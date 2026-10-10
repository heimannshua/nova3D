// Signing out, completely. Auth's own sign-out revokes the session and clears its cookies, but it does
// nothing when Auth cannot be reached, and a person who is refused (a disabled Account, an identity the
// callback turned away) must not stay signed in because of an outage. So a refusal also expires the
// session cookies itself.
import {withDeadline} from '../deadline';

export type SignOutScope = 'global' | 'local';

/** How long Auth may take to end a session before the sign-out gives up and the cookies are expired anyway. */
export const signOutTimeoutMs = 5000;

const escapeForPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The name @supabase/ssr gives this project's session cookie: `sb-<first label of the Supabase host>-auth-token`.
 * Null when the URL is missing or unreadable, in which case no cookie is recognised.
 */
export function authCookieBase(supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  if (!supabaseUrl) return null;
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  } catch {
    return null;
  }
}

/**
 * Whether a cookie belongs to THIS project's Auth session: the session cookie, its numbered chunks (`.0`,
 * `.1`), the PKCE code verifier and the per-flow verifier slots @supabase/ssr writes while a sign-in is
 * under way. Another project's `sb-*` cookies, or anything else, are not ours to touch.
 */
export function isAuthCookieName(name: string, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const base = authCookieBase(supabaseUrl);
  if (!base) return false;
  return new RegExp(`^${escapeForPattern(base)}(?:-code-verifier|-flows-code-verifier|-flow-[A-Za-z0-9_-]{8,64}-code-verifier)?(?:\\.\\d+)?$`).test(name);
}

type SignOutClient = {auth: {signOut(options: {scope: SignOutScope}): Promise<unknown>}};
type Log = (message: string, detail: string) => void;
const defaultLog: Log = (message, detail) => console.error(message, detail);

/** A name for what went wrong and nothing else: never a message, a token or a cookie. */
const nameOf = (error: unknown) => (typeof error === 'object' && error !== null && typeof (error as {name?: unknown}).name === 'string' ? (error as {name: string}).name : 'unknown failure');

/**
 * Ends the session at Auth. `global` revokes every session of the user (a disabled or refused identity),
 * `local` only this browser's (a person switching Google accounts, or an outage: it must not log every
 * device out). Never throws and never waits past the deadline: a failure, a timeout, or an answer that
 * carries an `error` is logged by name, and the caller still expires the cookies.
 */
export async function signOutQuietly(client: SignOutClient | null, scope: SignOutScope = 'global', options: {log?: Log; timeoutMs?: number} = {}) {
  if (!client) return;
  const log = options.log ?? defaultLog;
  try {
    const result = await withDeadline(client.auth.signOut({scope}), options.timeoutMs ?? signOutTimeoutMs);
    const error = typeof result === 'object' && result !== null ? (result as {error?: unknown}).error : null;
    if (error) log('Sign-out was refused by Auth; the session cookies are expired anyway.', nameOf(error));
  } catch (error) {
    log('Sign-out could not reach Auth; the session cookies are expired anyway.', nameOf(error));
  }
}
