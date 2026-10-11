import {describe, expect, it, vi} from 'vitest';
import type {ActivationReceipt, GrantReceipt, SessionAuthorization} from '@/lib/accounts';
import {
  apiCsrfInvalid,
  apiDenial,
  apiDenialResponse,
  apiOriginNotAllowed,
  claimPreauthorization,
  decideAccess,
  decideSignIn,
  isOutageError,
  issueCsrfToken,
  issueSessionGrant,
  readUser,
  redirectFor,
  resolveAccess,
  sessionIdOfToken,
  type Access,
  type AuthReader,
  type UserRead,
} from '@/lib/access';
import {hashCsrfToken} from '@/lib/request-integrity';
import {sessionReader, unsignedToken} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
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
const signedIn = (user: unknown = googleUser(), sessionId: string | null = SESSION): AuthReader => ({
  auth: {getUser: async () => ({data: {user}, error: null}), ...sessionReader(USER, sessionId)},
});
const failing = (error: unknown, user: unknown = null): AuthReader => ({
  auth: {getUser: async () => ({data: {user}, error}), ...sessionReader(USER, SESSION)},
});
const authError = (name: string, status?: number, code?: string) => Object.assign(new Error(`${name} happened`), {name, status, code});
/** What api.authorize_session answers: nothing but the state unless the state is active. */
const authorization = (state: SessionAuthorization['state'], extra: Partial<SessionAuthorization> = {}): SessionAuthorization =>
  state === 'active'
    ? {state, accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member', epoch: 1, ...extra}
    : {state, accountId: null, workspaceId: null, role: null, epoch: null};
const person = {id: USER, email: 'person@example.com', sessionId: SESSION};

describe('readUser: who is signed in, according to Auth', () => {
  it('returns the verified user, with a lower-case ID, the email Auth reports and the session of the verified token', async () => {
    expect(await readUser(signedIn(googleUser({id: USER.toUpperCase()})))).toEqual({kind: 'user', user: {id: USER, email: 'Person@Example.com', sessionId: SESSION}});
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
    expect(await readUser({auth: {getUser: async () => ({data: undefined as never, error: null}), ...sessionReader(USER, SESSION)}})).toEqual({kind: 'signed-out'});
  });

  it('fails closed when there is no client, when getUser throws, and when the user has no usable ID', async () => {
    expect(await readUser(null, {log: quiet})).toEqual({kind: 'unavailable'});
    expect(await readUser({auth: {getUser: async () => { throw new TypeError('fetch failed'); }, ...sessionReader(USER, SESSION)}}, {log: quiet})).toEqual({kind: 'unavailable'});
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

  describe('the session of the request', () => {
    it('is the session_id of the access token Auth has just verified, read after the user', async () => {
      const calls: string[] = [];
      const client: AuthReader = {
        auth: {
          getUser: async () => {
            calls.push('getUser');
            return {data: {user: googleUser()}, error: null};
          },
          getSession: async () => {
            calls.push('getSession');
            return sessionReader(USER, SESSION.toUpperCase()).getSession();
          },
        },
      };
      expect(await readUser(client)).toMatchObject({kind: 'user', user: {sessionId: SESSION}});
      expect(calls).toEqual(['getUser', 'getSession']);
    });

    it('is never read when Auth does not vouch for a user', async () => {
      const getSession = vi.fn(async () => ({data: {session: null}, error: null}));
      await readUser({auth: {getUser: async () => ({data: {user: null}, error: authError('AuthSessionMissingError', 400)}), getSession}}, {log: quiet});
      await readUser({auth: {getUser: async () => ({data: {user: googleUser({is_anonymous: true})}, error: null}), getSession}}, {log: quiet});
      expect(getSession).not.toHaveBeenCalled();
    });

    it.each([
      ['no session in storage', async () => ({data: {session: null}, error: null})],
      ['an error from the session read', async () => ({data: {session: {access_token: unsignedToken({sub: USER, session_id: SESSION})}}, error: authError('AuthApiError', 500)})],
      ['no access token', async () => ({data: {session: {}}, error: null})],
      ['a token that is not a JWT', async () => ({data: {session: {access_token: 'not-a-token'}}, error: null})],
      ['a token with no session_id', async () => ({data: {session: {access_token: unsignedToken({sub: USER})}}, error: null})],
      ['a session_id that is not a UUID', async () => ({data: {session: {access_token: unsignedToken({sub: USER, session_id: 'abc'})}}, error: null})],
      ['a token for another user', async () => ({data: {session: {access_token: unsignedToken({sub: ACCOUNT, session_id: SESSION})}}, error: null})],
      ['a session read that throws', async () => { throw new TypeError('storage failed'); }],
    ])('fails closed for %s: no grant can be checked, so the user is unavailable', async (_name, getSession) => {
      const log = vi.fn();
      const result = await readUser({auth: {getUser: async () => ({data: {user: googleUser()}, error: null}), getSession: getSession as AuthReader['auth']['getSession']}}, {log});
      expect(result).toEqual({kind: 'unavailable'});
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain(SESSION);
    });

    it('stops waiting for a session read that never answers', async () => {
      vi.useFakeTimers();
      try {
        const pending = readUser({auth: {getUser: async () => ({data: {user: googleUser()}, error: null}), getSession: () => new Promise(() => undefined)}}, {timeoutMs: 400, log: quiet});
        await vi.advanceTimersByTimeAsync(400);
        expect(await pending).toEqual({kind: 'unavailable'});
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('sessionIdOfToken', () => {
    it('reads the session_id of a token whose subject is the user, whatever the case', () => {
      expect(sessionIdOfToken(unsignedToken({sub: USER.toUpperCase(), session_id: SESSION.toUpperCase()}), USER)).toBe(SESSION);
    });

    it.each([
      ['a non-string', 42],
      ['a token with two parts', 'a.b'],
      ['a payload that is not JSON', 'a.!!!.c'],
      ['a payload that is not an object', `a.${Buffer.from('"text"').toString('base64url')}.c`],
      ['a payload that is null', `a.${Buffer.from('null').toString('base64url')}.c`],
      ['another subject', unsignedToken({sub: ACCOUNT, session_id: SESSION})],
      ['no subject', unsignedToken({session_id: SESSION})],
      ['a numeric session_id', unsignedToken({sub: USER, session_id: 7})],
    ])('is null for %s', (_name, token) => {
      expect(sessionIdOfToken(token, USER)).toBeNull();
    });
  });

  it('fails closed when Auth does not answer in time, and stops waiting', async () => {
    vi.useFakeTimers();
    try {
      const hung: AuthReader = {auth: {getUser: () => new Promise(() => undefined), ...sessionReader(USER, SESSION)}};
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

describe('resolveAccess: the live authorization of the verified session', () => {
  const authorizeOf = (answer: SessionAuthorization | Error) => vi.fn(async (_userId: string, _sessionId: string, _timeoutMs: number) => {
    if (answer instanceof Error) throw answer;
    return answer;
  });

  it('is active with an active Account and a valid grant, carrying the Account, Workspace, role and epoch', async () => {
    const authorize = authorizeOf(authorization('active', {role: 'administrator', epoch: 3}));
    expect(await resolveAccess(signedIn(), {authorize})).toEqual({
      state: 'active',
      user: {id: USER, email: 'Person@Example.com', sessionId: SESSION},
      account: {accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'administrator', epoch: 3},
    });
  });

  it('asks one question, about the verified user and the session of the verified token, and nothing else', async () => {
    const authorize = authorizeOf(authorization('unregistered'));
    await resolveAccess(signedIn(googleUser({email: 'x@example.com', app_metadata: {provider: 'google', user_id: ACCOUNT}, user_metadata: {id: ACCOUNT, role: 'administrator', session_id: ACCOUNT}})), {authorize});
    expect(authorize.mock.calls).toEqual([[USER, SESSION, expect.any(Number)]]);
  });

  it('is unregistered with no Account, and disabled with a disabled one', async () => {
    expect(await resolveAccess(signedIn(), {authorize: authorizeOf(authorization('unregistered'))})).toEqual({state: 'unregistered', user: {id: USER, email: 'Person@Example.com', sessionId: SESSION}});
    expect(await resolveAccess(signedIn(), {authorize: authorizeOf(authorization('disabled'))})).toEqual({state: 'disabled', user: {id: USER, email: 'Person@Example.com', sessionId: SESSION}});
  });

  it.each(['no_grant', 'revoked', 'expired', 'idle', 'stale_epoch'] as const)('is a session that has ended, for the reason %s, however valid the token', async (state) => {
    expect(await resolveAccess(signedIn(), {authorize: authorizeOf(authorization(state))})).toEqual({
      state: 'session-ended',
      reason: state,
      user: {id: USER, email: 'Person@Example.com', sessionId: SESSION},
    });
  });

  it('is signed out, not ended, when the database says Auth no longer has the session', async () => {
    expect(await resolveAccess(signedIn(), {authorize: authorizeOf(authorization('no_session'))})).toEqual({state: 'signed-out'});
  });

  it('is refused, with no user to name, when the Google identity is no longer the pinned one', async () => {
    expect(await resolveAccess(signedIn(), {authorize: authorizeOf(authorization('subject_mismatch'))})).toEqual({state: 'refused'});
  });

  it('is signed out, without touching the database, when there is no session', async () => {
    const authorize = authorizeOf(authorization('active'));
    expect(await resolveAccess(failing(authError('AuthSessionMissingError', 400)), {authorize})).toEqual({state: 'signed-out'});
    expect(authorize).not.toHaveBeenCalled();
  });

  it('is signed out, without touching the database, for a user that is not a confirmed Google identity', async () => {
    const authorize = authorizeOf(authorization('active'));
    expect(await resolveAccess(signedIn(googleUser({app_metadata: {provider: 'email'}})), {authorize, log: quiet})).toEqual({state: 'signed-out'});
    expect(authorize).not.toHaveBeenCalled();
  });

  it('is unavailable, without touching the database, when Auth cannot answer or names no session', async () => {
    const authorize = authorizeOf(authorization('active'));
    expect(await resolveAccess(failing(authError('AuthRetryableFetchError', 0)), {authorize, log: quiet})).toEqual({state: 'unavailable'});
    expect(await resolveAccess(null, {authorize, log: quiet})).toEqual({state: 'unavailable'});
    expect(await resolveAccess(signedIn(googleUser(), null), {authorize, log: quiet})).toEqual({state: 'unavailable'});
    expect(authorize).not.toHaveBeenCalled();
  });

  it('fails closed on a database error, whatever it is', async () => {
    const log = vi.fn();
    for (const failure of [new Error('The accounts database did not answer.'), new TypeError('fetch failed'), Object.assign(new Error('permission denied'), {code: '42501'})]) {
      expect(await resolveAccess(signedIn(), {authorize: authorizeOf(failure), log})).toEqual({state: 'unavailable'});
    }
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the database does not answer in time', async () => {
    vi.useFakeTimers();
    try {
      const pending = resolveAccess(signedIn(), {authorize: () => new Promise(() => undefined), timeoutMs: 500, log: quiet});
      await vi.advanceTimersByTimeAsync(500);
      expect(await pending).toEqual({state: 'unavailable'});
    } finally {
      vi.useRealTimers();
    }
  });

  it('never calls an Account active unless the database names it, its role and its epoch included', async () => {
    const malformed: SessionAuthorization[] = [
      authorization('active', {accountId: null}),
      authorization('active', {role: null}),
      authorization('active', {epoch: null}),
      {state: 'frozen' as never, accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member', epoch: 1},
      {state: undefined as never, accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member', epoch: 1},
    ];
    for (const answer of malformed) {
      expect(await resolveAccess(signedIn(), {authorize: authorizeOf(answer), log: quiet}), JSON.stringify(answer)).toEqual({state: 'unavailable'});
    }
  });

  it('accepts an active Account that has no Workspace row yet only with a null Workspace, never as a pass for anyone else', async () => {
    const result = await resolveAccess(signedIn(), {authorize: authorizeOf(authorization('active', {workspaceId: null}))});
    expect(result).toMatchObject({state: 'active', account: {workspaceId: null}});
  });
});

describe('decideAccess: the I/O matrix for a private path', () => {
  const user = person;
  const states: Record<string, Access> = {
    signedOut: {state: 'signed-out'},
    unregistered: {state: 'unregistered', user},
    active: {state: 'active', user, account: {accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member', epoch: 1}},
    disabled: {state: 'disabled', user},
    refused: {state: 'refused'},
    sessionEnded: {state: 'session-ended', reason: 'revoked', user},
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

  it.each([...paths, '/register'])('session ended: %s asks the person to sign in again, without signing out', (path) => {
    expect(decideAccess(path, states.sessionEnded)).toEqual({action: 'redirect', to: '/login?error=session_ended', signOut: false});
  });

  it('session ended without a grant: a POST to /register is let through (a retried registration), and nothing else is', () => {
    const noGrant: Access = {state: 'session-ended', reason: 'no_grant', user};
    expect(decideAccess('/register', noGrant, 'POST')).toEqual({action: 'allow'});
    expect(decideAccess('/register', noGrant, 'GET')).toEqual({action: 'redirect', to: '/login?error=session_ended', signOut: false});
    expect(decideAccess('/register', noGrant)).toEqual({action: 'redirect', to: '/login?error=session_ended', signOut: false});
    expect(decideAccess('/settings', noGrant, 'POST')).toEqual({action: 'redirect', to: '/login?error=session_ended', signOut: false});
    for (const reason of ['revoked', 'expired', 'idle', 'stale_epoch'] as const) {
      expect(decideAccess('/register', {state: 'session-ended', reason, user}, 'POST'), reason).toEqual({action: 'redirect', to: '/login?error=session_ended', signOut: false});
    }
  });

  it.each([...paths, '/register'])('identity changed: %s signs out everywhere and says not_allowed', (path) => {
    expect(decideAccess(path, states.refused)).toEqual({action: 'redirect', to: '/login?error=not_allowed', signOut: true, scope: 'global'});
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
    expect(redirectFor('/', states.refused)).toBe('/login?error=not_allowed');
    expect(redirectFor('/', states.sessionEnded)).toBe('/login?error=session_ended');
    expect(redirectFor('/', states.signedOut)).toBe('/login?error=not_signed_in');
    expect(redirectFor('/', states.unavailable)).toBe('/login?error=auth_unavailable');
  });
});

describe('decideSignIn: what the callback does with the user and the pre-authorization receipt', () => {
  const user: UserRead = {kind: 'user', user: person};
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

describe('apiDenial: a private /api path answers JSON, never a redirect', () => {
  const states: [string, Access, number, string, boolean][] = [
    ['signed out', {state: 'signed-out'}, 401, 'not_signed_in', false],
    ['a Google identity with no Account', {state: 'unregistered', user: person}, 403, 'account_required', false],
    ['a session whose grant has ended', {state: 'session-ended', reason: 'expired', user: person}, 401, 'session_ended', false],
    ['a disabled Account', {state: 'disabled', user: person}, 403, 'account_disabled', false],
    ['a changed Google identity', {state: 'refused'}, 403, 'not_allowed', false],
    ['a check that could not be made', {state: 'unavailable'}, 503, 'auth_unavailable', true],
  ];

  it.each(states)('%s: %i %s (retryable: %s)', (_name, access, status, error, retryable) => {
    expect(apiDenial(access)).toEqual({status, error, retryable});
  });

  it('lets an active Account with a valid grant through, and nothing else', () => {
    expect(apiDenial({state: 'active', user: person, account: {accountId: ACCOUNT, workspaceId: WORKSPACE, role: 'member', epoch: 1}})).toBeNull();
    expect(apiDenial({state: 'something-new'} as never)).toEqual({status: 503, error: 'auth_unavailable', retryable: true});
  });
});

describe('issueSessionGrant: the grant of the session that has become an Account\'s', () => {
  const receipt = (outcome: GrantReceipt['outcome']): GrantReceipt => ({outcome, accountId: ACCOUNT, epoch: 1});

  it('issues it for the verified user and the session of the verified token, and goes on', async () => {
    const issue = vi.fn(async (_userId: string, _sessionId: string, _timeoutMs: number) => receipt('issued'));
    expect(await issueSessionGrant(person, {issue})).toBeNull();
    expect(issue.mock.calls).toEqual([[USER, SESSION, expect.any(Number)]]);
  });

  it('goes on when the session already has its grant (idempotent)', async () => {
    expect(await issueSessionGrant(person, {issue: async () => receipt('exists')})).toBeNull();
  });

  it('signs out everywhere, with the disabled message, a disabled Account', async () => {
    expect(await issueSessionGrant(person, {issue: async () => receipt('disabled')})).toEqual({to: '/login?error=account_disabled', signOut: true, scope: 'global'});
  });

  it('signs out everywhere, as not allowed, a Google identity that is not the pinned one', async () => {
    expect(await issueSessionGrant(person, {issue: async () => receipt('subject_mismatch')})).toEqual({to: '/login?error=not_allowed', signOut: true, scope: 'global'});
  });

  it.each(['revoked', 'expired', 'idle', 'stale', 'no_account', 'no_session'] as const)('signs out this browser only, as unavailable, when the outcome is %s', async (outcome) => {
    const log = vi.fn();
    expect(await issueSessionGrant(person, {issue: async () => receipt(outcome), log})).toEqual({to: '/login?error=auth_unavailable', signOut: true, scope: 'local'});
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('fails closed, signing out this browser only, when the call fails, hangs or answers nothing usable', async () => {
    const log = vi.fn();
    const unavailable = {to: '/login?error=auth_unavailable', signOut: true, scope: 'local'};
    expect(await issueSessionGrant(person, {issue: async () => { throw new Error('The accounts database did not answer.'); }, log})).toEqual(unavailable);
    expect(await issueSessionGrant(person, {issue: async () => ({outcome: 'allowed'}) as never, log: quiet})).toEqual(unavailable);
    expect(log).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    try {
      const pending = issueSessionGrant(person, {issue: () => new Promise(() => undefined), timeoutMs: 300, log: quiet});
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toEqual(unavailable);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the answers of a refused mutation (Story 1.4c)', () => {
  it('is 403 JSON for a foreign origin and for a missing or wrong token, and neither can be retried into success', () => {
    expect(apiOriginNotAllowed).toEqual({status: 403, error: 'origin_not_allowed', retryable: false});
    expect(apiCsrfInvalid).toEqual({status: 403, error: 'csrf_invalid', retryable: false});
    for (const denial of [apiOriginNotAllowed, apiCsrfInvalid]) {
      const {body, init} = apiDenialResponse(denial);
      expect(body).toEqual({error: denial.error, retryable: false});
      expect(init).toEqual({status: 403, headers: {'cache-control': 'no-store'}});
    }
  });
});

describe('issueCsrfToken: the session\'s CSRF token, delivered only when its hash is stored', () => {
  type Issue = NonNullable<Parameters<typeof issueCsrfToken>[1]>['issue'];
  const issued = (outcome: 'issued' | 'exists' | 'denied'): Issue => vi.fn(async () => outcome);

  it('returns a new token when the database stores its hash, and tells the database the verified user, the session and only that hash', async () => {
    const issue = vi.fn(async (_input: {userId: string; sessionId: string; hash: string}, _timeoutMs: number) => 'issued' as const);
    const token = await issueCsrfToken(person, {issue});
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issue).toHaveBeenCalledTimes(1);
    const [input, timeoutMs] = issue.mock.calls[0];
    expect(input).toEqual({userId: USER, sessionId: SESSION, hash: await hashCsrfToken(token!)});
    expect(JSON.stringify(input)).not.toContain(token!);
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(3000);
  });

  it('is a different token every time', async () => {
    const seen = new Set<string | null>();
    for (let call = 0; call < 20; call += 1) seen.add(await issueCsrfToken(person, {issue: issued('issued')}));
    expect(seen.size).toBe(20);
  });

  it.each(['exists', 'denied'] as const)('returns nothing when the database says %s: a token whose hash is not stored must never be delivered', async (outcome) => {
    expect(await issueCsrfToken(person, {issue: issued(outcome)})).toBeNull();
  });

  it('returns nothing, logs the failure by name only, and never throws, when the database cannot answer or answers nonsense', async () => {
    const log = vi.fn();
    expect(await issueCsrfToken(person, {issue: async () => { throw new Error('The accounts database did not answer.'); }, log})).toBeNull();
    expect(await issueCsrfToken(person, {issue: (async () => 'minted') as never, log})).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('could not be issued');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('gives up on a database that never answers', async () => {
    vi.useFakeTimers();
    try {
      const pending = issueCsrfToken(person, {issue: () => new Promise(() => undefined), timeoutMs: 300, log: quiet});
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('claimPreauthorization: consuming the pre-authorization of a verified user', () => {
  const user = person;
  const receipt = (outcome: ActivationReceipt['outcome']): ActivationReceipt => ({outcome, accountId: outcome === 'none' || outcome === 'refused' ? null : ACCOUNT, workspaceId: null, role: null});
  const granted = async (): Promise<GrantReceipt> => ({outcome: 'issued', accountId: ACCOUNT, epoch: 1});

  it('consumes it for that user and decides as the callback does', async () => {
    const consume = vi.fn(async (_userId: string, _timeoutMs: number) => receipt('registered'));
    expect(await claimPreauthorization(user, {consume, issue: granted})).toEqual({to: '/', signOut: false});
    expect(consume).toHaveBeenCalledWith(USER, expect.any(Number));
    expect(await claimPreauthorization(user, {consume: async () => receipt('none'), issue: granted})).toEqual({to: '/register', signOut: false});
    expect(await claimPreauthorization(user, {consume: async () => receipt('refused'), issue: granted})).toEqual({to: '/login?error=not_allowed', signOut: true, scope: 'global'});
    expect(await claimPreauthorization(user, {consume: async () => receipt('disabled'), issue: granted})).toEqual({to: '/login?error=account_disabled', signOut: true, scope: 'global'});
  });

  it.each(['registered', 'active'] as const)('issues the grant of the session when the receipt is %s, before it says Home', async (outcome) => {
    const order: string[] = [];
    const issue = vi.fn(async (_userId: string, _sessionId: string, _timeoutMs: number): Promise<GrantReceipt> => {
      order.push('issue');
      return {outcome: 'issued', accountId: ACCOUNT, epoch: 1};
    });
    const consume = async () => {
      order.push('consume');
      return receipt(outcome);
    };
    expect(await claimPreauthorization(user, {consume, issue})).toEqual({to: '/', signOut: false});
    expect(order).toEqual(['consume', 'issue']);
    expect(issue.mock.calls).toEqual([[USER, SESSION, expect.any(Number)]]);
  });

  it.each(['none', 'refused', 'disabled'] as const)('issues no grant when the receipt is %s: only a live Account has one', async (outcome) => {
    const issue = vi.fn(granted);
    await claimPreauthorization(user, {consume: async () => receipt(outcome), issue});
    expect(issue).not.toHaveBeenCalled();
  });

  it('issues no grant when the pre-authorization call failed', async () => {
    const issue = vi.fn(granted);
    await claimPreauthorization(user, {consume: async () => { throw new Error('down'); }, issue, log: quiet});
    expect(issue).not.toHaveBeenCalled();
  });

  it('signs out, and does not send the person Home, when the Account is live but its grant cannot be issued', async () => {
    const log = vi.fn();
    expect(await claimPreauthorization(user, {consume: async () => receipt('registered'), issue: async () => { throw new TypeError('fetch failed'); }, log}))
      .toEqual({to: '/login?error=auth_unavailable', signOut: true, scope: 'local'});
    expect(await claimPreauthorization(user, {consume: async () => receipt('active'), issue: async () => ({outcome: 'subject_mismatch', accountId: ACCOUNT, epoch: 1}), log}))
      .toEqual({to: '/login?error=not_allowed', signOut: true, scope: 'global'});
    expect(await claimPreauthorization(user, {consume: async () => receipt('active'), issue: async () => ({outcome: 'disabled', accountId: ACCOUNT, epoch: 1}), log}))
      .toEqual({to: '/login?error=account_disabled', signOut: true, scope: 'global'});
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

describe('a token is accepted for its session only while it is Auth\'s verified one', () => {
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  const seconds = Math.floor(now / 1000);

  it('needs an expiry that has not passed: one second before it is fine, the second itself is not', () => {
    expect(sessionIdOfToken(unsignedToken({sub: USER, session_id: SESSION, exp: seconds + 1}), USER, now)).toBe(SESSION);
    expect(sessionIdOfToken(unsignedToken({sub: USER, session_id: SESSION, exp: seconds}), USER, now)).toBeNull();
    expect(sessionIdOfToken(unsignedToken({sub: USER, session_id: SESSION, exp: seconds - 1}), USER, now)).toBeNull();
  });

  it.each([
    ['no expiry at all', undefined],
    ['an expiry that is text', String(seconds + 3600)],
    ['an expiry that is not a number', Number.NaN],
    ['an expiry that is infinite', Number.POSITIVE_INFINITY],
    ['an expiry of null', null],
  ])('refuses %s', (name, exp) => {
    const token = unsignedToken({sub: USER, session_id: SESSION, exp});
    // JSON turns NaN and Infinity into null, which is no number either.
    expect(sessionIdOfToken(token, USER, now), name).toBeNull();
  });

  it('is what readUser reads from the stored session: an expired stored token is no session, even for a user Auth vouches for', async () => {
    const log = vi.fn();
    const expired: AuthReader = {
      auth: {
        getUser: async () => ({data: {user: googleUser()}, error: null}),
        getSession: async () => ({data: {session: {access_token: unsignedToken({sub: USER, session_id: SESSION, exp: Math.floor(Date.now() / 1000) - 60})}}, error: null}),
      },
    };
    expect(await readUser(expired, {log})).toEqual({kind: 'unavailable'});
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('readUser with the token the code exchange has just returned', () => {
  const reader = (getSession: AuthReader['auth']['getSession']): AuthReader => ({auth: {getUser: async () => ({data: {user: googleUser()}, error: null}), getSession}});
  const neverRead = vi.fn(async () => ({data: {session: null}, error: null}));

  it('takes the session from that token and does not read the stored session at all', async () => {
    neverRead.mockClear();
    const result = await readUser(reader(neverRead), {accessToken: unsignedToken({sub: USER, session_id: SESSION})});
    expect(result).toEqual({kind: 'user', user: {id: USER, email: 'Person@Example.com', sessionId: SESSION}});
    expect(neverRead).not.toHaveBeenCalled();
  });

  it.each([
    ['a token for another user', unsignedToken({sub: ACCOUNT, session_id: SESSION})],
    ['a token with no session_id', unsignedToken({sub: USER})],
    ['an expired token', unsignedToken({sub: USER, session_id: SESSION, exp: 1})],
    ['no token', undefined],
    ['text that is not a token', 'nope'],
  ])('is unavailable for %s: the exchange named no session this user can hold', async (_name, accessToken) => {
    neverRead.mockClear();
    const log = vi.fn();
    expect(await readUser(reader(neverRead), {accessToken, log})).toEqual({kind: 'unavailable'});
    expect(neverRead).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('one time budget for a whole decision', () => {
  const slow = (ms: number, value: unknown) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

  it('gives up when the calls together run out of time, not when each one alone does', async () => {
    vi.useFakeTimers();
    try {
      // getUser takes 3 s and the session read never answers. With a 5 s allowance for each call this would
      // end at 8 s; with one budget it ends at 5 s.
      const client: AuthReader = {
        auth: {
          getUser: () => slow(3000, {data: {user: googleUser()}, error: null}) as ReturnType<AuthReader['auth']['getUser']>,
          getSession: () => new Promise(() => undefined),
        },
      };
      const started = Date.now();
      const pending = resolveAccess(client, {timeoutMs: 5000, log: quiet, authorize: async () => authorization('active')});
      await vi.advanceTimersByTimeAsync(4999);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({state: 'unavailable'});
      expect(Date.now() - started).toBe(5000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands each step only the time that is left, and starts no step when none is', async () => {
    vi.useFakeTimers();
    try {
      const seen: number[] = [];
      const client: AuthReader = {
        auth: {
          getUser: () => slow(2000, {data: {user: googleUser()}, error: null}) as ReturnType<AuthReader['auth']['getUser']>,
          getSession: () => slow(2000, sessionReader(USER, SESSION).getSession()) as ReturnType<AuthReader['auth']['getSession']>,
        },
      };
      const authorize = vi.fn(async (_userId: string, _sessionId: string, timeoutMs: number) => {
        seen.push(timeoutMs);
        return authorization('active');
      });
      const pending = resolveAccess(client, {timeoutMs: 5000, authorize});
      await vi.advanceTimersByTimeAsync(4000);
      expect((await pending).state).toBe('active');
      expect(seen).toEqual([1000]);

      // Three seconds and three seconds: the budget is gone before the authorization is asked at all.
      const exhausted: AuthReader = {
        auth: {
          getUser: () => slow(3000, {data: {user: googleUser()}, error: null}) as ReturnType<AuthReader['auth']['getUser']>,
          getSession: () => slow(3000, sessionReader(USER, SESSION).getSession()) as ReturnType<AuthReader['auth']['getSession']>,
        },
      };
      authorize.mockClear();
      const second = resolveAccess(exhausted, {timeoutMs: 5000, log: quiet, authorize});
      await vi.advanceTimersByTimeAsync(5000);
      expect(await second).toEqual({state: 'unavailable'});
      expect(authorize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shares one budget across the pre-authorization and the grant', async () => {
    vi.useFakeTimers();
    try {
      const issue = vi.fn(async () => ({outcome: 'issued', accountId: ACCOUNT, epoch: 1}) as GrantReceipt);
      const consume = () => slow(700, {outcome: 'registered', accountId: ACCOUNT, workspaceId: null, role: 'member'}) as Promise<ActivationReceipt>;
      // 700 ms spent on the pre-authorization leaves 300 ms of a 1 s budget; a grant that needs 500 ms is too late.
      const slowIssue = (_userId: string, _sessionId: string, timeoutMs: number) => {
        expect(timeoutMs).toBe(300);
        return slow(500, {outcome: 'issued', accountId: ACCOUNT, epoch: 1}) as Promise<GrantReceipt>;
      };
      const pending = claimPreauthorization(person, {consume, issue: slowIssue, timeoutMs: 1000, log: quiet});
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({to: '/login?error=auth_unavailable', signOut: true, scope: 'local'});
      expect(issue).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
