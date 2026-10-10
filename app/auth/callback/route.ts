import {NextResponse} from 'next/server';
import {claimPreauthorization, decideSignIn, gatingTimeoutMs, isOutageError, readUser, type SignInDecision} from '@/lib/access';
import {withDeadline} from '@/lib/deadline';
import {signInErrorPath} from '@/lib/sign-in';
import {createSupabaseServerClient, endSession, expireAuthCookies} from '@/lib/supabase/server';

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

// Where Google sends the browser back to. A verified Google identity can always finish signing in; what it
// may then reach depends on its Account. The seeded address of an invited person becomes an Account here,
// at its first sign-in. Everything else is decided by lib/access.ts. A failure of any step, or a service
// that does not answer in time, signs the person out and says so; an outage ends only this browser's
// session, because it says nothing about the person's other devices.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = (path: string) => NextResponse.redirect(new URL(path, url));

  const code = url.searchParams.get('code');
  if (!code) {
    // Google (or Auth) turned the sign-in back: cancelled, or refused. That is a failed sign-in, not an outage.
    const turnedBack = ['error', 'error_code', 'error_description'].some((name) => url.searchParams.has(name));
    return to(signInErrorPath(turnedBack ? 'auth_failed' : 'auth_unavailable'));
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return to(signInErrorPath('auth_unavailable'));

  let exchanged: Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>> | null = null;
  try {
    exchanged = await withDeadline(supabase.auth.exchangeCodeForSession(code), gatingTimeoutMs);
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
  const read = await readUser(supabase);
  const decision: SignInDecision = read.kind === 'user' ? await claimPreauthorization(read.user) : decideSignIn(read, null);
  if (decision.signOut) await endSession(supabase, decision.scope);
  return to(decision.to);
}
