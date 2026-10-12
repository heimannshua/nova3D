import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The sign-in callback with the REAL server Supabase client (lib/supabase/server.ts, @supabase/ssr and
// auth-js), over a stubbed network and an in-memory cookie store, the way tests/unit/proxy-gating.test.ts
// runs the proxy. Local Google sign-in cannot be driven, so this is the closest the suite gets to the code
// exchange: the PKCE exchange itself, the user Auth then vouches for, the session read from the exchanged
// token, the pre-authorization, and the grant that goes to the accounts API.
const store = vi.hoisted(() => ({jar: new Map<string, string>()}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...store.jar].map(([name, value]) => ({name, value})),
    get: (name: string) => (store.jar.has(name) ? {name, value: store.jar.get(name)} : undefined),
    // @supabase/ssr removes a cookie by setting it empty.
    set: (name: string, value: string) => {
      if (value === '') store.jar.delete(name);
      else store.jar.set(name, value);
    },
    delete: (name: string) => {
      store.jar.delete(name);
    },
  }),
}));

import {GET} from '@/app/auth/callback/route';
import {challengeOfVerifier, hashStepUpSecret, stepUpCookieName} from '@/lib/step-up-flow';
import {sessionCookieName, signAccessToken} from '../support/session-cookie';
import {unsignedToken} from '../support/access-token';

const SUPABASE = 'http://127.0.0.1:54321';
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const SECRET = 'unit-test-jwt-secret-with-at-least-32-characters';
const cookieName = sessionCookieName(SUPABASE);

type Net = {
  /** The access token the code exchange returns. */
  token: () => string;
  /** What the pre-authorization answers. */
  preauth: 'registered' | 'active' | 'none' | 'disabled' | 'refused';
  /** What the grant call answers: an outcome, or a failure. */
  grant: 'issued' | 'exists' | 'down';
  /** Whether Auth refuses the exchange. */
  exchange: 'ok' | 'refused';
  /** What api.complete_step_up answers. */
  stepUp: 'accepted' | 'rejected' | 'unknown' | 'other_flow' | 'down';
};
type Call = {method: string; path: string; search: string; body: string};
let net: Net;
let calls: Call[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const user = () => ({
  id: USER, aud: 'authenticated', role: 'authenticated', email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z',
  app_metadata: {provider: 'google', providers: ['google']}, user_metadata: {email_verified: true}, identities: [],
  created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', is_anonymous: false,
});
const goodToken = (sessionId = SESSION) => signAccessToken({supabaseUrl: SUPABASE, userId: USER, email: 'person@example.com', sessionId, jwtSecret: SECRET});

async function stubbedFetch(input: unknown, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url);
  calls.push({method: init.method ?? 'GET', path: url.pathname, search: url.search, body: typeof init.body === 'string' ? init.body : ''});
  if (url.pathname === '/auth/v1/token') {
    if (net.exchange === 'refused') return json({code: 400, error_code: 'flow_state_not_found', msg: 'invalid flow state'}, 400);
    // The exchange consumes the PKCE verifier, so anything that needs it must have read it before.
    store.jar.delete(`${cookieName}-code-verifier`);
    const token = net.token();
    const issuedAt = Math.floor(Date.now() / 1000);
    return json({access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: issuedAt + 3600, refresh_token: 'exchanged-refresh-token', user: user()});
  }
  if (url.pathname === '/auth/v1/user') return json(user());
  if (url.pathname === '/auth/v1/logout') return new Response(null, {status: 204});
  if (url.pathname === '/rest/v1/rpc/consume_preauthorization') {
    const live = net.preauth === 'registered' || net.preauth === 'active';
    return json({outcome: net.preauth, account_id: live ? ACCOUNT : null, workspace_id: null, role: live ? 'member' : null});
  }
  if (url.pathname === '/rest/v1/rpc/issue_grant') {
    if (net.grant === 'down') throw new TypeError('fetch failed');
    return json({outcome: net.grant, account_id: ACCOUNT, epoch: 1});
  }
  if (url.pathname === '/rest/v1/rpc/complete_step_up') {
    if (net.stepUp === 'down') throw new TypeError('fetch failed');
    if (net.stepUp === 'accepted') return json({outcome: 'accepted', reason: null, action_class: 'administration'});
    if (net.stepUp === 'rejected') return json({outcome: 'rejected', reason: 'mismatch', action_class: 'administration'});
    return json({outcome: 'not_step_up', reason: net.stepUp, action_class: null});
  }
  throw new Error(`unexpected request to ${url.pathname}`);
}

