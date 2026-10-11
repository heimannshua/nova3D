// What the sign-out Server Actions (app/account/actions.ts) answer, and how the components that call them
// read a call that did not answer. Kept apart from the actions so the client components import nothing from
// the server. A successful sign-out never answers: it redirects to sign-in. So `unavailable` is the one
// failure there is: the revocation could not be recorded, the session is kept, and the person may try again.
import {unstable_rethrow} from 'next/navigation';

/** `done` carries how many sessions were signed out ("sign out my other sessions"); a sign-out never answers `done`, it redirects. */
export type SessionActionState = {outcome: 'idle'} | {outcome: 'unavailable'} | {outcome: 'done'; count: number};

export const sessionActionIdle: SessionActionState = {outcome: 'idle'};

export type SessionAction = (previous: SessionActionState) => Promise<SessionActionState>;

/** The message Next.js's client throws when a Server Action's answer is not an action response at all: what a redirect by the proxy to an HTML page looks like (tests/unit/session-actions.test.ts pins it to the installed Next.js). */
export const unexpectedResponseMessage = 'An unexpected response was received from the server.';

/** Loads this page again, which asks the proxy afresh: it sends the person wherever they now belong. */
export const reloadHere = () => window.location.assign(window.location.href);

/**
 * Calls a sign-out action and reads what comes back.
 *
 *  - A redirect (sign-out has finished) travels as a thrown error and is rethrown for Next.js to follow.
 *  - The one answer that is not the action's own is "an unexpected response": that is what a redirect by the
 *    proxy looks like to a Server Action, because this session no longer has access (it was signed out in
 *    another tab, its grant was revoked, the Account was disabled). Loading the page again lets the proxy
 *    say so and send the person to sign-in, instead of leaving a button that cannot work. It happens at most
 *    once for each attempt, so it can never become a reload loop.
 *  - Anything else, a dropped connection or a real server error, is a failure to say so: the action did not
 *    complete, nothing is known to have changed, and the person may try again (`unavailable`). Nothing
 *    reloads silently.
 */
export async function attemptSessionAction(action: SessionAction, previous: SessionActionState, navigate: () => void = reloadHere): Promise<SessionActionState> {
  try {
    return await action(previous);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof Error && error.message === unexpectedResponseMessage) {
      navigate();
      return previous;
    }
    return {outcome: 'unavailable'};
  }
}
