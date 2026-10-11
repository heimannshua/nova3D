// Stories 1.3 and 1.4a. The one place that decides what a request may do, from who is signed in, which
// Account they hold and whether their session holds a grant. The proxy, the pages, the sign-in callback and
// the registration action all ask it, so there is a single answer and a single way to fail: closed.
//
//   signed-out     no verified Auth session (or one Auth no longer has)
//   session-ended  a verified session whose grant is not valid: none issued, revoked, older than 30 days,
//                  idle for more than 7, or issued under an older epoch than the Account's. The person signs
//                  in again; `reason` says which (a session with no grant is the one case a retried
//                  registration may still repair)
//   unregistered  a verified session, but no Account yet: it may reach /register and nothing else
//   active        a verified session, an active Account and a valid grant: the private pages
//   disabled      the Account exists and is disabled: signed out, no private content
//   refused       the Google identity is no longer the one pinned to the Account: signed out everywhere
//   unavailable   the check itself failed (Auth or the database could not answer): access is denied
//
// SERVER-ONLY, because it imports lib/accounts. It imports nothing from Next.js, so it is tested directly.
//
// The user always comes from the verified server session (supabase.auth.getUser(), which asks the Auth
// service) and never from a cookie's contents, a form field or a header. The session ID is the `session_id`
// of the very access token Auth has just verified for that user, never an input. One call to
// api.authorize_session then answers both "which Account" and "is this session's grant valid". Anything
// that goes wrong while asking, including a timeout or an answer of an unexpected shape, is `unavailable`
// or `signed-out`, never a pass, and nothing is cached between requests. The calls of one decision (Auth's
// user, the stored session, the authorization) share one overall time budget, so three slow answers cannot
// take three times as long.
import {
  authorizeSession,
  completeStepUp,
  consumePreauthorization,
  issueCsrf,
  issueGrant,
  type ActivationReceipt,
  type CsrfIssueOutcome,
  type GrantReceipt,
  type Role,
  type SessionAuthorization,
  type StepUpReceipt,
} from '@/lib/accounts';
import {createBudget, withinBudget, type Budget} from '@/lib/deadline';
import {hashCsrfToken, newCsrfToken} from '@/lib/request-integrity';
import {signInErrorPath} from '@/lib/sign-in';
import {stepUpReturnPaths} from '@/lib/step-up';
import {hashStepUpSecret} from '@/lib/step-up-flow';
import type {SignOutScope} from '@/lib/supabase/sign-out';

export const homePath = '/';
export const registerPath = '/register';

/** How long a whole access decision (Auth's user, the session, the authorization) may take before the check counts as failed. */
export const gatingTimeoutMs = 5000;

/** How long a sign-out action's whole chain (who is asking, the revocation, ending the session) may take. */
export const actionTimeoutMs = 8000;

/** How long the sign-in callback's whole chain (the code exchange, the user, the pre-authorization, the grant) may take. */
export const signInTimeoutMs = 10_000;

/** How long issuing a CSRF token may take before the page goes on without one. */
export const csrfIssueTimeoutMs = 3000;

/** The verified user and the ID of the Auth session that is making this request. */
export type AccessUser = {id: string; email: string; sessionId: string};
export type AccessAccount = {accountId: string; workspaceId: string | null; role: Role; epoch: number};

/** Why a verified session has no valid grant. */
export type SessionEndedReason = 'no_grant' | 'revoked' | 'expired' | 'idle' | 'stale_epoch';

export type Access =
  | {state: 'signed-out'}
  | {state: 'unavailable'}
  | {state: 'refused'}
  | {state: 'session-ended'; reason: SessionEndedReason; user: AccessUser}
  | {state: 'unregistered'; user: AccessUser}
  | {state: 'disabled'; user: AccessUser}
  | {state: 'active'; user: AccessUser; account: AccessAccount};

export type ActiveAccess = Extract<Access, {state: 'active'}>;
export type UnregisteredAccess = Extract<Access, {state: 'unregistered'}>;

