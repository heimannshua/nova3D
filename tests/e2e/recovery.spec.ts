import {randomBytes} from 'node:crypto';
import {expect, test, type Browser, type Page} from '@playwright/test';
import {hashKey, hashRecoveryToken} from '../../lib/accounts';
import type {Locale, MessageKey} from '../../lib/i18n';
import {alertOf, hydrated, label, overflowReport, sessionCookies, setFontSize, setPreferences, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {endGlobalOutage, endOutage, flakyBaseUrl, startGlobalOutage, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld, type ForgedUser} from '../support/forged-session';
import {clearMailbox, listMail, recoveryLinkIn, tokenOfLink, waitForMail} from '../support/mail';
import {recoveryAdministratorEmail} from '../support/recovery-env';

// Story 1.6: Administrator recovery (A-03), in a real browser against the production build and the local Supabase stack.
// The mail is the real one: the application sends to the stack's Mailpit (APP_ENV=local), and these tests read what arrived.
//
// Recovery is a global singleton (one outstanding token, a limit that is global), and its mailbox is shared, so this file
// is ONE serial spec that runs on the desktop project only (the phone project's pages are in recovery-pages.spec.ts, which
// touches no token and no mail), and every case clears the token table and the mailbox first. The application servers are
// started with a test Administrator address (playwright.config.ts, tests/support/recovery-env.ts), and the Administrator
// these tests make has it: they never touch, and are never confused with, a developer's real Administrator.
//
// Tests that make a token through the page read the link out of the mail. Tests that need a token in a state the page cannot
// reach (aged, or on the server with the failing network) put one in the table the way api.issue_recovery would (hash only).

test.describe.configure({mode: 'serial'});

let world: AccountsWorld;
let administrator: ForgedUser;
const crossing = {timeout: 20_000};
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const recoveryKey = () => hashKey(world.env, 'RECOVERY_HASH_KEY');

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  world = accountsWorld();
  await world.connect();
  // An Administrator under the address the servers were started with: an Account, a pinned Google subject, a grant.
  await world.purgeUserByEmail(recoveryAdministratorEmail);
  administrator = await world.signedInUser({email: recoveryAdministratorEmail});
  await world.activate(administrator);
  await world.makeAdministrator(administrator);
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop') return;
  await world.clearRecoveryTokens();
  await world.close();
});
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Recovery is a singleton: its flows run once, on the desktop project. The phone project renders the pages in recovery-pages.spec.ts.');
  await world.clearRecoveryTokens();
  await clearMailbox();
});

// ---------------------------------------------------------------------------------------------------
// Helpers

/** Opens a page and waits for React to take it over. */
async function open(page: Page, url: string, selector = 'main form button') {
  // Two addresses that differ only after the `#` are one document to a browser: leave it first, so the page is really loaded.
  if (url.includes('#')) await page.goto('about:blank');
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await hydrated(page, selector);
}

/** Presses the one button of /recover and waits for the page to answer. */
async function requestLink(page: Page, locale: Locale = 'en') {
  await open(page, '/recover');
  await page.getByRole('button', {name: t(locale, 'recover.send')}).click();
}

/** A fresh token the way api.issue_recovery makes one (hash only), with the link that carries it. */
async function plantToken(baseURL: string, options: {ageMinutes?: number} = {}) {
  const token = randomBytes(32).toString('base64url');
  await world.insertRecoveryToken(administrator, token, options);
  return {token, link: `${baseURL}/recover/confirm#${token}`};
}

/** An Auth session of the Administrator with its grant, and the browser that holds it: what "my old session" is. */
async function oldSession(browser: Browser, baseURL: string) {
  const session = await world.liveSession(administrator);
  const context = await browser.newContext();
  await signIn(context, baseURL, session);
  return {...session, context};
}

const confirmButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'recoverConfirm.confirm')});
const invalidNotice = (page: Page, locale: Locale = 'en') => page.locator('.notice-danger').filter({hasText: t(locale, 'recoverConfirm.invalid.title')});

/** Opens the mailed link in a page and presses its button. The page's address, hydration and the press are all waited for. */
async function confirm(page: Page, link: string, locale: Locale = 'en') {
  await open(page, link);
  await confirmButton(page, locale).click();
}

/** Everything of this Auth user's that a session could be, as the database holds it. */
const sessionsOfAdministrator = () => world.authSessionsOf(administrator.id);

