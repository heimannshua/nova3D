import {createServerClient, type CookieOptions} from '@supabase/ssr';
import {NextResponse, type NextRequest} from 'next/server';
import {isAuthCookieName} from './sign-out';

/**
 * A Supabase client for the proxy, and the responses that carry its cookies. Auth may refresh the session
 * while it is being checked; the new cookies must reach both the page that renders next (through the
 * forwarded request) and the browser (on whatever response goes back, a redirect included), so every
 * response is built here and all of them carry every cookie written so far.
 */
export function createSupabaseProxyClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const written = new Map<string, {value: string; options: CookieOptions}>();
  const cacheHeaders: Record<string, string> = {};

  function carry(response: NextResponse) {
    for (const [name, {value, options}] of written) response.cookies.set(name, value, options);
    for (const [name, value] of Object.entries(cacheHeaders)) response.headers.set(name, value);
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const {name, value, options} of cookiesToSet) {
          request.cookies.set(name, value);
          written.set(name, {value, options});
        }
        Object.assign(cacheHeaders, headers);
      },
    },
  });

  return {
    supabase,
    /** Lets the request through to the page, with any refreshed session. */
    next: () => carry(NextResponse.next({request})),
    /** Sends the browser elsewhere, keeping any refreshed (or cleared) session cookies. */
    redirect: (location: URL, status: 303 | 307 = 307) => carry(NextResponse.redirect(location, status)),
    /** Expires every Auth cookie the request carried, for a refusal that must not stay signed in. */
    expireSession: (response: NextResponse) => {
      for (const {name} of request.cookies.getAll()) {
        if (isAuthCookieName(name, url)) response.cookies.set(name, '', {maxAge: 0, path: '/'});
      }
      return response;
    },
  };
}
