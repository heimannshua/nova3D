import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The registration Server Action with fake Auth, a fake accounts database and a fake redirect.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  endSession: vi.fn(),
  registerWithCode: vi.fn(),
  accountStatus: vi.fn(),
  headers: vi.fn(),
}));
vi.mock('next/headers', () => ({headers: mocks.headers}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: mocks.createSupabaseServerClient, endSession: mocks.endSession}));
vi.mock('@/lib/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounts')>()),
  registerWithCode: mocks.registerWithCode,
  accountStatus: mocks.accountStatus,
}));

import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {registerWithInvitation, switchGoogleAccount} from '@/app/register/actions';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const COMMAND = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const CODE = '7H2K-9QXM-AB12-CD34-EF56-GH78-JK90-MN12';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const initial = {commandId: COMMAND, error: null} as const;
const form = (fields: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [name, value] of Object.entries({code: CODE, commandId: COMMAND, ...fields})) data.set(name, value);
  return data;
};
const receipt = (outcome: string) => ({commandId: COMMAND, outcome, accountId: outcome === 'registered' ? 'a' : null, workspaceId: null, role: null, replayed: false});
const redirected = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};

type Auth = {getUser: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn>};
let auth: Auth;
const accountIs = (status: 'none' | 'active' | 'disabled') =>
  mocks.accountStatus.mockResolvedValue({status, accountId: status === 'none' ? null : 'acc', workspaceId: null, role: status === 'none' ? null : 'member'});

beforeEach(() => {
  auth = {
    getUser: vi.fn(async () => ({
      data: {user: {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}}},
      error: null,
    })),
    signOut: vi.fn(),
  };
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth}));
  mocks.endSession.mockReset();
  mocks.registerWithCode.mockReset().mockResolvedValue(receipt('registered'));
  mocks.accountStatus.mockReset();
  accountIs('none');
  mocks.headers.mockReset().mockResolvedValue(new Headers());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('a valid code', () => {
  it('registers the verified session user and lands on Home', async () => {
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/');
    expect(mocks.registerWithCode).toHaveBeenCalledTimes(1);
    expect(mocks.registerWithCode.mock.calls[0][0]).toEqual({userId: USER, commandId: COMMAND, code: CODE, clientAddress: null});
  });

  it('passes the platform-reported client address on Vercel, and none elsewhere', async () => {
    vi.stubEnv('VERCEL', '1');
    mocks.headers.mockResolvedValue(new Headers({'x-forwarded-for': '203.0.113.9'}));
    await redirected(registerWithInvitation(initial, form()));
    expect(mocks.registerWithCode.mock.calls[0][0].clientAddress).toBe('203.0.113.9');
    vi.unstubAllEnvs();
    await redirected(registerWithInvitation(initial, form()));
    expect(mocks.registerWithCode.mock.calls[1][0].clientAddress).toBeNull();
  });

  it('answers a replayed receipt as a success', async () => {
    mocks.registerWithCode.mockResolvedValue({...receipt('registered'), replayed: true});
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/');
  });
});

describe('definitive failures are generic and mint a new command ID', () => {
  it.each(['refused', 'limited'])('%s: one generic message, a fresh command ID', async (outcome) => {
    mocks.registerWithCode.mockResolvedValue(receipt(outcome));
    const state = await registerWithInvitation(initial, form());
    expect(state.error).toBe('refused');
    expect(state.commandId).toMatch(uuidPattern);
    expect(state.commandId).not.toBe(COMMAND);
  });

  it('gives bad, used, revoked and limited codes exactly the same answer', async () => {
    const answers = [];
    for (const outcome of ['refused', 'limited', 'refused']) {
      mocks.registerWithCode.mockResolvedValueOnce(receipt(outcome));
      const {commandId: _fresh, ...rest} = await registerWithInvitation(initial, form());
      answers.push(rest);
    }
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
  });

  it('never returns, logs or echoes the code', async () => {
    mocks.registerWithCode.mockResolvedValue(receipt('refused'));
    const state = await registerWithInvitation(initial, form());
    expect(JSON.stringify(state)).not.toContain('7H2K');
    mocks.registerWithCode.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    const retried = await registerWithInvitation(initial, form());
    expect(JSON.stringify(retried)).not.toContain('7H2K');
    expect(JSON.stringify([...vi.mocked(console.error).mock.calls])).not.toContain('7H2K');
  });

  it('lets a blank code through to the library, which refuses it without a database call', async () => {
    mocks.registerWithCode.mockResolvedValue(receipt('refused'));
    expect((await registerWithInvitation(initial, form({code: '   '}))).error).toBe('refused');
    expect(mocks.registerWithCode.mock.calls[0][0].code).toBe('   ');
  });
});

