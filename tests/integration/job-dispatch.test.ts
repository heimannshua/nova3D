import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {leaseExpiredSeconds, outboxAgeCondition, outboxAgeSeconds, leaseExpiredUnclaimedCondition} from '@/lib/alarm-conditions';
import {
  cancelAccountJobs,
  cancelJob,
  claimAttempt,
  claimOutbox,
  finishAttempt,
  finishOperation,
  listJobs,
  markPublished,
  readJobDetail,
  registerWorker,
  renewLease,
  runStep,
  submitJob,
  sweepAttempts,
} from '@/lib/job-commands';
import {jsonbText, planBytes, planToWire} from '@/lib/job-commands';
import {dispatchConstants, handleDispatchRequest, publishRows, publishSubmitted, runOutboxSweep, submitAndPublish, workloadResultDigest} from '@/lib/job-dispatch';
import {alarmObservations} from '@/lib/lifecycle';
import {handleWorkerRequest} from '@/lib/worker-commands';
import {bodyDigest} from '@/lib/service-signing';
import {createHarness, sha} from '../support/accounts-db';
import {
  ageOutbox,
  backdateLease,
  fakePublisher,
  fixtureSchedule,
  inputDigest,
  jobCommands,
  planOperation,
  raiseRevision,
  typedOperation,
  seedJob,
  testWorker,
  workerCommands,
  type FixtureSchedule,
} from '../support/job-world';
import {signedCall} from '../support/qstash-signature';
import {stackEnvironment} from '../support/stack';
import {truncateGuards} from '../support/truncate-guard';

// Story 2.7 against the Supabase CLI stack: the dispatch outbox that every attempt commits with it, the worker registry, the leases and their fencing tokens, the signed worker
// commands, the sweep, the cancellation on a user's cancel and on an Account's disable, the settlement of a completing Job, and the fifteen api functions that do it. The
// cases run on committed Accounts (the functions need several real connections for the concurrency rows and commit their own transactions), whose data is removed afterwards
// (tests/support/accounts-data.ts deletes the new tables before the Job records). The rate schedules are global: the file makes its own, under a provider of its own, and removes
// them when it is done. Money is integer microdollars: a planned operation of 1,000 bytes and 100 output tokens reserves 3,400.

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

/** Another connection, for the cases that need two sessions at once. A test that fails while it holds a lock must not leave the rest of the file waiting for it. */
const borrowed: Client[] = [];
async function connect() {
  const client = await openConnection();
  borrowed.push(client);
  await client.query(`set idle_in_transaction_session_timeout = '40s'`);
  await client.query(`set lock_timeout = '40s'`);
  return client;
}
// The database has a limited number of connections and the files of the suite run side by side: the sessions a test borrowed are given back when it ends.
afterEach(async () => {
  await Promise.all(borrowed.splice(0).map((client) => client.end().catch(() => undefined)));
});

const tag = randomBytes(3).toString('hex');
const provider = `t27-${tag}`;
let env: Record<string, string>;
let instanceId: string;
beforeAll(async () => {
  env = await stackEnvironment(db);
  instanceId = env.INSTANCE_ID;
});
afterAll(async () => {
  await cleanup();
  await db.query(`delete from usage.rate_schedules where provider = $1`, [provider]);
  await db.query(`delete from jobs.workers where worker_kind like 'itest\\_${tag}%'`);
});

// Fixtures ----------------------------------------------------------------------------------------------------------------------

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; epoch: number};

/** An Account with its Workspace and its `initial` period, made the way registration makes one (identity.activate_account). */
async function account(client: Client): Promise<Fixture> {
  const user = await addUser(client);
  const {rows: made} = await client.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject]);
  const accountId = made[0].id as string;
  const {rows: workspace} = await client.query('select id from projects.workspaces where account_id = $1', [accountId]);
  return {user, accountId, workspaceId: workspace[0].id as string, epoch: 1};
}

async function committedAccount(): Promise<Fixture> {
  const made = await account(db);
  committed.users.push(made.user.id);
  return made;
}

/** A Project, inserted directly (the owner can). */
async function project(client: Client, owner: Fixture): Promise<string> {
  const {rows: made} = await client.query(
    `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'Courtyard bench', 'researching') returning id`,
    [owner.workspaceId, owner.accountId],
  );
  return made[0].id as string;
}

/** A worker version no other run of this file (or leftover) serves: the registry is global. */
const freshVersion = () => 1000 + Math.floor(Math.random() * 1_000_000);

let schedule: FixtureSchedule;
const scheduleOf = async () => (schedule ??= await fixtureSchedule(db, {provider}));
const planWith = async (count = 1, extra: Record<string, unknown> = {}) => {
  const s = await scheduleOf();
  return {operations: Array.from({length: count}, (_, index) => planOperation(s, {stepKey: 'search', ordinal: index + 1})), ...extra};
};
let dear: FixtureSchedule;
/** A schedule that prices a token at ten microdollars, so a request can be over the $1 cap of an operation. */
const dearSchedule = async () => (dear ??= await fixtureSchedule(db, {provider, inputRate: 10, outputRate: 10}));
const RESERVED = 3400;

/** The commands for one Account on the owner's connection. */
const world = (a: Fixture, client: Client = db) => ({jobs: jobCommands(client, a), workers: workerCommands(client), who: {accountId: a.accountId, epoch: a.epoch}});

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as Record<string, any>;
const all = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Record<string, any>[];
const tables = ['jobs', 'attempts', 'steps', 'operations', 'commands', 'outbox', 'leases'] as const;
const counts = async (accountId: string) => {
  const found: Record<string, number> = {};
  for (const table of tables) found[table] = await count(db, `select count(*) as n from jobs.${table} where account_id = $1`, [accountId]);
  found.reservations = await count(db, 'select count(*) as n from usage.reservations where account_id = $1', [accountId]);
  found.settlements = await count(db, 'select count(*) as n from usage.settlements where account_id = $1', [accountId]);
  return found;
};
const attemptRow = async (id: string) => one('select * from jobs.attempts where id = $1', [id]);
const leaseRow = async (attemptId: string) => one('select * from jobs.leases where attempt_id = $1', [attemptId]);
const outboxRow = async (attemptId: string) => one('select * from jobs.outbox where attempt_id = $1', [attemptId]);
const operationRows = async (attemptId: string) => all('select o.* from jobs.operations o join jobs.steps s on s.id = o.step_id where s.attempt_id = $1 order by o.ordinal', [attemptId]);
const figures = async (accountId: string) => one(`select f.settled_microdollars::int as settled, f.reserved_microdollars::int as reserved from usage.periods p, lateral usage.period_figures(p.id) f where p.account_id = $1 order by p.seq desc limit 1`, [accountId]);
const D = (label: string) => sha(label);

