import {NextResponse, type NextRequest} from 'next/server';
import {claimPreauthorization, decideAccess, registerPath, resolveAccess, type AccessDecision} from '@/lib/access';
import {hasSupabaseConfig} from '@/lib/auth-config';
import {isPublicPath} from '@/lib/public-paths';
import {signInErrorPath, type SignInErrorCode} from '@/lib/sign-in';
import {createSupabaseProxyClient} from '@/lib/supabase/proxy';
import {signOutQuietly} from '@/lib/supabase/sign-out';

const legacyInterimSessionCookie = 'nova3d-interim-session';

function clearLegacyCookie(request: NextRequest, response: NextResponse) {
  if (request.cookies.has(legacyInterimSessionCookie)) {
    response.cookies.set(legacyInterimSessionCookie, '', {httpOnly: true, maxAge: 0, path: '/'});
  }
  return response;
}

// A page is reached by GET and a Server Action by POST. A 307 would send the POST on to the login page
// with its body; a 303 turns it into a plain GET.
const isNavigation = (request: NextRequest) => request.method === 'GET' || request.method === 'HEAD';
const redirectStatus = (request: NextRequest) => (isNavigation(request) ? 307 : 303);

function deny(request: NextRequest, error: SignInErrorCode) {
  return clearLegacyCookie(request, NextResponse.redirect(new URL(signInErrorPath(error), request.url), redirectStatus(request)));
}

/**
 * Gate (Story 1.3): every path that is not public needs a verified Google session and a live Account.
 * A session without an Account reaches /register only; a disabled Account is signed out; and any failure
 * while deciding, Auth or the database, denies access. The proxy adds one Auth call and one service-role
 * call to each private request; Story 1.4 replaces that with session grants.
 *
 * One more thing happens here, because only the proxy (and routes and actions) can clear cookies: a person
 * who signed in BEFORE their address was pre-authorized has no Account, and the sign-in callback, which
 * consumes pre-authorizations, will not run again until they sign in again. So when such an identity opens
 * /register, the pre-authorization is consumed exactly as the callback does, and a refusal, a disabled
 * Account or a failure signs the person out the same way.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicPath(pathname, process.env)) return clearLegacyCookie(request, NextResponse.next());
  if (!hasSupabaseConfig()) return deny(request, 'auth_not_configured');

  try {
    const client = createSupabaseProxyClient(request);
    if (!client) return deny(request, 'auth_not_configured');

    const access = await resolveAccess(client.supabase);
    let decision: AccessDecision = decideAccess(pathname, access);
    if (access.state === 'unregistered' && pathname === registerPath && request.method === 'GET') {
      const claimed = await claimPreauthorization(access.user);
      // Still nothing to claim: the registration screen is the answer.
      if (claimed.to !== registerPath) decision = {action: 'redirect', ...claimed};
    }
    if (decision.action === 'allow') return clearLegacyCookie(request, client.next());

    // A refusal that signs the person out does it on a page request. A Server Action that is refused (a form
    // left open) gets only the redirect: the browser then asks for /register, and THAT request is the one that
    // signs out and reaches the sign-in page with its own message. Signing out on the POST would take the
    // session away before the page could say why.
    let signedOut = false;
    if (decision.signOut && isNavigation(request)) {
      // Auth is told to end the session first; whether or not it answers, the cookies are expired too.
      await signOutQuietly(client.supabase, decision.scope);
      signedOut = true;
    }
    const response = client.redirect(new URL(decision.to, request.url), redirectStatus(request));
    return clearLegacyCookie(request, signedOut ? client.expireSession(response) : response);
  } catch (error) {
    console.error('Access check failed closed.', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');
    return deny(request, 'auth_unavailable');
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
