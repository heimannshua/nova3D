import {randomBytes} from 'node:crypto';
import {expect, test, type Page} from '@playwright/test';
import type {Locale} from '../../lib/i18n';
import {alertOf, label, mainNav, overflow, signIn, violations, watchForProblems} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';

// Story 1.3 Part B: registration and live-Account gating, in a real browser against the production build
// and the local Supabase stack. Local Google sign-in cannot be driven, so each test forges a session
// (tests/support/forged-session.ts): a Google user and an Auth session row exist, a token signed with the
// stack's JWT secret is set as the @supabase/ssr cookie, and Auth still validates it, so the application's
// own getUser(), proxy and Account checks all run. Every flow runs on `desktop` and `phone`.
//
// The registration limiter (5 failures per origin per 15 minutes) counts every browser as one origin
// here, so the file runs in order, each test starts from a clean limiter, and no test fails more than one
// attempt.

test.describe.configure({mode: 'serial'});

const unknownCode = 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ';

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});
test.beforeEach(async () => {
  await world.resetLimiter();
});

const commandId = (page: Page) => page.locator('input[name="commandId"]').inputValue();
const codeField = (page: Page, locale: Locale) => page.getByRole('textbox', {name: label(locale, 'register.code.label'), exact: true});
const submitButton = (page: Page, locale: Locale) => page.getByRole('button', {name: label(locale, 'register.submit')});

async function register(page: Page, locale: Locale, code: string) {
  await codeField(page, locale).fill(code);
  await submitButton(page, locale).click();
}

test.describe('signed out', () => {
  test('/register is a private page: it goes to sign-in', async ({page}) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/login\?error=not_signed_in$/);
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  });
});

