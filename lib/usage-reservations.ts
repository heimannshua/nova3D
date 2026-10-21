// Story 2.6. The application side of reserving bounded costs: typed calls to the three `api` functions that quote what a request may cost, reserve it against every
// limit in one transaction, and settle the reservation (quote_cost, reserve_cost, settle_cost) with the service role. This is the ONLY module that calls them
// (tests/unit/gate-structure.test.ts pins it), and it is one of the few that use the call helpers of lib/accounts.ts. NOTHING CALLS THIS MODULE YET, as nothing
// calls lib/job-records.ts: Story 2.5 adds the rate schedules, the provider adapters and the permission matching inside this admission, Story 2.7 reserves a Job's
// operations when it accepts the Job and makes a dispatch need a reservation, Story 2.8 reconciles ambiguous charges, sweeps the 24-hour deadline and clears overrun
// incidents, and Story 2.14 adds the credit funding split.
//
// SERVER-ONLY (it imports lib/accounts.ts, which holds the service-role key and refuses to load in a browser).
//
// The model, in the words of docs/authority-contract.md ("Reservations and settlements"):
//   A RESERVATION is the enforceable upper bound of ONE external operation (exactly one provider request), held in the Account's period and in the Job's lifetime
//   until it is settled, so every limit is checked against the same sums under one lock: the Account's allowance, the $5 cap of a Job across all its attempts and the
//   $1 cap of an operation. A SETTLEMENT releases the reservation entirely and records what happened: the usage evidence priced by the calculator (and, when it is
//   above the reservation, an overrun incident that blocks the provider for everyone until it is cleared), the reservation itself once an ambiguous charge is 24 hours
//   old, or nothing for a charge that was never made. Money is integer USD microdollars, a safe integer here and a `bigint` in SQL, never a float. There is ONE
//   calculator, in SQL: this module does no price arithmetic, it only carries the question and checks the answer.
//
// Reserving and quoting name the Account and its authorization epoch, both from the verified access (`operationOf`, lib/authority.ts), never from a request; the database
// begins them with `identity.assert_operation_authority`, so a disabled or deleted Account and a stale epoch are answered `denied`. Settling takes the Account alone:
// it records what already happened or releases what never went out, and refusing it for a disabled, stale or removed Account would strand the money.
//
// A command ID names ONE command: sent again with the same payload it answers the original record (`replayed`); with another payload it is `reused`. If a call throws
// an AccountsUnavailableError with `outcomeUnknown`, the command may or may not have been made: send the SAME command ID again, which is safe.
//
// Nothing here logs. An error that comes out of the database layer names the call and the HTTP status, never an amount or an ID.
import {callRow, oneOf, requireUuid, unexpected, type AccountsOptions, type Row} from '@/lib/accounts';
import type {Operation} from '@/lib/authority';
import {isMicrodollars} from '@/lib/usage-view';

// The recorded constants ----------------------------------------------------------------------------------------------------------------------

/**
 * The recorded constants, changeable only by a recorded decision. They live in SQL (the `usage.*` constant functions) and are mirrored here; a test holds the two
 * equal. Tokens, requests and microdollars; the deadline in hours.
 */
export const usageConstants = {
  /** Fixed overhead added to the input bound. */
  overheadTokens: 2000,
  /** Tokens added to the input bound for each image. */
  imageTokens: 5000,
  /** The margin the input bound is raised by, in percent. */
  marginPercent: 10,
  /** Admission ceiling of input tokens, applied to the raised bound. */
  inputCeiling: 200_000,
  /** Admission ceiling of output tokens. */
  outputCeiling: 16_000,
  /** Admission ceiling of requests of one operation. */
  requestCeiling: 20,
  /** The most one external operation may reserve: $1. */
  operationCap: 1_000_000,
  /** The most one Job may hold across all its attempts: $5. */
  jobCap: 5_000_000,
  /** How long an ambiguous charge holds its reservation before it settles at the reservation. */
  ambiguityDeadlineHours: 24,
} as const;

