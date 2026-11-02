// Story 2.7. What the Job screens (J-01 In progress, J-02 Job detail) and the typed Job commands (lib/job-commands.ts) agree on, with nothing that reaches the server: the
// vocabularies of states, reasons and endings, the shapes of a listed Job and of a Job in full, and the pure rules the screens read them by. A client component imports this
// file, so it imports no Node or Next.js server code and not lib/accounts.ts. Pure: it reads no clock, no environment variable and no database.
//
// The model, in the words of docs/authority-contract.md ("Jobs", "Dispatch and leases"): a Job has no state of its own; its state, stage and reason are its HIGHEST attempt's.
// A waiting attempt's reason is derived each time it is read: `awaiting_reconciliation` while an earlier operation is potentially chargeable, `awaiting_worker` while nobody
// can run it, else `awaiting_dispatch`. A failed or cancelled attempt has a stored reason, and the CAUSE behind it is the ending of its lease.

/** The states of an attempt, and so the public states of a Job. */
export const jobStates = ['waiting', 'running', 'completed', 'failed', 'cancelled'] as const;
export type JobState = (typeof jobStates)[number];
/** The states an attempt never leaves. */
export const finishedJobStates = ['completed', 'failed', 'cancelled'] as const;

/** Whether the Job is still open: its highest attempt is waiting or running. */
export function isOpenState(state: JobState): boolean {
  return state === 'waiting' || state === 'running';
}

/** Why a waiting attempt waits, as the Story 2.7 reads show it (derived each time, never stored). */
export const waitingReasons = ['awaiting_dispatch', 'awaiting_reconciliation', 'awaiting_worker'] as const;
export type WaitingReason = (typeof waitingReasons)[number];
/** The reasons the database STORES: why an attempt failed or was cancelled. */
export const failureReasons = ['step_failed', 'lease_lost'] as const;
export const cancellationReasons = ['user_cancelled', 'account_disabled'] as const;
export const storedReasons = [...failureReasons, ...cancellationReasons] as const;
export type StoredReason = (typeof storedReasons)[number];
/** Every reason a Job or an attempt can show. */
export const shownReasons = [...waitingReasons, ...storedReasons] as const;
export type ShownReason = (typeof shownReasons)[number];

/** The cause behind how a lease ended, which is how a Job's ending is told apart: the attempt's own reasons are the two failures and the two cancellations. */
export const endingDetails = ['user_cancelled', 'account_disabled', 'lease_expired', 'stale_revision', 'revoked_epoch', 'tombstoned', 'step_failed'] as const;
export type EndingDetail = (typeof endingDetails)[number];

/** The stages the records set themselves: `accepted` at attempt 1, `retry` at a later attempt, `started` when it starts. Any other stage is a step key. */
export const fixedStages = ['accepted', 'retry', 'started'] as const;
/** What a stage, a step key and a Job kind look like. */
export const namePattern = /^[a-z][a-z0-9_]{0,39}$/;

/** The one kind of Job that is accepted today: the deterministic test workload. */
export const testWorkloadKind = 'test_workload';

/** An attempt as a command answers about it. */
export type AttemptSummary = {id: string; number: number; state: JobState; stage: string; reason: ShownReason | null};

/** An attempt as the detail shows it: its state, stage, reason, times and how many of its operations are potentially chargeable. */
export type AttemptView = AttemptSummary & {createdAt: string; startedAt: string | null; endedAt: string | null; chargeableOperations: number};

/** A Job in the list of In progress (J-01): its Project, its public state, stage and reason, and the times of its highest attempt. */
export type JobListItem = {
  jobId: string;
  projectId: string;
  projectTitle: string;
  kind: string;
  createdAt: string;
  attemptNumber: number;
  state: JobState;
  stage: string;
  reason: ShownReason | null;
  startedAt: string | null;
  endedAt: string | null;
};

/** How far the highest attempt has come: steps begun of all its steps, operations completed of all it planned. */
export type JobProgress = {steps: number; stepsBegun: number; operationsPlanned: number; operationsCompleted: number};

/**
 * What the Job costs, in integer microdollars: `held` is reserved and not yet settled, `settled` is what was charged, `released` is what settled operations gave back to the
 * allowance (their reservation less what they settled), and `chargeableOperations` is how many operations of any attempt may still be charged (dispatched or ambiguous).
 */
export type JobCost = {held: number; settled: number; released: number; chargeableOperations: number};

