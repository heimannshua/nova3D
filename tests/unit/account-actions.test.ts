import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The sign-out Server Actions with a fake Auth client, a fake accounts database, a fake redirect and an
// in-memory cookie store. endSession and signOutQuietly are the real ones, so what a sign-out does to the
// cookies, and what it does when Auth fails or hangs after the revocation, is what the browser would see.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const store = vi.hoisted(() => ({cookies: [] as {name: string; value: string}[], deleted: [] as string[], failDelete: undefined as undefined | ((name: string) => boolean)}));
const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  authorizeSession: vi.fn(),
  revokeSessionGrant: vi.fn(),
  revokeAccountGrants: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => store.cookies,
    delete: (name: string) => {
      if (store.failDelete?.(name)) throw Object.assign(new Error(`cannot delete ${name}=secret-marker`), {name: 'CookieStoreError'});
      store.deleted.push(name);
    },
  }),
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
  revokeSessionGrant: mocks.revokeSessionGrant,
  revokeAccountGrants: mocks.revokeAccountGrants,
}));

import {AccountsUnavailableError} from '@/lib/accounts';
import {signOut, signOutOtherSessions} from '@/app/account/actions';
import {sessionActionIdle, type SessionActionState} from '@/lib/session-actions';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const OTHER_SESSION = '8d2e4f6a-1b3c-4d5e-9f70-a1b2c3d4e5f6';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const HOSTED = 'https://abcdefgh.supabase.co';
const cookieName = 'sb-abcdefgh-auth-token';
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};

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
let authSignOut: ReturnType<typeof vi.fn>;
let order: string[];
const noSession = () => getUser.mockResolvedValue({data: {user: null}, error: Object.assign(new Error('no session'), {name: 'AuthSessionMissingError', status: 400})});
const authorizationIs = (state: string) =>
  mocks.authorizeSession.mockResolvedValue(
    state === 'active'
      ? {state, accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 1}
      : {state, accountId: null, workspaceId: null, role: null, epoch: null},
  );
