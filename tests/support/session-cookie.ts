import {createHmac} from 'node:crypto';

// Builds the cookie @supabase/ssr reads a session from. Local Google sign-in cannot be driven, so the
// browser tests forge a session instead (tests/support/forged-session.ts inserts the Auth rows that make
// it real), and the unit tests use the same cookie against a stubbed Auth service. The cookie is
// `sb-<host-first-label>-auth-token`, its value `base64-` followed by the base64url of the session JSON.

/** The cookie name @supabase/ssr derives from the project URL. */
export function sessionCookieName(supabaseUrl: string) {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export type ForgedTokenInput = {
  supabaseUrl: string;
  userId: string;
  email: string;
  sessionId: string;
  /** The stack's JWT secret. Anything for a unit test, where the Auth service is stubbed. */
  jwtSecret: string;
  /** Seconds since the epoch. Defaults to now. */
  issuedAt?: number;
  /** How long the access token lives, in seconds. Defaults to an hour. */
  lifetime?: number;
};

/** An HS256 access token shaped like the ones GoTrue issues for a Google sign-in, including `session_id`. */
export function signAccessToken(input: ForgedTokenInput) {
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({alg: 'HS256', typ: 'JWT'})}.${base64url({
    iss: `${input.supabaseUrl}/auth/v1`,
    aud: 'authenticated',
    sub: input.userId,
    iat: issuedAt,
    exp: issuedAt + (input.lifetime ?? 3600),
    email: input.email,
    phone: '',
    app_metadata: {provider: 'google', providers: ['google']},
    user_metadata: {email: input.email, email_verified: true},
    role: 'authenticated',
    aal: 'aal1',
    amr: [{method: 'oauth', timestamp: issuedAt}],
    session_id: input.sessionId,
    is_anonymous: false,
  })}`;
  return `${unsigned}.${createHmac('sha256', input.jwtSecret).update(unsigned).digest('base64url')}`;
}

/** The cookie value for a session. Refuses a value too long for one cookie, which @supabase/ssr would chunk. */
export function sessionCookieValue(input: ForgedTokenInput & {refreshToken?: string}) {
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000);
  const lifetime = input.lifetime ?? 3600;
  const session = {
    access_token: signAccessToken(input),
    token_type: 'bearer',
    expires_in: lifetime,
    expires_at: issuedAt + lifetime,
    refresh_token: input.refreshToken ?? 'forged-refresh-token',
    user: {
      id: input.userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: input.email,
      email_confirmed_at: new Date(issuedAt * 1000).toISOString(),
      phone: '',
      app_metadata: {provider: 'google', providers: ['google']},
      user_metadata: {email: input.email, email_verified: true},
      identities: [],
      created_at: new Date(issuedAt * 1000).toISOString(),
      updated_at: new Date(issuedAt * 1000).toISOString(),
      is_anonymous: false,
    },
  };
  const value = `base64-${base64url(session)}`;
  if (value.length > 3000) throw new Error('The forged session no longer fits one cookie; shorten its claims.');
  return value;
}
