import AxeBuilder from '@axe-core/playwright';
import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import {translate, type Locale, type MessageKey} from '../../lib/i18n';

// Story 1.2: the accessible, localized shell. The real shell is behind sign-in and no test login exists
// until Story 1.4, so these flows run on the synthetic design kit (/kit), which renders the same shell,
// the shared patterns and the Settings controls. Unless SYNTHETIC_DATA_ENABLED=true the kit is not public:
// a signed-out browser is redirected to sign-in and a signed-in one gets a 404.
// Every flow runs on both projects: `desktop` (sidebar) and `phone` (bottom bar).

type Variant = {name: string; locale: Locale; theme: 'light' | 'dark'};
const variants: Variant[] = [
  {name: 'English, light', locale: 'en', theme: 'light'},
  {name: 'English, dark', locale: 'en', theme: 'dark'},
  {name: 'Hebrew, light', locale: 'he', theme: 'light'},
  {name: 'Hebrew, dark', locale: 'he', theme: 'dark'},
];

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const label = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);

async function setPreferences(context: BrowserContext, baseURL: string, preferences: {locale?: string; theme?: string; detail?: string; guidance?: string}) {
  const cookies = Object.entries(preferences).map(([name, value]) => ({name: `nova3d-${name}`, value: String(value), url: baseURL}));
  if (cookies.length) await context.addCookies(cookies);
}

// In CI the design kit must be there: a skipped test would read as a pass. On a developer machine without
// SYNTHETIC_DATA_ENABLED=true the kit is off, so its tests skip with a reason instead of failing.
const inCi = Boolean(process.env.CI);

function requireKit(finalUrl: string, status: number | undefined) {
  const unavailable = status === 404 || new URL(finalUrl).pathname !== '/kit';
  const reason = 'The design kit is off: run the server with SYNTHETIC_DATA_ENABLED=true.';
  if (inCi) expect(unavailable, reason).toBe(false);
  else test.skip(unavailable, reason);
}

async function openKit(page: Page) {
  const response = await page.goto('/kit');
  requireKit(page.url(), response?.status());
  await expect(page.locator('main h1')).toBeVisible();
}

async function violations(page: Page) {
  const results = await new AxeBuilder({page}).withTags(wcag).analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.slice(0, 5).map((node) => `${node.target.join(' ')} :: ${node.failureSummary?.split('\n').slice(0, 3).join(' | ')}`),
  }));
}

const announcer = (page: Page) => page.locator('[data-announcer]');
const cookie = async (context: BrowserContext, name: string) => (await context.cookies()).find((candidate) => candidate.name === name)?.value;
const mainNav = (page: Page, locale: Locale) => page.getByRole('navigation', {name: label(locale, 'a11y.mainNavigation')});

