import {redirect} from 'next/navigation';
import {cache} from 'react';
import {AccountsUnavailableError, verifyCsrf} from '@/lib/accounts';
import {
  actionTimeoutMs,
  apiCsrfInvalid,
  apiDenial,
  apiDenialResponse,
  apiInternalError,
  apiNotConfigured,
  apiOriginNotAllowed,
  apiSessionEnded,
  apiUnavailable,
  decideAccess,
  gatingTimeoutMs,
  homePath,
  readUser,
  redirectFor,
  registerPath,
  resolveAccess,
  type Access,
  type AccessUser,
  type ActiveAccess,
  type ApiDenial,
  type UnregisteredAccess,
} from '@/lib/access';
import {hasSupabaseConfig} from '@/lib/auth-config';
import {createBudget, type Budget} from '@/lib/deadline';
import {csrfHeaderName, decideOrigin, hashCsrfToken, isCsrfToken, originInputOf} from '@/lib/request-integrity';
import {signInErrorPath} from '@/lib/sign-in';
import {createSupabaseServerClient, endSession} from '@/lib/supabase/server';

/**
 * Who is making this request and what Account they hold, from the verified server session (Auth is asked,
 * the cookie is not trusted) and the live authorization of that session: its Account and its grant, in one
 * call. Fails closed: if either cannot be read the answer is `unavailable`, never an Account. The proxy
 * decides the same way before the page renders; this is the page's own check, because the proxy alone is not
 * a boundary.
 *
 * React's `cache` makes it one check per render: the page, its metadata and any component that asks share
 * one answer, and the next request starts from nothing. (Route handlers and Server Actions below ask
 * `resolveAccess` themselves, so a mutation never reuses an answer. `cache` is not observable from a test; the
 * browser spec counts the calls a page costs instead.)
 */
export const getAccess = cache(async (): Promise<Access> => {
  if (!hasSupabaseConfig()) return {state: 'unavailable'};
  return resolveAccess(await createSupabaseServerClient());
});

// A refusal is always somewhere to go, even if the decision table ever fails to name one.
const fallback = signInErrorPath('auth_unavailable');

/** For a private page: returns the active Account, or redirects to wherever this visitor belongs. */
export async function requireActiveAccount(): Promise<ActiveAccess> {
  const access = await getAccess();
  if (access.state === 'active') return access;
  return redirect(redirectFor(homePath, access) ?? fallback);
}

/** For the registration page: returns an identity that still needs an Account, or redirects. */
export async function requireUnregisteredIdentity(): Promise<UnregisteredAccess> {
  const access = await getAccess();
  if (access.state === 'unregistered') return access;
  return redirect(redirectFor(registerPath, access) ?? fallback);
}

type Guard = {access: ActiveAccess; denied?: undefined} | {access?: undefined; denied: Response};

// What went wrong as a name and a message, never a request, a token or a cookie; and where it is printed.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');
const log = (message: string, detail: string) => console.error(message, detail);

const answer = (denial: ApiDenial): {denied: Response} => {
  const {body, init} = apiDenialResponse(denial);
  return {denied: Response.json(body, init)};
};

/**
 * For a route handler under app/api that does not change anything (a GET; every non-GET handler starts from
 * `requireMutationAccess` instead, and the only route that starts from neither is on the allow-list in
 * tests/unit/gate-structure.test.ts): the active Account, or the JSON answer to send back instead (401, 403 or
 * a retryable 503; never a redirect, never HTML). The proxy already answers the same way before the handler
 * runs; this is the handler's own check, because the proxy alone is not a boundary.
 *
 *   const guard = await requireApiAccess();
 *   if (guard.denied) return guard.denied;
 *   const {access} = guard;
 */
export async function requireApiAccess(): Promise<Guard> {
  if (!hasSupabaseConfig()) return answer(apiNotConfigured);
  let access: Access;
  try {
    access = await resolveAccess(await createSupabaseServerClient());
  } catch {
    return answer(apiUnavailable);
  }
  const denial = apiDenial(access);
  if (denial || access.state !== 'active') return answer(denial ?? apiUnavailable);
  return {access};
}

