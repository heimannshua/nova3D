import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import type {PublishingConfig, Publisher} from '../../lib/job-dispatch';
import {bodyDigest, signWorkerCommand, type WorkerCommandClaims, type WorkerIssuer} from '../../lib/service-signing';
import {testSigner} from './service-keys';

// Story 2.7. The world the Job tests (integration, unit and browser) share: a publisher that records and can fail, a test worker that signs commands as the CAD worker or the
// engine worker with the tests' own keys, a fixture rate schedule, and Jobs walked into every state a screen shows by the real commands (api.submit_job, api.claim_attempt,
// api.run_step, ...), run as the table OWNER on a plain connection (the functions are security definers, so the owner runs exactly what the service role would).
//
// The clock cannot be moved, so two things are done to the rows directly, as the owner, and nowhere else: `backdateLease` makes a lease that has already run out (the
// guard refuses to shorten a live one, so the row is replaced by one of the same fence, claimed earlier), and `raiseRevision` bumps a Project's revision the way a rename
// does (a result of stale inputs). Everything is removed with `removeJobWorld`, which tests/support/accounts-data.ts and forged-session.ts call before the Job records.

// A publisher that records ---------------------------------------------------------------------------------------------------------------------

export type RecordedPublication = {url: string; body: {attempt: string; instance: string}; deduplicationId: string; messageId: string};

/**
 * A publisher that records what it was asked to publish and can be told to fail, in place of the queue. It answers a message ID of its own for each distinct deduplication ID
 * (as the queue does: a message published twice under one ID is held once and answers the first message ID).
 */
export function fakePublisher() {
  const calls: RecordedPublication[] = [];
  const held = new Map<string, string>();
  const state = {failing: false, failuresLeft: 0, attempts: 0};
  const publish: Publisher = async (message) => {
    state.attempts += 1;
    if (state.failing || state.failuresLeft > 0) {
      if (state.failuresLeft > 0) state.failuresLeft -= 1;
      throw new Error('the queue refused the message');
    }
    let messageId = held.get(message.deduplicationId);
    if (messageId === undefined) {
      messageId = `msg_${randomUUID().replaceAll('-', '')}`;
      held.set(message.deduplicationId, messageId);
    }
    calls.push({...message, messageId});
    return {messageId};
  };
  return {
    publish,
    calls,
    /** Every publication refused from now on (or none, with false). */
    setFailing(failing: boolean) {
      state.failing = failing;
    },
    /** The next `count` publications are refused. */
    failNext(count = 1) {
      state.failuresLeft = count;
    },
    /** How many times the publisher was asked, refused ones included. */
    asked: () => state.attempts,
    /** The publisher as the module takes it, for an environment (the instance and the origin are the tests'). */
    config(instanceId: string, origin = 'http://127.0.0.1:4173'): PublishingConfig {
      return {publish, url: `${origin}/api/dispatch`, instanceId};
    },
  };
}

// A test worker -----------------------------------------------------------------------------------------------------------------------------

/**
 * A worker that signs as `cad-worker` or `engine-worker` with that issuer's test key, and the environment a server needs to verify it (`SERVICE_KEYS_<ISSUER>`). `request` makes a
 * complete POST to the worker route with the token, the body's digest and the claims of the command.
 */
