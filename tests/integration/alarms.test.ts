import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {alarmConditions, evaluateConditions, heartbeatStaleCondition, ledgerPendingCondition, monitorLateCondition, unobservable, type AlarmCondition} from '@/lib/alarm-conditions';
import {dispatchDueMail, raiseAlarm as pushAlarm, runAlarmMonitor, runHeartbeatEvaluation} from '@/lib/alarms';
import {handleHeartbeatRequest} from '@/lib/heartbeat';
import {alarmObservations, alarmsDueMail, alarmSubjectPattern, isAlarmDetail, ledgerPending, listAlarms, raiseAlarm, recordAlarmNotice, recordHeartbeat, resolveAlarm, revokeServiceKey} from '@/lib/lifecycle';
import {sendAlarmMail, type AlarmNotice, type MailOutcome} from '@/lib/mailer';
import {scheduleRegistry} from '@/lib/schedules';
import {signHeartbeat} from '@/lib/service-signing';
import {createHarness, stack, tag} from '../support/accounts-db';
import {deleteMail, listMail, readMail} from '../support/mail';
import {jwtSecretOf, stackEnvironment} from '../support/stack';
import {signRaw, testSigner} from '../support/service-keys';

// Story 1.13 against the Supabase CLI stack: the three alarm tables and their guards, the seven functions (raise, resolve, list, due mail, notice,
// observations, heartbeat), the email rule with real notices at real times, the closure of every new object, the preflight, the typed calls over REST, the
// monitor and the heartbeat route end to end with a fake sender and a fixture condition, and `sendAlarmMail` against the stack's Mailpit.
//
// Alarms, notices and heartbeats are append-only, so what a committed case writes STAYS. Every case therefore uses conditions and key IDs of its own
// (`it-<hex>`), asserts on them alone, and resolves what it opened (a resolved alarm is never emailed, so debris cannot be mailed by anything that runs
// later). Most cases run inside a transaction that is rolled back and leave nothing at all.

const {db, connect, inTx, attempt, rows} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
  await resolveDebris();
});
afterEach(async () => {
  await resolveDebris();
});
afterAll(async () => {
  await resolveDebris();
});

/** Resolves every open alarm a case of this file committed (their conditions start with `it-`). */
async function resolveDebris() {
  await db.query(`update lifecycle.alarms set resolved_at = greatest(latest_at, clock_timestamp()) where resolved_at is null and condition like 'it-%'`);
}

const uid = () => `it-${randomBytes(4).toString('hex')}`;
const svc = async (client: Client, sql: string, params: unknown[] = []) => (await rows(client, 'service_role', sql, params))[0];
const raise = (client: Client, condition: string, subject: string | null, detail: Record<string, unknown> = {}) =>
  svc(client, 'select outcome, alarm_id from api.raise_alarm($1, $2, $3)', [condition, subject, JSON.stringify(detail)]) as Promise<{outcome: string; alarm_id: string}>;
const resolve = (client: Client, condition: string, subject: string | null) => svc(client, 'select outcome, alarm_id from api.resolve_alarm($1, $2)', [condition, subject]) as Promise<{outcome: string; alarm_id: string | null}>;
const notice = (client: Client, alarmId: string, outcome: string) => svc(client, 'select outcome from api.record_alarm_notice($1, $2)', [alarmId, outcome]) as Promise<{outcome: string}>;
/** A notice at a time of the test's choosing (the owner writes it directly: the service role cannot, and the application never does). */
const noticeAt = (client: Client, alarmId: string, outcome: string, ago: string) =>
  client.query(`insert into lifecycle.alarm_notices (alarm_id, at, outcome) values ($1, clock_timestamp() - $2::interval, $3)`, [alarmId, ago, outcome]);
type Listed = {id: string; condition: string; subject: string | null; first_at: string; latest_at: string; resolved_at: string | null; detail: Record<string, unknown>; last_sent_at: string | null; last_notice_outcome: string | null; last_notice_at: string | null};
const list = async (client: Client, includeResolved: boolean, limit = 50) => ((await svc(client, 'select alarms from api.list_alarms($1, $2)', [includeResolved, limit])) as {alarms: Listed[]}).alarms;
const dueOf = async (client: Client, prefix: string) =>
  ((await svc(client, 'select alarms from api.alarms_due_mail(50)')) as {alarms: {id: string; condition: string; subject: string | null; first_at: string; detail: Record<string, unknown>}[]}).alarms.filter((alarm) => alarm.condition.startsWith(prefix));
const alarmRow = async (client: Client, id: string) => (await client.query('select * from lifecycle.alarms where id = $1', [id])).rows[0];

