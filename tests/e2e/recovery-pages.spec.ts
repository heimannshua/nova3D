import {randomBytes} from 'node:crypto';
import {expect, test, type Page} from '@playwright/test';
import type {Locale, MessageKey} from '../../lib/i18n';
import {hydrated, label, overflow, overflowReport, setFontSize, setPreferences, variants, violations, watchForProblems} from '../support/e2e-helpers';

// Story 1.6: the two Administrator recovery pages as a person sees them on a phone and on a desktop, in every variant. This file
// touches no token, no mail and no Account (recovery is a global singleton: its flows are one serial spec on the desktop project,
// recovery.spec.ts), so it runs on both projects at once: the pages render, pass axe in English and Hebrew (right to left), light
// and dark, hold at 320 px with the text at 200 percent, and the sign-in page links to the first of them. The button that asks
// for a link and the one that confirms are pressed only with the network request they make held back or refused in the browser
// (the pageshow cases at the end), so the server never sees one and nothing can be issued or redeemed.

const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const aToken = () => randomBytes(32).toString('base64url');

async function open(page: Page, url: string, selector: string) {
  if (url.includes('#')) await page.goto('about:blank');
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await hydrated(page, selector);
}

const requestPage = (page: Page) => open(page, '/recover', 'main form button');
const readyPage = (page: Page, baseURL: string) => open(page, `${baseURL}/recover/confirm#${aToken()}`, 'main form button');
const unusablePage = (page: Page, baseURL: string) => open(page, `${baseURL}/recover/confirm`, 'main a.btn');

