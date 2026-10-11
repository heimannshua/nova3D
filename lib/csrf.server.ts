// Story 1.4c. The one place a Server Action or route handler removes the CSRF cookie. The proxy is what sets
// it (lib/supabase/proxy.ts, on a page request); a token belongs to ONE session's grant, so it must not outlive
// the session it was minted for. The proxy issues a token only for a browser that carries no such cookie, so a
// cookie left over from an earlier session would keep the next session from ever getting its own. Two moments
// end a session in the browser: signing out, and signing in (the sign-in callback gives the browser a different
// session, including the one a step-up creates), and each calls this.
//
// It never throws: a cookie that could not be removed is a token that does not match, which is refused, and
// must not turn a sign-in or a sign-out into a failure. It says so in the log, by the error's NAME only: what
// the store said may hold a cookie's value.
import {cookies} from 'next/headers';
import {csrfCookieName} from '@/lib/request-integrity';

export async function clearCsrfCookie() {
  try {
    (await cookies()).delete(csrfCookieName);
  } catch (error) {
    // Outside a request that can write cookies, or the store refused: nothing to remove.
    console.error('The CSRF cookie could not be removed.', error instanceof Error ? error.name : 'unknown failure');
  }
}
