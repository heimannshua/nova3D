import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// lib/auth.ts: what the pages ask. Fake Auth, fake accounts, and a redirect that throws where Next.js would.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const mocks = vi.hoisted(() => ({createSupabaseServerClient: vi.fn(), accountStatus: vi.fn()}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: mocks.createSupabaseServerClient}));
vi.mock('@/lib/accounts', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/accounts')>()), accountStatus: mocks.accountStatus}));

import {getAccess, requireActiveAccount, requireUnregisteredIdentity} from '@/lib/auth';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const googleUser = {
  id: USER,
  email: 'person@example.com',
  email_confirmed_at: '2026-10-10T00:00:00Z',
  is_anonymous: false,
  app_metadata: {provider: 'google', providers: ['google']},
};

let getUser: ReturnType<typeof vi.fn>;
const noSession = () => getUser.mockResolvedValue({data: {user: null}, error: Object.assign(new Error('no session'), {name: 'AuthSessionMissingError', status: 400})});
const accountIs = (status: 'none' | 'active' | 'disabled') =>
  mocks.accountStatus.mockResolvedValue({status, accountId: status === 'none' ? null : ACCOUNT, workspaceId: null, role: status === 'none' ? null : 'member'});
const redirectedTo = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  getUser = vi.fn(async () => ({data: {user: googleUser}, error: null}));
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser}}));
  mocks.accountStatus.mockReset();
  accountIs('active');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getAccess', () => {
  it('is active for an active Account, with the Account and Workspace the database named', async () => {
    expect(await getAccess()).toMatchObject({state: 'active', user: {id: USER, email: 'person@example.com'}, account: {accountId: ACCOUNT, role: 'member'}});
  });

  it('is unregistered with no Account, and disabled with a disabled one', async () => {
    accountIs('none');
    expect((await getAccess()).state).toBe('unregistered');
    accountIs('disabled');
    expect((await getAccess()).state).toBe('disabled');
  });

  it('is signed out without a session, and asks the database nothing', async () => {
    noSession();
    expect(await getAccess()).toEqual({state: 'signed-out'});
    expect(mocks.accountStatus).not.toHaveBeenCalled();
  });

  it('is unavailable when the database fails, when Auth fails, and when Supabase is not configured at all', async () => {
    mocks.accountStatus.mockRejectedValue(new Error('The accounts database did not answer.'));
    expect(await getAccess()).toEqual({state: 'unavailable'});
    accountIs('active');
    getUser.mockRejectedValue(new TypeError('fetch failed'));
    expect(await getAccess()).toEqual({state: 'unavailable'});
    getUser.mockResolvedValue({data: {user: googleUser}, error: null});
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(await getAccess()).toEqual({state: 'unavailable'});
    expect(mocks.createSupabaseServerClient).toHaveBeenCalledTimes(2);
  });

  it('asks Auth who is signed in, and trusts nothing else', async () => {
    await getAccess();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(mocks.accountStatus.mock.calls[0][0]).toBe(USER);
  });
});

describe('requireActiveAccount (every private page)', () => {
  it('returns the active Account and does not redirect', async () => {
    expect(await requireActiveAccount()).toMatchObject({state: 'active'});
  });

  it.each([
    ['no session', () => noSession(), '/login?error=not_signed_in'],
    ['no Account', () => accountIs('none'), '/register'],
    ['a disabled Account', () => accountIs('disabled'), '/login?error=account_disabled'],
    ['a database failure', () => mocks.accountStatus.mockRejectedValue(new Error('down')), '/login?error=auth_unavailable'],
    ['an Auth failure', () => getUser.mockRejectedValue(new TypeError('fetch failed')), '/login?error=auth_unavailable'],
    ['a user that is not a Google identity', () => getUser.mockResolvedValue({data: {user: {...googleUser, app_metadata: {provider: 'email'}}}, error: null}), '/login?error=not_signed_in'],
    ['no Supabase configuration', () => vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ''), '/login?error=auth_unavailable'],
  ])('redirects for %s', async (_name, arrange, target) => {
    arrange();
    expect(await redirectedTo(requireActiveAccount())).toBe(target);
  });
});

describe('requireUnregisteredIdentity (the registration page)', () => {
  it('returns an identity with no Account', async () => {
    accountIs('none');
    expect(await requireUnregisteredIdentity()).toMatchObject({state: 'unregistered', user: {id: USER}});
  });

  it.each([
    ['an active Account', () => accountIs('active'), '/'],
    ['no session', () => noSession(), '/login?error=not_signed_in'],
    ['a disabled Account', () => accountIs('disabled'), '/login?error=account_disabled'],
    ['a database failure', () => mocks.accountStatus.mockRejectedValue(new Error('down')), '/login?error=auth_unavailable'],
    ['no Supabase configuration', () => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''), '/login?error=auth_unavailable'],
  ])('redirects for %s', async (_name, arrange, target) => {
    arrange();
    expect(await redirectedTo(requireUnregisteredIdentity())).toBe(target);
  });
});
