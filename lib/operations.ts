// Story 1.13. What the Administrator's Operations page (app/admin/operations) and the components under components/admin agree on, with nothing that reaches
// the server: an alarm as the page is given it, the words for each known condition, how a receipt's outcome is said, and how an alarm's EMAIL STATE is read
// from its notices. A client component imports this file, so it imports no Node or Next.js server code and not lib/lifecycle.ts (whose `AlarmRecord` this file
// repeats by shape instead). Pure: it reads no clock, no environment variable and no database.
import type {MessageKey} from '@/lib/i18n';

/** One alarm, as the page passes it to the browser (lib/lifecycle.ts `AlarmRecord` has this shape). Times are UTC text to the millisecond. */
export type AlarmView = {
  id: string;
  condition: string;
  subject: string | null;
  firstAt: string;
  latestAt: string;
  resolvedAt: string | null;
  detail: Record<string, number | boolean | string>;
  /** When its last `sent` notice was recorded, or null when it has never been emailed. */
  lastSentAt: string | null;
  /** The outcome and time of its latest notice of any kind, or null when none was ever recorded. */
  lastNoticeOutcome: 'sent' | 'failed' | 'unknown' | null;
  lastNoticeAt: string | null;
};

/** The words for each condition the registry knows (lib/alarm-conditions.ts). A condition a later story adds shows its ID until the catalog names it. */
export const conditionTitleKeys: Readonly<Record<string, MessageKey>> = {
  'task-late': 'operations.condition.task-late',
  'ledger-pending': 'operations.condition.ledger-pending',
  'identities-unaccounted': 'operations.condition.identities-unaccounted',
  'heartbeat-stale': 'operations.condition.heartbeat-stale',
  'qstash-stale': 'operations.condition.qstash-stale',
  'monitor-late': 'operations.condition.monitor-late',
};

/** The catalog key for a condition's title, or null for a condition the catalog does not know (own entries only: `constructor` is not a condition). */
export function conditionTitleKey(condition: string): MessageKey | null {
  return Object.hasOwn(conditionTitleKeys, condition) ? conditionTitleKeys[condition] : null;
}

/** The words for a receipt's outcome: the four a task finishes with, and `never` (the task has never finished a run). */
export const receiptOutcomeKeys: Readonly<Record<string, MessageKey>> = {
  ran: 'operations.outcome.ran',
  idle: 'operations.outcome.idle',
  no_store: 'operations.outcome.no_store',
  failed: 'operations.outcome.failed',
  never: 'operations.outcome.never',
};

/** The catalog key for a receipt's outcome, or null for a word the catalog does not know (it is then shown as it is). */
export function receiptOutcomeKey(outcome: string): MessageKey | null {
  return Object.hasOwn(receiptOutcomeKeys, outcome) ? receiptOutcomeKeys[outcome] : null;
}

/** The last receipt an alarm's detail names: the task, how its run ended and when. Each is null when the detail has no such text. */
export type Receipt = {task: string | null; outcome: string | null; at: string | null};

/** The text of a detail value, or null for a value that is not text. */
const textOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** The last receipt of an alarm's detail (`receipt_task`, `receipt_outcome`, `receipt_at`); `at` is `never` for a task that has never finished a run. */
export function receiptOf(detail: AlarmView['detail']): Receipt {
  return {task: textOf(detail.receipt_task), outcome: textOf(detail.receipt_outcome), at: textOf(detail.receipt_at)};
}

/** Whether the detail names any part of a receipt. */
export const hasReceipt = (receipt: Receipt) => receipt.task !== null || receipt.outcome !== null || receipt.at !== null;

/**
 * Whether an alarm has been emailed:
 *  - `sent`    its last `sent` notice was at `at`, and no later attempt failed;
 *  - `failing` its latest attempt did not go through (it `failed`, or its outcome is `unknown`) and is later than any `sent` one: it is tried again at the next
 *              evaluation;
 *  - `pending` no email has been attempted yet (the alarm just opened, or its condition was emailed within 24 hours and it is sent when that window ends).
 */
export type EmailState = {state: 'sent'; at: string} | {state: 'pending'} | {state: 'failing'};

