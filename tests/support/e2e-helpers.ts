import AxeBuilder from '@axe-core/playwright';
import type {BrowserContext, Page} from '@playwright/test';
import {translate, type Locale, type MessageKey} from '../../lib/i18n';
import type {ForgedUser} from './forged-session';

// Helpers the browser specs share: signing a forged session in, reading the page the way a person does, and
// the accessibility run.

export const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
export const label = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);

/** Puts a forged session in the browser, with the device preferences a test asks for (language, theme). */
export async function signIn(context: BrowserContext, baseURL: string, user: {cookie: ForgedUser['cookie']}, preferences: {locale?: Locale; theme?: 'light' | 'dark'} = {}) {
  const cookies = [{name: user.cookie.name, value: user.cookie.value, url: baseURL}];
  for (const [name, value] of Object.entries(preferences)) cookies.push({name: `nova3d-${name}`, value, url: baseURL});
  await context.addCookies(cookies);
}

/** Sets only the device preferences (language, theme), for a page that needs no session. */
export async function setPreferences(context: BrowserContext, baseURL: string, preferences: {locale?: Locale; theme?: 'light' | 'dark'}) {
  await context.addCookies(Object.entries(preferences).map(([name, value]) => ({name: `nova3d-${name}`, value, url: baseURL})));
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
export const mainNav = (page: Page, locale: Locale) => page.getByRole('navigation', {name: label(locale, 'a11y.mainNavigation')});
/** The forged session cookie, if the browser still holds it with a value. */
export const sessionCookies = async (context: BrowserContext, user: {cookie: {name: string}}) =>
  (await context.cookies()).filter((cookie) => cookie.name === user.cookie.name && cookie.value !== '');
