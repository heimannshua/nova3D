import {createHmac, randomBytes} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

// Administrator recovery's two Server Actions (Story 1.6, app/recover/actions.ts) with the REAL collaborators: lib/recovery.ts,
// lib/accounts.ts, lib/auth-admin.ts, lib/mailer.ts and the real server Supabase client (@supabase/ssr and auth-js), over a
// stubbed network and an in-memory cookie store, the way tests/unit/auth-callback-real-client.test.ts runs the sign-in callback.
// What is stubbed is everything outside the process: the accounts API (check_recovery, redeem_recovery, issue_recovery,
// void_recovery), Auth (Admin generate_link, verify, user, logout) and the mail provider (Resend, Mailpit). So this is where the
// ORDER of requests, what a browser's cookies hold at each moment, what is ended on each failure, and what is printed are checked.
class Redirected extends Error {
  readonly to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}
const store = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  writes: [] as {name: string; value: string}[],
  deleted: [] as string[],
  headers: new Map<string, string>(),
  /** Makes `cookies().set` throw, as it does outside a Server Action or when the response is already sent. */
  failWrites: false,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...store.jar].map(([name, value]) => ({name, value})),
    get: (name: string) => (store.jar.has(name) ? {name, value: store.jar.get(name)} : undefined),
    // @supabase/ssr removes a cookie by setting it empty.
    set: (name: string, value: string) => {
      if (store.failWrites) throw new Error('Cookies can only be modified in a Server Action or Route Handler.');
      store.writes.push({name, value});
      if (value === '') store.jar.delete(name);
      else store.jar.set(name, value);
    },
    delete: (name: string) => {
      store.deleted.push(name);
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

import {redeemRecovery, requestRecovery} from '@/app/recover/actions';
import {isRecoveryToken} from '@/lib/accounts';
import {recheckDelaysMs} from '@/lib/recovery';
import {recoveryAdministratorEmail} from '../support/recovery-env';
import {sessionCookieName, signAccessToken} from '../support/session-cookie';

const SUPABASE = 'http://127.0.0.1:54321';
const SERVICE_KEY = 'service-role-key-must-never-be-printed';
const ANON_KEY = 'anon-key';
const RECOVERY_KEY = randomBytes(32);
const JWT_SECRET = 'unit-test-jwt-secret-with-at-least-32-characters';
const ADMIN = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_USER = '1c0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c99';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const OLD_SESSION_COOKIE = 'base64-an-old-session-cookie-the-browser-sent';
const HASHED_LINK_TOKEN = 'hashed-link-token-from-auth-must-never-be-printed';
const cookieName = sessionCookieName(SUPABASE);
const csrfCookie = 'nova3d-csrf';
const aToken = () => randomBytes(32).toString('base64url');
const hashOf = (token: string) => createHmac('sha256', RECOVERY_KEY).update(`nova3d/recovery-token/v1\0${token}`).digest('hex');

type Call = {method: string; path: string; search: string; body: string; headers: Record<string, string>};
type Net = {
  check: 'valid' | 'unknown' | 'used' | 'expired' | 'voided' | 'administrator' | 'down';
  generate: 'ok' | 'refused' | 'down' | 'other-user';
  verify: 'ok' | 'refused' | 'down';
  user: 'ok' | 'not-google' | 'other-user' | 'down';
  redeem: 'redeemed' | 'used' | 'administrator' | 'unknown' | 'rejected' | 'down' | 'unavailable';
  sessionsEnded: number;
  issue: 'issued' | 'limited' | 'refused' | 'down';
  void: 'voided' | 'recorded' | 'down';
  mail: 'sent' | 'refused' | 'error' | 'down' | 'timeout';
};
let net: Net;
let calls: Call[];
/** What the cookie jar held at the moment the accounts API was asked to redeem. */
let jarAtRedeem: string[] | null;
let printed: string[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const authUser = (id = ADMIN, google = true) => ({
  id, aud: 'authenticated', role: 'authenticated', email: recoveryAdministratorEmail, email_confirmed_at: '2026-10-10T00:00:00Z',
  app_metadata: google ? {provider: 'google', providers: ['google']} : {provider: 'email', providers: ['email']}, user_metadata: {email_verified: true}, identities: [],
  created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', is_anonymous: false,
});
// One token per test: the same second's `iat` for every use, so a comparison cannot differ by a tick.
let minted: string | null = null;
const mintedToken = () => (minted ??= signAccessToken({supabaseUrl: SUPABASE, userId: ADMIN, email: recoveryAdministratorEmail, sessionId: SESSION, jwtSecret: JWT_SECRET}));

async function stubbedFetch(input: unknown, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : (input as Request).url);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  calls.push({method: init.method ?? 'GET', path: url.pathname, search: url.search, body: typeof init.body === 'string' ? init.body : '', headers});
  const down = () => {
    throw new TypeError('fetch failed');
  };

  // The mail providers.
  if (url.host === 'api.resend.com' || url.port === '54324') {
    if (net.mail === 'down') return down();
    if (net.mail === 'timeout') throw Object.assign(new Error('timed out'), {name: 'TimeoutError'});
    if (net.mail === 'refused') return json({message: 'refused'}, 422);
    if (net.mail === 'error') return json({message: 'broken'}, 500);
    return json({id: 'message-id'});
  }

  if (url.pathname === '/rest/v1/rpc/check_recovery') {
    if (net.check === 'down') return down();
    return json(net.check === 'valid' ? {outcome: 'valid', user_id: ADMIN, email: recoveryAdministratorEmail} : {outcome: net.check, user_id: null, email: null});
  }
  if (url.pathname === '/auth/v1/admin/generate_link') {
    if (net.generate === 'down') return down();
    if (net.generate === 'refused') return json({code: 422, error_code: 'email_provider_disabled', msg: 'refused'}, 422);
    return json({id: net.generate === 'other-user' ? OTHER_USER : ADMIN, email: recoveryAdministratorEmail, hashed_token: HASHED_LINK_TOKEN, email_otp: '123456', action_link: `${SUPABASE}/auth/v1/verify?token=${HASHED_LINK_TOKEN}`, verification_type: 'magiclink'});
  }
  if (url.pathname === '/auth/v1/verify') {
    if (net.verify === 'down') return down();
    if (net.verify === 'refused') return json({code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired'}, 403);
    const issuedAt = Math.floor(Date.now() / 1000);
    return json({access_token: mintedToken(), token_type: 'bearer', expires_in: 3600, expires_at: issuedAt + 3600, refresh_token: 'minted-refresh-token', user: authUser()});
  }
  if (url.pathname === '/auth/v1/user') {
    if (net.user === 'down') return down();
    return json(authUser(net.user === 'other-user' ? OTHER_USER : ADMIN, net.user !== 'not-google'));
  }
  if (url.pathname === '/auth/v1/logout') return new Response(null, {status: 204});
  if (url.pathname === '/rest/v1/rpc/redeem_recovery') {
    jarAtRedeem = [...store.jar.keys()];
    if (net.redeem === 'down') return down();
    if (net.redeem === 'unavailable') return json({message: 'the database is down'}, 503);
    if (net.redeem === 'rejected') return json({code: '22023', message: 'invalid argument'}, 400);
    if (net.redeem === 'redeemed') return json({outcome: 'redeemed', sessions_ended: net.sessionsEnded, epoch: 4});
    return json({outcome: net.redeem === 'unknown' ? 'unknown' : net.redeem, sessions_ended: null, epoch: null});
  }
  if (url.pathname === '/rest/v1/rpc/issue_recovery') {
    if (net.issue === 'down') return down();
    return json({outcome: net.issue, expires_at: net.issue === 'issued' ? '2026-10-12T15:15:00Z' : null});
  }
  if (url.pathname === '/rest/v1/rpc/void_recovery') {
    if (net.void === 'down') return down();
    return json({outcome: net.void});
  }
  throw new Error(`unexpected request to ${url.pathname}`);
}

const rpc = (name: string) => calls.filter((call) => call.path === `/rest/v1/rpc/${name}`);
const auth = (path: string) => calls.filter((call) => call.path === `/auth/v1/${path}`);
const order = () =>
  calls.map((call) => {
    if (call.path === '/api/v1/send') return 'mail:mailpit';
    if (call.path === '/emails') return 'mail:resend';
    return call.path.replace('/rest/v1/rpc/', 'rpc:').replace('/auth/v1/', 'auth:');
  });

beforeEach(() => {
  net = {check: 'valid', generate: 'ok', verify: 'ok', user: 'ok', redeem: 'redeemed', sessionsEnded: 2, issue: 'issued', void: 'voided', mail: 'sent'};
  calls = [];
  minted = null;
  jarAtRedeem = null;
  printed = [];
  store.jar.clear();
  store.writes.length = 0;
  store.deleted.length = 0;
  store.failWrites = false;
  store.headers.clear();
  // The browser holds an old session and its CSRF token.
  store.jar.set(cookieName, OLD_SESSION_COOKIE);
  store.jar.set(csrfCookie, 'a-csrf-token-of-the-old-session');
  store.headers.set('host', '127.0.0.1:4173');
  vi.stubGlobal('fetch', vi.fn(stubbedFetch));
  vi.stubEnv('APP_ENV', 'local');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', ANON_KEY);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);
  vi.stubEnv('RECOVERY_HASH_KEY', RECOVERY_KEY.toString('base64'));
  vi.stubEnv('ADMINISTRATOR_EMAIL', recoveryAdministratorEmail);
  vi.stubEnv('APP_ORIGIN', undefined as unknown as string);
  vi.stubEnv('RESEND_API_KEY', undefined as unknown as string);
  const capture = (...args: unknown[]) => {
    printed.push(args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  vi.spyOn(console, 'error').mockImplementation(capture);
  vi.spyOn(console, 'warn').mockImplementation(capture);
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'info').mockImplementation(capture);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const form = (token: string) => {
  const data = new FormData();
  data.set('token', token);
  return data;
};
const idleRequest = {outcome: 'idle'} as const;
const idleRedeem = {outcome: 'idle'} as const;
const redirectedTo = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    if (error instanceof Redirected) return error.to;
    throw error;
  }
  return null;
};
/** Nothing a person or a log could read holds a secret: the token, the hash, the link's hashed token, the keys, a cookie value. */
const secretsIn = (text: string, token: string) => [token, hashOf(token), HASHED_LINK_TOKEN, SERVICE_KEY, ANON_KEY, RECOVERY_KEY.toString('base64'), OLD_SESSION_COOKIE].filter((secret) => text.includes(secret));

// ---------------------------------------------------------------------------------------------------
describe('requestRecovery (/recover)', () => {
  const sent = () => calls.filter((call) => call.path === '/api/v1/send' || call.path === '/emails');

  it('issues a token, mails its link to the configured address through the stack\'s Mailpit locally, and answers only that it was sent', async () => {
    store.headers.set('host', '127.0.0.1:4173');
    const state = await requestRecovery(idleRequest);
    expect(state).toEqual({outcome: 'sent'});
    // Issue first, then mail. Nothing else is asked: no check, no Auth, no void.
    expect(order()).toEqual(['rpc:issue_recovery', 'mail:mailpit']);
    const issued = JSON.parse(rpc('issue_recovery')[0].body);
    // The address is the server's, never an argument: lower case, from ADMINISTRATOR_EMAIL.
    expect(Object.keys(issued).sort()).toEqual(['p_administrator_email', 'p_token_hash']);
    expect(issued.p_administrator_email).toBe(recoveryAdministratorEmail);
    expect(issued.p_token_hash).toMatch(/^[0-9a-f]{64}$/);

    const [mail] = sent();
    expect(mail.method).toBe('POST');
    expect(mail.path).toBe('/api/v1/send');
    const body = JSON.parse(mail.body);
    expect(body.To).toEqual([{Email: recoveryAdministratorEmail}]);
    const link = /http:\/\/127\.0\.0\.1:4173\/recover\/confirm#([A-Za-z0-9_-]{43})/.exec(body.Text);
    expect(link).not.toBeNull();
    const token = link![1];
    expect(isRecoveryToken(token)).toBe(true);
    // The database was given the keyed hash of exactly that token, and the HTML carries the same link.
    expect(issued.p_token_hash).toBe(hashOf(token));
    expect(body.HTML).toContain(`/recover/confirm#${token}`);
    expect(secretsIn(printed.join('\n'), token)).toEqual([]);
    expect(printed.join('\n')).not.toContain(token);
  });

  it('uses APP_ORIGIN, never the request, for the link in staging and production, and Resend as the transport', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('APP_ORIGIN', 'https://nova3d-staging.example.test');
    vi.stubEnv('RESEND_API_KEY', 'resend-key-must-never-be-printed');
    // A request that claims another host (a forged Host or forwarding header) cannot choose where the link points.
    store.headers.set('host', 'evil.example.test');
    store.headers.set('x-forwarded-host', 'evil.example.test');
    store.headers.set('x-forwarded-proto', 'https');
    expect(await requestRecovery(idleRequest)).toEqual({outcome: 'sent'});
    const [mail] = sent();
    expect(mail.path).toBe('/emails');
    expect(mail.headers.authorization).toBe('Bearer resend-key-must-never-be-printed');
    const body = JSON.parse(mail.body);
    expect(body.to).toEqual([recoveryAdministratorEmail]);
    expect(body.text).toMatch(/^[\s\S]*https:\/\/nova3d-staging\.example\.test\/recover\/confirm#[A-Za-z0-9_-]{43}[\s\S]*$/m);
    expect(JSON.stringify(body)).not.toContain('evil.example.test');
    expect(printed.join('\n')).not.toContain('resend-key-must-never-be-printed');
  });

  it('issues nothing and mails nothing when staging has no usable APP_ORIGIN: an issuance that cannot be mailed would only spend the limit', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    for (const value of [undefined, '', 'http://nova3d-staging.example.test', 'https://nova3d-staging.example.test/path', '<staging-app-origin>']) {
      calls = [];
      vi.stubEnv('APP_ORIGIN', value as string);
      expect(await requestRecovery(idleRequest), String(value)).toEqual({outcome: 'unavailable'});
      expect(calls, String(value)).toEqual([]);
    }
  });

  it('is limited when the database says so, and mails nothing', async () => {
    net.issue = 'limited';
    expect(await requestRecovery(idleRequest)).toEqual({outcome: 'limited'});
    expect(order()).toEqual(['rpc:issue_recovery']);
  });

  it('reads unavailable, and mails nothing, when there is no eligible Administrator (the audit holds the cause)', async () => {
    net.issue = 'refused';
    expect(await requestRecovery(idleRequest)).toEqual({outcome: 'unavailable'});
    expect(order()).toEqual(['rpc:issue_recovery']);
    expect(printed.join('\n')).toMatch(/Recovery was not issued/);
  });

  it('reads unavailable, mails nothing and prints nothing but a name when the database does not answer', async () => {
    net.issue = 'down';
    expect(await requestRecovery(idleRequest)).toEqual({outcome: 'unavailable'});
    expect(order()).toEqual(['rpc:issue_recovery']);
    expect(printed.join('\n')).toContain('AccountsUnavailableError');
  });

  it('reads unavailable, and the token is voided, when the mail provider definitively refuses', async () => {
    net.mail = 'refused';
    expect(await requestRecovery(idleRequest)).toEqual({outcome: 'unavailable'});
    expect(order()).toEqual(['rpc:issue_recovery', 'mail:mailpit', 'rpc:void_recovery']);
    const issued = JSON.parse(rpc('issue_recovery')[0].body);
    expect(JSON.parse(rpc('void_recovery')[0].body)).toEqual({p_token_hash: issued.p_token_hash, p_definitive: true});
    expect(printed.join('\n')).toContain('refused (provider_refused)');
  });

  it.each(['error', 'down', 'timeout'] as const)('reads unavailable but does NOT void the token when the mail provider fails with an unknown outcome (%s): the mail may have gone out', async (failure) => {
    net.mail = failure;
    expect(await requestRecovery(idleRequest)).toEqual({outcome: 'unavailable'});
    expect(order()).toEqual(['rpc:issue_recovery', 'mail:mailpit', 'rpc:void_recovery']);
    expect(JSON.parse(rpc('void_recovery')[0].body).p_definitive).toBe(false);
  });

  it('still reads unavailable when the failed mail cannot be recorded either, and prints only names', async () => {
    net.mail = 'refused';
    net.void = 'down';
    expect(await requestRecovery(idleRequest)).toEqual({outcome: 'unavailable'});
    expect(printed.join('\n')).toContain('The failed recovery mail could not be recorded.');
    const token = /#([A-Za-z0-9_-]{43})/.exec(JSON.parse(sent()[0].body).Text)![1];
    expect(secretsIn(printed.join('\n'), token)).toEqual([]);
  });

  it('answers the same words whatever the cause, so nothing is learned from them', async () => {
    const answers = new Set<string>();
    for (const setup of [() => (net.issue = 'refused'), () => (net.issue = 'down'), () => ((net.issue = 'issued'), (net.mail = 'refused')), () => (net.mail = 'down')]) {
      net = {...net, issue: 'issued', mail: 'sent'};
      setup();
      answers.add(JSON.stringify(await requestRecovery(idleRequest)));
    }
    expect([...answers]).toEqual([JSON.stringify({outcome: 'unavailable'})]);
  });

  it('takes nothing from the request but where it came in: no argument, no form, no header but the host', async () => {
    store.headers.set('x-administrator-email', 'someone-else@example.test');
    store.headers.set('referer', 'https://evil.example.test/recover');
    await requestRecovery(idleRequest);
    const everything = calls.map((call) => `${call.path} ${call.body}`).join('\n');
    expect(everything).not.toContain('someone-else@example.test');
    expect(everything).not.toContain('evil.example.test');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('redeemRecovery (/recover/confirm)', () => {
  it('checks, makes the link, verifies it, reads the user, redeems, writes the cookies only then, clears the CSRF cookie and goes to Administration', async () => {
    const token = aToken();
    const to = await redirectedTo(redeemRecovery(idleRedeem, form(token)));
    expect(to).toBe('/admin?recovered=2');
    expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link', 'auth:verify', 'auth:user', 'rpc:redeem_recovery']);

    // The check asks about this token's keyed hash and the server's own address.
    expect(JSON.parse(rpc('check_recovery')[0].body)).toEqual({p_token_hash: hashOf(token), p_administrator_email: recoveryAdministratorEmail});
    // Auth's Admin API is asked for a magic link for the Auth user's own address (the check's answer), by the service role.
    const generated = auth('admin/generate_link')[0];
    expect(JSON.parse(generated.body)).toEqual({type: 'magiclink', email: recoveryAdministratorEmail});
    expect(generated.headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    // The link's hashed token is verified as a magic link, with the anon key (a session is minted for a person, not the service).
    const verified = auth('verify')[0];
    expect(JSON.parse(verified.body)).toMatchObject({token_hash: HASHED_LINK_TOKEN, type: 'magiclink'});
    expect(verified.headers.apikey).toBe(ANON_KEY);
    // The user is Auth's, read with the minted access token.
    expect(auth('user')[0].headers.authorization).toBe(`Bearer ${mintedToken()}`);
    // The transaction gets the user and the session of that token (never anything the request said), and the keyed hash of the token.
    expect(JSON.parse(rpc('redeem_recovery')[0].body)).toEqual({p_token_hash: hashOf(token), p_administrator_email: recoveryAdministratorEmail, p_user_id: ADMIN, p_session_id: SESSION});

    // Until the transaction answered, the browser's cookies were exactly what it sent; afterwards the minted session replaced them.
    expect(jarAtRedeem).toEqual([cookieName, csrfCookie]);
    expect(store.jar.get(cookieName)).not.toBe(OLD_SESSION_COOKIE);
    expect(store.jar.get(cookieName)).toMatch(/^base64-/);
    // The old session's CSRF cookie is gone with it.
    expect(store.deleted).toContain(csrfCookie);
    expect(store.jar.has(csrfCookie)).toBe(false);
    // Nothing was ended: the new session is the person's.
    expect(auth('logout')).toEqual([]);
    // Nothing printed holds a secret, and no URL ever carried the token.
    expect(secretsIn(printed.join('\n'), token)).toEqual([]);
    expect(calls.filter((call) => call.path.includes(token) || call.search.includes(token))).toEqual([]);
  });

  it('says how many other sessions it ended, and none when there were none', async () => {
    net.sessionsEnded = 0;
    expect(await redirectedTo(redeemRecovery(idleRedeem, form(aToken())))).toBe('/admin?recovered=0');
  });

  describe('a link that cannot be redeemed', () => {
    it.each(['unknown', 'used', 'expired', 'voided', 'administrator'] as const)('is refused at the check when %s, with one answer, before anything is made', async (outcome) => {
      net.check = outcome;
      const state = await redeemRecovery(idleRedeem, form(aToken()));
      expect(state).toEqual({outcome: 'invalid'});
      // No link, no session, no transaction, no cookie, nothing ended.
      expect(order()).toEqual(['rpc:check_recovery']);
      expect(store.writes).toEqual([]);
      expect(store.jar.get(cookieName)).toBe(OLD_SESSION_COOKIE);
    });

    it('is refused the same way when the form carries nothing, or something that is not a token', async () => {
      net.check = 'unknown';
      for (const field of ['', 'short', 'x'.repeat(5000), '<script>', 'é'.repeat(43)]) {
        calls = [];
        expect(await redeemRecovery(idleRedeem, form(field)), field.slice(0, 20)).toEqual({outcome: 'invalid'});
        expect(order()).toEqual(['rpc:check_recovery']);
        // What reaches the database is a keyed hash of a bounded part of it, never the text.
        expect(rpc('check_recovery')[0].body).not.toContain('<script>');
      }
      calls = [];
      const empty = new FormData();
      expect(await redeemRecovery(idleRedeem, empty)).toEqual({outcome: 'invalid'});
      expect(JSON.parse(rpc('check_recovery')[0].body).p_token_hash).toBe(hashOf(''));
    });
  });

  describe('when a service does not answer BEFORE a session is made', () => {
    it('is retryable and changes nothing when the check does not answer', async () => {
      net.check = 'down';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(order()).toEqual(['rpc:check_recovery']);
      expect(store.writes).toEqual([]);
    });

    it('is retryable and makes no session when Auth\'s Admin API refuses the link (hosted Auth refusing it reads like this)', async () => {
      net.generate = 'refused';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link']);
      expect(store.writes).toEqual([]);
      expect(printed.join('\n')).toContain('AuthAdminError');
    });

    it('is retryable when Auth does not answer for the link', async () => {
      net.generate = 'down';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link']);
    });

    it('verifies nothing when Auth made the link for another user than the one the check named', async () => {
      net.generate = 'other-user';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link']);
    });

    it('makes no session, and is retryable, when Auth does not answer to the verification', async () => {
      net.verify = 'down';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link', 'auth:verify']);
      expect(store.writes).toEqual([]);
    });

    it('asks again when Auth refuses a link it just made, and says the one bad-link message if the token has been used since (the other window won)', async () => {
      net.verify = 'refused';
      let asked = 0;
      const answers: Net['check'][] = ['valid', 'used'];
      const base = stubbedFetch;
      vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const path = new URL(typeof input === 'string' ? input : (input as Request).url).pathname;
        if (path === '/rest/v1/rpc/check_recovery') net.check = answers[Math.min(asked++, answers.length - 1)];
        return base(input, init);
      }));
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'invalid'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link', 'auth:verify', 'rpc:check_recovery']);
      expect(store.writes).toEqual([]);
      expect(auth('logout')).toEqual([]);
    });

    it('says try again, after asking a few more times, when Auth refuses the link and the token stays valid', async () => {
      net.verify = 'refused';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link', 'auth:verify', ...recheckDelaysMs.map(() => 'rpc:check_recovery')]);
      expect(store.writes).toEqual([]);
    });
  });

  describe('when the session that was made cannot be used: it is ended, and only it', () => {
    const endedLocally = () => {
      const [logout] = auth('logout');
      expect(logout, 'the session was ended').toBeDefined();
      // Local scope and the minted session's own token: never a global sign-out, never the browser's old session.
      expect(logout.search).toBe('?scope=local');
      expect(logout.headers.authorization).toBe(`Bearer ${mintedToken()}`);
      expect(auth('logout')).toHaveLength(1);
    };

    it('ends it and redeems nothing when the user is not a Google identity', async () => {
      net.user = 'not-google';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link', 'auth:verify', 'auth:user', 'auth:logout', 'rpc:check_recovery']);
      endedLocally();
      expect(store.writes).toEqual([]);
    });

    it('says the one bad-link message when its session was lost because another window recovered first: the token is used by then', async () => {
      net.user = 'down';
      let asked = 0;
      const base = stubbedFetch;
      vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const path = new URL(typeof input === 'string' ? input : (input as Request).url).pathname;
        if (path === '/rest/v1/rpc/check_recovery') net.check = asked++ === 0 ? 'valid' : 'used';
        return base(input, init);
      }));
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'invalid'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link', 'auth:verify', 'auth:user', 'auth:logout', 'rpc:check_recovery']);
      endedLocally();
      expect(store.writes).toEqual([]);
    });

    it('ends it and redeems nothing when the user is not the one the check named', async () => {
      net.user = 'other-user';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(rpc('redeem_recovery')).toEqual([]);
      endedLocally();
    });

    it('ends it when Auth cannot vouch for it', async () => {
      net.user = 'down';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(rpc('redeem_recovery')).toEqual([]);
      endedLocally();
      expect(store.writes).toEqual([]);
    });

    it.each(['used', 'administrator'] as const)('ends it and leaves the browser\'s cookies as they were when the transaction refuses (%s): the loser of a race', async (outcome) => {
      net.redeem = outcome;
      const state = await redeemRecovery(idleRedeem, form(aToken()));
      expect(state).toEqual({outcome: 'invalid'});
      expect(order()).toEqual(['rpc:check_recovery', 'auth:admin/generate_link', 'auth:verify', 'auth:user', 'rpc:redeem_recovery', 'auth:logout']);
      endedLocally();
      // Not one cookie was written or removed: a window that lost leaves nothing over the winner's session in a shared cookie jar.
      expect(store.writes).toEqual([]);
      expect(store.deleted).toEqual([]);
      expect(store.jar.get(cookieName)).toBe(OLD_SESSION_COOKIE);
      expect(store.jar.get(csrfCookie)).toBe('a-csrf-token-of-the-old-session');
    });

    it('ends it when the database understood the transaction and rejected the call (it certainly did not commit)', async () => {
      net.redeem = 'rejected';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      endedLocally();
      expect(store.writes).toEqual([]);
    });
  });

  describe('when the database does not answer AFTER the transaction was handed to it', () => {
    it.each(['down', 'unavailable'] as const)('keeps the session, writes its cookies and tells the person to open Administration (%s): it may have committed', async (failure) => {
      net.redeem = failure;
      const state = await redeemRecovery(idleRedeem, form(aToken()));
      expect(state).toEqual({outcome: 'unknown'});
      // Not ended: if it did commit, this session is the person's way in.
      expect(auth('logout')).toEqual([]);
      expect(store.jar.get(cookieName)).toMatch(/^base64-/);
      expect(store.jar.get(cookieName)).not.toBe(OLD_SESSION_COOKIE);
      // ... and the CSRF cookie of the old session is gone either way.
      expect(store.jar.has(csrfCookie)).toBe(false);
    });
  });

  describe('when the transaction was never sent, nothing can have committed: the session ends, no cookie is written, the token is untouched', () => {
    const endedLocally = () => {
      expect(auth('logout')).toHaveLength(1);
      expect(auth('logout')[0].search).toBe('?scope=local');
      expect(auth('logout')[0].headers.authorization).toBe(`Bearer ${mintedToken()}`);
    };

    it('does not send it when the recovery settings are unusable by then, and ends the session', async () => {
      // The environment loses the Administrator address between the user being read and the transaction being asked for.
      const base = stubbedFetch;
      vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const path = new URL(typeof input === 'string' ? input : (input as Request).url).pathname;
        const answer = await base(input, init);
        if (path === '/auth/v1/user') vi.stubEnv('ADMINISTRATOR_EMAIL', '');
        return answer;
      }));
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(rpc('redeem_recovery')).toEqual([]);
      endedLocally();
      expect(store.writes).toEqual([]);
      expect(store.deleted).toEqual([]);
      expect(store.jar.get(cookieName)).toBe(OLD_SESSION_COOKIE);
      expect(printed.join('\n')).toContain('AccountsConfigError');
    });

    it('does not send it when the budget was spent before it, and ends the session', async () => {
      // Reading the user takes longer than the whole budget (the clock jumps 20 s while Auth answers).
      let jump = 0;
      const realNow = Date.now.bind(Date);
      vi.spyOn(Date, 'now').mockImplementation(() => realNow() + jump);
      const base = stubbedFetch;
      vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const path = new URL(typeof input === 'string' ? input : (input as Request).url).pathname;
        const answer = await base(input, init);
        if (path === '/auth/v1/user') jump = 20_000;
        return answer;
      }));
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unavailable'});
      expect(rpc('redeem_recovery')).toEqual([]);
      endedLocally();
      expect(store.writes).toEqual([]);
      expect(store.jar.get(cookieName)).toBe(OLD_SESSION_COOKIE);
      expect(printed.join('\n')).toContain('no time left in the budget');
    });
  });

  describe('when the session cookies cannot be written after the recovery happened', () => {
    it('says unknown, does not redirect, still clears the old session\'s CSRF cookie, and says so in the log', async () => {
      store.failWrites = true;
      const token = aToken();
      let state: unknown = null;
      const to = await redirectedTo(redeemRecovery(idleRedeem, form(token)).then((answer) => {
        state = answer;
        return answer;
      }));
      // The transaction ran and committed, the session is the person's, but the browser cannot be given its cookies: no redirect to a page that
      // would find no session; the person is told to open Administration.
      expect(rpc('redeem_recovery')).toHaveLength(1);
      expect(to).toBeNull();
      expect(state).toEqual({outcome: 'unknown'});
      expect(store.deleted).toContain(csrfCookie);
      expect(store.jar.has(csrfCookie)).toBe(false);
      expect(store.writes).toEqual([]);
      expect(printed.join('\n')).toContain('The recovery session cookies could not be written.');
      expect(secretsIn(printed.join('\n'), token)).toEqual([]);
      // Nothing was ended: the session is the one that may be the person's way in.
      expect(auth('logout')).toEqual([]);
    });

    it('says the same when the recovery may have committed (unknown) and the cookies cannot be written either', async () => {
      store.failWrites = true;
      net.redeem = 'down';
      expect(await redeemRecovery(idleRedeem, form(aToken()))).toEqual({outcome: 'unknown'});
      expect(store.deleted).toContain(csrfCookie);
      expect(printed.join('\n')).toContain('could not be written');
    });
  });

  it('prints only names and fixed messages, whatever goes wrong, and never a secret', async () => {
    const token = aToken();
    const failures: Partial<Net>[] = [{check: 'down'}, {generate: 'refused'}, {generate: 'down'}, {verify: 'refused'}, {verify: 'down'}, {user: 'not-google'}, {user: 'down'}, {redeem: 'down'}, {redeem: 'rejected'}, {redeem: 'used'}];
    for (const failure of failures) {
      net = {...net, check: 'valid', generate: 'ok', verify: 'ok', user: 'ok', redeem: 'redeemed', ...failure};
      store.jar.set(cookieName, OLD_SESSION_COOKIE);
      await redeemRecovery(idleRedeem, form(token));
    }
    expect(printed.length).toBeGreaterThan(0);
    expect(secretsIn(printed.join('\n'), token)).toEqual([]);
    expect(printed.join('\n')).not.toContain(recoveryAdministratorEmail);
  });
});
