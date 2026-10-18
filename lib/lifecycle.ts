// Story 1.8. The application side of the Lifecycle functions: typed calls to the `api` schema with the service role.
//
//   recordTombstone       api.record_tombstone   the ONE writer of a tombstone. Nothing in the application calls it: Epic 8's
//                                                deletion commands will. It hides the target first, then records the tombstone.
//   guardTarget           api.guard_target       may THIS operation act on THIS target now? (lib/authority.ts `authorizeTarget`)
//   lookupStatus          api.lookup_status      what a status handle's target is now; the status route's database half
//   claimLedgerEvents     api.claim_ledger_events  the relay's lease and the pending events, in outbox order (lib/ledger.ts)
//   finishLedgerEvents    api.finish_ledger_events marks events relayed and lets go of the lease
//   ledgerPending         api.ledger_pending     how many events wait for the relay, and how old the oldest is
//
// Story 1.9 adds the scheduled jobs' half (lib/jobs.ts and lib/job-tasks.ts are its callers) and the dormant-identity purge:
//
//   claimJobRun           api.claim_job_run      claims one run of a scheduled message: claimed | duplicate | running
//   finishJobRun          api.finish_job_run     finishes its receipt, once, with an outcome and a result of counts and class names
//   lastJobRun            api.last_job_run       the newest finished receipt of a task (Story 1.13's alarm reads it)
//   purgeDormantIdentities api.purge_dormant_identities  deletes the Auth identities that never became Accounts, 30 days idle
//
// Story 1.12 adds the file gateway's two (nothing else calls them; lib/job-tasks.ts and an operator are the callers):
//
//   revokeServiceKey      api.revoke_service_key     records a key's revocation and ends every staging lease and transfer handle opened under it
//   listExpiredStaging    api.list_expired_staging   names the leases the hourly cleanup removes (expired or released, not yet deleted)
//
// Story 1.13 adds the operational alarms' seven (lib/alarms.ts, lib/heartbeat.ts and the Administrator's page are the callers):
//
//   raiseAlarm            api.raise_alarm          opens an alarm for a (condition, subject) or refreshes the open one
//   resolveAlarm          api.resolve_alarm        resolves the open alarm of a (condition, subject); the record is kept
//   listAlarms            api.list_alarms          the open alarms and, on request, the most recently resolved ones, each with its email state
//   alarmsDueMail         api.alarms_due_mail      the open alarms due an email (the 24-hour rule is the database's)
//   recordAlarmNotice     api.record_alarm_notice  the outcome of one attempt to email an alarm: sent | failed | unknown
//   alarmObservations     api.alarm_observations   every number the registry of conditions looks at, as ages in seconds on the database clock
//   recordHeartbeat       api.record_heartbeat     a heartbeat of the Railway cron task: recorded | duplicate | revoked
//
// SERVER-ONLY (it imports lib/accounts.ts, which holds the service-role key). Like lib/accounts.ts and lib/authority.ts it uses
// erasable TypeScript syntax and relative `.ts` imports, so a worker outside Next.js can import it through Node type stripping.
//
// Every answer is checked: a reply that is not shaped like an answer is no answer, and the caller treats no answer as a denial.
// Nothing here logs, and no error message holds an ID, a handle or a hash.
import {callRow, hashClientAddress, hashKey, oneOf, operationOutcomes, requireUuid, unexpected, type AccountsOptions, type OperationOutcome, type Row} from './accounts.ts';
import type {AlarmDetail, Observations} from './alarm-conditions.ts';
import {isHiddenState, type HiddenState} from './hidden-state.ts';
import {isServiceIssuer} from './service-signing.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const handlePattern = /^[0-9a-f]{32}$/;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const count = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);
const text = (value: unknown) => (typeof value === 'string' ? value : null);

// Tombstones ----------------------------------------------------------------------------------------------------------------

/** What a tombstone can be about. */
export const targetKinds = ['account', 'project'] as const;
export type TargetKind = (typeof targetKinds)[number];

function requireKind(kind: unknown): TargetKind {
  if (!(targetKinds as readonly unknown[]).includes(kind)) throw new TypeError('kind must be account or project');
  return kind as TargetKind;
}

/**
 * api.record_tombstone: `recorded` (the target was hidden first and its tombstone written, at `revision`), `exists` (it had one
 * already: nothing changed, and `revision` is the first one) or `not_found` (no such target and no tombstone).
 */
export type TombstoneReceipt = {outcome: 'recorded' | 'exists'; kind: TargetKind; targetId: string; revision: number} | {outcome: 'not_found'};

/**
 * Records a tombstone for an Account or a Project (Story 1.8's one writer; Epic 8's deletion commands are its callers). In one
 * database transaction under a lock on the target: the target is hidden FIRST (an Account is disabled under a raised epoch and its
 * Auth sessions are deleted, as a disable does; a Project is marked deleted under a raised revision), then the tombstone is written and
 * its ledger event queued. A second call
 * changes nothing and answers the first revision. If this throws an AccountsUnavailableError with `outcomeUnknown`, the tombstone
 * may or may not have been recorded: call it again, it is idempotent.
 */