for (const locale of ['en', 'he'] as const) {
  test.describe(`a Google identity without an Account (${locale})`, () => {
    test('reaches only the registration screen, from every private path', async ({page, context, baseURL}) => {
      const stranger = await world.signedInUser();
      await signIn(context, baseURL!, stranger, {locale});
      for (const path of ['/', '/projects', '/progress', '/settings', '/projects/anything', '/no-such-page']) {
        await page.goto(path);
        await expect(page, path).toHaveURL(/\/register$/);
        await expect(page.getByRole('heading', {level: 1}), path).toHaveText(label(locale, 'register.title'));
      }
      expect(await world.accountOf(stranger)).toBeUndefined();
    });

    test('shows the registration screen without the shell, in the right language and direction', async ({page, context, baseURL}) => {
      const email = `someone.long.address.${randomBytes(4).toString('hex')}@example.test`;
      const stranger = await world.signedInUser({email});
      await signIn(context, baseURL!, stranger, {locale});
      await page.goto('/register');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
      await expect(page).toHaveTitle(new RegExp(`^${label(locale, 'meta.register')}`));
      await expect(page.getByRole('heading', {level: 1})).toHaveText(label(locale, 'register.title'));
      await expect(page.getByRole('note')).toContainText(label(locale, 'register.operator'));
      await expect(page.getByText(email)).toBeVisible();
      await expect(codeField(page, locale)).toBeVisible();
      await expect(submitButton(page, locale)).toBeVisible();
      await expect(page.getByRole('button', {name: label(locale, 'register.switch')})).toBeVisible();
      // No shell: no navigation, no menus, no way into the workspace.
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(page.getByRole('button', {name: label(locale, 'nav.account'), exact: true})).toHaveCount(0);
      await expect(page.getByRole('link', {name: label(locale, 'nav.settings'), exact: true})).toHaveCount(0);
      // The code reads left to right in either language.
      await expect(codeField(page, locale)).toHaveAttribute('dir', 'ltr');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });

    test('fits the screen with enlarged text, and its controls are comfortable touch targets', async ({page, context, baseURL}) => {
      const stranger = await world.signedInUser();
      await signIn(context, baseURL!, stranger, {locale});
      await page.goto('/register');
      const session = await context.newCDPSession(page);
      await session.send('Page.setFontSizes', {fontSizes: {standard: 28, fixed: 28}});
      await page.reload();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      for (const control of [codeField(page, locale), submitButton(page, locale), page.getByRole('button', {name: label(locale, 'register.switch')})]) {
        await control.scrollIntoViewIfNeeded();
        const box = (await control.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        const viewport = page.viewportSize()!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      }
    });

    for (const theme of ['light', 'dark'] as const) {
      test(`has no accessibility violations: ${theme}`, async ({page, context, baseURL}) => {
        const stranger = await world.signedInUser();
        await signIn(context, baseURL!, stranger, {locale, theme});
        await page.goto('/register');
        await expect(page.getByRole('heading', {level: 1})).toBeVisible();
        expect(await violations(page), 'the form').toEqual([]);
        // And with the failure showing, which adds a live region and marks the field invalid.
        await register(page, locale, unknownCode);
        await expect(alertOf(page)).toContainText(label(locale, 'register.error.refused'));
        expect(await violations(page), 'after a refused code').toEqual([]);
      });
    }

    test('answers a bad code with one generic message, clears the field, mints a new command ID and creates nothing', async ({page, context, baseURL}) => {
      const stranger = await world.signedInUser();
      await signIn(context, baseURL!, stranger, {locale});
      const problems = watchForProblems(page);
      await page.goto('/register');
      const first = await commandId(page);
      expect(first).toMatch(/^[0-9a-f-]{36}$/);
      await register(page, locale, unknownCode);
      const alert = alertOf(page);
      await expect(alert).toHaveText(label(locale, 'register.error.refused'));
      await expect(page).toHaveURL(/\/register$/);
      await expect(codeField(page, locale)).toHaveValue('');
      await expect(codeField(page, locale)).toBeFocused();
      await expect(codeField(page, locale)).toHaveAttribute('aria-invalid', 'true');
      // A definitive answer: the next attempt is a new command.
      expect(await commandId(page)).not.toBe(first);
      // The code is nowhere in the page after the answer.
      expect(await page.content()).not.toContain(unknownCode);
      expect(await world.accountOf(stranger)).toBeUndefined();
      expect(await world.workspacesOf(stranger)).toBe(0);
      expect(problems).toEqual([]);
    });
  });
}

test.describe('registering with a code', () => {
  test('creates one Account and Workspace and lands on Home; the same code then cannot be used again', async ({page, context, browser, baseURL}) => {
    const person = await world.signedInUser();
    const {code, invitationId} = await world.issueCode('Registration e2e');
    await signIn(context, baseURL!, person);
    const problems = watchForProblems(page);
    await page.goto('/register');
    const sent = await commandId(page);
    await register(page, 'en', code);

    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(mainNav(page, 'en')).toBeVisible();
    expect(problems).toEqual([]);
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();

    const account = await world.accountOf(person);
    expect(account).toMatchObject({status: 'active', role: 'member', google_subject: person.subject, source: 'invitation'});
    expect(await world.workspacesOf(person)).toBe(1);
    expect(await world.invitationStatus(invitationId)).toBe('redeemed');
    expect(await world.commandsOf(person)).toEqual([sent]);
    // Registering issued the grant of this session, so the person is let in at once and no second grant exists.
    expect(await world.grantsOf(person)).toEqual([person.sessionId]);
    expect(await world.auditEvents('session.issued', `session:${person.sessionId}`)).toHaveLength(1);

    // /register is for strangers: an Account goes Home.
    await page.goto('/register');
    await expect(page).toHaveURL(`${baseURL}/`);

    // Someone else, with the same code now used, gets the same generic answer as for a wrong code.
    const other = await world.signedInUser();
    const second = await browser.newContext({baseURL});
    await signIn(second, baseURL!, other);
    const otherPage = await second.newPage();
    await otherPage.goto('/register');
    await register(otherPage, 'en', code);
    await expect(alertOf(otherPage)).toHaveText(label('en', 'register.error.refused'));
    expect(await world.accountOf(other)).toBeUndefined();
    await second.close();
  });

  test('answers a revoked code like any other bad one, and registers no one', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    const {code, invitationId} = await world.issueCode('Revoked before use');
    await world.revokeCode(invitationId);
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    await register(page, 'en', code);
    await expect(alertOf(page)).toHaveText(label('en', 'register.error.refused'));
    expect(await world.accountOf(person)).toBeUndefined();
    expect(await world.invitationStatus(invitationId)).toBe('revoked');
  });

  test('accepts the code however it is typed: lower case, spaces, no dashes', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    const {code} = await world.issueCode('Typed loosely');
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    await register(page, 'en', ` ${code.toLowerCase().replaceAll('-', ' ')} `);
    await expect(page).toHaveURL(`${baseURL}/`);
    expect((await world.accountOf(person)).status).toBe('active');
  });

  test('registers in Hebrew too, and lands on a right-to-left Home', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    const {code} = await world.issueCode('Hebrew e2e');
    await signIn(context, baseURL!, person, {locale: 'he'});
    await page.goto('/register');
    await register(page, 'he', code);
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(mainNav(page, 'he')).toBeVisible();
    expect((await world.accountOf(person)).status).toBe('active');
  });

  test('keeps the command ID and the typed code when the outcome is unknown, and retries the same command', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    const {code} = await world.issueCode('Retry e2e');
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    const sent = await commandId(page);

    // The request never reaches the server: the attempt's outcome is unknown.
    await page.route('**/register', (route) => (route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue()));
    await register(page, 'en', code);
    await expect(alertOf(page)).toHaveText(label('en', 'register.error.unavailable'));
    expect(await commandId(page)).toBe(sent);
    await expect(codeField(page, 'en')).toHaveValue(code);
    expect(await world.accountOf(person)).toBeUndefined();

    // The network is back: the same command, the same code.
    await page.unroute('**/register');
    await submitButton(page, 'en').click();
    await expect(page).toHaveURL(`${baseURL}/`);
    expect(await world.commandsOf(person)).toEqual([sent]);
    expect((await world.accountOf(person)).status).toBe('active');
  });

  test('"use a different Google account" ends the session and returns to sign-in', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    await page.getByRole('button', {name: label('en', 'register.switch')}).click();
    await expect(page).toHaveURL(`${baseURL}/login`);
    await expect(page.getByRole('button', {name: label('en', 'login.google')})).toBeVisible();
    expect((await context.cookies()).filter((cookie) => cookie.name === person.cookie.name && cookie.value !== '')).toEqual([]);
    expect(await world.sessionExists(person.sessionId)).toBe(false);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?error=not_signed_in$/);
  });
});

