import {expect, test, type Browser, type BrowserContext, type Page} from '@playwright/test';
import {callsFor, endOutage, flakyBaseUrl, forgetCalls, startOutage} from '../support/fake-network';
import {announcer, cookieValue, hydrated, label, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld, type ForgedUser} from '../support/forged-session';
import type {Locale} from '../../lib/i18n';

// Story 1.4d, AC-7: the Account-owned preferences record, in a real browser against the production build and the
// local Supabase stack. Each test forges a Google session with an Account and its grant (tests/support/
// forged-session.ts); Auth still validates the token, so the application's own proxy, authorization and Server
// Action all run. Every flow runs on `desktop` and `phone`.
//
//   * a person's first sign-in adopts the device's cookies into the Account's record, and a new device renders it;
//   * a change made signed in is applied at once, saved to the record, mirrored in the cookie, announced, and
//     undone (and announced) if it cannot be saved;
//   * a change made on another device shows on the next page load;
//   * the sign-in page offers English or Hebrew and light or dark: cookies only for a visitor with no session, and
//     saved to the Account (or undone, with the notice) for a visitor who holds one.
//
// "The database cannot save" is made true for ONE user on the second application server (the same build with
// tests/support/fake-network.mjs preloaded; see playwright.config.ts), so no other test is disturbed.

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const flaky = (baseURL: string, path = '/') => new URL(path, flakyBaseUrl(baseURL)).href;
/** The fake network keys the preferences functions, which name only an Account, by the Account's ID. */
const accountKey = async (user: ForgedUser) => (await world.accountOf(user)).id as string;
const html = (page: Page) => page.locator('html');
const radio = (page: Page, name: string | RegExp) => page.getByRole('radio', {name});
const hebrewDark = {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'};
const defaults = {locale: null, theme: 'light', detail: 'simple', guidance: 'shown'};

/** A user with an Account and the grant of their forged session, and NO preferences record yet: what a first sign-in finds. */
async function newcomer() {
  const user = await world.signedInUser();
  await world.activate(user);
  expect(await world.preferencesOf(user)).toBeUndefined();
  return user;
}

/** Another browser or device of the same person: its own session with its own grant. */
async function secondDevice(browser: Browser, baseURL: string, user: ForgedUser, preferences: Parameters<typeof signIn>[3] = {}, options: {locale?: string} = {}) {
  const device = await world.extraSession(user);
  await world.grant(user, device.sessionId);
  const context = await browser.newContext({baseURL, locale: options.locale});
  await signIn(context, baseURL, device, preferences);
  return {context, page: await context.newPage(), device};
}

/** The page has rendered and React has taken over its controls (before that a press does nothing). Home has buttons; Settings has radios. */
const settle = async (page: Page, selector = 'input[type="radio"]') => {
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await hydrated(page, selector);
};
const settleHome = (page: Page) => settle(page, 'main button');

// ---------------------------------------------------------------------------------------------------
test.describe('a first sign-in adopts the choices the device made before it (AC-7)', () => {
  test('Hebrew, dark, technical and a dismissed introduction become the Account\'s record, in that very request', async ({page, context, baseURL}) => {
    const user = await newcomer();
    await signIn(context, baseURL!, user, hebrewDark);
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    // The proxy adopted them before the page was served: the record exists as soon as the page does.
    expect(await world.preferencesOf(user)).toEqual(hebrewDark);
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    // The cookies are left as the device made them.
    expect(await cookieValue(context, 'nova3d-locale')).toBe('he');
    expect(await cookieValue(context, 'nova3d-theme')).toBe('dark');
  });

  test('a device with no cookies adopts the defaults, with no language chosen, and keeps following its own language', async ({browser, baseURL}) => {
    const user = await newcomer();
    const context = await browser.newContext({baseURL, locale: 'he-IL'});
    await signIn(context, baseURL!, user);
    const page = await context.newPage();
    await page.goto('/');
    expect(await world.preferencesOf(user)).toEqual(defaults);
    // No language was chosen, so the page still follows the device: Hebrew here.
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await context.close();
  });

  test('a tampered cookie is treated as absent, and the good ones are still adopted', async ({page, context, baseURL}) => {
    const user = await newcomer();
    await signIn(context, baseURL!, user, {locale: 'klingon', theme: 'neon', detail: 'technical', guidance: '<b>'});
    await page.goto('/');
    expect(await world.preferencesOf(user)).toEqual({locale: null, theme: 'light', detail: 'technical', guidance: 'shown'});
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
  });

  test('adopts once: the choices the device makes AFTER that are not adopted, the record wins', async ({page, context, baseURL}) => {
    const user = await newcomer();
    await signIn(context, baseURL!, user, {locale: 'he', theme: 'dark'});
    await page.goto('/');
    expect(await world.preferencesOf(user)).toMatchObject({locale: 'he', theme: 'dark'});
    // The device's cookies change by some other means (another site's script cannot, but the person's own browser can).
    await context.addCookies([{name: 'nova3d-locale', value: 'en', url: baseURL!}, {name: 'nova3d-theme', value: 'light', url: baseURL!}]);
    await page.goto('/projects');
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    expect(await world.preferencesOf(user)).toMatchObject({locale: 'he', theme: 'dark'});
  });

  test('a new device renders the record, not its own cookies, and leaves its cookies untouched', async ({page, context, browser, baseURL}) => {
    const user = await newcomer();
    await signIn(context, baseURL!, user, hebrewDark);
    await page.goto('/');
    expect(await world.preferencesOf(user)).toEqual(hebrewDark);

    const other = await secondDevice(browser, baseURL!, user, {locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown'});
    await other.page.goto('/');
    await expect(html(other.page)).toHaveAttribute('lang', 'he');
    await expect(html(other.page)).toHaveAttribute('dir', 'rtl');
    await expect(html(other.page)).toHaveAttribute('data-theme', 'dark');
    // The dismissed introduction and the technical level came with the Account too.
    await expect(other.page.locator('[data-guidance]')).toHaveCount(0);
    expect(await cookieValue(other.context, 'nova3d-locale')).toBe('en');
    expect(await cookieValue(other.context, 'nova3d-theme')).toBe('light');
    expect(await world.preferencesOf(user)).toEqual(hebrewDark);
    await other.context.close();
  });

  test('a database that cannot adopt does not block the page: it renders from the cookies, and the next navigation adopts', async ({page, context, baseURL}) => {
    const user = await newcomer();
    await signIn(context, baseURL!, user, hebrewDark);
    const key = await accountKey(user);
    forgetCalls(key);
    const stop = startOutage(key, {rpc: ['adopt_preferences']});
    try {
      const response = await page.goto(flaky(baseURL!, '/'));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', {level: 1})).toBeVisible();
      await expect(html(page)).toHaveAttribute('lang', 'he');
      await expect(html(page)).toHaveAttribute('data-theme', 'dark');
      expect(await world.preferencesOf(user)).toBeUndefined();
      expect(callsFor(key)).toContain('adopt_preferences');
    } finally {
      stop();
    }
    await page.goto(flaky(baseURL!, '/projects'));
    expect(await world.preferencesOf(user)).toEqual(hebrewDark);
    forgetCalls(key);
  });

  test('tries to adopt on a page load only: a client-side navigation does not, and the next page load does', async ({page, context, baseURL}) => {
    const user = await newcomer();
    await signIn(context, baseURL!, user, {theme: 'dark'});
    const key = await accountKey(user);
    forgetCalls(key);
    const stop = startOutage(key, {rpc: ['adopt_preferences']});
    try {
      await page.goto(flaky(baseURL!, '/'));
      await settleHome(page);
      expect(callsFor(key).filter((name) => name === 'adopt_preferences')).toHaveLength(1);
      // A client-side navigation is a request for a page fragment, not a page the person has opened.
      await page.getByRole('link', {name: label('en', 'nav.projects'), exact: true}).first().click();
      await expect(page).toHaveURL(/\/projects$/);
      await expect(page.getByRole('heading', {level: 1})).toBeVisible();
      expect(callsFor(key).filter((name) => name === 'adopt_preferences')).toHaveLength(1);
    } finally {
      stop();
    }
    await page.reload();
    expect(callsFor(key).filter((name) => name === 'adopt_preferences')).toHaveLength(2);
    expect(await world.preferencesOf(user)).toMatchObject({theme: 'dark'});
    // Once it exists it is not asked for again.
    forgetCalls(key);
    await page.reload();
    expect(callsFor(key)).not.toContain('adopt_preferences');
    forgetCalls(key);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a change made signed in is saved to the Account and follows it (AC-7)', () => {
  async function open(page: Page, context: BrowserContext, baseURL: string, preferences: Parameters<typeof signIn>[3] = {}, path = '/settings') {
    const user = await newcomer();
    await signIn(context, baseURL, user, preferences);
    await page.goto(path);
    await (path === '/' ? settleHome(page) : settle(page));
    // The first navigation adopted the device's choices; from here on the record is the Account's.
    expect(await world.preferencesOf(user)).toBeDefined();
    return user;
  }

  test('light or dark: applied at once, announced, saved to the record, copied to the cookie, and still there after a reload', async ({page, context, baseURL}) => {
    const problems = watchForProblems(page);
    const user = await open(page, context, baseURL!);
    await radio(page, 'Dark').check();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(announcer(page)).toHaveText(label('en', 'settings.announce.themeDark'));
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({theme: 'dark'});
    await expect.poll(() => cookieValue(context, 'nova3d-theme')).toBe('dark');
    await expect(radio(page, 'Dark')).toBeChecked();
    // The page asked the server for its own render again, and it agrees with the choice.
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(radio(page, 'Dark')).toBeChecked();

    await radio(page, 'Light').check();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({theme: 'light'});
    expect(problems).toEqual([]);
  });

  test('two choices made in quick succession both stand, and the last one wins, whatever order the server answers in', async ({page, context, baseURL}) => {
    const user = await open(page, context, baseURL!);
    // Hold the first save back so the second is made while it is still on its way.
    let held = false;
    await page.route(
      (url) => url.pathname === '/settings',
      async (route) => {
        if (route.request().method() === 'POST' && !held) {
          held = true;
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        await route.continue();
      },
    );
    await radio(page, 'Dark').check();
    await radio(page, 'Technical').check();
    await radio(page, 'Light').check();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => world.preferencesOf(user), {timeout: 10_000}).toEqual({...defaults, detail: 'technical'});
    // The page agrees with the record once every save is done, and stays that way.
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(radio(page, 'Technical')).toBeChecked();
    await expect(radio(page, 'Light')).toBeChecked();
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(radio(page, 'Technical')).toBeChecked();
  });

  test('while saves are still on their way, and a render made before them is late, the page never goes back to an older choice: every value it shows is recorded', async ({page, context, baseURL}) => {
    const user = await open(page, context, baseURL!);
    // The page asks the server for its own render after a save. Make the answer to the FIRST such request late: the
    // server renders it at once, with the record as it is then (only the first choice), and the browser gets it while
    // the saves of the choices made after it are still on their way. A page that took that render as the truth would
    // show the older choices again until its own refresh arrived.
    //
    // What this does and does not prove. It proves the end-to-end behaviour: whatever the router and the provider do
    // between them, nothing the page shows goes back. It cannot, today, fail by removing the provider's own guard
    // (`adoptServerRender`, lib/preferences.ts, unit-tested to fail without it): Next.js 16.3.5 itself drops a refresh
    // render that a later Server Action supersedes, so the late render below never reaches the provider as new props
    // (checked by logging the provider's renders with the guard deleted, in a scratch copy only).
    const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let saves = 0;
    let renders = 0;
    let lateRenderAsked!: () => void;
    const lateRender = new Promise<void>((resolve) => { lateRenderAsked = resolve; });
    await page.route(
      (url) => url.pathname === '/settings',
      async (route) => {
        const request = route.request();
        if (request.method() === 'POST') {
          saves += 1;
          // The first save is quick; the ones after it take long enough to be still on their way when the late render arrives.
          if (saves > 1) await wait(2500);
          return route.continue();
        }
        if (new URL(request.url()).searchParams.has('_rsc')) {
          renders += 1;
          if (renders > 1) return route.continue();
          // Rendered now, by the server, with the record as it is now; handed to the browser a moment later.
          const response = await route.fetch();
          lateRenderAsked();
          await wait(1500);
          return route.fulfill({response});
        }
        return route.continue();
      },
    );
    // A recorder in the page: every value of <html data-theme>, <html lang> and of the checked radio of each group,
    // in the order the page showed them, taken at every change of the document and at every frame.
    await page.evaluate(() => {
      const checked = (group: string) => document.querySelector<HTMLInputElement>(`input[name="${group}"]:checked`)?.value ?? null;
      const seen: Record<string, (string | null)[]> = {theme: [], lang: [], themeRadio: [], languageRadio: [], detailRadio: []};
      const note = (key: string, value: string | null) => {
        if (seen[key][seen[key].length - 1] !== value) seen[key].push(value);
      };
      const sample = () => {
        note('theme', document.documentElement.getAttribute('data-theme'));
        note('lang', document.documentElement.getAttribute('lang'));
        note('themeRadio', checked('theme'));
        note('languageRadio', checked('language'));
        note('detailRadio', checked('detail'));
      };
      sample();
      new MutationObserver(sample).observe(document.documentElement, {attributes: true, childList: true, subtree: true, characterData: true});
      const frame = () => {
        sample();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      (window as unknown as {__seen: typeof seen}).__seen = seen;
    });

    // The first choice, saved at once: its render is the late one. Wait until the server has made it (with the record
    // that holds only this choice), so the choices after it are made while it is on its way.
    await page.locator('input[name="theme"][value="dark"]').check();
    await lateRender;
    expect(await world.preferencesOf(user)).toMatchObject({theme: 'dark', locale: null, detail: 'simple'});
    // Two more, in quick succession, while that render is still on its way and their saves are not done.
    await page.locator('input[name="language"][value="he"]').check();
    await page.locator('input[name="detail"][value="technical"]').check();
    await expect.poll(() => world.preferencesOf(user), {timeout: 20_000}).toEqual({locale: 'he', theme: 'dark', detail: 'technical', guidance: 'shown'});
    // ... and a moment more, for the renders that follow the last save.
    await page.waitForTimeout(1500);
    expect(renders, 'the late render really was asked for and answered').toBeGreaterThanOrEqual(1);

    const seen = await page.evaluate(() => (window as unknown as {__seen: Record<string, (string | null)[]>}).__seen);
    // Each value appears once, in the order of the choices: never an older one again.
    expect(seen).toEqual({
      theme: ['light', 'dark'],
      lang: ['en', 'he'],
      themeRadio: ['light', 'dark'],
      languageRadio: ['device', 'he'],
      detailRadio: ['simple', 'technical'],
    });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(html(page)).toHaveAttribute('lang', 'he');
  });

  test('language: Hebrew mirrors the page, is saved, and "Match my device" saves no language and hands the choice back', async ({page, context, baseURL}) => {
    const user = await open(page, context, baseURL!);
    await radio(page, 'עברית').check();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await expect(announcer(page)).toHaveText(label('he', 'settings.announce.language', {language: 'עברית'}));
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({locale: 'he'});
    await expect.poll(() => cookieValue(context, 'nova3d-locale')).toBe('he');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('he', 'settings.title'));
    await page.reload();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(radio(page, 'עברית')).toBeChecked();

    // "Match my device": this browser asks for English.
    await radio(page, label('he', 'settings.language.device')).check();
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(html(page)).toHaveAttribute('dir', 'ltr');
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({locale: null});
    await expect.poll(() => cookieValue(context, 'nova3d-locale')).toBeUndefined();
    await page.reload();
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(radio(page, /Match my device/)).toBeChecked();
  });

  test('explanation detail is saved too, and changes nothing else', async ({page, context, baseURL}) => {
    const user = await open(page, context, baseURL!);
    await radio(page, 'Technical').check();
    await expect(announcer(page)).toHaveText(label('en', 'settings.announce.detailTechnical'));
    await expect.poll(() => world.preferencesOf(user)).toEqual({...defaults, detail: 'technical'});
    await page.reload();
    await expect(radio(page, 'Technical')).toBeChecked();
  });

  test('the first-use introduction: dismissed on Home it is saved, stays dismissed on a new device, and Replay in Settings brings it back', async ({page, context, browser, baseURL}) => {
    const user = await open(page, context, baseURL!, {}, '/');
    const guidance = page.locator('[data-guidance]');
    await expect(guidance).toBeVisible();
    await guidance.getByRole('button', {name: label('en', 'guidance.dismiss')}).click();
    await expect(guidance).toHaveCount(0);
    await expect(announcer(page)).toHaveText(label('en', 'guidance.dismissed'));
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({guidance: 'dismissed'});

    const other = await secondDevice(browser, baseURL!, user);
    await other.page.goto('/');
    await expect(other.page.getByRole('heading', {level: 1})).toBeVisible();
    await expect(other.page.locator('[data-guidance]')).toHaveCount(0);

    await page.goto('/settings');
    await settle(page);
    await page.getByRole('button', {name: label('en', 'settings.guidance.replay')}).click();
    await expect(announcer(page)).toHaveText(label('en', 'settings.announce.guidance'));
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({guidance: 'shown'});
    await other.page.reload();
    await expect(other.page.locator('[data-guidance]')).toBeVisible();
    await other.context.close();
  });

  test('a browser that refuses cookies still saves the choice: the Account holds it (cookies refused, signed in)', async ({page, context, baseURL}) => {
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
      Object.defineProperty(Document.prototype, 'cookie', {configurable: true, get: descriptor.get, set: () => undefined});
    });
    const user = await open(page, context, baseURL!);
    await radio(page, 'Dark').check();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(announcer(page)).toHaveText(label('en', 'settings.announce.themeDark'));
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({theme: 'dark'});
    await expect(page.locator('[data-preference-notice]')).toHaveCount(0);
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  });

  test('a change made on another device shows on this one\'s next page load, not before: nothing polls or pushes', async ({page, context, browser, baseURL}) => {
    const user = await open(page, context, baseURL!, {}, '/');
    const other = await secondDevice(browser, baseURL!, user);
    await other.page.goto('/settings');
    await settle(other.page);
    await radio(other.page, 'Dark').check();
    await radio(other.page, 'עברית').check();
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({theme: 'dark', locale: 'he'});

    // This tab does not hear about it by itself.
    await page.waitForTimeout(1500);
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(html(page)).toHaveAttribute('lang', 'en');
    // The next page load does.
    await page.goto('/projects');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    // ... and the cookies of this device were not rewritten to say so.
    expect(await cookieValue(context, 'nova3d-theme')).toBeUndefined();
    await other.context.close();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a change that cannot be saved is undone, announced and stores nothing (AC-7)', () => {
  async function onTheFlakyServer(page: Page, context: BrowserContext, baseURL: string, path = '/settings') {
    const user = await newcomer();
    await world.adoptPreferencesFor(user, {locale: null, theme: 'light', detail: 'simple', guidance: 'shown'});
    await signIn(context, baseURL, user);
    await page.goto(flaky(baseURL, path));
    await (path === '/' ? settleHome(page) : settle(page));
    return user;
  }
  /** Holds every Server Action post on the page back for a moment, so the choice can be seen before the save answers. */
  const slowSaves = (page: Page, milliseconds = 900) =>
    page.route(
      (url) => url.pathname === '/settings',
      async (route) => {
        if (route.request().method() === 'POST') await new Promise((resolve) => setTimeout(resolve, milliseconds));
        await route.continue();
      },
    );

  test('light or dark: shown at once, then undone with the reason in the live region and in words, and nothing stored', async ({page, context, baseURL}) => {
    const user = await onTheFlakyServer(page, context, baseURL!);
    const stop = startOutage(await accountKey(user), {rpc: ['set_preference']});
    await slowSaves(page);
    try {
      await radio(page, 'Dark').check();
      // At once: the page does not wait for the save.
      await expect(html(page)).toHaveAttribute('data-theme', 'dark');
      await expect(radio(page, 'Dark')).toBeChecked();
      // Then undone.
      await expect(html(page)).toHaveAttribute('data-theme', 'light', {timeout: 10_000});
      await expect(radio(page, 'Light')).toBeChecked();
      await expect(announcer(page)).toHaveText(label('en', 'settings.announce.saveFailed'));
      const notice = page.locator('[data-preference-notice]');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText(label('en', 'settings.announce.saveFailed'));
      // Nothing is stored: not in the record, not in the cookie copy.
      expect(await world.preferencesOf(user)).toEqual(defaults);
      expect(await cookieValue(context, 'nova3d-theme')).toBeUndefined();
    } finally {
      stop();
    }
  });

  test('the words can be put away, and the next change that is saved clears them too', async ({page, context, baseURL}) => {
    const user = await onTheFlakyServer(page, context, baseURL!);
    const stop = startOutage(await accountKey(user), {rpc: ['set_preference']});
    const notice = page.locator('[data-preference-notice]');
    await radio(page, 'Technical').check();
    await expect(notice).toBeVisible({timeout: 10_000});
    await expect(radio(page, 'Simple')).toBeChecked();
    await notice.getByRole('button', {name: label('en', 'notice.dismiss')}).click();
    await expect(notice).toHaveCount(0);

    await radio(page, 'Technical').check();
    await expect(notice).toBeVisible({timeout: 10_000});
    stop();
    await radio(page, 'Technical').check();
    await expect(notice).toHaveCount(0, {timeout: 10_000});
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({detail: 'technical'});
    await expect(radio(page, 'Technical')).toBeChecked();
  });

  test('a language that cannot be saved goes back to the earlier language, direction included, and says so in that language', async ({page, context, baseURL}) => {
    const user = await onTheFlakyServer(page, context, baseURL!);
    const stop = startOutage(await accountKey(user), {rpc: ['set_preference']});
    await radio(page, 'עברית').check();
    await expect(announcer(page)).toHaveText(label('en', 'settings.announce.saveFailed'), {timeout: 10_000});
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(html(page)).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('en', 'settings.title'));
    expect((await world.preferencesOf(user))?.locale).toBeNull();
    expect(await cookieValue(context, 'nova3d-locale')).toBeUndefined();
    stop();
  });

  test('the introduction that could not be dismissed on Home comes back, and is said to', async ({page, context, baseURL}) => {
    const user = await onTheFlakyServer(page, context, baseURL!, '/');
    const stop = startOutage(await accountKey(user), {rpc: ['set_preference']});
    const guidance = page.locator('[data-guidance]');
    await guidance.getByRole('button', {name: label('en', 'guidance.dismiss')}).click();
    await expect(page.locator('[data-preference-notice]')).toBeVisible({timeout: 10_000});
    await expect(guidance).toBeVisible();
    expect((await world.preferencesOf(user))?.guidance).toBe('shown');
    stop();
  });

  test('the failure is read the same when the database answers with an error', async ({page, context, baseURL}) => {
    const user = await onTheFlakyServer(page, context, baseURL!);
    const stop = startOutage(await accountKey(user), {rpc: ['set_preference'], mode: 'error'});
    await radio(page, 'Dark').check();
    await expect(page.locator('[data-preference-notice]')).toBeVisible({timeout: 10_000});
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    expect((await world.preferencesOf(user))?.theme).toBe('light');
    stop();
    endOutage(await accountKey(user));
  });

  for (const variant of [variants[0], variants[3]]) {
    test(`the notice has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
      const user = await newcomer();
      await world.adoptPreferencesFor(user, {locale: variant.locale === 'he' ? 'he' : 'en', theme: variant.theme});
      await signIn(context, baseURL!, user);
      await page.goto(flaky(baseURL!, '/settings'));
      await settle(page);
      const stop = startOutage(await accountKey(user), {rpc: ['set_preference']});
      await radio(page, label(variant.locale, 'settings.detail.technical')).check();
      await expect(page.locator('[data-preference-notice]')).toBeVisible({timeout: 10_000});
      expect(await violations(page)).toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      stop();
    });
  }
});

// ---------------------------------------------------------------------------------------------------
test.describe('the sign-in page offers English or Hebrew and light or dark (AC-7)', () => {
  async function openSignIn(page: Page) {
    await page.goto('/login');
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    await hydrated(page, 'input[type="radio"]');
  }

  test('offers exactly two radio groups and still one button', async ({page}) => {
    await openSignIn(page);
    await expect(page.getByRole('group', {name: label('en', 'login.prefs.title')})).toBeVisible();
    await expect(page.getByRole('radiogroup')).toHaveCount(2);
    await expect(radio(page, 'English')).toBeChecked();
    await expect(radio(page, 'עברית')).not.toBeChecked();
    await expect(radio(page, 'Light')).toBeChecked();
    await expect(page.getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('Hebrew applies at once, mirrors the page, is announced in Hebrew, and is a cookie and nothing else', async ({page, context}) => {
    await openSignIn(page);
    await radio(page, 'עברית').check();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('he', 'login.title'));
    await expect(announcer(page)).toHaveText(label('he', 'settings.announce.language', {language: 'עברית'}));
    await expect(announcer(page)).toHaveAttribute('lang', 'he');
    expect(await cookieValue(context, 'nova3d-locale')).toBe('he');
    await page.reload();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(radio(page, 'עברית')).toBeChecked();
    await expect(page).toHaveTitle(new RegExp(label('he', 'meta.login')));
  });

  test('dark applies at once, is announced, and is a cookie and nothing else', async ({page, context}) => {
    await openSignIn(page);
    await radio(page, 'Dark').check();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(announcer(page)).toHaveText(label('en', 'settings.announce.themeDark'));
    expect(await cookieValue(context, 'nova3d-theme')).toBe('dark');
    await radio(page, 'Light').check();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(announcer(page)).toHaveText(label('en', 'settings.announce.themeLight'));
  });

  test('a browser that refuses cookies is told, and the page does not pretend a choice stuck', async ({page}) => {
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!;
      Object.defineProperty(Document.prototype, 'cookie', {configurable: true, get: descriptor.get, set: () => undefined});
    });
    await openSignIn(page);
    await radio(page, 'Dark').click();
    await expect(announcer(page)).toHaveText(label('en', 'settings.announce.failed'));
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await radio(page, 'עברית').click();
    await expect(html(page)).toHaveAttribute('lang', 'en');
  });

  test('the arrow keys move the choice inside a group and apply it', async ({page}) => {
    await openSignIn(page);
    await radio(page, 'Light').focus();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'Dark')).toBeChecked();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await radio(page, 'English').focus();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'עברית')).toBeChecked();
    await expect(html(page)).toHaveAttribute('lang', 'he');
  });

  test('keeps right to left order in Hebrew: the first language is at the start, which is the right', async ({page, context, baseURL}) => {
    await context.addCookies([{name: 'nova3d-locale', value: 'he', url: baseURL!}]);
    await openSignIn(page);
    const [english, hebrew] = [(await radio(page, 'English').locator('xpath=..').boundingBox())!, (await radio(page, 'עברית').locator('xpath=..').boundingBox())!];
    const viewport = page.viewportSize()!;
    // Side by side while there is room (a phone is 412 wide), the first at the right; stacked on a very narrow screen.
    if (Math.abs(english.y - hebrew.y) < 4) expect(english.x).toBeGreaterThan(hebrew.x);
    else expect(Math.abs(english.x - hebrew.x)).toBeLessThan(viewport.width);
    expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
  });

  for (const variant of variants) {
    test(`has no accessibility violations, with the choices in it: ${variant.name}`, async ({page, context, baseURL}) => {
      await context.addCookies([{name: 'nova3d-locale', value: variant.locale, url: baseURL!}, {name: 'nova3d-theme', value: variant.theme, url: baseURL!}]);
      await openSignIn(page);
      await expect(radio(page, variant.locale === 'he' ? 'עברית' : 'English')).toBeChecked();
      expect(await violations(page)).toEqual([]);
      // And with an error showing and the focus in a group.
      await radio(page, variant.locale === 'he' ? 'עברית' : 'English').focus();
      expect(await violations(page)).toEqual([]);
    });
  }

  test('reflows with 200% text and at 320 px, in Hebrew and dark', async ({page, context, baseURL, browserName}) => {
    test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
    await context.addCookies([{name: 'nova3d-locale', value: 'he', url: baseURL!}, {name: 'nova3d-theme', value: 'dark', url: baseURL!}]);
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    await openSignIn(page);
    expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    for (const control of [radio(page, 'English'), radio(page, 'עברית'), radio(page, label('he', 'settings.theme.light')), radio(page, label('he', 'settings.theme.dark'))]) {
      const box = (await control.locator('xpath=..').boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
  });

  test('a choice made here is adopted at the first sign-in, and the Account keeps it', async ({browser, baseURL}) => {
    const user = await newcomer();
    const context = await browser.newContext({baseURL});
    const page = await context.newPage();
    await openSignIn(page);
    await radio(page, 'Dark').check();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await radio(page, 'עברית').check();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(announcer(page)).toHaveText(label('he', 'settings.announce.language', {language: 'עברית'}));
    expect(await world.preferencesOf(user)).toBeUndefined();
    // Signing in is a session arriving; the first page after it adopts what this device chose.
    await signIn(context, baseURL!, user);
    await page.goto('/');
    expect(await world.preferencesOf(user)).toEqual({locale: 'he', theme: 'dark', detail: 'simple', guidance: 'shown'});
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await context.close();
  });

  test('is ignored once the Account has a record: the record wins on the next page after signing in', async ({browser, baseURL}) => {
    const user = await newcomer();
    await world.adoptPreferencesFor(user, {locale: 'en', theme: 'light', detail: 'technical'});
    const context = await browser.newContext({baseURL});
    const page = await context.newPage();
    await openSignIn(page);
    await radio(page, 'Dark').check();
    await radio(page, 'עברית').check();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await signIn(context, baseURL!, user);
    await page.goto('/');
    await expect(html(page)).toHaveAttribute('lang', 'en');
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    expect(await world.preferencesOf(user)).toEqual({locale: 'en', theme: 'light', detail: 'technical', guidance: 'shown'});
    await context.close();
  });

  test('a visitor who holds an active session and opens it changes the Account, not only the device (the page is rendered for their Account)', async ({page, context, baseURL}) => {
    const user = await newcomer();
    await world.adoptPreferencesFor(user, {locale: 'en', theme: 'light'});
    await signIn(context, baseURL!, user);
    await openSignIn(page);
    await radio(page, 'עברית').check();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({locale: 'he'});
    await radio(page, label('he', 'settings.theme.dark')).check();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => world.preferencesOf(user)).toEqual({locale: 'he', theme: 'dark', detail: 'simple', guidance: 'shown'});
    // The cookie copy follows, so the page reads the same after signing out.
    await expect.poll(() => cookieValue(context, 'nova3d-locale')).toBe('he');
    await page.reload();
    await expect(html(page)).toHaveAttribute('lang', 'he');
    await expect(radio(page, 'עברית')).toBeChecked();
  });

  test('... and when the save fails for that visitor, the choice is undone and the notice shows on the sign-in page', async ({page, context, baseURL}) => {
    const user = await newcomer();
    await world.adoptPreferencesFor(user, {locale: 'en', theme: 'light'});
    await signIn(context, baseURL!, user);
    await page.goto(flaky(baseURL!, '/login'));
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    await hydrated(page, 'input[type="radio"]');
    const stop = startOutage(await accountKey(user), {rpc: ['set_preference']});
    try {
      await radio(page, 'Dark').check();
      const notice = page.locator('[data-preference-notice]');
      await expect(notice).toBeVisible({timeout: 10_000});
      await expect(notice).toContainText(label('en', 'settings.announce.saveFailed'));
      await expect(notice).toHaveAttribute('aria-label', label('en', 'settings.saveFailed.title'));
      await expect(announcer(page)).toHaveText(label('en', 'settings.announce.saveFailed'));
      // Undone, and stored nowhere: not in the record, not in the cookie.
      await expect(html(page)).toHaveAttribute('data-theme', 'light');
      await expect(radio(page, 'Light')).toBeChecked();
      expect((await world.preferencesOf(user))?.theme).toBe('light');
      expect(await cookieValue(context, 'nova3d-theme')).toBeUndefined();
      // It is a landmark on a page with no shell, and the page is still usable.
      expect(await violations(page)).toEqual([]);
      await expect(page.getByRole('main')).toHaveCount(1);
      // Putting it away moves focus to the page content instead of dropping it.
      await notice.getByRole('button', {name: label('en', 'notice.dismiss')}).focus();
      await page.keyboard.press('Enter');
      await expect(notice).toHaveCount(0);
      await expect(page.locator('main')).toBeFocused();
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the record is the Account\'s own', () => {
  test('two Accounts on one browser profile each see their own, never the other\'s', async ({browser, baseURL}) => {
    const [first, second] = [await newcomer(), await newcomer()];
    await world.adoptPreferencesFor(first, hebrewDark);
    await world.adoptPreferencesFor(second, {locale: 'en', theme: 'light'});
    const [one, two] = [await browser.newContext({baseURL}), await browser.newContext({baseURL})];
    await signIn(one, baseURL!, first);
    await signIn(two, baseURL!, second);
    const [pageOne, pageTwo] = [await one.newPage(), await two.newPage()];
    await pageOne.goto('/');
    await pageTwo.goto('/');
    await expect(html(pageOne)).toHaveAttribute('lang', 'he');
    await expect(html(pageTwo)).toHaveAttribute('lang', 'en');
    await expect(html(pageOne)).toHaveAttribute('data-theme', 'dark');
    await expect(html(pageTwo)).toHaveAttribute('data-theme', 'light');
    await one.close();
    await two.close();
  });

  test('a disabled Account is turned away before a preference can be changed, and its record is unchanged', async ({page, context, baseURL}) => {
    const user = await newcomer();
    await world.adoptPreferencesFor(user, {locale: 'en', theme: 'light'});
    await signIn(context, baseURL!, user);
    await page.goto('/settings');
    await settle(page);
    await world.setStatus(user, 'disabled');
    await radio(page, 'Dark').check();
    // The save is refused as a request from a session that no longer has access: the page is loaded again and the
    // person lands on sign-in (a page prefetch may already have ended the session, which reads "not signed in").
    await expect(page).toHaveURL(/\/login\?error=(?:account_disabled|not_signed_in)$/, {timeout: 15_000});
    expect(await world.preferencesOf(user)).toMatchObject({theme: 'light'});
  });

  for (const locale of ['en', 'he'] as Locale[]) {
    test(`the Settings page says the choices belong to the account (${locale})`, async ({page, context, baseURL}) => {
      const user = await newcomer();
      await signIn(context, baseURL!, user, {locale});
      await page.goto('/settings');
      await expect(page.locator('.lede')).toHaveText(label(locale, 'settings.lede'));
    });
  }
});