export async function recordTombstone(input: {kind: TargetKind; id: string}, options: AccountsOptions = {}): Promise<TombstoneReceipt> {
  const kind = requireKind(input.kind);
  const targetId = requireUuid('id', input.id);
  const row = await callRow('record_tombstone', {p_kind: kind, p_target_id: targetId}, options);
  const outcome = oneOf(row.outcome, ['recorded', 'exists', 'not_found'] as const);
  if (outcome === 'not_found') return {outcome};
  const revision = count(row.revision);
  // An answer that names another target than the one asked for, or no revision, is not an answer.
  if (revision === null || revision < 1 || row.kind !== kind || text(row.target_id)?.toLowerCase() !== targetId) throw unexpected();
  return {outcome, kind, targetId, revision};
}

// The guard for a target --------------------------------------------------------------------------------------------------------

/**
 * api.guard_target: the outcomes of `api.guard_operation` (the Account is asked first) and `unavailable`, the one answer for a
 * target that is another Account's, unknown, deleted or tombstoned. Only `allowed` is permission.
 */
export const targetOutcomes = [...operationOutcomes, 'unavailable'] as const;
export type TargetOutcome = OperationOutcome | 'unavailable';
export type TargetGuard = {outcome: TargetOutcome; epoch: number | null};

/**
 * Whether an operation of an Account, registered under an epoch, may act on a named target now. The database decides; this throws
 * when it cannot be reached (lib/authority.ts `authorizeTarget` turns that into a denial). An ID that is not shaped like an ID cannot
 * be any Account's target, and is `unavailable` without asking.
 */
export async function guardTarget(input: {accountId: string; epoch: number; kind: TargetKind; id: string}, options: AccountsOptions = {}): Promise<TargetGuard> {
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 1) throw new TypeError('epoch must be a positive integer');
  const accountId = requireUuid('accountId', input.accountId);
  const kind = requireKind(input.kind);
  if (typeof input.id !== 'string' || !uuidPattern.test(input.id)) return {outcome: 'unavailable', epoch: null};
  const row = await callRow('guard_target', {p_account_id: accountId, p_epoch: input.epoch, p_kind: kind, p_target_id: input.id.toLowerCase()}, options);
  const outcome = oneOf(row.outcome, targetOutcomes);
  const epoch = row.epoch === null || row.epoch === undefined ? null : count(row.epoch);
  if (epoch === null && row.epoch !== null && row.epoch !== undefined) throw unexpected();
  // Every answer but "no such Account" or a tombstoned Account whose row is gone comes from a known Account, which has an epoch.
  if (epoch === null && outcome !== 'no_account' && outcome !== 'tombstoned') throw unexpected();
  return {outcome, epoch};
}

// The status lookup ---------------------------------------------------------------------------------------------------------------

/**
 * api.lookup_status: `found` (the state and revision of the handle's target: an Account's revision is its authorization epoch, a Project's
 * is its own revision plus its Account's epoch, and a deleted target's is its tombstone's; lib/hidden-state.ts merges them), `unknown` (no such handle) or `limited` (the origin or
 * everyone has used its budget for this minute; try again in `retryAfter` seconds; nothing was looked up).
 */
export type StatusLookup = {outcome: 'found'; state: HiddenState; revision: number} | {outcome: 'unknown'} | {outcome: 'limited'; retryAfter: number};

/** Whether a value is shaped like a status handle: 32 lower-case hexadecimal characters. */
export function isStatusHandle(value: unknown): value is string {
  return typeof value === 'string' && handlePattern.test(value);
}

/**
 * Looks up a status handle for a caller at a network origin (`clientAddress`, from lib/accounts.ts `clientAddressFromHeaders`; it
 * is hashed under RATE_LIMIT_HASH_KEY here, the way registration hashes it, and never stored or logged). The database counts the
 * request first, answered or not. Fails closed: if the database cannot be reached this throws an AccountsUnavailableError, and the
 * route answers 503: "the database did not answer" is never `unknown`.
 */
export async function lookupStatus(input: {handle: string; clientAddress: string | null | undefined}, options: AccountsOptions = {}): Promise<StatusLookup> {
  if (!isStatusHandle(input.handle)) throw new TypeError('handle must be 32 lower-case hexadecimal characters');
  const key = hashKey(options.env ?? process.env, 'RATE_LIMIT_HASH_KEY');
  const row = await callRow('lookup_status', {p_handle: input.handle, p_origin_hash: hashClientAddress(input.clientAddress, key)}, options);
  const outcome = oneOf(row.outcome, ['active', 'disabled', 'deleted', 'unknown', 'limited'] as const);
  if (outcome === 'unknown') return {outcome};
  if (outcome === 'limited') {
    const retryAfter = count(row.retry_after);
    if (retryAfter === null || retryAfter < 1) throw unexpected();
    return {outcome, retryAfter};
  }
  const revision = count(row.revision);
  if (revision === null || revision < 1 || !isHiddenState(outcome)) throw unexpected();
  return {outcome: 'found', state: outcome, revision};
}