/** A Job in full (J-02): everything the screen shows, and nothing it does not. */
export type JobDetail = {
  jobId: string;
  projectId: string;
  projectTitle: string;
  kind: string;
  createdAt: string;
  state: JobState;
  stage: string;
  reason: ShownReason | null;
  canCancel: boolean;
  canRetry: boolean;
  attempts: AttemptView[];
  progress: JobProgress;
  cost: JobCost;
  /** The cause behind how the highest attempt's lease ended; null while the Job is open and for an attempt that never held a lease. */
  ending: EndingDetail | null;
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// What the screens say about a Job (Story 2.7: J-01 In progress, J-02 Job detail)
// ---------------------------------------------------------------------------------------------------------------------------------------
//
// Everything below is pure and client-safe. It turns what the database holds into words and shapes a person can act on: the state as a word with a shape of its own (never
// colour alone), the stage and the reason in plain language, and, when work failed or was stopped, the five things UX-DR19 asks for: the stage it stopped at, the known cause,
// the state that was preserved, the cost impact when it is known, and the next action. NOTHING here implies a retry: a failed Job stays failed until a person asks for it
// again, and this story offers no screen that asks (a retry is a later story's), so the next action says so instead of pointing at a button that is not there.
//
// MONEY is integer microdollars, written only by `formatDollars` (lib/usage-view.ts): it writes the exact amount, so an amount above zero is never shown as $0.00 and nothing is
// rounded or hidden. A screen shows it as an LTR token so Hebrew cannot reorder it.
import type {IconName} from '@/components/ui/icon';
import type {StatusTone} from '@/components/ui/status-badge';
import {isolateLtr, type MessageKey, type Translator} from '@/lib/i18n';
import {attemptAdministeredAction} from '@/lib/administration';
import {reloadHere} from '@/lib/session-actions';
import {formatDollars} from '@/lib/usage-view';

export {newCommandId, commandIdOf, uuidOf as jobIdOf} from '@/lib/project-view';
export {formatUpdated as formatTime, updatedIso as timeIso} from '@/lib/project-view';

// Where things are --------------------------------------------------------------------------------------------------------------------------

export {progressPath, jobPath} from '@/lib/job-paths';

/** How often a page that shows open work asks for itself again: every 10 seconds, and not while the tab is hidden. */
export const jobRefreshSeconds = 10;
export const jobRefreshMs = jobRefreshSeconds * 1000;

// The state, the stage and the reason in words -------------------------------------------------------------------------------------------------

/**
 * How a Job shows: `rejected` is a Job whose result was refused because the Project changed while it ran (a failed attempt whose lease ended `stale_revision`): it is a failure,
 * but it has its own word and its own explanation, and J-02 lists it as a variant of its own.
 */
export type JobVariant = JobState | 'rejected';

/** The variant a Job in full shows. */
export function variantOf(job: Pick<JobDetail, 'state' | 'ending'>): JobVariant {
  return job.state === 'failed' && job.ending === 'stale_revision' ? 'rejected' : job.state;
}

export const variantWordKeys = {
  waiting: 'job.state.waiting',
  running: 'job.state.running',
  completed: 'job.state.completed',
  failed: 'job.state.failed',
  cancelled: 'job.state.cancelled',
  rejected: 'job.state.rejected',
} as const satisfies Record<JobVariant, MessageKey>;

/** The badge of a variant: a tone and a shape of its own, as well as its word. */
export const variantBadges = {
  waiting: {tone: 'neutral', icon: 'clock'},
  running: {tone: 'running', icon: 'activity'},
  completed: {tone: 'success', icon: 'check-circle'},
  failed: {tone: 'danger', icon: 'x-octagon'},
  cancelled: {tone: 'neutral', icon: 'close'},
  rejected: {tone: 'danger', icon: 'alert-triangle'},
} as const satisfies Record<JobVariant, {tone: StatusTone; icon: IconName}>;

export const reasonWordKeys = {
  awaiting_dispatch: 'job.reason.awaiting_dispatch',
  awaiting_reconciliation: 'job.reason.awaiting_reconciliation',
  awaiting_worker: 'job.reason.awaiting_worker',
  step_failed: 'job.reason.step_failed',
  lease_lost: 'job.reason.lease_lost',
  user_cancelled: 'job.reason.user_cancelled',
  account_disabled: 'job.reason.account_disabled',
} as const satisfies Record<ShownReason, MessageKey>;

/** The reason in words, or null for an attempt that has none (running, completed). */
export function reasonWords(t: Translator, reason: ShownReason | null): string | null {
  return reason === null ? null : t(reasonWordKeys[reason]);
}

const stageWordKeys: Readonly<Record<string, MessageKey>> = {
  accepted: 'job.stage.accepted',
  retry: 'job.stage.retry',
  started: 'job.stage.started',
  work: 'job.stage.work',
};

/** The stage in words: the three the records set and the one step the test workload runs are named; any other step key is shown as the step it is, isolated as a token. */
export function stageWords(t: Translator, stage: string): string {
  const key = Object.hasOwn(stageWordKeys, stage) ? stageWordKeys[stage] : null;
  return key ? t(key) : t('job.stage.step', {step: isolateLtr(stage)});
}

/** The kind of work in words. Only the test workload exists; any other kind is named generally rather than shown as an identifier. */
export function kindWords(t: Translator, kind: string): string {
  return kind === testWorkloadKind ? t('job.kind.test_workload') : t('job.kind.other');
}

/** What a page read of the Account's Jobs: the Jobs (open ones first), or that they could not be read. An unreadable list is never shown as an empty one. */
export type JobsListing = {state: 'listed'; jobs: JobListItem[]} | {state: 'unreadable'};

/** Whether a Job shown in a list is still open work (a waiting or running attempt). */
export const isOpenListItem = (item: Pick<JobListItem, 'state'>) => isOpenState(item.state);

// Money --------------------------------------------------------------------------------------------------------------------------------------

/** An amount of microdollars as the screens write it: `$0.0034`. The exact amount, never rounded, so an amount above zero is never $0.00. A screen shows it as an LTR token. */
export function amountText(microdollars: number): string {
  return formatDollars(microdollars);
}

/** The same amount for a {placeholder} of a sentence, isolated left to right so Hebrew cannot reorder it. */
export function amountWords(microdollars: number): string {
  return isolateLtr(formatDollars(microdollars));
}

/** Whether anything was reserved, charged or released, or may still be charged. */
export function hasCostActivity(cost: JobCost): boolean {
  return cost.held > 0 || cost.settled > 0 || cost.released > 0 || cost.chargeableOperations > 0;
}

/** The sentences that say what the Job cost, when it is known: one for each thing that is so, and one that says nothing was charged when nothing was. */
export function costImpactLines(t: Translator, cost: JobCost): string[] {
  if (!hasCostActivity(cost)) return [t('job.impact.none')];
  const lines: string[] = [];
  if (cost.chargeableOperations > 0) {
    lines.push(
      cost.held > 0
        ? t('job.impact.held', {count: cost.chargeableOperations, amount: amountWords(cost.held)})
        : t('job.impact.pending', {count: cost.chargeableOperations}),
    );
  } else if (cost.held > 0) {
    // Held with no request that may still be charged: reserved for work that has not gone out yet.
    lines.push(t('job.impact.reserved', {amount: amountWords(cost.held)}));
  }
  if (cost.settled > 0) lines.push(t('job.impact.charged', {amount: amountWords(cost.settled)}));
  if (cost.released > 0) lines.push(t('job.impact.released', {amount: amountWords(cost.released)}));
  return lines;
}

// Progress ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * How far the highest attempt has come, as a bar and as words: requests completed of those planned. `null` is no bar: there is nothing to count yet, or the work is not made of
 * requests (it planned none). Steps begun of its steps is NOT a measure: a step exists only once it has begun, so it always reads "N of N" and a running Job would show a full bar.
 * Only a completed Job is whole, and then it says so as steps. `progressNoteKey` says in words why there is no bar.
 */
export type ProgressReading = {max: number; value: number; percent: number; wordsKey: 'job.progress.requests' | 'job.progress.steps'};

export function progressReading(progress: JobProgress, state: JobState): ProgressReading | null {
  const measure = (value: number, max: number, wordsKey: ProgressReading['wordsKey']): ProgressReading => {
    const whole = state === 'completed' ? max : Math.min(value, max);
    return {max, value: whole, percent: max === 0 ? 0 : Math.floor((whole * 100) / max), wordsKey};
  };
  if (progress.operationsPlanned > 0) return measure(progress.operationsCompleted, progress.operationsPlanned, 'job.progress.requests');
  if (state === 'completed' && progress.steps > 0) return measure(progress.steps, progress.steps, 'job.progress.steps');
  return null;
}

/** What the screen says when there is no bar: that nothing has started, or that this work has no parts to count (the stage says where it is). */
export function progressNoteKey(progress: JobProgress, state: JobState): MessageKey {
  return state === 'waiting' || (progress.steps === 0 && progress.operationsPlanned === 0) ? 'job.progress.nothing' : 'job.progress.unmeasured';
}

// What happened, and what to do next --------------------------------------------------------------------------------------------------------------

/** The cause of a failure or a stop in words, from the attempt's reason and the ending of its lease (the cause behind the reason). */
export function causeKey(job: Pick<JobDetail, 'state' | 'reason' | 'ending'>): MessageKey {
  if (job.ending === 'stale_revision') return 'job.cause.stale_revision';
  if (job.state === 'cancelled') {
    if (job.reason === 'user_cancelled') return 'job.cause.user_cancelled';
    // The Account's authority was taken away after the work began, but not necessarily by switching the Account off: its epoch moved (it was switched off and on again) or it was
    // removed. The words must not say the Account was switched off when the records say something else.
    if (job.ending === 'revoked_epoch' || job.ending === 'tombstoned') return 'job.cause.authority_changed';
    return 'job.cause.account_disabled';
  }
  if (job.reason === 'lease_lost') return 'job.cause.lease_lost';
  if (job.reason === 'step_failed') return 'job.cause.step_failed';
  return 'job.cause.unknown';
}

const nextKeys = {
  completed: 'job.next.completed',
  running: 'job.next.running',
  failed: 'job.next.failed',
  cancelled: 'job.next.cancelled',
  rejected: 'job.next.rejected',
} as const;

/** The next action in plain words. It never says that the work will run again by itself, and never points at a retry button: there is none on these screens. */
export function nextActionKey(job: Pick<JobDetail, 'state' | 'reason' | 'ending'>): MessageKey {
  const variant = variantOf(job);
  if (variant === 'waiting') {
    return job.reason === 'awaiting_worker' ? 'job.next.worker' : job.reason === 'awaiting_reconciliation' ? 'job.next.reconciliation' : 'job.next.dispatch';
  }
  return nextKeys[variant];
}

/** The five things a failure or a stop explains (UX-DR19), as sentences. */
export type Explanation = {stage: string; cause: string; kept: string; cost: string[]; next: string};

/** Whether the Job ended in a way that needs explaining: it failed (a rejected result included) or was cancelled. */
export function needsExplaining(job: Pick<JobDetail, 'state'>): boolean {
  return job.state === 'failed' || job.state === 'cancelled';
}

/** The explanation of a failed or cancelled Job: the stage it stopped at, the known cause, what was kept, what it cost when known, and what to do next. */
export function explain(t: Translator, job: JobDetail): Explanation {
  return {
    stage: stageWords(t, job.stage),
    cause: t(causeKey(job)),
    kept: t('job.kept.body'),
    cost: costImpactLines(t, job.cost),
    next: t(nextActionKey(job)),
  };
}

// Cancel ---------------------------------------------------------------------------------------------------------------------------------------

/**
 * What the Cancel Server Action answers, and what the dialog keeps.
 *
 *  - `cancelled` is a Job that was cancelled (`replayed`: the same command arriving again, so it already was).
 *  - `not_cancellable` is a Job whose work had already ended (it carries the state): nothing was changed.
 *  - `invalid` is a form that is not shaped like the dialog's.
 *  - `reused` is a command ID the database already used for another command. The dialog cannot cause it.
 *  - `gone` is a Job that is not (or is no longer) the person's to cancel: another Account's, deleted, unknown.
 *  - `unavailable` is a service that did not answer. `unknown` is true when the cancellation may have been made anyway: the person is told to check the page before trying again.
 */
export type JobCancelState =
  | {outcome: 'idle'}
  | {outcome: 'cancelled'; replayed: boolean}
  | {outcome: 'not_cancellable'; state: JobState}
  | {outcome: 'invalid'}
  | {outcome: 'reused'}
  | {outcome: 'gone'}
  | {outcome: 'unavailable'; unknown: boolean};

export const jobCancelIdle: JobCancelState = {outcome: 'idle'};

export type JobCancelAction = (previous: JobCancelState, formData: FormData) => Promise<JobCancelState>;

/** Calls the Cancel action and reads what comes back (see `attemptAdministeredAction`): a call that did not answer is `unavailable`, and the cancellation may have been made. */
export function attemptJobCancel(action: JobCancelAction, previous: JobCancelState, formData: FormData, navigate: () => void = reloadHere): Promise<JobCancelState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable', unknown: true}, navigate);
}

/** The message for an answer other than a cancellation, or null for one that needs none (nothing yet, a cancellation). A form that was not the dialog's has a message too. */
export function cancelFailureKey(state: JobCancelState): MessageKey | null {
  switch (state.outcome) {
    case 'not_cancellable':
      return 'job.cancel.notCancellable';
    case 'reused':
      return 'job.cancel.reused';
    case 'gone':
      return 'job.cancel.gone';
    case 'invalid':
      return 'job.cancel.invalid';
    case 'unavailable':
      return state.unknown ? 'job.cancel.unknown' : 'job.cancel.unavailable';
    default:
      return null;
  }
}

// Announcing change --------------------------------------------------------------------------------------------------------------------------

/** What a page that refreshes itself says when the Job it shows has changed, or null when it has not: the state, the stage and the reason are what a person is watching. */
export function changeSignature(job: Pick<JobListItem | JobDetail, 'state' | 'stage' | 'reason'>): string {
  return `${job.state}|${job.stage}|${job.reason ?? ''}`;
}