/** The part of a Supabase client the check needs. */
export type AuthReader = {
  auth: {
    getUser(): Promise<{data: {user: unknown}; error: unknown}>;
    getSession(): Promise<{data: {session: {access_token?: unknown} | null}; error: unknown}>;
  };
};

export type AccessOptions = {
  /** Authorizes a user's session (Account state and grant), within `timeoutMs`. Defaults to the service-role call in lib/accounts. */
  authorize?: (userId: string, sessionId: string, timeoutMs: number) => Promise<SessionAuthorization>;
  /** Called, with a name and message only, when the check fails closed. Defaults to console.error. */
  log?: (message: string, detail: string) => void;
  /** The overall time for the whole decision. Defaults to gatingTimeoutMs. */
  timeoutMs?: number;
  /** A budget already running (the sign-in callback shares one across its chain); wins over `timeoutMs`. */
  budget?: Budget;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultLog = (message: string, detail: string) => console.error(message, detail);

/** What went wrong, as a name and a message: never a request, a token or a cookie. */
function describe(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : 'unknown failure';
}

// The answers that mean "there is no valid session" and nothing else: the person is signed out. Auth's
// error codes, or the client's own error for a missing cookie.
const noSessionCodes = new Set(['session_not_found', 'bad_jwt', 'refresh_token_not_found', 'refresh_token_already_used']);

/**
 * Whether an Auth error is one of the known "no session" answers. Anything else, a network failure, a
 * timeout, a 5xx, a rate limit, or a 401 or 403 that is not about the session (a wrong API key, say), is a
 * check that could not be made, so it fails closed as `unavailable` and is logged.
 */
function isNoSessionError(error: unknown) {
  if (typeof error !== 'object' || error === null) return false;
  const {name, code} = error as {name?: unknown; code?: unknown};
  return name === 'AuthSessionMissingError' || (typeof code === 'string' && noSessionCodes.has(code));
}

/** Whether an Auth error means the service could not be reached or is struggling, as opposed to refusing a request. */
export function isOutageError(error: unknown) {
  if (typeof error !== 'object' || error === null) return false;
  const {name, status} = error as {name?: unknown; status?: unknown};
  return name === 'AuthRetryableFetchError' || (typeof status === 'number' && (status >= 500 || status === 429 || status === 408));
}

type AuthUserShape = {
  email?: unknown;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
  is_anonymous?: unknown;
  app_metadata?: {provider?: unknown; providers?: unknown} | null;
};

/**
 * Why a user Auth vouches for still may not enter, or null. Only a Google identity with a confirmed email
 * that is not anonymous qualifies; the Before User Created hook already guarantees it, and this keeps the
 * gate shut if a provider setting is ever wrong. The reason names a rule, never a person.
 */
function ineligibleReason(user: AuthUserShape) {
  const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : [];
  if (user.app_metadata?.provider !== 'google' && !providers.includes('google')) return 'the identity is not a Google identity';
  if (user.is_anonymous === true) return 'the identity is anonymous';
  if (typeof user.email !== 'string' || !user.email.trim()) return 'the identity has no email';
  if (!user.email_confirmed_at && !user.confirmed_at) return 'the email is not confirmed';
  return null;
}

export type UserRead = {kind: 'user'; user: AccessUser} | {kind: 'signed-out'} | {kind: 'unavailable'} | {kind: 'ineligible'};

const decodeSegment = (segment: string): unknown => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

/**
 * The session ID in an access token: its `session_id` claim, provided the token's subject is `userId`. The
 * signature is NOT checked here and does not need to be: this is called on the very token Auth has just
 * verified for that user (getUser sends it, or the code exchange has just issued it), so its claims are
 * Auth's. Null when the token is not a JWT, names another subject, has run out, or carries no usable
 * `session_id`.
 */
export function sessionIdOfToken(token: unknown, userId: string, nowMs: number = Date.now()): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const claims = decodeSegment(parts[1]);
  if (typeof claims !== 'object' || claims === null) return null;
  const {sub, session_id: sessionId, exp} = claims as {sub?: unknown; session_id?: unknown; exp?: unknown};
  if (typeof sub !== 'string' || sub.toLowerCase() !== userId.toLowerCase()) return null;
  if (typeof sessionId !== 'string' || !uuidPattern.test(sessionId)) return null;
  // A token that has run out is not the one Auth just verified, whatever it claims.
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp * 1000 <= nowMs) return null;
  return sessionId.toLowerCase();
}

