// Story 1.4c. What decides whether a state-changing request really came from this application: the origin
// decision, the CSRF token's names, shape and hash, and what counts as a page request. All of it is pure:
// no I/O, no Next.js and no Node module (it uses Web Crypto, which Node and every browser have), so the proxy,
// the route helper, the browser helper (lib/csrf-client.ts) and the tests share one definition.
//
//   Origin   Every request that is not safe (anything but GET, HEAD and OPTIONS) must carry an `Origin` that is
//            present, is not the literal `null` (a sandboxed frame, a redirect across origins, a file), and
//            whose host is this application's own: the first `x-forwarded-host`, else `host`, which is how Next
//            compares for Server Actions. Next lets a request with no `Origin` through; this does not. And a
//            browser that says `Sec-Fetch-Site: cross-site` is refused even when an `Origin` matches.
//   Token    256 random bits per session, 43 URL-safe characters. Only its SHA-256, under a domain label, is
//            stored (on the session grant); the browser keeps the token in a cookie its scripts can read and
//            echoes it in a header.
//
// Nothing here logs. A refusal names a rule, never a header's value.

/** The cookie that carries the session's CSRF token: readable by page script (not httpOnly), Secure on https, SameSite Lax, path `/`. */
export const csrfCookieName = 'nova3d-csrf';

/** The header in which page script echoes the cookie's token on a mutation. */
export const csrfHeaderName = 'x-csrf-token';

/**
 * The cookie's attributes. Not httpOnly, on purpose: the page script must read it to echo it. SameSite Lax, so
 * the top-level navigation that carries the session in also carries the token, and a request from another
 * site does not. A session cookie (no expiry of its own): the grant it belongs to lasts at most 30 days, and
 * a lost cookie is replaced on the next page request (see api.issue_csrf).
 */
export function csrfCookieOptions(secure: boolean) {
  return {httpOnly: false, secure, sameSite: 'lax', path: '/'} as const;
}

/**
 * Whether the browser reached this application over https, for the cookie's `Secure` flag: the first
 * `x-forwarded-proto` where a platform in front terminates TLS, else the request's own protocol.
 */
export function isSecureRequest(forwardedProto: string | null | undefined, urlProtocol: string): boolean {
  const forwarded = forwardedProto?.split(',')[0].trim().toLowerCase();
  if (forwarded) return forwarded === 'https';
  return urlProtocol.toLowerCase() === 'https:';
}

const tokenBytes = 32;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** Whether a value is shaped like a token this module mints (and so is worth hashing and comparing). */
export function isCsrfToken(value: unknown): value is string {
  return typeof value === 'string' && tokenPattern.test(value);
}

function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new token: 32 random bytes from the CSPRNG, as 43 URL-safe characters (256 bits). Shown to no one but the browser's cookie jar. */
export function newCsrfToken(random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))): string {
  const bytes = random(tokenBytes);
  if (bytes.length !== tokenBytes) throw new Error('The random source returned the wrong number of bytes.');
  return base64url(bytes);
}

/**
 * The hash the database stores and compares: hex SHA-256 of the token under a domain label. The token is
 * high-entropy, so a plain SHA-256 is enough. Throws for anything that is not shaped like a token, so a
 * malformed header never reaches the database.
 */