// The relay ---------------------------------------------------------------------------------------------------------------------------

/**
 * One pending event, as the relay appends it: its ID, its place in the outbox, the event itself ({id, type, ...}, as written when it
 * was queued) and its own time (UTC, to the millisecond), which the ledger writes so that a retry writes the same bytes.
 */
export type LedgerEvent = {id: string; seq: number; event: Row & {id: string; type: string}; at: string};

/** api.claim_ledger_events: `claimed` (the lease is held; the oldest pending events, in outbox order) or `busy` (another relay holds it). */
export type LedgerClaim = {outcome: 'claimed'; events: LedgerEvent[]} | {outcome: 'busy'};

export const maxClaimed = 200;

function eventOf(value: unknown): LedgerEvent {
  const item = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Row;
  const id = text(item.id);
  const seq = count(item.seq);
  const event = typeof item.event === 'object' && item.event !== null && !Array.isArray(item.event) ? (item.event as Row) : null;
  const at = text(item.at);
  // An event that does not name itself the way the outbox does, or has no type or time, is not one the relay may write.
  if (!id || !uuidPattern.test(id) || seq === null || seq < 1 || !event || event.id !== id || typeof event.type !== 'string' || !at || !instantPattern.test(at)) throw unexpected();
  return {id, seq, event: event as LedgerEvent['event'], at};
}

/**
 * Takes the relay's lease for `holder` and reads the oldest pending events, in outbox order. `busy` when another holder has an
 * unexpired lease. The same holder asking again renews its lease. The lease is short (default 30 seconds) and runs out by itself,
 * so a relay that crashed holds nothing for long.
 */
export async function claimLedgerEvents(input: {holder: string; limit?: number; leaseSeconds?: number}, options: AccountsOptions = {}): Promise<LedgerClaim> {
  const limit = input.limit ?? 50;
  const leaseSeconds = input.leaseSeconds ?? 30;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxClaimed) throw new TypeError('limit must be a whole number from 1 to 200');
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) throw new TypeError('leaseSeconds must be a whole number from 1 to 300');
  const row = await callRow('claim_ledger_events', {p_holder: requireUuid('holder', input.holder), p_limit: limit, p_lease_seconds: leaseSeconds}, options);
  const outcome = oneOf(row.outcome, ['claimed', 'busy'] as const);
  if (outcome === 'busy') return {outcome};
  if (!Array.isArray(row.events)) throw unexpected();
  const events = row.events.map(eventOf);
  // More than was asked for, or out of order, is not an answer: the relay appends in this order.
  if (events.length > limit) throw unexpected();
  for (let index = 1; index < events.length; index += 1) if (events[index].seq <= events[index - 1].seq) throw unexpected();
  return {outcome, events};
}

/** `marked` events were marked relayed now (one already marked is left as it was); `released` is true when the lease was the holder's and is let go. */
export type LedgerFinish = {marked: number; released: boolean};

/** Marks events relayed (they are in the ledger store) and, when `release` is true, lets go of the lease if `holder` still holds it. */
export async function finishLedgerEvents(input: {holder: string; eventIds: string[]; release?: boolean}, options: AccountsOptions = {}): Promise<LedgerFinish> {
  if (!Array.isArray(input.eventIds) || input.eventIds.length > maxClaimed) throw new TypeError('eventIds must be a list of at most 200 IDs');
  const row = await callRow(
    'finish_ledger_events',
    {p_holder: requireUuid('holder', input.holder), p_event_ids: input.eventIds.map((id) => requireUuid('eventId', id)), p_release: input.release === true},
    options,
  );
  const marked = count(row.marked);
  if (marked === null || marked > input.eventIds.length || typeof row.released !== 'boolean') throw unexpected();
  return {marked, released: row.released};
}

/** How many events wait for the relay, and the age in seconds of the oldest (null when none): what the alarm of Story 1.13 reads. */
export type LedgerBacklog = {pending: number; oldestSeconds: number | null};

export async function ledgerPending(options: AccountsOptions = {}): Promise<LedgerBacklog> {
  const row = await callRow('ledger_pending', {}, options);
  const pending = count(row.pending);
  const oldestSeconds = row.oldest_seconds === null || row.oldest_seconds === undefined ? null : count(row.oldest_seconds);
  if (pending === null || (oldestSeconds === null && row.oldest_seconds !== null && row.oldest_seconds !== undefined)) throw unexpected();
  // Nothing pending has no oldest, and something pending has one.
  if ((pending === 0) !== (oldestSeconds === null)) throw unexpected();
  return {pending, oldestSeconds};
}

