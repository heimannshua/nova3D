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

  function finish(response: NextResponse, extraCookie?: {name: string; value: string; options: CookieOptions}) {
    carry(response);
    if (extraCookie) {
      response.cookies.set(extraCookie.name, extraCookie.value, extraCookie.options);
      response.headers.set('cache-control', 'private, no-store');
    }
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
    /**
     * Lets the request through to the page, with any refreshed session. `extraCookie` (the CSRF token, Story 1.4c)
     * is set on the same response, and a response that sets it is ALWAYS `private, no-store`, whatever cache
     * header was there (a refreshed session may have set a weaker one): a shared cache must never store, and
     * so hand to somebody else, a response that carries one person's token.
     */
    next: (extraCookie?: {name: string; value: string; options: CookieOptions}) => finish(NextResponse.next({request}), extraCookie),
    /**
     * Lets the request through to ANOTHER path's page (the browser's address does not change), exactly as `next` does otherwise:
     * the same refreshed session cookies and the same extra cookie with the same cache header. (Story 1.7: a Project link whose
     * ID does not decode is rendered by the page for an ID that is none.)
     */
    rewrite: (to: URL, extraCookie?: {name: string; value: string; options: CookieOptions}) => finish(NextResponse.rewrite(to, {request}), extraCookie),
    /** Carries any refreshed (or cleared) session cookies on a response the proxy built itself, such as a JSON denial. */
    respond: (response: NextResponse) => carry(response),
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
