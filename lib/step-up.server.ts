// Story 1.4b. The parts of a step-up that need the request: this browser's step-up cookie and PKCE verifier
// cookie, and the origin the sign-in must return to. Only a route handler or a Server Action can write cookies,
// so only they call the writers.
//
// The secret in the cookie and the verifier are never logged and never returned to a page.
import {cookies, headers} from 'next/headers';
import {authCookieBase, isPkceVerifierCookieName} from '@/lib/supabase/sign-out';
import {challengeOfVerifier, isStepUpSecret, stepUpCookieMaxAge, stepUpCookieName, verifierOfCookie} from '@/lib/step-up-flow';

/** What this browser holds for an unfinished step-up: the cookie's secret, and the PKCE challenge of the sign-in it is coming back from. */
export type StepUpFlow = {secret: string; challenge: string};

/**
 * This browser's step-up cookie and the PKCE verifier of the sign-in that is calling back, or null when either
 * is missing or malformed: then the callback is an ordinary sign-in. It must be read BEFORE the code exchange,
 * which removes the verifier. It never throws.
 */
export async function readStepUpFlow(): Promise<StepUpFlow | null> {
  try {
    const store = await cookies();
    const secret = store.get(stepUpCookieName)?.value;
    if (!isStepUpSecret(secret)) return null;
    const base = authCookieBase();
    if (!base) return null;
    const verifier = verifierOfCookie(store.get(`${base}-code-verifier`)?.value);
    if (!verifier) return null;
    return {secret, challenge: challengeOfVerifier(verifier)};
  } catch {
    return null;
  }
}

/** Sets the step-up cookie: httpOnly (no script reads it), sent on the top-level return from Google (lax), and gone when the nonce is. */
export async function setStepUpCookie(secret: string, options: {secure: boolean}) {
  const store = await cookies();
  store.set(stepUpCookieName, secret, {httpOnly: true, sameSite: 'lax', secure: options.secure, path: '/', maxAge: stepUpCookieMaxAge});
}

/** Removes the step-up cookie. */
export async function clearStepUpCookie() {
  const store = await cookies();
  store.delete(stepUpCookieName);
}

/** This browser's PKCE verifier cookies by name (never the session cookie), as they were before a sign-in start wrote its own. */
export type VerifierCookies = ReadonlyMap<string, string>;

export async function snapshotVerifierCookies(): Promise<VerifierCookies> {
  const store = await cookies();
  return new Map(store.getAll().filter((cookie) => isPkceVerifierCookieName(cookie.name)).map((cookie) => [cookie.name, cookie.value]));
}

// The attributes @supabase/ssr gives its own cookies (DEFAULT_COOKIE_OPTIONS), so a verifier that is put back is
// the cookie it was.
const verifierCookieOptions = {path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60} as const;

/**
 * Undoes what a Google sign-in start wrote to this browser's PKCE verifier cookies, when the step-up that
 * wanted that sign-in then cannot begin (the Account has used its starts, the session has lost access, the
 * database did not answer): a verifier the start added is removed, and one it displaced (another sign-in's,
 * evicted or overwritten) is put back as it was. `written` is the names the start's client wrote; only names
 * that are verifier cookies are touched, never the session cookie (a client may refresh that while it works).
 */
export async function restoreVerifierCookies(before: VerifierCookies, written: Iterable<string>) {
  const store = await cookies();
  for (const name of new Set(written)) {
    if (!isPkceVerifierCookieName(name)) continue;
    const previous = before.get(name);
    if (previous === undefined) store.delete(name);
    else store.set(name, previous, verifierCookieOptions);
  }
}

const hostPattern = /^[A-Za-z0-9.-]+(?::\d{1,5})?$|^\[[0-9A-Fa-f:]+\](?::\d{1,5})?$/;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The origin this request came in on, for the sign-in's `redirectTo` (the browser flow uses
 * `window.location.origin`; a Server Action has only headers). The proxy in front of the app sets
 * `x-forwarded-host` and `x-forwarded-proto`; otherwise the Host header. A missing `x-forwarded-proto` is read as
 * plain http ONLY for a loopback host (127.0.0.1, localhost, [::1]: the local stack and the browser tests); for
 * any other host it fails closed, because a platform that forwards the host and not the protocol is a platform
 * to ask, not to guess http for (the step-up cookie's `Secure` flag depends on it). Auth only honours a
 * `redirectTo` on its allow-list and falls back to the site URL otherwise, so a forged Host header can send a
 * sign-in nowhere new. Null when the headers are not shaped like an origin.
 */
export async function requestOrigin(): Promise<{origin: string; secure: boolean} | null> {
  const list = await headers();
  const host = (list.get('x-forwarded-host') ?? list.get('host') ?? '').split(',')[0].trim();
  const forwarded = list.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase();
  if (!hostPattern.test(host)) return null;
  const hostname = host.replace(/:\d{1,5}$/, '').toLowerCase();
  const protocol = forwarded || (loopbackHosts.has(hostname) ? 'http' : '');
  if (protocol !== 'http' && protocol !== 'https') return null;
  return {origin: `${protocol}://${host}`, secure: protocol === 'https'};
}
