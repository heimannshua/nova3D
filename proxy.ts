import {NextResponse, type NextRequest} from 'next/server';
import {
  adoptDevicePreferences,
  apiDenial,
  apiDenialResponse,
  apiNotConfigured,
  apiOriginNotAllowed,
  apiUnavailable,
  claimPreauthorization,
  decideAccess,
  gatingTimeoutMs,
  issueCsrfToken,
  registerPath,
  resolveAccess,
  type Access,
  type AccessDecision,
  type ApiDenial,
} from '@/lib/access';
import {hasSupabaseConfig} from '@/lib/auth-config';
import {recordFromCookies} from '@/lib/preferences';
import {hasUndecodableProjectId, undecodableProjectPath} from '@/lib/project-paths';
import {isMachinePath, isPublicPath} from '@/lib/public-paths';
import {csrfCookieName, csrfCookieOptions, decideOrigin, isCsrfToken, isDocumentNavigation, isSecureRequest, originInputOf, type OriginRefusal} from '@/lib/request-integrity';
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

/**
 * Why a request that would otherwise go on is refused for where it came from, or null (Story 1.4c): any method
 * but GET, HEAD and OPTIONS needs an `Origin` that is this application's own, and no `Sec-Fetch-Site:
 * cross-site`. Next checks the Origin of a Server Action itself and lets a missing one through; this does not,
 * for every non-safe request, Server Action or route.
 */
function originRefusal(request: NextRequest): OriginRefusal | null {
  const decision = decideOrigin(originInputOf(request.method, request.headers));
  return decision.allowed ? null : decision.reason;
}

/**
 * The refusal: 403 JSON for an /api path and a plain 403 elsewhere, never a redirect, so a request from
 * another site is told nothing about where to go. Like any other answer it carries the session cookies Auth
 * refreshed while the access decision ran, when there was one. It is logged as ONE line that names the rule
 * and the method and nothing else: no header value, no path, no query, because every one of them is the
 * sender's, and a refusal is exactly the request that cannot be trusted to log its own words.
 */
function refuseOrigin(request: NextRequest, api: boolean, reason: OriginRefusal, client?: {respond(response: NextResponse): NextResponse}) {
  const method = /^[A-Za-z]{1,16}$/.test(request.method) ? request.method.toUpperCase() : 'OTHER';
  console.warn(`A request was refused for its origin. ${reason} ${method}`);
  if (api) return denyApi(request, apiOriginNotAllowed, client);
  const response = new NextResponse('Forbidden', {status: 403, headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'}});
  return clearLegacyCookie(request, client ? client.respond(response) : response);
}

/**
 * The CSRF cookie to set on a page that is about to render, or undefined. Only an active Account's browser
 * navigation (a document request; not a client-side navigation, a prefetch or an /api call) that carries no
 * token cookie is issued one. The database decides whether to store a hash (api.issue_csrf), and only a stored
 * hash is delivered, so a second tab that asks at the same moment sets nothing and the cookie and the hash
 * never differ. A failure issues nothing and never blocks the page. A cookie that is already there is left
 * alone, which is also why a request from another site cannot make the token change: it cannot read the cookie
 * and cannot clear it. "There" means shaped like a token: a truncated or planted value counts as absent, or it
 * would keep the real one from ever being issued.
 */
async function pageCsrfCookie(request: NextRequest, api: boolean, access: Access) {
  if (api || access.state !== 'active') return undefined;
  if (!isDocumentNavigation(request.method, request.headers) || isCsrfToken(request.cookies.get(csrfCookieName)?.value)) return undefined;
  const token = await issueCsrfToken(access.user);
  if (!token) return undefined;
  return {name: csrfCookieName, value: token, options: csrfCookieOptions(isSecureRequest(request.headers.get('x-forwarded-proto'), request.nextUrl.protocol))};
}

/**
 * A person's first sign-in adopts the device's choices (Story 1.4d): on an authorized page navigation whose active
 * answer carries no preferences record, the valid cookies (language, light or dark, explanation detail, first-use
 * guidance; an absent or tampered one is the default, and a language no cookie chose is "follow the device")
 * become the Account's record, once. It covers every way a first session starts that ends in a full page load (the
 * sign-in callback's redirect, the `/register` claim); the registration form's landing is a Server Action redirect,
 * which is a client-side navigation, and adopts at the next full page load. The database inserts only
 * when there is still no record, so two first requests at once leave one, and a record that exists is never
 * touched: from then on the record wins and the cookies are only a copy. Only a document navigation adopts, like
 * the CSRF cookie: a prefetch, a client-side navigation or an /api call has not opened the page. A failure is
 * logged (the error's name and message only) and never blocks the page, which renders from the cookies; the next
 * navigation tries again.
 */
async function adoptDeviceChoices(request: NextRequest, api: boolean, access: Access) {
  if (api || access.state !== 'active' || access.account.preferences !== null) return;
  if (!isDocumentNavigation(request.method, request.headers)) return;
  await adoptDevicePreferences(access.account, recordFromCookies((name) => request.cookies.get(name)?.value));
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
 * Request integrity (Story 1.4c) comes after the access decision, so a request that is denied keeps its 401, 403
 * or redirect: a request that would otherwise go on, and every request to a public path, is refused with a 403
 * unless it is safe (GET, HEAD, OPTIONS) or its Origin is this application's. A page request that goes on may
 * also be handed its session's CSRF token cookie (pageCsrfCookie), and is the moment an Account with no preferences
 * record adopts the device's cookies (adoptDeviceChoices).
 *
 * One more thing happens here, because only the proxy (and routes and actions) can clear cookies: a person
 * who signed in BEFORE their address was pre-authorized has no Account, and the sign-in callback, which
 * consumes pre-authorizations, will not run again until they sign in again. So when such an identity opens
 * /register, the pre-authorization is consumed exactly as the callback does (which also issues the grant of
 * this session), and a refusal, a disabled Account or a failure signs the person out the same way.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const api = isApiPath(pathname);
  if (isPublicPath(pathname, process.env)) {
    // A machine path (Story 1.9: the scheduled-job route) is called by a scheduler, which has no browser Origin. It skips this one rule and
    // nothing else: the route checks the call's signature, which is its only authentication.
    const refusal = isMachinePath(pathname) ? null : originRefusal(request);
    if (refusal) return refuseOrigin(request, api, refusal);
    return clearLegacyCookie(request, NextResponse.next());
  }
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
      const refusal = originRefusal(request);
      if (refusal) return refuseOrigin(request, api, refusal, client);
      // The two never depend on each other, and neither throws or blocks the page: one round trip's time, not two.
      const [csrfCookie] = await Promise.all([pageCsrfCookie(request, api, access), adoptDeviceChoices(request, api, access)]);
      // A Project link whose ID does not even decode (Story 1.7) would be a 500 from the router, for the page and for everything
      // that is sent to its address afterwards (a Server Action from the page's own menus, a refresh of its payload). It is a
      // malformed ID like any other, so the request is rewritten to the page for an ID that is none: the one unavailable page. Every
      // non-API request that has got this far is rewritten, a POST and a navigation payload as well as the document, and the
      // response is built the way every page response is (the refreshed session, the CSRF cookie, the adoption above).
      if (!api && hasUndecodableProjectId(pathname)) {
        return clearLegacyCookie(request, client.rewrite(new URL(undecodableProjectPath, request.url), csrfCookie));
      }
      return clearLegacyCookie(request, client.next(csrfCookie));
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
