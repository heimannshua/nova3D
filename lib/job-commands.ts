// Story 2.7. The application side of durable, fenced Jobs: typed calls to the fifteen `api` functions that accept a Job, cancel it, list and read it, register a worker, claim an
// attempt, renew its lease, run its steps, report its operations, finish it, record a signed worker command, publish the dispatch outbox, sweep, and cancel an Account's Jobs when
// it is disabled (submit_job, cancel_job, list_jobs, read_job_detail, register_worker, claim_attempt, renew_lease, run_step, finish_operation, finish_attempt, record_callback,
// claim_outbox, mark_published, sweep_attempts, cancel_account_jobs) with the service role. Story 2.8 adds a sixteenth, reconcile_operation (late evidence or a proven noncharge for an
// operation whose outcome was unknown), and lets finish_operation report an `ambiguous` outcome and sweep_attempts count what it marked, reconciled and failed. This is the ONLY module that calls them (tests/unit/gate-structure.test.ts pins
// it), and it is one of the few that use the call helpers of lib/accounts.ts. lib/job-dispatch.ts, lib/worker-commands.ts and lib/job-cancellation.ts call it; lib/job-view.ts is
// the client-safe half (the vocabularies and the shapes the screens read).
//
// SERVER-ONLY (it imports lib/accounts.ts, which holds the service-role key and refuses to load in a browser).
//
// The model, in the words of docs/authority-contract.md ("Dispatch and leases"):
//   Every attempt commits an OUTBOX row with it, pinning the Account's epoch, the Project's revision, the worker version and the plan. `submit_job` commits a Job, its planned
//   operations, their reservations and that outbox together, or nothing. An attempt is CLAIMED once, under a 120-second lease with a fencing token; every command after the claim
//   presents the fence, and the database rechecks the lease, the authority of the epoch the attempt is bound to and the Project's live state before it lets the command land. A
//   user cancel and an Account disable revoke commit authority first: the lease ends before anything else, so a late result has nowhere to land.
//
// The commands that act for a person (submit, cancel, list, read) name the Account and its authorization epoch, both from the verified access (`operationOf`, lib/authority.ts),
// never from a request. The commands of a worker take no Account and no epoch: the database reads the epoch bound in the outbox row. A Job, attempt or operation of another
// Account's, of a deleted Project, or an unknown one is `unavailable`: ONE answer with nothing in it.
//
// A command ID names ONE command: sent again with the same payload it answers the original records (`replayed`); with another payload it is `reused`. If a call throws an
// AccountsUnavailableError with `outcomeUnknown`, the command may or may not have been made: send the SAME command ID again, which is safe.
//
// Nothing here logs. An error that comes out of the database layer names the call and the HTTP status, never an ID.
import {callRow, oneOf, requireUuid, unexpected, type AccountsOptions, type Row} from '@/lib/accounts';
import type {Operation} from '@/lib/authority';
import {
  endingDetails,
  finishedJobStates,
  isOpenState,
  jobStates,
  namePattern,
  shownReasons,
  testWorkloadKind,
  waitingReasons,
  type AttemptSummary,
  type AttemptView,
  type EndingDetail,
  type JobCost,
  type JobDetail,
  type JobListItem,
  type JobProgress,
  type JobState,
  type ShownReason,
} from '@/lib/job-view';

// The shapes ------------------------------------------------------------------------------------------------------------------------------------

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const digestPattern = /^[0-9a-f]{64}$/;
const wordPattern = /^[a-z][a-z0-9._-]{0,79}$/;
const apiVersionPattern = /^[!-~]{1,100}$/;
const returnedModelPattern = /^[!-~]{1,200}$/;
const requestIdPattern = /^[!-~]{1,200}$/;
const operationStateWords: readonly string[] = ['planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned'];
const jtiPattern = /^[A-Za-z0-9_-]{22}$/;
const kidPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const messageIdPattern = /^[!-~]{1,200}$/;
/** The largest an integer argument of the database is (a 32-bit integer). */
const maxInteger = 2_147_483_647;
/** The largest a bigint argument may be here: a safe integer, which JSON carries exactly. */
const maxBigint = Number.MAX_SAFE_INTEGER;

/** The two outcomes of a plan: the deterministic test workload completes, or fails after dispatching its first operation. */
export const planOutcomes = ['complete', 'fail'] as const;
export type PlanOutcome = (typeof planOutcomes)[number];

/** The most operations a plan carries, and the most bytes the outbox holds of it. */
export const maxPlannedOperations = 3;
export const maxPlanBytes = 4096;
/** The most operations a step carries (an ordinal), as Story 2.11 fixes it. */
export const maxOperationOrdinal = 100;

/** One operation a plan asks the Job to reserve when it is accepted: its step and ordinal, and the calculation the reservation prices (Story 2.6). */
export type PlannedOperation = {
  stepKey: string;
  ordinal: number;
  scheduleId: string;
  provider: string;
  model: string;
  apiVersion: string;
  requestBytes: number;
  imageCount: number;
  outputLimit: number;
  options?: Record<string, unknown>;
};

/** The plan of the test workload: how it ends (complete by default) and the operations it runs, in order. */
export type WorkloadPlan = {outcome?: PlanOutcome; operations?: PlannedOperation[]};

const operationKeys = ['stepKey', 'ordinal', 'scheduleId', 'provider', 'model', 'apiVersion', 'requestBytes', 'imageCount', 'outputLimit', 'options'];

