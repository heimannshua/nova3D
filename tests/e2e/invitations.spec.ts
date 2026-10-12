import {randomUUID} from 'node:crypto';
import {expect, test, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {hashInvitationCode, hashKey, looksLikeInvitationCode} from '../../lib/accounts';
import type {Locale, MessageKey} from '../../lib/i18n';
import {announcer, hydrated, label, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {endGlobalOutage, endOutage, flakyBaseUrl, startGlobalOutage, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';

// Story 1.11: the Administrator's invitation page (AD-01), in a real browser against the production build and the
// local Supabase stack. Each test forges the Administrator's session and, where the flow needs one, the
// fresh-authentication marker a completed step-up writes (tests/support/forged-session.ts); the REAL step-up, with a
// second Google sign-in, is driven against the fake Google in tests/e2e/step-up.spec.ts. Auth still validates the
// token, so the application's own proxy, authorization, role check and marker check all run. Every flow runs on
// `desktop` and `phone`.
//
// There is ONE general code in the whole database, and the desktop and phone projects run the same flows at the same
// time, so each test that touches it holds a database lock for its whole length (world.takeGeneralCode) and leaves no
// general code waiting. Named codes are told apart by a name no other test uses.

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const path = '/admin/invitations';
const key = () => hashKey(world.env, 'INVITATION_HASH_KEY');
/** A name nothing else uses, so a test finds its own rows in a database every test shares. */
const nameOf = (tag: string) => `${tag} ${randomUUID().slice(0, 8)}`;

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

async function open(page: Page, url: string = path) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await hydrated(page, 'main button[type="submit"]');
}

const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const nameField = (page: Page, locale: Locale = 'en') => page.getByLabel(t(locale, 'invitations.named.label'), {exact: true});
const makeButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'invitations.named.submit')});
const mintButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'invitations.general.mint')});
const replaceButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'invitations.general.replace')});
const reveals = (page: Page) => page.locator('.code-reveal');
const row = (page: Page, text: string) => page.locator('.invite-item').filter({hasText: text});
const generalRows = (page: Page, locale: Locale = 'en') => page.locator('.invite-item').filter({hasText: t(locale, 'invitations.row.general')});
const revokeButton = (page: Page, name: string, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'invitations.row.revokeLabel', {name})});
const alerts = (page: Page) => page.locator('.notice[role="alert"]');
const dialog = (page: Page) => page.getByRole('dialog');
const stepUpLink = (page: Page, locale: Locale = 'en') => page.getByRole('link', {name: t(locale, 'invitations.confirm.action')});
const crossing = {timeout: 20_000};

async function makeNamed(page: Page, name: string, locale: Locale = 'en') {
  // After a code was made the form empties its field when the action settles; a name typed before that would be wiped
  // with it. A person cannot type that fast, so wait for the field to be empty, as a person would see it.
  await expect(nameField(page, locale)).toHaveValue('');
  await nameField(page, locale).fill(name);
  await makeButton(page, locale).click();
}

/** The code on screen, read the way a person copies it. */
const shownCode = async (section: Locator) => (await section.locator('code').innerText()).trim();