// Scheduled jobs (Story 1.9) --------------------------------------------------------------------------------------------------------

const taskPattern = /^[a-z][a-z0-9-]{0,62}$/;
const jobIdPattern = /^[A-Za-z0-9_.:-]{1,128}$/;

/** How a finished run went. `failed` is the only one a retry replaces. */
export const jobOutcomes = ['ran', 'idle', 'no_store', 'failed'] as const;
export type JobOutcome = (typeof jobOutcomes)[number];

/**
 * What a receipt's result may hold: a small flat object of whole numbers, booleans and single words (a class name such as `TypeError`,
 * or an outcome such as `store_unavailable`). It never holds an address, an ID, a key or a message: the database refuses anything
 * else, and this is the same rule, checked before the call so that a task that returns something else fails here, by name.
 */
export type JobResult = Record<string, number | boolean | string>;

const resultKeyPattern = /^[a-z][a-z0-9_]{0,31}$/;
const resultWordPattern = /^(?:[A-Z][A-Za-z]{0,47}|[a-z][a-z_]{0,31})$/;

/** Whether a value is a result the database would accept: at most 1 KB, only counts, booleans and single words. */
export function isJobResult(value: unknown): value is JobResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (JSON.stringify(value).length > 1024) return false;
  return entries.every(
    ([key, item]) =>
      resultKeyPattern.test(key) &&
      ((typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 && item < 1e12) || typeof item === 'boolean' || (typeof item === 'string' && resultWordPattern.test(item))),
  );
}

/**
 * api.claim_job_run: `claimed` (a new attempt: run the task, then finish `receiptId`), `duplicate` (the latest attempt of this message
 * finished with anything but `failed`: nothing runs) or `running` (the latest attempt is unfinished and inside its lease).
 */
export type JobClaim = {outcome: 'claimed'; receiptId: string; attempt: number} | {outcome: 'duplicate'} | {outcome: 'running'};

/**
 * Claims one run of a scheduled message BEFORE its task starts. The idempotency key is the (schedule ID, message ID) pair: QStash documents
 * no scheduled-time header, and a retry of a delivery keeps its message ID. An unfinished attempt past its lease (300 seconds unless
 * `leaseSeconds` says otherwise) and a `failed` one are replaced by the next attempt. If this throws an AccountsUnavailableError the
 * claim may or may not have been written: the caller answers "try again" and the delivery comes back.
 */
export async function claimJobRun(input: {task: string; scheduleId: string; messageId: string; leaseSeconds?: number}, options: AccountsOptions = {}): Promise<JobClaim> {
  const leaseSeconds = input.leaseSeconds ?? 300;
  if (typeof input.task !== 'string' || !taskPattern.test(input.task)) throw new TypeError('task must be a lower-case task ID');
  if (typeof input.scheduleId !== 'string' || !jobIdPattern.test(input.scheduleId)) throw new TypeError('scheduleId must be a QStash schedule ID');
  if (typeof input.messageId !== 'string' || !jobIdPattern.test(input.messageId)) throw new TypeError('messageId must be a QStash message ID');
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) throw new TypeError('leaseSeconds must be a whole number from 1 to 3600');
  const row = await callRow('claim_job_run', {p_task: input.task, p_schedule_id: input.scheduleId, p_message_id: input.messageId, p_lease_seconds: leaseSeconds}, options);
  const outcome = oneOf(row.outcome, ['claimed', 'duplicate', 'running'] as const);
  const attempt = count(row.attempt);
  const receiptId = text(row.receipt_id);
  // Every answer names the receipt it is about, and the attempt is a positive number.
  if (!receiptId || !uuidPattern.test(receiptId) || attempt === null || attempt < 1) throw unexpected();
  if (outcome === 'claimed') return {outcome, receiptId: receiptId.toLowerCase(), attempt};
  return {outcome};
}

/** api.finish_job_run: `finished` now, `already_finished` (a receipt is finished once: nothing changed) or `not_found`. */
export type JobFinish = {outcome: 'finished' | 'already_finished' | 'not_found'};

/** Finishes a receipt, once. The result must be counts, booleans and single words (see `isJobResult`): anything else is refused here, before the call. */
export async function finishJobRun(input: {receiptId: string; outcome: JobOutcome; result: JobResult}, options: AccountsOptions = {}): Promise<JobFinish> {
  const receiptId = requireUuid('receiptId', input.receiptId);
  if (!(jobOutcomes as readonly unknown[]).includes(input.outcome)) throw new TypeError('outcome must be ran, idle, no_store or failed');
  if (!isJobResult(input.result)) throw new TypeError('result must be a small object of counts, booleans and single words');
  const row = await callRow('finish_job_run', {p_receipt_id: receiptId, p_outcome: input.outcome, p_result: input.result}, options);
  return {outcome: oneOf(row.outcome, ['finished', 'already_finished', 'not_found'] as const)};
}

