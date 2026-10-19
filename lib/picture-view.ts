// Story 2.2. What the two picture Server Actions (app/projects/new/pictures/actions.ts) and the screen that calls them (components/projects/picture-intake.tsx)
// agree on, with nothing that reaches the server: the state Save answers with, the message each problem and each refusal has, and how a call that did not
// answer is read. A client component imports this file, so it imports no Node or Next.js server code and not lib/accounts.ts or lib/projects.ts.
//
// Nothing here is stored. The server reads every upload from its lease and decides; a state is only ever something to show, never something the server
// trusts back.
import {attemptAdministeredAction} from '@/lib/administration';
import type {MessageKey} from '@/lib/i18n';
import {formatBytes, updateItem, type FileProblem, type PictureSet, type SetProblem, type UploadProblem} from '@/lib/picture-set';

export {browserStorage, commandIdFor, forgetCommandId, newCommandId, requestKey} from '@/lib/request-view';

/**
 * What `savePictureSet` answers when it did not redirect (it redirects to the Project on `created`, `revised`, `replayed` and `unchanged`, and Home
 * when the Account has no authority).
 *  - `invalid`: the form is not shaped like the screen's (no pictures, an ID that is not an ID, too many); nothing was saved.
 *  - `unknown_upload`, `not_ready`, `expired_upload`: the picture at `position` (1 is the first) is not one of the Account's uploads, has not finished
 *    uploading, or has expired; nothing was saved.
 *  - `duplicate_image`: the picture at `position` has the same SHA-256 as an earlier one, as the database reads it from the leases (the browser's own check had
 *    not caught it); nothing was saved.
 *  - `too_large`: the pictures together are over 60 MiB, as the database reads them from the uploads; nothing was saved.
 *  - `reused`: the command ID was used before for something else; nothing was saved (the next Save is a new command).
 *  - `gone`: the Project is not (or is no longer) available: another Account's, deleted or unknown; nothing was saved.
 *  - `not_editable`: the Project's request is not an unconfirmed picture request any more; nothing was saved.
 *  - `unavailable`: the service did not answer. `unknown` is true when the pictures may have been saved anyway: the person is told to check My Projects
 *    first (a retry carries the same command ID, so it makes at most one Project and one revision).
 */
export type SaveState =
  | {outcome: 'idle'}
  | {outcome: 'invalid'}
  | {outcome: 'unknown_upload' | 'not_ready' | 'expired_upload' | 'duplicate_image'; position: number}
  | {outcome: 'too_large' | 'reused' | 'gone' | 'not_editable'}
  | {outcome: 'unavailable'; unknown: boolean};

export const saveIdle: SaveState = {outcome: 'idle'};

export type SaveAction = (previous: SaveState, formData: FormData) => Promise<SaveState>;
export type DiscardAction = (formData: FormData) => Promise<void>;

/** Calls the Save action and reads what comes back: a call that did not answer is `unavailable`, and the pictures may have been saved. */
export function attemptSave(action: SaveAction, previous: SaveState, formData: FormData): Promise<SaveState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable', unknown: true});
}

/**
 * Asks the server to release uploads the person replaced or removed before saving them. It never rejects and says nothing: when the release does not
 * happen the upload simply lapses on its own in 24 hours, and the person has lost nothing.
 */
export async function attemptDiscard(action: DiscardAction, uploadIds: readonly string[]): Promise<void> {
  if (uploadIds.length === 0) return;
  const form = new FormData();
  for (const id of uploadIds) form.append('uploadId', id);
  try {
    await action(form);
  } catch {
    // Silent on purpose.
  }
}

// What each problem says ---------------------------------------------------------------------------------------------------------

export const fileProblemKeys = {
  type: 'picture.problem.type',
  empty: 'picture.problem.empty',
  too_large: 'picture.problem.too_large',
  too_many: 'picture.problem.too_many',
  set_too_large: 'picture.problem.set_too_large',
  duplicate: 'picture.problem.duplicate',
  unreadable: 'picture.problem.unreadable',
} as const satisfies Record<FileProblem, MessageKey>;

