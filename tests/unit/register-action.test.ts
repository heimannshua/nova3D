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
  authorizeSession: vi.fn(),
  issueGrant: vi.fn(),
  confirmRegistration: vi.fn(),
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
  authorizeSession: mocks.authorizeSession,
  issueGrant: mocks.issueGrant,
  confirmRegistration: mocks.confirmRegistration,
}));

import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {registerWithInvitation, switchGoogleAccount} from '@/app/register/actions';
import {sessionReader} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const COMMAND = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const CODE = '7H2K-9QXM-AB12-CD34-EF56-GH78-JK90-MN12';
const GOOGLE_URL = 'http://127.0.0.1:54321/auth/v1/authorize?provider=google&prompt=select_account&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=s256';
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

type Auth = {getUser: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn>; getSession: ReturnType<typeof vi.fn>; signInWithOAuth: ReturnType<typeof vi.fn>};
let auth: Auth;
const accountIs = (state: 'unregistered' | 'active' | 'disabled' | 'no_grant' | 'revoked' | 'expired' | 'idle' | 'stale_epoch' | 'subject_mismatch') =>
  mocks.authorizeSession.mockResolvedValue(
    state === 'active'
      ? {state, accountId: 'acc', workspaceId: null, role: 'member', epoch: 1}
      : {state, accountId: null, workspaceId: null, role: null, epoch: null},
  );