export function testWorker(issuer: WorkerIssuer, instanceId: string, options: {label?: string; origin?: string} = {}) {
  const {signer, json } = testSigner({issuer, active: options.label ?? `${issuer}-1`});
  const variable = `SERVICE_KEYS_${issuer.toUpperCase().replace(/-/g, '_')}`;

  type Claims = DistributiveOmit<WorkerCommandClaims, 'dig'>;
  type Signing = {now?: number; lifetimeSeconds?: number; jti?: string; environment?: string};
  const token = (claims: Claims, body: string, signing: Signing = {}) =>
    signWorkerCommand(signer, signing.environment ?? instanceId, {...claims, dig: bodyDigest(body)} as WorkerCommandClaims, signing);

  return {
    issuer,
    signer,
    kid: signer.kid,
    keySetJson: json,
    /** The variable the application reads this issuer's public key set from, and its value. */
    environment: {[variable]: json} as Record<string, string>,
    token,
    /** A POST to /api/workers carrying a signed command. `body` is sent as written (a string) or as JSON; `signing` overrides the token's times and ID, or the environment it is for. */
    request(claims: Claims, body: unknown = {}, signing: Signing = {}, extraHeaders: Record<string, string> = {}) {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return new Request(`${options.origin ?? 'http://127.0.0.1:4173'}/api/workers`, {
        method: 'POST',
        headers: {authorization: `Bearer ${token(claims, text, signing)}`, 'content-type': 'application/json', ...extraHeaders},
        body: text,
      });
    },
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// A fixture rate schedule and a plan --------------------------------------------------------------------------------------------------------------

export type FixtureSchedule = {id: string; provider: string; model: string; apiVersion: string};

/**
 * A rate schedule (global, immutable): by default 1 microdollar per token in and out (`inputRate` and `outputRate` change that), no request fee. The provider is `fixture` unless a test gives its own (a test file that runs next to
 * others should: the cleanups delete the `fixture` schedules no reservation uses, which could be this file's before it uses it).
 */
export async function fixtureSchedule(client: Client, options: {model?: string; provider?: string; inputRate?: number; outputRate?: number} = {}): Promise<FixtureSchedule> {
  const model = options.model ?? `job-${randomUUID().replaceAll('-', '')}`;
  const provider = options.provider ?? 'fixture';
  const {rows} = await client.query(
    `insert into usage.rate_schedules (provider, model, version, api_version, currency, input_rate_num, input_rate_den, output_rate_num, output_rate_den, request_rate_num, request_rate_den,
                                       input_increment, output_increment, multiplier_num, multiplier_den)
     values ($2, $1, 1, 'fixture-1', 'USD', $3, 1, $4, 1, 0, 1, 1, 1, 1, 1) returning id`,
    [model, provider, options.inputRate ?? 1, options.outputRate ?? 1],
  );
  return {id: rows[0].id as string, provider, model, apiVersion: 'fixture-1'};
}

export type PlanOperation = {step_key: string; ordinal: number; schedule_id: string; provider: string; model: string; api_version: string; request_bytes: number; image_count: number; output_limit: number};

/** One planned operation under a schedule: 1,000 bytes and 100 tokens out price at 3,400 microdollars (the bound is 3,300 tokens in). */
export function planOperation(schedule: FixtureSchedule, options: {stepKey?: string; ordinal?: number; requestBytes?: number; outputLimit?: number} = {}): PlanOperation {
  return {
    step_key: options.stepKey ?? 'search',
    ordinal: options.ordinal ?? 1,
    schedule_id: schedule.id,
    provider: schedule.provider,
    model: schedule.model,
    api_version: schedule.apiVersion,
    request_bytes: options.requestBytes ?? 1000,
    image_count: 0,
    output_limit: options.outputLimit ?? 100,
  };
}

/** The same operation in the shape lib/job-commands.ts takes (camelCase), for the typed calls. */
export function typedOperation(schedule: FixtureSchedule, options: {stepKey?: string; ordinal?: number; requestBytes?: number; outputLimit?: number} = {}) {
  const wire = planOperation(schedule, options);
  return {
    stepKey: wire.step_key,
    ordinal: wire.ordinal,
    scheduleId: wire.schedule_id,
    provider: wire.provider,
    model: wire.model,
    apiVersion: wire.api_version,
    requestBytes: wire.request_bytes,
    imageCount: wire.image_count,
    outputLimit: wire.output_limit,
  };
}

// The commands, run as the owner ---------------------------------------------------------------------------------------------------------------

export type Who = {accountId: string; epoch: number};

/** The digest of what attempt 1 pins, the same for every test Job unless a test says otherwise. */
export const inputDigest = 'a'.repeat(64);

export function jobCommands(client: Client, who: Who) {
  const one = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0] as Record<string, any>;
  return {
    submit: (projectId: string, o: {plan?: unknown; workerVersion?: number | null; command?: string; digest?: string; kind?: string; epoch?: number} = {}) =>
      one('select * from api.submit_job($1, $2, $3, $4, $5, $6, $7, $8)', [
        who.accountId, o.epoch ?? who.epoch, o.command ?? randomUUID(), projectId, o.kind ?? 'test_workload', o.digest ?? inputDigest, JSON.stringify(o.plan ?? {}), o.workerVersion ?? null,
      ]),
    cancel: (jobId: string, o: {command?: string; epoch?: number} = {}) => one('select * from api.cancel_job($1, $2, $3, $4)', [who.accountId, o.epoch ?? who.epoch, o.command ?? randomUUID(), jobId]),
    list: (o: {limit?: number; epoch?: number} = {}) => one('select * from api.list_jobs($1, $2, $3)', [who.accountId, o.epoch ?? who.epoch, o.limit ?? 50]),
    detail: (jobId: string, o: {epoch?: number} = {}) => one('select * from api.read_job_detail($1, $2, $3)', [who.accountId, o.epoch ?? who.epoch, jobId]),
    retry: (jobId: string, expected: number, o: {command?: string; digest?: string} = {}) =>
      one('select * from api.request_retry($1, $2, $3, $4, $5, $6)', [who.accountId, who.epoch, o.command ?? randomUUID(), jobId, expected, o.digest ?? inputDigest]),
  };
}

export const workerCommands = (client: Client) => {
  const one = async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0] as Record<string, any>;
  return {
    register: (issuer: WorkerIssuer, kind: string, version: number, digest: string, kinds: string[]) => one('select * from api.register_worker($1, $2, $3, $4, $5)', [issuer, kind, version, digest, kinds]),
    claim: (attemptId: string, workerId: string | null = null, issuer: WorkerIssuer | null = null) => one('select * from api.claim_attempt($1, $2, $3)', [attemptId, workerId, issuer]),
    renew: (attemptId: string, fence: string) => one('select * from api.renew_lease($1, $2)', [attemptId, fence]),
    step: (attemptId: string, fence: string, key: string, ordinal: number | null = null) => one('select * from api.run_step($1, $2, $3, $4)', [attemptId, fence, key, ordinal]),
    operation: (attemptId: string, fence: string, operationId: string, outcome: 'completed' | 'noncharge', o: {input?: number; output?: number; model?: string; requestId?: string} = {}) =>
      one('select * from api.finish_operation($1, $2, $3, $4, $5, $6, $7, $8)', [
        attemptId, fence, operationId, outcome, outcome === 'completed' ? (o.input ?? 1) : null, outcome === 'completed' ? (o.output ?? 1) : null, outcome === 'completed' ? (o.model ?? 'fixture-model') : null,
        outcome === 'noncharge' ? (o.requestId ?? 'req_noncharge_1') : null,
      ]),
    finish: (attemptId: string, fence: string, to: 'completed' | 'failed', digest: string | null = to === 'completed' ? 'b'.repeat(64) : null, revision: number | null = null) =>
      one('select * from api.finish_attempt($1, $2, $3, $4, $5)', [attemptId, fence, to, digest, revision]),
    sweep: () => one('select * from api.sweep_attempts()', []),
    cancelAccount: (accountId: string) => one('select * from api.cancel_account_jobs($1)', [accountId]),
    claimOutbox: (limit = 20, outboxId: string | null = null) => one('select * from api.claim_outbox($1, $2)', [limit, outboxId]),
    mark: (outboxId: string, messageId: string) => one('select * from api.mark_published($1, $2)', [outboxId, messageId]),
    callback: (jti: string, issuer: WorkerIssuer, kid: string, command: string, attemptId: string | null, digest: string) =>
      one('select * from api.record_callback($1, $2, $3, $4, $5, $6, $7)', [jti, issuer, kid, 'worker-command', command, attemptId, digest]),
  };
};