/**
 * The signed-in user according to the Auth service, or why there is none. `ineligible` is a user Auth
 * vouches for who is not a confirmed, non-anonymous Google identity: no access, and the callback signs it out.
 * A user always comes with the ID of the session that is asking; a verified user whose token cannot name one
 * (it names another user, has run out, or has no `session_id`) is `unavailable`, because no grant can be
 * checked for it. The token is the stored session's, read after the user is verified, or `accessToken` when
 * the caller has just been handed one by the code exchange. Every call shares one time budget.
 */
export async function readUser(
  client: AuthReader | null,
  options: Pick<AccessOptions, 'log' | 'timeoutMs' | 'budget'> & {accessToken?: unknown} = {},
): Promise<UserRead> {
  const log = options.log ?? defaultLog;
  const budget = options.budget ?? createBudget(options.timeoutMs ?? gatingTimeoutMs);
  if (!client) return {kind: 'unavailable'};
  let result: Awaited<ReturnType<AuthReader['auth']['getUser']>>;
  try {
    result = await withinBudget(budget, () => client.auth.getUser());
  } catch (error) {
    log('Sign-in check failed closed (Auth did not answer).', describe(error));
    return {kind: 'unavailable'};
  }
  if (result.error) {
    if (isNoSessionError(result.error)) return {kind: 'signed-out'};
    log('Sign-in check failed closed (Auth could not vouch for the session).', describe(result.error));
    return {kind: 'unavailable'};
  }
  const user = result.data?.user as (AuthUserShape & {id?: unknown}) | null | undefined;
  if (!user) return {kind: 'signed-out'};
  if (typeof user.id !== 'string' || !uuidPattern.test(user.id)) {
    log('Sign-in check failed closed (Auth answered with an unexpected user).', 'the user ID is not a UUID');
    return {kind: 'unavailable'};
  }
  const reason = ineligibleReason(user);
  if (reason) {
    log('Sign-in check denied access.', reason);
    return {kind: 'ineligible'};
  }

  // The session is read after the user is verified, so a refresh Auth just made is the session read here.
  let sessionId: string | null = null;
  try {
    if ('accessToken' in options) {
      sessionId = sessionIdOfToken(options.accessToken, user.id);
    } else {
      const stored = await withinBudget(budget, () => client.auth.getSession());
      if (!stored.error) sessionId = sessionIdOfToken(stored.data?.session?.access_token, user.id);
    }
  } catch (error) {
    log('Sign-in check failed closed (the session could not be read).', describe(error));
    return {kind: 'unavailable'};
  }
  if (!sessionId) {
    log('Sign-in check failed closed (the access token names no session).', 'no usable session_id for the verified user');
    return {kind: 'unavailable'};
  }
  return {kind: 'user', user: {id: user.id.toLowerCase(), email: user.email as string, sessionId}};
}

/**
 * Who is signed in and what they may do. A database error is `unavailable`, never an Account or a grant: the
 * check that cannot be made is a check that fails. Nothing is remembered between calls.
 */
