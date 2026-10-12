import {refresh} from 'next/cache';
import {redirect} from 'next/navigation';
import {gatingTimeoutMs, homePath} from '@/lib/access';
import {checkMarker, type MarkerOutcome} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import type {Confirmation} from '@/lib/administration';
import {withinBudget, type Budget} from '@/lib/deadline';

// The one place that decides an Administrator's change may happen (Stories 1.11 and 1.5). The invitation page's three Server
// Actions and the Accounts page's two all go through `administered`, so the order of the checks is written once, and a
// structural test (tests/unit/gate-structure.test.ts) reads it here. Each action runs behind `withActiveAccount`, which asks
// for the live authorization itself, every time, so none of them trusts the page that rendered the button. In this order, and
// nothing changes before all of them pass:
//
//   1. The Account's role is `administrator` (the live authorization's, not the request's). Otherwise the attempt is refused,
//      recorded as denied by the action's `recordDenied`, and nothing else is done.
//   2. The session's own `administration` marker is valid (`checkMarker`, five minutes, reusable). Anything but `allowed` is a
//      refusal, recorded by the action's `recordRefused`; `none` and `expired` offer the step-up. The marker is checked here and
//      not inside the database function that makes the change, because the seed command shares the invitation functions and has
//      no session, and the `administration` marker is reusable for its five minutes, so a check followed by the call loses
//      nothing.
//   3. `run`, with the actor `user:<Auth user ID>` taken from the verified session, never from the request.
//
// Nothing here knows what the change is, or what a refusal is recorded as: the action passes that in. A failure to record a
// refusal is the action's to log, and never turns the refusal into a permission.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/** What an action answers for each way its change can be stopped before it starts, and how it records the two refusals. */
export type AdministeredSteps<S> = {
  /** The answer when a check could not be made: nothing was changed, and trying again is safe. */
  unavailable: S;
  /** The answer for an Account that is not the Administrator. */
  denied: S;
  /** The answer for an Administrator with no valid marker; `stepUp` says whether to offer the step-up (there was none, or it ran out). */
  refused: (stepUp: boolean) => S;
  /** Records the attempt of an Account that is not the Administrator. Never throws. */
  recordDenied: (userId: string) => Promise<void>;
  /** Records the attempt of an Administrator without a valid marker. Never throws. */
  recordRefused: (userId: string) => Promise<void>;
};

/** The role check, then the marker check, then `run` (see the top of this file). */
export async function administered<S>(
  steps: AdministeredSteps<S>,
  run: (context: {actor: string; budget: Budget}) => Promise<S>,
): Promise<S> {
  return withActiveAccount<S>({unavailable: steps.unavailable}, async ({access, budget}) => {
    const {user, account} = access;

    if (account.role !== 'administrator') {
      await steps.recordDenied(user.id);
      return steps.denied;
    }

    let marker: MarkerOutcome;
    try {
      marker = await withinBudget(budget, (timeoutMs) =>
        checkMarker({userId: user.id, sessionId: user.sessionId, actionClass: 'administration'}, {timeoutMs}),
      );
    } catch (error) {
      console.error('The administrator change could not check the fresh sign-in; nothing was changed.', describe(error));
      return steps.unavailable;
    }
    // The session no longer holds a valid grant of an active Account (it ended a moment ago): not a reason to try
    // again. Home lets the access gate decide where this person now belongs, as the step-up action does.
    if (marker === 'denied') return redirect(homePath);
    if (marker !== 'allowed') {
      await steps.recordRefused(user.id);
      const stepUp = marker === 'none' || marker === 'expired';
      // The page may still say "you have confirmed it is you" (the marker ran out while it was open): read it again, so
      // it shows the step-up beforehand, as it would on a new visit. Only the server's render changes; what the page
      // holds in the browser's own state stays.
      if (stepUp) refresh();
      return steps.refused(stepUp);
    }

    return run({actor: `user:${user.id}`, budget});
  });
}

/**
 * Whether the Administrator has a valid `administration` marker right now. A page uses it only to decide whether "Confirm it
 * is you" is offered before a change is tried: the Server Action checks the marker itself, every time, and is the authority.
 * A check that cannot be made says nothing (`unknown`) and the actions decide.
 */
export async function readConfirmation(user: {id: string; sessionId: string}): Promise<Confirmation> {
  try {
    const outcome = await checkMarker({userId: user.id, sessionId: user.sessionId, actionClass: 'administration'}, {timeoutMs: gatingTimeoutMs});
    return outcome === 'allowed' ? 'confirmed' : 'needed';
  } catch (error) {
    console.error('The fresh sign-in could not be checked for an administration page.', describe(error));
    return 'unknown';
  }
}
