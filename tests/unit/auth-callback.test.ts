import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The sign-in callback with a fake Auth client and fake accounts: no Google, no network.
const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  endSession: vi.fn(),
  expireAuthCookies: vi.fn(),
  clearCsrfCookie: vi.fn(),
  consumePreauthorization: vi.fn(),
  issueGrant: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: mocks.createSupabaseServerClient, endSession: mocks.endSession, expireAuthCookies: mocks.expireAuthCookies}));
vi.mock('@/lib/csrf.server', () => ({clearCsrfCookie: mocks.clearCsrfCookie}));
vi.mock('@/lib/accounts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounts')>()),
  consumePreauthorization: mocks.consumePreauthorization,
  issueGrant: mocks.issueGrant,
}));

import {AccountsUnavailableError} from '@/lib/accounts';
import {GET} from '@/app/auth/callback/route';
import {unsignedToken} from '../support/access-token';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const googleUser = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  email: 'person@example.com',
  email_confirmed_at: '2026-10-10T00:00:00Z',
  is_anonymous: false,
  app_metadata: {provider: 'google', providers: ['google']},
  ...overrides,
});

type Fake = {
  exchange: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  order: string[];
};

function fakeClient(options: {exchange?: unknown; getUser?: unknown} = {}): Fake & {auth: unknown} {
  const order: string[] = [];
  const exchange = vi.fn(async () => {
    order.push('exchange');
    // The exchange names a user of its own (never trusted) and hands over the session's token.
    return options.exchange ?? {data: {user: googleUser(OTHER_USER), session: {access_token: exchangedToken()}}, error: null};
  });
  const getUser = vi.fn(async () => {
    order.push('getUser');
    return options.getUser ?? {data: {user: googleUser(USER)}, error: null};
  });
  // The access token of the session the exchange left in storage: the verified user's, with its session.
  const getSession = vi.fn(async () => {
    order.push('getSession');
    return {data: {session: {access_token: unsignedToken({sub: USER, session_id: SESSION})}}, error: null};
  });
  return {exchange, getUser, getSession, order, auth: {exchangeCodeForSession: exchange, getUser, getSession}};
}

/** The access token the code exchange returns: the verified user's own session. */
const exchangedToken = (claims: Record<string, unknown> = {sub: USER, session_id: SESSION}) => unsignedToken(claims);
const receipt = (outcome: string) => ({outcome, accountId: outcome === 'none' || outcome === 'refused' ? null : ACCOUNT, workspaceId: null, role: null});
const call = async (query = '?code=google-code') => {
  const response = await GET(new Request(`http://127.0.0.1:4173/auth/callback${query}`));
  const location = new URL(response.headers.get('location') ?? '', 'http://127.0.0.1:4173');
  return {status: response.status, to: `${location.pathname}${location.search}`};
};