// Direct changes the clock and the Project force on a test -------------------------------------------------------------------------------------

/** Makes the lease of an attempt a lease that ran out `secondsAgo` seconds ago: the row is replaced by one of the same fence and worker, claimed 120 seconds before it expired. */
export async function backdateLease(client: Client, attemptId: string, secondsAgo = 5): Promise<void> {
  await client.query(
    `with old as (delete from jobs.leases where attempt_id = $1 and ended_at is null returning account_id, attempt_id, worker_id, fence)
     insert into jobs.leases (account_id, attempt_id, worker_id, fence, claimed_at, renewed_at, expires_at)
     select account_id, attempt_id, worker_id, fence,
            clock_timestamp() - make_interval(secs => $2 + 120), clock_timestamp() - make_interval(secs => $2 + 120), clock_timestamp() - make_interval(secs => $2)
       from old`,
    [attemptId, secondsAgo],
  );
}

/**
 * Makes an attempt's outbox row `secondsAgo` seconds old: the row is replaced by one of the same ID and pins, created earlier (an outbox row is never edited, and the clock
 * cannot be moved). A published row keeps its publication.
 */
export async function ageOutbox(client: Client, attemptId: string, secondsAgo: number): Promise<void> {
  await client.query(
    `with old as (delete from jobs.outbox where attempt_id = $1 returning *)
     insert into jobs.outbox (id, account_id, job_id, attempt_id, kind, plan, account_epoch, project_revision, worker_version, created_at, publish_until, published_at, message_id)
     select id, account_id, job_id, attempt_id, kind, plan, account_epoch, project_revision, worker_version, clock_timestamp() - make_interval(secs => $2), publish_until, published_at, message_id from old`,
    [attemptId, secondsAgo],
  );
}

/** Raises a Project's revision by one, the way a committed command (a rename) does. */
export async function raiseRevision(client: Client, projectId: string): Promise<void> {
  await client.query('update projects.projects set revision = revision + 1, updated_at = clock_timestamp() where id = $1', [projectId]);
}

// Jobs in every state a screen shows ---------------------------------------------------------------------------------------------------------------

export const jobStatesToSeed = ['waiting', 'awaiting_worker', 'running', 'completed', 'failed', 'lease_lost', 'stale', 'cancelled', 'account_disabled'] as const;
export type SeededState = (typeof jobStatesToSeed)[number];

