import {expect, test, type Browser, type BrowserContext, type Page} from '@playwright/test';
import {callsFor, endOutage, flakyBaseUrl, forgetCalls, startOutage} from '../support/fake-network';
import {alertOf, label, mainNav, overflow, sessionCookies, setPreferences, signIn, violations, watchForProblems} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld, type ForgedUser} from '../support/forged-session';
import type {Locale, MessageKey} from '../../lib/i18n';

// Story 1.4a: session grants and live authorization, in a real browser against the production build and the
// local Supabase stack. Local Google sign-in cannot be driven, so each test forges a session
// (tests/support/forged-session.ts) and gives it a grant the way the callback does; Auth still validates the
// token, so the application's own getUser(), proxy and authorization checks all run. Every flow runs on
// `desktop` and `phone`.
//
// "The database is unreachable" is made true for ONE user on a second application server (the same build,
// with tests/support/fake-network.mjs preloaded; see playwright.config.ts), so no other test is disturbed.

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const locales = ['en', 'he'] as const;
const flaky = (baseURL: string, path = '/') => new URL(path, flakyBaseUrl(baseURL)).href;

/** A user with an Account and the grant of their forged session: what a signed-in member is. */
async function member(options: {grant?: boolean} = {}) {
  const user = await world.signedInUser();
  await world.activate(user, options);
  return user;
}

const accountButton = (page: Page, locale: Locale) => page.getByRole('button', {name: label(locale, 'nav.account'), exact: true});
const accountPanel = (page: Page, locale: Locale) => page.getByRole('region', {name: label(locale, 'account.title')});
const signOutButton = (page: Page, locale: Locale) => accountPanel(page, locale).getByRole('button', {name: new RegExp(`^(${label(locale, 'account.signOut')}|${label(locale, 'account.signingOut')})$`)});
const otherSessionsButton = (page: Page, locale: Locale) => page.getByRole('button', {name: new RegExp(`^(${label(locale, 'settings.sessions.signOutOthers')}|${label(locale, 'settings.sessions.pending')})$`)});
// The sign-out buttons report through the page's one live region, and show the same words in a notice that has
// no role of its own (so a screen reader hears them once).
const liveRegion = (page: Page) => page.locator('[data-announcer]');
const sessionsNotice = (page: Page, tone: 'success' | 'danger') => page.locator(`#sessions .notice-${tone}`);
const menuNotice = (page: Page) => accountPanel(page, 'en').locator('.notice-danger');
const retryLink = (page: Page, locale: Locale) => page.getByRole('link', {name: label(locale, 'login.retry')});
const privatePaths = ['/', '/projects', '/progress', '/settings', '/projects/anything', '/no-such-page', '/register'];

/** A request on a session that is not let in: where it ends up, and what it says. `session_ended` is Auth-valid but grant-invalid. */
async function expectSignInAgainEverywhere(page: Page, baseURL: string, locale: Locale, reason: {code: string; message: MessageKey} = {code: 'session_ended', message: 'login.error.session_ended'}) {
  for (const path of privatePaths) {
    await page.goto(path);
    await expect(page, path).toHaveURL(`${baseURL}/login?error=${reason.code}`);
    await expect(alertOf(page), path).toHaveText(label(locale, reason.message));
    // No private content: not the navigation, not the account menu, not a link into the workspace.
    await expect(page.getByRole('navigation'), path).toHaveCount(0);
    await expect(accountButton(page, locale), path).toHaveCount(0);
  }
}