export async function hashCsrfToken(token: string): Promise<string> {
  if (!isCsrfToken(token)) throw new TypeError('not a CSRF token');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nova3d/csrf-token/v1\0${token}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Origin -----------------------------------------------------------------------------------------------

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
// A host name, an IPv4 address or a bracketed IPv6 address, with an optional port: what a Host header holds.
const bareHost = /^(?:[a-z0-9._-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** A safe method changes nothing, so it is not checked. */
export const isSafeMethod = (method: string) => safeMethods.has(method.toUpperCase());

export type OriginInput = {
  method: string;
  origin: string | null | undefined;
  host: string | null | undefined;
  forwardedHost: string | null | undefined;
  fetchSite: string | null | undefined;
};

/** Why a request was refused. A rule's name, never a header's value. */
export type OriginRefusal = 'origin_missing' | 'origin_null' | 'origin_invalid' | 'host_missing' | 'origin_mismatch' | 'cross_site';
export type OriginDecision = {allowed: true} | {allowed: false; reason: OriginRefusal};

/** The host this application is reached at: the first `x-forwarded-host` (a proxy may append its own), else `host`. Lower-case; null if neither says. */
export function expectedHost(input: Pick<OriginInput, 'host' | 'forwardedHost'>): string | null {
  const forwarded = input.forwardedHost?.split(',')[0].trim();
  const host = forwarded || input.host?.trim();
  return host ? host.toLowerCase() : null;
}

/**
 * Whether a request may go on, judged by its method and headers alone. A safe method always may. Any other
 * needs an `Origin` that is present, is not `null` and has this application's host, and a `Sec-Fetch-Site` that
 * is not `cross-site`. Anything it cannot read is a refusal.
 *
 * Hosts are compared the way a browser spells them: lower-case, and with the default port of the Origin's own
 * scheme dropped, so `Host: app.example:443` is the host of `Origin: https://app.example` (and `:80` of
 * `http://`). A different port is a different host. The SCHEME is not compared, as Next does not for Server
 * Actions either: a page served over http cannot be told from one served over https by the host alone, and the
 * defence there is HSTS and the Secure cookies, not this check.
 */
export function decideOrigin(input: OriginInput): OriginDecision {
  if (isSafeMethod(input.method)) return {allowed: true};
  const origin = input.origin?.trim();
  if (!origin) return {allowed: false, reason: 'origin_missing'};
  if (origin.toLowerCase() === 'null') return {allowed: false, reason: 'origin_null'};
  let claimed: URL;
  try {
    claimed = new URL(origin);
  } catch {
    return {allowed: false, reason: 'origin_invalid'};
  }
  const own = expectedHost(input);
  if (!own) return {allowed: false, reason: 'host_missing'};
  // Our own host, written as the Origin's scheme would write it (default port dropped). Anything that is not
  // a bare host with an optional port (a path, credentials, a query) is not a host we can compare with.
  if (!bareHost.test(own)) return {allowed: false, reason: 'host_missing'};
  let mine: URL;
  try {
    mine = new URL(`${claimed.protocol}//${own}`);
  } catch {
    return {allowed: false, reason: 'host_missing'};
  }
  if (mine.username || mine.password || mine.search || mine.hash || mine.pathname !== '/') return {allowed: false, reason: 'host_missing'};
  if (claimed.host.toLowerCase() !== mine.host.toLowerCase()) return {allowed: false, reason: 'origin_mismatch'};
  if (input.fetchSite?.trim().toLowerCase() === 'cross-site') return {allowed: false, reason: 'cross_site'};
  return {allowed: true};
}

type HeaderReader = {get(name: string): string | null};

/** The headers the decision reads, from a request's. */
export function originInputOf(method: string, headers: HeaderReader): OriginInput {
  return {
    method,
    origin: headers.get('origin'),
    host: headers.get('host'),
    forwardedHost: headers.get('x-forwarded-host'),
    fetchSite: headers.get('sec-fetch-site'),
  };
}

// Page requests -----------------------------------------------------------------------------------------

/**
 * Whether a request is a browser navigating to a page (a document navigation): a GET that asks for a
 * document. `Sec-Fetch-Dest: document` says so; a browser too old to send it is read by its `Accept`. A
 * client-side navigation (`RSC`), a prefetch and an `/api` call are not, and neither is a speculative load: a
 * page the browser fetches or renders ahead of time (`Sec-Purpose: prefetch` or `prerender`, or the older
 * `Purpose: prefetch`) has not been opened by the person, and a cookie set by it would be set before they
 * chose to go there.
 */
export function isDocumentNavigation(method: string, headers: HeaderReader): boolean {
  if (method.toUpperCase() !== 'GET') return false;
  if (headers.get('rsc') !== null || headers.get('next-router-prefetch') !== null) return false;
  const purpose = `${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''}`.toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('prerender')) return false;
  const destination = headers.get('sec-fetch-dest')?.trim().toLowerCase();
  if (destination) return destination === 'document';
  return (headers.get('accept') ?? '').toLowerCase().includes('text/html');
}
