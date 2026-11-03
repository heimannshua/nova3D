import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {unknownCostCondition, unknownCostSeconds} from '@/lib/alarm-conditions';
import {finishOperation, reconcileOperation, sweepAttempts} from '@/lib/job-commands';
import {alarmObservations} from '@/lib/lifecycle';
import {markDispatchedFor, reportOutcome} from '@/lib/operation-outcome';
import {clearOverrunIncident, listOverrunIncidents} from '@/lib/usage';
import {createHarness, stack} from '../support/accounts-db';
import {backdateLease, fixtureSchedule, jobCommands, planOperation, workerCommands, type FixtureSchedule} from '../support/job-world';
import {jwtSecretOf, stackEnvironment} from '../support/stack';
import {truncateGuards} from '../support/truncate-guard';
import {insertCorrection, insertReservation, insertSettlement, ledgerJob, setFigures} from '../support/usage-ledger';

// Story 2.8 against the Supabase CLI stack: the reconciliation of charges whose outcome is unknown, one row of the specification's I/O and Edge-Case Matrix at a time. An operation
// that was sent and whose outcome is not known (a timeout, a lost lease, a refused settlement) keeps its whole reservation until evidence, a proven noncharge or the 24-hour deadline
// settles it: jobs.mark_ambiguous and finish_operation(ambiguous) start the clock, the sweep's deadline stage settles exactly the reservation (class `deadline`), api.reconcile_operation
// and api.settle_cost take late evidence (a successor correction row, and an incident for an excess), and the Administrator lists and clears overrun incidents. The cases run on
// COMMITTED Accounts (the commands commit their own transactions and several rows need two real connections), whose data is removed afterwards (tests/support/accounts-data.ts).
// The rate schedules are global: the file makes its own, each under a provider of its own (an overrun blocks its provider for every Account, so no two cases share one), and
// removes them when it is done. A planned operation of 1,000 bytes and 100 output tokens reserves 3,400 microdollars at one microdollar per token; money is integer microdollars.
//
// THE CLOCK. The database clock cannot be moved, and `jobs.operations.outcome_at` is written once (the guard refuses a rewrite). The deadline is therefore tried at its edge by the
// OWNER making the move itself: `ambiguousSince` moves a `dispatched` operation to `ambiguous` with an `outcome_at` that many hours in the past. That is exactly the move the
// command makes, so the guard and the time-shape check still judge it; only a REWRITE of `outcome_at` is refused, and nothing here rewrites one. `dispatched_at` is back-dated the
// same way, at the move out of `planned`, for the alarm.

const {db, connect: openConnection, committed, cleanup, addUser, count, inTx, attempt: txAttempt} = createHarness();

/**
 * One statement that is expected to fail, on a connection that is not in a transaction (so no savepoint), optionally as a role. Answers whether it worked and, if not, the error's
 * code. The role is reset in every case.
 */
async function attempt(client: Client, role: string | null, sql: string, params: unknown[] = []): Promise<{ok: true; rows: Record<string, any>[]} | {ok: false; message: string; code: string | undefined}> {
  try {
    if (role) await client.query(`set role ${role}`);
    const result = await client.query(sql, params);
    return {ok: true, rows: result.rows};
  } catch (error) {
    return {ok: false, message: (error as Error).message, code: (error as {code?: string}).code};
  } finally {
    if (role) await client.query('reset role');
  }
}

/**
 * Another connection, for the cases that need two sessions at once. A test that fails while it holds a lock must not leave the rest of the file waiting for it: the session gives up.
 * The database has a limited number of connections and the files of the suite run side by side, so the sessions a test borrowed are given back when it ends (the harness would
 * keep them all until the file is done).
 */
const borrowed: Client[] = [];
async function connect() {
  const client = await openConnection();
  borrowed.push(client);
  await client.query(`set idle_in_transaction_session_timeout = '40s'`);
  await client.query(`set lock_timeout = '40s'`);
  return client;
}
afterEach(async () => {
  await Promise.all(borrowed.splice(0).map((client) => client.end().catch(() => undefined)));
});

const tag = randomBytes(3).toString('hex');
const provider = `t28-${tag}`;
let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});
afterAll(async () => {
  // The schedules are global: remove this run's once nothing refers to them (the Accounts' data goes first; the harness's own hook then finds nothing to do).
  await cleanup();
  await db.query(`delete from usage.rate_schedules where provider like $1`, [`${provider}%`]);
});

const M = 1_000_000;
const CAP = 1_000_000_000_000_000;
const RESERVED = 3400;

// Fixtures ----------------------------------------------------------------------------------------------------------------------

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; epoch: number};

/** An Account with its Workspace and its `initial` period, made the way registration makes one (identity.activate_account), committed and removed with the file. */
async function committedAccount(role: 'member' | 'administrator' = 'member'): Promise<Fixture> {
  const user = await addUser(db);
  const {rows: made} = await db.query(`select identity.activate_account($1, $2, $3, 'invitation') as id`, [user.id, user.subject, role]);
  const accountId = made[0].id as string;
  const {rows: workspace} = await db.query('select id from projects.workspaces where account_id = $1', [accountId]);
  committed.users.push(user.id);
  return {user, accountId, workspaceId: workspace[0].id as string, epoch: 1};
}

/** A Project, inserted directly (the owner can). */
async function project(owner: Fixture): Promise<string> {
  const {rows: made} = await db.query(
    `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'Courtyard bench', 'researching') returning id`,
    [owner.workspaceId, owner.accountId],
  );
  return made[0].id as string;
}

let sequence = 0;
/**
 * A rate schedule of one microdollar per token in and out, under a provider of its own: an overrun blocks its provider for every Account, so a case that opens an incident takes a
 * provider no other case uses (and every case takes its own, to be independent of the others).
 */
const own = (options: {inputRate?: number; outputRate?: number} = {}) => fixtureSchedule(db, {provider: `${provider}-${(sequence += 1)}`, ...options});

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as Record<string, any>;
const all = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Record<string, any>[];

