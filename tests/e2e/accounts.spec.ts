import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import type {Locale, MessageKey} from '../../lib/i18n';
import {addFakeAccount, chooserAccount, chooserUrl, fakeGoogleActive} from '../support/fake-google';
import {announcer, hydrated, label, mainNav, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {endGlobalOutage, endOutage, flakyBaseUrl, startGlobalOutage, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';
import {sessionCookieName} from '../support/session-cookie';

// Story 1.5: the Administrator's Accounts page (AD-02) and the Administration index, in a real browser against the production
// build and the local Supabase stack. Each test forges the Administrator's session and, where the flow needs one, the
// fresh-authentication marker a completed step-up writes (tests/support/forged-session.ts); the REAL step-up, with a second
// Google sign-in, is driven against the fake Google in tests/e2e/step-up.spec.ts, and a real sign-in of a disabled person
// and of the same person after a re-enable is driven at the end of this file. Auth still validates the token, so the
// application's own proxy, authorization, role check and marker check all run. Every flow runs on `desktop` and `phone`.
//
// Tests find their own rows by the address of the member they made, in a database every test shares.

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const path = '/admin/accounts';
const crossing = {timeout: 20_000};

type Options = {locale?: Locale; theme?: 'light' | 'dark'; marker?: boolean | 'expired'};

/** An Administrator with an Account, the grant of their forged session and, if asked, a marker; signed in, on the page, hydrated. */
async function administrator(page: Page, context: BrowserContext, baseURL: string, options: Options = {}) {
  const user = await world.signedInUser();
  await world.activate(user);
  await world.makeAdministrator(user);
  if (options.marker) await world.forgeMarker(user, user.sessionId, {expired: options.marker === 'expired'});
  await signIn(context, baseURL, user, {locale: options.locale ?? 'en', theme: options.theme ?? 'light'});
  await open(page);
  return user;
}

/** A member with an Account made with a named code, and the given number of live sessions (each with its grant). */
async function member(options: {sessions?: number; email?: string} = {}) {
  const user = await world.signedInUser(options.email ? {email: options.email} : {});
  await world.activate(user);
  const extra = [];
  for (let index = 1; index < (options.sessions ?? 1); index += 1) extra.push(await world.liveSession(user));
  return Object.assign(user, {extra, invitationName: `e2e ${user.id.slice(0, 8)}`});
}

async function open(page: Page, url: string = path) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await hydrated(page, 'main form button');
}

const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const row = (page: Page, email: string) => page.locator('.invite-item').filter({hasText: email});
const disableButton = (page: Page, email: string, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'accounts.row.disableLabel', {name: email})});
const enableButton = (page: Page, email: string, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'accounts.row.enableLabel', {name: email})});
const dialog = (page: Page) => page.getByRole('dialog');
const alerts = (page: Page) => page.locator('.notice[role="alert"]');
const stepUpLink = (page: Page, locale: Locale = 'en') => page.getByRole('link', {name: t(locale, 'invitations.confirm.action')});
const badge = (item: ReturnType<typeof row>, locale: Locale, status: 'active' | 'disabled') => item.locator('.status-badge').filter({hasText: new RegExp(`^${t(locale, `accounts.status.${status}`)}$`)});
const listHeading = (page: Page, locale: Locale = 'en') => page.getByRole('heading', {level: 2, name: t(locale, 'accounts.list.title')});

/** Disables through the dialog, the way a person does: Disable, then the confirming button. */
async function disableThroughDialog(page: Page, email: string, locale: Locale = 'en') {
  await disableButton(page, email, locale).click();
  await dialog(page).getByRole('button', {name: t(locale, 'accounts.disable.confirm')}).click();
}
async function enableThroughDialog(page: Page, email: string, locale: Locale = 'en') {
  await enableButton(page, email, locale).click();
  await dialog(page).getByRole('button', {name: t(locale, 'accounts.enable.confirm')}).click();
}

/** What a disable says above the list: the Account, the sessions that ended, the Jobs that were cancelled (none can exist yet). */
const disabledMessage = (locale: Locale, email: string, sessions: number) =>
  [t(locale, 'accounts.disable.done', {name: email}), t(locale, 'accounts.disable.sessions', {count: sessions}), t(locale, 'accounts.disable.jobs', {count: 0})].join(' ');

