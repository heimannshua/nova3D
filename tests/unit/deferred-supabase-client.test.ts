import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The server client that holds its cookie writes back (Story 1.6, lib/supabase/server.ts), run as the REAL @supabase/ssr and
// auth-js client over a stubbed Auth and an in-memory cookie store. Administrator recovery mints a session before the database
// has accepted it, and two windows of one browser share one cookie jar, so the minted session has to live in the client's
// memory until the recovery is known: written on `commit()`, never on `discard()`.
const store = vi.hoisted(() => ({jar: new Map<string, string>(), writes: [] as {name: string; value: string}[], failWrites: false}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...store.jar].map(([name, value]) => ({name, value})),
    get: (name: string) => (store.jar.has(name) ? {name, value: store.jar.get(name)} : undefined),
    set: (name: string, value: string) => {
      if (store.failWrites) throw new Error('cookies can only be set in a Server Action or Route Handler');
      store.writes.push({name, value});
      if (value === '') store.jar.delete(name);
      else store.jar.set(name, value);
    },
    delete: (name: string) => store.jar.delete(name),
  }),
}));

import {createDeferredSupabaseServerClient} from '@/lib/supabase/server';
import {sessionCookieName, signAccessToken} from '../support/session-cookie';

const SUPABASE = 'http://127.0.0.1:54321';
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const SECRET = 'unit-test-jwt-secret-with-at-least-32-characters';
const cookieName = sessionCookieName(SUPABASE);
const OLD = 'base64-the-session-cookie-the-browser-sent';

type Call = {method: string; path: string; search: string; authorization: string | null};
let calls: Call[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const minted = () => signAccessToken({supabaseUrl: SUPABASE, userId: USER, email: 'person@example.com', sessionId: SESSION, jwtSecret: SECRET, issuedAt: 1_800_000_000, lifetime: 10 * 365 * 24 * 3600});
const user = {
  id: USER, aud: 'authenticated', role: 'authenticated', email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z',
  app_metadata: {provider: 'google', providers: ['google']}, user_metadata: {}, identities: [], created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', is_anonymous: false,
};

async function stubbedFetch(input: unknown, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url);
  calls.push({method: init.method ?? 'GET', path: url.pathname, search: url.search, authorization: new Headers(init.headers).get('authorization')});
  if (url.pathname === '/auth/v1/verify') return json({access_token: minted(), token_type: 'bearer', expires_in: 3600, expires_at: 1_900_000_000, refresh_token: 'minted-refresh-token', user});
  if (url.pathname === '/auth/v1/user') return json(user);
  if (url.pathname === '/auth/v1/logout') return new Response(null, {status: 204});
  throw new Error(`unexpected request to ${url.pathname}`);
}