/** The largest single amount a reservation or a settlement carries, in microdollars: the database's bound. */
export const maxAmountMicrodollars = 1_000_000_000_000_000;

// The vocabularies ---------------------------------------------------------------------------------------------------------------------------

/** Why no bound is available for a request, in the order the calculator checks them. */
export const unavailableBoundReasons = [
  'unknown_rate',
  'foreign_rate',
  'foreign_currency',
  'unsupported_option',
  'over_input_ceiling',
  'over_output_ceiling',
  'over_request_ceiling',
  'overflow',
  'unpriced',
] as const;
export type UnavailableBoundReason = (typeof unavailableBoundReasons)[number];

/** The refusals that carry the exact cost block, in the order admission judges them (the bound first, the allowance last). */
export const costRefusals = ['unavailable_bound', 'provider_blocked', 'over_operation_cap', 'over_job_cap', 'insufficient_allowance'] as const;
export type CostRefusal = (typeof costRefusals)[number];

/** How a reservation is settled. */
export const settlementClassifications = ['evidence', 'deadline', 'noncharge', 'unused'] as const;
export type SettlementClassification = (typeof settlementClassifications)[number];

/** The states of an external operation (the Jobs module's, Story 2.11); a test holds this list equal to lib/job-records.ts. */
export const operationStates = ['planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned'] as const;
export type OperationState = (typeof operationStates)[number];

/** The states of an operation each classification can settle. */
export const settleableStates: Readonly<Record<SettlementClassification, readonly OperationState[]>> = {
  evidence: ['completed', 'ambiguous', 'settled'],
  deadline: ['ambiguous', 'settled'],
  noncharge: ['noncharge'],
  unused: ['abandoned'],
};

/** What a provider or model name looks like, and an API version (printable ASCII without spaces) and a returned model. */
export const wordPattern = /^[a-z][a-z0-9._-]{0,79}$/;
export const apiVersionPattern = /^[!-~]{1,100}$/;
export const returnedModelPattern = /^[!-~]{1,200}$/;

/** The most characters of an option key the database names in `detail`. */
export const maxOptionDetail = 100;

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
/** The largest an integer argument of the database is (a 32-bit integer). */
const maxInteger = 2_147_483_647;

// Checking what goes out and what comes back ------------------------------------------------------------------------------------------------

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

/** An amount in microdollars as the database answered it: a whole number, never above the largest a ledger row holds. */
function amountOf(value: unknown, minimum = 0): number {
  if (!isMicrodollars(value) || value < minimum || value > maxAmountMicrodollars) throw unexpected();
  return value;
}

function timeOf(value: unknown): string {
  const time = text(value);
  if (time === null || !timePattern.test(time) || Number.isNaN(Date.parse(time))) throw unexpected();
  return time;
}

function requireWord(name: string, value: unknown): string {
  if (typeof value !== 'string' || !wordPattern.test(value)) throw new TypeError(`${name} must be lower-case letters, digits, dots, underscores and hyphens, starting with a letter`);
  return value;
}

function requireApiVersion(value: unknown): string {
  if (typeof value !== 'string' || !apiVersionPattern.test(value)) throw new TypeError('apiVersion must be 1 to 100 printable ASCII characters without spaces');
  return value;
}

