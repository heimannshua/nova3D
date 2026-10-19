'use server';

import {redirect} from 'next/navigation';
import {homePath} from '@/lib/access';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import {operationOf} from '@/lib/authority';
import {withinBudget} from '@/lib/deadline';
import {measurementsFromFields} from '@/lib/picture-review';
import {isViewLabel} from '@/lib/picture-quality';
import {maxPictures} from '@/lib/picture-set';
import type {ReviewProblem, ReviewState} from '@/lib/picture-view';
import {commandIdOf, projectIdOf, projectPath, revisionOf} from '@/lib/project-view';
import {recordPictureReview as recordReview, type ReviewedImage} from '@/lib/projects';
import {fieldText, lineProblem, maxOutcomeLength, maxScopeLength} from '@/lib/request-intake';

// Record the review of a Project's pictures (Story 2.3): the Server Action behind the review screen (C-04, C-05 and the picture variant of C-06), in the pattern of
// the picture save and the confirm actions (app/projects/new/pictures/actions.ts, app/projects/new/actions.ts). It is behind `withActiveAccount`, which asks for the
// live authorization itself, every time, so it trusts nothing about the page that rendered the form: an Account that is disabled, a session that was revoked or an
// epoch that is stale is sent where any private request is sent. The Account is the verified access's (`operationOf(access.account)`), never a form field.
//
// ONE command records anything: a successor revision of the Project holding the mode, the person's labels and the browser's measurements of each picture, that the
// person confirmed nothing blocks the subject and, for direct conversion, the confirmed scope and outcome and (when the DATABASE finds the inputs incomplete) the
// Generate anyway acknowledgment. The form carries no pass or fail flag and no verdict of any kind: the measurements are the browser's claims and are stored as sent,
// and whether an acknowledgment is needed is decided again, in the database, from the labels and measurements. This action recomputes nothing the database
// recomputes. Confirming starts no conversion, approves no plan and authorizes no cost.
//
// A command ID is chosen by the screen when Confirm is pressed; sent again with the same review (a retry after an answer was lost) the database answers the original
// receipt, so a retry records at most one revision. This file prints only the name and message of an error, which never contain an ID.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/** The pictures a form carries, in order: each with a well-formed upload ID (none repeated), one of the seven labels and measurements in range. Anything else is null. */
function imagesOf(formData: FormData): ReviewedImage[] | null {
  const uploads = formData.getAll('uploadId');
  const labels = formData.getAll('label');
  const shortEdges = formData.getAll('shortEdge');
  const blurs = formData.getAll('blur');
  const clips = formData.getAll('clipped');
  const count = uploads.length;
  if (count < 1 || count > maxPictures || [labels, shortEdges, blurs, clips].some((column) => column.length !== count)) return null;
  const images: ReviewedImage[] = [];
  for (let index = 0; index < count; index += 1) {
    const uploadId = projectIdOf(uploads[index]);
    const label = labels[index];
    const measurements = measurementsFromFields({shortEdge: shortEdges[index], blur: blurs[index], clipped: clips[index]});
    if (!uploadId || !isViewLabel(label) || !measurements) return null;
    images.push({uploadId, label, shortEdgePx: measurements.shortEdgePx, blurVariance: measurements.blurVariance, clippedFraction: measurements.clippedFraction});
  }
  return new Set(images.map((image) => image.uploadId)).size === count ? images : null;
}

/**
 * Whether the record certainly did not happen. A request the database never received (the key is not configured), or one it understood and rejected (a 4xx), changed
 * nothing. Anything else may have reached it: a dropped connection, a timeout, a server error, an answer that makes no sense. For those the person is told to check
 * the Project first.
 */
function failed(error: unknown): ReviewState {
  console.error('The picture review could not be recorded.', describe(error));
  const certain = error instanceof AccountsConfigError || (error instanceof AccountsUnavailableError && !error.outcomeUnknown);
  return {outcome: 'unavailable', unknown: !certain};
}

/** Records the review the form describes as a successor revision, and goes to the Project. */
export async function recordPictureReview(_previous: ReviewState, formData: FormData): Promise<ReviewState> {
  return withActiveAccount<ReviewState>({unavailable: {outcome: 'unavailable', unknown: false}}, async ({access, budget}) => {
    const commandId = commandIdOf(formData.get('commandId'));
    const projectId = projectIdOf(formData.get('projectId'));
    const expectedSeq = revisionOf(formData.get('expectedSeq'));
    const mode = formData.get('mode');
    const images = imagesOf(formData);
    // A form that is not shaped like the screen's: nothing to point at.
    if (!commandId || !projectId || expectedSeq === null || expectedSeq > 2_000_000_000 || (mode !== 'evidence_images' && mode !== 'image_direct') || !images) {
      return {outcome: 'invalid', problems: []};
    }

    // Direct conversion confirms a scope and an outcome here; research-assisted records the choice and no scope (Story 2.13 confirms it after the subject is identified).
    let scope: string | null = null;
    let outcome: string | null = null;
    if (mode === 'image_direct') {
      scope = fieldText(formData.get('scope'));
      outcome = fieldText(formData.get('outcome'));
      const problems: ReviewProblem[] = [];
      const scopeProblem = lineProblem(scope, maxScopeLength);
      if (scopeProblem && scopeProblem !== 'not_a_match') problems.push({field: 'scope', problem: scopeProblem});
      const outcomeProblem = lineProblem(outcome, maxOutcomeLength);
      if (outcomeProblem && outcomeProblem !== 'not_a_match') problems.push({field: 'outcome', problem: outcomeProblem});
      if (problems.length) return {outcome: 'invalid', problems};
    }

    let receipt: Awaited<ReturnType<typeof recordReview>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) =>
        recordReview(
          operationOf(access.account),
          {
            commandId,
            projectId,
            expectedSeq,
            mode,
            scope,
            outcome,
            images,
            obstructionConfirmed: formData.get('obstruction') === 'on',
            acknowledge: mode === 'image_direct' && formData.get('acknowledge') === 'on',
          },
          {timeoutMs},
        ),
      );
    } catch (error) {
      return failed(error);
    }

    switch (receipt.outcome) {
      case 'created':
      case 'replayed':
      case 'unchanged':
        // To the Project, whose page shows the review. (A replay is the same revision: the command was already made. `unchanged` is the same review pressed again
        // under a new command, after an answer was lost: the revision already holds it, nothing was recorded, and there is nothing to tell.)
        return redirect(projectPath(receipt.projectId));
      case 'stale':
        return {outcome: 'stale'};
      case 'unknown_upload':
      case 'not_ready':
      case 'expired_upload':
        return {outcome: receipt.outcome, position: receipt.position};
      case 'obstruction_not_confirmed':
      case 'acknowledgment_required':
      case 'reused':
      case 'not_editable':
        return {outcome: receipt.outcome};
      case 'unavailable':
        // The Project is not (or is no longer) there: nothing to go to, so say so instead of redirecting to a 404.
        return {outcome: 'gone'};
      default:
        // The database no longer gives this request authority (it ended between the gate and the write): nothing was recorded, and Home lets the gate say where this
        // person now belongs.
        return redirect(homePath);
    }
  });
}