export async function resolveAccess(client: AuthReader | null, options: AccessOptions = {}): Promise<Access> {
  const log = options.log ?? defaultLog;
  const budget = options.budget ?? createBudget(options.timeoutMs ?? gatingTimeoutMs);
  const authorize = options.authorize ?? ((userId: string, sessionId: string, timeoutMs: number) => authorizeSession(userId, sessionId, {timeoutMs}));

  const read = await readUser(client, {log, budget});
  if (read.kind === 'signed-out' || read.kind === 'ineligible') return {state: 'signed-out'};
  if (read.kind === 'unavailable') return {state: 'unavailable'};

  let authorization: SessionAuthorization;
  try {
    authorization = await withinBudget(budget, (remaining) => authorize(read.user.id, read.user.sessionId, remaining));
  } catch (error) {
    log('Authorization failed closed (the database did not answer).', describe(error));
    return {state: 'unavailable'};
  }

  switch (authorization.state) {
    case 'unregistered':
      return {state: 'unregistered', user: read.user};
    case 'disabled':
      return {state: 'disabled', user: read.user};
    case 'subject_mismatch':
      return {state: 'refused'};
    // Auth's own session is gone as far as the database can see: the same as Auth saying so.
    case 'no_session':
      return {state: 'signed-out'};
    case 'no_grant':
    case 'revoked':
    case 'expired':
    case 'idle':
    case 'stale_epoch':
      return {state: 'session-ended', reason: authorization.state, user: read.user};
    case 'active':
      if (authorization.accountId && authorization.role && typeof authorization.epoch === 'number') {
        return {
          state: 'active',
          user: read.user,
          account: {accountId: authorization.accountId, workspaceId: authorization.workspaceId, role: authorization.role, epoch: authorization.epoch},
        };
      }
  }
  log('Authorization failed closed (the database answered with an unexpected state).', `state ${String(authorization.state)}`);
  return {state: 'unavailable'};
}

/** Where a request goes next, and whether the person is signed out first (everywhere, or on this browser only). */
export type SignInDecision = {to: string; signOut: false} | {to: string; signOut: true; scope: SignOutScope};

export type AccessDecision = {action: 'allow'} | ({action: 'redirect'} & SignInDecision);

const allow: AccessDecision = {action: 'allow'};
const redirectTo = (to: string, signOut = false): AccessDecision => (signOut ? {action: 'redirect', to, signOut: true, scope: 'global'} : {action: 'redirect', to, signOut: false});

/**
 * What to do with a request for a private path. Only an active Account with a valid grant passes, and not to
 * /register; an identity without an Account passes to /register and nowhere else; a disabled Account, or an
 * identity that is no longer the pinned one, is signed out; a session without a valid grant is asked to sign
 * in again. The one exception is a POST to /register from a session that has an Account but no grant: that is
 * a registration retried after its answer was lost, and the registration action itself refuses it unless the
 * retried command is the one that created the Account. Anything not named here is denied.
 */
export function decideAccess(pathname: string, access: Access, method: string = 'GET'): AccessDecision {
  switch (access.state) {
    case 'active':
      return pathname === registerPath ? redirectTo(homePath) : allow;
    case 'unregistered':
      return pathname === registerPath ? allow : redirectTo(registerPath);
    case 'signed-out':
      return redirectTo(signInErrorPath('not_signed_in'));
    case 'session-ended':
      if (access.reason === 'no_grant' && pathname === registerPath && method === 'POST') return allow;
      return redirectTo(signInErrorPath('session_ended'));
    case 'disabled':
      return redirectTo(signInErrorPath('account_disabled'), true);
    case 'refused':
      return redirectTo(signInErrorPath('not_allowed'), true);
    case 'unavailable':
    default:
      return redirectTo(signInErrorPath('auth_unavailable'));
  }
}

/** Why a private `/api` request was denied: the status and the JSON a client can act on (never HTML, never a redirect). */
export type ApiDenial = {
  status: 401 | 403 | 500 | 503;
  error:
    | 'not_signed_in'
    | 'session_ended'
    | 'account_required'
    | 'account_disabled'
    | 'not_allowed'
    | 'auth_unavailable'
    | 'auth_not_configured'
    | 'origin_not_allowed'
    | 'csrf_invalid'
    | 'internal_error';
  /** True when asking again may succeed (the check could not be made), as opposed to being refused. */
  retryable: boolean;
};

/**
 * What a private `/api` path answers instead of a redirect: 401 when there is no valid session (`session_ended`
 * when Auth's session is valid but its grant is not), 403 when
 * there is one that may not use the app, and 503 (retryable) when the check could not be made. Null means the
 * request may go on: only an active Account with a valid grant does. Anything not named here is denied.
 */
