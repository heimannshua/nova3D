import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The sign-in callback with the REAL clearCsrfCookie (tests/unit/auth-callback.test.ts fakes it) and a cookie
// store that throws: a cookie that cannot be removed must not stop a sign-in from reaching its decision and its
// grant. Only next/headers, Auth and the accounts database are faked.
const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  endSession: vi.fn(),
  expireAuthCookies: vi.fn(),
  consumePreauthorization: vi.fn(),
  issueGrant: vi.fn(),
  cookies: vi.fn(),
}));
vi.mock('next/headers', () => ({cookies: mocks.cookies}));
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: mocks.createSupabaseServerClient, endSession: mocks.endSession, expireAuthCookies: mocks.expireAuthCookies}));
vi.mock('@/lib/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounts')>()),
  consumePreauthorization: mocks.consumePreauthorization,
  issueGrant: mocks.issueGrant,
}));

import {GET} from '@/app/auth/callback/route';
import {unsignedToken} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const googleUser = {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}};

let deleted: string[];
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  deleted = [];
  const token = unsignedToken({sub: USER, session_id: SESSION});
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({
    auth: {
      exchangeCodeForSession: async () => ({data: {user: googleUser, session: {access_token: token}}, error: null}),
      getUser: async () => ({data: {user: googleUser}, error: null}),
      getSession: async () => ({data: {session: {access_token: token}}, error: null}),
    },
  }));
  mocks.endSession.mockReset();
  mocks.expireAuthCookies.mockReset();
  mocks.consumePreauthorization.mockReset().mockResolvedValue({outcome: 'active', accountId: ACCOUNT, workspaceId: null, role: 'member'});
  mocks.issueGrant.mockReset().mockResolvedValue({outcome: 'issued', accountId: ACCOUNT, epoch: 1});
  // The store the callback finds: readStepUpFlow reads it (nothing there), clearCsrfCookie deletes from it.
  mocks.cookies.mockReset().mockImplementation(async () => ({
    get: () => undefined,
    getAll: () => [],
    delete: (name: string) => {
      deleted.push(name);
    },
  }));
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const call = async () => {
  const response = await GET(new Request('http://127.0.0.1:4173/auth/callback?code=google-code'));
  return {status: response.status, to: response.headers.get('location')};
};

describe('the callback when the CSRF cookie cannot be removed', () => {
  it('removes it with the real helper when the store works', async () => {
    expect(await call()).toEqual({status: 307, to: '/'});
    expect(deleted).toEqual(['nova3d-csrf']);
    expect(mocks.issueGrant).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cookies() throws (outside a request that can write them)', () => mocks.cookies.mockImplementation(async () => { throw Object.assign(new Error('no request scope: nova3d-csrf=secret-marker'), {name: 'RequestScopeError'}); })],
    ['the store refuses the delete', () => mocks.cookies.mockImplementation(async () => ({get: () => undefined, getAll: () => [], delete: () => { throw Object.assign(new Error('read-only nova3d-csrf=secret-marker'), {name: 'ReadonlyRequestCookiesError'}); }}))],
  ])('still reaches its decision, consumes the pre-authorization and issues the grant when %s', async (_name, arrange) => {
    arrange();
    expect(await call()).toEqual({status: 307, to: '/'});
    expect(mocks.consumePreauthorization).toHaveBeenCalledTimes(1);
    expect(mocks.issueGrant).toHaveBeenCalledExactlyOnceWith(USER, SESSION, {timeoutMs: expect.any(Number)});
    expect(mocks.endSession).not.toHaveBeenCalled();
    // The failure is in the log, by the error's name only.
    const printed = JSON.stringify(errors.mock.calls);
    expect(printed).toContain('The CSRF cookie could not be removed.');
    expect(printed).not.toContain('secret-marker');
    expect(printed).not.toContain('nova3d-csrf=');
  });

  it('still signs the person out and says why when the decision is a refusal and the cookie cannot be removed', async () => {
    mocks.cookies.mockImplementation(async () => { throw new Error('boom'); });
    mocks.consumePreauthorization.mockResolvedValue({outcome: 'refused', accountId: null, workspaceId: null, role: null});
    expect(await call()).toEqual({status: 307, to: '/login?error=not_allowed'});
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });
});
