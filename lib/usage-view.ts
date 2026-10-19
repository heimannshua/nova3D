// Story 2.4. What the Administrator's Usage and limits page (app/admin/usage), its two Server Actions (actions.ts beside it) and the
// components under components/admin agree on, with nothing that reaches the server: a row, the money (parsed and written by one
// deterministic pair of functions), the state of a limit by integer arithmetic only, the figures that must reconcile, the meter, the
// state an action answers with, how a call that did not answer is read, and the words for each answer. A client component imports this
// file, so it imports no Node or Next.js server code and not lib/accounts.ts or lib/usage.ts.
//
// MONEY is integer USD microdollars: a safe integer in TypeScript (`bigint` in SQL), never a float. A limit is from $0 to $10,000 in whole
// cents (a cent is 10,000 microdollars). Dollars appear on screen only through `formatDollars`, which uses no `Intl` and no locale, so the
// same amount is the same text on the server and in the browser; a screen shows it as an LTR token so Hebrew cannot reorder it.
//
// FIGURES. Shown settled = what was carried in + the period's settled figure; shown reserved likewise (the database does that sum and
// the page receives the shown amounts). Used = settled + reserved. Available = the limit less what is used, never below 0. When used
// exceeds the limit the amount over is shown too, so the amounts always reconcile: settled + reserved + available = limit, or
// limit + over = used.
import {attemptAdministeredAction} from '@/lib/administration';
import {isolateLtr, type MessageKey} from '@/lib/i18n';
import {reloadHere} from '@/lib/session-actions';

export {newCommandId} from '@/lib/project-view';

// Money -----------------------------------------------------------------------------------------------------------------------------------

/** A cent, in microdollars. A limit is a whole number of cents. */
export const microdollarsPerCent = 10_000;
/** A dollar, in microdollars. */
export const microdollarsPerDollar = 1_000_000;
/** The ceiling of a limit: $10,000. */
export const maxLimitMicrodollars = 10_000_000_000;
/** The largest figure a period may carry (a safe integer with room to add): the database's bound. */
export const maxFigureMicrodollars = 1_000_000_000_000_000;

/** An amount of microdollars that can be stored and added: a whole number from 0 up to twice the largest figure. */
export function isMicrodollars(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2 * maxFigureMicrodollars;
}

/** Whether a limit is one the database accepts: whole cents from 0 to the ceiling. */
export function isLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maxLimitMicrodollars && value % microdollarsPerCent === 0;
}

const groupThousands = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Microdollars as dollars: `$25.00`, `$10,000.00`, `$0.00`. Two decimals for a whole number of cents (every limit is one), and the exact
 * amount, up to six decimals, for one that is not (`$19.999999`), so the amounts on a card always add up exactly. No `Intl`, no locale.
 * Anything that is not a whole number of microdollars is refused (a RangeError), never rounded.
 */
export function formatDollars(microdollars: number): string {
  if (!Number.isSafeInteger(microdollars)) throw new RangeError('microdollars must be a whole number');
  const sign = microdollars < 0 ? '-' : '';
  const absolute = Math.abs(microdollars);
  const whole = Math.floor(absolute / microdollarsPerDollar);
  const fraction = absolute % microdollarsPerDollar;
  let decimals = String(fraction).padStart(6, '0');
  decimals = fraction % microdollarsPerCent === 0 ? decimals.slice(0, 2) : decimals.replace(/0+$/, '');
  return `${sign}$${groupThousands(String(whole))}.${decimals}`;
}

/** Why a typed limit is not a limit; each has its own message and its own remedy. */
export type LimitProblem = 'empty' | 'format' | 'negative' | 'cents' | 'range';

export type ParsedLimit = {ok: true; microdollars: number} | {ok: false; problem: LimitProblem};

/**
 * A typed dollar amount as a limit in microdollars, or why it is not one. Accepts `40`, `40.5`, `40.50`, `$40.50` and `1,000.00`; whole
 * cents only (`12.345` is `cents`, though `12.340` is `12.34`); not negative; from $0 up to $10,000. Anything that is not text, and
 * text with a letter or a symbol in it, is `format`; nothing (or only spaces) is `empty`. The text is folded with Unicode NFKC first, so a full-width digit
 * (`１２`) counts as the digit it is, while digits of other scripts (Arabic-Indic `١٢`) do not fold and are `format`. A number written with more than
 * `maxTypedLength` (64) characters, leading zeros and separators included, is `range` without any arithmetic being done on it: no limit is written that long.
 */
export const maxTypedLength = 64;

