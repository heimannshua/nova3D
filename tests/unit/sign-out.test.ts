import {describe, expect, it, vi} from 'vitest';
import {authCookieBase, isAuthCookieName, signOutQuietly} from '@/lib/supabase/sign-out';

const LOCAL = 'http://127.0.0.1:54321';
const HOSTED = 'https://abcdefgh.supabase.co';

describe('which cookies are this project’s session', () => {
  it('derives the cookie name from the first label of the Supabase host, as @supabase/ssr does', () => {
    expect(authCookieBase(LOCAL)).toBe('sb-127-auth-token');
    expect(authCookieBase(HOSTED)).toBe('sb-abcdefgh-auth-token');
    expect(authCookieBase('http://localhost:54321')).toBe('sb-localhost-auth-token');
  });

  it('is nothing at all when there is no usable URL', () => {
    // `undefined` means "read the environment", so the environment is emptied for this case.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    try {
      for (const url of [undefined, '', 'not a url']) {
        expect(authCookieBase(url)).toBeNull();
        expect(isAuthCookieName('sb-127-auth-token', url)).toBe(false);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    'sb-abcdefgh-auth-token',
    'sb-abcdefgh-auth-token.0',
    'sb-abcdefgh-auth-token.12',
    'sb-abcdefgh-auth-token-code-verifier',
    'sb-abcdefgh-auth-token-code-verifier.0',
    'sb-abcdefgh-auth-token-flows-code-verifier',
    'sb-abcdefgh-auth-token-flow-AbCd1234_-xYz-code-verifier',
  ])('recognises %s', (name) => {
    expect(isAuthCookieName(name, HOSTED)).toBe(true);
  });

  it.each([
    'sb-otherproj-auth-token',
    'sb-otherproj-auth-token.0',
    'sb-otherproj-auth-token-code-verifier',
    'sb-abcdefgh-other-token',
    'sb-abcdefghi-auth-token',
    'xsb-abcdefgh-auth-token',
    'sb-abcdefgh-auth-token.x',
    'sb-abcdefgh-auth-token.0.1',
    'sb-abcdefgh-auth-token-flow-short-code-verifier',
    'sb-abcdefgh-auth-tokens',
    'nova3d-locale',
    'sb-127-auth-token',
    '',
  ])('leaves %j alone', (name) => {
    expect(isAuthCookieName(name, HOSTED)).toBe(false);
  });

  it('reads the URL from the environment by default', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', HOSTED);
    try {
      expect(isAuthCookieName('sb-abcdefgh-auth-token')).toBe(true);
      expect(isAuthCookieName('sb-127-auth-token')).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('treats a project label with regular-expression characters as plain text', () => {
    expect(isAuthCookieName('sb-aXb-auth-token', 'https://a.b.supabase.co')).toBe(false);
    expect(isAuthCookieName('sb-a-auth-token', 'https://a.b.supabase.co')).toBe(true);
  });
});

describe('signOutQuietly', () => {
  const client = (signOut: (options: {scope: 'global' | 'local'}) => Promise<unknown>) => ({auth: {signOut}});

  it('ends every session by default, and only this browser’s when asked', async () => {
    const signOut = vi.fn(async () => ({error: null}));
    await signOutQuietly(client(signOut));
    await signOutQuietly(client(signOut), 'local');
    expect(signOut.mock.calls).toEqual([[{scope: 'global'}], [{scope: 'local'}]]);
  });

  it('does nothing without a client', async () => {
    await expect(signOutQuietly(null)).resolves.toBeUndefined();
  });

  it('logs, by name only, a sign-out that Auth answers with an error, instead of ignoring it', async () => {
    const log = vi.fn();
    const refused = Object.assign(new Error('Session secret-session-id is invalid'), {name: 'AuthApiError', status: 403});
    await signOutQuietly(client(async () => ({error: refused})), 'global', {log});
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][1]).toBe('AuthApiError');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });

  it('logs and swallows a sign-out that throws', async () => {
    const log = vi.fn();
    await expect(signOutQuietly(client(async () => { throw new TypeError('fetch failed'); }), 'global', {log})).resolves.toBeUndefined();
    expect(log.mock.calls[0][1]).toBe('TypeError');
  });

  it('says nothing when Auth ends the session', async () => {
    const log = vi.fn();
    await signOutQuietly(client(async () => ({error: null})), 'global', {log});
    await signOutQuietly(client(async () => undefined), 'global', {log});
    expect(log).not.toHaveBeenCalled();
  });

  it('gives up on an Auth service that never answers, so the caller can expire the cookies', async () => {
    vi.useFakeTimers();
    try {
      const log = vi.fn();
      const pending = signOutQuietly(client(() => new Promise(() => undefined)), 'global', {log, timeoutMs: 400});
      await vi.advanceTimersByTimeAsync(399);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toBe(true);
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
