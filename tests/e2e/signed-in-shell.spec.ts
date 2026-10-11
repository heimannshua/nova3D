import {expect, test, type Page} from '@playwright/test';
import type {Locale, MessageKey} from '../../lib/i18n';
import {cookieValue, hydrated, label, mainNav, overflowReport, setFontSize, signIn, variants, violations, watchForProblems, type Variant} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';

// Story 1.4d: the accessible, localized shell on the REAL routes, signed in. tests/e2e/shell.spec.ts runs the same
// shell, patterns and Settings controls on the synthetic design kit, because it needed no one signed in; this file
// is the shell a person actually uses: Home, My Projects, In Progress, Settings and the 404 page, each behind a
// forged Google session with an Account and its grant (tests/support/forged-session.ts). Auth still validates the
// token, so the application's own proxy, authorization and Account preferences all run. Every flow runs on both
// projects: `desktop` (sidebar) and `phone` (bottom bar).
//
// The language and theme of a test come from the device cookies that a first navigation adopts into the Account's
// record (tests/e2e/preferences.spec.ts is where that is tested), so every later page of the test is rendered from
// the record, as a signed-in person's pages are.

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

type Route = {path: string; name: string; title: MessageKey; notFound?: boolean};
// Home is the one page with no title of its own: the product's default title; every other page's is `<page> · nova3D`.
const routes: Route[] = [
  {path: '/', name: 'Home', title: 'meta.title'},
  {path: '/projects', name: 'My Projects', title: 'meta.projects'},
  {path: '/progress', name: 'In Progress', title: 'meta.progress'},
  {path: '/settings', name: 'Settings', title: 'meta.settings'},
  {path: '/no-such-page', name: 'the 404 page', title: 'meta.notFound', notFound: true},
];
const titleOf = (route: Route, locale: Locale) => (route.path === '/' ? label(locale, route.title) : `${label(locale, route.title)} · nova3D`);
const home = routes[0];
const settings = routes[3];
const notFound = routes[4];

/** Signs a new member in with a language and theme, and opens the page. The page has rendered when its heading is there. */
async function open(page: Page, context: Parameters<typeof signIn>[0], baseURL: string, route: Route, variant: Pick<Variant, 'locale' | 'theme'> = {locale: 'en', theme: 'light'}) {
  const user = await world.signedInUser();
  await world.activate(user);
  await signIn(context, baseURL, user, variant);
  const response = await page.goto(route.path);
  expect(response?.status(), route.path).toBe(route.notFound ? 404 : 200);
  await expect(page.getByRole('heading', {level: 1}), route.path).toBeVisible();
  await expect(page, route.path).toHaveURL(`${baseURL}${route.path}`);
  return user;
}

const bell = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: label(locale, 'notifications.button', {count: 1})});
const account = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: label(locale, 'nav.account'), exact: true});
const createButton = (page: Page, locale: Locale = 'en') => mainNav(page, locale).getByRole('button', {name: label(locale, 'nav.create')});
const notifications = (page: Page, locale: Locale = 'en') => page.getByRole('region', {name: label(locale, 'notifications.title')});
const accountPanel = (page: Page, locale: Locale = 'en') => page.getByRole('region', {name: label(locale, 'account.title')});

