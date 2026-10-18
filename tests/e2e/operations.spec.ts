import {randomBytes} from 'node:crypto';
import {expect, test, type BrowserContext, type Locator, type Page} from '@playwright/test';
import type {Locale, MessageKey} from '../../lib/i18n';
import {label, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {endGlobalOutage, flakyBaseUrl, startGlobalOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';

// Story 1.13: the Administrator's Operations page, in a real browser against the production build and the local Supabase stack. Each test forges the
// Administrator's session (tests/support/forged-session.ts); the page is read only, so there is no fresh sign-in and nothing to press. Every flow runs on
// `desktop` and `phone`. What each email state looks like for every kind of notice is tests/unit/operations-page.test.tsx; this is the wiring, the layout
// and the accessibility run.
//
// HAZARDS this file keeps:
//  * No test here may cause an alarm email to be sent (the recovery specs assert the Mailpit mailbox holds exactly 0 or 1 messages, and the monitor and the
//    heartbeat route mail whatever is due). Every alarm a test OPENS is given its `sent` notice in the SAME transaction, so there is no moment at which
//    anything of ours is due. That is also why only the `sent` email state is asserted here: `pending` and `failing` are due by definition.
//  * Alarms cannot be deleted. Every alarm a test opens is resolved when the test ends, and each one has a subject of its own (`e2e-<random>`), because
//    the two projects run at the same time against one database and the open list shows every open alarm in it.
//  * It never opens an alarm whose subject is a real task (`ledger-relay`, `dormant-identity-purge`, `staging-cleanup`, `alarm-monitor`).

let world: AccountsWorld;
const opened: {condition: string; subject: string | null}[] = [];

test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  try {
    // A safety net: whatever a test left open (it failed before its own clean-up) is resolved, so no later run sees it on the page.
    for (const alarm of opened) await world.db.query('select * from api.resolve_alarm($1, $2)', [alarm.condition, alarm.subject]);
  } finally {
    await world.close();
  }
});

const path = '/admin/operations';
const crossing = {timeout: 20_000};
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const tag = () => `e2e-${randomBytes(5).toString('hex')}`;

type Detail = Record<string, number | boolean | string>;

/**
 * Opens an alarm the way the monitor does (`api.raise_alarm`) and gives it its `sent` notice in the same transaction, so it is never due; with `resolve` it is
 * resolved in that transaction too. Returns the pair so the test can close it.
 */
async function seed(condition: string, subject: string | null, detail: Detail, options: {resolve?: boolean} = {}) {
  await world.db.query('begin');
  try {
    const raised = await world.db.query('select alarm_id from api.raise_alarm($1, $2, $3::json)', [condition, subject, JSON.stringify(detail)]);
    await world.db.query(`select * from api.record_alarm_notice($1::uuid, 'sent')`, [raised.rows[0].alarm_id]);
    if (options.resolve) await world.db.query('select * from api.resolve_alarm($1, $2)', [condition, subject]);
    await world.db.query('commit');
  } catch (error) {
    await world.db.query('rollback');
    throw error;
  }
  opened.push({condition, subject});
  return {condition, subject};
}
const closeAll = async (alarms: {condition: string; subject: string | null}[]) => {
  for (const alarm of alarms) await world.db.query('select * from api.resolve_alarm($1, $2)', [alarm.condition, alarm.subject]);
};

/** An Administrator with an Account and a signed-in session, in the language and theme asked for. */
async function administrator(context: BrowserContext, baseURL: string, options: {locale?: Locale; theme?: 'light' | 'dark'} = {}) {
  const user = await world.signedInUser();
  await world.activate(user);
  await world.makeAdministrator(user);
  await signIn(context, baseURL, user, {locale: options.locale ?? 'en', theme: options.theme ?? 'light'});
  return user;
}

async function open(page: Page, url: string = path) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
}

const card = (page: Page, subject: string) => page.locator('.alarm-item').filter({hasText: subject});
const row = (item: Locator, locale: Locale, key: MessageKey) => item.locator('dl > div').filter({has: item.page().locator('dt', {hasText: new RegExp(`^${t(locale, key)}$`)})});

