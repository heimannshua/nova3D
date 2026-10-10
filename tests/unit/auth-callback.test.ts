import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The sign-in callback with a fake Auth client and fake accounts: no Google, no network.
const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  endSession: vi.fn(),
  expireAuthCookies: vi.fn(),
  consumePreauthorization: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({createSupabaseServerClient: mocks.createSupabaseServerClient, endSession: mocks.endSession, expireAuthCookies: mocks.expireAuthCookies}));
vi.mock('@/lib/accounts', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/accounts')>()), consumePreauthorization: mocks.consumePreauthorization}));

import {AccountsUnavailableError} from '@/lib/accounts';
import {GET} from '@/app/auth/callback/route';

const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
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
  order: string[];
};

function fakeClient(options: {exchange?: unknown; getUser?: unknown} = {}): Fake & {auth: unknown} {
  const order: string[] = [];
  const exchange = vi.fn(async () => {
    order.push('exchange');
    return options.exchange ?? {data: {user: googleUser(OTHER_USER), session: {}}, error: null};
  });
  const getUser = vi.fn(async () => {
    order.push('getUser');
    return options.getUser ?? {data: {user: googleUser(USER)}, error: null};
  });
  return {exchange, getUser, order, auth: {exchangeCodeForSession: exchange, getUser}};
}

const receipt = (outcome: string) => ({outcome, accountId: outcome === 'none' || outcome === 'refused' ? null : ACCOUNT, workspaceId: null, role: null});
const call = async (query = '?code=google-code') => {
  const response = await GET(new Request(`http://127.0.0.1:4173/auth/callback${query}`));
  const location = new URL(response.headers.get('location') ?? '');
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
  mocks.consumePreauthorization.mockReset().mockImplementation(async () => {
    client.order.push('consume');
    return receipt('active');
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
      await vi.advanceTimersByTimeAsync(5000);
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
    expect(client.order.slice(0, 3)).toEqual(['exchange', 'getUser', 'consume']);
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
      await vi.advanceTimersByTimeAsync(5000);
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