const momentOf = (at: string | null): number => (at === null ? Number.NaN : Date.parse(at));

/** The email state of an alarm, from its last `sent` notice and its latest notice of any kind. */
export function emailStateOf(alarm: Pick<AlarmView, 'lastSentAt' | 'lastNoticeOutcome' | 'lastNoticeAt'>): EmailState {
  const failed = alarm.lastNoticeOutcome === 'failed' || alarm.lastNoticeOutcome === 'unknown';
  if (failed) {
    const sent = momentOf(alarm.lastSentAt);
    const notice = momentOf(alarm.lastNoticeAt);
    // A failed attempt that is later than the last sent email (or with none before it) is the state the Administrator needs to know about.
    if (alarm.lastSentAt === null || !(notice <= sent)) return {state: 'failing'};
  }
  return alarm.lastSentAt === null ? {state: 'pending'} : {state: 'sent', at: alarm.lastSentAt};
}

/** The words for each email state; the page pairs each with its own shape. */
export const emailStateKeys = {
  sent: 'operations.email.sent',
  pending: 'operations.email.pending',
  failing: 'operations.email.failing',
} as const satisfies Record<EmailState['state'], MessageKey>;

/** The line of explanation that goes with the states that have one. */
export const emailNoteKeys = {
  pending: 'operations.email.pending.note',
  failing: 'operations.email.failing.note',
} as const satisfies Partial<Record<EmailState['state'], MessageKey>>;

/**
 * The catalog key of the line that goes with an alarm's email state, or null for a state with none (`sent` shows its time instead). It reads the alarm and not only
 * its state, because the line must be true of what happened:
 *  - `failing` after a `failed` notice: the provider refused the mail or it was not sent (the original words);
 *  - `failing` after an `unknown` notice: the provider did not answer, so the mail MAY have been delivered: it will be tried again, and may arrive twice;
 *  - `pending` with a subject: a subject-keyed alarm is emailed at the next check;
 *  - `pending` with no subject (a threshold alarm): the page cannot tell an alarm that has simply not been reached yet from one held back because an alarm of the same
 *    condition was emailed in the last 24 hours (the list holds only this alarm's own notices), so the line is true of both: at the next check, or when 24 hours have
 *    passed since the last email for this kind of alarm, and never more than one email for the kind in 24 hours.
 */
export function emailNoteKeyOf(alarm: Pick<AlarmView, 'subject' | 'lastSentAt' | 'lastNoticeOutcome' | 'lastNoticeAt'>): MessageKey | null {
  const state = emailStateOf(alarm);
  if (state.state === 'sent') return null;
  if (state.state === 'failing') return alarm.lastNoticeOutcome === 'unknown' ? 'operations.email.unknown.note' : emailNoteKeys.failing;
  return alarm.subject === null ? 'operations.email.pending.threshold.note' : emailNoteKeys.pending;
}

/** The keys of a detail that have words of their own: the numbers the six conditions find (lib/alarm-conditions.ts). Any other key is shown as it is. */
export const detailLabelKeys: Readonly<Record<string, MessageKey>> = {
  age_seconds: 'operations.detail.age_seconds',
  pending: 'operations.detail.pending',
  oldest_seconds: 'operations.detail.oldest_seconds',
  count: 'operations.detail.count',
};

/** The catalog key for a detail key's label, or null for a key the catalog does not know (own entries only: `constructor` is not a label). */
export function detailLabelKey(key: string): MessageKey | null {
  return Object.hasOwn(detailLabelKeys, key) ? detailLabelKeys[key] : null;
}

/** One value of a detail the page shows: a whole number or a boolean, with its key. */
export type DetailValue = {key: string; value: number | boolean};

/**
 * The whole numbers and booleans of a detail, in the order the detail holds them (the text of a detail, the receipt keys apart, is not shown: the receipt is its own
 * rows). A number that is not a whole number is not shown either.
 */
export function detailValuesOf(detail: AlarmView['detail']): DetailValue[] {
  return Object.entries(detail)
    .filter((entry): entry is [string, number | boolean] => typeof entry[1] === 'boolean' || (typeof entry[1] === 'number' && Number.isSafeInteger(entry[1])))
    .map(([key, value]) => ({key, value}));
}
