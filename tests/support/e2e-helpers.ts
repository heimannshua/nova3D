import AxeBuilder from '@axe-core/playwright';
import type {BrowserContext, Page} from '@playwright/test';
import {translate, type Locale, type MessageKey} from '../../lib/i18n';
import type {ForgedUser} from './forged-session';

// Helpers the browser specs share: signing a forged session in, reading the page the way a person does, and
// the accessibility run.

export const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
export const label = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);

/** The four variants every screen is checked in: English and Hebrew (right to left), light and dark. */
export type Variant = {name: string; locale: Locale; theme: 'light' | 'dark'};
export const variants: Variant[] = [
  {name: 'English, light', locale: 'en', theme: 'light'},
  {name: 'English, dark', locale: 'en', theme: 'dark'},
  {name: 'Hebrew, light', locale: 'he', theme: 'light'},
  {name: 'Hebrew, dark', locale: 'he', theme: 'dark'},
];

/** The device preference cookies a test can set: the four a browser holds (anything else is a tampered value on purpose). */
export type DevicePreferences = {locale?: string; theme?: string; detail?: string; guidance?: string};

/** Puts a forged session in the browser, with the device preferences a test asks for (language, theme, detail, guidance). */
export async function signIn(context: BrowserContext, baseURL: string, user: {cookie: ForgedUser['cookie']}, preferences: DevicePreferences = {}) {
  // SameSite Lax, spelled out as @supabase/ssr spells it in the cookie it sets. A cookie with NO SameSite attribute is
  // only "Lax by default" in Chrome, which still sends it on a cross-site top-level POST for its first two minutes.
  const cookies: {name: string; value: string; url: string; sameSite?: 'Lax'}[] = [{name: user.cookie.name, value: user.cookie.value, url: baseURL, sameSite: 'Lax'}];
  for (const [name, value] of Object.entries(preferences)) cookies.push({name: `nova3d-${name}`, value, url: baseURL});
  await context.addCookies(cookies);
}

/** Sets only the device preferences, for a page that needs no session. */
export async function setPreferences(context: BrowserContext, baseURL: string, preferences: DevicePreferences) {
  await context.addCookies(Object.entries(preferences).map(([name, value]) => ({name: `nova3d-${name}`, value: String(value), url: baseURL})));
}

/** The value of a cookie in the browser, or undefined. */
export const cookieValue = async (context: BrowserContext, name: string) => (await context.cookies()).find((candidate) => candidate.name === name)?.value;
/** The page's one polite live region. */
export const announcer = (page: Page) => page.locator('[data-announcer]');

/** The browser's own "font size" setting, which is what enlarged text really changes (it also moves rem breakpoints). Chromium only. */
export async function setFontSize(page: Page, pixels: number) {
  const session = await page.context().newCDPSession(page);
  await session.send('Page.setFontSizes', {fontSizes: {standard: pixels, fixed: pixels}});
}

export async function violations(page: Page) {
  const results = await new AxeBuilder({page}).withTags(wcag).analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.slice(0, 5).map((node) => `${node.target.join(' ')} :: ${node.failureSummary?.split('\n').slice(0, 3).join(' | ')}`),
  }));
}

// Nothing the page or the browser reports as an error: no React warning, no failed request.
export function watchForProblems(page: Page) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

// The message box, not Next.js's own empty route announcer, which is also an alert.
export const alertOf = (page: Page) => page.locator('.notice[role="alert"]');
export const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Sideways scrolling, and every visible element that sticks out of the window: the page's own scroll width beyond its
 * client width, and the first few elements whose box is outside it. Something inside a box that clips it (decorative
 * art in a card, say) cannot widen the page, so it is not counted.
 */
export function overflowReport(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clipped = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (box.width === 0 || style.visibility === 'hidden' || element.closest('.visually-hidden, .skip-link')) return false;
        for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          if (getComputedStyle(parent).overflowX !== 'visible') return false;
        }
        return box.right > width + 1 || box.left < -1;
      })
      .slice(0, 6)
      .map((element) => `${element.tagName.toLowerCase()}.${element.className} ${Math.round(element.getBoundingClientRect().left)}..${Math.round(element.getBoundingClientRect().right)}`);
    return {scroll: document.documentElement.scrollWidth - width, clipped};
  });
}
export const mainNav = (page: Page, locale: Locale) => page.getByRole('navigation', {name: label(locale, 'a11y.mainNavigation')});
/** The forged session cookie, if the browser still holds it with a value. */
export const sessionCookies = async (context: BrowserContext, user: {cookie: {name: string}}) =>
  (await context.cookies()).filter((cookie) => cookie.name === user.cookie.name && cookie.value !== '');

/**
 * Stops the browser at Auth's authorize endpoint with a stand-in page ("stopped at Auth"), so a test can read exactly
 * what the application asked Google for without Google, and without Auth being swapped. Returns the authorize URLs
 * the browser asked for, in order (a live array).
 */
export const authorizePath = '**/auth/v1/authorize**';
export const stoppedAtAuth = 'stopped at Auth';
export async function stopAtAuth(page: Page) {
  const seen: string[] = [];
  await page.route(authorizePath, (route) => {
    seen.push(route.request().url());
    return route.fulfill({status: 200, contentType: 'text/html', body: `<!doctype html><title>Auth stand-in</title><p>${stoppedAtAuth}</p>`});
  });
  return seen;
}

/**
 * Waits until React has taken over the page's controls (they carry React's props). Before that a form button
 * whose action is a function does nothing when pressed: its `action` is a placeholder that throws, and the press
 * is not replayed. `selector` names the controls to wait for.
 */
export async function hydrated(page: Page, selector = 'main button[type="submit"]') {
  await page.waitForFunction(
    (css) => {
      const nodes = [...document.querySelectorAll(css)];
      return nodes.length > 0 && nodes.every((node) => Object.keys(node).some((key) => key.startsWith('__reactProps$')));
    },
    selector,
  );
}
