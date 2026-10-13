import {cookies} from 'next/headers';
import {getAccess} from '@/lib/auth';
import {isAuthSessionCookieName} from './supabase/sign-out';

/**
 * The verified Google address of the Account this request belongs to, for the Account panel in the shell (Story 1.7), or null when
 * there is none to show: the request carries no Auth session, the Account could not be read, or the session is not an active
 * Account's. It is Auth's own answer for the verified session, never a cookie's contents or anything a request chose.
 *
 * Like the preferences (lib/preferences.server.ts), the Account is asked only when the request carries an Auth session cookie, so
 * the sign-in page costs nothing signed out; and `getAccess` is memoized for a render, so for a private page this adds no call.
 */
export async function getAccountAddress(): Promise<string | null> {
  const cookieStore = await cookies();
  if (!cookieStore.getAll().some(({name}) => isAuthSessionCookieName(name))) return null;
  const access = await getAccess().catch(() => null);
  return access?.state === 'active' ? access.user.email : null;
}