export function apiDenial(access: Access): ApiDenial | null {
  switch (access.state) {
    case 'active':
      return null;
    case 'signed-out':
      return {status: 401, error: 'not_signed_in', retryable: false};
    case 'session-ended':
      return {status: 401, error: 'session_ended', retryable: false};
    case 'unregistered':
      return {status: 403, error: 'account_required', retryable: false};
    case 'disabled':
      return {status: 403, error: 'account_disabled', retryable: false};
    case 'refused':
      return {status: 403, error: 'not_allowed', retryable: false};
    case 'unavailable':
    default:
      return {status: 503, error: 'auth_unavailable', retryable: true};
  }
}

/** The JSON body and the status and headers of a denied `/api` request: one answer for the proxy and for route handlers. */
export function apiDenialResponse(denial: ApiDenial) {
  const headers: Record<string, string> = {'cache-control': 'no-store'};
  if (denial.retryable) headers['retry-after'] = '5';
  return {body: {error: denial.error, retryable: denial.retryable}, init: {status: denial.status, headers}};
}

export const apiNotConfigured: ApiDenial = {status: 503, error: 'auth_not_configured', retryable: false};
export const apiUnavailable: ApiDenial = {status: 503, error: 'auth_unavailable', retryable: true};
/** A mutation whose Origin is not this application's (Story 1.4c): refused before any state change, whoever is signed in. */
export const apiOriginNotAllowed: ApiDenial = {status: 403, error: 'origin_not_allowed', retryable: false};
/** A route mutation without its session's CSRF token, or with another's (Story 1.4c). */
export const apiCsrfInvalid: ApiDenial = {status: 403, error: 'csrf_invalid', retryable: false};
/** The session's grant ended between the access check and the token check of a route mutation. */
export const apiSessionEnded: ApiDenial = {status: 401, error: 'session_ended', retryable: false};
/** Something threw that is not an outage: a bug, which retrying will not fix and which must not look like a service that is down. */
export const apiInternalError: ApiDenial = {status: 500, error: 'internal_error', retryable: false};

/** Where a page for `pathname` sends this visitor, or null when the page may render. */
export function redirectFor(pathname: string, access: Access): string | null {
  const decision = decideAccess(pathname, access);
  return decision.action === 'redirect' ? decision.to : null;
}

/** A decision that signs the person out: what a failed or refused sign-in, or a failed grant, comes to. */
export type SignOutDecision = Extract<SignInDecision, {signOut: true}>;

const stay = (to: string): SignInDecision => ({to, signOut: false});
/** Ends every session of the user: for an identity that is refused or disabled. */
const refuse = (to: string): SignOutDecision => ({to, signOut: true, scope: 'global'});
/** Ends only this browser's session: for an outage, which says nothing about the person's other devices. */
const outage = (to: string): SignOutDecision => ({to, signOut: true, scope: 'local'});

/**
 * What the sign-in callback does once Google has finished. `read` is the verified user, `receipt` what
 * consuming the pre-authorization returned (null when that call failed). A pure function of the two, so
 * every outcome is tested without Google.
 *
 *   registered, active  the Account is live: Home
 *   none                a verified Google identity with no Account: the registration screen
 *   refused             the address belongs to another Google subject: signed out everywhere, not allowed
 *   disabled            signed out everywhere, with the disabled message
 *   ineligible          not a confirmed Google identity: signed out everywhere, not allowed
 *   anything else       signed out on this browser only, with the unavailable message
 */
export function decideSignIn(read: UserRead, receipt: ActivationReceipt | null): SignInDecision {
  if (read.kind === 'signed-out') return stay(signInErrorPath('auth_failed'));
  if (read.kind === 'ineligible') return refuse(signInErrorPath('not_allowed'));
  if (read.kind === 'unavailable' || receipt === null) return outage(signInErrorPath('auth_unavailable'));
  switch (receipt.outcome) {
    case 'registered':
    case 'active':
      return stay(homePath);
    case 'none':
      return stay(registerPath);
    case 'disabled':
      return refuse(signInErrorPath('account_disabled'));
    case 'refused':
    default:
      return refuse(signInErrorPath('not_allowed'));
  }
}

