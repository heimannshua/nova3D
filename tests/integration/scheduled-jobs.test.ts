import {createHmac, randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {Client} from 'pg';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {handleJobRequest} from '@/lib/jobs';
import {createFixtureLedgerStore} from '@/lib/ledger-fixture';
import {verifyChain} from '@/lib/ledger';
import {claimJobRun, finishJobRun, lastJobRun, ledgerPending, purgeDormantIdentities} from '@/lib/lifecycle';
import {codeHash, createHarness, originHash, stack, tag} from '../support/accounts-db';
import {signedCall, testSigningKeys} from '../support/qstash-signature';
import {jwtSecretOf, stackEnvironment} from '../support/stack';

// Story 1.9 against the Supabase CLI stack: the immutable receipts and the claim that serializes them, the dormant-identity purge and the lock
// it shares with registration, the registration outcome `no_identity`, the closure of every new object, the preflight, the typed calls and the
// route end to end with a signed call. Most cases run inside a transaction that is rolled back, as the service role. The cases that need
// several real connections (the claim races, the purge against a registration in flight) commit unique data and remove what they can.
//
// Receipts are append-only (no delete, no truncate), so what a committed case writes STAYS, like the audit trail and the outbox. Every case
// therefore asserts on its own schedule and message IDs, never on a global count. The purge is global, so a case that commits it deletes only
// identities that are dormant: its own, back-dated, and whatever dormant debris the local stack happens to hold.

const {db, connect, committed, cleanup, inTx, addUser, attempt, rows, api, count, invitationStatus, failuresOf} = createHarness();

/** Connections a case opened: whatever it left open (a failed assertion between a begin and a commit) is rolled back, so it cannot hold a lock for the next case. */
const tracked: Client[] = [];
const track = async () => {
  const client = await connect();
  tracked.push(client);
  return client;
};
afterEach(async () => {
  await Promise.allSettled(tracked.map((client) => client.query('rollback')));
  tracked.length = 0;
});

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});
afterAll(async () => {
  await db.query('update lifecycle.ledger_relay set holder = null, lease_expires_at = null');
});

const svc = async (client: Client, sql: string, params: unknown[] = []) => (await rows(client, 'service_role', sql, params))[0];
const fresh = () => ({schedule: `scd_${randomUUID()}`, message: `msg_${randomUUID()}`});
const claim = (client: Client, task: string, key: {schedule: string; message: string}, lease?: number) =>
  svc(client, 'select outcome, receipt_id, attempt from api.claim_job_run($1, $2, $3, $4)', [task, key.schedule, key.message, lease ?? 300]);
const finish = (client: Client, receiptId: string, outcome: string, result: unknown = {}) =>
  svc(client, 'select outcome from api.finish_job_run($1, $2, $3)', [receiptId, outcome, JSON.stringify(result)]);
const receiptsOf = async (client: Client, key: {schedule: string; message: string}) =>
  (await client.query('select task, attempt, finished_at, outcome, result from lifecycle.job_receipts where schedule_id = $1 and message_id = $2 order by attempt', [key.schedule, key.message])).rows as {
    task: string;
    attempt: number;
    finished_at: Date | null;
    outcome: string | null;
    result: Record<string, unknown> | null;
  }[];
const purge = (client: Client, limit = 500) => svc(client, 'select deleted, kept, locked, remaining from api.purge_dormant_identities($1)', [limit]);
/** The same call outside a transaction (it commits on its own), for the cases that run on a connection that has none open. */
const purgeNow = async (client: Client, limit = 500) => (await client.query('select deleted, kept, locked, remaining from api.purge_dormant_identities($1)', [limit])).rows[0] as {deleted: number; kept: number; locked: number; remaining: number};
const claimNow = async (client: Client, task: string, key: {schedule: string; message: string}) =>
  (await client.query('select outcome, receipt_id, attempt from api.claim_job_run($1, $2, $3, 300)', [task, key.schedule, key.message])).rows[0] as {outcome: string; receipt_id: string; attempt: number};
const userExists = async (client: Client, id: string) => (await count(client, 'select count(*) as n from auth.users where id = $1', [id])) === 1;

/** Commits the work on this client, or rolls it back if it throws. */
async function committedTx<T>(client: Client, work: () => Promise<T>) {
  await client.query('begin');
  try {
    const result = await work();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function waitingOnLock(pid: number) {
  for (let tries = 0; tries < 100; tries += 1) {
    const {rows: waiting} = await db.query('select wait_event_type as type, wait_event as event from pg_stat_activity where pid = $1', [pid]);
    if (waiting[0]?.type === 'Lock') return waiting[0].event as string;
    await sleep(50);
  }
  throw new Error('The other connection never started waiting for the lock.');
}
async function untilSleeping(pid: number) {
  for (let tries = 0; tries < 200; tries += 1) {
    const {rows: waiting} = await db.query('select wait_event as event from pg_stat_activity where pid = $1', [pid]);
    if (waiting[0]?.event === 'PgSleep') return;
    await sleep(25);
  }
  throw new Error('The purge never reached the pause.');
}
const pidOf = async (client: Client) => Number((await client.query('select pg_backend_pid() as pid')).rows[0].pid);

/**
 * An Auth identity as GoTrue leaves it after a Google sign-in, aged as the case needs. `created`, `signedIn` and `attempted` are how long ago
 * (a Postgres interval, such as '40 days'); `signedIn: null` is a user who never signed in (`last_sign_in_at` is NULL), `attempted: null` one who never
 * tried to register. `account` gives it an Account and a Workspace, made the way registration makes them.
 */
async function identityAged(client: Client, options: {created?: string; signedIn?: string | null; attempted?: string | null; account?: boolean; commit?: boolean} = {}) {
  const user = await addUser(client);
  if (options.commit) committed.users.push(user.id);
  await client.query(
    `update auth.users set created_at = now() - $2::interval, last_sign_in_at = case when $3::text is null then null else now() - $3::interval end where id = $1`,
    [user.id, options.created ?? '40 days', options.signedIn ?? null],
  );
  if (options.attempted) await client.query(`insert into identity.registration_attempts (user_id, last_attempt_at) values ($1, now() - $2::interval)`, [user.id, options.attempted]);
  let accountId: string | null = null;
  if (options.account) accountId = (await client.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject])).rows[0].id as string;
  return {...user, accountId};
}
/** A named invitation code, committed, for a registration that really commits. */
async function codeCommitted() {
  const hash = codeHash();
  committed.hashes.push(hash);
  await committedTx(db, () => api(db).issue(hash, 'named', 'Scheduled jobs test'));
  return hash;
}
const orphans = async (client: Client) =>
  (await client.query(
    `select (select count(*)::int from identity.accounts a where not exists (select 1 from auth.users u where u.id = a.user_id)) as accounts,
            (select count(*)::int from projects.workspaces w where not exists (select 1 from identity.accounts a where a.id = w.account_id)) as workspaces`,
  )).rows[0] as {accounts: number; workspaces: number};