/** Waits until the backend is waiting for a lock. */
async function untilBlocked(pid: number) {
  for (let poll = 0; poll < 400; poll += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The backend never waited for a lock.');
}
const pidOf = async (client: Client) => (await client.query('select pg_backend_pid() as pid')).rows[0].pid as number;

// The functions, with their amounts as numbers (every amount in this file is far below 2^53) ------------------------------------------------------------

const SETTLE = `select outcome, settlement_id, reservation_id, operation_id, period_id, classification, settled_microdollars::float8 as settled, released_microdollars::float8 as released,
                       over_microdollars::float8 as over, incident_id, state, due_at, reason, correction_id, delta_microdollars::float8 as delta
                  from api.settle_cost($1, $2, $3, $4, $5, $6, $7)`;
const RECONCILE = `select outcome, operation_id, state, reason, settlement_id, correction_id, incident_id, classification, settled_microdollars::float8 as settled,
                          released_microdollars::float8 as released, over_microdollars::float8 as over, delta_microdollars::float8 as delta
                     from api.reconcile_operation($1, $2, $3, $4, $5, $6)`;
const FINISH = `select outcome, operation_id, state, settled_microdollars::float8 as settled, released_microdollars::float8 as released, over_microdollars::float8 as over
                  from api.finish_operation($1, $2, $3, $4, $5, $6, $7, $8)`;
const SWEEP = 'select expired, cancelled, settled, marked, reconciled, failed from api.sweep_attempts()';
const LIST = 'select outcome, incidents from api.list_overrun_incidents($1, $2, $3)';
const CLEAR = 'select outcome, incident_id, cleared_at, cleared_by from api.clear_overrun_incident($1, $2, $3, $4)';

type Evidence = {input?: number; output?: number; model?: string; command?: string};
const settleCost = (accountId: string, operationId: string, classification: 'evidence' | 'deadline' | 'noncharge' | 'unused', o: Evidence = {}, client: Client = db) =>
  client.query(SETTLE, [accountId, o.command ?? randomUUID(), operationId, classification, o.input ?? null, o.output ?? null, o.model ?? null]).then((result) => result.rows[0] as Record<string, any>);
const reconcile = (operationId: string, outcome: 'evidence' | 'noncharge', o: {input?: number; output?: number; model?: string; requestId?: string} = {}, client: Client = db) =>
  client.query(RECONCILE, [operationId, outcome, o.input ?? null, o.output ?? null, o.model ?? null, o.requestId ?? null]).then((result) => result.rows[0] as Record<string, any>);
const finish = (run: {attemptId: string; fence: string}, operationId: string, outcome: string, o: {input?: number; output?: number; model?: string; requestId?: string} = {}, client: Client = db) =>
  client.query(FINISH, [run.attemptId, run.fence, operationId, outcome, o.input ?? null, o.output ?? null, o.model ?? null, o.requestId ?? null]).then((result) => result.rows[0] as Record<string, any>);
const sweep = (client: Client = db) => client.query(SWEEP).then((result) => result.rows[0] as {expired: number; cancelled: number; settled: number; marked: number; reconciled: number; failed: number});
const listIncidents = (admin: {accountId: string; epoch: number}, limit = 200, client: Client = db) =>
  client.query(LIST, [admin.accountId, admin.epoch, limit]).then((result) => result.rows[0] as {outcome: string; incidents: Record<string, any>[] | null});
const clearIncident = (admin: {accountId: string; epoch: number}, incidentId: string, command = randomUUID(), client: Client = db) =>
  client.query(CLEAR, [admin.accountId, admin.epoch, command, incidentId]).then((result) => result.rows[0] as {outcome: string; incident_id: string | null; cleared_at: Date | null; cleared_by: string | null});

/** The evidence of `input` tokens in and `output` tokens out under a schedule: at one microdollar a token it prices at their sum. */
const evidence = (s: FixtureSchedule, input: number, output: number) => ({input, output, model: s.model});
const LOW = {input: 1000, output: 100}; // 1,100 microdollars: below the reservation of 3,400
const HIGH = {input: 5000, output: 100}; // 5,100 microdollars: 1,700 above it

// Reading the records ------------------------------------------------------------------------------------------------------------------------------------

const opRow = (id: string) =>
  one(
    `select state, request_id, dispatched_at is not null as dispatched, outcome_at is not null as stamped, outcome_at::text as outcome_text, dispatched_at::text as dispatched_text,
            extract(epoch from clock_timestamp() - outcome_at)::float8 as age_seconds, outcome_at >= dispatched_at as ordered
       from jobs.operations where id = $1`,
    [id],
  );
const attemptRow = (id: string) => one('select * from jobs.attempts where id = $1', [id]);
const settlementsOf = (operationId: string) =>
  all(
    `select s.id, s.reservation_id, s.period_id, s.classification, s.settled_microdollars::float8 as settled, s.released_microdollars::float8 as released, s.input_tokens::float8 as input_tokens,
            s.output_tokens::float8 as output_tokens, s.returned_model, s.digest, s.created_at::text as created
       from usage.settlements s join usage.reservations r on r.id = s.reservation_id where r.operation_id = $1`,
    [operationId],
  );
const correctionsOf = (operationId: string) =>
  all(
    `select c.id, c.account_id, c.reservation_id, c.settlement_id, c.period_id, c.settled_delta_microdollars::float8 as delta, c.input_tokens::float8 as input_tokens,
            c.output_tokens::float8 as output_tokens, c.returned_model, c.digest, c.created_at::text as created
       from usage.corrections c join usage.reservations r on r.id = c.reservation_id where r.operation_id = $1`,
    [operationId],
  );
const incidentsOf = (accountId: string) =>
  all(
    `select i.id, i.reservation_id, i.settlement_id, i.correction_id, i.provider, i.reserved_microdollars::float8 as reserved, i.evidence_microdollars::float8 as evidence, i.cleared_at, i.cleared_by
       from usage.overrun_incidents i where i.account_id = $1 order by i.created_at, i.id`,
    [accountId],
  );
/** The figures of the Account's current period as the pages show them (carried + the period's figure). */
const figures = (accountId: string) =>
  one(
    `select p.seq, p.limit_microdollars::float8 as "limit", (p.carried_settled_microdollars + f.settled_microdollars)::float8 as settled, (p.carried_reserved_microdollars + f.reserved_microdollars)::float8 as reserved,
            f.settled_microdollars::float8 as settled_figure, f.reserved_microdollars::float8 as reserved_figure, p.carried_settled_microdollars::float8 as carried_settled
       from usage.periods p cross join lateral usage.period_figures(p.id) f where p.account_id = $1 order by p.seq desc limit 1`,
    [accountId],
  );
const availableOf = async (accountId: string) => Number((await one('select usage.available_microdollars($1)::float8 as available', [accountId])).available);
const exposure = async (jobId: string) => Number((await one('select usage.job_exposure($1)::float8 as exposure', [jobId])).exposure);
const ledger = async (accountId: string) => ({
  reservations: await count(db, 'select count(*) as n from usage.reservations where account_id = $1', [accountId]),
  settlements: await count(db, 'select count(*) as n from usage.settlements where account_id = $1', [accountId]),
  corrections: await count(db, 'select count(*) as n from usage.corrections where account_id = $1', [accountId]),
  incidents: await count(db, 'select count(*) as n from usage.overrun_incidents where account_id = $1', [accountId]),
  commands: await count(db, 'select count(*) as n from usage.commands where account_id = $1', [accountId]),
});
/** Every period of the Account reconciles: what it carries in plus its settled figure is never below nothing and never above the bound. */
async function periodsHold(accountId: string) {
  const periods = await all(
    `select p.seq, (p.carried_settled_microdollars + f.settled_microdollars)::float8 as settled from usage.periods p cross join lateral usage.period_figures(p.id) f where p.account_id = $1 order by p.seq`,
    [accountId],
  );
  for (const period of periods) {
    expect(period.settled, `period ${period.seq} settled`).toBeGreaterThanOrEqual(0);
    expect(period.settled, `period ${period.seq} settled`).toBeLessThanOrEqual(CAP);
  }
}

// Jobs, walked by the real commands -----------------------------------------------------------------------------------------------------------------------

/** The commands for one Account on the owner's connection (the functions are security definers, so the owner runs exactly what the service role would). */
const world = (a: Fixture, client: Client = db) => ({jobs: jobCommands(client, a), workers: workerCommands(client)});

type Run = Awaited<ReturnType<typeof running>>;

/** A Job of the Account accepted with `operations` (at most three) planned, reserved operations of the schedule, and claimed by the built-in step. */
async function running(a: Fixture, s: FixtureSchedule, operations = 1, projectId?: string) {
  const w = world(a);
  const pid = projectId ?? (await project(a));
  const plan = {operations: Array.from({length: operations}, (_, index) => planOperation(s, {ordinal: index + 1}))};
  const submitted = await w.jobs.submit(pid, {plan});
  expect(submitted.outcome).toBe('accepted');
  const claimed = await w.workers.claim(submitted.attempt_id);
  expect(claimed.outcome).toBe('claimed');
  const planned = (await all('select o.id from jobs.operations o join jobs.steps s on s.id = o.step_id where s.attempt_id = $1 order by o.ordinal', [submitted.attempt_id])).map((row) => row.id as string);
  return {...w, a, schedule: s, projectId: pid, jobId: submitted.job_id as string, attemptId: submitted.attempt_id as string, fence: claimed.fence as string, planned};
}

/** Dispatches the operation with the ordinal (run_step), the way a worker does before it sends anything. */
async function dispatch(run: Run, ordinal = 1): Promise<string> {
  const stepped = await run.workers.step(run.attemptId, run.fence, 'search', ordinal);
  expect(['stepped', 'replayed'], `dispatch ${ordinal}`).toContain(stepped.outcome);
  return stepped.operation_id as string;
}

/**
 * Moves a `dispatched` operation to `ambiguous` as the OWNER, with its outcome recorded `ago` before now (an interval such as `23 hours 59 minutes`). It is the very move the commands
 * make (jobs.mark_ambiguous, finish_operation(ambiguous)); only the stamp is back-dated, because the clock cannot be moved and a stamp is never rewritten.
 */
async function ambiguousSince(operationId: string, ago: string, client: Client = db) {
  const moved = await client.query(`update jobs.operations set state = 'ambiguous', outcome_at = clock_timestamp() - $2::interval where id = $1 and state = 'dispatched'`, [operationId, ago]);
  expect(moved.rowCount, 'the operation was dispatched').toBe(1);
}

/** A Job whose one operation was dispatched and then went ambiguous `ago` ago (default: a day and an hour, so it is due), the attempt still running. */
async function ambiguousJob(a: Fixture, s: FixtureSchedule, ago = '25 hours') {
  const run = await running(a, s, 1);
  const operationId = await dispatch(run);
  await ambiguousSince(operationId, ago);
  return {run, operationId};
}

/** A Job whose one operation was settled by the sweep at its deadline, so that late evidence can arrive. Needs the sweep to reach it (it is the oldest due operation). */
async function bookedAtDeadline(a: Fixture, s: FixtureSchedule) {
  const made = await ambiguousJob(a, s, '25 hours');
  const swept = await sweep();
  expect(swept.reconciled).toBeGreaterThanOrEqual(1);
  expect(await opRow(made.operationId)).toMatchObject({state: 'settled'});
  const [settlement] = await settlementsOf(made.operationId);
  expect(settlement).toMatchObject({classification: 'deadline', settled: RESERVED, released: RESERVED});
  return {...made, settlement};
}

const periodOf = async (accountId: string) => (await one('select id from usage.periods where account_id = $1 order by seq desc limit 1', [accountId])).id as string;

/**
 * `count` operations of one Account made directly by the owner, each with a reservation of 3,400 and `dispatched`: in Jobs of at most 50 operations whose attempt the owner then
 * ends (the sweep marks the dispatched operations of ended attempts), or, with `ambiguousAgo`, already `ambiguous` that long ago plus one second for each operation after the first
 * (so the order of age is fixed: the first is the oldest). Returns the operation IDs in that order.
 */
async function manyOperations(a: Fixture, s: FixtureSchedule, total: number, options: {endAttempts?: boolean; ambiguousAgoSeconds?: number} = {}) {
  const period = await periodOf(a.accountId);
  const ids: string[] = [];
  for (let made = 0; made < total; made += 50) {
    const size = Math.min(50, total - made);
    const job = await ledgerJob(db, a.accountId, size);
    for (const operationId of job.operationIds) {
      await insertReservation(db, {accountId: a.accountId, periodId: period, jobId: job.jobId, operationId, amount: RESERVED, scheduleId: s.id});
      await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() where id = $1`, [operationId]);
      if (options.ambiguousAgoSeconds !== undefined) {
        await db.query(`update jobs.operations set state = 'ambiguous', outcome_at = clock_timestamp() - make_interval(secs => $2) where id = $1`, [operationId, options.ambiguousAgoSeconds - ids.length]);
      }
      ids.push(operationId);
    }
    if (options.endAttempts) await db.query(`update jobs.attempts set state = 'completed', ended_at = clock_timestamp() where id = $1`, [job.attemptId]);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------------
describe('ambiguous outcome: finish_operation(ambiguous) keeps the whole reservation and the Job\'s retry waits', () => {
  it('moves a dispatched operation to ambiguous and stamps outcome_at, settles nothing, keeps the request ID, and makes the Job\'s retry wait (blocked, awaiting_reconciliation)', async () => {
    const a = await committedAccount();
    const run = await running(a, await own());
    const operationId = await dispatch(run);
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
    const before = await ledger(a.accountId);

    const done = await finish(run, operationId, 'ambiguous', {requestId: 'req_amb_1'});
    expect(done).toEqual({outcome: 'finished', operation_id: operationId, state: 'ambiguous', settled: null, released: null, over: null});
    expect(await opRow(operationId)).toMatchObject({state: 'ambiguous', request_id: 'req_amb_1', dispatched: true, stamped: true, ordered: true});
    expect((await opRow(operationId)).age_seconds).toBeLessThan(60);
    // Nothing was settled: the reservation is held whole, the Job's exposure is the reservation, and the ledger only gained the receipt of the move.
    expect(await settlementsOf(operationId)).toEqual([]);
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
    expect(await exposure(run.jobId)).toBe(RESERVED);
    expect(await ledger(a.accountId)).toEqual(before);

    // The attempt fails; the retry waits for the charge, and the gate says so.
    expect((await run.workers.finish(run.attemptId, run.fence, 'failed')).outcome).toBe('finished');
    const retry = await run.jobs.retry(run.jobId, 1);
    expect(retry).toMatchObject({outcome: 'created', reason: 'awaiting_reconciliation'});
    expect((await run.jobs.detail(run.jobId)).reason).toBe('awaiting_reconciliation');
    expect(await run.workers.claim(retry.attempt_id)).toMatchObject({outcome: 'blocked', state: 'waiting'});
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [retry.attempt_id])).toBe(0);
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
  });

  it('takes no request ID: the report is allowed without one, and the stored request ID is never changed by a later report', async () => {
    const a = await committedAccount();
    const run = await running(a, await own());
    const operationId = await dispatch(run);
    expect(await finish(run, operationId, 'ambiguous')).toMatchObject({outcome: 'finished', state: 'ambiguous'});
    expect(await opRow(operationId)).toMatchObject({state: 'ambiguous', request_id: null, stamped: true});
  });

  it('answers a second report with a WORD and never raises 55000: the same report is finished again (nothing new), another request ID, a completion and a noncharge-less state are invalid_transition', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s);
    const operationId = await dispatch(run);
    await finish(run, operationId, 'ambiguous', {requestId: 'req_amb_2'});
    const stamp = (await opRow(operationId)).outcome_text;
    const before = await ledger(a.accountId);
    // The same report, with and without the request ID the operation already has: a replay.
    expect(await finish(run, operationId, 'ambiguous', {requestId: 'req_amb_2'})).toMatchObject({outcome: 'finished', state: 'ambiguous'});
    expect(await finish(run, operationId, 'ambiguous')).toMatchObject({outcome: 'finished', state: 'ambiguous'});
    // Another request ID, or a completion: a word. (A completion cannot follow an ambiguous report in this command: the operation is reconciled by api.reconcile_operation.)
    expect(await finish(run, operationId, 'ambiguous', {requestId: 'req_other'})).toMatchObject({outcome: 'invalid_transition', state: 'ambiguous'});
    expect(await finish(run, operationId, 'completed', evidence(s, 10, 10))).toMatchObject({outcome: 'invalid_transition', state: 'ambiguous'});
    expect(await opRow(operationId)).toMatchObject({state: 'ambiguous', outcome_text: stamp, request_id: 'req_amb_2'});
    expect(await ledger(a.accountId)).toEqual(before);
    // A planned operation was never dispatched; an unknown one is not this attempt's.
    const second = await running(a, s);
    expect(await finish(second, second.planned[0], 'ambiguous')).toMatchObject({outcome: 'not_dispatched'});
    expect(await finish(second, randomUUID(), 'ambiguous')).toMatchObject({outcome: 'not_found'});
  });

  it('answers a refused completion with a word and undoes the move: another model is invalid_evidence, other evidence after a completion is invalid_transition, a replay is finished again', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s, 2);
    const first = await dispatch(run, 1);
    const second = await dispatch(run, 2);
    // A model other than the pinned one is refused, the move is undone (the operation is still dispatched, with no stamp), and nothing is written.
    const before = await ledger(a.accountId);
    expect(await finish(run, first, 'completed', {input: 10, output: 10, model: 'another-model'})).toMatchObject({outcome: 'invalid_evidence', state: 'dispatched'});
    expect(await opRow(first)).toMatchObject({state: 'dispatched', stamped: false});
    expect(await ledger(a.accountId)).toEqual(before);
    // The caller's answer to a refused report is `ambiguous`.
    expect(await finish(run, first, 'ambiguous')).toMatchObject({outcome: 'finished', state: 'ambiguous'});
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: 2 * RESERVED});

    // A completion settles; the same completion again is finished (a replay); other evidence is already_settled and leaves the operation completed and the settlement as it was.
    expect(await finish(run, second, 'completed', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'finished', state: 'completed', settled: 1100, released: RESERVED, over: 0});
    const [settlement] = await settlementsOf(second);
    expect(await finish(run, second, 'completed', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'finished', state: 'completed', settled: 1100});
    // Other evidence for the same completion finds the settlement command it used before with another payload: a word (invalid_transition), the operation still completed.
    expect(await finish(run, second, 'completed', evidence(s, LOW.input + 1, LOW.output))).toMatchObject({outcome: 'invalid_transition', state: 'completed'});
    expect(await opRow(second)).toMatchObject({state: 'completed'});
    expect(await settlementsOf(second)).toEqual([settlement]);
    // A noncharge cannot follow a completion.
    expect(await finish(run, second, 'noncharge', {requestId: 'req_late'})).toMatchObject({outcome: 'invalid_transition', state: 'completed'});
    expect(await settlementsOf(second)).toEqual([settlement]);
  });

  it('answers already_settled, and undoes the move, when a noncharge is reported for an ambiguous operation that was settled by hand; the application\'s downgrade is ambiguous again; reconcile_operation completes the move', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s);
    const operationId = await dispatch(run);
    expect(await finish(run, operationId, 'ambiguous', {requestId: 'req_nc_hand'})).toMatchObject({outcome: 'finished', state: 'ambiguous'});
    // The owner of the ledger (a bare settle_cost) settled it as evidence without moving the operation: it is still ambiguous, and its gate is still closed.
    const bare = await settleCost(a.accountId, operationId, 'evidence', evidence(s, LOW.input, LOW.output));
    expect(bare).toMatchObject({outcome: 'settled', settled: 1100});
    expect(await opRow(operationId)).toMatchObject({state: 'ambiguous'});
    const before = await ledger(a.accountId);
    expect(await finish(run, operationId, 'noncharge', {requestId: 'req_nc_hand'})).toMatchObject({outcome: 'already_settled', state: 'ambiguous'});
    expect(await opRow(operationId)).toMatchObject({state: 'ambiguous', request_id: 'req_nc_hand'});
    expect(await ledger(a.accountId)).toEqual(before);
    // The application reports the refused noncharge as ambiguous, which the ambiguous operation takes as the replay it is.
    const reported = await reportOutcome({attemptId: run.attemptId, fence: run.fence, operationId}, {outcome: 'noncharge', requestId: 'req_nc_hand', status: 422}, {env});
    expect(reported).toMatchObject({reported: 'ambiguous', downgraded: true, finish: {outcome: 'finished', state: 'ambiguous'}});
    expect(await ledger(a.accountId)).toEqual(before);
    // The same evidence through reconcile_operation finds the settlement (a replay) and finishes the move: the operation is settled and the gate opens.
    expect(await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'reconciled', state: 'settled', settlement_id: bare.settlement_id, settled: 1100});
    expect(await opRow(operationId)).toMatchObject({state: 'settled'});
    expect(await settlementsOf(operationId)).toHaveLength(1);
  });

  it('raises 22023 for an ambiguous report that carries usage or a request ID that is not printable ASCII, and writes nothing', async () => {
    const a = await committedAccount();
    const run = await running(a, await own());
    const operationId = await dispatch(run);
    const before = await ledger(a.accountId);
    for (const [label, params] of [
      ['tokens', [run.attemptId, run.fence, operationId, 'ambiguous', 1, null, null, null]],
      ['output tokens', [run.attemptId, run.fence, operationId, 'ambiguous', null, 1, null, null]],
      ['a model', [run.attemptId, run.fence, operationId, 'ambiguous', null, null, 'claude-test', null]],
      ['a request ID with a space', [run.attemptId, run.fence, operationId, 'ambiguous', null, null, null, 'req 1']],
      ['an empty request ID', [run.attemptId, run.fence, operationId, 'ambiguous', null, null, null, '']],
      ['a request ID of 201 characters', [run.attemptId, run.fence, operationId, 'ambiguous', null, null, null, 'r'.repeat(201)]],
      ['an unknown outcome', [run.attemptId, run.fence, operationId, 'maybe', null, null, null, null]],
      ['a completion with a request ID', [run.attemptId, run.fence, operationId, 'completed', 1, 1, 'm', 'req_1']],
      ['a noncharge without a request ID', [run.attemptId, run.fence, operationId, 'noncharge', null, null, null, null]],
    ] as const) {
      const result = await attempt(db, null, FINISH, [...params]);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('22023');
    }
    expect(await opRow(operationId)).toMatchObject({state: 'dispatched'});
    expect(await ledger(a.accountId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('lost attempt: the sweep marks a dispatched operation of an ended attempt ambiguous, and cancelling releases only the planned ones', () => {
  it('marks the dispatched operation of an attempt whose lease ran out (the 24-hour clock starts), keeps its reservation, releases the planned one, and does it once', async () => {
    const a = await committedAccount();
    const run = await running(a, await own(), 2);
    const first = await dispatch(run, 1);
    const second = run.planned[1];
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: 2 * RESERVED});
    await backdateLease(db, run.attemptId, 5);
    const swept = await sweep();
    expect(swept.expired).toBeGreaterThanOrEqual(1);
    expect(swept.marked).toBeGreaterThanOrEqual(1);
    expect(await attemptRow(run.attemptId)).toMatchObject({state: 'failed', reason: 'lease_lost'});
    // The dispatched operation is ambiguous, stamped now; the one that never went out is abandoned and released; the dispatched one is held whole.
    expect(await opRow(first)).toMatchObject({state: 'ambiguous', stamped: true, ordered: true});
    expect((await opRow(first)).age_seconds).toBeLessThan(60);
    expect(await opRow(second)).toMatchObject({state: 'abandoned', stamped: false});
    expect((await settlementsOf(second)).map((row) => [row.classification, row.settled, row.released])).toEqual([['unused', 0, RESERVED]]);
    expect(await settlementsOf(first)).toEqual([]);
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
    // The retry waits for it.
    const retry = await run.jobs.retry(run.jobId, 1);
    expect(retry).toMatchObject({outcome: 'created', reason: 'awaiting_reconciliation'});
    expect(await run.workers.claim(retry.attempt_id)).toMatchObject({outcome: 'blocked'});
    // A second sweep changes nothing about it: the stamp stays the first one.
    const stamp = (await opRow(first)).outcome_text;
    await sweep();
    expect(await opRow(first)).toMatchObject({state: 'ambiguous', outcome_text: stamp});
    expect(await settlementsOf(first)).toEqual([]);
  });

  it('cancels a Job: the dispatched operation stays dispatched and held (cancel releases only the planned ones), and the next sweep marks it ambiguous', async () => {
    const a = await committedAccount();
    const run = await running(a, await own(), 2);
    const first = await dispatch(run, 1);
    const cancelled = await run.jobs.cancel(run.jobId);
    expect(cancelled).toMatchObject({outcome: 'cancelled', state: 'cancelled', released: 1});
    expect(await opRow(first)).toMatchObject({state: 'dispatched', stamped: false});
    expect(await opRow(run.planned[1])).toMatchObject({state: 'abandoned'});
    expect((await all(`select classification from usage.settlements where account_id = $1`, [a.accountId])).map((row) => row.classification)).toEqual(['unused']);
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
    const swept = await sweep();
    expect(swept.marked).toBeGreaterThanOrEqual(1);
    expect(await opRow(first)).toMatchObject({state: 'ambiguous', stamped: true});
    expect(await settlementsOf(first)).toEqual([]);
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
    expect(await attemptRow(run.attemptId)).toMatchObject({state: 'cancelled', reason: 'user_cancelled'});
  });

  it('marks the dispatched operation of an Account that is disabled too (no authority is asked: the clock must start anyway), and keeps the reservation held', async () => {
    const a = await committedAccount();
    const run = await running(a, await own(), 1);
    const first = await dispatch(run);
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    // The sweep cancels the attempt first (account_disabled), then marks what it left dispatched.
    const swept = await sweep();
    expect(swept.cancelled).toBeGreaterThanOrEqual(1);
    expect(swept.marked).toBeGreaterThanOrEqual(1);
    expect(await attemptRow(run.attemptId)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await opRow(first)).toMatchObject({state: 'ambiguous', stamped: true});
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
    // Disabling kept the reservation: only evidence, a proven noncharge or the deadline releases it.
    expect(await settlementsOf(first)).toEqual([]);
  });

  it('leaves the dispatched operation of an attempt that is still running alone', async () => {
    const a = await committedAccount();
    const run = await running(a, await own(), 1);
    const first = await dispatch(run);
    await sweep();
    expect(await opRow(first)).toMatchObject({state: 'dispatched', stamped: false});
    expect(await attemptRow(run.attemptId)).toMatchObject({state: 'running'});
  });

  it('marks the dispatched operations of attempts that completed, failed and were cancelled, at most 100 for each sweep and oldest dispatch first', async () => {
    const a = await committedAccount();
    const s = await own();
    const ids = await manyOperations(a, s, 102, {endAttempts: true});
    const first = await sweep();
    expect(first.marked).toBe(100);
    const states = async () => (await all(`select state, count(*)::int as n from jobs.operations where id = any($1) group by 1 order by 1`, [ids])).map((row) => [row.state, row.n]);
    expect(await states()).toEqual([['ambiguous', 100], ['dispatched', 2]]);
    // Oldest dispatch first: every one left over was dispatched no earlier than every one marked.
    const order = await one(
      `select (select max(dispatched_at) from jobs.operations where id = any($1) and state = 'ambiguous') <= (select min(dispatched_at) from jobs.operations where id = any($1) and state = 'dispatched') as oldest_first`,
      [ids],
    );
    expect(order.oldest_first).toBe(true);
    expect((await sweep()).marked).toBeGreaterThanOrEqual(2);
    expect(await states()).toEqual([['ambiguous', 102]]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('definitive noncharge: settled 0, the whole reservation released, the gate open', () => {
  it('finish_operation(noncharge) with the provider\'s request ID settles 0 and releases everything; the Job\'s retry then runs', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s);
    const operationId = await dispatch(run);
    expect(await finish(run, operationId, 'noncharge', {requestId: 'req_422_1'})).toMatchObject({outcome: 'finished', state: 'noncharge', settled: 0, released: RESERVED, over: 0});
    expect(await opRow(operationId)).toMatchObject({state: 'noncharge', request_id: 'req_422_1', stamped: true});
    expect((await settlementsOf(operationId)).map((row) => [row.classification, row.settled, row.released])).toEqual([['noncharge', 0, RESERVED]]);
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: 0});
    expect(await exposure(run.jobId)).toBe(0);
    expect((await run.workers.finish(run.attemptId, run.fence, 'failed')).outcome).toBe('finished');
    const retry = await run.jobs.retry(run.jobId, 1);
    expect(retry).toMatchObject({outcome: 'created', reason: 'awaiting_dispatch'});
    expect((await run.workers.claim(retry.attempt_id)).outcome).toBe('claimed');
  });

  it('is refused without a request ID (22023): the caller then reports the operation ambiguous', async () => {
    const a = await committedAccount();
    const run = await running(a, await own());
    const operationId = await dispatch(run);
    const result = await attempt(db, null, FINISH, [run.attemptId, run.fence, operationId, 'noncharge', null, null, null, null]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('22023');
    expect(await opRow(operationId)).toMatchObject({state: 'dispatched'});
    expect(await finish(run, operationId, 'ambiguous')).toMatchObject({outcome: 'finished', state: 'ambiguous'});
  });

  it('reconcile_operation(noncharge) moves an ambiguous operation to noncharge with the request ID and settles 0; the same proof again is replayed', async () => {
    const a = await committedAccount();
    const { run, operationId } = await ambiguousJob(a, await own(), '2 hours');
    expect((await run.workers.finish(run.attemptId, run.fence, 'failed')).outcome).toBe('finished');
    const retry = await run.jobs.retry(run.jobId, 1);
    expect(retry.reason).toBe('awaiting_reconciliation');
    expect((await run.workers.claim(retry.attempt_id)).outcome).toBe('blocked');

    const done = await reconcile(operationId, 'noncharge', {requestId: 'req_422_2'});
    expect(done).toMatchObject({outcome: 'reconciled', operation_id: operationId, state: 'noncharge', classification: 'noncharge', settled: 0, released: RESERVED, over: 0, incident_id: null, correction_id: null});
    expect(await opRow(operationId)).toMatchObject({state: 'noncharge', request_id: 'req_422_2', stamped: true});
    expect((await settlementsOf(operationId)).map((row) => [row.classification, row.settled, row.released])).toEqual([['noncharge', 0, RESERVED]]);
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: 0});
    // The gate is open: the waiting retry runs.
    expect((await run.jobs.detail(run.jobId)).reason).toBe('awaiting_dispatch');
    expect((await run.workers.claim(retry.attempt_id)).outcome).toBe('claimed');
    // The same proof again (and one with another request ID, which cannot change the stored one) is replayed, and writes nothing.
    const before = await ledger(a.accountId);
    expect(await reconcile(operationId, 'noncharge', {requestId: 'req_422_2'})).toMatchObject({outcome: 'replayed', state: 'noncharge', settlement_id: done.settlement_id});
    expect(await reconcile(operationId, 'noncharge', {requestId: 'req_other'})).toMatchObject({outcome: 'replayed', state: 'noncharge'});
    expect((await opRow(operationId)).request_id).toBe('req_422_2');
    expect(await ledger(a.accountId)).toEqual(before);
    // Evidence for a noncharge is not reconciled.
    expect(await reconcile(operationId, 'evidence', evidence(run.schedule, 1, 1))).toMatchObject({outcome: 'not_reconcilable', state: 'noncharge'});
  });

  it('keeps the operation\'s own request ID when it already has one, and proves a noncharge after an ambiguous report without one', async () => {
    const a = await committedAccount();
    const run = await running(a, await own());
    const operationId = await dispatch(run);
    await finish(run, operationId, 'ambiguous', {requestId: 'req_first'});
    expect(await reconcile(operationId, 'noncharge', {requestId: 'req_second'})).toMatchObject({outcome: 'reconciled', state: 'noncharge'});
    expect((await opRow(operationId)).request_id).toBe('req_first');
  });

  it('does not reconcile a noncharge proven after a deadline booking (left for others): not_reconcilable, nothing written', async () => {
    const a = await committedAccount();
    const { operationId } = await bookedAtDeadline(a, await own());
    const before = await ledger(a.accountId);
    expect(await reconcile(operationId, 'noncharge', {requestId: 'req_late'})).toMatchObject({outcome: 'not_reconcilable', state: 'settled'});
    expect(await ledger(a.accountId)).toEqual(before);
    expect(await opRow(operationId)).toMatchObject({state: 'settled', request_id: null});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('evidence in time: reconcile_operation and finish_operation(completed) settle at the priced evidence', () => {
  it('reconcile_operation(evidence) settles an ambiguous operation at the evidence, releases the remainder, moves it to settled and opens the gate for the waiting retry', async () => {
    const a = await committedAccount();
    const s = await own();
    const { run, operationId } = await ambiguousJob(a, s, '2 hours');
    expect((await run.workers.finish(run.attemptId, run.fence, 'failed')).outcome).toBe('finished');
    const retry = await run.jobs.retry(run.jobId, 1);
    expect((await run.workers.claim(retry.attempt_id)).outcome).toBe('blocked');

    const done = await reconcile(operationId, 'evidence', {...evidence(s, LOW.input, LOW.output), requestId: 'req_ev_1'});
    expect(done).toMatchObject({
      outcome: 'reconciled', operation_id: operationId, state: 'settled', classification: 'evidence', settled: 1100, released: RESERVED, over: 0, incident_id: null, correction_id: null, delta: null, reason: null,
    });
    expect(await opRow(operationId)).toMatchObject({state: 'settled', request_id: 'req_ev_1'});
    expect(await settlementsOf(operationId)).toEqual([
      expect.objectContaining({classification: 'evidence', settled: 1100, released: RESERVED, input_tokens: 1000, output_tokens: 100, returned_model: s.model, id: done.settlement_id}),
    ]);
    expect(await figures(a.accountId)).toMatchObject({settled: 1100, reserved: 0});
    expect(await exposure(run.jobId)).toBe(1100);
    expect(await incidentsOf(a.accountId)).toEqual([]);
    // The gate is open: the waiting retry runs.
    expect((await run.workers.claim(retry.attempt_id)).outcome).toBe('claimed');
    // The same evidence is replayed (nothing new), other evidence is already_settled, and neither changes the ledger.
    const before = await ledger(a.accountId);
    expect(await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'replayed', state: 'settled', settlement_id: done.settlement_id, settled: 1100});
    expect(await reconcile(operationId, 'evidence', evidence(s, LOW.input + 1, LOW.output))).toMatchObject({outcome: 'already_settled', state: 'settled', settlement_id: done.settlement_id, settled: 1100});
    expect(await ledger(a.accountId)).toEqual(before);
  });

  it('settles evidence equal to the reservation at the reservation, with no incident', async () => {
    const a = await committedAccount();
    const s = await own();
    const { operationId } = await ambiguousJob(a, s, '1 hour');
    expect(await reconcile(operationId, 'evidence', evidence(s, 3300, 100))).toMatchObject({outcome: 'reconciled', settled: RESERVED, released: RESERVED, over: 0, incident_id: null});
    expect(await incidentsOf(a.accountId)).toEqual([]);
  });

  it('settles an operation that reports its completion in time as evidence, state completed', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s);
    const operationId = await dispatch(run);
    expect(await finish(run, operationId, 'completed', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'finished', state: 'completed', settled: 1100, released: RESERVED, over: 0});
    expect(await figures(a.accountId)).toMatchObject({settled: 1100, reserved: 0});
    // And evidence for a completed operation is a replay for the same evidence and already_settled for other.
    expect(await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'replayed', state: 'completed'});
    expect(await reconcile(operationId, 'evidence', evidence(s, 1, 1))).toMatchObject({outcome: 'already_settled', state: 'completed'});
  });

  it('refuses a returned model other than the pinned one as invalid_evidence/model_mismatch in every door, writes nothing, and the caller\'s downgrade to ambiguous holds the whole reservation', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s, 1);
    const first = await dispatch(run, 1);
    const before = await ledger(a.accountId);
    // finish_operation(completed): a word, the move undone, nothing written.
    expect(await finish(run, first, 'completed', {input: 10, output: 10, model: 'another-model'})).toMatchObject({outcome: 'invalid_evidence', state: 'dispatched'});
    expect(await opRow(first)).toMatchObject({state: 'dispatched', stamped: false});
    expect(await ledger(a.accountId)).toEqual(before);
    // The application's downgrade (lib/operation-outcome.ts) reports the same completion ambiguous, and says so.
    const reported = await reportOutcome(
      {attemptId: run.attemptId, fence: run.fence, operationId: first},
      {outcome: 'completed', value: null, requestId: 'req_mm_1', returnedModel: 'another-model', inputTokens: 10, outputTokens: 10},
      {env},
    );
    expect(reported).toMatchObject({reported: 'ambiguous', downgraded: true, finish: {outcome: 'finished', state: 'ambiguous'}});
    expect(await opRow(first)).toMatchObject({state: 'ambiguous', request_id: 'req_mm_1', stamped: true});
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
    // The settlement itself, and reconcile_operation, on the ambiguous one: invalid_evidence (the settlement says why), the operation stays ambiguous, nothing is written.
    const refusal = await settleCost(a.accountId, first, 'evidence', {input: 10, output: 10, model: 'another-model'});
    expect(refusal).toMatchObject({outcome: 'invalid_evidence', reason: 'model_mismatch', settlement_id: null, settled: null});
    expect(await reconcile(first, 'evidence', {input: 10, output: 10, model: 'another-model'})).toMatchObject({outcome: 'invalid_evidence', state: 'ambiguous'});
    expect(await opRow(first)).toMatchObject({state: 'ambiguous'});
    expect(await settlementsOf(first)).toEqual([]);
    // The pinned model is accepted later.
    expect(await reconcile(first, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'reconciled', state: 'settled', settled: 1100});
  });

  it('refuses evidence that prices above 1e15 as invalid_evidence/overflow (a different reason from the model), writing nothing', async () => {
    const a = await committedAccount();
    const dear = await fixtureSchedule(db, {provider: `${provider}-dear`, inputRate: 1_000_000_000_000, outputRate: 0});
    // The owner makes the reservation: admission would refuse a request this dear.
    const job = await ledgerJob(db, a.accountId, 1);
    await insertReservation(db, {accountId: a.accountId, periodId: await periodOf(a.accountId), jobId: job.jobId, operationId: job.operationIds[0], amount: 1, scheduleId: dear.id});
    await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() where id = $1`, [job.operationIds[0]]);
    await ambiguousSince(job.operationIds[0], '1 hour');
    const before = await ledger(a.accountId);
    expect(await settleCost(a.accountId, job.operationIds[0], 'evidence', {input: 1001, output: 0, model: dear.model})).toMatchObject({outcome: 'invalid_evidence', reason: 'overflow', settlement_id: null});
    expect(await reconcile(job.operationIds[0], 'evidence', {input: 1001, output: 0, model: dear.model})).toMatchObject({outcome: 'invalid_evidence', state: 'ambiguous'});
    expect(await ledger(a.accountId)).toEqual(before);
  });

  it('answers a second, different completion with a word (invalid_transition) that the application does not downgrade, and never an exception', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s);
    const operationId = await dispatch(run);
    expect(await finish(run, operationId, 'completed', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'finished', state: 'completed'});
    const before = await ledger(a.accountId);
    const again = await reportOutcome({attemptId: run.attemptId, fence: run.fence, operationId}, {outcome: 'completed', value: null, requestId: null, returnedModel: s.model, inputTokens: 7, outputTokens: 7}, {env});
    expect(again).toMatchObject({reported: 'completed', downgraded: false, finish: {outcome: 'invalid_transition'}});
    expect(await ledger(a.accountId)).toEqual(before);
    expect(await opRow(operationId)).toMatchObject({state: 'completed'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the deadline: the sweep settles exactly the reservation, class deadline, 24 hours after the outcome, once', () => {
  it('does nothing for 23 hours 59 minutes, settles exactly the reservation at 24 hours (class deadline), moves the operation to settled, and a second sweep changes nothing', async () => {
    const a = await committedAccount();
    const run = await running(a, await own(), 2);
    const early = await dispatch(run, 1);
    const due = await dispatch(run, 2);
    await ambiguousSince(early, '23 hours 59 minutes');
    await ambiguousSince(due, '24 hours');
    const stamps = [(await opRow(early)).outcome_text, (await opRow(due)).outcome_text];
    const swept = await sweep();
    expect(swept.reconciled).toBeGreaterThanOrEqual(1);
    // Just before the deadline: nothing. At it: exactly the reservation, a deadline settlement, and the operation is settled with its record of being ambiguous kept.
    expect(await opRow(early)).toMatchObject({state: 'ambiguous', outcome_text: stamps[0]});
    expect(await settlementsOf(early)).toEqual([]);
    expect(await opRow(due)).toMatchObject({state: 'settled', outcome_text: stamps[1]});
    const settlements = await settlementsOf(due);
    expect(settlements).toEqual([expect.objectContaining({classification: 'deadline', settled: RESERVED, released: RESERVED, input_tokens: null, output_tokens: null, returned_model: null})]);
    expect(await figures(a.accountId)).toMatchObject({settled: RESERVED, reserved: RESERVED});
    expect(await exposure(run.jobId)).toBe(2 * RESERVED);
    expect(await incidentsOf(a.accountId)).toEqual([]);
    // A second sweep changes nothing: no new settlement, no change to the operation, the same figures.
    const before = await ledger(a.accountId);
    const again = await sweep();
    expect(again.failed).toBe(0);
    expect(await ledger(a.accountId)).toEqual(before);
    expect(await settlementsOf(due)).toEqual(settlements);
    expect(await opRow(early)).toMatchObject({state: 'ambiguous', outcome_text: stamps[0]});
    expect(await figures(a.accountId)).toMatchObject({settled: RESERVED, reserved: RESERVED});
  });

  it('opens the gate for a waiting retry: it runs now, and its reason reads awaiting_dispatch', async () => {
    const a = await committedAccount();
    const { run, operationId } = await ambiguousJob(a, await own(), '25 hours');
    expect((await run.workers.finish(run.attemptId, run.fence, 'failed')).outcome).toBe('finished');
    const retry = await run.jobs.retry(run.jobId, 1);
    expect(retry.reason).toBe('awaiting_reconciliation');
    expect((await run.workers.claim(retry.attempt_id)).outcome).toBe('blocked');
    const swept = await sweep();
    expect(swept.reconciled).toBeGreaterThanOrEqual(1);
    expect(await opRow(operationId)).toMatchObject({state: 'settled'});
    expect((await run.jobs.detail(run.jobId)).reason).toBe('awaiting_dispatch');
    expect((await run.workers.claim(retry.attempt_id)).outcome).toBe('claimed');
    // Held by nothing now: the reservation is booked, not released.
    expect(await figures(a.accountId)).toMatchObject({settled: RESERVED, reserved: 0});
  });

  it('settles for an Account that is disabled (no authority is asked), and an operation that was marked by the sweep itself is not due for 24 hours', async () => {
    const a = await committedAccount();
    const { operationId } = await ambiguousJob(a, await own(), '25 hours');
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    await sweep();
    expect(await opRow(operationId)).toMatchObject({state: 'settled'});
    expect((await settlementsOf(operationId)).map((row) => row.classification)).toEqual(['deadline']);
    // A lost lease starts the clock now: that operation is not settled by the sweep that marked it.
    const b = await committedAccount();
    const run = await running(b, await own(), 1);
    const lost = await dispatch(run);
    await backdateLease(db, run.attemptId, 5);
    await sweep();
    expect(await opRow(lost)).toMatchObject({state: 'ambiguous'});
    expect(await settlementsOf(lost)).toEqual([]);
  });

  it('settles at most 100 for each sweep, oldest outcome first, and the rest on the next', async () => {
    const a = await committedAccount();
    const s = await own();
    // 102 ambiguous operations, each due: the first is the oldest by 400 days and a second for each after it.
    const ids = await manyOperations(a, s, 102, {ambiguousAgoSeconds: 400 * 86_400});
    const first = await sweep();
    expect(first.reconciled).toBe(100);
    const settledIds = (await all(`select id from jobs.operations where id = any($1) and state = 'settled' order by outcome_at`, [ids])).map((row) => row.id as string);
    const left = (await all(`select id from jobs.operations where id = any($1) and state = 'ambiguous'`, [ids])).map((row) => row.id as string);
    expect(settledIds).toHaveLength(100);
    expect(left).toHaveLength(2);
    // Oldest first: the two left over are the two NEWEST outcomes.
    expect(left.sort()).toEqual(ids.slice(-2).sort());
    const second = await sweep();
    expect(second.reconciled).toBeGreaterThanOrEqual(2);
    expect(await count(db, `select count(*) as n from jobs.operations where id = any($1) and state = 'settled'`, [ids])).toBe(102);
    expect(await count(db, `select count(*) as n from usage.settlements where account_id = $1 and classification = 'deadline'`, [a.accountId])).toBe(102);
    expect(await figures(a.accountId)).toMatchObject({settled: 102 * RESERVED, reserved: 0});
  });

  it('keeps a deadline settlement from happening early by hand: settle_cost(deadline) says not_due before the 24 hours and the due time is exactly 24 hours after outcome_at', async () => {
    const a = await committedAccount();
    const { operationId } = await ambiguousJob(a, await own(), '23 hours 59 minutes');
    const before = await ledger(a.accountId);
    const refused = await settleCost(a.accountId, operationId, 'deadline');
    expect(refused).toMatchObject({outcome: 'not_due', settlement_id: null});
    const due = (await one(`select (outcome_at + interval '24 hours') as due from jobs.operations where id = $1`, [operationId])).due as Date;
    expect(new Date(refused.due_at).getTime()).toBe(due.getTime());
    expect(await ledger(a.accountId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------
const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Removes the Accounts' data now (a case that leaves an operation the sweep can never settle, or a period filled to its bound, must not leave it for the cases after it). `retireLater`
 * does it when the case ends, passed or failed, and `retire` at the point where the case wants it gone.
 */
const retire = (...accounts: Fixture[]) => cleanup(db, accounts.map((account) => account.user.id), []);
const doomed: Fixture[] = [];
const retireLater = (...accounts: Fixture[]) => void doomed.push(...accounts);
afterEach(async () => {
  if (doomed.length) await retire(...doomed.splice(0));
});

/** The Administrator changes a limit or resets the count, as the service role calls api.set_usage_limit. */
async function changeLimit(admin: Fixture, target: Fixture, kind: 'change' | 'reset', limit: number | null, expectedSeq: number) {
  return one('select outcome, seq from api.set_usage_limit($1, $2, $3, $4, $5, $6, $7, $8)', [`user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), kind, limit, expectedSeq]);
}

/** A submission of one planned operation of the schedule by the Account: the admission (api.submit_job) says whether the provider is blocked. */
async function submitOne(a: Fixture, s: FixtureSchedule) {
  return world(a).jobs.submit(await project(a), {plan: {operations: [planOperation(s)]}});
}

describe('late evidence: after a deadline booking one correction row is appended, the settlement is never edited', () => {
  const doors = ['reconcile_operation', 'settle_cost'] as const;
  type Door = (typeof doors)[number];
  const late = (door: Door, accountId: string, operationId: string, s: FixtureSchedule, e: {input: number; output: number}) =>
    door === 'reconcile_operation' ? reconcile(operationId, 'evidence', evidence(s, e.input, e.output)) : settleCost(accountId, operationId, 'evidence', evidence(s, e.input, e.output));
  const other = (door: Door): Door => (door === 'settle_cost' ? 'reconcile_operation' : 'settle_cost');

  it.each(doors)('lower evidence through %s releases the difference: one correction, the settlement row unchanged, the same evidence replayed, other evidence already_settled', async (door) => {
    const a = await committedAccount();
    const s = await own();
    const {run, operationId, settlement} = await bookedAtDeadline(a, s);
    expect(await figures(a.accountId)).toMatchObject({settled: RESERVED, reserved: 0});
    const available = await availableOf(a.accountId);

    const answer = await late(door, a.accountId, operationId, s, LOW);
    expect(answer).toMatchObject({outcome: 'corrected', operation_id: operationId, classification: 'deadline', settled: RESERVED, released: RESERVED, over: 0, incident_id: null, delta: -2300, settlement_id: settlement.id});
    expect(answer.correction_id).toMatch(uuidLike);
    expect(await correctionsOf(operationId)).toEqual([
      expect.objectContaining({id: answer.correction_id, account_id: a.accountId, settlement_id: settlement.id, delta: -2300, input_tokens: 1000, output_tokens: 100, returned_model: s.model, period_id: await periodOf(a.accountId)}),
    ]);
    // The booking is as it was; the figures, the headroom and the Job's exposure follow the correction.
    expect(await settlementsOf(operationId)).toEqual([settlement]);
    expect(await figures(a.accountId)).toMatchObject({settled: 1100, reserved: 0});
    expect(await availableOf(a.accountId)).toBe(available + 2300);
    expect(await exposure(run.jobId)).toBe(1100);
    expect(await incidentsOf(a.accountId)).toEqual([]);
    expect(await opRow(operationId)).toMatchObject({state: 'settled'});
    await periodsHold(a.accountId);

    // The same evidence through either door is replayed, with the same correction; other evidence is refused and carries the correction. Nothing more is written.
    const before = await ledger(a.accountId);
    for (const through of [door, other(door)]) {
      expect(await late(through, a.accountId, operationId, s, LOW), through).toMatchObject({outcome: 'replayed', correction_id: answer.correction_id, delta: -2300, settlement_id: settlement.id, incident_id: null});
      expect(await late(through, a.accountId, operationId, s, {input: LOW.input + 1, output: LOW.output}), through).toMatchObject({outcome: 'already_settled', correction_id: answer.correction_id, delta: -2300, settlement_id: settlement.id});
    }
    const after = await ledger(a.accountId);
    expect({...after, commands: before.commands}).toEqual(before);
    expect(await correctionsOf(operationId)).toHaveLength(1);
    expect(await settlementsOf(operationId)).toEqual([settlement]);
    expect(await figures(a.accountId)).toMatchObject({settled: 1100, reserved: 0});
  });

  it.each(doors)('higher evidence through %s settles the excess and opens an incident on the ORIGINAL settlement (through correction_id), and blocks the provider for every Account', async (door) => {
    const a = await committedAccount();
    const b = await committedAccount();
    const s = await own();
    const {run, operationId, settlement} = await bookedAtDeadline(a, s);

    const answer = await late(door, a.accountId, operationId, s, HIGH);
    expect(answer).toMatchObject({outcome: 'corrected', classification: 'deadline', settled: RESERVED, released: RESERVED, over: 1700, delta: 1700, settlement_id: settlement.id});
    expect(answer.incident_id).toMatch(uuidLike);
    const [correction] = await correctionsOf(operationId);
    expect(correction).toMatchObject({id: answer.correction_id, delta: 1700, input_tokens: 5000, output_tokens: 100, returned_model: s.model});
    expect(await incidentsOf(a.accountId)).toEqual([
      {id: answer.incident_id, reservation_id: settlement.reservation_id, settlement_id: settlement.id, correction_id: correction.id, provider: s.provider, reserved: RESERVED, evidence: 5100, cleared_at: null, cleared_by: null},
    ]);
    expect(await settlementsOf(operationId)).toEqual([settlement]);
    // It counts: the period shows the evidence, the Job's exposure is the evidence.
    expect(await figures(a.accountId)).toMatchObject({settled: 5100, reserved: 0});
    expect(await exposure(run.jobId)).toBe(5100);
    await periodsHold(a.accountId);
    // Every Account is refused for the provider; another provider is not.
    expect(await submitOne(a, s)).toMatchObject({outcome: 'refused', refusal: 'provider_blocked'});
    expect(await submitOne(b, s)).toMatchObject({outcome: 'refused', refusal: 'provider_blocked'});
    expect(await submitOne(b, await own())).toMatchObject({outcome: 'accepted'});
    // The same evidence again is replayed and carries the incident; other evidence is already_settled; there is still one correction and one incident.
    expect(await late(other(door), a.accountId, operationId, s, HIGH)).toMatchObject({outcome: 'replayed', correction_id: correction.id, incident_id: answer.incident_id, over: 1700, delta: 1700});
    expect(await late(door, a.accountId, operationId, s, {input: HIGH.input + 1, output: HIGH.output})).toMatchObject({outcome: 'already_settled', correction_id: correction.id, incident_id: answer.incident_id});
    expect(await ledger(a.accountId)).toMatchObject({corrections: 1, incidents: 1, settlements: 1});
  });

  it('replays the very same command of a correction from its receipt (whose subject is the correction), and refuses the command ID for other evidence as reused', async () => {
    const a = await committedAccount();
    const s = await own();
    const {operationId, settlement} = await bookedAtDeadline(a, s);
    const command = randomUUID();
    const first = await settleCost(a.accountId, operationId, 'evidence', {...evidence(s, LOW.input, LOW.output), command});
    expect(first).toMatchObject({outcome: 'corrected', delta: -2300, settlement_id: settlement.id});
    const before = await ledger(a.accountId);
    expect(await settleCost(a.accountId, operationId, 'evidence', {...evidence(s, LOW.input, LOW.output), command})).toMatchObject({
      outcome: 'replayed', correction_id: first.correction_id, delta: -2300, settlement_id: settlement.id, classification: 'deadline', settled: RESERVED, released: RESERVED, over: 0,
    });
    expect(await settleCost(a.accountId, operationId, 'evidence', {...evidence(s, LOW.input + 1, LOW.output), command})).toMatchObject({outcome: 'reused', correction_id: null, settlement_id: null});
    expect(await ledger(a.accountId)).toEqual(before);
    // The receipt's subject is the correction; once the correction is purged the ledger no longer agrees with its receipts, which is an error and not a replay with nothing in it.
    await db.query('delete from usage.corrections where id = $1', [first.correction_id]);
    const broken = await attempt(db, null, SETTLE, [a.accountId, command, operationId, 'evidence', LOW.input, LOW.output, s.model]);
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.code).toBe('55000');
      expect(broken.message).toContain('receipt subject missing');
    }
  });

  it('evidence equal to the reservation after a deadline booking is a correction of nothing: delta 0, no incident', async () => {
    const a = await committedAccount();
    const s = await own();
    const {operationId, settlement} = await bookedAtDeadline(a, s);
    expect(await reconcile(operationId, 'evidence', evidence(s, 3300, 100))).toMatchObject({outcome: 'corrected', delta: 0, over: 0, incident_id: null, settled: RESERVED});
    expect(await correctionsOf(operationId)).toEqual([expect.objectContaining({delta: 0})]);
    expect(await settlementsOf(operationId)).toEqual([settlement]);
    expect(await figures(a.accountId)).toMatchObject({settled: RESERVED});
  });

  it('refuses late evidence of another model (invalid_evidence, reason model_mismatch) and evidence that would pass the period\'s bound (overflow), writing nothing', async () => {
    const a = await committedAccount();
    retireLater(a);
    const s = await own();
    const {operationId} = await bookedAtDeadline(a, s);
    const before = await ledger(a.accountId);
    expect(await settleCost(a.accountId, operationId, 'evidence', {input: 1, output: 1, model: 'another-model'})).toMatchObject({outcome: 'invalid_evidence', reason: 'model_mismatch', correction_id: null});
    // A reconcile through the settled branch keeps the settlement's reason.
    expect(await reconcile(operationId, 'evidence', {input: 1, output: 1, model: 'another-model'})).toMatchObject({outcome: 'invalid_evidence', reason: 'model_mismatch', state: 'settled'});
    expect(await ledger(a.accountId)).toEqual(before);
    // The period holds CAP - 1,600 (the booking of 3,400 and a settled amount of CAP - 5,000): 5,100 of evidence is 1,700 more than the booking, so the total would be CAP + 100.
    await setFigures(db, await periodOf(a.accountId), CAP - 5000, 0);
    const full = await ledger(a.accountId);
    expect(await figures(a.accountId)).toMatchObject({settled: CAP - 1600});
    expect(await reconcile(operationId, 'evidence', evidence(s, HIGH.input, HIGH.output))).toMatchObject({outcome: 'overflow', state: 'settled', correction_id: null, incident_id: null});
    expect(await settleCost(a.accountId, operationId, 'evidence', evidence(s, HIGH.input, HIGH.output))).toMatchObject({outcome: 'overflow', correction_id: null, incident_id: null});
    expect(await ledger(a.accountId)).toEqual(full);
    expect(await correctionsOf(operationId)).toEqual([]);
    // A lower amount (one microdollar less than the room left) still lands; a negative delta is never refused for the bound.
    expect(await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'corrected', delta: -2300});
  });

  it('keeps the settled figure of a period that carries nothing at 0 when a correction releases a booking of an earlier period: after a reset and after a month turn', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const s = await own();
    const {run, operationId, settlement} = await bookedAtDeadline(a, s);
    expect(await changeLimit(admin, a, 'reset', null, 1)).toMatchObject({outcome: 'reset', seq: 2});
    expect(await figures(a.accountId)).toMatchObject({seq: 2, settled: 0, settled_figure: 0, carried_settled: 0});
    const answer = await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output));
    expect(answer).toMatchObject({outcome: 'corrected', delta: -2300});
    // The correction is in the new period, whose count started at 0: its settled figure is clamped at 0, never -2,300.
    expect((await correctionsOf(operationId))[0].period_id).toBe(await periodOf(a.accountId));
    expect(await figures(a.accountId)).toMatchObject({seq: 2, settled: 0, settled_figure: 0});
    expect(await exposure(run.jobId)).toBe(1100);
    expect(await settlementsOf(operationId)).toEqual([settlement]);
    await periodsHold(a.accountId);
    expect(await availableOf(a.accountId)).toBe(25 * M);
  });

  it('carries a booking through a LIMIT CHANGE, so the correction lowers the carried amount by its real signed delta', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const s = await own();
    const {operationId} = await bookedAtDeadline(a, s);
    expect(await changeLimit(admin, a, 'change', 30 * M, 1)).toMatchObject({outcome: 'changed', seq: 2});
    expect(await figures(a.accountId)).toMatchObject({seq: 2, settled: RESERVED, carried_settled: RESERVED, settled_figure: 0});
    expect(await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'corrected', delta: -2300});
    // The period's own figure is -2,300 (a signed delta, as Story 2.6 allows), and what it carried in plus that is 1,100.
    expect(await figures(a.accountId)).toMatchObject({seq: 2, settled: 1100, carried_settled: RESERVED, settled_figure: -2300});
    await periodsHold(a.accountId);
  });

  it('turns the month when the late evidence arrives: a booking made in an earlier month is corrected in the new period, settled never below 0', async () => {
    const a = await committedAccount();
    const s = await own();
    // The owner puts the Account's first period one month back, with a deadline booking in it (the clock cannot be moved).
    await db.query('delete from usage.periods where account_id = $1', [a.accountId]);
    const month = `(usage.current_month() - make_interval(months => 1))::date`;
    const past = (
      await db.query(
        `insert into usage.periods (account_id, seq, month_start, limit_microdollars, carried_settled_microdollars, carried_reserved_microdollars, cause, previous_limit_microdollars, actor, command_id, digest)
         values ($1, 1, ${month}, 25000000::bigint, 0, 0, 'initial', null, 'system', null, usage.period_digest($1, 1, ${month}, 25000000::bigint, 0::bigint, 0::bigint, 'initial')) returning id`,
        [a.accountId],
      )
    ).rows[0].id as string;
    const job = await ledgerJob(db, a.accountId, 1);
    const operationId = job.operationIds[0];
    await insertReservation(db, {accountId: a.accountId, periodId: past, jobId: job.jobId, operationId, amount: RESERVED, scheduleId: s.id});
    await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() - interval '3 days' where id = $1`, [operationId]);
    await ambiguousSince(operationId, '2 days');
    const settlementId = (
      await db.query(
        `insert into usage.settlements (account_id, reservation_id, period_id, classification, settled_microdollars, released_microdollars, digest)
         select r.account_id, r.id, $2, 'deadline', r.reserved_microdollars, r.reserved_microdollars, repeat('c', 64) from usage.reservations r where r.operation_id = $1 returning id`,
        [operationId, past],
      )
    ).rows[0].id as string;
    await db.query(`update jobs.operations set state = 'settled' where id = $1`, [operationId]);
    expect(await figures(a.accountId)).toMatchObject({seq: 1, settled: RESERVED});

    const answer = await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output));
    expect(answer).toMatchObject({outcome: 'corrected', delta: -2300, settlement_id: settlementId});
    // The new month's period starts the count at 0, so its figure is clamped at 0; the earlier month's own figure did not move.
    expect(await figures(a.accountId)).toMatchObject({seq: 2, settled: 0, settled_figure: 0, carried_settled: 0});
    expect((await correctionsOf(operationId))[0].period_id).not.toBe(past);
    expect((await one('select settled_microdollars::float8 as settled from usage.period_figures($1)', [past])).settled).toBe(RESERVED);
    await periodsHold(a.accountId);
  });
});

// ---------------------------------------------------------------------------------------------------
/** The incident an overrun opens: an ambiguous operation of the Account reconciled with evidence above its reservation. */
async function overrun(a: Fixture, s: FixtureSchedule, input = HIGH.input, output = HIGH.output) {
  const made = await ambiguousJob(a, s, '1 hour');
  const answer = await reconcile(made.operationId, 'evidence', evidence(s, input, output));
  expect(answer).toMatchObject({outcome: 'reconciled', over: input + output - RESERVED});
  return {...made, answer, incidentId: answer.incident_id as string};
}
const auditOf = (action: string, target: string) => all('select actor, action, target from identity.audit_events where action = $1 and target = $2 order by occurred_at', [action, target]);

describe('overrun incident: settled at the evidence, the provider blocked for every Account, listed and cleared by the Administrator', () => {
  it('settles evidence above the reservation at the evidence (finish_operation and reconcile_operation both), counts it against the period and the Job, and blocks the provider for every Account but not another provider', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    const s = await own();
    const run = await running(a, s, 2);
    const first = await dispatch(run, 1);
    const second = await dispatch(run, 2);
    expect(await finish(run, first, 'completed', evidence(s, HIGH.input, HIGH.output))).toMatchObject({outcome: 'finished', state: 'completed', settled: 5100, released: RESERVED, over: 1700});
    const [incident] = await incidentsOf(a.accountId);
    const [settlement] = await settlementsOf(first);
    expect(incident).toEqual({id: expect.stringMatching(uuidLike), reservation_id: settlement.reservation_id, settlement_id: settlement.id, correction_id: null, provider: s.provider, reserved: RESERVED, evidence: 5100, cleared_at: null, cleared_by: null});
    expect(await figures(a.accountId)).toMatchObject({settled: 5100, reserved: RESERVED});
    expect(await exposure(run.jobId)).toBe(5100 + RESERVED);
    // The second goes ambiguous and is reconciled with an overrun too: settled at the evidence, one incident of its own.
    await finish(run, second, 'ambiguous');
    expect(await reconcile(second, 'evidence', evidence(s, 6000, 100))).toMatchObject({outcome: 'reconciled', settled: 6100, released: RESERVED, over: 2700, correction_id: null});
    expect((await incidentsOf(a.accountId)).map((row) => row.evidence)).toEqual([5100, 6100]);
    expect(await figures(a.accountId)).toMatchObject({settled: 5100 + 6100, reserved: 0});
    // Every Account is refused for the provider; another provider is admitted.
    expect(await submitOne(a, s)).toMatchObject({outcome: 'refused', refusal: 'provider_blocked'});
    expect(await submitOne(b, s)).toMatchObject({outcome: 'refused', refusal: 'provider_blocked'});
    expect(await submitOne(b, await own())).toMatchObject({outcome: 'accepted'});
  });

  it('lists the incidents of every Account for the Administrator: open first and then the newest, with the provider, the operation, the Job, the amounts, and who cleared one and when', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const b = await committedAccount();
    const first = await overrun(a, await own());
    const second = await overrun(b, await own());
    const third = await overrun(a, await own(), 7000, 100);
    const listed = await listIncidents(admin);
    expect(listed.outcome).toBe('listed');
    const mine = (listed.incidents ?? []).filter((entry) => [first, second, third].some((x) => x.incidentId === entry.incident_id));
    // Newest open first.
    expect(mine.map((entry) => entry.incident_id)).toEqual([third.incidentId, second.incidentId, first.incidentId]);
    expect(mine[2]).toEqual({
      incident_id: first.incidentId, account_id: a.accountId, provider: first.run.schedule.provider, operation_id: first.operationId, job_id: first.run.jobId,
      reserved_microdollars: RESERVED, evidence_microdollars: 5100, over_microdollars: 1700, created_at: expect.any(String), cleared_at: null, cleared_by: null, cleared_by_email: null,
    });
    // A cleared incident follows the open ones, with who cleared it (the user, and the verified address of that user's Account).
    expect(await clearIncident(admin, third.incidentId)).toMatchObject({outcome: 'cleared'});
    const after = ((await listIncidents(admin)).incidents ?? []).filter((entry) => [first, second, third].some((x) => x.incidentId === entry.incident_id));
    expect(after.map((entry) => entry.incident_id)).toEqual([second.incidentId, first.incidentId, third.incidentId]);
    expect(after[2]).toMatchObject({cleared_by: `user:${admin.user.id}`, cleared_by_email: admin.user.email, over_microdollars: 3700});
    expect(new Date(after[2].cleared_at as string).getTime()).toBeGreaterThan(0);
    // The limit bounds the list, and the open incidents come first.
    const one1 = await listIncidents(admin, 1);
    expect(one1.incidents).toHaveLength(1);
    expect(one1.incidents![0].cleared_at).toBeNull();
    // The list is read-only and carries no Account's private data beyond what the page shows: its keys are exactly these.
    expect(Object.keys(mine[0]).sort()).toEqual(['account_id', 'cleared_at', 'cleared_by', 'cleared_by_email', 'created_at', 'evidence_microdollars', 'incident_id', 'job_id', 'operation_id', 'over_microdollars', 'provider', 'reserved_microdollars']);
  });

  it('lists the incident of a correction (late evidence above a deadline booking) with the operation of its reservation and the over amount of the excess', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const s = await own();
    const {run, operationId} = await bookedAtDeadline(a, s);
    const answer = await reconcile(operationId, 'evidence', evidence(s, HIGH.input, HIGH.output));
    const entry = ((await listIncidents(admin)).incidents ?? []).find((row) => row.incident_id === answer.incident_id);
    expect(entry).toMatchObject({account_id: a.accountId, operation_id: operationId, job_id: run.jobId, reserved_microdollars: RESERVED, evidence_microdollars: 5100, over_microdollars: 1700, cleared_at: null});
  });

  it('clears an incident once: cleared by user:<Auth user ID>, audited as usage.incident_cleared (incident:<id>) in the same transaction, again is already_cleared with no second event, an unknown incident is unavailable', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const made = await overrun(a, await own());
    const before = await ledger(a.accountId);
    const cleared = await clearIncident(admin, made.incidentId);
    expect(cleared).toMatchObject({outcome: 'cleared', incident_id: made.incidentId, cleared_by: `user:${admin.user.id}`});
    expect(cleared.cleared_at).toBeInstanceOf(Date);
    expect(await incidentsOf(a.accountId)).toEqual([expect.objectContaining({id: made.incidentId, cleared_by: `user:${admin.user.id}`, cleared_at: cleared.cleared_at})]);
    expect(await auditOf('usage.incident_cleared', `incident:${made.incidentId}`)).toEqual([{actor: `user:${admin.user.id}`, action: 'usage.incident_cleared', target: `incident:${made.incidentId}`}]);
    // Again (the same command or another, by the same Administrator or another): already_cleared, the first clearing, no second event.
    const second = await committedAccount('administrator');
    for (const [who, command] of [[admin, undefined], [second, randomUUID()]] as const) {
      expect(await clearIncident(who, made.incidentId, command)).toEqual({outcome: 'already_cleared', incident_id: made.incidentId, cleared_at: cleared.cleared_at, cleared_by: `user:${admin.user.id}`});
    }
    expect(await auditOf('usage.incident_cleared', `incident:${made.incidentId}`)).toHaveLength(1);
    expect(await clearIncident(admin, randomUUID())).toEqual({outcome: 'unavailable', incident_id: null, cleared_at: null, cleared_by: null});
    expect(await ledger(a.accountId)).toEqual(before);
  });

  it('resumes admissions only when the provider\'s LAST incident is cleared; another provider is never affected', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const b = await committedAccount();
    const c = await committedAccount();
    const s = await own();
    // Both Accounts are admitted before any incident exists; then each overruns.
    const runA = await ambiguousJob(a, s, '1 hour');
    const runB = await ambiguousJob(b, s, '1 hour');
    const one1 = (await reconcile(runA.operationId, 'evidence', evidence(s, HIGH.input, HIGH.output))).incident_id as string;
    const two = (await reconcile(runB.operationId, 'evidence', evidence(s, 6000, 100))).incident_id as string;
    expect([one1, two].every((id) => uuidLike.test(id))).toBe(true);
    expect(await submitOne(c, s)).toMatchObject({outcome: 'refused', refusal: 'provider_blocked'});
    expect(await clearIncident(admin, one1)).toMatchObject({outcome: 'cleared'});
    expect(await submitOne(c, s)).toMatchObject({outcome: 'refused', refusal: 'provider_blocked'});
    expect(await clearIncident(admin, two)).toMatchObject({outcome: 'cleared'});
    expect(await submitOne(c, s)).toMatchObject({outcome: 'accepted'});
  });

  it('answers denied, and changes nothing, for a member, a stale epoch, a disabled Administrator and an Account that does not exist: to the list and to the clearing', async () => {
    const admin = await committedAccount('administrator');
    const member = await committedAccount();
    const disabled = await committedAccount('administrator');
    const made = await overrun(member, await own());
    // api.disable_account refuses an Administrator, so the owner disables this one the way that function does (the status change raises the epoch).
    await db.query(`update identity.accounts set status = 'disabled' where id = $1`, [disabled.accountId]);
    const audit = async () => (await auditOf('usage.incident_cleared', `incident:${made.incidentId}`)).length;
    for (const who of [member, {...admin, epoch: 2}, disabled, {accountId: randomUUID(), epoch: 1}]) {
      expect(await listIncidents(who), JSON.stringify(who.epoch)).toEqual({outcome: 'denied', incidents: null});
      expect(await clearIncident(who, made.incidentId)).toEqual({outcome: 'denied', incident_id: null, cleared_at: null, cleared_by: null});
    }
    expect((await incidentsOf(member.accountId))[0]).toMatchObject({id: made.incidentId, cleared_at: null, cleared_by: null});
    expect(await audit()).toBe(0);
    // The owner clearing it by hand stays possible only for the owner (the roles have no privilege on the table): the API roles cannot.
    for (const role of ['service_role', 'authenticated', 'anon']) {
      const result = await attempt(db, role, `update usage.overrun_incidents set cleared_at = clock_timestamp(), cleared_by = 'user:x' where id = $1`, [made.incidentId]);
      expect(result.ok, role).toBe(false);
      if (!result.ok) expect(result.code, role).toBe('42501');
    }
  });

  it('raises 22023 for a list or a clearing the application would never send, and answers nothing', async () => {
    const admin = await committedAccount('administrator');
    for (const [label, sql, params] of [
      ['no Account', LIST, [null, 1, 50]],
      ['no epoch', LIST, [admin.accountId, null, 50]],
      ['epoch 0', LIST, [admin.accountId, 0, 50]],
      ['no limit', LIST, [admin.accountId, 1, null]],
      ['limit 0', LIST, [admin.accountId, 1, 0]],
      ['limit 201', LIST, [admin.accountId, 1, 201]],
      ['clear: no Account', CLEAR, [null, 1, randomUUID(), randomUUID()]],
      ['clear: epoch 0', CLEAR, [admin.accountId, 0, randomUUID(), randomUUID()]],
      ['clear: no command', CLEAR, [admin.accountId, 1, null, randomUUID()]],
      ['clear: no incident', CLEAR, [admin.accountId, 1, randomUUID(), null]],
    ] as const) {
      const result = await attempt(db, null, sql, [...params]);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('22023');
    }
  });

  it('records a refused clearing as usage.incident_refused through api.record_usage_refusal, once an hour for an actor and target, for an Administrator only', async () => {
    const admin = await committedAccount('administrator');
    const member = await committedAccount();
    const target = await committedAccount();
    const refuse = (userId: string, action: string, targetId: string | null = null) => attempt(db, 'service_role', 'select outcome from api.record_usage_refusal($1, $2, $3)', [userId, action, targetId]);
    expect(await refuse(admin.user.id, 'usage.incident_refused')).toMatchObject({ok: true, rows: [{outcome: 'recorded'}]});
    expect(await refuse(admin.user.id, 'usage.incident_refused')).toMatchObject({ok: true, rows: [{outcome: 'repeated'}]});
    expect(await refuse(admin.user.id, 'usage.incident_refused', target.accountId)).toMatchObject({ok: true, rows: [{outcome: 'recorded'}]});
    expect(await all(`select actor, action, target from identity.audit_events where actor = $1 and action = 'usage.incident_refused' order by target nulls first`, [`user:${admin.user.id}`])).toEqual([
      {actor: `user:${admin.user.id}`, action: 'usage.incident_refused', target: null},
      {actor: `user:${admin.user.id}`, action: 'usage.incident_refused', target: `account:${target.accountId}`},
    ]);
    // Not an Administrator: an argument error, as for usage.limit_refused. And usage.denied stays the member's.
    for (const [label, result] of [
      ['a member', await refuse(member.user.id, 'usage.incident_refused')],
      ['an Administrator for usage.denied', await refuse(admin.user.id, 'usage.denied')],
      ['an unknown user', await refuse(randomUUID(), 'usage.incident_refused')],
      ['an unknown action', await refuse(admin.user.id, 'usage.incident_cleared')],
    ] as const) {
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('22023');
    }
    expect(await refuse(member.user.id, 'usage.denied')).toMatchObject({ok: true, rows: [{outcome: 'recorded'}]});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('an unresolved charge and the caps: retry waits, a reset keeps the liability, the Job\'s $5 cap counts the charge and any correction', () => {
  it('keeps the liability through an allowance reset: the ambiguous operation\'s reservation is still carried and counted, and the deadline then books it in the new period', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const { run, operationId } = await ambiguousJob(a, await own(), '25 hours');
    expect(await figures(a.accountId)).toMatchObject({seq: 1, settled: 0, reserved: RESERVED});
    expect(await changeLimit(admin, a, 'reset', null, 1)).toMatchObject({outcome: 'reset', seq: 2});
    // The count restarts at 0 and the liability is kept: still reserved, still not available.
    expect(await figures(a.accountId)).toMatchObject({seq: 2, settled: 0, reserved: RESERVED, carried_settled: 0});
    expect(await availableOf(a.accountId)).toBe(25 * M - RESERVED);
    expect(await exposure(run.jobId)).toBe(RESERVED);
    // The deadline books it in the new period: settled, no longer reserved.
    expect((await sweep()).reconciled).toBeGreaterThanOrEqual(1);
    expect(await opRow(operationId)).toMatchObject({state: 'settled'});
    expect(await figures(a.accountId)).toMatchObject({seq: 2, settled: RESERVED, reserved: 0});
    expect((await settlementsOf(operationId))[0].period_id).toBe(await periodOf(a.accountId));
    await periodsHold(a.accountId);
  });

  it('keeps the reservation through a cancel and a disable (only evidence, a proven noncharge or the deadline releases it) and the retry waits throughout', async () => {
    const a = await committedAccount();
    const run = await running(a, await own(), 1);
    const operationId = await dispatch(run);
    await run.jobs.cancel(run.jobId);
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    await run.workers.cancelAccount(a.accountId);
    await sweep();
    expect(await opRow(operationId)).toMatchObject({state: 'ambiguous'});
    expect(await figures(a.accountId)).toMatchObject({settled: 0, reserved: RESERVED});
    expect(await exposure(run.jobId)).toBe(RESERVED);
    expect(await settlementsOf(operationId)).toEqual([]);
    expect(await count(db, 'select count(*) as n from jobs.attempts where job_id = $1', [run.jobId])).toBe(1);
  });

  it('counts an ambiguous charge, a deadline booking and its correction against the Job\'s $5 cap: exactly $5 fits and a microdollar more does not', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    // $1 for each 1,000 output tokens and nothing for input: an output limit of 1,000 reserves exactly $1.
    const dollar = await own({inputRate: 0, outputRate: 1000});
    const job = await ledgerJob(db, a.accountId, 6);
    const [held, booked, third, fourth, fifth] = job.operationIds;
    const reserveNow = (operationId: string, output: number) =>
      one('select outcome, reserved_microdollars::float8 as reserved, requested_microdollars::float8 as requested, used_microdollars::float8 as used, available_microdollars::float8 as available from api.reserve_cost($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, $10)', [
        a.accountId, a.epoch, randomUUID(), operationId, dollar.id, dollar.provider, dollar.model, dollar.apiVersion, output, '{}',
      ]);
    expect(await reserveNow(held, 1000)).toMatchObject({outcome: 'reserved', reserved: M});
    expect(await reserveNow(booked, 1000)).toMatchObject({outcome: 'reserved', reserved: M});
    for (const operationId of [held, booked]) await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() where id = $1`, [operationId]);
    await ambiguousSince(held, '2 hours');
    expect(await exposure(job.jobId)).toBe(2 * M);
    // The second is booked at its deadline ($1), and then late evidence of $1.60 corrects it up by $0.60 (an incident, cleared at once so that admission goes on).
    await ambiguousSince(booked, '25 hours');
    expect((await sweep()).reconciled).toBeGreaterThanOrEqual(1);
    const answer = await reconcile(booked, 'evidence', {input: 0, output: 1600, model: dollar.model});
    expect(answer).toMatchObject({outcome: 'corrected', delta: 600_000, incident_id: expect.stringMatching(uuidLike)});
    expect(await clearIncident(admin, answer.incident_id)).toMatchObject({outcome: 'cleared'});
    expect(await exposure(job.jobId)).toBe(M + 1_600_000);
    // Two more dollars fit ($4.60 used), then $0.40 exactly; $0.401 does not.
    expect(await reserveNow(third, 1000)).toMatchObject({outcome: 'reserved'});
    expect(await reserveNow(fourth, 1000)).toMatchObject({outcome: 'reserved'});
    expect(await reserveNow(fifth, 401)).toMatchObject({outcome: 'over_job_cap', requested: 401_000, used: 4_600_000, available: 400_000});
    expect(await reserveNow(fifth, 400)).toMatchObject({outcome: 'reserved', reserved: 400_000});
    expect(await exposure(job.jobId)).toBe(5_000_000);
  });

  it('counts a LOWER correction too: the released difference is room under the Job\'s cap', async () => {
    const a = await committedAccount();
    const s = await own();
    const {run, operationId} = await bookedAtDeadline(a, s);
    expect(await exposure(run.jobId)).toBe(RESERVED);
    await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output));
    expect(await exposure(run.jobId)).toBe(1100);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('overflow: a settlement that would take a period\'s settled total over 1e15 answers overflow and writes nothing', () => {
  /** An Account with two Jobs (A and B), each with one ambiguous operation whose deadline has passed, admitted BEFORE the period is filled to the brim. */
  async function crowded() {
    const a = await committedAccount();
    const s = await own();
    const one1 = await ambiguousJob(a, s, '25 hours');
    const two = await ambiguousJob(a, s, '25 hours');
    return {a, s, one1, two};
  }

  it('settles exactly up to 1e15 and answers overflow for one microdollar more, writing nothing; the operation stays ambiguous', async () => {
    const {a, one1, two} = await crowded();
    retireLater(a);
    await setFigures(db, await periodOf(a.accountId), CAP - RESERVED, 0);
    const full = await ledger(a.accountId);
    expect(await settleCost(a.accountId, one1.operationId, 'deadline')).toMatchObject({outcome: 'settled', classification: 'deadline', settled: RESERVED});
    expect(await figures(a.accountId)).toMatchObject({settled: CAP});
    const after = await ledger(a.accountId);
    expect(after.settlements).toBe(full.settlements + 1);
    // The next one would pass the bound: nothing is written, and the operation is not moved.
    const refused = await settleCost(a.accountId, two.operationId, 'deadline');
    expect(refused).toMatchObject({outcome: 'overflow', settlement_id: null, settled: null});
    expect(await ledger(a.accountId)).toEqual(after);
    expect(await opRow(two.operationId)).toMatchObject({state: 'ambiguous'});
    expect(await figures(a.accountId)).toMatchObject({settled: CAP, reserved: RESERVED});
    // An evidence settlement too (below the reservation it frees room, above it passes the bound).
    expect(await reconcile(two.operationId, 'evidence', evidence(two.run.schedule, 3300, 101))).toMatchObject({outcome: 'overflow', state: 'ambiguous'});
    expect(await ledger(a.accountId)).toEqual(after);
  });

  it('answers overflow in the report of a completion (a word, the move undone) and the application reports it ambiguous; a smaller evidence settles at the very edge', async () => {
    const a = await committedAccount();
    retireLater(a);
    const s = await own();
    const run = await running(a, s);
    const operationId = await dispatch(run);
    await setFigures(db, await periodOf(a.accountId), CAP - 1000, 0);
    const full = await ledger(a.accountId);
    expect(await finish(run, operationId, 'completed', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'overflow', state: 'dispatched'});
    expect(await opRow(operationId)).toMatchObject({state: 'dispatched', stamped: false});
    expect(await ledger(a.accountId)).toEqual(full);
    const reported = await reportOutcome({attemptId: run.attemptId, fence: run.fence, operationId}, {outcome: 'completed', value: null, requestId: 'req_of_1', returnedModel: s.model, inputTokens: LOW.input, outputTokens: LOW.output}, {env});
    expect(reported).toMatchObject({reported: 'ambiguous', downgraded: true, finish: {outcome: 'finished', state: 'ambiguous'}});
    expect(await reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'overflow', state: 'ambiguous'});
    // 900 microdollars of evidence is within the room that is left (1,000): it lands.
    expect(await reconcile(operationId, 'evidence', evidence(s, 800, 100))).toMatchObject({outcome: 'reconciled', settled: 900, state: 'settled'});
    expect(await figures(a.accountId)).toMatchObject({settled: CAP - 100});
  });

  it('is counted failed by the sweep, which goes on: the others still settle, the unsettled operation stays ambiguous, and unknown_cost_oldest shows it', async () => {
    const x = await committedAccount();
    const y = await committedAccount();
    retireLater(x, y);
    const s = await own();
    // X holds two operations that went ambiguous far back (the oldest unresolved charge in the database), Y one that is only due.
    const stuck = await ambiguousJob(x, s, '5000 days');
    const fine = await ambiguousJob(y, s, '30 hours');
    await setFigures(db, await periodOf(x.accountId), CAP - 1, 0);
    const swept = await sweep();
    expect(swept.failed).toBeGreaterThanOrEqual(1);
    expect(swept.reconciled).toBeGreaterThanOrEqual(1);
    expect(await opRow(fine.operationId)).toMatchObject({state: 'settled'});
    expect((await settlementsOf(fine.operationId))[0]).toMatchObject({classification: 'deadline', settled: RESERVED});
    expect(await opRow(stuck.operationId)).toMatchObject({state: 'ambiguous'});
    expect(await settlementsOf(stuck.operationId)).toEqual([]);
    // The alarm observation shows the stuck charge: older than 5,000 days.
    const observed = await alarmObservations({env});
    expect(observed.unknownCostOldest).toBeGreaterThanOrEqual(5000 * 86_400);
    expect(unknownCostCondition.evaluate({...observed, heartbeatConfigured: true}, [])).toEqual([{subject: null, detail: {age_seconds: observed.unknownCostOldest}}]);
    await retire(x, y);
    const cleared = await alarmObservations({env});
    expect(cleared.unknownCostOldest === null || cleared.unknownCostOldest < 5000 * 86_400).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('alarm observation unknown_cost_oldest: how old the oldest unresolved charge is', () => {
  it('measures a dispatched operation from its dispatch and an ambiguous one from its outcome, ignores one without a reservation, and clears when settled; unknown-cost raises past 87,000 seconds', async () => {
    const a = await committedAccount();
    const s = await own();
    expect(unknownCostSeconds).toBe(87_000);
    expect((await one('select usage.unknown_cost_alarm_seconds() as seconds')).seconds).toBe(87_000);
    const period = await periodOf(a.accountId);
    const job = await ledgerJob(db, a.accountId, 3);
    const [charged, unreserved] = job.operationIds;
    // One dispatched 3000 days ago with a reservation; one dispatched 4000 days ago with NONE (never counted).
    await insertReservation(db, {accountId: a.accountId, periodId: period, jobId: job.jobId, operationId: charged, amount: RESERVED, scheduleId: s.id});
    await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() - interval '3000 days' where id = $1`, [charged]);
    await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() - interval '4000 days' where id = $1`, [unreserved]);
    const day = 86_400;
    const observe = async () => Number((await one('select unknown_cost_oldest from api.alarm_observations()')).unknown_cost_oldest);
    let seen = await observe();
    expect(seen).toBeGreaterThanOrEqual(3000 * day);
    expect(seen).toBeLessThan(3010 * day);
    // Ambiguous: measured from the outcome (2,000 days ago), no longer from the dispatch.
    await db.query(`update jobs.operations set state = 'ambiguous', outcome_at = clock_timestamp() - interval '2000 days' where id = $1`, [charged]);
    seen = await observe();
    expect(seen).toBeGreaterThanOrEqual(2000 * day);
    expect(seen).toBeLessThan(2010 * day);
    const typed = await alarmObservations({env});
    expect(typed.unknownCostOldest).toBeGreaterThanOrEqual(2000 * day);
    expect(unknownCostCondition.evaluate({...typed, heartbeatConfigured: true}, [])).toHaveLength(1);
    expect(unknownCostCondition.evaluate({...typed, unknownCostOldest: unknownCostSeconds, heartbeatConfigured: true}, [])).toEqual([]);
    expect(unknownCostCondition.evaluate({...typed, unknownCostOldest: unknownCostSeconds + 1, heartbeatConfigured: true}, [])).toHaveLength(1);
    // Settled: it clears (the other operation never counted).
    expect(await reconcile(charged, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'reconciled'});
    const done = await alarmObservations({env});
    expect(done.unknownCostOldest === null || done.unknownCostOldest < 2000 * day).toBe(true);
    expect(unknownCostCondition.evaluate({...done, unknownCostOldest: null, heartbeatConfigured: true}, [])).toEqual([]);
  });

  it('does not count an operation that already HAS a settlement, whatever its state: the `not exists (settlement)` clause (an ambiguous one settled by a bare settle_cost, a dispatched one with a settlement row)', async () => {
    const a = await committedAccount();
    const s = await own();
    const period = await periodOf(a.accountId);
    const job = await ledgerJob(db, a.accountId, 3);
    const [ambiguousSettled, dispatchedSettled, counted] = job.operationIds;
    const day = 86_400;
    const observe = async () => Number((await one('select unknown_cost_oldest from api.alarm_observations()')).unknown_cost_oldest);

    // The newest of the three is the only one that counts: unsettled, reserved, dispatched 1,000 days ago. (Nothing else in the file is anywhere near that old and unsettled.)
    await insertReservation(db, {accountId: a.accountId, periodId: period, jobId: job.jobId, operationId: counted, amount: RESERVED, scheduleId: s.id});
    await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() - interval '1000 days' where id = $1`, [counted]);

    // Older ones that WOULD be the oldest if they counted: ambiguous 9,000 days ago, and dispatched 8,000 days ago, each with a reservation.
    const reservedAmbiguous = await insertReservation(db, {accountId: a.accountId, periodId: period, jobId: job.jobId, operationId: ambiguousSettled, amount: RESERVED, scheduleId: s.id});
    await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() - interval '9000 days' where id = $1`, [ambiguousSettled]);
    await ambiguousSince(ambiguousSettled, '9000 days');
    const reservedDispatched = await insertReservation(db, {accountId: a.accountId, periodId: period, jobId: job.jobId, operationId: dispatchedSettled, amount: RESERVED, scheduleId: s.id});
    await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() - interval '8000 days' where id = $1`, [dispatchedSettled]);

    // Unsettled, they are the oldest: the observation sees the 9,000 days.
    let seen = await observe();
    expect(seen).toBeGreaterThanOrEqual(9000 * day);
    expect(seen).toBeLessThan(9010 * day);

    // The ambiguous one is settled by a BARE settle_cost (which does not move the state): it stays ambiguous, and is no longer counted. The dispatched one is the next oldest.
    expect(await settleCost(a.accountId, ambiguousSettled, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'settled'});
    expect(await opRow(ambiguousSettled)).toMatchObject({state: 'ambiguous'});
    seen = await observe();
    expect(seen).toBeGreaterThanOrEqual(8000 * day);
    expect(seen).toBeLessThan(8010 * day);

    // A settlement row on the dispatched one (inserted directly: no command settles a dispatched operation): it is not counted either, and the one left is the 1,000-day-old operation.
    await insertSettlement(db, {accountId: a.accountId, reservationId: reservedDispatched, periodId: period, classification: 'unused'});
    expect(await opRow(dispatchedSettled)).toMatchObject({state: 'dispatched'});
    seen = await observe();
    expect(seen).toBeGreaterThanOrEqual(1000 * day);
    expect(seen).toBeLessThan(1010 * day);
    expect(reservedAmbiguous).not.toBe(reservedDispatched);
    // The typed read agrees, and the condition judges the age it was given.
    const typed = await alarmObservations({env});
    expect(typed.unknownCostOldest).toBeGreaterThanOrEqual(1000 * day);
    expect(typed.unknownCostOldest).toBeLessThan(1010 * day);

    // Settled, it goes too.
    await db.query(`update jobs.operations set state = 'ambiguous', outcome_at = clock_timestamp() - interval '1000 days' where id = $1`, [counted]);
    expect(await reconcile(counted, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'reconciled'});
    const gone = await observe().catch(() => null);
    expect(gone === null || Number.isNaN(gone) || gone < 1000 * day).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.reconcile_operation: which operations it reconciles, and what it refuses', () => {
  it('answers unavailable for an operation that does not exist, and not_reconcilable (with the state) for one that is planned, dispatched or abandoned, or past what the report can change; nothing is written', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s, 3);
    const dispatched = await dispatch(run, 1);
    const [, planned, abandonedLater] = run.planned;
    expect(abandonedLater).toBeTruthy();
    const before = await ledger(a.accountId);
    expect(await reconcile(randomUUID(), 'evidence', evidence(s, 1, 1))).toEqual(expect.objectContaining({outcome: 'unavailable', operation_id: null, state: null}));
    expect(await reconcile(planned, 'evidence', evidence(s, 1, 1))).toMatchObject({outcome: 'not_reconcilable', operation_id: planned, state: 'planned'});
    expect(await reconcile(dispatched, 'evidence', evidence(s, 1, 1))).toMatchObject({outcome: 'not_reconcilable', state: 'dispatched'});
    expect(await reconcile(dispatched, 'noncharge', {requestId: 'req_x'})).toMatchObject({outcome: 'not_reconcilable', state: 'dispatched'});
    expect(await ledger(a.accountId)).toEqual(before);
    // Abandoned: the Job is cancelled, the dispatched one is marked, the planned ones were released.
    await run.jobs.cancel(run.jobId);
    expect(await reconcile(planned, 'evidence', evidence(s, 1, 1))).toMatchObject({outcome: 'not_reconcilable', state: 'abandoned'});
    // Completed (the evidence is a replay or already_settled) and a noncharge on a completed operation or a settled one is not reconciled.
    const b = await committedAccount();
    const second = await running(b, s, 1);
    const done = await dispatch(second, 1);
    await finish(second, done, 'completed', evidence(s, LOW.input, LOW.output));
    expect(await reconcile(done, 'noncharge', {requestId: 'req_y'})).toMatchObject({outcome: 'not_reconcilable', state: 'completed'});
    const third = await ambiguousJob(b, s, '1 hour');
    await reconcile(third.operationId, 'evidence', evidence(s, LOW.input, LOW.output));
    expect(await reconcile(third.operationId, 'noncharge', {requestId: 'req_z'})).toMatchObject({outcome: 'not_reconcilable', state: 'settled'});
  });

  it('answers not_reserved for an ambiguous operation that holds no reservation, leaving it ambiguous', async () => {
    const a = await committedAccount();
    const s = await own();
    const job = await ledgerJob(db, a.accountId, 1);
    await db.query(`update jobs.operations set state = 'dispatched', dispatched_at = clock_timestamp() where id = $1`, [job.operationIds[0]]);
    await ambiguousSince(job.operationIds[0], '1 hour');
    expect(await reconcile(job.operationIds[0], 'evidence', evidence(s, 1, 1))).toMatchObject({outcome: 'not_reserved', state: 'ambiguous'});
    expect(await reconcile(job.operationIds[0], 'noncharge', {requestId: 'req_nr'})).toMatchObject({outcome: 'not_reserved', state: 'ambiguous'});
    expect(await opRow(job.operationIds[0])).toMatchObject({state: 'ambiguous', request_id: null});
    expect(await ledger(a.accountId)).toMatchObject({settlements: 0, commands: 0});
  });

  it('needs no authority: a disabled Account\'s ambiguous operation, and one whose Project is tombstoned, are reconciled all the same', async () => {
    const a = await committedAccount();
    const s = await own();
    const first = await ambiguousJob(a, s, '1 hour');
    const second = await ambiguousJob(a, s, '1 hour');
    await db.query(`select api.record_tombstone('project', $1)`, [second.run.projectId]);
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    expect(await reconcile(first.operationId, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'reconciled', settled: 1100});
    expect(await reconcile(second.operationId, 'noncharge', {requestId: 'req_tomb'})).toMatchObject({outcome: 'reconciled', state: 'noncharge', settled: 0});
    expect(await figures(a.accountId)).toMatchObject({settled: 1100, reserved: 0});
  });

  it('raises 22023 for a report the application would never send, and writes nothing', async () => {
    const a = await committedAccount();
    const s = await own();
    const { operationId } = await ambiguousJob(a, s, '1 hour');
    const before = await ledger(a.accountId);
    const bad: [string, unknown[]][] = [
      ['no operation', [null, 'evidence', 1, 1, s.model, null]],
      ['no outcome', [operationId, null, 1, 1, s.model, null]],
      ['an outcome that does not exist', [operationId, 'refund', null, null, null, 'req_1']],
      ['evidence with no tokens', [operationId, 'evidence', null, null, s.model, null]],
      ['evidence with no output', [operationId, 'evidence', 1, null, s.model, null]],
      ['evidence with no model', [operationId, 'evidence', 1, 1, null, null]],
      ['negative input', [operationId, 'evidence', -1, 1, s.model, null]],
      ['negative output', [operationId, 'evidence', 1, -1, s.model, null]],
      ['a model with a space', [operationId, 'evidence', 1, 1, 'a model', null]],
      ['a request ID with a space', [operationId, 'evidence', 1, 1, s.model, 'req 1']],
      ['a noncharge with no request ID', [operationId, 'noncharge', null, null, null, null]],
      ['a noncharge with tokens', [operationId, 'noncharge', 1, null, null, 'req_1']],
      ['a noncharge with a model', [operationId, 'noncharge', null, null, 'm', 'req_1']],
    ];
    for (const [label, params] of bad) {
      const result = await attempt(db, null, RECONCILE, params);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('22023');
    }
    expect(await opRow(operationId)).toMatchObject({state: 'ambiguous'});
    expect(await ledger(a.accountId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('isolation: one operation that cannot settle does not stop the others, a cancel or a fenced command', () => {
  /** The owner makes a settlement command of the operation impossible: its derived command ID is already a receipt of another kind (the settlement then answers `reused`). */
  async function poison(accountId: string, kind: 'settle_deadline' | 'settle_unused', operationId: string) {
    const id = (await one('select jobs.derived_id($1, array[$2::text]) as id', [kind, operationId])).id as string;
    await db.query(`insert into usage.commands (account_id, command_id, kind, digest, subject_id) values ($1, $2, 'reserve', repeat('a', 64), gen_random_uuid())`, [accountId, id]);
    return id;
  }

  it('counts a due operation whose settlement is refused as failed, leaves it ambiguous, and settles every other due operation in the same sweep', async () => {
    const x = await committedAccount();
    const y = await committedAccount();
    retireLater(x, y);
    const s = await own();
    const stuck = await ambiguousJob(x, s, '5000 days');
    const fine = await ambiguousJob(y, s, '30 hours');
    const alsoFine = await ambiguousJob(x, s, '26 hours');
    const receipt = await poison(x.accountId, 'settle_deadline', stuck.operationId);
    const swept = await sweep();
    expect(swept.failed).toBeGreaterThanOrEqual(1);
    expect(swept.reconciled).toBeGreaterThanOrEqual(2);
    expect(await opRow(stuck.operationId)).toMatchObject({state: 'ambiguous'});
    expect(await settlementsOf(stuck.operationId)).toEqual([]);
    for (const made of [fine, alsoFine]) {
      expect(await opRow(made.operationId)).toMatchObject({state: 'settled'});
      expect((await settlementsOf(made.operationId)).map((row) => row.classification)).toEqual(['deadline']);
    }
    // Still there, still failing, still harmless: a second sweep says so again and settles nothing more.
    const again = await sweep();
    expect(again.failed).toBeGreaterThanOrEqual(1);
    expect(again.reconciled).toBe(0);
    // Once the cause is gone, the next sweep settles it.
    await db.query('delete from usage.commands where account_id = $1 and command_id = $2', [x.accountId, receipt]);
    expect((await sweep()).reconciled).toBeGreaterThanOrEqual(1);
    expect(await opRow(stuck.operationId)).toMatchObject({state: 'settled'});
  });

  it('never fails api.cancel_job, api.finish_attempt or the sweep because one abandoned operation cannot be released; jobs.settle_abandoned skips it, and the sweep counts it', async () => {
    const x = await committedAccount();
    const y = await committedAccount();
    retireLater(x, y);
    const s = await own();
    // X: one Job cancelled by the user and one failed by the worker, each with two planned operations, the first of which cannot settle.
    const cancelled = await running(x, s, 2);
    const failed = await running(x, s, 2);
    const poisoned = [cancelled.planned[0], failed.planned[0]];
    for (const operationId of poisoned) await poison(x.accountId, 'settle_unused', operationId);
    expect(await cancelled.jobs.cancel(cancelled.jobId)).toMatchObject({outcome: 'cancelled', state: 'cancelled', released: 1});
    expect(await finish(failed, randomUUID(), 'ambiguous')).toMatchObject({outcome: 'not_found'});
    expect((await failed.workers.finish(failed.attemptId, failed.fence, 'failed')).outcome).toBe('finished');
    // The poisoned operations are abandoned and still hold their reservations; the others were released.
    for (const operationId of poisoned) {
      expect(await opRow(operationId)).toMatchObject({state: 'abandoned'});
      expect(await settlementsOf(operationId)).toEqual([]);
    }
    expect((await settlementsOf(cancelled.planned[1])).map((row) => row.classification)).toEqual(['unused']);
    expect((await settlementsOf(failed.planned[1])).map((row) => row.classification)).toEqual(['unused']);
    expect(await figures(x.accountId)).toMatchObject({settled: 0, reserved: 2 * RESERVED});
    // Y: a Job the owner abandoned without settling (a crash between the two steps). The sweep releases it though X's cannot be released, and counts the failures.
    const other = await running(y, s, 2);
    await db.query(`update jobs.attempts set state = 'cancelled', reason = 'user_cancelled', ended_at = clock_timestamp() where id = $1`, [other.attemptId]).catch(() => undefined);
    await db.query(`update jobs.operations o set state = 'abandoned' from jobs.steps st where st.id = o.step_id and st.attempt_id = $1 and o.state = 'planned'`, [other.attemptId]);
    const swept = await sweep();
    expect(swept.failed).toBeGreaterThanOrEqual(2);
    expect(swept.settled).toBeGreaterThanOrEqual(2);
    expect(await figures(y.accountId)).toMatchObject({settled: 0, reserved: 0});
    // api.cancel_account_jobs (the Account's other canceller) is not stopped by them either.
    expect(await cancelled.workers.cancelAccount(x.accountId)).toMatchObject({cancelled: expect.any(Number), settled: expect.any(Number)});
    // jobs.settle_abandoned (internal; the owner runs it) skips what cannot settle and answers how many it released.
    expect(Number((await one('select jobs.settle_abandoned($1) as released', [cancelled.attemptId])).released)).toBe(0);
    expect(Number((await one('select jobs.settle_abandoned(null, $1, 100) as released', [x.accountId])).released)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the records are immutable: corrections and incidents, and the settlements they leave untouched', () => {
  /** A correction made by the real commands, for lower evidence (no incident) and for higher evidence (an incident), on two Jobs of one Account. */
  async function corrected() {
    const a = await committedAccount();
    const s = await own();
    const lower = await bookedAtDeadline(a, s);
    const higher = await bookedAtDeadline(a, s);
    const lowAnswer = await reconcile(lower.operationId, 'evidence', evidence(s, LOW.input, LOW.output));
    const highAnswer = await reconcile(higher.operationId, 'evidence', evidence(s, HIGH.input, HIGH.output));
    return {a, s, lower, higher, lowAnswer, highAnswer};
  }

  it('refuses any update of a correction (55000), has its own BEFORE TRUNCATE guard, and lets the purge delete it', async () => {
    const {a, lower, lowAnswer} = await corrected();
    const id = lowAnswer.correction_id as string;
    for (const sql of [
      `update usage.corrections set settled_delta_microdollars = 0 where id = $1`,
      `update usage.corrections set digest = repeat('0', 64) where id = $1`,
      `update usage.corrections set returned_model = 'other' where id = $1`,
      `update usage.corrections set input_tokens = 1 where id = $1`,
      `update usage.corrections set created_at = now() where id = $1`,
      `update usage.corrections set period_id = period_id where id = $1`,
      `update usage.corrections set account_id = account_id where id = $1`,
    ]) {
      const result = await attempt(db, null, sql, [id]);
      expect(result.ok, sql).toBe(false);
      if (!result.ok) expect(result.code, sql).toBe('55000');
    }
    const guards = await truncateGuards(db, ['usage.corrections', 'usage.overrun_incidents', 'usage.settlements']);
    for (const [table, found] of Object.entries(guards)) expect(found.length, `${table} has a BEFORE TRUNCATE trigger that raises 55000`).toBeGreaterThanOrEqual(1);
    const truncate = await attempt(db, null, 'truncate usage.corrections, usage.overrun_incidents');
    expect(truncate.ok).toBe(false);
    if (!truncate.ok) expect(truncate.code).toBe('55000');
    // The settlement a correction corrects cannot be deleted from under it (restrict), and the correction can be (the purge deletes children first).
    const blocked = await attempt(db, null, `delete from usage.settlements where account_id = $1 and id = $2`, [a.accountId, (await settlementsOf(lower.operationId))[0].id]);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('23503');
    expect((await db.query('delete from usage.corrections where id = $1', [id])).rowCount).toBe(1);
    expect(await correctionsOf(lower.operationId)).toEqual([]);
  });

  it('holds one correction for a reservation (unique), of a DEADLINE settlement, within 0 and 1e15, and not in a period before the settlement\'s', async () => {
    const {a, s, lower, lowAnswer} = await corrected();
    const [correction] = await correctionsOf(lower.operationId);
    const [settlement] = await settlementsOf(lower.operationId);
    const insert = (over: Partial<Record<'reservation' | 'settlement' | 'period' | 'delta' | 'model' | 'digest', string | number>> = {}) =>
      attempt(
        db, null,
        `insert into usage.corrections (account_id, reservation_id, settlement_id, period_id, settled_delta_microdollars, input_tokens, output_tokens, returned_model, digest)
         values ($1, $2, $3, $4, $5, 1, 1, $6, $7)`,
        [a.accountId, over.reservation ?? settlement.reservation_id, over.settlement ?? settlement.id, over.period ?? correction.period_id, over.delta ?? -1, over.model ?? s.model, over.digest ?? 'e'.repeat(64)],
      );
    // A second correction for the same reservation: the unique key (after the correction is purged the same row would be fine).
    const second = await insert();
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('23505');
    expect(await correctionsOf(lower.operationId)).toHaveLength(1);
    await db.query('delete from usage.corrections where id = $1', [lowAnswer.correction_id]);
    // Within 0 and 1e15 of the corrected amount: -3401 would be below nothing, 1e15 - 3399 above the bound.
    for (const [label, delta] of [['below nothing', -(RESERVED + 1)], ['above 1e15', CAP - RESERVED + 1]] as const) {
      const result = await insert({delta});
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('23514');
    }
    // Exactly nothing is allowed (it releases the whole booking): the helper of tests/support/usage-ledger.ts makes one the way the trigger accepts.
    const whole = await insertCorrection(db, {accountId: a.accountId, reservationId: settlement.reservation_id, settlementId: settlement.id, periodId: correction.period_id, delta: -RESERVED});
    expect(whole).toMatch(uuidLike);
    expect(await correctionsOf(lower.operationId)).toEqual([expect.objectContaining({id: whole, delta: -RESERVED, returned_model: s.model})]);
    await db.query('delete from usage.corrections where reservation_id = $1', [settlement.reservation_id]);
    // A correction corrects a deadline settlement: an evidence settlement is refused.
    // (A provider of its own: the higher correction above opened an incident that blocks the first one.)
    const fresh = await own();
    const evidenceOp = await running(a, fresh, 1);
    const evidenceOperation = await dispatch(evidenceOp);
    await finish(evidenceOp, evidenceOperation, 'completed', evidence(fresh, LOW.input, LOW.output));
    const [evidenceSettlement] = await settlementsOf(evidenceOperation);
    const wrongKind = await insert({reservation: evidenceSettlement.reservation_id, settlement: evidenceSettlement.id});
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.code).toBe('23514');
    // A correction of one reservation naming another reservation's settlement.
    const mismatch = await insert({reservation: evidenceSettlement.reservation_id});
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.code).toBe('23514');
    // Not before the period of the settlement: the booking was made in period 2 (after a limit change), a correction in period 1 is refused.
    const admin = await committedAccount('administrator');
    const b = await committedAccount();
    const late = await ambiguousJob(b, fresh, '25 hours');
    const firstPeriod = await periodOf(b.accountId);
    expect(await changeLimit(admin, b, 'change', 30 * M, 1)).toMatchObject({outcome: 'changed'});
    await sweep();
    const [booking] = await settlementsOf(late.operationId);
    expect(booking.period_id).not.toBe(firstPeriod);
    const early = await attempt(
      db, null,
      `insert into usage.corrections (account_id, reservation_id, settlement_id, period_id, settled_delta_microdollars, input_tokens, output_tokens, returned_model, digest) values ($1, $2, $3, $4, -1, 1, 1, $5, $6)`,
      [b.accountId, booking.reservation_id, booking.id, firstPeriod, fresh.model, 'f'.repeat(64)],
    );
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe('23514');
  });

  it('lets an incident change in one way only (its clearing, once), keeps its correction_id, and refuses an incident of a correction that does not carry its evidence', async () => {
    const {a, lower, higher, highAnswer} = await corrected();
    const incidentId = highAnswer.incident_id as string;
    const [incident] = await incidentsOf(a.accountId);
    expect(incident).toMatchObject({id: incidentId, correction_id: highAnswer.correction_id});
    for (const sql of [
      `update usage.overrun_incidents set correction_id = null where id = $1`,
      `update usage.overrun_incidents set correction_id = null, cleared_at = clock_timestamp(), cleared_by = 'user:x' where id = $1`,
      `update usage.overrun_incidents set evidence_microdollars = evidence_microdollars + 1, cleared_at = clock_timestamp(), cleared_by = 'user:x' where id = $1`,
      `update usage.overrun_incidents set cleared_at = clock_timestamp() where id = $1`,
    ]) {
      const result = await attempt(db, null, sql, [incidentId]);
      expect(result.ok, sql).toBe(false);
      if (!result.ok) expect(result.code, sql).toBe('55000');
    }
    expect((await db.query(`update usage.overrun_incidents set cleared_at = clock_timestamp(), cleared_by = 'user:once' where id = $1`, [incidentId])).rowCount).toBe(1);
    const twice = await attempt(db, null, `update usage.overrun_incidents set cleared_at = clock_timestamp(), cleared_by = 'user:twice' where id = $1`, [incidentId]);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.code).toBe('55000');
    // An incident of the LOWER correction (delta -2,300) cannot carry evidence of 5,100: the correction does not say so.
    const [settlement] = await settlementsOf(lower.operationId);
    const [correction] = await correctionsOf(lower.operationId);
    const forged = await attempt(
      db, null,
      `insert into usage.overrun_incidents (account_id, reservation_id, settlement_id, correction_id, provider, reserved_microdollars, evidence_microdollars) values ($1, $2, $3, $4, $5, 3400, 5100)`,
      [a.accountId, settlement.reservation_id, settlement.id, correction.id, (await one('select provider from usage.reservations where id = $1', [settlement.reservation_id])).provider],
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.code).toBe('23514');
    // A correction an incident names cannot be purged before the incident.
    const blocked = await attempt(db, null, 'delete from usage.corrections where id = $1', [highAnswer.correction_id]);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('23503');
    expect(higher.operationId).toBeTruthy();
  });

  it('never edits a settlement: the deadline booking is row-for-row what it was after a correction, and an update of it is refused (55000)', async () => {
    const {lower, higher} = await corrected();
    for (const made of [lower, higher]) {
      expect(await settlementsOf(made.operationId)).toEqual([made.settlement]);
      const result = await attempt(db, null, `update usage.settlements set settled_microdollars = 0 where id = $1`, [made.settlement.id]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('55000');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('closure: no browser role and not the gateway reaches the new table or functions', () => {
  const newApi = ['api.reconcile_operation(uuid,text,bigint,bigint,text,text)', 'api.list_overrun_incidents(uuid,bigint,integer)', 'api.clear_overrun_incident(uuid,bigint,uuid,uuid)'];
  const internal = ['jobs.mark_ambiguous(uuid)', 'jobs.settle_abandoned(uuid,uuid,integer)', 'jobs.settle_abandoned_counted(uuid,uuid,integer)', 'usage.unknown_cost_alarm_seconds()', 'usage.check_correction()', 'usage.period_figures(uuid)', 'usage.job_exposure(uuid)'];

  it('gives usage.corrections row-level security with no policy and no privilege to any role, the gateway and PUBLIC included', async () => {
    const found = (
      await db.query(
        `select c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies, (select count(*)::int from aclexplode(c.relacl) a where a.grantee <> c.relowner) as other_grants
           from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'usage' and c.relname = 'corrections'`,
      )
    ).rows[0];
    expect(found).toEqual({rls: true, policies: 0, other_grants: 0});
    for (const role of ['anon', 'authenticated', 'service_role', 'nova3d_gateway']) {
      const held = (await db.query(`select has_table_privilege($1, 'usage.corrections', 'select,insert,update,delete,truncate,references,trigger') as can, has_any_column_privilege($1, 'usage.corrections', 'select,insert,update,references') as column_can`, [role])).rows[0];
      expect(held, role).toEqual({can: false, column_can: false});
      const read = await attempt(db, role, 'select * from usage.corrections');
      expect(read.ok, role).toBe(false);
      if (!read.ok) expect(read.code, role).toBe('42501');
    }
  });

  it('lets only the service role execute the three new api functions, and nobody (no API role) the internal ones; all run as their owner with a pinned search path', async () => {
    for (const role of ['anon', 'authenticated', 'nova3d_gateway']) {
      for (const signature of [...newApi, ...internal]) expect((await db.query(`select has_function_privilege($1, $2::regprocedure, 'execute') as can`, [role, signature])).rows[0].can, `${role} ${signature}`).toBe(false);
    }
    for (const signature of newApi) expect((await db.query(`select has_function_privilege('service_role', $1::regprocedure, 'execute') as can`, [signature])).rows[0].can, signature).toBe(true);
    for (const signature of internal) expect((await db.query(`select has_function_privilege('service_role', $1::regprocedure, 'execute') as can`, [signature])).rows[0].can, `service_role ${signature}`).toBe(false);
    for (const signature of newApi) {
      const fn = (await db.query(`select p.prosecdef as definer, p.proconfig as config from pg_proc p where p.oid = $1::regprocedure`, [signature])).rows[0];
      expect(fn, signature).toEqual({definer: true, config: ['search_path=""']});
    }
    for (const signature of internal) {
      const fn = (await db.query(`select p.proconfig as config from pg_proc p where p.oid = $1::regprocedure`, [signature])).rows[0];
      expect(fn.config, signature).toEqual(['search_path=""']);
    }
  });

  it('refuses every browser role and the gateway a direct call (42501), and the service role the internal ones', async () => {
    const calls = [
      `select * from api.reconcile_operation(gen_random_uuid(), 'noncharge', null, null, null, 'req_1')`,
      `select * from api.list_overrun_incidents(gen_random_uuid(), 1, 5)`,
      `select * from api.clear_overrun_incident(gen_random_uuid(), 1, gen_random_uuid(), gen_random_uuid())`,
    ];
    for (const role of ['anon', 'authenticated', 'nova3d_gateway']) {
      for (const sql of [...calls, `select jobs.mark_ambiguous(gen_random_uuid())`, `select usage.unknown_cost_alarm_seconds()`]) {
        const result = await attempt(db, role, sql);
        expect(result.ok, `${role} ${sql}`).toBe(false);
        if (!result.ok) expect(result.code, `${role} ${sql}`).toBe('42501');
      }
    }
    for (const sql of [`select jobs.mark_ambiguous(gen_random_uuid())`, `select * from jobs.settle_abandoned_counted(null, null, 1)`, `select usage.unknown_cost_alarm_seconds()`]) {
      const result = await attempt(db, 'service_role', sql);
      expect(result.ok, sql).toBe(false);
      if (!result.ok) expect(result.code, sql).toBe('42501');
    }
  });

  it('is unreachable over REST for the anon key, an anon token and a signed-in user\'s own token (the three functions, with the Account\'s own IDs)', async () => {
    const a = await committedAccount('administrator');
    const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const tokenFor = (role: 'authenticated' | 'anon', userId: string) => {
      const claims = {iss: `${stack.apiUrl}/auth/v1`, aud: 'authenticated', role, sub: userId, session_id: randomUUID(), exp: Math.floor(Date.now() / 1000) + 600};
      const unsigned = `${base64url({alg: 'HS256', typ: 'JWT'})}.${base64url(claims)}`;
      return `${unsigned}.${createHmac('sha256', jwtSecretOf(stack)).update(unsigned).digest('base64url')}`;
    };
    const tokens = [
      ['the anon key', stack.anonKey],
      ['an anon-role token', tokenFor('anon', randomUUID())],
      ['the authenticated token of the Administrator\'s own user', tokenFor('authenticated', a.user.id)],
    ] as const;
    const bodies: Record<string, unknown> = {
      reconcile_operation: {p_operation_id: randomUUID(), p_outcome: 'noncharge', p_input_tokens: null, p_output_tokens: null, p_returned_model: null, p_request_id: 'req_1'},
      list_overrun_incidents: {p_account_id: a.accountId, p_epoch: 1, p_limit: 5},
      clear_overrun_incident: {p_account_id: a.accountId, p_epoch: 1, p_command_id: randomUUID(), p_incident_id: randomUUID()},
    };
    const before = await ledger(a.accountId);
    for (const [label, token] of tokens) {
      for (const [name, body] of Object.entries(bodies)) {
        const response = await fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: {apikey: stack.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-profile': 'api'},
          body: JSON.stringify(body),
        });
        const text = await response.text();
        expect(response.status, `${label} calls ${name}`).toBeGreaterThanOrEqual(401);
        expect(response.status, `${label} calls ${name}`).toBeLessThan(500);
        // 42501 proves the request ran as that role and was refused by the database, not by a bad request.
        expect(JSON.parse(text).code, `${label} calls ${name}`).toBe('42501');
        expect(text).not.toContain(a.accountId);
      }
    }
    expect(await ledger(a.accountId)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries the Story 2.8 objects', () => {
  const apiSignatures = ['api.reconcile_operation(uuid,text,bigint,bigint,text,text)', 'api.list_overrun_incidents(uuid,bigint,integer)', 'api.clear_overrun_incident(uuid,bigint,uuid,uuid)'];
  const internalSignatures = [
    'usage.unknown_cost_alarm_seconds()', 'usage.check_correction()', 'jobs.mark_ambiguous(uuid)', 'jobs.settle_abandoned(uuid,uuid,integer)', 'jobs.settle_abandoned_counted(uuid,uuid,integer)',
  ];

  it('answers ok to the service role, reads the corrections table and the incident\'s correction column, looks for seventy-two api functions (fifteen of them the Story 2.8 block, with the three new ones), and keeps every earlier probe', async () => {
    await inTx(async (client) => {
      const answer = await txAttempt(client, 'service_role', 'select ok from api.preflight()');
      expect(answer).toEqual({ok: true, rows: [{ok: true}]});
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [
      'usage.corrections', 'co.settled_delta_microdollars', 'co.digest', 'oi.correction_id', 'Story 2.8 migration', ...apiSignatures, ...internalSignatures,
      'Story 1.5 migration', 'Story 2.4 migration', 'Story 2.6 migration', 'Story 2.5 migration', 'Story 2.7 migration', 'Story 2.11 migration', 'Story 2.12 migration', 'usage.overrun_incidents', 'jobs.leases', 'lifecycle.heartbeats', 'private-files',
    ]) {
      expect(definition, needle).toContain(needle);
    }
    const check = definition.indexOf('where not has_function_privilege');
    const executable = definition.slice(definition.lastIndexOf('unnest(array[', check), check);
    expect(new Set(executable.match(/'api\.[a-z_]+\([^']*\)'/g)).size).toBe(72);
    for (const signature of apiSignatures) expect(executable, signature).toContain(`'${signature}'`);
    // The bucket check stays last.
    expect(definition.indexOf('private-files')).toBeGreaterThan(definition.indexOf('delete Auth identities'));
  });

  it.each([...apiSignatures, ...internalSignatures])('fails the build with one line naming %s when it is missing, and says the Story 2.8 migration is not applied (N3020)', async (signature) => {
    await inTx(async (client) => {
      const spec = (await client.query(`select to_regprocedure($1)::text as name`, [signature])).rows[0].name;
      expect(spec, signature).toBeTruthy();
      await client.query(`drop function ${spec} cascade`);
      const result = await txAttempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain(signature);
        expect(result.message).toContain('Story 2.8');
        expect(result.message.trim().split('\n')).toHaveLength(1);
      }
    });
  });

  it.each(apiSignatures.map((signature) => [signature, signature.replace(/,/g, ', ')]))('fails with 42501 naming %s when the service role cannot execute it', async (signature, spaced) => {
    await inTx(async (client) => {
      await client.query(`revoke execute on function ${spaced} from service_role`);
      const result = await txAttempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(signature);
      }
    });
  });

  it('fails, naming the table and not answering ok, when the role it runs as cannot read usage.corrections', async () => {
    const everything = [
      'identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts',
      'artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance', 'artifacts.retained_pictures',
      'lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats', 'usage.periods', 'jobs.jobs', 'jobs.attempts', 'jobs.steps', 'jobs.operations', 'jobs.commands',
      'usage.rate_schedules', 'usage.reservations', 'usage.settlements', 'usage.overrun_incidents', 'usage.commands', 'provider_private.permissions', 'jobs.outbox', 'jobs.workers', 'jobs.leases', 'jobs.callbacks',
      'usage.corrections', 'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
    ];
    await inTx(async (client) => {
      await client.query('grant usage on schema api, identity, projects, lifecycle, artifacts, usage, jobs, provider_private to anon');
      await client.query('grant create on schema api to anon');
      for (const table of everything.filter((name) => name !== 'usage.corrections')) await client.query(`grant select on ${table} to anon`);
      await client.query('alter function api.preflight() owner to anon');
      const result = await txAttempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok, 'usage.corrections unreadable').toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('corrections');
      }
    });
  });

  it('fails when the corrections table or the incident\'s correction column is missing, naming it', async () => {
    await inTx(async (client) => {
      await client.query('alter table usage.overrun_incidents drop column correction_id cascade');
      const result = await txAttempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42703');
        expect(result.message).toContain('correction_id');
      }
    });
    await inTx(async (client) => {
      await client.query('drop table usage.corrections cascade');
      const result = await txAttempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42P01');
        expect(result.message).toContain('corrections');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('concurrency: one winner, a consistent answer, one settlement, and no deadlock (the Job lock, then the operation row, then the usage lock)', () => {
  it('settles each due operation once when two sweeps run at the same time', async () => {
    const accounts = await Promise.all([committedAccount(), committedAccount(), committedAccount()]);
    const s = await own();
    const made = [];
    for (const a of accounts) made.push(await ambiguousJob(a, s, '25 hours'));
    const [one1, two] = await Promise.all([connect(), connect()]);
    const [first, second] = await Promise.all([sweep(one1), sweep(two)]);
    expect(first.reconciled + second.reconciled).toBeGreaterThanOrEqual(3);
    expect(first.failed + second.failed).toBe(0);
    for (const entry of made) {
      expect(await opRow(entry.operationId)).toMatchObject({state: 'settled'});
      expect((await settlementsOf(entry.operationId)).map((row) => [row.classification, row.settled])).toEqual([['deadline', RESERVED]]);
    }
    expect(await count(db, `select count(*) as n from usage.commands where account_id = any($1) and kind = 'settle'`, [accounts.map((a) => a.accountId)])).toBe(3);
  });

  it('serializes the sweep and a late reconcile_operation either way round: the reconcile first leaves the sweep nothing to settle; the sweep first makes the evidence a correction', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    const s = await own();
    // The reconcile holds the Job and the operation: the sweep waits, then finds the operation settled by the evidence and settles nothing.
    const first = await ambiguousJob(a, s, '25 hours');
    const reconciler = await connect();
    const sweeper = await connect();
    await reconciler.query('begin');
    expect(await reconcile(first.operationId, 'evidence', evidence(s, LOW.input, LOW.output), reconciler)).toMatchObject({outcome: 'reconciled', settled: 1100});
    const sweeperPid = await pidOf(sweeper);
    const sweeping = sweep(sweeper);
    await untilBlocked(sweeperPid);
    await reconciler.query('commit');
    await sweeping;
    expect((await settlementsOf(first.operationId)).map((row) => [row.classification, row.settled])).toEqual([['evidence', 1100]]);
    expect(await opRow(first.operationId)).toMatchObject({state: 'settled'});
    expect(await correctionsOf(first.operationId)).toEqual([]);
    expect(await figures(a.accountId)).toMatchObject({settled: 1100, reserved: 0});

    // The sweep holds them: the reconcile waits, then finds a deadline booking, and its evidence is a correction.
    const second = await ambiguousJob(b, s, '25 hours');
    const holder = await connect();
    const waiter = await connect();
    await holder.query('begin');
    expect((await sweep(holder)).reconciled).toBeGreaterThanOrEqual(1);
    const waiterPid = await pidOf(waiter);
    const reconciling = reconcile(second.operationId, 'evidence', evidence(s, LOW.input, LOW.output), waiter);
    await untilBlocked(waiterPid);
    await holder.query('commit');
    expect(await reconciling).toMatchObject({outcome: 'corrected', delta: -2300, classification: 'deadline', settled: RESERVED});
    expect((await settlementsOf(second.operationId)).map((row) => [row.classification, row.settled])).toEqual([['deadline', RESERVED]]);
    expect(await correctionsOf(second.operationId)).toHaveLength(1);
    expect(await figures(b.accountId)).toMatchObject({settled: 1100, reserved: 0});
  });

  it('makes one correction of late evidence sent together through both doors: one corrected, the same evidence replayed, other evidence already_settled, and one correction row', async () => {
    const a = await committedAccount();
    const s = await own();
    const {operationId} = await bookedAtDeadline(a, s);
    const clients = await Promise.all(Array.from({length: 6}, () => connect()));
    const evidences = [LOW, LOW, LOW, {input: LOW.input + 1, output: LOW.output}, LOW, {input: LOW.input + 1, output: LOW.output}];
    const answers = await Promise.all(
      clients.map((client, index) =>
        index % 2 === 0 ? settleCost(a.accountId, operationId, 'evidence', evidence(s, evidences[index].input, evidences[index].output), client) : reconcile(operationId, 'evidence', evidence(s, evidences[index].input, evidences[index].output), client),
      ),
    );
    expect(answers.filter((answer) => answer.outcome === 'corrected')).toHaveLength(1);
    const [correction] = await correctionsOf(operationId);
    expect(await correctionsOf(operationId)).toHaveLength(1);
    // Whatever won, every other answer is consistent with it: the winner's evidence is replayed, the other evidence is already_settled, and all carry the one correction.
    answers.forEach((answer, index) => {
      if (answer.outcome === 'corrected') return;
      const winners = correction.input_tokens === evidences[index].input;
      expect(answer, `answer ${index}`).toMatchObject({outcome: winners ? 'replayed' : 'already_settled', correction_id: correction.id});
    });
    expect(await settlementsOf(operationId)).toHaveLength(1);
  });

  it('reconciles an operation once however many ask together: one reconciled, the rest replayed, one settlement and the operation settled', async () => {
    const a = await committedAccount();
    const s = await own();
    const {operationId} = await ambiguousJob(a, s, '1 hour');
    const clients = await Promise.all(Array.from({length: 6}, () => connect()));
    const answers = await Promise.all(clients.map((client) => reconcile(operationId, 'evidence', evidence(s, LOW.input, LOW.output), client)));
    expect(answers.map((answer) => answer.outcome).sort()).toEqual(['reconciled', 'replayed', 'replayed', 'replayed', 'replayed', 'replayed']);
    expect(new Set(answers.map((answer) => answer.settlement_id)).size).toBe(1);
    expect(await settlementsOf(operationId)).toHaveLength(1);
    expect(await opRow(operationId)).toMatchObject({state: 'settled'});
    expect(await figures(a.accountId)).toMatchObject({settled: 1100, reserved: 0});
  });

  it('serializes a clearing against another clearing: one cleared, the other already_cleared with the first one\'s time and Administrator, and one audit event', async () => {
    const one1 = await committedAccount('administrator');
    const two = await committedAccount('administrator');
    const a = await committedAccount();
    const made = await overrun(a, await own());
    const first = await connect();
    const second = await connect();
    await first.query('begin');
    const cleared = await clearIncident(one1, made.incidentId, randomUUID(), first);
    expect(cleared).toMatchObject({outcome: 'cleared', cleared_by: `user:${one1.user.id}`});
    const secondPid = await pidOf(second);
    const clearing = clearIncident(two, made.incidentId, randomUUID(), second);
    await untilBlocked(secondPid);
    await first.query('commit');
    expect(await clearing).toEqual({outcome: 'already_cleared', incident_id: made.incidentId, cleared_at: cleared.cleared_at, cleared_by: `user:${one1.user.id}`});
    expect(await auditOf('usage.incident_cleared', `incident:${made.incidentId}`)).toEqual([{actor: `user:${one1.user.id}`, action: 'usage.incident_cleared', target: `incident:${made.incidentId}`}]);
    // And two clearings sent together: exactly one wins.
    const b = await committedAccount();
    const other = await overrun(b, await own());
    const [x, y] = await Promise.all([connect(), connect()]);
    const answers = await Promise.all([clearIncident(one1, other.incidentId, randomUUID(), x), clearIncident(two, other.incidentId, randomUUID(), y)]);
    expect(answers.map((answer) => answer.outcome).sort()).toEqual(['already_cleared', 'cleared']);
    expect(new Set(answers.map((answer) => answer.cleared_by)).size).toBe(1);
    expect(await auditOf('usage.incident_cleared', `incident:${other.incidentId}`)).toHaveLength(1);
  });

  it('serializes a deadline settlement against finish_operation: the report first wins and the sweep skips the operation; the sweep first wins and the report is told invalid_transition', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    const s = await own();
    // The worker's report holds the Job: the sweep waits, then finds the operation no longer ambiguous.
    const first = await ambiguousJob(a, s, '25 hours');
    const worker = await connect();
    const sweeper = await connect();
    await worker.query('begin');
    expect(await finish(first.run, first.operationId, 'noncharge', {requestId: 'req_race_1'}, worker)).toMatchObject({outcome: 'finished', state: 'noncharge', settled: 0, released: RESERVED});
    const sweeperPid = await pidOf(sweeper);
    const sweeping = sweep(sweeper);
    await untilBlocked(sweeperPid);
    await worker.query('commit');
    await sweeping;
    expect((await settlementsOf(first.operationId)).map((row) => row.classification)).toEqual(['noncharge']);
    expect(await opRow(first.operationId)).toMatchObject({state: 'noncharge', request_id: 'req_race_1'});
    // The sweep holds the Job: the worker's report waits, then finds a settled operation and gets a word.
    const second = await ambiguousJob(b, s, '25 hours');
    const holder = await connect();
    const reporter = await connect();
    await holder.query('begin');
    expect((await sweep(holder)).reconciled).toBeGreaterThanOrEqual(1);
    const reporterPid = await pidOf(reporter);
    const reporting = finish(second.run, second.operationId, 'noncharge', {requestId: 'req_race_2'}, reporter);
    await untilBlocked(reporterPid);
    await holder.query('commit');
    expect(await reporting).toMatchObject({outcome: 'invalid_transition', state: 'settled'});
    expect((await settlementsOf(second.operationId)).map((row) => row.classification)).toEqual(['deadline']);
    expect(await opRow(second.operationId)).toMatchObject({state: 'settled', request_id: null});
  });

  it('runs sweeps, reconciliations, reports, cancels, clearings and listings together without a deadlock, and ends with records that reconcile', async () => {
    const admin = await committedAccount('administrator');
    const accounts = await Promise.all([committedAccount(), committedAccount()]);
    const s = await own();
    const units: {a: Fixture; run: Run; first: string; second: string}[] = [];
    for (const a of accounts) {
      for (let index = 0; index < 2; index += 1) {
        const run = await running(a, s, 2);
        units.push({a, run, first: await dispatch(run, 1), second: await dispatch(run, 2)});
      }
    }
    // Incidents to clear, made before the others (an incident blocks admission, and every Job above is admitted already).
    const incidents = [(await overrun(await committedAccount(), await own())).incidentId, (await overrun(await committedAccount(), await own())).incidentId];
    for (const [index, unit] of units.entries()) {
      await ambiguousSince(unit.first, '25 hours');
      if (index % 2 === 1) await ambiguousSince(unit.second, '1 hour');
    }
    const clients = await Promise.all(Array.from({length: 8}, () => connect()));
    const chains: Promise<unknown>[] = clients.map(() => Promise.resolve());
    const calls: Promise<unknown>[] = [];
    let next = 0;
    const run = (work: (client: Client) => Promise<unknown>) => {
      const lane = next++ % clients.length;
      const call = chains[lane].catch(() => undefined).then(() => work(clients[lane]));
      chains[lane] = call;
      calls.push(call);
    };
    run((client) => sweep(client));
    run((client) => sweep(client));
    run((client) => sweep(client));
    for (const [index, unit] of units.entries()) {
      if (index % 2 === 0) {
        run((client) => reconcile(unit.first, 'evidence', evidence(s, LOW.input, LOW.output), client));
        run((client) => finish(unit.run, unit.second, 'completed', evidence(s, LOW.input, LOW.output), client));
      } else {
        run((client) => reconcile(unit.first, 'noncharge', {requestId: `req_soak_${index}`}, client));
        run((client) => reconcile(unit.second, 'evidence', evidence(s, 6000, 100), client));
      }
      run((client) => reconcile(unit.first, 'evidence', evidence(s, LOW.input, LOW.output), client));
    }
    run((client) => client.query('select * from api.cancel_job($1, 1, $2, $3)', [units[0].a.accountId, randomUUID(), units[0].run.jobId]));
    run((client) => client.query('select * from api.cancel_account_jobs($1)', [accounts[1].accountId]));
    for (const incidentId of incidents) {
      run((client) => clearIncident(admin, incidentId, randomUUID(), client));
      run((client) => clearIncident(admin, incidentId, randomUUID(), client));
    }
    run((client) => listIncidents(admin, 50, client));
    const settled = await Promise.allSettled(calls);
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => result.reason as {code?: string; message: string});
    expect(failures.map((failure) => `${failure.code ?? ''} ${failure.message}`)).toEqual([]);
    await sweep();
    const ids = accounts.map((a) => a.accountId);
    // An operation that finished is settled exactly once; one still chargeable is settled not at all; a reservation never has two settlements.
    for (const row of await all(
      `select o.state, (select count(*) from usage.settlements st join usage.reservations r on r.id = st.reservation_id where r.operation_id = o.id)::int as n from jobs.operations o where o.account_id = any($1)`,
      [ids],
    )) {
      if (['completed', 'noncharge', 'settled'].includes(row.state)) expect(row.n, row.state).toBe(1);
      if (['dispatched', 'ambiguous'].includes(row.state)) expect(row.n, row.state).toBe(0);
      expect(row.n).toBeLessThanOrEqual(1);
    }
    expect(await all(`select r.id from usage.reservations r join usage.corrections c on c.reservation_id = r.id where r.account_id = any($1) group by r.id having count(*) > 1`, [ids])).toEqual([]);
    // The figures are the ledgers': settled is the settlements and the corrections, reserved what no settlement released.
    for (const a of accounts) {
      const expected = await one(
        `select (coalesce((select sum(st.settled_microdollars) from usage.settlements st where st.account_id = $1), 0) + coalesce((select sum(c.settled_delta_microdollars) from usage.corrections c where c.account_id = $1), 0))::float8 as settled,
                coalesce((select sum(r.reserved_microdollars) from usage.reservations r where r.account_id = $1 and not exists (select 1 from usage.settlements st where st.reservation_id = r.id)), 0)::float8 as reserved`,
        [a.accountId],
      );
      expect(await figures(a.accountId)).toMatchObject(expected);
      await periodsHold(a.accountId);
    }
    for (const incidentId of incidents) expect(await auditOf('usage.incident_cleared', `incident:${incidentId}`)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls of lib/job-commands.ts and lib/usage.ts against the real database', () => {
  it('reports ambiguous, sweeps, reconciles (evidence, noncharge, late evidence), lists and clears as the application will over REST', async () => {
    const admin = await committedAccount('administrator');
    const member = await committedAccount();
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s, 2);
    const first = await dispatch(run, 1);
    const second = await dispatch(run, 2);
    const fenced = {attemptId: run.attemptId, fence: run.fence};

    expect(await finishOperation({...fenced, operationId: first, outcome: 'ambiguous', requestId: 'req_typed_1'}, {env})).toEqual({outcome: 'finished', operationId: first, state: 'ambiguous', settlement: null});
    expect(await finishOperation({...fenced, operationId: first, outcome: 'ambiguous', requestId: 'req_typed_1'}, {env})).toMatchObject({outcome: 'finished', state: 'ambiguous'});
    expect(await finishOperation({...fenced, operationId: first, outcome: 'completed', usage: {inputTokens: 1, outputTokens: 1, returnedModel: s.model}}, {env})).toEqual({outcome: 'invalid_transition'});
    expect(await finishOperation({...fenced, operationId: second, outcome: 'completed', usage: {inputTokens: 1, outputTokens: 1, returnedModel: 'another-model'}}, {env})).toEqual({outcome: 'invalid_evidence'});
    expect(await finishOperation({...fenced, operationId: second, outcome: 'ambiguous'}, {env})).toMatchObject({outcome: 'finished', state: 'ambiguous'});
    const swept = await sweepAttempts({env});
    expect(Object.keys(swept).sort()).toEqual(['cancelled', 'expired', 'failed', 'marked', 'reconciled', 'settled']);
    for (const value of Object.values(swept)) expect(Number.isSafeInteger(value)).toBe(true);

    const evidenceOf = (inputTokens: number, outputTokens: number) => ({inputTokens, outputTokens, returnedModel: s.model});
    const reconciled = await reconcileOperation({operationId: first, outcome: 'evidence', usage: evidenceOf(HIGH.input, HIGH.output), requestId: 'req_typed_1'}, {env});
    expect(reconciled).toMatchObject({outcome: 'reconciled', operationId: first, state: 'settled', classification: 'evidence', settledMicrodollars: 5100, releasedMicrodollars: RESERVED, overMicrodollars: 1700, correctionId: null, deltaMicrodollars: null});
    const incidentId = reconciled.outcome === 'reconciled' ? reconciled.incidentId : null;
    expect(incidentId).toMatch(uuidLike);
    expect(await reconcileOperation({operationId: first, outcome: 'evidence', usage: evidenceOf(HIGH.input, HIGH.output)}, {env})).toMatchObject({outcome: 'replayed', settledMicrodollars: 5100, incidentId});
    expect(await reconcileOperation({operationId: first, outcome: 'evidence', usage: evidenceOf(1, 1)}, {env})).toEqual({outcome: 'already_settled', operationId: first, state: 'settled', reason: null});
    expect(await reconcileOperation({operationId: second, outcome: 'noncharge', requestId: 'req_typed_nc'}, {env})).toMatchObject({outcome: 'reconciled', state: 'noncharge', classification: 'noncharge', settledMicrodollars: 0, releasedMicrodollars: RESERVED, incidentId: null});
    expect(await reconcileOperation({operationId: randomUUID(), outcome: 'noncharge', requestId: 'req_typed_nc'}, {env})).toEqual({outcome: 'unavailable'});
    await expect(reconcileOperation({operationId: first, outcome: 'evidence', usage: {inputTokens: -1, outputTokens: 1, returnedModel: s.model}}, {env})).rejects.toThrow();

    // The list and the clearing, for the Administrator; the member is denied.
    const listed = await listOverrunIncidents({accountId: admin.accountId, epoch: admin.epoch}, {limit: 200}, {env});
    expect(listed.outcome).toBe('listed');
    const entry = listed.outcome === 'listed' ? listed.incidents.find((incident) => incident.id === incidentId) : undefined;
    expect(entry).toMatchObject({accountId: a.accountId, provider: s.provider, operationId: first, jobId: run.jobId, reserved: RESERVED, evidence: 5100, over: 1700, clearedAt: null, clearedBy: null, clearedByEmail: null});
    expect(await listOverrunIncidents({accountId: member.accountId, epoch: member.epoch}, {}, {env})).toEqual({outcome: 'denied'});
    expect(await clearOverrunIncident({accountId: member.accountId, epoch: member.epoch}, {commandId: randomUUID(), incidentId: incidentId!}, {env})).toEqual({outcome: 'denied'});
    const cleared = await clearOverrunIncident({accountId: admin.accountId, epoch: admin.epoch}, {commandId: randomUUID(), incidentId: incidentId!}, {env});
    expect(cleared).toMatchObject({outcome: 'cleared', incidentId, clearedBy: `user:${admin.user.id}`});
    expect(await clearOverrunIncident({accountId: admin.accountId, epoch: admin.epoch}, {commandId: randomUUID(), incidentId: incidentId!}, {env})).toMatchObject({outcome: 'already_cleared', incidentId, clearedBy: `user:${admin.user.id}`});
    expect(await clearOverrunIncident({accountId: admin.accountId, epoch: admin.epoch}, {commandId: randomUUID(), incidentId: randomUUID()}, {env})).toEqual({outcome: 'unavailable'});
    const after = await listOverrunIncidents({accountId: admin.accountId, epoch: admin.epoch}, {limit: 200}, {env});
    expect(after.outcome === 'listed' && after.incidents.find((incident) => incident.id === incidentId)).toMatchObject({clearedBy: `user:${admin.user.id}`, clearedByEmail: admin.user.email});

    // Late evidence after a deadline booking, through the typed call: a correction with its signed delta.
    const booked = await bookedAtDeadline(a, await own());
    const lateEvidence = {inputTokens: LOW.input, outputTokens: LOW.output, returnedModel: booked.run.schedule.model};
    const corrected = await reconcileOperation({operationId: booked.operationId, outcome: 'evidence', usage: lateEvidence}, {env});
    expect(corrected).toMatchObject({outcome: 'corrected', classification: 'deadline', settledMicrodollars: RESERVED, releasedMicrodollars: RESERVED, overMicrodollars: 0, deltaMicrodollars: -2300, incidentId: null});
    expect(await reconcileOperation({operationId: booked.operationId, outcome: 'evidence', usage: lateEvidence}, {env})).toMatchObject({outcome: 'replayed', deltaMicrodollars: -2300});
    expect(await reconcileOperation({operationId: booked.operationId, outcome: 'noncharge', requestId: 'req_typed_late'}, {env})).toEqual({outcome: 'not_reconcilable', operationId: booked.operationId, state: 'settled'});
  });

  it('carries the database\'s reason of an invalid_evidence through reconcileOperation: model_mismatch for another model and overflow for evidence that prices above the bound, on an ambiguous operation and on a settled one', async () => {
    const a = await committedAccount();
    const s = await own();
    const ambiguous = await ambiguousJob(a, s, '1 hour');
    const wrongModel = {operationId: ambiguous.operationId, outcome: 'evidence' as const, usage: {inputTokens: 10, outputTokens: 10, returnedModel: 'another-model'}};
    expect(await reconcileOperation(wrongModel, {env})).toEqual({outcome: 'invalid_evidence', operationId: ambiguous.operationId, state: 'ambiguous', reason: 'model_mismatch'});
    const tooMuch = {operationId: ambiguous.operationId, outcome: 'evidence' as const, usage: {inputTokens: 2_000_000_000_000_000, outputTokens: 0, returnedModel: s.model}};
    expect(await reconcileOperation(tooMuch, {env})).toEqual({outcome: 'invalid_evidence', operationId: ambiguous.operationId, state: 'ambiguous', reason: 'overflow'});
    // Refused: the operation is as it was, with nothing settled.
    expect(await opRow(ambiguous.operationId)).toMatchObject({state: 'ambiguous'});
    expect(await settlementsOf(ambiguous.operationId)).toEqual([]);
    // After a deadline booking the evidence would be a correction, and the same refusals apply there: the reason still comes from the settlement's own answer.
    const booked = await bookedAtDeadline(a, await own());
    const lateWrong = {operationId: booked.operationId, outcome: 'evidence' as const, usage: {inputTokens: 10, outputTokens: 10, returnedModel: 'another-model'}};
    expect(await reconcileOperation(lateWrong, {env})).toEqual({outcome: 'invalid_evidence', operationId: booked.operationId, state: 'settled', reason: 'model_mismatch'});
    expect(await reconcileOperation({...tooMuch, operationId: booked.operationId, usage: {...tooMuch.usage, returnedModel: booked.run.schedule.model}}, {env})).toEqual({outcome: 'invalid_evidence', operationId: booked.operationId, state: 'settled', reason: 'overflow'});
    expect(await correctionsOf(booked.operationId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('markDispatchedFor against the real api.run_step: the adapter\'s identity has to be the operation that was dispatched', () => {
  it('is true for the operation the step dispatched, and false when the adapter names another operation (nothing is sent for it)', async () => {
    const a = await committedAccount();
    const s = await own();
    const run = await running(a, s, 2);
    const [first, second] = run.planned;
    const reservationOf = async (operationId: string) => (await one('select id from usage.reservations where operation_id = $1', [operationId])).id as string;
    const identityOf = async (operationId: string) => ({provider: 'brave' as const, operationId, reservationId: await reservationOf(operationId)});

    // The site names step `search` and ordinal 1: the database dispatches the first operation and answers about it, which is the one the adapter named.
    const markFirst = markDispatchedFor({attemptId: run.attemptId, fence: run.fence, stepKey: 'search', ordinal: 1}, {env});
    expect(await markFirst(await identityOf(first))).toBe(true);
    expect(await opRow(first)).toMatchObject({state: 'dispatched'});

    // Another operation's identity at the site of ordinal 2: the database answers about the SECOND operation, not the one the adapter named (the first), so the answer is false.
    const markSecond = markDispatchedFor({attemptId: run.attemptId, fence: run.fence, stepKey: 'search', ordinal: 2}, {env});
    expect(await markSecond(await identityOf(first))).toBe(false);
    // An operation that is nobody's is false too, wherever the site points.
    const markOther = markDispatchedFor({attemptId: run.attemptId, fence: run.fence, stepKey: 'search', ordinal: 2}, {env});
    expect(await markOther({provider: 'brave', operationId: randomUUID(), reservationId: randomUUID()})).toBe(false);
    // A fence that is not the attempt's is false, as before.
    const markStranger = markDispatchedFor({attemptId: run.attemptId, fence: randomUUID(), stepKey: 'search', ordinal: 2}, {env});
    expect(await markStranger(await identityOf(second))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.list_overrun_incidents: the limit cuts the END of the order (open first, then newest), never an open incident', () => {
  it('with three incidents, the newest cleared, a limit of 2 returns the two open ones (newest first) and cuts the cleared one; a limit of 3 puts the cleared one last', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const first = await overrun(a, await own());
    const second = await overrun(a, await own(), 6000, 100);
    const third = await overrun(a, await own(), 7000, 100);
    // The newest incident is the one that gets cleared.
    expect(await clearIncident(admin, third.incidentId)).toMatchObject({outcome: 'cleared'});
    const mine = [first, second, third].map((made) => made.incidentId);

    // The list is global (every Account's incidents), and other cases of the suite leave open incidents of their own. So the case runs in a transaction that is rolled back, in which the
    // incidents of everybody else are removed: the three are all there is. (A delete is allowed on the ledger, and nothing here is committed.)
    const client = await connect();
    try {
      await client.query('begin');
      await client.query('delete from usage.overrun_incidents where id <> all($1::uuid[])', [mine]);
      const two = await listIncidents(admin, 2, client);
      expect(two.outcome).toBe('listed');
      // Both open incidents, the newer of them first; the cleared one (the newest of the three) is cut, and the oldest open one is NOT.
      expect(two.incidents?.map((entry) => entry.incident_id)).toEqual([second.incidentId, first.incidentId]);
      expect(two.incidents?.every((entry) => entry.cleared_at === null)).toBe(true);
      const one1 = await listIncidents(admin, 1, client);
      expect(one1.incidents?.map((entry) => entry.incident_id)).toEqual([second.incidentId]);
      const three = await listIncidents(admin, 3, client);
      expect(three.incidents?.map((entry) => entry.incident_id)).toEqual([second.incidentId, first.incidentId, third.incidentId]);
      expect(three.incidents?.[2].cleared_at).not.toBeNull();
      const fifty = await listIncidents(admin, 50, client);
      expect(fifty.incidents?.map((entry) => entry.incident_id)).toEqual([second.incidentId, first.incidentId, third.incidentId]);
    } finally {
      await client.query('rollback').catch(() => undefined);
    }
    // Nothing was really removed.
    expect(await count(db, 'select count(*) as n from usage.overrun_incidents where id = any($1::uuid[])', [mine])).toBe(3);
  });

  it('in the real, shared list the same order holds: no cleared incident comes before an open one, and a limit of exactly the open incidents returns all of them and no cleared one', async () => {
    const admin = await committedAccount('administrator');
    const a = await committedAccount();
    const made = await overrun(a, await own());
    const cleared = await overrun(a, await own(), 7000, 100);
    expect(await clearIncident(admin, cleared.incidentId)).toMatchObject({outcome: 'cleared'});
    // One snapshot for the count and for the lists, whatever else the suite is doing meanwhile.
    const client = await connect();
    try {
      await client.query('begin isolation level repeatable read');
      const open = await count(client, 'select count(*) as n from usage.overrun_incidents where cleared_at is null');
      expect(open).toBeGreaterThanOrEqual(1);
      const exactly = await listIncidents(admin, Math.min(open, 200), client);
      expect(exactly.incidents?.length).toBe(Math.min(open, 200));
      expect(exactly.incidents?.every((entry) => entry.cleared_at === null)).toBe(true);
      if (open < 200) {
        const withOne = await listIncidents(admin, open + 1, client);
        expect(withOne.incidents?.slice(0, open).every((entry) => entry.cleared_at === null)).toBe(true);
        expect(withOne.incidents?.[open].cleared_at).not.toBeNull();
        // The oldest open incident is the one a smaller limit cuts first.
        if (open > 1) {
          const fewer = await listIncidents(admin, open - 1, client);
          expect(fewer.incidents?.every((entry) => entry.cleared_at === null)).toBe(true);
          expect(fewer.incidents?.map((entry) => entry.incident_id)).toEqual(exactly.incidents?.slice(0, open - 1).map((entry) => entry.incident_id));
        }
      }
    } finally {
      await client.query('rollback').catch(() => undefined);
    }
    expect(made.incidentId).toMatch(uuidLike);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a Project that is tombstoned or deleted keeps its lost operations: the sweep marks them ambiguous and settles them at the deadline', () => {
  const goes = {
    tombstoned: (projectId: string) => db.query(`select api.record_tombstone('project', $1)`, [projectId]),
    deleted: (projectId: string) => db.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [projectId]),
  } as const;

  it.each(Object.keys(goes) as (keyof typeof goes)[])('%s: a dispatched operation of a lost lease is marked, and one 24 hours past its outcome is settled at the reservation (class deadline) and becomes settled', async (kind) => {
    const a = await committedAccount();
    const s = await own();
    // One operation whose worker never reported (its lease will run out) and one that went ambiguous 25 hours ago; each in a Job of a Project that then goes.
    const lost = await running(a, s, 1);
    const lostOperation = await dispatch(lost);
    const aged = await ambiguousJob(a, s, '25 hours');
    await goes[kind](lost.projectId);
    await goes[kind](aged.run.projectId);

    // What a fenced report answers for a Project that is gone, and what the operation stays: the code answers `unavailable` (the Project is not held) and writes nothing.
    const before = await ledger(a.accountId);
    expect(await finish(lost, lostOperation, 'ambiguous', {requestId: 'req_gone'})).toMatchObject({outcome: 'unavailable'});
    expect(await opRow(lostOperation)).toMatchObject({state: 'dispatched', stamped: false, request_id: null});
    expect(await ledger(a.accountId)).toEqual(before);

    // The lease runs out, and the sweep (which asks nothing of the Project) marks the dispatched operation ambiguous and settles the due one at its reservation.
    await backdateLease(db, lost.attemptId, 5);
    const swept = await sweep();
    expect(swept.marked).toBeGreaterThanOrEqual(1);
    expect(swept.reconciled).toBeGreaterThanOrEqual(1);
    expect(await opRow(lostOperation)).toMatchObject({state: 'ambiguous', stamped: true, ordered: true});
    expect((await opRow(lostOperation)).age_seconds).toBeLessThan(120);
    expect(await settlementsOf(lostOperation)).toEqual([]);
    expect(await opRow(aged.operationId)).toMatchObject({state: 'settled'});
    expect((await settlementsOf(aged.operationId)).map((row) => [row.classification, row.settled, row.released])).toEqual([['deadline', RESERVED, RESERVED]]);
    // The lost operation holds its whole reservation; the aged one's is booked at the reservation. Together: one settled, one held.
    expect(await figures(a.accountId)).toMatchObject({settled: RESERVED, reserved: RESERVED});

    // Once the lost operation's outcome is 24 hours old it is settled the same way. Its stamp cannot be rewritten, so a second lost operation is made already aged by the owner's move.
    const second = await running(a, s, 1);
    const secondOperation = await dispatch(second);
    await goes[kind](second.projectId);
    await backdateLease(db, second.attemptId, 5);
    await ambiguousSince(secondOperation, '25 hours');
    const again = await sweep();
    expect(again.reconciled).toBeGreaterThanOrEqual(1);
    expect(await opRow(secondOperation)).toMatchObject({state: 'settled'});
    expect((await settlementsOf(secondOperation)).map((row) => row.classification)).toEqual(['deadline']);
    // Reconciliation is authority-free as well: late evidence for the gone Project's operation is a correction.
    expect(await reconcile(secondOperation, 'evidence', evidence(s, LOW.input, LOW.output))).toMatchObject({outcome: 'corrected', delta: LOW.input + LOW.output - RESERVED});
    await periodsHold(a.accountId);
  });
});