beforeEach(() => {
  net = {token: () => goodToken(), preauth: 'registered', grant: 'issued', exchange: 'ok', stepUp: 'accepted'};
  calls = [];
  store.jar.clear();
  // What signInWithOAuth left in the browser: the PKCE code verifier for this sign-in. Auth's storage writes
  // every value as JSON text, so a string is stored with its quotes.
  store.jar.set(`${cookieName}-code-verifier`, JSON.stringify('a-pkce-code-verifier'));
  vi.stubGlobal('fetch', vi.fn(stubbedFetch));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const callback = async (query = '?code=google-code') => {
  const response = await GET(new Request(`http://127.0.0.1:4173/auth/callback${query}`));
  const location = new URL(response.headers.get('location') ?? 'http://invalid/', 'http://127.0.0.1:4173');
  return {status: response.status, to: `${location.pathname}${location.search}`};
};
const rpc = (name: string) => calls.filter((call) => call.path === `/rest/v1/rpc/${name}`);

describe('a completed sign-in, over the real client', () => {
  it('redirects with a relative Location, so the browser resolves it against the address it used, not the one the server believes it has', async () => {
    const response = await GET(new Request('http://localhost:4173/auth/callback?code=google-code'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/');
    const failed = await GET(new Request('http://localhost:4173/auth/callback'));
    expect(failed.headers.get('location')).toBe('/login?error=auth_unavailable');
  });

  it('exchanges the code, issues the grant for the exchanged token\'s session_id, and goes Home', async () => {
    expect(await callback()).toEqual({status: 307, to: '/'});
    // The exchange went to Auth with the code and the verifier.
    const exchange = calls.find((call) => call.path === '/auth/v1/token');
    expect(exchange?.search).toContain('grant_type=pkce');
    expect(JSON.parse(exchange!.body)).toMatchObject({auth_code: 'google-code', code_verifier: 'a-pkce-code-verifier'});
    // One grant, for that user and that session, and nothing the browser sent.
    expect(rpc('issue_grant').map((call) => JSON.parse(call.body))).toEqual([{p_user_id: USER, p_session_id: SESSION}]);
    // The session is in the browser, and nobody was signed out.
    expect(store.jar.has(cookieName)).toBe(true);
    expect(calls.some((call) => call.path === '/auth/v1/logout')).toBe(false);
  });

  it('names whichever session the exchange returned, not a fixed one', async () => {
    const other = '8d2e4f6a-1b3c-4d5e-9f70-a1b2c3d4e5f6';
    net.token = () => goodToken(other);
    expect(await callback()).toEqual({status: 307, to: '/'});
    expect(rpc('issue_grant').map((call) => JSON.parse(call.body))).toEqual([{p_user_id: USER, p_session_id: other}]);
  });

  it('does not read the stored session again: it asks Auth who signed in, and that is all', async () => {
    await callback();
    expect(calls.filter((call) => call.path === '/auth/v1/user')).toHaveLength(1);
    expect(calls.filter((call) => call.path === '/auth/v1/token')).toHaveLength(1);
  });

  it('issues the grant of a returning Account too (the pre-authorization says it is active)', async () => {
    net.preauth = 'active';
    expect(await callback()).toEqual({status: 307, to: '/'});
    expect(rpc('issue_grant')).toHaveLength(1);
  });

  it('sends a verified identity with no Account to register, with no grant', async () => {
    net.preauth = 'none';
    expect(await callback()).toEqual({status: 307, to: '/register'});
    expect(rpc('issue_grant')).toEqual([]);
  });
});

describe('a sign-in that cannot be completed, over the real client', () => {
  it('ends at auth_unavailable, signed out on this browser only, when the exchanged token carries no session_id', async () => {
    net.token = () => unsignedToken({sub: USER, aud: 'authenticated', role: 'authenticated'});
    expect(await callback()).toEqual({status: 307, to: '/login?error=auth_unavailable'});
    expect(rpc('issue_grant')).toEqual([]);
    expect(rpc('consume_preauthorization')).toEqual([]);
    expect(calls.find((call) => call.path === '/auth/v1/logout')?.search).toContain('scope=local');
    expect(store.jar.has(cookieName)).toBe(false);
  });

  it('ends at auth_unavailable when the exchanged token is for another user than the one Auth vouches for', async () => {
    net.token = () => signAccessToken({supabaseUrl: SUPABASE, userId: '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99', email: 'someone@example.com', sessionId: SESSION, jwtSecret: SECRET});
    expect(await callback()).toEqual({status: 307, to: '/login?error=auth_unavailable'});
    expect(rpc('issue_grant')).toEqual([]);
  });

  it('ends at auth_unavailable, signed out on this browser only, when the grant cannot be recorded', async () => {
    net.grant = 'down';
    expect(await callback()).toEqual({status: 307, to: '/login?error=auth_unavailable'});
    expect(calls.find((call) => call.path === '/auth/v1/logout')?.search).toContain('scope=local');
    expect(store.jar.has(cookieName)).toBe(false);
  });

  it('reports a refused exchange as a failed sign-in, with nothing consumed or granted', async () => {
    net.exchange = 'refused';
    expect(await callback()).toEqual({status: 307, to: '/login?error=auth_failed'});
    expect(rpc('consume_preauthorization')).toEqual([]);
    expect(rpc('issue_grant')).toEqual([]);
  });

  it('logs nothing that identifies the session, the user or the token', async () => {
    net.token = () => unsignedToken({sub: USER});
    await callback();
    const printed = JSON.stringify(vi.mocked(console.error).mock.calls);
    for (const secret of [SESSION, USER, 'exchanged-refresh-token', 'google-code', 'a-pkce-code-verifier']) expect(printed).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a sign-in that comes back to a browser holding a step-up cookie (Story 1.4b), over the real client', () => {
  const SECRET = 'q'.repeat(43);
  const VERIFIER = 'a-pkce-code-verifier';
  const stepUpCookie = () => store.jar.set(stepUpCookieName, SECRET);

  it('hands the NEW session to the database, with the hash of the secret and the challenge of the verifier it read before the exchange, and goes to the class\'s path', async () => {
    stepUpCookie();
    // The receipt says `administration`, which returns to the invitation page (Story 1.11).
    expect(await callback()).toEqual({status: 307, to: '/admin/invitations'});
    const calls_ = rpc('complete_step_up').map((call) => JSON.parse(call.body));
    expect(calls_).toEqual([{p_user_id: USER, p_session_id: SESSION, p_secret_hash: hashStepUpSecret(SECRET), p_verifier_hash: challengeOfVerifier(VERIFIER)}]);
    // The database did the granting: this callback consumed nothing and issued nothing.
    expect(rpc('consume_preauthorization')).toEqual([]);
    expect(rpc('issue_grant')).toEqual([]);
    // The new session stays, nobody is signed out, and the step-up cookie is gone.
    expect(store.jar.has(cookieName)).toBe(true);
    expect(calls.some((call) => call.path === '/auth/v1/logout')).toBe(false);
    expect(store.jar.has(stepUpCookieName)).toBe(false);
  });

  it('reads the verifier whichever way the cookie adapter wrote it', async () => {
    stepUpCookie();
    store.jar.set(`${cookieName}-code-verifier`, `base64-${Buffer.from(JSON.stringify(VERIFIER)).toString('base64url')}`);
    expect(await callback()).toEqual({status: 307, to: '/admin/invitations'});
    expect(JSON.parse(rpc('complete_step_up')[0].body).p_verifier_hash).toBe(challengeOfVerifier(VERIFIER));
  });

  it('rejected (another Google account, an expired or replaced nonce, an old sign-in): ends ONLY the new session, locally, and asks for sign-in with a localized error', async () => {
    stepUpCookie();
    net.stepUp = 'rejected';
    expect(await callback()).toEqual({status: 307, to: '/login?error=step_up_failed'});
    const logout = calls.filter((call) => call.path === '/auth/v1/logout');
    expect(logout).toHaveLength(1);
    expect(logout[0].search).toContain('scope=local');
    expect(calls.some((call) => call.search.includes('scope=global'))).toBe(false);
    expect(store.jar.has(cookieName)).toBe(false);
    expect(store.jar.has(stepUpCookieName)).toBe(false);
    // No grant, no pre-authorization claim, for a sign-in the step-up rejected.
    expect(rpc('issue_grant')).toEqual([]);
    expect(rpc('consume_preauthorization')).toEqual([]);
  });

  it('the database cannot be reached: denied and retryable, only the new session ended locally, nothing fresh', async () => {
    stepUpCookie();
    net.stepUp = 'down';
    expect(await callback()).toEqual({status: 307, to: '/login?error=auth_unavailable'});
    expect(calls.find((call) => call.path === '/auth/v1/logout')?.search).toContain('scope=local');
    expect(store.jar.has(cookieName)).toBe(false);
    expect(rpc('issue_grant')).toEqual([]);
  });

  it('a cookie that names nothing: an ordinary sign-in (the grant is issued the normal way), and the stale cookie goes', async () => {
    stepUpCookie();
    net.stepUp = 'unknown';
    expect(await callback()).toEqual({status: 307, to: '/'});
    expect(rpc('complete_step_up')).toHaveLength(1);
    expect(rpc('issue_grant').map((call) => JSON.parse(call.body))).toEqual([{p_user_id: USER, p_session_id: SESSION}]);
    expect(store.jar.has(stepUpCookieName)).toBe(false);
  });

  it('a sign-in that began from another flow: ordinary, and the cookie goes (the one verifier this browser holds was that flow\'s, so this step-up cannot come back here)', async () => {
    stepUpCookie();
    net.stepUp = 'other_flow';
    expect(await callback()).toEqual({status: 307, to: '/'});
    expect(rpc('issue_grant')).toHaveLength(1);
    expect(store.jar.has(stepUpCookieName)).toBe(false);
  });

  it('an exchange that yields no usable user (a token with no session) clears the step-up cookie too, and asks the database nothing', async () => {
    stepUpCookie();
    net.token = () => unsignedToken({sub: USER, aud: 'authenticated', role: 'authenticated'});
    expect(await callback()).toEqual({status: 307, to: '/login?error=auth_unavailable'});
    expect(rpc('complete_step_up')).toEqual([]);
    expect(store.jar.has(stepUpCookieName)).toBe(false);
    expect(store.jar.has(cookieName)).toBe(false);
  });

  it('an identity Auth vouches for that is not a Google identity is turned away, and the step-up cookie goes', async () => {
    stepUpCookie();
    // Auth vouches for a user whose provider is email, not Google.
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' ? input : (input as Request).url);
      if (url.pathname === '/auth/v1/user') return json({...user(), app_metadata: {provider: 'email', providers: ['email']}});
      return stubbedFetch(input, init);
    }));
    expect(await callback()).toEqual({status: 307, to: '/login?error=not_allowed'});
    expect(rpc('complete_step_up')).toEqual([]);
    expect(store.jar.has(stepUpCookieName)).toBe(false);
  });

  it('another browser: no cookie, so the database is never asked and the sign-in is ordinary', async () => {
    expect(await callback()).toEqual({status: 307, to: '/'});
    expect(rpc('complete_step_up')).toEqual([]);
    expect(rpc('issue_grant')).toHaveLength(1);
  });

  it('a step-up cookie without a verifier fails the exchange itself (nothing to bind to), and one with a value that is not a secret is no step-up', async () => {
    stepUpCookie();
    store.jar.delete(`${cookieName}-code-verifier`);
    expect(await callback()).toEqual({status: 307, to: '/login?error=auth_failed'});
    expect(rpc('complete_step_up')).toEqual([]);

    calls = [];
    store.jar.set(`${cookieName}-code-verifier`, JSON.stringify(VERIFIER));
    store.jar.set(stepUpCookieName, 'not-a-secret');
    expect(await callback()).toEqual({status: 307, to: '/'});
    expect(rpc('complete_step_up')).toEqual([]);
  });

  it('a refused exchange never reaches the step-up, and leaves its cookie alone', async () => {
    stepUpCookie();
    net.exchange = 'refused';
    expect(await callback()).toEqual({status: 307, to: '/login?error=auth_failed'});
    expect(rpc('complete_step_up')).toEqual([]);
    expect(store.jar.has(stepUpCookieName)).toBe(true);
  });

  it('logs nothing that is the secret, its hash, the verifier or the challenge', async () => {
    stepUpCookie();
    net.stepUp = 'rejected';
    await callback();
    net.stepUp = 'down';
    stepUpCookie();
    store.jar.set(`${cookieName}-code-verifier`, JSON.stringify(VERIFIER));
    await callback();
    const printed = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(printed.length).toBeGreaterThan(2);
    for (const secret of [SECRET, hashStepUpSecret(SECRET), VERIFIER, challengeOfVerifier(VERIFIER), SESSION, USER]) expect(printed).not.toContain(secret);
  });
});
