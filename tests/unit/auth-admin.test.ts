import {afterEach, describe, expect, it, vi} from 'vitest';
import {AuthAdminError, generateMagicLink, type AuthAdminOptions} from '@/lib/auth-admin';
import type {Env} from '@/lib/environment';

// The Auth Admin API client (Story 1.6): what it asks Auth for, with which credential, and how every answer is read. No test
// calls a real Auth.
const SERVICE_KEY = 'service-role-key-must-never-be-printed';
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const env: Env = {NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co/some/path?x=1', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY};
const body = (extra: Record<string, unknown> = {}) => ({id: USER, email: 'admin@example.test', hashed_token: 'hashed-token-value', email_otp: '123456', action_link: 'https://abcdefgh.supabase.co/auth/v1/verify?token=x', verification_type: 'magiclink', ...extra});

function recorder(answer: () => Response | Promise<Response>) {
  const seen: {url: string; init: RequestInit}[] = [];
  const fetch: NonNullable<AuthAdminOptions['fetch']> = async (url, init) => {
    seen.push({url, init: init ?? {}});
    return answer();
  };
  return {seen, fetch};
}
const ok = () => new Response(JSON.stringify(body()), {status: 200, headers: {'content-type': 'application/json'}});
const failure = async (options: AuthAdminOptions) => {
  try {
    await generateMagicLink('admin@example.test', options);
  } catch (error) {
    return error as AuthAdminError;
  }
  throw new Error('expected a failure');
};

afterEach(() => vi.restoreAllMocks());

describe('generateMagicLink', () => {
  it('asks Auth\'s Admin API for a magic link for the address, as the service role, and gives back the hashed token and the user', async () => {
    const {seen, fetch} = recorder(ok);
    expect(await generateMagicLink('admin@example.test', {env, fetch})).toEqual({hashedToken: 'hashed-token-value', userId: USER});
    expect(seen).toHaveLength(1);
    // The origin only: a path or a query in the configured URL is not carried.
    expect(seen[0].url).toBe('https://abcdefgh.supabase.co/auth/v1/admin/generate_link');
    expect(seen[0].init.method).toBe('POST');
    expect(JSON.parse(seen[0].init.body as string)).toEqual({type: 'magiclink', email: 'admin@example.test'});
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${SERVICE_KEY}`);
    expect(headers.get('apikey')).toBe(SERVICE_KEY);
  });

  it('forbids a redirect (so the service key cannot follow one to another host), bounds the wait and keeps nothing', async () => {
    const {seen, fetch} = recorder(ok);
    await generateMagicLink('admin@example.test', {env, fetch});
    expect(seen[0].init.redirect).toBe('error');
    expect(seen[0].init.cache).toBe('no-store');
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('lower-cases the user id Auth answers with', async () => {
    const {fetch} = recorder(() => new Response(JSON.stringify(body({id: USER.toUpperCase()}))));
    expect((await generateMagicLink('admin@example.test', {env, fetch})).userId).toBe(USER);
  });

  it.each([
    ['no URL', {...env, NEXT_PUBLIC_SUPABASE_URL: undefined}],
    ['no key', {...env, SUPABASE_SERVICE_ROLE_KEY: undefined}],
    ['an empty key', {...env, SUPABASE_SERVICE_ROLE_KEY: ' '}],
    ['a URL that is not one', {...env, NEXT_PUBLIC_SUPABASE_URL: 'not a url'}],
    ['a key that cannot be a header', {...env, SUPABASE_SERVICE_ROLE_KEY: 'line\nbreak'}],
  ] as [string, Env][])('is not configured with %s: it fails without a request, and not retryably', async (_name, broken) => {
    const {seen, fetch} = recorder(ok);
    const error = await failure({env: broken, fetch});
    expect(error).toBeInstanceOf(AuthAdminError);
    expect(error.message).toBe('Auth is not configured.');
    expect(error.retryable).toBe(false);
    expect(seen).toEqual([]);
  });

  it.each([400, 401, 403, 404, 422])('says Auth refused, not retryably, on HTTP %i (hosted Auth refusing the Admin link API reads like this)', async (status) => {
    const {fetch} = recorder(() => new Response(JSON.stringify({code: status, error_code: 'email_provider_disabled', msg: 'provider disabled'}), {status}));
    const error = await failure({env, fetch});
    expect(error.status).toBe(status);
    expect(error.code).toBe('email_provider_disabled');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(`Auth refused to make the link (HTTP ${status}).`);
  });

  it.each([500, 502, 503])('is retryable on HTTP %i', async (status) => {
    const error = await failure({env, fetch: recorder(() => new Response('{}', {status})).fetch});
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(status);
  });

  it('is retryable when Auth does not answer, and says nothing of why', async () => {
    const error = await failure({env, fetch: async () => Promise.reject(new TypeError(`fetch failed ${SERVICE_KEY}`))});
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Auth did not answer.');
  });

  it.each([
    ['not JSON', () => new Response('<html>', {status: 200})],
    ['no hashed token', () => new Response(JSON.stringify(body({hashed_token: undefined})))],
    ['an empty hashed token', () => new Response(JSON.stringify(body({hashed_token: ''})))],
    ['no user', () => new Response(JSON.stringify(body({id: undefined})))],
    ['a user that is not a UUID', () => new Response(JSON.stringify(body({id: 'someone'})))],
    ['an array', () => new Response('[]')],
    ['null', () => new Response('null')],
  ])('refuses an answer that is %s, not retryably', async (_name, answer) => {
    const error = await failure({env, fetch: recorder(answer).fetch});
    expect(error.message).toBe('Auth answered with an unexpected shape.');
    expect(error.retryable).toBe(false);
  });

  it('never puts the key, the address or a token in an error or in the log', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const answers = [() => new Response(JSON.stringify({msg: `${SERVICE_KEY} admin@example.test hashed-token-value`}), {status: 422}), () => Promise.reject(new TypeError(SERVICE_KEY)), () => new Response('x')];
    for (const answer of answers) {
      const error = await failure({env, fetch: recorder(answer).fetch});
      for (const text of [error.message, error.name, String(error.code ?? '')]) {
        expect(text).not.toContain(SERVICE_KEY);
        expect(text).not.toContain('admin@example.test');
        expect(text).not.toContain('hashed-token-value');
      }
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
