import {NextRequest} from 'next/server';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {proxy} from '@/proxy';
import {sessionCookieName, sessionCookieValue, signAccessToken} from '../support/session-cookie';

// The proxy end to end with a fake network: the real Supabase client reads a real-looking session cookie,
// the Auth service and the accounts database are stubbed at fetch, and the proxy's decision is read from
// the response it sends back. This is how every row of the I/O matrix is checked "with fake accounts".

const SUPABASE = 'http://127.0.0.1:54321';
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const SECRET = 'unit-test-jwt-secret-with-at-least-32-characters';
const cookieName = sessionCookieName(SUPABASE);

type Call = {method: string; path: string; search: string; headers: Record<string, string>; body: string};
type Net = {
  /** What GET /auth/v1/user does. */
  user: 'ok' | 'unauthorized' | 'revoked' | 'wrongKey' | 'error500' | 'unreachable' | 'stranger';
  /** What api.consume_preauthorization does: a receipt outcome, or a failure. */
  preauth: 'none' | 'registered' | 'active' | 'refused' | 'disabled' | 'error500' | 'unreachable';
  /** What POST /auth/v1/logout does. */
  logout: 'ok' | 'hangs' | 'unreachable';
  /** What api.account_status does: an Account state, or a failure. */
  account: {status: 'none' | 'active' | 'disabled'} | 'error500' | 'forbidden' | 'unreachable';
};

let net: Net;
let calls: Call[];
let errors: ReturnType<typeof vi.spyOn>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const userBody = (id = USER, overrides: Record<string, unknown> = {}) => ({
  id, aud: 'authenticated', role: 'authenticated', email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z',
  app_metadata: {provider: 'google', providers: ['google']}, user_metadata: {email_verified: true}, identities: [],
  created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', is_anonymous: false,
  ...overrides,
});

