import {createServerClient, type CookieOptions} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {isAuthCookieName, signOutQuietly, type SignOutScope} from './sign-out';

/**
 * `track`, when given, is told the name and value of every cookie this client writes (a removal has the empty
 * value). It changes nothing about how the client works; the step-up uses it to undo exactly the PKCE verifier
 * cookies a Google sign-in start wrote when the step-up then cannot begin.
 */
export async function createSupabaseServerClient(options: {track?: (cookie: {name: string; value: string}) => void} = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({name, value, options: cookieOptions}) => {
            cookieStore.set(name, value, cookieOptions);
            options.track?.({name, value});
          });
        } catch {
          // Server Components cannot always write cookies; proxy handles refreshes.
        }
      },
    },
  });
}

/**
 * A server client that READS this request's cookies like any other but holds back every cookie it would write, until
 * `commit()` (Story 1.6). Administrator recovery mints a session before the database has accepted it, and a browser with
 * two windows open shares one cookie jar: a window that loses the race must not leave its own, doomed session cookie (or
 * an expiry of the winner's) in the response it gives back. So the minted session lives in the client's memory (that is
 * where @supabase/ssr keeps it until the cookies are applied), and the cookies are written only once the recovery
 * succeeded, or may have. `discard()` writes nothing, so the browser keeps exactly the cookies it sent. `held` is the
 * number of cookie writes waiting (for the tests).
 */
export async function createDeferredSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieStore = await cookies();
  let held: {name: string; value: string; options: CookieOptions}[] = [];
  const client = createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        held.push(...cookiesToSet.map(({name, value, options}) => ({name, value, options})));
      },
    },
  });
  return {
    client,
    get held() {
      return held.length;
    },
    /**
     * Writes the held cookies, in the order the client made them, to this response. False when there was nothing to write (no
     * session was minted, or it was already committed or discarded: a recovery with no cookie to give must not go on to a page that
     * would find no session) and when the cookie store refused.
     */
    commit() {
      const writes = held;
      held = [];
      if (writes.length === 0) return false;
      try {
        for (const {name, value, options} of writes) cookieStore.set(name, value, options);
        return true;
      } catch {
        return false;
      }
    },
    /** Forgets the held cookies: the browser keeps what it sent. A commit after it has nothing to write. */
    discard() {
      held = [];
    },
  };
}

/**
 * Signs the person out for good, from a route handler or a Server Action (the only places that can write
 * cookies): Auth is told to end the session (all of the user's sessions for `global`, this browser's for
 * `local`) and gives up after the deadline, then THIS project's session cookies are expired whether or not
 * Auth answered, so an outage cannot leave a refused identity signed in. Other projects' cookies stay.
 */
export async function endSession(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scope: SignOutScope = 'global',
  options: {log?: (message: string, detail: string) => void; timeoutMs?: number} = {},
) {
  await signOutQuietly(client, scope, options);
  await expireAuthCookies();
}

/** Expires this project's session cookies without asking Auth anything: for a failure where Auth cannot be trusted to answer. */
export async function expireAuthCookies() {
  const store = await cookies();
  for (const {name} of store.getAll()) if (isAuthCookieName(name)) store.delete(name);
}
