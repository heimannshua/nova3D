import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {issueInvitation, registerWithCode} from '@/lib/accounts';
import {listUsage, recordUsageRefusal, setUsageLimit} from '@/lib/usage';
import {insertAuthUser} from '../support/accounts-data';
import {codeHash, createHarness, stack} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 2.4 against the Supabase CLI stack: the Usage-owned allowance periods (usage.periods), their lazy monthly rollover, the owner-written stand-in for the
// ledgers (usage.fixture_figures), and the three api functions behind the Administrator's Usage and limits page: api.set_usage_limit (change a limit or reset the
// count by appending a successor period that carries the liabilities), api.list_usage (each Account's current period) and api.record_usage_refusal (the audit
// of a refused change). Most cases run inside a transaction that is rolled back, as the service role. The cases that need several real connections (the same
// command twice at once, two commands against one period, a disable racing a change, a rollover racing a rollover, refusals arriving together) and the typed
// calls as the application makes them commit data that is removed afterwards. Audit events are append-only and stay, which is why every test that counts them
// uses an Account of its own and counts by its own actor and target. Money is integer microdollars: the spec's numbers are 25,000,000 for $25 and so on.

const {db, connect, committed, inTx, addUser, attempt, rows, api, count} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

const M = 1_000_000;
const CEILING = 10_000_000_000;

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; epoch: number};

/** An Account (registered the way the registration screen does it, so it has its `initial` period) with the given role, inside the open transaction. */
async function account(client: Client, role: 'member' | 'administrator' = 'member'): Promise<Fixture> {
  const svc = api(client);
  const user = await addUser(client);
  const hash = codeHash();
  await svc.issue(hash, 'general', null);
  const receipt = await svc.register(user.id, hash);
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  if (role === 'administrator') await client.query(`update identity.accounts set role = 'administrator' where id = $1`, [receipt.account_id]);
  return {user, accountId: receipt.account_id as string, epoch: await epochOf(client, receipt.account_id as string)};
}

/** The same, committed (for the cases that need real connections), removed with the harness's other committed data. */
async function committedAccount(role: 'member' | 'administrator' = 'member'): Promise<Fixture> {
  const user = await addUser(db);
  committed.users.push(user.id);
  const issued = await issueInvitation({kind: 'named', label: `usage ${user.id.slice(0, 8)}`, actor: 'seed:local:usage-limits'}, {env});
  if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
  committed.invitationIds.push(issued.invitationId);
  const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  if (role === 'administrator') await db.query(`update identity.accounts set role = 'administrator' where id = $1`, [receipt.accountId]);
  return {user, accountId: receipt.accountId as string, epoch: await epochOf(db, receipt.accountId as string)};
}

const epochOf = async (client: Client, accountId: string) => Number((await client.query('select authorization_epoch::int as epoch from identity.accounts where id = $1', [accountId])).rows[0].epoch);
const statusOf = async (client: Client, accountId: string) => (await client.query('select status from identity.accounts where id = $1', [accountId])).rows[0].status as string;

type PeriodRow = {
  id: string;
  seq: number;
  month_start: string;
  limit_microdollars: number;
  carried_settled: number;
  carried_reserved: number;
  cause: string;
  previous_limit: number | null;
  actor: string;
  command_id: string | null;
  digest: string;
  created_at: Date;
};
const periodsOf = async (client: Client, accountId: string) =>
  (
    await client.query(
      `select id, seq, month_start::text as month_start, limit_microdollars::float8 as limit_microdollars, carried_settled_microdollars::float8 as carried_settled,
              carried_reserved_microdollars::float8 as carried_reserved, cause, previous_limit_microdollars::float8 as previous_limit, actor, command_id, digest, created_at
         from usage.periods where account_id = $1 order by seq`,
      [accountId],
    )
  ).rows as PeriodRow[];
const currentMonth = async (client: Client) => (await client.query('select usage.current_month()::text as month')).rows[0].month as string;

/** The owner writes the stand-in figures of a period, as the tests (and nobody else) do. */
const figures = (client: Client, periodId: string, settled: number, reserved: number) =>
  client.query('insert into usage.fixture_figures (period_id, settled_microdollars, reserved_microdollars) values ($1, $2, $3)', [periodId, settled, reserved]);

type PeriodSpec = {seq: number; monthsAgo: number; limit: number; settled?: number; reserved?: number; cause: string; previous?: number | null; actor?: string; command?: string | null};
/**
 * Puts an Account's periods back as the owner (a period is never edited, but the owner may delete and insert): the given rows, `monthsAgo` months before the
 * current UTC month, so a rollover can be provoked. Returns the new rows' IDs in order.
 */
async function replacePeriods(client: Client, accountId: string, specs: PeriodSpec[]) {
  await client.query('delete from usage.periods where account_id = $1', [accountId]);
  const ids: string[] = [];
  for (const spec of specs) {
    const month = `(usage.current_month() - make_interval(months => $3::int))::date`;
    const inserted = await client.query(
      `insert into usage.periods (account_id, seq, month_start, limit_microdollars, carried_settled_microdollars, carried_reserved_microdollars, cause, previous_limit_microdollars, actor, command_id, digest)
       values ($1, $2, ${month}, $4, $5, $6, $7, $8, $9, $10, usage.period_digest($1, $2, ${month}, $4, $5, $6, $7)) returning id`,
      [accountId, spec.seq, spec.monthsAgo, spec.limit, spec.settled ?? 0, spec.reserved ?? 0, spec.cause, spec.previous ?? null, spec.actor ?? 'system', spec.command ?? null],
    );
    ids.push(inserted.rows[0].id as string);
  }
  return ids;
}

type Command = {admin: Fixture; target?: string; actor?: string; epoch?: number; command?: string; kind?: string; limit?: number | null; expectedSeq?: number};
const SET = `select outcome, period_id, seq, month_start::text as month_start, limit_microdollars::float8 as limit_microdollars, previous_limit_microdollars::float8 as previous_limit_microdollars, cause
               from api.set_usage_limit($1, $2, $3, $4, $5, $6, $7, $8)`;
const setArgs = (o: Command, target: string) => [
  o.actor ?? `user:${o.admin.user.id}`,
  o.admin.accountId,
  o.epoch ?? o.admin.epoch,
  o.target ?? target,
  o.command ?? randomUUID(),
  o.kind ?? 'change',
  o.limit === undefined ? (o.kind === 'reset' ? null : 30 * M) : o.limit,
  o.expectedSeq ?? 1,
];
/** The Administrator's command as the service role calls it. `target` is the Account the command is about (the second argument is for brevity). */
const setLimit = async (client: Client, target: string, o: Command) => (await rows(client, 'service_role', SET, setArgs(o, target)))[0] as {
  outcome: string;
  period_id: string | null;
  seq: number | null;
  month_start: string | null;
  limit_microdollars: number | null;
  previous_limit_microdollars: number | null;
  cause: string | null;
};
const attemptSet = (client: Client, target: string, o: Command) => attempt(client, 'service_role', SET, setArgs(o, target));

const listAs = async (client: Client, admin: Fixture, epoch = admin.epoch) =>
  (await rows(client, 'service_role', 'select outcome, accounts from api.list_usage($1, $2)', [admin.accountId, epoch]))[0] as {outcome: string; accounts: Record<string, unknown>[] | null};
const rowOf = (list: {accounts: Record<string, unknown>[] | null}, accountId: string) => list.accounts?.find((entry) => entry.account_id === accountId);
const availableOf = async (client: Client, accountId: string) => Number((await client.query('select usage.available_microdollars($1)::float8 as available', [accountId])).rows[0].available);

const usageEvents = async (client: Client, actor: string) =>
  (await client.query(`select actor, action, target from identity.audit_events where actor = $1 and action like 'usage.%' order by id`, [actor])).rows as {actor: string; action: string; target: string | null}[];
const eventsBy = async (client: Client, actor: string, action?: string) =>
  (await client.query(`select actor, action, target, occurred_at from identity.audit_events where actor = $1 ${action ? 'and action = $2' : ''} order by id`, action ? [actor, action] : [actor])).rows as {
    actor: string;
    action: string;
    target: string | null;
    occurred_at: Date;
  }[];

const disable = (client: Client, accountId: string) => rows(client, 'service_role', `select outcome from api.disable_account('seed:local:usage', $1)`, [accountId]).then((found) => found[0].outcome as string);
const tombstone = (client: Client, accountId: string) => rows(client, 'service_role', `select outcome from api.record_tombstone('account', $1)`, [accountId]).then((found) => found[0].outcome as string);