async function stubbedFetch(input: unknown, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  calls.push({method: init.method ?? 'GET', path: url.pathname, search: url.search, headers, body: typeof init.body === 'string' ? init.body : ''});
  if (url.pathname === '/auth/v1/user') {
    if (net.user === 'unreachable') throw new TypeError('fetch failed');
    if (net.user === 'error500') return json({code: 500, error_code: 'unexpected_failure', msg: 'internal'}, 500);
    if (net.user === 'unauthorized') return json({code: 401, error_code: 'bad_jwt', msg: 'invalid JWT'}, 401);
    if (net.user === 'revoked') return json({code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist'}, 403);
    // The API gateway rejects a wrong key before Auth ever sees the request: no Auth error code.
    if (net.user === 'wrongKey') return json({message: 'Invalid authentication credentials'}, 401);
    if (net.user === 'stranger') return json(userBody(USER, {app_metadata: {provider: 'email', providers: ['email']}}));
    return json(userBody());
  }
  if (url.pathname === '/auth/v1/logout') {
    if (net.logout === 'unreachable') throw new TypeError('fetch failed');
    if (net.logout === 'hangs') return new Promise<Response>(() => undefined);
    return new Response(null, {status: 204});
  }
  if (url.pathname === '/auth/v1/token') {
    const issuedAt = Math.floor(Date.now() / 1000);
    return json({
      access_token: signAccessToken({supabaseUrl: SUPABASE, userId: USER, email: 'person@example.com', sessionId: SESSION, jwtSecret: SECRET}),
      token_type: 'bearer', expires_in: 3600, expires_at: issuedAt + 3600, refresh_token: 'refreshed-refresh-token', user: userBody(),
    });
  }
  if (url.pathname === '/rest/v1/rpc/account_status') {
    if (net.account === 'unreachable') throw new TypeError('fetch failed');
    if (net.account === 'error500') return json({message: 'boom'}, 500);
    if (net.account === 'forbidden') return json({code: '42501', message: 'permission denied'}, 403);
    const active = net.account.status !== 'none';
    return json({status: net.account.status, account_id: active ? ACCOUNT : null, workspace_id: active ? ACCOUNT : null, role: active ? 'member' : null});
  }
  if (url.pathname === '/rest/v1/rpc/consume_preauthorization') {
    if (net.preauth === 'unreachable') throw new TypeError('fetch failed');
    if (net.preauth === 'error500') return json({message: 'boom'}, 500);
    const live = !['none', 'refused'].includes(net.preauth);
    return json({outcome: net.preauth, account_id: live ? ACCOUNT : null, workspace_id: null, role: live ? 'member' : null});
  }
  throw new Error(`unexpected request to ${url.pathname}`);
}

beforeEach(() => {
  net = {user: 'ok', account: {status: 'active'}, preauth: 'none', logout: 'ok'};
  calls = [];
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(stubbedFetch));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'false');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const session = (extra: Partial<Parameters<typeof sessionCookieValue>[0]> = {}) =>
  sessionCookieValue({supabaseUrl: SUPABASE, userId: USER, email: 'person@example.com', sessionId: SESSION, jwtSecret: SECRET, ...extra});

function run(path: string, options: {cookie?: string | null; method?: string; legacy?: boolean} = {}) {
  const cookie = options.cookie === undefined ? `${cookieName}=${session()}` : options.cookie;
  const parts = [cookie, options.legacy ? 'nova3d-interim-session=old' : null].filter(Boolean).join('; ');
  return proxy(new NextRequest(`http://127.0.0.1:4173${path}`, {method: options.method ?? 'GET', headers: parts ? {cookie: parts} : {}}));
}
const destination = (response: Response) => {
  const location = response.headers.get('location');
  if (!location) return null;
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
};
// Let through: the page renders, so there is no redirect. (How Next.js marks that internally is its business.)
const passes = (response: Response) => response.status === 200 && response.headers.get('location') === null;
const rpcs = () => calls.filter((call) => call.path.startsWith('/rest/v1/rpc/'));
const setCookies = (response: Response) => response.headers.getSetCookie();

describe('signed out', () => {
  it.each(['/', '/projects', '/progress', '/settings', '/register', '/nope'])('sends %s to sign-in, without asking the database', async (path) => {
    const response = await run(path, {cookie: null});
    expect(response.status).toBe(307);
    expect(destination(response)).toBe('/login?error=not_signed_in');
    expect(rpcs()).toEqual([]);
  });

  it('treats an Auth service that rejects the token as signed out', async () => {
    for (const user of ['unauthorized', 'revoked'] as const) {
      net.user = user;
      expect(destination(await run('/')), user).toBe('/login?error=not_signed_in');
    }
    expect(rpcs()).toEqual([]);
  });
});

describe('an active Account', () => {
  it.each(['/', '/projects', '/progress', '/settings', '/nope'])('renders %s', async (path) => {
    const response = await run(path);
    expect(passes(response)).toBe(true);
    expect(response.status).toBe(200);
  });

  it('is sent Home from /register', async () => {
    expect(destination(await run('/register'))).toBe('/');
  });

  it('asks Auth who is signed in with the cookie token, and the database about that ID only', async () => {
    await run('/projects');
    const auth = calls.find((call) => call.path === '/auth/v1/user')!;
    expect(auth.headers.authorization).toMatch(/^Bearer eyJ/);
    expect(rpcs().map((call) => [call.path, JSON.parse(call.body)])).toEqual([['/rest/v1/rpc/account_status', {p_user_id: USER}]]);
    // The accounts call is the service role's alone, and goes through the api schema.
    expect(rpcs()[0].headers.authorization).toBe('Bearer service-role-key');
    expect(rpcs()[0].headers['content-profile']).toBe('api');
  });

  it('clears the retired interim cookie, like any other private request', async () => {
    const response = await run('/', {legacy: true});
    expect(setCookies(response).some((value) => value.startsWith('nova3d-interim-session=;'))).toBe(true);
  });
});

describe('a Google identity without an Account', () => {
  beforeEach(() => {
    net.account = {status: 'none'};
  });

  it.each(['/', '/projects', '/progress', '/settings', '/nope', '/kit'])('reaches only /register: %s is redirected there', async (path) => {
    const response = await run(path);
    expect(response.status).toBe(307);
    expect(destination(response)).toBe('/register');
  });

  it('reaches /register', async () => {
    expect(passes(await run('/register'))).toBe(true);
  });

  it('is sent to /register with a 303 when it posts to a private path, so a Server Action body is never replayed', async () => {
    const response = await run('/settings', {method: 'POST'});
    expect(response.status).toBe(303);
    expect(destination(response)).toBe('/register');
  });
});

describe('a disabled Account', () => {
  beforeEach(() => {
    net.account = {status: 'disabled'};
  });

  it.each(['/', '/projects', '/register', '/nope'])('is signed out at %s and sent to sign-in with account_disabled', async (path) => {
    const response = await run(path);
    expect(response.status).toBe(307);
    expect(destination(response)).toBe('/login?error=account_disabled');
    expect(passes(response)).toBe(false);
  });

  it('does not sign out on a refused Server Action (a form left open): the redirect only, so the next page request can say why', async () => {
    const response = await run('/register', {method: 'POST'});
    expect(response.status).toBe(303);
    expect(destination(response)).toBe('/login?error=account_disabled');
    expect(calls.some((call) => call.path === '/auth/v1/logout')).toBe(false);
    expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=;`))).toBe(false);
    // The browser's next request, a page request, is the one that signs out.
    const next = await run('/register');
    expect(destination(next)).toBe('/login?error=account_disabled');
    expect(calls.some((call) => call.path === '/auth/v1/logout')).toBe(true);
    expect(setCookies(next).some((value) => value.startsWith(`${cookieName}=;`))).toBe(true);
  });

  it('ends every session at Auth and expires the session cookie', async () => {
    const response = await run('/');
    const logout = calls.find((call) => call.path === '/auth/v1/logout');
    expect(logout?.search).toContain('scope=global');
    const expired = setCookies(response).filter((value) => value.startsWith(`${cookieName}=`));
    expect(expired.length).toBeGreaterThan(0);
    for (const value of expired) expect(value).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it('expires the cookie even when Auth cannot be reached to end the session', async () => {
    const real = stubbedFetch;
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      if (new URL(typeof input === 'string' ? input : (input as Request).url).pathname === '/auth/v1/logout') throw new TypeError('fetch failed');
      return real(input, init);
    }));
    const response = await run('/');
    expect(destination(response)).toBe('/login?error=account_disabled');
    expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=;`))).toBe(true);
  });

  it('expires every chunk of a long session cookie, and nothing else', async () => {
    const response = await run('/', {cookie: `${cookieName}=${session()}; ${cookieName}.1=x; other=1; sb-127-other-token=2`});
    const names = setCookies(response).map((value) => value.split('=')[0]);
    expect(names).toContain(cookieName);
    expect(names).toContain(`${cookieName}.1`);
    expect(names).not.toContain('other');
    expect(names).not.toContain('sb-127-other-token');
  });
});