/** The newest finished receipt of a task, as the alarm of Story 1.13 reads it. `result` is what the run recorded: counts, booleans and words. */
export type JobRun = {outcome: JobOutcome; attempt: number; startedAt: string; finishedAt: string; result: JobResult};

/** The newest finished receipt of a task, or null when the task has never finished a run. */
export async function lastJobRun(task: string, options: AccountsOptions = {}): Promise<JobRun | null> {
  if (typeof task !== 'string' || !taskPattern.test(task)) throw new TypeError('task must be a lower-case task ID');
  const row = await callRow('last_job_run', {p_task: task}, options);
  if (row.outcome === null || row.outcome === undefined) {
    // Never finished: every field is null, and nothing else is an answer.
    if (Object.values(row).some((value) => value !== null && value !== undefined)) throw unexpected();
    return null;
  }
  const outcome = oneOf(row.outcome, jobOutcomes);
  const attempt = count(row.attempt);
  const startedAt = text(row.started_at);
  const finishedAt = text(row.finished_at);
  if (attempt === null || attempt < 1 || !startedAt || !finishedAt || !isJobResult(row.result)) throw unexpected();
  return {outcome, attempt, startedAt, finishedAt, result: row.result};
}

/**
 * api.purge_dormant_identities: counts only. `deleted` identities are gone; `kept` were not deleted (no longer dormant once locked, already
 * gone, or refused by the foreign key from an Account); `locked` were skipped because a registration (or another purge) held their row;
 * `remaining` dormant identities are still there (at most 10,001).
 */
export type PurgeReport = {deleted: number; kept: number; locked: number; remaining: number};

export const defaultPurgeLimit = 100;
export const maxPurgeLimit = 500;

/**
 * Deletes Auth identities that never became Accounts and have been idle for 30 days (no sign-in, no registration attempt), at most `limit`
 * (default 100, 1 to 500) in one database transaction. There is no age parameter: 30 days is not a setting. Each identity is locked the way
 * registration locks it (the lock is taken first, the conditions are read again, and a foreign-key refusal keeps it), so a registration
 * that is in flight for an identity is never undone and a purged identity's registration answers `no_identity`.
 */
export async function purgeDormantIdentities(input: {limit?: number} = {}, options: AccountsOptions = {}): Promise<PurgeReport> {
  const limit = input.limit ?? defaultPurgeLimit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxPurgeLimit) throw new TypeError('limit must be a whole number from 1 to 500');
  const row = await callRow('purge_dormant_identities', {p_limit: limit}, options);
  const deleted = count(row.deleted);
  const kept = count(row.kept);
  const locked = count(row.locked);
  const remaining = count(row.remaining);
  // The batch examines at most `limit` identities, each of which is deleted, kept or locked.
  if (deleted === null || kept === null || locked === null || remaining === null || deleted + kept + locked > limit) throw unexpected();
  return {deleted, kept, locked, remaining};
}

// The file gateway (Story 1.12) -----------------------------------------------------------------------------------------------------------

const kidPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const reasonPattern = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * api.revoke_service_key: `revoked` (the key is revoked from this moment: a ticket or command under it is refused at redemption) or `exists` (it was
 * revoked already; whatever was still open under it is ended again). `leases` and `transfers` are how many staging leases and transfers (their handles) this
 * call ended, in the same transaction.
 */
export type KeyRevocation = {outcome: 'revoked' | 'exists'; leases: number; transfers: number};

/**
 * Revokes a service-signing key: suspected compromise. Nothing in the application calls this; the operator does (docs/secrets.md), through the
 * service role. In one transaction it records the revocation and ends every staging lease and transfer handle opened under the key, so a transfer
 * in flight stops at its next chunk. The issuer is one of lib/service-signing.ts `serviceIssuers`, the key ID is the `kid` of the key set, and the
 * reason is one lower-case word such as `compromise`.
 */
export async function revokeServiceKey(input: {issuer: string; kid: string; reason: string}, options: AccountsOptions = {}): Promise<KeyRevocation> {
  if (!isServiceIssuer(input.issuer)) throw new TypeError('issuer must be a service issuer');
  if (typeof input.kid !== 'string' || !kidPattern.test(input.kid)) throw new TypeError('kid must be a key ID');
  if (typeof input.reason !== 'string' || !reasonPattern.test(input.reason)) throw new TypeError('reason must be one lower-case word');
  const row = await callRow('revoke_service_key', {p_issuer: input.issuer, p_kid: input.kid, p_reason: input.reason}, options);
  const outcome = oneOf(row.outcome, ['revoked', 'exists'] as const);
  const leases = count(row.leases);
  const transfers = count(row.transfers);
  if (leases === null || transfers === null) throw unexpected();
  return {outcome, leases, transfers};
}

