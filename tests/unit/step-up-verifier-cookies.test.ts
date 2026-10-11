import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// The PKCE verifier cookies a step-up leaves in the browser, seen through the REAL server Supabase client
// (lib/supabase/server.ts, @supabase/ssr, auth-js) and a cookie jar: nothing about the client or the cookies is
// mocked away. The step-up starts a Google sign-in (which writes the verifier) BEFORE the database is asked to
// record the nonce, so when the nonce cannot be written, exactly that verifier must go again, and nothing else.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const store = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  options: new Map<string, Record<string, unknown>>(),
  headers: new Map<string, string>(),
  writes: [] as string[],
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...store.jar].map(([name, value]) => ({name, value})),
    get: (name: string) => (store.jar.has(name) ? {name, value: store.jar.get(name)} : undefined),
    // @supabase/ssr removes a cookie by setting it empty.
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      store.writes.push(name);
      if (value === '') store.jar.delete(name);
      else {
        store.jar.set(name, value);
        store.options.set(name, options);
      }
    },
    delete: (name: string) => {
      store.writes.push(name);
      store.jar.delete(name);
    },
  }),
  headers: async () => ({get: (name: string) => store.headers.get(name.toLowerCase()) ?? null}),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

import {beginStepUp} from '@/app/step-up/actions';
import {requestGoogleSignIn} from '@/lib/sign-in';
import {restoreVerifierCookies, snapshotVerifierCookies} from '@/lib/step-up.server';
import {createSupabaseServerClient} from '@/lib/supabase/server';
import {isPkceVerifierCookieName} from '@/lib/supabase/sign-out';
import {stepUpCookieName} from '@/lib/step-up-flow';
import {sessionCookieName, sessionCookieValue} from '../support/session-cookie';

const SUPABASE = 'http://127.0.0.1:54321';
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const SECRET = 'unit-test-jwt-secret-with-at-least-32-characters';
const sessionCookie = sessionCookieName(SUPABASE);
const idle = {outcome: 'idle'} as const;

type Start = 'started' | 'limited' | 'refused' | 'down' | 'error';
let start: Start;
let calls: string[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

async function stubbedFetch(input: unknown): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url);
  calls.push(url.pathname);
  if (url.pathname === '/auth/v1/user') {
    return json({
      id: USER, aud: 'authenticated', role: 'authenticated', email: 'person@example.com', email_confirmed_at: '2026-10-10T00:00:00Z',
      app_metadata: {provider: 'google', providers: ['google']}, user_metadata: {}, identities: [], created_at: '2026-10-10T00:00:00Z', is_anonymous: false,
    });
  }
  if (url.pathname === '/rest/v1/rpc/authorize_session') return json({state: 'active', account_id: ACCOUNT, workspace_id: null, role: 'member', epoch: 1});
  if (url.pathname === '/rest/v1/rpc/start_step_up') {
    if (start === 'down') throw new TypeError('fetch failed');
    if (start === 'error') return json({code: 'XX000', message: 'boom'}, 503);
    return json({outcome: start, expires_at: start === 'started' ? new Date(Date.now() + 600_000).toISOString() : null});
  }
  throw new Error(`unexpected request to ${url.pathname}`);
}

const verifierCookies = () => new Map([...store.jar].filter(([name]) => isPkceVerifierCookieName(name, SUPABASE)));
const redirected = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};

beforeEach(() => {
  store.jar.clear();
  store.options.clear();
  store.writes = [];
  store.headers = new Map([['host', '127.0.0.1:4173']]);
  calls = [];
  start = 'started';
  store.jar.set(sessionCookie, sessionCookieValue({supabaseUrl: SUPABASE, userId: USER, email: 'person@example.com', sessionId: SESSION, jwtSecret: SECRET}));
  vi.stubGlobal('fetch', vi.fn(stubbedFetch));
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a step-up that does start (the control: the test can see the verifier cookies)', () => {
  it('leaves the verifier its Google sign-in needs, sets the step-up cookie, and goes to Google', async () => {
    const to = await redirected(beginStepUp('administration', idle));
    expect(to).toMatch(/^http:\/\/127\.0\.0\.1:54321\/auth\/v1\/authorize\?/);
    const names = [...verifierCookies().keys()];
    expect(names).toEqual(expect.arrayContaining([`${sessionCookie}-code-verifier`, `${sessionCookie}-flows-code-verifier`]));
    expect(names.some((name) => /-flow-[A-Za-z0-9_-]{8,64}-code-verifier$/.test(name))).toBe(true);
    expect(store.jar.has(stepUpCookieName)).toBe(true);
    expect(calls).toContain('/rest/v1/rpc/start_step_up');
  });
});

