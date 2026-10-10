import {redirect} from 'next/navigation';
import {homePath, redirectFor, registerPath, resolveAccess, type Access, type ActiveAccess, type UnregisteredAccess} from '@/lib/access';
import {hasSupabaseConfig} from '@/lib/auth-config';
import {signInErrorPath} from '@/lib/sign-in';
import {createSupabaseServerClient} from '@/lib/supabase/server';

/**
 * Who is making this request and what Account they hold, from the verified server session (Auth is asked,
 * the cookie is not trusted) and the live Account state. Fails closed: if either cannot be read the answer
 * is `unavailable`, never an Account. The proxy decides the same way before the page renders; this is the
 * page's own check, because the proxy alone is not a boundary.
 */
export async function getAccess(): Promise<Access> {
  if (!hasSupabaseConfig()) return {state: 'unavailable'};
  return resolveAccess(await createSupabaseServerClient());
}

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