export const uploadProblemKeys = {
  content: 'picture.upload.content',
  type: 'picture.upload.type',
  changed: 'picture.upload.changed',
  too_large: 'picture.upload.too_large',
  quota: 'picture.upload.quota',
  reload: 'picture.upload.reload',
  conflict: 'picture.upload.conflict',
  unavailable: 'picture.upload.unavailable',
  network: 'picture.upload.network',
  rejected: 'picture.upload.rejected',
  duplicate: 'picture.upload.duplicate',
} as const satisfies Record<UploadProblem, MessageKey>;

export const setProblemKeys = {
  empty: 'picture.set.empty',
  busy: 'picture.set.busy',
  failed: 'picture.set.failed',
  expired: 'picture.set.expired',
} as const satisfies Record<SetProblem, MessageKey>;

/** The message of an answer to Save that did not go through, or null when it needs none (nothing yet). */
export function saveKey(state: SaveState): MessageKey | null {
  switch (state.outcome) {
    case 'invalid':
      return 'picture.save.invalid';
    case 'unknown_upload':
      return 'picture.save.unknownUpload';
    case 'not_ready':
      return 'picture.save.notReady';
    case 'expired_upload':
      return 'picture.save.expiredUpload';
    case 'duplicate_image':
      return 'picture.save.duplicateImage';
    case 'too_large':
      return 'picture.save.tooLarge';
    case 'reused':
      return 'picture.save.reused';
    case 'gone':
      return 'picture.save.gone';
    case 'not_editable':
      return 'picture.save.notEditable';
    case 'unavailable':
      return state.unknown ? 'picture.save.unknown' : 'picture.save.unavailable';
    default:
      return null;
  }
}

// What the screen does with an answer to Save ------------------------------------------------------------------------------------

/** What a Save can come back with: its failures (a state) and the receipts that redirect (the screen never sees these, but the rule for them is the same). */
export type SaveAnswer = SaveState | {outcome: 'created' | 'revised' | 'replayed' | 'unchanged'};

export type SaveSettled = {
  /** The set with the picture the answer is about marked (the same set when the answer is about none). */
  set: PictureSet;
  /** The command ID that was sent cannot be sent again: the database says it was used for something else, or its Project is gone, so the next Save is a new command. */
  forgetCommand: boolean;
  /** The answer is a failure to show, announce and move focus to. */
  failed: boolean;
};

/**
 * What a Save's answer means for the screen, as a pure rule:
 *  - `reused` and `gone` forget the command ID (and the screen resets the key it remembers having sent); every other answer keeps it, because a retry of the
 *    very same Save must carry the same command;
 *  - an answer about a position names a picture by the uploads that were SUBMITTED (the snapshot of the form), not by the live list, which may have changed since:
 *    `unknown_upload`, `not_ready` and `expired_upload` mark a picture this screen uploaded (it still has its file) as failed with the problem `conflict`, so Retry
 *    uploads it again under a new upload ID, and a saved picture that has no file here as no longer available (replace it); `duplicate_image` marks the picture
 *    as a duplicate (remove it);
 *  - `created`, `revised`, `replayed` and `unchanged` are the receipts that leave the screen: nothing is marked and nothing is forgotten.
 */
export function settleSave(answer: SaveAnswer, submitted: readonly string[], set: PictureSet): SaveSettled {
  const failed = answer.outcome !== 'idle' && answer.outcome !== 'created' && answer.outcome !== 'revised' && answer.outcome !== 'replayed' && answer.outcome !== 'unchanged';
  const forgetCommand = answer.outcome === 'reused' || answer.outcome === 'gone';
  if (!('position' in answer)) return {set, forgetCommand, failed};
  const uploadId = submitted[answer.position - 1];
  const item = uploadId === undefined ? undefined : set.find((candidate) => candidate.uploadId === uploadId);
  if (!item) return {set, forgetCommand, failed};
  if (answer.outcome === 'duplicate_image') return {set: updateItem(set, item.key, {state: 'failed', progress: 0, problem: 'duplicate'}), forgetCommand, failed};
  return {
    set: item.file ? updateItem(set, item.key, {state: 'failed', progress: 0, problem: 'conflict'}) : updateItem(set, item.key, {available: false}),
    forgetCommand,
    failed,
  };
}

