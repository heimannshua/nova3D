// Story 2.4. The application side of Usage: typed calls to the three `api` functions of the usage limits (list, change or reset a limit, record a
// refused change) with the service role. This is the ONLY module that calls them (tests/unit/gate-structure.test.ts pins it), and it is
// one of the few that use the call helpers of lib/accounts.ts.
//
// SERVER-ONLY (it imports lib/accounts.ts, which holds the service-role key and refuses to load in a browser). A client component takes a row from
// its page as a plain `UsageRow` (lib/usage-view.ts) and never imports this file.
//
// Money is integer USD microdollars, a safe integer here and a `bigint` in SQL: an amount that is not a whole number, or not in range, is not an
// answer. The settled and reserved figures come out of the database as the amounts to SHOW (what was carried in plus the period's figure), and
// until Story 2.6 builds the ledgers they come from one stand-in that is zero in every real environment.
//
// The fresh administration marker is not checked here: lib/administered.ts is the only gate. Every call names the Administrator's Account and
// epoch, both from the verified access (`operationOf`), never from a request; the database begins every function with
// `identity.assert_operation_authority`, so a disabled Administrator and a stale epoch are refused there as well, and answered `denied`.
//
// Nothing here logs. An error that comes out of the database layer names the call and the HTTP status, never an amount or an ID.
import {callRow, oneOf, requireUuid, unexpected, type AccountsOptions, type Row} from '@/lib/accounts';
import type {Operation} from '@/lib/authority';
import {isLimit, isMicrodollars, usageCauses, type UsageCause, type UsageRow} from '@/lib/usage-view';

export type {UsageRow};

/** The most Accounts a read carries: the 200 newest, as in the Accounts list. */
export const maxUsageListed = 200;

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const wholeNumber = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null);
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireOperation(operation: Operation) {
  if (!Number.isSafeInteger(operation.epoch) || operation.epoch < 1) throw new TypeError('epoch must be a positive integer');
  return requireUuid('accountId', operation.accountId);
}

/** A row of the list as the database returned it, checked: a row that is not shaped like one is no answer, and no number is invented. */
function rowOf(value: unknown): UsageRow {
  const row = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Row;
  const accountId = text(row.account_id);
  const seq = wholeNumber(row.seq);
  const monthStart = text(row.month_start);
  const limit = row.limit_microdollars;
  const settled = row.settled_microdollars;
  const reserved = row.reserved_microdollars;
  if (!accountId || !idPattern.test(accountId) || seq === null || seq < 1 || !monthStart || !monthPattern.test(monthStart) || !isLimit(limit) || !isMicrodollars(settled) || !isMicrodollars(reserved)) throw unexpected();
  const email = row.email === null || row.email === undefined ? null : text(row.email);
  if (row.email !== null && row.email !== undefined && email === null) throw unexpected();
  return {
    accountId: accountId.toLowerCase(),
    email,
    role: oneOf(row.role, ['administrator', 'member'] as const),
    status: oneOf(row.status, ['active', 'disabled'] as const),
    seq,
    monthStart,
    limit,
    settled,
    reserved,
    cause: oneOf(row.cause, usageCauses),
  };
}

// The read ---------------------------------------------------------------------------------------------------------------------------------

/** `listed`: each Account's current period (at most 200, newest Account first). `denied`: the caller is not an active Administrator; nothing is listed. */
export type UsageList = {outcome: 'listed'; rows: UsageRow[]} | {outcome: 'denied'};

/**
 * Each Account's current usage period, for the Administrator (Story 2.4): the month, the limit and the shown settled and reserved amounts, with
 * the Account's address, role and status, and nothing else. The database rolls the month over first, so a new UTC month shows its own period.
 * Fails closed: if the database cannot be reached, or answers nonsense, this throws, and the page says it could not load; it never shows an empty
 * list, or a number, in place of a list it could not read.
 */
export async function listUsage(operation: Operation, options: AccountsOptions = {}): Promise<UsageList> {
  const row = await callRow('list_usage', {p_admin_account_id: requireOperation(operation), p_epoch: operation.epoch}, options);
  const outcome = oneOf(row.outcome, ['listed', 'denied'] as const);
  if (outcome === 'denied') return {outcome};
  if (!Array.isArray(row.accounts) || row.accounts.length > maxUsageListed) throw unexpected();
  const rows = row.accounts.map(rowOf);
  // The same Account twice is not a list.
  if (new Set(rows.map((entry) => entry.accountId)).size !== rows.length) throw unexpected();
  return {outcome, rows};
}

// The command --------------------------------------------------------------------------------------------------------------------------------

/** The period a command made, or the current one an answer is about. */
export type UsagePeriod = {seq: number; monthStart: string; limit: number; previousLimit: number | null; cause: UsageCause};

/**
 * What api.set_usage_limit answers. `changed`, `reset` and `replayed` (the same command sent again: the same period, nothing changed now) carry the
 * period the command made. `unchanged` (a change to the limit it already has) and `stale` (the person saw an older period) carry the Account's
 * CURRENT period and changed nothing. The others carry nothing and changed nothing: `reused` (the command ID was used for another payload),
 * `invalid_limit` (out of range, not whole cents, missing for a change or given for a reset), `disabled`, `not_found` and `denied`.
 */
export type UsageLimitReceipt =
  | {outcome: 'changed' | 'reset' | 'replayed' | 'unchanged' | 'stale'; period: UsagePeriod}
  | {outcome: 'reused' | 'invalid_limit' | 'disabled' | 'not_found' | 'denied'};

