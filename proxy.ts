import {NextResponse, type NextRequest} from 'next/server';
import {
  apiDenial,
  apiDenialResponse,
  apiNotConfigured,
  apiUnavailable,
  claimPreauthorization,
  decideAccess,
  gatingTimeoutMs,
  registerPath,
  resolveAccess,
  type AccessDecision,
  type ApiDenial,
} from '@/lib/access';
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

// A client of /api (a fetch from the app, a worker, a test) cannot follow a redirect to a sign-in page, so a
// private /api path is answered with JSON and a status, never HTML.
const isApiPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

/**
 * The JSON answer for a denied /api request: 401 or 403, or 503 and `retryable` when the check could not be
 * made. Like a redirect, it carries the session cookies Auth refreshed while the check ran, or the next
 * request would present a refresh token that has already been used.
 */
function denyApi(request: NextRequest, denial: ApiDenial, client?: {respond(response: NextResponse): NextResponse}) {
  const {body, init} = apiDenialResponse(denial);
  const response = NextResponse.json(body, init);
  return clearLegacyCookie(request, client ? client.respond(response) : response);
}

function deny(request: NextRequest, error: SignInErrorCode) {
  return clearLegacyCookie(request, NextResponse.redirect(new URL(signInErrorPath(error), request.url), redirectStatus(request)));
}

/**
 * Gate (Stories 1.3 and 1.4a): every path that is not public needs a verified Google session, a live Account
 * and a valid session grant, all from one authorization call. A session without an Account reaches /register
 * only; a disabled Account, or an identity that is no longer the pinned one, is signed out; a session whose
 * grant is missing, revoked, expired, idle or stale is sent to sign in again; and any failure while deciding,
 * Auth or the database, denies access and keeps the session, so the person can come back when it clears. The
 * proxy makes one Auth call and one authorization call per private request, and the page repeats them (once,
 * memoized for the render) because the proxy alone is not a boundary.
 *
 * A private /api path is answered with JSON (401, 403 or a retryable 503), never a redirect.
 *
 * One more thing happens here, because only the proxy (and routes and actions) can clear cookies: a person
 * who signed in BEFORE their address was pre-authorized has no Account, and the sign-in callback, which
 * consumes pre-authorizations, will not run again until they sign in again. So when such an identity opens
 * /register, the pre-authorization is consumed exactly as the callback does (which also issues the grant of
 * this session), and a refusal, a disabled Account or a failure signs the person out the same way.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicPath(pathname, process.env)) return clearLegacyCookie(request, NextResponse.next());
  const api = isApiPath(pathname);
  if (!hasSupabaseConfig()) return api ? denyApi(request, apiNotConfigured) : deny(request, 'auth_not_configured');

  try {
    const client = createSupabaseProxyClient(request);
    if (!client) return api ? denyApi(request, apiNotConfigured) : deny(request, 'auth_not_configured');

    const access = await resolveAccess(client.supabase);
    let decision: AccessDecision = decideAccess(pathname, access, request.method);
    if (access.state === 'unregistered' && pathname === registerPath && request.method === 'GET') {
      const claimed = await claimPreauthorization(access.user, {timeoutMs: gatingTimeoutMs});
      // Still nothing to claim: the registration screen is the answer.
      if (claimed.to !== registerPath) decision = {action: 'redirect', ...claimed};
    }
    if (decision.action === 'allow') {
      if (api) {
        // An /api path is never an Account-less identity's to use, whatever the page table says about it.
        const denial = apiDenial(access);
        if (denial) return denyApi(request, denial, client);
      }
      return clearLegacyCookie(request, client.next());
    }

    // A refusal that signs the person out does it on a page request. A Server Action that is refused (a form
    // left open) gets only the redirect: the browser then asks for /register, and THAT request is the one that
    // signs out and reaches the sign-in page with its own message. Signing out on the POST would take the
    // session away before the page could say why. An /api client has no page to say why, so it is signed out
    // on whatever request it made.
    let signedOut = false;
    if (decision.signOut && (isNavigation(request) || api)) {
      // Auth is told to end the session first; whether or not it answers, the cookies are expired too.
      await signOutQuietly(client.supabase, decision.scope);
      signedOut = true;
    }
    if (api) {
      const denied = denyApi(request, apiDenial(access) ?? apiUnavailable, client);
      return signedOut ? client.expireSession(denied) : denied;
    }
    const response = client.redirect(new URL(decision.to, request.url), redirectStatus(request));
    return clearLegacyCookie(request, signedOut ? client.expireSession(response) : response);
  } catch (error) {
    console.error('Access check failed closed.', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');
    return api ? denyApi(request, apiUnavailable) : deny(request, 'auth_unavailable');
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