test.describe('a form left open while things changed', () => {
  // The proxy answers a Server Action with a redirect when the person is no longer who the form was for.
  // The client cannot read that as the action's answer, so the form goes to /register and the proxy sends
  // the person where they belong, with that place's own message.
  test('a signed-out submission lands on sign-in with its message, and registers no one', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    await codeField(page, 'en').fill(unknownCode);
    await context.clearCookies();
    await submitButton(page, 'en').click();
    await expect(page).toHaveURL(`${baseURL}/login?error=not_signed_in`);
    await expect(alertOf(page)).toHaveText(label('en', 'login.error.not_signed_in'));
    expect(await world.accountOf(person)).toBeUndefined();
  });

  test('a submission after the Account was disabled lands on sign-in saying so, signed out', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person, {locale: 'he'});
    await page.goto('/register');
    await world.activate(person);
    await world.setStatus(person, 'disabled');
    await register(page, 'he', unknownCode);
    await expect(page).toHaveURL(`${baseURL}/login?error=account_disabled`);
    await expect(alertOf(page)).toHaveText(label('he', 'login.error.account_disabled'));
    expect((await context.cookies()).filter((cookie) => cookie.name === person.cookie.name && cookie.value !== '')).toEqual([]);
    expect(await world.sessionExists(person.sessionId)).toBe(false);
  });

  test('a submission after the Account already exists lands on Home, without redeeming the code', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    const {code, invitationId} = await world.issueCode('Unused when the Account already exists');
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    await world.activate(person);
    await register(page, 'en', code);
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(mainNav(page, 'en')).toBeVisible();
    expect(await world.invitationStatus(invitationId)).toBe('unused');
    expect(await world.commandsOf(person)).toHaveLength(1);
  });

  test('"use a different Google account" with the session already gone still ends at sign-in', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    await context.clearCookies();
    await page.getByRole('button', {name: label('en', 'register.switch')}).click();
    await expect(page).toHaveURL(`${baseURL}/login`);
    await expect(page.getByRole('button', {name: label('en', 'login.google')})).toBeVisible();
  });

  test('a code edited after an attempt of unknown outcome is a new command', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    const {code} = await world.issueCode('Edited after a dropped connection');
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    const first = await commandId(page);
    await page.route('**/register', (route) => (route.request().method() === 'POST' ? route.abort('connectionreset') : route.continue()));
    await register(page, 'en', unknownCode);
    await expect(alertOf(page)).toHaveText(label('en', 'register.error.unavailable'));
    expect(await commandId(page)).toBe(first);
    await expect(codeField(page, 'en')).toHaveValue(unknownCode);
    // The person notices the typo and sends a different code: not the same command any more.
    await page.unroute('**/register');
    await codeField(page, 'en').fill(code);
    await submitButton(page, 'en').click();
    await expect(page).toHaveURL(`${baseURL}/`);
    const commands = await world.commandsOf(person);
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toBe(first);
  });
});

