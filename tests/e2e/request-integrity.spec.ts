import {randomUUID} from 'node:crypto';
import {expect, test, type APIResponse, type Browser, type BrowserContext, type Page} from '@playwright/test';
import {stepUpUrl} from '../../lib/step-up';
import {csrfCookieName, csrfHeaderName, hashCsrfToken, newCsrfToken} from '../../lib/request-integrity';
import {readCsrfToken} from '../../lib/csrf-client';
import {addFakeAccount, chooserAccount, chooserUrl, fakeGoogleActive} from '../support/fake-google';
import {hydrated, label, mainNav, sessionCookies, signIn, stopAtAuth, stoppedAtAuth} from '../support/e2e-helpers';
import {callsFor, flakyBaseUrl, forgetCalls, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld, type ForgedUser} from '../support/forged-session';

// Story 1.4c: origin and CSRF checks for state-changing requests, in a real browser against the production
// build and the local Supabase stack. Each test forges a session (tests/support/forged-session.ts) and gives it a
// grant the way the callback does; Auth still validates the token, so the application's own proxy, authorization
// and token checks all run. Every flow runs on `desktop` and `phone`.
//
// The route mutation is the synthetic-only /api/kit/mutation: a counter per Account that a GET reports and a POST
// bumps, which is what lets a test see that a refused request changed nothing. A Server Action is replayed from
// the request the browser really made. "The database is unreachable" is made true for ONE user on the second
// application server (the same build, with tests/support/fake-network.mjs preloaded; see playwright.config.ts).

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const flaky = (baseURL: string, path = '/') => new URL(path, flakyBaseUrl(baseURL)).href;
const route = '/api/kit/mutation';
const evil = 'https://evil.example';
// What a browser sends when it navigates to a page.
const navigation = {'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', accept: 'text/html,application/xhtml+xml'};
const crossing = {timeout: 20_000};

/** A user with an Account and the grant of their forged session: what a signed-in member is. No CSRF token yet, as no page was requested. */
async function member(options: {grant?: boolean} = {}) {
  const user = await world.signedInUser();
  await world.activate(user, options);
  return user;
}

const csrfCookie = async (context: BrowserContext) => (await context.cookies()).find((cookie) => cookie.name === csrfCookieName);
const storedHash = async (user: {sessionId: string}) => (await world.grantOf(user.sessionId))?.csrf_hash ?? null;
const setCookiesOf = (response: APIResponse) => response.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value);
const csrfSetCookies = (response: APIResponse) => setCookiesOf(response).filter((value) => value.startsWith(`${csrfCookieName}=`));
/** The token the page's own script can read, the way the browser helper reads it. */
const tokenOnPage = async (page: Page) => readCsrfToken(await page.evaluate(() => document.cookie));

/** A route mutation made by the page's own script: a same-origin fetch, so the browser sets Origin and the fetch metadata itself. */
const mutate = (page: Page, token: string | null, method = 'POST', path = route) =>
  page.evaluate(
    async ({path, token, method, header}) => {
      const response = await fetch(path, {method, headers: token === null ? {} : {[header]: token}, credentials: 'same-origin'});
      return {status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json()};
    },
    {path, token, method, header: csrfHeaderName},
  );
const counter = async (page: Page) => (await mutate(page, null, 'GET')).body.count as number;

/** A signed-in member's page, loaded, so the proxy has handed the browser its token. */
async function signedInPage(page: Page, context: BrowserContext, baseURL: string, user?: ForgedUser) {
  const who = user ?? (await member());
  await signIn(context, baseURL, who);
  await page.goto('/');
  const token = await tokenOnPage(page);
  expect(token, 'the first page request must hand the browser a token').not.toBeNull();
  return {user: who, token: token!};
}