async function setFontSize(page: Page, pixels: number) {
  const session = await page.context().newCDPSession(page);
  // The browser's own "font size" setting, which is what enlarged text really changes (it also moves rem breakpoints).
  await session.send('Page.setFontSizes', {fontSizes: {standard: pixels, fixed: pixels}});
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clipped = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (box.width === 0 || style.visibility === 'hidden' || element.closest('.visually-hidden, .skip-link')) return false;
        // Something inside a box that clips it (decorative art in a card, say) cannot widen the page.
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

test('the design kit is served in the synthetic test environment', async ({page}) => {
  // Every kit flow below depends on this. It never skips: a redirect (flag off, signed out) or a 404 fails it.
  const response = await page.goto('/kit');
  expect(response?.status(), 'GET /kit').toBe(200);
  expect(new URL(page.url()).pathname, 'no redirect away from /kit').toBe('/kit');
  await expect(page.getByRole('heading', {level: 1})).toHaveText(label('en', 'kit.title'));
});

test.describe('axe: no accessibility violations (AC-3)', () => {
  for (const variant of variants) {
    test(`the shell, patterns and Settings: ${variant.name}`, async ({page, context, baseURL}) => {
      await setPreferences(context, baseURL!, {locale: variant.locale, theme: variant.theme});
      await openKit(page);
      expect(await violations(page)).toEqual([]);
    });

    test(`the sign-in page: ${variant.name}`, async ({page, context, baseURL}) => {
      await setPreferences(context, baseURL!, {locale: variant.locale, theme: variant.theme});
      await page.goto('/login');
      await expect(page.getByRole('heading', {level: 1})).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }

  for (const variant of [variants[0], variants[3]]) {
    test(`with menus and dialogs open: ${variant.name}`, async ({page, context, baseURL}) => {
      await setPreferences(context, baseURL!, {locale: variant.locale, theme: variant.theme});
      await openKit(page);
      const {locale} = variant;

      await page.getByRole('button', {name: label(locale, 'notifications.button', {count: 1})}).click();
      await expect(page.getByRole('region', {name: label(locale, 'notifications.title')})).toBeVisible();
      expect(await violations(page), 'notifications open').toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', {name: label(locale, 'nav.account')}).click();
      await expect(page.getByRole('region', {name: label(locale, 'account.title')})).toBeVisible();
      expect(await violations(page), 'account open').toEqual([]);
      await page.keyboard.press('Escape');

      await mainNav(page, locale).getByRole('button', {name: label(locale, 'nav.create')}).click();
      const create = page.getByRole('dialog', {name: label(locale, 'create.title')});
      await expect(create).toBeVisible();
      await create.getByRole('radio').first().check();
      expect(await violations(page), 'create dialog open').toEqual([]);
      await page.keyboard.press('Escape');

      await page.getByRole('button', {name: label(locale, 'confirm.open')}).click();
      await expect(page.getByRole('dialog', {name: label(locale, 'confirm.title')})).toBeVisible();
      expect(await violations(page), 'confirm dialog open').toEqual([]);
    });
  }

  test('with high contrast requested, in both themes', async ({page, context, baseURL}) => {
    await page.emulateMedia({contrast: 'more'});
    for (const theme of ['light', 'dark'] as const) {
      await context.clearCookies();
      await setPreferences(context, baseURL!, {theme});
      await openKit(page);
      expect(await violations(page), theme).toEqual([]);
    }
  });
});

test.describe('names and landmarks (AC-3)', () => {
  for (const locale of ['en', 'he'] as const) {
    test(`the navigation exposes names and the current page: ${locale}`, async ({page, context, baseURL}) => {
      await setPreferences(context, baseURL!, {locale});
      await openKit(page);
      const nav = mainNav(page, locale);
      await expect(nav).toBeVisible();
      for (const key of ['nav.home', 'nav.projects', 'nav.progress'] as const) await expect(nav.getByRole('link', {name: label(locale, key)})).toBeVisible();
      await expect(nav.getByRole('button', {name: label(locale, 'nav.create')})).toBeVisible();
      await expect(page.getByRole('link', {name: label(locale, 'nav.settings')})).toBeVisible();
      await expect(page.getByRole('button', {name: label(locale, 'notifications.button', {count: 1})})).toBeVisible();
      await expect(page.getByRole('button', {name: label(locale, 'nav.account')})).toBeVisible();
      await expect(page.getByRole('link', {name: label(locale, 'nav.backToHome')})).toBeVisible();
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('note').first()).toContainText(label(locale, 'shell.syntheticBadge'));
    });
  }

  test('marks no page as current on the kit, because it is not one of the primary destinations', async ({page}) => {
    await openKit(page);
    await expect(page.locator('nav [aria-current="page"]')).toHaveCount(0);
  });

  test('the whole project card is one target, and that target is the project route', async ({page}) => {
    await openKit(page);
    const card = page.locator('article.project-card').first();
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    // Not on the title: the blank part of the card, near its bottom edge.
    const point = {x: box.x + box.width / 2, y: box.y + box.height - 8};
    const target = await page.evaluate(({x, y}) => {
      const hit = document.elementFromPoint(x, y);
      return {href: hit?.closest('a')?.getAttribute('href') ?? null, inCard: Boolean(hit?.closest('article.project-card'))};
    }, point);
    expect(target).toEqual({href: '/projects', inCard: true});
    // A card with no route has no link to hit, anywhere.
    const plain = page.locator('article.project-card').nth(1);
    await plain.scrollIntoViewIfNeeded();
    const plainBox = (await plain.boundingBox())!;
    expect(await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest('a'), {x: plainBox.x + plainBox.width / 2, y: plainBox.y + plainBox.height - 8})).toBeNull();
    // The click really navigates to /projects. The kit is public and /projects is not, so the proxy answers
    // with the sign-in redirect; leaving /kit by that link is the observable result.
    await card.scrollIntoViewIfNeeded();
    const moved = (await card.boundingBox())!;
    await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height - 8);
    await expect(page).toHaveURL(/\/login\?error=/);
  });

  test('the viewport covers the whole screen and still allows zoom', async ({page}) => {
    await openKit(page);
    const content = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(content).toContain('viewport-fit=cover');
    expect(content).not.toMatch(/user-scalable=(no|0)|maximum-scale/);
  });
});

