'use server';

import {redirect} from 'next/navigation';
import {homePath} from '@/lib/access';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import {operationOf} from '@/lib/authority';
import {withinBudget} from '@/lib/deadline';
import {getI18n} from '@/lib/i18n/server';
import {maxPictures} from '@/lib/picture-set';
import type {SaveState} from '@/lib/picture-view';
import {commandIdOf, projectIdOf, projectPath} from '@/lib/project-view';
import {recordPictureSet, releaseStagedPictures} from '@/lib/projects';

// Save the ordered pictures of a request (Story 2.2): the two Server Actions behind the picture screen (C-03), in the pattern of the rename and the confirm
// actions (app/projects/actions.ts, app/projects/new/actions.ts). Both are behind `withActiveAccount`, which asks for the live authorization itself, every
// time, so neither trusts the page that rendered the form: an Account that is disabled, a session that was revoked or an epoch that is stale is sent where
// any private request is sent. The Account is the verified access's (`operationOf(access.account)`), never a form field.
//
//   savePictureSet    the one command that records anything: ONE database transaction creates the Project (when the form names none) with its first picture
//                     revision, or appends a successor to the one it names. The form names only the command, the Project and the uploads, in order; the
//                     database reads each upload's SHA-256, length and type from its lease, so nothing the browser says about a file is used. The title of a
//                     new Project is the catalog's phrase and the UTC date, in the person's language (it can be renamed). Saving confirms nothing, starts nothing and spends nothing.
//   discardPictures   releases uploads the person replaced or removed before they were saved, at once, so they stop counting toward the quota. It is
//                     silent: when it fails the upload lapses on its own in 24 hours.
//
// No image body is ever part of a Server Action: the pictures go from the browser to the file gateway with a single-use ticket (lib/picture-upload.ts). A
// command ID is chosen by the screen when Save is pressed; sent again with the same set (a retry after an answer was lost) the database answers the original
// receipt, so a retry makes at most one Project and one revision. This file prints only the name and message of an error, which never contain an ID.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/** The upload IDs a form carries, in order: each shaped like an ID, none repeated, 1 to 12. Anything else is null (and the form is not the screen's). */
function uploadIdsOf(formData: FormData): string[] | null {
  const ids: string[] = [];
  for (const value of formData.getAll('uploadId')) {
    const id = projectIdOf(value);
    if (!id) return null;
    ids.push(id);
  }
  if (ids.length < 1 || ids.length > maxPictures || new Set(ids).size !== ids.length) return null;
  return ids;
}

/**
 * Whether the save certainly did not happen. A request the database never received (the key is not configured), or one it understood and rejected
 * (a 4xx), changed nothing. Anything else may have reached it: a dropped connection, a timeout, a server error, an answer that makes no sense. For those
 * the person is told to check My Projects first.
 */
function failed(error: unknown): SaveState {
  console.error('The picture set could not be saved.', describe(error));
  const certain = error instanceof AccountsConfigError || (error instanceof AccountsUnavailableError && !error.outcomeUnknown);
  return {outcome: 'unavailable', unknown: !certain};
}

/** Saves the pictures the form lists, in its order, and goes to the Project. */
export async function savePictureSet(_previous: SaveState, formData: FormData): Promise<SaveState> {
  return withActiveAccount<SaveState>({unavailable: {outcome: 'unavailable', unknown: false}}, async ({access, budget}) => {
    const commandId = commandIdOf(formData.get('commandId'));
    const named = formData.get('projectId');
    // A form that names a Project names it by a well-formed ID; one that names none (an empty field) starts a new Project.
    const projectId = named === null || named === '' ? null : projectIdOf(named);
    const uploadIds = uploadIdsOf(formData);
    if (!commandId || (named !== null && named !== '' && !projectId) || !uploadIds) return {outcome: 'invalid'};
    // The title of a new Project is the catalog's phrase in the person's language with the UTC date of this save, so drafts can be told apart in My Projects
    // (it can be renamed). The date is a plain number and dashes, and the phrase is isolated by nothing: a title holds no direction control.
    const title = projectId ? null : (await getI18n()).t('picture.projectTitle', {date: new Date().toISOString().slice(0, 10)}, {isolate: false});

    let receipt: Awaited<ReturnType<typeof recordPictureSet>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) => recordPictureSet(operationOf(access.account), {commandId, projectId, title, uploadIds}, {timeoutMs}));
    } catch (error) {
      return failed(error);
    }

    switch (receipt.outcome) {
      case 'created':
      case 'revised':
      case 'replayed':
      case 'unchanged':
        // To the Project, whose page shows its pictures in order. (A replay is the same Project: the command was already made; unchanged wrote nothing.)
        return redirect(projectPath(receipt.projectId));
      case 'unknown_upload':
      case 'not_ready':
      case 'expired_upload':
      case 'duplicate_image':
        return {outcome: receipt.outcome, position: receipt.position};
      case 'too_large':
      case 'reused':
      case 'not_editable':
        return {outcome: receipt.outcome};
      case 'unavailable':
        // The Project is not (or is no longer) there: nothing to go to, so say so instead of redirecting to a 404.
        return {outcome: 'gone'};
      default:
        // The database no longer gives this request authority (it ended between the gate and the write): nothing was saved, and Home lets the gate
        // say where this person now belongs.
        return redirect(homePath);
    }
  });
}

/** Releases uploads that were never saved (a picture replaced or removed). Answers nothing, and never fails the screen: see the top of this file. */
export async function discardPictures(formData: FormData): Promise<void> {
  await withActiveAccount<void>({unavailable: undefined}, async ({access, budget}) => {
    const uploadIds = uploadIdsOf(formData);
    if (!uploadIds) return;
    try {
      await withinBudget(budget, (timeoutMs) => releaseStagedPictures(operationOf(access.account), uploadIds, {timeoutMs}));
    } catch (error) {
      console.error('Uploads could not be released.', describe(error));
    }
  });
}
