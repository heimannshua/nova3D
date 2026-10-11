import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// lib/auth.ts: what the pages ask. Fake Auth, fake accounts, and a redirect that throws where Next.js would.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const mocks = vi.hoisted(() => ({createSupabaseServerClient: vi.fn(), authorizeSession: vi.fn()}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: mocks.createSupabaseServerClient}));
vi.mock('@/lib/accounts', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/accounts')>()), authorizeSession: mocks.authorizeSession}));

import {getAccess, requireActiveAccount, requireApiAccess, requireUnregisteredIdentity} from '@/lib/auth';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
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
type Authorization = 'active' | 'unregistered' | 'disabled' | 'no_session' | 'no_grant' | 'revoked' | 'expired' | 'idle' | 'stale_epoch' | 'subject_mismatch';
const accountIs = (state: Authorization) =>
  mocks.authorizeSession.mockResolvedValue(
    state === 'active'
      ? {state, accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 1}
      : {state, accountId: null, workspaceId: null, role: null, epoch: null},
  );
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
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth: {getUser, ...sessionReader(USER, SESSION)}}));
  mocks.authorizeSession.mockReset();
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
    accountIs('unregistered');
    expect((await getAccess()).state).toBe('unregistered');
    accountIs('disabled');
    expect((await getAccess()).state).toBe('disabled');
  });

  it('is signed out without a session, and asks the database nothing', async () => {
    noSession();
    expect(await getAccess()).toEqual({state: 'signed-out'});
    expect(mocks.authorizeSession).not.toHaveBeenCalled();
  });

  it('is unavailable when the database fails, when Auth fails, and when Supabase is not configured at all', async () => {
    mocks.authorizeSession.mockRejectedValue(new Error('The accounts database did not answer.'));
    expect(await getAccess()).toEqual({state: 'unavailable'});
    accountIs('active');
    getUser.mockRejectedValue(new TypeError('fetch failed'));
    expect(await getAccess()).toEqual({state: 'unavailable'});
    getUser.mockResolvedValue({data: {user: googleUser}, error: null});
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(await getAccess()).toEqual({state: 'unavailable'});
    expect(mocks.createSupabaseServerClient).toHaveBeenCalledTimes(2);
  });

  it('asks Auth who is signed in, then authorizes that user and the session of the verified token, and trusts nothing else', async () => {
    await getAccess();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(mocks.authorizeSession.mock.calls).toEqual([[USER, SESSION, expect.anything()]]);
  });

  it.each(['no_grant', 'revoked', 'expired', 'idle', 'stale_epoch'] as const)('is a session that ended, for the reason %s', async (state) => {
    accountIs(state);
    expect(await getAccess()).toEqual({state: 'session-ended', reason: state, user: {id: USER, email: 'person@example.com', sessionId: SESSION}});
  });

  it('is signed out when the database no longer sees the Auth session', async () => {
    accountIs('no_session');
    expect(await getAccess()).toEqual({state: 'signed-out'});
  });

  it('is refused when the Google identity is not the pinned one', async () => {
    accountIs('subject_mismatch');
    expect(await getAccess()).toEqual({state: 'refused'});
  });
});

