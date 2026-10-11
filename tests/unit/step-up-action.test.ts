import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The step-up Server Action with a fake Auth client, a fake accounts database, a fake redirect and an in-memory
// cookie store. withActiveAccount and resolveAccess are the real ones, so who may start a step-up, and what the
// action takes from the verified session instead of from the request, is what the browser would see.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const store = vi.hoisted(() => ({
  set: [] as {name: string; value: string; options: Record<string, unknown>}[],
  headers: new Map<string, string>(),
  order: [] as string[],
}));
const mocks = vi.hoisted(() => ({createSupabaseServerClient: vi.fn(), authorizeSession: vi.fn(), startStepUp: vi.fn()}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    get: () => undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      store.order.push('cookie');
      store.set.push({name, value, options});
    },
    delete: () => undefined,
  }),
  headers: async () => ({get: (name: string) => store.headers.get(name.toLowerCase()) ?? null}),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    store.order.push('redirect');
    throw new Redirected(to);
  },
}));
vi.mock('@/lib/supabase/server', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/supabase/server')>()), createSupabaseServerClient: mocks.createSupabaseServerClient}));
vi.mock('@/lib/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounts')>()),
  authorizeSession: mocks.authorizeSession,
  startStepUp: mocks.startStepUp,
}));

import {beginStepUp} from '@/app/step-up/actions';
import {hashStepUpSecret, stepUpCookieName} from '@/lib/step-up-flow';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const OTHER_SESSION = '8d2e4f6a-1b3c-4d5e-9f70-a1b2c3d4e5f6';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const GOOGLE_URL = `http://127.0.0.1:54321/auth/v1/authorize?provider=google&redirect_to=x&code_challenge=${CHALLENGE}&code_challenge_method=s256&prompt=select_account`;
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};
const idle = {outcome: 'idle'} as const;

const redirected = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};