describe.each<[string, Start]>([
  ['the Account has used its ten starts in the hour (limited)', 'limited'],
  ['the database no longer sees the session as an active Account\'s (refused)', 'refused'],
  ['the database cannot be reached', 'down'],
  ['the database answers with a server error', 'error'],
])('when %s', (_name, mode) => {
  const expected = (): {state: unknown; to: string | null} => ({
    state: mode === 'limited' ? {outcome: 'limited'} : mode === 'refused' ? undefined : {outcome: 'unavailable'},
    to: mode === 'refused' ? '/' : null,
  });

  async function run() {
    start = mode;
    let state: unknown;
    const to = await redirected(
      (async () => {
        state = await beginStepUp('administration', idle);
      })(),
    );
    return {state, to};
  }

  it('removes the verifier cookies the start wrote, and sets no step-up cookie', async () => {
    const answer = await run();
    expect(answer.to).toBe(expected().to);
    if (mode !== 'refused') expect(answer.state).toEqual(expected().state);
    expect(calls).toContain('/rest/v1/rpc/start_step_up');
    expect([...verifierCookies().keys()]).toEqual([]);
    expect(store.jar.has(stepUpCookieName)).toBe(false);
  });

  it('never touches the session cookie', async () => {
    const before = store.jar.get(sessionCookie);
    await run();
    expect(store.jar.get(sessionCookie)).toBe(before);
    expect(store.writes.filter((name) => name === sessionCookie)).toEqual([]);
  });

  it('puts back the verifier of a sign-in that was already under way in this browser, exactly as it was', async () => {
    // Another tab started an ordinary sign-in: it left its verifier in the fixed cookie, its flow slot and the index.
    const other = await createSupabaseServerClient();
    expect((await requestGoogleSignIn(other, 'http://127.0.0.1:4173')).ok).toBe(true);
    const beforeFlow = verifierCookies();
    expect(beforeFlow.size).toBeGreaterThanOrEqual(3);

    await run();
    // The step-up's own start overwrote the fixed cookie and the index and added a slot; all of that is undone.
    expect(verifierCookies()).toEqual(beforeFlow);
  });
});

describe('when a step-up does not start for a reason other than the database', () => {
  it('removes the verifier cookie when the Google sign-in it built cannot be bound (no S256 challenge)', async () => {
    // Auth hands back a URL without an S256 challenge: the sign-in cannot be bound to a nonce.
    vi.spyOn(await import('@/lib/sign-in'), 'requestGoogleSignIn').mockImplementation(async (client) => {
      // Write a verifier the way the real start does, then answer with a URL that cannot be bound.
      await (client as {auth: {signInWithOAuth(c: unknown): Promise<unknown>}}).auth.signInWithOAuth({provider: 'google', options: {redirectTo: 'http://127.0.0.1:4173/auth/callback'}});
      return {ok: true, url: 'http://127.0.0.1:54321/auth/v1/authorize?code_challenge=abc&code_challenge_method=plain'};
    });
    expect(await beginStepUp('administration', idle)).toEqual({outcome: 'unavailable'});
    expect([...verifierCookies().keys()]).toEqual([]);
    expect(calls).not.toContain('/rest/v1/rpc/start_step_up');
  });
});

describe('restoreVerifierCookies', () => {
  const fixed = `${sessionCookie}-code-verifier`;

  it('touches only verifier cookies, whatever it is told was written (never the session cookie, never another project\'s)', async () => {
    const other = 'sb-someoneelse-auth-token-code-verifier';
    store.jar.set(fixed, '"old"');
    store.jar.set(other, '"theirs"');
    const before = await snapshotVerifierCookies();
    expect([...before.keys()]).toEqual([fixed]);
    store.jar.set(fixed, '"new"');
    const session = store.jar.get(sessionCookie);
    store.writes = [];
    await restoreVerifierCookies(before, [fixed, sessionCookie, other, 'nova3d-locale', stepUpCookieName]);
    expect(store.jar.get(fixed)).toBe('"old"');
    expect(store.jar.get(sessionCookie)).toBe(session);
    expect(store.jar.get(other)).toBe('"theirs"');
    expect(store.writes).toEqual([fixed]);
  });

  it('puts a displaced verifier back with the attributes @supabase/ssr gives its cookies, and removes one that was not there before', async () => {
    store.jar.set(fixed, '"old"');
    const slot = `${sessionCookie}-flow-0123456789abcdef-code-verifier`;
    const before = await snapshotVerifierCookies();
    store.jar.set(fixed, '"new"');
    store.jar.set(slot, '"added"');
    await restoreVerifierCookies(before, [fixed, slot]);
    expect(store.jar.get(fixed)).toBe('"old"');
    expect(store.options.get(fixed)).toEqual({path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60});
    expect(store.jar.has(slot)).toBe(false);
  });

  it('knows a verifier cookie by exact name only', () => {
    const base = sessionCookie;
    for (const name of [`${base}-code-verifier`, `${base}-flows-code-verifier`, `${base}-flow-abcdefgh-code-verifier`, `${base}-flow-A_b-c_d-e0-code-verifier`]) expect(isPkceVerifierCookieName(name, SUPABASE), name).toBe(true);
    for (const name of [base, `${base}.0`, `${base}-flow-short-code-verifier`, `${base}-code-verifier.0`, `x${base}-code-verifier`, `${base}-code-verifierx`, 'nova3d-step-up', 'sb-other-auth-token-code-verifier']) {
      expect(isPkceVerifierCookieName(name, SUPABASE), name).toBe(false);
    }
    expect(isPkceVerifierCookieName(`${base}-code-verifier`, '')).toBe(false);
  });
});
