// Story 2.2. What the two picture Server Actions (app/projects/new/pictures/actions.ts) and the screen that calls them (components/projects/picture-intake.tsx)
// agree on, with nothing that reaches the server: the state Save answers with, the message each problem and each refusal has, and how a call that did not
// answer is read. A client component imports this file, so it imports no Node or Next.js server code and not lib/accounts.ts or lib/projects.ts.
//
// Nothing here is stored. The server reads every upload from its lease and decides; a state is only ever something to show, never something the server
// trusts back.
import {attemptAdministeredAction} from '@/lib/administration';
import type {MessageKey} from '@/lib/i18n';
import {updateItem, type FileProblem, type PictureSet, type SetProblem, type UploadProblem} from '@/lib/picture-set';

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
 * What `recordPictureReview` answers when it did not redirect (it redirects to the Project on `created` and `replayed`, and Home when the Account has no authority).
 *  - `invalid`: the scope or the outcome is wrong (named in `problems`), or the form is not shaped like the screen's (no problem to point at); nothing was recorded.
 *  - `stale`: the Project's pictures or review changed since this page was loaded (another window saved a newer set or review); nothing was recorded. Load the page again.
 *  - `unknown_upload`, `not_ready`, `expired_upload`: the picture at `position` (1 is the first) is not one of the Account's uploads, did not finish uploading, or has
 *    expired; nothing was recorded.
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
  | {outcome: 'unknown_upload' | 'not_ready' | 'expired_upload'; position: number}
  | {outcome: 'stale' | 'reused' | 'gone' | 'not_editable' | 'obstruction_not_confirmed' | 'acknowledgment_required'}
  | {outcome: 'unavailable'; unknown: boolean};

export const reviewIdle: ReviewState = {outcome: 'idle'};

export type ReviewAction = (previous: ReviewState, formData: FormData) => Promise<ReviewState>;

/** Calls the review action and reads what comes back: a call that did not answer is `unavailable`, and the review may have been recorded. */
export function attemptReview(action: ReviewAction, previous: ReviewState, formData: FormData): Promise<ReviewState> {
  return attemptAdministeredAction(action, previous, formData, {outcome: 'unavailable', unknown: true});
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

/**
 * What a Confirm's answer means for the screen: `reused` and `gone` forget the command ID (the next Confirm is a new command); every other answer keeps it, because a
 * retry of the very same Confirm must carry the same command. `failed` says the answer is a failure to show, announce and move focus to.
 */
export function settleReview(state: ReviewState): {forgetCommand: boolean; failed: boolean} {
  return {forgetCommand: state.outcome === 'reused' || state.outcome === 'gone', failed: state.outcome !== 'idle'};
}