// The review (Story 2.3) ---------------------------------------------------------------------------------------------------------

/** A problem with the scope or the outcome of a direct request, by field and kind (the same words as Story 2.1's: lib/request-view.ts `problemKey` gives the message). */
export type ReviewProblem = {field: 'scope' | 'outcome'; problem: 'empty' | 'too_long' | 'control'};

/**
 * Why the pictures could not be kept (Story 2.12), for the ones that are about retention itself rather than about the review. Nothing was kept confirmed, and a retry
 * is safe: a picture that was kept stays kept and is not kept twice.
 *  - `bytes_changed`: the staged bytes of the picture at `position` (1 is the first) are not the bytes that were saved; nothing was kept of it. Add it again.
 *  - `strip_failed`: the picture at `position` could not be read well enough to remove its location data, so it was not kept (an unstripped copy is never kept).
 *  - `lease_expired`: the private copy of the picture at `position` has expired or is gone. `not_complete`: its upload did not finish.
 *  - `manifest_conflict`: a different retained copy of the upload at `position` is already recorded, so this one could not be.
 *  - `quota_exceeded`: the Account's kept pictures would pass 2 GiB. `kept` and `asked` are the bytes of each when they are known (null when only the store's backstop
 *    for a race answered). Deleting kept pictures arrives in a later release.
 *  - `retain_unavailable`: the private store did not answer (for the picture at `position` when it is about one, null otherwise). Try again.
 */
export type RetainFailure =
  | {outcome: 'bytes_changed' | 'strip_failed' | 'lease_expired' | 'not_complete' | 'manifest_conflict'; position: number}
  | {outcome: 'quota_exceeded'; kept: number | null; asked: number | null}
  | {outcome: 'retain_unavailable'; position: number | null};

/**
 * What `retainPictures` answers (it never redirects but to Home, when the Account has no authority).
 *  - `retained`: every picture (`count`) now has a retained copy; the screen goes on to record the review. Nothing is confirmed yet.
 *  - `invalid`: the form is not shaped like the screen's; nothing was kept. `stale`: the Project's pictures or review changed since the page loaded. `gone`: the Project is
 *    not (or no longer) available. `not_editable`: the request has no pictures to keep. `unknown_upload`, `not_ready`, `expired_upload`: the picture at `position` is not
 *    one of the Account's uploads, did not finish uploading, or has expired and has no retained copy. Every other answer is a `RetainFailure`.
 */
export type RetainState =
  | {outcome: 'idle'}
  | {outcome: 'retained'; count: number}
  | {outcome: 'invalid'}
  | {outcome: 'stale' | 'gone' | 'not_editable'}
  | {outcome: 'unknown_upload' | 'not_ready' | 'expired_upload'; position: number}
  | RetainFailure;

export const retainIdle: RetainState = {outcome: 'idle'};

export type RetainAction = (previous: RetainState, formData: FormData) => Promise<RetainState>;

/** Calls the retain action and reads what comes back: a call that did not answer is `retain_unavailable` (nothing was confirmed, and trying again keeps only what is not kept yet). */
export function attemptRetain(action: RetainAction, previous: RetainState, formData: FormData): Promise<RetainState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'retain_unavailable', position: null});
}

/** The form `retainPictures` reads, made from the Confirm form: the Project, the revision reviewed and the uploads in order. Nothing else of the review goes with it. */
export function retainForm(confirm: FormData): FormData {
  const form = new FormData();
  for (const name of ['projectId', 'expectedSeq'] as const) {
    const value = confirm.get(name);
    if (typeof value === 'string') form.set(name, value);
  }
  for (const uploadId of confirm.getAll('uploadId')) if (typeof uploadId === 'string') form.append('uploadId', uploadId);
  return form;
}

