// Story 1.4b. The secrets and hashes of a step-up, with nothing that needs a request: the random secret in the
// initiating browser's httpOnly cookie and its hash, the PKCE binding of the Google sign-in the step-up began,
// and the reading of the PKCE verifier cookie that @supabase/ssr leaves in that browser.
//
// SERVER-ONLY (it uses node:crypto, which a client bundle cannot resolve), and tested directly. No function
// here logs, and nothing in an error message is a secret, a verifier or a hash.
import {createHash, randomBytes} from 'node:crypto';

/** The httpOnly cookie, on the initiating browser only, that carries the step-up's random secret. */
export const stepUpCookieName = 'nova3d-step-up';

/** How long the cookie lives, in seconds: the nonce's own 10 minutes. */
export const stepUpCookieMaxAge = 600;

const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const challengePattern = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes from the operating system's CSPRNG, as 43 URL-safe characters: 256 bits. Shown to no one but the browser's cookie jar. */
export function newStepUpSecret() {
  return randomBytes(32).toString('base64url');
}

/** Whether a cookie value is shaped like a secret this module issues. Anything else is not a step-up. */
export function isStepUpSecret(value: unknown): value is string {
  return typeof value === 'string' && secretPattern.test(value);
}

/** The hash the database stores and looks a nonce up by. The secret is high-entropy, so a plain SHA-256 is enough, under a domain label. */
export function hashStepUpSecret(secret: string) {
  return createHash('sha256').update(`nova3d/step-up-secret/v1\0${secret}`).digest('hex');
}

/** The S256 PKCE challenge of a verifier: base64url of its SHA-256. The same value the authorize URL carries. */
export function challengeOfVerifier(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * The PKCE challenge in an authorize URL, or null unless the URL carries an S256 challenge of the expected
 * shape. A step-up that cannot be bound to its flow is not started (a `plain` challenge would be the
 * verifier itself).
 */
export function challengeOfAuthorizeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const challenge = parsed.searchParams.get('code_challenge');
  const method = parsed.searchParams.get('code_challenge_method');
  if (method?.toLowerCase() !== 's256' || !challenge || !challengePattern.test(challenge)) return null;
  return challenge;
}

/**
 * The PKCE verifier out of the raw value of the `<storage key>-code-verifier` cookie that @supabase/ssr writes
 * when a sign-in starts. Auth's storage writes every value as JSON text, and the cookie holds either that text or
 * `base64-` followed by its base64url (the default encoding); a verifier may carry a `/recovery` suffix, which
 * is not part of it. Null when the cookie is missing or is anything else.
 */
export function verifierOfCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  let text = raw;
  if (text.startsWith('base64-')) {
    try {
      text = Buffer.from(text.slice('base64-'.length), 'base64url').toString('utf8');
    } catch {
      return null;
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'string') return null;
  const verifier = value.split('/')[0];
  return verifier || null;
}