// ---------------------------------------------------------------------------------------------------
describe('the records', () => {
  it('has the three tables in the lifecycle schema, each closed: row-level security on, no policy, and no privilege for public, anon, authenticated or the service role', async () => {
    const {rows: tables} = await db.query(
      `select c.relname as name, c.relrowsecurity as rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c where c.relnamespace = 'lifecycle'::regnamespace and c.relkind = 'r' and c.relname in ('alarms', 'alarm_notices', 'heartbeats') order by 1`,
    );
    expect(tables).toEqual([
      {name: 'alarm_notices', rls: true, policies: 0},
      {name: 'alarms', rls: true, policies: 0},
      {name: 'heartbeats', rls: true, policies: 0},
    ]);
    for (const table of ['alarms', 'alarm_notices', 'heartbeats']) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const {rows: held} = await db.query(`select bool_or(has_table_privilege($1, $2, p)) as any from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p`, [role, `lifecycle.${table}`]);
        expect(held[0].any, `${role} on ${table}`).toBe(false);
      }
      const {rows: publicGrants} = await db.query(`select count(*)::int as n from pg_class c, aclexplode(c.relacl) a where c.oid = $1::regclass and a.grantee = 0`, [`lifecycle.${table}`]);
      expect(publicGrants[0].n, table).toBe(0);
    }
  });

  it('has the columns the spec names, with the checks the database holds on a condition, a subject and a detail', async () => {
    const {rows: columns} = await db.query(
      `select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'lifecycle' and table_name in ('alarms', 'alarm_notices', 'heartbeats') order by table_name, ordinal_position`,
    );
    expect(columns.map((column) => `${column.table_name}.${column.column_name}:${column.data_type}:${column.is_nullable}`)).toEqual([
      'alarm_notices.id:uuid:NO',
      'alarm_notices.alarm_id:uuid:NO',
      'alarm_notices.at:timestamp with time zone:NO',
      'alarm_notices.outcome:text:NO',
      'alarms.id:uuid:NO',
      'alarms.condition:text:NO',
      'alarms.subject:text:YES',
      'alarms.first_at:timestamp with time zone:NO',
      'alarms.latest_at:timestamp with time zone:NO',
      'alarms.resolved_at:timestamp with time zone:YES',
      'alarms.detail:json:NO',
      'heartbeats.id:uuid:NO',
      'heartbeats.jti:text:NO',
      'heartbeats.kid:text:NO',
      'heartbeats.received_at:timestamp with time zone:NO',
    ]);
  });

  it.each([
    ['a condition with a capital', 'Bad', null, {}],
    ['a condition with an underscore', 'bad_one', null, {}],
    ['a condition that starts with a digit', '1bad', null, {}],
    ['a condition of 49 characters', `a${'b'.repeat(48)}`, null, {}],
    ['an empty condition', '', null, {}],
    ['an empty subject', 'it-ok', '', {}],
    ['a subject with a space', 'it-ok', 'a b', {}],
    ['a subject with a slash', 'it-ok', 'a/b', {}],
    ['a subject of 65 characters', 'it-ok', 'x'.repeat(65), {}],
    ['a detail that is a list', 'it-ok', null, [1]],
    ['a detail with a nested object', 'it-ok', null, {a: {b: 1}}],
    ['a detail with a fraction', 'it-ok', null, {a: 1.5}],
    ['a detail with null', 'it-ok', null, {a: null}],
    ['a detail key with a capital', 'it-ok', null, {Count: 1}],
    ['a detail key with a hyphen', 'it-ok', null, {'a-b': 1}],
    ['a detail text of 81 characters', 'it-ok', null, {a: 'x'.repeat(81)}],
    ['a detail text that is not ASCII', 'it-ok', null, {a: 'café'}],
    ['a detail text with a line break', 'it-ok', null, {a: 'a\nb'}],
    ['a detail of more than 1 KB', 'it-ok', null, Object.fromEntries(Array.from({length: 30}, (_unused, index) => [`k_${index}`, 'x'.repeat(60)]))],
  ])('refuses %s, in the table itself (a direct insert) and through api.raise_alarm', async (_name, condition, subject, detail) => {
    await inTx(async (client) => {
      const direct = await attempt(client, null, 'insert into lifecycle.alarms (condition, subject, detail) values ($1, $2, $3)', [condition, subject, JSON.stringify(detail)]);
      expect(direct.ok).toBe(false);
      const viaFunction = await attempt(client, 'service_role', 'select * from api.raise_alarm($1, $2, $3)', [condition, subject, JSON.stringify(detail)]);
      expect(viaFunction.ok).toBe(false);
      if (!viaFunction.ok) expect(viaFunction.code).toBe('22023');
    });
  });

  it('accepts a detail of whole numbers, booleans and short printable text, including negative numbers and an empty object', async () => {
    await inTx(async (client) => {
      for (const detail of [{}, {count: 26, ok: true, receipt_task: 'ledger-relay', receipt_at: '2026-10-17T08:00:00.000Z'}, {negative: -5}, {text: 'x'.repeat(80)}, {empty: ''}]) {
        expect((await raise(client, uid(), null, detail)).outcome, JSON.stringify(detail)).toBe('opened');
      }
    });
    // A hand-written JSON that repeats a key is refused too (json keeps the text as written): the function the table's check calls is the one that decides.
    const {rows: duplicate} = await db.query(`select lifecycle.alarm_detail_ok('{"a": 1, "a": 2}'::json) as ok, lifecycle.alarm_detail_ok('{"a": 1, "b": 2}'::json) as fine`);
    expect(duplicate[0]).toEqual({ok: false, fine: true});
  });

  it('reads a whole number in a detail exactly as the application\'s own check does (review patch P4): 15 digits, with or without a minus sign, and no more', async () => {
    const detailFor = (value: unknown) => JSON.stringify({n: value});
    const text = [
      ['0', 0], ['-0', -0], ['1', 1], ['-1', -1], ['15 digits', 999_999_999_999_999], ['15 digits, negative', -999_999_999_999_999], ['16 digits', 1_000_000_000_000_000], ['16 digits, negative', -1_000_000_000_000_000],
      ['the largest safe integer', Number.MAX_SAFE_INTEGER], ['a fraction', 1.5], ['a large power of two', 2 ** 60], ['digits as text', '1000000000000000'], ['digits as long text', '9'.repeat(80)], ['too long text', '9'.repeat(81)],
    ] as const;
    for (const [name, value] of text) {
      const {rows: found} = await db.query('select lifecycle.alarm_detail_ok($1::json) as ok', [detailFor(value)]);
      expect(found[0].ok, `${name}: ${detailFor(value)}`).toBe(isAlarmDetail({n: value}));
    }
    // ... and the boundary is where the patch says: 15 digits are accepted, 16 are not.
    await inTx(async (client) => {
      expect((await attempt(client, 'service_role', 'select * from api.raise_alarm($1, null, $2)', [uid(), detailFor(999_999_999_999_999)])).ok).toBe(true);
      const refused = await attempt(client, 'service_role', 'select * from api.raise_alarm($1, null, $2)', [uid(), detailFor(1_000_000_000_000_000)]);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('22023');
    });
  });

  it('allows one open alarm for each (condition, subject), a null subject being one subject of its own', async () => {
    await inTx(async (client) => {
      const condition = uid();
      await client.query('insert into lifecycle.alarms (condition, subject, detail) values ($1, null, $2)', [condition, '{}']);
      await client.query('insert into lifecycle.alarms (condition, subject, detail) values ($1, $2, $3)', [condition, 'A', '{}']);
      await client.query('insert into lifecycle.alarms (condition, subject, detail) values ($1, $2, $3)', [condition, 'B', '{}']);
      for (const subject of [null, 'A', 'B']) {
        const again = await attempt(client, null, 'insert into lifecycle.alarms (condition, subject, detail) values ($1, $2, $3)', [condition, subject, '{}']);
        expect(again.ok, String(subject)).toBe(false);
        if (!again.ok) expect(again.code).toBe('23505');
      }
      // Once resolved, the pair may open again: the index holds the OPEN alarms only.
      await client.query(`update lifecycle.alarms set resolved_at = clock_timestamp() where condition = $1 and subject is null`, [condition]);
      expect((await attempt(client, null, 'insert into lifecycle.alarms (condition, subject, detail) values ($1, null, $2)', [condition, '{}'])).ok).toBe(true);
    });
  });

  it('refuses a latest time before the first, and a resolved time before the latest', async () => {
    await inTx(async (client) => {
      expect((await attempt(client, null, `insert into lifecycle.alarms (condition, detail, first_at, latest_at) values ($1, '{}', now(), now() - interval '1 minute')`, [uid()])).ok).toBe(false);
      expect((await attempt(client, null, `insert into lifecycle.alarms (condition, detail, first_at, latest_at, resolved_at) values ($1, '{}', now(), now(), now() - interval '1 minute')`, [uid()])).ok).toBe(false);
    });
  });

  it('keeps the time on the database clock: the application cannot choose it through the functions', async () => {
    await inTx(async (client) => {
      const before = (await client.query('select clock_timestamp() as now')).rows[0].now as Date;
      const id = (await raise(client, uid(), null)).alarm_id;
      const after = (await client.query('select clock_timestamp() as now')).rows[0].now as Date;
      const row = await alarmRow(client, id);
      expect(row.first_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1);
      expect(row.first_at.getTime()).toBeLessThanOrEqual(after.getTime() + 1);
      expect(row.latest_at.getTime()).toBe(row.first_at.getTime());
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the guards: nothing about an alarm changes but its latest time, its detail and being resolved, once', () => {
  it.each([
    ['id', `update lifecycle.alarms set id = gen_random_uuid() where id = $1`],
    ['condition', `update lifecycle.alarms set condition = 'it-changed' where id = $1`],
    ['subject', `update lifecycle.alarms set subject = 'other' where id = $1`],
    ['subject to null', `update lifecycle.alarms set subject = null where id = $1`],
    ['first time', `update lifecycle.alarms set first_at = first_at - interval '1 hour' where id = $1`],
    ['latest time, backwards', `update lifecycle.alarms set latest_at = latest_at - interval '1 second' where id = $1`],
  ])('refuses a change of its %s', async (_name, sql) => {
    await inTx(async (client) => {
      const id = (await raise(client, uid(), 'subject-a')).alarm_id;
      const result = await attempt(client, null, sql, [id]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('55000');
    });
  });

  it('lets the latest time move forward and the detail change while the alarm is open, and the alarm be resolved once', async () => {
    await inTx(async (client) => {
      const id = (await raise(client, uid(), null, {count: 1})).alarm_id;
      expect((await attempt(client, null, `update lifecycle.alarms set latest_at = latest_at + interval '1 minute', detail = '{"count": 2}' where id = $1`, [id])).ok).toBe(true);
      expect((await attempt(client, null, `update lifecycle.alarms set resolved_at = clock_timestamp() + interval '2 minutes' where id = $1`, [id])).ok).toBe(true);
      // Resolved once: not again, not undone, not changed in any way. A resolved alarm is final.
      for (const sql of [
        `update lifecycle.alarms set resolved_at = resolved_at + interval '1 minute' where id = $1`,
        `update lifecycle.alarms set resolved_at = null where id = $1`,
        `update lifecycle.alarms set detail = '{}' where id = $1`,
        `update lifecycle.alarms set latest_at = latest_at + interval '1 hour', resolved_at = resolved_at + interval '2 hours' where id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [id]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code).toBe('55000');
      }
    });
  });

  it('never deletes or truncates an alarm, a notice or a heartbeat, and never changes a notice or a heartbeat', async () => {
    await inTx(async (client) => {
      const id = (await raise(client, uid(), null)).alarm_id;
      await notice(client, id, 'sent');
      await svc(client, 'select outcome from api.record_heartbeat($1, $2)', [`it-${tag()}`, 'BBBBBBBBBBBBBBBBBBBBBB']);
      for (const sql of [
        'delete from lifecycle.alarms',
        'truncate lifecycle.alarms cascade',
        'delete from lifecycle.alarm_notices',
        `update lifecycle.alarm_notices set outcome = 'failed'`,
        `update lifecycle.alarm_notices set at = now()`,
        'truncate lifecycle.alarm_notices',
        'delete from lifecycle.heartbeats',
        `update lifecycle.heartbeats set kid = 'other'`,
        'truncate lifecycle.heartbeats',
      ]) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
    });
  });

  it('refuses a notice for no alarm, and an outcome that is not one, in the table itself', async () => {
    await inTx(async (client) => {
      expect((await attempt(client, null, `insert into lifecycle.alarm_notices (alarm_id, outcome) values (gen_random_uuid(), 'sent')`)).ok).toBe(false);
      const id = (await raise(client, uid(), null)).alarm_id;
      for (const outcome of ['delivered', 'SENT', '']) expect((await attempt(client, null, `insert into lifecycle.alarm_notices (alarm_id, outcome) values ($1, $2)`, [id, outcome])).ok, outcome).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.raise_alarm and api.resolve_alarm', () => {
  it('opens an alarm, refreshes the open one for the same pair (latest time and detail, never a second record), and keeps the first time and the ID', async () => {
    await inTx(async (client) => {
      const condition = uid();
      const first = await raise(client, condition, null, {count: 26});
      expect(first.outcome).toBe('opened');
      const before = await alarmRow(client, first.alarm_id);
      await client.query('select pg_sleep(0.02)');
      const second = await raise(client, condition, null, {count: 31});
      expect(second).toEqual({outcome: 'refreshed', alarm_id: first.alarm_id});
      const after = await alarmRow(client, first.alarm_id);
      expect(after.first_at).toEqual(before.first_at);
      expect(after.latest_at.getTime()).toBeGreaterThan(before.latest_at.getTime());
      expect(after.detail).toEqual({count: 31});
      expect((await client.query('select count(*)::int as n from lifecycle.alarms where condition = $1', [condition])).rows[0].n).toBe(1);
    });
  });

  it('keys an alarm by its subject: two subjects are two alarms, and the repeat of one is no third', async () => {
    await inTx(async (client) => {
      const condition = uid();
      const a = await raise(client, condition, 'A');
      const b = await raise(client, condition, 'B');
      const none = await raise(client, condition, null);
      expect(new Set([a.alarm_id, b.alarm_id, none.alarm_id]).size).toBe(3);
      expect(await raise(client, condition, 'A')).toEqual({outcome: 'refreshed', alarm_id: a.alarm_id});
      expect((await client.query('select count(*)::int as n from lifecycle.alarms where condition = $1', [condition])).rows[0].n).toBe(3);
    });
  });

  it('resolves the open alarm once, keeps the record, and says `none` when nothing is open', async () => {
    await inTx(async (client) => {
      const condition = uid();
      const opened = await raise(client, condition, 'A');
      expect(await resolve(client, condition, 'B')).toEqual({outcome: 'none', alarm_id: null});
      expect(await resolve(client, condition, 'A')).toEqual({outcome: 'resolved', alarm_id: opened.alarm_id});
      expect(await resolve(client, condition, 'A')).toEqual({outcome: 'none', alarm_id: null});
      const row = await alarmRow(client, opened.alarm_id);
      expect(row.resolved_at).toBeInstanceOf(Date);
      expect(row.resolved_at.getTime()).toBeGreaterThanOrEqual(row.latest_at.getTime());
    });
  });

  it('opens a NEW alarm when a pair comes back after it was resolved, and keeps the old record', async () => {
    await inTx(async (client) => {
      const condition = uid();
      const first = await raise(client, condition, null);
      await resolve(client, condition, null);
      const second = await raise(client, condition, null);
      expect(second.outcome).toBe('opened');
      expect(second.alarm_id).not.toBe(first.alarm_id);
      expect((await client.query('select count(*)::int as n from lifecycle.alarms where condition = $1', [condition])).rows[0].n).toBe(2);
      expect((await alarmRow(client, first.alarm_id)).resolved_at).not.toBeNull();
      expect((await alarmRow(client, second.alarm_id)).resolved_at).toBeNull();
    });
  });

  it('serializes simultaneous raises of one pair under an advisory lock: one opens it, the rest refresh it (real connections)', async () => {
    const condition = uid();
    const clients = await Promise.all([connect(), connect(), connect(), connect()]);
    for (let round = 0; round < 3; round += 1) {
      const subject = `round-${round}`;
      const outcomes = await Promise.all(clients.map((client) => client.query('select outcome, alarm_id from api.raise_alarm($1, $2, $3)', [condition, subject, '{}']).then((result) => result.rows[0] as {outcome: string; alarm_id: string})));
      expect(outcomes.map((outcome) => outcome.outcome).sort()).toEqual(['opened', 'refreshed', 'refreshed', 'refreshed']);
      expect(new Set(outcomes.map((outcome) => outcome.alarm_id)).size).toBe(1);
    }
    expect((await db.query('select count(*)::int as n from lifecycle.alarms where condition = $1 and resolved_at is null', [condition])).rows[0].n).toBe(3);
  });

  it('serializes a raise against a resolve of the same pair: the pair is open or resolved, never both (real connections)', async () => {
    const condition = uid();
    await db.query('select api.raise_alarm($1, null, $2)', [condition, '{}']);
    const [a, b] = await Promise.all([connect(), connect()]);
    const results = await Promise.all([
      a.query('select outcome from api.resolve_alarm($1, null)', [condition]),
      b.query('select outcome from api.raise_alarm($1, null, $2)', [condition, '{}']),
    ]);
    const open = (await db.query('select count(*)::int as n from lifecycle.alarms where condition = $1 and resolved_at is null', [condition])).rows[0].n as number;
    // Either the raise refreshed the alarm and the resolve then closed it (no open alarm), or the resolve closed it first and the raise opened a new one (one open alarm).
    expect([results[1].rows[0].outcome === 'refreshed' ? 0 : 1]).toEqual([open]);
  });

  it('refuses arguments that name no alarm: a condition, a subject or a detail that is not one, with a 22023', async () => {
    await inTx(async (client) => {
      for (const sql of [
        `select * from api.raise_alarm(null, null, '{}')`,
        `select * from api.raise_alarm('it-x', null, null)`,
        `select * from api.raise_alarm('it-x', 'a b', '{}')`,
        `select * from api.resolve_alarm(null, null)`,
        `select * from api.resolve_alarm('Bad', null)`,
        `select * from api.resolve_alarm('it-x', '')`,
        `select * from api.record_alarm_notice(null, 'sent')`,
        `select * from api.record_alarm_notice(gen_random_uuid(), 'delivered')`,
        `select * from api.list_alarms(null, 5)`,
        `select * from api.list_alarms(true, 0)`,
        `select * from api.list_alarms(true, 51)`,
        `select * from api.alarms_due_mail(0)`,
        `select * from api.alarms_due_mail(51)`,
        `select * from api.record_heartbeat(null, 'AAAAAAAAAAAAAAAAAAAAAA')`,
        `select * from api.record_heartbeat('it-kid', 'short')`,
        `select * from api.record_heartbeat('bad kid', 'AAAAAAAAAAAAAAAAAAAAAA')`,
      ]) {
        const result = await attempt(client, 'service_role', sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('22023');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.list_alarms', () => {
  it('lists the open alarms newest first, then (on request) the most recently resolved ones, each with what its email state is read from', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      const old = await raise(client, `${prefix}-old`, null, {n: 1});
      await client.query('select pg_sleep(0.02)');
      const middle = await raise(client, `${prefix}-middle`, 'S', {n: 2});
      await client.query('select pg_sleep(0.02)');
      const recent = await raise(client, `${prefix}-recent`, null, {n: 3});
      const gone1 = await raise(client, `${prefix}-gone1`, null);
      await resolve(client, `${prefix}-gone1`, null);
      await client.query('select pg_sleep(0.02)');
      const gone2 = await raise(client, `${prefix}-gone2`, null);
      await resolve(client, `${prefix}-gone2`, null);

      await noticeAt(client, middle.alarm_id, 'sent', '2 hours');
      await noticeAt(client, middle.alarm_id, 'failed', '1 hour');
      await noticeAt(client, recent.alarm_id, 'unknown', '30 minutes');

      const mine = (alarms: Listed[]) => alarms.filter((alarm) => alarm.condition.startsWith(prefix));
      const open = mine(await list(client, false));
      expect(open.map((alarm) => alarm.id)).toEqual([recent.alarm_id, middle.alarm_id, old.alarm_id]);
      expect(open.every((alarm) => alarm.resolved_at === null)).toBe(true);

      const all = mine(await list(client, true));
      expect(all.map((alarm) => alarm.id)).toEqual([recent.alarm_id, middle.alarm_id, old.alarm_id, gone2.alarm_id, gone1.alarm_id]);

      const byId = Object.fromEntries(all.map((alarm) => [alarm.id, alarm]));
      expect(byId[old.alarm_id]).toMatchObject({condition: `${prefix}-old`, subject: null, detail: {n: 1}, last_sent_at: null, last_notice_outcome: null, last_notice_at: null});
      expect(byId[middle.alarm_id]).toMatchObject({subject: 'S', last_notice_outcome: 'failed'});
      expect(byId[middle.alarm_id].last_sent_at).not.toBeNull();
      expect(new Date(byId[middle.alarm_id].last_notice_at!).getTime()).toBeGreaterThan(new Date(byId[middle.alarm_id].last_sent_at!).getTime());
      expect(byId[recent.alarm_id]).toMatchObject({last_sent_at: null, last_notice_outcome: 'unknown'});
      expect(byId[gone1.alarm_id].resolved_at).not.toBeNull();
      // Times are UTC text to the millisecond.
      for (const alarm of all) expect(alarm.first_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  it('limits the resolved alarms it adds, never the open ones', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      for (let index = 0; index < 4; index += 1) {
        await raise(client, `${prefix}-r${index}`, null);
        await resolve(client, `${prefix}-r${index}`, null);
        await client.query('select pg_sleep(0.01)');
      }
      await raise(client, `${prefix}-open`, null);
      const limited = await list(client, true, 2);
      // (Other resolved alarms in the database count in the limit too: it is the most recent two, and these are the most recent.)
      expect(limited.filter((alarm) => alarm.resolved_at !== null).map((alarm) => alarm.condition)).toEqual([`${prefix}-r3`, `${prefix}-r2`]);
      expect(limited.filter((alarm) => alarm.condition === `${prefix}-open`)).toHaveLength(1);
      expect(limited.filter((alarm) => alarm.resolved_at !== null)).toHaveLength(2);
      expect((await list(client, false, 1)).every((alarm) => alarm.resolved_at === null)).toBe(true);
    });
  });

  // CHANGED (F1): `api.alarms_due_mail` was in this list. It claims what it returns, so it writes and is not read-only; the two readers are, and the claim is its own test.
  it('is read-only (the list and the observations): they work in a read-only transaction; the due-mail function does not, because it claims what it returns', async () => {
    await inTx(async (client) => {
      await client.query('set transaction read only');
      expect((await attempt(client, 'service_role', 'select * from api.list_alarms(true, 5)')).ok).toBe(true);
      expect((await attempt(client, 'service_role', 'select * from api.alarm_observations()')).ok).toBe(true);
      const claiming = await attempt(client, 'service_role', 'select * from api.alarms_due_mail(5)');
      expect(claiming.ok).toBe(false);
      if (!claiming.ok) expect(claiming.code).toBe('25006');
    });
    expect((await db.query(`select provolatile from pg_proc where oid = 'api.alarms_due_mail(integer)'::regprocedure`)).rows[0].provolatile).toBe('v');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.alarms_due_mail: the email rule, with notices at the times the rule is about', () => {
  it('makes an open alarm with no notice due, a subject-keyed one and a threshold one alike', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      const threshold = await raise(client, `${prefix}-t`, null, {n: 1});
      const keyed = await raise(client, `${prefix}-s`, 'A', {n: 2});
      const due = await dueOf(client, prefix);
      expect(due.map((alarm) => alarm.id).sort()).toEqual([threshold.alarm_id, keyed.alarm_id].sort());
      expect(due.find((alarm) => alarm.id === keyed.alarm_id)).toMatchObject({condition: `${prefix}-s`, subject: 'A', detail: {n: 2}});
      expect(due[0].first_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  it('stops being due once a `sent` notice is recorded, and is due again 24 hours after it (one reminder), not before', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      const id = (await raise(client, `${prefix}-t`, null)).alarm_id;
      await notice(client, id, 'sent');
      expect(await dueOf(client, prefix)).toEqual([]);
      const aged = (await raise(client, `${prefix}-aged`, null)).alarm_id;
      await noticeAt(client, aged, 'sent', '23 hours 59 minutes');
      expect(await dueOf(client, `${prefix}-aged`)).toEqual([]);
      const reminder = (await raise(client, `${prefix}-reminder`, null)).alarm_id;
      await noticeAt(client, reminder, 'sent', '24 hours 1 minute');
      expect((await dueOf(client, `${prefix}-reminder`)).map((alarm) => alarm.id)).toEqual([reminder]);
      // ... and the reminder, once sent, closes the next 24 hours too.
      await notice(client, reminder, 'sent');
      expect(await dueOf(client, `${prefix}-reminder`)).toEqual([]);
    });
  });

  it('is retried at the next evaluation after a `failed` or an `unknown` notice, however many: neither closes a window', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      const id = (await raise(client, `${prefix}-t`, null)).alarm_id;
      await notice(client, id, 'failed');
      await notice(client, id, 'unknown');
      await notice(client, id, 'failed');
      expect((await dueOf(client, prefix)).map((alarm) => alarm.id)).toEqual([id]);
      const keyed = (await raise(client, `${prefix}-s`, 'A')).alarm_id;
      await notice(client, keyed, 'unknown');
      expect((await dueOf(client, `${prefix}-s`)).map((alarm) => alarm.id)).toEqual([keyed]);
    });
  });

  it('never makes a resolved alarm due', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      await raise(client, `${prefix}-t`, null);
      await raise(client, `${prefix}-s`, 'A');
      await resolve(client, `${prefix}-t`, null);
      await resolve(client, `${prefix}-s`, 'A');
      expect(await dueOf(client, prefix)).toEqual([]);
    });
  });

  it('holds a THREshold alarm back while its condition was emailed in the last 24 hours (for another alarm), and makes it due when that window ends if it is still open', async () => {
    await inTx(async (client) => {
      const condition = uid();
      const first = (await raise(client, condition, null)).alarm_id;
      await noticeAt(client, first, 'sent', '1 hour');
      await resolve(client, condition, null);
      // The condition came back: a new record, not emailed inside the window of the first.
      const second = (await raise(client, condition, null)).alarm_id;
      expect(second).not.toBe(first);
      expect(await dueOf(client, condition)).toEqual([]);
    });
    await inTx(async (client) => {
      const condition = uid();
      const first = (await raise(client, condition, null)).alarm_id;
      await noticeAt(client, first, 'sent', '25 hours');
      await resolve(client, condition, null);
      const second = (await raise(client, condition, null)).alarm_id;
      expect((await dueOf(client, condition)).map((alarm) => alarm.id)).toEqual([second]);
    });
  });

  it('does not hold a subject-keyed alarm back for another subject of its condition: each subject has its own alarm and email', async () => {
    await inTx(async (client) => {
      const condition = uid();
      const a = (await raise(client, condition, 'A')).alarm_id;
      const b = (await raise(client, condition, 'B')).alarm_id;
      await notice(client, a, 'sent');
      // A repeats: the same record, and nothing due for it. B was never emailed and is due.
      expect(await raise(client, condition, 'A')).toEqual({outcome: 'refreshed', alarm_id: a});
      expect((await dueOf(client, condition)).map((alarm) => alarm.id)).toEqual([b]);
      await notice(client, b, 'sent');
      expect(await dueOf(client, condition)).toEqual([]);
    });
  });

  it('holds a threshold alarm back for a `sent` notice of a subject-keyed alarm of its own condition, as the rule says "any alarm of the same condition"', async () => {
    await inTx(async (client) => {
      const condition = uid();
      const keyed = (await raise(client, condition, 'A')).alarm_id;
      await notice(client, keyed, 'sent');
      await raise(client, condition, null);
      expect(await dueOf(client, condition)).toEqual([]);
    });
  });

  it('lists the oldest first and at most the limit', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      const ids: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        ids.push((await raise(client, `${prefix}-${index}`, null)).alarm_id);
        await client.query('select pg_sleep(0.01)');
      }
      expect((await dueOf(client, prefix)).map((alarm) => alarm.id)).toEqual(ids);
    });
    // ... and the limit holds: one is handed out, the oldest due one in the database (which, in a database that holds no other due alarm, is the first of these).
    await inTx(async (client) => {
      const prefix = uid();
      const ids: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        ids.push((await raise(client, `${prefix}-${index}`, null)).alarm_id);
        await client.query('select pg_sleep(0.01)');
      }
      const one = (await svc(client, 'select alarms from api.alarms_due_mail(1)')) as {alarms: {id: string}[]};
      expect(one.alarms).toHaveLength(1);
      // It was claimed, so the next call hands out the next one and not the same.
      const next = (await svc(client, 'select alarms from api.alarms_due_mail(1)')) as {alarms: {id: string}[]};
      expect(next.alarms).toHaveLength(1);
      expect(next.alarms[0].id).not.toBe(one.alarms[0].id);
    });
  });

  it('records a notice for an alarm, and says `not_found` for none', async () => {
    await inTx(async (client) => {
      const id = (await raise(client, uid(), null)).alarm_id;
      for (const outcome of ['sent', 'failed', 'unknown']) expect(await notice(client, id, outcome)).toEqual({outcome: 'recorded'});
      expect(await notice(client, randomUUID(), 'sent')).toEqual({outcome: 'not_found'});
      expect((await client.query('select outcome from lifecycle.alarm_notices where alarm_id = $1 order by at, id', [id])).rows.map((row) => row.outcome)).toEqual(['sent', 'failed', 'unknown']);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.alarm_observations', () => {
  const observe = async (client: Client) =>
    (await svc(client, 'select first_receipt_age, latest_receipt_age, first_heartbeat_age, latest_heartbeat_age, ledger_pending, ledger_oldest, unaccounted, tasks from api.alarm_observations()')) as {
      first_receipt_age: string | number | null;
      latest_receipt_age: string | number | null;
      first_heartbeat_age: string | number | null;
      latest_heartbeat_age: string | number | null;
      ledger_pending: number;
      ledger_oldest: string | number | null;
      unaccounted: number;
      tasks: {task: string; outcome: string; at: string; age: number}[];
    };
  const insertReceipt = (client: Client, task: string, options: {startedAgo: string; finishedAgo?: string | null; outcome?: string}) =>
    client.query(
      `insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt, started_at, finished_at, outcome, result)
       values ($1, $2, $3, 1, clock_timestamp() - $4::interval, case when $5::text is null then null else clock_timestamp() - $5::interval end, case when $5::text is null then null else $6 end, case when $5::text is null then null else '{}'::json end)`,
      [task, `scd_${randomUUID()}`, `msg_${randomUUID()}`, options.startedAgo, options.finishedAgo ?? null, options.outcome ?? 'ran'],
    );

  it('reports each task\'s newest FINISHED receipt, with its outcome, its time and its age in seconds on the database clock', async () => {
    await inTx(async (client) => {
      const task = uid();
      const unfinished = uid();
      await insertReceipt(client, task, {startedAgo: '5 hours', finishedAgo: '5 hours', outcome: 'failed'});
      await insertReceipt(client, task, {startedAgo: '3 hours 1 second', finishedAgo: '3 hours', outcome: 'no_store'});
      await insertReceipt(client, task, {startedAgo: '10 seconds', finishedAgo: null});
      await insertReceipt(client, unfinished, {startedAgo: '1 hour', finishedAgo: null});
      const observed = await observe(client);
      const mine = observed.tasks.filter((entry) => entry.task === task || entry.task === unfinished);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({task, outcome: 'no_store'});
      expect(Number(mine[0].age)).toBeGreaterThanOrEqual(10_800);
      expect(Number(mine[0].age)).toBeLessThan(10_830);
      expect(mine[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  it('reports the age of the first receipt of any task and of the latest one (finished or not), and null for neither when there is none', async () => {
    await inTx(async (client) => {
      await insertReceipt(client, uid(), {startedAgo: '30 days', finishedAgo: '30 days'});
      await insertReceipt(client, uid(), {startedAgo: '2 seconds', finishedAgo: null});
      const observed = await observe(client);
      expect(Number(observed.first_receipt_age)).toBeGreaterThanOrEqual(30 * 86_400);
      expect(Number(observed.latest_receipt_age)).toBeLessThanOrEqual(5);
    });
  });

  it('reports the age of the first heartbeat and of the latest', async () => {
    await inTx(async (client) => {
      await client.query(`insert into lifecycle.heartbeats (jti, kid, received_at) values ($1, 'it-kid', clock_timestamp() - interval '9 hours')`, [randomBytes(16).toString('base64url')]);
      await client.query(`insert into lifecycle.heartbeats (jti, kid, received_at) values ($1, 'it-kid', clock_timestamp() - interval '1 second')`, [randomBytes(16).toString('base64url')]);
      const observed = await observe(client);
      expect(Number(observed.first_heartbeat_age)).toBeGreaterThanOrEqual(9 * 3600);
      expect(Number(observed.latest_heartbeat_age)).toBeLessThanOrEqual(5);
    });
  });

  it('reports the ledger backlog the way api.ledger_pending does', async () => {
    await inTx(async (client) => {
      const observed = await observe(client);
      const pending = (await svc(client, 'select pending, oldest_seconds from api.ledger_pending()')) as {pending: number; oldest_seconds: string | null};
      expect(observed.ledger_pending).toBe(pending.pending);
      if (pending.oldest_seconds === null) expect(observed.ledger_oldest).toBeNull();
      else expect(Math.abs(Number(observed.ledger_oldest) - Number(pending.oldest_seconds))).toBeLessThanOrEqual(2);
    });
  });

  it('counts the Auth identities that have no Account, and the application never names auth.users to do it', async () => {
    await inTx(async (client) => {
      const before = (await observe(client)).unaccounted;
      const direct = Number((await client.query('select count(*) as n from auth.users u where not exists (select 1 from identity.accounts a where a.user_id = u.id)')).rows[0].n);
      expect(before).toBe(direct);
      for (let index = 0; index < 3; index += 1) await client.query(`insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now())`, [`obs-${tag()}-${index}@example.test`]);
      expect((await observe(client)).unaccounted).toBe(before + 3);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_heartbeat', () => {
  const beat = (client: Client, kid: string, jti: string) => svc(client, 'select outcome from api.record_heartbeat($1, $2)', [kid, jti]) as Promise<{outcome: string}>;
  const jti = () => randomBytes(16).toString('base64url');

  it('records a heartbeat once, and a repeat of its jti is a duplicate that adds nothing', async () => {
    await inTx(async (client) => {
      const kid = `it-${tag()}`;
      const token = jti();
      expect(await beat(client, kid, token)).toEqual({outcome: 'recorded'});
      expect(await beat(client, kid, token)).toEqual({outcome: 'duplicate'});
      expect(await beat(client, `it-${tag()}`, token)).toEqual({outcome: 'duplicate'});
      expect((await client.query('select kid from lifecycle.heartbeats where jti = $1', [token])).rows).toEqual([{kid}]);
      expect(await beat(client, kid, jti())).toEqual({outcome: 'recorded'});
    });
  });

  it('refuses a revoked heartbeat key, and records nothing for it; another issuer\'s revocation of the same key ID does not revoke it', async () => {
    await inTx(async (client) => {
      const kid = `it-${tag()}`;
      expect(((await svc(client, `select outcome from api.revoke_service_key('application', $1, 'test')`, [kid])) as {outcome: string}).outcome).toBe('revoked');
      expect(await beat(client, kid, jti())).toEqual({outcome: 'recorded'});
      expect(((await svc(client, `select outcome from api.revoke_service_key('heartbeat', $1, 'test')`, [kid])) as {outcome: string}).outcome).toBe('revoked');
      const token = jti();
      expect(await beat(client, kid, token)).toEqual({outcome: 'revoked'});
      expect((await client.query('select 1 from lifecycle.heartbeats where jti = $1', [token])).rowCount).toBe(0);
    });
  });

  it('serializes simultaneous heartbeats with one jti: one is recorded, the rest are duplicates (real connections)', async () => {
    const clients = await Promise.all([connect(), connect(), connect()]);
    const token = jti();
    const results = await Promise.all(clients.map((client) => client.query('select outcome from api.record_heartbeat($1, $2)', ['it-hb-race', token]).then((result) => result.rows[0].outcome as string)));
    expect(results.sort()).toEqual(['duplicate', 'duplicate', 'recorded']);
  });

  // The lock is what makes a heartbeat and the revocation of its key serial (the same shared/exclusive advisory lock a ticket's redemption takes). The test HOLDS an
  // uncommitted revocation on one connection, calls `record_heartbeat` on another and requires it to BLOCK until the revocation commits, and then to answer `revoked`;
  // it fails without the lock (mutation-checked: with `pg_advisory_xact_lock_shared` removed from api.record_heartbeat the call does not wait, it records the heartbeat).
  // The mirror case holds a heartbeat in flight and requires the revocation to wait for it. (Review patch P9b; the pattern is tests/integration/file-gateway-db.test.ts.)
  it('serializes a heartbeat against the revocation of its key: a revocation held open blocks the heartbeat until it commits, which then answers `revoked`; a heartbeat held open blocks the revocation (real connections)', async () => {
    const pidOf = async (client: Client) => Number((await client.query('select pg_backend_pid() as pid')).rows[0].pid);
    const waitingOnLock = async (pid: number) => {
      for (let tries = 0; tries < 100; tries += 1) {
        const {rows: waiting} = await db.query('select wait_event_type as type, wait_event as event from pg_stat_activity where pid = $1', [pid]);
        if (waiting[0]?.type === 'Lock') return waiting[0].event as string;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('The other connection never started waiting for the lock.');
    };

    // 1. The revocation is first and not committed: the heartbeat waits for it, then finds the key revoked, and nothing is recorded.
    {
      const kid = `it-${tag()}`;
      const token = jti();
      const [revoker, beater] = await Promise.all([connect(), connect()]);
      try {
        await revoker.query('begin');
        await revoker.query(`select * from api.revoke_service_key('heartbeat', $1, 'race')`, [kid]);
        const beaterPid = await pidOf(beater);
        let finished = false;
        const heartbeat = beater.query('select outcome from api.record_heartbeat($1, $2)', [kid, token]).then((result) => {
          finished = true;
          return result.rows[0].outcome as string;
        });
        expect(await waitingOnLock(beaterPid)).toBe('advisory');
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(finished, 'the heartbeat waits for the revocation in flight').toBe(false);
        await revoker.query('commit');
        expect(await heartbeat).toBe('revoked');
        expect((await db.query('select 1 from lifecycle.heartbeats where jti = $1', [token])).rowCount).toBe(0);
      } finally {
        await revoker.query('rollback').catch(() => undefined);
      }
    }
    // 2. The heartbeat is first and not committed: the revocation waits for it, and then the key is revoked for every heartbeat after it.
    {
      const kid = `it-${tag()}`;
      const [beater, revoker] = await Promise.all([connect(), connect()]);
      try {
        await beater.query('begin');
        expect(((await beater.query('select outcome from api.record_heartbeat($1, $2)', [kid, jti()])).rows[0] as {outcome: string}).outcome).toBe('recorded');
        const revokerPid = await pidOf(revoker);
        let finished = false;
        const revocation = revoker.query(`select outcome from api.revoke_service_key('heartbeat', $1, 'race')`, [kid]).then((result) => {
          finished = true;
          return result.rows[0].outcome as string;
        });
        expect(await waitingOnLock(revokerPid)).toBe('advisory');
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(finished, 'the revocation waits for the heartbeat in flight').toBe(false);
        await beater.query('commit');
        expect(await revocation).toBe('revoked');
      } finally {
        await beater.query('rollback').catch(() => undefined);
      }
      expect(((await db.query('select outcome from api.record_heartbeat($1, $2)', [kid, jti()])).rows[0] as {outcome: string}).outcome).toBe('revoked');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('closure: the tables and the seven functions are reachable by the service role through the api alone', () => {
  const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  function authenticatedToken() {
    const claims = {iss: `${stack.apiUrl}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: randomUUID(), session_id: randomUUID(), exp: Math.floor(Date.now() / 1000) + 600};
    const unsigned = `${base64url({alg: 'HS256', typ: 'JWT'})}.${base64url(claims)}`;
    return `${unsigned}.${createHmac('sha256', jwtSecretOf(stack)).update(unsigned).digest('base64url')}`;
  }
  const rest = (token: string, path: string, init: RequestInit & {profile?: string} = {}) =>
    fetch(`${stack.apiUrl}/rest/v1/${path}`, {
      ...init,
      headers: {apikey: stack.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.profile ? {'accept-profile': init.profile, 'content-profile': init.profile} : {}), ...init.headers},
    });
  const closureCondition = uid();
  const bodies = (): Record<string, unknown> => ({
    raise_alarm: {p_condition: closureCondition, p_subject: null, p_detail: {}},
    resolve_alarm: {p_condition: closureCondition, p_subject: null},
    list_alarms: {p_include_resolved: true, p_limit: 5},
    alarms_due_mail: {p_limit: 1},
    record_alarm_notice: {p_alarm_id: randomUUID(), p_outcome: 'sent'},
    alarm_observations: {},
    record_heartbeat: {p_kid: 'it-closure', p_jti: 'CCCCCCCCCCCCCCCCCCCCCC'},
  });

  it('refuses every read, write and delete of each table to anon, authenticated and the service role over REST: a permission error and no row', async () => {
    await db.query('select api.raise_alarm($1, null, $2)', [closureCondition, '{}']);
    for (const table of ['alarms', 'alarm_notices', 'heartbeats']) {
      for (const token of [stack.anonKey, authenticatedToken(), stack.serviceKey]) {
        const read = await rest(token, `${table}?select=*`, {profile: 'lifecycle'});
        const text = await read.text();
        expect([401, 403], `${table} read ${read.status}`).toContain(read.status);
        expect(JSON.parse(text).code).toBe('42501');
        for (const [method, path, body] of [['POST', table, '{}'], ['DELETE', `${table}?id=not.is.null`, undefined], ['PATCH', `${table}?id=not.is.null`, '{}']] as const) {
          const write = await rest(token, path, {method, profile: 'lifecycle', body});
          expect([401, 403], `${table} ${method}`).toContain(write.status);
        }
      }
    }
    expect((await db.query(`select count(*)::int as n from lifecycle.alarms where condition = $1`, [closureCondition])).rows[0].n).toBe(1);
  });

  it('does not publish the tables, and lets no one call the helpers of the lifecycle schema over REST', async () => {
    for (const token of [stack.anonKey, authenticatedToken()]) {
      const text = await (await rest(token, '', {profile: 'lifecycle', headers: {accept: 'application/openapi+json'}})).text();
      for (const table of ['"/alarms"', '"/alarm_notices"', '"/heartbeats"']) expect(text).not.toContain(table);
    }
    for (const helper of ['alarm_detail_ok', 'iso_utc', 'age_seconds', 'guard_alarm']) {
      for (const token of [stack.anonKey, authenticatedToken(), stack.serviceKey]) {
        const response = await rest(token, `rpc/${helper}`, {method: 'POST', profile: 'lifecycle', body: '{}'});
        expect(response.status, helper).toBeGreaterThanOrEqual(400);
        expect(response.status, helper).toBeLessThan(500);
      }
    }
  });

  it('refuses the seven functions to the anon key and an authenticated token with a permission error, and lets the service role call the read-only ones', async () => {
    for (const token of [stack.anonKey, authenticatedToken()]) {
      for (const [name, body] of Object.entries(bodies())) {
        const response = await rest(token, `rpc/${name}`, {method: 'POST', profile: 'api', body: JSON.stringify(body)});
        expect([401, 403], name).toContain(response.status);
        expect((await response.json()).code, name).toBe('42501');
      }
    }
    for (const name of ['list_alarms', 'alarms_due_mail', 'alarm_observations', 'raise_alarm', 'resolve_alarm']) {
      const response = await rest(stack.serviceKey, `rpc/${name}`, {method: 'POST', profile: 'api', body: JSON.stringify(bodies()[name])});
      expect(response.status, name).toBe(200);
    }
  });

  it('refuses the file gateway\'s database role every one of the tables and functions: it holds no lifecycle object', async () => {
    await inTx(async (client) => {
      for (const sql of ['select 1 from lifecycle.alarms', 'select 1 from lifecycle.alarm_notices', 'select 1 from lifecycle.heartbeats', `insert into lifecycle.heartbeats (jti, kid) values ('DDDDDDDDDDDDDDDDDDDDDD', 'x')`, `select * from api.raise_alarm('it-x', null, '{}')`, 'select * from api.list_alarms(true, 5)', 'select * from api.alarm_observations()']) {
        const result = await attempt(client, 'nova3d_gateway', sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('42501');
      }
    });
  });

  it('makes every new function run with an empty search_path, the api ones as their owner and executable by the service role alone, the lifecycle helpers by nobody', async () => {
    const {rows: functions} = await db.query(
      `select p.proname as name, n.nspname as schema, p.prosecdef as definer, p.proconfig as config,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('raise_alarm', 'resolve_alarm', 'list_alarms', 'alarms_due_mail', 'record_alarm_notice', 'alarm_observations', 'record_heartbeat', 'alarm_detail_ok', 'iso_utc', 'age_seconds', 'guard_alarm') order by 1`,
    );
    expect(functions.map((entry) => entry.name)).toEqual(['age_seconds', 'alarm_detail_ok', 'alarm_observations', 'alarms_due_mail', 'guard_alarm', 'iso_utc', 'list_alarms', 'raise_alarm', 'record_alarm_notice', 'record_heartbeat', 'resolve_alarm']);
    for (const entry of functions) {
      expect(String(entry.config), entry.name).toContain('search_path=');
      if (entry.schema === 'api') {
        expect(entry.definer, entry.name).toBe(true);
        expect(entry.grantees, entry.name).toEqual(['service_role']);
      } else {
        expect(entry.grantees, entry.name).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries every earlier probe and the new ones', () => {
  const signatures = [
    'api.raise_alarm(text, text, json)',
    'api.resolve_alarm(text, text)',
    'api.list_alarms(boolean, integer)',
    'api.alarms_due_mail(integer)',
    'api.record_alarm_notice(uuid, text)',
    'api.alarm_observations()',
    'api.record_heartbeat(text, text)',
    'lifecycle.alarm_detail_ok(json)',
  ];

  it('answers ok, reads the three tables and their columns, and looks for the eight functions', async () => {
    await inTx(async (client) => {
      expect(await svc(client, 'select ok from api.preflight()')).toEqual({ok: true});
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [
      // Every earlier probe is still there.
      'identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts', 'artifacts.staging_leases', 'artifacts.manifests', 'artifacts.session_authority', 'artifacts.instance',
      'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims', 'delete on auth.sessions', 'delete Auth identities', 'private-files', 'Story 1.12 migration',
      // And the new ones.
      'lifecycle.alarms', 'k.condition', 'k.resolved_at', 'k.detail', 'lifecycle.alarm_notices', 'e.outcome', 'lifecycle.heartbeats', 'z.jti', 'z.received_at',
      ...signatures.map((signature) => signature.replace(/, /g, ',')),
      'Story 1.13 migration',
    ]) expect(definition, needle).toContain(needle);
    // It reads no row of auth.users (the identities are counted by api.alarm_observations, not here).
    expect(definition).not.toMatch(/from auth\.users/);
    // The seven new `api` functions are among those the service role must be able to execute (thirty-one in all when this story added them, thirty-three since Story 2.1 added two, thirty-five since Story 2.2 added two more, thirty-six since Story 2.3 added one, thirty-eight since Story 2.12 added two).
    const check = definition.indexOf('where not has_function_privilege');
    const executable = definition.slice(definition.lastIndexOf('unnest(array[', check), check);
    expect(executable.match(/'api\.[a-z_]+\([^']*\)'/g)).toHaveLength(38);
    // The bucket check stays last.
    expect(definition.indexOf('private-files')).toBeGreaterThan(definition.indexOf('delete Auth identities'));
  });

  it.each(signatures)('fails the build with one line naming %s when it is missing', async (signature) => {
    await inTx(async (client) => {
      await client.query(`drop function ${signature} cascade`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('Story 1.13');
        expect(result.message).toContain(signature.replace(/, /g, ','));
      }
    });
  });

  it.each(signatures.filter((signature) => signature.startsWith('api.')))('fails when the service role cannot execute %s', async (signature) => {
    await inTx(async (client) => {
      await client.query(`revoke execute on function ${signature} from service_role`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(signature.replace(/, /g, ','));
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls against the real stack (lib/lifecycle.ts, over REST)', () => {
  it('raises, lists, mails, notices, resolves and observes through the application\'s own calls, and reads the real answers', async () => {
    const condition = uid();
    const options = {env};
    const opened = await raiseAlarm({condition, subject: 'ledger-relay', detail: {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T08:00:00.000Z', age_seconds: 700}}, options);
    expect(opened.outcome).toBe('opened');
    expect(await raiseAlarm({condition, subject: 'ledger-relay', detail: {age_seconds: 800}}, options)).toEqual({outcome: 'refreshed', alarmId: opened.alarmId});

    const open = (await listAlarms({}, options)).filter((alarm) => alarm.condition === condition);
    expect(open).toEqual([expect.objectContaining({id: opened.alarmId, subject: 'ledger-relay', resolvedAt: null, detail: {age_seconds: 800}, lastSentAt: null, lastNoticeOutcome: null})]);

    expect((await alarmsDueMail({}, options)).filter((alarm) => alarm.condition === condition)).toEqual([{id: opened.alarmId, condition, subject: 'ledger-relay', firstAt: open[0].firstAt, detail: {age_seconds: 800}}]);
    expect(await recordAlarmNotice({alarmId: opened.alarmId, outcome: 'failed'}, options)).toEqual({outcome: 'recorded'});
    expect((await alarmsDueMail({}, options)).filter((alarm) => alarm.condition === condition)).toHaveLength(1);
    expect(await recordAlarmNotice({alarmId: opened.alarmId, outcome: 'sent'}, options)).toEqual({outcome: 'recorded'});
    expect((await alarmsDueMail({}, options)).filter((alarm) => alarm.condition === condition)).toEqual([]);
    const emailed = (await listAlarms({}, options)).find((alarm) => alarm.id === opened.alarmId)!;
    expect(emailed).toMatchObject({lastNoticeOutcome: 'sent'});
    expect(emailed.lastSentAt).not.toBeNull();

    expect(await resolveAlarm({condition, subject: 'ledger-relay'}, options)).toEqual({outcome: 'resolved', alarmId: opened.alarmId});
    expect(await resolveAlarm({condition, subject: 'ledger-relay'}, options)).toEqual({outcome: 'none'});
    const resolved = (await listAlarms({includeResolved: true, limit: 50}, options)).find((alarm) => alarm.id === opened.alarmId);
    expect(resolved?.resolvedAt).toMatch(/Z$/);
  });

  it('reads the real observations: every field the registry reads is the shape the typed call accepts, and the backlog agrees with ledgerPending', async () => {
    const observed = await alarmObservations({env});
    expect(Object.keys(observed).sort()).toEqual(['firstHeartbeatAge', 'firstReceiptAge', 'latestHeartbeatAge', 'latestReceiptAge', 'ledgerOldest', 'ledgerWaiting', 'tasks', 'unaccounted']);
    const backlog = await ledgerPending({env});
    expect(Math.abs(observed.ledgerWaiting - backlog.pending)).toBeLessThanOrEqual(5);
    for (const entry of observed.tasks) expect(entry.at).toMatch(/Z$/);
  });

  it('records a heartbeat and refuses a revoked key and a repeat, through the typed calls', async () => {
    const kid = `it-${tag()}`;
    const token = randomBytes(16).toString('base64url');
    expect(await recordHeartbeat({kid, jti: token}, {env})).toEqual({outcome: 'recorded'});
    expect(await recordHeartbeat({kid, jti: token}, {env})).toEqual({outcome: 'duplicate'});
    expect(await revokeServiceKey({issuer: 'heartbeat', kid, reason: 'test'}, {env})).toMatchObject({outcome: 'revoked'});
    expect(await recordHeartbeat({kid, jti: randomBytes(16).toString('base64url')}, {env})).toEqual({outcome: 'revoked'});
  });
});

// ---------------------------------------------------------------------------------------------------
/** A sender that answers from a script (`sent` once it is spent) and remembers what it was asked to send for the conditions of one case. */
function sender(prefix: string, script: (MailOutcome | 'throw')[] = []) {
  const mails: AlarmNotice[] = [];
  const queue = [...script];
  const send = async (alarm: AlarmNotice): Promise<MailOutcome> => {
    // Alarms that are not this case's are refused, so nothing of another case is marked sent by it.
    if (!alarm.condition.startsWith(prefix)) return {outcome: 'refused', reason: 'not_configured'};
    mails.push(alarm);
    const next = queue.shift() ?? {outcome: 'sent' as const};
    if (next === 'throw') throw new Error('the sender broke');
    return next;
  };
  return {send, mails};
}
const refused: MailOutcome = {outcome: 'refused', reason: 'provider_refused'};
const unknown: MailOutcome = {outcome: 'unknown', reason: 'timeout'};

describe('the monitor end to end against the real database, with a fixture condition and a fake sender', () => {
  // What the sender is asked to send includes whatever else the shared local database holds that is due; the sender refuses what is not this case's (so it
  // marks nothing of another case sent), and every assertion about mail is about THIS case's alarms: its sender's mails and its alarms' notices.
  /** A fixture threshold condition (a later story's own): raised while `active` is on, with a flat detail. */
  function fixture(id: string) {
    const state = {active: true};
    const condition: AlarmCondition = {id, evaluatedBy: 'monitor', evaluate: () => (state.active ? [{subject: null, detail: {count: 30, receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T08:00:00.000Z'}}] : [])};
    return {state, condition};
  }
  const subjects = (id: string, found: string[]): AlarmCondition => ({id, evaluatedBy: 'monitor', evaluate: () => found.map((subject) => ({subject, detail: {n: found.length}}))});
  const options = (mail: ReturnType<typeof sender>, conditions: AlarmCondition[]) => ({accounts: {env}, send: mail.send, conditions, heartbeatConfigured: false});
  const records = async (condition: string) => (await db.query('select id, subject, resolved_at from lifecycle.alarms where condition = $1 order by first_at, id', [condition])).rows as {id: string; subject: string | null; resolved_at: Date | null}[];

  it('AC-1: opens one alarm for a condition that crosses its threshold and emails it once, refreshes it without a second record or email, resolves it when it clears, and keeps the record', async () => {
    const id = uid();
    const {state, condition} = fixture(id);
    const mail = sender(id);
    const run = () => runAlarmMonitor(options(mail, [condition]));

    expect(await run()).toMatchObject({raised: 1, resolved: 0});
    const [alarm, ...others] = await records(id);
    expect(others).toEqual([]);
    expect(mail.mails).toEqual([expect.objectContaining({condition: id, subject: null, detail: expect.objectContaining({count: 30})})]);
    expect(await outcomes(alarm.id)).toEqual(['sent']);

    const latest = (await db.query('select latest_at from lifecycle.alarms where id = $1', [alarm.id])).rows[0].latest_at as Date;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await run()).toMatchObject({raised: 1, resolved: 0});
    expect(await records(id)).toHaveLength(1);
    expect(((await db.query('select latest_at from lifecycle.alarms where id = $1', [alarm.id])).rows[0].latest_at as Date).getTime()).toBeGreaterThan(latest.getTime());
    expect(mail.mails).toHaveLength(1);
    expect(await outcomes(alarm.id)).toEqual(['sent']);

    state.active = false;
    expect(await run()).toMatchObject({raised: 0, resolved: 1});
    expect((await records(id))[0].resolved_at).toBeInstanceOf(Date);
    expect(await run()).toMatchObject({raised: 0, resolved: 0});
    expect(mail.mails).toHaveLength(1);
    expect((await listAlarms({includeResolved: true, limit: 50}, {env})).some((entry) => entry.id === alarm.id && entry.resolvedAt !== null)).toBe(true);
  });

  it('re-crossing: the condition comes back after a resolve as a new alarm, and it is not emailed while its condition was emailed in the last 24 hours', async () => {
    const id = uid();
    const {state, condition} = fixture(id);
    const mail = sender(id);
    const run = () => runAlarmMonitor(options(mail, [condition]));
    await run();
    state.active = false;
    await run();
    state.active = true;
    expect(await run()).toMatchObject({raised: 1, resolved: 0});
    const found = await records(id);
    expect(found).toHaveLength(2);
    expect(found.filter((record) => record.resolved_at === null)).toHaveLength(1);
    expect(mail.mails).toHaveLength(1);
    expect(await outcomes(found[1].id)).toEqual([]);
  });

  it('re-crossing, once the window has ended: a new alarm of a condition last emailed 25 hours ago is emailed at the first evaluation, and only once', async () => {
    const id = uid();
    const {state, condition} = fixture(id);
    const mail = sender(id);
    await raiseAlarm({condition: id, subject: null, detail: {count: 30}}, {env});
    const [first] = await records(id);
    await db.query(`insert into lifecycle.alarm_notices (alarm_id, at, outcome) values ($1, clock_timestamp() - interval '25 hours', 'sent')`, [first.id]);
    await resolveAlarm({condition: id, subject: null}, {env});
    expect(state.active).toBe(true);
    expect(await runAlarmMonitor(options(mail, [condition]))).toMatchObject({raised: 1});
    const [, second] = await records(id);
    expect(mail.mails).toHaveLength(1);
    expect(await outcomes(second.id)).toEqual(['sent']);
    await runAlarmMonitor(options(mail, [condition]));
    expect(mail.mails).toHaveLength(1);
  });

  it('reminds an alarm that is still open once its last `sent` notice is 24 hours old, and not before', async () => {
    const id = uid();
    const {condition} = fixture(id);
    const mail = sender(id);
    await runAlarmMonitor(options(mail, [condition]));
    expect(mail.mails).toHaveLength(1);
    // A moment later: nothing.
    await runAlarmMonitor(options(mail, [condition]));
    expect(mail.mails).toHaveLength(1);
    // An alarm whose only `sent` notice is 25 hours old is due again, and is reminded once.
    const old = uid();
    const aged = fixture(old);
    const mailOld = sender(old);
    await raiseAlarm({condition: old, subject: null, detail: {count: 30}}, {env});
    const [agedAlarm] = await records(old);
    await db.query(`insert into lifecycle.alarm_notices (alarm_id, at, outcome) values ($1, clock_timestamp() - interval '25 hours', 'sent')`, [agedAlarm.id]);
    await runAlarmMonitor(options(mailOld, [aged.condition]));
    expect(mailOld.mails).toHaveLength(1);
    await runAlarmMonitor(options(mailOld, [aged.condition]));
    expect(mailOld.mails).toHaveLength(1);
    expect(await outcomes(agedAlarm.id)).toEqual(['sent', 'sent']);
  });

  it('AC-5: records the alarm and shows it on the list when the mailer fails, records `failed` or `unknown`, and retries the email at the next evaluation', async () => {
    const id = uid();
    const {condition} = fixture(id);
    const mail = sender(id, [refused, unknown, 'throw']);
    const run = () => runAlarmMonitor(options(mail, [condition]));
    expect(await run()).toMatchObject({raised: 1});
    const [alarm] = await records(id);
    const shown = (await listAlarms({}, {env})).find((entry) => entry.id === alarm.id);
    expect(shown).toMatchObject({lastNoticeOutcome: 'failed', lastSentAt: null, resolvedAt: null});
    await run();
    await run();
    expect(await outcomes(alarm.id)).toEqual(['failed', 'unknown', 'failed']);
    await run();
    expect(await outcomes(alarm.id)).toEqual(['failed', 'unknown', 'failed', 'sent']);
    expect(mail.mails).toHaveLength(4);
    expect(await records(id)).toHaveLength(1);
    await run();
    expect(mail.mails).toHaveLength(4);
  });

  it('AC-6: gives each subject its own alarm and email, and the repeat of one creates nothing', async () => {
    const id = uid();
    const mail = sender(id);
    const found: string[] = ['A'];
    const condition = subjects(id, found);
    await runAlarmMonitor(options(mail, [condition]));
    found.push('B');
    await runAlarmMonitor(options(mail, [condition]));
    await runAlarmMonitor(options(mail, [condition]));
    expect((await records(id)).map((record) => record.subject)).toEqual(['A', 'B']);
    expect(mail.mails.map((alarm) => alarm.subject)).toEqual(['A', 'B']);
  });

  it('AC-6, pushed: two subjects raise through the push helper within 24 hours and one raises again', async () => {
    const id = uid();
    const mail = sender(id);
    const deps = {accounts: {env}, send: mail.send};
    expect(await pushAlarm({condition: id, subject: 'pay_A', detail: {n: 1}}, deps)).toMatchObject({outcome: 'opened'});
    expect(await pushAlarm({condition: id, subject: 'pay_B', detail: {n: 2}}, deps)).toMatchObject({outcome: 'opened'});
    expect(await pushAlarm({condition: id, subject: 'pay_A', detail: {n: 3}}, deps)).toMatchObject({outcome: 'refreshed'});
    expect((await records(id)).map((record) => record.subject)).toEqual(['pay_A', 'pay_B']);
    expect(mail.mails.map((alarm) => alarm.subject)).toEqual(['pay_A', 'pay_B']);
    // Nothing evaluates a pushed condition, so a monitor run resolves none of its alarms.
    await runAlarmMonitor(options(mail, []));
    expect((await records(id)).every((record) => record.resolved_at === null)).toBe(true);
  });

  it('AC-4: handles a condition of a later story with the same alarm path and no new channel: the one sender is the only way mail leaves', async () => {
    const id = uid();
    const {condition} = fixture(id);
    const mail = sender(id);
    expect(await runAlarmMonitor(options(mail, [condition]))).toMatchObject({raised: 1});
    expect(mail.mails).toHaveLength(1);
    await dispatchDueMail({accounts: {env}, send: mail.send});
    expect(mail.mails).toHaveLength(1);
  });

  it('evaluates the real registry against the real observations without error, and every finding it could raise is one the database accepts (nothing is written)', async () => {
    const observed = await alarmObservations({env});
    const found = evaluateConditions(alarmConditions, 'monitor', {...observed, heartbeatConfigured: true}, scheduleRegistry);
    expect(found.map((one) => one.id)).toEqual(['task-late', 'ledger-pending', 'identities-unaccounted', 'heartbeat-stale']);
    for (const one of found) {
      expect(one.findings, one.id).not.toBeNull();
      // (The relay's latest receipt may be `no_store` in this database: then `ledger-pending` is unobservable, which is an answer too.)
      for (const finding of one.findings === unobservable || one.findings === null ? [] : one.findings) {
        expect(isAlarmDetail(finding.detail), `${one.id}: ${JSON.stringify(finding.detail)}`).toBe(true);
        if (finding.subject !== null) expect(finding.subject).toMatch(alarmSubjectPattern);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the heartbeat route end to end against the real database', () => {
  const instance = () => env.INSTANCE_ID;
  const keys = (label: string) => testSigner({issuer: 'heartbeat', active: `${label}`});
  const post = (token: string, extra: HeadersInit = {}) => new Request('http://127.0.0.1:4173/api/heartbeat', {method: 'POST', headers: {authorization: `Heartbeat ${token}`, ...extra}});

  it('records a heartbeat, evaluates the application\'s conditions, raises an alarm and emails it, then resolves it, and refuses a replay and a revoked key', async () => {
    const label = `it-hb-${tag()}`;
    const { signer, json } = keys(label);
    const id = uid();
    const state = {active: true};
    const condition: AlarmCondition = {id, evaluatedBy: 'heartbeat', evaluate: () => (state.active ? [{subject: null, detail: {age_seconds: 7300}}] : [])};
    const mail = sender(id);
    const options = {env: {...env, SERVICE_KEYS_HEARTBEAT: json}, alarms: {send: mail.send, conditions: [condition]}};
    const token = signHeartbeat(signer, instance());

    const first = await handleHeartbeatRequest(post(token), options);
    expect(first.status).toBe(200);
    const body = (await first.json()) as {state: string; receipt_age_seconds: number | null};
    expect(body.state).toBe('recorded');
    expect(body.receipt_age_seconds === null || Number.isInteger(body.receipt_age_seconds)).toBe(true);
    expect((await db.query('select kid from lifecycle.heartbeats where jti = $1', [JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).jti])).rows).toEqual([{kid: `test-${label}`}]);
    expect(mail.mails).toEqual([expect.objectContaining({condition: id})]);
    const [alarm] = (await db.query('select id, resolved_at from lifecycle.alarms where condition = $1', [id])).rows as {id: string; resolved_at: Date | null}[];
    expect(alarm.resolved_at).toBeNull();

    // A replay of the same token is a duplicate and evaluates nothing more.
    const replay = await handleHeartbeatRequest(post(token), options);
    expect([replay.status, await replay.json()]).toEqual([409, {state: 'duplicate'}]);

    // A later heartbeat with the condition gone resolves the alarm.
    state.active = false;
    expect((await handleHeartbeatRequest(post(signHeartbeat(signer, instance())), options)).status).toBe(200);
    expect(((await db.query('select resolved_at from lifecycle.alarms where id = $1', [alarm.id])).rows[0].resolved_at as Date | null)).toBeInstanceOf(Date);

    // A revoked key is refused with the one body, and records nothing.
    await revokeServiceKey({issuer: 'heartbeat', kid: `test-${label}`, reason: 'test'}, {env});
    const revoked = await handleHeartbeatRequest(post(signHeartbeat(signer, instance())), options);
    expect([revoked.status, await revoked.json()]).toEqual([401, {error: 'invalid_token'}]);
    expect((await db.query('select count(*)::int as n from lifecycle.heartbeats where kid = $1', [`test-${label}`])).rows[0].n).toBe(2);
  });

  it('answers 401 for a token of another environment, an Origin header 403, and 503 when the database cannot be reached, recording nothing', async () => {
    const label = `it-hb-${tag()}`;
    const { signer, json } = keys(label);
    const options = {env: {...env, SERVICE_KEYS_HEARTBEAT: json}, alarms: {send: sender('it-none').send, conditions: []}};
    expect((await handleHeartbeatRequest(post(signHeartbeat(signer, randomUUID())), options)).status).toBe(401);
    expect((await handleHeartbeatRequest(post(signHeartbeat(signer, instance()), {origin: 'https://evil.example'}), options)).status).toBe(403);
    const down = await handleHeartbeatRequest(post(signHeartbeat(signer, instance())), {...options, env: {...options.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}, accounts: {timeoutMs: 1500}});
    expect(down.status).toBe(503);
    expect((await db.query('select count(*)::int as n from lifecycle.heartbeats where kid = $1', [`test-${label}`])).rows[0].n).toBe(0);
  });

  // Review patch P3: a token that is validly signed but carries a `jti` the database would refuse is a 401 like every other bad token, not a 503; the database is not asked.
  it('answers 401, not 503, for a validly signed token whose jti the database would refuse, and records nothing; the route\'s pattern and the database\'s agree on every jti tried', async () => {
    const label = `it-hb-${tag()}`;
    const { signer, json } = keys(label);
    const options = {env: {...env, SERVICE_KEYS_HEARTBEAT: json}, alarms: {send: sender('it-none').send, conditions: []}};
    const jtis = ['A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}=`, `${'A'.repeat(22)}\n`, `${'A'.repeat(10)}\n${'A'.repeat(11)}`, `${'A'.repeat(21)}\u00e9`, `${'A'.repeat(21)}\uff21`, `_-${randomBytes(15).toString('base64url')}`, randomBytes(16).toString('base64url')];
    // (The two jtis that are valid are random: a heartbeat is recorded for ever, and a jti is taken once.)
    for (const jti of jtis) {
      const shape = /^[A-Za-z0-9_-]{22}$/.test(jti);
      expect((await db.query(`select $1::text ~ '^[A-Za-z0-9_-]{22}$' as ok`, [jti])).rows[0].ok, JSON.stringify(jti)).toBe(shape);
      const token = signRaw(signer, {iss: 'heartbeat', aud: 'application', env: instance(), jti, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, typ: 'heartbeat'});
      const response = await handleHeartbeatRequest(post(token), options);
      if (shape) expect(response.status, JSON.stringify(jti)).toBe(200);
      else expect([response.status, await response.json()], JSON.stringify(jti)).toEqual([401, {error: 'invalid_token'}]);
      // The database itself refuses the same jti, so the route could not have recorded it either.
      const direct = await inTx((client) => attempt(client, 'service_role', 'select * from api.record_heartbeat($1, $2)', [`test-${label}`, jti]));
      if (!shape) {
        expect(direct.ok, JSON.stringify(jti)).toBe(false);
        if (!direct.ok) expect(direct.code).toBe('22023');
      }
    }
    expect((await db.query('select count(*)::int as n from lifecycle.heartbeats where kid = $1', [`test-${label}`])).rows[0].n).toBe(2);
  });

  it('runs the evaluation on its own too, and answers the age of the latest receipt', async () => {
    const report = await runHeartbeatEvaluation({accounts: {env}, send: sender('it-none').send, conditions: []});
    expect(report).toMatchObject({raised: 0, resolved: 0, mailed: 0, mailFailed: 0});
    expect(report.receiptAge === null || Number.isInteger(report.receiptAge)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// F1. The monitor and the heartbeat evaluation both fire at :00 and can both find the same alarm due. The database claims what it hands out, under one lock.
// (The outcomes a sender recorded. The claims the database made before each are `claims`; CHANGED (F1): these used to be every notice, and a claim now comes before each.)
const outcomes = async (alarmId: string) => (await db.query(`select outcome from lifecycle.alarm_notices where alarm_id = $1 and outcome <> 'claimed' order by at, id`, [alarmId])).rows.map((row) => row.outcome as string);
const claims = async (alarmId: string) => (await db.query(`select count(*)::int as n from lifecycle.alarm_notices where alarm_id = $1 and outcome = 'claimed'`, [alarmId])).rows[0].n as number;
const backendPid = async (client: Client) => Number((await client.query('select pg_backend_pid() as pid')).rows[0].pid);
async function waitForLock(pid: number) {
  for (let tries = 0; tries < 100; tries += 1) {
    const {rows: waiting} = await db.query('select wait_event_type as type, wait_event as event from pg_stat_activity where pid = $1', [pid]);
    if (waiting[0]?.type === 'Lock') return waiting[0].event as string;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The other connection never started waiting for the lock.');
}
type Handed = {id: string; condition: string; subject: string | null};
const handedBy = async (client: Client, prefix: string) => ((await client.query('select alarms from api.alarms_due_mail(50)')).rows[0].alarms as Handed[]).filter((alarm) => alarm.condition.startsWith(prefix));
/** A `claimed` notice made `ago` ago: what a caller of api.alarms_due_mail leaves behind (the owner writes it directly; the service role cannot). */
const claimAt = (client: Client, alarmId: string, ago: string) => client.query(`insert into lifecycle.alarm_notices (alarm_id, at, outcome) values ($1, clock_timestamp() - $2::interval, 'claimed')`, [alarmId, ago]);

describe('api.alarms_due_mail claims what it returns (F1)', () => {
  it('hands each due alarm to exactly one of several callers that ask at once (real connections), and records one claim for each', async () => {
    const prefix = uid();
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) ids.push((await db.query('select alarm_id from api.raise_alarm($1, null, $2)', [`${prefix}-${index}`, '{}'])).rows[0].alarm_id as string);
    const clients = await Promise.all(Array.from({length: 6}, () => connect()));
    const results = await Promise.all(clients.map((client) => handedBy(client, prefix)));
    const handed = results.flat().map((alarm) => alarm.id);
    expect([...handed].sort()).toEqual([...ids].sort());
    for (const id of ids) expect(await claims(id)).toBe(1);
    // ... and the next call, afterwards, is handed none of them.
    expect(await handedBy(db, prefix)).toEqual([]);
  });

  // Held-transaction pattern (tests/integration/file-gateway-db.test.ts): one caller holds its claims UNCOMMITTED; the other must wait for the lock, and then find them claimed.
  // Without the lock the second reads the alarm as due (the first has not committed) and is handed it too; without the claim it is handed it again once the first has committed.
  it('makes a second caller WAIT for the first, and then find the alarms claimed: the lock is held until the first commits, and the claim is what it then reads', async () => {
    const prefix = uid();
    const id = (await db.query('select alarm_id from api.raise_alarm($1, $2, $3)', [`${prefix}-held`, 'A', '{}'])).rows[0].alarm_id as string;
    const [first, second] = await Promise.all([connect(), connect()]);
    try {
      await first.query('begin');
      expect((await handedBy(first, prefix)).map((alarm) => alarm.id)).toEqual([id]);
      const secondPid = await backendPid(second);
      let finished = false;
      const waiting = second.query('select alarms from api.alarms_due_mail(50)').then((result) => {
        finished = true;
        return (result.rows[0].alarms as Handed[]).filter((alarm) => alarm.condition.startsWith(prefix));
      });
      expect(await waitForLock(secondPid)).toBe('advisory');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(finished, 'the second caller waits for the first').toBe(false);
      await first.query('commit');
      expect(await waiting).toEqual([]);
      expect(await claims(id)).toBe(1);
    } finally {
      await first.query('rollback').catch(() => undefined);
    }
  });

  it('sends one mail when two dispatches overlap (the monitor and the heartbeat evaluation at :00), with a sender that takes its time: one claim, one `sent` notice', async () => {
    const prefix = uid();
    const mail = sender(prefix);
    const slow = async (alarm: AlarmNotice): Promise<MailOutcome> => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return mail.send(alarm);
    };
    const opened = await raiseAlarm({condition: `${prefix}-overlap`, subject: 'A', detail: {n: 1}}, {env});
    const [one, two] = await Promise.all([dispatchDueMail({accounts: {env}, send: slow}), dispatchDueMail({accounts: {env}, send: slow})]);
    expect(mail.mails.filter((alarm) => alarm.condition === `${prefix}-overlap`)).toHaveLength(1);
    expect(await outcomes(opened.alarmId)).toEqual(['sent']);
    expect(await claims(opened.alarmId)).toBe(1);
    // (The alarms of the database that are not this test's are not its to count; what both dispatches did for this one is one mail.)
    expect(one.mailed + two.mailed).toBeGreaterThanOrEqual(1);
    // The next dispatch finds nothing due for it.
    await dispatchDueMail({accounts: {env}, send: slow});
    expect(mail.mails.filter((alarm) => alarm.condition === `${prefix}-overlap`)).toHaveLength(1);
  });

  it('retries a sender that crashed after claiming only after 10 minutes, with the claim at a real time in the past: held at 9 minutes, due at 11', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      const nine = (await raise(client, `${prefix}-nine`, 'A')).alarm_id;
      const eleven = (await raise(client, `${prefix}-eleven`, 'A')).alarm_id;
      await claimAt(client, nine, '9 minutes');
      await claimAt(client, eleven, '11 minutes');
      const handed = (await dueOf(client, prefix)).map((alarm) => alarm.id);
      expect(handed).toEqual([eleven]);
      // It was claimed again at once, so it is held again.
      expect((await dueOf(client, prefix)).map((alarm) => alarm.id)).toEqual([]);
    });
  });

  it('releases a claim at once with a LATER `failed`, `unknown` or `sent` notice, and not with an EARLIER one; `sent` also closes the 24 hours, the other two do not', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      const failed = (await raise(client, `${prefix}-failed`, 'A')).alarm_id;
      const unknown = (await raise(client, `${prefix}-unknown`, 'A')).alarm_id;
      const sent = (await raise(client, `${prefix}-sent`, 'A')).alarm_id;
      const earlier = (await raise(client, `${prefix}-earlier`, 'A')).alarm_id;
      for (const id of [failed, unknown, sent]) await claimAt(client, id, '2 minutes');
      await noticeAt(client, failed, 'failed', '1 minute');
      await noticeAt(client, unknown, 'unknown', '1 minute');
      await noticeAt(client, sent, 'sent', '1 minute');
      // The `failed` before the claim is an earlier notice: it does not release it.
      await noticeAt(client, earlier, 'failed', '3 minutes');
      await claimAt(client, earlier, '2 minutes');
      expect((await dueOf(client, prefix)).map((alarm) => alarm.id).sort()).toEqual([failed, unknown].sort());
    });
  });

  it('holds an alarm with no subject for a claim on ANY alarm of its condition (the older alarm of the condition, resolved), and a subject-keyed alarm only for a claim on itself', async () => {
    await inTx(async (client) => {
      const condition = uid();
      const old = (await raise(client, condition, null)).alarm_id;
      await claimAt(client, old, '1 minute');
      await resolve(client, condition, null);
      // The condition has come back: a new alarm with no subject, held by the claim on the old one. Two subject-keyed alarms of the same condition are not held by it.
      const threshold = (await raise(client, condition, null)).alarm_id;
      const keyedA = (await raise(client, condition, 'A')).alarm_id;
      const keyedB = (await raise(client, condition, 'B')).alarm_id;
      await claimAt(client, keyedB, '1 minute');
      // A claim on a subject-keyed alarm holds that alarm; it does not hold the condition's other subjects (and the threshold alarm is held by `old` already).
      expect((await dueOf(client, condition)).map((alarm) => alarm.id)).toEqual([keyedA]);
    });
    await inTx(async (client) => {
      const condition = uid();
      const old = (await raise(client, condition, null)).alarm_id;
      await claimAt(client, old, '11 minutes');
      await resolve(client, condition, null);
      const threshold = (await raise(client, condition, null)).alarm_id;
      // The claim lapsed 1 minute ago: the new alarm is due.
      expect((await dueOf(client, condition)).map((alarm) => alarm.id)).toEqual([threshold]);
    });
    await inTx(async (client) => {
      const condition = uid();
      const keyed = (await raise(client, condition, 'A')).alarm_id;
      const threshold = (await raise(client, condition, null)).alarm_id;
      await claimAt(client, keyed, '1 minute');
      // A claim on a subject-keyed alarm of the condition holds the threshold alarm too ("any alarm of the same condition"), as a `sent` one does.
      expect((await dueOf(client, condition)).map((alarm) => alarm.id)).toEqual([]);
      expect(threshold).toBeDefined();
    });
  });

  it('does not let a caller record a claim: the record function refuses it (22023) to the service role, in the database and over REST, and the table is closed to everyone but the owner', async () => {
    await inTx(async (client) => {
      const id = (await raise(client, uid(), 'A')).alarm_id;
      const refused = await attempt(client, 'service_role', 'select * from api.record_alarm_notice($1, $2)', [id, 'claimed']);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('22023');
      const direct = await attempt(client, 'service_role', `insert into lifecycle.alarm_notices (alarm_id, outcome) values ($1, 'claimed')`, [id]);
      expect(direct.ok).toBe(false);
      if (!direct.ok) expect(direct.code).toBe('42501');
      expect((await client.query(`select count(*)::int as n from lifecycle.alarm_notices where alarm_id = $1`, [id])).rows[0].n).toBe(0);
    });
    const id = (await db.query('select alarm_id from api.raise_alarm($1, $2, $3)', [uid(), 'A', '{}'])).rows[0].alarm_id as string;
    const response = await fetch(`${stack.apiUrl}/rest/v1/rpc/record_alarm_notice`, {
      method: 'POST',
      headers: {apikey: stack.anonKey, authorization: `Bearer ${stack.serviceKey}`, 'content-type': 'application/json', 'content-profile': 'api'},
      body: JSON.stringify({p_alarm_id: id, p_outcome: 'claimed'}),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('22023');
    expect(await claims(id)).toBe(0);
  });

  it('does not show a claim as an alarm\'s latest notice: an alarm whose last try failed and is being tried again still shows that it failed, and one only claimed shows none', async () => {
    await inTx(async (client) => {
      const prefix = uid();
      const retried = (await raise(client, `${prefix}-retried`, 'A')).alarm_id;
      const claimed = (await raise(client, `${prefix}-claimed`, 'A')).alarm_id;
      await noticeAt(client, retried, 'failed', '5 minutes');
      await claimAt(client, retried, '1 minute');
      await claimAt(client, claimed, '1 minute');
      const listed = (await list(client, false)).filter((alarm) => alarm.condition.startsWith(prefix));
      const byId = Object.fromEntries(listed.map((alarm) => [alarm.id, alarm]));
      expect(byId[retried]).toMatchObject({last_notice_outcome: 'failed', last_sent_at: null});
      expect(byId[claimed]).toMatchObject({last_notice_outcome: null, last_notice_at: null, last_sent_at: null});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
/**
 * The real database, with the observations it reports changed by `patch` before the application reads them. Receipts and heartbeats are append-only, so a database that
 * has run for a while cannot be made to have NO fresh monitor receipt, or a relay at `no_store`, by deleting anything; the alarms, the notices, the claims and the mail
 * rule are all still the real ones, which is what these cases are about.
 */
function observing(patch: (observation: Record<string, any>) => Record<string, any>) {
  return async (input: string, init?: RequestInit) => {
    const response = await fetch(input, init);
    if (!String(input).endsWith('/rpc/alarm_observations') || !response.ok) return response;
    return new Response(JSON.stringify(patch((await response.json()) as Record<string, any>)), {status: response.status, headers: {'content-type': 'application/json'}});
  };
}
/** The task list of an observation with one task's newest finished receipt set (or taken out). */
const withTask = (observation: Record<string, any>, task: string, receipt: {outcome: string; age: number} | null) => ({
  ...observation,
  tasks: [...(observation.tasks as {task: string}[]).filter((entry) => entry.task !== task), ...(receipt ? [{task, outcome: receipt.outcome, at: '2026-10-17T20:00:00.000Z', age: receipt.age}] : [])],
});

describe('monitor-late: the heartbeat route sees a stopped monitor (F3)', () => {
  const instance = () => env.INSTANCE_ID;
  const keys = (label: string) => testSigner({issuer: 'heartbeat', active: `${label}`});
  const post = (token: string) => new Request('http://127.0.0.1:4173/api/heartbeat', {method: 'POST', headers: {authorization: `Heartbeat ${token}`}});
  // The real condition under an ID of this run's own: the 24-hour rule is real, and a real `monitor-late` alarm left by an earlier run would hold this one's email back.
  const monitorLate = (id: string): AlarmCondition => ({...monitorLateCondition, id});

  it('raises it when a heartbeat arrives and the monitor has no receipt newer than 600 seconds, emails it once, refreshes it at the next heartbeat, and resolves it at the first heartbeat after a fresh monitor receipt (the matrix row "Monitor stopped")', async () => {
    const label = `it-hb-${tag()}`;
    const {signer, json} = keys(label);
    const id = uid();
    const mail = sender(id);
    let monitor: {outcome: string; age: number} | null = {outcome: 'ran', age: 900};
    // (Without a monitor receipt the condition measures from the first receipt of any task, which this database's history decides: it is set here.)
    const options = () => ({
      env: {...env, SERVICE_KEYS_HEARTBEAT: json},
      accounts: {fetch: observing((observation) => ({...withTask(observation, 'alarm-monitor', monitor), first_receipt_age: 5000})) as never},
      alarms: {send: mail.send, conditions: [monitorLate(id)]},
    });
    const beat = async () => handleHeartbeatRequest(post(signHeartbeat(signer, instance())), options());
    const records = async () => (await db.query('select id, subject, resolved_at, detail from lifecycle.alarms where condition = $1 order by first_at', [id])).rows as {id: string; subject: string | null; resolved_at: Date | null; detail: Record<string, unknown>}[];

    expect((await beat()).status).toBe(200);
    const [alarm, ...others] = await records();
    expect(others).toEqual([]);
    expect(alarm).toMatchObject({subject: null, resolved_at: null, detail: {receipt_task: 'alarm-monitor', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:00:00.000Z', age_seconds: 900}});
    expect(mail.mails).toEqual([expect.objectContaining({condition: id, subject: null})]);
    expect(await outcomes(alarm.id)).toEqual(['sent']);

    // The next heartbeat finds it still late: the same record, refreshed, and no second email.
    expect((await beat()).status).toBe(200);
    expect(await records()).toHaveLength(1);
    expect(mail.mails).toHaveLength(1);

    // A monitor that never finished a run, while the scheduler has been running for over 600 seconds, is the same alarm (the schedule was never made).
    monitor = null;
    expect((await beat()).status).toBe(200);
    expect(await records()).toHaveLength(1);
    expect((await records())[0]).toMatchObject({resolved_at: null, detail: {receipt_task: 'alarm-monitor', receipt_outcome: 'never', age_seconds: 5000}});
    expect(mail.mails).toHaveLength(1);

    // A fresh monitor receipt: the first heartbeat after it resolves it, with no email.
    monitor = {outcome: 'ran', age: 40};
    expect((await beat()).status).toBe(200);
    expect((await records())[0].resolved_at).toBeInstanceOf(Date);
    expect(mail.mails).toHaveLength(1);
  });

  it('is evaluated by the heartbeat and not by the monitor: a monitor run with the same stale picture raises none of it, and the heartbeat\'s evaluation raises it and the monitor\'s conditions not', async () => {
    const id = uid();
    const mail = sender(id);
    const stale = observing((observation) => withTask(observation, 'alarm-monitor', {outcome: 'ran', age: 5000}));
    const condition = {...monitorLateCondition, id};
    // (A monitor run owns the monitor's conditions only: this one is the heartbeat's.)
    await runAlarmMonitor({accounts: {env, fetch: stale as never}, send: mail.send, conditions: [condition], heartbeatConfigured: false});
    expect((await db.query('select count(*)::int as n from lifecycle.alarms where condition = $1', [id])).rows[0].n).toBe(0);
    await runHeartbeatEvaluation({accounts: {env, fetch: stale as never}, send: mail.send, conditions: [condition]});
    expect((await db.query('select count(*)::int as n from lifecycle.alarms where condition = $1 and resolved_at is null', [id])).rows[0].n).toBe(1);
  });

  it('reads the real observations: a finished alarm-monitor receipt of the database is the task\'s entry the condition reads, and a fresh one clears it', async () => {
    await inTx(async (client) => {
      await client.query(`insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt, started_at, finished_at, outcome, result) values ('alarm-monitor', $1, $2, 1, clock_timestamp(), clock_timestamp(), 'ran', '{}')`, [`scd_${randomUUID()}`, `msg_${randomUUID()}`]);
      const observed = (await svc(client, 'select tasks, first_receipt_age from api.alarm_observations()')) as {tasks: {task: string; outcome: string; age: number}[]; first_receipt_age: string};
      const entry = observed.tasks.find((task) => task.task === 'alarm-monitor');
      expect(entry).toMatchObject({outcome: 'ran'});
      expect(entry!.age).toBeLessThanOrEqual(5);
      const conditionsSaw = monitorLateCondition.evaluate({firstReceiptAge: Number(observed.first_receipt_age), latestReceiptAge: 1, firstHeartbeatAge: null, latestHeartbeatAge: null, ledgerWaiting: 0, ledgerOldest: null, unaccounted: 0, tasks: observed.tasks as never, heartbeatConfigured: false}, scheduleRegistry);
      expect(conditionsSaw).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('unobservable keeps an open alarm open (F4)', () => {
  /** The real conditions, each under an ID of this run's own (the 24-hour rule is real). */
  const ledgerPending = (id: string): AlarmCondition => ({...ledgerPendingCondition, id});
  const heartbeatStale = (id: string): AlarmCondition => ({...heartbeatStaleCondition, id});
  const openOf = async (id: string) => (await db.query('select id, resolved_at from lifecycle.alarms where condition = $1 order by first_at', [id])).rows as {id: string; resolved_at: Date | null}[];

  it('ledger-pending: an alarm that is open stays open while the relay\'s latest receipt is `no_store`, nothing is raised or resolved, and it resolves once the relay can relay and the backlog is clear', async () => {
    const id = uid();
    const mail = sender(id);
    let relay = 'ran';
    let backlog = {pending: 4, oldest: 2000};
    const run = () =>
      runAlarmMonitor({
        accounts: {env, fetch: observing((observation) => ({...withTask(observation, 'ledger-relay', {outcome: relay, age: 60}), ledger_pending: backlog.pending, ledger_oldest: backlog.oldest})) as never},
        send: mail.send,
        conditions: [ledgerPending(id)],
        heartbeatConfigured: false,
      });
    expect(await run()).toMatchObject({raised: 1, resolved: 0});
    const [alarm] = await openOf(id);
    expect(alarm.resolved_at).toBeNull();
    // The relay now has no store to write to: unobservable, with the backlog still old and with it gone.
    relay = 'no_store';
    for (const next of [{pending: 4, oldest: 2000}, {pending: 0, oldest: null as never}]) {
      backlog = next;
      expect(await run()).toMatchObject({raised: 0, resolved: 0});
      expect(await openOf(id)).toEqual([{id: alarm.id, resolved_at: null}]);
    }
    // The relay is back and the backlog is clear: resolved, once.
    relay = 'ran';
    expect(await run()).toMatchObject({raised: 0, resolved: 1});
    expect((await openOf(id))[0].resolved_at).toBeInstanceOf(Date);
    expect(mail.mails).toHaveLength(1);
  });

  it('ledger-pending: with the relay at `no_store` from the start, no alarm is ever opened, however old the backlog is', async () => {
    const id = uid();
    const run = () =>
      runAlarmMonitor({
        accounts: {env, fetch: observing((observation) => ({...withTask(observation, 'ledger-relay', {outcome: 'no_store', age: 60}), ledger_pending: 134, ledger_oldest: 90_000})) as never},
        send: sender(id).send,
        conditions: [ledgerPending(id)],
        heartbeatConfigured: false,
      });
    expect(await run()).toMatchObject({raised: 0, resolved: 0});
    expect(await openOf(id)).toEqual([]);
  });

  it('heartbeat-stale: an alarm that is open stays open while SERVICE_KEYS_HEARTBEAT is unset, and resolves once it is set again and the heartbeat is found fresh', async () => {
    const id = uid();
    const mail = sender(id);
    let configured = true;
    let age: number | null = 9000;
    const run = () =>
      runAlarmMonitor({
        accounts: {env, fetch: observing((observation) => ({...observation, latest_heartbeat_age: age, first_heartbeat_age: age})) as never},
        send: mail.send,
        conditions: [heartbeatStale(id)],
        heartbeatConfigured: configured,
      });
    expect(await run()).toMatchObject({raised: 1, resolved: 0});
    const [alarm] = await openOf(id);
    configured = false;
    for (const next of [9000, 30, null]) {
      age = next;
      expect(await run()).toMatchObject({raised: 0, resolved: 0});
      expect(await openOf(id)).toEqual([{id: alarm.id, resolved_at: null}]);
    }
    configured = true;
    age = 30;
    expect(await run()).toMatchObject({raised: 0, resolved: 1});
    expect((await openOf(id))[0].resolved_at).toBeInstanceOf(Date);
    expect(mail.mails).toHaveLength(1);
  });

  it('heartbeat-stale: unset from the start, none is ever opened; and the operator who removed the heartbeat on purpose closes an open one with api.resolve_alarm, through the service role', async () => {
    const id = uid();
    const run = (configured: boolean) =>
      runAlarmMonitor({
        accounts: {env, fetch: observing((observation) => ({...observation, latest_heartbeat_age: 99_999, first_heartbeat_age: 99_999})) as never},
        send: sender(id).send,
        conditions: [heartbeatStale(id)],
        heartbeatConfigured: configured,
      });
    expect(await run(false)).toMatchObject({raised: 0});
    expect(await openOf(id)).toEqual([]);
    expect(await run(true)).toMatchObject({raised: 1});
    expect(await run(false)).toMatchObject({raised: 0, resolved: 0});
    expect((await openOf(id))[0].resolved_at).toBeNull();
    // The statement in docs/staging.md, as the service role runs it.
    const closed = await inTx(async (client) => svc(client, `select * from api.resolve_alarm('${id}', null)`));
    expect(closed).toMatchObject({outcome: 'resolved'});
    expect(await resolveAlarm({condition: id, subject: null}, {env})).toMatchObject({outcome: 'resolved'});
    expect((await openOf(id))[0].resolved_at).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('sendAlarmMail against the stack\'s Mailpit', () => {
  it('sends the alarm to the configured Administrator address through the real local transport, and the message holds what the spec lists and nothing else', async () => {
    const condition = uid();
    const before = new Set((await listMail()).map((message) => message.id));
    const outcome = await sendAlarmMail(
      {condition, subject: 'ledger-relay', firstAt: '2026-10-17T20:41:16.179Z', detail: {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:37:22.998Z', age_seconds: 700, count: 99, note: 'not for the mail'}},
      {env: {...env, ADMINISTRATOR_EMAIL: 'alarms-admin@example.test'}},
    );
    expect(outcome).toEqual({outcome: 'sent'});
    let mine: Awaited<ReturnType<typeof readMail>> | undefined;
    try {
      for (let tries = 0; tries < 60 && !mine; tries += 1) {
        const fresh = (await listMail()).filter((message) => !before.has(message.id) && message.subject.includes(condition));
        if (fresh.length > 0) mine = await readMail(fresh[0].id);
        else await new Promise((resolve) => setTimeout(resolve, 150));
      }
      expect(mine, 'the message reached Mailpit').toBeDefined();
      expect(mine!.to).toEqual(['alarms-admin@example.test']);
      // CHANGED (F2): the subject line names the environment, which here is the local stack's.
      expect(mine!.subject).toBe(`[local] nova3D alarm: ${condition} (ledger-relay)`);
      expect(mine!.text).toContain(`Condition: ${condition}`);
      expect(mine!.text).toContain('Subject: ledger-relay');
      expect(mine!.text).toContain('First seen: 2026-10-17 20:41 UTC');
      expect(mine!.text).toContain('Last receipt, task: ledger-relay');
      // CHANGED (F2): the whole numbers of the detail are in the message with their keys (it asserted they were not); the environment is its first line; no address.
      expect(mine!.text).toContain('Environment: local');
      expect(mine!.text).toContain('age_seconds: 700');
      expect(mine!.text).toContain('count: 99');
      expect(mine!.text).not.toContain('not for the mail');
      expect(mine!.text).not.toMatch(/@/);
    } finally {
      // Only this message goes: the mailbox is left as it was found (the recovery specs read it).
      if (mine) await deleteMail([mine.id]);
      else {
        const stray = (await listMail()).filter((message) => !before.has(message.id) && message.subject.includes(condition));
        await deleteMail(stray.map((message) => message.id));
      }
    }
    expect((await listMail()).some((message) => message.subject.includes(condition))).toBe(false);
  });

  it('refuses without sending when the Administrator address is not configured', async () => {
    const before = (await listMail()).length;
    expect(await sendAlarmMail({condition: uid(), subject: null, firstAt: '2026-10-17T20:41:16.179Z', detail: {}}, {env: {...env, ADMINISTRATOR_EMAIL: undefined as never}})).toEqual({outcome: 'refused', reason: 'not_configured'});
    expect((await listMail()).length).toBe(before);
  });
});