export const usageCommandKinds = ['change', 'reset'] as const;
export type UsageCommandKind = (typeof usageCommandKinds)[number];

const requireActor = (actor: string) => {
  if (typeof actor !== 'string' || !/^user:[A-Za-z0-9_-]{1,64}$/.test(actor)) throw new TypeError('actor must be user:<Auth user ID>');
};

function periodOf(row: Row): UsagePeriod {
  const seq = wholeNumber(row.seq);
  const monthStart = text(row.month_start);
  const limit = row.limit_microdollars;
  if (seq === null || seq < 1 || !monthStart || !monthPattern.test(monthStart) || !isLimit(limit)) throw unexpected();
  const previous = row.previous_limit_microdollars;
  if (previous !== null && previous !== undefined && !isLimit(previous)) throw unexpected();
  return {seq, monthStart, limit, previousLimit: previous ?? null, cause: oneOf(row.cause, usageCauses)};
}

/**
 * Changes an Account's monthly limit, or resets its count, by appending a successor period that carries the liabilities (Story 2.4). The actor
 * (`user:<Auth user ID>`) is the verified Administrator's, taken by the caller from the session and never from input; the caller has already checked
 * the role and the fresh administration marker. `expectedSeq` is the period the person saw. A `change` carries the new limit in microdollars (whole
 * cents); a `reset` carries none. A command ID names ONE command: sent again with the same payload it answers the original period (`replayed`), and
 * with another payload it is `reused`. If this throws an AccountsUnavailableError with `outcomeUnknown`, the command may or may not have been made:
 * read the list before trying again (or send the same command ID again, which is safe).
 */
export async function setUsageLimit(
  operation: Operation,
  input: {actor: string; targetAccountId: string; commandId: string; kind: UsageCommandKind; limit: number | null; expectedSeq: number},
  options: AccountsOptions = {},
): Promise<UsageLimitReceipt> {
  requireActor(input.actor);
  if (!(usageCommandKinds as readonly string[]).includes(input.kind)) throw new TypeError('kind must be change or reset');
  if (!Number.isSafeInteger(input.expectedSeq) || input.expectedSeq < 1) throw new TypeError('expectedSeq must be a positive integer');
  // A change names a limit in whole cents and a reset names none. (The database judges the limit as well, and answers `invalid_limit`.)
  if (input.kind === 'reset' ? input.limit !== null : !Number.isSafeInteger(input.limit)) throw new TypeError('a change needs a limit in microdollars and a reset needs none');
  const row = await callRow(
    'set_usage_limit',
    {
      p_actor: input.actor,
      p_admin_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      p_target_account_id: requireUuid('targetAccountId', input.targetAccountId),
      p_command_id: requireUuid('commandId', input.commandId),
      p_kind: input.kind,
      p_limit_microdollars: input.limit,
      p_expected_seq: input.expectedSeq,
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['changed', 'reset', 'replayed', 'unchanged', 'stale', 'reused', 'invalid_limit', 'disabled', 'not_found', 'denied'] as const);
  switch (outcome) {
    case 'changed':
    case 'reset':
    case 'replayed':
    case 'unchanged':
    case 'stale': {
      const period = periodOf(row);
      // A successor is the next period of the one the person saw; an answer that is not is not an answer.
      if ((outcome === 'changed' || outcome === 'reset') && period.seq !== input.expectedSeq + 1) throw unexpected();
      if ((outcome === 'changed' && period.cause !== 'change') || (outcome === 'reset' && period.cause !== 'reset')) throw unexpected();
      return {outcome, period};
    }
    default:
      return {outcome};
  }
}

// Refusals -------------------------------------------------------------------------------------------------------------------------------

/**
 * The refusals of a usage-limit change that api.record_usage_refusal records: an Administrator who tried to change or reset a limit without a valid
 * fresh administration marker, and an Account that is not an Administrator who tried either.
 */
export const usageRefusalActions = ['usage.limit_refused', 'usage.denied'] as const;
export type UsageRefusalAction = (typeof usageRefusalActions)[number];
/** `recorded` (a new audit event) or `repeated` (the same refusal was recorded in the last hour; nothing was written). */
export const usageRefusalOutcomes = ['recorded', 'repeated'] as const;
export type UsageRefusalOutcome = (typeof usageRefusalOutcomes)[number];

/**
 * Records a refused usage-limit change in the audit trail: the actor (`user:<id>`, built by the database from the verified Auth user the server passes,
 * never from input) and, when it exists, the Account the attempt named as the target. It records no limit, amount, marker outcome or reason text, and
 * takes none. Once an hour per actor, action and target. The application has already refused the change when it calls this: a failure to record is
 * logged by the caller and never turns the refusal into a permission.
 */
export async function recordUsageRefusal(
  input: {userId: string; action: UsageRefusalAction; accountId?: string | null},
  options: AccountsOptions = {},
): Promise<UsageRefusalOutcome> {
  if (!(usageRefusalActions as readonly string[]).includes(input.action)) throw new TypeError('action must be one of the usage refusal actions');
  const row = await callRow(
    'record_usage_refusal',
    {
      p_user_id: requireUuid('userId', input.userId),
      p_action: input.action,
      p_target_account_id: input.accountId == null ? null : requireUuid('accountId', input.accountId),
    },
    options,
  );
  return oneOf(row.outcome, usageRefusalOutcomes);
}