/** A staging lease whose staging is to be removed: its upload and its Account. Opaque IDs only. */
export type ExpiredLease = {uploadId: string; accountId: string};

export const maxExpiredStaging = 50;

/**
 * api.list_expired_staging: the leases the hourly cleanup removes (expired or released, not yet deleted), oldest first, at most `limit` (default and
 * most: 50). Read-only: the gateway deletes, on a signed command, and checks again at that moment that the lease is still expired or released.
 */
export async function listExpiredStaging(input: {limit?: number} = {}, options: AccountsOptions = {}): Promise<ExpiredLease[]> {
  const limit = input.limit ?? maxExpiredStaging;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxExpiredStaging) throw new TypeError('limit must be a whole number from 1 to 50');
  const row = await callRow('list_expired_staging', {p_limit: limit}, options);
  if (!Array.isArray(row.leases) || row.leases.length > limit) throw unexpected();
  return row.leases.map((item: unknown) => {
    const lease = (typeof item === 'object' && item !== null && !Array.isArray(item) ? item : {}) as Row;
    const uploadId = text(lease.upload_id);
    const accountId = text(lease.account_id);
    // Both are IDs: they name a prefix that is deleted, so anything else is not an answer.
    if (!uploadId || !uuidPattern.test(uploadId) || !accountId || !uuidPattern.test(accountId)) throw unexpected();
    return {uploadId: uploadId.toLowerCase(), accountId: accountId.toLowerCase()};
  });
}

// Operational alarms (Story 1.13) -----------------------------------------------------------------------------------------------------------------

/** An alarm's condition: one lower-case word of letters, digits and hyphens. A subject names what the alarm is about (a task, a payment) and may be absent. */
export const alarmConditionPattern = /^[a-z][a-z0-9-]{0,47}$/;
export const alarmSubjectPattern = /^[A-Za-z0-9._:-]{1,64}$/;
const detailKeyPattern = /^[a-z][a-z0-9_]{0,31}$/;
const detailTextPattern = /^[ -~]{0,80}$/;
/** The whole numbers the database accepts in a detail (lifecycle.alarm_detail_ok): zero, or at most 15 digits with no leading zero, negative or not. */
const detailIntegerPattern = /^-?(0|[1-9][0-9]{0,14})$/;

/**
 * Whether a value is an alarm's detail: a flat object of at most 1 KB whose keys are lower-case words and whose values are whole numbers of at most 15 digits
 * (negative or not), booleans, or strings of at most 80 printable ASCII characters. The database holds exactly the same rule (lifecycle.alarm_detail_ok, and a
 * test compares the two on the boundary values); it is checked here first so that a condition that produces anything else fails by name before the call.
 */
export function isAlarmDetail(value: unknown): value is AlarmDetail {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (JSON.stringify(value).length > 1024) return false;
  return Object.entries(value).every(
    ([key, item]) =>
      detailKeyPattern.test(key) &&
      // A number is checked as the database reads it: by the text it is sent as. A safe integer of sixteen digits is whole but is not accepted.
      ((typeof item === 'number' && Number.isSafeInteger(item) && detailIntegerPattern.test(JSON.stringify(item))) || typeof item === 'boolean' || (typeof item === 'string' && detailTextPattern.test(item))),
  );
}

function requireCondition(condition: unknown): string {
  if (typeof condition !== 'string' || !alarmConditionPattern.test(condition)) throw new TypeError('condition must be a lower-case condition ID');
  return condition;
}

function requireSubject(subject: unknown): string | null {
  if (subject === null) return null;
  if (typeof subject !== 'string' || !alarmSubjectPattern.test(subject)) throw new TypeError('subject must be null or a subject key');
  return subject;
}

/** api.raise_alarm: `opened` (a new alarm) or `refreshed` (the open alarm for the pair had its latest time and detail renewed), with the alarm's ID. */
export type AlarmRaise = {outcome: 'opened' | 'refreshed'; alarmId: string};

/**
 * Opens an alarm for a (condition, subject), or refreshes the open one: there is never a second open alarm for a pair. If this throws an
 * AccountsUnavailableError the alarm may or may not have been recorded; raising again is idempotent.
 */
export async function raiseAlarm(input: {condition: string; subject: string | null; detail: AlarmDetail}, options: AccountsOptions = {}): Promise<AlarmRaise> {
  const condition = requireCondition(input.condition);
  const subject = requireSubject(input.subject);
  if (!isAlarmDetail(input.detail)) throw new TypeError('detail must be a small flat object of whole numbers, booleans and short text');
  const row = await callRow('raise_alarm', {p_condition: condition, p_subject: subject, p_detail: input.detail}, options);
  const outcome = oneOf(row.outcome, ['opened', 'refreshed'] as const);
  const alarmId = text(row.alarm_id);
  if (!alarmId || !uuidPattern.test(alarmId)) throw unexpected();
  return {outcome, alarmId: alarmId.toLowerCase()};
}