function requireSize(name: string, value: unknown, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new TypeError(`${name} must be a whole number from 0 to ${maximum}`);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The text of a number as Postgres writes a `numeric` (never an exponent): what a JavaScript number such as 1e21 or 1.5e-7 becomes inside a jsonb value. */
function numericText(value: number): string {
  const plain = String(value);
  const exponent = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(plain);
  if (!exponent) return plain;
  const [, sign, whole, fraction = '', shift] = exponent;
  const digits = whole + fraction;
  const point = whole.length + Number(shift);
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * The text Postgres gives a jsonb value (`jsonb::text`), of a value JSON can carry: `", "` between the members of an object or the items of an array, `": "` after a key, strings
 * escaped as JSON escapes them, numbers as numerics. The database limits a plan by the length of THIS text (`octet_length(p_plan::text)`), which is longer than the compact JSON
 * the application sends by one byte for every comma and every colon outside a string, so the application measures the same text. (Postgres orders an object's keys by length and
 * then by bytes; the order does not change the length, so it is not reproduced here.)
 */
export function jsonbText(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return Number.isFinite(value) ? numericText(value) : 'null';
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
      const members = Object.entries(value as Record<string, unknown>).map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`);
      return `{${members.join(', ')}}`;
    }
    default:
      throw new TypeError('a plan holds only what JSON can carry');
  }
}

/** The number of bytes the database counts for a plan: the length of its jsonb text, which is what it limits to 4 KB. */
export function planBytes(wire: unknown): number {
  // What the database receives is the JSON the application sends, read back: a Date has become its text, an undefined member is gone.
  return new TextEncoder().encode(jsonbText(JSON.parse(JSON.stringify(wire)))).length;
}

/**
 * A plan in the form the database takes (snake_case members), checked as the database checks it: at most three operations, each a step key and an ordinal of 1 to 100 that no other
 * operation has, a rate schedule, the provider, model and API version it was priced under, and the calculation's sizes; an outcome of complete or fail. Throws a TypeError for
 * anything else, so a plan the database would refuse (22023) is never sent.
 */
export function planToWire(plan: WorkloadPlan | undefined): Row {
  if (plan === undefined) return {};
  if (!isPlainObject(plan)) throw new TypeError('plan must be an object');
  for (const key of Object.keys(plan)) if (key !== 'outcome' && key !== 'operations') throw new TypeError('plan has a member it does not know');
  const wire: Row = {};
  if (plan.outcome !== undefined) {
    if (!(planOutcomes as readonly unknown[]).includes(plan.outcome)) throw new TypeError('plan.outcome must be complete or fail');
    wire.outcome = plan.outcome;
  }
  if (plan.operations !== undefined) {
    if (!Array.isArray(plan.operations) || plan.operations.length > maxPlannedOperations) throw new TypeError(`plan.operations must be a list of at most ${maxPlannedOperations}`);
    const seen = new Set<string>();
    wire.operations = plan.operations.map((operation) => {
      if (!isPlainObject(operation)) throw new TypeError('a planned operation must be an object');
      for (const key of Object.keys(operation)) if (!operationKeys.includes(key)) throw new TypeError('a planned operation has a member it does not know');
      if (typeof operation.stepKey !== 'string' || !namePattern.test(operation.stepKey)) throw new TypeError('stepKey must be lower-case letters, digits and underscores');
      if (typeof operation.ordinal !== 'number' || !Number.isSafeInteger(operation.ordinal) || operation.ordinal < 1 || operation.ordinal > maxOperationOrdinal) throw new TypeError('ordinal must be a whole number from 1 to 100');
      if (typeof operation.provider !== 'string' || !wordPattern.test(operation.provider)) throw new TypeError('provider must be lower-case letters, digits, dots, underscores and hyphens, starting with a letter');
      if (typeof operation.model !== 'string' || !wordPattern.test(operation.model)) throw new TypeError('model must be lower-case letters, digits, dots, underscores and hyphens, starting with a letter');
      if (typeof operation.apiVersion !== 'string' || !apiVersionPattern.test(operation.apiVersion)) throw new TypeError('apiVersion must be 1 to 100 printable ASCII characters without spaces');
      if (operation.options !== undefined && !isPlainObject(operation.options)) throw new TypeError('options must be an object');
      const pair = `${operation.stepKey}:${operation.ordinal}`;
      if (seen.has(pair)) throw new TypeError('no two planned operations share a step key and an ordinal');
      seen.add(pair);
      return {
        step_key: operation.stepKey,
        ordinal: operation.ordinal,
        schedule_id: requireUuid('scheduleId', operation.scheduleId),
        provider: operation.provider,
        model: operation.model,
        api_version: operation.apiVersion,
        request_bytes: requireSize('requestBytes', operation.requestBytes, maxBigint),
        image_count: requireSize('imageCount', operation.imageCount, 999_999_999),
        output_limit: requireSize('outputLimit', operation.outputLimit, 999_999_999),
        ...(operation.options === undefined ? {} : {options: operation.options}),
      };
    });
  }
  if (planBytes(wire) > maxPlanBytes) throw new TypeError(`plan must be at most ${maxPlanBytes} bytes`);
  return wire;
}

// Checking what comes back ---------------------------------------------------------------------------------------------------------------------

function requireOperation(operation: Operation) {
  if (!Number.isSafeInteger(operation.epoch) || operation.epoch < 1) throw new TypeError('epoch must be a positive integer');
  return requireUuid('accountId', operation.accountId);
}

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const wholeNumber = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);

function uuidOf(value: unknown): string {
  const id = text(value);
  if (id === null || !idPattern.test(id)) throw unexpected();
  return id.toLowerCase();
}

function optionalUuidOf(value: unknown): string | null {
  return value === null || value === undefined ? null : uuidOf(value);
}

function numberOf(value: unknown, minimum = 1): number {
  const number = wholeNumber(value);
  if (number === null || number < minimum) throw unexpected();
  return number;
}

function amountOf(value: unknown): number {
  const amount = wholeNumber(value);
  if (amount === null) throw unexpected();
  return amount;
}

function stageOf(value: unknown): string {
  const stage = text(value);
  if (stage === null || !namePattern.test(stage)) throw unexpected();
  return stage;
}

function timeOf(value: unknown): string {
  const time = text(value);
  if (time === null || !timePattern.test(time) || Number.isNaN(Date.parse(time))) throw unexpected();
  return time;
}

function optionalTimeOf(value: unknown): string | null {
  return value === null || value === undefined ? null : timeOf(value);
}

function rowIn(value: unknown): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unexpected();
  return value as Row;
}

/** The reason of an attempt as the database answered, checked against its state: only a waiting attempt shows a derived reason. */
function reasonOf(state: JobState, value: unknown): ShownReason | null {
  const reason = value === null || value === undefined ? null : oneOf(value, shownReasons);
  const allowed: readonly (ShownReason | null)[] =
    state === 'waiting' ? waitingReasons : state === 'failed' ? (['step_failed', 'lease_lost'] as const) : state === 'cancelled' ? (['user_cancelled', 'account_disabled'] as const) : [null];
  if (!allowed.includes(reason)) throw unexpected();
  return reason;
}

function summaryOf(row: Row, idKey: string, numberKey: string): AttemptSummary {
  const state = oneOf(row.state, jobStates);
  return {id: uuidOf(row[idKey]), number: numberOf(row[numberKey]), state, stage: stageOf(row.stage), reason: reasonOf(state, row.reason)};
}

// Submit ----------------------------------------------------------------------------------------------------------------------------------------

/** The money a refused submission names: what the request would reserve (null when nothing could be priced), the cap or limit, what is used against it and what is available. */
export type SubmissionCost = {requested: number | null; limit: number; used: number; available: number};

/** The words a refused submission can carry: the refusals of the reservation (Story 2.6), and the permission words of a permissioned provider (Story 2.5). */
export const submissionRefusals = [
  'unavailable_bound',
  'provider_blocked',
  'over_operation_cap',
  'over_job_cap',
  'insufficient_allowance',
  'permission_required',
  'maximum_exceeded',
  'not_reservable',
  'already_reserved',
  'reused',
  'unavailable',
  'denied',
] as const;
export type SubmissionRefusal = (typeof submissionRefusals)[number];

/**
 * What api.submit_job answers.
 *  - `accepted` and `replayed` (the same command sent again: the same Job, one row) carry the Job, its attempt 1 and its outbox row.
 *  - `reused`: the command ID was used for another payload. `denied`: the Account has no authority for this request. `unavailable`: the Project is another Account's, deleted,
 *    unknown or tombstoned. Nothing was written for any of them.
 *  - `at_capacity`: the Account already has `limit` Jobs with an open attempt. Nothing was written.
 *  - `refused`: a planned operation's reservation was refused (`refusal`, the reason of an unavailable bound, and the exact cost block when the refusal has one). NOTHING was written:
 *    no Job, outbox row, operation, reservation or receipt.
 */
export type JobSubmission =
  | {outcome: 'accepted' | 'replayed'; jobId: string; attemptId: string; outboxId: string; attempt: AttemptSummary}
  | {outcome: 'reused' | 'denied' | 'unavailable'}
  | {outcome: 'at_capacity'; open: number; limit: number}
  | {outcome: 'refused'; refusal: SubmissionRefusal; reason: string | null; detail: string | null; cost: SubmissionCost | null};

function submissionCostOf(row: Row): SubmissionCost | null {
  const present = [row.limit_microdollars, row.used_microdollars, row.available_microdollars].map((value) => value !== null && value !== undefined);
  if (present.every((value) => !value)) {
    if (row.requested_microdollars !== null && row.requested_microdollars !== undefined) throw unexpected();
    return null;
  }
  if (!present.every(Boolean)) throw unexpected();
  const requested = row.requested_microdollars === null || row.requested_microdollars === undefined ? null : amountOf(row.requested_microdollars);
  const limit = amountOf(row.limit_microdollars);
  const used = amountOf(row.used_microdollars);
  const available = amountOf(row.available_microdollars);
  return {requested, limit, used, available};
}

/**
 * Commits a `test_workload` Job of a live Project of the Account, its attempt 1 (`waiting`, stage `accepted`), the OUTBOX row that pins the Account's epoch, the Project's
 * revision, the worker version and the plan, and each planned operation with its reservation: all of it in one transaction, or none of it. `inputDigest` is the SHA-256 (hex) of
 * what attempt 1 pins to run on. `plan` says how the workload ends and which operations to reserve and run; `workerVersion` pins the worker it waits for (left out, the built-in
 * step). It dispatches nothing itself: lib/job-dispatch.ts publishes the outbox row, at once and then by the minute sweep.
 */
export async function submitJob(
  operation: Operation,
  input: {commandId: string; projectId: string; inputDigest: string; kind?: typeof testWorkloadKind; plan?: WorkloadPlan; workerVersion?: number | null},
  options: AccountsOptions = {},
): Promise<JobSubmission> {
  if ((input.kind ?? testWorkloadKind) !== testWorkloadKind) throw new TypeError('kind must be test_workload');
  if (typeof input.inputDigest !== 'string' || !digestPattern.test(input.inputDigest)) throw new TypeError('inputDigest must be 64 lower-case hexadecimal characters');
  const workerVersion = input.workerVersion ?? null;
  if (workerVersion !== null && (!Number.isSafeInteger(workerVersion) || workerVersion < 1 || workerVersion > maxInteger)) throw new TypeError('workerVersion must be a positive integer');
  const row = await callRow(
    'submit_job',
    {
      p_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      p_command_id: requireUuid('commandId', input.commandId),
      p_project_id: requireUuid('projectId', input.projectId),
      p_kind: testWorkloadKind,
      p_input_digest: input.inputDigest,
      p_plan: planToWire(input.plan),
      p_worker_version: workerVersion,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['accepted', 'replayed', 'reused', 'denied', 'unavailable', 'at_capacity', 'refused'] as const);
  if (outcome === 'reused' || outcome === 'denied' || outcome === 'unavailable') return {outcome};
  if (outcome === 'at_capacity') {
    const open = numberOf(row.open_jobs, 0);
    const limit = numberOf(row.open_limit);
    // At capacity means the Account holds as many open Jobs as it may.
    if (open < limit) throw unexpected();
    return {outcome, open, limit};
  }
  if (outcome === 'refused') {
    const refusal = oneOf(row.refusal, submissionRefusals);
    const cost = submissionCostOf(row);
    // A refusal about money carries the exact cost block; one about permission or a replay carries none.
    const money = (['unavailable_bound', 'provider_blocked', 'over_operation_cap', 'over_job_cap', 'insufficient_allowance'] as readonly string[]).includes(refusal);
    if (money !== (cost !== null)) throw unexpected();
    const reason = text(row.refusal_reason);
    const detail = text(row.refusal_detail);
    if ((reason !== null && !/^[a-z_]{1,40}$/.test(reason)) || (detail !== null && detail.length > 200)) throw unexpected();
    return {outcome, refusal, reason, detail, cost};
  }
  const attempt = summaryOf(row, 'attempt_id', 'attempt_number');
  // A Job is accepted with its first attempt, waiting at stage accepted. (A replay carries attempt 1 as it is now.)
  if (attempt.number !== 1) throw unexpected();
  if (outcome === 'accepted' && (attempt.state !== 'waiting' || attempt.stage !== 'accepted' || attempt.reason === null)) throw unexpected();
  return {outcome, jobId: uuidOf(row.job_id), attemptId: attempt.id, outboxId: uuidOf(row.outbox_id), attempt};
}

// Cancel ----------------------------------------------------------------------------------------------------------------------------------------

/**
 * What api.cancel_job answers. `cancelled`: the lease ended first, then the attempt moved to `cancelled` / `user_cancelled`; `released` is how many never-dispatched operations
 * had their reservation released. `replayed`: the same command sent again, with the attempt as it is now. `not_cancellable`: the highest attempt is not waiting or running
 * (it carries its state). `reused`, `denied` and `unavailable` wrote nothing.
 */
export type JobCancellation =
  | {outcome: 'cancelled'; jobId: string; attempt: AttemptSummary; released: number}
  | {outcome: 'replayed'; jobId: string; attempt: AttemptSummary}
  | {outcome: 'not_cancellable'; state: JobState}
  | {outcome: 'reused' | 'denied' | 'unavailable'};

/** Cancels a Job whose highest attempt is waiting or running. Commit authority is revoked first (the lease ends), then the attempt moves; held reservations of dispatched operations stay held. */
export async function cancelJob(operation: Operation, input: {commandId: string; jobId: string}, options: AccountsOptions = {}): Promise<JobCancellation> {
  const jobId = requireUuid('jobId', input.jobId);
  const row = await callRow(
    'cancel_job',
    {p_account_id: requireOperation(operation), p_epoch: operation.epoch, p_command_id: requireUuid('commandId', input.commandId), p_job_id: jobId},
    options,
  );
  const outcome = oneOf(row.outcome, ['cancelled', 'replayed', 'reused', 'denied', 'unavailable', 'not_cancellable'] as const);
  if (outcome === 'reused' || outcome === 'denied' || outcome === 'unavailable') return {outcome};
  if (outcome === 'not_cancellable') {
    const state = oneOf(row.state, jobStates);
    if (isOpenState(state)) throw unexpected();
    return {outcome, state};
  }
  const attempt = summaryOf(row, 'attempt_id', 'attempt_number');
  if (uuidOf(row.job_id) !== jobId) throw unexpected();
  if (outcome === 'replayed') return {outcome, jobId, attempt};
  if (attempt.state !== 'cancelled' || attempt.reason !== 'user_cancelled') throw unexpected();
  return {outcome, jobId, attempt, released: numberOf(row.released, 0)};
}

// List and read ---------------------------------------------------------------------------------------------------------------------------------

/** `found`: the Account's Jobs whose Project is live, open ones first and then the newest ended. `denied`: the Account has no authority for this request. */
export type JobListing = {outcome: 'found'; jobs: JobListItem[]} | {outcome: 'denied'};

/** The most Jobs one list asks for, and the default. */
export const maxListedJobs = 200;
export const defaultListedJobs = 50;

function listItemOf(value: unknown): JobListItem {
  const row = rowIn(value);
  const state = oneOf(row.state, jobStates);
  const startedAt = optionalTimeOf(row.started_at);
  const endedAt = optionalTimeOf(row.ended_at);
  const kind = text(row.kind);
  const title = text(row.project_title);
  if (kind === null || !namePattern.test(kind) || title === null) throw unexpected();
  // The times agree with the state: an open attempt has not ended and a finished one has; only a waiting attempt (or one cancelled before it started) has not started.
  if ((endedAt !== null) === isOpenState(state) || (state === 'waiting' && startedAt !== null) || ((state === 'running' || state === 'completed' || state === 'failed') && startedAt === null)) throw unexpected();
  return {
    jobId: uuidOf(row.job_id),
    projectId: uuidOf(row.project_id),
    projectTitle: title,
    kind,
    createdAt: timeOf(row.created_at),
    attemptNumber: numberOf(row.attempt_number),
    state,
    stage: stageOf(row.stage),
    reason: reasonOf(state, row.reason),
    startedAt,
    endedAt,
  };
}

/**
 * Lists the Account's Jobs whose Project is live: open attempts first, then the newest ended (at most `limit`, 50 by default, never more than 200), each with its Project's ID and
 * title, kind, public state, stage and reason (with `awaiting_worker`) and times. One statement reads them, so each Job's state is its highest attempt's.
 */
export async function listJobs(operation: Operation, input: {limit?: number} = {}, options: AccountsOptions = {}): Promise<JobListing> {
  const limit = input.limit ?? defaultListedJobs;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListedJobs) throw new TypeError(`limit must be a whole number from 1 to ${maxListedJobs}`);
  const row = await callRow('list_jobs', {p_account_id: requireOperation(operation), p_epoch: operation.epoch, p_limit: limit}, options);
  const outcome = oneOf(row.outcome, ['found', 'denied'] as const);
  if (outcome === 'denied') return {outcome};
  if (!Array.isArray(row.items) || row.items.length > limit) throw unexpected();
  const jobs = row.items.map(listItemOf);
  // Open Jobs first.
  let seenEnded = false;
  for (const job of jobs) {
    if (!isOpenState(job.state)) seenEnded = true;
    else if (seenEnded) throw unexpected();
  }
  return {outcome, jobs};
}

/** `found`: the Job in full. `denied`: the Account has no authority for this request. `unavailable`: a foreign, deleted, unknown or tombstoned Job or Project. */
export type JobRead = {outcome: 'found'; job: JobDetail} | {outcome: 'denied' | 'unavailable'};

function attemptViewOf(value: unknown): AttemptView {
  const row = rowIn(value);
  const summary = summaryOf(row, 'id', 'number');
  const startedAt = optionalTimeOf(row.started_at);
  const endedAt = optionalTimeOf(row.ended_at);
  const chargeable = wholeNumber(row.chargeable_operations);
  if (chargeable === null) throw unexpected();
  const finished = (finishedJobStates as readonly string[]).includes(summary.state);
  if ((endedAt !== null) !== finished || (summary.state === 'waiting' && startedAt !== null) || ((summary.state === 'running' || summary.state === 'completed' || summary.state === 'failed') && startedAt === null)) throw unexpected();
  return {...summary, createdAt: timeOf(row.created_at), startedAt, endedAt, chargeableOperations: chargeable};
}

function progressOf(value: unknown): JobProgress {
  const row = rowIn(value);
  const progress = {
    steps: amountOf(row.steps),
    stepsBegun: amountOf(row.steps_begun),
    operationsPlanned: amountOf(row.operations_planned),
    operationsCompleted: amountOf(row.operations_completed),
  };
  if (progress.stepsBegun > progress.steps || progress.operationsCompleted > progress.operationsPlanned) throw unexpected();
  return progress;
}

function costOf(value: unknown): JobCost {
  const row = rowIn(value);
  return {held: amountOf(row.held), settled: amountOf(row.settled), released: amountOf(row.released), chargeableOperations: amountOf(row.chargeable_operations)};
}

/** The endings a state can have: what the lease of an attempt in that state recorded (null for one that never held a lease, and for a completed one). */
const endingsOf: Readonly<Record<JobState, readonly (EndingDetail | null)[]>> = {
  waiting: [null],
  running: [null],
  completed: [null],
  failed: ['step_failed', 'stale_revision', 'lease_expired', null],
  cancelled: ['user_cancelled', 'account_disabled', 'revoked_epoch', 'tombstoned', null],
};

/**
 * Reads a Job in full: its public state, stage and reason, whether it can be cancelled and retried, every attempt, its progress (steps begun, operations completed of planned),
 * its cost (microdollars held, settled and released, and how many operations may still be charged) and its ending (why the lease of its highest attempt ended). Nothing else:
 * no input digest, no request ID, no fence. One statement reads all of it, so it comes from one snapshot; it fails closed all the same: an answer that is not shaped like a Job,
 * or whose public state is not its highest attempt's, throws rather than show a state the records do not hold.
 */
export async function readJobDetail(operation: Operation, input: {jobId: string}, options: AccountsOptions = {}): Promise<JobRead> {
  const row = await callRow(
    'read_job_detail',
    {p_account_id: requireOperation(operation), p_epoch: operation.epoch, p_job_id: requireUuid('jobId', input.jobId)},
    options,
  );
  const outcome = oneOf(row.outcome, ['found', 'denied', 'unavailable'] as const);
  if (outcome !== 'found') return {outcome};
  if (!Array.isArray(row.attempts) || row.attempts.length === 0) throw unexpected();
  const attempts = row.attempts.map(attemptViewOf);
  attempts.forEach((attempt, index) => {
    if (attempt.number !== index + 1) throw unexpected();
    if (index < attempts.length - 1 && isOpenState(attempt.state)) throw unexpected();
  });
  const highest = attempts[attempts.length - 1];
  const state = oneOf(row.state, jobStates);
  const stage = stageOf(row.stage);
  const reason = reasonOf(state, row.reason);
  // The Job has no state of its own: its public state IS its highest attempt's.
  if (state !== highest.state || stage !== highest.stage || reason !== highest.reason) throw unexpected();
  if (typeof row.can_cancel !== 'boolean' || row.can_cancel !== isOpenState(state)) throw unexpected();
  if (typeof row.can_retry !== 'boolean' || row.can_retry !== (state === 'failed')) throw unexpected();
  const ending = row.ending === null || row.ending === undefined ? null : oneOf(row.ending, endingDetails);
  if (!endingsOf[state].includes(ending)) throw unexpected();
  const kind = text(row.kind);
  const title = text(row.project_title);
  if (kind === null || !namePattern.test(kind) || title === null) throw unexpected();
  const progress = progressOf(row.progress);
  const cost = costOf(row.cost);
  // What the Job may still be charged for is the sum of what its attempts may.
  if (cost.chargeableOperations !== attempts.reduce((sum, attempt) => sum + attempt.chargeableOperations, 0)) throw unexpected();
  return {
    outcome,
    job: {
      jobId: uuidOf(row.job_id),
      projectId: uuidOf(row.project_id),
      projectTitle: title,
      kind,
      createdAt: timeOf(row.created_at),
      state,
      stage,
      reason,
      canCancel: row.can_cancel,
      canRetry: row.can_retry,
      attempts,
      progress,
      cost,
      ending,
    },
  };
}

// Register a worker -------------------------------------------------------------------------------------------------------------------------------

export const workerIssuers = ['cad-worker', 'engine-worker'] as const;
export type WorkerIssuer = (typeof workerIssuers)[number];

/**
 * What api.register_worker answers. `registered`: a new version is in service and the earlier versions of the same (issuer, worker kind) are retired (`retired` counts them).
 * `replayed`: the same registration again. `superseded`: the version is not above one still in service, or the image is already registered as something else (it carries
 * the version in service).
 */
export type WorkerRegistration = {outcome: 'registered' | 'replayed' | 'superseded'; workerId: string; version: number; retired: number};

export async function registerWorker(
  input: {issuer: WorkerIssuer; workerKind: string; version: number; imageDigest: string; kinds: readonly string[]},
  options: AccountsOptions = {},
): Promise<WorkerRegistration> {
  if (!(workerIssuers as readonly unknown[]).includes(input.issuer)) throw new TypeError('issuer must be cad-worker or engine-worker');
  if (typeof input.workerKind !== 'string' || !namePattern.test(input.workerKind)) throw new TypeError('workerKind must be lower-case letters, digits and underscores');
  if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > maxInteger) throw new TypeError('version must be a positive integer');
  if (typeof input.imageDigest !== 'string' || !digestPattern.test(input.imageDigest)) throw new TypeError('imageDigest must be 64 lower-case hexadecimal characters');
  if (!Array.isArray(input.kinds) || input.kinds.length < 1 || input.kinds.length > 8 || new Set(input.kinds).size !== input.kinds.length || input.kinds.some((kind) => typeof kind !== 'string' || !namePattern.test(kind))) {
    throw new TypeError('kinds must be one to eight different lower-case words');
  }
  const row = await callRow(
    'register_worker',
    {p_issuer: input.issuer, p_worker_kind: input.workerKind, p_version: input.version, p_image_digest: input.imageDigest, p_kinds: [...input.kinds]},
    options,
  );
  const outcome = oneOf(row.outcome, ['registered', 'replayed', 'superseded'] as const);
  const retired = numberOf(row.retired, 0);
  if (outcome !== 'registered' && retired !== 0) throw unexpected();
  return {outcome, workerId: uuidOf(row.worker_id), version: numberOf(row.version), retired};
}

// Claim ---------------------------------------------------------------------------------------------------------------------------------------------

/** What a claimed attempt carries: the fence, when the lease expires, and what the attempt is pinned to. */
export type ClaimedAttempt = {
  attemptId: string;
  jobId: string;
  kind: string;
  fence: string;
  expiresAt: string;
  plan: WorkloadPlan;
  inputDigest: string;
  projectRevision: number;
  accountEpoch: number;
  workerVersion: number;
};

/**
 * What api.claim_attempt answers. `claimed`: the attempt started under a 120-second lease and a fencing token. `replayed`: the same registered worker again (the fence comes
 * back). `already_claimed`: another claimant, or the built-in step again, is too late. `not_waiting` (it carries the state), `blocked` (an earlier operation may still be
 * charged), `waiting_for_worker` (nobody can run the attempt), `incompatible` (the worker is retired, of another version or without the kind), `revoked` (the Account's authority is
 * gone: the attempt is cancelled) and `unavailable` (the attempt is unknown or its Project is not live) start nothing.
 */
export type AttemptClaim =
  | {outcome: 'claimed' | 'replayed'; claim: ClaimedAttempt}
  | {outcome: 'not_waiting'; state: JobState}
  | {outcome: 'already_claimed' | 'blocked' | 'waiting_for_worker' | 'incompatible' | 'revoked' | 'unavailable'};

const planOperationKeys = ['step_key', 'ordinal', 'schedule_id', 'provider', 'model', 'api_version', 'request_bytes', 'image_count', 'output_limit', 'options'];

/** The plan as the outbox holds it (snake_case), read back into the shape the module takes, checked as strictly as the database stores it. */
export function planFromWire(value: unknown): WorkloadPlan {
  const wire = rowIn(value);
  for (const key of Object.keys(wire)) if (key !== 'outcome' && key !== 'operations') throw unexpected();
  const plan: WorkloadPlan = {};
  if (wire.outcome !== undefined) plan.outcome = oneOf(wire.outcome, planOutcomes);
  if (wire.operations !== undefined) {
    if (!Array.isArray(wire.operations) || wire.operations.length > maxPlannedOperations) throw unexpected();
    plan.operations = wire.operations.map((item): PlannedOperation => {
      const operation = rowIn(item);
      for (const key of Object.keys(operation)) if (!planOperationKeys.includes(key)) throw unexpected();
      const stepKey = text(operation.step_key);
      const provider = text(operation.provider);
      const model = text(operation.model);
      const apiVersion = text(operation.api_version);
      if (stepKey === null || !namePattern.test(stepKey) || provider === null || !wordPattern.test(provider) || model === null || !wordPattern.test(model)) throw unexpected();
      if (apiVersion === null || !apiVersionPattern.test(apiVersion)) throw unexpected();
      const ordinal = numberOf(operation.ordinal);
      if (ordinal > maxOperationOrdinal) throw unexpected();
      const options = operation.options === undefined ? undefined : rowIn(operation.options);
      return {
        stepKey,
        ordinal,
        scheduleId: uuidOf(operation.schedule_id),
        provider,
        model,
        apiVersion,
        requestBytes: numberOf(operation.request_bytes, 0),
        imageCount: numberOf(operation.image_count, 0),
        outputLimit: numberOf(operation.output_limit, 0),
        ...(options === undefined ? {} : {options}),
      };
    });
  }
  return plan;
}

/**
 * Claims a waiting attempt ONCE, as the built-in step (`workerId` left out) or as a registered worker. The epoch is the one bound in the attempt's outbox row; the caller names
 * neither an Account nor an epoch. A finished attempt is never reclaimed. `issuer` is the issuer of the token that signed the claim (the signed endpoint always passes the verified
 * one): a registered worker that belongs to another issuer is `incompatible`, so a worker's ID cannot be used by a key that is not its own.
 */
export async function claimAttempt(input: {attemptId: string; workerId?: string | null; issuer?: WorkerIssuer | null}, options: AccountsOptions = {}): Promise<AttemptClaim> {
  const attemptId = requireUuid('attemptId', input.attemptId);
  const workerId = input.workerId === undefined || input.workerId === null ? null : requireUuid('workerId', input.workerId);
  const issuer = input.issuer ?? null;
  if (issuer !== null && !(workerIssuers as readonly unknown[]).includes(issuer)) throw new TypeError('issuer must be cad-worker or engine-worker');
  const row = await callRow('claim_attempt', {p_attempt_id: attemptId, p_worker_id: workerId, p_issuer: issuer}, options);
  const outcome = oneOf(row.outcome, ['claimed', 'replayed', 'already_claimed', 'not_waiting', 'blocked', 'waiting_for_worker', 'incompatible', 'revoked', 'unavailable'] as const);
  if (outcome === 'not_waiting') {
    const state = oneOf(row.state, jobStates);
    if (state === 'waiting') throw unexpected();
    return {outcome, state};
  }
  if (outcome !== 'claimed' && outcome !== 'replayed') return {outcome};
  // A replay is only ever answered to a registered worker, and a claim starts the attempt.
  if (outcome === 'replayed' && workerId === null) throw unexpected();
  if (uuidOf(row.attempt_id) !== attemptId) throw unexpected();
  if (outcome === 'claimed' && oneOf(row.state, jobStates) !== 'running') throw unexpected();
  const kind = text(row.kind);
  const inputDigest = text(row.input_digest);
  if (kind === null || !namePattern.test(kind) || inputDigest === null || !digestPattern.test(inputDigest)) throw unexpected();
  return {
    outcome,
    claim: {
      attemptId,
      jobId: uuidOf(row.job_id),
      kind,
      fence: uuidOf(row.fence),
      expiresAt: timeOf(row.expires_at),
      plan: planFromWire(row.plan),
      inputDigest,
      projectRevision: numberOf(row.project_revision),
      accountEpoch: numberOf(row.account_epoch),
      workerVersion: numberOf(row.worker_version),
    },
  };
}

// The fenced commands ---------------------------------------------------------------------------------------------------------------------------

/**
 * The refusals every fenced command can answer, in the order the database checks them: `fence_mismatch` (the fence is not this attempt's lease), `cancelled`, `expired` and
 * `revoked` (the lease ended that way, or has run out), `not_running` (the attempt is not running), `revoked` again when the authority of the epoch the attempt is bound to is gone
 * (the lease is ended and the attempt cancelled first), and `unavailable` (the Project is not live). Nothing was published.
 */
export const fenceRefusals = ['fence_mismatch', 'cancelled', 'expired', 'revoked', 'not_running', 'unavailable'] as const;
export type FenceRefusal = (typeof fenceRefusals)[number];

function fencedBody(input: {attemptId: string; fence: string}) {
  return {p_attempt_id: requireUuid('attemptId', input.attemptId), p_fence: requireUuid('fence', input.fence)};
}

/** `renewed` carries the new expiry, 120 seconds from now. An expired lease is never renewed. */
export type LeaseRenewal = {outcome: 'renewed'; expiresAt: string} | {outcome: FenceRefusal};

export async function renewLease(input: {attemptId: string; fence: string}, options: AccountsOptions = {}): Promise<LeaseRenewal> {
  const row = await callRow('renew_lease', fencedBody(input), options);
  const outcome = oneOf(row.outcome, ['renewed', ...fenceRefusals] as const);
  if (outcome !== 'renewed') return {outcome};
  return {outcome, expiresAt: timeOf(row.expires_at)};
}

/**
 * What api.run_step answers: `stepped` (the step was begun and, when the ordinal names a planned, reserved operation, the operation was dispatched), `replayed` (it already was),
 * `not_planned` (the ordinal names no planned, reserved operation of the step: nothing was made), or a fence refusal.
 */
export type StepRun =
  | {outcome: 'stepped' | 'replayed'; stepId: string; operationId: string | null; operationState: string | null}
  | {outcome: 'not_planned' | FenceRefusal};

export async function runStep(input: {attemptId: string; fence: string; stepKey: string; ordinal?: number | null}, options: AccountsOptions = {}): Promise<StepRun> {
  if (typeof input.stepKey !== 'string' || !namePattern.test(input.stepKey)) throw new TypeError('stepKey must be lower-case letters, digits and underscores');
  const ordinal = input.ordinal ?? null;
  if (ordinal !== null && (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > maxOperationOrdinal)) throw new TypeError('ordinal must be a whole number from 1 to 100');
  const row = await callRow('run_step', {...fencedBody(input), p_step_key: input.stepKey, p_ordinal: ordinal}, options);
  const outcome = oneOf(row.outcome, ['stepped', 'replayed', 'not_planned', ...fenceRefusals] as const);
  if (outcome !== 'stepped' && outcome !== 'replayed') return {outcome};
  const operationId = optionalUuidOf(row.operation_id);
  // An operation comes back exactly when an ordinal was asked for.
  if ((operationId === null) !== (ordinal === null)) throw unexpected();
  const operationState = row.operation_state === null || row.operation_state === undefined ? null : text(row.operation_state);
  if ((operationState === null) !== (operationId === null)) throw unexpected();
  return {outcome, stepId: uuidOf(row.step_id), operationId, operationState};
}

/** What the outcome of an operation settled: the amounts of its settlement, or none when the operation holds no reservation. */
export type OperationSettlement = {settledMicrodollars: number; releasedMicrodollars: number; overMicrodollars: number} | null;

/**
 * What api.finish_operation answers: `finished` (the outcome is recorded and, when the operation holds a reservation, settled; an `ambiguous` outcome settles nothing and keeps the
 * whole reservation held), `not_found` (not an operation of this attempt), `not_dispatched` (it is still planned), `invalid_transition` (it is in a state that cannot take this
 * outcome), `already_settled`, `invalid_evidence` and `overflow` (the settlement was refused and the outcome undone: the caller reports the operation `ambiguous` instead), or a fence
 * refusal. A second report for an operation that has finished answers one of these words; it never raises.
 */
export type OperationFinish =
  | {outcome: 'finished'; operationId: string; state: string; settlement: OperationSettlement}
  | {outcome: 'not_found' | 'not_dispatched' | 'invalid_transition' | 'already_settled' | 'invalid_evidence' | 'overflow' | FenceRefusal};

/** A completed operation's usage, as the provider reported it. */
export type OperationUsage = {inputTokens: number; outputTokens: number; returnedModel: string};

/**
 * Records the outcome of a dispatched operation under the attempt's fence. `completed` (with the usage) moves the operation and settles it as evidence: the calculator prices the
 * usage and the unused remainder of the reservation is released. `noncharge` (with the provider's request ID) moves it and settles it noncharge. `ambiguous` (the provider's request
 * ID is optional) moves it to `ambiguous`, settles nothing and keeps the whole reservation held until evidence, a proven noncharge or the 24-hour deadline (Story 2.8).
 */
export async function finishOperation(
  input: {attemptId: string; fence: string; operationId: string} & (
    | {outcome: 'completed'; usage: OperationUsage}
    | {outcome: 'noncharge'; requestId: string}
    | {outcome: 'ambiguous'; requestId?: string | null}
  ),
  options: AccountsOptions = {},
): Promise<OperationFinish> {
  const operationId = requireUuid('operationId', input.operationId);
  let usage: Row = {p_input_tokens: null, p_output_tokens: null, p_returned_model: null, p_request_id: null};
  if (input.outcome === 'completed') {
    if (!input.usage || typeof input.usage.returnedModel !== 'string' || !returnedModelPattern.test(input.usage.returnedModel)) throw new TypeError('returnedModel must be 1 to 200 printable ASCII characters without spaces');
    usage = {p_input_tokens: requireSize('inputTokens', input.usage.inputTokens, maxBigint), p_output_tokens: requireSize('outputTokens', input.usage.outputTokens, maxBigint), p_returned_model: input.usage.returnedModel, p_request_id: null};
  } else if (input.outcome === 'noncharge') {
    if (typeof input.requestId !== 'string' || !requestIdPattern.test(input.requestId)) throw new TypeError('requestId must be 1 to 200 printable ASCII characters without spaces');
    usage = {...usage, p_request_id: input.requestId};
  } else if (input.outcome === 'ambiguous') {
    const requestId = input.requestId ?? null;
    if (requestId !== null && (typeof requestId !== 'string' || !requestIdPattern.test(requestId))) throw new TypeError('requestId must be 1 to 200 printable ASCII characters without spaces');
    usage = {...usage, p_request_id: requestId};
  } else {
    throw new TypeError('outcome must be completed, noncharge or ambiguous');
  }
  const row = await callRow('finish_operation', {...fencedBody(input), p_operation_id: operationId, p_outcome: input.outcome, ...usage}, options);
  const outcome = oneOf(row.outcome, ['finished', 'not_found', 'not_dispatched', 'invalid_transition', 'already_settled', 'invalid_evidence', 'overflow', ...fenceRefusals] as const);
  if (outcome !== 'finished') return {outcome};
  const state = text(row.state);
  if (state === null || uuidOf(row.operation_id) !== operationId) throw unexpected();
  // The operation is in the state that was reported, except that a report sent again after the operation has been reconciled finds it `settled` (an ambiguous one) and the like.
  if (input.outcome !== 'ambiguous' && state !== input.outcome) throw unexpected();
  if (input.outcome === 'ambiguous' && !operationStateWords.includes(state)) throw unexpected();
  const settled = row.settled_microdollars;
  let settlement: OperationSettlement = null;
  if (settled !== null && settled !== undefined) {
    settlement = {settledMicrodollars: amountOf(settled), releasedMicrodollars: amountOf(row.released_microdollars), overMicrodollars: amountOf(row.over_microdollars)};
  } else if ([row.released_microdollars, row.over_microdollars].some((value) => value !== null && value !== undefined)) {
    throw unexpected();
  }
  return {outcome, operationId, state, settlement};
}

// Reconciling an operation whose outcome was unknown (Story 2.8) ---------------------------------------------------------------------------------------

/** The words a refused settlement answers inside a reconciliation. */
export const reconcileRefusals = ['already_settled', 'invalid_evidence', 'overflow', 'not_reserved', 'not_settleable', 'not_due', 'reused'] as const;
export type ReconcileRefusal = (typeof reconcileRefusals)[number];

/** Why evidence was refused as `invalid_evidence`: it prices above the largest amount (`overflow`), or it names a model other than the one the reservation pinned (`model_mismatch`). */
export const reconcileReasons = ['overflow', 'model_mismatch'] as const;
export type ReconcileReason = (typeof reconcileReasons)[number];

/** The evidence that reconciles an operation, or the proof that it was never charged. */
export type ReconcileInput = {operationId: string} & (
  | {outcome: 'evidence'; usage: OperationUsage; requestId?: string | null}
  | {outcome: 'noncharge'; requestId: string}
);

/** What a reconciliation booked: the settlement (or, for late evidence, the correction) and what it changed. */
export type ReconcileBooking = {
  settlementId: string;
  classification: 'evidence' | 'deadline' | 'noncharge';
  settledMicrodollars: number;
  releasedMicrodollars: number;
  /** How far the evidence was above the reservation (an incident was opened), else 0. */
  overMicrodollars: number;
  incidentId: string | null;
  /** The correction a late evidence appended, with its signed settled delta (evidence minus the amount the deadline settled); null for a first settlement. */
  correctionId: string | null;
  deltaMicrodollars: number | null;
};

/**
 * What api.reconcile_operation answers.
 *  - `reconciled`: an ambiguous operation was settled at the evidence (or as a proven noncharge) and moved to `settled` (or `noncharge`), which opens the gate for a waiting retry.
 *  - `corrected`: late evidence after a deadline booking appended ONE correction; the settlement was not edited.
 *  - `replayed`: the same report again.
 *  - `not_reconcilable`: the operation is planned, dispatched or abandoned, or is past an outcome this report cannot change (it carries the state).
 *  - `unavailable`: no such operation. Or the refusal of the settlement (the operation stays as it was): see `reconcileRefusals`. A refusal carries the state the operation is in
 *    and, for `invalid_evidence`, the database's `reason` (see `reconcileReasons`); it is null for every other word.
 */
export type OperationReconciliation =
  | ({outcome: 'reconciled' | 'corrected' | 'replayed'; operationId: string; state: string} & ReconcileBooking)
  | {outcome: 'not_reconcilable'; operationId: string; state: string}
  | {outcome: 'unavailable'}
  | {outcome: ReconcileRefusal; operationId: string; state: string; reason: ReconcileReason | null};

const isReconcileRefusal = (word: string): word is ReconcileRefusal => (reconcileRefusals as readonly string[]).includes(word);

function signedAmountOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw unexpected();
  return value;
}

/**
 * Reconciles an operation that went out with an unknown outcome, with no Account authority (it records what already happened): an `ambiguous` operation with `evidence` settles at
 * the evidence (the remainder released) and becomes `settled`; with a proven `noncharge` (the provider's request ID is required) it becomes `noncharge` and settles 0; an
 * operation the deadline settled that gets `evidence` appends one correction. The same report again is `replayed`. It makes no request of any kind to a provider.
 */
export async function reconcileOperation(input: ReconcileInput, options: AccountsOptions = {}): Promise<OperationReconciliation> {
  const operationId = requireUuid('operationId', input.operationId);
  let body: Row;
  if (input.outcome === 'evidence') {
    if (!input.usage || typeof input.usage.returnedModel !== 'string' || !returnedModelPattern.test(input.usage.returnedModel)) throw new TypeError('returnedModel must be 1 to 200 printable ASCII characters without spaces');
    const requestId = input.requestId ?? null;
    if (requestId !== null && (typeof requestId !== 'string' || !requestIdPattern.test(requestId))) throw new TypeError('requestId must be 1 to 200 printable ASCII characters without spaces');
    body = {
      p_input_tokens: requireSize('inputTokens', input.usage.inputTokens, maxBigint),
      p_output_tokens: requireSize('outputTokens', input.usage.outputTokens, maxBigint),
      p_returned_model: input.usage.returnedModel,
      p_request_id: requestId,
    };
  } else if (input.outcome === 'noncharge') {
    if (typeof input.requestId !== 'string' || !requestIdPattern.test(input.requestId)) throw new TypeError('requestId must be 1 to 200 printable ASCII characters without spaces');
    body = {p_input_tokens: null, p_output_tokens: null, p_returned_model: null, p_request_id: input.requestId};
  } else {
    throw new TypeError('outcome must be evidence or noncharge');
  }
  const row = await callRow('reconcile_operation', {p_operation_id: operationId, p_outcome: input.outcome, ...body}, options);
  const outcome = oneOf(row.outcome, ['reconciled', 'corrected', 'replayed', 'not_reconcilable', 'unavailable', ...reconcileRefusals] as const);
  if (outcome === 'unavailable') return {outcome};
  const state = text(row.state);
  if (state === null || !operationStateWords.includes(state) || uuidOf(row.operation_id) !== operationId) throw unexpected();
  // The database's reason travels with the word: only an `invalid_evidence` has one, and it is one of the two it knows.
  const reason = row.reason === null || row.reason === undefined ? null : oneOf(row.reason, reconcileReasons);
  if (reason !== null && outcome !== 'invalid_evidence') throw unexpected();
  if (outcome === 'not_reconcilable') return {outcome, operationId, state};
  if (isReconcileRefusal(outcome)) return {outcome, operationId, state, reason};
  const classification = oneOf(row.classification, ['evidence', 'deadline', 'noncharge'] as const);
  const settled = amountOf(row.settled_microdollars);
  const released = amountOf(row.released_microdollars);
  const over = amountOf(row.over_microdollars);
  const incidentId = optionalUuidOf(row.incident_id);
  const correctionId = optionalUuidOf(row.correction_id);
  const delta = row.delta_microdollars === null || row.delta_microdollars === undefined ? null : signedAmountOf(row.delta_microdollars);
  if ((correctionId === null) !== (delta === null)) throw unexpected();
  if (correctionId === null) {
    // A settlement: the over amount is exactly what it is above the whole reservation it released, and it is the only thing that makes an incident.
    if (over !== Math.max(settled - released, 0) || (over > 0) !== (incidentId !== null)) throw unexpected();
  } else {
    // A correction of a deadline booking: the booking is untouched, the delta is the evidence minus it, and only a positive delta makes an incident.
    if (classification !== 'deadline' || settled !== released || over !== Math.max(delta!, 0) || (over > 0) !== (incidentId !== null)) throw unexpected();
  }
  if (outcome === 'corrected' && correctionId === null) throw unexpected();
  if (outcome === 'reconciled' && correctionId !== null) throw unexpected();
  return {
    outcome,
    operationId,
    state,
    settlementId: uuidOf(row.settlement_id),
    classification,
    settledMicrodollars: settled,
    releasedMicrodollars: released,
    overMicrodollars: over,
    incidentId,
    correctionId,
    deltaMicrodollars: delta,
  };
}

/**
 * What api.finish_attempt answers. `finished`: the lease ended (`completed`, or `failed` with the cause `step_failed`) and the attempt moved. `replayed`: the same finish again.
 * `rejected`: the Project's revision is no longer the one the attempt is bound to, so the result is refused (the lease ended `revoked` with the cause `stale_revision`, the attempt
 * failed `step_failed`). `open_operations`: an operation is still planned, dispatched or ambiguous. Or a fence refusal. Nothing is published but by `finished` and `replayed`.
 *
 * A worker names, with `revision`, the Project revision its result was computed from (the signed `rev` claim): a completion whose revision is not the one the attempt is bound to is
 * `rejected` exactly as one whose Project has moved on. A `failed` finish ignores it. The built-in step passes none.
 */
export type AttemptFinish =
  | {outcome: 'finished' | 'replayed' | 'rejected'; attempt: Omit<AttemptSummary, 'id' | 'number'>; detail: EndingDetail | null}
  | {outcome: 'open_operations' | FenceRefusal};

export async function finishAttempt(
  input: {attemptId: string; fence: string; to: 'completed' | 'failed'; resultDigest?: string | null; revision?: number | null},
  options: AccountsOptions = {},
): Promise<AttemptFinish> {
  if (input.to !== 'completed' && input.to !== 'failed') throw new TypeError('to must be completed or failed');
  const revision = input.revision ?? null;
  if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) throw new TypeError('revision must be a positive integer');
  const resultDigest = input.resultDigest ?? null;
  if (input.to === 'completed' && (resultDigest === null || !digestPattern.test(resultDigest))) throw new TypeError('a completed attempt needs a resultDigest of 64 lower-case hexadecimal characters');
  if (input.to === 'failed' && resultDigest !== null) throw new TypeError('a failed attempt has no resultDigest');
  const row = await callRow('finish_attempt', {...fencedBody(input), p_to: input.to, p_result_digest: resultDigest, p_revision: revision}, options);
  const outcome = oneOf(row.outcome, ['finished', 'replayed', 'rejected', 'open_operations', ...fenceRefusals] as const);
  if (outcome === 'open_operations' || (fenceRefusals as readonly string[]).includes(outcome)) return {outcome: outcome as 'open_operations' | FenceRefusal};
  const state = oneOf(row.state, jobStates);
  const detail = row.detail === null || row.detail === undefined ? null : oneOf(row.detail, endingDetails);
  if (outcome === 'finished' && (state !== input.to || (input.to === 'failed' && detail !== 'step_failed'))) throw unexpected();
  if (outcome === 'rejected' && (state !== 'failed' || detail !== 'stale_revision' || input.to !== 'completed')) throw unexpected();
  return {outcome: outcome as 'finished' | 'replayed' | 'rejected', attempt: {state, stage: stageOf(row.stage), reason: reasonOf(state, row.reason)}, detail};
}

// The signed callbacks ---------------------------------------------------------------------------------------------------------------------------

/** What api.record_callback answers: `recorded` (the command may run), `duplicate` (this `jti` was accepted before) or `revoked` (the key is revoked). */
export type CallbackRecord = {outcome: 'recorded' | 'duplicate' | 'revoked'};

/** Records a signed worker command after the route has verified its token: the key ID, the token's `jti` and type, the command, the attempt it is about and the digest of the body. */
export async function recordCallback(
  input: {jti: string; issuer: WorkerIssuer; kid: string; typ: string; command: string; attemptId: string | null; digest: string},
  options: AccountsOptions = {},
): Promise<CallbackRecord> {
  if (typeof input.jti !== 'string' || !jtiPattern.test(input.jti)) throw new TypeError('jti must be 128 bits in base64url');
  if (!(workerIssuers as readonly unknown[]).includes(input.issuer)) throw new TypeError('issuer must be cad-worker or engine-worker');
  if (typeof input.kid !== 'string' || !kidPattern.test(input.kid)) throw new TypeError('kid must be a key ID');
  if (typeof input.typ !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(input.typ)) throw new TypeError('typ must be a lower-case word');
  if (!['register', 'claim', 'renew', 'step', 'operation', 'finish'].includes(input.command)) throw new TypeError('command must be a worker command');
  if (typeof input.digest !== 'string' || !digestPattern.test(input.digest)) throw new TypeError('digest must be 64 lower-case hexadecimal characters');
  const row = await callRow(
    'record_callback',
    {
      p_jti: input.jti,
      p_issuer: input.issuer,
      p_kid: input.kid,
      p_typ: input.typ,
      p_command: input.command,
      p_attempt_id: input.attemptId === null ? null : requireUuid('attemptId', input.attemptId),
      p_digest: input.digest,
    },
    options,
  );
  return {outcome: oneOf(row.outcome, ['recorded', 'duplicate', 'revoked'] as const)};
}

// The outbox ---------------------------------------------------------------------------------------------------------------------------------------

/** An outbox row leased to the publisher: what to publish (the attempt) and what the publication is recorded under (the row's ID). */
export type OutboxRow = {id: string; attemptId: string; jobId: string; kind: string; createdAt: string};

/** The most rows one claim leases. */
export const maxOutboxClaim = 100;
export const defaultOutboxClaim = 20;

/**
 * Leases for publishing (60 seconds) the unpublished outbox rows older than 15 seconds whose lease is free, or, with `outboxId`, that one row at any age. Two publishers never take
 * the same row; a published row is never offered again.
 */
export async function claimOutbox(input: {limit?: number; outboxId?: string | null} = {}, options: AccountsOptions = {}): Promise<OutboxRow[]> {
  const limit = input.limit ?? defaultOutboxClaim;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxOutboxClaim) throw new TypeError(`limit must be a whole number from 1 to ${maxOutboxClaim}`);
  const outboxId = input.outboxId === undefined || input.outboxId === null ? null : requireUuid('outboxId', input.outboxId);
  const row = await callRow('claim_outbox', {p_limit: limit, p_outbox_id: outboxId}, options);
  const claimed = numberOf(row.claimed, 0);
  if (!Array.isArray(row.items) || row.items.length !== claimed || claimed > limit || (outboxId !== null && claimed > 1)) throw unexpected();
  return row.items.map((value: unknown) => {
    const item = rowIn(value);
    const kind = text(item.kind);
    if (kind === null || !namePattern.test(kind)) throw unexpected();
    const id = uuidOf(item.id);
    if (outboxId !== null && id !== outboxId) throw unexpected();
    return {id, attemptId: uuidOf(item.attempt_id), jobId: uuidOf(item.job_id), kind, createdAt: timeOf(item.created_at)};
  });
}

/** `marked`: the message ID is now the row's. `replayed`: the row already holds this message ID. `conflict`: it holds another one (returned), and nothing changed. */
export type PublicationMark = {outcome: 'marked' | 'replayed'; messageId: string} | {outcome: 'conflict'; messageId: string};

/** Records the message ID of a published row, once. */
export async function markPublished(input: {outboxId: string; messageId: string}, options: AccountsOptions = {}): Promise<PublicationMark> {
  if (typeof input.messageId !== 'string' || !messageIdPattern.test(input.messageId)) throw new TypeError('messageId must be 1 to 200 printable ASCII characters without spaces');
  const row = await callRow('mark_published', {p_outbox_id: requireUuid('outboxId', input.outboxId), p_message_id: input.messageId}, options);
  const outcome = oneOf(row.outcome, ['marked', 'replayed', 'conflict'] as const);
  const messageId = text(row.message_id);
  if (messageId === null || !messageIdPattern.test(messageId)) throw unexpected();
  // A mark or a replay is the message ID that was given.
  if (outcome !== 'conflict' && messageId !== input.messageId) throw unexpected();
  if (outcome === 'conflict' && messageId === input.messageId) throw unexpected();
  return {outcome, messageId};
}

// The sweep and the cancellation on disable ------------------------------------------------------------------------------------------------------------

/**
 * What one sweep did: leases it ended (their attempts failed as `lease_lost`), attempts it cancelled (a disabled Account or a moved epoch), reservations it released, dispatched
 * operations of ended attempts it marked `ambiguous` (the 24-hour clock started), ambiguous operations it settled at their deadline (and moved to `settled`), and operations it
 * could not move or settle and skipped (`failed`: each in its own sub-block, so the others still went on). Story 2.8 added the last three.
 */
export type AttemptSweep = {expired: number; cancelled: number; settled: number; marked: number; reconciled: number; failed: number};

/** The database half of the minute sweep. Safe to run twice or at once: each lease is ended once, each attempt cancelled once, each reservation released once, each deadline settled once. */
export async function sweepAttempts(options: AccountsOptions = {}): Promise<AttemptSweep> {
  const row = await callRow('sweep_attempts', {}, options);
  return {
    expired: numberOf(row.expired, 0),
    cancelled: numberOf(row.cancelled, 0),
    settled: numberOf(row.settled, 0),
    marked: numberOf(row.marked, 0),
    reconciled: numberOf(row.reconciled, 0),
    failed: numberOf(row.failed, 0),
  };
}

/** How many open attempts of the Account were cancelled and how many reservations were released. A second call finds nothing and cancels nothing. */
export type AccountCancellation = {cancelled: number; settled: number};

/**
 * Cancels every open attempt of an Account with no authority check (the Account is disabled, so the authority is already gone): each lease is revoked first, each attempt
 * cancelled `account_disabled`, what never went out is released and what was dispatched stays held. Writes ONE audit event, `jobs.cancelled`, when it cancelled any.
 */
export async function cancelAccountJobs(input: {accountId: string}, options: AccountsOptions = {}): Promise<AccountCancellation> {
  const row = await callRow('cancel_account_jobs', {p_account_id: requireUuid('accountId', input.accountId)}, options);
  return {cancelled: numberOf(row.cancelled, 0), settled: numberOf(row.settled, 0)};
}
