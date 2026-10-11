// Story 1.4c. The browser's half of the CSRF token: read the cookie the proxy set and echo it in a header on a
// mutation. A page on another site can neither read this application's cookie nor set its header, which is
// what makes the echo a proof.
//
// BROWSER-SAFE. It imports only the names from lib/request-integrity.ts (pure, no Node module) and touches
// `document`, `location` and `fetch` only inside a function, so a client component, a Server Component and a
// test may all import it. tests/unit/gate-structure.test.ts keeps it free of the server-only modules.
//
// The token is readable by page script on purpose, so it must go nowhere but this application: `csrfFetch`
// sends to the page's own origin and rejects, sending nothing, for any other.
//
// A Server Action needs none of this: Next compares its Origin to its Host, and the proxy refuses a mutation
// whose Origin is not this application's.
import {csrfCookieName, csrfHeaderName, isCsrfToken} from './request-integrity';

/**
 * The token in a cookie string (`document.cookie` by default), or null when there is none. Every cookie of that
 * name is read, and the first one that is shaped like a token wins: a stale or planted cookie of the same name
 * (another path, a truncated value) does not hide the real one.
 */
export function readCsrfToken(cookie: string = typeof document === 'undefined' ? '' : document.cookie): string | null {
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== csrfCookieName) continue;
    let value = part.slice(separator + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // A value that does not decode is not a token; the next cookie of the name may be.
    }
    if (isCsrfToken(value)) return value;
  }
  return null;
}

/** The request options with the token added in its header, when the browser holds one. Anything already in `init` is kept. */
export function withCsrfToken(init: RequestInit = {}, cookie?: string): RequestInit {
  const token = readCsrfToken(cookie);
  const headers = new Headers(init.headers);
  if (token) headers.set(csrfHeaderName, token);
  return {...init, headers};
}

/** What `csrfFetch` reads from the page, so a test can say where the page is and what it holds. */
export type CsrfPage = {
  /** The page's address (`location.href`): a relative target is resolved against it. */
  href: string;
  /** The page's origin (`location.origin`): the only origin the token is sent to. */
  origin: string;
  /** The page's cookies (`document.cookie`). */
  cookie?: string;
  /** The `fetch` to send with. */
  fetch?: typeof fetch;
};

function currentPage(): CsrfPage {
  if (typeof location === 'undefined') throw new TypeError('csrfFetch can only be used in a page.');
  return {href: location.href, origin: location.origin, cookie: typeof document === 'undefined' ? '' : document.cookie};
}

/**
 * `fetch` for a mutation of this application's own `/api`: SAME ORIGIN ONLY, with the token echoed.
 *
 * The target is resolved against the page's address; if its origin is not the page's, this rejects with a TypeError and
 * sends NOTHING, because the token is readable by script and must never go to a third party. When `input` is a
 * `Request`, its own headers are kept and `init.headers` win over them (a bare `fetch(request, init)` would
 * replace them). With no token to echo it still sends the request, which the server refuses with `csrf_invalid`;
 * a page request issues one.
 */
export async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}, page: CsrfPage = currentPage()): Promise<Response> {
  const target = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  let url: URL;
  try {
    url = new URL(target, page.href);
  } catch {
    throw new TypeError('csrfFetch needs an address it can read.');
  }
  if (url.origin !== page.origin) throw new TypeError('csrfFetch sends to this application only.');

  const headers = new Headers(typeof input === 'string' || input instanceof URL ? undefined : input.headers);
  for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  const token = readCsrfToken(page.cookie ?? (typeof document === 'undefined' ? '' : document.cookie));
  if (token) headers.set(csrfHeaderName, token);
  return (page.fetch ?? fetch)(input, {...init, headers, credentials: 'same-origin'});
}
