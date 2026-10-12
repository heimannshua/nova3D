// Story 1.6. The one place the application calls Auth's Admin API: it asks for a magic-link token for a user it has already
// checked, so that a session can be minted without a sign-in credential (Administrator recovery). The service role key
// is the credential, and only this module and lib/accounts.ts use it.
//
// What it asks: POST <supabase>/auth/v1/admin/generate_link with {type: 'magiclink', email}. Auth answers with the user and
// a `hashed_token`, which `verifyOtp({token_hash, type: 'magiclink'})` on the cookie-bound client turns into a session.
// The email provider stays disabled in Auth: this is the Admin API, not the provider (docs/auth-setup.md, "Verifying
// Administrator recovery on hosted environments", is the check that hosted Auth allows it).
//
// Plain `fetch`, a timeout, no redirects (so the service key can never follow one to another host), and nothing is logged:
// no key, address, token or response. SERVER-ONLY, like lib/accounts.ts.
import type {Env} from '@/lib/environment';

if (typeof window !== 'undefined') {
  throw new Error('lib/auth-admin.ts is server-only and must not be imported by browser code.');
}

/**
 * Auth's Admin API could not make the link: not configured, not reachable, or refused. `retryable` is true for a network
 * failure, a timeout or an HTTP 5xx (asking again may work) and false for a request Auth understood and refused (a 4xx:
 * hosted Auth refusing the Admin link API is one, and is what the staging attestation exists to catch).
 */
export class AuthAdminError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly retryable: boolean;
  constructor(message: string, details: {status?: number; code?: string; retryable?: boolean} = {}) {
    super(message);
    this.name = 'AuthAdminError';
    this.status = details.status;
    this.code = details.code;
    this.retryable = details.retryable ?? false;
  }
}

export type AuthAdminOptions = {
  env?: Env;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

/** What a generated link gives the caller: the hashed token to verify, and the Auth user it is for. */
export type MagicLink = {hashedToken: string; userId: string};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Generates a magic-link token for an existing Auth user, by that user's own email. Throws AuthAdminError. The caller
 * verifies the token at once with `verifyOtp` and never stores or logs it. The returned user ID is Auth's own answer, so the
 * caller can compare it with the user it meant to sign in.
 */
export async function generateMagicLink(email: string, options: AuthAdminOptions = {}): Promise<MagicLink> {
  const env = options.env ?? process.env;
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base || !serviceKey) throw new AuthAdminError('Auth is not configured.');
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    throw new AuthAdminError('Auth is not configured.');
  }
  const headers = {apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', accept: 'application/json'};
  try {
    new Headers(headers);
  } catch {
    throw new AuthAdminError('Auth is not configured.');
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${origin}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers,
      body: JSON.stringify({type: 'magiclink', email}),
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      cache: 'no-store',
    });
  } catch {
    throw new AuthAdminError('Auth did not answer.', {retryable: true});
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const fields = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (!response.ok) {
    const code = typeof fields.error_code === 'string' ? fields.error_code : undefined;
    throw new AuthAdminError(`Auth refused to make the link (HTTP ${response.status}).`, {status: response.status, code, retryable: response.status >= 500});
  }
  const hashedToken = fields.hashed_token;
  const userId = fields.id;
  if (typeof hashedToken !== 'string' || !hashedToken || typeof userId !== 'string' || !uuidPattern.test(userId)) {
    throw new AuthAdminError('Auth answered with an unexpected shape.', {status: response.status});
  }
  return {hashedToken, userId: userId.toLowerCase()};
}