/**
 * Issues the grant of the session that has just become an active Account's (Story 1.4a), at sign-in, at the
 * registration screen's claim of a pre-authorization, and at registration. Null means the grant is in place
 * (just issued, or already there) and the person goes on. Anything else signs the person out, because a
 * session without a grant has no access: a disabled Account is signed out everywhere with its message, a
 * Google identity that is not the pinned one is refused everywhere, and a failure (the database did not
 * answer, or the session cannot hold a grant) ends only this browser's session and says it is unavailable.
 */
export async function issueSessionGrant(
  user: AccessUser,
  options: {issue?: (userId: string, sessionId: string, timeoutMs: number) => Promise<GrantReceipt>; log?: AccessOptions['log']; timeoutMs?: number; budget?: Budget} = {},
): Promise<SignOutDecision | null> {
  const log = options.log ?? defaultLog;
  const budget = options.budget ?? createBudget(options.timeoutMs ?? gatingTimeoutMs);
  const issue = options.issue ?? ((userId: string, sessionId: string, timeoutMs: number) => issueGrant(userId, sessionId, {timeoutMs}));
  let receipt: GrantReceipt | null = null;
  try {
    receipt = await withinBudget(budget, (remaining) => issue(user.id, user.sessionId, remaining));
  } catch (error) {
    log('The session grant could not be issued; failing closed.', describe(error));
  }
  switch (receipt?.outcome) {
    case 'issued':
    case 'exists':
      return null;
    case 'disabled':
      return refuse(signInErrorPath('account_disabled'));
    case 'subject_mismatch':
      return refuse(signInErrorPath('not_allowed'));
    default:
      // Anything else is not a grant (a revoked, expired, idle or stale one, a session Auth does not have, an
      // unknown outcome): this sign-in did not complete.
      if (receipt) log('The session grant was not issued; failing closed.', `outcome ${String(receipt.outcome)}`);
      return outage(signInErrorPath('auth_unavailable'));
  }
}

/**
 * Consumes the pre-authorization of a verified user, issues the grant of the session once that makes it an
 * Account's, and decides what follows, exactly as the sign-in callback does. A failure of any call fails
 * closed. Used by the callback, and by the proxy for an identity that signed in before its address was
 * pre-authorized.
 */
export async function claimPreauthorization(
  user: AccessUser,
  options: {
    consume?: (userId: string, timeoutMs: number) => Promise<ActivationReceipt>;
    issue?: (userId: string, sessionId: string, timeoutMs: number) => Promise<GrantReceipt>;
    log?: AccessOptions['log'];
    timeoutMs?: number;
    budget?: Budget;
  } = {},
): Promise<SignInDecision> {
  const log = options.log ?? defaultLog;
  const budget = options.budget ?? createBudget(options.timeoutMs ?? signInTimeoutMs);
  const consume = options.consume ?? ((userId: string, timeoutMs: number) => consumePreauthorization(userId, {timeoutMs}));
  let receipt: ActivationReceipt | null = null;
  try {
    receipt = await withinBudget(budget, (remaining) => consume(user.id, remaining));
  } catch (error) {
    log('The pre-authorization check failed closed.', describe(error));
  }
  // Only a live Account has a session to grant: a person with no Account yet gets none, and no one is given
  // a grant before their Account is known to be active.
  if (receipt && (receipt.outcome === 'registered' || receipt.outcome === 'active')) {
    const refusal = await issueSessionGrant(user, {issue: options.issue, log, budget});
    if (refusal) return refusal;
  }
  return decideSignIn({kind: 'user', user}, receipt);
}

/**
 * What the sign-in callback does with a sign-in that came back to a browser holding a step-up cookie (Story
 * 1.4b). The cookie is cleared whichever it is: this browser holds one PKCE verifier (the most recently
 * started sign-in's), and a sign-in that comes back has consumed it, so this step-up cannot come back here.
 *   ordinary  the sign-in is not this step-up's (the cookie names no nonce, or the verifier is not the one this
 *             nonce's flow began: a sign-in started any other way, which overwrote the step-up's verifier), so
 *             the callback carries on as for any sign-in.
 *   decided   the callback acts on this decision: the new session's grant and marker exist and the person
 *             returns to the class's own path (`stay`), or the new session was NOT accepted and only it is ended
 *             (local scope, never a global sign-out) with the person sent to sign-in (`signOut`). The
 *             initiating session is never signed out here; its grant is revoked by the database only on
 *             acceptance, so a rejection leaves it untouched.
 */