export function parseDollars(input: unknown): ParsedLimit {
  if (typeof input !== 'string') return {ok: false, problem: 'empty'};
  const typed = input.normalize('NFKC').trim().replace(/^\$\s*/, '');
  if (typed === '') return {ok: false, problem: 'empty'};
  if (typed.startsWith('-')) return {ok: false, problem: /^-\s*\$?\s*[\d,]*\.?\d*$/.test(typed) && /\d/.test(typed) ? 'negative' : 'format'};
  const match = /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/.exec(typed);
  if (!match || !/\d/.test(typed)) return {ok: false, problem: 'format'};
  // Refused before any BigInt is made of it: an oversized digit string costs a length check, not arithmetic.
  if (typed.length > maxTypedLength) return {ok: false, problem: 'range'};
  const whole = match[1].replace(/,/g, '') || '0';
  const fraction = match[2] ?? '';
  // More than two decimals is only fine when the rest are zeros: 12.340 is 12.34, 12.345 is not a whole number of cents.
  if (fraction.length > 2 && !/^0+$/.test(fraction.slice(2))) return {ok: false, problem: 'cents'};
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
  if (cents > BigInt(maxLimitMicrodollars / microdollarsPerCent)) return {ok: false, problem: 'range'};
  return {ok: true, microdollars: Number(cents) * microdollarsPerCent};
}

/**
 * The smallest and largest limit as the messages that name them take them ({min} and {max}): written by `formatDollars`, the one formatter, and isolated so Hebrew
 * cannot reorder them. No message holds a number of dollars of its own.
 */
export function limitBounds(): {min: string; max: string} {
  return {min: isolateLtr(formatDollars(0)), max: isolateLtr(formatDollars(maxLimitMicrodollars))};
}

/** The catalog key of the message for a typed limit that is not one. Its message may name the bounds: pass `limitBounds()`. */
export const limitProblemKeys = {
  empty: 'usage.error.empty',
  format: 'usage.error.format',
  negative: 'usage.error.negative',
  cents: 'usage.error.cents',
  range: 'usage.error.range',
} as const satisfies Record<LimitProblem, MessageKey>;

// The rows ----------------------------------------------------------------------------------------------------------------------------------

/** Why a period began: the default limit, a new month, a change of the limit or a reset of the count. */
export type UsageCause = 'initial' | 'month' | 'change' | 'reset';
export const usageCauses: readonly UsageCause[] = ['initial', 'month', 'change', 'reset'];

export const usageCauseKeys = {
  initial: 'usage.cause.initial',
  month: 'usage.cause.month',
  change: 'usage.cause.change',
  reset: 'usage.cause.reset',
} as const satisfies Record<UsageCause, MessageKey>;

/** One Account's current period, as the page passes it to the browser. Every amount is a whole number of microdollars. */
export type UsageRow = {
  accountId: string;
  /** The Google address Auth verified, or null if Auth no longer vouches for one. */
  email: string | null;
  role: 'administrator' | 'member';
  status: 'active' | 'disabled';
  /** The period's place in the Account's family (from 1): what a change is made against, so a stale form is told. */
  seq: number;
  /** The first day of the UTC month, `YYYY-MM-DD`. */
  monthStart: string;
  limit: number;
  /** Shown settled: what was carried in plus the period's settled figure. */
  settled: number;
  /** Shown reserved: what was carried in plus the period's reserved figure. */
  reserved: number;
  cause: UsageCause;
};

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])-01$/;

/** The month as `2026-10`, or an empty string for a date that is not the first of a month. */
export function formatMonth(monthStart: string): string {
  const match = monthPattern.exec(monthStart);
  return match ? `${match[1]}-${match[2]}` : '';
}

// The state of a limit --------------------------------------------------------------------------------------------------------------------

/** `under` (used is under 80% of the limit), `nearly` (80% or more, and under the limit) or `reached` (at or over the limit; a limit of 0 included). */
export type UsageState = 'under' | 'nearly' | 'reached';

/**
 * The state by integer arithmetic only: `under` when used × 5 < limit × 4, `reached` when used ≥ limit, otherwise `nearly`. A limit of 0 is
 * `reached` (nothing used is already at it). The products are BigInt, so no amount can overflow or round.
 */
export function classify(limit: number, used: number): UsageState {
  if (used >= limit) return 'reached';
  return BigInt(used) * BigInt(5) < BigInt(limit) * BigInt(4) ? 'under' : 'nearly';
}

/** The catalog keys of a state: its word, and what it means for new paid work. */
export const usageStateKeys = {
  under: {label: 'usage.state.under', note: 'usage.state.under.note'},
  nearly: {label: 'usage.state.nearly', note: 'usage.state.nearly.note'},
  reached: {label: 'usage.state.reached', note: 'usage.state.reached.note'},
} as const satisfies Record<UsageState, {label: MessageKey; note: MessageKey}>;

/** The tone of the state's badge; the badge also carries its word and its own shape. */
export const usageStateTones = {under: 'success', nearly: 'warning', reached: 'danger'} as const satisfies Record<UsageState, 'success' | 'warning' | 'danger'>;

// The figures -------------------------------------------------------------------------------------------------------------------------------

export type UsageFigures = {
  limit: number;
  settled: number;
  reserved: number;
  /** Settled plus reserved. */
  used: number;
  /** What is left of the limit; 0 when used is at or over it. */
  available: number;
  /** How far used is over the limit; 0 when it is not. */
  over: number;
  state: UsageState;
};