/**
 * For a route handler under app/api that changes something (every POST, PUT, PATCH and DELETE must start with
 * it; Server Actions need no token, because Next's host check and the proxy's origin check cover them): the
 * active Account, or the JSON answer to send back instead. In this order, and nothing changes before all pass:
 *
 *   1. The request comes from this application's own origin (a present `Origin` that is not `null` and has
 *      the first `x-forwarded-host`, else `host`; no `Sec-Fetch-Site: cross-site`): else 403 `origin_not_allowed`.
 *      The proxy already refused such a request; this is the handler's own check, because the proxy alone is
 *      not a boundary.
 *   2. `requireApiAccess`: a live active Account with a valid grant, else its 401, 403 or retryable 503.
 *   3. The request's `x-csrf-token` header, hashed, is the hash stored on the grant of the verified session
 *      (api.verify_csrf): a missing, malformed, wrong or another session's token is 403 `csrf_invalid`. The
 *      user and the session come from the verified session, never from the request. A database that cannot
 *      answer is a retryable 503, any other failure of the check is a non-retryable 500 (and is logged),
 *      and in both the request is not let through.
 *
 *   export async function POST(request: Request) {
 *     const guard = await requireMutationAccess(request);
 *     if (guard.denied) return guard.denied;
 *     const {access} = guard;
 *     // ...change something
 *   }
 */
export async function requireMutationAccess(request: Request): Promise<Guard> {
  if (!decideOrigin(originInputOf(request.method, request.headers)).allowed) return answer(apiOriginNotAllowed);

  const guard = await requireApiAccess();
  if (guard.denied) return guard;

  const token = request.headers.get(csrfHeaderName);
  if (!isCsrfToken(token)) return answer(apiCsrfInvalid);
  try {
    const {user} = guard.access;
    const outcome = await verifyCsrf({userId: user.id, sessionId: user.sessionId, hash: await hashCsrfToken(token)}, {timeoutMs: gatingTimeoutMs});
    if (outcome === 'valid') return guard;
    // The grant ended between the check above and this one: the same answer as any request on an ended session.
    if (outcome === 'denied') return answer(apiSessionEnded);
    return answer(apiCsrfInvalid);
  } catch (error) {
    // Only a database that could not be asked (or answered nonsense) is an outage worth retrying. Anything
    // else that throws here is a bug, and a retry will not fix it: say so, in the log and to the client.
    if (error instanceof AccountsUnavailableError) {
      log('The CSRF check failed closed (the database did not answer).', describe(error));
      return answer(apiUnavailable);
    }
    log('The CSRF check failed with an unexpected error; the request is refused.', describe(error));
    return answer(apiInternalError);
  }
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * For a Server Action that needs an active Account (for example "sign out my other sessions"). It asks
 * `resolveAccess` for itself, every time, and then:
 *   - an active Account runs `run`, with the verified access, the Auth client and the action's time budget;
 *   - a check that could not be made returns `unavailable` (the caller shows a retry message);
 *   - anyone else is sent where any private request would send them, signed out first when that is what the
 *     decision says (a disabled Account, a changed Google identity).
 */
export async function withActiveAccount<T>(
  handlers: {unavailable: T},
  run: (context: {access: ActiveAccess; supabase: ServerClient; budget: Budget}) => Promise<T>,
): Promise<T> {
  const budget = createBudget(actionTimeoutMs);
  const supabase = await createSupabaseServerClient();
  const access = await resolveAccess(supabase, {budget});
  if (access.state === 'active') return run({access, supabase, budget});
  if (access.state === 'unavailable') return handlers.unavailable;
  const decision = decideAccess(homePath, access);
  if (decision.action === 'redirect') {
    if (decision.signOut) await endSession(supabase, decision.scope, {timeoutMs: budget.remaining()});
    return redirect(decision.to);
  }
  return handlers.unavailable;
}

/**
 * For a Server Action that is for any verified user, with or without an Account or a valid grant (signing
 * out: a session whose grant has ended can still be ended). `user` is null when Auth has no session for the
 * browser (or does not vouch for the identity); a check that could not be made returns `unavailable`.
 */
export async function withVerifiedUser<T>(
  handlers: {unavailable: T},
  run: (context: {user: AccessUser | null; supabase: ServerClient; budget: Budget}) => Promise<T>,
): Promise<T> {
  const budget = createBudget(actionTimeoutMs);
  const supabase = await createSupabaseServerClient();
  const read = await readUser(supabase, {budget});
  if (read.kind === 'unavailable') return handlers.unavailable;
  return run({user: read.kind === 'user' ? read.user : null, supabase, budget});
}
