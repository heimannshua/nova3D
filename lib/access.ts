// Story 1.3 (Part B). The one place that decides what a request may do, from who is signed in and which
// Account they hold. The proxy, the pages, the sign-in callback and the registration action all ask it,
// so there is a single answer and a single way to fail: closed.
//
//   signed-out    no verified Auth session
//   unregistered  a verified session, but no Account yet: it may reach /register and nothing else
//   active        a verified session and an active Account: the private pages
//   disabled      the Account exists and is disabled: signed out, no private content
//   unavailable   the check itself failed (Auth or the database could not answer): access is denied
//
// SERVER-ONLY, because it imports lib/accounts. It imports nothing from Next.js, so it is tested directly.
//
// The user always comes from the verified server session (supabase.auth.getUser(), which asks the Auth
// service) and never from a cookie's contents, a form field or a header. Anything that goes wrong while
// asking, including a timeout or an answer of an unexpected shape, is `unavailable` or `signed-out`,
// never a pass.
import {accountStatus, consumePreauthorization, type AccountState, type ActivationReceipt, type Role} from '@/lib/accounts';
import {withDeadline} from '@/lib/deadline';
import {signInErrorPath} from '@/lib/sign-in';
import type {SignOutScope} from '@/lib/supabase/sign-out';

export const homePath = '/';
export const registerPath = '/register';

/** How long Auth or the database may take before the check counts as failed. */
export const gatingTimeoutMs = 5000;

export type AccessUser = {id: string; email: string};
export type AccessAccount = {accountId: string; workspaceId: string | null; role: Role};

export type Access =
  | {state: 'signed-out'}
  | {state: 'unavailable'}
  | {state: 'unregistered'; user: AccessUser}
  | {state: 'disabled'; user: AccessUser}
  | {state: 'active'; user: AccessUser; account: AccessAccount};

export type ActiveAccess = Extract<Access, {state: 'active'}>;
export type UnregisteredAccess = Extract<Access, {state: 'unregistered'}>;

/** The part of a Supabase client the check needs. */
export type AuthReader = {auth: {getUser(): Promise<{data: {user: unknown}; error: unknown}>}};

export type AccessOptions = {
  /** Reads the Account state of a user. Defaults to the service-role call in lib/accounts. */
  lookup?: (userId: string) => Promise<AccountState>;
  /** Called, with a name and message only, when the check fails closed. Defaults to console.error. */
  log?: (message: string, detail: string) => void;
  timeoutMs?: number;
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

/**
 * The signed-in user according to the Auth service, or why there is none. `ineligible` is a user Auth
 * vouches for who is not a confirmed, non-anonymous Google identity: no access, and the callback signs it out.
 */
export async function readUser(client: AuthReader | null, options: Pick<AccessOptions, 'log' | 'timeoutMs'> = {}): Promise<UserRead> {
  const log = options.log ?? defaultLog;
  if (!client) return {kind: 'unavailable'};
  let result: Awaited<ReturnType<AuthReader['auth']['getUser']>>;
  try {
    result = await withDeadline(client.auth.getUser(), options.timeoutMs ?? gatingTimeoutMs);
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
  return {kind: 'user', user: {id: user.id.toLowerCase(), email: user.email as string}};
}

/**
 * Who is signed in and what they may do. A database error is `unavailable`, never an Account: the check
 * that cannot be made is a check that fails.
 */
export async function resolveAccess(client: AuthReader | null, options: AccessOptions = {}): Promise<Access> {
  const log = options.log ?? defaultLog;
  const timeoutMs = options.timeoutMs ?? gatingTimeoutMs;
  const lookup = options.lookup ?? ((userId: string) => accountStatus(userId, {timeoutMs}));

  const read = await readUser(client, {log, timeoutMs});
  if (read.kind === 'signed-out' || read.kind === 'ineligible') return {state: 'signed-out'};
  if (read.kind === 'unavailable') return {state: 'unavailable'};

  let account: AccountState;
  try {
    account = await withDeadline(lookup(read.user.id), timeoutMs);
  } catch (error) {
    log('Account check failed closed (the database did not answer).', describe(error));
    return {state: 'unavailable'};
  }

  if (account.status === 'none') return {state: 'unregistered', user: read.user};
  if (account.status === 'disabled') return {state: 'disabled', user: read.user};
  if (account.status === 'active' && account.accountId && account.role) {
    return {state: 'active', user: read.user, account: {accountId: account.accountId, workspaceId: account.workspaceId, role: account.role}};
  }
  log('Account check failed closed (the database answered with an unexpected state).', `status ${String(account.status)}`);
  return {state: 'unavailable'};
}

/** Where a request goes next, and whether the person is signed out first (everywhere, or on this browser only). */
export type SignInDecision = {to: string; signOut: false} | {to: string; signOut: true; scope: SignOutScope};

export type AccessDecision = {action: 'allow'} | ({action: 'redirect'} & SignInDecision);

const allow: AccessDecision = {action: 'allow'};
const redirectTo = (to: string, signOut = false): AccessDecision => (signOut ? {action: 'redirect', to, signOut: true, scope: 'global'} : {action: 'redirect', to, signOut: false});

/**
 * What to do with a request for a private path. Only an active Account passes, and not to /register; an
 * identity without an Account passes to /register and nowhere else; a disabled Account is signed out.
 * Anything not named here is denied.
 */
export function decideAccess(pathname: string, access: Access): AccessDecision {
  switch (access.state) {
    case 'active':
      return pathname === registerPath ? redirectTo(homePath) : allow;
    case 'unregistered':
      return pathname === registerPath ? allow : redirectTo(registerPath);
    case 'signed-out':
      return redirectTo(signInErrorPath('not_signed_in'));
    case 'disabled':
      return redirectTo(signInErrorPath('account_disabled'), true);
    case 'unavailable':
    default:
      return redirectTo(signInErrorPath('auth_unavailable'));
  }
}

/** Where a page for `pathname` sends this visitor, or null when the page may render. */
export function redirectFor(pathname: string, access: Access): string | null {
  const decision = decideAccess(pathname, access);
  return decision.action === 'redirect' ? decision.to : null;
}

const stay = (to: string): SignInDecision => ({to, signOut: false});
/** Ends every session of the user: for an identity that is refused or disabled. */
const refuse = (to: string): SignInDecision => ({to, signOut: true, scope: 'global'});
/** Ends only this browser's session: for an outage, which says nothing about the person's other devices. */
const outage = (to: string): SignInDecision => ({to, signOut: true, scope: 'local'});

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
 * Consumes the pre-authorization of a verified user and decides what follows, exactly as the sign-in
 * callback does. A failure of the call fails closed (receipt null). Used by the callback, and by the proxy
 * for an identity that signed in before its address was pre-authorized.
 */
export async function claimPreauthorization(
  user: AccessUser,
  options: {consume?: (userId: string) => Promise<ActivationReceipt>; log?: AccessOptions['log']; timeoutMs?: number} = {},
): Promise<SignInDecision> {
  const log = options.log ?? defaultLog;
  const timeoutMs = options.timeoutMs ?? gatingTimeoutMs;
  const consume = options.consume ?? ((userId: string) => consumePreauthorization(userId, {timeoutMs}));
  let receipt: ActivationReceipt | null = null;
  try {
    receipt = await withDeadline(consume(user.id), timeoutMs);
  } catch (error) {
    log('The pre-authorization check failed closed.', describe(error));
  }
  return decideSignIn({kind: 'user', user}, receipt);
}
