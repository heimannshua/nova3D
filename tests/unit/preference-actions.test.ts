import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The preference Server Action (Story 1.4d) with a fake Auth client, a fake accounts database, a fake redirect and
// an in-memory cookie and header store. withActiveAccount is the real one, so what the action does for a session that
// is not let in, and for a database that fails, is what the browser would see.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
type Cookie = {name: string; value: string; options?: Record<string, unknown>};
const store = vi.hoisted(() => ({cookies: [] as {name: string; value: string}[], set: [] as Cookie[], deleted: [] as string[], headers: {} as Record<string, string>, failSet: false}));
const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  authorizeSession: vi.fn(),
  adoptPreferences: vi.fn(),
  setAccountPreference: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => store.cookies,
    get: (name: string) => store.cookies.find((cookie) => cookie.name === name),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      if (store.failSet) throw Object.assign(new Error(`cannot set ${name}=secret-marker`), {name: 'CookieStoreError'});
      store.set.push({name, value, options});
    },
    delete: (name: string) => {
      store.deleted.push(name);
    },
  }),
  headers: async () => ({get: (name: string) => store.headers[name.toLowerCase()] ?? null}),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock('@/lib/supabase/server', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/supabase/server')>()), createSupabaseServerClient: mocks.createSupabaseServerClient}));
vi.mock('@/lib/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounts')>()),
  authorizeSession: mocks.authorizeSession,
  adoptPreferences: mocks.adoptPreferences,
  setAccountPreference: mocks.setAccountPreference,
}));

import {AccountsUnavailableError} from '@/lib/accounts';
import {savePreference} from '@/app/account/preference-actions';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const HOSTED = 'https://abcdefgh.supabase.co';
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};
const record = {locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown'};

const redirected = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};

let getUser: ReturnType<typeof vi.fn>;
const authorizationIs = (state: string, preferences: Record<string, unknown> | null = record) =>
  mocks.authorizeSession.mockResolvedValue(
    state === 'active'
      ? {state, accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 1, preferences}
      : {state, accountId: null, workspaceId: null, role: null, epoch: null, preferences: null},
  );