// ---------------------------------------------------------------------------------------------------
test.describe('who may open the pages', () => {
  test('a member gets the 404 page for the Accounts page and for the Administration index, and no link to either', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await signIn(context, baseURL!, user);
    for (const url of [path, '/admin']) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(404);
      await expect(page.getByRole('heading', {level: 1, name: t('en', 'notFound.title')})).toBeVisible();
      // The 404 for a member names nothing about the page: its title is the 404 page's, the one a page that does not exist has.
      await expect(page).toHaveTitle(`${t('en', 'meta.notFound')} · nova3D`);
      await expect(page.getByRole('button', {name: new RegExp(t('en', 'accounts.row.disable'))})).toHaveCount(0);
      await expect(page.locator('.invite-item')).toHaveCount(0);
    }
    await page.goto('/settings');
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'settings.title')})).toBeVisible();
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  });

  test('a signed-out visitor is sent to sign in', async ({page, baseURL}) => {
    for (const url of [path, '/admin']) {
      await page.goto(url);
      await expect(page).toHaveURL(new RegExp(`^${baseURL}/login`));
    }
  });

  test('the Administrator finds it from the Administration index, and Back leads up one level at a time', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await signIn(context, baseURL!, user);
    await page.goto('/admin');
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'admin.title')})).toBeVisible();
    await expect(page.getByRole('heading', {level: 2})).toHaveText([t('en', 'admin.invitations.title'), t('en', 'admin.accounts.title')]);
    await page.getByRole('link', {name: t('en', 'admin.accounts.open')}).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, crossing);
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'accounts.title')})).toBeVisible();
    await expect(page).toHaveTitle(`${t('en', 'meta.accounts')} · nova3D`);
    await expect(page.locator('.back-link')).toHaveAttribute('href', '/admin');
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(`${baseURL}/admin`, crossing);
    await expect(page.locator('.back-link')).toHaveAttribute('href', '/settings');
  });

  test('the Administration index says the person has confirmed it is them when they have, and nothing when they have not', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await signIn(context, baseURL!, user);
    await page.goto('/admin');
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'admin.title')})).toBeVisible();
    await expect(page.locator('.notice')).toHaveCount(0);
    await world.forgeMarker(user, user.sessionId);
    await page.reload();
    await expect(page.locator('.notice-success')).toContainText(t('en', 'admin.confirm.ok'));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the list', () => {
  test('shows each Account with its address, role, invitation, status and time, and nothing of a Workspace', async ({page, context, baseURL}) => {
    const person = await member({sessions: 2});
    const disabled = await member();
    await world.setStatus(disabled, 'disabled');
    const user = await administrator(page, context, baseURL!, {marker: true});

    const mine = row(page, person.email);
    await expect(mine).toBeVisible();
    await expect(mine.getByRole('heading', {level: 3})).toHaveText(person.email);
    await expect(mine).toContainText(t('en', 'accounts.row.role.member'));
    await expect(mine).toContainText(person.invitationName);
    await expect(badge(mine, 'en', 'active')).toBeVisible();
    await expect(mine.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    await expect(disableButton(page, person.email)).toBeVisible();
    await expect(enableButton(page, person.email)).toHaveCount(0);

    await expect(badge(row(page, disabled.email), 'en', 'disabled')).toBeVisible();
    await expect(enableButton(page, disabled.email)).toBeVisible();
    await expect(disableButton(page, disabled.email)).toHaveCount(0);

    // The Administrator's own Account is listed, and has neither control.
    const own = row(page, user.email);
    await expect(own).toContainText(t('en', 'accounts.row.role.administrator'));
    await expect(own).toContainText(t('en', 'accounts.row.administratorNote'));
    await expect(own.getByRole('button')).toHaveCount(0);

    // No Workspace content, project name or usage is on the page: not its ID, not a word for one.
    const html = await page.content();
    for (const workspace of [await world.workspaceIdOf(person), await world.workspaceIdOf(disabled), await world.workspaceIdOf(user)]) expect(html).not.toContain(workspace!);
    expect(html).not.toMatch(/workspace_id|workspaces/i);
    await expect(mine.locator('dt')).toHaveText([t('en', 'accounts.row.role'), t('en', 'accounts.row.invitation'), t('en', 'accounts.row.created')]);
  });

  test('shows every status as a word and a shape, never a colour alone', async ({page, context, baseURL}) => {
    const disabled = await member();
    await world.setStatus(disabled, 'disabled');
    const person = await member();
    await administrator(page, context, baseURL!, {marker: false});
    for (const [who, status] of [[person, 'active'], [disabled, 'disabled']] as const) {
      const mark = badge(row(page, who.email), 'en', status);
      await expect(mark).toBeVisible();
      await expect(mark.locator('svg')).toHaveCount(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('without a fresh sign-in', () => {
  for (const marker of [false, 'expired', 'another class'] as const) {
    test(`a disable is refused, nothing changes, the step-up is offered, and the refusal is audited once (${marker === false ? 'no marker' : marker === 'expired' ? 'a marker that ran out' : 'only a marker of another class'})`, async ({page, context, baseURL}) => {
      const person = await member({sessions: 2});
      const user = await administrator(page, context, baseURL!, {marker: marker === 'expired' ? 'expired' : false});
      if (marker === 'another class') await world.forgeMarker(user, user.sessionId, {actionClass: 'owner_deletion'});
      const actor = `user:${user.id}`;
      const target = `account:${(await world.accountOf(person)).id}`;
      // Offered beforehand, as a link to the step-up for administration: the server picks where it returns to.
      await expect(stepUpLink(page)).toHaveAttribute('href', '/step-up?for=administration');
      await expect(page.locator('.notice-success')).toHaveCount(0);

      await disableThroughDialog(page, person.email);
      const refused = alerts(page).filter({hasText: t('en', 'accounts.error.needsConfirm')});
      await expect(refused).toBeVisible(crossing);
      await expect(refused.getByRole('link', {name: t('en', 'invitations.confirm.action')})).toHaveAttribute('href', '/step-up?for=administration');
      // Nothing changed: still enabled, still signed in everywhere, same epoch.
      await expect(badge(row(page, person.email), 'en', 'active')).toBeVisible();
      expect(await world.accountOf(person)).toMatchObject({status: 'active', epoch: 1});
      expect(await world.authSessionsOf(person.id)).toHaveLength(2);
      for (const sessionId of await world.grantsOf(person)) expect((await world.grantOf(sessionId))!.revoked_at).toBeNull();
      expect(await world.auditBy(actor, 'account.disable_refused')).toEqual([expect.objectContaining({actor, action: 'account.disable_refused', target})]);

      // Pressing again is the same refusal and the same one audit event: once an hour.
      await disableThroughDialog(page, person.email);
      await expect(refused).toBeVisible();
      expect(await world.auditBy(actor, 'account.disable_refused')).toHaveLength(1);
      expect(await world.auditEvents('account.disabled', target)).toEqual([]);
    });
  }

  test('a re-enable is refused too: the Account stays disabled, and the attempt is audited as an enable refusal', async ({page, context, baseURL}) => {
    const person = await member();
    await world.setStatus(person, 'disabled');
    const user = await administrator(page, context, baseURL!, {marker: false});
    await enableThroughDialog(page, person.email);
    await expect(row(page, person.email).locator('.notice[role="alert"]')).toContainText(t('en', 'accounts.error.needsConfirm'), crossing);
    expect((await world.accountOf(person)).status).toBe('disabled');
    const target = `account:${(await world.accountOf(person)).id}`;
    expect(await world.auditBy(`user:${user.id}`, 'account.enable_refused')).toEqual([expect.objectContaining({target})]);
    expect(await world.auditEvents('account.enabled', target)).toEqual([]);
  });

  test('a fresh sign-in that runs out while the page is open re-reads the page: the green note gives way to the step-up note', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await administrator(page, context, baseURL!, {marker: true});
    await expect(page.locator('.notice-success')).toContainText(t('en', 'accounts.confirm.ok'));
    await expect(stepUpLink(page)).toHaveCount(0);
    await world.expireMarker(user.sessionId);
    await disableThroughDialog(page, person.email);
    await expect(alerts(page).filter({hasText: t('en', 'accounts.error.needsConfirm')})).toBeVisible(crossing);
    await expect(page.locator('.notice-success')).toHaveCount(0);
    await expect(page.locator('.notice-warning').filter({hasText: t('en', 'accounts.confirm.needed')})).toBeVisible(crossing);
    expect((await world.accountOf(person)).status).toBe('active');
  });

  test('a person who stopped being the Administrator while the page was open is denied, audited as denied, and nothing changes', async ({page, context, baseURL}) => {
    const person = await member({sessions: 2});
    const user = await administrator(page, context, baseURL!, {marker: true});
    await world.db.query(`update identity.accounts set role = 'member' where user_id = $1`, [user.id]);
    await disableThroughDialog(page, person.email);
    await expect(alerts(page).filter({hasText: t('en', 'accounts.error.denied')})).toBeVisible(crossing);
    expect((await world.accountOf(person)).status).toBe('active');
    expect(await world.authSessionsOf(person.id)).toHaveLength(2);
    const target = `account:${(await world.accountOf(person)).id}`;
    expect(await world.auditBy(`user:${user.id}`, 'account.denied')).toEqual([expect.objectContaining({target})]);
    // And the page itself is now a page that does not exist for them.
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('disabling an Account', () => {
  test('asks first, in a dialog that starts on Cancel; Escape and Cancel change nothing; confirming disables in one step and keeps the Workspace', async ({page, context, baseURL}) => {
    const person = await member({sessions: 3});
    const user = await administrator(page, context, baseURL!, {marker: true});
    const target = `account:${(await world.accountOf(person)).id}`;
    const workspace = await world.workspaceIdOf(person);
    const sessionIds = await world.grantsOf(person);
    expect(sessionIds).toHaveLength(3);
    const item = row(page, person.email);
    const disable = disableButton(page, person.email);
    await expect(disable).toHaveText(t('en', 'accounts.row.disable'));

    await disable.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', {name: t('en', 'accounts.disable.title')})).toBeVisible();
    await expect(dialog(page)).toContainText(person.email);
    // It starts on Cancel, so Enter does not disable by accident.
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(disable).toBeFocused();
    expect((await world.accountOf(person)).status).toBe('active');

    await disable.click();
    await dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')}).click();
    await expect(dialog(page)).toHaveCount(0);
    expect((await world.accountOf(person)).status).toBe('active');

    // The keyboard moves between the dialog's two buttons, and the page behind it is out of reach.
    await disable.click();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'accounts.disable.confirm')})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'accounts.disable.confirm')})).toBeFocused();

    await dialog(page).getByRole('button', {name: t('en', 'accounts.disable.confirm')}).click();
    await expect(badge(item, 'en', 'disabled')).toBeVisible(crossing);
    await expect(enableButton(page, person.email)).toBeVisible();
    await expect(disableButton(page, person.email)).toHaveCount(0);
    const said = disabledMessage('en', person.email, 3);
    await expect(page.locator('.notice-success').filter({hasText: said})).toBeVisible();
    await expect(announcer(page)).toHaveText(said);
    await expect(listHeading(page)).toBeFocused();

    // In the database: the status and the epoch, every grant, every Auth session, the audit event; the Workspace is untouched.
    expect(await world.accountOf(person)).toMatchObject({status: 'disabled', epoch: 2});
    for (const sessionId of sessionIds) expect(await world.grantOf(sessionId)).toMatchObject({revoked_by: `user:${user.id}`, revoked_reason: 'disabled'});
    expect(await world.authSessionsOf(person.id)).toEqual([]);
    expect(await world.workspaceIdOf(person)).toBe(workspace);
    expect(await world.workspacesOf(person)).toBe(1);
    expect(await world.auditEvents('account.disabled', target)).toEqual([{actor: `user:${user.id}`, action: 'account.disabled', target}]);
    // The trail holds the actor, the action, the opaque target and the time: no address.
    const trail = JSON.stringify((await world.db.query(`select * from identity.audit_events where target = $1 or actor = $2`, [target, `user:${user.id}`])).rows);
    expect(trail).not.toContain(person.email);
  });

  test('shows Disabling while it runs, takes one press to send one request, and sends one when it is double-clicked', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await administrator(page, context, baseURL!, {marker: true});
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) posts.push(request.url());
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route((url) => url.pathname === path, async (route) => {
      if (route.request().method() === 'POST') await held;
      return route.continue();
    });
    try {
      await disableButton(page, person.email).click();
      await dialog(page).getByRole('button', {name: t('en', 'accounts.disable.confirm')}).click();
      const busy = row(page, person.email).getByRole('button');
      await expect(busy).toHaveAttribute('aria-disabled', 'true');
      await expect(busy).toHaveText(t('en', 'accounts.disable.pending'));
      await expect(row(page, person.email).getByRole('status')).toHaveText(t('en', 'accounts.disable.pendingStatus'));
      // Busy, but still the control that has focus: it is aria-disabled, not disabled. A second press does nothing.
      await busy.click({force: true});
      await expect(dialog(page)).toHaveCount(0);
    } finally {
      release();
    }
    await expect(badge(row(page, person.email), 'en', 'disabled')).toBeVisible(crossing);
    await page.waitForLoadState('networkidle');
    expect(posts, 'one request reached the server').toHaveLength(1);
    expect(await world.auditEvents('account.disabled', `account:${(await world.accountOf(person)).id}`)).toEqual([expect.objectContaining({actor: `user:${user.id}`})]);
  });

  test('the disabled person\'s browsers are refused at once, and a page they had open shows no private content', async ({page, context, browser, baseURL}) => {
    const person = await member({sessions: 2});
    const other = person.extra[0];
    // Two browsers of the same person, both inside the application.
    const mineContext = await browser.newContext();
    const otherContext = await browser.newContext();
    try {
      await signIn(mineContext, baseURL!, person);
      await signIn(otherContext, baseURL!, {cookie: other.cookie});
      const mine = await mineContext.newPage();
      const away = await otherContext.newPage();
      await mine.goto(`${baseURL}/`);
      await expect(mainNav(mine, 'en')).toBeVisible();
      await away.goto(`${baseURL}/settings`);
      await expect(away.getByRole('heading', {level: 1, name: t('en', 'settings.title')})).toBeVisible();

      await administrator(page, context, baseURL!, {marker: true});
      await disableThroughDialog(page, person.email);
      await expect(badge(row(page, person.email), 'en', 'disabled')).toBeVisible(crossing);

      // The very next request of each of their browsers: sent away from the application, no private page.
      for (const browserPage of [mine, away]) {
        await browserPage.goto(`${baseURL}/`);
        await expect(browserPage).toHaveURL(/\/login\?error=/, crossing);
        await expect(mainNav(browserPage, 'en')).toHaveCount(0);
        await expect(browserPage.getByRole('heading', {level: 1, name: t('en', 'login.title')})).toBeVisible();
      }
      // A mutation from a page they still had open goes nowhere either.
      await away.goto(`${baseURL}/settings`);
      await expect(away).toHaveURL(/\/login\?error=/, crossing);
    } finally {
      await mineContext.close();
      await otherContext.close();
    }
  });

  test('two windows at once: one disables, the other is told it is already disabled, and there is one audit event', async ({page, context, baseURL}) => {
    const person = await member({sessions: 2});
    const user = await administrator(page, context, baseURL!, {marker: true});
    const second = await context.newPage();
    await open(second);
    await expect(disableButton(second, person.email)).toBeVisible();

    await disableThroughDialog(page, person.email);
    await expect(badge(row(page, person.email), 'en', 'disabled')).toBeVisible(crossing);

    // The second window still believes the Account is enabled. It is told, and its page catches up.
    await disableThroughDialog(second, person.email);
    await expect(second.locator('.notice-info').filter({hasText: t('en', 'accounts.disable.alreadyDisabled', {name: person.email})})).toBeVisible(crossing);
    await expect(badge(row(second, person.email), 'en', 'disabled')).toBeVisible(crossing);
    await expect(enableButton(second, person.email)).toBeVisible();
    expect(await world.auditEvents('account.disabled', `account:${(await world.accountOf(person)).id}`)).toEqual([expect.objectContaining({actor: `user:${user.id}`})]);
    expect((await world.accountOf(person)).epoch).toBe(2);
  });

  test('an Account that no longer exists is not found, the list catches up, and nothing is invented for it', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    await expect(row(page, person.email)).toBeVisible();
    await world.eraseAccount(person);
    await disableThroughDialog(page, person.email);
    await expect(page.locator('.notice-warning').filter({hasText: t('en', 'accounts.error.notFound')})).toBeVisible(crossing);
    await expect(announcer(page)).toHaveText(t('en', 'accounts.error.notFound'));
    await expect(row(page, person.email)).toHaveCount(0);
    await expect(listHeading(page)).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('re-enabling an Account', () => {
  test('asks first, in a dialog that starts on Cancel; confirming makes it active under a newer epoch, and the old sessions stay revoked', async ({page, context, baseURL}) => {
    const person = await member({sessions: 2});
    const user = await administrator(page, context, baseURL!, {marker: true});
    const target = `account:${(await world.accountOf(person)).id}`;
    const old = await world.grantsOf(person);
    await disableThroughDialog(page, person.email);
    await expect(enableButton(page, person.email)).toBeVisible(crossing);

    const enable = enableButton(page, person.email);
    await expect(enable).toHaveText(t('en', 'accounts.row.enable'));
    await enable.click();
    await expect(dialog(page).getByRole('heading', {name: t('en', 'accounts.enable.title')})).toBeVisible();
    await expect(dialog(page)).toContainText(person.email);
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(enable).toBeFocused();
    expect((await world.accountOf(person)).status).toBe('disabled');

    await enable.click();
    await dialog(page).getByRole('button', {name: t('en', 'accounts.enable.confirm')}).click();
    await expect(badge(row(page, person.email), 'en', 'active')).toBeVisible(crossing);
    await expect(disableButton(page, person.email)).toBeVisible();
    const said = t('en', 'accounts.enable.done', {name: person.email});
    await expect(page.locator('.notice-success').filter({hasText: said})).toBeVisible();
    await expect(announcer(page)).toHaveText(said);
    await expect(listHeading(page)).toBeFocused();

    expect(await world.accountOf(person)).toMatchObject({status: 'active', epoch: 3});
    expect(await world.auditEvents('account.enabled', target)).toEqual([{actor: `user:${user.id}`, action: 'account.enabled', target}]);
    // Nothing was restored: every old grant is still revoked, and Auth has no session for the person.
    for (const sessionId of old) expect(await world.grantOf(sessionId)).toMatchObject({revoked_reason: 'disabled'});
    expect(await world.authSessionsOf(person.id)).toEqual([]);
  });

  test('an old session stays refused after the re-enable, even if Auth were to have it again', async ({page, context, browser, baseURL}) => {
    const person = await member();
    const old = person.sessionId;
    await administrator(page, context, baseURL!, {marker: true});
    await disableThroughDialog(page, person.email);
    await expect(enableButton(page, person.email)).toBeVisible(crossing);
    await enableThroughDialog(page, person.email);
    await expect(disableButton(page, person.email)).toBeVisible(crossing);

    // Auth is given the old session back by hand: its grant is revoked for good, so the application still refuses it.
    await world.restoreSession(person, old);
    const theirs = await browser.newContext();
    try {
      await signIn(theirs, baseURL!, person);
      const away = await theirs.newPage();
      await away.goto(`${baseURL}/`);
      await expect(away).toHaveURL(`${baseURL}/login?error=session_ended`, crossing);
    } finally {
      await theirs.close();
    }
  });

  test('says it is already enabled when another window got there first', async ({page, context, baseURL}) => {
    const person = await member();
    await world.setStatus(person, 'disabled');
    await administrator(page, context, baseURL!, {marker: true});
    await expect(enableButton(page, person.email)).toBeVisible();
    await world.setStatus(person, 'active');
    await enableThroughDialog(page, person.email);
    await expect(page.locator('.notice-info').filter({hasText: t('en', 'accounts.enable.alreadyEnabled', {name: person.email})})).toBeVisible(crossing);
    await expect(badge(row(page, person.email), 'en', 'active')).toBeVisible();
    expect(await world.auditEvents('account.enabled', `account:${(await world.accountOf(person)).id}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a real sign-in of a disabled person, and of the same person after a re-enable (the fake Google)', () => {
  let fakeActive = false;
  test.beforeAll(async () => {
    fakeActive = await fakeGoogleActive(world.stack.apiUrl);
    if (!fakeActive && process.env.CI) throw new Error('The fake Google is not running, or the stack\'s Auth is not swapped to use it, so this flow cannot run. CI swaps it in with `npm run fake-google:up` before the browser tests.');
  });
  test.beforeEach(() => {
    test.skip(!fakeActive, 'The fake Google is not active. Run `npm run fake-google:up` against the local stack to run this flow.');
  });

  test('is refused with the disabled message while disabled; after the re-enable a new sign-in gets in under a newer epoch, and earlier sessions stay revoked', async ({page, context, browser, baseURL}) => {
    const tag = randomUUID().slice(0, 8);
    const person = await world.signedInUser({email: `again-${tag}@example.test`, subject: `google-${randomUUID()}`});
    await world.activate(person);
    await addFakeAccount({email: person.email, sub: person.subject, name: `Again ${tag}`});
    const oldGrants = await world.grantsOf(person);

    await administrator(page, context, baseURL!, {marker: true});
    await disableThroughDialog(page, person.email);
    await expect(badge(row(page, person.email), 'en', 'disabled')).toBeVisible(crossing);

    const theirs = await browser.newContext();
    try {
      const away = await theirs.newPage();
      // A sign-in the way the login page's button starts one: a PKCE verifier in a cookie, and Auth's authorize endpoint with
      // its challenge. (The button itself is not clicked: it needs the Supabase address in the client bundle, which a build made
      // without credentials, as CI makes it, does not have. Everything after the click is the application's own.)
      const signInAgain = async () => {
        const verifier = randomBytes(48).toString('base64url');
        await theirs.addCookies([
          {
            name: `${sessionCookieName(world.env.NEXT_PUBLIC_SUPABASE_URL!)}-code-verifier`,
            value: `base64-${Buffer.from(JSON.stringify(verifier)).toString('base64url')}`,
            url: baseURL!,
            sameSite: 'Lax',
          },
        ]);
        const authorize = new URL('/auth/v1/authorize', world.stack.apiUrl);
        authorize.searchParams.set('provider', 'google');
        authorize.searchParams.set('redirect_to', `${baseURL}/auth/callback`);
        authorize.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
        authorize.searchParams.set('code_challenge_method', 's256');
        // Google's own account chooser every time (the application asks the same when it must be sure), not a pass-through.
        authorize.searchParams.set('prompt', 'select_account');
        await away.goto(authorize.href);
        await expect(away).toHaveURL(chooserUrl, crossing);
        await chooserAccount(away, person.email).click();
      };

      // Disabled: Google says it is them, the application says no, with the disabled message, and no session is left.
      await signInAgain();
      await expect(away).toHaveURL(`${baseURL}/login?error=account_disabled`, crossing);
      await expect(away.locator('.notice[role="alert"]')).toHaveText(t('en', 'login.error.account_disabled'));
      expect(await world.authSessionsOf(person.id)).toEqual([]);
      expect(await world.grantsOf(person)).toEqual(oldGrants);

      // Re-enabled by the Administrator.
      await enableThroughDialog(page, person.email);
      await expect(badge(row(page, person.email), 'en', 'active')).toBeVisible(crossing);

      // A new sign-in regains access, under a newer epoch; the earlier sessions stay revoked.
      await signInAgain();
      await expect(away).toHaveURL(`${baseURL}/`, crossing);
      await expect(mainNav(away, 'en')).toBeVisible();
      const grants = await world.grantsOf(person);
      const fresh = grants.filter((sessionId) => !oldGrants.includes(sessionId));
      expect(fresh).toHaveLength(1);
      expect(await world.grantOf(fresh[0])).toMatchObject({revoked_at: null, epoch: '3'});
      for (const sessionId of oldGrants) expect((await world.grantOf(sessionId))!.revoked_at).not.toBeNull();
      expect(await world.accountOf(person)).toMatchObject({status: 'active', epoch: 3});
    } finally {
      await theirs.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('when the database does not answer', () => {
  const flaky = (baseURL: string) => new URL(path, flakyBaseUrl(baseURL)).href;
  // The second server's switch for `list_accounts` is global (the call names nobody), so the tests that load the page through
  // it take turns.
  test.beforeEach(() => world.holdFlakyAccounts());
  test.afterEach(() => {
    endGlobalOutage('list_accounts');
    return world.releaseFlakyAccounts();
  });

  async function adminOnFlaky(page: Page, context: BrowserContext, baseURL: string) {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL, user);
    await open(page, flaky(baseURL));
    return user;
  }

  test('the marker cannot be checked: a retryable notice, nothing is changed, and the next press works', async ({page, context, baseURL}) => {
    const person = await member({sessions: 2});
    const user = await adminOnFlaky(page, context, baseURL!);
    startOutage(user.id, {rpc: ['use_marker'], mode: 'down'});
    try {
      await disableThroughDialog(page, person.email);
      await expect(row(page, person.email).locator('.notice[role="alert"]')).toContainText(t('en', 'accounts.error.unavailable'), crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await world.accountOf(person)).toMatchObject({status: 'active', epoch: 1});
    expect(await world.authSessionsOf(person.id)).toHaveLength(2);
    expect(await world.auditBy(`user:${user.id}`, 'account.disable_refused')).toEqual([]);
    await disableThroughDialog(page, person.email);
    await expect(badge(row(page, person.email), 'en', 'disabled')).toBeVisible(crossing);
  });

  test('the disable itself gets no answer: the person is told it is not known, and to check the list first, which was read again', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await adminOnFlaky(page, context, baseURL!);
    // An Account that appears while the page is open: "check the list" must point at a list read AFTER the attempt.
    const appeared = await member();
    await expect(row(page, appeared.email)).toHaveCount(0);
    startOutage(user.id, {rpc: ['disable_account'], mode: 'error'});
    try {
      await disableThroughDialog(page, person.email);
      await expect(row(page, person.email).locator('.notice[role="alert"]')).toContainText(t('en', 'accounts.error.unknown'), crossing);
      await expect(row(page, appeared.email)).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    expect((await world.accountOf(person)).status).toBe('active');
  });

  test('a re-enable that gets no answer says the same', async ({page, context, baseURL}) => {
    const person = await member();
    await world.setStatus(person, 'disabled');
    const user = await adminOnFlaky(page, context, baseURL!);
    startOutage(user.id, {rpc: ['enable_account'], mode: 'down'});
    try {
      await enableThroughDialog(page, person.email);
      await expect(row(page, person.email).locator('.notice[role="alert"]')).toContainText(t('en', 'accounts.error.unknown'), crossing);
    } finally {
      endOutage(user.id);
    }
    expect((await world.accountOf(person)).status).toBe('disabled');
  });

  test('the list cannot be read: the page still renders (200), says the list could not be loaded, claims nothing about any Account, and works again when the database does', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL!, user);
    const problems = watchForProblems(page);
    // `list_accounts` names nobody, so its outage is the server's, not the user's (the tests of this block take turns).
    startGlobalOutage('list_accounts', 'down');
    try {
      const response = await page.goto(flaky(baseURL!));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', {level: 1, name: t('en', 'accounts.title')})).toBeVisible();
      await expect(page.getByRole('heading', {level: 3, name: t('en', 'accounts.list.error.title')})).toBeVisible();
      await expect(page.locator('.state-error[role="alert"]')).toContainText(t('en', 'accounts.list.error.body'));
      await expect(page.locator('.invite-item')).toHaveCount(0);
      await expect(page.getByRole('button', {name: new RegExp(`^(${t('en', 'accounts.row.disable')}|${t('en', 'accounts.row.enable')})`)})).toHaveCount(0);
      expect(await violations(page)).toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    } finally {
      endGlobalOutage('list_accounts');
    }
    expect(problems).toEqual([]);
    await page.reload();
    await expect(row(page, person.email)).toBeVisible();
    await expect(page.getByRole('heading', {level: 3, name: t('en', 'accounts.list.error.title')})).toHaveCount(0);
  });

  test('the marker cannot be read when the page loads: no "needs a fresh sign-in" note and no "confirmed" note, the list is there, and the action decides', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL!, user);
    startOutage(user.id, {rpc: ['use_marker'], mode: 'down'});
    try {
      const response = await page.goto(flaky(baseURL!));
      expect(response?.status()).toBe(200);
      await expect(row(page, person.email)).toBeVisible();
      await expect(page.locator('.notice-success')).toHaveCount(0);
      await expect(page.locator('.notice-warning')).toHaveCount(0);
      await expect(stepUpLink(page)).toHaveCount(0);
      await hydrated(page, 'main form button');
    } finally {
      endOutage(user.id);
    }
    await disableThroughDialog(page, person.email);
    await expect(badge(row(page, person.email), 'en', 'disabled')).toBeVisible(crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('on every screen', () => {
  for (const variant of variants) {
    test(`has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
      const enabled = await member({sessions: 2});
      const disabled = await member();
      await world.setStatus(disabled, 'disabled');
      const user = await administrator(page, context, baseURL!, {marker: false, locale: variant.locale, theme: variant.theme});
      await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      await expect(page.locator('html')).toHaveAttribute('dir', variant.locale === 'he' ? 'rtl' : 'ltr');
      expect(await violations(page), 'the page, with the step-up offered').toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});

      // A refusal, the confirmed page, the dialog, the answer to a disable and to a re-enable, each checked once it is on screen.
      await disableThroughDialog(page, enabled.email, variant.locale);
      await expect(alerts(page).filter({hasText: t(variant.locale, 'accounts.error.needsConfirm')})).toBeVisible(crossing);
      expect(await violations(page), 'a refusal').toEqual([]);

      await world.forgeMarker(user, user.sessionId);
      await open(page);
      await expect(page.locator('.notice-success')).toBeVisible();
      expect(await violations(page), 'confirmed').toEqual([]);

      await disableButton(page, enabled.email, variant.locale).click();
      await expect(dialog(page)).toBeVisible();
      expect(await violations(page), 'the disable confirmation').toEqual([]);
      await dialog(page).getByRole('button', {name: t(variant.locale, 'accounts.disable.confirm')}).click();
      await expect(page.locator('.notice-success').filter({hasText: disabledMessage(variant.locale, enabled.email, 2)})).toBeVisible(crossing);
      expect(await violations(page), 'a disable that happened').toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});

      await enableButton(page, disabled.email, variant.locale).click();
      await expect(dialog(page)).toBeVisible();
      expect(await violations(page), 'the re-enable confirmation').toEqual([]);
      await dialog(page).getByRole('button', {name: t(variant.locale, 'accounts.enable.confirm')}).click();
      await expect(page.locator('.notice-success').filter({hasText: t(variant.locale, 'accounts.enable.done', {name: disabled.email})})).toBeVisible(crossing);
      expect(await violations(page), 'a re-enable that happened').toEqual([]);
    });

    test(`the Administration index has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
      const user = await world.signedInUser();
      await world.activate(user);
      await world.makeAdministrator(user);
      await world.forgeMarker(user, user.sessionId);
      await signIn(context, baseURL!, user, {locale: variant.locale, theme: variant.theme});
      await page.goto('/admin');
      await expect(page.getByRole('heading', {level: 1, name: t(variant.locale, 'admin.title')})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('dir', variant.locale === 'he' ? 'rtl' : 'ltr');
      await expect(page.locator('.notice-success')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    });
  }

  for (const variant of [variants[0], variants[3]]) {
    test(`reflows at 320 px wide with 200% text, with a long address and a dialog: ${variant.name}`, async ({page, context, baseURL, browserName}) => {
      test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      const long = await member({email: `${'long-address-'.repeat(4)}${randomUUID().slice(0, 8)}@example.test`});
      await administrator(page, context, baseURL!, {marker: true, locale: variant.locale, theme: variant.theme});
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
      await expect(row(page, long.email)).toBeVisible();
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      await disableButton(page, long.email, variant.locale).click();
      const confirm = dialog(page);
      await expect(confirm).toBeVisible();
      const box = (await confirm.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(await violations(page)).toEqual([]);
      await confirm.getByRole('button', {name: t(variant.locale, 'accounts.disable.confirm')}).click();
      await expect(page.locator('.notice-success')).toBeVisible(crossing);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    });
  }

  test('reads in Hebrew, right to left, and keeps the addresses and times left to right', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true, locale: 'he', theme: 'dark'});
    await expect(page.getByRole('heading', {level: 1, name: t('he', 'accounts.title')})).toBeVisible();
    await expect(page).toHaveTitle(`${t('he', 'meta.accounts')} · nova3D`);
    const item = row(page, person.email);
    await expect(item.locator('.ltr-token').first()).toHaveCSS('direction', 'ltr');
    await expect(item.locator('time').locator('xpath=..')).toHaveCSS('direction', 'ltr');
    await expect(badge(item, 'he', 'active')).toBeVisible();
    await expect(item).toContainText(t('he', 'accounts.row.role.member'));
    await disableThroughDialog(page, person.email, 'he');
    await expect(badge(item, 'he', 'disabled')).toBeVisible(crossing);
    await expect(enableButton(page, person.email, 'he')).toBeVisible();
  });

  test('can be used with the keyboard alone, from the control to the answer', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    const disable = disableButton(page, person.email);
    await disable.focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'accounts.disable.confirm')})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(badge(row(page, person.email), 'en', 'disabled')).toBeVisible(crossing);
    await expect(listHeading(page)).toBeFocused();
    // The next control in the order is the one for the next Account, not something the dialog left behind.
    await expect(dialog(page)).toHaveCount(0);
  });
});