// ---------------------------------------------------------------------------------------------------
test.describe('who may open the page', () => {
  test('a member gets the 404 page, and no link to it', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await signIn(context, baseURL!, user);
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'notFound.title')})).toBeVisible();
    await expect(page.getByLabel(t('en', 'invitations.named.label'), {exact: true})).toHaveCount(0);
    // The 404 for a member names nothing about the page: its title is the 404 page's, the one a page that does not exist has.
    await expect(page).toHaveTitle(`${t('en', 'meta.notFound')} · nova3D`);
    expect(await page.title()).not.toContain(t('en', 'meta.invitations'));
    const missing = await page.goto('/no-such-page');
    expect(missing?.status()).toBe(404);
    expect(await page.title()).toBe(`${t('en', 'meta.notFound')} · nova3D`);

    await page.goto('/settings');
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'settings.title')})).toBeVisible();
    await expect(page.getByRole('heading', {name: t('en', 'settings.admin.title')})).toHaveCount(0);
    await expect(page.locator('a[href="/admin/invitations"]')).toHaveCount(0);
  });

  test('a signed-out visitor is sent to sign in', async ({page, baseURL}) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/login`));
  });

  test('the Administrator finds it in Settings, and Back leads to Settings', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await signIn(context, baseURL!, user);
    await page.goto('/settings');
    await expect(page.getByRole('heading', {name: t('en', 'settings.admin.title')})).toBeVisible();
    await page.getByRole('link', {name: t('en', 'settings.admin.invitations')}).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, crossing);
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'invitations.title')})).toBeVisible();
    await expect(page).toHaveTitle(`${t('en', 'meta.invitations')} · nova3D`);
    await expect(page.locator('.back-link')).toHaveAttribute('href', '/settings');
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(`${baseURL}/settings`, crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('without a fresh sign-in', () => {
  for (const marker of [false, 'expired'] as const) {
    test(`nothing changes, the step-up is offered, and each refusal is audited once (${marker ? 'a marker that ran out' : 'no marker'})`, async ({page, context, baseURL}) => {
      // The page shows the one general code's state, which every other test shares: hold it still while this one reads it.
      await world.takeGeneralCode();
      test.info().annotations.push({type: 'general-code', description: 'holds the general-code lock'});
      const user = await administrator(page, context, baseURL!, {marker});
      const actor = `user:${user.id}`;
      // Offered beforehand, as a link to the step-up for administration: the server picks where it returns to.
      await expect(stepUpLink(page)).toHaveAttribute('href', '/step-up?for=administration');
      await expect(page.locator('.notice-success')).toHaveCount(0);

      const name = nameOf('Refused');
      await makeNamed(page, name);
      const refused = alerts(page).filter({hasText: t('en', 'invitations.error.needsConfirm')});
      await expect(refused).toBeVisible(crossing);
      await expect(refused.getByRole('link', {name: t('en', 'invitations.confirm.action')})).toHaveAttribute('href', '/step-up?for=administration');
      await expect(reveals(page)).toHaveCount(0);
      expect(await world.invitationByLabel(name)).toEqual([]);
      expect(await world.auditBy(actor, 'invitation.issue_refused')).toEqual([expect.objectContaining({actor, action: 'invitation.issue_refused', target: null})]);

      // Pressing again, and trying the general code, is the same refusal and the same one audit event: once an hour.
      await makeButton(page).click();
      await expect(refused).toBeVisible();
      await mintButton(page).click();
      await expect(page.locator('.settings-section', {hasText: t('en', 'invitations.general.title')}).locator('.notice[role="alert"]')).toContainText(t('en', 'invitations.error.needsConfirm'), crossing);
      expect(await world.invitationsIssuedBy(user)).toEqual([]);
      expect(await world.auditBy(actor, 'invitation.issue_refused')).toHaveLength(1);
    });
  }
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.annotations.some((annotation) => annotation.type === 'general-code')) await world.releaseGeneralCode();
  });

  test('a revoke is refused too: the code stays unused, and the attempt is audited against that invitation', async ({page, context, baseURL}) => {
    const name = nameOf('Keep');
    const {invitationId} = await world.issueCode(name);
    const user = await administrator(page, context, baseURL!, {marker: false});
    await revokeButton(page, name).click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', {name: t('en', 'invitations.revoke.confirm')}).click();
    await expect(row(page, name).locator('.notice[role="alert"]')).toContainText(t('en', 'invitations.error.needsConfirm'), crossing);
    expect(await world.invitationStatus(invitationId)).toBe('unused');
    const events = await world.auditBy(`user:${user.id}`, 'invitation.revoke_refused');
    expect(events).toEqual([expect.objectContaining({target: `invitation:${invitationId}`})]);
    expect(await world.auditEvents('invitation.revoked', `invitation:${invitationId}`)).toEqual([]);
  });

  test('a person who stopped being the Administrator while the page was open is denied, audited as denied, and nothing changes', async ({page, context, baseURL}) => {
    const user = await administrator(page, context, baseURL!, {marker: true});
    await world.db.query(`update identity.accounts set role = 'member' where user_id = $1`, [user.id]);
    const name = nameOf('Denied');
    await makeNamed(page, name);
    await expect(alerts(page).filter({hasText: t('en', 'invitations.error.denied')})).toBeVisible(crossing);
    expect(await world.invitationByLabel(name)).toEqual([]);
    expect(await world.auditBy(`user:${user.id}`, 'invitation.denied')).toHaveLength(1);
    // And the page itself is now a page that does not exist for them.
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('with a fresh sign-in', () => {
  test('says so, and issues a named code that is shown once, with a copy action, and listed without its value', async ({page, context, baseURL}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin: baseURL!});
    const user = await administrator(page, context, baseURL!, {marker: true});
    const problems = watchForProblems(page);
    await expect(page.locator('.notice-success')).toContainText(t('en', 'invitations.confirm.ok'));
    await expect(stepUpLink(page)).toHaveCount(0);

    // Every response the page's own fetches receive, to find the one that carries the code. (Read in the page, from a
    // clone: the browser's tools cannot always read the body of a response that is streamed to the page.)
    await page.evaluate(() => {
      const w = window as unknown as {__bodies: {method: string; body: string}[]};
      w.__bodies = [];
      const original = window.fetch;
      window.fetch = async (...args) => {
        const response = await original(...args);
        const method = (args[1]?.method ?? (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase();
        response.clone().text().then((body) => w.__bodies.push({method, body}), () => undefined);
        return response;
      };
    });
    const withCode = (code: string) =>
      page.evaluate((needle) => (window as unknown as {__bodies: {method: string; body: string}[]}).__bodies.filter((entry) => entry.body.includes(needle)).map((entry) => entry.method), code);

    const name = nameOf('Ben');
    await makeNamed(page, name);
    const reveal = reveals(page).first();
    await expect(reveal).toBeVisible(crossing);
    await expect(reveal.getByRole('heading', {name: t('en', 'invitations.reveal.named', {label: name})})).toBeVisible();
    await expect(reveal).toBeFocused();
    const code = await shownCode(reveal);
    expect(looksLikeInvitationCode(code)).toBe(true);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);

    // The list gained an Unused row, with the name, the kind and the identifier, and not the code.
    const stored = await world.invitationByLabel(name);
    expect(stored).toHaveLength(1);
    const [invitation] = stored;
    expect(invitation).toMatchObject({kind: 'named', status: 'unused', issued_by: `user:${user.id}`});
    expect(invitation.code_hash).toBe(hashInvitationCode(code, key()));
    const item = row(page, name);
    await expect(item).toBeVisible(crossing);
    await expect(item.getByText(t('en', 'invitations.status.unused'), {exact: true})).toBeVisible();
    await expect(item).toContainText(invitation.id);
    await expect(item).not.toContainText(code);
    // The name field is empty again, ready for the next code.
    await expect(nameField(page)).toHaveValue('');

    // Copy puts exactly that code on the clipboard, and says so.
    await reveal.getByRole('button', {name: t('en', 'invitations.reveal.copy')}).click();
    await expect(reveal.getByRole('status')).toHaveText(t('en', 'invitations.reveal.copied'));
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);

    // The code is in one response, the action's, and nowhere else the browser can look.
    await expect.poll(() => withCode(code)).toEqual(['POST']);
    expect(page.url()).not.toContain(code);
    const memory = await page.evaluate(() => JSON.stringify({local: {...localStorage}, session: {...sessionStorage}, cookie: document.cookie, title: document.title}));
    const cookies = JSON.stringify(await context.cookies());
    for (const spelling of [code, code.replaceAll('-', '')]) {
      expect(memory).not.toContain(spelling);
      expect(cookies).not.toContain(spelling);
    }

    // The audit trail names who and what, and holds neither the code nor the name.
    const issued = await world.auditEvents('invitation.issued', `invitation:${invitation.id}`);
    expect(issued).toEqual([{actor: `user:${user.id}`, action: 'invitation.issued', target: `invitation:${invitation.id}`}]);
    const trail = JSON.stringify((await world.db.query(`select * from identity.audit_events where actor = $1`, [`user:${user.id}`])).rows);
    expect(trail).not.toContain(code);
    expect(trail).not.toContain(code.replaceAll('-', ''));
    expect(trail).not.toContain(name);
    expect(trail).not.toContain(invitation.code_hash);

    // Hiding it removes it, and focus lands on the page's heading, not nowhere.
    await reveal.getByRole('button', {name: t('en', 'invitations.reveal.hide')}).click();
    await expect(reveals(page)).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 1})).toBeFocused();
    expect(await page.content()).not.toContain(code);

    // Loaded again, the list shows the row and the page holds nothing it could show again.
    await page.reload();
    await expect(row(page, name)).toBeVisible();
    expect(await page.content()).not.toContain(code);
    expect(await page.content()).not.toContain(invitation.code_hash);
    expect(problems).toEqual([]);

    // And it is a real code: the person it was given to registers with it, and the row reads Used.
    const newcomer = await world.signedInUser();
    await world.activateWithCode(newcomer, code);
    await page.reload();
    await expect(row(page, name).getByText(t('en', 'invitations.status.redeemed'), {exact: true})).toBeVisible();
    await expect(revokeButton(page, name)).toHaveCount(0);
  });

  test('a refusal because the fresh sign-in ran out re-reads the page: the green "confirmed" note gives way to the step-up note, and a code made earlier stays on screen', async ({page, context, baseURL}) => {
    const user = await administrator(page, context, baseURL!, {marker: true});
    await expect(page.locator('.notice-success')).toContainText(t('en', 'invitations.confirm.ok'));
    const first = nameOf('Kept');
    await makeNamed(page, first);
    const reveal = reveals(page).first();
    await expect(reveal).toBeVisible(crossing);
    const code = await shownCode(reveal);

    // The marker runs out while the page is open; the next change is refused.
    await world.expireMarker(user.sessionId);
    const second = nameOf('Late');
    await makeNamed(page, second);
    await expect(alerts(page).filter({hasText: t('en', 'invitations.error.needsConfirm')})).toBeVisible(crossing);
    expect(await world.invitationByLabel(second)).toEqual([]);

    // The page was read again: it no longer says it is confirmed, and says a change needs a fresh sign-in, with the way to get one.
    await expect(page.locator('.notice-success')).toHaveCount(0);
    const beforehand = page.locator('.notice-warning').filter({hasText: t('en', 'invitations.confirm.needed')});
    await expect(beforehand).toBeVisible(crossing);
    await expect(beforehand.getByRole('link', {name: t('en', 'invitations.confirm.action')})).toHaveAttribute('href', '/step-up?for=administration');
    // The code made before is still on screen, whole, and so is the list's row for it; what was typed is still in the field.
    await expect(reveals(page)).toHaveCount(1);
    expect(await shownCode(reveals(page).first())).toBe(code);
    await expect(row(page, first)).toBeVisible();
    await expect(nameField(page)).toHaveValue(second);
  });

  test('a second code made before the first was hidden does not take its place', async ({page, context, baseURL}) => {
    await administrator(page, context, baseURL!, {marker: true});
    const first = nameOf('First');
    const second = nameOf('Second');
    await makeNamed(page, first);
    await expect(reveals(page)).toHaveCount(1, crossing);
    const firstCode = await shownCode(reveals(page).first());
    await makeNamed(page, second);
    await expect(reveals(page)).toHaveCount(2, crossing);
    // Newest first, and both still there.
    await expect(reveals(page).nth(0).getByRole('heading')).toContainText(second);
    await expect(reveals(page).nth(1).getByRole('heading')).toContainText(first);
    expect(await shownCode(reveals(page).nth(1))).toBe(firstCode);
    // Leaving the page and coming back shows neither.
    await open(page);
    await expect(reveals(page)).toHaveCount(0);
    await expect(row(page, first)).toBeVisible();
    await expect(row(page, second)).toBeVisible();
  });

  test('a name that is empty, blank or over 80 characters is answered in the field, and nothing is sent', async ({page, context, baseURL}) => {
    const user = await administrator(page, context, baseURL!, {marker: true});
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') posts.push(request.url());
    });
    const field = nameField(page);
    const before = (await world.db.query(`select count(*)::int as n from identity.invitations where issued_by = $1`, [`user:${user.id}`])).rows[0].n as number;

    // Blank, and blank-looking: a name of nothing but zero-width and fill characters draws nothing, so it is empty too.
    for (const [typed, message] of [
      ['', 'invitations.named.error.empty'],
      ['   \t ', 'invitations.named.error.empty'],
      ['\u200b\u200f\u3164\u2800', 'invitations.named.error.empty'],
      ['x'.repeat(81), 'invitations.named.error.tooLong'],
    ] as const) {
      await field.fill(typed);
      await makeButton(page).click();
      const error = alerts(page).filter({hasText: t('en', message)});
      await expect(error).toBeVisible();
      await expect(field).toBeFocused();
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toHaveAccessibleDescription(new RegExp(t('en', message).replace(/\./g, '\\.')));
    }
    expect(posts).toEqual([]);
    expect((await world.db.query(`select count(*)::int as n from identity.invitations where issued_by = $1`, [`user:${user.id}`])).rows[0].n).toBe(before);
    expect(await world.auditBy(`user:${user.id}`, 'invitation.issue_refused')).toEqual([]);

    // Typing again takes the error away, and exactly 80 characters is a name.
    await field.fill('y'.repeat(80));
    await expect(alerts(page)).toHaveCount(0);
    await makeButton(page).click();
    await expect(reveals(page)).toHaveCount(1, crossing);
    expect(await world.invitationByLabel('y'.repeat(80))).toHaveLength(1);
  });

  test('the form can be used with the keyboard alone', async ({page, context, baseURL}) => {
    await administrator(page, context, baseURL!, {marker: true});
    const name = nameOf('Keys');
    await nameField(page).focus();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await expect(reveals(page).first()).toBeFocused({timeout: 20_000});
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', {name: t('en', 'invitations.reveal.copy')})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', {name: t('en', 'invitations.reveal.hide')})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(reveals(page)).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 1})).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('revoking a code', () => {
  test('asks first, in a dialog that starts on Cancel; Escape and Cancel change nothing; confirming revokes it', async ({page, context, baseURL}) => {
    const name = nameOf('Rita');
    const {invitationId} = await world.issueCode(name);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const item = row(page, name);
    await expect(item.getByText(t('en', 'invitations.status.unused'), {exact: true})).toBeVisible();
    const revoke = revokeButton(page, name);
    await expect(revoke).toHaveText(t('en', 'invitations.row.revoke'));

    await revoke.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', {name: t('en', 'invitations.revoke.title')})).toBeVisible();
    await expect(dialog(page)).toContainText(name);
    // It starts on Cancel, so Enter does not revoke by accident.
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(revoke).toBeFocused();
    expect(await world.invitationStatus(invitationId)).toBe('unused');

    await revoke.click();
    await dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')}).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await world.invitationStatus(invitationId)).toBe('unused');

    // The keyboard moves between the dialog's two buttons, and the page behind it is out of reach.
    await revoke.click();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'invitations.revoke.confirm')})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'invitations.revoke.confirm')})).toBeFocused();
    await expect(page.locator('main form input[name="label"]')).not.toBeFocused();

    await dialog(page).getByRole('button', {name: t('en', 'invitations.revoke.confirm')}).click();
    await expect(item.getByText(t('en', 'invitations.status.revoked'), {exact: true})).toBeVisible(crossing);
    await expect(revokeButton(page, name)).toHaveCount(0);
    await expect(page.locator('.notice-success').filter({hasText: t('en', 'invitations.revoke.done', {name})})).toBeVisible();
    await expect(announcer(page)).toHaveText(t('en', 'invitations.revoke.done', {name}));
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'invitations.list.title')})).toBeFocused();
    expect(await world.invitationStatus(invitationId)).toBe('revoked');
    expect((await world.invitationRow(invitationId))!.revoked_by).toBe(`user:${user.id}`);
    expect(await world.auditEvents('invitation.revoked', `invitation:${invitationId}`)).toEqual([{actor: `user:${user.id}`, action: 'invitation.revoked', target: `invitation:${invitationId}`}]);
  });

  test('a code that was used while the page was open stays Used, and the page says so', async ({page, context, baseURL}) => {
    const name = nameOf('Late');
    const {code, invitationId} = await world.issueCode(name);
    const user = await administrator(page, context, baseURL!, {marker: true});
    await expect(row(page, name).getByText(t('en', 'invitations.status.unused'), {exact: true})).toBeVisible();
    await world.activateWithCode(await world.signedInUser(), code);
    await revokeButton(page, name).click();
    await dialog(page).getByRole('button', {name: t('en', 'invitations.revoke.confirm')}).click();
    await expect(page.locator('.notice').filter({hasText: t('en', 'invitations.revoke.redeemed')})).toBeVisible(crossing);
    await expect(row(page, name).getByText(t('en', 'invitations.status.redeemed'), {exact: true})).toBeVisible();
    expect(await world.invitationStatus(invitationId)).toBe('redeemed');
    expect(await world.auditEvents('invitation.revoked', `invitation:${invitationId}`)).toEqual([]);
    expect(await world.auditBy(`user:${user.id}`, 'invitation.revoke_refused')).toEqual([]);
  });

  test('an identifier that names nothing is not found, and nothing is invented for it', async ({page, context, baseURL}) => {
    const name = nameOf('Gone');
    const {invitationId} = await world.issueCode(name);
    await administrator(page, context, baseURL!, {marker: true});
    await expect(row(page, name)).toBeVisible();
    await world.db.query('delete from identity.invitations where id = $1', [invitationId]);
    await revokeButton(page, name).click();
    await dialog(page).getByRole('button', {name: t('en', 'invitations.revoke.confirm')}).click();
    // The list is refreshed, so the row is gone with the answer: it is said above the list, and announced.
    await expect(page.locator('.notice-warning').filter({hasText: t('en', 'invitations.revoke.notFound')})).toBeVisible(crossing);
    await expect(announcer(page)).toHaveText(t('en', 'invitations.revoke.notFound'));
    await expect(row(page, name)).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'invitations.list.title')})).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the general code', () => {
  test.beforeEach(async () => {
    await world.takeGeneralCode();
  });
  test.afterEach(async () => {
    await world.releaseGeneralCode();
  });

  test('after a registration used it, none is listed as waiting; making the next one needs the marker and shows it once', async ({page, context, baseURL}) => {
    const retired = await world.issueGeneralCode();
    await world.activateWithCode(await world.signedInUser(), retired.code);
    expect(await world.invitationStatus(retired.invitationId)).toBe('redeemed');

    const user = await administrator(page, context, baseURL!, {marker: false});
    await expect(page.getByText(t('en', 'invitations.general.none'), {exact: true})).toBeVisible();
    await expect(page.getByText(t('en', 'invitations.general.noneBadge'), {exact: true})).toBeVisible();
    await expect(generalRows(page).filter({hasText: t('en', 'invitations.status.unused')})).toHaveCount(0);
    await expect(generalRows(page).filter({hasText: retired.invitationId}).getByText(t('en', 'invitations.status.redeemed'), {exact: true})).toBeVisible();
    await expect(replaceButton(page)).toHaveCount(0);

    // Without a marker: refused, and nothing was made.
    await mintButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'invitations.error.needsConfirm')})).toBeVisible(crossing);
    expect(await world.unusedGeneralId()).toBeUndefined();
    expect(await world.auditBy(`user:${user.id}`, 'invitation.issue_refused')).toHaveLength(1);

    // With one: made, shown once, and from then on there is one waiting.
    await world.forgeMarker(user, user.sessionId);
    await mintButton(page).click();
    const reveal = reveals(page).first();
    await expect(reveal).toBeVisible(crossing);
    await expect(reveal.getByRole('heading', {name: t('en', 'invitations.reveal.general')})).toBeVisible();
    await expect(reveal).not.toContainText(t('en', 'invitations.reveal.rotated'));
    const code = await shownCode(reveal);
    expect(looksLikeInvitationCode(code)).toBe(true);
    const waiting = await world.unusedGeneralId();
    expect(waiting).toBeDefined();
    expect((await world.invitationRow(waiting!))!.code_hash).toBe(hashInvitationCode(code, key()));
    await expect(generalRows(page).filter({hasText: waiting!}).getByText(t('en', 'invitations.status.unused'), {exact: true})).toBeVisible();
    await expect(replaceButton(page)).toBeVisible();
    await expect(mintButton(page)).toHaveCount(0);
    await page.reload();
    expect(await page.content()).not.toContain(code);
    await expect(reveals(page)).toHaveCount(0);
  });

  test('while one is waiting, Replace asks first, starts on Cancel, revokes it and shows the new one once', async ({page, context, baseURL}) => {
    const current = await world.issueGeneralCode();
    const user = await administrator(page, context, baseURL!, {marker: true});
    await expect(page.getByText(t('en', 'invitations.general.waiting'), {exact: true})).toBeVisible();
    await expect(mintButton(page)).toHaveCount(0);

    await replaceButton(page).click();
    await expect(dialog(page).getByRole('heading', {name: t('en', 'invitations.general.replaceTitle')})).toBeVisible();
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(replaceButton(page)).toBeFocused();
    expect(await world.unusedGeneralId()).toBe(current.invitationId);

    await replaceButton(page).click();
    await dialog(page).getByRole('button', {name: t('en', 'invitations.general.replaceConfirm')}).click();
    const reveal = reveals(page).first();
    await expect(reveal).toBeVisible(crossing);
    await expect(reveal).toContainText(t('en', 'invitations.reveal.rotated'));
    const code = await shownCode(reveal);
    const next = await world.unusedGeneralId();
    expect(next).toBeDefined();
    expect(next).not.toBe(current.invitationId);
    expect(await world.invitationStatus(current.invitationId)).toBe('revoked');
    await expect(generalRows(page).filter({hasText: current.invitationId}).getByText(t('en', 'invitations.status.revoked'), {exact: true})).toBeVisible();
    await expect(generalRows(page).filter({hasText: next!}).getByText(t('en', 'invitations.status.unused'), {exact: true})).toBeVisible();
    expect((await world.invitationRow(next!))!.code_hash).toBe(hashInvitationCode(code, key()));
    const actor = `user:${user.id}`;
    expect(await world.auditEvents('invitation.revoked', `invitation:${current.invitationId}`)).toEqual([{actor, action: 'invitation.revoked', target: `invitation:${current.invitationId}`}]);
    expect(await world.auditEvents('invitation.issued', `invitation:${next}`)).toEqual([{actor, action: 'invitation.issued', target: `invitation:${next}`}]);
  });

  test('in two windows at once, one makes the code and the other is told one exists', async ({page, context, baseURL}) => {
    const user = await administrator(page, context, baseURL!, {marker: true});
    const other = await context.newPage();
    await open(other);
    await expect(mintButton(page)).toBeVisible();
    await expect(mintButton(other)).toBeVisible();

    await mintButton(page).click();
    await expect(reveals(page)).toHaveCount(1, crossing);
    const waiting = await world.unusedGeneralId();

    // The second window still believes none is waiting. It is told, and its page catches up; nothing was made.
    await mintButton(other).click();
    await expect(other.locator('.notice').filter({hasText: t('en', 'invitations.general.exists')})).toBeVisible(crossing);
    await expect(reveals(other)).toHaveCount(0);
    await expect(replaceButton(other)).toBeVisible(crossing);
    expect(await world.unusedGeneralId()).toBe(waiting);
    expect(await world.auditEvents('invitation.issued', `invitation:${waiting}`)).toEqual([expect.objectContaining({actor: `user:${user.id}`})]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('when the database does not answer', () => {
  const flaky = (baseURL: string) => new URL(path, flakyBaseUrl(baseURL)).href;
  // The second server's switch for `list_invitations` is global (the call names nobody), so the tests that load the page
  // through it take turns.
  test.beforeEach(() => world.holdFlakyInvitations());
  test.afterEach(() => world.releaseFlakyInvitations());

  test('the marker cannot be checked: a retryable notice, nothing is made', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL!, user);
    await open(page, flaky(baseURL!));
    const name = nameOf('Outage');
    startOutage(user.id, {rpc: ['use_marker'], mode: 'down'});
    try {
      await makeNamed(page, name);
      await expect(alerts(page).filter({hasText: t('en', 'invitations.error.unavailable')})).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await world.invitationByLabel(name)).toEqual([]);
    expect(await world.auditBy(`user:${user.id}`, 'invitation.issue_refused')).toEqual([]);
    // The name is still in the field, and the next press works.
    await expect(nameField(page)).toHaveValue(name);
    await makeButton(page).click();
    await expect(reveals(page)).toHaveCount(1, crossing);
  });

  test('the issue itself gets no answer: the person is told it is not known, and to check the list first', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL!, user);
    await open(page, flaky(baseURL!));
    const name = nameOf('Unknown');
    // A code that appears while the page is open: "check the list below" must point at a list read AFTER the attempt, so it is there.
    const appeared = nameOf('Appeared');
    await world.issueCode(appeared);
    await expect(row(page, appeared)).toHaveCount(0);
    startOutage(user.id, {rpc: ['issue_invitation'], mode: 'error'});
    try {
      await makeNamed(page, name);
      await expect(alerts(page).filter({hasText: t('en', 'invitations.error.unknown')})).toBeVisible(crossing);
      await expect(row(page, appeared)).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    await expect(reveals(page)).toHaveCount(0);
    expect(await world.invitationByLabel(name)).toEqual([]);
  });

  test('a revoke that gets no answer says the same', async ({page, context, baseURL}) => {
    const name = nameOf('Maybe');
    const {invitationId} = await world.issueCode(name);
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL!, user);
    await open(page, flaky(baseURL!));
    const appeared = nameOf('Appeared');
    await world.issueCode(appeared);
    await expect(row(page, appeared)).toHaveCount(0);
    startOutage(user.id, {rpc: ['revoke_invitation'], mode: 'down'});
    try {
      await revokeButton(page, name).click();
      await dialog(page).getByRole('button', {name: t('en', 'invitations.revoke.confirm')}).click();
      await expect(row(page, name).locator('.notice[role="alert"]')).toContainText(t('en', 'invitations.error.unknown'), crossing);
      // The list was read again after the attempt.
      await expect(row(page, appeared)).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await world.invitationStatus(invitationId)).toBe('unused');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the page is rendered while the database does not answer', () => {
  const flaky = (baseURL: string) => new URL(path, flakyBaseUrl(baseURL)).href;
  test.beforeEach(() => world.holdFlakyInvitations());
  test.afterEach(() => {
    endGlobalOutage('list_invitations');
    return world.releaseFlakyInvitations();
  });

  async function adminWithMarker(context: BrowserContext, baseURL: string) {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL, user);
    return user;
  }

  test('the list cannot be read: the page still renders (200), says the list could not be loaded, claims nothing about the general code, and works again when the database does', async ({page, context, baseURL}) => {
    const user = await adminWithMarker(context, baseURL!);
    const name = nameOf('Listed');
    await world.issueCode(name);
    const problems = watchForProblems(page);
    // `list_invitations` names nobody, so its outage is the server's, not the user's (the tests of this block take turns).
    startGlobalOutage('list_invitations', 'down');
    try {
      const response = await page.goto(flaky(baseURL!));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', {level: 1, name: t('en', 'invitations.title')})).toBeVisible();
      await expect(page.getByRole('heading', {level: 3, name: t('en', 'invitations.list.error.title')})).toBeVisible();
      await expect(page.locator('.state-error[role="alert"]')).toContainText(t('en', 'invitations.list.error.body'));
      await expect(page.locator('.invite-item')).toHaveCount(0);
      // Nothing is claimed about whether a general code is waiting; making one is offered, and the server decides.
      for (const key of ['invitations.general.none', 'invitations.general.noneBadge', 'invitations.general.waiting'] as const) {
        await expect(page.getByText(t('en', key), {exact: true}), key).toHaveCount(0);
      }
      await expect(replaceButton(page)).toHaveCount(0);
      await expect(mintButton(page)).toBeVisible();
      // The marker could be read, so the page says it is confirmed; the rest of the page is intact.
      await expect(page.locator('.notice-success')).toContainText(t('en', 'invitations.confirm.ok'));
      await expect(nameField(page)).toBeVisible();
      expect(await violations(page)).toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    } finally {
      endGlobalOutage('list_invitations');
    }
    expect(problems).toEqual([]);
    await page.reload();
    await expect(row(page, name)).toBeVisible();
    await expect(page.getByRole('heading', {level: 3, name: t('en', 'invitations.list.error.title')})).toHaveCount(0);
  });

  test('the marker cannot be read: no "needs a fresh sign-in" note and no "confirmed" note either, the list is there, and the action decides', async ({page, context, baseURL}) => {
    const user = await adminWithMarker(context, baseURL!);
    const name = nameOf('Listed');
    await world.issueCode(name);
    const problems = watchForProblems(page);
    startOutage(user.id, {rpc: ['use_marker'], mode: 'down'});
    try {
      const response = await page.goto(flaky(baseURL!));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', {level: 1, name: t('en', 'invitations.title')})).toBeVisible();
      await expect(row(page, name)).toBeVisible();
      await expect(page.locator('.notice-success')).toHaveCount(0);
      await expect(page.locator('.notice-warning')).toHaveCount(0);
      await expect(stepUpLink(page)).toHaveCount(0);
      await expect(page.getByText(t('en', 'invitations.confirm.needed'))).toHaveCount(0);
      await hydrated(page, 'main button[type="submit"]');
    } finally {
      endOutage(user.id);
    }
    // The action is the authority: with the database back, the person who really has a marker can make a code.
    await makeNamed(page, nameOf('After'));
    await expect(reveals(page)).toHaveCount(1, crossing);
    expect(problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a second press while one is running sends nothing more', () => {
  /** Counts the Server Action requests, and holds the answer to the first until `release`, so the busy state can be looked at. */
  async function holdActions(page: Page) {
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
    return {posts, release};
  }

  const twoSubmits = (page: Page, selector: string) =>
    page.evaluate((css) => {
      // Two submissions before React has re-rendered: only the press flag taken in the submit event can stop the second.
      const form = (document.querySelector(css) as HTMLElement).closest('form') as HTMLFormElement;
      form.requestSubmit();
      form.requestSubmit();
    }, selector);

  for (const [how, press] of [
    ['submitted twice in one task', (page: Page) => twoSubmits(page, 'input[name="label"]')],
    ['double-clicked', (page: Page) => makeButton(page).dblclick()],
  ] as const) {
    test(`Make code ${how}: one request goes out, one code is made, one is shown`, async ({page, context, baseURL}) => {
      const user = await administrator(page, context, baseURL!, {marker: true});
      const {posts, release} = await holdActions(page);
      try {
        await nameField(page).fill(nameOf('Twice'));
        await makeButton(page).focus();
        await press(page);
        await expect(makeButton(page)).toHaveAttribute('aria-disabled', 'true');
        await expect(page.locator('.invite-form .auth-status').first()).toHaveText(t('en', 'invitations.named.pending'));
        // Busy, but still the control that has focus: it is aria-disabled, not disabled.
        await expect(makeButton(page)).toBeFocused();
      } finally {
        release();
      }
      await expect(reveals(page)).toHaveCount(1, crossing);
      await page.waitForLoadState('networkidle');
      expect(posts, 'one request reached the server').toHaveLength(1);
      expect(await world.invitationsIssuedBy(user)).toHaveLength(1);
      await expect(reveals(page)).toHaveCount(1);
      await expect(makeButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    });
  }

  test('the general code, double-clicked: one request, one code', async ({page, context, baseURL}) => {
    await world.takeGeneralCode();
    try {
      const user = await administrator(page, context, baseURL!, {marker: true});
      const {posts, release} = await holdActions(page);
      try {
        await mintButton(page).focus();
        await mintButton(page).dblclick();
        await expect(mintButton(page)).toHaveAttribute('aria-disabled', 'true');
      } finally {
        release();
      }
      await expect(reveals(page)).toHaveCount(1, crossing);
      await page.waitForLoadState('networkidle');
      expect(posts).toHaveLength(1);
      expect((await world.invitationsIssuedBy(user)).map((row) => row.kind)).toEqual(['general']);
    } finally {
      await world.releaseGeneralCode();
    }
  });

  test('Revoke, submitted twice in one task: one request, one revocation, one audit event', async ({page, context, baseURL}) => {
    const name = nameOf('Once');
    const {invitationId} = await world.issueCode(name);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const {posts, release} = await holdActions(page);
    try {
      await twoSubmits(page, `input[name="invitationId"][value="${invitationId}"]`);
      await expect(revokeButton(page, name)).toHaveAttribute('aria-disabled', 'true');
    } finally {
      release();
    }
    await expect(row(page, name).getByText(t('en', 'invitations.status.revoked'), {exact: true})).toBeVisible(crossing);
    await page.waitForLoadState('networkidle');
    expect(posts).toHaveLength(1);
    expect(await world.auditEvents('invitation.revoked', `invitation:${invitationId}`)).toEqual([{actor: `user:${user.id}`, action: 'invitation.revoked', target: `invitation:${invitationId}`}]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('when the browser refuses to copy', () => {
  test('the code is selected for copying by hand, and the page says so', async ({page, context, baseURL}) => {
    // A clipboard that refuses, as one does without permission or in an insecure context.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError'))}});
    });
    await administrator(page, context, baseURL!, {marker: true});
    await makeNamed(page, nameOf('Hand'));
    const reveal = reveals(page).first();
    await expect(reveal).toBeVisible(crossing);
    const code = await shownCode(reveal);
    await reveal.getByRole('button', {name: t('en', 'invitations.reveal.copy')}).click();
    await expect(reveal.getByRole('status')).toHaveText(t('en', 'invitations.reveal.copyFailed'));
    expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe(code);
    // It says nothing of having copied.
    await expect(reveal.getByText(t('en', 'invitations.reveal.copied'), {exact: true})).toHaveCount(0);
    // And the code is still there to be copied by hand.
    await expect(reveal.locator('code')).toHaveText(code);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('on every screen', () => {
  /** A page with a list long enough to wrap: a long name, a used code, a revoked one, an unused one. */
  async function fill(long: boolean) {
    const used = await world.issueCode(nameOf('Used'));
    await world.activateWithCode(await world.signedInUser(), used.code);
    const revoked = await world.issueCode(nameOf('Revoked'));
    await world.revokeCode(revoked.invitationId);
    await world.issueCode(long ? `${'Wide name '.repeat(8)}`.trim() : nameOf('Waiting'));
  }

  for (const variant of variants) {
    test(`has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
      const user = await administrator(page, context, baseURL!, {marker: false, locale: variant.locale, theme: variant.theme});
      await fill(false);
      await open(page);
      await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      await expect(page.locator('html')).toHaveAttribute('dir', variant.locale === 'he' ? 'rtl' : 'ltr');
      expect(await violations(page), 'the page, with the step-up offered').toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});

      // A refusal, a made code, a confirmation and the confirmed page, each checked once it is on screen.
      await nameField(page, variant.locale).fill('x');
      await makeButton(page, variant.locale).click();
      await expect(alerts(page).filter({hasText: t(variant.locale, 'invitations.error.needsConfirm')})).toBeVisible(crossing);
      expect(await violations(page), 'a refusal').toEqual([]);

      await world.forgeMarker(user, user.sessionId);
      await makeButton(page, variant.locale).click();
      await expect(reveals(page)).toHaveCount(1, crossing);
      expect(await violations(page), 'a code on screen').toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});

      await open(page);
      await expect(page.locator('.notice-success')).toBeVisible();
      expect(await violations(page), 'confirmed').toEqual([]);

      await page.locator('.invite-item').filter({has: page.locator('button')}).first().getByRole('button').click();
      await expect(dialog(page)).toBeVisible();
      expect(await violations(page), 'the confirmation').toEqual([]);
    });
  }

  for (const variant of [variants[0], variants[3]]) {
    test(`reflows at 320 px wide with 200% text, with a long name and a made code: ${variant.name}`, async ({page, context, baseURL, browserName}) => {
      test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      const user = await administrator(page, context, baseURL!, {marker: true, locale: variant.locale, theme: variant.theme});
      await fill(true);
      await open(page);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      await makeNamed(page, 'A'.repeat(80), variant.locale);
      await expect(reveals(page)).toHaveCount(1, crossing);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      const box = (await reveals(page).first().boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      await page.locator('.invite-item').filter({has: page.locator('button')}).first().getByRole('button').click();
      const confirm = dialog(page);
      await expect(confirm).toBeVisible();
      const dialogBox = (await confirm.boundingBox())!;
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(320);
      expect(await violations(page)).toEqual([]);
    });
  }

  test('reads in Hebrew, right to left, and keeps the code and identifiers left to right', async ({page, context, baseURL}) => {
    const user = await administrator(page, context, baseURL!, {marker: true, locale: 'he', theme: 'dark'});
    await fill(false);
    await open(page);
    await expect(page.getByRole('heading', {level: 1, name: t('he', 'invitations.title')})).toBeVisible();
    await expect(page).toHaveTitle(`${t('he', 'meta.invitations')} · nova3D`);
    await makeNamed(page, nameOf('דנה'), 'he');
    const reveal = reveals(page).first();
    await expect(reveal).toBeVisible(crossing);
    await expect(reveal.locator('.ltr-token')).toHaveCSS('direction', 'ltr');
    await expect(page.locator('.invite-id').first().locator('xpath=..')).toHaveCSS('direction', 'ltr');
    for (const state of ['unused', 'redeemed', 'revoked'] as const) {
      await expect(page.locator('.status-badge').filter({hasText: t('he', `invitations.status.${state}`)}).first()).toBeVisible();
    }
  });

  test('shows every status as a word and a shape, never a colour alone', async ({page, context, baseURL}) => {
    const user = await administrator(page, context, baseURL!, {marker: false});
    await fill(false);
    await open(page);
    for (const state of ['unused', 'redeemed', 'revoked'] as const) {
      const badge = page.locator('.status-badge').filter({hasText: new RegExp(`^${t('en', `invitations.status.${state}`)}$`)}).first();
      await expect(badge).toBeVisible();
      await expect(badge.locator('svg')).toHaveCount(1);
    }
  });
});