test.describe('keyboard (AC-3)', () => {
  test('the skip link is first, shows on focus, and moves focus to the page content', async ({page}) => {
    await openKit(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', {name: label('en', 'a11y.skipToContent')});
    await expect(skip).toBeFocused();
    const box = (await skip.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('every control the keyboard reaches shows a visible focus ring', async ({page}) => {
    await openKit(page);
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

  test('navigation comes in reading order: Home, My Projects, Create, In Progress', async ({page}) => {
    await openKit(page);
    const names: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab');
      names.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim()));
    }
    const order = ['Home', 'My Projects', 'Create', 'In Progress'].map((name) => names.indexOf(name));
    expect(order.every((index) => index >= 0), names.join(' | ')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('a menu opens from the keyboard, closes with Escape and gives focus back', async ({page}) => {
    await openKit(page);
    const bell = page.getByRole('button', {name: label('en', 'notifications.button', {count: 1})});
    await bell.focus();
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('region', {name: 'Notifications'});
    await expect(panel).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('link')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(bell).toBeFocused();
    await expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  test('the Create dialog traps focus, closes with Escape and returns focus to its opener', async ({page}) => {
    await openKit(page);
    const create = mainNav(page, 'en').getByRole('button', {name: 'Create'});
    await create.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {name: 'What would you like to make?'});
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
    await expect(dialog.getByText('Picture intake selected')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(create).toBeFocused();
  });

  test('a destructive confirmation starts on Cancel and gives focus back', async ({page}) => {
    await openKit(page);
    const opener = page.getByRole('button', {name: 'Open the confirmation'});
    await opener.click();
    const dialog = page.getByRole('dialog', {name: 'Remove this sample item?'});
    await expect(dialog.getByRole('button', {name: 'Cancel'})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByRole('dialog').getByRole('button', {name: 'Remove'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a radio group answers the arrow keys and applies the choice', async ({page}) => {
    await openKit(page);
    await page.getByRole('radio', {name: 'Light'}).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('radio', {name: 'Dark'})).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('menus and dialogs close the way people expect (AC-3)', () => {
  const bell = (page: Page) => page.getByRole('button', {name: label('en', 'notifications.button', {count: 1})});
  const account = (page: Page) => page.getByRole('button', {name: label('en', 'nav.account')});
  const createButton = (page: Page) => mainNav(page, 'en').getByRole('button', {name: label('en', 'nav.create')});

  test('a click on the backdrop closes the Create dialog and gives focus back to its opener', async ({page}) => {
    await openKit(page);
    await createButton(page).click();
    const dialog = page.getByRole('dialog', {name: label('en', 'create.title')});
    await expect(dialog).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
    await expect(createButton(page)).toBeFocused();
  });

  test('dragging a text selection out of the dialog onto the backdrop does not close it', async ({page}) => {
    await openKit(page);
    await createButton(page).click();
    const dialog = page.getByRole('dialog', {name: label('en', 'create.title')});
    const description = (await dialog.locator('.dialog-description').boundingBox())!;
    await page.mouse.move(description.x + 6, description.y + 6);
    await page.mouse.down();
    await page.mouse.move(2, 2, {steps: 6});
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    // A plain click on the backdrop afterwards still closes it.
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
  });

  test('a click outside a menu closes it and keeps focus from falling to the page', async ({page}) => {
    await openKit(page);
    for (const [trigger, panel] of [[bell(page), 'notifications.title'], [account(page), 'account.title']] as const) {
      await trigger.focus();
      await page.keyboard.press('Enter');
      const region = page.getByRole('region', {name: label('en', panel)});
      await expect(region).toBeVisible();
      // The notifications panel has a link to tab into; the account panel is text only, so focus stays on its button.
      if ((await region.locator('a, button').count()) > 0) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.popover-panel')))).toBe(true);
      }
      // Blank space: the bottom edge of the page heading, which cannot take focus. On a phone the open panel
      // covers the heading's upper part, so aim below it.
      const heading = page.locator('main h1');
      await heading.click({position: {x: 4, y: (await heading.boundingBox())!.height - 3}});
      await expect(region).toHaveCount(0);
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
    }
  });

  test('a click on another control closes the menu and lets that control take focus', async ({page}) => {
    await openKit(page);
    await bell(page).click();
    await expect(page.getByRole('region', {name: label('en', 'notifications.title')})).toBeVisible();
    await account(page).click();
    await expect(page.getByRole('region', {name: label('en', 'notifications.title')})).toHaveCount(0);
    await expect(page.getByRole('region', {name: label('en', 'account.title')})).toBeVisible();
  });

  test('tabbing out of an open menu closes it, forwards and backwards', async ({page}) => {
    await openKit(page);
    await bell(page).focus();
    await page.keyboard.press('Enter');
    const region = page.getByRole('region', {name: label('en', 'notifications.title')});
    await expect(region).toBeVisible();
    await page.keyboard.press('Tab'); // into the panel
    await expect(region.getByRole('link')).toBeFocused();
    await page.keyboard.press('Tab'); // out of it, to Settings
    await expect(page.getByRole('link', {name: label('en', 'nav.settings')})).toBeFocused();
    await expect(region).toHaveCount(0);

    await bell(page).focus();
    await page.keyboard.press('Enter');
    await expect(region).toBeVisible();
    await page.keyboard.press('Shift+Tab'); // backwards, out of the menu
    await expect(region).toHaveCount(0);
  });

  test('a change of path closes open menus and the Create dialog, Back and Forward included', async ({page}) => {
    await openKit(page);
    // Next.js syncs the router with the History API, so this is the same change of pathname a link makes.
    await bell(page).click();
    await expect(bell(page)).toHaveAttribute('aria-expanded', 'true');
    await page.evaluate(() => window.history.pushState(null, '', '/kit/elsewhere'));
    await expect(page.getByRole('region', {name: label('en', 'notifications.title')})).toHaveCount(0);

    await account(page).click();
    await expect(page.getByRole('region', {name: label('en', 'account.title')})).toBeVisible();
    await page.evaluate(() => window.history.pushState(null, '', '/kit/again'));
    await expect(page.getByRole('region', {name: label('en', 'account.title')})).toHaveCount(0);

    await createButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/kit\/elsewhere$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await createButton(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/kit\/again$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the Help link goes to an element that exists on the Settings content', async ({page}) => {
    await openKit(page);
    // The Help link is part of the sidebar, which a phone does not show, so read it from the document rather
    // than from what is visible: the target it names must exist either way.
    const href = await page.locator('a.help-link').getAttribute('href');
    const fragment = new URL(href!, 'http://example.test').hash.slice(1);
    expect(fragment).not.toBe('');
    // The kit shows the same Settings controls as /settings, so the target must be on this page too.
    await expect(page.locator(`#${fragment}`)).toHaveCount(1);
    await expect(page.locator(`#${fragment}`)).toContainText(label('en', 'settings.guidance.title'));
  });
});

test.describe('a browser that refuses cookies (AC-2)', () => {
  test('is told, and the page does not pretend a choice stuck', async ({page, context}) => {
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
      Object.defineProperty(Document.prototype, 'cookie', {configurable: true, get: descriptor.get, set: () => undefined});
    });
    await openKit(page);
    const failed = label('en', 'settings.announce.failed');
    const html = page.locator('html');

    await page.getByRole('radio', {name: 'Dark'}).click();
    await expect(announcer(page)).toHaveText(failed);
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('radio', {name: 'Light'})).toBeChecked();

    // Light is already the default: a refused write must be caught even when the value chosen equals it.
    await page.getByRole('radio', {name: 'Dark'}).click();
    await page.getByRole('radio', {name: 'Light'}).click();
    await expect(announcer(page)).toHaveText(failed);

    await page.getByRole('radio', {name: 'עברית'}).click();
    await expect(announcer(page)).toHaveText(failed);
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('radio', {name: /Match my device/})).toBeChecked();

    await page.getByRole('radio', {name: 'Technical'}).click();
    await expect(page.locator('[data-detail="technical"]')).toHaveCount(0);
    await expect(page.getByRole('radio', {name: 'Simple'})).toBeChecked();

    // Dismissing the guidance fails too: the card stays and focus stays on the button that was pressed.
    const dismiss = page.locator('[data-guidance]').getByRole('button', {name: label('en', 'guidance.dismiss')});
    await dismiss.click();
    await expect(announcer(page)).toHaveText(failed);
    await expect(page.locator('[data-guidance]')).toBeVisible();
    await expect(dismiss).toBeFocused();

    expect((await context.cookies()).filter((cookie) => cookie.name.startsWith('nova3d-'))).toEqual([]);
  });
});

test.describe('device language and stored preferences (AC-1, AC-2, I/O matrix)', () => {
  test('a Hebrew device with no cookie gets Hebrew, right to left, light', async ({browser, baseURL}) => {
    const context = await browser.newContext({locale: 'he-IL', baseURL});
    const page = await context.newPage();
    await openKit(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('he', 'kit.title'));
    await expect(page.locator('.synthetic-banner')).toContainText(label('he', 'shell.syntheticNote'));
    await context.close();
  });

  test('an unsupported device language gets English', async ({browser, baseURL}) => {
    const context = await browser.newContext({locale: 'fr-FR', baseURL});
    const page = await context.newPage();
    await openKit(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await context.close();
  });

  test('the cookie wins over the device language', async ({browser, baseURL}) => {
    const context = await browser.newContext({locale: 'he-IL', baseURL});
    await setPreferences(context, baseURL!, {locale: 'en'});
    const page = await context.newPage();
    await openKit(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await context.close();
  });

  test('a tampered cookie is ignored without an error', async ({page, context, baseURL}) => {
    await setPreferences(context, baseURL!, {locale: 'klingon', theme: 'neon', detail: 'expert', guidance: '<b>'});
    await openKit(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('alert').filter({hasText: /\S/})).toHaveCount(0);
    await expect(page.locator('[data-guidance]')).toBeVisible();
    await expect(page.locator('[data-detail="technical"]')).toHaveCount(0);
  });

  test('dark is in the first HTML, so nothing flashes', async ({request}) => {
    const dark = await request.get('/kit', {headers: {cookie: 'nova3d-theme=dark'}});
    requireKit(dark.url(), dark.status());
    expect(await dark.text()).toMatch(/<html lang="en" dir="ltr" data-theme="dark"/);
    const hebrew = await request.get('/kit', {headers: {cookie: 'nova3d-locale=he; nova3d-theme=dark'}});
    expect(await hebrew.text()).toMatch(/<html lang="he" dir="rtl" data-theme="dark"/);
    const device = await request.get('/kit', {headers: {'accept-language': 'he-IL,he;q=0.9,en;q=0.5'}});
    expect(await device.text()).toMatch(/<html lang="he" dir="rtl" data-theme="light"/);
  });

  test('the operating system colour scheme never turns dark mode on', async ({browser, baseURL}) => {
    const context = await browser.newContext({colorScheme: 'dark', baseURL});
    const page = await context.newPage();
    await openKit(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(246, 247, 251)');
    await context.close();
  });

  test('choosing dark applies at once, persists, and is announced', async ({page, context}) => {
    await openKit(page);
    await page.getByRole('radio', {name: 'Dark'}).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(announcer(page)).toHaveText('Dark mode on.');
    expect(await cookie(context, 'nova3d-theme')).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('radio', {name: 'Dark'})).toBeChecked();
    await page.getByRole('radio', {name: 'Light'}).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('choosing Hebrew mirrors the page, persists, and returns to the device language on request', async ({page, context}) => {
    await openKit(page);
    await expect(page.getByRole('radio', {name: /Match my device/})).toBeChecked();
    await page.getByRole('radio', {name: 'עברית'}).check();
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(announcer(page)).toHaveText(translate('he', 'settings.announce.language', {language: 'עברית'}));
    await expect(announcer(page)).toHaveAttribute('lang', 'he');
    expect(await cookie(context, 'nova3d-locale')).toBe('he');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('he', 'kit.title'));
    // The document title follows the language too, without a reload.
    await expect(page).toHaveTitle(`${label('he', 'meta.kit')} · nova3D`);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await page.getByRole('radio', {name: label('he', 'settings.language.device')}).check();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await cookie(context, 'nova3d-locale')).toBeUndefined();
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('en', 'kit.title'));
    await expect(page).toHaveTitle(`${label('en', 'meta.kit')} · nova3D`);
  });

  test('technical detail adds explanation and changes nothing else', async ({page, context}) => {
    await openKit(page);
    const facts = () => page.evaluate(() => ({
      badges: [...document.querySelectorAll('.status-badge')].map((badge) => badge.textContent),
      progress: [...document.querySelectorAll('[role="progressbar"]')].map((bar) => bar.getAttribute('aria-valuenow')),
      projects: [...document.querySelectorAll('article.project-card h3')].map((heading) => heading.textContent),
      theme: document.documentElement.dataset.theme,
      lang: document.documentElement.lang,
    }));
    const before = await facts();
    await expect(page.locator('[data-detail="technical"]')).toHaveCount(0);
    await page.getByRole('radio', {name: 'Technical'}).check();
    await expect(page.locator('[data-guidance] [data-detail="technical"]')).toHaveCount(5);
    await expect(announcer(page)).toHaveText('Technical detail on.');
    expect(await cookie(context, 'nova3d-detail')).toBe('technical');
    expect(await facts()).toEqual(before);
    await page.reload();
    await expect(page.locator('[data-guidance] [data-detail="technical"]')).toHaveCount(5);
    expect(await facts()).toEqual(before);
  });

  test('guidance dismissed stays hidden after a reload, then Replay brings it back', async ({page, context}) => {
    await openKit(page);
    const guidance = page.locator('[data-guidance]');
    await expect(guidance).toBeVisible();
    await expect(guidance.locator('li')).toHaveCount(5);
    await guidance.getByRole('button', {name: 'Dismiss guidance'}).click();
    await expect(guidance).toHaveCount(0);
    await expect(announcer(page)).toHaveText('Guidance dismissed. You can bring it back from Settings.');
    await expect(page.locator('main')).toBeFocused();
    expect(await cookie(context, 'nova3d-guidance')).toBe('dismissed');
    await page.reload();
    await expect(page.locator('[data-guidance]')).toHaveCount(0);
    await expect(page.getByText('The introduction is hidden.')).toBeVisible();
    await page.getByRole('button', {name: 'Replay introduction'}).click();
    await expect(page.locator('[data-guidance]')).toBeVisible();
    await expect(announcer(page)).toHaveText('Introduction restored on Home.');
    await page.reload();
    await expect(page.locator('[data-guidance]')).toBeVisible();
  });
});

test.describe('right to left and mixed languages (AC-3, UX-DR5)', () => {
  test('the layout and direction icons mirror in Hebrew', async ({page, context, baseURL}) => {
    await setPreferences(context, baseURL!, {locale: 'he'});
    await openKit(page);
    const viewport = page.viewportSize()!;
    const home = mainNav(page, 'he').getByRole('link', {name: label('he', 'nav.home')});
    const projects = mainNav(page, 'he').getByRole('link', {name: label('he', 'nav.projects')});
    const [homeBox, projectsBox] = [(await home.boundingBox())!, (await projects.boundingBox())!];
    if (viewport.width >= 768) {
      // Sidebar: it sits at the inline start, which is the right-hand side in Hebrew.
      expect((await mainNav(page, 'he').boundingBox())!.x).toBeGreaterThan(viewport.width / 2);
    } else {
      // Bottom bar: the first item is at the right.
      expect(homeBox.x).toBeGreaterThan(projectsBox.x);
    }
    const mirrored = await page.locator('.icon-directional').first().evaluate((icon) => getComputedStyle(icon).transform);
    expect(mirrored).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    const back = page.getByRole('link', {name: label('he', 'nav.backToHome')});
    const backBox = (await back.boundingBox())!;
    expect(backBox.x).toBeGreaterThan(viewport.width / 2);
  });

  test('the same icon is not mirrored in English', async ({page}) => {
    await openKit(page);
    expect(await page.locator('.icon-directional').first().evaluate((icon) => getComputedStyle(icon).transform)).toBe('none');
  });

  for (const locale of ['en', 'he'] as const) {
    test(`Hebrew and English spans keep their own lang and dir inside a ${locale} page`, async ({page, context, baseURL}) => {
      await setPreferences(context, baseURL!, {locale});
      await openKit(page);
      const sample = page.locator('[data-sample]');
      const hebrew = sample.locator('p[lang="he"]');
      const english = sample.locator('p[lang="en"]');
      await expect(hebrew).toHaveAttribute('dir', 'rtl');
      await expect(english).toHaveAttribute('dir', 'ltr');
      expect(await hebrew.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');
      expect(await english.evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
      expect(await hebrew.evaluate((element) => getComputedStyle(element).unicodeBidi)).toBe('isolate');
      expect(await english.evaluate((element) => getComputedStyle(element).textAlign)).toMatch(/^(start|left)$/);
      // Three distinct blocks: original, translation, explanation.
      await expect(sample.locator('.bilingual-block')).toHaveCount(3);
    });
  }

  test('an identifier stays left to right inside Hebrew text', async ({page, context, baseURL}) => {
    await setPreferences(context, baseURL!, {locale: 'he'});
    await openKit(page);
    const explanation = page.locator('[data-sample] .bilingual-block').nth(2).locator('p');
    await expect(explanation).toContainText('SAMPLE-001');
    expect(await explanation.evaluate((element) => element.textContent)).toContain('⁦SAMPLE-001⁩');
    const token = page.locator('bdi.ltr-token').first();
    expect(await token.evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
  });

  test('the language preview shows both languages with their own direction', async ({page}) => {
    await openKit(page);
    const preview = page.locator('.language-preview');
    await expect(preview.locator('p[lang="en"]')).toHaveAttribute('dir', 'ltr');
    await expect(preview.locator('p[lang="he"]')).toHaveAttribute('dir', 'rtl');
  });

  test('the sign-in page reads in Hebrew with no shell around it', async ({page, context, baseURL}) => {
    await setPreferences(context, baseURL!, {locale: 'he'});
    await page.goto('/login?error=not_allowed');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('he', 'login.title'));
    await expect(page.getByRole('alert').filter({hasText: label('he', 'login.error.not_allowed')})).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(1);
  });
});

test.describe('reduced motion, high contrast and forced colours (AC-3)', () => {
  test('reduced motion removes transitions and animation', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await openKit(page);
    const durations = await page.evaluate(() => [...document.querySelectorAll('.btn, .icon-btn, .nav-item, .choice')].map((element) => {
      const style = getComputedStyle(element);
      return {transition: parseFloat(style.transitionDuration), animation: parseFloat(style.animationDuration), scroll: style.scrollBehavior};
    }));
    expect(durations.length).toBeGreaterThan(5);
    for (const duration of durations) {
      expect(duration.transition).toBeLessThanOrEqual(0.001);
      expect(duration.animation).toBeLessThanOrEqual(0.001);
      expect(duration.scroll).toBe('auto');
    }
  });

  test('high contrast darkens the text and border tokens', async ({page}) => {
    await openKit(page);
    const normal = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--border-strong').trim());
    await page.emulateMedia({contrast: 'more'});
    const more = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--border-strong').trim());
    expect(more).not.toBe(normal);
  });

  test('forced colours keep every control and badge outlined', async ({page}) => {
    await page.emulateMedia({forcedColors: 'active'});
    await openKit(page);
    const unbounded = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.btn, .icon-btn, .status-badge, .choice')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.borderTopStyle === 'none' || parseFloat(style.borderTopWidth) === 0;
      })
      .map((element) => element.className));
    expect(unbounded).toEqual([]);
  });
});

test.describe('enlarged text and narrow screens (AC-3)', () => {
  const pages = ['/kit', '/login'];

  for (const variant of [variants[0], variants[3]]) {
    for (const path of pages) {
      test(`200% text reflows without sideways scrolling: ${path}, ${variant.name}`, async ({page, context, baseURL, browserName}) => {
        test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
        await setPreferences(context, baseURL!, {locale: variant.locale, theme: variant.theme});
        await setFontSize(page, 32);
        const response = await page.goto(path);
        if (path === '/kit') requireKit(page.url(), response?.status());
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
        expect(await overflow(page)).toEqual({scroll: 0, clipped: []});
        if (path === '/kit') {
          // Every way to act is still there: the primary navigation, Settings, Notifications, Account.
          const nav = mainNav(page, variant.locale);
          await expect(nav.getByRole('button', {name: label(variant.locale, 'nav.create')})).toBeVisible();
          await expect(page.getByRole('link', {name: label(variant.locale, 'nav.settings')})).toBeVisible();
          expect(await violations(page)).toEqual([]);
        }
      });

      test(`320 px wide reflows without sideways scrolling: ${path}, ${variant.name}`, async ({page, context, baseURL}) => {
        await setPreferences(context, baseURL!, {locale: variant.locale, theme: variant.theme});
        await page.setViewportSize({width: 320, height: 640});
        const response = await page.goto(path);
        if (path === '/kit') requireKit(page.url(), response?.status());
        expect(await overflow(page)).toEqual({scroll: 0, clipped: []});
        if (path === '/kit') {
          await expect(mainNav(page, variant.locale).getByRole('button', {name: label(variant.locale, 'nav.create')})).toBeVisible();
          await mainNav(page, variant.locale).getByRole('button', {name: label(variant.locale, 'nav.create')}).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          const box = (await dialog.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(320);
        }
      });
    }
  }

  test('320 px wide with 200% text still has no sideways scrolling', async ({page, browserName, context, baseURL}) => {
    test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
    await setPreferences(context, baseURL!, {locale: 'he', theme: 'dark'});
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    await openKit(page);
    expect(await overflow(page)).toEqual({scroll: 0, clipped: []});
  });

  test('the bottom bar and menus fit a short, narrow screen', async ({page}) => {
    await page.setViewportSize({width: 320, height: 240});
    await openKit(page);
    expect(await overflow(page)).toEqual({scroll: 0, clipped: []});
    await page.getByRole('button', {name: 'Notifications, 1 unread'}).click();
    const panel = page.getByRole('region', {name: 'Notifications'});
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  });
});

test.describe('touch targets are at least 44 px (AC-3)', () => {
  for (const variant of [variants[0], variants[2]]) {
    test(`every control: ${variant.name}`, async ({page, context, baseURL}) => {
      await setPreferences(context, baseURL!, {locale: variant.locale, theme: variant.theme});
      await openKit(page);
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
});

test.describe('status never relies on colour alone (UX-DR4)', () => {
  test('every badge, notice and state has a shape and a word', async ({page}) => {
    await openKit(page);
    const bare = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.status-badge, .notice, .state')]
      .filter((element) => !element.querySelector('svg') || !(element.textContent ?? '').trim())
      .map((element) => element.className));
    expect(bare).toEqual([]);
    const badges = await page.evaluate(() => [...document.querySelectorAll('.status-badge')].map((badge) => badge.querySelector('svg')?.innerHTML ?? ''));
    expect(new Set(badges).size).toBeGreaterThanOrEqual(10);
  });
});