// ---------------------------------------------------------------------------------------------------
test.describe('a session with a valid grant', () => {
  test('is let in to every private page, and its last use moves forward at most once a minute', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    await world.ageGrant(user.sessionId, 1, 0.01);
    const stale = (await world.grantOf(user.sessionId))!.last_used_at;

    for (const path of ['/', '/projects', '/progress', '/settings']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page).toHaveURL(`${baseURL}${path}`);
      await expect(mainNav(page, 'en')).toBeVisible();
    }
    const used = (await world.grantOf(user.sessionId))!.last_used_at;
    expect(used.getTime()).toBeGreaterThan(stale.getTime());
    expect(Date.now() - used.getTime()).toBeLessThan(60_000);

    // Four requests in a few seconds wrote it once: the first moved it, the rest were inside the minute.
    await page.goto('/projects');
    expect((await world.grantOf(user.sessionId))!.last_used_at).toEqual(used);
  });

  test('stays signed in after 29 days, and after 6 days without use', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    await world.ageGrant(user.sessionId, 29, 6);
    await page.goto('/projects');
    await expect(page).toHaveURL(`${baseURL}/projects`);
    await expect(mainNav(page, 'en')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a valid token without a valid grant is refused, even though the UI is bypassed', () => {
  const refusals: [string, (user: ForgedUser) => Promise<unknown>, {grant?: boolean}][] = [
    ['no grant (a session from before session grants)', async () => undefined, {grant: false}],
    ['a revoked grant', (user) => world.revokeGrant(user, user.sessionId), {}],
    ['a grant 31 days old', (user) => world.ageGrant(user.sessionId, 31, 0), {}],
    ['a grant idle for 8 days', (user) => world.ageGrant(user.sessionId, 10, 8), {}],
    ['a grant of an older epoch', (user) => world.raiseEpoch(user), {}],
  ];

  for (const locale of locales) {
    for (const [name, arrange, options] of refusals) {
      test(`${name}: every private path asks the person to sign in again (${locale})`, async ({page, context, baseURL}) => {
        const user = await member(options);
        await arrange(user);
        await signIn(context, baseURL!, user, {locale});
        await expectSignInAgainEverywhere(page, baseURL!, locale);
        // The Auth session itself was not touched: it is the grant that says no.
        expect(await world.sessionExists(user.sessionId)).toBe(true);
      });
    }
  }

  test('signing in again is a new session with a new grant, and the old one stays refused', async ({page, context, baseURL}) => {
    const user = await member();
    await world.revokeGrant(user, user.sessionId);
    await signIn(context, baseURL!, user);
    await page.goto('/');
    await expect(page).toHaveURL(`${baseURL}/login?error=session_ended`);

    const fresh = await world.extraSession(user);
    await world.grant(user, fresh.sessionId);
    await context.addCookies([{name: fresh.cookie.name, value: fresh.cookie.value, url: baseURL!}]);
    await page.goto('/');
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(mainNav(page, 'en')).toBeVisible();
    expect((await world.grantOf(user.sessionId))!.revoked_at).not.toBeNull();
  });

  test('a session that predates session grants is let in by signing in again, never by waiting', async ({page, context, baseURL}) => {
    const user = await member({grant: false});
    await signIn(context, baseURL!, user);
    await page.goto('/projects');
    await expect(page).toHaveURL(`${baseURL}/login?error=session_ended`);
    expect(await world.grantsOf(user)).toEqual([]);
    // Nothing a private request does creates a grant: only a sign-in, a registration or a claim does.
    await page.goto('/');
    expect(await world.grantsOf(user)).toEqual([]);
  });

  test('an Account raised to a new epoch lets in only the sessions that signed in after it', async ({browser, baseURL}) => {
    const user = await member();
    const first = await browser.newContext({baseURL});
    const second = await browser.newContext({baseURL});
    try {
      await signIn(first, baseURL!, user);
      const firstPage = await first.newPage();
      await firstPage.goto('/');
      await expect(mainNav(firstPage, 'en')).toBeVisible();

      expect((await world.raiseEpoch(user)).epoch).toBe(2);
      const later = await world.extraSession(user);
      await world.grant(user, later.sessionId);
      expect(Number((await world.grantOf(later.sessionId))!.epoch)).toBe(2);
      await signIn(second, baseURL!, {cookie: later.cookie});
      const secondPage = await second.newPage();
      await secondPage.goto('/');
      await expect(mainNav(secondPage, 'en')).toBeVisible();

      await firstPage.goto('/projects');
      await expect(firstPage).toHaveURL(`${baseURL}/login?error=session_ended`);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test('a disabled Account is signed out, with its message, whatever its grant says', async ({page, context, baseURL}) => {
    const user = await member();
    await world.setStatus(user, 'disabled');
    await signIn(context, baseURL!, user, {locale: 'he'});
    await page.goto('/settings');
    await expect(page).toHaveURL(`${baseURL}/login?error=account_disabled`);
    await expect(alertOf(page)).toHaveText(label('he', 'login.error.account_disabled'));
    expect(await sessionCookies(context, user)).toEqual([]);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('a changed Google identity revokes the grant, is refused everywhere, and is audited', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    // Auth now reports a Google identity that is not the one pinned to the Account (for example, another
    // identity linked to the same Auth user). The grant was valid a moment ago.
    await world.db.query(`update auth.identities set provider_id = $2 where user_id = $1`, [user.id, `another-subject-${user.sessionId}`]);
    await page.goto('/projects');
    await expect(page).toHaveURL(`${baseURL}/login?error=not_allowed`);
    await expect(alertOf(page)).toHaveText(label('en', 'login.error.not_allowed'));
    expect(await sessionCookies(context, user)).toEqual([]);
    expect((await world.grantOf(user.sessionId))!.revoked_reason).toBe('subject_mismatch');
    expect(await world.auditEvents('session.subject_mismatch', `session:${user.sessionId}`)).toHaveLength(1);
    expect(await world.sessionExists(user.sessionId)).toBe(false);
  });

  for (const locale of locales) {
    for (const theme of ['light', 'dark'] as const) {
      test(`the sign-in page that says so has no accessibility violations (${locale}, ${theme})`, async ({page, context, baseURL}) => {
        const user = await member();
        await world.revokeGrant(user, user.sessionId);
        await signIn(context, baseURL!, user, {locale, theme});
        await page.goto('/');
        await expect(alertOf(page)).toHaveText(label(locale, 'login.error.session_ended'));
        expect(await violations(page)).toEqual([]);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
      });

      test(`the sign-in page after a deliberate sign-out has no accessibility violations and says so (${locale}, ${theme})`, async ({page, context, baseURL}) => {
        await setPreferences(context, baseURL!, {locale, theme});
        await page.goto('/login?notice=signed_out');
        await expect(page.locator('.notice-info')).toHaveText(label(locale, 'login.notice.signed_out'));
        await expect(alertOf(page)).toHaveCount(0);
        expect(await violations(page)).toEqual([]);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }

  test('an Auth session the database no longer sees is signed out, not an ended session', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    // Auth's own session is gone but its token is still presented: Auth itself says so.
    await world.db.query('delete from auth.sessions where id = $1', [user.sessionId]);
    await page.goto('/projects');
    await expect(page).toHaveURL(`${baseURL}/login?error=not_signed_in`);
    await expect(alertOf(page)).toHaveText(label('en', 'login.error.not_signed_in'));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('sign out', () => {
  for (const locale of locales) {
    test(`revokes the grant first, ends the session, clears the cookies, and the old token is refused (${locale})`, async ({page, context, browser, baseURL}) => {
      const user = await member();
      await signIn(context, baseURL!, user, {locale});
      const problems = watchForProblems(page);
      await page.goto('/settings');
      await expect(mainNav(page, locale)).toBeVisible();

      await accountButton(page, locale).click();
      await expect(accountPanel(page, locale)).toBeVisible();
      await signOutButton(page, locale).click();

      await expect(page).toHaveURL(`${baseURL}/login?notice=signed_out`);
      await expect(page.locator('.notice-info')).toHaveText(label(locale, 'login.notice.signed_out'));
      await expect(page.getByRole('button', {name: label(locale, 'login.google')})).toBeVisible();
      await expect(page.getByRole('navigation')).toHaveCount(0);
      expect(await sessionCookies(context, user)).toEqual([]);
      expect(problems).toEqual([]);

      // One grant, revoked by this person, for this reason, and audited once.
      const grant = (await world.grantOf(user.sessionId))!;
      expect(grant).toMatchObject({revoked_by: `user:${user.id}`, revoked_reason: 'sign_out'});
      expect(grant.revoked_at).not.toBeNull();
      expect(await world.grantsOf(user)).toEqual([user.sessionId]);
      expect(await world.auditEvents('session.revoked', `session:${user.sessionId}`)).toEqual([
        {actor: `user:${user.id}`, action: 'session.revoked', target: `session:${user.sessionId}`},
      ]);
      expect(await world.sessionExists(user.sessionId)).toBe(false);

      // A request on the old token is refused, and it matters WHO refuses. First Auth: its session is gone, so
      // it says there is no session at all.
      const replay = await browser.newContext({baseURL});
      try {
        await signIn(replay, baseURL!, user, {locale});
        const replayPage = await replay.newPage();
        await replayPage.goto('/');
        await expect(replayPage).toHaveURL(`${baseURL}/login?error=not_signed_in`);
        await expect(alertOf(replayPage)).toHaveText(label(locale, 'login.error.not_signed_in'));

        // Then the grant alone: with Auth's session put back (and the cookie the refusal cleared presented
        // again), the token is valid at Auth, and only the revoked grant refuses it. Its message is the one for
        // a session that ended, not for a missing one.
        await world.restoreSession(user, user.sessionId);
        await signIn(replay, baseURL!, user, {locale});
        await replayPage.goto('/');
        await expect(replayPage).toHaveURL(`${baseURL}/login?error=session_ended`);
        await expect(alertOf(replayPage)).toHaveText(label(locale, 'login.error.session_ended'));
      } finally {
        await replay.close();
      }
      await page.goto('/projects');
      await expect(page).toHaveURL(`${baseURL}/login?error=not_signed_in`);
    });
  }

  test('works from the keyboard alone', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    await page.goto('/');
    await accountButton(page, 'en').focus();
    await page.keyboard.press('Enter');
    await expect(accountPanel(page, 'en')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(signOutButton(page, 'en')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/login?notice=signed_out`);
    expect((await world.grantOf(user.sessionId))!.revoked_reason).toBe('sign_out');
  });

  test('is a comfortable touch target and fits the screen, with enlarged text too', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    await page.goto('/');
    const session = await context.newCDPSession(page);
    await session.send('Page.setFontSizes', {fontSizes: {standard: 28, fixed: 28}});
    await page.reload();
    await accountButton(page, 'en').click();
    const button = signOutButton(page, 'en');
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('the open menu has no accessibility violations (English light, Hebrew dark)', async ({page, context, baseURL}) => {
    for (const [locale, theme] of [['en', 'light'], ['he', 'dark']] as const) {
      const user = await member();
      await context.clearCookies();
      await signIn(context, baseURL!, user, {locale, theme});
      await page.goto('/');
      await accountButton(page, locale).click();
      await expect(signOutButton(page, locale)).toBeVisible();
      expect(await violations(page), `${locale} ${theme}`).toEqual([]);
    }
  });

  for (const locale of locales) {
    test(`says so and keeps the session when the revocation cannot be recorded; trying again signs out (${locale})`, async ({page, context, baseURL}) => {
      const user = await member();
      await signIn(context, baseURL!, user, {locale});
      await page.goto(flaky(baseURL!, '/projects'));
      await expect(mainNav(page, locale)).toBeVisible();

      startOutage(user.id, {rpc: ['revoke_grants']});
      try {
        await accountButton(page, locale).click();
        await signOutButton(page, locale).click();
        // The failure is shown in the menu and announced through the page's one live region, once.
        await expect(accountPanel(page, locale).locator('.notice-danger')).toHaveText(label(locale, 'account.signOutFailed'));
        await expect(liveRegion(page)).toHaveText(label(locale, 'account.signOutFailed'));
        expect(await violations(page), 'with the failure showing').toEqual([]);
        // Closing the menu forgets the failure: it does not greet the next time the menu opens.
        await page.keyboard.press('Escape');
        await expect(accountPanel(page, locale)).toHaveCount(0);
        await accountButton(page, locale).click();
        await expect(accountPanel(page, locale).locator('.notice')).toHaveCount(0);
        await signOutButton(page, locale).click();
        await expect(accountPanel(page, locale).locator('.notice-danger')).toHaveText(label(locale, 'account.signOutFailed'));
        // Still signed in, here and at the server: nothing was revoked, nothing was ended.
        await expect(page).toHaveURL(flaky(baseURL!, '/projects'));
        await expect(mainNav(page, locale)).toBeVisible();
        expect(await sessionCookies(context, user)).toHaveLength(1);
        expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
        expect(await world.sessionExists(user.sessionId)).toBe(true);
        await page.goto(flaky(baseURL!, '/settings'));
        await expect(mainNav(page, locale)).toBeVisible();
      } finally {
        endOutage(user.id);
      }

      // The database is back: the same person signs out.
      await accountButton(page, locale).click();
      await signOutButton(page, locale).click();
      await expect(page).toHaveURL(flaky(baseURL!, '/login?notice=signed_out'));
      expect((await world.grantOf(user.sessionId))!.revoked_reason).toBe('sign_out');
      expect(await sessionCookies(context, user)).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------
test.describe('sign out my other sessions', () => {
  /** The same person on two more devices: each its own browser, session and grant. */
  async function twoDevices(browser: Browser, baseURL: string, user: ForgedUser, locale: Locale = 'en') {
    const second = await world.extraSession(user);
    await world.grant(user, second.sessionId);
    const context = await browser.newContext({baseURL});
    await signIn(context, baseURL, {cookie: second.cookie}, {locale});
    return {context, page: await context.newPage(), sessionId: second.sessionId};
  }

  for (const locale of locales) {
    test(`revokes every other grant at once and the current session continues (${locale})`, async ({page, context, browser, baseURL}) => {
      const user = await member();
      const third = await world.extraSession(user);
      await world.grant(user, third.sessionId);
      const bystander = await member();
      const other = await twoDevices(browser, baseURL!, user, locale);
      const bystanderContext = await browser.newContext({baseURL});
      try {
        await signIn(bystanderContext, baseURL!, bystander);
        const bystanderPage = await bystanderContext.newPage();
        await bystanderPage.goto('/');
        await other.page.goto('/');
        await expect(mainNav(other.page, locale)).toBeVisible();

        await signIn(context, baseURL!, user, {locale});
        const problems = watchForProblems(page);
        await page.goto('/settings');
        await expect(page.getByRole('heading', {level: 2, name: label(locale, 'settings.sessions.title')})).toBeVisible();
        await otherSessionsButton(page, locale).click();
        // Two other sessions were in use, and it says so, in the person's language; the live region says it too.
        await expect(sessionsNotice(page, 'success')).toHaveText(label(locale, 'settings.sessions.done', {count: 2}));
        await expect(liveRegion(page)).toHaveText(label(locale, 'settings.sessions.done', {count: 2}));
        expect(problems).toEqual([]);

        // Every other grant is revoked, this one is not, and nobody else's is touched.
        expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
        for (const sessionId of [other.sessionId, third.sessionId]) {
          expect(await world.grantOf(sessionId), sessionId).toMatchObject({revoked_by: `user:${user.id}`, revoked_reason: 'sign_out_others'});
          // Auth was asked to end them too.
          expect(await world.sessionExists(sessionId), sessionId).toBe(false);
        }
        expect(await world.sessionExists(user.sessionId)).toBe(true);
        expect((await world.grantOf(bystander.sessionId))!.revoked_at).toBeNull();

        // The current session carries on; the other device is signed out; the bystander is not.
        await page.goto('/projects');
        await expect(page).toHaveURL(`${baseURL}/projects`);
        await expect(mainNav(page, locale)).toBeVisible();
        await other.page.goto('/projects');
        await expect(other.page).toHaveURL(`${baseURL}/login?error=not_signed_in`);
        await expect(alertOf(other.page)).toHaveText(label(locale, 'login.error.not_signed_in'));
        await bystanderPage.goto('/projects');
        await expect(bystanderPage).toHaveURL(`${baseURL}/projects`);
      } finally {
        await other.context.close();
        await bystanderContext.close();
      }
    });
  }

  test('says so and changes nothing when the revocation cannot be recorded; trying again works', async ({page, context, browser, baseURL}) => {
    const user = await member();
    const other = await twoDevices(browser, baseURL!, user);
    try {
      await signIn(context, baseURL!, user);
      await page.goto(flaky(baseURL!, '/settings'));
      startOutage(user.id, {rpc: ['revoke_grants']});
      try {
        await otherSessionsButton(page, 'en').click();
        await expect(sessionsNotice(page, 'danger')).toHaveText(label('en', 'settings.sessions.failed'));
        await expect(liveRegion(page)).toHaveText(label('en', 'settings.sessions.failed'));
        await expect(sessionsNotice(page, 'success')).toHaveCount(0);
        expect(await violations(page), 'with the failure showing').toEqual([]);
        expect((await world.grantOf(other.sessionId))!.revoked_at).toBeNull();
        expect(await world.sessionExists(other.sessionId)).toBe(true);
        await other.page.goto(flaky(baseURL!, '/'));
        await expect(mainNav(other.page, 'en')).toBeVisible();
      } finally {
        endOutage(user.id);
      }
      await otherSessionsButton(page, 'en').click();
      await expect(sessionsNotice(page, 'success')).toHaveText(label('en', 'settings.sessions.done', {count: 1}));
      await expect(sessionsNotice(page, 'danger')).toHaveCount(0);
      expect((await world.grantOf(other.sessionId))!.revoked_reason).toBe('sign_out_others');
    } finally {
      await other.context.close();
    }
  });

  for (const locale of locales) {
    test(`with nothing else signed in, says so (${locale})`, async ({page, context, baseURL}) => {
      const user = await member();
      await signIn(context, baseURL!, user, {locale});
      await page.goto('/settings');
      await otherSessionsButton(page, locale).click();
      await expect(sessionsNotice(page, 'success')).toHaveText(label(locale, 'settings.sessions.none'));
      await expect(liveRegion(page)).toHaveText(label(locale, 'settings.sessions.none'));
      expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
    });
  }

  test('does not count the sessions that had already ended: a grant that lapsed is cleaned up without being "signed out"', async ({page, context, baseURL}) => {
    const user = await member();
    const lapsed = await world.extraSession(user);
    await world.grant(user, lapsed.sessionId);
    await world.ageGrant(lapsed.sessionId, 40, 0);
    await signIn(context, baseURL!, user);
    await page.goto('/settings');
    await otherSessionsButton(page, 'en').click();
    await expect(sessionsNotice(page, 'success')).toHaveText(label('en', 'settings.sessions.none'));
    expect((await world.grantOf(lapsed.sessionId))!.revoked_reason).toBe('sign_out_others');
  });

  test('a double press sends one request, however fast: two submits in one task, before the page has re-rendered, and then a double click', async ({page, context, browser, baseURL}) => {
    const user = await member();
    const other = await twoDevices(browser, baseURL!, user);
    try {
      await signIn(context, baseURL!, user);
      await page.goto('/settings');
      const posts: string[] = [];
      page.on('request', (request) => request.method() === 'POST' && posts.push(request.url()));
      // Two submit events in the same task: nothing has re-rendered between them, so only a lock taken
      // synchronously in the submit handler (not the "pending" state) can tell them apart.
      await otherSessionsButton(page, 'en').evaluate((button) => {
        const form = (button as HTMLButtonElement).form!;
        form.requestSubmit();
        form.requestSubmit();
      });
      await expect(sessionsNotice(page, 'success')).toHaveText(label('en', 'settings.sessions.done', {count: 1}));
      expect(posts).toHaveLength(1);
      expect(await world.auditEvents('session.revoked', `session:${other.sessionId}`)).toHaveLength(1);

      // And an ordinary fast double click, once the first has finished: one more request, not two.
      await otherSessionsButton(page, 'en').dblclick();
      await expect(sessionsNotice(page, 'success')).toHaveText(label('en', 'settings.sessions.none'));
      expect(posts).toHaveLength(2);
    } finally {
      await other.context.close();
    }
  });

  test('a double press of sign out sends one request too', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    await page.goto('/');
    await accountButton(page, 'en').click();
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && posts.push(request.url()));
    await signOutButton(page, 'en').evaluate((button) => {
      const form = (button as HTMLButtonElement).form!;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page).toHaveURL(`${baseURL}/login?notice=signed_out`);
    expect(posts).toHaveLength(1);
  });

  test('is a comfortable touch target, fits the screen with enlarged text, and has no accessibility violations (English light, Hebrew dark)', async ({page, context, baseURL}) => {
    for (const [locale, theme] of [['en', 'light'], ['he', 'dark']] as const) {
      const user = await member();
      await context.clearCookies();
      await signIn(context, baseURL!, user, {locale, theme});
      await page.goto('/settings');
      const button = otherSessionsButton(page, locale);
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(await violations(page), `${locale} ${theme}`).toEqual([]);
      await button.click();
      await expect(sessionsNotice(page, 'success')).toHaveText(label(locale, 'settings.sessions.none'));
      expect(await violations(page), `${locale} ${theme} after`).toEqual([]);
      const session = await context.newCDPSession(page);
      await session.send('Page.setFontSizes', {fontSizes: {standard: 28, fixed: 28}});
      await page.reload();
      expect(await overflow(page), `${locale} enlarged`).toBeLessThanOrEqual(0);
    }
  });

  test('is not for a session that has lost its grant: it is sent to sign in, and revokes nothing', async ({page, context, browser, baseURL}) => {
    const user = await member();
    const other = await twoDevices(browser, baseURL!, user);
    try {
      await signIn(context, baseURL!, user);
      await page.goto('/settings');
      await world.revokeGrant(user, user.sessionId);
      await otherSessionsButton(page, 'en').click();
      await expect(page).toHaveURL(`${baseURL}/login?error=session_ended`);
      expect((await world.grantOf(other.sessionId))!.revoked_at).toBeNull();
    } finally {
      await other.context.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the accounts database is unreachable', () => {
  for (const locale of locales) {
    for (const mode of ['down', 'error'] as const) {
      test(`denies with a retryable page, keeps the session, honors nothing cached, and lets the person back in when it clears (${locale}, ${mode})`, async ({page, context, baseURL}) => {
        const user = await member();
        await signIn(context, baseURL!, user, {locale});
        const home = flaky(baseURL!, '/');

        await page.goto(flaky(baseURL!, '/projects'));
        await expect(mainNav(page, locale)).toBeVisible();

        startOutage(user.id, {rpc: ['authorize_session'], mode});
        try {
          // A page the browser already has open is no pass: the next request is denied.
          await page.goto(flaky(baseURL!, '/progress'));
          await expect(page).toHaveURL(flaky(baseURL!, '/login?error=auth_unavailable'));
          await expect(alertOf(page)).toContainText(label(locale, 'login.error.auth_unavailable'));
          await expect(retryLink(page, locale)).toBeVisible();
          await expect(page.getByRole('navigation')).toHaveCount(0);
          expect(await violations(page)).toEqual([]);
          // Every private path is denied the same way, and nothing private is shown.
          for (const path of ['/', '/settings', '/projects/anything']) {
            await page.goto(flaky(baseURL!, path));
            await expect(page, path).toHaveURL(flaky(baseURL!, '/login?error=auth_unavailable'));
            await expect(page.getByRole('navigation'), path).toHaveCount(0);
          }
          // The session was kept: the cookie, the Auth session and the grant are as they were.
          expect(await sessionCookies(context, user)).toHaveLength(1);
          expect(await world.sessionExists(user.sessionId)).toBe(true);
          expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
          // And the sign-in page itself still answers.
          await expect(page.getByRole('button', {name: label(locale, 'login.google')})).toBeVisible();
        } finally {
          endOutage(user.id);
        }

        // The database is back: asking again is enough.
        await page.goto(flaky(baseURL!, '/login?error=auth_unavailable'));
        await retryLink(page, locale).click();
        await expect(page).toHaveURL(home);
        await expect(mainNav(page, locale)).toBeVisible();
      });
    }
  }

  test('denies a private /api request with a retryable 503 JSON answer, and keeps the session', async ({context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    startOutage(user.id, {rpc: ['authorize_session']});
    try {
      const response = await context.request.get(flaky(baseURL!, '/api/anything'), {maxRedirects: 0});
      expect(response.status()).toBe(503);
      expect(response.headers()['content-type']).toMatch(/^application\/json/);
      expect(response.headers()['retry-after']).toBe('5');
      expect(await response.json()).toEqual({error: 'auth_unavailable', retryable: true});
    } finally {
      endOutage(user.id);
    }
    expect(await sessionCookies(context, user)).toHaveLength(1);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
    // The outage over, the same request is let through to the route, which answers 404 as it does for any Account.
    const after = await context.request.get(flaky(baseURL!, '/api/anything'), {maxRedirects: 0});
    expect(after.status()).toBe(404);
  });

  test('is a database failure for this user only: another user is not affected', async ({page, context, browser, baseURL}) => {
    const down = await member();
    const fine = await member();
    const other = await browser.newContext({baseURL});
    try {
      await signIn(context, baseURL!, down);
      await signIn(other, baseURL!, fine);
      const otherPage = await other.newPage();
      startOutage(down.id, {rpc: ['authorize_session']});
      try {
        await page.goto(flaky(baseURL!, '/'));
        await expect(page).toHaveURL(flaky(baseURL!, '/login?error=auth_unavailable'));
        await otherPage.goto(flaky(baseURL!, '/'));
        await expect(mainNav(otherPage, 'en')).toBeVisible();
      } finally {
        endOutage(down.id);
      }
    } finally {
      await other.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a private /api path answers JSON, never HTML or a redirect', () => {
  const expectJson = async (response: Awaited<ReturnType<BrowserContext['request']['get']>>, status: number, error: string) => {
    expect(response.status()).toBe(status);
    expect(response.headers()['content-type']).toMatch(/^application\/json/);
    expect(response.headers()['location']).toBeUndefined();
    expect(response.headers()['cache-control']).toMatch(/no-store/);
    expect(await response.json()).toMatchObject({error});
  };

  test('401 when signed out, for any method, with or without an HTML Accept header', async ({context}) => {
    await expectJson(await context.request.get('/api/projects', {maxRedirects: 0}), 401, 'not_signed_in');
    await expectJson(await context.request.get('/api/projects', {maxRedirects: 0, headers: {accept: 'text/html,application/xhtml+xml'}}), 401, 'not_signed_in');
    await expectJson(await context.request.post('/api/projects', {maxRedirects: 0, data: {}}), 401, 'not_signed_in');
    await expectJson(await context.request.delete('/api/projects/1', {maxRedirects: 0}), 401, 'not_signed_in');
    expect((await context.request.get('/api/health')).status()).toBe(200);
  });

  for (const [name, arrange, options] of [
    ['missing', async () => undefined, {grant: false}],
    ['revoked', (user: ForgedUser) => world.revokeGrant(user, user.sessionId), {}],
    ['expired', (user: ForgedUser) => world.ageGrant(user.sessionId, 31, 0), {}],
    ['idle', (user: ForgedUser) => world.ageGrant(user.sessionId, 10, 8), {}],
    ['stale', (user: ForgedUser) => world.raiseEpoch(user), {}],
  ] as [string, (user: ForgedUser) => Promise<unknown>, {grant?: boolean}][]) {
    test(`401 session_ended for a valid token whose grant is ${name}`, async ({context, baseURL}) => {
      const user = await member(options);
      await arrange(user);
      await signIn(context, baseURL!, user);
      await expectJson(await context.request.get('/api/projects', {maxRedirects: 0}), 401, 'session_ended');
    });
  }

  test('401 not_signed_in, not session_ended, when Auth has no session for the token', async ({context, baseURL}) => {
    const user = await member();
    await world.db.query('delete from auth.sessions where id = $1', [user.sessionId]);
    await signIn(context, baseURL!, user);
    await expectJson(await context.request.get('/api/projects', {maxRedirects: 0}), 401, 'not_signed_in');
  });

  test('403 for an identity with no Account, a disabled Account (which is signed out), and a changed Google identity', async ({context, baseURL}) => {
    const stranger = await world.signedInUser();
    await signIn(context, baseURL!, stranger);
    await expectJson(await context.request.get('/api/projects', {maxRedirects: 0}), 403, 'account_required');

    const disabled = await member();
    await world.setStatus(disabled, 'disabled');
    await context.clearCookies();
    await signIn(context, baseURL!, disabled);
    await expectJson(await context.request.get('/api/projects', {maxRedirects: 0}), 403, 'account_disabled');
    expect(await world.sessionExists(disabled.sessionId)).toBe(false);

    const changed = await member();
    await world.db.query(`update auth.identities set provider_id = $2 where user_id = $1`, [changed.id, `changed-${changed.sessionId}`]);
    await context.clearCookies();
    await signIn(context, baseURL!, changed);
    await expectJson(await context.request.get('/api/projects', {maxRedirects: 0}), 403, 'not_allowed');
  });

  test('is let through for an Account with a valid grant: the route itself answers (here, that there is none)', async ({context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    const response = await context.request.get('/api/projects', {maxRedirects: 0});
    expect(response.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('how many authorization calls a request costs', () => {
  // React's cache() is what shares the page's answer between the things that ask inside one render. It cannot be
  // observed from a test, so this measures what it makes true instead: the calls the database receives.
  test('a page request costs two calls (the proxy\'s and the page\'s) and an /api request costs one (the proxy\'s)', async ({context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    forgetCalls(user.id);
    const page = await context.request.get(flaky(baseURL!, '/settings'));
    expect(page.status()).toBe(200);
    expect(callsFor(user.id)).toEqual(['authorize_session', 'authorize_session']);

    // A path under /api that has no handler is answered by the 404 page, which is a page of the root layout, and since
    // Story 1.4d the layout asks for the Account (to render its preferences) when the request carries a session: the
    // proxy's call and the layout's. Both share the same memoized answer inside the render, so it is never three.
    forgetCalls(user.id);
    const missing = await context.request.get(flaky(baseURL!, '/api/anything'), {maxRedirects: 0});
    expect(missing.status()).toBe(404);
    expect(callsFor(user.id)).toEqual(['authorize_session', 'authorize_session']);
  });

  test('the root layout asks for the Account only when there is a session, and shares the page\'s answer (Story 1.4d)', async ({context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    // A public page with a session: the proxy asks nobody, the layout asks once.
    forgetCalls(user.id);
    const kit = await context.request.get(flaky(baseURL!, '/kit'));
    expect(kit.status()).toBe(200);
    expect(callsFor(user.id)).toEqual(['authorize_session']);
    // A private page: the proxy's and the one the layout, the metadata and the page share.
    forgetCalls(user.id);
    expect((await context.request.get(flaky(baseURL!, '/progress'))).status()).toBe(200);
    expect(callsFor(user.id)).toEqual(['authorize_session', 'authorize_session']);
    // A page that does not exist is a page of the layout too.
    forgetCalls(user.id);
    expect((await context.request.get(flaky(baseURL!, '/no-such-page'))).status()).toBe(404);
    expect(callsFor(user.id)).toEqual(['authorize_session', 'authorize_session']);
  });

  test('issues no grant on a private request, however often it is made', async ({context, baseURL}) => {
    const user = await member({grant: false});
    await signIn(context, baseURL!, user);
    forgetCalls(user.id);
    for (let request = 0; request < 3; request += 1) await context.request.get(flaky(baseURL!, '/projects'), {maxRedirects: 0});
    expect(callsFor(user.id).filter((name) => name !== 'authorize_session')).toEqual([]);
    expect(await world.grantsOf(user)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('two tabs of one session', () => {
  test('once one tab has signed out, the other tab\'s "sign out my other sessions" is turned away, and revokes nothing', async ({context, browser, baseURL}) => {
    const user = await member();
    const elsewhere = await twoDevicesFor(browser, baseURL!, user);
    try {
      await signIn(context, baseURL!, user);
      const tabA = await context.newPage();
      const tabB = await context.newPage();
      await tabA.goto('/');
      await tabB.goto('/settings');
      await expect(otherSessionsButton(tabB, 'en')).toBeVisible();

      await accountButton(tabA, 'en').click();
      await signOutButton(tabA, 'en').click();
      await expect(tabA).toHaveURL(`${baseURL}/login?notice=signed_out`);

      // Tab B still shows its button; pressing it finds no session, and the page goes to sign-in.
      await otherSessionsButton(tabB, 'en').click();
      await expect(tabB).toHaveURL(`${baseURL}/login?error=not_signed_in`);
      expect((await world.grantOf(elsewhere.sessionId))!.revoked_at).toBeNull();
    } finally {
      await elsewhere.context.close();
    }
  });

  test('an action that was pending in one tab when the other signed out is turned away the same way', async ({context, browser, baseURL}) => {
    const user = await member();
    const elsewhere = await twoDevicesFor(browser, baseURL!, user);
    try {
      await signIn(context, baseURL!, user);
      const tabA = await context.newPage();
      const tabB = await context.newPage();
      await tabA.goto('/');
      await tabB.goto('/settings');

      // Hold tab B's request before it reaches the server.
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let seen = false;
      await tabB.route('**/settings', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        seen = true;
        await held;
        return route.continue();
      });
      await otherSessionsButton(tabB, 'en').click();
      await expect.poll(() => seen).toBe(true);

      await accountButton(tabA, 'en').click();
      await signOutButton(tabA, 'en').click();
      await expect(tabA).toHaveURL(`${baseURL}/login?notice=signed_out`);

      release();
      await expect(tabB).toHaveURL(`${baseURL}/login?error=not_signed_in`);
      expect((await world.grantOf(elsewhere.sessionId))!.revoked_at).toBeNull();
    } finally {
      await elsewhere.context.close();
    }
  });
});

async function twoDevicesFor(browser: Browser, baseURL: string, user: ForgedUser) {
  const second = await world.extraSession(user);
  await world.grant(user, second.sessionId);
  const context = await browser.newContext({baseURL});
  await signIn(context, baseURL, {cookie: second.cookie});
  return {context, sessionId: second.sessionId};
}

// ---------------------------------------------------------------------------------------------------
test.describe('a registration retried after its answer was lost', () => {
  const codeField = (page: Page) => page.getByRole('textbox', {name: label('en', 'register.code.label'), exact: true});
  const commandIdOf = (page: Page) => page.locator('input[name="commandId"]').inputValue();
  const unknownCode = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ';
  test.afterEach(async () => {
    // A mismatched command counts one failure against the origin every test browser shares.
    await world.resetLimiter();
  });

  test('is repaired: the same command and code give the session its grant, and the person lands on Home', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    const command = await commandIdOf(page);
    // The server registered the person and then lost the answer, before the session got its grant.
    const code = await world.registerWithoutGrant(person, command);
    expect(await world.grantsOf(person)).toEqual([]);

    await codeField(page).fill(code);
    await page.getByRole('button', {name: label('en', 'register.submit')}).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(mainNav(page, 'en')).toBeVisible();
    expect(await world.grantsOf(person)).toEqual([person.sessionId]);
    expect(await world.auditEvents('session.issued', `session:${person.sessionId}`)).toHaveLength(1);
  });

  test('is not a way to a grant for anyone else: a session of a user who has an Account, with another command, gets none', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    // The Account came about some other way (and this session predates grants): the form's command is not the one that made it.
    await world.activate(person, {grant: false});

    await codeField(page).fill(unknownCode);
    await page.getByRole('button', {name: label('en', 'register.submit')}).click();
    await expect(page).toHaveURL(`${baseURL}/login?error=session_ended`);
    await expect(alertOf(page)).toHaveText(label('en', 'login.error.session_ended'));
    expect(await world.grantsOf(person)).toEqual([]);
  });

  test('is not repaired by the right command with another code', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    const command = await commandIdOf(page);
    await world.registerWithoutGrant(person, command);

    await codeField(page).fill(unknownCode);
    await page.getByRole('button', {name: label('en', 'register.submit')}).click();
    await expect(page).toHaveURL(`${baseURL}/login?error=session_ended`);
    expect(await world.grantsOf(person)).toEqual([]);
  });

  test('is only for a session that never had a grant: opening the registration page itself is turned away', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await world.activate(person, {grant: false});
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    await expect(page).toHaveURL(`${baseURL}/login?error=session_ended`);
  });
});