test.describe('the form while it works (English and Hebrew)', () => {
  for (const locale of ['en', 'he'] as const) {
    test(`answers a blank field itself, in ${locale}, without a request, and focuses the field`, async ({page, context, baseURL}) => {
      const person = await world.signedInUser();
      await signIn(context, baseURL!, person, {locale});
      await page.goto('/register');
      const posts: string[] = [];
      page.on('request', (request) => request.method() === 'POST' && posts.push(request.url()));
      const first = await commandId(page);
      await submitButton(page, locale).click();
      await expect(alertOf(page)).toHaveText(label(locale, 'register.error.empty'));
      await expect(codeField(page, locale)).toBeFocused();
      await expect(codeField(page, locale)).toHaveAttribute('aria-invalid', 'true');
      // Whitespace is blank too, nothing was sent or counted, and the message is announced afresh (a new alert, not the old one).
      const firstAlert = await alertOf(page).elementHandle();
      await codeField(page, locale).fill('   ');
      await submitButton(page, locale).click();
      await expect(alertOf(page)).toHaveText(label(locale, 'register.error.empty'));
      await expect.poll(() => firstAlert!.evaluate((node) => node.isConnected)).toBe(false);
      expect(posts).toEqual([]);
      expect(await commandId(page)).toBe(first);
      expect(await violations(page)).toEqual([]);
    });
  }

  test('describes the field by its hint and, after a failure, by the error too; announces every failure afresh; clears the error while a new attempt runs', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    const field = codeField(page, 'en');
    await expect(field).toHaveAttribute('aria-describedby', 'register-code-hint');

    await register(page, 'en', unknownCode);
    await expect(alertOf(page)).toHaveText(label('en', 'register.error.refused'));
    await expect(field).toHaveAttribute('aria-describedby', 'register-code-hint register-error');
    expect(await page.locator('#register-error').textContent()).toBe(label('en', 'register.error.refused'));
    const firstAlert = await alertOf(page).elementHandle();

    // The second failed attempt: the previous message disappears while it runs, then a NEW alert node appears.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/register', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await held;
      return route.continue();
    });
    await register(page, 'en', unknownCode);
    await expect(alertOf(page)).toHaveCount(0);
    await expect(field).toHaveAttribute('aria-describedby', 'register-code-hint');
    release();
    await expect(alertOf(page)).toHaveText(label('en', 'register.error.refused'));
    expect(await firstAlert!.evaluate((node) => node.isConnected)).toBe(false);
    await page.unroute('**/register');
  });

  test('keeps focus on the submit button while busy (aria-disabled, never disabled), and sends a double submit once', async ({page, context, baseURL}) => {
    const person = await world.signedInUser();
    await signIn(context, baseURL!, person);
    await page.goto('/register');
    const posts: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/register', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts.push(route.request().url());
      await held;
      return route.continue();
    });
    await codeField(page, 'en').fill(unknownCode);
    const button = submitButton(page, 'en');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toHaveAttribute('disabled', /.*/);
    await expect(button).toBeFocused();
    await expect(page.getByRole('status').filter({hasText: label('en', 'register.pending')})).toBeVisible();
    // Pressing Enter again, clicking, and submitting from the field do not send a second request.
    await page.keyboard.press('Enter');
    await button.click({force: true});
    await codeField(page, 'en').press('Enter');
    release();
    await expect(alertOf(page)).toHaveText(label('en', 'register.error.refused'));
    expect(posts).toHaveLength(1);
    await page.unroute('**/register');
  });
});