// ---------------------------------------------------------------------------------------------------
test.describe('who may open the page', () => {
  test('a member gets the 404 page, with the title of a page that does not exist, and the Settings page offers no link to it', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await signIn(context, baseURL!, user);
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'notFound.title')})).toBeVisible();
    await expect(page).toHaveTitle(`${t('en', 'meta.notFound')} · nova3D`);
    // It names nothing about the page: no title, no card, no state of the page.
    await expect(page.locator('.alarm-item')).toHaveCount(0);
    await expect(page.getByText(t('en', 'operations.title'), {exact: true})).toHaveCount(0);
    await page.goto('/settings');
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  });

  test('a signed-out visitor is sent to sign in', async ({page, baseURL}) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/login`));
  });

  test('the Administrator finds it from the Administration index, and Back leads up one level', async ({page, context, baseURL}) => {
    await administrator(context, baseURL!);
    await page.goto('/admin');
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'admin.title')})).toBeVisible();
    await expect(page.getByRole('heading', {level: 2})).toHaveText([t('en', 'admin.invitations.title'), t('en', 'admin.accounts.title'), t('en', 'admin.operations.title')]);
    await page.getByRole('link', {name: t('en', 'admin.operations.open')}).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, crossing);
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'operations.title')})).toBeVisible();
    await expect(page).toHaveTitle(`${t('en', 'meta.operations')} · nova3D`);
    await expect(page.locator('.back-link')).toHaveAttribute('href', '/admin');
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(`${baseURL}/admin`, crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the alarms', () => {
  test('lists the open alarms newest first, each with its title, subject, times, last receipt and email state, then the resolved ones, and offers nothing to press', async ({page, context, baseURL}) => {
    const late = `${tag()}`;
    const never = `${tag()}`;
    const unknown = tag();
    const cleared = tag();
    const mine = [
      await seed('task-late', late, {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:30:00.000Z', age_seconds: 700}),
      await seed('task-late', never, {receipt_task: 'staging-cleanup', receipt_outcome: 'never', receipt_at: 'never', age_seconds: 9000}),
      await seed(`e2e-fixture-${unknown}`, null, {count: 3, spare_flag: true, spare_flag_not_in_the_catalog: 12}),
      await seed('task-late', cleared, {receipt_task: 'ledger-relay', receipt_outcome: 'failed', receipt_at: '2026-10-17T19:00:00.000Z'}, {resolve: true}),
    ];
    try {
      await administrator(context, baseURL!);
      const problems = watchForProblems(page);
      await open(page);
      await expect(page.getByRole('heading', {level: 2})).toHaveText([t('en', 'operations.open.title'), t('en', 'operations.resolved.title')]);

      const first = card(page, late);
      await expect(first).toBeVisible();
      await expect(first.getByRole('heading', {level: 3})).toHaveText(t('en', 'operations.condition.task-late'));
      await expect(row(first, 'en', 'operations.row.subject')).toContainText(late);
      await expect(row(first, 'en', 'operations.row.first').locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      await expect(row(first, 'en', 'operations.row.first').locator('time')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      await expect(row(first, 'en', 'operations.row.latest').locator('time')).toBeVisible();
      await expect(row(first, 'en', 'operations.row.receiptTask')).toContainText('ledger-relay');
      await expect(row(first, 'en', 'operations.row.receiptOutcome')).toContainText(t('en', 'operations.outcome.ran'));
      await expect(row(first, 'en', 'operations.row.receiptAt').locator('time')).toHaveText('2026-10-17 20:30 UTC');
      // The detail's whole numbers are on the card, with their words (F2): the age the condition found, in seconds. The strings of the detail are not.
      await expect(row(first, 'en', 'operations.detail.age_seconds')).toContainText('700');
      // The email state is a word and a shape: it went out, and when.
      const email = row(first, 'en', 'operations.row.email');
      await expect(email.locator('.status-badge')).toHaveText(t('en', 'operations.email.sent'));
      await expect(email.locator('.status-badge svg')).toHaveCount(1);
      await expect(email.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);

      // A task that has never finished a run says so once, and has no time.
      const second = card(page, never);
      await expect(row(second, 'en', 'operations.detail.age_seconds')).toContainText('9000');
      await expect(row(second, 'en', 'operations.row.receiptTask')).toContainText('staging-cleanup');
      await expect(row(second, 'en', 'operations.row.receiptOutcome')).toContainText(t('en', 'operations.outcome.never'));
      await expect(second.locator('dt', {hasText: t('en', 'operations.row.receiptAt')})).toHaveCount(0);

      // A condition the catalog does not know shows its ID, and an alarm with no subject shows no subject.
      const third = page.locator('.alarm-item').filter({has: page.locator('.ltr-token', {hasText: `e2e-fixture-${unknown}`})});
      await expect(third).toHaveCount(1);
      await expect(third.getByRole('heading', {level: 3})).toHaveText(`e2e-fixture-${unknown}`);
      await expect(third.locator('dt', {hasText: t('en', 'operations.row.subject')})).toHaveCount(0);
      await expect(row(third, 'en', 'operations.row.receipt')).toContainText(t('en', 'operations.row.receipt.none'));
      // A key the catalog knows has its words; a boolean is a word, not a colour; any other key shows the key itself.
      await expect(row(third, 'en', 'operations.detail.count')).toContainText('3');
      const flag = third.locator('dl > div').filter({has: page.locator('dt', {hasText: /^spare_flag$/})});
      await expect(flag).toHaveCount(1);
      await expect(flag.locator('dd')).toHaveText(t('en', 'operations.detail.yes'));
      const stray = third.locator('dl > div').filter({has: page.locator('dt', {hasText: /^spare_flag_not_in_the_catalog$/})});
      await expect(stray.locator('dd')).toHaveText('12');

      // The resolved one is under the resolved heading, with its word and shape, its first and resolved time, and no email state.
      const resolved = card(page, cleared);
      await expect(resolved).toBeVisible();
      await expect(resolved.locator('.status-badge')).toHaveText(t('en', 'operations.resolved.badge'));
      await expect(row(resolved, 'en', 'operations.row.resolved').locator('time')).toBeVisible();
      await expect(resolved.locator('dt', {hasText: t('en', 'operations.row.email')})).toHaveCount(0);
      const order = await page.evaluate(
        ([open, closed]) => {
          const all = [...document.querySelectorAll('.alarm-item')];
          const where = (text: string) => all.findIndex((item) => item.textContent?.includes(text));
          return {open: where(open), closed: where(closed)};
        },
        [late, cleared],
      );
      expect(order.open).toBeGreaterThanOrEqual(0);
      expect(order.closed).toBeGreaterThan(order.open);

      // Read only: nothing to acknowledge, snooze or delete, and nothing in the main part of the page to press.
      await expect(page.locator('main').getByRole('button')).toHaveCount(0);
      await expect(page.locator('main form')).toHaveCount(0);
      await expect(page.locator('main a')).toHaveCount(0);
      expect(problems).toEqual([]);
    } finally {
      await closeAll(mine);
    }
  });

  test('shows an alarm that has since cleared under the resolved ones after a reload, and keeps it listed', async ({page, context, baseURL}) => {
    const subject = tag();
    const alarm = await seed('task-late', subject, {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:30:00.000Z'});
    try {
      await administrator(context, baseURL!);
      await open(page);
      await expect(card(page, subject).locator('.status-badge')).toHaveText(t('en', 'operations.email.sent'));
      await closeAll([alarm]);
      await page.reload();
      await expect(card(page, subject).locator('.status-badge')).toHaveText(t('en', 'operations.resolved.badge'), crossing);
    } finally {
      await closeAll([alarm]);
    }
  });

  // Review patch P9a: the page lists the ten most recently resolved alarms, not all of them. Eleven resolved alarms are seeded (each opened, given its `sent` notice and
  // resolved in ONE transaction, so none is ever due and no mail can be sent), so more than ten exist in the database whatever else has been resolved there, and the
  // resolved section must hold exactly ten cards, every one resolved.
  test('shows exactly ten resolved alarms when more than ten have been resolved', async ({page, context, baseURL}) => {
    const alarms: {condition: string; subject: string | null}[] = [];
    for (let index = 0; index < 11; index += 1) alarms.push(await seed('task-late', tag(), {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:30:00.000Z'}, {resolve: true}));
    try {
      expect(Number((await world.db.query('select count(*) as n from lifecycle.alarms where resolved_at is not null')).rows[0].n)).toBeGreaterThanOrEqual(11);
      await administrator(context, baseURL!);
      await open(page);
      const resolved = page.locator('section.settings-section').filter({has: page.getByRole('heading', {level: 2, name: t('en', 'operations.resolved.title')})});
      await expect(resolved).toHaveCount(1);
      await expect(resolved.locator('.alarm-item')).toHaveCount(10);
      await expect(resolved.locator('.alarm-item .status-badge')).toHaveText(Array.from({length: 10}, () => t('en', 'operations.resolved.badge')));
      // None of them is in the open list, and the open list has no resolved badge.
      const openList = page.locator('section.settings-section').filter({has: page.getByRole('heading', {level: 2, name: t('en', 'operations.open.title')})});
      await expect(openList.locator('.alarm-item').filter({hasText: t('en', 'operations.resolved.badge')})).toHaveCount(0);
    } finally {
      await closeAll(alarms);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('when the database does not answer', () => {
  const flaky = (baseURL: string) => new URL(path, flakyBaseUrl(baseURL)).href;
  // The second server's switch for `list_alarms` is global (the call names nobody), so the tests that load the page through it take turns.
  test.beforeEach(() => world.db.query(`select pg_advisory_lock(hashtextextended('nova3d-e2e:flaky-operations', 0))`));
  test.afterEach(async () => {
    endGlobalOutage('list_alarms');
    await world.db.query(`select pg_advisory_unlock(hashtextextended('nova3d-e2e:flaky-operations', 0))`);
  });

  test('the alarms cannot be read: the page still renders (200), says they could not be loaded, claims nothing, and works again when the database does', async ({page, context, baseURL}) => {
    const subject = tag();
    const alarm = await seed('task-late', subject, {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:30:00.000Z'});
    try {
      await administrator(context, baseURL!);
      const problems = watchForProblems(page);
      // `list_alarms` names nobody, so its outage is the server's, not the user's.
      startGlobalOutage('list_alarms', 'down');
      try {
        const response = await page.goto(flaky(baseURL!));
        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', {level: 1, name: t('en', 'operations.title')})).toBeVisible();
        await expect(page.getByRole('heading', {level: 3, name: t('en', 'operations.error.title')})).toBeVisible();
        await expect(page.locator('.state-error[role="alert"]')).toContainText(t('en', 'operations.error.body'));
        await expect(page.locator('.alarm-item')).toHaveCount(0);
        // Nothing is claimed: not "nothing is wrong", and not a resolved section.
        await expect(page.getByText(t('en', 'operations.open.empty.title'))).toHaveCount(0);
        await expect(page.getByRole('heading', {level: 2, name: t('en', 'operations.resolved.title')})).toHaveCount(0);
        expect(await violations(page)).toEqual([]);
        expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      } finally {
        endGlobalOutage('list_alarms');
      }
      expect(problems).toEqual([]);
      await page.reload();
      await expect(card(page, subject)).toBeVisible();
      await expect(page.getByRole('heading', {level: 3, name: t('en', 'operations.error.title')})).toHaveCount(0);
    } finally {
      await closeAll([alarm]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('on every screen', () => {
  for (const variant of variants) {
    test(`has no accessibility violations and no sideways scrolling: ${variant.name}`, async ({page, context, baseURL}) => {
      const long = `${'long-subject-'.repeat(3)}${tag()}`;
      const fixture = `e2e-fixture-${'x'.repeat(16)}-${tag()}`;
      const mine = [
        await seed('task-late', long, {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:30:00.000Z', age_seconds: 700}),
        await seed(fixture, null, {count: 1, a_detail_key_that_is_thirty_two_: 123456789012345, spare_flag: false}),
        await seed('task-late', tag(), {receipt_task: 'staging-cleanup', receipt_outcome: 'never', receipt_at: 'never'}, {resolve: true}),
      ];
      try {
        await administrator(context, baseURL!, {locale: variant.locale, theme: variant.theme});
        await open(page);
        await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
        await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
        await expect(page.locator('html')).toHaveAttribute('dir', variant.locale === 'he' ? 'rtl' : 'ltr');
        await expect(page.getByRole('heading', {level: 1, name: t(variant.locale, 'operations.title')})).toBeVisible();
        await expect(card(page, long)).toBeVisible();
        await expect(card(page, long).getByRole('heading', {level: 3})).toHaveText(t(variant.locale, 'operations.condition.task-late'));
        // The detail's number is visible beside its label, in both languages, on a phone and on a desktop; the false flag says so in words.
        const ageRow = row(card(page, long), variant.locale, 'operations.detail.age_seconds');
        await expect(ageRow).toBeVisible();
        await expect(ageRow.locator('dd')).toHaveText('700');
        const flagged = card(page, fixture).locator('dl > div').filter({has: page.locator('dt', {hasText: /^spare_flag$/})});
        await expect(flagged.locator('dd')).toHaveText(t(variant.locale, 'operations.detail.no'));
        await expect(card(page, fixture).locator('dd', {hasText: '123456789012345'})).toBeVisible();
        expect(await violations(page)).toEqual([]);
        expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      } finally {
        await closeAll(mine);
      }
    });
  }

  for (const variant of [variants[0], variants[3]]) {
    test(`reflows at 320 px wide with 200% text, with a long subject and a long unknown condition: ${variant.name}`, async ({page, context, baseURL, browserName}) => {
      test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      const long = `${'long-subject-'.repeat(3)}${tag()}`;
      const mine = [
        await seed('task-late', long, {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T20:30:00.000Z', age_seconds: 700}),
        await seed(`e2e-fixture-${'y'.repeat(14)}-${tag()}`, `${'long-subject-'.repeat(3)}${tag()}`, {count: 1, a_detail_key_that_is_thirty_two_: 123456789012345}),
      ];
      try {
        await administrator(context, baseURL!, {locale: variant.locale, theme: variant.theme});
        await open(page);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
        await expect(card(page, long)).toBeVisible();
        expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
        expect(await violations(page)).toEqual([]);
      } finally {
        await closeAll(mine);
      }
    });
  }
});