function requireSize(name: string, value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a whole number of at least 0`);
  if (value > maximum) throw new TypeError(`${name} must be at most ${maximum}`);
  return value;
}

/** A plain object: made by an object literal or `JSON.parse` (its prototype is `Object.prototype` or none), not a Map, a Date, a class instance or an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether a value is carried by JSON exactly as it is: a string, a boolean, a finite number, null, an array of such (with no hole) or a plain object of such with
 * string keys and ordinary enumerable data properties. Anything JSON would drop, change or refuse (undefined, a function, a symbol, a bigint, NaN, Infinity, a hole, a
 * getter, a non-plain prototype, a cycle) is not carried, and an option the database never saw must not look like an option that was not given.
 */
function isCarriedByJson(value: unknown, path: object[]): boolean {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (value === null) return true;
      if (path.includes(value)) return false;
      const below = [...path, value];
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          if (!(index in value) || !isCarriedByJson(value[index], below)) return false;
        }
        return Reflect.ownKeys(value).every((key) => key === 'length' || (typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key)));
      }
      if (!isPlainObject(value)) return false;
      return Reflect.ownKeys(value).every((key) => {
        if (typeof key !== 'string') return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && descriptor.enumerable === true && 'value' in descriptor && isCarriedByJson(descriptor.value, below);
      });
    }
    default:
      return false;
  }
}

/**
 * What the request is: the options object. No option is supported, so any key is refused by the calculator (`unsupported_option`), but what is sent must be exactly what
 * was given: a plain JSON object whose every value, at any depth, JSON carries as it is. `{cache: undefined}` would reach SQL as `{}` (no option) and is refused here.
 */
function requireOptions(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new TypeError('options must be a plain object');
  if (!isCarriedByJson(value, [])) throw new TypeError('options must hold only values JSON carries as they are (no undefined, function, symbol, bigint, NaN or Infinity)');
  return value;
}

type Calculation = {
  rateScheduleId: string;
  provider: string;
  model: string;
  apiVersion: string;
  requestBytes: number;
  imageCount: number;
  outputLimit: number;
  options?: Record<string, unknown>;
};

/** The arguments the calculator shares between a quote and a reservation, checked before anything is sent. */
function calculationArguments(input: Calculation) {
  return {
    p_rate_schedule_id: requireUuid('rateScheduleId', input.rateScheduleId),
    p_provider: requireWord('provider', input.provider),
    p_model: requireWord('model', input.model),
    p_api_version: requireApiVersion(input.apiVersion),
    p_request_bytes: requireSize('requestBytes', input.requestBytes),
    p_image_count: requireSize('imageCount', input.imageCount, maxInteger),
    p_output_limit: requireSize('outputLimit', input.outputLimit, maxInteger),
  };
}

/** The reason a bound is unavailable, and the option key it names (only for an unsupported option). */
function boundRefusalOf(row: Row): {reason: UnavailableBoundReason; detail: string | null} {
  const reason = oneOf(row.reason, unavailableBoundReasons);
  const detail = row.detail === null || row.detail === undefined ? null : text(row.detail);
  if (row.detail !== null && row.detail !== undefined && detail === null) throw unexpected();
  // Only an unsupported option names a key, and it always does.
  if ((reason === 'unsupported_option') !== (detail !== null)) throw unexpected();
  // (An option key can be empty: JSON allows it, and the calculator names it all the same.)
  // (The database counts characters, as the code points of a string do; .length counts UTF-16 units, so an astral character would count twice.)
  if (detail !== null && [...detail].length > maxOptionDetail) throw unexpected();
  return {reason, detail};
}

// Quote ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * What api.quote_cost answers. `quoted`: the provider-independent input bound in tokens, the billed units (rounded up to the schedule's increments) and the price in
 * microdollars, rounded up once. `unavailable_bound`: no bound is available, with the reason (and the option key for an unsupported option). `denied`: the Account has
 * no authority for this request.
 */
export type CostQuote =
  | {outcome: 'quoted'; inputBound: number; inputUnits: number; outputUnits: number; microdollars: number}
  | {outcome: 'unavailable_bound'; reason: UnavailableBoundReason; detail: string | null}
  | {outcome: 'denied'};

/**
 * What a bounded request costs under a pinned rate schedule: the input bound (the byte length of the request with image data excluded, plus 2,000 tokens, plus 5,000
 * for each image, raised by 10%), the billed units and the microdollars. Read-only: it reserves nothing, writes nothing and takes no lock. `requestCount` is the
 * number of requests of one operation (1 unless a search prices several). No option is supported: any key in `options` is an `unsupported_option`.
 */
export async function quoteCost(
  operation: Operation,
  input: Calculation & {requestCount?: number},
  options: AccountsOptions = {},
): Promise<CostQuote> {
  const requestCount = input.requestCount ?? 1;
  if (typeof requestCount !== 'number' || !Number.isSafeInteger(requestCount) || requestCount < 1 || requestCount > maxInteger) throw new TypeError('requestCount must be a whole number of at least 1');
  const row = await callRow(
    'quote_cost',
    {
      p_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      ...calculationArguments(input),
      p_request_count: requestCount,
      p_options: requireOptions(input.options),
    },
    options,
  );
  const outcome = oneOf(row.outcome, ['quoted', 'unavailable_bound', 'denied'] as const);
  if (outcome === 'denied') return {outcome};
  if (outcome === 'unavailable_bound') return {outcome, ...boundRefusalOf(row)};
  // A quote is above the ceiling of nothing: the bound is within the admission ceiling, and the price is a real amount.
  const inputBound = wholeNumber(row.input_bound);
  const inputUnits = wholeNumber(row.input_units);
  const outputUnits = wholeNumber(row.output_units);
  if (inputBound === null || inputBound < 1 || inputBound > usageConstants.inputCeiling || inputUnits === null || inputUnits < inputBound || outputUnits === null) throw unexpected();
  return {outcome, inputBound, inputUnits, outputUnits, microdollars: amountOf(row.microdollars, 1)};
}

// Reserve -------------------------------------------------------------------------------------------------------------------------------------

/** A reservation as the database holds it: the enforceable upper bound of one external operation. */
export type Reservation = {
  id: string;
  operationId: string;
  jobId: string;
  /** The allowance period the reservation was made in. */
  periodId: string;
  /** The rate schedule the operation is pinned to. */
  rateScheduleId: string;
  /** The provider-independent input bound in tokens. */
  inputBound: number;
  reservedMicrodollars: number;
};

/**
 * The exact cost block a refusal carries: what was `requested` (the reserved amount the request needs; null when no bound could be computed), the cap or `limit` that
 * applies, what is `used` against it and what is `available` under it. The limit is the operation cap for `over_operation_cap`, the Job cap for `over_job_cap` and the
 * Account's limit for the other refusals. All in microdollars.
 */
export type CostBlock = {requested: number | null; limit: number; used: number; available: number};

/**
 * What api.reserve_cost answers.
 *  - `reserved`: one reservation, in the current period. `replayed`: the same command sent again, or another command ID with the same payload for an operation that already
 *    holds the reservation: the original reservation, nothing made now. `already_reserved`: another payload for an operation that already holds a reservation (it carries it).
 *  - `reused`: the command ID was used for another payload. `denied`: the Account has no authority for this request. `unavailable`: the operation is another Account's,
 *    unknown, or of a deleted Project: ONE answer with nothing in it. `not_reservable`: the operation is not `planned` (it carries its state).
 *  - the money refusals, each with the cost block and no reservation, settlement, incident or receipt written (the month may have turned first): `unavailable_bound` (with the reason), `provider_blocked` (an uncleared overrun incident of the
 *    provider, whichever Account it was of), `over_operation_cap`, `over_job_cap`, `insufficient_allowance`.
 */
export type CostReservation =
  | {outcome: 'reserved' | 'replayed' | 'already_reserved'; reservation: Reservation}
  | {outcome: 'reused' | 'denied' | 'unavailable'}
  | {outcome: 'not_reservable'; state: OperationState}
  | {outcome: 'unavailable_bound'; reason: UnavailableBoundReason; detail: string | null; cost: CostBlock}
  | {outcome: 'provider_blocked' | 'over_operation_cap' | 'over_job_cap' | 'insufficient_allowance'; cost: CostBlock};

function reservationOf(row: Row): Reservation {
  const inputBound = wholeNumber(row.input_bound);
  if (inputBound === null || inputBound < 1) throw unexpected();
  return {
    id: uuidOf(row.reservation_id),
    operationId: uuidOf(row.operation_id),
    jobId: uuidOf(row.job_id),
    periodId: uuidOf(row.period_id),
    rateScheduleId: uuidOf(row.rate_schedule_id),
    inputBound,
    reservedMicrodollars: amountOf(row.reserved_microdollars, 1),
  };
}

/** The cost block of a refusal, checked against the amounts the refusal says exceeded it. */
function costBlockOf(row: Row, outcome: CostRefusal): CostBlock {
  const requested = row.requested_microdollars === null || row.requested_microdollars === undefined ? null : amountOf(row.requested_microdollars, 1);
  const limit = amountOf(row.limit_microdollars);
  const used = amountOf(row.used_microdollars);
  const available = amountOf(row.available_microdollars);
  // Only a request with no bound has no requested amount; every other refusal is about an amount.
  if ((outcome === 'unavailable_bound') !== (requested === null)) throw unexpected();
  if (outcome === 'over_operation_cap' && (limit !== usageConstants.operationCap || used !== 0 || available !== limit || requested === null || requested <= limit)) throw unexpected();
  if (outcome === 'over_job_cap' && (limit !== usageConstants.jobCap || available !== Math.max(limit - used, 0) || requested === null || requested + used <= limit)) throw unexpected();
  if (outcome === 'insufficient_allowance' && (requested === null || requested <= available)) throw unexpected();
  // The allowance reconciles with its limit: what is available is what is left of it, never below 0.
  if (outcome === 'insufficient_allowance' || outcome === 'provider_blocked' || outcome === 'unavailable_bound') {
    if (available !== Math.max(limit - used, 0)) throw unexpected();
  }
  return {requested, limit, used, available};
}

/**
 * Reserves the enforceable maximum cost of ONE external operation (exactly one provider request) in one transaction, against the Account's allowance, the Job's $5 cap
 * across all its attempts and the $1 cap of the operation. The operation must be `planned`. The reserved amount is the calculator's: the input bound times the input
 * rate plus the output limit times the output rate under the pinned rate schedule, rounded up once. A refusal writes no reservation, settlement, incident or receipt (the month may turn first: the period rolls over when work is first asked for) and carries the exact cost block, so no
 * external side effect can follow it. Refusals are judged in this order: the bound, the provider, the operation cap, the Job cap, the allowance.
 */
export async function reserveCost(
  operation: Operation,
  input: Calculation & {commandId: string; operationId: string},
  options: AccountsOptions = {},
): Promise<CostReservation> {
  const operationId = requireUuid('operationId', input.operationId);
  const row = await callRow(
    'reserve_cost',
    {
      p_account_id: requireOperation(operation),
      p_epoch: operation.epoch,
      p_command_id: requireUuid('commandId', input.commandId),
      p_operation_id: operationId,
      ...calculationArguments(input),
      p_options: requireOptions(input.options),
    },
    options,
  );
  const outcome = oneOf(row.outcome, [
    'reserved',
    'replayed',
    'already_reserved',
    'reused',
    'denied',
    'unavailable',
    'not_reservable',
    ...costRefusals,
  ] as const);
  switch (outcome) {
    case 'reused':
    case 'denied':
    case 'unavailable':
      return {outcome};
    case 'not_reservable': {
      const state = oneOf(row.state, operationStates);
      // Only an operation that is not planned is not reservable.
      if (state === 'planned') throw unexpected();
      return {outcome, state};
    }
    case 'unavailable_bound':
      return {outcome, ...boundRefusalOf(row), cost: costBlockOf(row, outcome)};
    case 'provider_blocked':
    case 'over_operation_cap':
    case 'over_job_cap':
    case 'insufficient_allowance':
      return {outcome, cost: costBlockOf(row, outcome)};
    default: {
      const reservation = reservationOf(row);
      // The reservation is for the operation that was asked about, and the cost block is a refusal's: an answer that holds a reservation holds none.
      if (reservation.operationId !== operationId) throw unexpected();
      if ([row.requested_microdollars, row.limit_microdollars, row.used_microdollars, row.available_microdollars].some((value) => value !== null && value !== undefined)) throw unexpected();
      // What admission reserved is within the operation cap and the ceiling of the input bound. (A reservation that is returned again is as it was made.)
      if (outcome === 'reserved' && (reservation.reservedMicrodollars > usageConstants.operationCap || reservation.inputBound > usageConstants.inputCeiling)) throw unexpected();
      return {outcome, reservation};
    }
  }
}

// Settle --------------------------------------------------------------------------------------------------------------------------------------

/** A settlement as the database holds it: the whole reservation released and what happened settled. */
export type Settlement = {
  id: string;
  reservationId: string;
  operationId: string;
  /** The allowance period the settlement was made in, which may be later than the reservation's. */
  periodId: string;
  classification: SettlementClassification;
  settledMicrodollars: number;
  /** Always the reservation's whole amount. */
  releasedMicrodollars: number;
  /** How far the settled amount was above the reservation (settled - released), else 0. */
  overMicrodollars: number;
  /** The overrun incident the evidence made, when it was above the reservation. */
  incidentId: string | null;
};

/**
 * What api.settle_cost answers.
 *  - `settled`: one settlement in the current period (and, when the evidence was above the reservation, one overrun incident). `replayed`: the same command sent again, or
 *    another command ID with the same classification and evidence: the original settlement. `already_settled`: another classification or evidence for a reservation that
 *    is already settled (it carries the settlement).
 *  - `reused`: the command ID was used for another payload. `unavailable`: the operation is another Account's or unknown. `not_reserved`: the operation holds no
 *    reservation. `not_settleable`: the operation's state does not fit the classification (it carries it). `not_due`: a deadline settlement before 24 hours after the
 *    outcome (it carries the time it is due). `invalid_evidence`: the evidence prices above the largest amount.
 */
export type CostSettlement =
  | {outcome: 'settled' | 'replayed' | 'already_settled'; settlement: Settlement}
  | {outcome: 'reused' | 'unavailable' | 'not_reserved'}
  | {outcome: 'not_settleable'; state: OperationState}
  | {outcome: 'not_due'; dueAt: string}
  | {outcome: 'invalid_evidence'; reason: 'overflow'};

/** The evidence of a charge: what the provider's usage report said, and the model it says served the request. */
export type UsageEvidence = {inputTokens: number; outputTokens: number; returnedModel: string};

function settlementOf(row: Row, operationId: string): Settlement {
  const classification = oneOf(row.classification, settlementClassifications);
  const settled = amountOf(row.settled_microdollars);
  const released = amountOf(row.released_microdollars, 1);
  const over = amountOf(row.over_microdollars);
  const incidentId = row.incident_id === null || row.incident_id === undefined ? null : uuidOf(row.incident_id);
  // The over amount is exactly what the settlement is above the whole reservation it released, and it is the only thing that makes an incident.
  if (over !== Math.max(settled - released, 0) || (over > 0) !== (incidentId !== null)) throw unexpected();
  // What each classification settles: the evidence at its price, the whole reservation at the deadline, nothing for a charge never made.
  if (classification === 'deadline' && settled !== released) throw unexpected();
  if ((classification === 'noncharge' || classification === 'unused') && settled !== 0) throw unexpected();
  const settlement = {
    id: uuidOf(row.settlement_id),
    reservationId: uuidOf(row.reservation_id),
    operationId: uuidOf(row.operation_id),
    periodId: uuidOf(row.period_id),
    classification,
    settledMicrodollars: settled,
    releasedMicrodollars: released,
    overMicrodollars: over,
    incidentId,
  };
  if (settlement.operationId !== operationId) throw unexpected();
  return settlement;
}

/**
 * Settles the reservation of an operation, once. `evidence` prices the provider's usage report with the calculator at the pinned schedule (the operation is `completed`,
 * `ambiguous` or `settled`) and needs `evidence`; `deadline` settles an ambiguous charge at the reservation, 24 hours after its outcome was recorded; `noncharge` (the
 * operation is `noncharge`) and `unused` (the operation is `abandoned`) settle nothing. Every class releases the reservation's whole amount. Evidence above the reservation
 * settles at the evidence, counts against the period and the Job cap, and blocks that provider for every Account until the incident is cleared (Story 2.8).
 *
 * It takes the Account alone, with no epoch: settling records what already happened or releases what never went out, and is not refused for a disabled, stale or removed
 * Account. The database still refuses an operation that is not the Account's.
 */
export async function settleCost(
  account: Pick<Operation, 'accountId'>,
  input: {commandId: string; operationId: string; classification: SettlementClassification; evidence?: UsageEvidence | null},
  options: AccountsOptions = {},
): Promise<CostSettlement> {
  if (!(settlementClassifications as readonly string[]).includes(input.classification)) throw new TypeError('classification must be evidence, deadline, noncharge or unused');
  const evidence = input.evidence ?? null;
  if ((input.classification === 'evidence') !== (evidence !== null)) throw new TypeError('evidence goes with the classification evidence and with no other');
  if (evidence !== null) {
    requireSize('inputTokens', evidence.inputTokens);
    requireSize('outputTokens', evidence.outputTokens);
    if (typeof evidence.returnedModel !== 'string' || !returnedModelPattern.test(evidence.returnedModel)) throw new TypeError('returnedModel must be 1 to 200 printable ASCII characters without spaces');
  }
  const operationId = requireUuid('operationId', input.operationId);
  const row = await callRow(
    'settle_cost',
    {
      p_account_id: requireUuid('accountId', account.accountId),
      p_command_id: requireUuid('commandId', input.commandId),
      p_operation_id: operationId,
      p_classification: input.classification,
      p_input_tokens: evidence?.inputTokens ?? null,
      p_output_tokens: evidence?.outputTokens ?? null,
      p_returned_model: evidence?.returnedModel ?? null,
    },
    options,
  );
  const outcome = oneOf(row.outcome, [
    'settled',
    'replayed',
    'reused',
    'already_settled',
    'not_reserved',
    'not_settleable',
    'not_due',
    'invalid_evidence',
    'unavailable',
  ] as const);
  switch (outcome) {
    case 'reused':
    case 'unavailable':
    case 'not_reserved':
      return {outcome};
    case 'not_settleable': {
      const state = oneOf(row.state, operationStates);
      // The operation's state does not fit the classification that was asked for.
      if (settleableStates[input.classification].includes(state)) throw unexpected();
      return {outcome, state};
    }
    case 'not_due':
      // Only a deadline settlement waits.
      if (input.classification !== 'deadline') throw unexpected();
      return {outcome, dueAt: timeOf(row.due_at)};
    case 'invalid_evidence':
      // Only evidence can be invalid, and only by pricing above the largest amount.
      if (input.classification !== 'evidence' || row.reason !== 'overflow') throw unexpected();
      return {outcome, reason: 'overflow'};
    default: {
      const settlement = settlementOf(row, operationId);
      // A settlement made now is of the class that was asked for. (A replayed or earlier one may be of another.)
      if (outcome === 'settled' && settlement.classification !== input.classification) throw unexpected();
      if (outcome === 'replayed' && settlement.classification !== input.classification) throw unexpected();
      return {outcome, settlement};
    }
  }
}
