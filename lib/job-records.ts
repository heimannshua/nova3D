// Story 2.11. The application side of Jobs: typed calls to the six `api` functions that record a Job, its attempts, its steps and their external operations
// (accept a Job, begin a step, advance an operation, move an attempt, request a retry, read a Job) with the service role. This is the ONLY module that
// calls them (tests/unit/gate-structure.test.ts pins it), and it is one of the few that use the call helpers of lib/accounts.ts. NOTHING CALLS THIS MODULE YET,
// as nothing but the tests calls lib/project-target.ts: Story 2.6 reserves a cost against an operation, Story 2.7 accepts a Job and runs it, Story 2.8
// reconciles an ambiguous charge. They build on the identities and the guarded states recorded here.
//
// SERVER-ONLY (it imports lib/accounts.ts, which holds the service-role key and refuses to load in a browser).
//
// The model, in the words of docs/authority-contract.md ("Jobs"):
//   Job -> attempt -> step -> operation. A Job has NO state of its own: its state, stage and reason are its highest attempt's. A step is unique by (attempt, step
//   key) and an operation by (step, ordinal), so a duplicate command finds the record that exists and never makes another. A user retry makes the next attempt
//   under the same Job and it does not start while an operation of an earlier attempt is still potentially chargeable (`dispatched` or `ambiguous`); that wait is
//   the database's, at the one move that could bypass it, and no attempt number or Account allowance gets past it.
//
// Every call names the Account and its authorization epoch, both from the verified access (`operationOf`, lib/authority.ts), never from a request; the database
// begins every function with `identity.assert_operation_authority`, so a disabled or deleted Account and a stale epoch are answered `denied`. A Job, attempt,
// step or operation of another Account's, of a deleted Project, or an unknown one is `unavailable`: ONE answer with nothing in it.
//
// A command ID names ONE command: sent again with the same payload it answers the original records (`replayed`); with another payload it is `reused`. If a call
// throws an AccountsUnavailableError with `outcomeUnknown`, the command may or may not have been made: send the SAME command ID again, which is safe.
//
// Nothing here logs. An error that comes out of the database layer names the call and the HTTP status, never an ID.
import {callRow, oneOf, requireUuid, unexpected, type AccountsOptions, type Row} from '@/lib/accounts';
import type {Operation} from '@/lib/authority';

// The vocabularies ---------------------------------------------------------------------------------------------------------------------------

/** The states of an attempt, and so the public states of a Job. */
export const jobStates = ['waiting', 'running', 'completed', 'failed', 'cancelled'] as const;
export type JobState = (typeof jobStates)[number];
/** The states an attempt never leaves. */
export const finishedJobStates = ['completed', 'failed', 'cancelled'] as const;

/** The reasons the database STORES: why an attempt failed or was cancelled. */
export const storedReasons = ['step_failed', 'lease_lost', 'user_cancelled', 'account_disabled'] as const;
export type StoredReason = (typeof storedReasons)[number];
/** Why a waiting attempt waits. DERIVED each time it is read, never stored: `awaiting_reconciliation` while an earlier operation is potentially chargeable. */
export const waitingReasons = ['awaiting_dispatch', 'awaiting_reconciliation'] as const;
export type WaitingReason = (typeof waitingReasons)[number];
/** Every reason a Job or an attempt can show. */
export const jobReasons = [...waitingReasons, ...storedReasons] as const;
export type JobReason = (typeof jobReasons)[number];
/** The reasons a failed attempt can carry, and the reasons a cancelled one can. */
export const failureReasons = ['step_failed', 'lease_lost'] as const;
export const cancellationReasons = ['user_cancelled', 'account_disabled'] as const;

/** The stages the records set themselves: `accepted` at attempt 1, `retry` at a later attempt, `started` when it starts. Any other stage is a step key. */
export const fixedStages = ['accepted', 'retry', 'started'] as const;
/** What a stage, a step key and a Job kind look like. */
export const namePattern = /^[a-z][a-z0-9_]{0,39}$/;

/** The states of an external operation. */
export const operationStates = ['planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned'] as const;
export type OperationState = (typeof operationStates)[number];
/** Potentially chargeable: the dispatch was recorded and no outcome has reconciled it. */
export const chargeableOperationStates = ['dispatched', 'ambiguous'] as const;