/** Waits until the backend is waiting for a lock. */
async function untilBlocked(pid: number) {
  for (let round = 0; round < 200; round += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The backend never waited for a lock.');
}
const pidOf = async (client: Client) => (await client.query('select pg_backend_pid() as pid')).rows[0].pid as number;

/** A Job accepted with one planned, reserved operation, claimed by the built-in step. */
async function claimedJob(a: Fixture, options: {plan?: unknown; project?: string} = {}) {
  const w = world(a);
  const pid = options.project ?? (await project(db, a));
  const submitted = await w.jobs.submit(pid, {plan: options.plan ?? (await planWith(1))});
  expect(submitted.outcome).toBe('accepted');
  const claimed = await w.workers.claim(submitted.attempt_id);
  expect(claimed.outcome).toBe('claimed');
  return {...w, projectId: pid, jobId: submitted.job_id as string, attemptId: submitted.attempt_id as string, outboxId: submitted.outbox_id as string, fence: claimed.fence as string};
}

// ---------------------------------------------------------------------------------------------------
describe('the recorded constants and the closed schema', () => {
  it('holds the recorded constants in SQL and mirrors them in lib/job-dispatch.ts (and the alarm thresholds in lib/alarm-conditions.ts)', async () => {
    const sql = await one(
      `select jobs.lease_seconds() as lease, jobs.renewal_seconds() as renewal, jobs.publish_grace_seconds() as grace, jobs.publish_lease_seconds() as publish_lease,
              jobs.open_job_limit() as open_limit, jobs.outbox_alarm_seconds() as outbox_alarm, jobs.lease_alarm_seconds() as lease_alarm,
              jobs.builtin_version() as version, jobs.builtin_kind() as kind`,
    );
    expect(sql).toEqual({lease: 120, renewal: 30, grace: 15, publish_lease: 60, open_limit: 3, outbox_alarm: 120, lease_alarm: 300, version: 1, kind: 'test_workload'});
    expect(dispatchConstants).toEqual({
      leaseSeconds: sql.lease,
      renewalSeconds: sql.renewal,
      publishGraceSeconds: sql.grace,
      publishLeaseSeconds: sql.publish_lease,
      openJobLimit: sql.open_limit,
      outboxAlarmSeconds: sql.outbox_alarm,
      leaseAlarmSeconds: sql.lease_alarm,
      builtinVersion: sql.version,
      builtinKind: sql.kind,
    });
    expect([outboxAgeSeconds, leaseExpiredSeconds]).toEqual([sql.outbox_alarm, sql.lease_alarm]);
  });

  it('has nine tables in jobs now, the four new ones with row-level security on, no policy and no privilege for any role', async () => {
    const found = await all(`select c.relname, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'jobs' and c.relkind = 'r' order by 1`);
    expect(found.map((row) => row.relname)).toEqual(['attempts', 'callbacks', 'commands', 'jobs', 'leases', 'operations', 'outbox', 'steps', 'workers']);
    expect(found.every((row) => row.rls)).toBe(true);
    const policies = await all(`select 1 from pg_policies where schemaname = 'jobs'`);
    expect(policies).toEqual([]);
    for (const role of ['anon', 'authenticated', 'service_role', 'nova3d_gateway']) {
      for (const table of ['outbox', 'workers', 'leases', 'callbacks']) {
        const privilege = await one(
          `select has_table_privilege($1, 'jobs.' || $2, 'select') or has_table_privilege($1, 'jobs.' || $2, 'insert') or has_table_privilege($1, 'jobs.' || $2, 'update') or has_table_privilege($1, 'jobs.' || $2, 'delete') as any`,
          [role, table],
        );
        expect(privilege.any, `${role} ${table}`).toBe(false);
      }
    }
  });

  it('executes the fifteen api functions for the service role alone, and no internal function for any API role', async () => {
    const names = [
      'submit_job', 'cancel_job', 'list_jobs', 'read_job_detail', 'register_worker', 'claim_attempt', 'renew_lease', 'run_step', 'finish_operation', 'finish_attempt',
      'record_callback', 'claim_outbox', 'mark_published', 'sweep_attempts', 'cancel_account_jobs',
    ];
    const functions = await all(
      `select p.oid::regprocedure::text as signature, p.proname, p.prosecdef, p.proconfig,
              has_function_privilege('service_role', p.oid, 'execute') as service, has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated, has_function_privilege('nova3d_gateway', p.oid, 'execute') as gateway
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = any($1)`,
      [names],
    );
    expect(functions.map((row) => row.proname).sort()).toEqual([...names].sort());
    for (const row of functions) {
      expect(row, row.signature).toMatchObject({service: true, anon: false, authenticated: false, gateway: false, prosecdef: true});
      expect(row.proconfig, row.signature).toContain('search_path=""');
    }
    const internal = await all(
      `select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'jobs' and (has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    expect(internal).toEqual([]);
  });

  it('refuses the service role every direct read or write of the new tables', async () => {
    for (const table of ['outbox', 'workers', 'leases', 'callbacks']) {
      const read = await attempt(db, 'service_role', `select 1 from jobs.${table} limit 1`);
      expect(read.ok, table).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.submit_job: accept, plan, reserve and write the outbox, all together or not at all', () => {
  it('accepts a Job: one Job and attempt 1 waiting at stage accepted, and ONE outbox row that pins the epoch, the revision, the worker version and the plan', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const w = world(a);
    const command = randomUUID();
    const submitted = await w.jobs.submit(pid, {command});
    expect(submitted).toMatchObject({outcome: 'accepted', attempt_number: 1, state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch', refusal: null});
    expect(await counts(a.accountId)).toMatchObject({jobs: 1, attempts: 1, steps: 0, operations: 0, outbox: 1, leases: 0, reservations: 0, commands: 1});
    const outbox = await outboxRow(submitted.attempt_id);
    expect(outbox).toMatchObject({
      id: submitted.outbox_id,
      account_id: a.accountId,
      job_id: submitted.job_id,
      kind: 'test_workload',
      plan: {},
      account_epoch: '1',
      project_revision: '1',
      worker_version: 1,
      publish_until: null,
      published_at: null,
      message_id: null,
    });
    const job = await one('select kind, project_id from jobs.jobs where id = $1', [submitted.job_id]);
    expect(job).toEqual({kind: 'test_workload', project_id: pid});
    const receipt = await one('select kind, subject_id from jobs.commands where account_id = $1 and command_id = $2', [a.accountId, command]);
    expect(receipt).toEqual({kind: 'submit_job', subject_id: submitted.job_id});
  });

  it('pins the Account\'s CURRENT epoch and the Project\'s CURRENT revision, not the ones the Account started with', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    await raiseRevision(db, pid);
    await raiseRevision(db, pid);
    await db.query('select api.raise_authorization_epoch($1, $2)', [a.accountId, 'seed:local:test']);
    const current = (await one('select authorization_epoch::int as e from identity.accounts where id = $1', [a.accountId])).e as number;
    const submitted = await world({...a, epoch: current}).jobs.submit(pid);
    expect(submitted.outcome).toBe('accepted');
    expect(await outboxRow(submitted.attempt_id)).toMatchObject({account_epoch: String(current), project_revision: '3'});
  });

  it('plans each operation with its step, reserves it through api.reserve_cost, and commits the Job, the step, the planned operation, the reservation and the outbox row together', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const plan = await planWith(2);
    const submitted = await world(a).jobs.submit(pid, {plan});
    expect(submitted).toMatchObject({outcome: 'accepted', state: 'waiting', stage: 'accepted'});
    expect(await counts(a.accountId)).toMatchObject({jobs: 1, attempts: 1, steps: 1, operations: 2, reservations: 2, outbox: 1, commands: 1});
    const operations = await operationRows(submitted.attempt_id);
    expect(operations.map((row) => [row.ordinal, row.state])).toEqual([[1, 'planned'], [2, 'planned']]);
    const reservations = await all('select reserved_microdollars::int as amount, provider, job_id from usage.reservations where account_id = $1', [a.accountId]);
    expect(reservations).toEqual([{amount: RESERVED, provider, job_id: submitted.job_id}, {amount: RESERVED, provider, job_id: submitted.job_id}]);
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: 2 * RESERVED});
    expect((await outboxRow(submitted.attempt_id)).plan).toEqual(plan);
    // The stage is still `accepted`: a planned step is not a begun one.
    expect((await attemptRow(submitted.attempt_id)).stage).toBe('accepted');
  });

  it('writes NOTHING when a reservation is refused: no Job, outbox row, step, operation, reservation or receipt, and answers the refusal word and the exact cost block', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const s = await scheduleOf();
    const dear = await dearSchedule();
    // 100,000 bytes of request is a bound of 112,200 tokens, ten microdollars each: over the operation cap ($1).
    const big = {operations: [planOperation(dear, {requestBytes: 100_000, outputLimit: 100})]};
    const refused = await world(a).jobs.submit(pid, {plan: big});
    expect(refused).toMatchObject({outcome: 'refused', refusal: 'over_operation_cap', job_id: null, attempt_id: null, outbox_id: null, limit_microdollars: '1000000', used_microdollars: '0', available_microdollars: '1000000'});
    expect(Number(refused.requested_microdollars)).toBeGreaterThan(1_000_000);
    expect(await counts(a.accountId)).toMatchObject({jobs: 0, attempts: 0, steps: 0, operations: 0, outbox: 0, reservations: 0, commands: 0});
    // A second operation that is refused undoes the first one that was reserved.
    const second = {operations: [planOperation(s, {ordinal: 1}), planOperation(dear, {ordinal: 2, requestBytes: 100_000})]};
    const refusedLater = await world(a).jobs.submit(pid, {plan: second});
    expect(refusedLater).toMatchObject({outcome: 'refused', refusal: 'over_operation_cap'});
    expect(await counts(a.accountId)).toMatchObject({jobs: 0, attempts: 0, steps: 0, operations: 0, outbox: 0, reservations: 0, commands: 0});
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: 0});
  });

  it('refuses each reason a reservation can be refused for, with its word: an unknown rate (unavailable_bound), an allowance that is too small, and a permissioned provider', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const s = await scheduleOf();
    const unknown = await world(a).jobs.submit(pid, {plan: {operations: [{...planOperation(s), schedule_id: randomUUID()}]}});
    expect(unknown).toMatchObject({outcome: 'refused', refusal: 'unavailable_bound', refusal_reason: 'unknown_rate', requested_microdollars: null});
    // The allowance: a limit of 0 holds nothing.
    await db.query(`delete from usage.periods where account_id = $1`, [a.accountId]);
    await db.query(
      `insert into usage.periods (account_id, seq, month_start, limit_microdollars, carried_settled_microdollars, carried_reserved_microdollars, cause, previous_limit_microdollars, actor, command_id, digest)
       values ($1, 1, usage.current_month(), 0::bigint, 0, 0, 'initial', null, 'system', null, usage.period_digest($1, 1, usage.current_month(), 0::bigint, 0::bigint, 0::bigint, 'initial'))`,
      [a.accountId],
    );
    const poor = await world(a).jobs.submit(pid, {plan: await planWith(1)});
    expect(poor).toMatchObject({outcome: 'refused', refusal: 'insufficient_allowance', requested_microdollars: String(RESERVED), limit_microdollars: '0', available_microdollars: '0'});
    // A permissioned provider is refused with the word the reservation gives (Story 2.5 adds its permission argument in jobs.reserve_planned only).
    const anthropic = await fixtureSchedule(db, {provider: 'anthropic', model: `t27-${tag}-claude`});
    const permissioned = await world(a).jobs.submit(pid, { plan: {operations: [planOperation(anthropic)]} });
    expect(permissioned).toMatchObject({outcome: 'refused', refusal: 'permission_required'});
    expect(await counts(a.accountId)).toMatchObject({jobs: 0, attempts: 0, outbox: 0, reservations: 0, commands: 0});
    await db.query(`delete from usage.rate_schedules where id = $1`, [anthropic.id]);
  });

  it('answers at_capacity, carrying the count and 3, for a fourth Job with a waiting or running attempt, and writes nothing; an ended Job frees a slot', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const w = world(a);
    const first = await w.jobs.submit(pid);
    const second = await w.jobs.submit(pid);
    const third = await w.jobs.submit(pid);
    expect([first, second, third].map((row) => row.outcome)).toEqual(['accepted', 'accepted', 'accepted']);
    const before = await counts(a.accountId);
    const fourth = await w.jobs.submit(pid);
    expect(fourth).toMatchObject({outcome: 'at_capacity', open_jobs: 3, open_limit: 3, job_id: null});
    expect(await counts(a.accountId)).toEqual(before);
    // Running counts too; a cancelled Job does not.
    expect((await w.workers.claim(first.attempt_id)).outcome).toBe('claimed');
    expect((await w.jobs.submit(pid)).outcome).toBe('at_capacity');
    expect((await w.jobs.cancel(second.job_id)).outcome).toBe('cancelled');
    expect((await w.jobs.submit(pid)).outcome).toBe('accepted');
    // Another Account has its own three.
    const b = await committedAccount();
    expect((await world(b).jobs.submit(await project(db, b))).outcome).toBe('accepted');
  });

  it('replays the same command (the same Job, attempt and outbox row, one of each) and refuses another payload with `reused`, writing nothing; another command ID makes another Job', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const other = await project(db, a);
    const w = world(a);
    const plan = await planWith(1);
    const command = randomUUID();
    const first = await w.jobs.submit(pid, {command, plan});
    const again = await w.jobs.submit(pid, {command, plan});
    expect(again).toMatchObject({outcome: 'replayed', job_id: first.job_id, attempt_id: first.attempt_id, outbox_id: first.outbox_id, attempt_number: 1, state: 'waiting'});
    const before = await counts(a.accountId);
    expect(before).toMatchObject({jobs: 1, attempts: 1, outbox: 1, reservations: 1, commands: 1});
    for (const changed of [
      {projectId: other, plan},
      {projectId: pid, plan: await planWith(2)},
      {projectId: pid, plan, digest: D('another input')},
      {projectId: pid, plan, workerVersion: 2},
      {projectId: pid, plan: {...plan, outcome: 'fail'}},
    ]) {
      const reused = await w.jobs.submit(changed.projectId, {command, plan: changed.plan, digest: changed.digest, workerVersion: changed.workerVersion});
      expect(reused.outcome).toBe('reused');
    }
    expect(await counts(a.accountId)).toEqual(before);
    // The same command ID of another kind of command is reused too.
    expect((await w.jobs.cancel(first.job_id, {command})).outcome).toBe('reused');
    // A replay carries the attempt as it is now.
    await w.workers.claim(first.attempt_id);
    expect(await w.jobs.submit(pid, {command, plan})).toMatchObject({outcome: 'replayed', state: 'running'});
    expect((await w.jobs.submit(pid, {plan})).job_id).not.toBe(first.job_id);
  });

  it('raises 22023 for a kind other than test_workload and for a bad ID, digest, plan or worker version, and writes nothing', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const s = await scheduleOf();
    const op = planOperation(s);
    const bad: [string, unknown[]][] = [
      ['kind', [a.accountId, 1, randomUUID(), pid, 'research', inputDigest, '{}', null]],
      ['digest', [a.accountId, 1, randomUUID(), pid, 'test_workload', 'xyz', '{}', null]],
      ['null project', [a.accountId, 1, randomUUID(), null, 'test_workload', inputDigest, '{}', null]],
      ['null command', [a.accountId, 1, null, pid, 'test_workload', inputDigest, '{}', null]],
      ['epoch', [a.accountId, 0, randomUUID(), pid, 'test_workload', inputDigest, '{}', null]],
      ['version', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, '{}', 0]],
      ['plan not an object', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, '[]', null]],
      ['plan outcome', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, '{"outcome":"explode"}', null]],
      ['plan member', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, '{"retry":true}', null]],
      ['four operations', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [1, 2, 3, 4].map((ordinal) => ({...op, ordinal}))}), null]],
      ['a repeated pair', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [op, op]}), null]],
      ['ordinal 0', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [{...op, ordinal: 0}]}), null]],
      ['ordinal 101', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [{...op, ordinal: 101}]}), null]],
      ['a fractional size', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [{...op, request_bytes: 1.5}]}), null]],
      ['an operation member', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [{...op, extra: 1}]}), null]],
      ['a missing member', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [{step_key: 'search'}]}), null]],
      ['options not an object', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [{...op, options: 'x'}]}), null]],
      ['over 4 KB', [a.accountId, 1, randomUUID(), pid, 'test_workload', inputDigest, JSON.stringify({operations: [{...op, options: {pad: 'x'.repeat(5000)}}]}), null]],
    ];
    for (const [label, params] of bad) {
      const result = await attempt(db, null, 'select * from api.submit_job($1, $2, $3, $4, $5, $6, $7::jsonb, $8)', params);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('22023');
    }
    expect(await counts(a.accountId)).toMatchObject({jobs: 0, attempts: 0, outbox: 0, reservations: 0, commands: 0});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the outbox: every attempt commits with its row, and the row changes only by its publication', () => {
  it('gives every attempt exactly one outbox row in the same transaction, a retry\'s included (it keeps the version, runs the plan {} and pins the epoch and revision of the retry)', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const w = world(a);
    const submitted = await w.jobs.submit(pid, {plan: await planWith(1), workerVersion: 1});
    const claimed = await w.workers.claim(submitted.attempt_id);
    expect((await w.workers.finish(submitted.attempt_id, claimed.fence, 'failed')).outcome).toBe('finished');
    await raiseRevision(db, pid);
    const retry = await w.jobs.retry(submitted.job_id, 1);
    expect(retry).toMatchObject({outcome: 'created', attempt_number: 2});
    const rows = await all('select attempt_id, plan, worker_version, project_revision::int as revision from jobs.outbox where job_id = $1 order by created_at', [submitted.job_id]);
    expect(rows.map((row) => row.attempt_id)).toEqual([submitted.attempt_id, retry.attempt_id]);
    expect(rows[1]).toMatchObject({plan: {}, worker_version: 1, revision: 2});
    // A transaction that inserts an attempt and rolls back leaves no outbox row, and one that commits has it (the trigger runs inside it).
    const outsider = await connect();
    await outsider.query('begin');
    await outsider.query(`insert into jobs.jobs (account_id, project_id, kind) values ($1, $2, 'x_kind') returning id`, [a.accountId, pid]);
    const orphan = await outsider.query(`select id from jobs.jobs where account_id = $1 and kind = 'x_kind'`, [a.accountId]);
    await outsider.query(`insert into jobs.attempts (account_id, job_id, number, input_digest, state, stage) values ($1, $2, 1, $3, 'waiting', 'accepted')`, [a.accountId, orphan.rows[0].id, inputDigest]);
    expect((await outsider.query('select count(*)::int as n from jobs.outbox where job_id = $1', [orphan.rows[0].id])).rows[0].n).toBe(1);
    await outsider.query('rollback');
    expect(await count(db, 'select count(*) as n from jobs.outbox where job_id = $1', [orphan.rows[0].id])).toBe(0);
  });

  it('refuses every update of an outbox row but the publisher\'s lease and the one-time published_at and message_id, and refuses to empty the table', async () => {
    const a = await committedAccount();
    const submitted = await world(a).jobs.submit(await project(db, a));
    const id = submitted.outbox_id as string;
    for (const [column, value] of [['plan', `'{"outcome":"fail"}'::jsonb`], ['account_epoch', '7'], ['project_revision', '7'], ['worker_version', '9'], ['kind', `'other_kind'`], ['created_at', 'now()'], ['account_id', `'${randomUUID()}'`]]) {
      const result = await attempt(db, null, `update jobs.outbox set ${column} = ${value} where id = $1`, [id]);
      expect(result.ok, column).toBe(false);
      if (!result.ok) expect(result.code, column).toBeOneOf(['55000', '23503']);
    }
    // The lease may move; the publication may be written once, together, and then nothing moves.
    expect((await attempt(db, null, `update jobs.outbox set publish_until = clock_timestamp() + interval '1 minute' where id = $1`, [id])).ok).toBe(true);
    const half = await attempt(db, null, `update jobs.outbox set published_at = clock_timestamp() where id = $1`, [id]);
    expect(half.ok).toBe(false);
    expect((await attempt(db, null, `update jobs.outbox set published_at = clock_timestamp(), message_id = 'msg_1' where id = $1`, [id])).ok).toBe(true);
    for (const sql of [`update jobs.outbox set message_id = 'msg_2' where id = $1`, `update jobs.outbox set published_at = null, message_id = null where id = $1`, `update jobs.outbox set publish_until = null where id = $1`]) {
      const result = await attempt(db, null, sql, [id]);
      expect(result.ok, sql).toBe(false);
      if (!result.ok) expect(result.code).toBe('55000');
    }
    const truncate = await attempt(db, null, 'truncate jobs.outbox');
    expect(truncate.ok).toBe(false);
    if (!truncate.ok) expect(['55000', '0A000']).toContain(truncate.code);
    expect(await truncateGuards(db, ['jobs.outbox', 'jobs.workers', 'jobs.leases', 'jobs.callbacks'])).toEqual({
      'jobs.outbox': ['outbox_no_truncate'],
      'jobs.workers': ['workers_no_truncate'],
      'jobs.leases': ['leases_no_truncate'],
      'jobs.callbacks': ['callbacks_no_truncate'],
    });
  });

  it('shapes the columns: a plan is the closed shape within 4 KB, a message ID is printable ASCII, publication is both or neither', async () => {
    const a = await committedAccount();
    const submitted = await world(a).jobs.submit(await project(db, a));
    for (const [sql, label] of [
      [`update jobs.outbox set message_id = 'has space', published_at = now() where id = $1`, 'message id with a space'],
      [`update jobs.outbox set message_id = '', published_at = now() where id = $1`, 'empty message id'],
    ] as const) {
      const result = await attempt(db, null, sql, [submitted.outbox_id]);
      expect(result.ok, label).toBe(false);
    }
    const insert = await attempt(
      db, null,
      `insert into jobs.outbox (account_id, job_id, attempt_id, kind, plan, account_epoch, project_revision, worker_version) select account_id, job_id, id, 'test_workload', '{"unknown":1}'::jsonb, 1, 1, 1 from jobs.attempts where id = $1`,
      [submitted.attempt_id],
    );
    expect(insert.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('publishing: the request, then the sweep, once', () => {
  it('offers an unpublished row only after 15 seconds, leases it for 60 and offers it to nobody else meanwhile; the named row is offered at any age', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a));
    // A new row is not offered by the sweep's claim, but the request can ask for it by name.
    const fresh = await w.workers.claimOutbox(100);
    expect((fresh.items as {id: string}[]).map((row) => row.id)).not.toContain(submitted.outbox_id);
    const named = await w.workers.claimOutbox(1, submitted.outbox_id);
    expect(named).toMatchObject({claimed: 1});
    expect(named.items[0]).toMatchObject({id: submitted.outbox_id, attempt_id: submitted.attempt_id, job_id: submitted.job_id, kind: 'test_workload'});
    const leased = await outboxRow(submitted.attempt_id);
    const lease = leased.publish_until.getTime() - Date.now();
    expect(lease).toBeGreaterThan(55_000);
    expect(lease).toBeLessThanOrEqual(60_000);
    // Leased: nobody gets it, by name or by age, until the lease runs out.
    await ageOutbox(db, submitted.attempt_id, 20);
    expect((await w.workers.claimOutbox(1, submitted.outbox_id)).claimed).toBe(0);
    const aged = await w.workers.claimOutbox(100);
    expect((aged.items as {id: string}[]).map((row) => row.id)).not.toContain(submitted.outbox_id);
  });

  it('offers a row older than 15 seconds to the sweep, once its lease is free, in order and at most the limit; a published row is never offered again', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const jobs = [await w.jobs.submit(pid), await w.jobs.submit(pid), await w.jobs.submit(pid)];
    for (const [index, job] of jobs.entries()) await ageOutbox(db, job.attempt_id, 30 - index);
    const mine = new Set(jobs.map((job) => job.outbox_id as string));
    const first = await w.workers.claimOutbox(100);
    const claimed = (first.items as {id: string}[]).filter((row) => mine.has(row.id)).map((row) => row.id);
    expect(claimed).toEqual(jobs.map((job) => job.outbox_id));
    // Another claim finds them leased.
    expect(((await w.workers.claimOutbox(100)).items as {id: string}[]).filter((row) => mine.has(row.id))).toEqual([]);
    // A lease that has run out frees the row; the limit is respected; a published row is never offered.
    await db.query(`update jobs.outbox set publish_until = clock_timestamp() - interval '1 second' where id = any($1)`, [[...mine]]);
    expect((await w.workers.mark(jobs[0].outbox_id, 'msg_a')).outcome).toBe('marked');
    const again = await w.workers.claimOutbox(100);
    const offered = (again.items as {id: string}[]).filter((row) => mine.has(row.id)).map((row) => row.id);
    expect(offered).toEqual([jobs[1].outbox_id, jobs[2].outbox_id]);
    expect((await w.workers.claimOutbox(100, jobs[0].outbox_id)).claimed).toBe(0);
    await db.query(`update jobs.outbox set publish_until = clock_timestamp() - interval '1 second' where id = any($1) and published_at is null`, [[...mine]]);
    const limited = await w.workers.claimOutbox(1);
    expect(limited.claimed).toBe(1);
  });

  it('records the message ID once: marked, replayed for the same one, conflict for another (which it returns); an unknown row is an argument error', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a));
    expect(await w.workers.mark(submitted.outbox_id, 'msg_one')).toEqual({outcome: 'marked', message_id: 'msg_one'});
    expect(await w.workers.mark(submitted.outbox_id, 'msg_one')).toEqual({outcome: 'replayed', message_id: 'msg_one'});
    expect(await w.workers.mark(submitted.outbox_id, 'msg_two')).toEqual({outcome: 'conflict', message_id: 'msg_one'});
    expect((await outboxRow(submitted.attempt_id)).message_id).toBe('msg_one');
    for (const params of [[randomUUID(), 'msg_x'], [submitted.outbox_id, 'has space'], [submitted.outbox_id, ''], [null, 'msg_x']]) {
      const result = await attempt(db, null, 'select * from api.mark_published($1, $2)', params);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    }
  });

  it('publishes the row of a Job at once (best effort), with the outbox ID as the deduplication ID, and records the message ID; the sweep then skips it', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a));
    const queue = fakePublisher();
    const config = queue.config(instanceId);
    expect(await publishSubmitted(submitted.outbox_id, {config, accounts: {env}})).toBe('published');
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]).toMatchObject({url: 'http://127.0.0.1:4173/api/dispatch', body: {attempt: submitted.attempt_id, instance: instanceId}, deduplicationId: submitted.outbox_id});
    const row = await outboxRow(submitted.attempt_id);
    expect(row.message_id).toBe(queue.calls[0].messageId);
    expect(row.published_at).toBeInstanceOf(Date);
    // Published once: the request again, and the sweep after 15 seconds, publish nothing.
    expect(await publishSubmitted(submitted.outbox_id, {config, accounts: {env}})).toBe('skipped');
    await ageOutbox(db, submitted.attempt_id, 30);
    const swept = await runOutboxSweep({config, accounts: {env}});
    expect(swept.configured).toBe(true);
    expect(queue.calls.filter((call) => call.deduplicationId === submitted.outbox_id)).toHaveLength(1);
  });

  it('accepts a Job and publishes it in one call (submitAndPublish): at once; a queue that refuses leaves the committed row for the sweep; a refused or replayed submission is told apart', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const queue = fakePublisher();
    const config = queue.config(instanceId);
    const command = randomUUID();
    const first = await submitAndPublish(operation, {commandId: command, projectId: pid, inputDigest}, {config, accounts: {env}});
    expect(first).toMatchObject({submission: {outcome: 'accepted'}, publication: 'published'});
    if (first.submission.outcome !== 'accepted') return;
    expect(queue.calls.map((call) => call.deduplicationId)).toEqual([first.submission.outboxId]);
    // The same command again: replayed, and the row is already published.
    expect(await submitAndPublish(operation, {commandId: command, projectId: pid, inputDigest}, {config, accounts: {env}})).toMatchObject({submission: {outcome: 'replayed'}, publication: 'skipped'});
    expect(queue.calls).toHaveLength(1);
    // A refusing queue: the Job is accepted all the same, the row stays unpublished, and nothing throws.
    queue.setFailing(true);
    const second = await submitAndPublish(operation, {commandId: randomUUID(), projectId: pid, inputDigest}, {config, accounts: {env}});
    expect(second).toMatchObject({submission: {outcome: 'accepted'}, publication: 'failed'});
    if (second.submission.outcome !== 'accepted') return;
    expect((await outboxRow(second.submission.attemptId)).published_at).toBeNull();
    // No queue configured at all: the same.
    expect(await submitAndPublish(operation, {commandId: randomUUID(), projectId: pid, inputDigest}, {config: null, accounts: {env}})).toMatchObject({submission: {outcome: 'accepted'}, publication: 'failed'});
    // A submission that is not accepted publishes nothing.
    expect(await submitAndPublish(operation, {commandId: randomUUID(), projectId: pid, inputDigest}, {config, accounts: {env}})).toEqual({submission: {outcome: 'at_capacity', open: 3, limit: 3}, publication: null});
  });

  it('leaves the row for the sweep when the publication fails, claims it again after the 60-second lease, and never gives it two message IDs', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a));
    const queue = fakePublisher();
    const config = queue.config(instanceId);
    queue.setFailing(true);
    expect(await publishSubmitted(submitted.outbox_id, {config, accounts: {env}})).toBe('failed');
    expect(queue.calls).toHaveLength(0);
    expect((await outboxRow(submitted.attempt_id)).published_at).toBeNull();
    // The sweep, after 15 seconds, while the 60-second lease still holds: nothing is offered. After the lease: offered, and published.
    await ageOutbox(db, submitted.attempt_id, 20);
    queue.setFailing(false);
    const during = await runOutboxSweep({config, accounts: {env}});
    expect(during.published).toBeGreaterThanOrEqual(0);
    expect(queue.calls.filter((call) => call.deduplicationId === submitted.outbox_id)).toHaveLength(0);
    await db.query(`update jobs.outbox set publish_until = clock_timestamp() - interval '1 second' where id = $1`, [submitted.outbox_id]);
    const after = await runOutboxSweep({config, accounts: {env}});
    expect(after.published).toBeGreaterThanOrEqual(1);
    const mine = queue.calls.filter((call) => call.deduplicationId === submitted.outbox_id);
    expect(mine).toHaveLength(1);
    expect((await outboxRow(submitted.attempt_id)).message_id).toBe(mine[0].messageId);
  });

  it('counts a refused publication in the sweep and goes on with the others', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const jobs = [await w.jobs.submit(pid), await w.jobs.submit(pid)];
    for (const job of jobs) await ageOutbox(db, job.attempt_id, 30);
    const queue = fakePublisher();
    queue.failNext(1);
    const rows = (await claimOutbox({limit: 100}, {env})).filter((row) => jobs.some((job) => job.outbox_id === row.id));
    expect(rows).toHaveLength(2);
    const report = await publishRows(rows, queue.config(instanceId), {env});
    expect(report).toEqual({published: 1, failed: 1});
  });

  it('is exactly once when the request and the sweep race: two publishers never take one row, and the queue holds one message', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a));
    await ageOutbox(db, submitted.attempt_id, 30);
    const queue = fakePublisher();
    const config = queue.config(instanceId);
    await Promise.all([
      publishSubmitted(submitted.outbox_id, {config, accounts: {env}}),
      publishSubmitted(submitted.outbox_id, {config, accounts: {env}}),
      runOutboxSweep({config, accounts: {env}}),
      runOutboxSweep({config, accounts: {env}}),
    ]);
    expect(queue.calls.filter((call) => call.deduplicationId === submitted.outbox_id)).toHaveLength(1);
    expect((await outboxRow(submitted.attempt_id)).published_at).toBeInstanceOf(Date);
  });

  it('skips a row another transaction holds (FOR UPDATE SKIP LOCKED) instead of waiting for it', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a));
    await ageOutbox(db, submitted.attempt_id, 30);
    const holder = await connect();
    await holder.query('begin');
    await holder.query('select 1 from jobs.outbox where id = $1 for update', [submitted.outbox_id]);
    const claimed = await w.workers.claimOutbox(100);
    expect((claimed.items as {id: string}[]).map((row) => row.id)).not.toContain(submitted.outbox_id);
    await holder.query('rollback');
    expect(((await w.workers.claimOutbox(100)).items as {id: string}[]).map((row) => row.id)).toContain(submitted.outbox_id);
  });

  it('does not publish without a queue configured: the sweep leaves the rows alone and says so', async () => {
    const a = await committedAccount();
    const submitted = await world(a).jobs.submit(await project(db, a));
    await ageOutbox(db, submitted.attempt_id, 30);
    const swept = await runOutboxSweep({config: null, accounts: {env}});
    expect(swept).toMatchObject({configured: false, claimed: 0, published: 0, publishFailed: 0});
    expect((await outboxRow(submitted.attempt_id)).publish_until).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.register_worker: the registry', () => {
  it('registers a version, replays it, and retires the earlier versions of the same (issuer, worker kind) but no other', async () => {
    const kind = `itest_${tag}_a`;
    const other = `itest_${tag}_b`;
    const w = workerCommands(db);
    const d1 = sha(`${kind}-1`);
    const d2 = sha(`${kind}-2`);
    // (Versions nobody else serves: the registry is global, and a worker of version 2 would make every Job pinned to it elsewhere executable.)
    const v = freshVersion();
    const first = await w.register('cad-worker', kind, v, d1, ['test_workload']);
    expect(first).toMatchObject({outcome: 'registered', version: v, retired: 0});
    expect(await w.register('cad-worker', kind, v, d1, ['test_workload'])).toMatchObject({outcome: 'replayed', worker_id: first.worker_id, retired: 0});
    const unrelated = await w.register('cad-worker', other, v, sha(`${other}-1`), ['test_workload']);
    const engine = await w.register('engine-worker', kind, v, sha(`${kind}-e`), ['test_workload']);
    const second = await w.register('cad-worker', kind, v + 1, d2, ['test_workload']);
    expect(second).toMatchObject({outcome: 'registered', version: v + 1, retired: 1});
    const rows = await all('select id, retired_at from jobs.workers where id = any($1)', [[first.worker_id, second.worker_id, unrelated.worker_id, engine.worker_id]]);
    const retired = Object.fromEntries(rows.map((row) => [row.id, row.retired_at !== null]));
    expect(retired).toEqual({[first.worker_id]: true, [second.worker_id]: false, [unrelated.worker_id]: false, [engine.worker_id]: false});
    // A version below the one in service is superseded, and writes nothing; so is the same version with another image.
    expect(await w.register('cad-worker', kind, v - 1, sha(`${kind}-old`), ['test_workload'])).toMatchObject({outcome: 'superseded', worker_id: second.worker_id, version: v + 1});
    expect(await w.register('cad-worker', kind, v + 1, sha(`${kind}-other`), ['test_workload'])).toMatchObject({outcome: 'superseded', version: v + 1});
    expect(await count(db, `select count(*) as n from jobs.workers where worker_kind = $1`, [kind])).toBe(3);
  });

  it('raises 22023 for a bad issuer, kind, version, digest or list of kinds, and registers nothing', async () => {
    const kind = `itest_${tag}_bad`;
    const good = ['cad-worker', kind, 1, sha('d'), ['test_workload']];
    const bad: [string, unknown[]][] = [
      ['issuer', ['gateway', kind, 1, sha('d'), ['test_workload']]],
      ['kind', ['cad-worker', 'Bad Kind', 1, sha('d'), ['test_workload']]],
      ['version', ['cad-worker', kind, 0, sha('d'), ['test_workload']]],
      ['digest', ['cad-worker', kind, 1, 'xyz', ['test_workload']]],
      ['no kinds', ['cad-worker', kind, 1, sha('d'), []]],
      ['nine kinds', ['cad-worker', kind, 1, sha('d'), Array.from({length: 9}, (_, index) => `k${index}`)]],
      ['a repeated kind', ['cad-worker', kind, 1, sha('d'), ['test_workload', 'test_workload']]],
      ['a bad kind word', ['cad-worker', kind, 1, sha('d'), ['Not A Word']]],
      ['null kinds', ['cad-worker', kind, 1, sha('d'), null]],
    ];
    for (const [label, params] of bad) {
      const result = await attempt(db, null, 'select * from api.register_worker($1, $2, $3, $4, $5)', params);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('22023');
    }
    expect(good).toHaveLength(5);
    expect(await count(db, 'select count(*) as n from jobs.workers where worker_kind = $1', [kind])).toBe(0);
  });

  it('refuses every update of a worker but its one retirement, and truncate', async () => {
    const kind = `itest_${tag}_g`;
    const registered = await workerCommands(db).register('cad-worker', kind, freshVersion(), sha(`${kind}`), ['test_workload']);
    for (const sql of [`update jobs.workers set version = 9 where id = $1`, `update jobs.workers set kinds = array['other'] where id = $1`, `update jobs.workers set image_digest = '${'0'.repeat(64)}' where id = $1`, `update jobs.workers set retired_at = null where id = $1`]) {
      const result = await attempt(db, null, sql, [registered.worker_id]);
      expect(result.ok, sql).toBe(false);
      if (!result.ok) expect(result.code).toBe('55000');
    }
    expect((await attempt(db, null, `update jobs.workers set retired_at = clock_timestamp() where id = $1`, [registered.worker_id])).ok).toBe(true);
    const again = await attempt(db, null, `update jobs.workers set retired_at = clock_timestamp() where id = $1`, [registered.worker_id]);
    expect(again.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.claim_attempt: once, under a lease and a fence', () => {
  it('claims a waiting, executable attempt for the built-in step: running, stage started, a lease of 120 seconds and a fence; a second claim is already_claimed', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const plan = await planWith(1);
    const submitted = await w.jobs.submit(pid, {plan});
    const claimed = await w.workers.claim(submitted.attempt_id);
    expect(claimed).toMatchObject({outcome: 'claimed', attempt_id: submitted.attempt_id, job_id: submitted.job_id, kind: 'test_workload', plan, input_digest: inputDigest, project_revision: '1', account_epoch: '1', worker_version: 1, state: 'running'});
    expect(claimed.fence).toMatch(/^[0-9a-f-]{36}$/);
    const attemptNow = await attemptRow(submitted.attempt_id);
    expect(attemptNow).toMatchObject({state: 'running', stage: 'started', reason: null});
    expect(attemptNow.started_at).toBeInstanceOf(Date);
    const lease = await leaseRow(submitted.attempt_id);
    expect(lease).toMatchObject({fence: claimed.fence, worker_id: null, ended_at: null, end_reason: null});
    expect(lease.expires_at.getTime() - lease.claimed_at.getTime()).toBe(120_000);
    expect(lease.expires_at.getTime()).toBe(new Date(claimed.expires_at).getTime());
    expect((await w.workers.claim(submitted.attempt_id)).outcome).toBe('already_claimed');
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [submitted.attempt_id])).toBe(1);
  });

  it('answers replayed, with its fence, to the SAME registered worker only; the built-in step again is already_claimed', async () => {
    const a = await committedAccount();
    const w = world(a);
    const kind = `itest_${tag}_claim`;
    const version = freshVersion();
    const worker = await w.workers.register('cad-worker', kind, version, sha(kind), ['test_workload']);
    const other = await w.workers.register('engine-worker', kind, version, sha(`${kind}-other`), ['test_workload']);
    const submitted = await w.jobs.submit(await project(db, a), {workerVersion: version});
    const claimed = await w.workers.claim(submitted.attempt_id, worker.worker_id);
    expect(claimed.outcome).toBe('claimed');
    expect((await leaseRow(submitted.attempt_id)).worker_id).toBe(worker.worker_id);
    expect(await w.workers.claim(submitted.attempt_id, worker.worker_id)).toMatchObject({outcome: 'replayed', fence: claimed.fence});
    expect((await w.workers.claim(submitted.attempt_id, other.worker_id)).outcome).toBe('already_claimed');
    expect((await w.workers.claim(submitted.attempt_id)).outcome).toBe('already_claimed');
    // After the lease ended the same worker still gets its (worthless) fence back, and anyone else is too late.
    await w.workers.finish(submitted.attempt_id, claimed.fence, 'failed');
    expect(await w.workers.claim(submitted.attempt_id, worker.worker_id)).toMatchObject({outcome: 'replayed', fence: claimed.fence});
    expect((await w.workers.claim(submitted.attempt_id)).outcome).toBe('already_claimed');
  });

  it('leaves an attempt pinned to a worker version nobody serves waiting with the reason awaiting_worker; a compatible registered worker lets it run', async () => {
    const a = await committedAccount();
    const w = world(a);
    const kind = `itest_${tag}_wait`;
    const version = freshVersion();
    const submitted = await w.jobs.submit(await project(db, a), {workerVersion: version});
    expect(submitted).toMatchObject({outcome: 'accepted', state: 'waiting', reason: 'awaiting_worker'});
    expect((await w.jobs.detail(submitted.job_id)).reason).toBe('awaiting_worker');
    expect(((await w.jobs.list()).items as {reason: string}[]).map((row) => row.reason)).toContain('awaiting_worker');
    // Nobody serves it: the built-in step cannot, and a worker of another version is not the one it waits for.
    expect(await w.workers.claim(submitted.attempt_id)).toMatchObject({outcome: 'waiting_for_worker', state: 'waiting'});
    const wrong = await w.workers.register('cad-worker', `${kind}_v6`, version - 1, sha(`${kind}6`), ['test_workload']);
    expect((await w.workers.claim(submitted.attempt_id, wrong.worker_id)).outcome).toBe('waiting_for_worker');
    // The story's old reads are unchanged: api.read_job still says awaiting_dispatch.
    expect((await db.query('select * from api.read_job($1, 1, $2)', [a.accountId, submitted.job_id])).rows[0].reason).toBe('awaiting_dispatch');
    const right = await w.workers.register('cad-worker', `${kind}_v7`, version, sha(`${kind}7`), ['test_workload']);
    expect((await w.jobs.detail(submitted.job_id)).reason).toBe('awaiting_dispatch');
    expect((await w.workers.claim(submitted.attempt_id)).outcome).toBe('incompatible');
    expect(await w.workers.claim(submitted.attempt_id, right.worker_id)).toMatchObject({outcome: 'claimed', worker_version: version});
  });

  it('says incompatible to a worker that is retired, of another version or without the kind, when the attempt itself can be run', async () => {
    const a = await committedAccount();
    const w = world(a);
    const kind = `itest_${tag}_compat`;
    const pid = await project(db, a);
    // Pinned to version 1: the built-in step serves it, so it is executable.
    const v = freshVersion();
    const retired = await w.workers.register('cad-worker', kind, v, sha(`${kind}1`), ['test_workload']);
    await w.workers.register('cad-worker', kind, v + 1, sha(`${kind}2`), ['test_workload']);
    const otherVersion = await w.workers.register('engine-worker', `${kind}_e`, freshVersion(), sha(`${kind}e4`), ['test_workload']);
    const noKind = await w.workers.register('engine-worker', `${kind}_n`, v, sha(`${kind}n1`), ['something_else']);
    const submitted = await w.jobs.submit(pid);
    for (const [label, worker] of [['retired', retired], ['another version', otherVersion], ['without the kind', noKind]] as const) {
      expect((await w.workers.claim(submitted.attempt_id, worker.worker_id)).outcome, label).toBe('incompatible');
    }
    expect((await w.workers.claim(submitted.attempt_id, randomUUID())).outcome).toBe('incompatible');
    expect(await attemptRow(submitted.attempt_id)).toMatchObject({state: 'waiting'});
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [submitted.attempt_id])).toBe(0);
  });

  it('is blocked while an earlier operation may still be charged: the retry reads awaiting_reconciliation, and runs once the charge is reconciled', async () => {
    const a = await committedAccount();
    const failed = await claimedJob(a, {plan: await planWith(1)});
    const stepped = await failed.workers.step(failed.attemptId, failed.fence, 'search', 1);
    expect(stepped.outcome).toBe('stepped');
    expect((await failed.workers.finish(failed.attemptId, failed.fence, 'failed')).outcome).toBe('finished');
    const retry = await failed.jobs.retry(failed.jobId, 1);
    expect(retry).toMatchObject({outcome: 'created', reason: 'awaiting_reconciliation'});
    expect((await failed.jobs.detail(failed.jobId)).reason).toBe('awaiting_reconciliation');
    expect(await failed.workers.claim(retry.attempt_id)).toMatchObject({outcome: 'blocked', state: 'waiting'});
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [retry.attempt_id])).toBe(0);
    // The charge is reconciled (the owner stands in for Story 2.8): the operation is noncharge with a request ID.
    await db.query(`select api.advance_operation($1, 1, $2, $3, 'noncharge', 'req_reconciled_1')`, [a.accountId, randomUUID(), stepped.operation_id]);
    expect((await failed.jobs.detail(failed.jobId)).reason).toBe('awaiting_dispatch');
    expect((await failed.workers.claim(retry.attempt_id)).outcome).toBe('claimed');
  });

  it('answers not_waiting for a finished attempt and unavailable for an unknown one, and starts nothing', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a));
    await w.jobs.cancel(submitted.job_id);
    expect(await w.workers.claim(submitted.attempt_id)).toMatchObject({outcome: 'not_waiting', state: 'cancelled'});
    expect((await w.workers.claim(randomUUID())).outcome).toBe('unavailable');
    expect(await count(db, 'select count(*) as n from jobs.leases where account_id = $1', [a.accountId])).toBe(0);
    const seeded = await seedJob(db, {accountId: a.accountId, epoch: 1}, await project(db, a), 'completed');
    expect(await w.workers.claim(seeded.attemptId)).toMatchObject({outcome: 'already_claimed'});
  });

  it('cancels the attempt (account_disabled) and answers revoked when the Account\'s authority is gone, and unavailable for a tombstoned Project', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const first = await w.jobs.submit(pid, {plan: await planWith(1)});
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    expect(await w.workers.claim(first.attempt_id)).toMatchObject({outcome: 'revoked', state: 'cancelled'});
    expect(await attemptRow(first.attempt_id)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect((await operationRows(first.attempt_id)).map((row) => row.state)).toEqual(['abandoned']);
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [first.attempt_id])).toBe(0);
    // The reservation of the abandoned operation was released.
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: 0});
    const b = await committedAccount();
    const wb = world(b);
    const pb = await project(db, b);
    const second = await wb.jobs.submit(pb);
    await db.query(`select api.record_tombstone('project', $1)`, [pb]);
    expect((await wb.workers.claim(second.attempt_id)).outcome).toBe('unavailable');
    expect(await attemptRow(second.attempt_id)).toMatchObject({state: 'waiting'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('running a claimed attempt: step, operation, settlement, publication', () => {
  it('runs the planned operation: step, dispatch, completion settled as evidence, the unused remainder released, the attempt completed; history is not rewritten', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: RESERVED});
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    expect(stepped).toMatchObject({outcome: 'stepped', operation_state: 'dispatched', attempt_state: 'running'});
    expect((await attemptRow(job.attemptId)).stage).toBe('search');
    const reservationBefore = await one('select * from usage.reservations where operation_id = $1', [stepped.operation_id]);
    const done = await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed', {input: 1, output: 1, model: (await scheduleOf()).model});
    expect(done).toMatchObject({outcome: 'finished', state: 'completed', settled_microdollars: '2', released_microdollars: String(RESERVED), over_microdollars: '0'});
    // The reservation figure falls by the whole reservation and the settled figure rises by the evidence: the unused remainder is back in the allowance.
    expect(await figures(a.accountId)).toEqual({settled: 2, reserved: 0});
    expect(await one('select * from usage.reservations where operation_id = $1', [stepped.operation_id])).toEqual(reservationBefore);
    const finished = await job.workers.finish(job.attemptId, job.fence, 'completed', workloadResultDigest(inputDigest));
    expect(finished).toMatchObject({outcome: 'finished', state: 'completed', detail: null});
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'completed', reason: null, stage: 'search'});
    expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'completed', detail: null, result_digest: workloadResultDigest(inputDigest)});
    // The same finish again is a replay and changes nothing; so is the same completion.
    expect(await job.workers.finish(job.attemptId, job.fence, 'completed', workloadResultDigest(inputDigest))).toMatchObject({outcome: 'replayed', state: 'completed'});
    expect(await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed', {model: (await scheduleOf()).model})).toMatchObject({outcome: 'not_running'});
    expect(await count(db, 'select count(*) as n from usage.settlements where account_id = $1', [a.accountId])).toBe(1);
  });

  it('runs a duplicate step as a replay (no second dispatch) and refuses an ordinal that names no planned, reserved operation', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    const first = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    expect(await job.workers.step(job.attemptId, job.fence, 'search', 1)).toMatchObject({outcome: 'replayed', step_id: first.step_id, operation_id: first.operation_id, operation_state: 'dispatched'});
    expect((await job.workers.step(job.attemptId, job.fence, 'search', 2)).outcome).toBe('not_planned');
    expect((await job.workers.step(job.attemptId, job.fence, 'other', 1)).outcome).toBe('not_planned');
    // A step with no operation is begun now (and found again).
    expect(await job.workers.step(job.attemptId, job.fence, 'work')).toMatchObject({outcome: 'stepped', operation_id: null});
    expect((await job.workers.step(job.attemptId, job.fence, 'work')).outcome).toBe('replayed');
    expect(await count(db, 'select count(*) as n from jobs.operations o join jobs.steps s on s.id = o.step_id where s.attempt_id = $1', [job.attemptId])).toBe(1);
    // finish_attempt will not complete with the operation still dispatched.
    expect((await job.workers.finish(job.attemptId, job.fence, 'completed')).outcome).toBe('open_operations');
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'running'});
  });

  it('refuses finish_operation outside its states: another attempt\'s operation, a planned one, an unknown one; and records a noncharge with the provider\'s request ID', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a, {plan: await planWith(2)});
    const ops = await operationRows(job.attemptId);
    expect((await job.workers.operation(job.attemptId, job.fence, ops[0].id, 'completed')).outcome).toBe('not_dispatched');
    expect((await job.workers.operation(job.attemptId, job.fence, randomUUID(), 'completed')).outcome).toBe('not_found');
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    expect(await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'noncharge', {requestId: 'req_pre_1'})).toMatchObject({outcome: 'finished', state: 'noncharge', settled_microdollars: '0', released_microdollars: String(RESERVED)});
    expect((await operationRows(job.attemptId))[0]).toMatchObject({state: 'noncharge', request_id: 'req_pre_1'});
    // A completion cannot follow a noncharge.
    expect((await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed')).outcome).toBe('invalid_transition');
    const other = await claimedJob(a);
    expect((await job.workers.operation(job.attemptId, job.fence, (await operationRows(other.attemptId))[0].id, 'completed')).outcome).toBe('not_found');
    const bad = await attempt(db, null, 'select * from api.finish_operation($1, $2, $3, $4, null, null, null, null)', [job.attemptId, job.fence, stepped.operation_id, 'completed']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('22023');
  });

  it('settles evidence above a reservation at the evidence and blocks the provider, and refuses a settlement the calculator cannot price (the move is undone)', async () => {
    const a = await committedAccount();
    const tiny = await fixtureSchedule(db, {provider: `${provider}-over`, inputRate: 1, outputRate: 1});
    const job = await claimedJob(a, {plan: {operations: [planOperation(tiny, {requestBytes: 0, outputLimit: 1})]}});
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    const reserved = Number((await one('select reserved_microdollars from usage.reservations where operation_id = $1', [stepped.operation_id])).reserved_microdollars);
    expect(reserved).toBe(2201);
    const over = await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed', {input: 10_000, output: 10_000, model: tiny.model});
    expect(over).toMatchObject({outcome: 'finished', state: 'completed', settled_microdollars: '20000', released_microdollars: String(reserved), over_microdollars: String(20000 - reserved)});
    expect(await count(db, 'select count(*) as n from usage.overrun_incidents where account_id = $1', [a.accountId])).toBe(1);
    await db.query('delete from usage.overrun_incidents where account_id = $1', [a.accountId]);
    await db.query('delete from usage.settlements where account_id = $1', [a.accountId]);
    await db.query('delete from usage.reservations where account_id = $1', [a.accountId]);
    await db.query(`delete from usage.rate_schedules where id = $1`, [tiny.id]);
  });

  it('fails when the plan says fail: the first operation is dispatched and stays chargeable and held, the attempt is failed/step_failed, and nothing retries by itself', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a, {plan: await planWith(2, {outcome: 'fail'})});
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    expect(stepped.outcome).toBe('stepped');
    expect(await job.workers.finish(job.attemptId, job.fence, 'failed')).toMatchObject({outcome: 'finished', state: 'failed', reason: 'step_failed', detail: 'step_failed'});
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'failed', reason: 'step_failed'});
    expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'failed', detail: 'step_failed'});
    // The dispatched operation stays potentially chargeable and its reservation held; the one that never went out is abandoned and released.
    const states = (await operationRows(job.attemptId)).map((row) => row.state);
    expect(states).toEqual(['dispatched', 'abandoned']);
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: RESERVED});
    expect(await count(db, 'select count(*) as n from usage.settlements where account_id = $1 and classification = $2', [a.accountId, 'unused'])).toBe(1);
    expect(await count(db, 'select count(*) as n from jobs.attempts where job_id = $1', [job.jobId])).toBe(1);
    expect((await job.jobs.detail(job.jobId))).toMatchObject({state: 'failed', can_retry: true, ending: 'step_failed'});
    // Only the user retries, and the retry waits for the charge.
    expect(await job.jobs.retry(job.jobId, 1)).toMatchObject({outcome: 'created', reason: 'awaiting_reconciliation'});
  });

  it('refuses to complete with an operation still planned, and completes a plan with no operation (the step work) with the digest of its input', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const withOp = await claimedJob(a, {project: pid});
    expect((await withOp.workers.finish(withOp.attemptId, withOp.fence, 'completed')).outcome).toBe('open_operations');
    const submitted = await w.jobs.submit(pid);
    const claimed = await w.workers.claim(submitted.attempt_id);
    expect((await w.workers.step(submitted.attempt_id, claimed.fence, 'work')).outcome).toBe('stepped');
    expect((await w.workers.finish(submitted.attempt_id, claimed.fence, 'completed', workloadResultDigest(inputDigest))).outcome).toBe('finished');
    expect((await w.jobs.detail(submitted.job_id))).toMatchObject({state: 'completed', stage: 'work', can_cancel: false, can_retry: false, ending: null, progress: {steps: 1, steps_begun: 1, operations_planned: 0, operations_completed: 0}});
  });

  it('raises 22023 for a bad fence call: null IDs, an unknown outcome, a completion without a digest, a failure with one', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    const bad: [string, string, unknown[]][] = [
      ['renew null', 'select * from api.renew_lease($1, $2)', [null, job.fence]],
      ['step key', 'select * from api.run_step($1, $2, $3, $4)', [job.attemptId, job.fence, 'Bad Key', null]],
      ['step ordinal', 'select * from api.run_step($1, $2, $3, $4)', [job.attemptId, job.fence, 'search', 0]],
      ['finish to', 'select * from api.finish_attempt($1, $2, $3, $4)', [job.attemptId, job.fence, 'cancelled', null]],
      ['completed without digest', 'select * from api.finish_attempt($1, $2, $3, $4)', [job.attemptId, job.fence, 'completed', null]],
      ['failed with digest', 'select * from api.finish_attempt($1, $2, $3, $4)', [job.attemptId, job.fence, 'failed', 'b'.repeat(64)]],
      ['operation outcome', 'select * from api.finish_operation($1, $2, $3, $4, 1, 1, $5, null)', [job.attemptId, job.fence, randomUUID(), 'ambiguous', 'm']],
    ];
    for (const [label, sql, params] of bad) {
      const result = await attempt(db, null, sql, params);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('22023');
    }
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'running'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('leases: renewed in time, expired by the sweep, never extended late', () => {
  it('renews a live lease to 120 seconds from now', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const before = await leaseRow(job.attemptId);
    const renewed = await job.workers.renew(job.attemptId, job.fence);
    expect(renewed).toMatchObject({outcome: 'renewed', state: 'running'});
    const after = await leaseRow(job.attemptId);
    expect(after.expires_at.getTime()).toBeGreaterThan(before.expires_at.getTime());
    expect(after.expires_at.getTime() - after.renewed_at.getTime()).toBe(120_000);
    expect(after.claimed_at.getTime()).toBe(before.claimed_at.getTime());
  });

  it('ends a lease that ran out (expired) and fails its attempt as an interrupted one (lease_lost), exactly once however often the sweep runs, and keeps what was dispatched held', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a, {plan: await planWith(2)});
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    expect(stepped.outcome).toBe('stepped');
    await backdateLease(db, job.attemptId, 5);
    // Before the sweep the lease is live but out of time: every fenced command is refused `expired`, and nothing is published.
    expect((await job.workers.renew(job.attemptId, job.fence)).outcome).toBe('expired');
    expect((await job.workers.step(job.attemptId, job.fence, 'search', 2)).outcome).toBe('expired');
    expect((await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed')).outcome).toBe('expired');
    expect((await job.workers.finish(job.attemptId, job.fence, 'completed')).outcome).toBe('expired');
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'running'});
    await job.workers.sweep();
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'failed', reason: 'lease_lost'});
    expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'expired', detail: 'lease_expired', result_digest: null});
    const endedAt = (await leaseRow(job.attemptId)).ended_at.getTime();
    await job.workers.sweep();
    expect((await leaseRow(job.attemptId)).ended_at.getTime()).toBe(endedAt);
    // The dispatched operation is still chargeable and held; the one that never went out was released.
    expect((await operationRows(job.attemptId)).map((row) => row.state)).toEqual(['dispatched', 'planned'].map((state, index) => (index === 1 ? 'abandoned' : state)));
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: RESERVED});
    // A late renewal, step or finish is refused and publishes nothing; the failure stays terminal until the user retries.
    expect((await job.workers.renew(job.attemptId, job.fence)).outcome).toBe('expired');
    expect((await job.workers.finish(job.attemptId, job.fence, 'completed')).outcome).toBe('expired');
    expect(await count(db, 'select count(*) as n from jobs.attempts where job_id = $1', [job.jobId])).toBe(1);
    expect((await job.jobs.detail(job.jobId))).toMatchObject({state: 'failed', reason: 'lease_lost', ending: 'lease_expired', can_retry: true});
  });

  it('does not touch a lease that is still live, and two sweeps at once end each lease once', async () => {
    const a = await committedAccount();
    const live = await claimedJob(a);
    const dead = await claimedJob(a);
    await backdateLease(db, dead.attemptId, 5);
    const [one, two] = await Promise.all([connect(), connect()]);
    const results = await Promise.all([one, two].map((client) => client.query('select * from api.sweep_attempts()')));
    const ended = results.map((result) => Number(result.rows[0].expired));
    expect(ended.reduce((sum, value) => sum + value, 0)).toBeGreaterThanOrEqual(1);
    expect((await attemptRow(live.attemptId)).state).toBe('running');
    expect((await attemptRow(dead.attemptId)).state).toBe('failed');
    expect(await count(db, `select count(*) as n from jobs.leases where attempt_id = $1 and end_reason = 'expired'`, [dead.attemptId])).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the fence: nothing is published without a live lease, a matching fence, authority and a current revision', () => {
  it('answers fence_mismatch for a wrong fence, a fence of another attempt, an unknown attempt and an unknown fence; nothing changes', async () => {
    const a = await committedAccount();
    const one = await claimedJob(a);
    const two = await claimedJob(a);
    for (const [attemptId, fence] of [[one.attemptId, randomUUID()], [one.attemptId, two.fence], [randomUUID(), one.fence]] as const) {
      expect((await one.workers.renew(attemptId, fence)).outcome).toBe('fence_mismatch');
      expect((await one.workers.step(attemptId, fence, 'search', 1)).outcome).toBe('fence_mismatch');
      expect((await one.workers.finish(attemptId, fence, 'failed')).outcome).toBe('fence_mismatch');
      expect((await one.workers.operation(attemptId, fence, randomUUID(), 'completed')).outcome).toBe('fence_mismatch');
    }
    expect((await attemptRow(one.attemptId)).state).toBe('running');
    expect((await attemptRow(two.attemptId)).state).toBe('running');
  });

  it('answers cancelled, expired and revoked by how the lease ended, to every fenced command', async () => {
    const a = await committedAccount();
    const cancelled = await claimedJob(a);
    await cancelled.jobs.cancel(cancelled.jobId);
    const lost = await claimedJob(a);
    await backdateLease(db, lost.attemptId, 5);
    await lost.workers.sweep();
    const revoked = await claimedJob(a);
    await raiseRevision(db, revoked.projectId);
    expect((await revoked.workers.finish(revoked.attemptId, revoked.fence, 'completed')).outcome).toBe('rejected');
    for (const [job, word] of [[cancelled, 'cancelled'], [lost, 'expired'], [revoked, 'revoked']] as const) {
      expect((await job.workers.renew(job.attemptId, job.fence)).outcome, word).toBe(word);
      expect((await job.workers.step(job.attemptId, job.fence, 'search', 1)).outcome, word).toBe(word);
      expect((await job.workers.operation(job.attemptId, job.fence, (await operationRows(job.attemptId))[0].id, 'completed')).outcome, word).toBe(word);
      expect((await job.workers.finish(job.attemptId, job.fence, 'completed')).outcome, word).toBe(word);
    }
  });

  it('rejects a result whose Project changed since the claim: the lease ends revoked/stale_revision, the attempt fails step_failed, nothing is published', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed');
    await raiseRevision(db, job.projectId);
    const rejected = await job.workers.finish(job.attemptId, job.fence, 'completed', workloadResultDigest(inputDigest));
    expect(rejected).toMatchObject({outcome: 'rejected', state: 'failed', reason: 'step_failed', detail: 'stale_revision'});
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'failed', reason: 'step_failed'});
    expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'revoked', detail: 'stale_revision', result_digest: null});
    expect((await job.jobs.detail(job.jobId))).toMatchObject({state: 'failed', ending: 'stale_revision', can_retry: true});
    // The failed attempt can be retried by the user, which pins the new revision.
    const retry = await job.jobs.retry(job.jobId, 1);
    expect(retry.outcome).toBe('created');
    expect((await outboxRow(retry.attempt_id)).project_revision).toBe('2');
  });

  it('revokes a lease whose epoch is gone: the lease is ended revoked and the attempt cancelled (account_disabled) BEFORE the answer, for every fenced command', async () => {
    for (const command of ['renew', 'step', 'operation', 'finish'] as const) {
      const a = await committedAccount();
      const job = await claimedJob(a);
      const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
      await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
      const answer =
        command === 'renew' ? await job.workers.renew(job.attemptId, job.fence)
        : command === 'step' ? await job.workers.step(job.attemptId, job.fence, 'search', 1)
        : command === 'operation' ? await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed')
        : await job.workers.finish(job.attemptId, job.fence, 'completed');
      expect(answer.outcome, command).toBe('revoked');
      expect(await attemptRow(job.attemptId), command).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
      expect(await leaseRow(job.attemptId), command).toMatchObject({end_reason: 'revoked', detail: 'account_disabled'});
      // The dispatched operation stays held.
      expect((await operationRows(job.attemptId))[0].state, command).toBe('dispatched');
      expect(await figures(a.accountId), command).toEqual({settled: 0, reserved: RESERVED});
    }
  });

  it('revokes a lease after a re-enable too (the epoch only rises): revoked_epoch, and the old fence stays worthless', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    await db.query(`select api.enable_account('seed:local:test', $1)`, [a.accountId]);
    expect((await job.workers.finish(job.attemptId, job.fence, 'completed')).outcome).toBe('revoked');
    expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'revoked', detail: 'revoked_epoch'});
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
  });

  it('answers unavailable, and publishes nothing, once the Project is tombstoned; a step cannot land after the tombstone', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    await db.query(`select api.record_tombstone('project', $1)`, [job.projectId]);
    expect((await job.workers.step(job.attemptId, job.fence, 'search', 1)).outcome).toBe('unavailable');
    expect((await job.workers.renew(job.attemptId, job.fence)).outcome).toBe('unavailable');
    expect((await job.workers.finish(job.attemptId, job.fence, 'completed')).outcome).toBe('unavailable');
    expect((await operationRows(job.attemptId))[0].state).toBe('planned');
    expect(await leaseRow(job.attemptId)).toMatchObject({ended_at: null});
  });

  it('gives a late result nowhere to land after a cancel: the lease is ended first, so the same finish is refused', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed');
    expect((await job.jobs.cancel(job.jobId)).outcome).toBe('cancelled');
    expect((await job.workers.finish(job.attemptId, job.fence, 'completed')).outcome).toBe('cancelled');
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'cancelled', reason: 'user_cancelled'});
    expect((await leaseRow(job.attemptId)).result_digest).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('cancelling a Job', () => {
  it('cancels a running Job: the lease ends FIRST, then the attempt moves, planned operations are abandoned and released, a dispatched one stays chargeable and held, no new step starts', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a, {plan: await planWith(2)});
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    expect(stepped.outcome).toBe('stepped');
    const cancelled = await job.jobs.cancel(job.jobId);
    expect(cancelled).toMatchObject({outcome: 'cancelled', state: 'cancelled', reason: 'user_cancelled', released: 1, attempt_number: 1});
    expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'cancelled', detail: 'user_cancelled'});
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'cancelled', reason: 'user_cancelled'});
    const lease = await leaseRow(job.attemptId);
    expect(lease.ended_at.getTime()).toBeLessThanOrEqual((await attemptRow(job.attemptId)).ended_at.getTime());
    expect((await operationRows(job.attemptId)).map((row) => row.state)).toEqual(['dispatched', 'abandoned']);
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: RESERVED});
    expect(await count(db, `select count(*) as n from usage.settlements where account_id = $1 and classification = 'unused'`, [a.accountId])).toBe(1);
    expect((await job.workers.step(job.attemptId, job.fence, 'search', 2)).outcome).toBe('cancelled');
    expect(await job.jobs.detail(job.jobId)).toMatchObject({state: 'cancelled', reason: 'user_cancelled', can_cancel: false, can_retry: false, ending: 'user_cancelled', cost: {held: String(RESERVED) === '3400' ? 3400 : 0, settled: 0, released: 3400, chargeable_operations: 1}});
  });

  it('cancels a waiting Job (no lease, no start time) and releases its reservations; again is a replay, a terminal Job is not_cancellable, another payload is reused', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a), {plan: await planWith(2)});
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: 2 * RESERVED});
    const command = randomUUID();
    const cancelled = await w.jobs.cancel(submitted.job_id, {command});
    expect(cancelled).toMatchObject({outcome: 'cancelled', state: 'cancelled', reason: 'user_cancelled', released: 2});
    expect(await attemptRow(submitted.attempt_id)).toMatchObject({state: 'cancelled', started_at: null});
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [submitted.attempt_id])).toBe(0);
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: 0});
    expect((await operationRows(submitted.attempt_id)).map((row) => row.state)).toEqual(['abandoned', 'abandoned']);
    expect(await w.jobs.cancel(submitted.job_id, {command})).toMatchObject({outcome: 'replayed', state: 'cancelled'});
    expect(await w.jobs.cancel(submitted.job_id)).toMatchObject({outcome: 'not_cancellable', state: 'cancelled'});
    const another = await w.jobs.submit(await project(db, a));
    expect((await w.jobs.cancel(another.job_id, {command})).outcome).toBe('reused');
    expect((await attemptRow(another.attempt_id)).state).toBe('waiting');
    const completed = await seedJob(db, a, await project(db, a), 'completed');
    expect(await w.jobs.cancel(completed.jobId)).toMatchObject({outcome: 'not_cancellable', state: 'completed'});
    expect(await count(db, `select count(*) as n from usage.settlements where account_id = $1 and classification = 'unused'`, [a.accountId])).toBe(2);
  });

  it('cancels against a claim and against a finish with one winner and a consistent answer', async () => {
    const a = await committedAccount();
    const w = world(a);
    // A cancel that holds the Job makes a claim wait, and the claim then finds the attempt cancelled.
    const submitted = await w.jobs.submit(await project(db, a));
    const canceller = await connect();
    const claimer = await connect();
    const claimerPid = await pidOf(claimer);
    await canceller.query('begin');
    expect((await canceller.query('select * from api.cancel_job($1, 1, $2, $3)', [a.accountId, randomUUID(), submitted.job_id])).rows[0].outcome).toBe('cancelled');
    const claiming = claimer.query('select * from api.claim_attempt($1, null)', [submitted.attempt_id]);
    await untilBlocked(claimerPid);
    await canceller.query('commit');
    expect((await claiming).rows[0].outcome).toBe('not_waiting');
    // A finish that holds the Job makes a cancel wait, and the cancel then finds the attempt completed.
    const job = await claimedJob(a);
    const stepped = await job.workers.step(job.attemptId, job.fence, 'search', 1);
    await job.workers.operation(job.attemptId, job.fence, stepped.operation_id, 'completed');
    const finisher = await connect();
    const cancelling = await connect();
    const cancellingPid = await pidOf(cancelling);
    await finisher.query('begin');
    expect((await finisher.query('select * from api.finish_attempt($1, $2, $3, $4)', [job.attemptId, job.fence, 'completed', workloadResultDigest(inputDigest)])).rows[0].outcome).toBe('finished');
    const racing = cancelling.query('select * from api.cancel_job($1, 1, $2, $3)', [a.accountId, randomUUID(), job.jobId]);
    await untilBlocked(cancellingPid);
    await finisher.query('commit');
    expect((await racing).rows[0]).toMatchObject({outcome: 'not_cancellable', state: 'completed'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('disabling an Account cancels its Jobs', () => {
  it('cancels every open attempt (waiting and running) account_disabled, revokes the leases first, keeps dispatched reservations held, and writes ONE audit event; again is safe', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const waiting = await w.jobs.submit(pid, {plan: await planWith(1)});
    const running = await claimedJob(a, {project: pid, plan: await planWith(2)});
    const stepped = await running.workers.step(running.attemptId, running.fence, 'search', 1);
    expect(stepped.outcome).toBe('stepped');
    const done = await seedJob(db, a, pid, 'completed', {schedule: await scheduleOf()});
    const before = await count(db, `select count(*) as n from identity.audit_events where action = 'jobs.cancelled' and target = $1`, [`account:${a.accountId}`]);
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    const cancelled = await w.workers.cancelAccount(a.accountId);
    expect(cancelled).toMatchObject({cancelled: 2});
    expect(await attemptRow(waiting.attempt_id)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await attemptRow(running.attemptId)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await attemptRow(done.attemptId)).toMatchObject({state: 'completed'});
    expect(await leaseRow(running.attemptId)).toMatchObject({end_reason: 'revoked', detail: 'account_disabled'});
    // The planned operations went back to the allowance; the dispatched one is still held.
    expect((await operationRows(running.attemptId)).map((row) => row.state)).toEqual(['dispatched', 'abandoned']);
    expect((await operationRows(waiting.attempt_id)).map((row) => row.state)).toEqual(['abandoned']);
    expect(await figures(a.accountId)).toEqual({settled: 2, reserved: RESERVED});
    expect(await count(db, `select count(*) as n from identity.audit_events where action = 'jobs.cancelled' and target = $1 and actor = 'system:jobs'`, [`account:${a.accountId}`])).toBe(before + 1);
    // Twice is safe: nothing more is cancelled and no second event is written.
    expect(await w.workers.cancelAccount(a.accountId)).toMatchObject({cancelled: 0, settled: 0});
    expect(await count(db, `select count(*) as n from identity.audit_events where action = 'jobs.cancelled' and target = $1`, [`account:${a.accountId}`])).toBe(before + 1);
    expect((await running.workers.finish(running.attemptId, running.fence, 'completed')).outcome).toBe('revoked');
  });

  it('writes no event for an Account with nothing open, and is not confused by another Account\'s Jobs', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    const wb = world(b);
    const other = await wb.jobs.submit(await project(db, b));
    const before = await count(db, `select count(*) as n from identity.audit_events where action = 'jobs.cancelled'`);
    expect(await workerCommands(db).cancelAccount(a.accountId)).toMatchObject({cancelled: 0, settled: 0});
    expect(await count(db, `select count(*) as n from identity.audit_events where action = 'jobs.cancelled'`)).toBe(before);
    expect((await attemptRow(other.attempt_id)).state).toBe('waiting');
  });

  it('is finished by the next sweep when the canceller did not run: a disabled Account\'s attempts are cancelled, a moved epoch too, and one audit event records it', async () => {
    const a = await committedAccount();
    const w = world(a);
    const job = await claimedJob(a);
    const waiting = await w.jobs.submit(await project(db, a));
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    const swept = await w.workers.sweep();
    expect(Number(swept.cancelled)).toBeGreaterThanOrEqual(2);
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await attemptRow(waiting.attempt_id)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'revoked', detail: 'account_disabled'});
    expect(await count(db, `select count(*) as n from identity.audit_events where action = 'jobs.cancelled' and target = $1`, [`account:${a.accountId}`])).toBe(1);
    expect(Number((await w.workers.sweep()).cancelled)).toBe(0);
    // A re-enabled Account whose epoch moved on does not get its old attempt back; a new attempt of the new epoch is untouched.
    const b = await committedAccount();
    const wb = world(b);
    const old = await wb.jobs.submit(await project(db, b));
    await db.query(`select api.disable_account('seed:local:test', $1)`, [b.accountId]);
    await db.query(`select api.enable_account('seed:local:test', $1)`, [b.accountId]);
    const epoch = (await one('select authorization_epoch::int as e from identity.accounts where id = $1', [b.accountId])).e as number;
    const fresh = await world({...b, epoch}).jobs.submit(await project(db, b));
    expect(fresh.outcome).toBe('accepted');
    await wb.workers.sweep();
    expect(await attemptRow(old.attempt_id)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await leaseRow(old.attempt_id).catch(() => undefined)).toBeUndefined();
    expect((await attemptRow(fresh.attempt_id)).state).toBe('waiting');
  });

  it('registers the canceller of Jobs with runCancellers, which reports the count the Accounts page shows', async () => {
    const { runCancellers } = await import('@/lib/authority');
    await import('@/lib/job-cancellation');
    const a = await committedAccount();
    const w = world(a);
    await w.jobs.submit(await project(db, a));
    await w.jobs.submit(await project(db, a));
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    const previous = {...process.env};
    Object.assign(process.env, {NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY});
    try {
      const report = await runCancellers({accountId: a.accountId, epoch: 2});
      expect(report.failed).toBe(0);
      expect(report.cancelled).toBe(2);
    } finally {
      process.env = previous;
    }
    expect(await count(db, `select count(*) as n from jobs.attempts where account_id = $1 and state = 'cancelled' and reason = 'account_disabled'`, [a.accountId])).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the dispatch route: a signed delivery claims the attempt as the built-in step and runs the test workload', () => {
  const queueKeys = {QSTASH_CURRENT_SIGNING_KEY: 'test-qstash-current-signing-key-0000000000001', QSTASH_NEXT_SIGNING_KEY: 'test-qstash-next-signing-key-00000000000000002'};
  const routeEnv = () => ({...env, ...queueKeys, ADMINISTRATOR_EMAIL: 'admin@example.test', NEXT_PUBLIC_APP_ENV: 'local', PAID_ADAPTERS_ENABLED: 'false', SYNTHETIC_DATA_ENABLED: 'false'});
  const deliver = async (attemptId: string, body: Record<string, unknown> = {attempt: attemptId, instance: instanceId}) => {
    const call = signedCall(JSON.stringify(body), {key: queueKeys.QSTASH_CURRENT_SIGNING_KEY});
    const request = new Request('http://127.0.0.1:4173/api/dispatch', {method: 'POST', headers: {...call.headers, 'upstash-signature': call.headers['upstash-signature']}, body: call.body});
    return handleDispatchRequest(request, {env: routeEnv()});
  };

  it('runs the workload to completion: the step, the operation settled, the attempt completed with the digest of its input; a duplicate delivery does nothing', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a), {plan: await planWith(2)});
    const ran = await deliver(submitted.attempt_id);
    expect(ran.status).toBe(200);
    expect(await ran.json()).toEqual({outcome: 'ran', end: 'completed'});
    expect(await attemptRow(submitted.attempt_id)).toMatchObject({state: 'completed', stage: 'search'});
    expect(await leaseRow(submitted.attempt_id)).toMatchObject({end_reason: 'completed', worker_id: null, result_digest: workloadResultDigest(inputDigest)});
    expect((await operationRows(submitted.attempt_id)).map((row) => row.state)).toEqual(['completed', 'completed']);
    expect(await figures(a.accountId)).toEqual({settled: 4, reserved: 0});
    // The same delivery again (the queue may deliver twice) gets the receipt and does nothing.
    const again = await deliver(submitted.attempt_id);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({outcome: 'duplicate'});
    expect(await count(db, 'select count(*) as n from usage.settlements where account_id = $1', [a.accountId])).toBe(2);
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [submitted.attempt_id])).toBe(1);
  });

  it('runs a plan with no operation (the step work), fails when the plan says fail, and keeps a failure terminal until the user retries (then it completes, with the plan {})', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const plain = await w.jobs.submit(pid);
    expect(await (await deliver(plain.attempt_id)).json()).toEqual({outcome: 'ran', end: 'completed'});
    expect((await attemptRow(plain.attempt_id)).stage).toBe('work');
    const failing = await w.jobs.submit(pid, {plan: await planWith(1, {outcome: 'fail'})});
    expect(await (await deliver(failing.attempt_id)).json()).toEqual({outcome: 'ran', end: 'failed'});
    expect(await attemptRow(failing.attempt_id)).toMatchObject({state: 'failed', reason: 'step_failed'});
    expect((await operationRows(failing.attempt_id)).map((row) => row.state)).toEqual(['dispatched']);
    // A redelivery cannot reclaim a failed attempt: failed work stays terminal until an explicit user retry.
    expect(await (await deliver(failing.attempt_id)).json()).toEqual({outcome: 'duplicate'});
    expect(await count(db, 'select count(*) as n from jobs.attempts where job_id = $1', [failing.job_id])).toBe(1);
    const retry = await w.jobs.retry(failing.job_id, 1);
    expect(retry).toMatchObject({outcome: 'created', reason: 'awaiting_reconciliation'});
    expect(await (await deliver(retry.attempt_id)).json()).toEqual({outcome: 'blocked'});
  });

  it('answers a cancelled attempt not_waiting, an attempt nobody can run waiting_for_worker, and a disabled Account\'s attempt revoked, starting nothing', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const cancelled = await w.jobs.submit(pid);
    await w.jobs.cancel(cancelled.job_id);
    expect(await (await deliver(cancelled.attempt_id)).json()).toEqual({outcome: 'not_waiting'});
    const waiting = await w.jobs.submit(pid, {workerVersion: freshVersion()});
    expect(await (await deliver(waiting.attempt_id)).json()).toEqual({outcome: 'waiting_for_worker'});
    expect((await attemptRow(waiting.attempt_id)).state).toBe('waiting');
    const doomed = await w.jobs.submit(pid);
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    expect(await (await deliver(doomed.attempt_id)).json()).toEqual({outcome: 'revoked'});
    expect(await attemptRow(doomed.attempt_id)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await count(db, 'select count(*) as n from jobs.leases where account_id = $1', [a.accountId])).toBe(0);
  });

  it('refuses a call that is not the queue\'s or not for this environment, and claims nothing', async () => {
    const a = await committedAccount();
    const submitted = await world(a).jobs.submit(await project(db, a));
    const forged = signedCall(JSON.stringify({attempt: submitted.attempt_id, instance: instanceId}), {key: 'not-the-queues-key-0000000000000000000000'});
    const refused = await handleDispatchRequest(new Request('http://127.0.0.1:4173/api/dispatch', {method: 'POST', headers: forged.headers, body: forged.body}), {env: routeEnv()});
    expect(refused.status).toBe(401);
    expect((await deliver(submitted.attempt_id, {attempt: submitted.attempt_id, instance: randomUUID()})).status).toBe(403);
    expect((await deliver(submitted.attempt_id, {attempt: 'nope', instance: instanceId})).status).toBe(400);
    expect((await deliver(submitted.attempt_id, {attempt: submitted.attempt_id, instance: instanceId, extra: 1})).status).toBe(400);
    expect((await attemptRow(submitted.attempt_id)).state).toBe('waiting');
    expect(await count(db, 'select count(*) as n from jobs.leases where account_id = $1', [a.accountId])).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('signed worker commands against the real database', () => {
  const workerEnv = (worker: ReturnType<typeof testWorker>) => ({...env, ...worker.environment, ADMINISTRATOR_EMAIL: 'admin@example.test', NEXT_PUBLIC_APP_ENV: 'local', PAID_ADAPTERS_ENABLED: 'false', SYNTHETIC_DATA_ENABLED: 'false'});

  it('registers a worker, then claims, steps, reports an operation and finishes an attempt pinned to its version, all by signed commands', async () => {
    const a = await committedAccount();
    const w = world(a);
    const worker = testWorker('cad-worker', instanceId);
    const options = {env: workerEnv(worker)};
    const version = freshVersion();
    const kind = `itest_${tag}_route`;
    const registerBody = {worker_kind: kind, version, image_digest: sha(`${kind}-image`), kinds: ['test_workload']};
    const registered = await handleWorkerRequest(worker.request({cmd: 'register'}, registerBody), options);
    expect(registered.status).toBe(200);
    const registration = await registered.json();
    expect(registration).toMatchObject({state: 'registered', version, retired: 0});
    const plan = await planWith(1);
    const submitted = await w.jobs.submit(await project(db, a), {plan, workerVersion: version});
    expect(submitted.reason).toBe('awaiting_dispatch');
    const claimed = await handleWorkerRequest(worker.request({cmd: 'claim', att: submitted.attempt_id, wid: registration.worker}, {}), options);
    expect(claimed.status).toBe(200);
    const claim = await claimed.json();
    expect(claim).toMatchObject({state: 'claimed', attempt: submitted.attempt_id, job: submitted.job_id, kind: 'test_workload', plan, input_digest: inputDigest, revision: 1, epoch: 1, worker_version: version});
    const fenced = {att: submitted.attempt_id, fence: claim.fence};
    expect((await handleWorkerRequest(worker.request({cmd: 'renew', ...fenced}, {}), options)).status).toBe(200);
    const step = await (await handleWorkerRequest(worker.request({cmd: 'step', ...fenced}, {step_key: 'search', ordinal: 1}), options)).json();
    expect(step).toMatchObject({state: 'stepped', operation_state: 'dispatched'});
    const operation = await handleWorkerRequest(
      worker.request({cmd: 'operation', ...fenced}, {operation: step.operation, outcome: 'completed', input_tokens: 1, output_tokens: 1, returned_model: (await scheduleOf()).model}),
      options,
    );
    expect(await operation.json()).toMatchObject({state: 'finished', operation_state: 'completed', settled_microdollars: 2});
    const finished = await handleWorkerRequest(worker.request({cmd: 'finish', ...fenced, rev: 1}, {to: 'completed', result_digest: 'c'.repeat(64)}), options);
    expect(await finished.json()).toEqual({state: 'finished', attempt_state: 'completed'});
    expect(await leaseRow(submitted.attempt_id)).toMatchObject({worker_id: registration.worker, end_reason: 'completed', result_digest: 'c'.repeat(64)});
    expect(await count(db, `select count(*) as n from jobs.callbacks where attempt_id = $1`, [submitted.attempt_id])).toBe(5);
  });

  it('refuses a replayed token, a token for another environment and a revoked key with one reasonless 401, and writes nothing; a fenced failure is a 409 with the word', async () => {
    const a = await committedAccount();
    const w = world(a);
    // A revoked key stays revoked for ever, so this test signs with a key of its own for each run.
    const worker = testWorker('engine-worker', instanceId, {label: `engine-worker-${tag}`});
    const options = {env: workerEnv(worker)};
    const kind = `itest_${tag}_refuse`;
    const version = freshVersion();
    const registration = await (await handleWorkerRequest(worker.request({cmd: 'register'}, {worker_kind: kind, version, image_digest: sha(kind), kinds: ['test_workload']}), options)).json();
    expect(registration).toMatchObject({state: 'registered'});
    const submitted = await w.jobs.submit(await project(db, a), {workerVersion: version});
    const jti = 'Zm9vYmFyYmF6cXV4MTIzNA';
    const first = worker.request({cmd: 'claim', att: submitted.attempt_id, wid: registration.worker}, {}, {jti});
    expect((await handleWorkerRequest(first, options)).status).toBe(200);
    const replay = worker.request({cmd: 'claim', att: submitted.attempt_id, wid: registration.worker}, {}, {jti});
    const replayed = await handleWorkerRequest(replay, options);
    expect(replayed.status).toBe(401);
    expect(await replayed.json()).toEqual({error: 'invalid_token'});
    const elsewhere = await handleWorkerRequest(worker.request({cmd: 'claim', att: submitted.attempt_id, wid: registration.worker}, {}, {environment: randomUUID()}), options);
    expect(elsewhere.status).toBe(401);
    expect(await count(db, `select count(*) as n from jobs.callbacks where attempt_id = $1`, [submitted.attempt_id])).toBe(1);
    // A new token for the same claim: the worker gets its fence back (a replay), and a wrong fence is a 409 with the word.
    const again = await (await handleWorkerRequest(worker.request({cmd: 'claim', att: submitted.attempt_id, wid: registration.worker}, {}), options)).json();
    expect(again.state).toBe('replayed');
    const wrong = await handleWorkerRequest(worker.request({cmd: 'renew', att: submitted.attempt_id, fence: randomUUID()}, {}), options);
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toEqual({state: 'fence_mismatch'});
    // A revoked key is refused at the record, with the same 401, and nothing is recorded for it.
    await db.query(`select api.revoke_service_key('engine-worker', $1, 'test')`, [worker.kid]);
    const before = await count(db, 'select count(*) as n from jobs.callbacks where attempt_id = $1', [submitted.attempt_id]);
    const refused = await handleWorkerRequest(worker.request({cmd: 'renew', att: submitted.attempt_id, fence: again.fence}, {}), options);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({error: 'invalid_token'});
    expect(await count(db, 'select count(*) as n from jobs.callbacks where attempt_id = $1', [submitted.attempt_id])).toBe(before);
  });

  it('records a callback once and refuses a revoked key under the shared key lock (api.record_callback)', async () => {
    const w = workerCommands(db);
    const jti = randomBytes(16).toString('base64url');
    const kid = `callback-${tag}`;
    const digest = sha('body');
    expect(await w.callback(jti, 'cad-worker', kid, 'claim', null, digest)).toEqual({outcome: 'recorded'});
    expect(await w.callback(jti, 'cad-worker', kid, 'claim', null, digest)).toEqual({outcome: 'duplicate'});
    for (const [label, params] of [
      ['issuer', [randomBytes(16).toString('base64url'), 'gateway', kid, 'worker-command', 'claim', null, digest]],
      ['command', [randomBytes(16).toString('base64url'), 'cad-worker', kid, 'worker-command', 'explode', null, digest]],
      ['jti', ['short', 'cad-worker', kid, 'worker-command', 'claim', null, digest]],
      ['digest', [randomBytes(16).toString('base64url'), 'cad-worker', kid, 'worker-command', 'claim', null, 'xyz']],
    ] as const) {
      const result = await attempt(db, null, 'select * from api.record_callback($1, $2, $3, $4, $5, $6, $7)', [...params]);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.code, label).toBe('22023');
    }
    await db.query(`select api.revoke_service_key('cad-worker', $1, 'test')`, [kid]);
    expect(await w.callback(randomBytes(16).toString('base64url'), 'cad-worker', kid, 'claim', null, digest)).toEqual({outcome: 'revoked'});
    expect(await count(db, 'select count(*) as n from jobs.callbacks where kid = $1', [kid])).toBe(1);
    // A callback never changes or disappears but by the purge.
    expect((await attempt(db, null, `update jobs.callbacks set command = 'renew' where jti = $1`, [jti])).ok).toBe(false);
    await db.query('delete from jobs.callbacks where kid = $1', [kid]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the sweep: leases, abandoned reservations and the second layer of the disable', () => {
  it('releases the abandoned reservations nobody settled (a Job cancelled by the owner\'s hand), once, and reports the counts', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a), {plan: await planWith(2)});
    // The owner abandons the planned operations without settling them, as a crash between the two steps would leave them.
    await db.query(`update jobs.attempts set state = 'cancelled', reason = 'user_cancelled', ended_at = clock_timestamp() where id = $1`, [submitted.attempt_id]).catch(() => undefined);
    await db.query(`update jobs.operations o set state = 'abandoned' from jobs.steps s where s.id = o.step_id and s.attempt_id = $1 and o.state = 'planned'`, [submitted.attempt_id]);
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: 2 * RESERVED});
    const swept = await w.workers.sweep();
    expect(Number(swept.settled)).toBeGreaterThanOrEqual(2);
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: 0});
    expect(await count(db, `select count(*) as n from usage.settlements where account_id = $1 and classification = 'unused'`, [a.accountId])).toBe(2);
    await w.workers.sweep();
    expect(await count(db, `select count(*) as n from usage.settlements where account_id = $1`, [a.accountId])).toBe(2);
  });

  it('returns the three counts as numbers, and an idle sweep changes nothing', async () => {
    const swept = await sweepAttempts({env});
    expect(Object.keys(swept).sort()).toEqual(['cancelled', 'expired', 'settled']);
    for (const value of Object.values(swept)) expect(Number.isSafeInteger(value)).toBe(true);
    const task = await runOutboxSweep({config: null, accounts: {env}});
    expect(task.configured).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the alarms: an old unpublished row and a lease nobody ended', () => {
  it('reports the age of the oldest unpublished outbox row and of the oldest live lease that has expired, and the conditions raise and clear', async () => {
    const a = await committedAccount();
    const w = world(a);
    const baseline = await alarmObservations({env});
    const submitted = await w.jobs.submit(await project(db, a));
    await ageOutbox(db, submitted.attempt_id, 500);
    const observed = await alarmObservations({env});
    expect(observed.outboxOldest).not.toBeNull();
    expect(observed.outboxOldest!).toBeGreaterThanOrEqual(500);
    const seen = {...observed, heartbeatConfigured: true};
    expect(outboxAgeCondition.evaluate(seen, [])).toEqual([{subject: null, detail: {age_seconds: observed.outboxOldest}}]);
    // Publishing clears it.
    await w.workers.mark(submitted.outbox_id, 'msg_alarm');
    const cleared = await alarmObservations({env});
    expect(cleared.outboxOldest === null || cleared.outboxOldest < observed.outboxOldest!).toBe(true);
    expect(outboxAgeCondition.evaluate({...cleared, outboxOldest: null, heartbeatConfigured: true}, [])).toEqual([]);
    expect(outboxAgeCondition.evaluate({...baseline, outboxOldest: outboxAgeSeconds, heartbeatConfigured: true}, [])).toEqual([]);
    expect(outboxAgeCondition.evaluate({...baseline, outboxOldest: outboxAgeSeconds + 1, heartbeatConfigured: true}, [])).toHaveLength(1);

    const job = await claimedJob(a);
    await backdateLease(db, job.attemptId, 400);
    const lease = await alarmObservations({env});
    expect(lease.leaseExpiredOldest).not.toBeNull();
    expect(lease.leaseExpiredOldest!).toBeGreaterThanOrEqual(400);
    expect(leaseExpiredUnclaimedCondition.evaluate({...lease, heartbeatConfigured: true}, [])).toHaveLength(1);
    expect(leaseExpiredUnclaimedCondition.evaluate({...lease, leaseExpiredOldest: leaseExpiredSeconds, heartbeatConfigured: true}, [])).toEqual([]);
    // The sweep ends it, and the observation clears (for this lease).
    await w.workers.sweep();
    const swept = await alarmObservations({env});
    expect(swept.leaseExpiredOldest === null || swept.leaseExpiredOldest < 400).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('reads: the list and the detail', () => {
  it('lists the Account\'s Jobs with open attempts first, then the newest ended, each with its Project and public state', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const schedule = await scheduleOf();
    const done = await seedJob(db, a, pid, 'completed', {schedule});
    const failed = await seedJob(db, a, pid, 'failed', {schedule});
    const waiting = await seedJob(db, a, pid, 'waiting');
    const listed = await w.jobs.list();
    expect(listed.outcome).toBe('found');
    const items = listed.items as {job_id: string; project_id: string; project_title: string; kind: string; state: string; stage: string; reason: string | null; attempt_number: number}[];
    expect(items.map((item) => item.job_id)).toEqual([waiting.jobId, failed.jobId, done.jobId]);
    expect(items[0]).toMatchObject({project_id: pid, project_title: 'Courtyard bench', kind: 'test_workload', state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch', attempt_number: 1});
    expect(items[1]).toMatchObject({state: 'failed', reason: 'step_failed'});
    expect(items[2]).toMatchObject({state: 'completed', reason: null});
    // The limit applies, after the order.
    expect(((await w.jobs.list({limit: 1})).items as unknown[]).length).toBe(1);
    // Another Account sees none of them; a stale epoch is denied.
    const b = await committedAccount();
    expect((await world(b).jobs.list()).items).toEqual([]);
    expect(await w.jobs.list({epoch: 9})).toMatchObject({outcome: 'denied', items: null});
    const bad = await attempt(db, null, 'select * from api.list_jobs($1, 1, 0)', [a.accountId]);
    expect(bad.ok).toBe(false);
  });

  it('hides the Jobs of a deleted or tombstoned Project from the list and answers unavailable for them in the detail, as for a foreign or unknown Job', async () => {
    const a = await committedAccount();
    const w = world(a);
    const kept = await project(db, a);
    const gone = await project(db, a);
    const tomb = await project(db, a);
    const one = await w.jobs.submit(kept);
    const two = await w.jobs.submit(gone);
    const three = await w.jobs.submit(tomb);
    await db.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [gone]);
    await db.query(`select api.record_tombstone('project', $1)`, [tomb]);
    const items = (await w.jobs.list()).items as {job_id: string}[];
    expect(items.map((item) => item.job_id)).toEqual([one.job_id]);
    expect(await w.jobs.detail(two.job_id)).toMatchObject({outcome: 'unavailable', job_id: null, attempts: null});
    expect((await w.jobs.detail(three.job_id)).outcome).toBe('unavailable');
    expect((await w.jobs.detail(randomUUID())).outcome).toBe('unavailable');
    const b = await committedAccount();
    expect((await world(b).jobs.detail(one.job_id)).outcome).toBe('unavailable');
    expect((await w.jobs.detail(one.job_id, {epoch: 4})).outcome).toBe('denied');
  });

  it('shows the state, stage and reason of the records through a whole life, with the cost, the progress and the ending the screens need and nothing else', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const schedule = await scheduleOf();
    const waiting = await seedJob(db, a, pid, 'waiting');
    expect(await w.jobs.detail(waiting.jobId)).toMatchObject({outcome: 'found', state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch', can_cancel: true, can_retry: false, ending: null, project_title: 'Courtyard bench'});
    const running = await seedJob(db, a, pid, 'running', {schedule});
    const detail = await w.jobs.detail(running.jobId);
    expect(Object.keys(detail).sort()).toEqual(['attempts', 'can_cancel', 'can_retry', 'cost', 'created_at', 'ending', 'job_id', 'kind', 'outcome', 'progress', 'project_id', 'project_title', 'reason', 'stage', 'state'].sort());
    expect(detail).toMatchObject({state: 'running', stage: 'search', reason: null, can_cancel: true, can_retry: false, ending: null});
    expect(detail.progress).toEqual({steps: 1, steps_begun: 1, operations_planned: 1, operations_completed: 0});
    expect(detail.cost).toEqual({held: RESERVED, settled: 0, released: 0, chargeable_operations: 1});
    expect(detail.attempts).toHaveLength(1);
    expect(Object.keys(detail.attempts[0]).sort()).toEqual(['chargeable_operations', 'created_at', 'ended_at', 'id', 'number', 'reason', 'stage', 'started_at', 'state']);
    // The Job's state is its highest attempt's, always.
    const completed = await seedJob(db, a, pid, 'completed', {schedule});
    const done = await w.jobs.detail(completed.jobId);
    expect(done).toMatchObject({state: 'completed', can_cancel: false, ending: null});
    expect(done.cost).toEqual({held: 0, settled: 2, released: RESERVED - 2, chargeable_operations: 0});
    expect(done.progress).toEqual({steps: 1, steps_begun: 1, operations_planned: 1, operations_completed: 1});
    const stale = await seedJob(db, a, pid, 'stale', {schedule});
    expect(await w.jobs.detail(stale.jobId)).toMatchObject({state: 'failed', reason: 'step_failed', ending: 'stale_revision', can_retry: true});
    const lost = await seedJob(db, a, pid, 'lease_lost', {schedule});
    expect(await w.jobs.detail(lost.jobId)).toMatchObject({state: 'failed', reason: 'lease_lost', ending: 'lease_expired', can_retry: true});
    const cancelled = await seedJob(db, a, pid, 'cancelled');
    expect(await w.jobs.detail(cancelled.jobId)).toMatchObject({state: 'cancelled', reason: 'user_cancelled', ending: null, can_cancel: false});
  });

  it('reads through the typed calls as the screens do, and fails closed on an answer that is not a Job', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const submitted = await submitJob(operation, {commandId: randomUUID(), projectId: pid, inputDigest, plan: {operations: [typedOperation(await scheduleOf())]}}, {env});
    expect(submitted).toMatchObject({outcome: 'accepted', attempt: {number: 1, state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch'}});
    if (submitted.outcome !== 'accepted') return;
    const read = await readJobDetail(operation, {jobId: submitted.jobId}, {env});
    expect(read).toMatchObject({outcome: 'found', job: {state: 'waiting', canCancel: true, canRetry: false, ending: null, progress: {steps: 1, stepsBegun: 0, operationsPlanned: 1, operationsCompleted: 0}, cost: {held: RESERVED, settled: 0, released: 0, chargeableOperations: 0}}});
    const listed = await listJobs(operation, {}, {env});
    expect(listed).toMatchObject({outcome: 'found', jobs: [{jobId: submitted.jobId, projectTitle: 'Courtyard bench', state: 'waiting', reason: 'awaiting_dispatch'}]});
    expect(await listJobs({accountId: a.accountId, epoch: 7}, {}, {env})).toEqual({outcome: 'denied'});
    expect(await readJobDetail({accountId: a.accountId, epoch: 7}, {jobId: submitted.jobId}, {env})).toEqual({outcome: 'denied'});
    const cancelled = await cancelJob(operation, {commandId: randomUUID(), jobId: submitted.jobId}, {env});
    expect(cancelled).toMatchObject({outcome: 'cancelled', attempt: {state: 'cancelled', reason: 'user_cancelled'}, released: 1});
    expect(await cancelJob(operation, {commandId: randomUUID(), jobId: submitted.jobId}, {env})).toEqual({outcome: 'not_cancellable', state: 'cancelled'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('authority and the hidden state: nothing is written or revealed', () => {
  it('answers denied to the four user commands for a stale epoch, a disabled Account and an Account that does not exist, and writes nothing', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const job = await w.jobs.submit(pid);
    const before = await counts(a.accountId);
    expect((await w.jobs.submit(pid, {epoch: 5})).outcome).toBe('denied');
    expect((await w.jobs.cancel(job.job_id, {epoch: 5})).outcome).toBe('denied');
    expect((await w.jobs.list({epoch: 5})).outcome).toBe('denied');
    expect((await w.jobs.detail(job.job_id, {epoch: 5})).outcome).toBe('denied');
    expect((await db.query('select * from api.submit_job($1, 1, $2, $3, $4, $5, $6, null)', [randomUUID(), randomUUID(), pid, 'test_workload', inputDigest, '{}'])).rows[0].outcome).toBe('denied');
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    for (const epoch of [1, 2, 3]) {
      expect((await w.jobs.submit(pid, {epoch})).outcome, String(epoch)).toBe('denied');
      expect((await w.jobs.cancel(job.job_id, {epoch})).outcome, String(epoch)).toBe('denied');
    }
    expect(await counts(a.accountId)).toEqual(before);
    // A tombstoned Account is denied too.
    const b = await committedAccount();
    const wb = world(b);
    const pb = await project(db, b);
    await db.query(`select api.record_tombstone('account', $1)`, [b.accountId]);
    expect((await wb.jobs.submit(pb)).outcome).toBe('denied');
    expect((await wb.jobs.list()).outcome).toBe('denied');
  });

  it('answers the same unavailable for a foreign, a deleted, an unknown and a tombstoned Project or Job, with nothing in it, and writes nothing', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    const wa = world(a);
    const wb = world(b);
    const mine = await project(db, a);
    const foreign = await project(db, b);
    const deleted = await project(db, a);
    const tombstoned = await project(db, a);
    const job = await wa.jobs.submit(mine);
    const before = await counts(a.accountId);
    await db.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [deleted]);
    await db.query(`select api.record_tombstone('project', $1)`, [tombstoned]);
    for (const target of [foreign, deleted, tombstoned, randomUUID()]) {
      const answer = await wa.jobs.submit(target);
      expect(answer, target).toMatchObject({outcome: 'unavailable', job_id: null, attempt_id: null, outbox_id: null});
    }
    expect((await wb.jobs.cancel(job.job_id)).outcome).toBe('unavailable');
    expect((await wa.jobs.cancel(randomUUID())).outcome).toBe('unavailable');
    expect(await counts(a.accountId)).toEqual(before);
    expect((await counts(b.accountId)).jobs).toBe(0);
  });

  it('does not outlive the Project\'s visibility: a replay of a submission and of a cancel is unavailable once the Project is deleted', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const submit = randomUUID();
    const cancel = randomUUID();
    const job = await w.jobs.submit(pid, {command: submit});
    await w.jobs.cancel(job.job_id, {command: cancel});
    await db.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [pid]);
    expect((await w.jobs.submit(pid, {command: submit})).outcome).toBe('unavailable');
    expect((await w.jobs.cancel(job.job_id, {command: cancel})).outcome).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('real connections: one winner, one publish, one Job', () => {
  it('makes one Job and two replays when the same submission arrives three times at once', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const clients = await Promise.all([connect(), connect(), connect()]);
    const command = randomUUID();
    const plan = JSON.stringify(await planWith(1));
    const answers = await Promise.all(clients.map((client) => client.query('select * from api.submit_job($1, 1, $2, $3, $4, $5, $6::jsonb, null)', [a.accountId, command, pid, 'test_workload', inputDigest, plan])));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['accepted', 'replayed', 'replayed']);
    expect(new Set(answers.map((answer) => answer.rows[0].job_id)).size).toBe(1);
    expect(await counts(a.accountId)).toMatchObject({jobs: 1, attempts: 1, outbox: 1, reservations: 1, commands: 1});
  });

  it('admits at most three Jobs when submissions with different command IDs arrive at once', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const clients = await Promise.all(Array.from({length: 5}, () => connect()));
    const answers = await Promise.all(clients.map((client) => client.query('select * from api.submit_job($1, 1, $2, $3, $4, $5, $6::jsonb, null)', [a.accountId, randomUUID(), pid, 'test_workload', inputDigest, '{}'])));
    const outcomes = answers.map((answer) => answer.rows[0].outcome as string);
    expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(3);
    expect(outcomes.filter((outcome) => outcome === 'at_capacity')).toHaveLength(2);
    expect(await counts(a.accountId)).toMatchObject({jobs: 3, attempts: 3, outbox: 3});
  });

  it('makes one claim when two claims arrive at once: one claimed, one already_claimed, one lease', async () => {
    const a = await committedAccount();
    const submitted = await world(a).jobs.submit(await project(db, a));
    const clients = await Promise.all([connect(), connect(), connect()]);
    const answers = await Promise.all(clients.map((client) => client.query('select * from api.claim_attempt($1, null)', [submitted.attempt_id])));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['already_claimed', 'already_claimed', 'claimed']);
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [submitted.attempt_id])).toBe(1);
  });

  it('never lets a step land after a tombstone: a run_step that waits for api.record_tombstone finds the Project gone, and a tombstone waits for a step that holds the Project', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    const recorder = await connect();
    const stepper = await connect();
    const stepperPid = await pidOf(stepper);
    await recorder.query('begin');
    expect((await recorder.query(`select outcome from api.record_tombstone('project', $1)`, [job.projectId])).rows[0].outcome).toBe('recorded');
    const stepping = stepper.query('select * from api.run_step($1, $2, $3, $4)', [job.attemptId, job.fence, 'search', 1]);
    await untilBlocked(stepperPid);
    await recorder.query('commit');
    expect((await stepping).rows[0].outcome).toBe('unavailable');
    expect((await operationRows(job.attemptId))[0].state).toBe('planned');

    const b = await committedAccount();
    const other = await claimedJob(b);
    const stepper2 = await connect();
    const recorder2 = await connect();
    const recorder2Pid = await pidOf(recorder2);
    await stepper2.query('begin');
    expect((await stepper2.query('select * from api.run_step($1, $2, $3, $4)', [other.attemptId, other.fence, 'search', 1])).rows[0].outcome).toBe('stepped');
    const recording = recorder2.query(`select outcome from api.record_tombstone('project', $1)`, [other.projectId]);
    await untilBlocked(recorder2Pid);
    await stepper2.query('commit');
    expect((await recording).rows[0].outcome).toBe('recorded');
    expect((await operationRows(other.attemptId))[0].state).toBe('dispatched');
    expect((await other.workers.step(other.attemptId, other.fence, 'search', 1)).outcome).toBe('unavailable');
  });

  it('is one winner when an Account is disabled while a fenced command runs: the command commits first, or the lease is revoked', async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < 4; round += 1) {
      const a = await committedAccount();
      const job = await claimedJob(a);
      const [one, two] = await Promise.all([connect(), connect()]);
      const [stepped, disabled] = await Promise.all([
        one.query('select * from api.run_step($1, $2, $3, $4)', [job.attemptId, job.fence, 'search', 1]),
        two.query(`select outcome from api.disable_account('seed:local:jobs', $1)`, [a.accountId]),
      ]);
      expect(disabled.rows[0].outcome).toBe('disabled');
      const outcome = stepped.rows[0].outcome as string;
      outcomes.add(outcome);
      expect(['stepped', 'revoked']).toContain(outcome);
      if (outcome === 'revoked') expect(await attemptRow(job.attemptId)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    }
    expect([...outcomes].every((outcome) => outcome === 'stepped' || outcome === 'revoked')).toBe(true);
  });

  it('waits for the Job\'s advisory lock and for the global sweep lock, and answers once they are released', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    const holder = await connect();
    const caller = await connect();
    const callerPid = await pidOf(caller);
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d:job:' || $1::text, 0))`, [job.jobId]);
    const renewing = caller.query('select * from api.renew_lease($1, $2)', [job.attemptId, job.fence]);
    await untilBlocked(callerPid);
    await holder.query('commit');
    expect((await renewing).rows[0].outcome).toBe('renewed');
    const sweeper = await connect();
    const sweeperPid = await pidOf(sweeper);
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d:jobs-sweep', 0))`);
    const sweeping = sweeper.query('select * from api.sweep_attempts()');
    await untilBlocked(sweeperPid);
    await holder.query('commit');
    expect((await sweeping).rows[0]).toHaveProperty('expired');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('immutability and closure', () => {
  it('refuses to change an ended lease, to shorten a live one, to extend an expired one and to change what identifies one; delete (the purge) is allowed', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    const lease = await leaseRow(job.attemptId);
    for (const sql of [
      `update jobs.leases set fence = gen_random_uuid() where id = $1`,
      `update jobs.leases set attempt_id = gen_random_uuid() where id = $1`,
      `update jobs.leases set claimed_at = claimed_at - interval '1 hour' where id = $1`,
      `update jobs.leases set expires_at = expires_at - interval '1 second' where id = $1`,
      `update jobs.leases set ended_at = clock_timestamp(), end_reason = 'revoked', detail = 'user_cancelled' where id = $1`,
      `update jobs.leases set ended_at = clock_timestamp(), end_reason = 'completed', detail = 'step_failed' where id = $1`,
      `update jobs.leases set ended_at = clock_timestamp(), end_reason = 'failed', detail = 'step_failed', expires_at = expires_at + interval '1 minute' where id = $1`,
    ]) {
      const result = await attempt(db, null, sql, [lease.id]);
      expect(result.ok, sql).toBe(false);
    }
    expect((await attempt(db, null, `update jobs.leases set renewed_at = clock_timestamp(), expires_at = expires_at + interval '10 seconds' where id = $1`, [lease.id])).ok).toBe(true);
    expect((await job.workers.finish(job.attemptId, job.fence, 'failed')).outcome).toBe('finished');
    for (const sql of [`update jobs.leases set expires_at = expires_at + interval '1 minute' where id = $1`, `update jobs.leases set detail = null, end_reason = 'completed' where id = $1`, `update jobs.leases set result_digest = '${'a'.repeat(64)}' where id = $1`]) {
      const result = await attempt(db, null, sql, [lease.id]);
      expect(result.ok, sql).toBe(false);
      if (!result.ok) expect(result.code).toBe('55000');
    }
    const truncate = await attempt(db, null, 'truncate jobs.leases');
    expect(truncate.ok).toBe(false);
  });

  it('keeps at most one lease for an attempt and one fence for a lease, whoever writes', async () => {
    const a = await committedAccount();
    const job = await claimedJob(a);
    const lease = await leaseRow(job.attemptId);
    const second = await attempt(db, null, `insert into jobs.leases (account_id, attempt_id, fence, expires_at) values ($1, $2, gen_random_uuid(), clock_timestamp() + interval '1 minute')`, [a.accountId, job.attemptId]);
    expect(second.ok).toBe(false);
    const sameFence = await world(a).jobs.submit(await project(db, a));
    const other = await attempt(db, null, `insert into jobs.leases (account_id, attempt_id, fence, expires_at) values ($1, $2, $3, clock_timestamp() + interval '1 minute')`, [a.accountId, sameFence.attempt_id, lease.fence]);
    expect(other.ok).toBe(false);
    // A lease names an attempt of its own Account only.
    const b = await committedAccount();
    const foreign = await attempt(db, null, `insert into jobs.leases (account_id, attempt_id, fence, expires_at) values ($1, $2, gen_random_uuid(), clock_timestamp() + interval '1 minute')`, [b.accountId, sameFence.attempt_id]);
    expect(foreign.ok).toBe(false);
  });

  it('lets the browser roles and the gateway nowhere near the new functions and tables, over REST too', async () => {
    for (const role of ['anon', 'authenticated', 'nova3d_gateway']) {
      for (const sql of ['select * from api.claim_outbox(1, null)', 'select * from api.sweep_attempts()', 'select * from jobs.outbox']) {
        const result = await attempt(db, role, sql);
        expect(result.ok, `${role} ${sql}`).toBe(false);
        if (!result.ok) expect(result.code).toBe('42501');
      }
    }
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/sweep_attempts`, {
      method: 'POST',
      headers: {apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, 'content-type': 'application/json', 'content-profile': 'api'},
      body: '{}',
    });
    expect([401, 403, 404]).toContain(response.status);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls of lib/job-commands.ts against the real database', () => {
  it('accepts, claims, runs, finishes, sweeps and publishes as the application will over REST', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const submitted = await submitJob(operation, {commandId: randomUUID(), projectId: pid, inputDigest, plan: {operations: [typedOperation(await scheduleOf())]}}, {env});
    expect(submitted.outcome).toBe('accepted');
    if (submitted.outcome !== 'accepted') return;
    const claimed = await claimAttempt({attemptId: submitted.attemptId}, {env});
    expect(claimed).toMatchObject({outcome: 'claimed', claim: {attemptId: submitted.attemptId, kind: 'test_workload', inputDigest, projectRevision: 1, accountEpoch: 1, workerVersion: 1, plan: {operations: [{stepKey: 'search', ordinal: 1, provider, requestBytes: 1000, imageCount: 0, outputLimit: 100}]}}});
    if (claimed.outcome !== 'claimed') return;
    const fenced = {attemptId: submitted.attemptId, fence: claimed.claim.fence};
    expect(await renewLease(fenced, {env})).toMatchObject({outcome: 'renewed'});
    const stepped = await runStep({...fenced, stepKey: 'search', ordinal: 1}, {env});
    expect(stepped).toMatchObject({outcome: 'stepped', operationState: 'dispatched'});
    if (stepped.outcome !== 'stepped' || stepped.operationId === null) return;
    expect(await finishOperation({...fenced, operationId: stepped.operationId, outcome: 'completed', usage: {inputTokens: 1, outputTokens: 1, returnedModel: 'fixture-model'}}, {env})).toMatchObject({
      outcome: 'finished',
      state: 'completed',
      settlement: {settledMicrodollars: 2, releasedMicrodollars: RESERVED, overMicrodollars: 0},
    });
    expect(await finishAttempt({...fenced, to: 'completed', resultDigest: workloadResultDigest(inputDigest)}, {env})).toMatchObject({outcome: 'finished', attempt: {state: 'completed'}, detail: null});
    expect(await finishAttempt({...fenced, to: 'completed', resultDigest: workloadResultDigest(inputDigest)}, {env})).toMatchObject({outcome: 'replayed'});
    expect(await renewLease(fenced, {env})).toEqual({outcome: 'not_running'});
    // The outbox: claimed by name, marked once.
    const rows = await claimOutbox({limit: 1, outboxId: submitted.outboxId}, {env});
    expect(rows).toEqual([expect.objectContaining({id: submitted.outboxId, attemptId: submitted.attemptId})]);
    expect(await markPublished({outboxId: submitted.outboxId, messageId: 'msg_typed'}, {env})).toEqual({outcome: 'marked', messageId: 'msg_typed'});
    expect(await markPublished({outboxId: submitted.outboxId, messageId: 'msg_other'}, {env})).toEqual({outcome: 'conflict', messageId: 'msg_typed'});
    // The registry and the account cancellation.
    const registration = await registerWorker({issuer: 'cad-worker', workerKind: `itest_${tag}_typed`, version: freshVersion(), imageDigest: sha('typed'), kinds: ['test_workload']}, {env});
    expect(registration.outcome).toBe('registered');
    expect(await cancelAccountJobs({accountId: a.accountId}, {env})).toEqual({cancelled: 0, settled: 0});
    expect((await sweepAttempts({env})).expired).toBeGreaterThanOrEqual(0);
    // A cancelled Job's late finish is refused by the typed call too.
    const second = await submitJob(operation, {commandId: randomUUID(), projectId: pid, inputDigest}, {env});
    if (second.outcome !== 'accepted') return;
    const second_claim = await claimAttempt({attemptId: second.attemptId}, {env});
    if (second_claim.outcome !== 'claimed') return;
    await cancelJob(operation, {commandId: randomUUID(), jobId: second.jobId}, {env});
    expect(await finishAttempt({attemptId: second.attemptId, fence: second_claim.claim.fence, to: 'failed'}, {env})).toEqual({outcome: 'cancelled'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries the Story 2.7 tables and functions', () => {
  it('answers ok to the service role, and reads the four tables and looks for the fifteen functions (sixty-nine api functions in all)', async () => {
    const answer = await one('select ok from api.preflight()');
    expect(answer.ok).toBe(true);
    const text = (await one(`select pg_get_functiondef('api.preflight()'::regprocedure) as def`)).def as string;
    for (const needle of ['jobs.outbox', 'jobs.workers', 'jobs.leases', 'jobs.callbacks', 'api.submit_job(uuid,bigint,uuid,uuid,text,text,jsonb,integer)', 'api.cancel_account_jobs(uuid)', 'jobs.builtin_kind()', 'Story 2.7']) {
      expect(text, needle).toContain(needle);
    }
    const listed = [...text.matchAll(/'((?:api)\.[a-z_]+\([^']*\))'/g)].map((match) => match[1]);
    const withExecute = text.slice(text.indexOf('the service role cannot execute') - 4500, text.indexOf('the service role cannot execute'));
    expect(new Set([...withExecute.matchAll(/'(api\.[a-z_]+\([^']*\))'/g)].map((match) => match[1])).size).toBe(69);
    expect(listed.length).toBeGreaterThanOrEqual(69);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('lock order: commands that walk many Jobs and commands on one Job never deadlock', () => {
  it('runs sweeps, account cancellations, cancels, fenced commands, claims and submissions together without a deadlock, and ends with consistent records', async () => {
    const accounts = await Promise.all([committedAccount(), committedAccount()]);
    const jobs: Awaited<ReturnType<typeof claimedJob>>[] = [];
    const waiting: {a: Fixture; attemptId: string; jobId: string}[] = [];
    for (const a of accounts) {
      const pid = await project(db, a);
      for (let index = 0; index < 2; index += 1) jobs.push(await claimedJob(a, {project: pid, plan: await planWith(2)}));
      const submitted = await world(a).jobs.submit(pid, {plan: await planWith(1)});
      waiting.push({a, attemptId: submitted.attempt_id, jobId: submitted.job_id});
    }
    await Promise.all(jobs.slice(0, 2).map((job) => backdateLease(db, job.attemptId, 5)));
    // Ten sessions are enough to have the calls overlap, and the database has a limited number of connections: each session takes its calls one after another.
    const clients = await Promise.all(Array.from({length: 10}, () => connect()));
    const chains: Promise<unknown>[] = clients.map(() => Promise.resolve());
    const calls: Promise<unknown>[] = [];
    let next = 0;
    const run = (sql: string, params: unknown[] = []) => {
      const lane = next++ % clients.length;
      const call = chains[lane].catch(() => undefined).then(() => clients[lane].query(sql, params)).then((result) => result.rows[0] as Record<string, any>);
      chains[lane] = call;
      calls.push(call);
    };
    run('select * from api.sweep_attempts()');
    run('select * from api.sweep_attempts()');
    run('select * from api.cancel_account_jobs($1)', [accounts[1].accountId]);
    for (const [index, job] of jobs.entries()) {
      run('select * from api.run_step($1, $2, $3, $4)', [job.attemptId, job.fence, 'search', 1]);
      if (index % 2 === 0) run('select * from api.cancel_job($1, 1, $2, $3)', [job.who.accountId, randomUUID(), job.jobId]);
      else run('select * from api.finish_attempt($1, $2, $3, $4)', [job.attemptId, job.fence, 'failed', null]);
    }
    for (const entry of waiting) {
      run('select * from api.claim_attempt($1, null)', [entry.attemptId]);
      run('select * from api.cancel_job($1, 1, $2, $3)', [entry.a.accountId, randomUUID(), entry.jobId]);
    }
    const settled = await Promise.allSettled(calls);
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map((result) => (result.reason as {code?: string; message: string}));
    expect(failures.map((failure) => `${failure.code ?? ''} ${failure.message}`)).toEqual([]);
    // Every attempt is in exactly one coherent state: a lease is ended exactly when its attempt is, and the open attempts are at most one for a Job.
    for (const row of await all(`select a.id, a.state, l.id as lease_id, l.ended_at as lease_ended from jobs.attempts a left join jobs.leases l on l.attempt_id = a.id where a.account_id = any($1)`, [accounts.map((a) => a.accountId)])) {
      if (row.lease_id) expect(row.lease_ended !== null, `${row.state}`).toBe(row.state !== 'running');
      expect(['waiting', 'running', 'completed', 'failed', 'cancelled']).toContain(row.state);
    }
    // No reservation of an operation that never went out is left held: what is abandoned is settled by the sweep, and the figures reconcile.
    await workerCommands(db).sweep();
    for (const a of accounts) {
      const held = await one(
        `select coalesce(sum(r.reserved_microdollars), 0)::int as held from usage.reservations r join jobs.operations o on o.id = r.operation_id
          where r.account_id = $1 and o.state in ('planned', 'abandoned') and not exists (select 1 from usage.settlements s where s.reservation_id = r.id)
            and not exists (select 1 from jobs.steps st join jobs.attempts at on at.id = st.attempt_id where st.id = o.step_id and at.state in ('waiting', 'running'))`,
        [a.accountId],
      );
      expect(held.held).toBe(0);
    }
  });
});


// ---------------------------------------------------------------------------------------------------
describe('a worker is bound to the issuer that signed for it (api.claim_attempt, p_issuer)', () => {
  async function pinned() {
    const a = await committedAccount();
    const w = world(a);
    // A kind of its own for each Job: registering a version retires the earlier ones of the same (issuer, worker kind), and the registry is global.
    const kind = `itest_${tag}_${randomBytes(3).toString('hex')}`;
    const version = freshVersion();
    const cad = await w.workers.register('cad-worker', kind, version, sha(`${kind}-cad-${version}`), ['test_workload']);
    const engine = await w.workers.register('engine-worker', `${kind}_e`, version, sha(`${kind}-engine-${version}`), ['test_workload']);
    const submitted = await w.jobs.submit(await project(db, a), {workerVersion: version});
    return {a, w, cad: cad.worker_id as string, engine: engine.worker_id as string, version, attempt_id: submitted.attempt_id as string, job_id: submitted.job_id as string};
  }

  it('answers incompatible, changing nothing and handing out no fence, to a token of another issuer that names the worker; the worker\'s own issuer claims', async () => {
    const {w, cad, engine, attempt_id: attemptId} = await pinned();
    expect(await w.workers.claim(attemptId, cad, 'engine-worker')).toMatchObject({outcome: 'incompatible', fence: null, expires_at: null});
    expect(await w.workers.claim(attemptId, engine, 'cad-worker')).toMatchObject({outcome: 'incompatible', fence: null});
    expect(await attemptRow(attemptId)).toMatchObject({state: 'waiting', started_at: null});
    expect(await count(db, 'select count(*) as n from jobs.leases where attempt_id = $1', [attemptId])).toBe(0);
    const claimed = await w.workers.claim(attemptId, cad, 'cad-worker');
    expect(claimed).toMatchObject({outcome: 'claimed', worker_version: expect.any(Number)});
    expect((await leaseRow(attemptId)).worker_id).toBe(cad);
  });

  it('does not hand a claimed attempt\'s fence back to the other issuer\'s token: a replay needs the worker\'s own issuer (or none stated)', async () => {
    const {w, cad, attempt_id: attemptId} = await pinned();
    const claimed = await w.workers.claim(attemptId, cad, 'cad-worker');
    expect(claimed.outcome).toBe('claimed');
    expect(await w.workers.claim(attemptId, cad, 'cad-worker')).toMatchObject({outcome: 'replayed', fence: claimed.fence});
    const foreign = await w.workers.claim(attemptId, cad, 'engine-worker');
    expect(foreign).toMatchObject({outcome: 'incompatible', fence: null});
    // No issuer stated: nothing to bind it to, and the database says what it always said.
    expect(await w.workers.claim(attemptId, cad, null)).toMatchObject({outcome: 'replayed', fence: claimed.fence});
    // The built-in step names no worker, so there is nothing to bind: it is simply too late.
    expect((await w.workers.claim(attemptId, null, 'cad-worker')).outcome).toBe('already_claimed');
  });

  it('judges the issuer before the state of the attempt: a finished attempt is not a way to learn anything about a worker that is another issuer\'s', async () => {
    const {w, cad, a, attempt_id: attemptId, job_id: jobId} = await pinned();
    await w.jobs.cancel(jobId);
    expect(await w.workers.claim(attemptId, cad, 'engine-worker')).toMatchObject({outcome: 'incompatible'});
    expect(await w.workers.claim(attemptId, cad, 'cad-worker')).toMatchObject({outcome: 'not_waiting', state: 'cancelled'});
    expect(a.accountId).toBeTruthy();
  });

  it('raises 22023 for an issuer that is not a worker issuer, and an unknown worker stays incompatible whatever the issuer', async () => {
    const {w, attempt_id: attemptId} = await pinned();
    for (const issuer of ['gateway', 'application', 'heartbeat', '', 'CAD-WORKER', 'cad-worker ']) {
      const refused = await attempt(db, null, 'select * from api.claim_attempt($1, null, $2)', [attemptId, issuer]);
      expect(refused.ok, issuer).toBe(false);
      if (!refused.ok) expect(refused.code, issuer).toBe('22023');
    }
    expect((await w.workers.claim(attemptId, randomUUID(), 'cad-worker')).outcome).toBe('incompatible');
    expect(await attemptRow(attemptId)).toMatchObject({state: 'waiting'});
  });

  it('is what the signed endpoint does with the VERIFIED issuer: the engine worker\'s token that names the CAD worker is refused 409 incompatible, the CAD worker\'s own is not', async () => {
    const {w, cad, attempt_id: attemptId} = await pinned();
    const engineWorker = testWorker('engine-worker', instanceId);
    const cadWorker = testWorker('cad-worker', instanceId);
    const options = {env: {...env, ...engineWorker.environment, ...cadWorker.environment, ADMINISTRATOR_EMAIL: 'admin@example.test', NEXT_PUBLIC_APP_ENV: 'local', PAID_ADAPTERS_ENABLED: 'false', SYNTHETIC_DATA_ENABLED: 'false'}};
    const refused = await handleWorkerRequest(engineWorker.request({cmd: 'claim', att: attemptId, wid: cad}, {}), options);
    expect([refused.status, await refused.json()]).toEqual([409, {state: 'incompatible'}]);
    expect((await attemptRow(attemptId)).state).toBe('waiting');
    const claimed = await handleWorkerRequest(cadWorker.request({cmd: 'claim', att: attemptId, wid: cad}, {}), options);
    expect(claimed.status).toBe(200);
    const body = await claimed.json();
    expect(body.state).toBe('claimed');
    // The engine worker's token cannot ask for the fence again either.
    const again = await handleWorkerRequest(engineWorker.request({cmd: 'claim', att: attemptId, wid: cad}, {}), options);
    expect([again.status, await again.json()]).toEqual([409, {state: 'incompatible'}]);
    expect(w).toBeTruthy();
  });

  it('is passed by the typed call, and refuses an issuer that is not a worker\'s before asking', async () => {
    const {cad, attempt_id: attemptId} = await pinned();
    expect(await claimAttempt({attemptId, workerId: cad, issuer: 'engine-worker'}, {env})).toEqual({outcome: 'incompatible'});
    expect(await claimAttempt({attemptId, workerId: cad, issuer: 'cad-worker'}, {env})).toMatchObject({outcome: 'claimed'});
    await expect(claimAttempt({attemptId, workerId: cad, issuer: 'gateway' as never}, {env})).rejects.toBeInstanceOf(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the revision a worker names (api.finish_attempt, p_revision): the signed rev claim means something', () => {
  async function ready(options: {registered?: boolean} = {}) {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const submitted = await w.jobs.submit(pid);
    const claimed = await w.workers.claim(submitted.attempt_id);
    expect(claimed.outcome).toBe('claimed');
    expect((await w.workers.step(submitted.attempt_id, claimed.fence, 'work')).outcome).toBe('stepped');
    void options;
    return {a, w, pid, attemptId: submitted.attempt_id as string, jobId: submitted.job_id as string, fence: claimed.fence as string};
  }

  it('finishes a completion that names the revision the attempt is bound to, and one that names none (the built-in step)', async () => {
    const first = await ready();
    expect(await first.w.workers.finish(first.attemptId, first.fence, 'completed', 'b'.repeat(64), 1)).toMatchObject({outcome: 'finished', state: 'completed'});
    const second = await ready();
    expect(await second.w.workers.finish(second.attemptId, second.fence, 'completed', 'b'.repeat(64), null)).toMatchObject({outcome: 'finished', state: 'completed'});
  });

  it('rejects a completion computed from another revision than the bound one, EVEN WHEN the Project has not moved: lease revoked/stale_revision, attempt failed/step_failed, nothing published', async () => {
    for (const named of [2, 7, 1_000_000]) {
      const job = await ready();
      const rejected = await job.w.workers.finish(job.attemptId, job.fence, 'completed', 'b'.repeat(64), named);
      expect(rejected, String(named)).toMatchObject({outcome: 'rejected', state: 'failed', reason: 'step_failed', detail: 'stale_revision'});
      expect(await attemptRow(job.attemptId)).toMatchObject({state: 'failed', reason: 'step_failed'});
      expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'revoked', detail: 'stale_revision', result_digest: null});
      expect((await job.w.jobs.detail(job.jobId))).toMatchObject({state: 'failed', ending: 'stale_revision', can_retry: true});
      // The lease is ended: the same call again is refused, and nothing was published.
      expect((await job.w.workers.finish(job.attemptId, job.fence, 'completed', 'b'.repeat(64), 1)).outcome).toBe('revoked');
    }
  });

  it('still rejects the right revision when the Project moved on (the bound revision against the current one is judged as before)', async () => {
    const job = await ready();
    await raiseRevision(db, job.pid);
    expect(await job.w.workers.finish(job.attemptId, job.fence, 'completed', 'b'.repeat(64), 1)).toMatchObject({outcome: 'rejected', detail: 'stale_revision'});
  });

  it('ignores the revision of a failure: a worker that failed says so whatever it was computed from', async () => {
    const job = await ready();
    expect(await job.w.workers.finish(job.attemptId, job.fence, 'failed', null, 99)).toMatchObject({outcome: 'finished', state: 'failed', reason: 'step_failed', detail: 'step_failed'});
    expect(await leaseRow(job.attemptId)).toMatchObject({end_reason: 'failed', detail: 'step_failed'});
  });

  it('raises 22023 for a revision below 1, and writes nothing', async () => {
    const job = await ready();
    for (const revision of [0, -4]) {
      const refused = await attempt(db, null, 'select * from api.finish_attempt($1, $2, $3, $4, $5)', [job.attemptId, job.fence, 'completed', 'b'.repeat(64), revision]);
      expect(refused.ok, String(revision)).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('22023');
    }
    expect(await attemptRow(job.attemptId)).toMatchObject({state: 'running'});
  });

  it('is the signed endpoint\'s rev claim: a finish that signs the bound revision is finished, one that signs another is 409 rejected and the attempt is failed', async () => {
    const worker = testWorker('cad-worker', instanceId);
    const options = {env: {...env, ...worker.environment, ADMINISTRATOR_EMAIL: 'admin@example.test', NEXT_PUBLIC_APP_ENV: 'local', PAID_ADAPTERS_ENABLED: 'false', SYNTHETIC_DATA_ENABLED: 'false'}};
    const kind = `itest_${tag}_rev`;
    const version = freshVersion();
    const a = await committedAccount();
    const w = world(a);
    const registered = await w.workers.register('cad-worker', kind, version, sha(`${kind}-${version}`), ['test_workload']);
    const pid = await project(db, a);
    const good = await w.jobs.submit(pid, {workerVersion: version});
    const stale = await w.jobs.submit(pid, {workerVersion: version});
    const goodClaim = await w.workers.claim(good.attempt_id, registered.worker_id, 'cad-worker');
    const staleClaim = await w.workers.claim(stale.attempt_id, registered.worker_id, 'cad-worker');
    const finish = (attemptId: string, fence: string, rev: number) =>
      handleWorkerRequest(worker.request({cmd: 'finish', att: attemptId, fence, rev}, {to: 'completed', result_digest: 'c'.repeat(64)}), options);
    const rejected = await finish(stale.attempt_id, staleClaim.fence, 2);
    expect([rejected.status, await rejected.json()]).toEqual([409, {state: 'rejected'}]);
    expect(await attemptRow(stale.attempt_id)).toMatchObject({state: 'failed', reason: 'step_failed'});
    expect(await leaseRow(stale.attempt_id)).toMatchObject({end_reason: 'revoked', detail: 'stale_revision'});
    const finished = await finish(good.attempt_id, goodClaim.fence, 1);
    expect([finished.status, await finished.json()]).toEqual([200, {state: 'finished', attempt_state: 'completed'}]);
  });

  it('is passed by the typed call: the revision goes with a completion, and a revision below 1 is refused before asking', async () => {
    const job = await ready();
    expect(await finishAttempt({attemptId: job.attemptId, fence: job.fence, to: 'completed', resultDigest: 'b'.repeat(64), revision: 4}, {env})).toMatchObject({outcome: 'rejected', detail: 'stale_revision'});
    await expect(finishAttempt({attemptId: job.attemptId, fence: job.fence, to: 'completed', resultDigest: 'b'.repeat(64), revision: 0}, {env})).rejects.toBeInstanceOf(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the cancellation of one Account uses the sweep\'s predicate: authority gone, and never the healthy Jobs of a re-enabled Account', () => {
  const epochOf = async (accountId: string) => (await one('select authorization_epoch::int as e from identity.accounts where id = $1', [accountId])).e as number;
  const audit = (accountId: string) => count(db, `select count(*) as n from identity.audit_events where action = 'jobs.cancelled' and target = $1`, [`account:${accountId}`]);

  it('cancels NOTHING for an Account that is active under the epoch its attempts are bound to: a waiting and a running Job keep their leases, and no audit event is written', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const waiting = await w.jobs.submit(pid, {plan: await planWith(1)});
    const running = await claimedJob(a, {project: pid, plan: await planWith(1)});
    const before = await counts(a.accountId);
    expect(await w.workers.cancelAccount(a.accountId)).toEqual({cancelled: 0, settled: 0});
    expect(await attemptRow(waiting.attempt_id)).toMatchObject({state: 'waiting'});
    expect(await attemptRow(running.attemptId)).toMatchObject({state: 'running'});
    expect(await leaseRow(running.attemptId)).toMatchObject({ended_at: null});
    expect(await counts(a.accountId)).toEqual(before);
    expect(await figures(a.accountId)).toEqual({settled: 0, reserved: 2 * RESERVED});
    expect(await audit(a.accountId)).toBe(0);
    // And the Job can still be finished.
    expect((await running.workers.step(running.attemptId, running.fence, 'search', 1)).outcome).toBe('stepped');
  });

  it('cancels an Account that is disabled (every open attempt, once, with one audit event), and the cause is recorded as account_disabled', async () => {
    const a = await committedAccount();
    const w = world(a);
    const running = await claimedJob(a);
    const waiting = await w.jobs.submit(await project(db, a));
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    expect(await w.workers.cancelAccount(a.accountId)).toMatchObject({cancelled: 2});
    expect(await leaseRow(running.attemptId)).toMatchObject({end_reason: 'revoked', detail: 'account_disabled'});
    expect(await attemptRow(waiting.attempt_id)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await audit(a.accountId)).toBe(1);
  });

  it('cancels the attempts of the OLD epoch of a re-enabled Account (a late canceller) and leaves the healthy Jobs of the new epoch alone', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const oldRunning = await claimedJob(a, {project: pid, plan: await planWith(1)});
    const oldWaiting = await w.jobs.submit(pid);
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    await db.query(`select api.enable_account('seed:local:test', $1)`, [a.accountId]);
    const epoch = await epochOf(a.accountId);
    expect(epoch).toBeGreaterThan(a.epoch);
    const fresh = world({...a, epoch});
    // (Three open Jobs at most: the two old ones, which are still open, and one new one.)
    const newRunningSubmit = await fresh.jobs.submit(pid);
    expect(newRunningSubmit.outcome).toBe('accepted');
    const newClaim = await fresh.workers.claim(newRunningSubmit.attempt_id);
    expect(newClaim.outcome).toBe('claimed');
    // The Account is ACTIVE again, so a canceller that runs now (late) must cancel only what the sweep would: the attempts bound to the epoch that is gone.
    expect(await w.workers.cancelAccount(a.accountId)).toMatchObject({cancelled: 2});
    expect(await attemptRow(oldRunning.attemptId)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await attemptRow(oldWaiting.attempt_id)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await leaseRow(oldRunning.attemptId)).toMatchObject({end_reason: 'revoked', detail: 'revoked_epoch'});
    expect(await attemptRow(newRunningSubmit.attempt_id)).toMatchObject({state: 'running'});
    expect(await leaseRow(newRunningSubmit.attempt_id)).toMatchObject({ended_at: null});
    expect(await audit(a.accountId)).toBe(1);
    // The new Job keeps working, and a second call changes nothing.
    expect((await fresh.workers.step(newRunningSubmit.attempt_id, newClaim.fence, 'work')).outcome).toBe('stepped');
    expect(await w.workers.cancelAccount(a.accountId)).toMatchObject({cancelled: 0});
    expect(await audit(a.accountId)).toBe(1);
  });

  it('agrees with the sweep: the same Account state cancels the same attempts whichever of the two runs, and the sweep never touches the new epoch\'s Jobs either', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const old = await w.jobs.submit(pid);
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    await db.query(`select api.enable_account('seed:local:test', $1)`, [a.accountId]);
    const fresh = world({...a, epoch: await epochOf(a.accountId)});
    const healthy = await fresh.jobs.submit(pid);
    await w.workers.sweep();
    expect(await attemptRow(old.attempt_id)).toMatchObject({state: 'cancelled', reason: 'account_disabled'});
    expect(await attemptRow(healthy.attempt_id)).toMatchObject({state: 'waiting'});
  });

  it('records why: the epoch that moved, the Account that is disabled, the Account that is removed', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const one1 = await claimedJob(a, {project: pid});
    await db.query(`select api.disable_account('seed:local:test', $1)`, [a.accountId]);
    await db.query(`select api.enable_account('seed:local:test', $1)`, [a.accountId]);
    await w.workers.cancelAccount(a.accountId);
    expect(await leaseRow(one1.attemptId)).toMatchObject({detail: 'revoked_epoch'});
    const b = await committedAccount();
    const wb = world(b);
    const two = await claimedJob(b);
    await db.query(`select api.record_tombstone('account', $1)`, [b.accountId]);
    await wb.workers.cancelAccount(b.accountId);
    expect(await leaseRow(two.attemptId)).toMatchObject({end_reason: 'revoked', detail: 'tombstoned'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the sweep ends an expired live lease whatever became of its attempt', () => {
  const MOVE = 'select * from api.move_attempt($1, $2, $3, $4, $5, $6)';

  it('ends the lease (expired / lease_expired) of an attempt that api.move_attempt moved by hand, leaves the attempt as it is, and clears the expired-lease observation', async () => {
    const a = await committedAccount();
    const w = world(a);
    const submitted = await w.jobs.submit(await project(db, a));
    const claimed = await w.workers.claim(submitted.attempt_id);
    expect(claimed.outcome).toBe('claimed');
    // The attempt is moved directly (a Story 2.11 command that does not end its lease).
    const moved = await db.query(MOVE, [a.accountId, a.epoch, randomUUID(), submitted.attempt_id, 'failed', 'step_failed']);
    expect(moved.rows[0].outcome).toBe('moved');
    expect(await leaseRow(submitted.attempt_id)).toMatchObject({ended_at: null});
    await backdateLease(db, submitted.attempt_id, 400);
    const observed = await alarmObservations({env});
    expect(observed.leaseExpiredOldest).not.toBeNull();
    expect(observed.leaseExpiredOldest!).toBeGreaterThanOrEqual(400);
    expect(leaseExpiredUnclaimedCondition.evaluate({...observed, heartbeatConfigured: true}, [])).toHaveLength(1);

    const swept = await w.workers.sweep();
    expect(Number(swept.expired)).toBeGreaterThanOrEqual(1);
    // The lease is ended; the attempt is exactly as the command left it (not failed again, not lease_lost).
    expect(await leaseRow(submitted.attempt_id)).toMatchObject({end_reason: 'expired', detail: 'lease_expired', result_digest: null});
    expect(await attemptRow(submitted.attempt_id)).toMatchObject({state: 'failed', reason: 'step_failed'});
    expect(await count(db, `select count(*) as n from jobs.leases l where l.attempt_id = $1 and l.ended_at is null`, [submitted.attempt_id])).toBe(0);
    // Nothing of this lease is left to raise the alarm for.
    const after = await alarmObservations({env});
    expect(after.leaseExpiredOldest === null || after.leaseExpiredOldest < 400).toBe(true);
    // A second sweep finds nothing to do for it.
    const lease = await leaseRow(submitted.attempt_id);
    await w.workers.sweep();
    expect((await leaseRow(submitted.attempt_id)).ended_at.getTime()).toBe(lease.ended_at.getTime());
  });

  it('does the same for an attempt moved to completed by hand, and still fails a running attempt as lease_lost', async () => {
    const a = await committedAccount();
    const w = world(a);
    const pid = await project(db, a);
    const done = await w.jobs.submit(pid);
    await w.workers.claim(done.attempt_id);
    expect((await db.query(MOVE, [a.accountId, a.epoch, randomUUID(), done.attempt_id, 'completed', null])).rows[0].outcome).toBe('moved');
    const live = await w.jobs.submit(pid);
    await w.workers.claim(live.attempt_id);
    await backdateLease(db, done.attempt_id, 5);
    await backdateLease(db, live.attempt_id, 5);
    await w.workers.sweep();
    expect(await leaseRow(done.attempt_id)).toMatchObject({end_reason: 'expired', detail: 'lease_expired'});
    expect(await attemptRow(done.attempt_id)).toMatchObject({state: 'completed'});
    expect(await leaseRow(live.attempt_id)).toMatchObject({end_reason: 'expired', detail: 'lease_expired'});
    expect(await attemptRow(live.attempt_id)).toMatchObject({state: 'failed', reason: 'lease_lost'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a plan is limited by the length of its jsonb text, and the application counts the same', () => {
  const withOptions = async (options: Record<string, unknown>) => ({operations: [{...typedOperation(await scheduleOf()), options}]});
  /** The wire form of a plan with one operation and these options, built by hand: planToWire itself refuses what is over the limit, and these tests need both sides of it. */
  const wireWith = async (options: Record<string, unknown>) => {
    const base = planToWire({operations: [typedOperation(await scheduleOf())]}).operations as Record<string, unknown>[];
    return JSON.parse(JSON.stringify({operations: [{...base[0], options}]}));
  };
  const padFor = async (target: number) => {
    let pad = 0;
    while (planBytes(await wireWith({pad: 'x'.repeat(pad + 1)})) <= target) pad += 1;
    return pad;
  };
  const databaseBytes = async (plan: unknown) => (await one('select octet_length($1::jsonb::text) as n', [JSON.stringify(plan)])).n as number;

  it('counts the same bytes the database counts, for strings, numbers, escapes, nesting and multi-byte text', async () => {
    const samples: unknown[] = [
      {},
      {outcome: 'fail'},
      {a: [1, 2, 3], b: {c: 'd', e: [true, false, null]}},
      {text: 'שלום עולם, "quoted": \\ back \n new \t tab \u0001 é ✓'},
      {numbers: [0, -1, 1.5, 100000000000, 1e21, 1.5e-7, 1.234e25, -2.5e-9, 0.1, 123456789.123456789]},
      {deep: [[[[{x: []}]]]], empty: {}},
    ];
    for (const sample of samples) {
      const wire = JSON.parse(JSON.stringify(sample));
      expect(planBytes(wire), JSON.stringify(sample)).toBe(await databaseBytes(wire));
      expect(Buffer.byteLength(jsonbText(wire), 'utf8')).toBe(await databaseBytes(wire));
    }
  });

  it('accepts a plan of exactly 4096 bytes by the database\'s count in both places, and refuses 4097 in both', async () => {
    const pad = await padFor(4096);
    const fits = await withOptions({pad: 'x'.repeat(pad)});
    const over = await withOptions({pad: 'x'.repeat(pad + 1)});
    const fitsWire = planToWire(fits as never);
    expect(planBytes(fitsWire)).toBe(4096);
    expect(await databaseBytes(fitsWire)).toBe(4096);
    expect((await one('select jobs.plan_valid($1::jsonb) as ok', [JSON.stringify(fitsWire)])).ok).toBe(true);
    expect(() => planToWire(over as never)).toThrow(TypeError);
    // The database refuses the 4097 plan too (sent by hand, as the application would not).
    const overWire = await wireWith({pad: 'x'.repeat(pad + 1)});
    expect(await databaseBytes(overWire)).toBe(4097);
    expect((await one('select jobs.plan_valid($1::jsonb) as ok', [JSON.stringify(overWire)])).ok).toBe(false);
    // Through the typed call the 4096 plan reaches the database (and is refused there for its option, a reservation matter, not for its size); the 4097 plan never leaves.
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const project1 = await project(db, a);
    expect(await submitJob(operation, {commandId: randomUUID(), projectId: project1, inputDigest, plan: fits as never}, {env})).toMatchObject({outcome: 'refused', refusal: 'unavailable_bound', reason: 'unsupported_option'});
    await expect(submitJob(operation, {commandId: randomUUID(), projectId: project1, inputDigest, plan: over as never}, {env})).rejects.toBeInstanceOf(TypeError);
  });

  it('refuses in TypeScript a plan whose compact JSON is within 4096 bytes but whose jsonb text is over, which the database refuses with 22023', async () => {
    let count1 = 1;
    const listPlan = async (n: number) => withOptions({list: Array.from({length: n}, () => 0)});
    const wireOf = (n: number) => wireWith({list: Array.from({length: n}, () => 0)});
    while (planBytes(await wireOf(count1)) <= 4096) count1 += 1;
    const wire = await wireOf(count1);
    expect(Buffer.byteLength(JSON.stringify(wire), 'utf8')).toBeLessThanOrEqual(4096);
    expect(await databaseBytes(wire)).toBeGreaterThan(4096);
    expect((await one('select jobs.plan_valid($1::jsonb) as ok', [JSON.stringify(wire)])).ok).toBe(false);
    const a = await committedAccount();
    const project1 = await project(db, a);
    const refused = await attempt(db, null, 'select * from api.submit_job($1, 1, $2, $3, $4, $5, $6::jsonb, null)', [a.accountId, randomUUID(), project1, 'test_workload', inputDigest, JSON.stringify(wire)]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe('22023');
    await expect(submitJob({accountId: a.accountId, epoch: a.epoch}, {commandId: randomUUID(), projectId: project1, inputDigest, plan: (await listPlan(count1)) as never}, {env})).rejects.toBeInstanceOf(TypeError);
    // One item fewer is within the limit for both.
    expect(await databaseBytes(await wireOf(count1 - 1))).toBeLessThanOrEqual(4096);
    const fewer = await listPlan(count1 - 1);
    expect(() => planToWire(fewer as never)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight fails closed for the Story 2.7 objects', () => {
  const signatures = [
    'api.submit_job(uuid,bigint,uuid,uuid,text,text,jsonb,integer)',
    'api.cancel_job(uuid,bigint,uuid,uuid)',
    'api.list_jobs(uuid,bigint,integer)',
    'api.read_job_detail(uuid,bigint,uuid)',
    'api.register_worker(text,text,integer,text,text[])',
    'api.claim_attempt(uuid,uuid,text)',
    'api.renew_lease(uuid,uuid)',
    'api.run_step(uuid,uuid,text,integer)',
    'api.finish_operation(uuid,uuid,uuid,text,bigint,bigint,text,text)',
    'api.finish_attempt(uuid,uuid,text,text,bigint)',
    'api.record_callback(text,text,text,text,text,uuid,text)',
    'api.claim_outbox(integer,uuid)',
    'api.mark_published(uuid,text)',
    'api.sweep_attempts()',
    'api.cancel_account_jobs(uuid)',
  ];

  it('lists the fifteen signatures it looks for and the fifteen the service role must execute', async () => {
    expect(signatures).toHaveLength(15);
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const signature of signatures) expect(definition.split(`'${signature}'`).length - 1, signature).toBe(2);
  });

  it.each(signatures)('fails with N3020 naming %s and the Story 2.7 migration when it is missing', async (signature) => {
    await inTx(async (client) => {
      const spec = (await client.query(`select to_regprocedure($1)::text as name`, [signature])).rows[0].name;
      expect(spec, signature).toBeTruthy();
      await client.query(`drop function ${spec} cascade`);
      const result = await txAttempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain(signature);
        expect(result.message).toContain('Story 2.7');
      }
    });
  });

  it.each(signatures.map((signature) => [signature, signature.replace(/,/g, ', ')]))('fails with 42501 naming %s when the service role cannot execute it', async (signature, spaced) => {
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

  it.each(['jobs.outbox', 'jobs.workers', 'jobs.leases', 'jobs.callbacks'])('fails, naming a permission and not answering ok, when the role it runs as cannot read %s', async (blocked) => {
    const everything = [
      'identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts',
      'artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance', 'artifacts.retained_pictures',
      'lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats', 'usage.periods',
      'jobs.jobs', 'jobs.attempts', 'jobs.steps', 'jobs.operations', 'jobs.commands',
      'usage.rate_schedules', 'usage.reservations', 'usage.settlements', 'usage.overrun_incidents', 'usage.commands',
      'provider_private.permissions',
      'jobs.outbox', 'jobs.workers', 'jobs.leases', 'jobs.callbacks',
      'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
    ];
    await inTx(async (client) => {
      await client.query('grant usage on schema api, identity, projects, lifecycle, artifacts, usage, jobs, provider_private to anon');
      await client.query('grant create on schema api to anon');
      for (const table of everything.filter((name) => name !== blocked)) await client.query(`grant select on ${table} to anon`);
      await client.query('alter function api.preflight() owner to anon');
      const result = await txAttempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok, `${blocked} unreadable`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(blocked.split('.')[1]);
      }
    });
  });
});
