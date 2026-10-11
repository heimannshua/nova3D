import {redirect} from 'next/navigation';
import {cache} from 'react';
import {
  actionTimeoutMs,
  apiDenial,
  apiDenialResponse,
  apiNotConfigured,
  apiUnavailable,
  decideAccess,
  homePath,
  readUser,
  redirectFor,
  registerPath,
  resolveAccess,
  type Access,
  type AccessUser,
  type ActiveAccess,
  type UnregisteredAccess,
} from '@/lib/access';
import {hasSupabaseConfig} from '@/lib/auth-config';
import {createBudget, type Budget} from '@/lib/deadline';
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

/**
 * For a route handler under app/api (every one that is not on the allow-list in tests/unit/api-guards.test.ts
 * must start with it): the active Account, or the JSON answer to send back instead (401, 403 or a retryable
 * 503; never a redirect, never HTML). The proxy already answers the same way before the handler runs; this is
 * the handler's own check, because the proxy alone is not a boundary.
 *
 *   const guard = await requireApiAccess();
 *   if (guard.denied) return guard.denied;
 *   const {access} = guard;
 */
export async function requireApiAccess(): Promise<{access: ActiveAccess; denied?: undefined} | {access?: undefined; denied: Response}> {
  const answer = (denial: Parameters<typeof apiDenialResponse>[0]) => {
    const {body, init} = apiDenialResponse(denial);
    return {denied: Response.json(body, init)};
  };
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
