import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The verified address the shell's Account panel shows (lib/account-address.server.ts): asked for only when the request carries an
// Auth session cookie, and only an active Account's own address, from the verified access, is ever an answer.
const request = vi.hoisted(() => ({cookies: {} as Record<string, string>}));
const mocks = vi.hoisted(() => ({getAccess: vi.fn()}));
vi.mock('next/headers', () => ({
  cookies: async () => ({getAll: () => Object.entries(request.cookies).map(([name, value]) => ({name, value}))}),
}));
vi.mock('@/lib/auth', () => ({getAccess: mocks.getAccess}));

import {getAccountAddress} from '@/lib/account-address.server';

const session = 'sb-abcdefgh-auth-token';
const user = {id: '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44', email: 'person@example.com', sessionId: '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11'};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  request.cookies = {[session]: 'x'};
  mocks.getAccess.mockReset().mockResolvedValue({state: 'active', user, account: {accountId: 'a', workspaceId: null, role: 'member', epoch: 1, preferences: null}});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getAccountAddress', () => {
  it('answers null without asking anything when the request carries no Auth session cookie', async () => {
    request.cookies = {'nova3d-locale': 'he', 'nova3d-theme': 'dark'};
    expect(await getAccountAddress()).toBeNull();
    request.cookies = {};
    expect(await getAccountAddress()).toBeNull();
    expect(mocks.getAccess).not.toHaveBeenCalled();
  });

  it('answers the verified address of an active Account, asking once', async () => {
    expect(await getAccountAddress()).toBe('person@example.com');
    expect(mocks.getAccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{state: 'signed-out'}],
    [{state: 'unavailable'}],
    [{state: 'refused'}],
    [{state: 'unregistered', user}],
    [{state: 'disabled', user}],
    [{state: 'session-ended', reason: 'revoked', user}],
  ])('answers null for an access that is not an active Account: %j', async (access) => {
    mocks.getAccess.mockResolvedValue(access);
    expect(await getAccountAddress()).toBeNull();
  });

  it('answers null, and does not throw, when the access cannot be read at all', async () => {
    mocks.getAccess.mockRejectedValue(new Error('the accounts database did not answer'));
    expect(await getAccountAddress()).toBeNull();
  });

  it('takes the address from the verified access and from nothing a request chose', async () => {
    request.cookies = {[session]: 'someone-else@example.com', 'nova3d-email': 'forged@example.com'};
    expect(await getAccountAddress()).toBe('person@example.com');
  });
});