beforeEach(() => {
  calls = [];
  store.jar.clear();
  store.writes.length = 0;
  store.failWrites = false;
  store.jar.set(cookieName, OLD);
  store.jar.set('nova3d-csrf', 'a-csrf-token');
  vi.stubGlobal('fetch', vi.fn(stubbedFetch));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const verify = (client: NonNullable<Awaited<ReturnType<typeof createDeferredSupabaseServerClient>>>['client']) => client.auth.verifyOtp({token_hash: 'hashed-link-token', type: 'magiclink'});

describe('createDeferredSupabaseServerClient', () => {
  it('is none without the Supabase URL and key, like the ordinary client', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(await createDeferredSupabaseServerClient()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    expect(await createDeferredSupabaseServerClient()).toBeNull();
  });

  it('mints a session without writing a single cookie, and holds the writes it would have made', async () => {
    const deferred = (await createDeferredSupabaseServerClient())!;
    const {data, error} = await verify(deferred.client);
    expect(error).toBeNull();
    expect(data.session?.access_token).toBe(minted());
    // Not one cookie of the browser's was touched.
    expect(store.writes).toEqual([]);
    expect(store.jar.get(cookieName)).toBe(OLD);
    expect(deferred.held).toBeGreaterThan(0);
  });

  it('keeps the minted session in memory: Auth is asked about the NEW session, not the cookie the browser sent', async () => {
    const deferred = (await createDeferredSupabaseServerClient())!;
    await verify(deferred.client);
    const {data} = await deferred.client.auth.getUser();
    expect(data.user?.id).toBe(USER);
    const asked = calls.find((call) => call.path === '/auth/v1/user')!;
    expect(asked.authorization).toBe(`Bearer ${minted()}`);
    expect((await deferred.client.auth.getSession()).data.session?.access_token).toBe(minted());
    expect(store.writes).toEqual([]);
  });

  it('writes the held cookies, in order and only then, on commit: the session replaces the one the browser sent', async () => {
    const deferred = (await createDeferredSupabaseServerClient())!;
    await verify(deferred.client);
    expect(store.writes).toEqual([]);
    expect(deferred.commit()).toBe(true);
    expect(store.writes.length).toBeGreaterThan(0);
    expect(store.writes.every((write) => write.name.startsWith(cookieName))).toBe(true);
    expect(store.jar.get(cookieName)).toMatch(/^base64-/);
    expect(store.jar.get(cookieName)).not.toBe(OLD);
    // Other cookies (the CSRF token) are not this client's to touch.
    expect(store.jar.get('nova3d-csrf')).toBe('a-csrf-token');
    // Committed once: a second commit has nothing left to write, and says so.
    const written = store.writes.length;
    expect(deferred.commit()).toBe(false);
    expect(store.writes).toHaveLength(written);
    expect(deferred.held).toBe(0);
  });

  it('writes nothing on discard, and the browser keeps exactly the cookies it sent', async () => {
    const deferred = (await createDeferredSupabaseServerClient())!;
    await verify(deferred.client);
    deferred.discard();
    expect(deferred.held).toBe(0);
    // A commit after a discard has nothing to write, and says so.
    expect(deferred.commit()).toBe(false);
    expect(store.writes).toEqual([]);
    expect(store.jar.get(cookieName)).toBe(OLD);
    expect(store.jar.get('nova3d-csrf')).toBe('a-csrf-token');
  });

  it('says it wrote nothing when there was nothing to write: no session was minted, so there is no cookie to give', async () => {
    const deferred = (await createDeferredSupabaseServerClient())!;
    expect(deferred.held).toBe(0);
    expect(deferred.commit()).toBe(false);
    expect(store.writes).toEqual([]);
    expect(store.jar.get(cookieName)).toBe(OLD);
    // ... and it still says true when it did write.
    await verify(deferred.client);
    expect(deferred.commit()).toBe(true);
  });

  it('ends only the session it minted, at Auth, and still writes nothing: a window that lost leaves nothing in a shared cookie jar', async () => {
    const deferred = (await createDeferredSupabaseServerClient())!;
    await verify(deferred.client);
    await deferred.client.auth.signOut({scope: 'local'});
    const logout = calls.find((call) => call.path === '/auth/v1/logout')!;
    expect(logout.search).toBe('?scope=local');
    expect(logout.authorization).toBe(`Bearer ${minted()}`);
    deferred.discard();
    expect(store.writes).toEqual([]);
    expect(store.jar.get(cookieName)).toBe(OLD);
  });

  it('says so, and does not throw, when the cookie store refuses the write', async () => {
    const deferred = (await createDeferredSupabaseServerClient())!;
    await verify(deferred.client);
    store.failWrites = true;
    expect(deferred.commit()).toBe(false);
    expect(store.jar.get(cookieName)).toBe(OLD);
  });

  it('leaves the ordinary client alone: it still writes as it always did', async () => {
    const {createSupabaseServerClient} = await import('@/lib/supabase/server');
    const client = (await createSupabaseServerClient())!;
    await verify(client as unknown as Parameters<typeof verify>[0]);
    expect(store.writes.length).toBeGreaterThan(0);
  });
});