/**
 * What `recordPictureReview` answers when it did not redirect (it redirects to the Project on `created` and `replayed`, and Home when the Account has no authority), and
 * what `retainPictures` answered when the pictures could not be kept first (a `RetainFailure`: nothing was kept confirmed).
 *  - `invalid`: the scope or the outcome is wrong (named in `problems`), or the form is not shaped like the screen's (no problem to point at); nothing was recorded.
 *  - `stale`: the Project's pictures or review changed since this page was loaded (another window saved a newer set or review); nothing was recorded. Load the page again.
 *  - `unknown_upload`, `not_ready`, `expired_upload`: the picture at `position` (1 is the first) is not one of the Account's uploads, did not finish uploading, or has
 *    expired; nothing was recorded. `not_retained`: the picture at `position` has no retained copy (the database refuses a review of pictures that were not kept).
 *  - `obstruction_not_confirmed`: the person did not confirm that nothing blocks the subject. `acknowledgment_required`: direct conversion with incomplete inputs without
 *    the Generate anyway acknowledgment (the database decided from the labels and measurements). Nothing was recorded for either.
 *  - `reused`: the command ID was used before for something else (the next Confirm is a new command). `gone`: the Project is not (or is no longer) available.
 *    `not_editable`: the Project's request is a text request, which has no pictures to review.
 *  - `unavailable`: the service did not answer. `unknown` is true when the review may have been recorded anyway: the person is told to check the Project first (a retry
 *    carries the same command ID, so it records at most one revision).
 */
export type ReviewState =
  | {outcome: 'idle'}
  | {outcome: 'invalid'; problems: ReviewProblem[]}
  | {outcome: 'unknown_upload' | 'not_ready' | 'expired_upload' | 'not_retained'; position: number}
  | {outcome: 'stale' | 'reused' | 'gone' | 'not_editable' | 'obstruction_not_confirmed' | 'acknowledgment_required'}
  | {outcome: 'unavailable'; unknown: boolean}
  | RetainFailure;

export const reviewIdle: ReviewState = {outcome: 'idle'};

export type ReviewAction = (previous: ReviewState, formData: FormData) => Promise<ReviewState>;

/** Calls the review action and reads what comes back: a call that did not answer is `unavailable`, and the review may have been recorded. */
export function attemptReview(action: ReviewAction, previous: ReviewState, formData: FormData): Promise<ReviewState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable', unknown: true});
}

/**
 * What an answer of `retainPictures` that did not keep every picture means as the Confirm's own answer, so one rule shows, announces and focuses every refusal: the
 * answers the review writer also gives are the same state, a form that is not the screen's is `invalid` with no field to point at, and the rest are retention failures.
 * An answer of `idle` is no answer at all (nothing was kept), and is told as the private store not answering.
 */
export function reviewOfRetain(state: Exclude<RetainState, {outcome: 'retained'}>): ReviewState {
  if (state.outcome === 'invalid') return {outcome: 'invalid', problems: []};
  if (state.outcome === 'idle') return {outcome: 'retain_unavailable', position: null};
  return state;
}

/**
 * What Confirm does (Story 2.12), in order, for the screen's action: KEEP the pictures first (`retain`), and only when the answer is that every picture of the form is
 * kept, RECORD the review (`record`). Any other answer of the retain action is Confirm's own answer, and nothing is recorded: the pictures are unconfirmed, and a retry
 * of the same Confirm is safe (what was kept stays kept). `phase` is told which part is running, for the status line and the live region. A call that did not answer is
 * read as `attemptRetain` and `attemptReview` read it.
 */
export async function confirmReview(
  steps: {retain: RetainAction; record: ReviewAction; phase?: (phase: ConfirmPhase) => void},
  previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  steps.phase?.('retaining');
  const answer = await attemptRetain(steps.retain, retainIdle, retainForm(formData));
  // The answer of a call that redirected (the Account lost its authority) is not an answer, and neither is a count that is not the pictures of the form.
  const kept = typeof answer === 'object' && answer !== null && typeof answer.outcome === 'string' ? answer : null;
  if (kept === null || (kept.outcome === 'retained' && kept.count !== formData.getAll('uploadId').length)) return {outcome: 'retain_unavailable', position: null};
  if (kept.outcome !== 'retained') return reviewOfRetain(kept);
  steps.phase?.('recording');
  return attemptReview(steps.record, previous, formData);
}