/** The figures of a row, all derived from its limit, settled and reserved. */
export function figuresOf(row: Pick<UsageRow, 'limit' | 'settled' | 'reserved'>): UsageFigures {
  const used = row.settled + row.reserved;
  return {
    limit: row.limit,
    settled: row.settled,
    reserved: row.reserved,
    used,
    available: Math.max(row.limit - used, 0),
    over: Math.max(used - row.limit, 0),
    state: classify(row.limit, used),
  };
}

/** Whether the amounts add up: settled + reserved + available is the limit, or, over the limit, the limit + over is what is used. */
export function reconciles(figures: UsageFigures): boolean {
  return figures.over > 0
    ? figures.available === 0 && figures.limit + figures.over === figures.used
    : figures.over === 0 && figures.settled + figures.reserved + figures.available === figures.limit;
}

/** The meter's two segments as whole percents of the limit: settled, then reserved, together never above 100. A limit of 0 is full. */
export type Meter = {settledPercent: number; reservedPercent: number; usedPercent: number};

export function meterOf(figures: UsageFigures): Meter {
  if (figures.limit === 0) return {settledPercent: 0, reservedPercent: figures.used > 0 ? 100 : 0, usedPercent: 100};
  const share = (amount: number) => Number((BigInt(amount) * BigInt(100)) / BigInt(figures.limit));
  const settledPercent = Math.min(share(figures.settled), 100);
  const reservedPercent = Math.min(share(figures.reserved), 100 - settledPercent);
  return {settledPercent, reservedPercent, usedPercent: Math.min(share(figures.used), 100)};
}

// What the actions answer -----------------------------------------------------------------------------------------------------------------

/**
 * What the two Server Actions (change the limit, reset the count) answer, and what the controls keep.
 *
 *  - `changed` carries the new limit; `reset` is a count that was reset; `replayed` is the same command arriving again (nothing changed now).
 *  - `unchanged` is a limit typed that is the limit already.
 *  - `stale` is "the page was out of date" (another window, or the month turned): nothing was changed, and the list is read again.
 *  - `reused` is a command ID the database already used for another payload. The form cannot normally cause it: a command ID belongs to a command (the Account, the
 *    period the person saw, the kind and the amount, `useCommandIds` in components/admin/usage-list.tsx), so another amount, another period or another kind gets another ID.
 *    It is the answer to a request that was not made by this form, and nothing was changed.
 *  - `invalid` is a typed limit that is not one (a message in the form, nothing sent); `invalid_limit` is the database refusing one anyway.
 *  - `disabled` is an Account that is disabled: its limit is not changed until it is enabled again.
 *  - `not_found` is an ID that names no Account (or one that was deleted).
 *  - `refused` is "no valid fresh sign-in": nothing was changed. `stepUp` says whether to offer the sign-in (there was none or it ran out).
 *  - `denied` is an Account that is not the Administrator.
 *  - `unavailable` is a service that did not answer. `unknown` is true when the change may have been made anyway: the person is told to
 *    check the list before trying again.
 */
export type UsageActionState =
  | {outcome: 'idle'}
  | {outcome: 'changed'; limit: number}
  | {outcome: 'reset'}
  | {outcome: 'replayed'}
  | {outcome: 'unchanged'; limit: number}
  | {outcome: 'stale'}
  | {outcome: 'reused'}
  | {outcome: 'invalid'; problem: LimitProblem}
  | {outcome: 'invalid_limit'}
  | {outcome: 'disabled'}
  | {outcome: 'not_found'}
  | {outcome: 'refused'; stepUp: boolean}
  | {outcome: 'denied'}
  | {outcome: 'unavailable'; unknown: boolean};

export const usageActionIdle: UsageActionState = {outcome: 'idle'};

export type UsageAction = (previous: UsageActionState, formData: FormData) => Promise<UsageActionState>;

/** Calls a Usage action and reads what comes back (see `attemptAdministeredAction`): a call that did not answer is `unavailable`, and the change may have been made. */
export function attemptUsageAction(
  action: UsageAction,
  previous: UsageActionState,
  formData: FormData,
  navigate: () => void = reloadHere,
): Promise<UsageActionState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable', unknown: true}, navigate);
}

/** The catalog key for an answer that is one fixed message. The others carry something: a limit, or what to do next (usageFailureKey). */
export const usageMessageKeys = {
  reset: 'usage.reset.done',
  replayed: 'usage.done.replayed',
  stale: 'usage.error.stale',
  reused: 'usage.error.reused',
  invalid_limit: 'usage.error.invalidLimit',
  disabled: 'usage.error.disabled',
  not_found: 'usage.error.notFound',
  denied: 'usage.error.denied',
} as const satisfies Partial<Record<UsageActionState['outcome'], MessageKey>>;

export function usageFailureKey(state: Extract<UsageActionState, {outcome: 'refused' | 'unavailable'}>): MessageKey {
  if (state.outcome === 'refused') return state.stepUp ? 'usage.error.needsConfirm' : 'usage.error.refused';
  return state.unknown ? 'usage.error.unknown' : 'usage.error.unavailable';
}

/** The name an Account goes by in the list and in a sentence: its Google address, or a stand-in when Auth no longer vouches for one. */
export function usageNameOf(row: Pick<UsageRow, 'email'>, standIn: string): string {
  return row.email ?? standIn;
}