let signInWithOAuth: ReturnType<typeof vi.fn>;
let getUser: ReturnType<typeof vi.fn>;
const authorizationIs = (state: string) =>
  mocks.authorizeSession.mockResolvedValue(
    state === 'active'
      ? {state, accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 1}
      : {state, accountId: null, workspaceId: null, role: null, epoch: null},
  );

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  store.set = [];
  store.order = [];
  store.headers = new Map([['host', '127.0.0.1:4173']]);
  getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  signInWithOAuth = vi.fn(async () => {
    store.order.push('google');
    return {data: {provider: 'google', url: GOOGLE_URL}, error: null};
  });
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signInWithOAuth, signOut: vi.fn(), ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.startStepUp.mockReset().mockImplementation(async () => {
    store.order.push('start');
    return {outcome: 'started', expiresAt: new Date(Date.now() + 600_000).toISOString()};
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('starting a step-up', () => {
  it('builds the Google chooser flow, records the nonce for the VERIFIED user and session, sets the cookie, and only then sends the browser to Google', async () => {
    expect(await redirected(beginStepUp('administration', idle))).toBe(GOOGLE_URL);
    // In this order: the flow exists, the nonce exists, the cookie is set, the browser leaves.
    expect(store.order).toEqual(['google', 'start', 'cookie', 'redirect']);

    expect(signInWithOAuth).toHaveBeenCalledWith({provider: 'google', options: {redirectTo: 'http://127.0.0.1:4173/auth/callback', queryParams: {prompt: 'select_account'}}});
    const [{queryParams}] = [signInWithOAuth.mock.calls[0][0].options];
    expect(queryParams).not.toHaveProperty('login_hint');

    expect(store.set).toHaveLength(1);
    const cookie = store.set[0];
    expect(cookie.name).toBe(stepUpCookieName);
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // httpOnly (no script reads it), sent on the top-level return from Google, gone with the nonce.
    expect(cookie.options).toEqual({httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: 600});

    expect(mocks.startStepUp).toHaveBeenCalledTimes(1);
    const [input] = mocks.startStepUp.mock.calls[0];
    // The Account's user and session are the verified ones; only the hash of the cookie's secret and the flow's challenge are stored.
    expect(input).toEqual({userId: USER, sessionId: SESSION, actionClass: 'administration', secretHash: hashStepUpSecret(cookie.value), verifierHash: CHALLENGE});
    expect(JSON.stringify(input)).not.toContain(cookie.value);
  });

  it.each(['administration', 'owner_deletion', 'account_deletion', 'close_instance'])('starts for the class %s that the page bound, and for nothing else', async (actionClass) => {
    await redirected(beginStepUp(actionClass, idle));
    expect(mocks.startStepUp.mock.calls[0][0].actionClass).toBe(actionClass);
  });

  it('takes no Account, session, class, return path or time from the request: the previous state the client sends back is ignored', async () => {
    const forged = {outcome: 'idle', userId: OTHER_USER, sessionId: OTHER_SESSION, accountId: 'x', actionClass: 'close_instance', returnTo: 'https://evil.example', at: '2000-01-01'} as never;
    await redirected(beginStepUp('administration', forged));
    expect(mocks.startStepUp.mock.calls[0][0]).toMatchObject({userId: USER, sessionId: SESSION, actionClass: 'administration'});
    expect(JSON.stringify(mocks.startStepUp.mock.calls[0][0])).not.toContain('evil.example');
    // And the sign-in Google is built for returns to this application's own callback.
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe('http://127.0.0.1:4173/auth/callback');
  });

  it('refuses a class that is not on the list, before it asks anyone anything', async () => {
    for (const bad of ['', 'admin', 'Administration', 'administration; drop', '__proto__', 'constructor']) {
      expect(await beginStepUp(bad, idle), bad).toEqual({outcome: 'unavailable'});
    }
    expect(getUser).not.toHaveBeenCalled();
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(mocks.startStepUp).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });

  it('marks the cookie secure when the request came in over https (behind the platform\'s proxy), and uses the forwarded host', async () => {
    store.headers = new Map([['x-forwarded-host', 'nova3d.example'], ['x-forwarded-proto', 'https'], ['host', 'internal:3000']]);
    await redirected(beginStepUp('administration', idle));
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe('https://nova3d.example/auth/callback');
    expect(store.set[0].options.secure).toBe(true);
  });

  it.each([[''], ['bad host!'], ['a b'], ['http://evil.example'], ['host/path'], ['a@b']])('does not start for a Host header that is not an origin (%j)', async (host) => {
    store.headers = new Map([['host', host]]);
    expect(await beginStepUp('administration', idle)).toEqual({outcome: 'unavailable'});
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(mocks.startStepUp).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });

  it('does not guess http for a host that is not a loopback address: a forwarded host without a forwarded protocol fails closed', async () => {
    for (const headers of [
      [['x-forwarded-host', 'nova3d.example']],
      [['host', 'nova3d.example']],
      [['host', 'nova3d.example:3000']],
      [['host', '10.0.0.5:3000']],
      [['x-forwarded-host', 'localhost.evil.example']],
      [['x-forwarded-host', 'nova3d.example'], ['x-forwarded-proto', 'ftp']],
      [['x-forwarded-host', 'nova3d.example'], ['x-forwarded-proto', '']],
    ] as [string, string][][]) {
      store.headers = new Map(headers);
      expect(await beginStepUp('administration', idle), JSON.stringify(headers)).toEqual({outcome: 'unavailable'});
    }
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(mocks.startStepUp).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });

  it.each([
    ['127.0.0.1:4173', 'http://127.0.0.1:4173'],
    ['localhost:3000', 'http://localhost:3000'],
    ['LOCALHOST:3000', 'http://LOCALHOST:3000'],
    ['[::1]:3000', 'http://[::1]:3000'],
    ['127.0.0.1', 'http://127.0.0.1'],
  ])('reads a missing forwarded protocol as http for the loopback host %s', async (host, origin) => {
    store.headers = new Map([['host', host]]);
    await redirected(beginStepUp('administration', idle));
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(`${origin}/auth/callback`);
    expect(store.set[0].options.secure).toBe(false);
  });

  it('takes the first value of a comma-separated forwarded protocol and host, and trusts a forwarded https for any host', async () => {
    store.headers = new Map([['x-forwarded-host', 'nova3d.example, internal:3000'], ['x-forwarded-proto', 'https, http']]);
    await redirected(beginStepUp('administration', idle));
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe('https://nova3d.example/auth/callback');
    expect(store.set[0].options.secure).toBe(true);
  });

  it('says the limit was reached, and sets no cookie and goes nowhere, when the Account has started ten in the hour', async () => {
    mocks.startStepUp.mockResolvedValue({outcome: 'limited', expiresAt: null});
    expect(await beginStepUp('administration', idle)).toEqual({outcome: 'limited'});
    expect(store.set).toEqual([]);
    expect(store.order).not.toContain('redirect');
  });

  it('sends the person Home, not to "try again", when the database no longer sees the session as an active Account\'s: the access gate decides where they belong', async () => {
    mocks.startStepUp.mockResolvedValue({outcome: 'refused', expiresAt: null});
    expect(await redirected(beginStepUp('administration', idle))).toBe('/');
    expect(store.set).toEqual([]);
    // Logged by name, with nothing in it that is a secret, a token or an ID.
    const printed = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(printed).toContain('refused');
    expect(printed).not.toMatch(/[A-Za-z0-9_-]{40}/);
    expect(printed).not.toContain(USER);
    expect(printed).not.toContain(SESSION);
  });

  it('fails closed when the database cannot be reached: retryable, no cookie, nowhere to go, nothing logged that is a secret', async () => {
    mocks.startStepUp.mockRejectedValue(new Error('The accounts database did not answer.'));
    expect(await beginStepUp('administration', idle)).toEqual({outcome: 'unavailable'});
    expect(store.set).toEqual([]);
    expect(store.order).not.toContain('redirect');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('does not start when Google cannot be started, or when the flow cannot be bound (no S256 challenge)', async () => {
    signInWithOAuth.mockResolvedValueOnce({data: null, error: {message: 'raw provider detail'}});
    expect(await beginStepUp('administration', idle)).toEqual({outcome: 'unavailable'});
    signInWithOAuth.mockResolvedValueOnce({data: {url: 'http://127.0.0.1:54321/auth/v1/authorize?code_challenge=abc&code_challenge_method=plain'}, error: null});
    expect(await beginStepUp('administration', idle)).toEqual({outcome: 'unavailable'});
    expect(mocks.startStepUp).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });

  it('is for an active Account only: anyone else goes where any private request would send them, and starts nothing', async () => {
    const cases: [string, string][] = [
      ['unregistered', '/register'],
      ['revoked', '/login?error=session_ended'],
      ['no_grant', '/login?error=session_ended'],
      ['disabled', '/login?error=account_disabled'],
      ['subject_mismatch', '/login?error=not_allowed'],
    ];
    for (const [state, to] of cases) {
      store.order = [];
      authorizationIs(state);
      expect(await redirected(beginStepUp('administration', idle)), state).toBe(to);
    }
    getUser.mockResolvedValue({data: {user: null}, error: Object.assign(new Error('no session'), {name: 'AuthSessionMissingError', status: 400})});
    authorizationIs('active');
    expect(await redirected(beginStepUp('administration', idle))).toBe('/login?error=not_signed_in');
    expect(mocks.startStepUp).not.toHaveBeenCalled();
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });

  it('is retryable, and starts nothing, when the check of who is asking cannot be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new Error('down'));
    expect(await beginStepUp('administration', idle)).toEqual({outcome: 'unavailable'});
    expect(mocks.startStepUp).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });
});