const printed = () => JSON.stringify(vi.mocked(console.error).mock.calls);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
  store.cookies = [{name: 'sb-abcdefgh-auth-token', value: 'x'}];
  store.set = [];
  store.deleted = [];
  store.failSet = false;
  store.headers = {origin: 'http://127.0.0.1:4173'};
  getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signOut: vi.fn(async () => ({error: null})), ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.adoptPreferences.mockReset().mockResolvedValue('created');
  mocks.setAccountPreference.mockReset().mockResolvedValue('saved');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a change made signed in is saved to the Account\'s record (I/O matrix)', () => {
  it.each([
    ['locale', 'he'],
    ['theme', 'dark'],
    ['detail', 'technical'],
    ['guidance', 'dismissed'],
  ])('saves %s = %s for the Account of the verified session, then sets the cookie copy', async (name, value) => {
    expect(await savePreference(name, value)).toEqual({outcome: 'saved'});
    expect(mocks.setAccountPreference).toHaveBeenCalledTimes(1);
    expect(mocks.setAccountPreference).toHaveBeenCalledWith({accountId: ACCOUNT, name, value}, {timeoutMs: expect.any(Number)});
    expect(store.set).toEqual([{name: `nova3d-${name}`, value, options: {path: '/', maxAge: 31_536_000, sameSite: 'lax', secure: false}}]);
    expect(store.deleted).toEqual([]);
  });

  it('"Match my device": a null language is saved as null and removes the cookie copy, so the device decides again', async () => {
    expect(await savePreference('locale', null)).toEqual({outcome: 'saved'});
    expect(mocks.setAccountPreference).toHaveBeenCalledWith({accountId: ACCOUNT, name: 'locale', value: null}, expect.anything());
    expect(store.deleted).toEqual(['nova3d-locale']);
    expect(store.set).toEqual([]);
  });

  it('writes the cookie copy only AFTER the record is saved', async () => {
    const order: string[] = [];
    mocks.setAccountPreference.mockImplementation(async () => {
      order.push('record');
      return 'saved';
    });
    const original = store.set.push.bind(store.set);
    store.set.push = (...items: Cookie[]) => {
      order.push('cookie');
      return original(...items);
    };
    await savePreference('theme', 'dark');
    expect(order).toEqual(['record', 'cookie']);
  });

  it('is Secure when the browser came in over https (the platform\'s x-forwarded-proto, else the Origin)', async () => {
    store.headers = {origin: 'http://internal', 'x-forwarded-proto': 'https'};
    await savePreference('theme', 'dark');
    expect(store.set[0].options).toMatchObject({secure: true});
    store.set = [];
    store.headers = {origin: 'https://app.example'};
    await savePreference('theme', 'dark');
    expect(store.set[0].options).toMatchObject({secure: true});
    store.set = [];
    store.headers = {origin: 'not a url'};
    await savePreference('theme', 'dark');
    expect(store.set[0].options).toMatchObject({secure: false});
    store.set = [];
    store.headers = {};
    await savePreference('theme', 'dark');
    expect(store.set[0].options).toMatchObject({secure: false});
  });

  it('still saves when the cookie copy cannot be written: the record wins, and a browser that refuses cookies loses nothing (cookies refused, signed in)', async () => {
    store.failSet = true;
    expect(await savePreference('theme', 'dark')).toEqual({outcome: 'saved'});
    expect(mocks.setAccountPreference).toHaveBeenCalledTimes(1);
    // Logged by the error's name only: what the store said may hold a cookie's value.
    expect(printed()).toContain('The preference cookie copy could not be written.');
    expect(printed()).toContain('CookieStoreError');
    expect(printed()).not.toContain('secret-marker');
  });

  it('adopts the device\'s cookies first when the Account has no record yet, so changing one setting does not drop the other three', async () => {
    authorizationIs('active', null);
    store.cookies.push({name: 'nova3d-locale', value: 'he'}, {name: 'nova3d-theme', value: 'dark'}, {name: 'nova3d-detail', value: 'expert'});
    const order: string[] = [];
    mocks.adoptPreferences.mockImplementation(async () => {
      order.push('adopt');
      return 'created';
    });
    mocks.setAccountPreference.mockImplementation(async () => {
      order.push('set');
      return 'saved';
    });
    expect(await savePreference('guidance', 'dismissed')).toEqual({outcome: 'saved'});
    expect(order).toEqual(['adopt', 'set']);
    expect(mocks.adoptPreferences).toHaveBeenCalledWith({accountId: ACCOUNT, locale: 'he', theme: 'dark', detail: 'simple', guidance: 'shown'}, {timeoutMs: expect.any(Number)});
  });

  it('adopts nothing when the Account already has a record', async () => {
    await savePreference('theme', 'dark');
    expect(mocks.adoptPreferences).not.toHaveBeenCalled();
  });

  it('saves nothing, and sets no cookie, when the adoption it needs fails', async () => {
    authorizationIs('active', null);
    mocks.adoptPreferences.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await savePreference('theme', 'dark')).toEqual({outcome: 'unavailable'});
    expect(mocks.setAccountPreference).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });
});