/** api.resolve_alarm: `resolved` (the open alarm now has its resolved time; the record is kept) or `none` (nothing was open for the pair). */
export type AlarmResolve = {outcome: 'resolved'; alarmId: string} | {outcome: 'none'};

/** Resolves the open alarm of a (condition, subject), once. */
export async function resolveAlarm(input: {condition: string; subject: string | null}, options: AccountsOptions = {}): Promise<AlarmResolve> {
  const condition = requireCondition(input.condition);
  const subject = requireSubject(input.subject);
  const row = await callRow('resolve_alarm', {p_condition: condition, p_subject: subject}, options);
  const outcome = oneOf(row.outcome, ['resolved', 'none'] as const);
  if (outcome === 'none') return {outcome};
  const alarmId = text(row.alarm_id);
  if (!alarmId || !uuidPattern.test(alarmId)) throw unexpected();
  return {outcome, alarmId: alarmId.toLowerCase()};
}

export const noticeOutcomes = ['sent', 'failed', 'unknown'] as const;
export type NoticeOutcome = (typeof noticeOutcomes)[number];

/** An alarm as the Administrator's page and the monitor read it. Times are UTC text to the millisecond. */
export type AlarmRecord = {
  id: string;
  condition: string;
  subject: string | null;
  firstAt: string;
  latestAt: string;
  resolvedAt: string | null;
  detail: AlarmDetail;
  /** When its last `sent` notice was recorded, or null when it has never been emailed. */
  lastSentAt: string | null;
  /** The outcome and time of its latest notice of any kind, or null when none was ever recorded. */
  lastNoticeOutcome: NoticeOutcome | null;
  lastNoticeAt: string | null;
};

const recordOf = (value: unknown): Row => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : {});
const instantOf = (value: unknown): string => {
  const at = text(value);
  if (!at || !instantPattern.test(at)) throw unexpected();
  return at;
};
const optionalInstantOf = (value: unknown): string | null => (value === null || value === undefined ? null : instantOf(value));

function alarmOf(value: unknown): AlarmRecord {
  const item = recordOf(value);
  const id = text(item.id);
  const condition = text(item.condition);
  const subject = item.subject === null || item.subject === undefined ? null : text(item.subject);
  if (!id || !uuidPattern.test(id) || !condition || !alarmConditionPattern.test(condition)) throw unexpected();
  // A subject is absent (null) or a subject key; anything else is not an answer.
  if (item.subject !== null && item.subject !== undefined && (subject === null || !alarmSubjectPattern.test(subject))) throw unexpected();
  if (!isAlarmDetail(item.detail)) throw unexpected();
  const notice = item.last_notice_outcome === null || item.last_notice_outcome === undefined ? null : oneOf(item.last_notice_outcome, noticeOutcomes);
  return {
    id: id.toLowerCase(),
    condition,
    subject,
    firstAt: instantOf(item.first_at),
    latestAt: instantOf(item.latest_at),
    resolvedAt: optionalInstantOf(item.resolved_at),
    detail: item.detail,
    lastSentAt: optionalInstantOf(item.last_sent_at),
    lastNoticeOutcome: notice,
    lastNoticeAt: optionalInstantOf(item.last_notice_at),
  };
}

export const maxResolvedListed = 50;
export const defaultResolvedListed = 10;

/**
 * api.list_alarms: every open alarm, newest first (at most 500), and, when `includeResolved` is true, the `limit` (1 to 50, ten by default) most recently
 * resolved ones after them. Each carries what its email state is read from (`lastSentAt`, `lastNoticeOutcome`, `lastNoticeAt`). Read-only.
 */
export async function listAlarms(input: {includeResolved?: boolean; limit?: number} = {}, options: AccountsOptions = {}): Promise<AlarmRecord[]> {
  const includeResolved = input.includeResolved ?? false;
  const limit = input.limit ?? defaultResolvedListed;
  if (typeof includeResolved !== 'boolean') throw new TypeError('includeResolved must be true or false');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxResolvedListed) throw new TypeError('limit must be a whole number from 1 to 50');
  const row = await callRow('list_alarms', {p_include_resolved: includeResolved, p_limit: limit}, options);
  if (!Array.isArray(row.alarms) || row.alarms.length > 500 + limit) throw unexpected();
  const alarms = row.alarms.map(alarmOf);
  // Open alarms come first, then resolved ones, and nothing resolved when none was asked for.
  const firstResolved = alarms.findIndex((alarm) => alarm.resolvedAt !== null);
  if (firstResolved !== -1 && (!includeResolved || alarms.slice(firstResolved).some((alarm) => alarm.resolvedAt === null) || alarms.length - firstResolved > limit)) throw unexpected();
  return alarms;
}