describe('a failure while deciding denies access (fail closed)', () => {
  const cases: [string, Partial<Net>][] = [
    ['the accounts database is unreachable', {account: 'unreachable'}],
    ['the accounts database answers 500', {account: 'error500'}],
    ['the accounts database refuses the call', {account: 'forbidden'}],
    ['Auth is unreachable', {user: 'unreachable'}],
    ['Auth answers 500', {user: 'error500'}],
  ];

  it.each(cases)('%s: private paths go to sign-in with auth_unavailable', async (_name, change) => {
    Object.assign(net, change);
    for (const path of ['/', '/projects', '/register', '/nope']) {
      const response = await run(path);
      expect(response.status, path).toBe(307);
      expect(destination(response), path).toBe('/login?error=auth_unavailable');
      expect(passes(response), path).toBe(false);
    }
  });

  it('does not sign the person out for an outage, so they can come back when it clears', async () => {
    net.account = 'unreachable';
    const response = await run('/');
    expect(calls.some((call) => call.path === '/auth/v1/logout')).toBe(false);
    expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=;`))).toBe(false);
  });

  it('logs the failure by name and never prints a token, a key or the cookie', async () => {
    net.account = 'error500';
    await run('/');
    const printed = JSON.stringify(errors.mock.calls);
    expect(printed).toContain('Account check failed closed');
    for (const secret of ['service-role-key', 'anon-key', 'eyJ', 'base64-', SECRET]) expect(printed).not.toContain(secret);
  });

  it('denies when the proxy itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('boom'); }));
    const response = await run('/');
    expect(destination(response)).toBe('/login?error=auth_unavailable');
  });

  it('keeps the existing answer for an environment with no Supabase configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(destination(await run('/'))).toBe('/login?error=auth_not_configured');
    expect(calls).toEqual([]);
  });
});

describe('public paths are not gated', () => {
  it.each(['/login', '/auth/callback', '/api/health'])('lets %s through without asking anyone', async (path) => {
    const response = await run(path, {cookie: null});
    expect(passes(response)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('never makes /register public, with or without synthetic data', async () => {
    for (const synthetic of ['true', 'false']) {
      vi.stubEnv('SYNTHETIC_DATA_ENABLED', synthetic);
      expect(destination(await run('/register', {cookie: null})), synthetic).toBe('/login?error=not_signed_in');
    }
  });
});

describe('a session that Auth refreshes while it is checked', () => {
  const expired = () => session({issuedAt: Math.floor(Date.now() / 1000) - 7200});

  it('hands the new session to the page that renders next, and to the browser', async () => {
    const response = await run('/projects', {cookie: `${cookieName}=${expired()}`});
    expect(calls.some((call) => call.path === '/auth/v1/token')).toBe(true);
    expect(passes(response)).toBe(true);
    expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=`))).toBe(true);
    // The browser is handed the refreshed session, and what it is handed is the new refresh token.
    const written = setCookies(response).find((value) => value.startsWith(`${cookieName}=base64-`));
    const session = JSON.parse(Buffer.from(/=base64-([^;]+)/.exec(written ?? '')?.[1] ?? '', 'base64url').toString());
    expect(session.refresh_token).toBe('refreshed-refresh-token');
    expect(response.headers.get('cache-control')).toMatch(/no-store|no-cache/);
  });

  it('keeps the new session on a redirect too, or the next request would present a used refresh token', async () => {
    net.account = {status: 'none'};
    const response = await run('/projects', {cookie: `${cookieName}=${expired()}`});
    expect(destination(response)).toBe('/register');
    expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=`) && !value.startsWith(`${cookieName}=;`))).toBe(true);
    expect(response.headers.get('cache-control')).toMatch(/no-store|no-cache/);
  });
});

describe('Auth answers that are not "no session" fail closed', () => {
  it('treats a wrong API key as an outage with a log line, not as signed out', async () => {
    net.user = 'wrongKey';
    const response = await run('/');
    expect(destination(response)).toBe('/login?error=auth_unavailable');
    expect(JSON.stringify(errors.mock.calls)).toContain('Sign-in check failed closed');
    expect(rpcs()).toEqual([]);
  });

  it('turns away a user that is not a Google identity, without asking the database about it', async () => {
    net.user = 'stranger';
    const response = await run('/');
    expect(destination(response)).toBe('/login?error=not_signed_in');
    expect(rpcs()).toEqual([]);
    expect(JSON.stringify(errors.mock.calls)).toContain('not a Google identity');
  });
});

describe('an identity that signed in before its address was pre-authorized (the cutover case)', () => {
  beforeEach(() => {
    net.account = {status: 'none'};
  });
  const consumed = () => rpcs().filter((call) => call.path.endsWith('/consume_preauthorization'));

  it('keeps seeing the registration screen while nothing is pre-authorized, and asks only when it opens /register', async () => {
    expect(passes(await run('/register'))).toBe(true);
    expect(consumed()).toHaveLength(1);
    expect(JSON.parse(consumed()[0].body)).toEqual({p_user_id: USER});
    expect(consumed()[0].headers.authorization).toBe('Bearer service-role-key');
    // Other paths just redirect there; they do not spend a database write.
    calls.length = 0;
    expect(destination(await run('/projects'))).toBe('/register');
    expect(consumed()).toEqual([]);
  });

  it('becomes an Account on its next visit once the address has been seeded, with the same session', async () => {
    expect(passes(await run('/register'))).toBe(true);
    // Josh seeds the address afterwards. The browser still holds the session it signed in with.
    net.preauth = 'registered';
    const response = await run('/register');
    expect(response.status).toBe(307);
    expect(destination(response)).toBe('/');
    expect(calls.some((call) => call.path === '/auth/v1/logout')).toBe(false);
    // And from then on the gate sees the Account.
    net.account = {status: 'active'};
    expect(passes(await run('/projects'))).toBe(true);
  });

  it('sends an already-activated receipt Home too', async () => {
    net.preauth = 'active';
    expect(destination(await run('/register'))).toBe('/');
  });

  it('signs out everywhere and refuses an address that belongs to another Google subject', async () => {
    net.preauth = 'refused';
    const response = await run('/register');
    expect(destination(response)).toBe('/login?error=not_allowed');
    expect(calls.find((call) => call.path === '/auth/v1/logout')?.search).toContain('scope=global');
    expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=;`))).toBe(true);
  });

  it('signs out everywhere a disabled Account', async () => {
    net.preauth = 'disabled';
    const response = await run('/register');
    expect(destination(response)).toBe('/login?error=account_disabled');
    expect(calls.find((call) => call.path === '/auth/v1/logout')?.search).toContain('scope=global');
  });

  it.each(['unreachable', 'error500'] as const)('fails closed on %s, signing out this browser only', async (failure) => {
    net.preauth = failure;
    const response = await run('/register');
    expect(destination(response)).toBe('/login?error=auth_unavailable');
    expect(calls.find((call) => call.path === '/auth/v1/logout')?.search).toContain('scope=local');
    expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=;`))).toBe(true);
  });

  it('does not consume anything for a post (the registration action), an active Account or a signed-out visitor', async () => {
    net.preauth = 'registered';
    expect(passes(await run('/register', {method: 'POST'}))).toBe(true);
    net.account = {status: 'active'};
    expect(destination(await run('/register'))).toBe('/');
    expect(consumed()).toEqual([]);
    expect(destination(await run('/register', {cookie: null}))).toBe('/login?error=not_signed_in');
    expect(consumed()).toEqual([]);
  });
});

describe('every sign-out is bounded by a deadline and by the cookies', () => {
  it.each(['hangs', 'unreachable'] as const)('ends a disabled Account in the redirect and an expired cookie when the logout %s', async (logout) => {
    net.account = {status: 'disabled'};
    net.logout = logout;
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
    try {
      const pending = run('/');
      await vi.advanceTimersByTimeAsync(6000);
      const response = await pending;
      expect(destination(response)).toBe('/login?error=account_disabled');
      expect(setCookies(response).some((value) => value.startsWith(`${cookieName}=;`))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves other projects\' cookies alone when it expires the session', async () => {
    net.account = {status: 'disabled'};
    const response = await run('/', {cookie: `${cookieName}=${session()}; sb-other-auth-token=keep; sb-other-auth-token.0=keep`});
    const names = setCookies(response).map((value) => value.split('=')[0]);
    expect(names).toContain(cookieName);
    expect(names).not.toContain('sb-other-auth-token');
    expect(names).not.toContain('sb-other-auth-token.0');
  });
});