describe('a save that fails stores nothing and leaves the device as it was (save fails: undone, announced, nothing stored)', () => {
  it.each([
    ['the database does not answer', () => mocks.setAccountPreference.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}))],
    ['the database errors', () => mocks.setAccountPreference.mockRejectedValue(new AccountsUnavailableError('The accounts database refused the call (HTTP 500).', {status: 500, retryable: true}))],
    ['the database refuses the value', () => mocks.setAccountPreference.mockRejectedValue(new AccountsUnavailableError('refused', {status: 400, code: '22023'}))],
    ['the Account is no longer active (denied)', () => mocks.setAccountPreference.mockResolvedValue('denied')],
    ['the call hangs past the action\'s time', () => mocks.setAccountPreference.mockImplementation(() => new Promise(() => undefined))],
  ])('says unavailable, writes no cookie and logs the error\'s name and message only (no choice, key or cookie) when %s', async (_name, arrange) => {
    arrange();
    vi.useFakeTimers();
    const answer = savePreference('theme', 'dark');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await answer).toEqual({outcome: 'unavailable'});
    expect(store.set).toEqual([]);
    expect(store.deleted).toEqual([]);
    expect(printed()).toContain('A preference could not be saved');
    expect(printed()).not.toMatch(/dark|Bearer|service/);
  });
});

describe('the action takes a name and a value and nothing else: no Account, no user, no session', () => {
  it('takes only two parameters', () => {
    expect(savePreference.length).toBe(2);
  });

  it.each([
    ['an unknown name', 'font', 'big'],
    ['a name in another case', 'Theme', 'dark'],
    ['a language outside the set', 'locale', 'fr'],
    ['a theme outside the set', 'theme', 'neon'],
    ['a null theme', 'theme', null],
    ['a null detail', 'detail', null],
    ['a null guidance', 'guidance', null],
    ['a value of another preference', 'theme', 'technical'],
    ['an object', 'theme', {account: 'x'}],
    ['no name', undefined, 'dark'],
  ])('refuses %s before it asks anyone anything', async (_name, name, value) => {
    expect(await savePreference(name as never, value as never)).toEqual({outcome: 'unavailable'});
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
    expect(mocks.setAccountPreference).not.toHaveBeenCalled();
    expect(mocks.adoptPreferences).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });

  it('uses the Account of the verified session even if the client smuggles another into the call', async () => {
    const other = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
    // Extra arguments are not even read.
    await (savePreference as unknown as (...args: unknown[]) => Promise<unknown>)('theme', 'dark', other, {accountId: other});
    expect(mocks.setAccountPreference).toHaveBeenCalledWith({accountId: ACCOUNT, name: 'theme', value: 'dark'}, expect.anything());
    expect(JSON.stringify(mocks.setAccountPreference.mock.calls)).not.toContain(other);
  });

  it('asks the live authorization for itself every time: nothing is remembered between calls', async () => {
    await savePreference('theme', 'dark');
    await savePreference('theme', 'light');
    expect(mocks.authorizeSession).toHaveBeenCalledTimes(2);
  });
});

describe('a session that is not let in saves nothing', () => {
  it.each([
    ['no grant', 'no_grant', '/login?error=session_ended'],
    ['a revoked grant', 'revoked', '/login?error=session_ended'],
    ['a stale epoch', 'stale_epoch', '/login?error=session_ended'],
    ['a disabled Account', 'disabled', '/login?error=account_disabled'],
    ['a changed Google identity', 'subject_mismatch', '/login?error=not_allowed'],
    ['no Account', 'unregistered', '/register'],
  ])('sends %s where any private request is sent, and stores and sets nothing', async (_name, state, to) => {
    authorizationIs(state);
    expect(await redirected(savePreference('theme', 'dark'))).toBe(to);
    expect(mocks.setAccountPreference).not.toHaveBeenCalled();
    expect(mocks.adoptPreferences).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });

  it('says unavailable, and stores nothing, when the check itself cannot be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await savePreference('theme', 'dark')).toEqual({outcome: 'unavailable'});
    expect(mocks.setAccountPreference).not.toHaveBeenCalled();
    expect(store.set).toEqual([]);
  });

  it('says unavailable, and stores nothing, when Auth cannot vouch for the session', async () => {
    getUser.mockResolvedValue({data: {user: null}, error: Object.assign(new Error('boom'), {name: 'AuthRetryableFetchError', status: 0})});
    expect(await savePreference('theme', 'dark')).toEqual({outcome: 'unavailable'});
    expect(mocks.setAccountPreference).not.toHaveBeenCalled();
  });
});