let client: ReturnType<typeof fakeClient>;
beforeEach(() => {
  client = fakeClient();
  mocks.createSupabaseServerClient.mockReset().mockImplementation(async () => client);
  mocks.endSession.mockReset().mockImplementation(async () => {
    client.order.push('endSession');
  });
  mocks.expireAuthCookies.mockReset();
  mocks.clearCsrfCookie.mockReset();
  mocks.consumePreauthorization.mockReset().mockImplementation(async () => {
    client.order.push('consume');
    return receipt('active');
  });
  mocks.issueGrant.mockReset().mockImplementation(async () => {
    client.order.push('grant');
    return {outcome: 'issued', accountId: ACCOUNT, epoch: 1};
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('before Google has answered', () => {
  it('returns to sign-in as unavailable when there is no code, or no Auth client', async () => {
    expect((await call('')).to).toBe('/login?error=auth_unavailable');
    mocks.createSupabaseServerClient.mockImplementation(async () => null);
    expect((await call()).to).toBe('/login?error=auth_unavailable');
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
  });

  it.each([
    ['?error=access_denied&error_description=The+user+denied+access'],
    ['?error_description=Unable+to+exchange+external+code'],
    ['?error_code=bad_oauth_callback&error=invalid_request'],
  ])('reports a sign-in that Google or Auth turned back (%s) as a failed sign-in, not an outage', async (query) => {
    expect((await call(query)).to).toBe('/login?error=auth_failed');
    expect(client.exchange).not.toHaveBeenCalled();
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
  });

  it('reports a failed exchange as a failed sign-in, and consumes nothing', async () => {
    client = fakeClient({exchange: {data: {user: null, session: null}, error: Object.assign(new Error('invalid grant'), {name: 'AuthApiError', status: 400})}});
    expect((await call()).to).toBe('/login?error=auth_failed');
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('reports an exchange that Auth could not serve (a 5xx, a dropped connection) as unavailable', async () => {
    for (const error of [Object.assign(new Error('down'), {name: 'AuthRetryableFetchError', status: 0}), Object.assign(new Error('boom'), {name: 'AuthApiError', status: 503})]) {
      client = fakeClient({exchange: {data: {user: null, session: null}, error}});
      expect((await call()).to).toBe('/login?error=auth_unavailable');
    }
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
  });

  it('reports an exchange that throws as unavailable, without trusting Auth to answer a sign-out', async () => {
    client.exchange.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await call()).to).toBe('/login?error=auth_unavailable');
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
    expect(mocks.expireAuthCookies).toHaveBeenCalledTimes(1);
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('gives up on an exchange Auth never answers and ends in the redirect, not a hang', async () => {
    vi.useFakeTimers();
    try {
      client.exchange.mockImplementationOnce(() => new Promise(() => undefined));
      const pending = call();
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).to).toBe('/login?error=auth_unavailable');
      expect(mocks.expireAuthCookies).toHaveBeenCalledTimes(1);
      expect(mocks.endSession).not.toHaveBeenCalled();
      expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends this browser only when the exchange failed with an outage but returned a user', async () => {
    client = fakeClient({exchange: {data: {user: googleUser(USER), session: null}, error: Object.assign(new Error('partial'), {name: 'AuthRetryableFetchError', status: 0})}});
    expect((await call()).to).toBe('/login?error=auth_unavailable');
    expect(mocks.endSession).toHaveBeenCalledWith(client, 'local');
  });

  it('ends every session if the exchange returned a user together with a refusal', async () => {
    client = fakeClient({exchange: {data: {user: googleUser(USER), session: null}, error: Object.assign(new Error('partial'), {name: 'AuthApiError', status: 400})}});
    expect((await call()).to).toBe('/login?error=auth_failed');
    expect(mocks.endSession).toHaveBeenCalledWith(client, 'global');
  });
});

describe('the pre-authorization and the Account', () => {
  it('consumes the pre-authorization of the user Auth verifies, after the exchange, never of the one the exchange named', async () => {
    await call();
    // The session comes from the exchange's own token: the stored session is never read in the callback.
    expect(client.order.slice(0, 3)).toEqual(['exchange', 'getUser', 'consume']);
    expect(client.getSession).not.toHaveBeenCalled();
    expect(mocks.consumePreauthorization).toHaveBeenCalledTimes(1);
    expect(mocks.consumePreauthorization.mock.calls[0][0]).toBe(USER);
    expect(mocks.consumePreauthorization.mock.calls[0][0]).not.toBe(OTHER_USER);
  });

  it.each([
    ['registered', '/'],
    ['active', '/'],
  ])('sends a %s Account Home and keeps the session', async (outcome, to) => {
    mocks.consumePreauthorization.mockResolvedValue(receipt(outcome));
    const result = await call();
    expect(result).toEqual({status: 307, to});
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('sends a verified Google identity with no Account to the registration screen, signed in', async () => {
    mocks.consumePreauthorization.mockResolvedValue(receipt('none'));
    expect((await call()).to).toBe('/register');
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it('signs a subject mismatch out of every device and says not_allowed', async () => {
    mocks.consumePreauthorization.mockResolvedValue(receipt('refused'));
    expect((await call()).to).toBe('/login?error=not_allowed');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.endSession).toHaveBeenCalledWith(client, 'global');
  });

  it('signs a disabled Account out of every device and says account_disabled', async () => {
    mocks.consumePreauthorization.mockResolvedValue(receipt('disabled'));
    expect((await call()).to).toBe('/login?error=account_disabled');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.endSession).toHaveBeenCalledWith(client, 'global');
  });

  it('signs out an identity that is not a confirmed Google identity, everywhere, and never asks about a pre-authorization', async () => {
    for (const overrides of [{app_metadata: {provider: 'email'}}, {is_anonymous: true}, {email_confirmed_at: null}]) {
      client = fakeClient({getUser: {data: {user: googleUser(USER, overrides)}, error: null}});
      mocks.endSession.mockClear();
      expect((await call()).to).toBe('/login?error=not_allowed');
      expect(mocks.endSession).toHaveBeenCalledWith(client, 'global');
    }
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
  });

  it.each([
    ['the database is unreachable', new AccountsUnavailableError('The accounts database did not answer.', {retryable: true})],
    ['the database refuses the call', new AccountsUnavailableError('refused', {status: 403, code: '42501'})],
    ['a key is missing', new Error('SUPABASE_SERVICE_ROLE_KEY is not set')],
  ])('fails closed when %s: signed out on this browser only, auth_unavailable', async (_name, failure) => {
    mocks.consumePreauthorization.mockRejectedValue(failure);
    expect((await call()).to).toBe('/login?error=auth_unavailable');
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.endSession).toHaveBeenCalledWith(client, 'local');
  });

  it('fails closed, without waiting for ever, when the pre-authorization call hangs', async () => {
    vi.useFakeTimers();
    try {
      mocks.consumePreauthorization.mockImplementation(() => new Promise(() => undefined));
      const pending = call();
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).to).toBe('/login?error=auth_unavailable');
      expect(mocks.endSession).toHaveBeenCalledWith(client, 'local');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed when Auth cannot name the user it just signed in', async () => {
    client = fakeClient({getUser: {data: {user: null}, error: Object.assign(new Error('down'), {name: 'AuthRetryableFetchError', status: 0})}});
    expect((await call()).to).toBe('/login?error=auth_unavailable');
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.endSession).toHaveBeenCalledWith(client, 'local');
  });

  it('treats a session that Auth does not recognise right after the exchange as a failed sign-in', async () => {
    client = fakeClient({getUser: {data: {user: null}, error: Object.assign(new Error('no session'), {name: 'AuthSessionMissingError', status: 400})}});
    expect((await call()).to).toBe('/login?error=auth_failed');
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
  });

  it('ends the session before it answers, so no redirect can outrun the sign-out', async () => {
    mocks.consumePreauthorization.mockResolvedValue(receipt('refused'));
    await call();
    expect(client.order.at(-1)).toBe('endSession');
  });

  it('logs failures by name and message only', async () => {
    mocks.consumePreauthorization.mockRejectedValue(Object.assign(new Error('boom'), {token: 'secret-token'}));
    await call('?code=secret-google-code');
    const printed = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(printed).toContain('boom');
    expect(printed).not.toContain('secret');
  });
});

describe('the session grant (Story 1.4a)', () => {
  it('issues exactly one grant, for the verified user and the session of the verified token, before it sends the person Home', async () => {
    expect(await call()).toEqual({status: 307, to: '/'});
    expect(mocks.issueGrant).toHaveBeenCalledTimes(1);
    expect(mocks.issueGrant.mock.calls[0].slice(0, 2)).toEqual([USER, SESSION]);
    expect(client.order.indexOf('consume')).toBeLessThan(client.order.indexOf('grant'));
    expect(client.getSession).not.toHaveBeenCalled();
  });

  it.each(['registered', 'active'])('issues the grant of a %s Account, and no other', async (outcome) => {
    mocks.consumePreauthorization.mockResolvedValue(receipt(outcome));
    await call();
    expect(mocks.issueGrant).toHaveBeenCalledTimes(1);
  });

  it.each(['none', 'refused', 'disabled'])('issues no grant for a %s receipt', async (outcome) => {
    mocks.consumePreauthorization.mockResolvedValue(receipt(outcome));
    await call();
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it('issues no grant when the exchange failed, when Auth cannot name the user, or when the user is not a confirmed Google identity', async () => {
    client = fakeClient({exchange: {data: {user: null, session: null}, error: Object.assign(new Error('invalid grant'), {name: 'AuthApiError', status: 400})}});
    await call();
    client = fakeClient({getUser: {data: {user: null}, error: Object.assign(new Error('down'), {name: 'AuthRetryableFetchError', status: 0})}});
    await call();
    client = fakeClient({getUser: {data: {user: googleUser(USER, {app_metadata: {provider: 'email'}})}, error: null}});
    await call();
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it('signs out this browser only and says unavailable when the grant cannot be recorded: the sign-in did not complete', async () => {
    mocks.issueGrant.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await call()).toEqual({status: 307, to: '/login?error=auth_unavailable'});
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.endSession).toHaveBeenCalledWith(client, 'local');
  });

  it('gives up on a grant call that never answers, in the same redirect', async () => {
    vi.useFakeTimers();
    try {
      mocks.issueGrant.mockImplementation(() => new Promise(() => undefined));
      const pending = call();
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).to).toBe('/login?error=auth_unavailable');
      expect(mocks.endSession).toHaveBeenCalledWith(client, 'local');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['disabled', '/login?error=account_disabled', 'global'],
    ['subject_mismatch', '/login?error=not_allowed', 'global'],
    ['revoked', '/login?error=auth_unavailable', 'local'],
    ['no_session', '/login?error=auth_unavailable', 'local'],
  ])('answers a %s grant outcome with %s, signing out %s', async (outcome, to, scope) => {
    mocks.issueGrant.mockResolvedValue({outcome, accountId: ACCOUNT, epoch: 1});
    expect((await call()).to).toBe(to);
    expect(mocks.endSession).toHaveBeenCalledWith(client, scope);
  });

  it('never logs the session, the token or the user', async () => {
    mocks.issueGrant.mockRejectedValue(new Error('boom'));
    await call('?code=secret-google-code');
    const printed = JSON.stringify(vi.mocked(console.error).mock.calls);
    for (const secret of [SESSION, USER, 'secret-google-code']) expect(printed).not.toContain(secret);
  });
});

describe('the session of the exchange (Story 1.4a)', () => {
  const exchange = (access_token: unknown) => ({data: {user: googleUser(USER), session: access_token === undefined ? {} : {access_token}}, error: null});

  it('is the one in the token the exchange returned, whatever the stored session says', async () => {
    const other = '8d2e4f6a-1b3c-4d5e-9f70-a1b2c3d4e5f6';
    client = fakeClient({exchange: exchange(exchangedToken({sub: USER, session_id: other}))});
    client.getSession.mockImplementation(async () => ({data: {session: {access_token: exchangedToken({sub: USER, session_id: SESSION})}}, error: null}));
    await call();
    expect(mocks.issueGrant.mock.calls[0].slice(0, 2)).toEqual([USER, other]);
  });

  it.each([
    ['no session at all', exchange(undefined)],
    ['a token with no session_id', exchange(exchangedToken({sub: USER}))],
    ['a token for another user', exchange(exchangedToken({sub: OTHER_USER, session_id: SESSION}))],
    ['a token that has run out', exchange(exchangedToken({sub: USER, session_id: SESSION, exp: 1}))],
    ['a token that is not one', exchange('not-a-token')],
  ])('ends at auth_unavailable, on this browser only, and consumes and grants nothing, for %s', async (_name, result) => {
    client = fakeClient({exchange: result});
    expect(await call()).toEqual({status: 307, to: '/login?error=auth_unavailable'});
    expect(mocks.endSession).toHaveBeenCalledWith(client, 'local');
    expect(mocks.consumePreauthorization).not.toHaveBeenCalled();
    expect(mocks.issueGrant).not.toHaveBeenCalled();
  });

  it('shares one time budget across the exchange, the user, the pre-authorization and the grant', async () => {
    vi.useFakeTimers();
    try {
      const slow = (ms: number, value: unknown) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
      // 4 s for the exchange and 4 s for the user leave 2 s of the 10 s; a pre-authorization that never answers is cut off then.
      client.exchange.mockImplementation(() => slow(4000, {data: {user: googleUser(OTHER_USER), session: {access_token: exchangedToken()}}, error: null}));
      client.getUser.mockImplementation(() => slow(4000, {data: {user: googleUser(USER)}, error: null}));
      mocks.consumePreauthorization.mockImplementation(() => new Promise(() => undefined));
      const started = Date.now();
      const pending = call();
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await pending).to).toBe('/login?error=auth_unavailable');
      expect(Date.now() - started).toBe(10_000);
      expect(mocks.endSession).toHaveBeenCalledWith(client, 'local');
      expect(mocks.issueGrant).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the CSRF cookie belongs to one session (Story 1.4c)', () => {
  it('is removed once the code exchange has given the browser a new session, before anything else is decided', async () => {
    expect((await call()).to).toBe('/');
    expect(mocks.clearCsrfCookie).toHaveBeenCalledTimes(1);
    const [cleared] = mocks.clearCsrfCookie.mock.invocationCallOrder;
    expect(client.exchange.mock.invocationCallOrder[0]).toBeLessThan(cleared);
    expect(cleared).toBeLessThan(mocks.consumePreauthorization.mock.invocationCallOrder[0]);
  });

  it('is removed whatever the new session then turns out to be, a refusal included, because the old session is gone either way', async () => {
    mocks.consumePreauthorization.mockImplementation(async () => receipt('refused'));
    expect((await call()).to).toBe('/login?error=not_allowed');
    expect(mocks.clearCsrfCookie).toHaveBeenCalledTimes(1);
  });

  it('is left alone when no new session came of it: Google turned the sign-in back, or the exchange failed or did not answer', async () => {
    await call('?error=access_denied');
    await call('');
    client = fakeClient({exchange: {data: {user: null, session: null}, error: Object.assign(new Error('invalid grant'), {name: 'AuthApiError', status: 400})}});
    await call();
    client = fakeClient();
    client.exchange.mockRejectedValueOnce(new TypeError('fetch failed'));
    await call();
    expect(mocks.clearCsrfCookie).not.toHaveBeenCalled();
  });
});