export type SeededJob = {state: SeededState; jobId: string; attemptId: string; outboxId: string; projectId: string; fence: string | null; operationIds: string[]};

/**
 * Walks a new Job of the Project into a state, by the real commands: `waiting` (accepted, nothing claimed), `awaiting_worker` (pinned to a worker version nobody serves),
 * `running` (claimed, its operation dispatched and held), `completed` (its operation completed and settled), `failed` (the plan said fail: its operation was dispatched and stays
 * held), `lease_lost` (the lease ran out and the sweep failed the attempt), `stale` (the Project changed under it, so its result was refused), `cancelled` (by the user) and
 * `account_disabled` (the Account was disabled and its Jobs cancelled: the Account stays disabled, so nothing after it can be asked as this Account).
 * Each plan reserves one operation under `schedule`.
 */
export async function seedJob(client: Client, who: Who, projectId: string, state: SeededState, options: {schedule?: FixtureSchedule; command?: string} = {}): Promise<SeededJob> {
  const jobs = jobCommands(client, who);
  const workers = workerCommands(client);
  const withOperation = options.schedule !== undefined && state !== 'awaiting_worker' && state !== 'waiting' && state !== 'cancelled';
  const operations = withOperation ? [planOperation(options.schedule!)] : [];
  const plan = state === 'failed' ? {outcome: 'fail', operations} : {operations};
  const submitted = await jobs.submit(projectId, {plan, workerVersion: state === 'awaiting_worker' ? 2 : null, command: options.command});
  if (submitted.outcome !== 'accepted') throw new Error(`The seeded Job was not accepted (${submitted.outcome}).`);
  const seeded: SeededJob = {state, jobId: submitted.job_id, attemptId: submitted.attempt_id, outboxId: submitted.outbox_id, projectId, fence: null, operationIds: []};
  if (state === 'waiting' || state === 'awaiting_worker') return seeded;
  if (state === 'cancelled') {
    await jobs.cancel(seeded.jobId);
    return seeded;
  }
  const claimed = await workers.claim(seeded.attemptId);
  if (claimed.outcome !== 'claimed') throw new Error(`The seeded Job was not claimed (${claimed.outcome}).`);
  seeded.fence = claimed.fence;
  if (withOperation) {
    const stepped = await workers.step(seeded.attemptId, claimed.fence, 'search', 1);
    if (stepped.outcome !== 'stepped') throw new Error(`The seeded Job's step was not begun (${stepped.outcome}).`);
    seeded.operationIds.push(stepped.operation_id);
  } else {
    await workers.step(seeded.attemptId, claimed.fence, 'work');
  }
  switch (state) {
    case 'running':
      return seeded;
    case 'completed':
      for (const operationId of seeded.operationIds) await workers.operation(seeded.attemptId, claimed.fence, operationId, 'completed');
      await workers.finish(seeded.attemptId, claimed.fence, 'completed');
      return seeded;
    case 'failed':
      await workers.finish(seeded.attemptId, claimed.fence, 'failed');
      return seeded;
    case 'lease_lost':
      await backdateLease(client, seeded.attemptId);
      await workers.sweep();
      return seeded;
    case 'stale':
      for (const operationId of seeded.operationIds) await workers.operation(seeded.attemptId, claimed.fence, operationId, 'completed');
      await raiseRevision(client, projectId);
      await workers.finish(seeded.attemptId, claimed.fence, 'completed');
      return seeded;
    case 'account_disabled':
      await client.query(`select api.disable_account('seed:local:test', $1)`, [who.accountId]);
      await workers.cancelAccount(who.accountId);
      return seeded;
    default:
      return seeded;
  }
}

// Cleanup -----------------------------------------------------------------------------------------------------------------------------------

/**
 * Removes the Job rows this story added for the Accounts (the callbacks of their attempts, then their outbox rows and leases) and the workers the tests registered (a worker
 * kind that starts with `itest_`, `etest_` or `test_`), in the order the foreign keys need: callbacks, leases, outbox, workers. Call it before the Job records themselves
 * (operations, steps, attempts, Jobs) are deleted.
 */
export async function removeJobWorld(client: Client, accountIds: string[]): Promise<void> {
  await client.query('delete from jobs.callbacks where attempt_id in (select id from jobs.attempts where account_id = any($1))', [accountIds]);
  await client.query('delete from jobs.leases where account_id = any($1)', [accountIds]);
  await client.query('delete from jobs.outbox where account_id = any($1)', [accountIds]);
  await removeTestWorkers(client);
}

/** Deletes the registered test workers that no lease refers to any longer. */
export async function removeTestWorkers(client: Client): Promise<void> {
  await client.query(
    `delete from jobs.workers w where w.worker_kind ~ '^(itest|etest|test)_' and not exists (select 1 from jobs.leases l where l.worker_id = w.id)`,
  );
}