/** Whether an operation in this state may still be charged for: it was dispatched and its outcome is not terminal, reconciled or classified noncharge. */
export function isChargeable(state: OperationState): boolean {
  return (chargeableOperationStates as readonly string[]).includes(state);
}

/** The most operations a step can carry, and what a provider request ID looks like (printable ASCII without spaces). */
export const maxOperationOrdinal = 100;
export const requestIdPattern = /^[!-~]{1,200}$/;
const digestPattern = /^[0-9a-f]{64}$/;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;

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

function numberOf(value: unknown): number {
  const number = wholeNumber(value);
  if (number === null || number < 1) throw unexpected();
  return number;
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

/** The state, stage and reason of an attempt as the database answered, with the reason checked against the state: only a waiting attempt shows a derived reason. */
function attemptFacts(state: JobState, stage: string, reason: unknown): JobReason | null {
  const value = reason === null || reason === undefined ? null : oneOf(reason, jobReasons);
  const allowed: readonly (JobReason | null)[] =
    state === 'waiting' ? waitingReasons : state === 'failed' ? failureReasons : state === 'cancelled' ? cancellationReasons : [null];
  if (!allowed.includes(value)) throw unexpected();
  if (!namePattern.test(stage)) throw unexpected();
  return value;
}

/** An attempt as a command answers about it. */
export type AttemptSummary = {id: string; number: number; state: JobState; stage: string; reason: JobReason | null};

function summaryOf(row: Row, idKey: string, numberKey: string): AttemptSummary {
  const state = oneOf(row.state, jobStates);
  const stage = stageOf(row.stage);
  return {id: uuidOf(row[idKey]), number: numberOf(row[numberKey]), state, stage, reason: attemptFacts(state, stage, row.reason)};
}

const denialOutcomes = ['denied', 'unavailable'] as const;

// Accept ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * What api.accept_job answers. `created` and `replayed` (the same command sent again: the same Job, one row) carry the Job and its attempt 1. `reused`: the command
 * ID was used for another payload; nothing was written. `denied`: the Account has no authority for this request. `unavailable`: the Project is another Account's,
 * deleted, unknown or deleted-for-good; nothing was written.
 */
export type JobAcceptance =
  | {outcome: 'created' | 'replayed'; jobId: string; attempt: AttemptSummary}
  | {outcome: 'reused' | 'denied' | 'unavailable'};

/**
 * Creates a Job of a live Project of the Account and its attempt 1: `waiting`, stage `accepted`, reason `awaiting_dispatch`. It reserves nothing, dispatches
 * nothing and starts nothing: reservation, dispatch and execution are Stories 2.6 and 2.7. `inputDigest` is the SHA-256 (hex) of what attempt 1 pins to run on.
 */
export async function acceptJob(
  operation: Operation,
  input: {commandId: string; projectId: string; kind: string; inputDigest: string},
  options: AccountsOptions = {},
): Promise<JobAcceptance> {
  if (typeof input.kind !== 'string' || !namePattern.test(input.kind)) throw new TypeError('kind must be lower-case letters, digits and underscores');
  if (typeof input.inputDigest !== 'string' || !digestPattern.test(input.inputDigest)) throw new TypeError('inputDigest must be 64 lower-case hexadecimal characters');
  const row = await callRow(
    'accept_job',
    {
      p_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      p_command_id: requireUuid('commandId', input.commandId),
      p_project_id: requireUuid('projectId', input.projectId),
      p_kind: input.kind,
      p_input_digest: input.inputDigest,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['created', 'replayed', 'reused', 'denied', 'unavailable'] as const);
  if (outcome === 'reused' || outcome === 'denied' || outcome === 'unavailable') return {outcome};
  const attempt = summaryOf(row, 'attempt_id', 'attempt_number');
  // A Job is accepted with its first attempt. (A replay carries attempt 1 as it is now, so only its number is fixed.)
  if (attempt.number !== 1) throw unexpected();
  if (outcome === 'created' && (attempt.state !== 'waiting' || attempt.stage !== 'accepted' || attempt.reason !== 'awaiting_dispatch')) throw unexpected();
  return {outcome, jobId: uuidOf(row.job_id), attempt};
}

// Begin a step -----------------------------------------------------------------------------------------------------------------------------------

/**
 * What api.begin_step answers. `created`: a step (and with an ordinal its `planned` operation) was made. `replayed`: it already existed, or this command ID made
 * it, and nothing was made now; the IDs are the original ones, whatever the attempt's state. Both carry `operationId` (null without an ordinal) and the attempt's
 * state. `not_running`: the attempt is not `running` (it carries its state) and the step does not exist: nothing was made.
 */
export type StepBeginning =
  | {outcome: 'created' | 'replayed'; stepId: string; operationId: string | null; attemptState: JobState}
  | {outcome: 'not_running'; attemptState: JobState}
  | {outcome: 'reused' | 'denied' | 'unavailable'};

/**
 * Records a logical step of a RUNNING attempt, unique by attempt and step key, and with an ordinal the `planned` operation of the step, unique by step and
 * ordinal (1 to 100). Records that exist are returned and never recreated: two commands for the same step are one step, and the second answers the original IDs.
 * Creating a step sets the attempt's stage to the step key.
 */
export async function beginStep(
  operation: Operation,
  input: {commandId: string; attemptId: string; stepKey: string; ordinal?: number | null},
  options: AccountsOptions = {},
): Promise<StepBeginning> {
  if (typeof input.stepKey !== 'string' || !namePattern.test(input.stepKey)) throw new TypeError('stepKey must be lower-case letters, digits and underscores');
  const ordinal = input.ordinal ?? null;
  if (ordinal !== null && (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > maxOperationOrdinal)) throw new TypeError('ordinal must be a whole number from 1 to 100');
  const row = await callRow(
    'begin_step',
    {
      p_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      p_command_id: requireUuid('commandId', input.commandId),
      p_attempt_id: requireUuid('attemptId', input.attemptId),
      p_step_key: input.stepKey,
      p_ordinal: ordinal,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['created', 'replayed', 'reused', 'denied', 'unavailable', 'not_running'] as const);
  if (outcome === 'reused' || outcome === 'denied' || outcome === 'unavailable') return {outcome};
  const attemptState = oneOf(row.attempt_state, jobStates);
  if (outcome === 'not_running') {
    // The attempt that refused is not running.
    if (attemptState === 'running') throw unexpected();
    return {outcome, attemptState};
  }
  const operationId = row.operation_id === null || row.operation_id === undefined ? null : uuidOf(row.operation_id);
  // An operation comes back exactly when an ordinal was asked for; a step is made only in a running attempt.
  if ((operationId === null) !== (ordinal === null)) throw unexpected();
  if (outcome === 'created' && attemptState !== 'running') throw unexpected();
  return {outcome, stepId: uuidOf(row.step_id), operationId, attemptState};
}

// Advance an operation -----------------------------------------------------------------------------------------------------------------------------

/**
 * What api.advance_operation answers. `advanced`: the operation moved, and is in the state asked for. `replayed`: nothing moved now, because the operation was already
 * in the state asked for (with the same request ID) or this command ID made the move earlier; it carries the operation AS IT IS NOW, which may have moved on since
 * (dispatched under a command, then ambiguous, then settled). Both carry the state and the request ID. `not_running`: a dispatch needs a running attempt (it carries the attempt's state). `invalid_transition`: the
 * move is not listed, the request ID would change, or a noncharge has none (it carries the operation's state).
 */
export type OperationAdvance =
  | {outcome: 'advanced' | 'replayed'; operationId: string; state: OperationState; requestId: string | null}
  | {outcome: 'not_running'; attemptState: JobState}
  | {outcome: 'invalid_transition'; state: OperationState}
  | {outcome: 'reused' | 'denied' | 'unavailable'};

/**
 * The moves an operation allows: `planned` to `dispatched` or `abandoned`; `dispatched` to `completed`, `ambiguous` or `noncharge`; `ambiguous` to `settled` or
 * `noncharge`. Nothing leaves `completed`, `noncharge`, `settled` or `abandoned`.
 */
export const operationMoves: Readonly<Record<OperationState, readonly OperationState[]>> = {
  planned: ['dispatched', 'abandoned'],
  dispatched: ['completed', 'ambiguous', 'noncharge'],
  ambiguous: ['settled', 'noncharge'],
  completed: [],
  noncharge: [],
  settled: [],
  abandoned: [],
};

/**
 * Moves an operation along its guarded states. The dispatch (`planned` to `dispatched`) needs its attempt running; every other move works in any attempt state, so
 * the late outcome of an attempt that has ended is still recorded: that is how an ambiguous charge is reconciled. A `noncharge` needs the provider's request ID
 * (`requestId`, printable ASCII without spaces, once known), and a stored request ID never changes.
 */
export async function advanceOperation(
  operation: Operation,
  input: {commandId: string; operationId: string; to: OperationState; requestId?: string | null},
  options: AccountsOptions = {},
): Promise<OperationAdvance> {
  if (!(operationStates as readonly string[]).includes(input.to)) throw new TypeError('to must be an operation state');
  const requestId = input.requestId ?? null;
  if (requestId !== null && (typeof requestId !== 'string' || !requestIdPattern.test(requestId))) throw new TypeError('requestId must be 1 to 200 printable ASCII characters without spaces');
  const row = await callRow(
    'advance_operation',
    {
      p_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      p_command_id: requireUuid('commandId', input.commandId),
      p_operation_id: requireUuid('operationId', input.operationId),
      p_to: input.to,
      p_request_id: requestId,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['advanced', 'replayed', 'reused', 'denied', 'unavailable', 'not_running', 'invalid_transition'] as const);
  if (outcome === 'reused' || outcome === 'denied' || outcome === 'unavailable') return {outcome};
  if (outcome === 'not_running') {
    const attemptState = oneOf(row.attempt_state, jobStates);
    if (attemptState === 'running' || input.to !== 'dispatched') throw unexpected();
    return {outcome, attemptState};
  }
  const state = oneOf(row.state, operationStates);
  if (outcome === 'invalid_transition') return {outcome, state};
  const stored = row.request_id === null || row.request_id === undefined ? null : text(row.request_id);
  if (stored !== null && !requestIdPattern.test(stored)) throw unexpected();
  // A move lands in the state that was asked for. A replay is the operation as it is NOW, which may have moved on since the command ran (dispatched under a
  // command, then ambiguous, then settled), so any state is an answer. Either way a noncharge has its request ID, and a request ID the caller gave is the stored one.
  if (outcome === 'advanced' && state !== input.to) throw unexpected();
  if (state === 'noncharge' && stored === null) throw unexpected();
  if (requestId !== null && stored !== requestId) throw unexpected();
  return {outcome, operationId: uuidOf(row.operation_id), state, requestId: stored};
}

// Move an attempt ----------------------------------------------------------------------------------------------------------------------------------

/**
 * What api.move_attempt answers. `moved` and `replayed` carry the attempt. `blocked`: starting is refused while an operation of an earlier attempt is potentially
 * chargeable; the reason is `awaiting_reconciliation`, and the attempt is unchanged. `open_operations`: an attempt completes only when none of its operations is
 * `planned`, `dispatched` or `ambiguous`. `invalid_transition`: the move is not listed (it carries the attempt's state); a finished attempt has no move at all.
 */
export type AttemptMove =
  | {outcome: 'moved' | 'replayed'; attempt: AttemptSummary}
  | {outcome: 'blocked'; reason: 'awaiting_reconciliation'}
  | {outcome: 'open_operations'}
  | {outcome: 'invalid_transition'; state: JobState}
  | {outcome: 'reused' | 'denied' | 'unavailable'};

/**
 * Starts (`running`), completes, fails or cancels an attempt. The moves are `waiting` to `running` or `cancelled`, and `running` to `completed`, `failed` or
 * `cancelled`. `failed` needs a reason of `step_failed` or `lease_lost`, and `cancelled` one of `user_cancelled` or `account_disabled`; no other state takes a
 * reason. Failing or cancelling turns the attempt's `planned` operations `abandoned` in the same transaction, while its `dispatched` and `ambiguous` operations
 * stay potentially chargeable. A finished attempt is never started, extended or changed.
 */
export async function moveAttempt(
  operation: Operation,
  input: {commandId: string; attemptId: string; to: JobState; reason?: StoredReason | null},
  options: AccountsOptions = {},
): Promise<AttemptMove> {
  if (!(jobStates as readonly string[]).includes(input.to)) throw new TypeError('to must be an attempt state');
  const reason = input.reason ?? null;
  const allowed: readonly (StoredReason | null)[] = input.to === 'failed' ? failureReasons : input.to === 'cancelled' ? cancellationReasons : [null];
  if (!allowed.includes(reason)) throw new TypeError('a failed attempt needs step_failed or lease_lost, a cancelled one user_cancelled or account_disabled, and no other state takes a reason');
  const row = await callRow(
    'move_attempt',
    {
      p_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      p_command_id: requireUuid('commandId', input.commandId),
      p_attempt_id: requireUuid('attemptId', input.attemptId),
      p_to: input.to,
      p_reason: reason,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['moved', 'replayed', 'reused', 'denied', 'unavailable', 'blocked', 'open_operations', 'invalid_transition'] as const);
  switch (outcome) {
    case 'reused':
    case 'denied':
    case 'unavailable':
      return {outcome};
    case 'open_operations':
      // Only a completion is held back by an operation that is still open.
      if (input.to !== 'completed') throw unexpected();
      return {outcome};
    case 'blocked':
      // The gate holds a waiting attempt: it is waiting, for reconciliation, and the move asked for is a start.
      if (row.state !== 'waiting' || row.reason !== 'awaiting_reconciliation' || input.to !== 'running') throw unexpected();
      return {outcome, reason: 'awaiting_reconciliation'};
    case 'invalid_transition':
      return {outcome, state: oneOf(row.state, jobStates)};
    default: {
      const attempt = summaryOf(row, 'attempt_id', 'attempt_number');
      // A move lands in the state that was asked for, with the reason that was given. (A replay is the attempt as it is now.)
      if (outcome === 'moved' && (attempt.state !== input.to || (attempt.state === 'failed' || attempt.state === 'cancelled' ? attempt.reason !== reason : false))) throw unexpected();
      return {outcome, attempt};
    }
  }
}

// Request a retry ---------------------------------------------------------------------------------------------------------------------------------

/**
 * What api.request_retry answers. `created` and `replayed` carry the new attempt: `waiting`, stage `retry`, and its derived reason (`awaiting_reconciliation` while
 * an operation of an earlier attempt is potentially chargeable, else `awaiting_dispatch`). `stale`: the person saw an older attempt (it carries the highest number).
 * `not_retryable`: only a `failed` attempt is retried (it carries the highest attempt's state). Nothing was made for either.
 */
export type RetryRequest =
  | {outcome: 'created' | 'replayed'; jobId: string; attempt: AttemptSummary}
  | {outcome: 'stale'; number: number}
  | {outcome: 'not_retryable'; state: JobState}
  | {outcome: 'reused' | 'denied' | 'unavailable'};

/**
 * Makes the next attempt of a Job after its highest attempt has FAILED, linked to it and waiting. `expectedNumber` is the highest attempt the person saw. It
 * never waits inside the command, never starts the attempt (starting is `moveAttempt`, past the gate) and nothing retries by itself.
 */
export async function requestRetry(
  operation: Operation,
  input: {commandId: string; jobId: string; expectedNumber: number; inputDigest: string},
  options: AccountsOptions = {},
): Promise<RetryRequest> {
  if (!Number.isSafeInteger(input.expectedNumber) || input.expectedNumber < 1) throw new TypeError('expectedNumber must be a positive integer');
  if (typeof input.inputDigest !== 'string' || !digestPattern.test(input.inputDigest)) throw new TypeError('inputDigest must be 64 lower-case hexadecimal characters');
  const row = await callRow(
    'request_retry',
    {
      p_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      p_command_id: requireUuid('commandId', input.commandId),
      p_job_id: requireUuid('jobId', input.jobId),
      p_expected_number: input.expectedNumber,
      p_input_digest: input.inputDigest,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['created', 'replayed', 'reused', 'denied', 'unavailable', 'stale', 'not_retryable'] as const);
  if (outcome === 'reused' || outcome === 'denied' || outcome === 'unavailable') return {outcome};
  if (outcome === 'stale') {
    const number = numberOf(row.attempt_number);
    // The highest attempt is not the one the person saw.
    if (number === input.expectedNumber) throw unexpected();
    return {outcome, number};
  }
  if (outcome === 'not_retryable') {
    const state = oneOf(row.state, jobStates);
    if (state === 'failed' || numberOf(row.attempt_number) !== input.expectedNumber) throw unexpected();
    return {outcome, state};
  }
  const attempt = summaryOf(row, 'attempt_id', 'attempt_number');
  // A new attempt follows the one the person saw, and waits. (A replay is the same attempt as it is now.)
  if (attempt.number !== input.expectedNumber + 1) throw unexpected();
  if (outcome === 'created' && (attempt.state !== 'waiting' || attempt.stage !== 'retry' || attempt.reason === null)) throw unexpected();
  return {outcome, jobId: uuidOf(row.job_id), attempt};
}

// Read a Job -------------------------------------------------------------------------------------------------------------------------------------------

/** An attempt as the read shows it: its state, stage, reason, times and the count of its operations that are potentially chargeable. Nothing else. */
export type AttemptRecord = AttemptSummary & {createdAt: string; startedAt: string | null; endedAt: string | null; chargeableOperations: number};

/**
 * A Job as the read shows it. `state`, `stage` and `reason` are the Job's PUBLIC state: its highest attempt's (a waiting attempt's reason is derived).
 * `canRetry`: the highest attempt has failed. `attempts` are in order, from 1.
 */
export type JobRecord = {
  id: string;
  projectId: string;
  kind: string;
  createdAt: string;
  state: JobState;
  stage: string;
  reason: JobReason | null;
  canRetry: boolean;
  attempts: AttemptRecord[];
};

/** `found`: the Job. `denied`: the Account has no authority for this request. `unavailable`: a foreign, deleted, unknown or deleted-for-good Job or Project. */
export type JobRead = {outcome: 'found'; job: JobRecord} | {outcome: (typeof denialOutcomes)[number]};

function attemptRecordOf(value: unknown): AttemptRecord {
  const row = rowIn(value);
  const startedAt = optionalTimeOf(row.started_at);
  const endedAt = optionalTimeOf(row.ended_at);
  const chargeable = wholeNumber(row.chargeable_operations);
  if (chargeable === null) throw unexpected();
  const summary = summaryOf(row, 'id', 'number');
  const finished = (finishedJobStates as readonly string[]).includes(summary.state);
  // The times agree with the state: an open attempt has not ended, a finished one has, and only a waiting attempt (or one cancelled before it started) has not started.
  if ((endedAt !== null) !== finished || (summary.state === 'waiting' && startedAt !== null) || ((summary.state === 'running' || summary.state === 'completed' || summary.state === 'failed') && startedAt === null)) throw unexpected();
  return {...summary, createdAt: timeOf(row.created_at), startedAt, endedAt, chargeableOperations: chargeable};
}

/**
 * Reads a Job: its public state, whether it can be retried, and every attempt in order with its state, stage, reason, times and the count of its potentially
 * chargeable operations. Nothing else: no input digest, no request ID, no step. The database reads the Job's state and its attempts in ONE statement, so they come
 * from one snapshot and agree even while a command commits. Fails closed all the same: an answer that is not shaped like a Job, or whose public state is not its
 * highest attempt's, throws rather than show a state the records do not hold.
 */
export async function readJob(operation: Operation, input: {jobId: string}, options: AccountsOptions = {}): Promise<JobRead> {
  const row = await callRow(
    'read_job',
    {p_account_id: requireOperation(operation), p_epoch: operation.epoch, p_job_id: requireUuid('jobId', input.jobId)},
    options,
  );
  const outcome = oneOf(row.outcome, ['found', 'denied', 'unavailable'] as const);
  if (outcome !== 'found') return {outcome};
  if (!Array.isArray(row.attempts) || row.attempts.length === 0) throw unexpected();
  const attempts = row.attempts.map(attemptRecordOf);
  // In order from 1, one after another; only the highest can be open (waiting or running).
  attempts.forEach((attempt, index) => {
    if (attempt.number !== index + 1) throw unexpected();
    if (index < attempts.length - 1 && !(finishedJobStates as readonly string[]).includes(attempt.state)) throw unexpected();
  });
  const highest = attempts[attempts.length - 1];
  const state = oneOf(row.state, jobStates);
  const stage = stageOf(row.stage);
  const reason = attemptFacts(state, stage, row.reason);
  // The Job has no state of its own: its public state IS its highest attempt's.
  if (state !== highest.state || stage !== highest.stage || reason !== highest.reason) throw unexpected();
  if (typeof row.can_retry !== 'boolean' || row.can_retry !== (state === 'failed')) throw unexpected();
  const kind = text(row.kind);
  if (kind === null || !namePattern.test(kind)) throw unexpected();
  return {
    outcome,
    job: {id: uuidOf(row.job_id), projectId: uuidOf(row.project_id), kind, createdAt: timeOf(row.created_at), state, stage, reason, canRetry: row.can_retry, attempts},
  };
}