// ---------------------------------------------------------------------------------------------------
test.describe('the CSRF cookie', () => {
  test('is issued on the first page request of a session: a cookie its own script can read, with only its hash stored on the grant', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    expect(await storedHash(user)).toBeNull();
    expect(await csrfCookie(context)).toBeUndefined();

    expect((await page.goto('/'))?.status()).toBe(200);
    const cookie = await csrfCookie(context);
    expect(cookie).toBeDefined();
    expect(cookie).toMatchObject({httpOnly: false, secure: false, sameSite: 'Lax', path: '/'});
    expect(cookie!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // A session cookie: it has no expiry of its own.
    expect(cookie!.expires).toBe(-1);
    // The page's script can read it, and nothing else about it.
    expect(await page.evaluate(() => document.cookie)).toContain(`${csrfCookieName}=${cookie!.value}`);
    expect(await tokenOnPage(page)).toBe(cookie!.value);

    // The database holds the hash of that token, not the token.
    const hash = await storedHash(user);
    expect(hash).toBe(await hashCsrfToken(cookie!.value));
    expect(hash).not.toContain(cookie!.value);
    const row = await world.db.query('select * from identity.session_grants where session_id = $1', [user.sessionId]);
    expect(JSON.stringify(row.rows[0])).not.toContain(cookie!.value);
  });

  test('is issued once: later page requests leave the cookie and the stored hash alone', async ({page, context, baseURL}) => {
    const {user, token} = await signedInPage(page, context, baseURL!);
    const first = (await world.grantOf(user.sessionId))!;
    for (const path of ['/projects', '/settings', '/progress', '/']) {
      await page.goto(path);
      expect((await csrfCookie(context))?.value, path).toBe(token);
    }
    await page.reload();
    expect((await csrfCookie(context))?.value).toBe(token);
    const last = (await world.grantOf(user.sessionId))!;
    expect(last.csrf_hash).toBe(first.csrf_hash);
    expect(last.csrf_issued_at!.getTime()).toBe(first.csrf_issued_at!.getTime());
  });

  test('is Secure only when the browser reached the application over https', async ({context, browser, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    const behind = await context.request.get('/', {headers: {...navigation, 'x-forwarded-proto': 'https'}});
    expect(behind.status()).toBe(200);
    const [secure] = csrfSetCookies(behind);
    // A page that sets one person's token is never stored by a shared cache: this is the header Next finally sends.
    expect(behind.headers()['cache-control']).toMatch(/\bprivate\b/);
    expect(behind.headers()['cache-control']).toMatch(/\bno-store\b/);
    expect(secure).toMatch(/Secure/i);
    expect(secure).toMatch(/SameSite=lax/i);
    expect(secure).toMatch(/Path=\//i);
    expect(secure).not.toMatch(/HttpOnly/i);
    // Another session, over plain http.
    const other = await member();
    const context2 = await browser.newContext({baseURL});
    try {
      await signIn(context2, baseURL!, other);
      const plain = await context2.request.get('/', {headers: navigation});
      expect(csrfSetCookies(plain)[0]).not.toMatch(/Secure/i);
    } finally {
      await context2.close();
    }
  });

  test('is given to a session whose grant has none (every grant made before this story) on its next page request, and not on a request that is not a page', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    expect(await storedHash(user)).toBeNull();
    // An /api call, a plain fetch, a client-side navigation and a prefetch are not page requests.
    const notPages = [
      await context.request.get(route),
      await context.request.get('/settings', {headers: {accept: '*/*'}}),
      await context.request.get('/settings', {headers: {'sec-fetch-dest': 'empty', rsc: '1'}}),
      await context.request.get('/settings', {headers: {'sec-fetch-dest': 'empty', rsc: '1', 'next-router-prefetch': '1'}}),
      await context.request.get('/settings', {headers: {'sec-fetch-dest': 'iframe', accept: 'text/html'}}),
      await context.request.get('/settings', {headers: {'sec-fetch-dest': 'script', accept: '*/*'}}),
    ];
    for (const response of notPages) expect(csrfSetCookies(response)).toEqual([]);
    expect(await storedHash(user)).toBeNull();
    expect(await csrfCookie(context)).toBeUndefined();

    await page.goto('/settings');
    const cookie = await csrfCookie(context);
    expect(cookie).toBeDefined();
    expect(await storedHash(user)).toBe(await hashCsrfToken(cookie!.value));
  });

  test('is not given to a request for /api, to an identity with no Account, or to anyone who is not let in', async ({context, baseURL}) => {
    const stranger = await world.signedInUser();
    await signIn(context, baseURL!, stranger);
    const registerPage = await context.request.get('/register', {headers: navigation});
    expect(registerPage.status()).toBe(200);
    expect(csrfSetCookies(registerPage)).toEqual([]);

    const ended = await member();
    await world.revokeGrant(ended, ended.sessionId);
    await context.clearCookies();
    await signIn(context, baseURL!, ended);
    const refused = await context.request.get('/settings', {headers: navigation, maxRedirects: 0});
    expect(refused.status()).toBe(307);
    expect(csrfSetCookies(refused)).toEqual([]);

    await context.clearCookies();
    const signedOut = await context.request.get('/settings', {headers: navigation, maxRedirects: 0});
    expect(signedOut.status()).toBe(307);
    expect(csrfSetCookies(signedOut)).toEqual([]);
    expect(await storedHash(ended)).toBeNull();
  });

  test('two page requests at once leave one token standing: the cookie the browser holds is the one the grant has', async ({browser, baseURL}) => {
    for (let round = 0; round < 3; round += 1) {
      const user = await member();
      const fresh = await browser.newContext({baseURL});
      try {
        await signIn(fresh, baseURL!, user);
        const responses = await Promise.all(Array.from({length: 4}, (_value, index) => fresh.request.get(index % 2 ? '/settings' : '/projects', {headers: navigation})));
        for (const response of responses) expect(response.status()).toBe(200);
        // Exactly one of them stored a hash and so exactly one delivered a cookie.
        expect(responses.flatMap(csrfSetCookies), `round ${round}`).toHaveLength(1);
        const cookie = await csrfCookie(fresh);
        expect(cookie, `round ${round}`).toBeDefined();
        expect(await storedHash(user), `round ${round}`).toBe(await hashCsrfToken(cookie!.value));
      } finally {
        await fresh.close();
      }
    }
  });

  test('a cookie lost less than a minute after it was issued is not replaced, and one lost for longer is', async ({page, context, baseURL}) => {
    const {user, token: first} = await signedInPage(page, context, baseURL!);
    const firstHash = await storedHash(user);

    await context.clearCookies({name: csrfCookieName});
    await page.goto('/projects');
    // The grant holds a token under a minute old, so no second one is made and none is delivered.
    expect(await csrfCookie(context)).toBeUndefined();
    expect(await storedHash(user)).toBe(firstHash);

    await world.ageCsrf(user.sessionId, 61);
    await page.goto('/projects');
    const replacement = await csrfCookie(context);
    expect(replacement).toBeDefined();
    expect(replacement!.value).not.toBe(first);
    expect(await storedHash(user)).toBe(await hashCsrfToken(replacement!.value));
    expect(await storedHash(user)).not.toBe(firstHash);
    // The new token works and the old one does not.
    expect((await mutate(page, replacement!.value)).status).toBe(200);
    expect(await mutate(page, first)).toMatchObject({status: 403, body: {error: 'csrf_invalid'}});
  });

  test('is issued to a page whose database call fails as a page without a cookie, never an error, and the next page request tries again', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    for (const mode of ['down', 'error'] as const) {
      const end = startOutage(user.id, {rpc: ['issue_csrf'], mode});
      try {
        const response = await page.goto(flaky(baseURL!, '/settings'));
        expect(response?.status(), mode).toBe(200);
        await expect(page.getByRole('main')).toBeVisible();
        expect(await csrfCookie(context), mode).toBeUndefined();
        expect(await storedHash(user), mode).toBeNull();
      } finally {
        end();
      }
    }
    await page.goto(flaky(baseURL!, '/settings'));
    const cookie = await csrfCookie(context);
    expect(cookie).toBeDefined();
    expect(await storedHash(user)).toBe(await hashCsrfToken(cookie!.value));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a route mutation (not a Server Action)', () => {
  test('from the application\'s own origin with its session\'s token, succeeds and changes the state', async ({page, context, baseURL}) => {
    const {token} = await signedInPage(page, context, baseURL!);
    expect(await counter(page)).toBe(0);
    const first = await mutate(page, token);
    expect(first).toMatchObject({status: 200, body: {count: 1}});
    expect(await mutate(page, token)).toMatchObject({status: 200, body: {count: 2}});
    expect(await counter(page)).toBe(2);
    // The same request from a client that is not a page, with the browser's cookies, its own origin and the token: also fine.
    const response = await context.request.post(route, {headers: {origin: baseURL!, [csrfHeaderName]: token}});
    expect([response.status(), await response.json()]).toEqual([200, {count: 3}]);
  });

  test('without the token, or with a wrong one, is refused as csrf_invalid before it changes anything', async ({page, context, baseURL}) => {
    const {token} = await signedInPage(page, context, baseURL!);
    for (const [name, sent] of [
      ['no token', null],
      ['an empty token', ''],
      ['a token that is not shaped like one', 'let-me-in'],
      ['a random token', newCsrfToken()],
      ['the token with a character changed', `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`],
      ['the token twice', `${token}${token}`],
      ['the token\'s hash', await hashCsrfToken(token)],
    ] as [string, string | null][]) {
      const answer = await mutate(page, sent);
      expect(answer, name).toMatchObject({status: 403, body: {error: 'csrf_invalid', retryable: false}});
    }
    expect(await counter(page)).toBe(0);
    expect((await mutate(page, token)).status).toBe(200);
  });

  test('is refused with the token of another session: another Account\'s, and another session of the same Account', async ({page, context, browser, baseURL}) => {
    const mine = await signedInPage(page, context, baseURL!);

    const bystander = await browser.newContext({baseURL});
    const sibling = await browser.newContext({baseURL});
    try {
      const theirs = await signedInPage(await bystander.newPage(), bystander, baseURL!);
      const second = await world.extraSession(mine.user);
      await world.grant(mine.user, second.sessionId);
      await signIn(sibling, baseURL!, {cookie: second.cookie});
      const siblingPage = await sibling.newPage();
      await siblingPage.goto('/');
      const siblingToken = await tokenOnPage(siblingPage);
      expect(siblingToken).not.toBeNull();
      expect(new Set([mine.token, theirs.token, siblingToken]).size).toBe(3);

      expect(await mutate(page, theirs.token)).toMatchObject({status: 403, body: {error: 'csrf_invalid'}});
      expect(await mutate(page, siblingToken)).toMatchObject({status: 403, body: {error: 'csrf_invalid'}});
      expect(await counter(page)).toBe(0);
      // Each works for its own session, and the counters are each Account's own.
      expect((await mutate(page, mine.token)).body.count).toBe(1);
      expect((await mutate(siblingPage, siblingToken)).body.count).toBe(2);
      expect((await mutate(await bystander.pages()[0], theirs.token)).body.count).toBe(1);
    } finally {
      await bystander.close();
      await sibling.close();
    }
  });

  test('from a foreign origin, a null origin, no origin or a cross-site fetch is refused as origin_not_allowed, even with the right token', async ({page, context, baseURL}) => {
    const {token} = await signedInPage(page, context, baseURL!);
    const attempts: [string, Record<string, string>][] = [
      ['a foreign origin', {origin: evil}],
      ['a host that starts with ours', {origin: `${baseURL}.evil.example`}],
      ['the same host on another port', {origin: baseURL!.replace(/:\d+$/, ':9')}],
      ['the literal null', {origin: 'null'}],
      ['no Origin at all', {}],
      ['our Origin but a cross-site fetch', {origin: baseURL!, 'sec-fetch-site': 'cross-site'}],
    ];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const [name, headers] of attempts) {
        const response = await context.request.fetch(route, {method, headers: {...headers, [csrfHeaderName]: token}, maxRedirects: 0});
        expect(response.status(), `${method} ${name}`).toBe(403);
        expect(response.headers()['content-type']).toMatch(/^application\/json/);
        expect(response.headers()['location']).toBeUndefined();
        expect(await response.json(), `${method} ${name}`).toEqual({error: 'origin_not_allowed', retryable: false});
      }
    }
    expect(await counter(page)).toBe(0);
    // The same request from our own origin succeeds.
    const ok = await context.request.post(route, {headers: {origin: baseURL!, [csrfHeaderName]: token}});
    expect([ok.status(), await ok.json()]).toEqual([200, {count: 1}]);
  });

  test('does not check a safe method: a GET from anywhere is let through', async ({page, context, baseURL}) => {
    await signedInPage(page, context, baseURL!);
    const anywhere: Record<string, string>[] = [{origin: evil}, {origin: 'null'}, {}, {origin: evil, 'sec-fetch-site': 'cross-site'}];
    for (const headers of anywhere) {
      const response = await context.request.get(route, {headers});
      expect([response.status(), await response.json()], JSON.stringify(headers)).toEqual([200, {count: 0}]);
    }
    // HEAD and OPTIONS pass the origin check too (the route answers 405 or its own default, never the proxy's 403).
    for (const method of ['HEAD', 'OPTIONS']) {
      const response = await context.request.fetch(route, {method, headers: {origin: evil}});
      expect(response.status(), method).not.toBe(403);
      // There is no CORS anywhere: no answer, to any origin, grants another site anything.
      expect(Object.keys(response.headers()).filter((name) => name.startsWith('access-control-')), method).toEqual([]);
    }
  });

  test('keeps the answer of a request that is not let in at all: 401, 403 or a redirect, whatever its origin', async ({context, baseURL}) => {
    // Signed out.
    const post = await context.request.post(route, {headers: {origin: evil}, maxRedirects: 0});
    expect([post.status(), await post.json()]).toEqual([401, {error: 'not_signed_in', retryable: false}]);
    const bare = await context.request.post(route, {maxRedirects: 0});
    expect(bare.status()).toBe(401);
    const action = await context.request.post('/settings', {headers: {origin: evil}, maxRedirects: 0});
    expect(action.status()).toBe(303);
    expect(new URL(action.headers()['location'], baseURL!).pathname + new URL(action.headers()['location'], baseURL!).search).toBe('/login?error=not_signed_in');

    // No Account.
    const stranger = await world.signedInUser();
    await signIn(context, baseURL!, stranger);
    const noAccount = await context.request.post(route, {headers: {origin: evil}, maxRedirects: 0});
    expect([noAccount.status(), await noAccount.json()]).toEqual([403, {error: 'account_required', retryable: false}]);
    await context.clearCookies();

    // A grant that has ended.
    const ended = await member();
    await world.revokeGrant(ended, ended.sessionId);
    await signIn(context, baseURL!, ended);
    const revoked = await context.request.post(route, {headers: {origin: evil}, maxRedirects: 0});
    expect([revoked.status(), await revoked.json()]).toEqual([401, {error: 'session_ended', retryable: false}]);
  });

  for (const [name, end] of [
    ['revoked (signed out)', (user: ForgedUser) => world.revokeGrant(user, user.sessionId)],
    ['expired', (user: ForgedUser) => world.ageGrant(user.sessionId, 31, 0)],
    ['idle', (user: ForgedUser) => world.ageGrant(user.sessionId, 10, 8)],
    ['stale (the epoch was raised)', (user: ForgedUser) => world.raiseEpoch(user)],
  ] as [string, (user: ForgedUser) => Promise<unknown>][]) {
    test(`is refused, with the token that was valid a moment ago, once its grant is ${name}`, async ({page, context, baseURL}) => {
      const {user, token} = await signedInPage(page, context, baseURL!);
      expect((await mutate(page, token)).status).toBe(200);
      await end(user);
      const response = await context.request.post(route, {headers: {origin: baseURL!, [csrfHeaderName]: token}, maxRedirects: 0});
      expect([response.status(), await response.json()]).toEqual([401, {error: 'session_ended', retryable: false}]);
    });
  }

  test('costs the database what it must: a refused origin only the proxy\'s authorization, an accepted request the proxy\'s, the handler\'s and the token check', async ({context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    // Asked for without a page, whose own prefetches would add calls to the count.
    expect((await context.request.get(flaky(baseURL!, '/'), {headers: navigation})).status()).toBe(200);
    const token = (await csrfCookie(context))?.value;
    expect(token).toBeDefined();
    forgetCalls(user.id);
    const refused = await context.request.post(flaky(baseURL!, route), {headers: {origin: evil, [csrfHeaderName]: token!}, maxRedirects: 0});
    expect(refused.status()).toBe(403);
    expect(callsFor(user.id)).toEqual(['authorize_session']);

    forgetCalls(user.id);
    const accepted = await context.request.post(flaky(baseURL!, route), {headers: {origin: flakyBaseUrl(baseURL!), [csrfHeaderName]: token!}, maxRedirects: 0});
    expect(accepted.status()).toBe(200);
    expect(callsFor(user.id)).toEqual(['authorize_session', 'authorize_session', 'verify_csrf']);
  });

  for (const mode of ['down', 'error'] as const) {
    test(`is refused as retryable, with nothing changed, while the database cannot answer the token check (${mode})`, async ({page, context, baseURL}) => {
      const user = await member();
      await signIn(context, baseURL!, user);
      await page.goto(flaky(baseURL!, '/'));
      const token = await tokenOnPage(page);
      expect(token).not.toBeNull();

      const end = startOutage(user.id, {rpc: ['verify_csrf'], mode});
      try {
        const answer = await mutate(page, token);
        expect(answer.status).toBe(503);
        expect(answer.retryAfter).toBe('5');
        expect(answer.body).toEqual({error: 'auth_unavailable', retryable: true});
      } finally {
        end();
      }
      // Nothing happened, and the person was not signed out for it.
      expect(await counter(page)).toBe(0);
      expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
      expect((await mutate(page, token)).body).toEqual({count: 1});
    });
  }

  test('is refused as retryable too when the whole accounts database is unreachable, and the same request works once it is back', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    await page.goto(flaky(baseURL!, '/'));
    const token = await tokenOnPage(page);
    const end = startOutage(user.id);
    try {
      const answer = await mutate(page, token);
      expect(answer.status).toBe(503);
      expect(answer.body).toEqual({error: 'auth_unavailable', retryable: true});
    } finally {
      end();
    }
    expect(await counter(page)).toBe(0);
    expect((await mutate(page, token)).body).toEqual({count: 1});
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('public paths and pages', () => {
  test('a mutation to a public path is refused from a foreign origin, with no session and no database call', async ({context, baseURL}) => {
    for (const origin of [evil, 'null']) {
      const response = await context.request.post('/api/health', {headers: {origin}, maxRedirects: 0});
      expect([response.status(), await response.json()], origin).toEqual([403, {error: 'origin_not_allowed', retryable: false}]);
    }
    const bare = await context.request.post('/api/health', {maxRedirects: 0});
    expect(bare.status()).toBe(403);
    // From our own origin it gets as far as the route, which has no POST.
    const own = await context.request.post('/api/health', {headers: {origin: baseURL!}, maxRedirects: 0});
    expect(own.status()).toBe(405);
    expect((await context.request.get('/api/health', {headers: {origin: evil}})).status()).toBe(200);
    const login = await context.request.post('/login', {headers: {origin: evil}, maxRedirects: 0});
    expect(login.status()).toBe(403);
    expect(await login.text()).toBe('Forbidden');
  });

  test('a page mutation from anywhere but our own origin gets a plain 403 and no redirect', async ({page, context, baseURL}) => {
    await signedInPage(page, context, baseURL!);
    const refused: Record<string, string>[] = [{origin: evil}, {origin: 'null'}, {}, {origin: baseURL!, 'sec-fetch-site': 'cross-site'}];
    for (const headers of refused) {
      const response = await context.request.post('/settings', {headers, maxRedirects: 0});
      expect(response.status(), JSON.stringify(headers)).toBe(403);
      expect(response.headers()['location']).toBeUndefined();
      expect(response.headers()['content-type']).toMatch(/^text\/plain/);
      expect(await response.text()).toBe('Forbidden');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a client-side navigation', () => {
  test('issues no token, however old the stored one: a real <Link> click is an RSC fetch, which Next gives the proxy without its RSC headers, and Sec-Fetch-Dest: empty is what keeps it from being a page', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    await page.goto(flaky(baseURL!, '/'));
    expect(callsFor(user.id)).toContain('issue_csrf');
    expect(await csrfCookie(context)).toBeDefined();

    // The cookie is lost and the stored hash is old enough to be replaced: only the KIND of request now decides.
    await context.clearCookies({name: csrfCookieName});
    await world.ageCsrf(user.sessionId, 61);
    await page.waitForLoadState('networkidle');
    forgetCalls(user.id);
    await page.evaluate(() => {
      (window as unknown as {stillHere: boolean}).stillHere = true;
    });

    const projects = mainNav(page, 'en').getByRole('link', {name: label('en', 'nav.projects')});
    const rsc = page.waitForRequest((request) => new URL(request.url()).pathname === '/projects' && request.headers()['rsc'] === '1');
    await projects.click();
    await expect(page).toHaveURL(flaky(baseURL!, '/projects'));
    const sent = await rsc;
    // What the browser sent: a fetch, not a document ...
    expect((await sent.allHeaders())['sec-fetch-dest']).toBe('empty');
    // ... and the page was not reloaded: this was a client-side navigation.
    expect(await page.evaluate(() => (window as unknown as {stillHere?: boolean}).stillHere)).toBe(true);
    await page.waitForLoadState('networkidle');

    // The proxy ran for it (it asked who the person is) and issued nothing.
    expect(callsFor(user.id)).toContain('authorize_session');
    expect(callsFor(user.id)).not.toContain('issue_csrf');
    expect(await csrfCookie(context)).toBeUndefined();
    expect(await storedHash(user)).not.toBeNull();

    // A full document load of the same kind of page does issue one.
    forgetCalls(user.id);
    await page.goto(flaky(baseURL!, '/progress'));
    expect(callsFor(user.id)).toContain('issue_csrf');
    const cookie = await csrfCookie(context);
    expect(cookie).toBeDefined();
    expect(await storedHash(user)).toBe(await hashCsrfToken(cookie!.value));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a real cross-origin attempt, from a page in a browser', () => {
  // The victim is signed in at 127.0.0.1; the attacker's page is this same application served at localhost: a
  // different origin AND a different site. Its script does what an attacker's would: POST to the victim's route
  // with the victim's cookies, as a simple request (no custom header, so no preflight) and as a form.
  const attackerBase = (victimBase: string) => victimBase.replace('127.0.0.1', 'localhost');

  /** The attacker's page posts to the victim's route; returns what the victim's server answered and what the browser sent. */
  async function attack(context: BrowserContext, victimBase: string, how: 'fetch' | 'form') {
    const attacker = await context.newPage();
    try {
      await attacker.goto(`${attackerBase(victimBase)}/login`);
      expect(new URL(attacker.url()).origin).not.toBe(new URL(victimBase).origin);
      const target = new URL(route, victimBase).href;
      const answered = attacker.waitForResponse((response) => response.url() === target && response.request().method() === 'POST');
      if (how === 'fetch') {
        await attacker.evaluate((url) => fetch(url, {method: 'POST', mode: 'no-cors', credentials: 'include', headers: {'content-type': 'text/plain'}, body: 'bump'}).catch(() => undefined), target);
      } else {
        void attacker
          .evaluate((url) => {
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = url;
            form.enctype = 'text/plain';
            document.body.append(form);
            form.submit();
          }, target)
          .catch(() => undefined);
      }
      const response = await answered;
      return {status: response.status(), body: await response.json().catch(() => null)};
    } finally {
      await attacker.close();
    }
  }

  test('the session cookie is SameSite Lax, so the browser sends it with no cross-site POST: the request reaches the application as nobody, and the counter does not move', async ({page, context, baseURL}) => {
    const victim = await member();
    await signIn(context, baseURL!, victim);
    const session = (await context.cookies()).find((cookie) => cookie.name === victim.cookie.name);
    expect(session?.sameSite, 'the session cookie must be Lax, as @supabase/ssr sets it').toBe('Lax');
    await page.goto(flaky(baseURL!, '/'));
    expect((await mutate(page, (await tokenOnPage(page))!)).body.count).toBe(1);

    await page.waitForLoadState('networkidle');
    forgetCalls(victim.id);
    for (const how of ['fetch', 'form'] as const) {
      const result = await attack(context, flakyBaseUrl(baseURL!), how);
      expect(result.status, how).toBe(401);
      // (A no-cors response is opaque to the browser's own tooling; a form's is a page and can be read.)
      if (how === 'form') expect(result.body, how).toMatchObject({error: 'not_signed_in'});
    }
    // No cookie of the victim's went with it: the server never asked the database about them.
    expect(callsFor(victim.id)).toEqual([]);
    expect(await counter(page)).toBe(1);
  });

  test('even if the browser DID send the cookie (SameSite=None, which nothing sets), the origin check refuses it before the token or any state is looked at', async ({page, context, baseURL}) => {
    const victim = await member();
    const victimBase = flakyBaseUrl(baseURL!);
    // The application never sets this; it is what a weaker cookie, or an older browser, would do. (By domain and
    // path: Chrome takes a Secure cookie over http for a loopback host only that way.)
    await context.addCookies([{name: victim.cookie.name, value: victim.cookie.value, domain: new URL(victimBase).hostname, path: '/', sameSite: 'None', secure: true}]);
    await page.goto(new URL('/', victimBase).href);
    const token = await tokenOnPage(page);
    expect(token, 'the SameSite=None cookie must reach the application for this test to mean anything').not.toBeNull();
    expect((await mutate(page, token!)).body.count).toBe(1);

    // (The victim's own page prefetches in the background: let it finish before counting what the attack costs.)
    await page.waitForLoadState('networkidle');
    forgetCalls(victim.id);
    for (const how of ['fetch', 'form'] as const) {
      const result = await attack(context, victimBase, how);
      expect(result.status, how).toBe(403);
      if (how === 'form') expect(result.body, how).toEqual({error: 'origin_not_allowed', retryable: false});
    }
    // The cookie did arrive (the proxy asked who the person is, once per attempt), and nothing went further:
    // the handler never ran, so there was no second authorization and no token check.
    expect(callsFor(victim.id)).toEqual(['authorize_session', 'authorize_session']);
    expect(await counter(page)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('sign out', () => {
  test('removes the CSRF cookie with the session, in a real browser', async ({page, context, baseURL}) => {
    const { user } = await signedInPage(page, context, baseURL!);
    expect(await csrfCookie(context)).toBeDefined();
    await page.getByRole('button', {name: label('en', 'nav.account'), exact: true}).click();
    const panel = page.getByRole('region', {name: label('en', 'account.title')});
    await expect(panel).toBeVisible();
    await panel.getByRole('button', {name: new RegExp(`^(${label('en', 'account.signOut')}|${label('en', 'account.signingOut')})$`)}).click();
    await expect(page).toHaveURL(`${baseURL}/login?notice=signed_out`);
    expect(await csrfCookie(context)).toBeUndefined();
    expect(await page.evaluate(() => document.cookie)).not.toContain(csrfCookieName);
    expect(await sessionCookies(context, user)).toEqual([]);
    expect((await world.grantOf(user.sessionId))!.revoked_reason).toBe('sign_out');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a native form post, with JavaScript off (progressive enhancement)', () => {
  // None of the application's forms posts without script today: each is bound to its action by a client
  // function (useActionState), which React renders as `action="javascript:..."` (see deferred-work.md). So the
  // form is the one React WOULD render for a Server Action given directly: a plain `<form method="post">` whose
  // hidden `$ACTION_ID_<id>` names the action, served from this application's own origin to a browser that runs
  // no script. The action is "Use a different Google account" (it takes no argument, ends this browser's
  // session and sends the browser to Google), whose id is read from the request the real button makes.
  const noReferrer = /(?:^|,)\s*no-referrer\s*(?:,|$)/i;
  const nativePage = (actionId: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Native form</title></head><body><main>` +
    `<form method="post" action="/register" enctype="multipart/form-data"><input type="hidden" name="$ACTION_ID_${actionId}" value="">` +
    `<button type="submit">Use a different Google account</button></form></main></body></html>`;

  /** The id of the "use a different Google account" Server Action, read from the request the real button makes in a browser that runs script. */
  async function switchActionId(page: Page, context: BrowserContext, baseURL: string) {
    const someone = await world.signedInUser();
    await signIn(context, baseURL, someone);
    await stopAtAuth(page);
    await page.goto('/register');
    await hydrated(page);
    const request = page.waitForRequest((sent) => sent.method() === 'POST' && 'next-action' in sent.headers());
    await page.getByRole('button', {name: label('en', 'register.switch')}).click();
    const id = (await request).headers()['next-action'];
    expect(id).toMatch(/^[0-9a-f]{20,}$/);
    return id;
  }

  /** A browser that runs no script, signed in as a Google identity with no Account, on a /register that is the native form. */
  async function scriptFreeBrowser(browser: Browser, baseURL: string, actionId: string, headers: Record<string, string> = {}) {
    const stranger = await world.signedInUser();
    const context = await browser.newContext({baseURL, javaScriptEnabled: false});
    await signIn(context, baseURL, stranger);
    const page = await context.newPage();
    await stopAtAuth(page);
    await page.route('**/register', (route) =>
      route.request().method() === 'GET' ? route.fulfill({status: 200, contentType: 'text/html', headers, body: nativePage(actionId)}) : route.continue(),
    );
    return {stranger, context, page};
  }

  test('a Server Action posted by a plain form passes the origin check, because the browser names its own origin; and the application\'s pages set no Referrer-Policy: no-referrer', async ({page, context, browser, baseURL}) => {
    const actionId = await switchActionId(page, context, baseURL!);

    // The application's own page, as served: no script runs, and nothing asks the browser to hide its origin.
    const own = await browser.newContext({baseURL, javaScriptEnabled: false});
    try {
      const stranger = await world.signedInUser();
      await signIn(own, baseURL!, stranger);
      const ownPage = await own.newPage();
      const loaded = await ownPage.goto('/register');
      expect(loaded?.status()).toBe(200);
      expect(await ownPage.evaluate(() => [...document.querySelectorAll('main button[type="submit"]')].some((node) => Object.keys(node).some((key) => key.startsWith('__reactProps$'))))).toBe(false);
      expect(loaded?.headers()['referrer-policy'] ?? '').not.toMatch(noReferrer);
      for (const content of await ownPage.locator('meta[name="referrer"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''))) expect(content).not.toMatch(noReferrer);
    } finally {
      await own.close();
    }

    const native = await scriptFreeBrowser(browser, baseURL!, actionId);
    try {
      await native.page.goto('/register');
      const posted = native.page.waitForResponse((response) => response.request().method() === 'POST');
      await native.page.getByRole('button', {name: 'Use a different Google account'}).click();
      const response = await posted;
      const sent = await response.request().allHeaders();
      // The browser named its own origin, as it does for every same-origin POST ...
      expect(sent['origin']).toBe(baseURL);
      expect(sent['next-action']).toBeUndefined();
      // ... so the proxy let the post through and the ACTION ran: it answered with the redirect to Google's
      // sign-in (not the proxy's 403), and it ended this browser's session.
      expect(response.status()).toBe(303);
      expect(response.headers()['location']).toMatch(/\/auth\/v1\/authorize\?provider=google&.*prompt=select_account/);
      expect(await world.sessionExists(native.stranger.sessionId)).toBe(false);
    } finally {
      await native.context.close();
    }
  });

  test('a page that DID set Referrer-Policy: no-referrer would make the same post carry Origin: null and be refused, and the action would not run: do not set it', async ({page, context, browser, baseURL}) => {
    const actionId = await switchActionId(page, context, baseURL!);
    const native = await scriptFreeBrowser(browser, baseURL!, actionId, {'referrer-policy': 'no-referrer'});
    try {
      await native.page.goto('/register');
      const posted = native.page.waitForResponse((response) => response.request().method() === 'POST');
      await native.page.getByRole('button', {name: 'Use a different Google account'}).click();
      const response = await posted;
      expect((await response.request().allHeaders())['origin']).toBe('null');
      expect(response.status()).toBe(403);
      expect(await response.text()).toBe('Forbidden');
      expect(await world.sessionExists(native.stranger.sessionId)).toBe(true);
    } finally {
      await native.context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a Server Action replayed', () => {
  const settingsButton = (page: Page) => page.getByRole('button', {name: new RegExp(`^(${label('en', 'settings.sessions.signOutOthers')}|${label('en', 'settings.sessions.pending')})$`)});

  /** The request the browser really makes when the button is pressed, caught before it leaves: the action, its body and its headers. */
  async function captureAction(page: Page) {
    let captured: {url: string; headers: Record<string, string>; body: Buffer} | undefined;
    await page.route('**/settings', async (request) => {
      const sent = request.request();
      if (sent.method() === 'POST' && sent.headers()['next-action']) {
        captured = {url: sent.url(), headers: await sent.allHeaders(), body: sent.postDataBuffer()!};
        return request.abort();
      }
      return request.continue();
    });
    await hydrated(page);
    await settingsButton(page).click();
    await expect.poll(() => captured, crossing).toBeDefined();
    await page.unroute('**/settings');
    return captured!;
  }

  /** What a browser would send for the action, minus what each variant sets for itself. */
  const replay = (context: BrowserContext, captured: Awaited<ReturnType<typeof captureAction>>, extra: Record<string, string>) => {
    const headers = Object.fromEntries(
      Object.entries(captured.headers).filter(([name]) => !['cookie', 'host', 'content-length', 'origin', 'referer'].includes(name) && !name.startsWith('sec-fetch-')),
    );
    return context.request.post(captured.url, {headers: {...headers, ...extra}, data: captured.body, maxRedirects: 0});
  };

  test('with a foreign origin, a null origin, no origin or a cross-site fetch is refused before the action runs; from our own origin it does what it should', async ({page, context, baseURL}) => {
    const user = await member();
    const others = [await world.extraSession(user), await world.extraSession(user)];
    for (const other of others) await world.grant(user, other.sessionId);
    await signIn(context, baseURL!, user);
    await page.goto('/settings');
    const captured = await captureAction(page);
    expect(captured.headers['next-action']).toBeTruthy();
    // The browser itself named its origin: that is what the check relies on.
    expect(captured.headers['origin']).toBe(baseURL);

    const standing = async () => (await Promise.all(others.map((other) => world.grantOf(other.sessionId)))).map((grant) => grant!.revoked_at);
    expect(await standing()).toEqual([null, null]);

    for (const [name, extra] of [
      ['a foreign origin', {origin: evil}],
      ['a null origin', {origin: 'null'}],
      ['no origin', {}],
      ['our origin in a cross-site fetch', {origin: baseURL!, 'sec-fetch-site': 'cross-site'}],
    ] as [string, Record<string, string>][]) {
      const response = await replay(context, captured, extra);
      expect(response.status(), name).toBe(403);
      expect(response.headers()['location'], name).toBeUndefined();
      expect(await response.text(), name).toBe('Forbidden');
      // The action did not run: nobody was signed out.
      expect(await standing(), name).toEqual([null, null]);
    }

    const own = await replay(context, captured, {origin: baseURL!});
    expect(own.status()).toBe(200);
    expect((await standing()).every((revokedAt) => revokedAt !== null)).toBe(true);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
  });

  test('from the page itself, with no token and no script of ours, still works: a Server Action needs no CSRF token', async ({page, context, baseURL}) => {
    const user = await member();
    const other = await world.extraSession(user);
    await world.grant(user, other.sessionId);
    await signIn(context, baseURL!, user);
    await page.goto('/settings');
    // Whatever the cookie says, the action does not ask for it.
    await context.clearCookies({name: csrfCookieName});
    await hydrated(page);
    await settingsButton(page).click();
    await expect(page.locator('#sessions .notice-success')).toHaveText(label('en', 'settings.sessions.done', {count: 1}), crossing);
    expect((await world.grantOf(other.sessionId))!.revoked_reason).toBe('sign_out_others');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a session that signs in again (the step-up against the fake Google)', () => {
  let fakeActive = false;
  test.beforeAll(async () => {
    fakeActive = await fakeGoogleActive(world.stack.apiUrl);
    if (!fakeActive && process.env.CI) throw new Error('The fake Google is not running, or the stack\'s Auth is not swapped to use it, so this flow cannot run. CI swaps it in with `npm run fake-google:up` before the browser tests.');
  });
  test.beforeEach(() => {
    test.skip(!fakeActive, 'The fake Google is not active. Run `npm run fake-google:up` against the local stack to run this flow.');
  });

  test('gets a token of its own on its next page request, though the browser still held the old session\'s cookie', async ({page, context, baseURL}) => {
    const tag = randomUUID().slice(0, 8);
    const user = await world.signedInUser({email: `csrf-${tag}@example.test`, subject: `google-${randomUUID()}`});
    await world.activate(user);
    await addFakeAccount({email: user.email, sub: user.subject, name: `Csrf ${tag}`});
    const { token: before } = await signedInPage(page, context, baseURL!, user);

    await page.goto(stepUpUrl('administration'));
    await hydrated(page, 'main button[type="submit"], main a[href]');
    await page.getByRole('button', {name: label('en', 'stepUp.continue')}).click();
    await expect(page).toHaveURL(chooserUrl, crossing);
    await chooserAccount(page, user.email).click();
    await expect(page).toHaveURL(`${baseURL}/settings`, crossing);

    // A new session with its own grant, and the old one's token is gone with it.
    const fresh = (await world.grantsOf(user)).find((id) => id !== user.sessionId)!;
    expect(fresh).toBeDefined();
    expect((await world.grantOf(user.sessionId))!.revoked_reason).toBe('step_up');
    // The session cookie the APPLICATION set on that sign-in (not one a test forged) is SameSite Lax.
    const appCookies = (await context.cookies()).filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name) && cookie.value !== '');
    expect(appCookies.length).toBeGreaterThan(0);
    expect(appCookies.map((cookie) => cookie.sameSite)).toEqual(appCookies.map(() => 'Lax'));
    const after = (await csrfCookie(context))?.value;
    expect(after, 'the new session must hold a token of its own').toBeDefined();
    expect(after).not.toBe(before);
    expect((await world.grantOf(fresh))!.csrf_hash).toBe(await hashCsrfToken(after!));
    expect((await mutate(page, after!)).status).toBe(200);
    expect(await mutate(page, before)).toMatchObject({status: 403, body: {error: 'csrf_invalid'}});
  });
});
