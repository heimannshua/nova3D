import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// endSession and expireAuthCookies with a stubbed cookie store and a fake Auth client.
const store = vi.hoisted(() => ({cookies: [] as {name: string; value: string}[], deleted: [] as string[]}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => store.cookies,
    delete: (name: string) => {
      store.deleted.push(name);
    },
  }),
}));

import {endSession, expireAuthCookies} from '@/lib/supabase/server';

const HOSTED = 'https://abcdefgh.supabase.co';
const ours = [
  'sb-abcdefgh-auth-token',
  'sb-abcdefgh-auth-token.0',
  'sb-abcdefgh-auth-token.1',
  'sb-abcdefgh-auth-token-code-verifier',
  'sb-abcdefgh-auth-token-flows-code-verifier',
];
const others = ['sb-otherproj-auth-token', 'sb-otherproj-auth-token.0', 'sb-otherproj-auth-token-code-verifier', 'nova3d-locale', 'nova3d-theme', 'sb-abcdefgh-something-else'];
type Client = Parameters<typeof endSession>[0];
const clientOf = (signOut: (options: {scope: 'global' | 'local'}) => Promise<unknown>) => ({auth: {signOut}}) as unknown as Client;

beforeEach(() => {
  store.cookies = [...ours, ...others].map((name) => ({name, value: 'x'}));
  store.deleted = [];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('endSession', () => {
  it('ends every session by default, then deletes this project’s session, chunk and verifier cookies', async () => {
    const signOut = vi.fn(async () => ({error: null}));
    await endSession(clientOf(signOut));
    expect(signOut).toHaveBeenCalledExactlyOnceWith({scope: 'global'});
    expect(store.deleted.sort()).toEqual([...ours].sort());
  });

  it('ends only this browser’s session for scope local, and still deletes the cookies', async () => {
    const signOut = vi.fn(async () => ({error: null}));
    await endSession(clientOf(signOut), 'local');
    expect(signOut).toHaveBeenCalledExactlyOnceWith({scope: 'local'});
    expect(store.deleted.sort()).toEqual([...ours].sort());
  });

  it('leaves every other project’s cookies, and the preference cookies, alone', async () => {
    await endSession(clientOf(async () => ({error: null})));
    for (const name of others) expect(store.deleted).not.toContain(name);
  });

  it('deletes the cookies even when Auth refuses, fails or has no client', async () => {
    const log = vi.fn();
    await endSession(clientOf(async () => ({error: Object.assign(new Error('nope'), {name: 'AuthApiError'})})), 'global', {log});
    expect(store.deleted.sort()).toEqual([...ours].sort());
    expect(log).toHaveBeenCalledTimes(1);
    store.deleted = [];
    await endSession(clientOf(async () => { throw new TypeError('fetch failed'); }), 'global', {log});
    expect(store.deleted.sort()).toEqual([...ours].sort());
    store.deleted = [];
    await endSession(null);
    expect(store.deleted.sort()).toEqual([...ours].sort());
  });

  it('does not wait on an Auth service that never answers', async () => {
    vi.useFakeTimers();
    try {
      const pending = endSession(clientOf(() => new Promise(() => undefined)), 'global', {timeoutMs: 300, log: () => undefined});
      await vi.advanceTimersByTimeAsync(300);
      await pending;
      expect(store.deleted.sort()).toEqual([...ours].sort());
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes nothing when the project URL is unknown, rather than guessing which cookies are ours', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await endSession(null);
    expect(store.deleted).toEqual([]);
  });
});

describe('expireAuthCookies', () => {
  it('deletes this project’s cookies without asking Auth anything', async () => {
    await expireAuthCookies();
    expect(store.deleted.sort()).toEqual([...ours].sort());
  });
});
