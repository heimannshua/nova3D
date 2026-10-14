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
// SERVER-ONLY (it imports lib/accounts.ts, which holds the service-role key). Like lib/accounts.ts and lib/authority.ts it uses
// erasable TypeScript syntax and relative `.ts` imports, so a worker outside Next.js can import it through Node type stripping.
//
// Every answer is checked: a reply that is not shaped like an answer is no answer, and the caller treats no answer as a denial.
// Nothing here logs, and no error message holds an ID, a handle or a hash.
import {callRow, hashClientAddress, hashKey, oneOf, operationOutcomes, requireUuid, unexpected, type AccountsOptions, type OperationOutcome, type Row} from './accounts.ts';
import {isHiddenState, type HiddenState} from './hidden-state.ts';

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
