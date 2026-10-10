import {describe, expect, it, vi} from 'vitest';
import type {AccountState, ActivationReceipt} from '@/lib/accounts';
import {claimPreauthorization, decideAccess, decideSignIn, isOutageError, readUser, redirectFor, resolveAccess, type Access, type AuthReader, type UserRead} from '@/lib/access';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const WORKSPACE = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

const quiet = () => undefined;
/** The user Auth reports for a confirmed, non-anonymous Google sign-in. */
const googleUser = (overrides: Record<string, unknown> = {}) => ({
  id: USER,
  email: 'Person@Example.com',
  email_confirmed_at: '2026-10-10T00:00:00Z',
  is_anonymous: false,
  app_metadata: {provider: 'google', providers: ['google']},
  ...overrides,
});
const signedIn = (user: unknown = googleUser()): AuthReader => ({auth: {getUser: async () => ({data: {user}, error: null})}});
const failing = (error: unknown, user: unknown = null): AuthReader => ({auth: {getUser: async () => ({data: {user}, error})}});
const authError = (name: string, status?: number, code?: string) => Object.assign(new Error(`${name} happened`), {name, status, code});
const state = (status: AccountState['status'], extra: Partial<AccountState> = {}): AccountState =>
  status === 'none'
    ? {status, accountId: null, workspaceId: null, role: null}
    : {status, accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member', ...extra};

describe('readUser: who is signed in, according to Auth', () => {
  it('returns the verified user, with a lower-case ID and the email Auth reports', async () => {
    expect(await readUser(signedIn(googleUser({id: USER.toUpperCase()})))).toEqual({kind: 'user', user: {id: USER, email: 'Person@Example.com'}});
  });

  it.each([
    ['a missing cookie or session (AuthSessionMissingError)', authError('AuthSessionMissingError', 400)],
    ['session_not_found', authError('AuthApiError', 403, 'session_not_found')],
    ['bad_jwt', authError('AuthApiError', 401, 'bad_jwt')],
    ['refresh_token_not_found', authError('AuthApiError', 400, 'refresh_token_not_found')],
    ['refresh_token_already_used', authError('AuthApiError', 400, 'refresh_token_already_used')],
  ])('is signed out for %s, and says nothing in the log', async (_name, error) => {
    const log = vi.fn();
    expect(await readUser(failing(error), {log})).toEqual({kind: 'signed-out'});
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', authError('AuthRetryableFetchError', 0)],
    ['a 500 from Auth', authError('AuthApiError', 500)],
    ['a 503 from Auth', authError('AuthApiError', 503)],
    ['a rate limit', authError('AuthApiError', 429)],
    ['a request timeout', authError('AuthApiError', 408)],
    ['a wrong API key (401 from the gateway, no error code)', authError('AuthApiError', 401)],
    ['a 403 that is not about the session', authError('AuthApiError', 403, 'user_banned')],
    ['an unknown 400', authError('AuthApiError', 400, 'validation_failed')],
    ['an old-style invalid token error', authError('AuthInvalidJwtError', 401)],
    ['an error nobody recognises', new Error('boom')],
    ['a bare string', 'boom'],
  ])('fails closed for %s: the check could not be made, which is not the same as signed out', async (_name, error) => {
    const log = vi.fn();
    expect(await readUser(failing(error), {log})).toEqual({kind: 'unavailable'});
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('lets an error win over a user in the same answer', async () => {
    expect(await readUser(failing(authError('AuthApiError', 500), googleUser()), {log: quiet})).toEqual({kind: 'unavailable'});
    expect(await readUser(failing(authError('AuthSessionMissingError', 400), googleUser()), {log: quiet})).toEqual({kind: 'signed-out'});
  });

  it('is signed out when Auth answers with neither a user nor an error', async () => {
    expect(await readUser(signedIn(null))).toEqual({kind: 'signed-out'});
    expect(await readUser({auth: {getUser: async () => ({data: undefined as never, error: null})}})).toEqual({kind: 'signed-out'});
  });

  it('fails closed when there is no client, when getUser throws, and when the user has no usable ID', async () => {
    expect(await readUser(null, {log: quiet})).toEqual({kind: 'unavailable'});
    expect(await readUser({auth: {getUser: async () => { throw new TypeError('fetch failed'); }}}, {log: quiet})).toEqual({kind: 'unavailable'});
    for (const id of ['not-a-uuid', 7, undefined, `${USER}x`]) {
      expect(await readUser(signedIn(googleUser({id})), {log: quiet}), String(id)).toEqual({kind: 'unavailable'});
    }
  });

  it.each([
    ['an email sign-in', {app_metadata: {provider: 'email', providers: ['email']}}, 'not a Google identity'],
    ['a phone sign-in', {app_metadata: {provider: 'phone', providers: ['phone']}}, 'not a Google identity'],
    ['no provider at all', {app_metadata: {}}, 'not a Google identity'],
    ['no app metadata', {app_metadata: null}, 'not a Google identity'],
    ['an anonymous user', {is_anonymous: true}, 'anonymous'],
    ['an unconfirmed email', {email_confirmed_at: null, confirmed_at: null}, 'not confirmed'],
    ['no email', {email: null}, 'no email'],
    ['a blank email', {email: '  '}, 'no email'],
  ])('lets %s through to nothing: ineligible, with a one-line reason and no personal data', async (_name, overrides, reason) => {
    const log = vi.fn();
    expect(await readUser(signedIn(googleUser(overrides)), {log})).toEqual({kind: 'ineligible'});
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toContain(reason);
    expect(JSON.stringify(log.mock.calls)).not.toContain('Person@Example.com');
    expect(JSON.stringify(log.mock.calls)).not.toContain(USER);
  });

  it('accepts a Google identity listed only under providers, and one confirmed under confirmed_at', async () => {
    expect((await readUser(signedIn(googleUser({app_metadata: {providers: ['email', 'google']}})))).kind).toBe('user');
    expect((await readUser(signedIn(googleUser({email_confirmed_at: undefined, confirmed_at: '2026-10-10T00:00:00Z'})))).kind).toBe('user');
  });

  it('fails closed when Auth does not answer in time, and stops waiting', async () => {
    vi.useFakeTimers();
    try {
      const hung: AuthReader = {auth: {getUser: () => new Promise(() => undefined)}};
      const log = vi.fn();
      const pending = readUser(hung, {timeoutMs: 1000, log});
      await vi.advanceTimersByTimeAsync(999);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({kind: 'unavailable'});
      expect(log).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('1000 ms'));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a name and a message only', async () => {
    const log = vi.fn();
    await readUser(failing(Object.assign(new Error('GoTrue said no'), {name: 'AuthApiError', status: 500, token: 'secret-token', cookie: 'secret-cookie'})), {log});
    expect(JSON.stringify(log.mock.calls)).toContain('AuthApiError: GoTrue said no');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
});

describe('isOutageError: the service could not be reached, as opposed to refusing a request', () => {
  it.each([
    [authError('AuthRetryableFetchError', 0), true],
    [authError('AuthApiError', 500), true],
    [authError('AuthApiError', 503), true],
    [authError('AuthApiError', 429), true],
    [authError('AuthApiError', 408), true],
    [authError('AuthApiError', 400), false],
    [authError('AuthApiError', 401), false],
    [new Error('invalid grant'), false],
    [null, false],
    ['text', false],
  ])('%j is %s', (error, outage) => {
    expect(isOutageError(error)).toBe(outage);
  });
});

describe('resolveAccess: the Account state of the verified session', () => {
  const lookupOf = (answer: AccountState | Error) => vi.fn(async (_userId: string) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });

  it('is active with an active Account, carrying the Account, Workspace and role', async () => {
    const lookup = lookupOf(state('active', {role: 'administrator'}));
    expect(await resolveAccess(signedIn(), {lookup})).toEqual({
      state: 'active',
      user: {id: USER, email: 'Person@Example.com'},
      account: {accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'administrator'},
    });
    expect(lookup).toHaveBeenCalledWith(USER);
  });

  it('is unregistered with no Account, and disabled with a disabled one', async () => {
    expect(await resolveAccess(signedIn(), {lookup: lookupOf(state('none'))})).toEqual({state: 'unregistered', user: {id: USER, email: 'Person@Example.com'}});
    expect(await resolveAccess(signedIn(), {lookup: lookupOf(state('disabled'))})).toEqual({state: 'disabled', user: {id: USER, email: 'Person@Example.com'}});
  });

  it('asks about the ID Auth reported and nothing else', async () => {
    const lookup = lookupOf(state('none'));
    await resolveAccess(signedIn(googleUser({email: 'x@example.com', app_metadata: {provider: 'google', user_id: ACCOUNT}, user_metadata: {id: ACCOUNT, role: 'administrator'}})), {lookup});
    expect(lookup.mock.calls).toEqual([[USER]]);
  });

  it('is signed out, without touching the database, when there is no session', async () => {
    const lookup = lookupOf(state('active'));
    expect(await resolveAccess(failing(authError('AuthSessionMissingError', 400)), {lookup})).toEqual({state: 'signed-out'});
    expect(lookup).not.toHaveBeenCalled();
  });

  it('is signed out, without touching the database, for a user that is not a confirmed Google identity', async () => {
    const lookup = lookupOf(state('active'));
    expect(await resolveAccess(signedIn(googleUser({app_metadata: {provider: 'email'}})), {lookup, log: quiet})).toEqual({state: 'signed-out'});
    expect(lookup).not.toHaveBeenCalled();
  });

  it('is unavailable, without touching the database, when Auth cannot answer', async () => {
    const lookup = lookupOf(state('active'));
    expect(await resolveAccess(failing(authError('AuthRetryableFetchError', 0)), {lookup, log: quiet})).toEqual({state: 'unavailable'});
    expect(await resolveAccess(null, {lookup, log: quiet})).toEqual({state: 'unavailable'});
    expect(lookup).not.toHaveBeenCalled();
  });

  it('fails closed on a database error, whatever it is', async () => {
    const log = vi.fn();
    for (const failure of [new Error('The accounts database did not answer.'), new TypeError('fetch failed'), Object.assign(new Error('permission denied'), {code: '42501'})]) {
      expect(await resolveAccess(signedIn(), {lookup: lookupOf(failure), log})).toEqual({state: 'unavailable'});
    }
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the database does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      const pending = resolveAccess(signedIn(), {lookup: () => new Promise(() => undefined), timeoutMs: 500, log: quiet});
      await vi.advanceTimersByTimeAsync(500);
      expect(await pending).toEqual({state: 'unavailable'});
    } finally {
      vi.useRealTimers();
    }
  });

  it('never calls an Account active unless the database names it, its role included', async () => {
    const malformed: AccountState[] = [
      state('active', {accountId: null}),
      state('active', {role: null}),
      {status: 'frozen' as never, accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member'},
      {status: undefined as never, accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member'},
    ];
    for (const answer of malformed) {
      expect(await resolveAccess(signedIn(), {lookup: lookupOf(answer), log: quiet}), JSON.stringify(answer)).toEqual({state: 'unavailable'});
    }
  });

  it('accepts an active Account that has no Workspace row yet only with a null Workspace, never as a pass for anyone else', async () => {
    const result = await resolveAccess(signedIn(), {lookup: lookupOf(state('active', {workspaceId: null}))});
    expect(result).toMatchObject({state: 'active', account: {workspaceId: null}});
  });
});

describe('decideAccess: the I/O matrix for a private path', () => {
  const user = {id: USER, email: 'person@example.com'};
  const states: Record<string, Access> = {
    signedOut: {state: 'signed-out'},
    unregistered: {state: 'unregistered', user},
    active: {state: 'active', user, account: {accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member'}},
    disabled: {state: 'disabled', user},
    unavailable: {state: 'unavailable'},
  };
  const paths = ['/', '/projects', '/progress', '/settings', '/projects/42', '/kit', '/nope', '/register/extra', '/Register', '/login/x'];

  it.each(paths)('signed out: %s goes to sign-in with not_signed_in', (path) => {
    expect(decideAccess(path, states.signedOut)).toEqual({action: 'redirect', to: '/login?error=not_signed_in', signOut: false});
  });

  it('signed out: /register is private too', () => {
    expect(decideAccess('/register', states.signedOut)).toEqual({action: 'redirect', to: '/login?error=not_signed_in', signOut: false});
  });

  it.each(paths)('active Account: %s renders', (path) => {
    expect(decideAccess(path, states.active)).toEqual({action: 'allow'});
  });

  it('active Account: /register goes Home', () => {
    expect(decideAccess('/register', states.active)).toEqual({action: 'redirect', to: '/', signOut: false});
  });

  it.each(paths)('no Account: %s goes to /register', (path) => {
    expect(decideAccess(path, states.unregistered)).toEqual({action: 'redirect', to: '/register', signOut: false});
  });

  it('no Account: /register is the one thing it may reach', () => {
    expect(decideAccess('/register', states.unregistered)).toEqual({action: 'allow'});
  });

  it.each([...paths, '/register'])('disabled Account: %s signs out and says why', (path) => {
    expect(decideAccess(path, states.disabled)).toEqual({action: 'redirect', to: '/login?error=account_disabled', signOut: true, scope: 'global'});
  });

  it.each([...paths, '/register'])('check failed: %s is denied with auth_unavailable', (path) => {
    expect(decideAccess(path, states.unavailable)).toEqual({action: 'redirect', to: '/login?error=auth_unavailable', signOut: false});
  });

  it('allows exactly two combinations and nothing else', () => {
    const allowed: string[] = [];
    for (const [name, access] of Object.entries(states)) {
      for (const path of [...paths, '/register']) if (decideAccess(path, access).action === 'allow') allowed.push(`${name} ${path === '/register' ? '/register' : 'any other path'}`);
    }
    expect([...new Set(allowed)].sort()).toEqual(['active any other path', 'unregistered /register']);
  });

  it('denies a state it does not know', () => {
    expect(decideAccess('/', {state: 'something-new'} as never)).toEqual({action: 'redirect', to: '/login?error=auth_unavailable', signOut: false});
  });

  it('tells a page where to send the visitor, or that it may render', () => {
    expect(redirectFor('/', states.active)).toBeNull();
    expect(redirectFor('/', states.unregistered)).toBe('/register');
    expect(redirectFor('/register', states.unregistered)).toBeNull();
    expect(redirectFor('/register', states.active)).toBe('/');
    expect(redirectFor('/', states.disabled)).toBe('/login?error=account_disabled');
    expect(redirectFor('/', states.signedOut)).toBe('/login?error=not_signed_in');
    expect(redirectFor('/', states.unavailable)).toBe('/login?error=auth_unavailable');
  });
});

describe('decideSignIn: what the callback does with the user and the pre-authorization receipt', () => {
  const user: UserRead = {kind: 'user', user: {id: USER, email: 'person@example.com'}};
  const receipt = (outcome: ActivationReceipt['outcome']): ActivationReceipt => ({outcome, accountId: outcome === 'none' || outcome === 'refused' ? null : ACCOUNT, workspaceId: null, role: null});
  const everywhere = (to: string) => ({to, signOut: true, scope: 'global'});
  const thisBrowser = (to: string) => ({to, signOut: true, scope: 'local'});

  it.each([
    ['registered', {to: '/', signOut: false}],
    ['active', {to: '/', signOut: false}],
    ['none', {to: '/register', signOut: false}],
    ['disabled', everywhere('/login?error=account_disabled')],
    ['refused', everywhere('/login?error=not_allowed')],
  ] as const)('a %s receipt: %j', (outcome, decision) => {
    expect(decideSignIn(user, receipt(outcome))).toEqual(decision);
  });

  it('signs out everywhere and refuses when the receipt is unreadable', () => {
    expect(decideSignIn(user, receipt('allowed' as never))).toEqual(everywhere('/login?error=not_allowed'));
    expect(decideSignIn(user, {outcome: undefined as never, accountId: null, workspaceId: null, role: null})).toEqual(everywhere('/login?error=not_allowed'));
  });

  it('signs out on this browser only, and says unavailable, when the pre-authorization call failed: an outage is not a verdict on the person', () => {
    expect(decideSignIn(user, null)).toEqual(thisBrowser('/login?error=auth_unavailable'));
  });

  it('does the same when Auth could not name the user it just signed in', () => {
    expect(decideSignIn({kind: 'unavailable'}, receipt('registered'))).toEqual(thisBrowser('/login?error=auth_unavailable'));
    expect(decideSignIn({kind: 'unavailable'}, null)).toEqual(thisBrowser('/login?error=auth_unavailable'));
  });

  it('signs out everywhere an identity that is not a confirmed Google identity', () => {
    expect(decideSignIn({kind: 'ineligible'}, receipt('registered'))).toEqual(everywhere('/login?error=not_allowed'));
    expect(decideSignIn({kind: 'ineligible'}, null)).toEqual(everywhere('/login?error=not_allowed'));
  });

  it('reports a sign-in that left no session as a failed sign-in, never as success', () => {
    expect(decideSignIn({kind: 'signed-out'}, receipt('registered'))).toEqual({to: '/login?error=auth_failed', signOut: false});
    expect(decideSignIn({kind: 'signed-out'}, null)).toEqual({to: '/login?error=auth_failed', signOut: false});
  });

  it('sends nobody Home unless the Account is live', () => {
    const outcomes: ActivationReceipt['outcome'][] = ['registered', 'active', 'disabled', 'none', 'refused'];
    const home = outcomes.filter((outcome) => decideSignIn(user, receipt(outcome)).to === '/');
    expect(home).toEqual(['registered', 'active']);
  });
});

describe('claimPreauthorization: consuming the pre-authorization of a verified user', () => {
  const user = {id: USER, email: 'person@example.com'};
  const receipt = (outcome: ActivationReceipt['outcome']): ActivationReceipt => ({outcome, accountId: outcome === 'none' || outcome === 'refused' ? null : ACCOUNT, workspaceId: null, role: null});

  it('consumes it for that user and decides as the callback does', async () => {
    const consume = vi.fn(async (_userId: string) => receipt('registered'));
    expect(await claimPreauthorization(user, {consume})).toEqual({to: '/', signOut: false});
    expect(consume).toHaveBeenCalledWith(USER);
    expect(await claimPreauthorization(user, {consume: async () => receipt('none')})).toEqual({to: '/register', signOut: false});
    expect(await claimPreauthorization(user, {consume: async () => receipt('refused')})).toEqual({to: '/login?error=not_allowed', signOut: true, scope: 'global'});
    expect(await claimPreauthorization(user, {consume: async () => receipt('disabled')})).toEqual({to: '/login?error=account_disabled', signOut: true, scope: 'global'});
  });

  it('fails closed, signing out on this browser only, when the call fails or hangs', async () => {
    const log = vi.fn();
    expect(await claimPreauthorization(user, {consume: async () => { throw new Error('The accounts database did not answer.'); }, log})).toEqual({to: '/login?error=auth_unavailable', signOut: true, scope: 'local'});
    expect(log).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    try {
      const pending = claimPreauthorization(user, {consume: () => new Promise(() => undefined), timeoutMs: 300, log: quiet});
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toEqual({to: '/login?error=auth_unavailable', signOut: true, scope: 'local'});
    } finally {
      vi.useRealTimers();
    }
  });
});