export type StepUpSignIn = {kind: 'ordinary'} | {kind: 'decided'; decision: SignInDecision};

/**
 * Hands the new session to the database to accept or reject as the step-up's completed sign-in. The user is the
 * one Auth vouched for and the session the one in the exchanged access token (`user`), the secret is this
 * browser's cookie and `challenge` the PKCE challenge of the verifier that came back with it; the database
 * decides, from its own tables and Auth's, never from anything the browser said beyond those two. Any failure
 * (the database did not answer, an answer of an unexpected shape) is a sign-in that did not complete: only this
 * browser's new session is ended, with the unavailable message, and nothing fresh exists.
 */
export async function finishStepUp(
  user: AccessUser,
  flow: {secret: string; challenge: string},
  options: {complete?: (input: {userId: string; sessionId: string; secretHash: string; verifierHash: string}, timeoutMs: number) => Promise<StepUpReceipt>; log?: AccessOptions['log']; timeoutMs?: number; budget?: Budget} = {},
): Promise<StepUpSignIn> {
  const log = options.log ?? defaultLog;
  const budget = options.budget ?? createBudget(options.timeoutMs ?? signInTimeoutMs);
  const complete = options.complete ?? ((input, timeoutMs) => completeStepUp(input, {timeoutMs}));
  let receipt: StepUpReceipt;
  try {
    receipt = await withinBudget(budget, (remaining) =>
      complete({userId: user.id, sessionId: user.sessionId, secretHash: hashStepUpSecret(flow.secret), verifierHash: flow.challenge}, remaining),
    );
  } catch (error) {
    log('The step-up could not be completed; failing closed.', describe(error));
    return {kind: 'decided', decision: outage(signInErrorPath('auth_unavailable'))};
  }
  switch (receipt.outcome) {
    case 'not_step_up':
      return {kind: 'ordinary'};
    case 'accepted':
      if (receipt.actionClass) return {kind: 'decided', decision: stay(stepUpReturnPaths[receipt.actionClass])};
      break;
    case 'rejected':
      log('A step-up sign-in was rejected; only its new session is ended.', `reason ${String(receipt.reason)}`);
      return {kind: 'decided', decision: outage(signInErrorPath('step_up_failed'))};
  }
  log('The step-up answer was not understood; failing closed.', `outcome ${String(receipt.outcome)}`);
  return {kind: 'decided', decision: outage(signInErrorPath('auth_unavailable'))};
}

/**
 * Mints a CSRF token for the verified session and has the database store its hash on the session's grant
 * (Story 1.4c). Returns the token to deliver in the cookie, or null when none is to be delivered: the grant
 * already holds a hash under a minute old (another request issued it and sets the cookie), the session no
 * longer holds a valid grant, or the database could not answer. A failure is logged by name and never blocks
 * the page, which simply goes on without a cookie; the next page request tries again. The token is never
 * logged, and only its hash leaves this function.
 */
export async function issueCsrfToken(
  user: AccessUser,
  options: {issue?: (input: {userId: string; sessionId: string; hash: string}, timeoutMs: number) => Promise<CsrfIssueOutcome>; log?: AccessOptions['log']; timeoutMs?: number; budget?: Budget} = {},
): Promise<string | null> {
  const log = options.log ?? defaultLog;
  const budget = options.budget ?? createBudget(options.timeoutMs ?? csrfIssueTimeoutMs);
  const issue = options.issue ?? ((input: {userId: string; sessionId: string; hash: string}, timeoutMs: number) => issueCsrf(input, {timeoutMs}));
  try {
    const token = newCsrfToken();
    const hash = await hashCsrfToken(token);
    const outcome = await withinBudget(budget, (remaining) => issue({userId: user.id, sessionId: user.sessionId, hash}, remaining));
    return outcome === 'issued' ? token : null;
  } catch (error) {
    log('The CSRF token could not be issued; the page goes on without one.', describe(error));
    return null;
  }
}