const cookiesExpired = () => store.deleted.includes(cookieName);

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
  store.cookies = [{name: cookieName, value: 'x'}, {name: 'nova3d-locale', value: 'he'}];
  store.deleted = [];
  store.failDelete = undefined;
  order = [];
  getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  authSignOut = vi.fn(async (options: {scope: string}) => {
    order.push(`auth.signOut:${options.scope}`);
    return {error: null};
  });
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, signOut: authSignOut, ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
  authorizationIs('active');
  mocks.revokeSessionGrant.mockReset().mockImplementation(async () => {
    order.push('revokeSessionGrant');
    return {revoked: 1, live: 1};
  });
  mocks.revokeAccountGrants.mockReset().mockImplementation(async () => {
    order.push('revokeAccountGrants');
    return {revoked: 3, live: 2};
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sign out', () => {
  it('revokes the grant of the verified session FIRST, then ends the session on this browser, then lands on sign-in saying so', async () => {
    expect(await redirected(signOut(sessionActionIdle))).toBe('/login?notice=signed_out');
    expect(order).toEqual(['revokeSessionGrant', 'auth.signOut:local']);
    expect(mocks.revokeSessionGrant).toHaveBeenCalledWith({sessionId: SESSION, userId: USER, actor: `user:${USER}`, reason: 'sign_out'}, {timeoutMs: expect.any(Number)});
    expect(cookiesExpired()).toBe(true);
    expect(store.deleted).not.toContain('nova3d-locale');
  });

  it('removes the CSRF cookie with the session it belonged to (Story 1.4c), and only once the revocation is recorded', async () => {
    expect(await redirected(signOut(sessionActionIdle))).toBe('/login?notice=signed_out');
    expect(store.deleted).toContain('nova3d-csrf');
    store.deleted = [];
    mocks.revokeSessionGrant.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await signOut(sessionActionIdle)).toEqual({outcome: 'unavailable'});
    expect(store.deleted).not.toContain('nova3d-csrf');
  });

  it('still signs out, and says where, when the CSRF cookie cannot be removed: a cookie that stays is a token that does not match', async () => {
    store.failDelete = (name) => name === 'nova3d-csrf';
    expect(await redirected(signOut(sessionActionIdle))).toBe('/login?notice=signed_out');
    // The session was still ended, in the order that matters, and the failure is in the log by name only.
    expect(order).toEqual(['revokeSessionGrant', 'auth.signOut:local']);
    expect(cookiesExpired()).toBe(true);
    expect(store.deleted).not.toContain('nova3d-csrf');
    const printed = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(printed).toContain('The CSRF cookie could not be removed.');
    expect(printed).toContain('CookieStoreError');
    expect(printed).not.toContain('nova3d-csrf=');
    expect(printed).not.toContain('secret-marker');
  });

  it('knows no user or session but the verified ones: the state the client sends back names nothing it can use', async () => {
    // The only input a Server Action invoked by a form has is the previous state, which the client controls.
    const forged = {outcome: 'done', count: 9, userId: OTHER_USER, user_id: OTHER_USER, sessionId: OTHER_SESSION, session_id: OTHER_SESSION, accountId: ACCOUNT} as unknown as SessionActionState;
    await redirected(signOut(forged));
    expect(mocks.revokeSessionGrant).toHaveBeenCalledTimes(1);
    expect(mocks.revokeSessionGrant.mock.calls[0][0]).toEqual({sessionId: SESSION, userId: USER, actor: `user:${USER}`, reason: 'sign_out'});
    expect(mocks.authorizeSession).not.toHaveBeenCalled();
  });

  it.each([
    ['the database is unreachable', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true})],
    ['the database refuses the call', new AccountsUnavailableError('refused', {status: 403, code: '42501'})],
    ['a key is missing', new Error('SUPABASE_SERVICE_ROLE_KEY is not set')],
  ])('keeps the session and says so when %s: Auth is not asked, no cookie is expired', async (_name, failure) => {
    mocks.revokeSessionGrant.mockRejectedValue(failure);
    expect(await signOut(sessionActionIdle)).toEqual({outcome: 'unavailable'});
    expect(authSignOut).not.toHaveBeenCalled();
    expect(store.deleted).toEqual([]);
  });

  it('keeps the session and says so when Auth cannot say who is signing out, or there is no Auth client', async () => {
    getUser.mockRejectedValue(new TypeError('fetch failed'));
    expect(await signOut(sessionActionIdle)).toEqual({outcome: 'unavailable'});
    mocks.createSupabaseServerClient.mockResolvedValue(null);
    expect(await signOut(sessionActionIdle)).toEqual({outcome: 'unavailable'});
    expect(mocks.revokeSessionGrant).not.toHaveBeenCalled();
    expect(store.deleted).toEqual([]);
  });

  it('can be tried again after a failure', async () => {
    mocks.revokeSessionGrant.mockRejectedValueOnce(new Error('down'));
    expect(await signOut(sessionActionIdle)).toEqual({outcome: 'unavailable'});
    expect(await redirected(signOut({outcome: 'unavailable'}))).toBe('/login?notice=signed_out');
    expect(cookiesExpired()).toBe(true);
  });

  it('clears the cookies of a session Auth no longer knows without recording anything: there is no grant to revoke', async () => {
    noSession();
    expect(await redirected(signOut(sessionActionIdle))).toBe('/login?notice=signed_out');
    expect(mocks.revokeSessionGrant).not.toHaveBeenCalled();
    expect(cookiesExpired()).toBe(true);
  });

  it('signs out a session whose grant has already ended too: the revocation is a no-op, the session still ends', async () => {
    authorizationIs('revoked');
    mocks.revokeSessionGrant.mockResolvedValue({revoked: 0, live: 0});
    expect(await redirected(signOut(sessionActionIdle))).toBe('/login?notice=signed_out');
    expect(authSignOut).toHaveBeenCalledTimes(1);
    expect(cookiesExpired()).toBe(true);
  });

  it('ends the session even when Auth refuses the sign-out after the grant was revoked: the grant is what ended it', async () => {
    authSignOut.mockResolvedValue({error: Object.assign(new Error('boom'), {name: 'AuthApiError', status: 500})});
    expect(await redirected(signOut(sessionActionIdle))).toBe('/login?notice=signed_out');
    expect(mocks.revokeSessionGrant).toHaveBeenCalledTimes(1);
    expect(cookiesExpired()).toBe(true);
  });

  it('ends the session even when Auth throws or never answers after the grant was revoked, without waiting for ever', async () => {
    authSignOut.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await redirected(signOut(sessionActionIdle))).toBe('/login?notice=signed_out');
    expect(cookiesExpired()).toBe(true);

    store.deleted = [];
    vi.useFakeTimers();
    authSignOut.mockImplementation(() => new Promise(() => undefined));
    const pending = redirected(signOut(sessionActionIdle));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe('/login?notice=signed_out');
    expect(cookiesExpired()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares one time budget across who is asking, the revocation and ending the session', async () => {
    vi.useFakeTimers();
    // Auth takes 6 s to say who this is, leaving 2 s of the 8 s: the revocation gets those 2 s and no more.
    getUser.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({data: {user: googleUser}, error: null}), 6000)));
    mocks.revokeSessionGrant.mockImplementation(() => new Promise(() => undefined));
    const pending = signOut(sessionActionIdle);
    await vi.advanceTimersByTimeAsync(6000);
    expect(mocks.revokeSessionGrant).toHaveBeenCalledTimes(1);
    expect(mocks.revokeSessionGrant.mock.calls[0][1]).toEqual({timeoutMs: 2000});
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({outcome: 'unavailable'});
    expect(store.deleted).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs by name and message only', async () => {
    mocks.revokeSessionGrant.mockRejectedValue(Object.assign(new Error('boom'), {token: 'secret-token'}));
    await signOut(sessionActionIdle);
    const printed = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(printed).toContain('boom');
    for (const secret of ['secret-token', SESSION, USER]) expect(printed).not.toContain(secret);
  });
});