for (const variant of variants) {
  test.describe(`${variant.name}`, () => {
    test.beforeEach(async ({context, baseURL}) => {
      await setPreferences(context, baseURL!, {locale: variant.locale, theme: variant.theme});
    });

    test('the request page names itself, has one button and no input, and passes axe', async ({page}) => {
      const problems = watchForProblems(page);
      await requestPage(page);
      await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
      await expect(page.locator('html')).toHaveAttribute('dir', variant.locale === 'he' ? 'rtl' : 'ltr');
      await expect(page).toHaveTitle(`${t(variant.locale, 'meta.recover')} · nova3D`);
      await expect(page.getByRole('heading', {level: 1, name: t(variant.locale, 'recover.title')})).toBeVisible();
      await expect(page.getByRole('button')).toHaveCount(1);
      await expect(page.getByRole('button', {name: t(variant.locale, 'recover.send')})).toBeVisible();
      await expect(page.locator('main input, main textarea, main select')).toHaveCount(0);
      await expect(page.getByRole('link', {name: t(variant.locale, 'recover.back')})).toHaveAttribute('href', '/login');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      expect(await violations(page)).toEqual([]);
      expect(problems).toEqual([]);
    });

    test('the confirmation page with a link renders the form, and nothing happens until the button is pressed; it passes axe', async ({page, baseURL}) => {
      const problems = watchForProblems(page);
      await readyPage(page, baseURL!);
      await expect(page).toHaveTitle(`${t(variant.locale, 'meta.recoverConfirm')} · nova3D`);
      await expect(page.getByRole('heading', {level: 1, name: t(variant.locale, 'recoverConfirm.title')})).toBeVisible();
      await expect(page.getByRole('button', {name: t(variant.locale, 'recoverConfirm.confirm')})).toBeEnabled();
      // The token is taken out of the address bar and held in the form.
      await expect(page).toHaveURL(`${baseURL}/recover/confirm`);
      await expect(page.locator('input[name="token"]')).toHaveCount(1);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      expect(await violations(page)).toEqual([]);
      expect(problems).toEqual([]);
    });

    test('the confirmation page with no usable link says so in words and offers a new link; it passes axe', async ({page, baseURL}) => {
      await unusablePage(page, baseURL!);
      await expect(page.locator('.notice-danger')).toContainText(t(variant.locale, 'recoverConfirm.invalid.title'));
      await expect(page.locator('.notice-danger')).toContainText(t(variant.locale, 'recoverConfirm.invalid'));
      await expect(page.getByRole('link', {name: t(variant.locale, 'recoverConfirm.newLink')})).toHaveAttribute('href', '/recover');
      await expect(page.getByRole('button')).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.describe('on a narrow screen with large text', () => {
  test('every page holds at 320 px with the text at 200 percent, in both languages, and nothing scrolls sideways', async ({page, context, baseURL, browserName}) => {
    test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    for (const locale of ['en', 'he'] as const) {
      await setPreferences(context, baseURL!, {locale});
      await requestPage(page);
      expect(await overflowReport(page), `request ${locale}`).toEqual({scroll: 0, clipped: []});
      await readyPage(page, baseURL!);
      expect(await overflowReport(page), `confirm ${locale}`).toEqual({scroll: 0, clipped: []});
      await unusablePage(page, baseURL!);
      expect(await overflowReport(page), `unusable ${locale}`).toEqual({scroll: 0, clipped: []});
    }
  });
});

test.describe('the sign-in page', () => {
  test('has a quiet link to the Recover page that is not a button, in both languages', async ({page, context, baseURL}) => {
    for (const locale of ['en', 'he'] as const) {
      await setPreferences(context, baseURL!, {locale});
      await page.goto('/login');
      const link = page.getByRole('link', {name: t(locale, 'login.recover')});
      await expect(link).toHaveAttribute('href', '/recover');
      await expect(link).toHaveClass(/btn-quiet/);
      expect(await violations(page), locale).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// A browser can bring a page back exactly as it was left (Back from another page, say) with its button still busy, or its answer still
// shown, and nothing that would ever finish them. A restored page (`pageshow` with `persisted`) starts the form afresh; a pageshow that
// is a normal load changes nothing. (Headless Chromium does not keep pages in its back/forward cache, so the event it would send is
// sent here, as tests/e2e/step-up.spec.ts does for its form.) The request each press makes is held back or refused before it leaves the
// browser, so the server is never asked.
test.describe('a page brought back as it was left (pageshow)', () => {
  const pageshow = (page: Page, persisted: boolean) => page.evaluate((flag) => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: flag})), persisted);

  /** Holds every Server Action POST to `pathname` until `release()`, and then refuses it. Page loads (GET) go through. */
  async function holdPosts(page: Page, pathname: string) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route((url) => url.pathname === pathname, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await held;
      return route.abort();
    });
    return release;
  }
  /** Refuses every Server Action POST to `pathname` at once: the action answers as it does when the connection drops. */
  const refusePosts = (page: Page, pathname: string) =>
    page.route((url) => url.pathname === pathname, (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));

  const sendButton = (page: Page) => page.getByRole('button', {name: t('en', 'recover.send')});
  const confirmButton = (page: Page) => page.getByRole('button', {name: t('en', 'recoverConfirm.confirm')});
  const status = (page: Page) => page.locator('.auth-status');

  test.describe('the request form', () => {
    test('a restored page starts afresh: a busy button is free again and says nothing is under way', async ({page}) => {
      const release = await holdPosts(page, '/recover');
      try {
        await requestPage(page);
        await sendButton(page).click();
        await expect(sendButton(page)).toHaveAttribute('aria-disabled', 'true');
        await expect(status(page)).toHaveText(t('en', 'recover.pending'));
        await pageshow(page, true);
        await expect(sendButton(page)).not.toHaveAttribute('aria-disabled', 'true');
        await expect(status(page)).toHaveText('');
      } finally {
        release();
      }
    });

    test('a pageshow that is not a restore (a normal load) leaves a busy button alone', async ({page}) => {
      const release = await holdPosts(page, '/recover');
      try {
        await requestPage(page);
        await sendButton(page).click();
        await expect(sendButton(page)).toHaveAttribute('aria-disabled', 'true');
        await pageshow(page, false);
        await expect(sendButton(page)).toHaveAttribute('aria-disabled', 'true');
        await expect(status(page)).toHaveText(t('en', 'recover.pending'));
      } finally {
        release();
      }
    });

    test('a restored page forgets the answer it was left showing; a normal pageshow keeps it', async ({page}) => {
      await refusePosts(page, '/recover');
      await requestPage(page);
      await sendButton(page).click();
      const answer = page.locator('.notice[role="alert"]');
      await expect(answer).toContainText(t('en', 'recover.unavailable'));
      await pageshow(page, false);
      await expect(answer).toContainText(t('en', 'recover.unavailable'));
      await pageshow(page, true);
      await expect(answer).toHaveCount(0);
      await expect(sendButton(page)).toBeVisible();
      await expect(sendButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  test.describe('the confirmation form', () => {
    // The fragment is taken out of the address when the page reads it, so a restored page has no link left: it says so, in words, and
    // offers the way to a new one. That is the page starting afresh.
    test('a restored page starts afresh: a busy form is gone, with the words for a link that cannot be used', async ({page, baseURL}) => {
      const release = await holdPosts(page, '/recover/confirm');
      try {
        await readyPage(page, baseURL!);
        await confirmButton(page).click();
        await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
        await expect(status(page)).toHaveText(t('en', 'recoverConfirm.pending'));
        await pageshow(page, true);
        await expect(confirmButton(page)).toHaveCount(0);
        await expect(status(page)).toHaveCount(0);
        await expect(page.locator('.notice-danger')).toContainText(t('en', 'recoverConfirm.invalid.title'));
        await expect(page.getByRole('link', {name: t('en', 'recoverConfirm.newLink')})).toHaveAttribute('href', '/recover');
      } finally {
        release();
      }
    });

    test('a pageshow that is not a restore (a normal load) leaves a busy form alone', async ({page, baseURL}) => {
      const release = await holdPosts(page, '/recover/confirm');
      try {
        await readyPage(page, baseURL!);
        await confirmButton(page).click();
        await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
        await pageshow(page, false);
        await expect(confirmButton(page)).toHaveAttribute('aria-disabled', 'true');
        await expect(status(page)).toHaveText(t('en', 'recoverConfirm.pending'));
        await expect(page.locator('.notice-danger')).toHaveCount(0);
      } finally {
        release();
      }
    });

    test('a restored page forgets the answer it was left showing; a normal pageshow keeps it', async ({page, baseURL}) => {
      // A connection that drops after the form was sent is read as "cannot tell whether it worked" (never as an invitation to press again).
      await refusePosts(page, '/recover/confirm');
      await readyPage(page, baseURL!);
      await confirmButton(page).click();
      const unknown = page.locator('.notice-warning[role="alert"]');
      await expect(unknown).toContainText(t('en', 'recoverConfirm.unknown'));
      await expect(page.getByRole('link', {name: t('en', 'recoverConfirm.openAdmin')})).toHaveAttribute('href', '/admin');
      await pageshow(page, false);
      await expect(unknown).toContainText(t('en', 'recoverConfirm.unknown'));
      await pageshow(page, true);
      await expect(unknown).toHaveCount(0);
      await expect(page.getByRole('link', {name: t('en', 'recoverConfirm.openAdmin')})).toHaveCount(0);
      await expect(page.locator('.notice-danger')).toContainText(t('en', 'recoverConfirm.invalid.title'));
    });
  });
});

// The wording a person who reloaded the confirmation page needs: the fragment is gone by design, so the page tells them the emailed link
// is still the way in, before it suggests spending a new one.
test.describe('a confirmation page with no link left in the address', () => {
  test('tells a person who reloaded to open the link in their email again, and only then to ask for a new one', async ({page, baseURL}) => {
    await readyPage(page, baseURL!);
    await page.reload();
    await hydrated(page, 'main a.btn');
    const notice = page.locator('.notice-danger');
    await expect(notice).toContainText(t('en', 'recoverConfirm.invalid'));
    await expect(notice).toContainText('If you reloaded this page, open the link in your email again');
    await expect(page.getByRole('link', {name: t('en', 'recoverConfirm.newLink')})).toBeVisible();
  });
});

// Without script the form can never be sent: the button waits for the page to read the link. The page says so rather than reading the link
// for ever.
test.describe('a browser with script turned off', () => {
  test.use({javaScriptEnabled: false});

  test('is told that confirming needs script', async ({page, baseURL}) => {
    const response = await page.goto(`${baseURL}/recover/confirm`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('noscript .notice-warning, .notice-warning')).toContainText(t('en', 'recoverConfirm.noscript'));
    await expect(page.getByRole('button', {name: t('en', 'recoverConfirm.confirm')})).toBeDisabled();
  });
});
