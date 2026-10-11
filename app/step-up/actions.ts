'use server';

import {redirect} from 'next/navigation';
import {startStepUp} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import {withinBudget} from '@/lib/deadline';
import {homePath} from '@/lib/access';
import {requestGoogleSignIn} from '@/lib/sign-in';
import {isStepUpClass, type StepUpState} from '@/lib/step-up';
import {challengeOfAuthorizeUrl, hashStepUpSecret, newStepUpSecret} from '@/lib/step-up-flow';
import {requestOrigin, restoreVerifierCookies, setStepUpCookie, snapshotVerifierCookies} from '@/lib/step-up.server';
import {createSupabaseServerClient} from '@/lib/supabase/server';

const unavailable: StepUpState = {outcome: 'unavailable'};
// A name and a message, never a request, a token, a cookie or a secret.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/**
 * Starts a step-up (Story 1.4b): proof that the person has just signed in again, for one action class. The page
 * binds the class to this action (`beginStepUp.bind(null, actionClass)`) and the form has no field: the class is
 * checked here against the closed list, the Account and the session are the verified session's
 * (`withActiveAccount` asks for itself, every time), and the return path is derived from the class by the
 * callback, never taken from a request.
 *
 * In order: Google sign-in is built on the server with the account chooser (`prompt=select_account`, no
 * `login_hint`), which writes its PKCE verifier into this browser's cookies; the database records a nonce bound
 * to the Account, this session, the random secret that goes in an httpOnly cookie (only its hash is stored) and
 * the challenge of that very flow; the cookie is set; and the browser goes to Google. Nothing is set and nobody
 * is redirected unless the nonce exists, and if the nonce cannot be written the verifier cookies the start wrote
 * are undone (those cookies only, and one it displaced is put back; never the session cookie). The initiating
 * session is untouched until the step-up is accepted.
 *
 * Fails closed: if the database cannot be reached the person is told to try again and nothing fresh exists. If it
 * answers `refused` the session no longer has access (its grant ended, the Account was disabled, the Google
 * identity changed): "try again in a moment" would be untrue, so the person is sent Home and the access gate
 * decides where they belong.
 */
export async function beginStepUp(actionClass: string, _previous: StepUpState): Promise<StepUpState> {
  if (!isStepUpClass(actionClass)) return unavailable;
  return withActiveAccount({unavailable}, async ({access, budget}) => {
    const where = await requestOrigin();
    if (!where) return unavailable;

    const secret = newStepUpSecret();
    // The Google sign-in's own client, so that exactly the verifier cookies it writes are known and can be undone.
    const before = await snapshotVerifierCookies();
    const written = new Set<string>();
    const oauth = await createSupabaseServerClient({track: ({name}) => written.add(name)});
    const google = await requestGoogleSignIn(oauth, where.origin, {chooser: true});
    const challenge = google.ok ? challengeOfAuthorizeUrl(google.url) : null;
    if (!google.ok || !challenge) {
      await restoreVerifierCookies(before, written);
      return unavailable;
    }

    let started: Awaited<ReturnType<typeof startStepUp>>;
    try {
      started = await withinBudget(budget, (timeoutMs) =>
        startStepUp(
          {userId: access.user.id, sessionId: access.user.sessionId, actionClass, secretHash: hashStepUpSecret(secret), verifierHash: challenge},
          {timeoutMs},
        ),
      );
    } catch (error) {
      console.error('The step-up could not be started; failing closed.', describe(error));
      await restoreVerifierCookies(before, written);
      return unavailable;
    }
    if (started.outcome !== 'started') {
      await restoreVerifierCookies(before, written);
      if (started.outcome === 'limited') return {outcome: 'limited'};
      // `refused`: the database no longer sees this session as an active Account's. Not a reason to try again.
      console.error('The step-up was refused; the session no longer has access.', 'refused');
      return redirect(homePath);
    }

    await setStepUpCookie(secret, {secure: where.secure});
    return redirect(google.url);
  });
}