describe('sign out my other sessions', () => {
  it('revokes every other grant of the Account, spares this session, asks Auth to end the others, and says how many were in use', async () => {
    expect(await signOutOtherSessions(sessionActionIdle)).toEqual({outcome: 'done', count: 2});
    expect(order).toEqual(['revokeAccountGrants', 'auth.signOut:others']);
    expect(mocks.revokeAccountGrants).toHaveBeenCalledWith(
      {accountId: ACCOUNT, exceptSessionId: SESSION, actor: `user:${USER}`, reason: 'sign_out_others'},
      {timeoutMs: expect.any(Number)},
    );
    // This browser stays signed in.
    expect(store.deleted).toEqual([]);
  });

  it('counts only the sessions that were in use: grants that had already lapsed are cleaned up but are not "signed out"', async () => {
    mocks.revokeAccountGrants.mockResolvedValue({revoked: 4, live: 0});
    expect(await signOutOtherSessions(sessionActionIdle)).toEqual({outcome: 'done', count: 0});
  });

  it('knows no Account or session but the verified ones: the state the client sends back names nothing it can use', async () => {
    const forged = {outcome: 'idle', accountId: OTHER_USER, exceptSessionId: OTHER_SESSION, userId: OTHER_USER} as unknown as SessionActionState;
    await signOutOtherSessions(forged);
    expect(mocks.authorizeSession.mock.calls[0].slice(0, 2)).toEqual([USER, SESSION]);
    expect(mocks.revokeAccountGrants.mock.calls[0][0]).toEqual({accountId: ACCOUNT, exceptSessionId: SESSION, actor: `user:${USER}`, reason: 'sign_out_others'});
  });

  it('keeps the Auth sessions and says so when the revocation cannot be recorded', async () => {
    mocks.revokeAccountGrants.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await signOutOtherSessions(sessionActionIdle)).toEqual({outcome: 'unavailable'});
    expect(authSignOut).not.toHaveBeenCalled();
  });

  it('is done once the grants are revoked, however Auth answers: failing, throwing or never answering changes nothing', async () => {
    authSignOut.mockResolvedValueOnce({error: Object.assign(new Error('boom'), {name: 'AuthApiError', status: 500})});
    expect(await signOutOtherSessions(sessionActionIdle)).toEqual({outcome: 'done', count: 2});
    authSignOut.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await signOutOtherSessions(sessionActionIdle)).toEqual({outcome: 'done', count: 2});

    vi.useFakeTimers();
    authSignOut.mockImplementation(() => new Promise(() => undefined));
    const pending = signOutOtherSessions(sessionActionIdle);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({outcome: 'done', count: 2});
    expect(store.deleted).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says it is unavailable, and revokes nothing, when the check cannot be made', async () => {
    mocks.authorizeSession.mockRejectedValue(new Error('down'));
    expect(await signOutOtherSessions(sessionActionIdle)).toEqual({outcome: 'unavailable'});
    getUser.mockRejectedValue(new TypeError('fetch failed'));
    authorizationIs('active');
    expect(await signOutOtherSessions(sessionActionIdle)).toEqual({outcome: 'unavailable'});
    expect(mocks.revokeAccountGrants).not.toHaveBeenCalled();
  });

  it.each([
    ['no session', () => noSession(), '/login?error=not_signed_in', false],
    ['no grant', () => authorizationIs('no_grant'), '/login?error=session_ended', false],
    ['a revoked grant', () => authorizationIs('revoked'), '/login?error=session_ended', false],
    ['no Account', () => authorizationIs('unregistered'), '/register', false],
    ['a disabled Account', () => authorizationIs('disabled'), '/login?error=account_disabled', true],
    ['a changed Google identity', () => authorizationIs('subject_mismatch'), '/login?error=not_allowed', true],
  ])('is not for someone with %s: sent where any private request goes, revoking nothing', async (_name, arrange, to, signsOut) => {
    arrange();
    expect(await redirected(signOutOtherSessions(sessionActionIdle))).toBe(to);
    expect(mocks.revokeAccountGrants).not.toHaveBeenCalled();
    expect(cookiesExpired()).toBe(signsOut);
  });

  it('shares one time budget across who is asking, the authorization and the revocation: the action\'s 8 s, not 5 s for each step', async () => {
    vi.useFakeTimers();
    // Auth takes 6 s to say who this is (more than the 5 s a request on its own is given) and the database 1 s
    // to authorize: both fit in the action's 8 s, and 1 s is left for the revocation.
    getUser.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({data: {user: googleUser}, error: null}), 6000)));
    mocks.authorizeSession.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({state: 'active', accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 1}), 1000)));
    const pending = signOutOtherSessions(sessionActionIdle);
    await vi.advanceTimersByTimeAsync(7000);
    expect(mocks.revokeAccountGrants).toHaveBeenCalledTimes(1);
    expect(mocks.revokeAccountGrants.mock.calls[0][1]).toEqual({timeoutMs: 1000});
    expect(await pending).toEqual({outcome: 'done', count: 2});
  });

  it('two tabs: once one has signed out, the other tab\'s pending action is turned away and revokes nothing', async () => {
    // Tab A signs out; tab B, which only now sends its action, finds the grant revoked.
    expect(await redirected(signOut(sessionActionIdle))).toBe('/login?notice=signed_out');
    authorizationIs('revoked');
    expect(await redirected(signOutOtherSessions(sessionActionIdle))).toBe('/login?error=session_ended');
    expect(mocks.revokeAccountGrants).not.toHaveBeenCalled();
  });
});