describe('requireActiveAccount (every private page)', () => {
  it('returns the active Account and does not redirect', async () => {
    expect(await requireActiveAccount()).toMatchObject({state: 'active'});
  });

  it.each([
    ['no session', () => noSession(), '/login?error=not_signed_in'],
    ['no Account', () => accountIs('unregistered'), '/register'],
    ['a disabled Account', () => accountIs('disabled'), '/login?error=account_disabled'],
    ['a database failure', () => mocks.authorizeSession.mockRejectedValue(new Error('down')), '/login?error=auth_unavailable'],
    ['a revoked grant', () => accountIs('revoked'), '/login?error=session_ended'],
    ['an expired grant', () => accountIs('expired'), '/login?error=session_ended'],
    ['an idle grant', () => accountIs('idle'), '/login?error=session_ended'],
    ['a stale epoch', () => accountIs('stale_epoch'), '/login?error=session_ended'],
    ['no grant', () => accountIs('no_grant'), '/login?error=session_ended'],
    ['an Auth session the database does not see', () => accountIs('no_session'), '/login?error=not_signed_in'],
    ['a changed Google identity', () => accountIs('subject_mismatch'), '/login?error=not_allowed'],
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
    accountIs('unregistered');
    expect(await requireUnregisteredIdentity()).toMatchObject({state: 'unregistered', user: {id: USER}});
  });

  it.each([
    ['an active Account', () => accountIs('active'), '/'],
    ['no session', () => noSession(), '/login?error=not_signed_in'],
    ['a disabled Account', () => accountIs('disabled'), '/login?error=account_disabled'],
    ['a database failure', () => mocks.authorizeSession.mockRejectedValue(new Error('down')), '/login?error=auth_unavailable'],
    ['no Supabase configuration', () => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''), '/login?error=auth_unavailable'],
  ])('redirects for %s', async (_name, arrange, target) => {
    arrange();
    expect(await redirectedTo(requireUnregisteredIdentity())).toBe(target);
  });
});

describe('requireApiAccess (every private route handler)', () => {
  const denied = async (work: ReturnType<typeof requireApiAccess>) => {
    const guard = await work;
    if (!guard.denied) throw new Error('expected a denial');
    return {status: guard.denied.status, body: await guard.denied.json(), headers: guard.denied.headers};
  };

  it('returns the active Account and no denial', async () => {
    const guard = await requireApiAccess();
    expect(guard.denied).toBeUndefined();
    expect(guard.access).toMatchObject({state: 'active', user: {id: USER}, account: {accountId: ACCOUNT}});
  });

  it.each([
    ['no session', () => noSession(), 401, 'not_signed_in'],
    ['a revoked grant', () => accountIs('revoked'), 401, 'session_ended'],
    ['no grant', () => accountIs('no_grant'), 401, 'session_ended'],
    ['no Account', () => accountIs('unregistered'), 403, 'account_required'],
    ['a disabled Account', () => accountIs('disabled'), 403, 'account_disabled'],
    ['a changed Google identity', () => accountIs('subject_mismatch'), 403, 'not_allowed'],
    ['a database failure', () => mocks.authorizeSession.mockRejectedValue(new Error('down')), 503, 'auth_unavailable'],
    ['an Auth failure', () => getUser.mockRejectedValue(new TypeError('fetch failed')), 503, 'auth_unavailable'],
  ])('answers JSON, not a redirect, for %s: %i %s', async (_name, arrange, status, error) => {
    arrange();
    const answer = await denied(requireApiAccess());
    expect(answer.status).toBe(status);
    expect(answer.body).toEqual({error, retryable: status === 503});
    expect(answer.headers.get('content-type')).toMatch(/^application\/json/);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('retry-after')).toBe(status === 503 ? '5' : null);
  });

  it('answers 503 auth_not_configured, not retryable, when Supabase is not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const answer = await denied(requireApiAccess());
    expect(answer.status).toBe(503);
    expect(answer.body).toEqual({error: 'auth_not_configured', retryable: false});
  });

  it('answers 503 when the check itself throws, and never lets the error out', async () => {
    mocks.createSupabaseServerClient.mockRejectedValue(new Error('cookies unavailable'));
    expect(await denied(requireApiAccess())).toMatchObject({status: 503, body: {error: 'auth_unavailable', retryable: true}});
  });

  it('asks afresh every time: nothing from an earlier call is honored', async () => {
    expect((await requireApiAccess()).access).toBeDefined();
    accountIs('revoked');
    expect((await denied(requireApiAccess())).status).toBe(401);
    accountIs('active');
    expect((await requireApiAccess()).access).toBeDefined();
    expect(mocks.authorizeSession).toHaveBeenCalledTimes(3);
  });
});
