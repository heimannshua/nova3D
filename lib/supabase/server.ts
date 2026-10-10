import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {isAuthCookieName, signOutQuietly, type SignOutScope} from './sign-out';

export async function createSupabaseServerClient() {
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
          cookiesToSet.forEach(({name, value, options}) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot always write cookies; proxy handles refreshes.
        }
      },
    },
  });
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