// ---------------------------------------------------------------------------------------------------
test.describe('asking for a link', () => {
  test('mails the link to the configured address only, says only that it was sent, and keeps nothing readable', async ({page, baseURL}) => {
    const issuedBefore = (await world.auditFor('recovery.issued', (await world.accountOf(administrator)).id)).length;
    await requestLink(page);
    await expect(page.locator('.notice-success')).toContainText(t('en', 'recover.sent'), crossing);

    const [mail] = await waitForMail(1);
    expect(await listMail()).toHaveLength(1);
    expect(mail.to).toEqual([recoveryAdministratorEmail]);
    expect(mail.from).toBe('onboarding@resend.dev');
    const link = recoveryLinkIn(mail.text);
    // The token is in the FRAGMENT of the application's own link, on the origin the request came in on.
    expect(link).toMatch(new RegExp(`^${escapeRegExp(baseURL!)}/recover/confirm#[A-Za-z0-9_-]{43}$`));
    expect(recoveryLinkIn(mail.html)).toBe(link);
    // Nothing of the Workspace, an Account or a name is in it.
    for (const text of [mail.text, mail.html]) expect(text).not.toMatch(/workspace|project/i);

    // The page says nothing of the address, a name, an Account or a Workspace.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(recoveryAdministratorEmail);
    expect(body).not.toContain('example.test');
    expect(body).not.toContain(tokenOfLink(link));
    expect(page.url()).not.toContain(tokenOfLink(link));

    // One token, stored as its keyed hash for 15 minutes on the database's own clock.
    const tokens = await world.recoveryTokens();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token_hash).toBe(hashRecoveryToken(tokenOfLink(link), recoveryKey()));
    expect(JSON.stringify(tokens)).not.toContain(tokenOfLink(link));
    expect(tokens[0].expires_at.getTime() - tokens[0].issued_at.getTime()).toBe(15 * 60 * 1000);
    expect(tokens[0].used_at).toBeNull();
    expect(tokens[0].voided_at).toBeNull();

    // Audited, with an opaque target and no token, hash or address.
    const issued = await world.auditFor('recovery.issued', (await world.accountOf(administrator)).id);
    expect(issued).toHaveLength(issuedBefore + 1);
    expect(issued.at(-1)).toMatchObject({actor: 'system:recovery', action: 'recovery.issued'});
    expect(JSON.stringify(issued)).not.toContain(tokenOfLink(link));
  });

  test('a second request within 15 minutes is limited: the page says try later, and nothing is issued or mailed', async ({page}) => {
    await requestLink(page);
    await expect(page.locator('.notice-success')).toContainText(t('en', 'recover.sent'), crossing);
    await waitForMail(1);
    await page.reload();
    await hydrated(page, 'main form button');
    await page.getByRole('button', {name: t('en', 'recover.send')}).click();
    await expect(alertOf(page)).toContainText(t('en', 'recover.limited'), crossing);
    expect(await listMail()).toHaveLength(1);
    expect(await world.recoveryTokens()).toHaveLength(1);
    const account = await world.accountOf(administrator);
    const limited = await world.auditFor('recovery.limited', account.id);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited.at(-1)).toMatchObject({actor: 'system:recovery'});
  });

  test('the fifth issuance of a day is the last: a sixth is limited even when the last one was long ago', async ({page}) => {
    // Five tokens in the last 24 hours, the newest 20 minutes old: the 15-minute limit has passed, the daily one has not.
    for (const age of [20, 60, 180, 300, 600]) await world.insertRecoveryToken(administrator, randomBytes(32).toString('base64url'), {ageMinutes: age});
    await requestLink(page);
    await expect(alertOf(page)).toContainText(t('en', 'recover.limited'), crossing);
    expect(await listMail()).toHaveLength(0);
    expect(await world.recoveryTokens()).toHaveLength(5);
    // With only four in the day it would have been allowed: the limit is the fifth, counting every issuance.
    await world.db.query('delete from identity.recovery_tokens where issued_at = (select min(issued_at) from identity.recovery_tokens)');
    await page.reload();
    await hydrated(page, 'main form button');
    await page.getByRole('button', {name: t('en', 'recover.send')}).click();
    await expect(page.locator('.notice-success')).toContainText(t('en', 'recover.sent'), crossing);
    expect(await listMail()).toHaveLength(1);
  });

  test('says unavailable, mails nothing and leaves nothing usable when there is no eligible Administrator', async ({page}) => {
    await world.db.query(`update identity.accounts set role = 'member' where user_id = $1`, [administrator.id]);
    try {
      await requestLink(page);
      await expect(alertOf(page)).toContainText(t('en', 'recover.unavailable'), crossing);
      expect(await listMail()).toHaveLength(0);
      expect(await world.recoveryTokens()).toHaveLength(0);
      const refused = await world.untargetedAudit('recovery.rejected.administrator');
      expect(refused.length).toBeGreaterThan(0);
      expect(Date.now() - refused[0].occurred_at.getTime()).toBeLessThan(60 * 60 * 1000);
      // The answer is the same words as for any other cause, and names nothing.
      expect(await page.locator('body').innerText()).not.toContain(recoveryAdministratorEmail);
    } finally {
      await world.makeAdministrator(administrator);
    }
  });

  test('says unavailable and issues nothing when the Administrator\'s pinned Google subject no longer matches', async ({page}) => {
    await world.db.query(
      `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ($1, $2, $3, 'google', now(), now())`,
      ['sub-extra-recovery', administrator.id, JSON.stringify({sub: 'sub-extra-recovery', email: administrator.email, email_verified: true})],
    );
    try {
      await requestLink(page);
      await expect(alertOf(page)).toContainText(t('en', 'recover.unavailable'), crossing);
      expect(await listMail()).toHaveLength(0);
      expect(await world.recoveryTokens()).toHaveLength(0);
    } finally {
      await world.db.query(`delete from auth.identities where user_id = $1 and provider_id = 'sub-extra-recovery'`, [administrator.id]);
    }
  });

  test('a press while another is running sends one request, not two', async ({page}) => {
    await open(page, '/recover');
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/recover') posts.push(request.url());
    });
    const button = page.getByRole('button', {name: t('en', 'recover.send')});
    await Promise.all([button.dblclick(), page.waitForResponse((response) => response.request().method() === 'POST', crossing)]);
    expect(posts).toHaveLength(1);
    await expect(page.locator('.notice-success')).toContainText(t('en', 'recover.sent'), crossing);
    expect(await listMail()).toHaveLength(1);
    expect(await world.recoveryTokens()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('opening the link', () => {
  test('a mail scanner\'s GET renders the page and changes nothing: the token is still valid and no session exists', async ({request, baseURL}) => {
    const {link, token} = await plantToken(baseURL!);
    const sessionsBefore = await sessionsOfAdministrator();
    const grantsBefore = await world.grantRows(administrator);
    const epochBefore = (await world.accountOf(administrator)).epoch;

    // A client that follows the link gets the page. The fragment is never sent, so the server cannot see the token: asking for
    // the URL with it, or without it, is the same request.
    for (const url of [link, `${baseURL}/recover/confirm`]) {
      const response = await request.get(url);
      expect(response.status(), url).toBe(200);
      const html = await response.text();
      expect(html).not.toContain(token);
      expect(response.headers()['set-cookie'] ?? '').toBe('');
    }

    const [row] = await world.recoveryTokens();
    expect(row.used_at).toBeNull();
    expect(row.voided_at).toBeNull();
    expect(await sessionsOfAdministrator()).toEqual(sessionsBefore);
    expect(await world.grantRows(administrator)).toEqual(grantsBefore);
    expect((await world.accountOf(administrator)).epoch).toBe(epochBefore);
    expect(await world.markerSources(administrator)).not.toEqual(expect.arrayContaining([expect.objectContaining({source: 'recovery'})]));
  });

  test('a GET never redeems, whatever it carries: a HEAD, or a token mistakenly put in the query, only renders', async ({request, baseURL}) => {
    const {token} = await plantToken(baseURL!);
    for (const url of [`${baseURL}/recover/confirm?token=${token}`, `${baseURL}/recover/confirm?t=${token}`]) {
      const response = await request.get(url);
      expect(response.status(), url).toBe(200);
      expect(response.headers()['set-cookie'] ?? '').toBe('');
    }
    const head = await request.head(`${baseURL}/recover/confirm`);
    expect(head.status()).toBe(200);
    const [row] = await world.recoveryTokens();
    expect(row.used_at).toBeNull();
    expect(row.voided_at).toBeNull();
    expect(await world.markerSources(administrator)).not.toEqual(expect.arrayContaining([expect.objectContaining({source: 'recovery'})]));
  });

  test('a link with no token, or with something that is not one, says so at once and offers a new link', async ({context, baseURL}) => {
    for (const url of ['/recover/confirm', '/recover/confirm#', '/recover/confirm#short', `/recover/confirm#${'a'.repeat(44)}`, '/recover/confirm#' + 'é'.repeat(43)]) {
      // A page of its own each time: two addresses that differ only after the `#` are one document to a browser.
      const page = await context.newPage();
      const response = await page.goto(`${baseURL}${url}`);
      expect(response?.status(), url).toBe(200);
      await expect(invalidNotice(page), url).toBeVisible();
      await expect(page.getByRole('link', {name: t('en', 'recoverConfirm.newLink')})).toHaveAttribute('href', '/recover');
      await expect(confirmButton(page)).toHaveCount(0);
      await page.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('redeeming', () => {
  test('signs the Administrator in at Administration with every earlier session gone, the epoch raised, a fresh marker for the new session only, and the event audited', async ({page, browser, baseURL}) => {
    const problems = watchForProblems(page);
    const account = await world.accountOf(administrator);
    const old = await oldSession(browser, baseURL!);
    const sessionsBeforeRedeem = await sessionsOfAdministrator();
    expect(sessionsBeforeRedeem).toContain(old.sessionId);
    const epochBefore = (await world.accountOf(administrator)).epoch;
    const redeemedBefore = (await world.auditFor('recovery.redeemed', account.id)).length;

    // Through the page, as a person does: ask, read the mail, open the link, press the button.
    await requestLink(page);
    await expect(page.locator('.notice-success')).toContainText(t('en', 'recover.sent'), crossing);
    const [mail] = await waitForMail(1);
    const link = recoveryLinkIn(mail.text);
    const token = tokenOfLink(link);

    // Nothing on the way carries the token in a URL: not a request's, not a redirect's, not the address bar after the page has read it.
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    page.on('response', (response) => urls.push(response.url(), response.headers().location ?? ''));
    await open(page, link, 'main form button');
    await expect(page).toHaveURL(`${baseURL}/recover/confirm`);
    await expect(page.locator('input[name="token"]')).toHaveValue(token);
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/admin\?recovered=\d+$/, crossing);
    expect(urls.filter((url) => url.includes(token))).toEqual([]);

    // Signed in as the Administrator, at Administration, told what it did.
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'admin.title')})).toBeVisible();
    // ... and how many other sessions it signed out: every session the person had before.
    const ended = sessionsBeforeRedeem.length;
    expect(Number(new URL(page.url()).searchParams.get('recovered'))).toBe(ended);
    await expect(page.locator('.notice-success').filter({hasText: t('en', 'admin.recovered', {count: ended})})).toBeVisible();
    // The new session holds a fresh `administration` marker, so the page says so, without a step-up.
    await expect(page.locator('.notice-success').filter({hasText: t('en', 'admin.confirm.ok')})).toBeVisible();

    // Every earlier session of the person is gone and its grant revoked for `recovery`; the epoch is raised once.
    const sessions = await sessionsOfAdministrator();
    expect(sessions).not.toContain(old.sessionId);
    expect(sessions).not.toContain(administrator.sessionId);
    expect(sessions).toHaveLength(1);
    const [fresh] = sessions;
    const grants = await world.grantRows(administrator);
    const epoch = (await world.accountOf(administrator)).epoch;
    expect(epoch).toBeGreaterThan(epochBefore);
    expect(grants.find((grant) => grant.session_id === old.sessionId)).toMatchObject({revoked_reason: 'recovery'});
    expect(grants.filter((grant) => grant.revoked_at === null).map((grant) => grant.session_id)).toEqual([fresh]);
    expect(grants.find((grant) => grant.session_id === fresh)?.epoch).toBe(epoch);

    // The marker is class administration, source recovery, no nonce, this session's alone, and runs five minutes.
    const markers = (await world.markersOf(administrator)).filter((marker) => marker.session_id === fresh);
    expect(markers).toHaveLength(1);
    expect(markers[0].action_class).toBe('administration');
    expect(markers[0].expires_at.getTime() - markers[0].issued_at.getTime()).toBe(5 * 60 * 1000);
    expect(await world.markerSources(administrator)).toContainEqual({session_id: fresh, action_class: 'administration', source: 'recovery', nonce_id: null});
    expect(await world.markerOutcome(administrator, fresh, 'administration')).toBe('allowed');
    expect(await world.markerOutcome(administrator, fresh, 'owner_deletion')).toBe('none');
    expect(await world.markerOutcome(administrator, old.sessionId, 'administration')).toBe('denied');

    // The token is used, and one audit event names the Account and no secret.
    const [row] = await world.recoveryTokens();
    expect(row.used_at).not.toBeNull();
    const redeemed = await world.auditFor('recovery.redeemed', account.id);
    expect(redeemed).toHaveLength(redeemedBefore + 1);
    expect(redeemed.at(-1)).toEqual({actor: `user:${administrator.id}`, action: 'recovery.redeemed', target: `account:${account.id}`});
    expect(JSON.stringify(redeemed)).not.toContain(token);

    // The old session's browser is signed out at its next request; the new session works for a change (a named code).
    const stale = await old.context.newPage();
    await stale.goto('/admin');
    await expect(stale).toHaveURL(new RegExp(`^${escapeRegExp(baseURL!)}/login`));
    await old.context.close();
    await page.goto('/admin/invitations');
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'invitations.title')})).toBeVisible();

    // The CSRF cookie of the old session is gone with it, and nothing printed a React or browser problem.
    expect(problems.filter((problem) => !/Failed to load resource/.test(problem))).toEqual([]);
    expect(await sessionCookies(page.context(), {cookie: {name: administrator.cookie.name}})).toHaveLength(1);
  });

  test('keeps the token out of every place it could be kept: the address bar, storage, cookies and the console', async ({page, baseURL}) => {
    const {link, token} = await plantToken(baseURL!);
    const logs: string[] = [];
    page.on('console', (message) => logs.push(message.text()));
    await open(page, link);
    await expect(page.locator('input[name="token"]')).toHaveValue(token);
    // Not in the address, any storage or any cookie; only the form holds it.
    expect(page.url()).toBe(`${baseURL}/recover/confirm`);
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(await page.evaluate((needle) => JSON.stringify([{...window.localStorage}, {...window.sessionStorage}]).includes(needle), token)).toBe(false);
    expect((await page.context().cookies()).some((cookie) => cookie.value.includes(token) || cookie.name.includes(token))).toBe(false);
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/admin\?recovered=/, crossing);
    expect((await page.context().cookies()).some((cookie) => cookie.value.includes(token))).toBe(false);
    expect(logs.filter((line) => line.includes(token))).toEqual([]);
  });

  test('a press while another is running sends one request, not two: a double click on the confirm button posts the form once', async ({page, baseURL}) => {
    const {link} = await plantToken(baseURL!);
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/recover/confirm') posts.push(request.url());
    });
    await open(page, link);
    await confirmButton(page).dblclick();
    await expect(page).toHaveURL(/\/admin\?recovered=/, crossing);
    expect(posts).toHaveLength(1);
    // One recovery: the one session of the person is the new one, and the token was used once.
    expect(await sessionsOfAdministrator()).toHaveLength(1);
    const [row] = await world.recoveryTokens();
    expect(row.used_at).not.toBeNull();
  });

  test('a replayed link is refused with one message and nothing changes', async ({page, browser, baseURL}) => {
    const {link} = await plantToken(baseURL!);
    await confirm(page, link);
    await expect(page).toHaveURL(/\/admin\?recovered=/, crossing);
    const sessionsAfter = await sessionsOfAdministrator();
    const grantsAfter = await world.grantRows(administrator);
    const epochAfter = (await world.accountOf(administrator)).epoch;
    const markersAfter = await world.markerSources(administrator);

    const second = await browser.newContext();
    const replay = await second.newPage();
    await confirm(replay, link);
    await expect(alertOf(replay)).toContainText(t('en', 'recoverConfirm.invalid'), crossing);
    await expect(replay.getByRole('link', {name: t('en', 'recoverConfirm.newLink')})).toBeVisible();
    // No session in the replaying browser, and nothing about the Administrator changed.
    expect(await replay.context().cookies()).toEqual([]);
    expect(await sessionsOfAdministrator()).toEqual(sessionsAfter);
    expect(await world.grantRows(administrator)).toEqual(grantsAfter);
    expect((await world.accountOf(administrator)).epoch).toBe(epochAfter);
    expect(await world.markerSources(administrator)).toEqual(markersAfter);
    const account = await world.accountOf(administrator);
    expect((await world.auditFor('recovery.rejected.used', account.id)).length).toBeGreaterThan(0);
    await second.close();
  });

  test('an expired link is refused, no session is made and the Administrator is untouched', async ({page, baseURL}) => {
    const {link} = await plantToken(baseURL!, {ageMinutes: 16});
    const sessionsBefore = await sessionsOfAdministrator();
    const epochBefore = (await world.accountOf(administrator)).epoch;
    await confirm(page, link);
    await expect(alertOf(page)).toContainText(t('en', 'recoverConfirm.invalid'), crossing);
    expect(await page.context().cookies()).toEqual([]);
    expect(await sessionsOfAdministrator()).toEqual(sessionsBefore);
    expect((await world.accountOf(administrator)).epoch).toBe(epochBefore);
    const [row] = await world.recoveryTokens();
    expect(row.used_at).toBeNull();
    const account = await world.accountOf(administrator);
    expect((await world.auditFor('recovery.rejected.expired', account.id)).length).toBeGreaterThan(0);
  });

  test('a link that was voided is refused like any other', async ({page, baseURL}) => {
    const {link} = await plantToken(baseURL!);
    await world.db.query('update identity.recovery_tokens set voided_at = clock_timestamp()');
    await confirm(page, link);
    await expect(alertOf(page)).toContainText(t('en', 'recoverConfirm.invalid'), crossing);
    expect(await page.context().cookies()).toEqual([]);
    const account = await world.accountOf(administrator);
    expect((await world.auditFor('recovery.rejected.voided', account.id)).length).toBeGreaterThan(0);
  });

  test('a token nobody issued is refused with the same one message, and the audit names no one and no token', async ({page, baseURL}) => {
    const token = randomBytes(32).toString('base64url');
    await confirm(page, `${baseURL}/recover/confirm#${token}`);
    await expect(alertOf(page)).toContainText(t('en', 'recoverConfirm.invalid'), crossing);
    expect(await page.context().cookies()).toEqual([]);
    const unknown = await world.untargetedAudit('recovery.rejected.unknown');
    expect(unknown.length).toBeGreaterThan(0);
    expect(JSON.stringify(unknown)).not.toContain(token);
  });

  test('two windows with the same link, one after the other: the second is refused with the one message and holds no session', async ({browser, baseURL}) => {
    const {link} = await plantToken(baseURL!);
    const contexts = [await browser.newContext(), await browser.newContext()];
    const [first, second] = await Promise.all(contexts.map((context) => context.newPage()));
    await open(first, link);
    await open(second, link);
    await confirmButton(first).click();
    await expect(first).toHaveURL(/\/admin\?recovered=/, crossing);
    await confirmButton(second).click();
    await expect(alertOf(second)).toContainText(t('en', 'recoverConfirm.invalid'), crossing);
    // The loser's own session was ended and its cookies were never written; the winner's is the one session, and it works.
    expect(await contexts[1].cookies()).toEqual([]);
    expect(await sessionsOfAdministrator()).toHaveLength(1);
    await first.goto('/admin');
    await expect(first.getByRole('heading', {level: 1, name: t('en', 'admin.title')})).toBeVisible();
    await Promise.all(contexts.map((context) => context.close()));
  });

  test('two windows with the same link at the same moment: one recovers, the other is refused, in two browsers and in two tabs of one', async ({browser, baseURL}) => {
    // What the loser is told depends on where the race was lost (Auth keeps one pending link per person): the link is already used, or
    // a service could not finish and trying again is safe. Either way it is refused, it holds no session, and the winner's session stands.
    const refused = new RegExp([t('en', 'recoverConfirm.invalid'), t('en', 'recoverConfirm.unavailable')].map(escapeRegExp).join('|'));
    // Two browsers.
    {
      const {link} = await plantToken(baseURL!);
      const contexts = [await browser.newContext(), await browser.newContext()];
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      for (const page of pages) await open(page, link);
      await Promise.all(pages.map((page) => confirmButton(page).click()));
      const outcomes = await Promise.all(
        pages.map(async (page) => {
          await expect(page.locator('.notice-success, .notice-danger').first()).toBeVisible(crossing);
          return page.url().includes('/admin?recovered=') ? 'recovered' : 'refused';
        }),
      );
      expect([...outcomes].sort()).toEqual(['recovered', 'refused']);
      const winner = pages[outcomes.indexOf('recovered')];
      const loser = pages[outcomes.indexOf('refused')];
      await expect(alertOf(loser)).toContainText(refused);
      expect(await loser.context().cookies()).toEqual([]);
      expect(await sessionsOfAdministrator()).toHaveLength(1);
      await winner.goto('/admin');
      await expect(winner.getByRole('heading', {level: 1, name: t('en', 'admin.title')})).toBeVisible();
      await Promise.all(contexts.map((context) => context.close()));
    }
    await world.clearRecoveryTokens();
    // Two tabs of one browser share one cookie jar: the loser must not leave its own session, or an expiry, over the winner's.
    {
      const {link} = await plantToken(baseURL!);
      const context = await browser.newContext();
      const pages = [await context.newPage(), await context.newPage()];
      for (const page of pages) await open(page, link);
      await Promise.all(pages.map((page) => confirmButton(page).click()));
      await Promise.all(pages.map((page) => expect(page.locator('.notice-success, .notice-danger').first()).toBeVisible(crossing)));
      expect(pages.filter((page) => page.url().includes('/admin?recovered='))).toHaveLength(1);
      expect(await sessionsOfAdministrator()).toHaveLength(1);
      // The browser's one cookie jar still holds a session Auth has and the database authorizes.
      const fresh = await context.newPage();
      await fresh.goto('/admin');
      await expect(fresh).toHaveURL(`${baseURL}/admin`);
      await expect(fresh.getByRole('heading', {level: 1, name: t('en', 'admin.title')})).toBeVisible();
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('when a service does not answer', () => {
  test('the check not answering is retryable: nothing was made, the link still works, and trying again succeeds', async ({page, baseURL}) => {
    const flaky = flakyBaseUrl(baseURL!);
    const {token} = await plantToken(baseURL!);
    const link = `${flaky}/recover/confirm#${token}`;
    const sessionsBefore = await sessionsOfAdministrator();
    startGlobalOutage('check_recovery');
    try {
      await open(page, link);
      await confirmButton(page).click();
      await expect(alertOf(page)).toContainText(t('en', 'recoverConfirm.unavailable'), crossing);
      expect(await page.context().cookies()).toEqual([]);
      expect(await sessionsOfAdministrator()).toEqual(sessionsBefore);
      expect((await world.recoveryTokens())[0].used_at).toBeNull();
    } finally {
      endGlobalOutage('check_recovery');
    }
    // The form is still there, with the same token, and the same press now recovers.
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/admin\?recovered=/, crossing);
  });

  test('the database not answering after the transaction was handed to it keeps the session and says to open Administration', async ({page, baseURL}) => {
    const flaky = flakyBaseUrl(baseURL!);
    const {token} = await plantToken(baseURL!);
    const link = `${flaky}/recover/confirm#${token}`;
    startOutage(administrator.id, {rpc: ['redeem_recovery'], mode: 'down'});
    try {
      await open(page, link);
      await confirmButton(page).click();
      await expect(alertOf(page)).toContainText(t('en', 'recoverConfirm.unknown'), crossing);
      await expect(page.getByRole('link', {name: t('en', 'recoverConfirm.openAdmin')})).toHaveAttribute('href', '/admin');
      // Nothing committed (the call never reached the database), the token is unused, and the inert session the person holds reaches nothing.
      expect((await world.recoveryTokens())[0].used_at).toBeNull();
      expect(await sessionCookies(page.context(), {cookie: {name: administrator.cookie.name}})).toHaveLength(1);
    } finally {
      endOutage(administrator.id);
    }
    // Administration says to sign in (the session has no grant); the same link, still unused, recovers.
    await page.goto(`${flaky}/admin`);
    await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(flaky)}/login`));
    await confirm(page, link);
    await expect(page).toHaveURL(/\/admin\?recovered=/, crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the pages in every variant', () => {
  for (const variant of variants) {
    test(`request, sent, and the link's states pass axe: ${variant.name}`, async ({page, context, baseURL}) => {
      await setPreferences(context, baseURL!, {locale: variant.locale, theme: variant.theme});
      await open(page, '/recover');
      await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
      await expect(page.locator('html')).toHaveAttribute('dir', variant.locale === 'he' ? 'rtl' : 'ltr');
      expect(await violations(page), 'request').toEqual([]);

      await page.getByRole('button', {name: t(variant.locale, 'recover.send')}).click();
      await expect(page.locator('.notice-success')).toContainText(t(variant.locale, 'recover.sent'), crossing);
      expect(await violations(page), 'sent').toEqual([]);

      await page.reload();
      await hydrated(page, 'main form button');
      await page.getByRole('button', {name: t(variant.locale, 'recover.send')}).click();
      await expect(alertOf(page)).toContainText(t(variant.locale, 'recover.limited'), crossing);
      expect(await violations(page), 'limited').toEqual([]);

      const {link} = await plantToken(baseURL!);
      await open(page, link);
      expect(await violations(page), 'confirm').toEqual([]);
      await confirmButton(page, variant.locale).click();
      await expect(page).toHaveURL(/\/admin\?recovered=/, crossing);
      await expect(page.locator('.notice-success').first()).toBeVisible();
      expect(await violations(page), 'success').toEqual([]);

      const replay = await plantToken(baseURL!);
      await world.db.query('update identity.recovery_tokens set used_at = clock_timestamp() where token_hash = $1', [hashRecoveryToken(replay.token, recoveryKey())]);
      const fresh = await context.browser()!.newContext();
      await setPreferences(fresh, baseURL!, {locale: variant.locale, theme: variant.theme});
      const used = await fresh.newPage();
      await open(used, replay.link);
      await confirmButton(used, variant.locale).click();
      await expect(alertOf(used)).toContainText(t(variant.locale, 'recoverConfirm.invalid'), crossing);
      expect(await violations(used), 'used').toEqual([]);
      await fresh.close();
    });
  }

  test('every state reads at 320 px with the text at 200 percent, and nothing scrolls sideways', async ({page, context, baseURL, browserName}) => {
    test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    for (const locale of ['en', 'he'] as const) {
      await setPreferences(context, baseURL!, {locale});
      await world.clearRecoveryTokens();
      await clearMailbox();
      await open(page, '/recover');
      expect((await overflowReport(page)).scroll, `request ${locale}`).toBeLessThanOrEqual(0);
      await page.getByRole('button', {name: t(locale, 'recover.send')}).click();
      await expect(page.locator('.notice-success')).toContainText(t(locale, 'recover.sent'), crossing);
      expect(await overflowReport(page), `sent ${locale}`).toEqual({scroll: 0, clipped: []});
      const {link} = await plantToken(baseURL!, {ageMinutes: 0});
      await open(page, link);
      expect(await overflowReport(page), `confirm ${locale}`).toEqual({scroll: 0, clipped: []});
      await open(page, `${baseURL}/recover/confirm#nope`, 'main a.btn');
      await expect(invalidNotice(page, locale)).toBeVisible();
      expect(await overflowReport(page), `invalid ${locale}`).toEqual({scroll: 0, clipped: []});
    }
  });

  test('the keyboard reaches the one button, presses it with Enter, and the way back is a link', async ({page}) => {
    await open(page, '/recover');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await page.keyboard.press('Tab');
    const button = page.getByRole('button', {name: t('en', 'recover.send')});
    await expect(button).toBeFocused();
    // The focus ring is drawn: an outline, not just the browser's default removed.
    expect(await button.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.locator('.notice-success')).toContainText(t('en', 'recover.sent'), crossing);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', {name: t('en', 'recover.back')})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/login$/, crossing);
    await expect(page.getByRole('link', {name: t('en', 'login.recover')})).toHaveAttribute('href', '/recover');
  });

  test('the confirmation button is reached and pressed from the keyboard', async ({page, baseURL}) => {
    const {link} = await plantToken(baseURL!);
    await open(page, link);
    await expect(confirmButton(page)).toBeEnabled();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(confirmButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\?recovered=/, crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the sign-in page', () => {
  test('has a quiet link to the Recover page, and following it reaches the page', async ({page}) => {
    await page.goto('/login');
    const link = page.getByRole('link', {name: t('en', 'login.recover')});
    await expect(link).toHaveAttribute('href', '/recover');
    await link.click();
    await expect(page).toHaveURL(/\/recover$/, crossing);
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'recover.title')})).toBeVisible();
  });
});