/** An alarm that is due an email: only what the mail holds (the condition, the subject, the first time and the detail, of which the mailer keeps the receipt keys). */
export type DueAlarm = {id: string; condition: string; subject: string | null; firstAt: string; detail: AlarmDetail};

export const maxDueMail = 50;

/** api.alarms_due_mail: the open alarms due an email, oldest first, at most `limit` (default and most: 50). Read-only. */
export async function alarmsDueMail(input: {limit?: number} = {}, options: AccountsOptions = {}): Promise<DueAlarm[]> {
  const limit = input.limit ?? maxDueMail;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxDueMail) throw new TypeError('limit must be a whole number from 1 to 50');
  const row = await callRow('alarms_due_mail', {p_limit: limit}, options);
  if (!Array.isArray(row.alarms) || row.alarms.length > limit) throw unexpected();
  return row.alarms.map((value: unknown) => {
    const alarm = alarmOf({...recordOf(value), latest_at: recordOf(value).first_at});
    return {id: alarm.id, condition: alarm.condition, subject: alarm.subject, firstAt: alarm.firstAt, detail: alarm.detail};
  });
}

/** api.record_alarm_notice: `recorded`, or `not_found` (no such alarm). */
export type AlarmNoticeReceipt = {outcome: 'recorded' | 'not_found'};

/** Records the outcome of one attempt to email an alarm. Only `sent` closes a 24-hour window; `failed` and `unknown` are retried at the next evaluation. */
export async function recordAlarmNotice(input: {alarmId: string; outcome: NoticeOutcome}, options: AccountsOptions = {}): Promise<AlarmNoticeReceipt> {
  const alarmId = requireUuid('alarmId', input.alarmId);
  if (!(noticeOutcomes as readonly unknown[]).includes(input.outcome)) throw new TypeError('outcome must be sent, failed or unknown');
  const row = await callRow('record_alarm_notice', {p_alarm_id: alarmId, p_outcome: input.outcome}, options);
  return {outcome: oneOf(row.outcome, ['recorded', 'not_found'] as const)};
}

/** What the database reports; the application adds `heartbeatConfigured` (lib/alarm-conditions.ts `Observations`). */
export type DatabaseObservations = Omit<Observations, 'heartbeatConfigured'>;

const optionalAge = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const age = count(value);
  if (age === null) throw unexpected();
  return age;
};

/**
 * api.alarm_observations: every number the registry of conditions looks at, as AGES IN SECONDS on the database clock (the application never compares its
 * own clock with the database's), the ledger backlog, how many Auth identities have no Account (the one place they are counted: the application never
 * names `auth.users`) and each task's newest finished receipt. Read-only.
 */
export async function alarmObservations(options: AccountsOptions = {}): Promise<DatabaseObservations> {
  const row = await callRow('alarm_observations', {}, options);
  const ledgerWaiting = count(row.ledger_pending);
  const unaccounted = count(row.unaccounted);
  const ledgerOldest = optionalAge(row.ledger_oldest);
  if (ledgerWaiting === null || unaccounted === null || !Array.isArray(row.tasks)) throw unexpected();
  // Nothing pending has no oldest, and something pending has one.
  if ((ledgerWaiting === 0) !== (ledgerOldest === null)) throw unexpected();
  const tasks = row.tasks.map((value: unknown) => {
    const item = recordOf(value);
    const task = text(item.task);
    const age = count(item.age);
    if (!task || !taskPattern.test(task) || age === null) throw unexpected();
    return {task, outcome: oneOf(item.outcome, jobOutcomes), at: instantOf(item.at), age};
  });
  return {
    firstReceiptAge: optionalAge(row.first_receipt_age),
    latestReceiptAge: optionalAge(row.latest_receipt_age),
    firstHeartbeatAge: optionalAge(row.first_heartbeat_age),
    latestHeartbeatAge: optionalAge(row.latest_heartbeat_age),
    ledgerWaiting,
    ledgerOldest,
    unaccounted,
    tasks,
  };
}

/** api.record_heartbeat: `recorded`, `duplicate` (this `jti` was accepted before) or `revoked` (the key is revoked). */
export type HeartbeatReceipt = {outcome: 'recorded' | 'duplicate' | 'revoked'};

/** Records a heartbeat of the Railway cron task, after the route has verified its token: the key ID and the token's `jti`. */
export async function recordHeartbeat(input: {kid: string; jti: string}, options: AccountsOptions = {}): Promise<HeartbeatReceipt> {
  if (typeof input.kid !== 'string' || !kidPattern.test(input.kid)) throw new TypeError('kid must be a key ID');
  if (typeof input.jti !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(input.jti)) throw new TypeError('jti must be 128 bits in base64url');
  const row = await callRow('record_heartbeat', {p_kid: input.kid, p_jti: input.jti}, options);
  return {outcome: oneOf(row.outcome, ['recorded', 'duplicate', 'revoked'] as const)};
}
