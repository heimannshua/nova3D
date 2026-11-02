'use server';

import {refresh} from 'next/cache';
import {redirect} from 'next/navigation';
import {homePath} from '@/lib/access';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import {operationOf} from '@/lib/authority';
import {withinBudget} from '@/lib/deadline';
import {cancelJob} from '@/lib/job-commands';
import {commandIdOf, jobIdOf, type JobCancelState} from '@/lib/job-view';

// Cancel a Job (Story 2.7: J-02): the only command a Job screen sends. It is a Server Action behind `withActiveAccount`, which asks for the live authorization itself, every time,
// so it does not trust the page that rendered the button: an Account that is disabled, a session that was revoked or an epoch that is stale is sent where any private request is
// sent, and nothing is asked of the database. In this order, and nothing changes before all of them pass:
//
//   1. The Account is the verified access's (`access.account`, from `operationOf`), with the epoch the request was authorized under. It is never read from the form, the URL or a
//      header: the form names the Job and the command, and nothing else.
//   2. The form is read and checked: a Job ID and a command ID that are shaped like them. The command ID belongs to one confirmation (the dialog makes it when it opens), so pressing
//      the button again after an answer was lost sends the same command and the database answers its receipt.
//   3. `cancelJob`: ONE database transaction. The database begins it with `identity.assert_operation_authority`, so the authority is checked again at the moment of the write. It ENDS
//      THE LEASE FIRST (commit authority is revoked before anything else, so a result that is still on its way has nowhere to land), then moves the attempt to cancelled, abandons the
//      steps that never started and releases what was reserved for them; a request that was already sent stays chargeable and held.
//
// A Job that is another Account's, deleted or unknown is `gone`, and nothing else is said about it. This file prints only the name and message of an error, which never contain an
// ID, and takes the Job and the command from nowhere but the form.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

const nothingHappened: JobCancelState = {outcome: 'unavailable', unknown: false};

/**
 * Whether the cancellation certainly did not happen. A request the database never received (the key is not configured), or one it understood and rejected (a 4xx), changed
 * nothing. Anything else may have reached it: a dropped connection, a timeout, a server error, an answer that makes no sense. For those the person is told to look at the page first.
 */
function failed(error: unknown): JobCancelState {
  console.error('The Job cancellation failed.', describe(error));
  const certain = error instanceof AccountsConfigError || (error instanceof AccountsUnavailableError && !error.outcomeUnknown);
  // "Look at the page" must point at a page that has been read since: a lost answer may have been a cancellation that was made.
  if (!certain) refresh();
  return {outcome: 'unavailable', unknown: !certain};
}

/** Cancels a Job of the signed-in Account. The answer says what happened; see `JobCancelState`. */
export async function cancelJobAction(_previous: JobCancelState, formData: FormData): Promise<JobCancelState> {
  return withActiveAccount<JobCancelState>({unavailable: nothingHappened}, async ({access, budget}) => {
    const jobId = jobIdOf(formData.get('jobId'));
    const commandId = commandIdOf(formData.get('commandId'));
    if (!jobId || !commandId) return {outcome: 'invalid'};

    let receipt: Awaited<ReturnType<typeof cancelJob>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) => cancelJob(operationOf(access.account), {commandId, jobId}, {timeoutMs}));
    } catch (error) {
      return failed(error);
    }

    switch (receipt.outcome) {
      case 'cancelled':
      case 'replayed':
        // The page shows the Job as it is now.
        refresh();
        return {outcome: 'cancelled', replayed: receipt.outcome === 'replayed'};
      case 'not_cancellable':
        // It had ended (or been cancelled in another window) before this arrived: the page shows how.
        refresh();
        return {outcome: 'not_cancellable', state: receipt.state};
      case 'reused':
        return {outcome: 'reused'};
      case 'unavailable':
        // The page this was sent from now shows the one page every unavailable Job gets.
        refresh();
        return {outcome: 'gone'};
      default:
        // The database no longer gives this request authority (it ended between the gate and the write): nothing changed, and Home lets the gate say where this person now belongs.
        return redirect(homePath);
    }
  });
}
