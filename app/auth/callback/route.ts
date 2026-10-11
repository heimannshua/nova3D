import {claimPreauthorization, decideSignIn, finishStepUp, isOutageError, readUser, signInTimeoutMs, type SignInDecision} from '@/lib/access';
import {createBudget, withinBudget} from '@/lib/deadline';
import {signInErrorPath} from '@/lib/sign-in';
import {clearStepUpCookie, readStepUpFlow} from '@/lib/step-up.server';
import {createSupabaseServerClient, endSession, expireAuthCookies} from '@/lib/supabase/server';

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

// Where Google sends the browser back to. A verified Google identity can always finish signing in; what it
// may then reach depends on its Account. The seeded address of an invited person becomes an Account here,
// at its first sign-in. Everything else is decided by lib/access.ts. A failure of any step, or a service
// that does not answer in time signs the person out and says so; an outage ends only this browser's
// session, because it says nothing about the person's other devices. The whole chain (the code exchange, the
// user, the pre-authorization, the grant) shares one time budget. The session the grant is issued for is the
// one in the token the code exchange has just returned, checked against the user Auth then vouches for.
//
// Step-up (Story 1.4b) is this same callback: a browser that holds a step-up cookie and comes back from the
// Google sign-in that the step-up began (its PKCE verifier is the one the nonce is bound to) has the new
// session handed to the database to accept or reject (lib/access.ts finishStepUp). Acceptance already issued
// the new session's grant and its marker and revoked the initiating session's, so the person goes straight to
// the class's own path. A rejection or a failure ends only the new session (local scope; never a global
// sign-out) and the person signs in again, because the exchange has already replaced this browser's session
// cookie. Any other sign-in, including one started in another tab or another browser, never takes this branch
// and is an ordinary sign-in.
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Every answer is a redirect with a RELATIVE Location, which the browser resolves against the address it
  // actually used. A route handler's `request.url` is not that address everywhere (behind `next start
  // --hostname 127.0.0.1` it names `localhost`, which would leave the session cookie behind on 127.0.0.1),
  // and a sign-in must end where it began.
  const to = (path: string) => new Response(null, {status: 307, headers: {location: path}});

  const code = url.searchParams.get('code');
  if (!code) {
    // Google (or Auth) turned the sign-in back: cancelled, or refused. That is a failed sign-in, not an outage.
    const turnedBack = ['error', 'error_code', 'error_description'].some((name) => url.searchParams.has(name));
    return to(signInErrorPath(turnedBack ? 'auth_failed' : 'auth_unavailable'));
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return to(signInErrorPath('auth_unavailable'));

  // The step-up cookie and the PKCE verifier are read BEFORE the exchange, which removes the verifier.
  const stepUp = await readStepUpFlow();

  const budget = createBudget(signInTimeoutMs);
  let exchanged: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>> | null = null;
  try {
    exchanged = await withinBudget(budget, () => supabase.auth.exchangeCodeForSession(code));
  } catch (error) {
    console.error('Google sign-in could not be completed (Auth did not answer).', describe(error));
  }
  if (!exchanged) {
    // Auth did not answer in time. Do not wait on it again: expire what this request holds and say so.
    await expireAuthCookies();
    return to(signInErrorPath('auth_unavailable'));
  }
  if (exchanged.error || !exchanged.data.user) {
    const outage = isOutageError(exchanged.error);
    if (exchanged.data.user) await endSession(supabase, outage ? 'local' : 'global');
    return to(signInErrorPath(outage ? 'auth_unavailable' : 'auth_failed'));
  }

  // Who signed in, from Auth itself; then the pre-authorization for that user's verified address.
  const read = await readUser(supabase, {budget, accessToken: exchanged.data.session?.access_token});
  let decision: SignInDecision | null = null;
  if (stepUp) {
    if (read.kind === 'user') {
      const finished = await finishStepUp(read.user, stepUp, {budget});
      if (finished.kind === 'decided') decision = finished.decision;
    }
    // Whatever came of it, the cookie has done its work: the verifier it was bound to is consumed, and a sign-in
    // that yielded no user (an outage, an ineligible identity) leaves nothing for it to complete.
    await clearStepUpCookie();
  }
  decision ??= read.kind === 'user' ? await claimPreauthorization(read.user, {budget}) : decideSignIn(read, null);
  if (decision.signOut) await endSession(supabase, decision.scope);
  return to(decision.to);
}