/** The message of an answer to Confirm that did not go through, or null when it needs none (nothing yet, or field problems the fields themselves show). */
export function reviewKey(state: ReviewState): MessageKey | null {
  switch (state.outcome) {
    case 'invalid':
      return state.problems.length ? null : 'review.confirm.invalid';
    case 'stale':
      return 'review.confirm.stale';
    case 'unknown_upload':
      return 'review.confirm.unknownUpload';
    case 'not_ready':
      return 'review.confirm.notReady';
    case 'expired_upload':
      return 'review.confirm.expiredUpload';
    case 'not_retained':
      return 'review.confirm.notRetained';
    case 'bytes_changed':
      return 'review.confirm.bytesChanged';
    case 'strip_failed':
      return 'review.confirm.stripFailed';
    case 'lease_expired':
      return 'review.confirm.leaseExpired';
    case 'not_complete':
      return 'review.confirm.notComplete';
    case 'manifest_conflict':
      return 'review.confirm.manifestConflict';
    case 'quota_exceeded':
      return state.kept === null || state.asked === null ? 'review.confirm.quotaFull' : 'review.confirm.quota';
    case 'retain_unavailable':
      return state.position === null ? 'review.confirm.retainUnavailable' : 'review.confirm.retainUnavailablePicture';
    case 'obstruction_not_confirmed':
      return 'review.confirm.obstruction';
    case 'acknowledgment_required':
      return 'review.confirm.acknowledgment';
    case 'reused':
      return 'review.confirm.reused';
    case 'gone':
      return 'review.confirm.gone';
    case 'not_editable':
      return 'review.confirm.notEditable';
    case 'unavailable':
      return state.unknown ? 'review.confirm.unknown' : 'review.confirm.unavailable';
    default:
      return null;
  }
}

/** The retained-picture quota the messages name (2 GiB): the limit is the database's, and this is only the words' number, given as a parameter so no language has to spell it. */
export const retainedQuotaText = '2 GiB';

/**
 * Which part of Confirm is running (Story 2.12): `retaining` (the pictures are being kept privately, one pre-check and up to 12 attaches), `recording` (they are kept, and
 * the review is being recorded), or `idle` (between Confirms).
 */
export type ConfirmPhase = 'idle' | 'retaining' | 'recording';

/** What the status line under Confirm says while a Confirm is running: the count of pictures being kept, then that the review is being saved; nothing when none is. */
export function confirmStatusKey(saving: boolean, phase: ConfirmPhase): MessageKey | null {
  if (!saving) return null;
  return phase === 'retaining' ? 'review.confirm.retaining' : 'review.confirm.pending';
}

/** The words' parameters for an answer's message: the picture it is about, or the quota's sizes (the limit is given as a parameter so no language has to spell it). */
export function reviewParams(state: ReviewState): Record<string, string | number> {
  if ('position' in state && state.position !== null) return {position: state.position};
  if (state.outcome === 'quota_exceeded') {
    return {limit: retainedQuotaText, ...(state.kept === null || state.asked === null ? {} : {kept: formatBytes(state.kept), asked: formatBytes(state.asked)})};
  }
  return {position: 0};
}

/**
 * What a Confirm's answer means for the screen: `reused` and `gone` forget the command ID (the next Confirm is a new command); every other answer keeps it, because a
 * retry of the very same Confirm must carry the same command. `failed` says the answer is a failure to show, announce and move focus to.
 */
export function settleReview(state: ReviewState): {forgetCommand: boolean; failed: boolean} {
  return {forgetCommand: state.outcome === 'reused' || state.outcome === 'gone', failed: state.outcome !== 'idle'};
}