beforeEach(() => {
  auth = {
    getUser: vi.fn(async () => ({
      data: {user: {id: USER, email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z', is_anonymous: false, app_metadata: {provider: 'google', providers: ['google']}}},
      error: null,
    })),
    signOut: vi.fn(),
    getSession: vi.fn(sessionReader(USER, SESSION).getSession),
    signInWithOAuth: vi.fn(async () => ({data: {provider: 'google', url: GOOGLE_URL}, error: null})),
  };
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => ({auth}));
  mocks.endSession.mockReset();
  mocks.registerWithCode.mockReset().mockResolvedValue(receipt('registered'));
  mocks.authorizeSession.mockReset();
  mocks.issueGrant.mockReset().mockResolvedValue({outcome: 'issued', accountId: 'acc', epoch: 1});
  mocks.confirmRegistration.mockReset().mockResolvedValue(true);
  accountIs('unregistered');
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

describe('the session grant (Story 1.4a)', () => {
  it('issues the grant of the verified session once the Account exists, before it lands on Home', async () => {
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/');
    expect(mocks.issueGrant).toHaveBeenCalledTimes(1);
    expect(mocks.issueGrant.mock.calls[0].slice(0, 2)).toEqual([USER, SESSION]);
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('ignores a session or user in the form: the grant is for the session of the verified token', async () => {
    await redirected(registerWithInvitation(initial, form({sessionId: OTHER_USER, session_id: OTHER_USER, userId: OTHER_USER})));
    expect(mocks.issueGrant.mock.calls[0].slice(0, 2)).toEqual([USER, SESSION]);
  });

  it('issues a grant for a replayed registration too: the session may be a new one', async () => {
    mocks.registerWithCode.mockResolvedValue({...receipt('registered'), replayed: true});
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/');
    expect(mocks.issueGrant).toHaveBeenCalledTimes(1);
  });

  it.each(['refused', 'limited', 'disabled'])('issues no grant for a %s registration', async (outcome) => {
    mocks.registerWithCode.mockResolvedValue(receipt(outcome));
    await redirected(registerWithInvitation(initial, form()));
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it('issues no grant when no Account is created: a failed call, a signed-out visitor, an existing Account', async () => {
    mocks.registerWithCode.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await registerWithInvitation(initial, form());
    mocks.registerWithCode.mockReset();
    accountIs('active');
    await redirected(registerWithInvitation(initial, form()));
    accountIs('revoked');
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=session_ended');
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it('signs out this browser and sends the person to sign-in when the grant cannot be recorded: the Account exists, signing in again issues it', async () => {
    mocks.issueGrant.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=auth_unavailable');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.endSession.mock.calls[0][1]).toBe('local');
  });

  it('signs out everywhere when the grant is refused: a disabled Account or a changed Google identity', async () => {
    mocks.issueGrant.mockResolvedValue({outcome: 'disabled', accountId: 'acc', epoch: 1});
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=account_disabled');
    expect(mocks.endSession.mock.calls[0][1]).toBe('global');
    mocks.issueGrant.mockResolvedValue({outcome: 'subject_mismatch', accountId: 'acc', epoch: 1});
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=not_allowed');
    expect(mocks.endSession.mock.calls[1][1]).toBe('global');
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
    expect(mocks.authorizeSession).not.toHaveBeenCalled();
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
    mocks.authorizeSession.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
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

  it('signs a changed Google identity out everywhere it can, says so, and registers no one', async () => {
    accountIs('subject_mismatch');
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=not_allowed');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  });

  it('signs a disabled Account out, and registers no one', async () => {
    accountIs('disabled');
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=account_disabled');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
  });

  it('turns an Auth identity that is gone (Story 1.9: the dormant-identity purge deleted it while the registration waited) into "sign in again", ends the session and issues no grant', async () => {
    mocks.registerWithCode.mockResolvedValue(receipt('no_identity'));
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=not_signed_in');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.issueGrant).not.toHaveBeenCalled();
    expect(mocks.confirmRegistration).not.toHaveBeenCalled();
  });

  it('never reports a disabled Account as registered', async () => {
    mocks.registerWithCode.mockResolvedValue(receipt('disabled'));
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=account_disabled');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
  });
});

describe('use a different Google account (Story 1.4b)', () => {
  let order: string[];
  beforeEach(() => {
    order = [];
    mocks.headers.mockResolvedValue(new Headers({host: '127.0.0.1:4173'}));
    mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => {
      order.push('client');
      return {auth};
    });
    mocks.endSession.mockReset().mockImplementation(async () => {
      order.push('end');
    });
    auth.signInWithOAuth.mockImplementation(async () => {
      order.push('google');
      return {data: {provider: 'google', url: GOOGLE_URL}, error: null};
    });
  });

  it('ends this browser session only, and THEN starts Google with the account chooser from a fresh client: the start follows the expiry', async () => {
    expect(await redirected(switchGoogleAccount())).toBe(GOOGLE_URL);
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.endSession.mock.calls[0][1]).toBe('local');
    // The session cookies (and with them the verifier cookies) are expired before the new flow writes its own verifier.
    expect(order).toEqual(['client', 'end', 'client', 'google']);
  });

  it('asks Google for the chooser: prompt=select_account and no login_hint, returning to this application\'s own callback', async () => {
    await redirected(switchGoogleAccount());
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({provider: 'google', options: {redirectTo: 'http://127.0.0.1:4173/auth/callback', queryParams: {prompt: 'select_account'}}});
    expect(auth.signInWithOAuth.mock.calls[0][0].options.queryParams).not.toHaveProperty('login_hint');
  });

  it('uses the forwarded host and protocol behind the platform\'s proxy', async () => {
    mocks.headers.mockResolvedValue(new Headers({'x-forwarded-host': 'nova3d.example', 'x-forwarded-proto': 'https', host: 'internal:3000'}));
    await redirected(switchGoogleAccount());
    expect(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe('https://nova3d.example/auth/callback');
  });

  it('lands on sign-in, saying it is unavailable, when Google cannot be started: the session is already over, and the button there starts it the ordinary way', async () => {
    auth.signInWithOAuth.mockResolvedValue({data: null, error: {message: 'raw provider detail'}});
    expect(await redirected(switchGoogleAccount())).toBe('/login?error=auth_unavailable');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    mocks.headers.mockResolvedValue(new Headers({host: 'not a host!'}));
    expect(await redirected(switchGoogleAccount())).toBe('/login?error=auth_unavailable');
  });

  it('reads nothing from the request: it takes no argument at all', () => {
    expect(switchGoogleAccount.length).toBe(0);
  });
});

describe('a registration retried after its answer was lost: an Account, but no grant for this session', () => {
  beforeEach(() => {
    accountIs('no_grant');
    mocks.registerWithCode.mockResolvedValue({...receipt('registered'), replayed: true});
  });

  it('replays the command, has the database confirm that this command and code created the Account, and then issues the grant', async () => {
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/');
    expect(mocks.registerWithCode).toHaveBeenCalledTimes(1);
    expect(mocks.registerWithCode.mock.calls[0][0]).toMatchObject({userId: USER, commandId: COMMAND, code: CODE});
    expect(mocks.confirmRegistration).toHaveBeenCalledWith({userId: USER, commandId: COMMAND, code: CODE});
    expect(mocks.issueGrant).toHaveBeenCalledTimes(1);
    expect(mocks.issueGrant.mock.calls[0].slice(0, 2)).toEqual([USER, SESSION]);
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('gives a session that merely holds a user with an Account no grant: another command or code is not the one that registered it', async () => {
    mocks.confirmRegistration.mockResolvedValue(false);
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=session_ended');
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it('does not take a registration that is not a replay for the original: the database must still confirm it, and a fresh one never counts', async () => {
    mocks.registerWithCode.mockResolvedValue({...receipt('registered'), replayed: false});
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=session_ended');
    expect(mocks.confirmRegistration).not.toHaveBeenCalled();
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it.each(['refused', 'limited'])('turns a %s answer into an ended session: an Account already exists, so no code can help', async (outcome) => {
    mocks.registerWithCode.mockResolvedValue(receipt(outcome));
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=session_ended');
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it('signs a disabled Account out with its message', async () => {
    mocks.registerWithCode.mockResolvedValue(receipt('disabled'));
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=account_disabled');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the command and asks for a retry when the database cannot confirm, and issues nothing', async () => {
    mocks.confirmRegistration.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await registerWithInvitation(initial, form())).toEqual({commandId: COMMAND, error: 'unavailable'});
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it('signs this browser out, and says unavailable, when the grant cannot be recorded after a confirmed replay', async () => {
    mocks.issueGrant.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=auth_unavailable');
    expect(mocks.endSession.mock.calls[0][1]).toBe('local');
  });

  it.each(['revoked', 'expired', 'idle', 'stale_epoch'] as const)('is only for a session that never had a grant: a %s one is turned away without a replay', async (state) => {
    accountIs(state);
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/login?error=session_ended');
    expect(mocks.registerWithCode).not.toHaveBeenCalled();
    expect(mocks.confirmRegistration).not.toHaveBeenCalled();
  });

  it('a user without an Account never reaches the confirmation: a new registration is not a replay', async () => {
    accountIs('unregistered');
    mocks.registerWithCode.mockResolvedValue(receipt('registered'));
    expect(await redirected(registerWithInvitation(initial, form()))).toBe('/');
    expect(mocks.confirmRegistration).not.toHaveBeenCalled();
    expect(mocks.issueGrant).toHaveBeenCalledTimes(1);
  });
});
