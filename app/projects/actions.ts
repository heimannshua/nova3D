'use server';

import {refresh} from 'next/cache';
import {redirect} from 'next/navigation';
import {homePath} from '@/lib/access';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import {operationOf} from '@/lib/authority';
import {withinBudget} from '@/lib/deadline';
import {renameProjectCommand} from '@/lib/projects';
import {commandIdOf, normalizeTitle, projectIdOf, revisionOf, titleProblem, type RenameState} from '@/lib/project-view';

// Rename a Project (Story 1.7): the first command that carries an expected revision, and the only one. It is a Server Action behind
// `withActiveAccount`, which asks for the live authorization itself, every time, so it does not trust the page that rendered the
// button: an Account that is disabled, a session that was revoked or an epoch that is stale is sent where any private request is
// sent, and nothing is asked of the database. In this order, and nothing changes before all of them pass:
//
//   1. The Account is the verified access's (`access.account`, from `operationOf`), with the epoch the request was authorized
//      under. It is never read from the form, the URL or a header: the form names the Project, the command, the revision the
//      person saw and the new title, and nothing else.
//   2. The form is read and checked: a Project ID, a command ID and an expected revision that are shaped like them, and a title
//      that is trimmed, not blank, not over 120 characters and free of control characters. A title that is not valid is a field
//      error; nothing is sent.
//   3. `renameProjectCommand`: ONE database transaction under a lock on the Project row. The database begins it with
//      `identity.assert_operation_authority`, so the authority is checked again at the moment of the write, and a disable cannot
//      commit between the check and the write. It answers the original receipt for the same command sent again, refuses the
//      same command ID with another change, and refuses a stale revision with the current title and revision and changes nothing.
//
// A Project that is another Account's, deleted or unknown is `gone`, and nothing else is said about it. This file prints only the
// name and message of an error, which never contain a title or an ID, and takes the title from nowhere but the form.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

const nothingHappened: RenameState = {outcome: 'unavailable', unknown: false};

/**
 * Whether the rename certainly did not happen. A request the database never received (the key is not configured), or one it
 * understood and rejected (a 4xx), changed nothing. Anything else may have reached it: a dropped connection, a timeout, a server
 * error, an answer that makes no sense. For those the person is told to check the name first.
 */
function failed(error: unknown): RenameState {
  console.error('The Project rename failed.', describe(error));
  const certain = error instanceof AccountsConfigError || (error instanceof AccountsUnavailableError && !error.outcomeUnknown);
  // "Check the name" must point at a name that has been read since: a lost answer may have been a rename that was made.
  if (!certain) refresh();
  return {outcome: 'unavailable', unknown: !certain};
}

/** Renames a Project of the signed-in Account. The answer says what happened; see `RenameState`. */
export async function renameProject(_previous: RenameState, formData: FormData): Promise<RenameState> {
  return withActiveAccount<RenameState>({unavailable: nothingHappened}, async ({access, budget}) => {
    const projectId = projectIdOf(formData.get('projectId'));
    const commandId = commandIdOf(formData.get('commandId'));
    const expectedRevision = revisionOf(formData.get('expectedRevision'));
    if (!projectId || !commandId || expectedRevision === null) return {outcome: 'invalid', problem: 'request'};
    const title = normalizeTitle(formData.get('title'));
    const problem = titleProblem(title);
    if (problem) return {outcome: 'invalid', problem};

    let receipt: Awaited<ReturnType<typeof renameProjectCommand>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) =>
        renameProjectCommand(operationOf(access.account), {commandId, projectId, expectedRevision, title}, {timeoutMs}),
      );
    } catch (error) {
      return failed(error);
    }

    switch (receipt.outcome) {
      case 'renamed':
        // The page shows the new title and revision everywhere.
        refresh();
        return {outcome: 'renamed', title: receipt.title, revision: receipt.revision, replayed: receipt.replayed};
      case 'stale':
        // Someone renamed it first: the page shows the title it has now, and the answer carries it too.
        refresh();
        return {outcome: 'stale', title: receipt.title, revision: receipt.revision};
      case 'reused':
        return {outcome: 'reused'};
      case 'unavailable':
        // The page this was sent from now shows the one page every unavailable Project gets.
        refresh();
        return {outcome: 'gone'};
      default:
        // The database no longer gives this request authority (it ended between the gate and the write): nothing changed,
        // and Home lets the gate say where this person now belongs.
        return redirect(homePath);
    }
  });
}