// ---------------------------------------------------------------------------------------------------
describe('access: the usage schema is closed, and only the service role reaches the three api functions', () => {
  it('is a schema that no browser role, no API role and not PUBLIC can use or create in, and whose default privileges grant nothing', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const {rows: found} = await db.query(`select has_schema_privilege($1, 'usage', 'usage') as usage, has_schema_privilege($1, 'usage', 'create') as "create"`, [role]);
      expect(found[0], role).toEqual({usage: false, create: false});
    }
    const {rows: acl} = await db.query(`select a.grantee::regrole::text as grantee from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'usage' and a.grantee <> n.nspowner`);
    expect(acl).toEqual([]);
    const {rows: publicGrants} = await db.query(`select 1 from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'usage' and a.grantee = 0`);
    expect(publicGrants).toEqual([]);
    const {rows: defaults} = await db.query(
      `select d.defaclobjtype as kind, a.grantee from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
        where n.nspname = 'usage' and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))`,
    );
    expect(defaults).toEqual([]);
  });

  it('has exactly two tables, both with row-level security on, no policy, and no privilege for any role or PUBLIC', async () => {
    const {rows: tables} = await db.query(
      `select c.relname as name, c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies,
              (select count(*)::int from aclexplode(c.relacl) a where a.grantee <> c.relowner) as other_grants
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'usage' and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1`,
    );
    expect(tables).toEqual([
      {name: 'fixture_figures', rls: true, policies: 0, other_grants: 0},
      {name: 'periods', rls: true, policies: 0, other_grants: 0},
    ]);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const table of ['usage.periods', 'usage.fixture_figures']) {
        const {rows: held} = await db.query(`select has_table_privilege($1, $2, 'select,insert,update,delete,truncate,references,trigger') as can, has_any_column_privilege($1, $2, 'select,insert,update,references') as column_can`, [role, table]);
        expect(held[0], `${role} on ${table}`).toEqual({can: false, column_can: false});
      }
    }
    const {rows: sequences} = await db.query(`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'usage' and c.relkind = 'S'`);
    expect(sequences).toEqual([]);
  });

  it('refuses the service role a direct read or write of either table, and every internal function: it reaches Usage only through the api schema', async () => {
    await inTx(async (client) => {
      for (const sql of [
        'select * from usage.periods',
        'select * from usage.fixture_figures',
        'insert into usage.fixture_figures (period_id) values (gen_random_uuid())',
        'delete from usage.periods',
        'select usage.default_limit($$member$$)',
        'select usage.current_month()',
        'select usage.ensure_period(gen_random_uuid())',
        'select * from usage.period_figures(gen_random_uuid())',
        'select usage.available_microdollars(gen_random_uuid())',
      ]) {
        for (const role of ['service_role', 'anon', 'authenticated']) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.code, `${role}: ${sql}`).toBe('42501');
        }
      }
    });
  });

  it('holds exactly the functions the migration describes, each with its search path pinned, an explicit ACL, and an execute grant to nobody', async () => {
    const {rows: functions} = await db.query(
      `select p.proname as name, p.proconfig as config, p.proacl is null as default_acl,
              (select count(*)::int from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) as other_grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'usage' order by 1`,
    );
    expect(functions.map((fn) => fn.name)).toEqual([
      'append_period',
      'available_microdollars',
      'check_period',
      'command_digest',
      'create_initial_period',
      'current_month',
      'default_limit',
      'ensure_period',
      'period_digest',
      'period_figures',
      'refuse_period_change',
    ]);
    for (const fn of functions) {
      expect(fn.default_acl, `usage.${fn.name} has an explicit ACL`).toBe(false);
      expect(String(fn.config), `usage.${fn.name} pins search_path`).toContain('search_path=');
      expect(fn.other_grantees, `usage.${fn.name} is executable by nobody else`).toBe(0);
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const {rows: can} = await db.query(
        `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'usage' and has_function_privilege($1, p.oid, 'execute')`,
        [role],
      );
      expect(can, role).toEqual([]);
    }
  });

  it('puts the three api functions in the api schema, running as their owner with an empty search path, executable by the service role alone, with exactly these arguments and results', async () => {
    const {rows: found} = await db.query(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
              coalesce((select array_agg(a.grantee::regrole::text order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname in ('set_usage_limit', 'list_usage', 'record_usage_refusal') order by 1`,
    );
    expect(found.map((fn) => fn.name)).toEqual(['list_usage', 'record_usage_refusal', 'set_usage_limit']);
    for (const fn of found) {
      expect(fn.definer, fn.name).toBe(true);
      expect(fn.config, fn.name).toEqual(['search_path=""']);
      expect(fn.grantees, fn.name).toEqual(['service_role']);
    }
    const byName = Object.fromEntries(found.map((fn) => [fn.name, fn]));
    expect(byName.set_usage_limit.args).toBe(
      'p_actor text, p_admin_account_id uuid, p_epoch bigint, p_target_account_id uuid, p_command_id uuid, p_kind text, p_limit_microdollars bigint, p_expected_seq integer',
    );
    expect(byName.set_usage_limit.result).toBe('api.usage_limit_change');
    expect(byName.list_usage.args).toBe('p_admin_account_id uuid, p_epoch bigint');
    expect(byName.list_usage.result).toBe('api.usage_list');
    // No amount, limit or reason can be passed in to record a refusal: there is no parameter for one.
    expect(byName.record_usage_refusal.args).toBe('p_user_id uuid, p_action text, p_target_account_id uuid DEFAULT NULL::uuid');
    expect(byName.record_usage_refusal.result).toBe('api.usage_refusal');
  });

  it.each(['anon', 'authenticated'])('refuses %s every one of them at the database, with a permission error, and writes nothing', async (role) => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const audited = await count(client, 'select count(*) as n from identity.audit_events');
      const before = await periodsOf(client, member.accountId);
      const calls = [
        ['select * from api.set_usage_limit($1, $2, $3, $4, $5, $6, $7, $8)', [`user:${admin.user.id}`, admin.accountId, admin.epoch, member.accountId, randomUUID(), 'change', 40 * M, 1]],
        ['select * from api.list_usage($1, $2)', [admin.accountId, admin.epoch]],
        ['select * from api.record_usage_refusal($1, $2, $3)', [admin.user.id, 'usage.limit_refused', member.accountId]],
      ] as const;
      for (const [sql, params] of calls) {
        const result = await attempt(client, role, sql, [...params]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.message, sql).toMatch(/permission denied for schema api/);
      }
      expect(await periodsOf(client, member.accountId)).toEqual(before);
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(audited);
    });
  });

  it('refuses the browser roles over REST with a permission error, and lets the service role in', async () => {
    const bodies: Record<string, unknown> = {
      set_usage_limit: {p_actor: `user:${randomUUID()}`, p_admin_account_id: randomUUID(), p_epoch: 1, p_target_account_id: randomUUID(), p_command_id: randomUUID(), p_kind: 'change', p_limit_microdollars: 40 * M, p_expected_seq: 1},
      list_usage: {p_admin_account_id: randomUUID(), p_epoch: 1},
      record_usage_refusal: {p_user_id: randomUUID(), p_action: 'usage.denied', p_target_account_id: null},
    };
    const post = (key: string, name: string, body: unknown) =>
      fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-profile': 'api'},
        body: JSON.stringify(body),
      });
    for (const [name, body] of Object.entries(bodies)) {
      const refused = await post(stack.anonKey, name, body);
      expect(refused.status, name).toBeGreaterThanOrEqual(401);
      expect(refused.status, name).toBeLessThan(500);
      expect((await refused.json()).code, name).toBe('42501');
    }
    // The service role gets an answer (an Account that does not exist is `denied`), which proves the function is reachable by the one role meant to call it.
    const answered = await post(stack.serviceKey, 'list_usage', bodies.list_usage);
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({outcome: 'denied', accounts: null});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the periods table: a period is a record, never edited', () => {
  it('refuses to update a period, whatever the column, and to empty the table; deleting is left for the purge', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const sql of [
        'update usage.periods set limit_microdollars = 0 where account_id = $1',
        `update usage.periods set cause = 'month' where account_id = $1`,
        `update usage.periods set carried_reserved_microdollars = 1 where account_id = $1`,
        `update usage.periods set actor = 'user:other' where account_id = $1`,
        'update usage.periods set created_at = now() where account_id = $1',
      ]) {
        const result = await attempt(client, null, sql, [a.accountId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      // The table cannot be emptied in one statement either (the foreign key of the fixture table has to be named with it for the trigger to be the one to answer).
      const truncated = await attempt(client, null, 'truncate usage.periods, usage.fixture_figures');
      expect(truncated.ok).toBe(false);
      if (!truncated.ok) expect(truncated.code).toBe('55000');
      const alone = await attempt(client, null, 'truncate usage.periods');
      expect(alone.ok).toBe(false);
      expect((await periodsOf(client, a.accountId)).map((p) => p.seq)).toEqual([1]);
      // Delete is left for the Epic 8 purge, and takes the stand-in figures of the period with it.
      const [period] = await periodsOf(client, a.accountId);
      await figures(client, period.id, 1, 1);
      expect(await count(client, 'select count(*) as n from usage.fixture_figures where period_id = $1', [period.id])).toBe(1);
      expect((await client.query('delete from usage.periods where account_id = $1', [a.accountId])).rowCount).toBe(1);
      expect(await count(client, 'select count(*) as n from usage.fixture_figures where period_id = $1', [period.id])).toBe(0);
    });
  });

  it('keys every period to its Account with ON DELETE RESTRICT: an Account that has periods cannot be deleted by accident', async () => {
    const {rows: constraints} = await db.query(`select confdeltype from pg_constraint where conrelid = 'usage.periods'::regclass and confrelid = 'identity.accounts'::regclass and contype = 'f'`);
    expect(constraints).toEqual([{confdeltype: 'r'}]);
    await inTx(async (client) => {
      const a = await account(client);
      const refused = await attempt(client, null, 'delete from identity.accounts where id = $1', [a.accountId]);
      expect(refused.ok).toBe(false);
    });
  });

  describe('its constraints', () => {
    type Insert = {seq: number; month: string | 'current' | 'earlier' | 'later'; limit: number; cs: number; cr: number; cause: string; previous: number | null; actor: string; command: string | null; digest: string; account: string | 'self'};
    const base: Insert = {seq: 2, month: 'current', limit: 30 * M, cs: 0, cr: 0, cause: 'change', previous: 25 * M, actor: `user:${randomUUID()}`, command: 'new', digest: 'a'.repeat(64), account: 'self'};
    async function insert(client: Client, accountId: string, over: Partial<Insert>) {
      const o = {...base, ...over};
      const month =
        o.month === 'current'
          ? `usage.current_month()`
          : o.month === 'earlier'
            ? `(usage.current_month() - interval '1 month')::date`
            : o.month === 'later'
              ? `(usage.current_month() + interval '1 month')::date`
              : `'${o.month}'::date`;
      return attempt(
        client,
        null,
        `insert into usage.periods (account_id, seq, month_start, limit_microdollars, carried_settled_microdollars, carried_reserved_microdollars, cause, previous_limit_microdollars, actor, command_id, digest)
         values ($1, $2, ${month}, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [o.account === 'self' ? accountId : o.account, o.seq, o.limit, o.cs, o.cr, o.cause, o.previous, o.actor, o.command === 'new' ? randomUUID() : o.command, o.digest],
      );
    }

    it('accepts a well-formed successor of every cause (the control for the cases below), including the ceiling and a limit of 0', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        expect((await insert(client, a.accountId, {})).ok).toBe(true);
        expect((await insert(client, a.accountId, {seq: 3, cause: 'reset', limit: 30 * M, previous: 30 * M})).ok).toBe(true);
        expect((await insert(client, a.accountId, {seq: 4, month: 'later', cause: 'month', limit: 30 * M, previous: 30 * M, actor: 'system', command: null})).ok).toBe(true);
        expect((await insert(client, a.accountId, {seq: 5, month: 'later', cause: 'change', limit: CEILING, previous: 30 * M})).ok).toBe(true);
        expect((await insert(client, a.accountId, {seq: 6, month: 'later', cause: 'change', limit: 0, previous: CEILING})).ok).toBe(true);
        expect((await periodsOf(client, a.accountId)).map((p) => p.seq)).toEqual([1, 2, 3, 4, 5, 6]);
      });
    });

    it.each([
      ['a limit that is not whole cents', {limit: 25_000_001}, '23514'],
      ['a negative limit', {limit: -10_000}, '23514'],
      ['a limit above $10,000', {limit: CEILING + 10_000}, '23514'],
      ['a negative carried settled amount', {cs: -1, cause: 'change'}, '23514'],
      ['a carried reserved amount above the bound a safe integer needs', {cr: 1_000_000_000_000_001}, '23514'],
      ['a cause it does not know', {cause: 'refund'}, '23514'],
      ['a month that is not the first of a month', {month: '2026-10-02'}, '23514'],
      ['the system as the actor of a command', {actor: 'system'}, '23514'],
      ['an actor that is neither a user nor the system', {actor: 'root'}, '23514'],
      ['a user ID with a space in it', {actor: 'user:bad id'}, '23514'],
      ['a command with no command ID', {command: null}, '23514'],
      ['a rollover with a command ID', {cause: 'month', month: 'later', actor: 'system', previous: 30 * M, limit: 30 * M}, '23514'],
      ['a digest that is not 64 lower-case hexadecimal characters', {digest: 'xyz'}, '23514'],
      ['a digest in upper case', {digest: 'A'.repeat(64)}, '23514'],
      ['an initial period that is not the first', {cause: 'initial', previous: null, command: null, actor: 'system'}, '23514'],
      ['a change with no previous limit', {previous: null}, '23514'],
      ['a change to the limit it already had', {limit: 25 * M}, '23514'],
      ['a reset that moves the limit', {cause: 'reset', limit: 30 * M, previous: 25 * M}, '23514'],
      ['a reset that carries settled usage', {cause: 'reset', limit: 25 * M, previous: 25 * M, cs: 1}, '23514'],
      ['a rollover that carries settled usage', {cause: 'month', month: 'later', actor: 'system', command: null, limit: 25 * M, previous: 25 * M, cs: 1}, '23514'],
      ['a seq that skips one', {seq: 3}, '23514'],
      ['a seq that repeats one', {seq: 1}, '23514'],
      ['a month that goes back', {month: 'earlier'}, '23514'],
      ['a change in a later month than the period before it', {month: 'later'}, '23514'],
      ['a rollover in the same month', {cause: 'month', actor: 'system', command: null, limit: 25 * M, previous: 25 * M}, '23514'],
    ] as [string, Partial<Insert>, string][])('refuses %s', async (_name, over, code) => {
      await inTx(async (client) => {
        const a = await account(client);
        const result = await insert(client, a.accountId, over);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe(code);
        expect((await periodsOf(client, a.accountId)).map((p) => p.seq)).toEqual([1]);
      });
    });

    it('refuses a first period that is not `initial`, and an initial one that carries anything or has a previous limit', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        await client.query('delete from usage.periods where account_id = $1', [a.accountId]);
        expect((await insert(client, a.accountId, {seq: 1})).ok).toBe(false);
        expect((await insert(client, a.accountId, {seq: 1, cause: 'initial', previous: 25 * M, command: null, actor: 'system'})).ok).toBe(false);
        expect((await insert(client, a.accountId, {seq: 1, cause: 'initial', previous: null, command: null, actor: 'system', cr: 1})).ok).toBe(false);
        expect((await insert(client, a.accountId, {seq: 1, cause: 'initial', previous: null, command: null, actor: 'system', cs: 1})).ok).toBe(false);
        expect((await insert(client, a.accountId, {seq: 1, cause: 'initial', previous: null, command: null, actor: 'system', limit: 25 * M})).ok).toBe(true);
      });
    });

    it('refuses a period of an Account that does not exist, and a command ID used twice for one Account (the receipt is unique)', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        const stranger = await insert(client, a.accountId, {account: randomUUID(), seq: 1, cause: 'initial', previous: null, command: null, actor: 'system', limit: 25 * M});
        expect(stranger.ok).toBe(false);
        if (!stranger.ok) expect(stranger.code).toBe('23503');
        const command = randomUUID();
        expect((await insert(client, a.accountId, {command})).ok).toBe(true);
        const twice = await insert(client, a.accountId, {seq: 3, cause: 'reset', limit: 30 * M, previous: 30 * M, command});
        expect(twice.ok).toBe(false);
        if (!twice.ok) expect(twice.code).toBe('23505');
        // The same command ID for another Account is another receipt.
        const b = await account(client);
        expect((await insert(client, b.accountId, {command})).ok).toBe(true);
      });
    });

    it('keeps the figures of the stand-in non-negative, one row for each period', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        const [period] = await periodsOf(client, a.accountId);
        for (const [settled, reserved] of [[-1, 0], [0, -1], [1_000_000_000_000_001, 0]]) {
          const result = await attempt(client, null, 'insert into usage.fixture_figures (period_id, settled_microdollars, reserved_microdollars) values ($1, $2, $3)', [period.id, settled, reserved]);
          expect(result.ok, `${settled}/${reserved}`).toBe(false);
          if (!result.ok) expect(result.code).toBe('23514');
        }
        await figures(client, period.id, 5, 6);
        const twice = await attempt(client, null, 'insert into usage.fixture_figures (period_id) values ($1)', [period.id]);
        expect(twice.ok).toBe(false);
        if (!twice.ok) expect(twice.code).toBe('23505');
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('defaults: $25 for an invitee, $50 for the Administrator, for the UTC month, in integer microdollars', () => {
  it('gives an invitee 25,000,000 when registration activates the Account, in the same transaction, as an `initial` period made by the system', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const month = await currentMonth(client);
      expect(await periodsOf(client, a.accountId)).toEqual([
        expect.objectContaining({seq: 1, month_start: month, limit_microdollars: 25 * M, carried_settled: 0, carried_reserved: 0, cause: 'initial', previous_limit: null, actor: 'system', command_id: null}),
      ]);
      const [period] = await periodsOf(client, a.accountId);
      expect(period.digest).toMatch(/^[0-9a-f]{64}$/);
      // The month is the UTC first of the month (a date), whatever the clock says on the machine running the tests.
      expect(month).toBe((await client.query(`select date_trunc('month', now() at time zone 'UTC')::date::text as month`)).rows[0].month);
    });
  });

  it('gives the Administrator 50,000,000 when the pre-authorization is consumed', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      await svc.seed(user.email, 'administrator');
      const receipt = await svc.consume(user.id);
      expect(receipt.outcome).toBe('registered');
      expect(receipt.role).toBe('administrator');
      expect(await periodsOf(client, receipt.account_id)).toEqual([
        expect.objectContaining({seq: 1, limit_microdollars: 50 * M, carried_settled: 0, carried_reserved: 0, cause: 'initial', actor: 'system'}),
      ]);
    });
  });

  it('creates no period for a registration that is refused, nor for an activation that fails: the period is made in the transaction that makes the Account', async () => {
    await inTx(async (client) => {
      const before = await count(client, 'select count(*) as n from usage.periods');
      const user = await addUser(client);
      const refused = await api(client).register(user.id, codeHash());
      expect(refused.outcome).toBe('refused');
      expect(await count(client, 'select count(*) as n from usage.periods')).toBe(before);
      // identity.activate_account is one statement: a role it refuses leaves no Account, no Workspace and no period.
      const second = await addUser(client);
      const activation = await attempt(client, null, `select identity.activate_account($1, $2, 'owner', 'invitation')`, [second.id, second.subject]);
      expect(activation.ok).toBe(false);
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [second.id])).toBe(0);
      expect(await count(client, 'select count(*) as n from usage.periods')).toBe(before);
    });
  });

  it('knows the default of a role and nothing else: an unknown or missing role is an invalid argument', async () => {
    await inTx(async (client) => {
      const row = (await client.query(`select usage.default_limit('member')::float8 as member, usage.default_limit('administrator')::float8 as administrator`)).rows[0];
      expect(row).toEqual({member: 25 * M, administrator: 50 * M});
      for (const role of ["'owner'", "'Member'", "''", 'null']) {
        const result = await attempt(client, null, `select usage.default_limit(${role})`);
        expect(result.ok, role).toBe(false);
        if (!result.ok) expect(result.code, role).toBe('22023');
      }
    });
  });

  it('gives an Account that exists an `initial` period when the migration\'s backfill runs, and runs it again without adding a second', async () => {
    const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261022120000_usage_limits.sql'), 'utf8');
    const start = migration.indexOf('-- BACKFILL BEGINS');
    const end = migration.indexOf('-- BACKFILL ENDS');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const backfill = migration.slice(start + '-- BACKFILL BEGINS'.length, end);
    expect(backfill).toMatch(/usage\.ensure_period/);
    await inTx(async (client) => {
      const member = await account(client);
      const admin = await account(client, 'administrator');
      // The Accounts as they were before the migration: no period at all.
      await client.query('delete from usage.periods where account_id = any($1)', [[member.accountId, admin.accountId]]);
      expect(await periodsOf(client, member.accountId)).toEqual([]);
      await client.query(backfill);
      const month = await currentMonth(client);
      expect(await periodsOf(client, member.accountId)).toEqual([expect.objectContaining({seq: 1, month_start: month, limit_microdollars: 25 * M, cause: 'initial', actor: 'system'})]);
      // The role at the moment of the backfill decides: an Account that has become the Administrator gets $50.
      expect(await periodsOf(client, admin.accountId)).toEqual([expect.objectContaining({seq: 1, month_start: month, limit_microdollars: 50 * M, cause: 'initial', actor: 'system'})]);
      await client.query(backfill);
      expect((await periodsOf(client, member.accountId)).map((p) => p.seq)).toEqual([1]);
      expect((await periodsOf(client, admin.accountId)).map((p) => p.seq)).toEqual([1]);
      // And every Account in the database has one now.
      expect(await count(client, 'select count(*) as n from identity.accounts a where not exists (select 1 from usage.periods p where p.account_id = a.id)')).toBe(0);
    });
  });

  it('creates the `initial` period of an Account that has none, under the lock, when anything reads Usage; and refuses an Account that does not exist', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await client.query('delete from usage.periods where account_id = $1', [a.accountId]);
      const ensured = (await client.query('select seq, cause, limit_microdollars::float8 as limit from usage.ensure_period($1)', [a.accountId])).rows[0];
      expect(ensured).toEqual({seq: 1, cause: 'initial', limit: 25 * M});
      expect((await periodsOf(client, a.accountId)).map((p) => p.seq)).toEqual([1]);
      for (const bad of [randomUUID(), null]) {
        const result = await attempt(client, null, 'select usage.ensure_period($1)', [bad]);
        expect(result.ok, String(bad)).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });

  it('takes the month from the UTC clock, never from the session\'s time zone', async () => {
    for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata']) {
      await inTx(async (client) => {
        await client.query(`set local time zone '${zone}'`);
        const utc = (await client.query(`select date_trunc('month', clock_timestamp() at time zone 'UTC')::date::text as month`)).rows[0].month;
        expect(await currentMonth(client), zone).toBe(utc);
        const a = await account(client);
        expect((await periodsOf(client, a.accountId))[0].month_start, zone).toBe(utc);
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('changing a limit and resetting the count: a successor period that carries the liabilities', () => {
  it('changes the limit: seq + 1, the old limit recorded, everything so far carried, the old row untouched, one audit event; the worked example of the story', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const [first] = await periodsOf(client, member.accountId);
      // 25M limit, 10M settled, 2M reserved.
      await figures(client, first.id, 10 * M, 2 * M);
      expect(await availableOf(client, member.accountId)).toBe(13 * M);
      const command = randomUUID();
      const answer = await setLimit(client, member.accountId, {admin, command, kind: 'change', limit: 40 * M, expectedSeq: 1});
      expect(answer).toMatchObject({outcome: 'changed', seq: 2, limit_microdollars: 40 * M, previous_limit_microdollars: 25 * M, cause: 'change'});
      const periods = await periodsOf(client, member.accountId);
      expect(periods).toHaveLength(2);
      expect(answer.period_id).toBe(periods[1].id);
      expect(periods[1]).toMatchObject({
        seq: 2,
        month_start: first.month_start,
        limit_microdollars: 40 * M,
        carried_settled: 10 * M,
        carried_reserved: 2 * M,
        cause: 'change',
        previous_limit: 25 * M,
        actor: `user:${admin.user.id}`,
        command_id: command,
      });
      expect(periods[1].digest).toMatch(/^[0-9a-f]{64}$/);
      // The row it replaces as the current one is exactly as it was.
      expect(periods[0]).toEqual(first);
      // Seq 2 carried 10M/2M, so 28M of 40M is available, and the page reads the carried amounts as the shown ones.
      expect(await availableOf(client, member.accountId)).toBe(28 * M);
      const listed = rowOf(await listAs(client, admin), member.accountId);
      expect(listed).toMatchObject({seq: 2, limit_microdollars: 40 * M, settled_microdollars: 10 * M, reserved_microdollars: 2 * M, cause: 'change'});
      // One audit event for the actor and the Account, and no amount in it.
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([{actor: `user:${admin.user.id}`, action: 'usage.limit_changed', target: `account:${member.accountId}`}]);
    });
  });

  it('resets the count: carried settled 0, the reserved carry kept, the limit kept; the worked example of the story', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const [first] = await periodsOf(client, member.accountId);
      await figures(client, first.id, 10 * M, 2 * M);
      const answer = await setLimit(client, member.accountId, {admin, kind: 'reset', limit: null, expectedSeq: 1});
      expect(answer).toMatchObject({outcome: 'reset', seq: 2, limit_microdollars: 25 * M, previous_limit_microdollars: 25 * M, cause: 'reset'});
      const periods = await periodsOf(client, member.accountId);
      expect(periods[1]).toMatchObject({seq: 2, limit_microdollars: 25 * M, carried_settled: 0, carried_reserved: 2 * M, cause: 'reset', previous_limit: 25 * M, actor: `user:${admin.user.id}`});
      expect(periods[0]).toEqual(first);
      expect(await availableOf(client, member.accountId)).toBe(23 * M);
      expect(rowOf(await listAs(client, admin), member.accountId)).toMatchObject({seq: 2, limit_microdollars: 25 * M, settled_microdollars: 0, reserved_microdollars: 2 * M, cause: 'reset'});
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([{actor: `user:${admin.user.id}`, action: 'usage.limit_reset', target: `account:${member.accountId}`}]);
    });
  });

  it('keeps carrying through several periods: each change adds the figures of the period it closes, a reset drops only the settled count', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      let periods = await periodsOf(client, member.accountId);
      await figures(client, periods[0].id, 4 * M, 1 * M);
      await setLimit(client, member.accountId, {admin, limit: 30 * M, expectedSeq: 1});
      periods = await periodsOf(client, member.accountId);
      expect(periods[1]).toMatchObject({carried_settled: 4 * M, carried_reserved: 1 * M});
      await figures(client, periods[1].id, 3 * M, 2 * M);
      await setLimit(client, member.accountId, {admin, limit: 35 * M, expectedSeq: 2});
      periods = await periodsOf(client, member.accountId);
      expect(periods[2]).toMatchObject({seq: 3, limit_microdollars: 35 * M, carried_settled: 7 * M, carried_reserved: 3 * M, previous_limit: 30 * M});
      expect(await availableOf(client, member.accountId)).toBe(25 * M);
      await figures(client, periods[2].id, 1 * M, 1 * M);
      await setLimit(client, member.accountId, {admin, kind: 'reset', limit: null, expectedSeq: 3});
      periods = await periodsOf(client, member.accountId);
      expect(periods[3]).toMatchObject({seq: 4, limit_microdollars: 35 * M, carried_settled: 0, carried_reserved: 4 * M, cause: 'reset'});
      expect(await availableOf(client, member.accountId)).toBe(31 * M);
      // A change after a reset counts from the reset.
      await figures(client, periods[3].id, 2 * M, 0);
      await setLimit(client, member.accountId, {admin, limit: 20 * M, expectedSeq: 4});
      periods = await periodsOf(client, member.accountId);
      expect(periods[4]).toMatchObject({seq: 5, limit_microdollars: 20 * M, carried_settled: 2 * M, carried_reserved: 4 * M});
      expect(await availableOf(client, member.accountId)).toBe(14 * M);
      // Nothing earlier was ever edited: the same five rows, in order, each with its own history.
      expect(periods.map((p) => p.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(periods.map((p) => p.cause)).toEqual(['initial', 'change', 'change', 'reset', 'change']);
    });
  });

  it('accepts a limit below what is already used: the Account is at its limit, the amounts are carried as they were, and nothing is available', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const [first] = await periodsOf(client, member.accountId);
      await figures(client, first.id, 18 * M, 2 * M);
      const answer = await setLimit(client, member.accountId, {admin, limit: 10 * M, expectedSeq: 1});
      expect(answer).toMatchObject({outcome: 'changed', seq: 2, limit_microdollars: 10 * M, previous_limit_microdollars: 25 * M});
      expect(rowOf(await listAs(client, admin), member.accountId)).toMatchObject({limit_microdollars: 10 * M, settled_microdollars: 18 * M, reserved_microdollars: 2 * M});
      // Used 20M against 10M: 10M over, nothing available, never a negative number.
      expect(await availableOf(client, member.accountId)).toBe(0);
    });
  });

  it('accepts a limit of 0 (nothing available, whatever is used) and the ceiling of $10,000, and nothing in between that is not whole cents', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      expect(await setLimit(client, member.accountId, {admin, limit: 0, expectedSeq: 1})).toMatchObject({outcome: 'changed', seq: 2, limit_microdollars: 0, previous_limit_microdollars: 25 * M});
      expect(await availableOf(client, member.accountId)).toBe(0);
      expect(await setLimit(client, member.accountId, {admin, limit: CEILING, expectedSeq: 2})).toMatchObject({outcome: 'changed', seq: 3, limit_microdollars: CEILING, previous_limit_microdollars: 0});
      expect(await availableOf(client, member.accountId)).toBe(CEILING);
      expect(await setLimit(client, member.accountId, {admin, limit: 10_000, expectedSeq: 3})).toMatchObject({outcome: 'changed', seq: 4, limit_microdollars: 10_000});
      expect(await setLimit(client, member.accountId, {admin, limit: 10_000_000_000 - 10_000, expectedSeq: 4})).toMatchObject({outcome: 'changed', seq: 5});
    });
  });

  it('lets the Administrator change the Administrator\'s own limit', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      expect(await setLimit(client, admin.accountId, {admin, limit: 60 * M, expectedSeq: 1})).toMatchObject({outcome: 'changed', seq: 2, limit_microdollars: 60 * M});
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([{actor: `user:${admin.user.id}`, action: 'usage.limit_changed', target: `account:${admin.accountId}`}]);
    });
  });

  it('can reset twice in a row: a reset is a period of its own each time, and carries the reserved amount again', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const [first] = await periodsOf(client, member.accountId);
      await figures(client, first.id, 5 * M, 3 * M);
      expect(await setLimit(client, member.accountId, {admin, kind: 'reset', limit: null, expectedSeq: 1})).toMatchObject({outcome: 'reset', seq: 2});
      expect(await setLimit(client, member.accountId, {admin, kind: 'reset', limit: null, expectedSeq: 2})).toMatchObject({outcome: 'reset', seq: 3});
      const periods = await periodsOf(client, member.accountId);
      expect(periods.map((p) => [p.seq, p.cause, p.carried_settled, p.carried_reserved])).toEqual([[1, 'initial', 0, 0], [2, 'reset', 0, 3 * M], [3, 'reset', 0, 3 * M]]);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toHaveLength(2);
    });
  });

  it('shows no fixture to anyone but the stand-in: with no row in usage.fixture_figures every figure is zero', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      expect(await count(client, 'select count(*) as n from usage.fixture_figures f join usage.periods p on p.id = f.period_id where p.account_id = $1', [member.accountId])).toBe(0);
      expect(rowOf(await listAs(client, admin), member.accountId)).toMatchObject({settled_microdollars: 0, reserved_microdollars: 0});
      const figuresOf = (await client.query('select settled_microdollars::float8 as settled, reserved_microdollars::float8 as reserved from usage.period_figures($1)', [randomUUID()])).rows[0];
      expect(figuresOf).toEqual({settled: 0, reserved: 0});
      expect(await availableOf(client, member.accountId)).toBe(25 * M);
    });
  });

  it('never writes the stand-in: no api function adds, changes or deletes a row of usage.fixture_figures', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const before = await count(client, 'select count(*) as n from usage.fixture_figures');
      await setLimit(client, member.accountId, {admin, limit: 40 * M, expectedSeq: 1});
      await setLimit(client, member.accountId, {admin, kind: 'reset', limit: null, expectedSeq: 2});
      await listAs(client, admin);
      await rows(client, 'service_role', 'select * from api.record_usage_refusal($1, $2, $3)', [member.user.id, 'usage.denied', member.accountId]);
      expect(await count(client, 'select count(*) as n from usage.fixture_figures')).toBe(before);
    });
    const definition = (await db.query(`select string_agg(pg_get_functiondef(p.oid), E'\\n') as text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname in ('set_usage_limit', 'list_usage', 'record_usage_refusal')`)).rows[0].text as string;
    expect(definition).not.toMatch(/(insert\s+into|update|delete\s+from)\s+usage\.fixture_figures/i);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the monthly rollover: lazy, once, and under the Account\'s lock', () => {
  it('appends one `month` period the first time anything reads Usage in a new UTC month: the same limit, settled carry 0, the reserved carry kept; and a second call adds none', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const [id] = await replacePeriods(client, member.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M, cause: 'initial'}]);
      await figures(client, id, 10 * M, 2 * M);
      const [old] = await periodsOf(client, member.accountId);
      const month = await currentMonth(client);
      expect(old.month_start).not.toBe(month);

      const first = rowOf(await listAs(client, admin), member.accountId);
      const periods = await periodsOf(client, member.accountId);
      expect(periods).toHaveLength(2);
      expect(periods[1]).toMatchObject({seq: 2, month_start: month, limit_microdollars: 25 * M, carried_settled: 0, carried_reserved: 2 * M, cause: 'month', previous_limit: 25 * M, actor: 'system', command_id: null});
      expect(periods[0]).toEqual(old);
      expect(first).toMatchObject({seq: 2, month_start: month, limit_microdollars: 25 * M, settled_microdollars: 0, reserved_microdollars: 2 * M, cause: 'month'});

      await listAs(client, admin);
      await rows(client, 'service_role', 'select * from api.list_usage($1, $2)', [admin.accountId, admin.epoch]);
      expect(await periodsOf(client, member.accountId)).toHaveLength(2);
      // No audit event for a rollover: nobody commanded it.
      expect(await usageEvents(client, 'system')).toEqual([]);
    });
  });

  it('adds up the reserved carry over the periods it leaves behind, and drops the settled one', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const command = randomUUID();
      const ids = await replacePeriods(client, member.accountId, [
        {seq: 1, monthsAgo: 2, limit: 25 * M, cause: 'initial'},
        {seq: 2, monthsAgo: 2, limit: 30 * M, cause: 'change', previous: 25 * M, settled: 4 * M, reserved: 1 * M, actor: `user:${admin.user.id}`, command},
      ]);
      expect(ids).toHaveLength(2);
      await figures(client, ids[1], 3 * M, 2 * M);
      // Both periods are of the month before last, so one rollover brings the Account to this month.
      const shown = rowOf(await listAs(client, admin), member.accountId);
      const periods = await periodsOf(client, member.accountId);
      expect(periods.map((p) => p.seq)).toEqual([1, 2, 3]);
      expect(periods[2]).toMatchObject({seq: 3, limit_microdollars: 30 * M, carried_settled: 0, carried_reserved: 3 * M, cause: 'month', previous_limit: 30 * M, actor: 'system'});
      expect(shown).toMatchObject({settled_microdollars: 0, reserved_microdollars: 3 * M, limit_microdollars: 30 * M});
      expect(await availableOf(client, member.accountId)).toBe(27 * M);
    });
  });

  it('adds one period for several skipped months, not one for each', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      await replacePeriods(client, member.accountId, [{seq: 1, monthsAgo: 5, limit: 25 * M, cause: 'initial'}]);
      await listAs(client, admin);
      const periods = await periodsOf(client, member.accountId);
      expect(periods.map((p) => [p.seq, p.cause])).toEqual([[1, 'initial'], [2, 'month']]);
      expect(periods[1].month_start).toBe(await currentMonth(client));
    });
  });

  it('keeps a limit that was changed across the month, and a reserved carry that was reset, into the new month', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const ids = await replacePeriods(client, member.accountId, [
        {seq: 1, monthsAgo: 1, limit: 40 * M, cause: 'initial'},
        {seq: 2, monthsAgo: 1, limit: 40 * M, cause: 'reset', previous: 40 * M, reserved: 2 * M, actor: `user:${admin.user.id}`, command: randomUUID()},
      ]);
      await figures(client, ids[1], 1 * M, 1 * M);
      await listAs(client, admin);
      const periods = await periodsOf(client, member.accountId);
      // The reserved carry (2M) plus the reserved figure of the period left behind (1M); the settled figure (1M) is not carried into a new month.
      expect(periods[2]).toMatchObject({seq: 3, limit_microdollars: 40 * M, carried_settled: 0, carried_reserved: 3 * M, cause: 'month'});
    });
  });

  it('rolls the month over before a command, so a page that was rendered last month is told it is stale, with the new period\'s seq', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      await replacePeriods(client, member.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M, cause: 'initial'}]);
      const stale = await setLimit(client, member.accountId, {admin, limit: 40 * M, expectedSeq: 1});
      expect(stale).toMatchObject({outcome: 'stale', seq: 2, cause: 'month', limit_microdollars: 25 * M});
      expect((await periodsOf(client, member.accountId)).map((p) => [p.seq, p.cause])).toEqual([[1, 'initial'], [2, 'month']]);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([]);
      // With the seq of the new month the same limit is accepted, and the change belongs to this month.
      expect(await setLimit(client, member.accountId, {admin, limit: 40 * M, expectedSeq: 2})).toMatchObject({outcome: 'changed', seq: 3, month_start: await currentMonth(client)});
    });
  });

  it('does not roll a disabled Account\'s month for a command (it is refused first), and does when the Administrator reads Usage: its usage stays readable', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      await replacePeriods(client, member.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M, cause: 'initial'}]);
      expect(await disable(client, member.accountId)).toBe('disabled');
      expect(await setLimit(client, member.accountId, {admin, limit: 40 * M, expectedSeq: 1})).toMatchObject({outcome: 'disabled'});
      expect(await periodsOf(client, member.accountId)).toHaveLength(1);
      expect(rowOf(await listAs(client, admin), member.accountId)).toMatchObject({status: 'disabled', seq: 2, cause: 'month'});
    });
  });

  it('is done by usage.available_microdollars too: it reads the Account\'s current month, with the reserved carry', async () => {
    await inTx(async (client) => {
      const member = await account(client);
      const [id] = await replacePeriods(client, member.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M, cause: 'initial'}]);
      await figures(client, id, 10 * M, 2 * M);
      expect(await availableOf(client, member.accountId)).toBe(23 * M);
      expect((await periodsOf(client, member.accountId)).map((p) => p.cause)).toEqual(['initial', 'month']);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.set_usage_limit: every outcome, in its order', () => {
  it('refuses a shape the application would never send as an invalid argument (22023), before anything else: not even the authority is asked', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const good = setArgs({admin, expectedSeq: 1}, member.accountId);
      const variants: [string, unknown[]][] = [
        ['no actor', [null, ...good.slice(1)]],
        ['an actor that is not a user', ['seed:local:test', ...good.slice(1)]],
        ['an actor with another prefix', [`account:${admin.accountId}`, ...good.slice(1)]],
        ['an actor with a space in it', ['user:a b', ...good.slice(1)]],
        ['an empty actor', ['', ...good.slice(1)]],
        ['no Administrator Account', [good[0], null, ...good.slice(2)]],
        ['no epoch', [good[0], good[1], null, ...good.slice(3)]],
        ['an epoch of 0', [good[0], good[1], 0, ...good.slice(3)]],
        ['no target', [...good.slice(0, 3), null, ...good.slice(4)]],
        ['no command ID', [...good.slice(0, 4), null, ...good.slice(5)]],
        ['no kind', [...good.slice(0, 5), null, ...good.slice(6)]],
        ['a kind it does not know', [...good.slice(0, 5), 'delete', ...good.slice(6)]],
        ['a kind in upper case', [...good.slice(0, 5), 'Change', ...good.slice(6)]],
        ['no expected seq', [...good.slice(0, 7), null]],
        ['an expected seq of 0', [...good.slice(0, 7), 0]],
        ['a negative expected seq', [...good.slice(0, 7), -1]],
      ];
      for (const [name, params] of variants) {
        const result = await attempt(client, 'service_role', SET, params);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('22023');
      }
      // Even a caller that is no Administrator is told about a malformed command by the error, not by `denied`.
      const result = await attempt(client, 'service_role', SET, [`user:${member.user.id}`, member.accountId, member.epoch, member.accountId, randomUUID(), 'delete', 40 * M, 1]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(await periodsOf(client, member.accountId)).toHaveLength(1);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([]);
    });
  });

  it('answers `denied` for a caller that is a member, whatever the rest of the command says, and appends and audits nothing', async () => {
    await inTx(async (client) => {
      const member = await account(client);
      const other = await account(client);
      for (const target of [other.accountId, member.accountId, randomUUID()]) {
        const answer = await setLimit(client, target, {admin: member, actor: `user:${member.user.id}`, limit: 99 * M, expectedSeq: 1});
        expect(answer).toMatchObject({outcome: 'denied', period_id: null, seq: null, limit_microdollars: null});
      }
      expect(await periodsOf(client, other.accountId)).toHaveLength(1);
      expect(await periodsOf(client, member.accountId)).toHaveLength(1);
      expect(await usageEvents(client, `user:${member.user.id}`)).toEqual([]);
    });
  });

  it('answers `denied` for an Account that does not exist, a stale epoch (any other than the Account\'s), a disabled caller and a tombstoned caller', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      expect(await setLimit(client, target.accountId, {admin: {...admin, accountId: randomUUID()}, limit: 99 * M})).toMatchObject({outcome: 'denied'});
      for (const epoch of [admin.epoch + 1, admin.epoch + 5, 1000]) expect(await setLimit(client, target.accountId, {admin, epoch, limit: 99 * M}), String(epoch)).toMatchObject({outcome: 'denied'});
      // Disabled: the status change raises the epoch, so the old epoch is stale, and the new one is refused because the Account is disabled.
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [admin.accountId]);
      const raised = await epochOf(client, admin.accountId);
      expect(raised).toBeGreaterThan(admin.epoch);
      for (const epoch of [admin.epoch, raised]) expect(await setLimit(client, target.accountId, {admin, epoch, limit: 99 * M}), String(epoch)).toMatchObject({outcome: 'denied'});
      // Active again under a newer epoch: the old operation stays denied, the new one works.
      await client.query(`update identity.accounts set status = 'active' where id = $1`, [admin.accountId]);
      const newer = await epochOf(client, admin.accountId);
      expect(await setLimit(client, target.accountId, {admin, epoch: raised, limit: 99 * M})).toMatchObject({outcome: 'denied'});
      expect(await setLimit(client, target.accountId, {admin, epoch: newer, limit: 99 * M})).toMatchObject({outcome: 'changed'});
      // A tombstoned caller is refused first.
      const gone = await account(client, 'administrator');
      expect(await tombstone(client, gone.accountId)).toBe('recorded');
      const after = await epochOf(client, gone.accountId);
      for (const epoch of [gone.epoch, after, after + 1]) expect(await setLimit(client, target.accountId, {admin: gone, epoch, limit: 98 * M}), String(epoch)).toMatchObject({outcome: 'denied'});
      expect(await periodsOf(client, target.accountId)).toHaveLength(2);
    });
  });

  it('answers `not_found` for an Account that does not exist and for one with a tombstone, before it asks about anything else of the command', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      expect(await setLimit(client, randomUUID(), {admin, limit: 99 * M})).toMatchObject({outcome: 'not_found', period_id: null});
      // A bad limit and a stale seq do not matter: the Account is not there.
      expect(await setLimit(client, randomUUID(), {admin, limit: 12_345, expectedSeq: 9})).toMatchObject({outcome: 'not_found'});
      expect(await tombstone(client, target.accountId)).toBe('recorded');
      expect(await setLimit(client, target.accountId, {admin, limit: 99 * M})).toMatchObject({outcome: 'not_found'});
      // ... even though its row and its periods are still there, and unchanged.
      expect(await periodsOf(client, target.accountId)).toHaveLength(1);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([]);
    });
  });

  it('answers `disabled` for a disabled Account, appends and audits nothing, and answers it again for a bad limit, a stale seq and a replayed command: the Account is judged before the rest', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      const command = randomUUID();
      expect(await setLimit(client, target.accountId, {admin, command, limit: 40 * M, expectedSeq: 1})).toMatchObject({outcome: 'changed'});
      expect(await disable(client, target.accountId)).toBe('disabled');
      const events = (await usageEvents(client, `user:${admin.user.id}`)).length;
      for (const o of [
        {limit: 50 * M, expectedSeq: 2},
        {limit: 12_345, expectedSeq: 2},
        {limit: 50 * M, expectedSeq: 1},
        {kind: 'reset', limit: null, expectedSeq: 2},
        // The command that already made a period is not replayed for a disabled Account.
        {command, limit: 40 * M, expectedSeq: 1},
      ]) {
        const answer = await setLimit(client, target.accountId, {admin, ...o});
        expect(answer, JSON.stringify(o)).toMatchObject({outcome: 'disabled', period_id: null, seq: null});
      }
      expect(await periodsOf(client, target.accountId)).toHaveLength(2);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toHaveLength(events);
      // Re-enabled, the Account can be changed again, from where it was.
      await rows(client, 'service_role', `select * from api.enable_account('seed:local:usage', $1)`, [target.accountId]);
      expect(await setLimit(client, target.accountId, {admin, limit: 50 * M, expectedSeq: 2})).toMatchObject({outcome: 'changed', seq: 3});
    });
  });

  it('answers `replayed` with the same period for the same command, and appends and audits nothing again; also when the person\'s seq is out of date by now', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      const command = randomUUID();
      const first = await setLimit(client, target.accountId, {admin, command, limit: 40 * M, expectedSeq: 1});
      expect(first.outcome).toBe('changed');
      const again = await setLimit(client, target.accountId, {admin, command, limit: 40 * M, expectedSeq: 1});
      expect(again).toMatchObject({outcome: 'replayed', period_id: first.period_id, seq: 2, limit_microdollars: 40 * M, previous_limit_microdollars: 25 * M, cause: 'change', month_start: first.month_start});
      // Another command moves the Account on; the first one is still answered with its own period.
      expect(await setLimit(client, target.accountId, {admin, limit: 45 * M, expectedSeq: 2})).toMatchObject({outcome: 'changed', seq: 3});
      expect(await setLimit(client, target.accountId, {admin, command, limit: 40 * M, expectedSeq: 1})).toMatchObject({outcome: 'replayed', period_id: first.period_id, seq: 2});
      expect(await periodsOf(client, target.accountId)).toHaveLength(3);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toHaveLength(2);
      // A reset replays the same way.
      const reset = randomUUID();
      const made = await setLimit(client, target.accountId, {admin, command: reset, kind: 'reset', limit: null, expectedSeq: 3});
      expect(made).toMatchObject({outcome: 'reset', seq: 4});
      expect(await setLimit(client, target.accountId, {admin, command: reset, kind: 'reset', limit: null, expectedSeq: 3})).toMatchObject({outcome: 'replayed', period_id: made.period_id, cause: 'reset', limit_microdollars: 45 * M});
      expect(await periodsOf(client, target.accountId)).toHaveLength(4);
    });
  });

  it('answers `reused` when the command ID made a period for another payload: another limit, another expected seq, another kind; and appends nothing, even though the seq is out of date', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      const command = randomUUID();
      expect((await setLimit(client, target.accountId, {admin, command, limit: 40 * M, expectedSeq: 1})).outcome).toBe('changed');
      for (const o of [
        {limit: 50 * M, expectedSeq: 1},
        {limit: 40 * M, expectedSeq: 2},
        {kind: 'reset', limit: null, expectedSeq: 1},
        {limit: 50 * M, expectedSeq: 2},
        {limit: 12_345, expectedSeq: 1},
      ]) {
        expect(await setLimit(client, target.accountId, {admin, command, ...o}), JSON.stringify(o)).toMatchObject({outcome: 'reused', period_id: null, seq: null});
      }
      expect(await periodsOf(client, target.accountId)).toHaveLength(2);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toHaveLength(1);
      // The receipt belongs to the Account: the same command ID for another Account is a new command.
      const other = await account(client);
      expect(await setLimit(client, other.accountId, {admin, command, limit: 50 * M, expectedSeq: 1})).toMatchObject({outcome: 'changed', seq: 2, limit_microdollars: 50 * M});
    });
  });

  it('answers `stale` with the current seq when the person saw an older period, and appends and audits nothing; it comes before a bad limit and before `unchanged`', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      await setLimit(client, target.accountId, {admin, limit: 40 * M, expectedSeq: 1});
      const events = (await usageEvents(client, `user:${admin.user.id}`)).length;
      for (const o of [
        {limit: 50 * M, expectedSeq: 1},
        {limit: 12_345, expectedSeq: 1},
        {limit: -5, expectedSeq: 1},
        {limit: 40 * M, expectedSeq: 1},
        {kind: 'reset', limit: null, expectedSeq: 1},
        {kind: 'reset', limit: 40 * M, expectedSeq: 1},
        {limit: 50 * M, expectedSeq: 3},
        {limit: 50 * M, expectedSeq: 99},
      ]) {
        const answer = await setLimit(client, target.accountId, {admin, ...o});
        expect(answer, JSON.stringify(o)).toMatchObject({outcome: 'stale', seq: 2, limit_microdollars: 40 * M, previous_limit_microdollars: 25 * M, cause: 'change'});
      }
      expect(await periodsOf(client, target.accountId)).toHaveLength(2);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toHaveLength(events);
    });
  });

  it.each([
    ['a negative limit', -10_000],
    ['a limit of one microdollar', 1],
    ['a limit that is not whole cents', 12_345],
    ['a limit one microdollar above a whole number of cents', 25_000_001],
    ['a limit above the ceiling', CEILING + 10_000],
    ['a limit that is a lot above the ceiling', 9_000_000_000_000],
    ['no limit for a change', null],
  ])('answers `invalid_limit` for %s, and appends and audits nothing', async (_name, limit) => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      expect(await setLimit(client, target.accountId, {admin, kind: 'change', limit, expectedSeq: 1})).toMatchObject({outcome: 'invalid_limit', period_id: null, seq: null, limit_microdollars: null});
      expect(await periodsOf(client, target.accountId)).toHaveLength(1);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([]);
    });
  });

  it('answers `invalid_limit` for a reset that is given a limit, even the limit it already has', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      for (const limit of [0, 25 * M, 40 * M, CEILING]) expect(await setLimit(client, target.accountId, {admin, kind: 'reset', limit, expectedSeq: 1}), String(limit)).toMatchObject({outcome: 'invalid_limit'});
      expect(await periodsOf(client, target.accountId)).toHaveLength(1);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([]);
    });
  });

  it('answers `unchanged` for a change to the current limit, with the current period, and appends and audits nothing; a reset is never unchanged', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      const [first] = await periodsOf(client, target.accountId);
      expect(await setLimit(client, target.accountId, {admin, limit: 25 * M, expectedSeq: 1})).toMatchObject({outcome: 'unchanged', period_id: first.id, seq: 1, limit_microdollars: 25 * M, cause: 'initial', previous_limit_microdollars: null});
      expect(await periodsOf(client, target.accountId)).toHaveLength(1);
      expect(await usageEvents(client, `user:${admin.user.id}`)).toEqual([]);
      // The same holds after a change: "the limit it already has" is the current period's.
      await setLimit(client, target.accountId, {admin, limit: 40 * M, expectedSeq: 1});
      expect(await setLimit(client, target.accountId, {admin, limit: 40 * M, expectedSeq: 2})).toMatchObject({outcome: 'unchanged', seq: 2, cause: 'change'});
      expect(await setLimit(client, target.accountId, {admin, limit: 25 * M, expectedSeq: 2})).toMatchObject({outcome: 'changed', seq: 3});
      expect(await setLimit(client, target.accountId, {admin, kind: 'reset', limit: null, expectedSeq: 3})).toMatchObject({outcome: 'reset', seq: 4});
      expect(await usageEvents(client, `user:${admin.user.id}`)).toHaveLength(3);
    });
  });

  it('goes in the documented order, each outcome beating those after it', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const target = await account(client);
      const disabledTarget = await account(client);
      await disable(client, disabledTarget.accountId);
      // denied beats not_found and disabled and invalid_limit
      expect(await setLimit(client, randomUUID(), {admin: member, actor: `user:${member.user.id}`, limit: 12_345})).toMatchObject({outcome: 'denied'});
      expect(await setLimit(client, disabledTarget.accountId, {admin: member, actor: `user:${member.user.id}`, limit: 12_345})).toMatchObject({outcome: 'denied'});
      // not_found beats everything after the Account
      expect(await setLimit(client, randomUUID(), {admin, limit: 12_345, expectedSeq: 7})).toMatchObject({outcome: 'not_found'});
      // disabled beats reused, stale and invalid_limit
      expect(await setLimit(client, disabledTarget.accountId, {admin, limit: 12_345, expectedSeq: 7})).toMatchObject({outcome: 'disabled'});
      // reused beats stale and invalid_limit
      const command = randomUUID();
      await setLimit(client, target.accountId, {admin, command, limit: 40 * M, expectedSeq: 1});
      expect(await setLimit(client, target.accountId, {admin, command, limit: 12_345, expectedSeq: 7})).toMatchObject({outcome: 'reused'});
      // stale beats invalid_limit and unchanged
      expect(await setLimit(client, target.accountId, {admin, limit: 12_345, expectedSeq: 1})).toMatchObject({outcome: 'stale'});
      expect(await setLimit(client, target.accountId, {admin, limit: 40 * M, expectedSeq: 1})).toMatchObject({outcome: 'stale'});
      // invalid_limit beats unchanged (a reset given the current limit is invalid, not "unchanged")
      expect(await setLimit(client, target.accountId, {admin, kind: 'reset', limit: 40 * M, expectedSeq: 2})).toMatchObject({outcome: 'invalid_limit'});
    });
  });

  it('makes the period and its audit event in one transaction: if the audit event cannot be written, no period is left', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      await client.query(`create function public.refuse_usage_audit() returns trigger language plpgsql as $$ begin if new.action like 'usage.%' then raise exception 'the audit trail refused it' using errcode = 'P0001'; end if; return new; end $$`);
      await client.query('create trigger refuse_usage_audit before insert on identity.audit_events for each row execute function public.refuse_usage_audit()');
      const refused = await attemptSet(client, target.accountId, {admin, limit: 40 * M, expectedSeq: 1});
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.message).toContain('the audit trail refused it');
      expect(await periodsOf(client, target.accountId)).toHaveLength(1);
      await client.query('drop trigger refuse_usage_audit on identity.audit_events');
      // The same command, now that the audit trail takes it, makes both.
      expect(await setLimit(client, target.accountId, {admin, limit: 40 * M, expectedSeq: 1})).toMatchObject({outcome: 'changed', seq: 2});
      expect(await usageEvents(client, `user:${admin.user.id}`)).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the audit trail: who, what and which Account, and no amount', () => {
  it('keeps the five columns of identity.audit_events, and records the actor, the action and the Account as an opaque target, with no old or new limit', async () => {
    const {rows: columns} = await db.query(`select column_name from information_schema.columns where table_schema = 'identity' and table_name = 'audit_events' order by ordinal_position`);
    expect(columns.map((column) => column.column_name)).toEqual(['id', 'occurred_at', 'actor', 'action', 'target']);
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      await setLimit(client, target.accountId, {admin, limit: 40 * M, expectedSeq: 1});
      await setLimit(client, target.accountId, {admin, kind: 'reset', limit: null, expectedSeq: 2});
      const events = await eventsBy(client, `user:${admin.user.id}`);
      expect(events).toEqual([
        {actor: `user:${admin.user.id}`, action: 'usage.limit_changed', target: `account:${target.accountId}`, occurred_at: expect.any(Date)},
        {actor: `user:${admin.user.id}`, action: 'usage.limit_reset', target: `account:${target.accountId}`, occurred_at: expect.any(Date)},
      ]);
      const text = JSON.stringify(events.map(({actor, action, target}) => ({actor, action, target})));
      for (const amount of ['40000000', '25000000']) expect(text, amount).not.toContain(amount);
      // The period, not the audit table, holds the old and new limits and the time.
      const [, change, reset] = await periodsOf(client, target.accountId);
      expect(change).toMatchObject({limit_microdollars: 40 * M, previous_limit: 25 * M});
      expect(reset).toMatchObject({limit_microdollars: 40 * M, previous_limit: 40 * M});
      expect(change.created_at).toBeInstanceOf(Date);
      // The audit table is append-only, as it was.
      for (const sql of [`update identity.audit_events set action = 'usage.limit_reset' where actor = $1`, `delete from identity.audit_events where actor = $1`]) {
        const result = await attempt(client, null, sql, [`user:${admin.user.id}`]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code).toBe('55000');
      }
    });
  });

  it('audits nothing for an outcome that changed nothing, whichever it is', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const target = await account(client);
      const disabledTarget = await account(client);
      await disable(client, disabledTarget.accountId);
      const command = randomUUID();
      await setLimit(client, target.accountId, {admin, command, limit: 40 * M, expectedSeq: 1});
      const before = await count(client, `select count(*) as n from identity.audit_events where action like 'usage.%'`);
      for (const [name, run] of [
        ['replayed', () => setLimit(client, target.accountId, {admin, command, limit: 40 * M, expectedSeq: 1})],
        ['reused', () => setLimit(client, target.accountId, {admin, command, limit: 41 * M, expectedSeq: 1})],
        ['stale', () => setLimit(client, target.accountId, {admin, limit: 41 * M, expectedSeq: 1})],
        ['invalid_limit', () => setLimit(client, target.accountId, {admin, limit: 12_345, expectedSeq: 2})],
        ['unchanged', () => setLimit(client, target.accountId, {admin, limit: 40 * M, expectedSeq: 2})],
        ['disabled', () => setLimit(client, disabledTarget.accountId, {admin, limit: 41 * M})],
        ['not_found', () => setLimit(client, randomUUID(), {admin, limit: 41 * M})],
        ['denied', () => setLimit(client, target.accountId, {admin: member, actor: `user:${member.user.id}`, limit: 41 * M, expectedSeq: 2})],
      ] as const) {
        expect((await run()).outcome, name).toBe(name);
      }
      expect(await count(client, `select count(*) as n from identity.audit_events where action like 'usage.%'`)).toBe(before);
      // ... and a read adds none either.
      await listAs(client, admin);
      expect(await count(client, `select count(*) as n from identity.audit_events where action like 'usage.%'`)).toBe(before);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.list_usage: each Account\'s current period, for an active Administrator, and nothing else', () => {
  it('lists the current period of each Account with the address, role, status and the shown amounts, and exactly those ten fields', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const [first] = await periodsOf(client, member.accountId);
      await figures(client, first.id, 10 * M, 2 * M);
      await setLimit(client, member.accountId, {admin, limit: 40 * M, expectedSeq: 1});
      const list = await listAs(client, admin);
      expect(list.outcome).toBe('listed');
      const month = await currentMonth(client);
      expect(rowOf(list, member.accountId)).toEqual({
        account_id: member.accountId,
        email: member.user.email,
        role: 'member',
        status: 'active',
        seq: 2,
        month_start: month,
        limit_microdollars: 40 * M,
        settled_microdollars: 10 * M,
        reserved_microdollars: 2 * M,
        cause: 'change',
      });
      expect(rowOf(list, admin.accountId)).toMatchObject({email: admin.user.email, role: 'administrator', status: 'active', seq: 1, cause: 'initial', limit_microdollars: 25 * M});
      for (const entry of list.accounts ?? []) {
        expect(Object.keys(entry).sort()).toEqual(['account_id', 'cause', 'email', 'limit_microdollars', 'month_start', 'reserved_microdollars', 'role', 'seq', 'settled_microdollars', 'status']);
        for (const key of ['seq', 'limit_microdollars', 'settled_microdollars', 'reserved_microdollars']) expect(Number.isSafeInteger(entry[key]), key).toBe(true);
      }
    });
  });

  it('lists in the order of api.list_accounts, newest first, at most 200', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const listed = await listAs(client, admin);
      const accounts = (await rows(client, 'service_role', 'select account_id from api.list_accounts()')).map((row) => row.account_id as string);
      const usage = (listed.accounts ?? []).map((entry) => entry.account_id as string);
      // (Another connection may add an Account between the two reads: compare the Accounts both lists hold, in order.)
      const common = usage.filter((id) => accounts.includes(id));
      expect(common).toEqual(accounts.filter((id) => usage.includes(id)));
      expect(usage.length).toBeLessThanOrEqual(200);
      expect(Math.abs(usage.length - accounts.length)).toBeLessThanOrEqual(1);
    });
  });

  it('never lists more than 200 Accounts, and the 200 are the newest', { timeout: 120_000 }, async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const ids: string[] = [];
      for (let index = 0; index < 201; index += 1) {
        const user = await insertAuthUser(client);
        const created = await client.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject]);
        ids.push(created.rows[0].id as string);
      }
      const listed = await listAs(client, admin);
      expect(listed.accounts).toHaveLength(200);
      const listedIds = (listed.accounts ?? []).map((entry) => entry.account_id as string);
      expect(new Set(listedIds).size).toBe(200);
      // The same 200, in the same order, as the Accounts list shows (another connection may add an Account between the two reads: compare what both hold).
      const accounts = (await rows(client, 'service_role', 'select account_id from api.list_accounts()')).map((row) => row.account_id as string);
      expect(accounts).toHaveLength(200);
      expect(listedIds.filter((id) => accounts.includes(id))).toEqual(accounts.filter((id) => listedIds.includes(id)));
      expect(ids).toHaveLength(201);
    });
  });

  it('includes disabled Accounts, whose usage stays readable, with their status', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const [first] = await periodsOf(client, member.accountId);
      await figures(client, first.id, 25 * M, 0);
      expect(await disable(client, member.accountId)).toBe('disabled');
      expect(rowOf(await listAs(client, admin), member.accountId)).toMatchObject({status: 'disabled', limit_microdollars: 25 * M, settled_microdollars: 25 * M, reserved_microdollars: 0, seq: 1});
    });
  });

  it('gives an Account that has no period its `initial` one, and reads nothing it did not roll first', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      await client.query('delete from usage.periods where account_id = any($1)', [[member.accountId]]);
      expect(rowOf(await listAs(client, admin), member.accountId)).toMatchObject({seq: 1, cause: 'initial', limit_microdollars: 25 * M, settled_microdollars: 0, reserved_microdollars: 0});
      expect(await periodsOf(client, member.accountId)).toHaveLength(1);
    });
  });

  it('shows no address for an Account whose Auth user no longer vouches for one', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      await client.query(`update auth.users set email_confirmed_at = null where id = $1`, [member.user.id]);
      expect(rowOf(await listAs(client, admin), member.accountId)).toMatchObject({email: null, role: 'member'});
    });
  });

  it('answers `denied`, with nothing listed, for a member, a stale epoch, a disabled Administrator, a tombstoned one and an Account that does not exist', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      expect(await listAs(client, member)).toEqual({outcome: 'denied', accounts: null});
      expect(await listAs(client, admin, admin.epoch + 1)).toEqual({outcome: 'denied', accounts: null});
      expect(await listAs(client, {...admin, accountId: randomUUID()})).toEqual({outcome: 'denied', accounts: null});
      const second = await account(client, 'administrator');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [second.accountId]);
      const raised = await epochOf(client, second.accountId);
      for (const epoch of [second.epoch, raised]) expect(await listAs(client, second, epoch), String(epoch)).toEqual({outcome: 'denied', accounts: null});
      const third = await account(client, 'administrator');
      await tombstone(client, third.accountId);
      for (const epoch of [third.epoch, await epochOf(client, third.accountId)]) expect(await listAs(client, third, epoch), String(epoch)).toEqual({outcome: 'denied', accounts: null});
      // A denied read changed nothing: it did not roll any month over.
      const aged = await account(client);
      await replacePeriods(client, aged.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M, cause: 'initial'}]);
      await listAs(client, member);
      await listAs(client, admin, admin.epoch + 1);
      expect(await periodsOf(client, aged.accountId)).toHaveLength(1);
    });
  });

  it('refuses a shape the application would never send as an invalid argument', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      for (const params of [[null, 1], [admin.accountId, null], [admin.accountId, 0], [admin.accountId, -1]]) {
        const result = await attempt(client, 'service_role', 'select * from api.list_usage($1, $2)', params);
        expect(result.ok, JSON.stringify(params)).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('refusing a change is audited (api.record_usage_refusal)', () => {
  const call = 'select outcome from api.record_usage_refusal($1, $2, $3)';

  it('accepts each of the two refusals from exactly one of the two roles', async () => {
    await inTx(async (client) => {
      const member = await account(client);
      const admin = await account(client, 'administrator');
      const accepted: string[] = [];
      for (const action of ['usage.limit_refused', 'usage.denied']) {
        for (const who of [member, admin]) {
          const result = await attempt(client, 'service_role', call, [who.user.id, action, null]);
          if (result.ok) accepted.push(`${action}:${who === admin ? 'administrator' : 'member'}`);
          else expect(result.code).toBe('22023');
        }
      }
      expect(accepted.sort()).toEqual(['usage.denied:member', 'usage.limit_refused:administrator']);
    });
  });

  it.each([
    ['an action that is not a refusal', 'usage.limit_changed'],
    ['another family of refusals', 'account.denied'],
    ['a different spelling', 'Usage.Denied'],
    ['an empty action', ''],
    ['text that is no action', "usage.denied'; delete from identity.audit_events"],
    ['no action', null],
  ])('refuses %s as an invalid argument, and writes nothing', async (_name, action) => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      const result = await attempt(client, 'service_role', call, [admin.user.id, action, null]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before);
    });
  });

  it('refuses a missing user, an Auth user with no Account, and a user that does not exist', async () => {
    await inTx(async (client) => {
      const stranger = await addUser(client);
      for (const user of [null, randomUUID(), stranger.id]) {
        const result = await attempt(client, 'service_role', call, [user, 'usage.denied', null]);
        expect(result.ok, String(user)).toBe(false);
        if (!result.ok) expect(result.code, String(user)).toBe('22023');
      }
    });
  });

  it('records the actor and the Account the attempt named, as an opaque target, and only if that Account exists, with no content', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      expect((await client.query(call, [admin.user.id, 'usage.limit_refused', target.accountId])).rows[0].outcome).toBe('recorded');
      expect((await client.query(call, [admin.user.id, 'usage.limit_refused', randomUUID()])).rows[0].outcome).toBe('recorded');
      const events = await eventsBy(client, `user:${admin.user.id}`);
      expect(events.map((event) => [event.action, event.target])).toEqual([
        ['usage.limit_refused', `account:${target.accountId}`],
        ['usage.limit_refused', null],
      ]);
      expect(JSON.stringify(events.map(({actor, action, target}) => ({actor, action, target})))).not.toContain(admin.user.email);
      // The five columns hold it all: nothing was added to the table for this.
      expect(Object.keys(events[0]).sort()).toEqual(['action', 'actor', 'occurred_at', 'target']);
      // ... and writes no period and no figure.
      expect(await periodsOf(client, target.accountId)).toHaveLength(1);
    });
  });

  it('is once an hour for one actor, one action and one target, and again after the hour', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const [one, two] = [await account(client), await account(client)];
      const outcomes: string[] = [];
      for (const [action, target] of [
        ['usage.limit_refused', one.accountId],
        ['usage.limit_refused', one.accountId],
        ['usage.limit_refused', two.accountId],
        ['usage.limit_refused', null],
        ['usage.limit_refused', null],
      ] as const) outcomes.push((await client.query(call, [admin.user.id, action, target])).rows[0].outcome);
      expect(outcomes).toEqual(['recorded', 'repeated', 'recorded', 'recorded', 'repeated']);
      expect(await eventsBy(client, `user:${admin.user.id}`, 'usage.limit_refused')).toHaveLength(3);
      const member = await account(client);
      expect((await client.query(call, [member.user.id, 'usage.denied', one.accountId])).rows[0].outcome).toBe('recorded');
      expect((await client.query(call, [member.user.id, 'usage.denied', one.accountId])).rows[0].outcome).toBe('repeated');

      const other = await account(client, 'administrator');
      await client.query(`insert into identity.audit_events (occurred_at, actor, action) values (clock_timestamp() - interval '61 minutes', $1, 'usage.limit_refused')`, [`user:${other.user.id}`]);
      expect((await client.query(call, [other.user.id, 'usage.limit_refused', null])).rows[0].outcome).toBe('recorded');
      await client.query(`insert into identity.audit_events (occurred_at, actor, action) values (clock_timestamp() - interval '59 minutes', $1, 'usage.limit_refused')`, [`user:${other.user.id}`]);
      expect((await client.query(call, [other.user.id, 'usage.limit_refused', null])).rows[0].outcome).toBe('repeated');
    });
  });

  it('is not the Accounts page\'s refusal: it neither records nor deduplicates against account.* events', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const target = await account(client);
      await rows(client, 'service_role', 'select * from api.record_account_refusal($1, $2, $3)', [admin.user.id, 'account.disable_refused', target.accountId]);
      expect((await client.query(call, [admin.user.id, 'usage.limit_refused', target.accountId])).rows[0].outcome).toBe('recorded');
      expect((await eventsBy(client, `user:${admin.user.id}`)).map((event) => event.action).sort()).toEqual(['account.disable_refused', 'usage.limit_refused']);
    });
  });

  it('is exactly once when many refusals arrive at the same moment (real connections)', async () => {
    const admin = await committedAccount('administrator');
    const target = await committedAccount();
    const clients = await Promise.all(Array.from({length: 8}, () => connect()));
    const answers = await Promise.all(clients.map((client) => client.query(call, [admin.user.id, 'usage.limit_refused', target.accountId])));
    const outcomes = answers.map((answer) => answer.rows[0].outcome);
    expect(outcomes.filter((outcome) => outcome === 'recorded')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'repeated')).toHaveLength(7);
    expect(await eventsBy(db, `user:${admin.user.id}`, 'usage.limit_refused')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('real connections: one command at a time for an Account, under the advisory lock', () => {
  it('makes one period and one replay when the same command arrives twice at once', async () => {
    const admin = await committedAccount('administrator');
    const target = await committedAccount();
    const [one, two, three] = await Promise.all([connect(), connect(), connect()]);
    const command = randomUUID();
    const args = [`user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, command, 'change', 40 * M, 1];
    const answers = await Promise.all([one, two, three].map((client) => client.query(SET, args)));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['changed', 'replayed', 'replayed']);
    const ids = new Set(answers.map((answer) => answer.rows[0].period_id));
    expect(ids.size).toBe(1);
    expect((await periodsOf(db, target.accountId)).map((p) => [p.seq, p.cause])).toEqual([[1, 'initial'], [2, 'change']]);
    expect(await usageEvents(db, `user:${admin.user.id}`)).toHaveLength(1);
  });

  it('makes one change and one `stale` when two different commands are made against the same period', async () => {
    const admin = await committedAccount('administrator');
    const target = await committedAccount();
    const [one, two] = await Promise.all([connect(), connect()]);
    const make = (limit: number) => [`user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), 'change', limit, 1];
    const answers = await Promise.all([one.query(SET, make(30 * M)), two.query(SET, make(35 * M))]);
    const outcomes = answers.map((answer) => answer.rows[0].outcome).sort();
    expect(outcomes).toEqual(['changed', 'stale']);
    const periods = await periodsOf(db, target.accountId);
    expect(periods.map((p) => p.seq)).toEqual([1, 2]);
    const won = answers.find((answer) => answer.rows[0].outcome === 'changed')!.rows[0];
    const lost = answers.find((answer) => answer.rows[0].outcome === 'stale')!.rows[0];
    expect(periods[1].limit_microdollars).toBe(won.limit_microdollars);
    // The loser is told the current seq, which is the winner's.
    expect(lost.seq).toBe(2);
    expect(lost.limit_microdollars).toBe(won.limit_microdollars);
    expect(await usageEvents(db, `user:${admin.user.id}`)).toHaveLength(1);
  });

  it('serializes a change and a reset of the same period: both can never be seq 2', async () => {
    const admin = await committedAccount('administrator');
    const target = await committedAccount();
    const [one, two] = await Promise.all([connect(), connect()]);
    const make = (kind: string, limit: number | null) => [`user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), kind, limit, 1];
    const answers = await Promise.all([one.query(SET, make('change', 30 * M)), two.query(SET, make('reset', null))]);
    const outcomes = answers.map((answer) => answer.rows[0].outcome as string);
    expect(outcomes.filter((outcome) => outcome === 'stale')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'changed' || outcome === 'reset')).toHaveLength(1);
    expect((await periodsOf(db, target.accountId)).map((p) => p.seq)).toEqual([1, 2]);
  });

  it('is one winner every time when a disable and a change start together: the change commits first and the Account is then disabled, or the change is told `disabled`', async () => {
    const admin = await committedAccount('administrator');
    const seen = new Set<string>();
    for (let round = 0; round < 6; round += 1) {
      const target = await committedAccount();
      const [one, two] = await Promise.all([connect(), connect()]);
      const [changed, disabled] = await Promise.all([
        one.query(SET, [`user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), 'change', 40 * M, 1]),
        two.query(`select outcome from api.disable_account('seed:local:usage', $1)`, [target.accountId]),
      ]);
      expect(disabled.rows[0].outcome).toBe('disabled');
      expect(await statusOf(db, target.accountId)).toBe('disabled');
      const outcome = changed.rows[0].outcome as string;
      seen.add(outcome);
      expect(['changed', 'disabled']).toContain(outcome);
      // Either the change committed (and the period is there, with its audit event) or nothing was appended.
      expect((await periodsOf(db, target.accountId)).length).toBe(outcome === 'changed' ? 2 : 1);
      // And once disabled, the next command is refused.
      expect((await db.query(SET, [`user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), 'change', 41 * M, outcome === 'changed' ? 2 : 1])).rows[0].outcome).toBe('disabled');
    }
    expect([...seen].every((outcome) => outcome === 'changed' || outcome === 'disabled')).toBe(true);
  });

  it('adds exactly one `month` period when two readers meet a new month together', async () => {
    const admin = await committedAccount('administrator');
    const target = await committedAccount();
    await replacePeriods(db, target.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M, cause: 'initial'}]);
    const [one, two, three] = await Promise.all([connect(), connect(), connect()]);
    await Promise.all([
      one.query('select outcome from api.list_usage($1, $2)', [admin.accountId, admin.epoch]),
      two.query('select outcome from api.list_usage($1, $2)', [admin.accountId, admin.epoch]),
      three.query('select usage.available_microdollars($1)', [target.accountId]),
    ]);
    expect((await periodsOf(db, target.accountId)).map((p) => [p.seq, p.cause])).toEqual([[1, 'initial'], [2, 'month']]);
  });

  it('waits for the Account\'s advisory lock `nova3d:usage:<account>` (the lock Story 2.6 reuses) and answers once it is released', async () => {
    const admin = await committedAccount('administrator');
    const target = await committedAccount();
    const holder = await connect();
    const caller = await connect();
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d:usage:' || $1::text, 0))`, [target.accountId]);
    const { rows: pid } = await caller.query('select pg_backend_pid() as pid');
    const running = caller.query(SET, [`user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), 'change', 40 * M, 1]);
    let blocked = false;
    for (let attemptNumber = 0; attemptNumber < 100 && !blocked; attemptNumber += 1) {
      const { rows: found } = await db.query(`select wait_event_type, wait_event from pg_stat_activity where pid = $1`, [pid[0].pid]);
      blocked = found[0]?.wait_event_type === 'Lock' && found[0]?.wait_event === 'advisory';
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(blocked, 'the command waits for the Account\'s advisory lock').toBe(true);
    await holder.query('commit');
    expect((await running).rows[0].outcome).toBe('changed');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('disabling an Account at its limit behaves as before, and its usage stays readable', () => {
  it('disables and re-enables an Account that has reached its limit exactly as for any other, with its reservation and settled amounts untouched', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const [first] = await periodsOf(client, member.accountId);
      await figures(client, first.id, 20 * M, 5 * M);
      const before = await periodsOf(client, member.accountId);
      const disabled = (await rows(client, 'service_role', 'select outcome, sessions_ended, grants_revoked, epoch::int as epoch from api.disable_account($1, $2)', ['seed:local:usage', member.accountId]))[0];
      expect(disabled).toMatchObject({outcome: 'disabled', epoch: member.epoch + 1});
      expect(await statusOf(client, member.accountId)).toBe('disabled');
      // Usage is untouched by it, and readable.
      expect(await periodsOf(client, member.accountId)).toEqual(before);
      expect(rowOf(await listAs(client, admin), member.accountId)).toMatchObject({status: 'disabled', limit_microdollars: 25 * M, settled_microdollars: 20 * M, reserved_microdollars: 5 * M});
      expect(await availableOf(client, member.accountId)).toBe(0);
      expect((await rows(client, 'service_role', `select outcome from api.enable_account('seed:local:usage', $1)`, [member.accountId]))[0].outcome).toBe('enabled');
      expect(await periodsOf(client, member.accountId)).toEqual(before);
    });
  });

  it('adds nothing to what api.disable_account does: it never touches usage.periods', async () => {
    const definition = (await db.query(`select pg_get_functiondef('api.disable_account(text,uuid)'::regprocedure) as text`)).rows[0].text as string;
    expect(definition).not.toMatch(/usage\./);
    const enable = (await db.query(`select pg_get_functiondef('api.enable_account(text,uuid)'::regprocedure) as text`)).rows[0].text as string;
    expect(enable).not.toMatch(/usage\./);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls of lib/usage.ts against the real database', () => {
  it('reads the list, makes a change and a reset, replays one, and records a refusal, as the application does over REST', async () => {
    const admin = await committedAccount('administrator');
    const target = await committedAccount();
    const operation = {accountId: admin.accountId, epoch: admin.epoch};
    const listed = await listUsage(operation, {env});
    expect(listed.outcome).toBe('listed');
    if (listed.outcome !== 'listed') return;
    const mine = listed.rows.find((row) => row.accountId === target.accountId);
    expect(mine).toEqual({accountId: target.accountId, email: target.user.email, role: 'member', status: 'active', seq: 1, monthStart: await currentMonth(db), limit: 25 * M, settled: 0, reserved: 0, cause: 'initial'});

    const command = randomUUID();
    const input = {actor: `user:${admin.user.id}`, targetAccountId: target.accountId, commandId: command, kind: 'change' as const, limit: 40 * M, expectedSeq: 1};
    expect(await setUsageLimit(operation, input, {env})).toEqual({outcome: 'changed', period: {seq: 2, monthStart: await currentMonth(db), limit: 40 * M, previousLimit: 25 * M, cause: 'change'}});
    expect(await setUsageLimit(operation, input, {env})).toMatchObject({outcome: 'replayed', period: {seq: 2, limit: 40 * M}});
    expect(await setUsageLimit(operation, {...input, commandId: randomUUID(), limit: 40 * M, expectedSeq: 2}, {env})).toMatchObject({outcome: 'unchanged', period: {seq: 2}});
    expect(await setUsageLimit(operation, {...input, commandId: randomUUID(), expectedSeq: 1}, {env})).toMatchObject({outcome: 'stale', period: {seq: 2, limit: 40 * M}});
    expect(await setUsageLimit(operation, {...input, commandId: randomUUID(), limit: 12_345, expectedSeq: 2}, {env})).toEqual({outcome: 'invalid_limit'});
    expect(await setUsageLimit(operation, {...input, limit: 50 * M, expectedSeq: 2}, {env})).toEqual({outcome: 'reused'});
    expect(await setUsageLimit(operation, {...input, commandId: randomUUID(), kind: 'reset', limit: null, expectedSeq: 2}, {env})).toEqual({
      outcome: 'reset',
      period: {seq: 3, monthStart: await currentMonth(db), limit: 40 * M, previousLimit: 40 * M, cause: 'reset'},
    });
    expect(await setUsageLimit(operation, {...input, commandId: randomUUID(), targetAccountId: randomUUID(), expectedSeq: 1}, {env})).toEqual({outcome: 'not_found'});
    expect(await setUsageLimit({accountId: target.accountId, epoch: target.epoch}, {...input, commandId: randomUUID(), expectedSeq: 3, limit: 41 * M}, {env})).toEqual({outcome: 'denied'});
    expect(await listUsage({accountId: target.accountId, epoch: target.epoch}, {env})).toEqual({outcome: 'denied'});

    expect(await recordUsageRefusal({userId: admin.user.id, action: 'usage.limit_refused', accountId: target.accountId}, {env})).toBe('recorded');
    expect(await recordUsageRefusal({userId: admin.user.id, action: 'usage.limit_refused', accountId: target.accountId}, {env})).toBe('repeated');
    expect(await recordUsageRefusal({userId: target.user.id, action: 'usage.denied', accountId: target.accountId}, {env})).toBe('recorded');

    expect((await usageEvents(db, `user:${admin.user.id}`)).map((event) => event.action)).toEqual(['usage.limit_changed', 'usage.limit_reset', 'usage.limit_refused']);
    const after = await listUsage(operation, {env});
    expect(after.outcome === 'listed' && after.rows.find((row) => row.accountId === target.accountId)).toMatchObject({seq: 3, limit: 40 * M, cause: 'reset'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries the Story 2.4 tables and functions', () => {
  const apiSignatures = ['api.set_usage_limit(text,uuid,bigint,uuid,uuid,text,bigint,integer)', 'api.list_usage(uuid,bigint)', 'api.record_usage_refusal(uuid,text,uuid)'];
  const internalSignatures = ['usage.ensure_period(uuid)', 'usage.period_figures(uuid)', 'usage.available_microdollars(uuid)', 'usage.default_limit(text)'];

  it('answers ok to the service role, reads the two tables and their columns, and looks for the seven functions', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [
      'usage.periods', 'usage.fixture_figures', 'u.carried_settled_microdollars', 'u.command_id', 'u.digest', 'x2.period_id', 'x2.settled_microdollars',
      ...apiSignatures,
      ...internalSignatures,
      'Story 2.4 migration',
      // Every earlier probe is still there.
      'Story 1.5 migration', 'Story 2.12 migration', 'lifecycle.heartbeats', 'private-files',
    ]) expect(definition, needle).toContain(needle);
    // The three new `api` functions are among those the service role must be able to execute (forty-one in all).
    const check = definition.indexOf('where not has_function_privilege');
    const executable = definition.slice(definition.lastIndexOf('unnest(array[', check), check);
    expect(executable.match(/'api\.[a-z_]+\([^']*\)'/g)).toHaveLength(41);
    for (const signature of apiSignatures) expect(executable, signature).toContain(`'${signature}'`);
    // The bucket check stays last.
    expect(definition.indexOf('private-files')).toBeGreaterThan(definition.indexOf('delete Auth identities'));
  });

  it.each([...apiSignatures, ...internalSignatures])('fails the build with one line naming %s when it is missing, and says which migration is not applied', async (signature) => {
    await inTx(async (client) => {
      const spec = (await client.query(`select to_regprocedure($1)::text as name`, [signature])).rows[0].name;
      await client.query(`drop function ${spec} cascade`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain(signature);
        expect(result.message).toContain('Story 2.4');
      }
    });
  });

  it.each(apiSignatures.map((signature) => [signature, signature.replace(/,/g, ', ')]))('fails when the service role cannot execute %s', async (signature, spaced) => {
    await inTx(async (client) => {
      await client.query(`revoke execute on function ${spaced} from service_role`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(signature);
      }
    });
  });

  it.each(['usage.periods', 'usage.fixture_figures'])('fails, naming a permission and not answering ok, when the role it runs as cannot read %s', async (blocked) => {
    const everything = [
      'identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts',
      'artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance', 'artifacts.retained_pictures',
      'lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats', 'usage.periods', 'usage.fixture_figures',
      'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
    ];
    await inTx(async (client) => {
      await client.query('grant usage on schema api, identity, projects, lifecycle, artifacts, usage to anon');
      await client.query('grant create on schema api to anon');
      for (const table of everything.filter((name) => name !== blocked)) await client.query(`grant select on ${table} to anon`);
      await client.query('alter function api.preflight() owner to anon');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok, `${blocked} unreadable`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(blocked.split('.')[1]);
      }
    });
  });
});