describe('the input is bounded before any work is done', () => {
  const untouched = () => {
    expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
    expect(auth.getUser).not.toHaveBeenCalled();
    expect(mocks.accountStatus).not.toHaveBeenCalled();
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  };

  it('refuses a code longer than 256 characters, generically, with a fresh command ID, touching nothing', async () => {
    const state = await registerWithInvitation(initial, form({code: 'A'.repeat(257)}));
    expect(state.error).toBe('refused');
    expect(state.commandId).toMatch(uuidPattern);
    expect(state.commandId).not.toBe(COMMAND);
    untouched();
  });

  it('refuses a missing code and a code that is not text, touching nothing', async () => {
    const missing = new FormData();
    missing.set('commandId', COMMAND);
    expect((await registerWithInvitation(initial, missing)).error).toBe('refused');
    const file = new FormData();
    file.set('commandId', COMMAND);
    file.set('code', new File(['x'], 'code.txt'));
    expect((await registerWithInvitation(initial, file)).error).toBe('refused');
    untouched();
  });

  it('refuses a huge code without reading the rest of the request', async () => {
    expect((await registerWithInvitation(initial, form({code: 'Z'.repeat(1_000_000)}))).error).toBe('refused');
    untouched();
  });

  it('accepts a code of exactly 256 characters as far as the bound goes', async () => {
    mocks.registerWithCode.mockResolvedValue(receipt('refused'));
    await registerWithInvitation(initial, form({code: 'A'.repeat(256)}));
    expect(mocks.registerWithCode).toHaveBeenCalledTimes(1);
  });
});

describe('an unreachable database fails closed and keeps the command ID', () => {
  it.each([
    ['a network failure', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true})],
    ['an HTTP 5xx', new AccountsUnavailableError('The accounts database refused the call (HTTP 503).', {status: 503, retryable: true, outcomeUnknown: true})],
  ])('after %s: a retry message and the same command ID', async (_name, failure) => {
    mocks.registerWithCode.mockRejectedValue(failure);
    expect(await registerWithInvitation(initial, form())).toEqual({commandId: COMMAND, error: 'unavailable'});
  });

  it('uses a new command ID when the database understood and rejected the call, or never got it', async () => {
    for (const failure of [new AccountsUnavailableError('rejected', {status: 403, code: '42501'}), new AccountsConfigError('INVITATION_HASH_KEY is not set'), new TypeError('bad uuid')]) {
      mocks.registerWithCode.mockRejectedValueOnce(failure);
      const state = await registerWithInvitation(initial, form());
      expect(state.error).toBe('unavailable');
      expect(state.commandId).not.toBe(COMMAND);
    }
  });

  it('shows the retry message, keeps the ID and registers no one when the Account check cannot be made', async () => {
    mocks.accountStatus.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await registerWithInvitation(initial, form())).toEqual({commandId: COMMAND, error: 'unavailable'});
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  });

  it('does the same when Auth cannot be reached', async () => {
    auth.getUser.mockRejectedValue(new TypeError('fetch failed'));
    expect(await registerWithInvitation(initial, form())).toEqual({commandId: COMMAND, error: 'unavailable'});
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  });

  it('does the same when there is no Auth client at all', async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(null);
    expect(await registerWithInvitation(initial, form())).toEqual({commandId: COMMAND, error: 'unavailable'});
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  });
});

describe('the user is the verified session, never the form', () => {
  it('ignores a user ID, role, status, email or Account in the form', async () => {
    await redirected(registerWithInvitation(initial, form({userId: OTHER_USER, user_id: OTHER_USER, role: 'administrator', status: 'active', email: 'admin@example.com', accountId: OTHER_USER, p_user_id: OTHER_USER})));
    expect(mocks.registerWithCode.mock.calls[0][0].userId).toBe(USER);
    expect(Object.keys(mocks.registerWithCode.mock.calls[0][0]).sort()).toEqual(['clientAddress', 'code', 'commandId', 'userId']);
    expect(auth.getUser).toHaveBeenCalled();
  });

  it('mints a command ID when the form carries none, or a malformed one', async () => {
    for (const commandId of ['', 'not-a-uuid', `${COMMAND}0`]) {
      mocks.registerWithCode.mockClear();
      await redirected(registerWithInvitation(initial, form({commandId})));
      expect(mocks.registerWithCode.mock.calls[0][0].commandId, commandId).toMatch(uuidPattern);
      expect(mocks.registerWithCode.mock.calls[0][0].commandId).not.toBe(COMMAND);
    }
  });

  it('lower-cases a command ID before using it', async () => {
    await redirected(registerWithInvitation(initial, form({commandId: COMMAND.toUpperCase()})));
    expect(mocks.registerWithCode.mock.calls[0][0].commandId).toBe(COMMAND);
  });

  it('ignores the previous state the client sends back', async () => {
    await redirected(registerWithInvitation({commandId: OTHER_USER, error: 'refused'}, form()));
    expect(mocks.registerWithCode.mock.calls[0][0].commandId).toBe(COMMAND);
  });
});

describe('who may register', () => {
  it('sends a signed-out visitor to sign-in, and registers no one', async () => {
    auth.getUser.mockResolvedValue({data: {user: null}, error: Object.assign(new Error('no session'), {name: 'AuthSessionMissingError', status: 400})});
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=not_signed_in');
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  });

  it('sends an identity that already has an Account Home, without redeeming a code', async () => {
    accountIs('active');
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/');
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  });

  it('signs a disabled Account out, and registers no one', async () => {
    accountIs('disabled');
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=account_disabled');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  });

  it('never reports a disabled Account as registered', async () => {
    mocks.registerWithCode.mockResolvedValue(receipt('disabled'));
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=account_disabled');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
  });
});

describe('use a different Google account', () => {
  it('ends this browser session only and returns to sign-in', async () => {
    expect(await redirected(switchGoogleAccount())).toBe('/login');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.endSession.mock.calls[0][1]).toBe('local');
  });
});