test.describe('an address pre-authorized after its owner first signed in (the cutover case)', () => {
  test('is picked up when the registration screen is next opened, with the same session', async ({page, context, baseURL}) => {
    const email = `cutover.${randomBytes(4).toString('hex')}@example.test`;
    const person = await world.signedInUser({email});
    await signIn(context, baseURL!, person);
    // Signed in before anyone seeded the address: the registration screen, and no Account.
    await page.goto('/');
    await expect(page).toHaveURL(/\/register$/);
    expect(await world.accountOf(person)).toBeUndefined();

    // Josh seeds the address. The browser still holds the session it signed in with.
    await world.preauthorize(email);
    await page.goto('/');
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(mainNav(page, 'en')).toBeVisible();
    expect(await world.accountOf(person)).toMatchObject({status: 'active', role: 'member', source: 'preauthorization', google_subject: person.subject});
    expect(await world.workspacesOf(person)).toBe(1);
    expect(await world.sessionExists(person.sessionId)).toBe(true);
    // The claim issued the grant of the session that made it, so that same session carries on.
    expect(await world.grantsOf(person)).toEqual([person.sessionId]);
  });

  test('turns a second Google identity with the same address away, signs it out everywhere, and says so', async ({page, context, baseURL, browser}) => {
    const tag = randomBytes(4).toString('hex');
    const email = `owner.${tag}@example.test`;
    const owner = await world.signedInUser({email});
    await world.preauthorize(email);
    const ownerContext = await browser.newContext({baseURL});
    await signIn(ownerContext, baseURL!, owner);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto('/register');
    await expect(ownerPage).toHaveURL(`${baseURL}/`);
    await ownerContext.close();

    // Another Google subject presents the same address (spelled differently: Auth keeps one user per spelling).
    const impostor = await world.signedInUser({email: `Owner.${tag}@example.test`, subject: `another-subject-${tag}`});
    await signIn(context, baseURL!, impostor, {locale: 'he'});
    await page.goto('/register');
    await expect(page).toHaveURL(`${baseURL}/login?error=not_allowed`);
    await expect(alertOf(page)).toHaveText(label('he', 'login.error.not_allowed'));
    expect(await world.accountOf(impostor)).toBeUndefined();
    expect(await world.grantsOf(impostor)).toEqual([]);
    expect(await world.sessionExists(impostor.sessionId)).toBe(false);
    expect((await context.cookies()).filter((cookie) => cookie.name === impostor.cookie.name && cookie.value !== '')).toEqual([]);
  });
});

test.describe('an active Account', () => {
  for (const [path, view] of [['/', 'home'], ['/projects', 'projects'], ['/progress', 'progress'], ['/settings', 'settings']] as const) {
    test(`reaches ${path}`, async ({page, context, baseURL}) => {
      const member = await world.signedInUser();
      await world.activate(member);
      await signIn(context, baseURL!, member);
      const response = await page.goto(path);
      expect(response?.status(), view).toBe(200);
      await expect(page).toHaveURL(`${baseURL}${path}`);
      await expect(mainNav(page, 'en')).toBeVisible();
      await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    });
  }

  for (const variant of [{locale: 'en', theme: 'light'}, {locale: 'he', theme: 'dark'}] as const) {
    for (const path of ['/', '/projects', '/progress', '/settings']) {
      test(`${path} has no accessibility violations: ${variant.locale}, ${variant.theme}`, async ({page, context, baseURL}) => {
        const member = await world.signedInUser();
        await world.activate(member);
        await signIn(context, baseURL!, member, variant);
        await page.goto(path);
        await expect(page.getByRole('heading', {level: 1})).toBeVisible();
        expect(await violations(page)).toEqual([]);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }

  test('is sent Home from /register, and a signed-in Account never sees the registration form', async ({page, context, baseURL}) => {
    const member = await world.signedInUser();
    await world.activate(member);
    await signIn(context, baseURL!, member);
    await page.goto('/register');
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(codeField(page, 'en')).toHaveCount(0);
  });
});

test.describe('a disabled Account', () => {
  test('is signed out on its next request and sees no private content', async ({page, context, baseURL}) => {
    const member = await world.signedInUser();
    await world.activate(member);
    await signIn(context, baseURL!, member);
    await page.goto('/projects');
    await expect(mainNav(page, 'en')).toBeVisible();

    await world.setStatus(member, 'disabled');
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login\?error=account_disabled$/);
    await expect(alertOf(page)).toHaveText(label('en', 'login.error.account_disabled'));
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expect((await context.cookies()).filter((cookie) => cookie.name === member.cookie.name && cookie.value !== '')).toEqual([]);
    expect(await world.sessionExists(member.sessionId)).toBe(false);

    // Signed out for good: the next private request is just a sign-in redirect.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?error=not_signed_in$/);
  });

  test('is turned away from /register and the pages alike, in Hebrew too', async ({page, context, baseURL}) => {
    const member = await world.signedInUser();
    await world.activate(member);
    await world.setStatus(member, 'disabled');
    await signIn(context, baseURL!, member, {locale: 'he'});
    await page.goto('/register');
    await expect(page).toHaveURL(/\/login\?error=account_disabled$/);
    await expect(alertOf(page)).toHaveText(label('he', 'login.error.account_disabled'));
  });
});

test.describe('the sign-in callback', () => {
  test('a code Google never issued returns to sign-in as a failed sign-in', async ({page}) => {
    await page.goto('/auth/callback?code=not-a-code-google-issued');
    await expect(page).toHaveURL(/\/login\?error=auth_failed$/);
    await expect(alertOf(page)).toHaveText(label('en', 'login.error.auth_failed'));
  });
});