// ---------------------------------------------------------------------------------------------------
describe('the receipts table', () => {
  it('has the columns of the contract and nothing else: id, task, schedule ID, message ID, attempt, start, finish, outcome and a result', async () => {
    const {rows: columns} = await db.query(`select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'lifecycle' and table_name = 'job_receipts' order by ordinal_position`);
    expect(columns.map((column) => [column.column_name, column.data_type, column.is_nullable])).toEqual([
      ['id', 'uuid', 'NO'],
      ['task', 'text', 'NO'],
      ['schedule_id', 'text', 'NO'],
      ['message_id', 'text', 'NO'],
      ['attempt', 'integer', 'NO'],
      ['started_at', 'timestamp with time zone', 'NO'],
      ['finished_at', 'timestamp with time zone', 'YES'],
      ['outcome', 'text', 'YES'],
      ['result', 'json', 'YES'],
    ]);
  });

  it('is unique per schedule ID, message ID and attempt', async () => {
    await inTx(async (client) => {
      const key = fresh();
      await client.query(`insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt) values ('ledger-relay', $1, $2, 1)`, [key.schedule, key.message]);
      const again = await attempt(client, null, `insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt) values ('ledger-relay', $1, $2, 1)`, [key.schedule, key.message]);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.code).toBe('23505');
      const next = await attempt(client, null, `insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt) values ('ledger-relay', $1, $2, 2)`, [key.schedule, key.message]);
      expect(next.ok).toBe(true);
    });
  });

  it.each([
    ['a task that is not an ID', `('Ledger Relay', 'scd_1', 'msg_1', 1)`],
    ['a schedule ID with a space', `('ledger-relay', 'scd 1', 'msg_1', 1)`],
    ['a message ID that is empty', `('ledger-relay', 'scd_1', '', 1)`],
    ['a message ID that is far too long', `('ledger-relay', 'scd_1', '${'m'.repeat(129)}', 1)`],
    ['an attempt of 0', `('ledger-relay', 'scd_1', 'msg_1', 0)`],
  ])('refuses %s', async (_name, values) => {
    await inTx(async (client) => {
      const result = await attempt(client, null, `insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt) values ${values}`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('23514');
    });
  });

  it('keeps the outcome, the finish time and the result together: all three or none', async () => {
    await inTx(async (client) => {
      for (const sql of [
        `insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt, finished_at) values ('ledger-relay', 'scd_a', 'msg_a', 1, now())`,
        `insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt, outcome) values ('ledger-relay', 'scd_b', 'msg_b', 1, 'ran')`,
        `insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt, result) values ('ledger-relay', 'scd_c', 'msg_c', 1, '{}')`,
        `insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt, finished_at, outcome, result) values ('ledger-relay', 'scd_d', 'msg_d', 1, now(), 'done', '{}')`,
      ]) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('23514');
      }
    });
  });

  it('is immutable apart from being finished once: no other column changes, a finished receipt never changes, a finish is never undone', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const { receipt_id: id } = await claim(client, 'ledger-relay', key);
      for (const sql of [
        `update lifecycle.job_receipts set task = 'dormant-identity-purge' where id = $1`,
        `update lifecycle.job_receipts set schedule_id = 'scd_other' where id = $1`,
        `update lifecycle.job_receipts set message_id = 'msg_other' where id = $1`,
        `update lifecycle.job_receipts set attempt = 9 where id = $1`,
        `update lifecycle.job_receipts set started_at = started_at - interval '1 day' where id = $1`,
        `update lifecycle.job_receipts set id = gen_random_uuid() where id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [id]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      // Finishing is the one change, and only once.
      expect((await attempt(client, null, `update lifecycle.job_receipts set finished_at = now(), outcome = 'ran', result = '{"n":1}' where id = $1`, [id])).ok).toBe(true);
      for (const sql of [
        `update lifecycle.job_receipts set outcome = 'failed' where id = $1`,
        `update lifecycle.job_receipts set result = '{"n":2}' where id = $1`,
        `update lifecycle.job_receipts set finished_at = now() where id = $1`,
        `update lifecycle.job_receipts set finished_at = null, outcome = null, result = null where id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [id]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      expect((await receiptsOf(client, key))[0]).toMatchObject({outcome: 'ran', result: {n: 1}});
    });
  });

  it('cannot be deleted from or truncated, not even by its owner', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const { receipt_id: id } = await claim(client, 'ledger-relay', key);
      for (const sql of [`delete from lifecycle.job_receipts where id = $1`, `delete from lifecycle.job_receipts`, `truncate lifecycle.job_receipts`, `truncate lifecycle.job_receipts cascade`]) {
        const result = await attempt(client, null, sql, sql.includes('$1') ? [id] : []);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      expect(await receiptsOf(client, key)).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('what a result may hold (lifecycle.job_result_ok)', () => {
  const accepts = async (result: string) => (await db.query(`select lifecycle.job_result_ok($1::json) as ok`, [result])).rows[0].ok as boolean;

  it('accepts counts, booleans and single words, in an object of at most 1 KB', async () => {
    for (const result of ['{}', '{"pending":0}', '{"deleted":4,"kept":2,"locked":1,"remaining":9}', '{"outcome":"store_unavailable","claimed":3}', '{"error_class":"TypeError"}', '{"ok":true}', '{"count":999999999999}']) {
      expect(await accepts(result), result).toBe(true);
    }
  });

  it('refuses an address, an ID, a key, a message, a nested value, a list, a fraction, a negative or huge number, a bad name, null and a non-object', async () => {
    for (const result of [
      '{"address":"someone@example.test"}',
      `{"id":"${randomUUID()}"}`,
      `{"key":"${['sk', 'live', '4eC39HqLyjWDarjtT1zdp7dc'].join('_')}"}`,
      '{"message":"Something went wrong here"}',
      '{"nested":{"a":1}}',
      '{"list":[1]}',
      '{"fraction":1.5}',
      '{"negative":-1}',
      '{"big":1000000000000}',
      '{"Upper":1}',
      '{"has space":1}',
      '{"empty":""}',
      '{"nothing":null}',
      `{"${'k'.repeat(40)}":1}`,
      `{"word":"${'x'.repeat(40)}"}`,
      `{${Array.from({length: 80}, (_, index) => `"key_${index}":999999999999`).join(',')}}`,
      'null',
      '[]',
      '1',
      '"text"',
    ]) {
      expect(await accepts(result), result.slice(0, 50)).toBe(false);
    }
    expect((await db.query(`select lifecycle.job_result_ok(null) as ok`)).rows[0].ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.claim_job_run', () => {
  it('claims the first attempt of a message, writing an unfinished receipt before anything runs', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const first = await claim(client, 'ledger-relay', key);
      expect(first).toMatchObject({outcome: 'claimed', attempt: 1});
      expect(first.receipt_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(await receiptsOf(client, key)).toEqual([expect.objectContaining({task: 'ledger-relay', attempt: 1, finished_at: null, outcome: null, result: null})]);
    });
  });

  it('answers `running`, with the same receipt, for the same message while it is unfinished and inside its lease, and writes no row', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const first = await claim(client, 'ledger-relay', key);
      const second = await claim(client, 'ledger-relay', key);
      expect(second).toEqual({outcome: 'running', receipt_id: first.receipt_id, attempt: 1});
      expect(await receiptsOf(client, key)).toHaveLength(1);
    });
  });

  it('answers `duplicate`, nothing else written, once the latest attempt finished with ran, idle or no_store', async () => {
    await inTx(async (client) => {
      for (const outcome of ['ran', 'idle', 'no_store']) {
        const key = fresh();
        const first = await claim(client, 'ledger-relay', key);
        expect(await finish(client, first.receipt_id, outcome, {pending: 0})).toEqual({outcome: 'finished'});
        expect(await claim(client, 'ledger-relay', key), outcome).toEqual({outcome: 'duplicate', receipt_id: first.receipt_id, attempt: 1});
        expect(await claim(client, 'ledger-relay', key), outcome).toMatchObject({outcome: 'duplicate'});
        expect(await receiptsOf(client, key), outcome).toHaveLength(1);
      }
    });
  });

  it('replaces a `failed` attempt with attempt + 1 at once, and keeps the failed receipt as it was', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const first = await claim(client, 'dormant-identity-purge', key);
      await finish(client, first.receipt_id, 'failed', {error_class: 'TypeError'});
      const second = await claim(client, 'dormant-identity-purge', key);
      expect(second).toMatchObject({outcome: 'claimed', attempt: 2});
      expect(second.receipt_id).not.toBe(first.receipt_id);
      await finish(client, second.receipt_id, 'failed', {error_class: 'TypeError'});
      expect(await claim(client, 'dormant-identity-purge', key)).toMatchObject({outcome: 'claimed', attempt: 3});
      const receipts = await receiptsOf(client, key);
      expect(receipts.map((receipt) => [receipt.attempt, receipt.outcome])).toEqual([[1, 'failed'], [2, 'failed'], [3, null]]);
      await finish(client, (await claim(client, 'dormant-identity-purge', key)).receipt_id, 'ran', {deleted: 0});
      expect(await claim(client, 'dormant-identity-purge', key)).toMatchObject({outcome: 'duplicate', attempt: 3});
    });
  });

  it('replaces an unfinished attempt once it is past its lease (a crash), and not a moment before', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const first = await claim(client, 'ledger-relay', key, 1);
      expect(await claim(client, 'ledger-relay', key, 1)).toMatchObject({outcome: 'running', attempt: 1});
      await client.query('select pg_sleep(1.2)');
      const second = await claim(client, 'ledger-relay', key, 1);
      expect(second).toMatchObject({outcome: 'claimed', attempt: 2});
      expect(second.receipt_id).not.toBe(first.receipt_id);
      expect((await receiptsOf(client, key)).map((receipt) => [receipt.attempt, receipt.outcome])).toEqual([[1, null], [2, null]]);
      // The latest attempt decides: a stale attempt 1 that finishes late is recorded on its own receipt and changes nothing about attempt 2.
      expect(await claim(client, 'ledger-relay', key, 1)).toMatchObject({outcome: 'running', attempt: 2});
      expect(await finish(client, first.receipt_id, 'ran', {pending: 0})).toEqual({outcome: 'finished'});
      expect((await receiptsOf(client, key)).map((receipt) => [receipt.attempt, receipt.outcome])).toEqual([[1, 'ran'], [2, null]]);
      expect(await claim(client, 'ledger-relay', key, 1)).toEqual({outcome: 'running', receipt_id: second.receipt_id, attempt: 2});
      // Only when attempt 2 itself finishes is the message a duplicate.
      expect(await finish(client, second.receipt_id, 'idle', {pending: 0})).toEqual({outcome: 'finished'});
      expect(await claim(client, 'ledger-relay', key, 1)).toEqual({outcome: 'duplicate', receipt_id: second.receipt_id, attempt: 2});
    });
  });

  it('keys a run by the pair (schedule ID, message ID): another message, or the same message of another schedule, is another run', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const first = await claim(client, 'ledger-relay', key);
      await finish(client, first.receipt_id, 'idle', {pending: 0});
      expect(await claim(client, 'ledger-relay', {schedule: key.schedule, message: `msg_${randomUUID()}`})).toMatchObject({outcome: 'claimed', attempt: 1});
      expect(await claim(client, 'ledger-relay', {schedule: `scd_${randomUUID()}`, message: key.message})).toMatchObject({outcome: 'claimed', attempt: 1});
    });
  });

  it('refuses to run another task under a message that is already some task\'s, and bad input, with the stable invalid-argument code', async () => {
    await inTx(async (client) => {
      const key = fresh();
      await claim(client, 'ledger-relay', key);
      for (const [sql, params] of [
        ['select * from api.claim_job_run($1, $2, $3, 300)', ['dormant-identity-purge', key.schedule, key.message]],
        ['select * from api.claim_job_run(null, $1, $2, 300)', [key.schedule, key.message]],
        ['select * from api.claim_job_run($1, null, $2, 300)', ['ledger-relay', key.message]],
        ['select * from api.claim_job_run($1, $2, null, 300)', ['ledger-relay', key.schedule]],
        ['select * from api.claim_job_run($1, $2, $3, null)', ['ledger-relay', key.schedule, key.message]],
        ['select * from api.claim_job_run($1, $2, $3, 0)', ['ledger-relay', key.schedule, key.message]],
        ['select * from api.claim_job_run($1, $2, $3, 3601)', ['ledger-relay', key.schedule, key.message]],
        ['select * from api.claim_job_run($1, $2, $3, 300)', ['Ledger Relay', key.schedule, key.message]],
        ['select * from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', 'scd 1', key.message]],
        ['select * from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.schedule, `${key.message};drop`]],
      ] as const) {
        const result = await attempt(client, 'service_role', sql, [...params]);
        expect(result.ok, sql + JSON.stringify(params)).toBe(false);
        if (!result.ok) expect(result.code, sql + JSON.stringify(params)).toBe('22023');
      }
      expect(await receiptsOf(client, key)).toHaveLength(1);
    });
  });

  it('is serialized per key: ten connections claiming one message at once get exactly one `claimed` and nine `running`, and one row is written (real connections)', async () => {
    const key = fresh();
    const clients = await Promise.all(Array.from({length: 10}, () => track()));
    const answers = await Promise.all(clients.map((client) => client.query('select outcome, attempt from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.schedule, key.message])));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['claimed', ...Array(9).fill('running')]);
    expect(answers.every((answer) => answer.rows[0].attempt === 1)).toBe(true);
    expect(await receiptsOf(db, key)).toHaveLength(1);
  });

  it('lets many different messages be claimed at once without waiting on one another (real connections)', async () => {
    const keys = Array.from({length: 6}, () => fresh());
    const clients = await Promise.all(keys.map(() => track()));
    const answers = await Promise.all(clients.map((client, index) => client.query('select outcome from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', keys[index].schedule, keys[index].message])));
    expect(answers.map((answer) => answer.rows[0].outcome)).toEqual(Array(6).fill('claimed'));
  });

  it('makes a second claim wait for the first to commit, then reads what it committed: running, or duplicate once it finished (real connections)', async () => {
    const key = fresh();
    const [first, second] = await Promise.all([track(), track()]);
    await first.query('begin');
    const claimed = (await first.query('select outcome, receipt_id from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.schedule, key.message])).rows[0];
    expect(claimed.outcome).toBe('claimed');
    const pid = await pidOf(second);
    const waiting = second.query('select outcome, attempt from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.schedule, key.message]);
    expect(await waitingOnLock(pid)).toBe('advisory');
    await first.query('commit');
    expect((await waiting).rows[0]).toEqual({outcome: 'running', attempt: 1});
    await first.query('select * from api.finish_job_run($1, $2, $3)', [claimed.receipt_id, 'ran', JSON.stringify({deleted: 0})]);
    expect((await second.query('select outcome from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.schedule, key.message])).rows[0].outcome).toBe('duplicate');
    expect(await receiptsOf(db, key)).toHaveLength(1);
  });

  it('lets the next claim in when the first rolls back: nothing was claimed, so the waiting one is the first attempt (real connections)', async () => {
    const key = fresh();
    const [first, second] = await Promise.all([track(), track()]);
    await first.query('begin');
    await first.query('select * from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.schedule, key.message]);
    const pid = await pidOf(second);
    const waiting = second.query('select outcome, attempt from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.schedule, key.message]);
    await waitingOnLock(pid);
    await first.query('rollback');
    expect((await waiting).rows[0]).toEqual({outcome: 'claimed', attempt: 1});
    expect(await receiptsOf(db, key)).toHaveLength(1);
  });

  it('gives a failed message to exactly one of the connections that retry it at once (real connections)', async () => {
    const key = fresh();
    const first = await claimNow(db, 'ledger-relay', key);
    await db.query('select * from api.finish_job_run($1, $2, $3)', [first.receipt_id, 'failed', '{"error_class":"TypeError"}']);
    const clients = await Promise.all(Array.from({length: 5}, () => track()));
    const answers = await Promise.all(clients.map((client) => client.query('select outcome, attempt from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.schedule, key.message])));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['claimed', 'running', 'running', 'running', 'running']);
    expect(answers.every((answer) => answer.rows[0].attempt === 2)).toBe(true);
    expect((await receiptsOf(db, key)).map((receipt) => receipt.attempt)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.finish_job_run', () => {
  it('finishes a receipt once with its outcome and a result, and a second finish changes nothing', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const { receipt_id: id } = await claim(client, 'dormant-identity-purge', key);
      expect(await finish(client, id, 'ran', {deleted: 2, kept: 1, locked: 0, remaining: 0})).toEqual({outcome: 'finished'});
      expect(await finish(client, id, 'failed', {error_class: 'TypeError'})).toEqual({outcome: 'already_finished'});
      expect(await finish(client, id, 'ran', {deleted: 9})).toEqual({outcome: 'already_finished'});
      const [receipt] = await receiptsOf(client, key);
      expect(receipt).toMatchObject({outcome: 'ran', result: {deleted: 2, kept: 1, locked: 0, remaining: 0}});
      expect(receipt.finished_at).toBeInstanceOf(Date);
    });
  });

  it('answers not_found for a receipt that does not exist', async () => {
    await inTx(async (client) => {
      expect(await finish(client, randomUUID(), 'ran', {})).toEqual({outcome: 'not_found'});
    });
  });

  it('refuses an outcome that is not one, and a result a receipt could not hold, with the invalid-argument code and nothing finished', async () => {
    await inTx(async (client) => {
      const key = fresh();
      const { receipt_id: id } = await claim(client, 'ledger-relay', key);
      for (const [outcome, result] of [
        ['done', '{}'],
        ['', '{}'],
        ['ran', '{"address":"someone@example.test"}'],
        ['ran', `{"id":"${randomUUID()}"}`],
        ['ran', '{"nested":{"a":1}}'],
        ['ran', '[]'],
        ['ran', 'null'],
      ] as const) {
        const refused = await attempt(client, 'service_role', 'select * from api.finish_job_run($1, $2, $3::json)', [id, outcome, result]);
        expect(refused.ok, `${outcome} ${result}`).toBe(false);
        if (!refused.ok) expect(refused.code, `${outcome} ${result}`).toBe('22023');
      }
      for (const sql of ['select * from api.finish_job_run(null, \'ran\', \'{}\')', 'select * from api.finish_job_run(gen_random_uuid(), null, \'{}\')', 'select * from api.finish_job_run(gen_random_uuid(), \'ran\', null)']) {
        const refused = await attempt(client, 'service_role', sql);
        expect(refused.ok, sql).toBe(false);
        if (!refused.ok) expect(refused.code, sql).toBe('22023');
      }
      expect((await receiptsOf(client, key))[0].finished_at).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.last_job_run', () => {
  const task = () => `test-last-${tag()}${tag()}`;
  const last = (client: Client, name: string) => svc(client, 'select outcome, attempt, started_at, finished_at, result from api.last_job_run($1)', [name]);

  it('answers all null for a task that has never finished a run, and ignores an unfinished receipt', async () => {
    await inTx(async (client) => {
      const name = task();
      expect(await last(client, name)).toEqual({outcome: null, attempt: null, started_at: null, finished_at: null, result: null});
      await claim(client, name, fresh());
      expect(await last(client, name)).toEqual({outcome: null, attempt: null, started_at: null, finished_at: null, result: null});
    });
  });

  it('answers the newest finished receipt of the task: its outcome, attempt, times and result, a failed run included, and no other task\'s', async () => {
    await inTx(async (client) => {
      const name = task();
      const other = task();
      const a = await claim(client, name, fresh());
      await finish(client, a.receipt_id, 'ran', {deleted: 1});
      await client.query('select pg_sleep(0.05)');
      const b = await claim(client, name, fresh());
      await finish(client, b.receipt_id, 'failed', {error_class: 'TypeError'});
      await client.query('select pg_sleep(0.05)');
      const c = await claim(client, other, fresh());
      await finish(client, c.receipt_id, 'idle', {pending: 0});
      await claim(client, name, fresh());
      const newest = await last(client, name);
      expect(newest).toMatchObject({outcome: 'failed', attempt: 1, result: {error_class: 'TypeError'}});
      expect(newest.finished_at).toBeInstanceOf(Date);
      expect(newest.finished_at.getTime()).toBeGreaterThanOrEqual(newest.started_at.getTime());
      expect(await last(client, other)).toMatchObject({outcome: 'idle', result: {pending: 0}});
    });
  });

  it('refuses a task that is not an ID, and changes nothing (it is read-only)', async () => {
    await inTx(async (client) => {
      for (const name of ['Ledger Relay', '', 'a'.repeat(70)]) {
        const refused = await attempt(client, 'service_role', 'select * from api.last_job_run($1)', [name]);
        expect(refused.ok, name).toBe(false);
        if (!refused.ok) expect(refused.code, name).toBe('22023');
      }
      expect((await attempt(client, 'service_role', 'select * from api.last_job_run(null)')).ok).toBe(false);
    });
    const {rows: definition} = await db.query(`select provolatile from pg_proc where oid = 'api.last_job_run(text)'::regprocedure`);
    expect(definition[0].provolatile).toBe('s');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.register_with_code and an identity that is gone (no_identity)', () => {
  it('answers `no_identity`, not a refusal, for an Auth identity that is not there, and counts nothing against the origin', async () => {
    await inTx(async (client) => {
      const svcApi = api(client);
      const hash = codeHash();
      await svcApi.issue(hash, 'general', null);
      const origin = originHash();
      const receipt = await svcApi.register(randomUUID(), hash, {origin});
      expect(receipt).toMatchObject({outcome: 'no_identity', account_id: null, workspace_id: null, role: null, replayed: false});
      expect(await failuresOf(client, origin)).toBe(0);
      expect(await invitationStatus(client, hash)).toBe('unused');
    });
  });

  it('writes no attempt time for an identity that is not there, and consumes no code', async () => {
    await inTx(async (client) => {
      const gone = randomUUID();
      const hash = codeHash();
      await api(client).issue(hash, 'named', 'Gone');
      await api(client).register(gone, hash);
      expect(await count(client, 'select count(*) as n from identity.registration_attempts where user_id = $1', [gone])).toBe(0);
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [gone])).toBe(0);
      expect(await invitationStatus(client, hash)).toBe('unused');
    });
  });

  it('still refuses, and counts, an identity that exists but is not a verified Google identity: only a missing row is `no_identity`', async () => {
    await inTx(async (client) => {
      const user = await addUser(client, {verified: false});
      const hash = codeHash();
      await api(client).issue(hash, 'general', null);
      const origin = originHash();
      expect(await api(client).register(user.id, hash, {origin})).toMatchObject({outcome: 'refused'});
      expect(await failuresOf(client, origin)).toBe(1);
    });
  });

  it('keeps the limiter first: an origin that has spent its budget is told `limited`, whoever it asks about', async () => {
    await inTx(async (client) => {
      const origin = originHash();
      const hash = codeHash();
      await api(client).issue(hash, 'general', null);
      const user = await addUser(client, {verified: false});
      for (let index = 0; index < 5; index += 1) expect((await api(client).register(user.id, hash, {origin})).outcome).toBe('refused');
      expect((await api(client).register(randomUUID(), hash, {origin})).outcome).toBe('limited');
    });
  });

  it('leaves the consumption of a pre-authorization as it was: an identity that is gone answers none', async () => {
    await inTx(async (client) => {
      expect((await api(client).consume(randomUUID())).outcome).toBe('none');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.purge_dormant_identities: who is dormant', () => {
  it('deletes an identity with no Account that never signed in and is older than 30 days, and counts it', async () => {
    await inTx(async (client) => {
      const dormant = await identityAged(client, {created: '31 days', signedIn: null});
      const report = await purge(client);
      expect(report.deleted).toBeGreaterThanOrEqual(1);
      expect(await userExists(client, dormant.id)).toBe(false);
    });
  });

  it('keeps an identity that has an Account, however old and idle it is', async () => {
    await inTx(async (client) => {
      const member = await identityAged(client, {created: '900 days', signedIn: '800 days', attempted: '700 days', account: true});
      await purge(client);
      expect(await userExists(client, member.id)).toBe(true);
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [member.id])).toBe(1);
      expect(await count(client, 'select count(*) as n from projects.workspaces where account_id = $1', [member.accountId])).toBe(1);
    });
  });

  it('measures from the last sign-in when there is one, from creation when there is none, and from the registration attempt if that is later', async () => {
    await inTx(async (client) => {
      const cases = [
        {name: 'created 31 days ago, never signed in', options: {created: '31 days', signedIn: null}, deleted: true},
        {name: 'created long ago, signed in 29 days ago', options: {created: '400 days', signedIn: '29 days'}, deleted: false},
        {name: 'created long ago, signed in 31 days ago', options: {created: '400 days', signedIn: '31 days'}, deleted: true},
        {name: 'created 29 days ago, never signed in', options: {created: '29 days', signedIn: null}, deleted: false},
        {name: 'created now', options: {created: '0 seconds', signedIn: null}, deleted: false},
        {name: 'old, but tried to register 29 days ago', options: {created: '400 days', signedIn: '300 days', attempted: '29 days'}, deleted: false},
        {name: 'old, and tried to register 31 days ago', options: {created: '400 days', signedIn: '300 days', attempted: '31 days'}, deleted: true},
        {name: 'old, tried to register a minute ago', options: {created: '400 days', signedIn: null, attempted: '1 minute'}, deleted: false},
        {name: 'a minute short of 30 days', options: {created: '29 days 23 hours 59 minutes', signedIn: null}, deleted: false},
        {name: 'a minute past 30 days', options: {created: '30 days 1 minute', signedIn: null}, deleted: true},
      ];
      const made: ((typeof cases)[number] & {user: Awaited<ReturnType<typeof identityAged>>})[] = [];
      for (const entry of cases) made.push({...entry, user: await identityAged(client, entry.options)});
      await purge(client);
      for (const entry of made) expect(await userExists(client, entry.user.id), entry.name).toBe(!entry.deleted);
    });
  });

  it('deletes the identity\'s own rows with it (its identities, sessions and attempt time), leaving no orphan', async () => {
    await inTx(async (client) => {
      const dormant = await identityAged(client, {created: '60 days', signedIn: '50 days', attempted: '45 days'});
      const session = await client.query(`insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (gen_random_uuid(), $1, now() - interval '50 days', now() - interval '50 days', 'aal1') returning id`, [dormant.id]);
      expect(session.rowCount).toBe(1);
      await purge(client);
      expect(await userExists(client, dormant.id)).toBe(false);
      for (const sql of ['select count(*) as n from auth.identities where user_id = $1', 'select count(*) as n from auth.sessions where user_id = $1', 'select count(*) as n from identity.registration_attempts where user_id = $1']) {
        expect(await count(client, sql, [dormant.id]), sql).toBe(0);
      }
      expect(await orphans(client)).toEqual({accounts: 0, workspaces: 0});
    });
  });

  it('deletes only the dormant identities of a batch and leaves a recent one, an active Account\'s and one that tried to register', async () => {
    await inTx(async (client) => {
      const dormant = await identityAged(client, {created: '90 days'});
      const recent = await identityAged(client, {created: '2 days'});
      const member = await identityAged(client, {created: '90 days', account: true});
      const trying = await identityAged(client, {created: '90 days', attempted: '3 days'});
      await purge(client);
      expect([dormant, recent, member, trying].map((user) => user.id)).toHaveLength(4);
      expect(await userExists(client, dormant.id)).toBe(false);
      for (const user of [recent, member, trying]) expect(await userExists(client, user.id), user.email).toBe(true);
    });
  });

  it('is repeatable: a second purge finds nothing more of the same identities', async () => {
    await inTx(async (client) => {
      const dormant = await identityAged(client, {created: '90 days'});
      const first = await purge(client);
      expect(first.deleted).toBeGreaterThanOrEqual(1);
      const second = await purge(client);
      expect(second.deleted).toBe(0);
      expect(await userExists(client, dormant.id)).toBe(false);
    });
  });
});

describe('api.purge_dormant_identities: the batch, the report and the refusals', () => {
  it('returns four counts and nothing else: no ID, no address', async () => {
    const {rows: attributes} = await db.query(
      `select a.attname, format_type(a.atttypid, a.atttypmod) as type from pg_type t join pg_class c on c.oid = t.typrelid join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where t.typnamespace = 'api'::regnamespace and t.typname = 'purge_report' order by a.attnum`,
    );
    expect(attributes.map((attribute) => [attribute.attname, attribute.type])).toEqual([['deleted', 'integer'], ['kept', 'integer'], ['locked', 'integer'], ['remaining', 'integer']]);
    await inTx(async (client) => {
      await identityAged(client, {created: '90 days'});
      const report = await svc(client, 'select * from api.purge_dormant_identities(5)');
      expect(Object.keys(report)).toEqual(['deleted', 'kept', 'locked', 'remaining']);
      for (const value of Object.values(report)) expect(Number.isInteger(value)).toBe(true);
    });
  });

  it('purges at most p_limit identities, the oldest first, and says how many dormant ones remain', async () => {
    await inTx(async (client) => {
      // Whatever dormant identities the local stack already holds go first (this transaction is rolled back), so the order below is the order of these three.
      await purge(client);
      const [oldest, middle, youngest] = [await identityAged(client, {created: '9000 days'}), await identityAged(client, {created: '8999 days'}), await identityAged(client, {created: '8998 days'})];
      const report = await purge(client, 1);
      expect(report.deleted + report.kept + report.locked).toBeLessThanOrEqual(1);
      expect(report.remaining).toBeGreaterThanOrEqual(2);
      expect(await userExists(client, oldest.id)).toBe(false);
      expect(await userExists(client, middle.id)).toBe(true);
      expect(await userExists(client, youngest.id)).toBe(true);
    });
  });

  it('takes a limit of 1 to 500 and refuses any other, and has no age parameter', async () => {
    await inTx(async (client) => {
      for (const limit of [0, -1, 501, 100000]) {
        const refused = await attempt(client, 'service_role', 'select * from api.purge_dormant_identities($1)', [limit]);
        expect(refused.ok, String(limit)).toBe(false);
        if (!refused.ok) expect(refused.code, String(limit)).toBe('22023');
      }
      expect((await attempt(client, 'service_role', 'select * from api.purge_dormant_identities(null)')).ok).toBe(false);
      for (const limit of [1, 100, 500]) expect((await attempt(client, 'service_role', 'select * from api.purge_dormant_identities($1)', [limit])).ok, String(limit)).toBe(true);
      expect((await attempt(client, 'service_role', 'select * from api.purge_dormant_identities()')).ok).toBe(true);
    });
    const {rows: signature} = await db.query(`select pg_get_function_arguments('api.purge_dormant_identities(integer)'::regprocedure) as args`);
    expect(signature[0].args).toBe('p_limit integer DEFAULT 100');
  });

  it('counts a foreign-key refusal as kept, keeps that identity, and still deletes the others of the batch (each in its own sub-block)', async () => {
    await inTx(async (client) => {
      const [blocked, plain, another] = [await identityAged(client, {created: '95 days'}), await identityAged(client, {created: '96 days'}), await identityAged(client, {created: '97 days'})];
      // Something that holds the identity with a RESTRICT key, as an Account does.
      await client.query('create table public.purge_fk_probe (user_id uuid primary key references auth.users (id) on delete restrict)');
      await client.query('insert into public.purge_fk_probe values ($1)', [blocked.id]);
      const report = await purge(client);
      expect(report.kept).toBeGreaterThanOrEqual(1);
      expect(report.deleted).toBeGreaterThanOrEqual(2);
      expect(await userExists(client, blocked.id)).toBe(true);
      expect(await userExists(client, plain.id)).toBe(false);
      expect(await userExists(client, another.id)).toBe(false);
    });
  });

  it('deletes no one in a transaction that is rolled back', async () => {
    const dormant = await identityAged(db, {created: '120 days', commit: true});
    await db.query('begin');
    try {
      expect((await purge(db)).deleted).toBeGreaterThanOrEqual(1);
      expect(await userExists(db, dormant.id)).toBe(false);
    } finally {
      await db.query('rollback');
    }
    expect(await userExists(db, dormant.id)).toBe(true);
    await cleanup();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the purge and registration share one lock (real connections)', () => {
  it('purge first: the purge deletes the identity, the waiting registration finds none and answers no_identity, nothing is orphaned (AC-3)', async () => {
    const dormant = await identityAged(db, {created: '120 days', commit: true});
    const hash = await codeCommitted();
    const origin = originHash();
    committed.origins.push(origin);
    const [purger, registrant] = await Promise.all([track(), track()]);

    await purger.query('begin');
    const report = await purge(purger);
    expect(report.deleted).toBeGreaterThanOrEqual(1);
    expect(await userExists(purger, dormant.id)).toBe(false);

    await registrant.query('begin');
    const pid = await pidOf(registrant);
    const registering = api(registrant).register(dormant.id, hash, {origin});
    expect(await waitingOnLock(pid)).toBe('transactionid');
    await purger.query('commit');
    expect(await registering).toMatchObject({outcome: 'no_identity', account_id: null, workspace_id: null, role: null});
    await registrant.query('commit');

    expect(await userExists(db, dormant.id)).toBe(false);
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [dormant.id])).toBe(0);
    expect(await count(db, 'select count(*) as n from identity.registration_attempts where user_id = $1', [dormant.id])).toBe(0);
    expect(await count(db, 'select count(*) as n from identity.registration_commands rc join identity.invitations i on i.code_hash = rc.code_hash where i.code_hash = $1', [hash])).toBe(0);
    expect(await invitationStatus(db, hash)).toBe('unused');
    expect(await failuresOf(db, origin)).toBe(0);
    expect(await orphans(db)).toEqual({accounts: 0, workspaces: 0});
  });

  it('registration first: the purge skips the identity it cannot lock, deletes nothing of it, and the Account and Workspace exist afterwards (AC-3)', async () => {
    const dormant = await identityAged(db, {created: '120 days', commit: true});
    const hash = await codeCommitted();
    const origin = originHash();
    committed.origins.push(origin);
    const [purger, registrant] = await Promise.all([track(), track()]);

    await registrant.query('begin');
    const receipt = await api(registrant).register(dormant.id, hash, {origin});
    expect(receipt.outcome).toBe('registered');

    await purger.query('begin');
    const report = await purge(purger);
    expect(report.locked).toBeGreaterThanOrEqual(1);
    expect(await userExists(purger, dormant.id)).toBe(true);
    await purger.query('commit');
    await registrant.query('commit');

    expect(await userExists(db, dormant.id)).toBe(true);
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1 and status = \'active\'', [dormant.id])).toBe(1);
    expect(await count(db, 'select count(*) as n from projects.workspaces w join identity.accounts a on a.id = w.account_id where a.user_id = $1', [dormant.id])).toBe(1);
    expect(await invitationStatus(db, hash)).toBe('redeemed');
    expect(await orphans(db)).toEqual({accounts: 0, workspaces: 0});

    // And the next purge leaves it for ever: it has an Account.
    await purgeNow(db);
    expect(await userExists(db, dormant.id)).toBe(true);
  });

  it('registration in flight with a code that is wrong: the purge skips it, and once the attempt is written the identity is no longer dormant', async () => {
    const dormant = await identityAged(db, {created: '120 days', commit: true});
    const origin = originHash();
    committed.origins.push(origin);
    const [purger, registrant] = await Promise.all([track(), track()]);
    await registrant.query('begin');
    expect((await api(registrant).register(dormant.id, codeHash(), {origin})).outcome).toBe('refused');
    await purger.query('begin');
    expect((await purge(purger)).locked).toBeGreaterThanOrEqual(1);
    await purger.query('commit');
    await registrant.query('commit');
    expect(await userExists(db, dormant.id)).toBe(true);
    expect(await count(db, `select count(*) as n from identity.registration_attempts where user_id = $1 and last_attempt_at > now() - interval '1 minute'`, [dormant.id])).toBe(1);
    await purgeNow(db);
    expect(await userExists(db, dormant.id)).toBe(true);
  });

  it('only the dormant identity is deleted while a registration is in flight for another one, and that registration completes whole (AC-4)', async () => {
    const dormant = await identityAged(db, {created: '120 days', commit: true});
    // Another identity that looks dormant too, and is mid-registration: it must not be touched either.
    const inFlight = await identityAged(db, {created: '121 days', commit: true});
    const recent = await identityAged(db, {created: '1 day', commit: true});
    const hash = await codeCommitted();
    const origin = originHash();
    committed.origins.push(origin);
    const [purger, registrant] = await Promise.all([track(), track()]);

    await registrant.query('begin');
    expect((await api(registrant).register(inFlight.id, hash, {origin})).outcome).toBe('registered');

    await purger.query('begin');
    const report = await purge(purger);
    expect(report.deleted).toBeGreaterThanOrEqual(1);
    expect(report.locked).toBeGreaterThanOrEqual(1);
    await purger.query('commit');
    await registrant.query('commit');

    expect(await userExists(db, dormant.id)).toBe(false);
    expect(await userExists(db, inFlight.id)).toBe(true);
    expect(await userExists(db, recent.id)).toBe(true);
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [inFlight.id])).toBe(1);
    expect(await count(db, 'select count(*) as n from projects.workspaces w join identity.accounts a on a.id = w.account_id where a.user_id = $1', [inFlight.id])).toBe(1);
    expect(await count(db, 'select count(*) as n from identity.registration_commands rc join identity.accounts a on a.id = rc.account_id where a.user_id = $1', [inFlight.id])).toBe(1);
    expect(await invitationStatus(db, hash)).toBe('redeemed');
    expect(await orphans(db)).toEqual({accounts: 0, workspaces: 0});
  });

  it('reads the conditions again after it has the lock: an identity that registers between the candidate list and its turn is kept, not deleted', async () => {
    // The purge works through its candidates oldest first. The first one's deletion is slowed by a trigger (a test-only object, removed
    // afterwards), and while the purge is stuck there the second registers and commits. This shows the race ends whole: the Account and its
    // Workspace exist and nothing is orphaned. It does NOT show that the purge reads the conditions again after the lock, because the foreign
    // key from identity.accounts.user_id would refuse the delete of an identity that has an Account anyway (and the purge counts that as kept).
    // The re-read is shown by the next describe, with changes that no foreign key blocks.
    const slow = await identityAged(db, {created: '9500 days', commit: true});
    const registers = await identityAged(db, {created: '9499 days', commit: true});
    const hash = await codeCommitted();
    const origin = originHash();
    committed.origins.push(origin);
    await db.query(
      `create function lifecycle.test_pause_before_delete() returns trigger language plpgsql as $$
       begin
         if old.id::text = current_setting('nova3d.test_pause_user', true) then perform pg_sleep(2); end if;
         return old;
       end; $$`,
    );
    await db.query('create trigger test_pause_before_delete before delete on auth.users for each row execute function lifecycle.test_pause_before_delete()');
    try {
      const [purger, registrant] = await Promise.all([track(), track()]);
      await purger.query('begin');
      await purger.query(`select set_config('nova3d.test_pause_user', $1, true)`, [slow.id]);
      const purgerPid = await pidOf(purger);
      const purging = purge(purger);
      await untilSleeping(purgerPid);
      await registrant.query('begin');
      expect((await api(registrant).register(registers.id, hash, {origin})).outcome).toBe('registered');
      await registrant.query('commit');
      const report = await purging;
      await purger.query('commit');
      expect(report.deleted).toBeGreaterThanOrEqual(1);
      expect(report.kept).toBeGreaterThanOrEqual(1);
      expect(await userExists(db, slow.id)).toBe(false);
      expect(await userExists(db, registers.id)).toBe(true);
      expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [registers.id])).toBe(1);
      expect(await orphans(db)).toEqual({accounts: 0, workspaces: 0});
    } finally {
      await db.query('drop trigger test_pause_before_delete on auth.users');
      await db.query('drop function lifecycle.test_pause_before_delete()');
    }
  });

  it('skips an identity another purge holds: the second purge cannot lock a row the first has deleted but not committed, so it leaves it, and the identity is deleted once', async () => {
    const dormant = await identityAged(db, {created: '9600 days', commit: true});
    const [first, second] = await Promise.all([track(), track()]);
    await first.query('begin');
    expect((await purge(first)).deleted).toBeGreaterThanOrEqual(1);
    expect(await userExists(first, dormant.id)).toBe(false);
    await second.query('begin');
    const report = await purge(second);
    expect(report.locked).toBeGreaterThanOrEqual(1);
    // The first has not committed, so the second still sees the identity, and has not touched it.
    expect(await userExists(second, dormant.id)).toBe(true);
    await first.query('commit');
    await second.query('commit');
    expect(await userExists(db, dormant.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the purge reads the conditions again once it holds the lock (changes that no foreign key blocks)', () => {
  // The same paused-trigger shape as above: the purge's first candidate is slowed by a test-only trigger, and while it is stuck there ANOTHER
  // connection commits a change to the second candidate that makes it no longer dormant: a fresh registration attempt, or a fresh sign-in. Neither
  // is blocked by any foreign key, so only the re-read after the lock keeps the identity. The control runs the same scenario against a scratch
  // copy of the function with the re-read block cut out (made from the live function's own text, in a transaction that is rolled back, and
  // never written to the migration): the identity is deleted there, which shows these cases would catch the block being removed.
  const reread = /perform 1\s+from auth\.users u\s+where u\.id = v_candidate[\s\S]*?end if;/;

  async function withPausingTrigger<T>(work: () => Promise<T>) {
    await db.query(
      `create function lifecycle.test_pause_before_delete() returns trigger language plpgsql as $$
       begin
         if old.id::text = current_setting('nova3d.test_pause_user', true) then perform pg_sleep(2); end if;
         return old;
       end; $$`,
    );
    await db.query('create trigger test_pause_before_delete before delete on auth.users for each row execute function lifecycle.test_pause_before_delete()');
    try {
      return await work();
    } finally {
      await db.query('drop trigger test_pause_before_delete on auth.users');
      await db.query('drop function lifecycle.test_pause_before_delete()');
    }
  }

  const becomes = {
    attempted: (id: string) => db.query(`insert into identity.registration_attempts (user_id, last_attempt_at) values ($1, now()) on conflict (user_id) do update set last_attempt_at = excluded.last_attempt_at`, [id]),
    signed_in: (id: string) => db.query('update auth.users set last_sign_in_at = now() where id = $1', [id]),
  };

  async function pausedPurge(change: keyof typeof becomes, options: {withoutReread: boolean}) {
    const slow = await identityAged(db, {created: '9400 days', commit: true});
    const later = await identityAged(db, {created: '9399 days', commit: true});
    return withPausingTrigger(async () => {
      const purger = await track();
      await purger.query('begin');
      if (options.withoutReread) {
        const live = (await db.query(`select pg_get_functiondef('api.purge_dormant_identities(integer)'::regprocedure) as text`)).rows[0].text as string;
        const scratch = live.replace(reread, '');
        // The scratch copy really lacks the block, and is otherwise the live function.
        expect(scratch).not.toBe(live);
        expect(scratch).toContain('delete from auth.users');
        expect(scratch).toContain('for update skip locked');
        expect((scratch.match(/continue;/g) ?? []).length).toBe((live.match(/continue;/g) ?? []).length - 1);
        await purger.query(scratch);
      }
      await purger.query(`select set_config('nova3d.test_pause_user', $1, true)`, [slow.id]);
      const purgerPid = await pidOf(purger);
      const purging = purge(purger);
      await untilSleeping(purgerPid);
      // Committed by another connection: after the candidate list was read, before the purge locks the second candidate.
      await becomes[change](later.id);
      const report = await purging;
      const goneInThePurgesView = !(await userExists(purger, later.id));
      await purger.query(options.withoutReread ? 'rollback' : 'commit');
      return {report, slow, later, goneInThePurgesView};
    });
  }

  it.each(['attempted', 'signed_in'] as const)('keeps an identity that %s after the candidate list was read: counted kept, its auth.users row survives, and it has no Account to blame', async (change) => {
    const { report, slow, later, goneInThePurgesView } = await pausedPurge(change, {withoutReread: false});
    expect(goneInThePurgesView).toBe(false);
    expect(await userExists(db, later.id)).toBe(true);
    expect(await userExists(db, slow.id)).toBe(false);
    expect(report.deleted).toBeGreaterThanOrEqual(1);
    expect(report.kept).toBeGreaterThanOrEqual(1);
    // No Account, no Workspace, no foreign key holds this row: only the re-read after the lock did.
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [later.id])).toBe(0);
    if (change === 'attempted') expect(await count(db, `select count(*) as n from identity.registration_attempts where user_id = $1 and last_attempt_at > now() - interval '1 minute'`, [later.id])).toBe(1);
    else expect(await count(db, `select count(*) as n from auth.users where id = $1 and last_sign_in_at > now() - interval '1 minute'`, [later.id])).toBe(1);
    // And it is no longer a candidate on the next run.
    const next = await purgeNow(db);
    expect(next.deleted).toBe(0);
    expect(await userExists(db, later.id)).toBe(true);
  });

  it.each(['attempted', 'signed_in'] as const)('control: against a copy of the function with the re-read cut out, an identity that %s is DELETED (so these cases fail if the block is removed)', async (change) => {
    const { report, slow, later, goneInThePurgesView } = await pausedPurge(change, {withoutReread: true});
    expect(goneInThePurgesView).toBe(true);
    expect(report.deleted).toBeGreaterThanOrEqual(2);
    // The scratch copy and its deletions were rolled back with the transaction: both identities are still there, and the live function still re-reads.
    expect(await userExists(db, slow.id)).toBe(true);
    expect(await userExists(db, later.id)).toBe(true);
    const live = (await db.query(`select pg_get_functiondef('api.purge_dormant_identities(integer)'::regprocedure) as text`)).rows[0].text as string;
    expect(live).toMatch(reread);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('closure: the receipts table and the new functions are reachable by the service role through the api alone', () => {
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
  const bodies = (): Record<string, unknown> => ({
    claim_job_run: {p_task: 'ledger-relay', p_schedule_id: 'scd_closure', p_message_id: 'msg_closure', p_lease_seconds: 300},
    finish_job_run: {p_receipt_id: randomUUID(), p_outcome: 'ran', p_result: {}},
    last_job_run: {p_task: 'ledger-relay'},
    purge_dormant_identities: {p_limit: 1},
  });

  it('has row-level security on, no policy, and no privilege on it for public, anon, authenticated or the service role', async () => {
    const {rows: table} = await db.query(`select relrowsecurity, relforcerowsecurity, relacl from pg_class where oid = 'lifecycle.job_receipts'::regclass`);
    expect(table[0].relrowsecurity).toBe(true);
    expect((await db.query(`select count(*)::int as n from pg_policies where schemaname = 'lifecycle' and tablename = 'job_receipts'`)).rows[0].n).toBe(0);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const {rows: privileges} = await db.query(`select bool_or(has_table_privilege($1, 'lifecycle.job_receipts', p)) as any from unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p`, [role]);
      expect(privileges[0].any, role).toBe(false);
    }
    const {rows: grants} = await db.query(`select count(*)::int as n from pg_class c, aclexplode(c.relacl) a where c.oid = 'lifecycle.job_receipts'::regclass and a.grantee = 0`);
    expect(grants[0].n).toBe(0);
  });

  it('refuses every read, write and delete of the table to anon, authenticated and the service role over REST: a permission error and no row', async () => {
    const key = fresh();
    await claimNow(db, 'ledger-relay', key);
    for (const token of [stack.anonKey, authenticatedToken(), stack.serviceKey]) {
      const read = await rest(token, 'job_receipts?select=*', {profile: 'lifecycle'});
      const text = await read.text();
      expect([401, 403], `read ${read.status}`).toContain(read.status);
      expect(JSON.parse(text).code).toBe('42501');
      expect(text).not.toContain(key.message);
      for (const [method, path, body] of [['POST', 'job_receipts', '{}'], ['DELETE', 'job_receipts?task=eq.ledger-relay', undefined], ['PATCH', 'job_receipts?task=eq.ledger-relay', '{}']] as const) {
        const write = await rest(token, path, {method, profile: 'lifecycle', body});
        expect([401, 403], method).toContain(write.status);
      }
    }
    expect(await receiptsOf(db, key)).toHaveLength(1);
  });

  it('does not publish the table, and lets no one call the helper of the lifecycle schema over REST', async () => {
    for (const token of [stack.anonKey, authenticatedToken()]) {
      const response = await rest(token, '', {profile: 'lifecycle', headers: {accept: 'application/openapi+json'}});
      expect(await response.text()).not.toContain('"/job_receipts"');
    }
    for (const token of [stack.anonKey, authenticatedToken(), stack.serviceKey]) {
      const response = await rest(token, 'rpc/job_result_ok', {method: 'POST', profile: 'lifecycle', body: JSON.stringify({p_result: {}})});
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
  });

  it('refuses the four functions to the anon key and an authenticated token with a permission error, and lets the service role call them', async () => {
    for (const token of [stack.anonKey, authenticatedToken()]) {
      for (const [name, body] of Object.entries(bodies())) {
        const response = await rest(token, `rpc/${name}`, {method: 'POST', profile: 'api', body: JSON.stringify(body)});
        expect([401, 403], name).toContain(response.status);
        expect((await response.json()).code, name).toBe('42501');
      }
    }
    for (const name of ['last_job_run', 'purge_dormant_identities']) {
      const response = await rest(stack.serviceKey, `rpc/${name}`, {method: 'POST', profile: 'api', body: JSON.stringify(bodies()[name])});
      expect(response.status, name).toBe(200);
    }
  });

  it('makes every new function run as its owner with an empty search_path, executable by the service role alone', async () => {
    const {rows: functions} = await db.query(
      `select p.proname as name, n.nspname as schema, p.prosecdef as definer, p.proconfig as config,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('claim_job_run', 'finish_job_run', 'last_job_run', 'purge_dormant_identities', 'job_result_ok', 'guard_job_receipt') order by 1`,
    );
    expect(functions.map((entry) => entry.name)).toEqual(['claim_job_run', 'finish_job_run', 'guard_job_receipt', 'job_result_ok', 'last_job_run', 'purge_dormant_identities']);
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

  it('refuses the new functions to anon and authenticated over the wire', async () => {
    await inTx(async (client) => {
      for (const sql of ['select * from api.claim_job_run(\'ledger-relay\', \'scd_x\', \'msg_x\', 300)', 'select * from api.finish_job_run(gen_random_uuid(), \'ran\', \'{}\')', 'select * from api.last_job_run(\'ledger-relay\')', 'select * from api.purge_dormant_identities(1)', 'select lifecycle.job_result_ok(\'{}\')']) {
        for (const role of ['anon', 'authenticated']) expect((await attempt(client, role, sql)).ok, `${role}: ${sql}`).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries every earlier probe and the new ones', () => {
  it('answers ok to the service role, and reads the receipts table and the new functions', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [
      // Every earlier probe is still there.
      'identity.session_grants', 'identity.accounts', 'a.status_handle', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
      'delete on auth.sessions', 'api.list_accounts()', 'api.issue_recovery(text,text)', 'api.rename_project(uuid,bigint,uuid,uuid,bigint,text)',
      'api.record_tombstone(text,uuid)', 'api.guard_target(uuid,bigint,text,uuid)', 'api.claim_ledger_events(uuid,integer,integer)', 'api.finish_ledger_events(uuid,uuid[],boolean)', 'api.ledger_pending()', 'api.lookup_status(text,text)', 'lifecycle.assert_not_tombstoned(text,uuid)',
      // And the new ones.
      'lifecycle.job_receipts', 'b.schedule_id', 'b.message_id', 'b.attempt', 'b.outcome', 'b.result',
      'api.claim_job_run(text,text,text,integer)', 'api.finish_job_run(uuid,text,json)', 'api.last_job_run(text)', 'api.purge_dormant_identities(integer)', 'lifecycle.job_result_ok(json)',
      "has_table_privilege('auth.users', 'DELETE')", 'delete Auth identities',
    ]) expect(definition, needle).toContain(needle);
  });

  it.each(['api.claim_job_run(text, text, text, integer)', 'api.finish_job_run(uuid, text, json)', 'api.last_job_run(text)', 'api.purge_dormant_identities(integer)', 'lifecycle.job_result_ok(json)'])(
    'fails the build with one line naming %s when it is missing',
    async (signature) => {
      await inTx(async (client) => {
        await client.query(`drop function ${signature} cascade`);
        const result = await attempt(client, 'service_role', 'select * from api.preflight()');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('N3020');
          expect(result.message).toContain('Story 1.9');
          expect(result.message).toContain(signature.replace(/, /g, ','));
        }
      });
    },
  );

  it.each(['api.claim_job_run(text, text, text, integer)', 'api.finish_job_run(uuid, text, json)', 'api.last_job_run(text)', 'api.purge_dormant_identities(integer)'])('fails when the service role cannot execute %s', async (signature) => {
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

  it('fails with one line naming the privilege when the role it runs as can end Auth sessions but not delete Auth identities, and answers ok once it can (the branch is executed, not only matched)', async () => {
    // The functions run as their owner. A role that owns the preflight, reads every table it reads and may delete from auth.sessions, but not from
    // auth.users, reaches the last check and fails it. Granting those privileges takes more than the `postgres` role of this stack holds (it has
    // DELETE on auth.sessions without the right to grant it), so this one case connects as the stack's superuser, `supabase_admin`, to the SAME local
    // database, in a transaction that is rolled back: the probe role, its grants and the changed owner all go with it.
    const url = new URL(stack.dbUrl);
    url.username = 'supabase_admin';
    const admin = new Client({connectionString: url.toString()});
    await admin.connect().catch((error: Error) => {
      throw new Error(`The superuser connection this case needs (supabase_admin on the local stack) failed: ${error.message}`);
    });
    const tables = ['identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images', 'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts', 'artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance', 'artifacts.retained_pictures', 'lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats', 'usage.periods', 'usage.fixture_figures', 'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims'];
    const preflightAsServiceRole = async () => {
      await admin.query('savepoint probe');
      try {
        await admin.query('set local role service_role');
        const result = await admin.query('select ok from api.preflight()');
        await admin.query('reset role');
        await admin.query('release savepoint probe');
        return {ok: true as const, rows: result.rows};
      } catch (error) {
        await admin.query('rollback to savepoint probe');
        return {ok: false as const, message: (error as Error).message, code: (error as {code?: string}).code};
      }
    };
    await admin.query('begin');
    try {
      await admin.query('create role preflight_probe nologin');
      // Story 1.12: the preflight also reads the Artifacts tables and views, and (last of all) the private bucket through row-level security, which only
      // a role that bypasses it sees whole; the probe role is made with that attribute (the stack's superuser may) and may read storage.buckets.
      await admin.query('alter role preflight_probe bypassrls');
      await admin.query('grant usage on schema api, identity, projects, lifecycle, auth, artifacts, usage, storage to preflight_probe');
      await admin.query('grant select on storage.buckets to preflight_probe');
      await admin.query('grant create on schema api to preflight_probe');
      for (const table of tables) await admin.query(`grant select on ${table} to preflight_probe`);
      await admin.query('grant delete on auth.sessions to preflight_probe');
      await admin.query('alter function api.preflight() owner to preflight_probe');
      // The setup is what it says: the probe may end sessions and may not delete identities.
      const { rows: held } = await admin.query(`select has_table_privilege('preflight_probe', 'auth.sessions', 'DELETE') as sessions, has_table_privilege('preflight_probe', 'auth.users', 'DELETE') as users`);
      expect(held[0]).toEqual({sessions: true, users: false});

      const refused = await preflightAsServiceRole();
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.code).toBe('42501');
        expect(refused.message).toContain('permission denied to delete Auth identities');
        expect(refused.message).toContain('auth.users');
        expect(refused.message).not.toContain('end Auth sessions');
      }

      // The control: the same role, given DELETE on auth.users, passes every check.
      await admin.query('grant delete on auth.users to preflight_probe');
      const accepted = await preflightAsServiceRole();
      expect(accepted).toEqual({ok: true, rows: [{ok: true}]});
    } finally {
      await admin.query('rollback').catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
    // Nothing of it is left: the real function is still owned by the migration role and answers ok.
    const { rows: owner } = await db.query(`select pg_get_userbyid(proowner) as owner from pg_proc where oid = 'api.preflight()'::regprocedure`);
    expect(owner[0].owner).not.toBe('preflight_probe');
    expect((await db.query(`select count(*)::int as n from pg_roles where rolname = 'preflight_probe'`)).rows[0].n).toBe(0);
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
    });
  });

  it('fails, naming the table, when the role it runs as cannot read the receipts', async () => {
    await inTx(async (client) => {
      await client.query('grant usage on schema api, identity, projects, lifecycle to anon');
      await client.query('grant create on schema api to anon');
      for (const table of ['identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images', 'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims']) {
        await client.query(`grant select on ${table} to anon`);
      }
      await client.query('alter function api.preflight() owner to anon');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('job_receipts');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls against the real stack (lib/lifecycle.ts, over REST)', () => {
  it('claims, finishes and reads back a run, and answers duplicate for the same message', async () => {
    const key = fresh();
    const claimed = await claimJobRun({task: 'ledger-relay', scheduleId: key.schedule, messageId: key.message}, {env});
    expect(claimed).toMatchObject({outcome: 'claimed', attempt: 1});
    if (claimed.outcome !== 'claimed') throw new Error('unreachable');
    expect(await claimJobRun({task: 'ledger-relay', scheduleId: key.schedule, messageId: key.message}, {env})).toEqual({outcome: 'running'});
    expect(await finishJobRun({receiptId: claimed.receiptId, outcome: 'ran', result: {outcome: 'relayed', claimed: 1, appended: 1, marked: 1}}, {env})).toEqual({outcome: 'finished'});
    expect(await finishJobRun({receiptId: claimed.receiptId, outcome: 'failed', result: {error_class: 'TypeError'}}, {env})).toEqual({outcome: 'already_finished'});
    expect(await claimJobRun({task: 'ledger-relay', scheduleId: key.schedule, messageId: key.message}, {env})).toEqual({outcome: 'duplicate'});
    expect((await receiptsOf(db, key))[0]).toMatchObject({outcome: 'ran', result: {outcome: 'relayed', claimed: 1, appended: 1, marked: 1}});
  });

  it('reads the last run of a task, or null for a task that never ran', async () => {
    const task = `test-typed-${tag()}${tag()}`;
    expect(await lastJobRun(task, {env})).toBeNull();
    const key = fresh();
    const claimed = await claimJobRun({task, scheduleId: key.schedule, messageId: key.message}, {env});
    if (claimed.outcome !== 'claimed') throw new Error('unreachable');
    expect(await lastJobRun(task, {env})).toBeNull();
    await finishJobRun({receiptId: claimed.receiptId, outcome: 'idle', result: {pending: 0}}, {env});
    expect(await lastJobRun(task, {env})).toMatchObject({outcome: 'idle', attempt: 1, result: {pending: 0}});
  });

  it('purges through the typed call and reads the four counts', async () => {
    const dormant = await identityAged(db, {created: '9700 days', commit: true});
    const report = await purgeDormantIdentities({limit: 500}, {env});
    expect(report.deleted).toBeGreaterThanOrEqual(1);
    for (const value of Object.values(report)) expect(Number.isInteger(value)).toBe(true);
    expect(await userExists(db, dormant.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('POST /api/jobs end to end (lib/jobs.ts against the real database, signed the way QStash signs)', () => {
  const instance = () => env.INSTANCE_ID;
  const jobEnv = () => ({...env, QSTASH_CURRENT_SIGNING_KEY: testSigningKeys.current, QSTASH_NEXT_SIGNING_KEY: testSigningKeys.next, ADMINISTRATOR_EMAIL: 'admin@example.test', NEXT_PUBLIC_APP_ENV: 'local', PAID_ADAPTERS_ENABLED: 'false', SYNTHETIC_DATA_ENABLED: 'false'});
  const send = (call: ReturnType<typeof signedCall>, options: Parameters<typeof handleJobRequest>[1] = {}) =>
    handleJobRequest(new Request('http://127.0.0.1:4173/api/jobs', {method: 'POST', headers: call.headers, body: call.body}), {env: jobEnv(), ...options});
  const drain = () => db.query('update lifecycle.ledger_outbox set relayed_at = clock_timestamp() where relayed_at is null');

  it('runs a task once, writes one finished receipt, and answers a repeat of the same message with `duplicate` and no new row (AC-2)', async () => {
    await drain();
    const key = fresh();
    const call = signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: key.schedule, messageId: key.message});
    const first = await send(call);
    expect([first.status, await first.json()]).toEqual([200, {outcome: 'idle'}]);
    const again = await send(signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: key.schedule, messageId: key.message}));
    expect([again.status, await again.json()]).toEqual([200, {outcome: 'duplicate'}]);
    const receipts = await receiptsOf(db, key);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({task: 'ledger-relay', attempt: 1, outcome: 'idle', result: {pending: 0}});
    expect(receipts[0].finished_at).toBeInstanceOf(Date);
    // A message of the same schedule at the next firing is another run.
    const next = await send(signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: key.schedule}));
    expect(await next.json()).toEqual({outcome: 'idle'});
  });

  it('rejects foreign calls and writes no receipt: a bad signature, another key, another instance, a bad body', async () => {
    const key = fresh();
    const content = {task: 'ledger-relay', instance: instance()};
    const calls = [
      [401, signedCall(content, {...key && {scheduleId: key.schedule, messageId: key.message}, key: 'another-queues-signing-key-0000000000000'})],
      [403, signedCall({task: 'ledger-relay', instance: randomUUID()}, {scheduleId: key.schedule, messageId: key.message})],
      [400, signedCall({task: 'nope', instance: instance()}, {scheduleId: key.schedule, messageId: key.message})],
      [400, signedCall(content, {scheduleId: null, messageId: key.message})],
    ] as const;
    for (const [status, call] of calls) expect((await send(call)).status).toBe(status);
    const tampered = signedCall(content, {scheduleId: key.schedule, messageId: key.message});
    expect((await send({...tampered, body: `${tampered.body} `})).status).toBe(401);
    expect(await receiptsOf(db, key)).toEqual([]);
    expect(await count(db, 'select count(*) as n from lifecycle.job_receipts where schedule_id = $1 or message_id = $2', [key.schedule, key.message])).toBe(0);
  });

  it('answers 403 and writes no receipt when the database row names another instance than the one the call is for', async () => {
    const key = fresh();
    const other = randomUUID();
    const response = await send(signedCall({task: 'ledger-relay', instance: other}, {scheduleId: key.schedule, messageId: key.message}), {env: {...jobEnv(), INSTANCE_ID: other}});
    expect([response.status, await response.json()]).toEqual([403, {error: 'wrong_environment'}]);
    expect(await receiptsOf(db, key)).toEqual([]);
  });

  it('records `no_store` with the pending count when events wait and no store is configured, then relays them with a store, in order', async () => {
    await drain();
    const accounts = [];
    for (let index = 0; index < 2; index += 1) {
      const user = await addUser(db);
      committed.users.push(user.id);
      const { id } = (await db.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject])).rows[0] as { id: string };
      await db.query(`select * from api.disable_account('seed:local:test', $1)`, [id]);
      accounts.push(id);
    }
    const pending = (await ledgerPending({env})).pending;
    expect(pending).toBeGreaterThanOrEqual(2);

    const noStore = fresh();
    const withoutStore = await send(signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: noStore.schedule, messageId: noStore.message}));
    expect([withoutStore.status, await withoutStore.json()]).toEqual([200, {outcome: 'no_store'}]);
    expect((await receiptsOf(db, noStore))[0]).toMatchObject({outcome: 'no_store', result: {pending}});
    expect((await ledgerPending({env})).pending).toBe(pending);

    const store = createFixtureLedgerStore();
    const relayed = fresh();
    const withStore = await send(signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: relayed.schedule, messageId: relayed.message}), {task: {ledgerStore: store}});
    expect([withStore.status, await withStore.json()]).toEqual([200, {outcome: 'ran'}]);
    expect((await receiptsOf(db, relayed))[0]).toMatchObject({outcome: 'ran', result: {outcome: 'relayed', claimed: pending, appended: pending, marked: pending}});
    expect(verifyChain(instance(), store.objects())).toEqual({ok: true, length: pending});
    expect((await ledgerPending({env})).pending).toBe(0);
    const ledger = store.objects().map((object) => JSON.parse(object.body) as {event: {account_id?: string}});
    for (const id of accounts) expect(ledger.some((entry) => entry.event.account_id === id)).toBe(true);
  });

  it('keeps events pending, and records the run, when the store is down; the next firing resumes', async () => {
    await drain();
    const user = await addUser(db);
    committed.users.push(user.id);
    const { id } = (await db.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject])).rows[0] as { id: string };
    await db.query(`select * from api.disable_account('seed:local:test', $1)`, [id]);
    const store = createFixtureLedgerStore();
    store.setOutage(true);
    const down = fresh();
    const outage = await send(signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: down.schedule, messageId: down.message}), {task: {ledgerStore: store}});
    expect([outage.status, await outage.json()]).toEqual([200, {outcome: 'ran'}]);
    expect((await receiptsOf(db, down))[0].result).toMatchObject({outcome: 'store_unavailable', appended: 0, marked: 0});
    expect((await ledgerPending({env})).pending).toBeGreaterThanOrEqual(1);
    store.setOutage(false);
    const back = fresh();
    await send(signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: back.schedule, messageId: back.message}), {task: {ledgerStore: store}});
    expect((await receiptsOf(db, back))[0].result).toMatchObject({outcome: 'relayed'});
    expect((await ledgerPending({env})).pending).toBe(0);
  });

  it('records a damaged ledger chain as `failed` with the class name only, answers 500, and leaves the events pending; the retry of the same message succeeds once the chain is whole', async () => {
    await drain();
    const user = await addUser(db);
    committed.users.push(user.id);
    const { id } = (await db.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject])).rows[0] as { id: string };
    await db.query(`select * from api.disable_account('seed:local:test', $1)`, [id]);
    const pending = (await ledgerPending({env})).pending;
    expect(pending).toBeGreaterThanOrEqual(1);

    const key = fresh();
    const body = {task: 'ledger-relay', instance: instance()};
    const conflicting = {head: async () => null, putIfAbsent: async () => 'exists' as const};
    const corrupt = {head: async () => ({key: 'not-a-ledger-key', body: 'not a body'}), putIfAbsent: async () => 'created' as const};
    for (const [store, expected] of [[corrupt, 'LedgerCorruptError'], [conflicting, 'LedgerConflictError']] as const) {
      const schedule = fresh();
      const response = await send(signedCall(body, {scheduleId: schedule.schedule, messageId: schedule.message}), {task: {ledgerStore: store as never}});
      expect([response.status, await response.json()]).toEqual([500, {outcome: 'failed'}]);
      const [receipt] = await receiptsOf(db, schedule);
      expect(receipt).toMatchObject({task: 'ledger-relay', attempt: 1, outcome: 'failed', result: {error_class: expected}});
      expect(Object.keys(receipt.result ?? {})).toEqual(['error_class']);
      expect((await ledgerPending({env})).pending).toBe(pending);
      expect((await db.query('select holder from lifecycle.ledger_relay')).rows[0].holder).toBeNull();
    }

    // The scheduler retries the failed message: attempt 2 of the same message runs, and with a whole chain it relays.
    const failed = await send(signedCall(body, {scheduleId: key.schedule, messageId: key.message}), {task: {ledgerStore: corrupt as never}});
    expect(failed.status).toBe(500);
    const retry = await send(signedCall(body, {scheduleId: key.schedule, messageId: key.message}), {task: {ledgerStore: createFixtureLedgerStore()}});
    expect([retry.status, await retry.json()]).toEqual([200, {outcome: 'ran'}]);
    expect((await receiptsOf(db, key)).map((receipt) => [receipt.attempt, receipt.outcome])).toEqual([[1, 'failed'], [2, 'ran']]);
    expect((await ledgerPending({env})).pending).toBe(0);
  });

  it('records the purge\'s counts, and the dormant identity is gone afterwards', async () => {
    const dormant = await identityAged(db, {created: '9800 days', commit: true});
    const key = fresh();
    const response = await send(signedCall({task: 'dormant-identity-purge', instance: instance()}, {scheduleId: key.schedule, messageId: key.message}));
    expect([response.status, await response.json()]).toEqual([200, {outcome: 'ran'}]);
    const [receipt] = await receiptsOf(db, key);
    expect(receipt).toMatchObject({task: 'dormant-identity-purge', outcome: 'ran'});
    expect(Object.keys(receipt.result ?? {}).sort()).toEqual(['deleted', 'kept', 'locked', 'remaining']);
    expect(Number(receipt.result?.deleted)).toBeGreaterThanOrEqual(1);
    expect(await userExists(db, dormant.id)).toBe(false);
    expect((await lastJobRun('dormant-identity-purge', {env}))?.outcome).toBe('ran');
  });

  it('records a failure as `failed` with the class only, answers 500, and the retry of the same message is attempt 2, which then succeeds', async () => {
    const key = fresh();
    const body = {task: 'dormant-identity-purge', instance: instance()};
    const failing = await send(signedCall(body, {scheduleId: key.schedule, messageId: key.message}), {
      run: async () => {
        throw new RangeError('boom someone@example.test');
      },
    });
    expect([failing.status, await failing.json()]).toEqual([500, {outcome: 'failed'}]);
    expect(await receiptsOf(db, key)).toEqual([expect.objectContaining({attempt: 1, outcome: 'failed', result: {error_class: 'RangeError'}})]);
    const retry = await send(signedCall(body, {scheduleId: key.schedule, messageId: key.message}));
    expect([retry.status, await retry.json()]).toEqual([200, {outcome: 'ran'}]);
    expect((await receiptsOf(db, key)).map((receipt) => [receipt.attempt, receipt.outcome])).toEqual([[1, 'failed'], [2, 'ran']]);
    const duplicate = await send(signedCall(body, {scheduleId: key.schedule, messageId: key.message}));
    expect(await duplicate.json()).toEqual({outcome: 'duplicate'});
  });

  it('answers 409 running for a message that is being run, and runs nothing', async () => {
    const key = fresh();
    await claimNow(db, 'ledger-relay', key);
    const response = await send(signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: key.schedule, messageId: key.message}));
    expect([response.status, await response.json()]).toEqual([409, {outcome: 'running'}]);
    expect(await receiptsOf(db, key)).toHaveLength(1);
  });

  it('answers 503, never 200, with no signing keys, and 503 when the database cannot be reached; nothing is written either way', async () => {
    const key = fresh();
    const call = signedCall({task: 'ledger-relay', instance: instance()}, {scheduleId: key.schedule, messageId: key.message});
    expect((await send(call, {env: {...jobEnv(), QSTASH_CURRENT_SIGNING_KEY: undefined}})).status).toBe(503);
    expect((await send(call, {env: {...jobEnv(), NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9'}})).status).toBe(503);
    expect(await receiptsOf(db, key)).toEqual([]);
  });
});
