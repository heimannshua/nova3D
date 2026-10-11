import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// lib/csrf.server.ts with ONLY next/headers faked: the one place a Server Action or route handler removes the
// CSRF cookie. It must never throw (a cookie that stays is a token that does not match, which is refused), and
// it must say so in the log by the error's NAME alone, because what a store says may hold a cookie's value.
const store = vi.hoisted(() => ({
  cookies: vi.fn(),
  deleted: [] as string[],
}));
vi.mock('next/headers', () => ({cookies: store.cookies}));

import {clearCsrfCookie} from '@/lib/csrf.server';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  store.deleted = [];
  store.cookies.mockReset().mockImplementation(async () => ({
    delete: (name: string) => {
      store.deleted.push(name);
    },
  }));
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('clearCsrfCookie', () => {
  it('removes the nova3d-csrf cookie, and only it, and logs nothing', async () => {
    await expect(clearCsrfCookie()).resolves.toBeUndefined();
    expect(store.deleted).toEqual(['nova3d-csrf']);
    expect(errors).not.toHaveBeenCalled();
  });

  it('resolves, and logs the error\'s name only, when cookies() throws (outside a request)', async () => {
    store.cookies.mockRejectedValue(Object.assign(new Error('cookie value=secret-marker was rejected'), {name: 'RequestScopeError'}));
    await expect(clearCsrfCookie()).resolves.toBeUndefined();
    expect(errors.mock.calls).toEqual([['The CSRF cookie could not be removed.', 'RequestScopeError']]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('secret-marker');
  });

  it('resolves, and logs the error\'s name only, when the store refuses the delete (a read-only store)', async () => {
    store.cookies.mockImplementation(async () => ({
      delete: () => {
        throw Object.assign(new Error('Cookies can only be modified in a Server Action or Route Handler (nova3d-csrf=secret-marker)'), {name: 'ReadonlyRequestCookiesError'});
      },
    }));
    await expect(clearCsrfCookie()).resolves.toBeUndefined();
    expect(errors.mock.calls).toEqual([['The CSRF cookie could not be removed.', 'ReadonlyRequestCookiesError']]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('secret-marker');
  });

  it.each([['a string', 'nova3d-csrf=secret-marker'], ['null', null], ['undefined', undefined], ['an object', {value: 'secret-marker'}]])('resolves, and logs no value, when what is thrown is %s', async (_name, thrown) => {
    store.cookies.mockImplementation(async () => ({
      delete: () => {
        throw thrown;
      },
    }));
    await expect(clearCsrfCookie()).resolves.toBeUndefined();
    expect(errors.mock.calls).toEqual([['The CSRF cookie could not be removed.', 'unknown failure']]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('secret-marker');
  });
});