// ---------------------------------------------------------------------------------------------------
test.describe('axe: no accessibility violations on the real routes, in four variants (AC-3)', () => {
  for (const route of routes) {
    for (const variant of variants) {
      test(`${route.name}: ${variant.name}`, async ({page, context, baseURL}) => {
        await open(page, context, baseURL!, route, variant);
        await expect(html(page)).toHaveAttribute('lang', variant.locale);
        await expect(html(page)).toHaveAttribute('data-theme', variant.theme);
        expect(await violations(page)).toEqual([]);
        expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      });
    }
  }

  for (const variant of [variants[0], variants[3]]) {
    test(`with menus and dialogs open: ${variant.name}`, async ({page, context, baseURL}) => {
      await open(page, context, baseURL!, home, variant);
      const {locale} = variant;
      await hydrated(page, 'main button');

      await bell(page, locale).click();
      await expect(notifications(page, locale)).toBeVisible();
      expect(await violations(page), 'notifications open').toEqual([]);
      await page.keyboard.press('Escape');

      await account(page, locale).click();
      await expect(accountPanel(page, locale)).toBeVisible();
      expect(await violations(page), 'account open').toEqual([]);
      await page.keyboard.press('Escape');

      await createButton(page, locale).click();
      const create = page.getByRole('dialog', {name: label(locale, 'create.title')});
      await expect(create).toBeVisible();
      await create.getByRole('radio').first().check();
      expect(await violations(page), 'create dialog open').toEqual([]);
    });

    test(`the 404 page with a menu open: ${variant.name}`, async ({page, context, baseURL}) => {
      await open(page, context, baseURL!, notFound, variant);
      await hydrated(page, 'main a, header button');
      await account(page, variant.locale).click();
      await expect(accountPanel(page, variant.locale)).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    for (const route of [home, settings, notFound]) {
      test(`${route.name} with high contrast requested: ${theme}`, async ({page, context, baseURL}) => {
        await page.emulateMedia({contrast: 'more'});
        await open(page, context, baseURL!, route, {locale: 'en', theme});
        expect(await violations(page)).toEqual([]);
      });
    }
  }
});

const html = (page: Page) => page.locator('html');

// ---------------------------------------------------------------------------------------------------
test.describe('names and landmarks on the real routes (AC-3)', () => {
  for (const locale of ['en', 'he'] as const) {
    for (const route of routes) {
      test(`${route.name} exposes its navigation, its menus and one banner and one main: ${locale}`, async ({page, context, baseURL}) => {
        await open(page, context, baseURL!, route, {locale, theme: 'light'});
        const nav = mainNav(page, locale);
        await expect(nav).toBeVisible();
        for (const key of ['nav.home', 'nav.projects', 'nav.progress'] as const) await expect(nav.getByRole('link', {name: label(locale, key)})).toBeVisible();
        await expect(nav.getByRole('button', {name: label(locale, 'nav.create')})).toBeVisible();
        await expect(page.getByRole('link', {name: label(locale, 'nav.settings'), exact: true})).toBeVisible();
        await expect(bell(page, locale)).toBeVisible();
        await expect(account(page, locale)).toBeVisible();
        await expect(page.getByRole('banner')).toHaveCount(1);
        await expect(page.getByRole('main')).toHaveCount(1);
        await expect(page.getByRole('note').first()).toContainText(label(locale, 'shell.syntheticBadge'));
        // The title names the page in the interface language.
        await expect(page).toHaveTitle(titleOf(route, locale));
      });
    }
  }

  test('marks the page in view as current, and only that one', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await signIn(context, baseURL!, user);
    for (const [path, name] of [['/', 'nav.home'], ['/projects', 'nav.projects'], ['/progress', 'nav.progress']] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', {level: 1})).toBeVisible();
      const current = page.locator('nav [aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText(label('en', name));
    }
    await page.goto('/settings');
    await expect(page.locator('nav [aria-current="page"]')).toHaveCount(0);
    await expect(page.locator('a.icon-btn[aria-current="page"]')).toHaveAttribute('aria-label', label('en', 'nav.settings'));
    await page.goto('/no-such-page');
    await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
  });

  test('the 404 page is a page of the shell: a 404 status, its words, and a way home', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, notFound);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('en', 'notFound.title'));
    await expect(page.getByRole('main')).toContainText(label('en', 'notFound.body'));
    await expect(page).toHaveTitle(`${label('en', 'meta.notFound')} · nova3D`);
    await page.getByRole('link', {name: label('en', 'notFound.home')}).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  });

  test('the 404 page reads in Hebrew, right to left', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, notFound, {locale: 'he', theme: 'dark'});
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('he', 'notFound.title'));
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await expect(page).toHaveTitle(`${label('he', 'meta.notFound')} · nova3D`);
  });

  test('a nested path that does not exist is the same 404 page, not a way into anything', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, {path: '/projects/anything/at/all', name: 'nested', title: 'meta.notFound', notFound: true});
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('en', 'notFound.title'));
  });

  test('the viewport covers the whole screen and still allows zoom', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).toContain('viewport-fit=cover');
    expect(content).not.toMatch(/user-scalable=(no|0)|maximum-scale/);
  });

  test('the Help link goes to an element that exists on the Settings page', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    // The Help link is part of the sidebar, which a phone does not show, so read it from the document rather than
    // from what is visible: the target it names must exist either way.
    const href = await page.locator('a.help-link').getAttribute('href');
    const fragment = new URL(href!, 'http://example.test').hash.slice(1);
    expect(fragment).not.toBe('');
    await page.goto('/settings');
    await expect(page.locator(`#${fragment}`)).toHaveCount(1);
    await expect(page.locator(`#${fragment}`)).toContainText(label('en', 'settings.guidance.title'));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('keyboard on the real routes (AC-3)', () => {
  for (const route of [home, settings, notFound]) {
    test(`${route.name}: the skip link is first, shows on focus, and moves focus to the page content`, async ({page, context, baseURL}) => {
      await open(page, context, baseURL!, route);
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', {name: label('en', 'a11y.skipToContent')});
      await expect(skip).toBeFocused();
      const box = (await skip.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      await page.keyboard.press('Enter');
      await expect(page.locator('main')).toBeFocused();
    });

    test(`${route.name}: every control the keyboard reaches shows a visible focus ring`, async ({page, context, baseURL}) => {
      await open(page, context, baseURL!, route);
      await hydrated(page, 'main button, header button');
      const problems: string[] = [];
      for (let step = 0; step < 24; step += 1) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || element === document.body) return null;
          const style = getComputedStyle(element);
          const parent = element.closest('.choice') ? getComputedStyle(element.closest('.choice') as HTMLElement) : null;
          const own = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
          const viaLabel = parent !== null && parent.outlineStyle !== 'none' && parseFloat(parent.outlineWidth) >= 2;
          return {name: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 30) || element.tagName, visible: own || viaLabel};
        });
        if (ring && !ring.visible) problems.push(ring.name);
      }
      expect(problems).toEqual([]);
    });
  }

  test('navigation comes in reading order: Home, My Projects, Create, In Progress', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    const names: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      names.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim()));
    }
    const order = ['Home', 'My Projects', 'Create', 'In Progress'].map((name) => names.indexOf(name));
    expect(order.every((index) => index >= 0), names.join(' | ')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('a menu opens from the keyboard, closes with Escape and gives focus back', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    const trigger = bell(page);
    await trigger.focus();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(notifications(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(notifications(page).getByRole('link')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(notifications(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('the Account menu opens from the keyboard, holds the sign-out button, and closes with Escape', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    await account(page).focus();
    await page.keyboard.press('Enter');
    await expect(accountPanel(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(accountPanel(page).getByRole('button', {name: label('en', 'account.signOut')})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(accountPanel(page)).toHaveCount(0);
    await expect(account(page)).toBeFocused();
  });

  test('the Create dialog traps focus, closes with Escape and returns focus to its opener', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    const create = createButton(page);
    await create.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {name: label('en', 'create.title')});
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-describedby', /.+/);
    // Focus may leave the dialog only for the browser's own controls (which shows as the body), never for the page behind it.
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement?.closest('dialog')))).toBe(true);
    }
    // The choice is a radio group: arrow keys move it, and the result is announced in place.
    await dialog.getByRole('radio').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('radio', {name: /Upload picture/})).toBeChecked();
    await expect(dialog.getByText(label('en', 'create.imageSelected'))).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(create).toBeFocused();
  });

  test('the radio groups on Settings answer the arrow keys and apply the choice to the Account', async ({page, context, baseURL}) => {
    const user = await open(page, context, baseURL!, settings);
    await hydrated(page, 'input[type="radio"]');
    await page.getByRole('radio', {name: 'Light'}).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', {name: 'Dark'})).toBeChecked();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({theme: 'dark'});
  });

  test('the Settings radio groups each have a name', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, settings);
    await expect(page.getByRole('radiogroup')).toHaveCount(3);
    for (const key of ['settings.language.title', 'settings.theme.title', 'settings.detail.title'] as const) {
      await expect(page.getByRole('radiogroup', {name: label('en', key)})).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('menus and dialogs close the way people expect, on the real routes (AC-3)', () => {
  test('a click on the backdrop closes the Create dialog and gives focus back to its opener', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    await createButton(page).click();
    const dialog = page.getByRole('dialog', {name: label('en', 'create.title')});
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
    await expect(createButton(page)).toBeFocused();
  });

  test('dragging a text selection out of the dialog onto the backdrop does not close it', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    await createButton(page).click();
    const dialog = page.getByRole('dialog', {name: label('en', 'create.title')});
    const description = (await dialog.locator('.dialog-description').boundingBox())!;
    await page.mouse.move(description.x + 6, description.y + 6);
    await page.mouse.down();
    await page.mouse.move(2, 2, {steps: 6});
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
  });

  test('a click outside a menu closes it and keeps focus from falling to the page', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, notFound);
    await hydrated(page, 'main a, header button');
    for (const [trigger, panel] of [[bell(page), 'notifications.title'], [account(page), 'account.title']] as const) {
      await trigger.focus();
      await page.keyboard.press('Enter');
      const region = page.getByRole('region', {name: label('en', panel)});
      await expect(region).toBeVisible();
      // The notifications panel has a link to tab into; the account panel has the sign-out button.
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.popover-panel')))).toBe(true);
      // Blank space: the bottom edge of the page's main region, below its content. It takes focus only when a
      // script gives it focus (tabindex -1), so a click there is the case the menu must hand focus back from.
      const main = page.locator('main');
      await main.click({position: {x: 4, y: (await main.boundingBox())!.height - 3}});
      await expect(region).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
    }
  });

  test('a click on another control closes the menu and lets that control take focus', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    await bell(page).click();
    await expect(notifications(page)).toBeVisible();
    await account(page).click();
    await expect(notifications(page)).toHaveCount(0);
    await expect(accountPanel(page)).toBeVisible();
  });

  test('tabbing out of an open menu closes it, forwards and backwards', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    await bell(page).focus();
    await page.keyboard.press('Enter');
    await expect(notifications(page)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(notifications(page).getByRole('link')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', {name: label('en', 'nav.settings'), exact: true})).toBeFocused();
    await expect(notifications(page)).toHaveCount(0);

    await bell(page).focus();
    await page.keyboard.press('Enter');
    await expect(notifications(page)).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(notifications(page)).toHaveCount(0);
  });

  test('a change of page closes open menus and the Create dialog, Back and Forward included', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    // Go by the Settings link: a client-side navigation to a real route.
    await bell(page).click();
    await expect(notifications(page)).toBeVisible();
    await page.getByRole('link', {name: label('en', 'nav.settings'), exact: true}).click();
    await expect(page).toHaveURL(`${baseURL}/settings`);
    await expect(notifications(page)).toHaveCount(0);

    await account(page).click();
    await expect(accountPanel(page)).toBeVisible();
    await mainNav(page, 'en').getByRole('link', {name: label('en', 'nav.projects')}).click();
    await expect(page).toHaveURL(`${baseURL}/projects`);
    await expect(accountPanel(page)).toHaveCount(0);

    await createButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}/settings`);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await createButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(`${baseURL}/projects`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the Account menu signs out from the real page, and says so on the sign-in page', async ({page, context, baseURL}) => {
    const user = await open(page, context, baseURL!, notFound);
    await hydrated(page, 'main a, header button');
    await account(page).click();
    await accountPanel(page).getByRole('button', {name: label('en', 'account.signOut')}).click();
    await expect(page).toHaveURL(`${baseURL}/login?notice=signed_out`);
    expect((await world.grantOf(user.sessionId))!.revoked_at).not.toBeNull();
    // The language and theme of the person's choice are still the device's on the sign-in page (the cookie copy).
    await expect(html(page)).toHaveAttribute('lang', 'en');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('enlarged text and narrow screens on the real routes (AC-3)', () => {
  for (const variant of [variants[0], variants[3]]) {
    for (const route of routes) {
      test(`200% text reflows without sideways scrolling: ${route.name}, ${variant.name}`, async ({page, context, baseURL, browserName}) => {
        test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
        await setFontSize(page, 32);
        await open(page, context, baseURL!, route, variant);
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
        expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
        // Every way to act is still there: the primary navigation, Settings, Notifications, Account.
        await expect(createButton(page, variant.locale)).toBeVisible();
        await expect(page.getByRole('link', {name: label(variant.locale, 'nav.settings'), exact: true})).toBeVisible();
        expect(await violations(page)).toEqual([]);
      });

      test(`320 px wide reflows without sideways scrolling: ${route.name}, ${variant.name}`, async ({page, context, baseURL}) => {
        await page.setViewportSize({width: 320, height: 640});
        await open(page, context, baseURL!, route, variant);
        expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
        await expect(createButton(page, variant.locale)).toBeVisible();
      });
    }
  }

  test('the Create dialog fits a 320 px screen', async ({page, context, baseURL}) => {
    await page.setViewportSize({width: 320, height: 640});
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    await createButton(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });

  test('320 px wide with 200% text still has no sideways scrolling, on Settings, in Hebrew and dark', async ({page, context, baseURL, browserName}) => {
    test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    await open(page, context, baseURL!, settings, {locale: 'he', theme: 'dark'});
    expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
  });

  test('the bottom bar and menus fit a short, narrow screen', async ({page, context, baseURL}) => {
    await page.setViewportSize({width: 320, height: 240});
    await open(page, context, baseURL!, home);
    await hydrated(page, 'main button, header button');
    expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    await bell(page).click();
    const panel = notifications(page);
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('reduced motion, high contrast and forced colours on the real routes (AC-3)', () => {
  test('reduced motion removes transitions and animation', async ({page, context, baseURL}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await open(page, context, baseURL!, settings);
    const durations = await page.evaluate(() =>
      [...document.querySelectorAll('.btn, .icon-btn, .nav-item, .choice')].map((element) => {
        const style = getComputedStyle(element);
        return {transition: parseFloat(style.transitionDuration), animation: parseFloat(style.animationDuration), scroll: style.scrollBehavior};
      }),
    );
    expect(durations.length).toBeGreaterThan(5);
    for (const duration of durations) {
      expect(duration.transition).toBeLessThanOrEqual(0.001);
      expect(duration.animation).toBeLessThanOrEqual(0.001);
      expect(duration.scroll).toBe('auto');
    }
  });

  test('forced colours keep every control and badge outlined', async ({page, context, baseURL}) => {
    await page.emulateMedia({forcedColors: 'active'});
    await open(page, context, baseURL!, settings);
    const unbounded = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.btn, .icon-btn, .status-badge, .choice')]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.borderTopStyle === 'none' || parseFloat(style.borderTopWidth) === 0;
        })
        .map((element) => element.className),
    );
    expect(unbounded).toEqual([]);
  });

  test('high contrast darkens the text and border tokens', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, home);
    const normal = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--border-strong').trim());
    await page.emulateMedia({contrast: 'more'});
    const more = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--border-strong').trim());
    expect(more).not.toBe(normal);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('touch targets are at least 44 px on the real routes (AC-3)', () => {
  for (const variant of [variants[0], variants[2]]) {
    for (const route of [home, settings, notFound]) {
      test(`every control on ${route.name}: ${variant.name}`, async ({page, context, baseURL}) => {
        await open(page, context, baseURL!, route, variant);
        const small = await page.evaluate(() => {
          // The project card's title link is stretched over the whole card, and the radio input sits inside a
          // 44 px label that is the real target. Everything else is measured as drawn.
          const controls = [...document.querySelectorAll<HTMLElement>('button, a[href], summary, label.choice')]
            .filter((element) => !element.matches('.card-link, .skip-link') && !element.closest('.visually-hidden') && !(element as HTMLButtonElement).disabled);
          return controls
            .map((element) => ({box: element.getBoundingClientRect(), name: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 30)}))
            .filter(({box}) => box.width > 0 && (box.width < 43.5 || box.height < 43.5))
            .map(({box, name}) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
        });
        expect(small).toEqual([]);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------------
test.describe('right to left and mixed languages on the real routes (AC-3, UX-DR5)', () => {
  test('the layout and direction icons mirror in Hebrew', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, settings, {locale: 'he', theme: 'light'});
    const viewport = page.viewportSize()!;
    const homeLink = mainNav(page, 'he').getByRole('link', {name: label('he', 'nav.home')});
    const projects = mainNav(page, 'he').getByRole('link', {name: label('he', 'nav.projects')});
    const [homeBox, projectsBox] = [(await homeLink.boundingBox())!, (await projects.boundingBox())!];
    if (viewport.width >= 768) {
      // Sidebar: it sits at the inline start, which is the right-hand side in Hebrew.
      expect((await mainNav(page, 'he').boundingBox())!.x).toBeGreaterThan(viewport.width / 2);
    } else {
      // Bottom bar: the first item is at the right.
      expect(homeBox.x).toBeGreaterThan(projectsBox.x);
    }
    const back = page.getByRole('link', {name: label('he', 'nav.backToHome')});
    expect(((await back.boundingBox())!).x).toBeGreaterThan(viewport.width / 2);
    expect(await page.locator('.icon-directional').first().evaluate((icon) => getComputedStyle(icon).transform)).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  });

  test('the same icon is not mirrored in English', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, settings);
    expect(await page.locator('.icon-directional').first().evaluate((icon) => getComputedStyle(icon).transform)).toBe('none');
  });

  test('the language preview on Settings shows both languages with their own direction', async ({page, context, baseURL}) => {
    await open(page, context, baseURL!, settings);
    const preview = page.locator('.language-preview');
    await expect(preview.locator('p[lang="en"]')).toHaveAttribute('dir', 'ltr');
    await expect(preview.locator('p[lang="he"]')).toHaveAttribute('dir', 'rtl');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the real routes render from the Account\'s record and say nothing wrong (Story 1.4d)', () => {
  test('a page load is quiet: no console error, no React warning, no failed request', async ({page, context, baseURL}) => {
    const problems = watchForProblems(page);
    // A prefetch that the next navigation interrupts is aborted by the browser; that is not a failure of the page.
    const failed: string[] = [];
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') failed.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`);
    });
    const user = await world.signedInUser();
    await world.activate(user);
    await signIn(context, baseURL!, user, {locale: 'he', theme: 'dark'});
    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', {level: 1}), route.path).toBeVisible();
    }
    // 404 responses are the 404 page doing its job; everything else must be silent.
    expect(problems.filter((problem) => !/404 \(Not Found\)|Failed to load resource/.test(problem))).toEqual([]);
    expect(failed).toEqual([]);
  });

  test('the first HTML already has the record\'s language, direction and theme, so nothing flashes', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await signIn(context, baseURL!, user, {locale: 'he', theme: 'dark'});
    await page.goto('/');
    expect(await world.preferencesOf(user)).toMatchObject({locale: 'he', theme: 'dark'});
    // A different device, no cookies of its own: the very first HTML says so.
    const request = await context.request.get(`${baseURL}/projects`, {headers: {cookie: (await context.cookies()).filter((cookie) => !cookie.name.startsWith('nova3d-')).map((cookie) => `${cookie.name}=${cookie.value}`).join('; '), 'sec-fetch-dest': 'document', accept: 'text/html'}});
    expect(request.status()).toBe(200);
    expect(await request.text()).toMatch(/<html lang="he" dir="rtl" data-theme="dark"/);
  });

  test('the sign-in page of a signed-out browser stays the device\'s: no record, no Account asked', async ({page}) => {
    await page.goto('/login');
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('en', 'login.title'));
    expect(await cookieValue(page.context(), 'nova3d-locale')).toBeUndefined();
  });
});
