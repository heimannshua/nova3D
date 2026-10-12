import {randomUUID} from 'node:crypto';
import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import {stepUpPath, stepUpUrl, type StepUpClass} from '../../lib/step-up';
import {hashStepUpSecret, stepUpCookieName} from '../../lib/step-up-flow';
import {addFakeAccount, chooserAccount, chooserUrl, fakeGoogleActive, requestsFor} from '../support/fake-google';
import {alertOf, hydrated, label, mainNav, overflow, setPreferences, signIn, stopAtAuth, stoppedAtAuth, violations, watchForProblems} from '../support/e2e-helpers';
import {endOutage, flakyBaseUrl, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld, type ForgedUser} from '../support/forged-session';
import type {Locale} from '../../lib/i18n';

// Story 1.4b: step-up (fresh authentication) in a real browser against the production build and the local
// Supabase stack. Two kinds of spec live here.
//
//  * The page and the START of a step-up run everywhere. Google is not involved: the browser is stopped at
//    Auth's authorize endpoint, which is enough to read exactly what the application asked Google for.
//  * The flows that need a real SECOND sign-in (a new Auth session, Auth's own `amr` row, the callback's code
//    exchange) run against the fake Google that `npm run fake-google:up` puts behind the stack's Auth container.
//    Without it they are skipped locally; in CI a missing swap fails the run instead of passing for green.
//
// Each test forges the initiating session (tests/support/forged-session.ts) and gives it a grant the way the
// callback does; the stolen-session cases in the issue are this session, started by someone who holds it.
// Every flow runs on `desktop` and `phone`.

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const locales = ['en', 'he'] as const;

/**
 * A user with an Account and the grant of their forged session: the Administrator, because most of what is tested here
 * is the step-up for `administration`, which only the Administrator may start (Story 1.11: the page it returns to answers
 * 404 to anyone else, so the step-up page does too). `plainMember` is the one who may not.
 */
async function administrator(options: {grant?: boolean} = {}) {
  const user = await world.signedInUser();
  await world.activate(user, options);
  await world.makeAdministrator(user);
  return user;
}

/** An Account that is not the Administrator's. */
async function plainMember() {
  const user = await world.signedInUser();
  await world.activate(user);
  return user;
}

/**
 * The same as `administrator()`, and a Google account in the fake with the same address and subject: signing in there is
 * signing in as this user. Pass `{administrator: false}` for a member.
 */
async function googleMember(options: {administrator?: boolean} = {}) {
  const tag = randomUUID().slice(0, 8);
  const user = await world.signedInUser({email: `step-${tag}@example.test`, subject: `google-${randomUUID()}`});
  await world.activate(user);
  if (options.administrator !== false) await world.makeAdministrator(user);
  await addFakeAccount({email: user.email, sub: user.subject, name: `Step ${tag}`});
  return user;
}

/**
 * How long a step that crosses the proxy, Auth and the database (and, against the fake, Google's chooser and Auth's
 * callback) may take before it is called stuck. The default of 5 s is for a page that is already here; on a busy
 * machine the first of these takes longer than that and passes on a retry, which is not a pass.
 */
const crossing = {timeout: 20_000};

/**
 * Opens the step-up page and waits until React has taken it over. A press before that is not lost (React replays
 * it once it has hydrated) but it is queued behind the page's own scripts, which is exactly the delay that made a
 * press look like it did nothing on a busy machine; waiting here takes hydration out of what a press has to wait for.
 */
async function openStepUp(page: Page, actionClass: StepUpClass, url: string = stepUpUrl(actionClass)) {
  await page.goto(url);
  await hydrated(page, 'main button[type="submit"], main a[href]');
}

const continueButton = (page: Page, locale: Locale) => page.getByRole('button', {name: new RegExp(`^(${label(locale, 'stepUp.continue')}|${label(locale, 'stepUp.pending')})$`)});
const stepUpCookie = async (context: BrowserContext) => (await context.cookies()).find((cookie) => cookie.name === stepUpCookieName);
/** Every cookie that holds this browser's Supabase session (it may be split into chunks). */
const sessionCookieNames = async (context: BrowserContext) =>
  (await context.cookies()).filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name) && cookie.value !== '').map((cookie) => cookie.name);
/**
 * This browser's PKCE verifier cookies by name: the fixed one, the flow index and the per-flow slots (never the
 * session). Values are compared as the application reads them: percent-decoded, because a cookie that holds quotes
 * is stored with them encoded when the server writes it.
 */
const verifierCookies = async (context: BrowserContext) =>
  new Map(
    (await context.cookies())
      .filter((cookie) => /^sb-.*-auth-token-(code-verifier|flows-code-verifier|flow-[A-Za-z0-9_-]+-code-verifier)$/.test(cookie.name) && cookie.value !== '')
      .map((cookie) => [cookie.name, decodeURIComponent(cookie.value)]),
  );
// Google accounts a test signs in with that the application has never seen. A real sign-in makes an Auth user
// for each, which is removed with the world, whether or not the test got far enough to look at it.
const strangers: string[] = [];
test.afterEach(async () => {
  for (const email of strangers.splice(0)) await world.adoptUser(email);
});
const otherGoogleAccount = async () => {
  const tag = randomUUID().slice(0, 8);
  const account = {email: `other-${tag}@example.test`, sub: `google-${randomUUID()}`, name: `Other ${tag}`};
  strangers.push(account.email);
  await addFakeAccount(account);
  return account;
};

// ---------------------------------------------------------------------------------------------------
test.describe('the step-up page', () => {
  for (const locale of locales) {
    test(`asks the person to sign in with Google again, accessibly, on phone and desktop (${locale}${locale === 'he' ? ', dark' : ''})`, async ({page, context, baseURL}) => {
      const user = await administrator();
      await signIn(context, baseURL!, user, locale === 'he' ? {locale, theme: 'dark'} : {locale});
      const problems = watchForProblems(page);
      const response = await page.goto(stepUpUrl('administration'));
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
      await expect(page).toHaveTitle(new RegExp(label(locale, 'meta.stepUp')));
      await expect(page.getByRole('heading', {level: 1, name: label(locale, 'stepUp.title')})).toBeVisible();
      await expect(page.getByText(label(locale, 'stepUp.lede'))).toBeVisible();
      // It says what is being confirmed, and which Google address is signed in (Story 1.11).
      await expect(page.getByText(label(locale, 'stepUp.reason.administration'))).toBeVisible();
      await expect(page.getByText(label(locale, 'stepUp.signedInAs', {email: user.email}))).toBeVisible();
      await expect(continueButton(page, locale)).toBeVisible();
      await expect(page.getByRole('link', {name: label(locale, 'stepUp.cancel')})).toHaveAttribute('href', '/admin');
      // One question and nothing else: no navigation to wander off by, no alert before an attempt.
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(alertOf(page)).toHaveCount(0);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      expect(await violations(page)).toEqual([]);
      expect(problems).toEqual([]);
    });
  }

  test('"Not now" returns to the class\'s own page and the person is still signed in: Settings for a class whose area does not exist yet', async ({page, context, baseURL}) => {
    const user = await plainMember();
    await signIn(context, baseURL!, user);
    await openStepUp(page, 'owner_deletion');
    await page.getByRole('link', {name: label('en', 'stepUp.cancel')}).click();
    await expect(page).toHaveURL(`${baseURL}/settings`, crossing);
    await expect(mainNav(page, 'en')).toBeVisible();
    expect(await world.noncesOf(user)).toEqual([]);
  });

  test('"Not now" on the administration step-up returns the Administrator to the Administration index (Story 1.5: the class serves both of the Administrator\'s pages)', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    await openStepUp(page, 'administration');
    await page.getByRole('link', {name: label('en', 'stepUp.cancel')}).click();
    await expect(page).toHaveURL(`${baseURL}/admin`, crossing);
    await expect(page.getByRole('heading', {level: 1, name: label('en', 'admin.title')})).toBeVisible();
    // Not confirmed: the index says nothing of a fresh sign-in.
    await expect(page.locator('.notice-success')).toHaveCount(0);
    expect(await world.noncesOf(user)).toEqual([]);
  });

  test('says in its own words what each class confirms, and the same Google address, for every class', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    for (const actionClass of ['administration', 'owner_deletion', 'account_deletion', 'close_instance'] as const) {
      await openStepUp(page, actionClass);
      await expect(page.getByText(label('en', `stepUp.reason.${actionClass}`))).toBeVisible();
      await expect(page.getByText(label('en', 'stepUp.signedInAs', {email: user.email}))).toBeVisible();
    }
  });

  test('is a page that does not exist for a member who asks for administration (it would lead to a page that answers 404 to them), and is still theirs for the other classes', async ({page, context, baseURL}) => {
    const user = await plainMember();
    await signIn(context, baseURL!, user);
    const response = await page.goto(stepUpUrl('administration'));
    expect(response?.status()).toBe(404);
    await expect(continueButton(page, 'en')).toHaveCount(0);
    await expect(page.getByText(label('en', 'stepUp.reason.administration'))).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 1, name: label('en', 'notFound.title')})).toBeVisible();
    expect(await world.noncesOf(user)).toEqual([]);
    for (const actionClass of ['owner_deletion', 'account_deletion', 'close_instance'] as const) {
      expect((await page.goto(stepUpUrl(actionClass)))?.status(), actionClass).toBe(200);
      await expect(continueButton(page, 'en'), actionClass).toBeVisible();
    }
  });

  test('is a page that does not exist for a class that is not on the list', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    for (const path of ['/step-up', '/step-up?for=', '/step-up?for=Administration', '/step-up?for=admin', '/step-up?for=delete_everything', '/step-up?for=__proto__']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(continueButton(page, 'en'), path).toHaveCount(0);
    }
    expect(await world.noncesOf(user)).toEqual([]);
  });

  test('is for an active Account with a valid grant only: everyone else is sent where any private page would send them', async ({page, context, baseURL}) => {
    // Signed out.
    await page.goto(stepUpUrl('administration'));
    await expect(page).toHaveURL(`${baseURL}/login?error=not_signed_in`, crossing);
    // A session whose grant has ended.
    const ended = await administrator();
    await world.revokeGrant(ended, ended.sessionId);
    await signIn(context, baseURL!, ended);
    await page.goto(stepUpUrl('administration'));
    await expect(page).toHaveURL(`${baseURL}/login?error=session_ended`, crossing);
    // A Google identity with no Account.
    await context.clearCookies();
    const stranger = await world.signedInUser();
    await signIn(context, baseURL!, stranger);
    await page.goto(stepUpUrl('administration'));
    await expect(page).toHaveURL(`${baseURL}/register`, crossing);
    expect(await world.noncesOf(ended)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('starting a step-up (the browser is stopped at Auth, so Google is not needed)', () => {
  test('asks Google for its account chooser with no login_hint, binds a nonce to this Account, session and flow, and sets an httpOnly cookie', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    const seen = await stopAtAuth(page);
    await openStepUp(page, 'owner_deletion');
    await continueButton(page, 'en').click();
    await expect(page.getByText(stoppedAtAuth)).toBeVisible(crossing);

    // What Google is asked for.
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]);
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.has('login_hint')).toBe(false);
    expect(url.searchParams.get('redirect_to')).toBe(`${baseURL}/auth/callback`);
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');

    // The nonce: this Account, this session, the class the page named, the cookie's hash, this very flow's challenge.
    const cookie = await stepUpCookie(context);
    expect(cookie, 'the step-up cookie').toBeDefined();
    expect(cookie).toMatchObject({httpOnly: true, sameSite: 'Lax', path: '/'});
    expect(cookie!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(590);
    expect(cookie!.expires - Date.now() / 1000).toBeLessThan(610);
    const [nonce, ...others] = await world.noncesOf(user);
    expect(others).toEqual([]);
    expect(nonce).toMatchObject({session_id: user.sessionId, action_class: 'owner_deletion', status: 'open', completed_session_id: null});
    const row = (await world.db.query('select secret_hash, verifier_hash from identity.step_up_nonces n join identity.accounts a on a.id = n.account_id where a.user_id = $1', [user.id])).rows[0];
    expect(row.secret_hash).toBe(hashStepUpSecret(cookie!.value));
    expect(row.verifier_hash).toBe(url.searchParams.get('code_challenge'));
    expect(nonce.expires_at.getTime() - nonce.started_at.getTime()).toBe(10 * 60_000);
    // No script can read the secret.
    expect(await page.evaluate(() => document.cookie)).not.toContain('nova3d-step-up');
    // Nothing fresh yet: the initiating session is exactly what it was.
    expect(await world.markersOf(user)).toEqual([]);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
  });

  test('a second start voids the first nonce, and the cookie carries the new secret', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    await stopAtAuth(page);
    await openStepUp(page, 'administration');
    await continueButton(page, 'en').click();
    await expect(page.getByText(stoppedAtAuth)).toBeVisible(crossing);
    const first = (await stepUpCookie(context))!.value;
    await openStepUp(page, 'administration');
    await continueButton(page, 'en').click();
    await expect(page.getByText(stoppedAtAuth)).toBeVisible(crossing);
    const second = (await stepUpCookie(context))!.value;
    expect(second).not.toBe(first);
    const nonces = await world.noncesOf(user);
    expect(nonces.map((nonce) => nonce.status)).toEqual(['voided', 'open']);
  });

  test('refuses the eleventh start in an hour, in the person\'s language, goes nowhere, and leaves no verifier of its own behind', async ({page, context, baseURL}) => {
    const user = await administrator();
    for (let i = 0; i < 10; i += 1) expect((await world.startStepUpFrom(user, user.sessionId)).outcome).toBe('started');
    await signIn(context, baseURL!, user, {locale: 'he'});
    // A sign-in already under way in this browser (another tab) holds the fixed verifier cookie.
    const earlier = {name: `${user.cookie.name}-code-verifier`, value: JSON.stringify('a-verifier-from-an-earlier-sign-in'), url: baseURL!};
    await context.addCookies([earlier]);
    const before = await verifierCookies(context);
    expect([...before.keys()]).toEqual([earlier.name]);
    const seen = await stopAtAuth(page);
    await openStepUp(page, 'administration');
    await continueButton(page, 'he').click();
    await expect(alertOf(page)).toHaveText(label('he', 'stepUp.error.limited'));
    await expect(page).toHaveURL(`${baseURL}${stepUpUrl('administration')}`, crossing);
    expect(seen).toEqual([]);
    expect(await stepUpCookie(context)).toBeUndefined();
    expect(await world.noncesOf(user)).toHaveLength(10);
    // The sign-in start wrote a verifier before the database was asked; it is gone, the earlier one is exactly as it
    // was, and the session cookie was never touched.
    expect(await verifierCookies(context)).toEqual(before);
    expect((await context.cookies()).find((cookie) => cookie.name === user.cookie.name)?.value).toBe(user.cookie.value);
  });

  test('is denied, retryably, with nothing fresh and the session kept, while the database is unreachable', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    const seen = await stopAtAuth(page);
    await openStepUp(page, 'administration', new URL(stepUpUrl('administration'), flakyBaseUrl(baseURL!)).href);
    const end = startOutage(user.id, {mode: 'down', rpc: ['start_step_up']});
    try {
      await continueButton(page, 'en').click();
      await expect(alertOf(page)).toHaveText(label('en', 'stepUp.error.unavailable'));
      expect(seen).toEqual([]);
      expect(await stepUpCookie(context)).toBeUndefined();
      expect(await world.noncesOf(user)).toEqual([]);
    } finally {
      end();
    }
    // Retryable: the same button works once the database is back.
    await continueButton(page, 'en').click();
    await expect(page.getByText(stoppedAtAuth)).toBeVisible(crossing);
    expect(await world.noncesOf(user)).toHaveLength(1);
    endOutage(user.id);
    // The session was kept throughout.
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
  });

  test('leaves no verifier behind when the database cannot be reached either', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    await stopAtAuth(page);
    await openStepUp(page, 'administration', new URL(stepUpUrl('administration'), flakyBaseUrl(baseURL!)).href);
    startOutage(user.id, {mode: 'down', rpc: ['start_step_up']});
    try {
      await continueButton(page, 'en').click();
      await expect(alertOf(page)).toHaveText(label('en', 'stepUp.error.unavailable'));
      expect([...(await verifierCookies(context)).keys()]).toEqual([]);
    } finally {
      endOutage(user.id);
    }
  });

  // The double-press guard. A second press while one is running must send nothing: React does not drop it, it QUEUES
  // the action and runs it once the first has finished, so the difference shows when the first FAILS and the queued
  // one would then run as a retry nobody asked for. The database is made unreachable for this user (on the second
  // server, as the other outage tests do), the action's answer is held so that the busy state can be looked at, and
  // requests carrying a Server Action are counted.
  async function pressWhileBusy(page: Page, user: ForgedUser, baseURL: string, press: (page: Page) => Promise<void>) {
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) posts.push(request.url());
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route((url) => url.pathname === stepUpPath, async (route) => {
      if (route.request().method() === 'POST') await held;
      return route.continue();
    });
    const seen = await stopAtAuth(page);
    await openStepUp(page, 'administration', new URL(stepUpUrl('administration'), flakyBaseUrl(baseURL)).href);
    startOutage(user.id, {mode: 'down', rpc: ['start_step_up']});
    try {
      const button = continueButton(page, 'en');
      await button.focus();
      await press(page);
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('.auth-status')).toHaveText(label('en', 'stepUp.pending'));
      // Busy, but still the control that has focus: it is aria-disabled, not disabled, so a keyboard or screen reader user is not dropped.
      await expect(button).toBeFocused();
      release();
      // The one request fails (the database is down) and the person is told. Nothing else may follow it.
      await expect(alertOf(page)).toHaveText(label('en', 'stepUp.error.unavailable'), crossing);
      await page.waitForLoadState('networkidle');
      expect(posts, 'one request reached the server').toHaveLength(1);
      expect(seen, 'nothing reached Auth').toEqual([]);
      expect(await world.noncesOf(user)).toEqual([]);
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
    } finally {
      release();
      endOutage(user.id);
    }
    return {posts, seen};
  }

  test('submitted twice in one task while idle, the form sends one request, not a queued second', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    await pressWhileBusy(page, user, baseURL!, (current) =>
      current.evaluate(() => {
        // Two submissions before React has re-rendered: only the press flag taken in the submit event can stop the second.
        const form = document.querySelector('main form') as HTMLFormElement;
        form.requestSubmit();
        form.requestSubmit();
      }),
    );
  });

  test('double-clicked, the button sends one request, not a queued second', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    await pressWhileBusy(page, user, baseURL!, async (current) => {
      await continueButton(current, 'en').dblclick();
    });
  });

  test('once the first press has finished and been answered, pressing again is a new request, and it works', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    const { posts, seen } = await pressWhileBusy(page, user, baseURL!, async (current) => {
      await continueButton(current, 'en').click();
    });
    // The database is back (pressWhileBusy ended the outage): a deliberate second press is a second request.
    await continueButton(page, 'en').click();
    await expect(page.getByText(stoppedAtAuth)).toBeVisible(crossing);
    expect(posts).toHaveLength(2);
    expect(seen).toHaveLength(1);
    expect(await world.noncesOf(user)).toHaveLength(1);
  });

  test('a page restored from the back/forward cache (Back from Google) starts afresh, not stuck busy', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    await stopAtAuth(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route((url) => url.pathname === stepUpPath, async (route) => {
      if (route.request().method() === 'POST') await held;
      return route.continue();
    });
    try {
      await openStepUp(page, 'administration');
      const button = continueButton(page, 'en');
      await button.click();
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('.auth-status')).toHaveText(label('en', 'stepUp.pending'));
      // The browser brings the page back as it was left: busy, the press flag set, nothing that will ever finish.
      // (Headless Chromium does not keep pages in its back/forward cache, so the event it would send is sent here.)
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('.auth-status')).toHaveText('');
      // And it works: the person can press it again.
      await button.click();
      await expect(button).toHaveAttribute('aria-disabled', 'true');
    } finally {
      release();
    }
    await expect(page.getByText(stoppedAtAuth)).toBeVisible(crossing);
  });

  test('a pageshow that is not a restore (a normal load) leaves a busy button alone', async ({page, context, baseURL}) => {
    const user = await administrator();
    await signIn(context, baseURL!, user);
    await stopAtAuth(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route((url) => url.pathname === stepUpPath, async (route) => {
      if (route.request().method() === 'POST') await held;
      return route.continue();
    });
    try {
      await openStepUp(page, 'administration');
      const button = continueButton(page, 'en');
      await button.click();
      await expect(button).toHaveAttribute('aria-disabled', 'true');
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted: false})));
      await expect(button).toHaveAttribute('aria-disabled', 'true');
    } finally {
      release();
    }
    await expect(page.getByText(stoppedAtAuth)).toBeVisible(crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the step-up against the fake Google (a real second sign-in)', () => {
  let fakeActive = false;
  test.beforeAll(async () => {
    fakeActive = await fakeGoogleActive(world.stack.apiUrl);
    if (!fakeActive && process.env.CI) throw new Error('The fake Google is not running, or the stack\'s Auth is not swapped to use it, so the step-up flows cannot run. CI swaps it in with `npm run fake-google:up` before the browser tests.');
  });
  test.beforeEach(() => {
    test.skip(!fakeActive, 'The fake Google is not active. Run `npm run fake-google:up` against the local stack to run the step-up flows.');
  });

  /** Opens the step-up for a class and chooses the given Google account in Google's chooser. */
  async function stepUpWith(page: Page, locale: Locale, actionClass: StepUpClass, email: string) {
    await openStepUp(page, actionClass);
    await continueButton(page, locale).click();
    await expect(page).toHaveURL(chooserUrl, crossing);
    await chooserAccount(page, email).click();
  }

  for (const locale of locales) {
    test(`the same Google account signs in again: the new session is fresh for the class and only it, and the old session is revoked (${locale})`, async ({page, context, browser, baseURL}) => {
      // The Administrator, because administration returns to the Administration index (Stories 1.11 and 1.5).
      const user = await googleMember();
      await signIn(context, baseURL!, user, {locale});
      const problems = watchForProblems(page);
      await openStepUp(page, 'administration');
      await continueButton(page, locale).click();
      // Google's own account chooser, not a silent pass-through.
      await expect(page).toHaveURL(chooserUrl, crossing);
      await expect(page.getByRole('heading', {name: 'Choose an account'})).toBeVisible();
      await expect(page.locator('[data-prompt]')).toHaveText('select_account');
      await chooserAccount(page, user.email).click();
      await expect(page).toHaveURL(`${baseURL}/admin`, crossing);
      await expect(mainNav(page, locale)).toBeVisible();
      await expect(page.getByRole('heading', {level: 1, name: label(locale, 'admin.title')})).toBeVisible();
      await expect(page.locator('.notice-success')).toContainText(label(locale, 'admin.confirm.ok'));

      // What Google was asked: the chooser, and no hint at who.
      const asked = await requestsFor(user.email);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({prompt: 'select_account', loginHint: null, chooser: true});

      // A new session, with its own grant; the initiating grant is revoked for step_up.
      const grants = await world.grantsOf(user);
      expect(grants).toHaveLength(2);
      const fresh = grants.find((id) => id !== user.sessionId)!;
      expect(fresh).not.toBe(user.sessionId);
      expect(await world.hasGrantAtAll(fresh)).toBe(true);
      expect((await world.grantOf(fresh))!.revoked_at).toBeNull();
      expect(await world.grantOf(user.sessionId)).toMatchObject({revoked_reason: 'step_up', revoked_by: `user:${user.id}`});

      // Auth's own table says that session came from a Google sign-in, after the nonce started.
      const nonce = (await world.noncesOf(user))[0];
      expect(nonce).toMatchObject({status: 'completed', completed_session_id: fresh, session_id: user.sessionId});
      const amr = (await world.db.query(`select created_at from auth.mfa_amr_claims where session_id = $1 and authentication_method = 'oauth'`, [fresh])).rows;
      expect(amr).toHaveLength(1);
      expect(amr[0].created_at.getTime()).toBeGreaterThanOrEqual(nonce.started_at.getTime());

      // The marker: the new session only, this class, five minutes.
      const [marker, ...more] = await world.markersOf(user);
      expect(more).toEqual([]);
      expect(marker).toMatchObject({session_id: fresh, action_class: 'administration', consumed_at: null});
      expect(marker.expires_at.getTime() - marker.issued_at.getTime()).toBe(5 * 60_000);
      expect(await world.markerOutcome(user, fresh, 'administration')).toBe('allowed');
      expect(await world.markerOutcome(user, fresh, 'administration')).toBe('allowed');
      expect(await world.markerOutcome(user, user.sessionId, 'administration')).toBe('denied');
      expect(await world.markerOutcome(user, fresh, 'owner_deletion')).toBe('none');
      // After five minutes it is refused.
      await world.db.query(`update identity.fresh_authentications set issued_at = issued_at - interval '6 minutes', expires_at = expires_at - interval '6 minutes' where session_id = $1`, [fresh]);
      expect(await world.markerOutcome(user, fresh, 'administration')).toBe('expired');

      // The cookie is gone, the browser holds the NEW session, and a thief holding the old one is out.
      expect(await stepUpCookie(context)).toBeUndefined();
      expect((await sessionCookieNames(context)).length).toBeGreaterThan(0);
      const thief = await browser.newContext();
      try {
        await signIn(thief, baseURL!, user);
        const stolen = await thief.newPage();
        await stolen.goto(`${baseURL}/`);
        await expect(stolen).toHaveURL(`${baseURL}/login?error=session_ended`, crossing);
      } finally {
        await thief.close();
      }
      expect(problems).toEqual([]);
    });
  }

  // Story 1.11: the invitation page is the first area that needs the step-up, so the whole loop runs here, for real: a
  // change refused for want of a fresh sign-in, the link to the step-up, Google's chooser, the way back to the page, a change
  // that now works, and a change that is refused again once the five minutes are up.
  for (const locale of locales) {
    test(`the invitation page sends the Administrator through a real step-up and back, and a change then works for five minutes (${locale})`, async ({page, context, baseURL}) => {
      const user = await googleMember();
      await signIn(context, baseURL!, user, {locale, theme: locale === 'he' ? 'dark' : 'light'});
      const problems = watchForProblems(page);
      await page.goto('/admin/invitations');
      await hydrated(page, 'main button[type="submit"]');
      const nameField = page.getByLabel(label(locale, 'invitations.named.label'), {exact: true});
      const make = page.getByRole('button', {name: label(locale, 'invitations.named.submit')});
      const reveal = page.locator('.code-reveal');

      // Not fresh: a change is refused, and the way to get a fresh sign-in is the link beside the message.
      await nameField.fill(`First ${user.id.slice(0, 6)}`);
      await make.click();
      const refused = alertOf(page).filter({hasText: label(locale, 'invitations.error.needsConfirm')});
      await expect(refused).toBeVisible(crossing);
      expect(await world.invitationsIssuedBy(user)).toEqual([]);
      await refused.getByRole('link', {name: label(locale, 'invitations.confirm.action')}).click();

      // The step-up page says what is being confirmed and which Google address is signed in.
      await expect(page).toHaveURL(`${baseURL}${stepUpUrl('administration')}`, crossing);
      await expect(page.getByText(label(locale, 'stepUp.reason.administration'))).toBeVisible();
      await expect(page.getByText(label(locale, 'stepUp.signedInAs', {email: user.email}))).toBeVisible();
      await hydrated(page, 'main button[type="submit"], main a[href]');
      await continueButton(page, locale).click();
      await expect(page).toHaveURL(chooserUrl, crossing);
      await chooserAccount(page, user.email).click();

      // Back on the Administration index (the class alone decides where to return), in the NEW session, which has the marker.
      await expect(page).toHaveURL(`${baseURL}/admin`, crossing);
      await expect(page.locator('.notice-success')).toContainText(label(locale, 'admin.confirm.ok'));
      await page.getByRole('link', {name: label(locale, 'admin.invitations.open')}).click();
      await expect(page).toHaveURL(`${baseURL}/admin/invitations`, crossing);
      await expect(page.locator('.notice-success')).toContainText(label(locale, 'invitations.confirm.ok'));
      await expect(page.getByRole('link', {name: label(locale, 'invitations.confirm.action')})).toHaveCount(0);
      await hydrated(page, 'main button[type="submit"]');
      const name = `Second ${user.id.slice(0, 6)}`;
      await nameField.fill(name);
      await make.click();
      await expect(reveal).toBeVisible(crossing);
      expect((await world.invitationsIssuedBy(user)).map((row) => row.label)).toEqual([name]);
      const [marker] = await world.markersOf(user);
      expect(marker).toMatchObject({action_class: 'administration', consumed_at: null});
      // The same marker serves a second change inside its five minutes. (The field empties when the first action settles;
      // wait for that, as a person would see it, before typing the next name.)
      await expect(nameField).toHaveValue('');
      await nameField.fill(`Third ${user.id.slice(0, 6)}`);
      await make.click();
      await expect(reveal).toHaveCount(2, crossing);

      // Five minutes later: refused again, and the step-up is offered again.
      await world.expireMarker(marker.session_id);
      await expect(nameField).toHaveValue('');
      await nameField.fill(`Fourth ${user.id.slice(0, 6)}`);
      await make.click();
      await expect(alertOf(page).filter({hasText: label(locale, 'invitations.error.needsConfirm')})).toBeVisible(crossing);
      expect(await world.invitationsIssuedBy(user)).toHaveLength(2);
      expect(await world.auditBy(`user:${user.id}`, 'invitation.issue_refused')).toHaveLength(1);
      expect(problems).toEqual([]);
    });
  }

  test('Account deletion and close-instance markers are consumed by use, and only after a step-up started after the confirmation', async ({page, context, baseURL}) => {
    const user = await googleMember();
    await signIn(context, baseURL!, user);
    const shown = new Date(Date.now() - 1_000);
    await stepUpWith(page, 'en', 'account_deletion', user.email);
    await expect(page).toHaveURL(`${baseURL}/settings`, crossing);
    const [marker] = await world.markersOf(user);
    expect(marker).toMatchObject({action_class: 'account_deletion', consumed_at: null});
    // A confirmation shown AFTER this step-up started would need a newer step-up.
    expect(await world.markerOutcome(user, marker.session_id, 'account_deletion', new Date(marker.step_up_started_at.getTime() + 1_000))).toBe('stale');
    // Shown before it started: once.
    expect(await world.markerOutcome(user, marker.session_id, 'account_deletion', shown)).toBe('allowed');
    expect(await world.markerOutcome(user, marker.session_id, 'account_deletion', shown)).toBe('used');
    expect((await world.markersOf(user))[0].consumed_at).not.toBeNull();
  });

  test('another Google account chosen: nothing becomes fresh, only the new session is ended, the old session is untouched', async ({page, context, browser, baseURL}) => {
    const user = await googleMember();
    const other = await otherGoogleAccount();
    await signIn(context, baseURL!, user);
    await stepUpWith(page, 'en', 'administration', other.email);
    await expect(page).toHaveURL(`${baseURL}/login?error=step_up_failed`, crossing);
    await expect(alertOf(page)).toHaveText(label('en', 'login.error.step_up_failed'));

    // The other Google account became an Auth user with no Account; its new session is gone, and so is the cookie.
    const otherId = await world.adoptUser(other.email);
    expect(otherId, 'Auth created the other account\'s user').toBeDefined();
    expect(await world.authSessionsOf(otherId!)).toEqual([]);
    expect(await sessionCookieNames(context)).toEqual([]);
    expect(await stepUpCookie(context)).toBeUndefined();

    // Nothing is fresh for anyone, and the initiating session is exactly what it was.
    expect(await world.markersOf(user)).toEqual([]);
    expect((await world.noncesOf(user))[0]).toMatchObject({status: 'rejected', completed_session_id: null});
    expect(await world.sessionExists(user.sessionId)).toBe(true);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
    expect(await world.markerOutcome(user, user.sessionId, 'administration')).toBe('none');
    // Not a global sign-out: the initiating session still works from where it is.
    const original = await browser.newContext();
    try {
      await signIn(original, baseURL!, user);
      const kept = await original.newPage();
      await kept.goto(`${baseURL}/`);
      await expect(kept).toHaveURL(`${baseURL}/`, crossing);
      await expect(mainNav(kept, 'en')).toBeVisible();
    } finally {
      await original.close();
    }
  });

  test('another browser completes: it holds no step-up cookie and no PKCE verifier, so it signs in nothing and makes nothing fresh', async ({page, context, browser, baseURL}) => {
    const user = await googleMember();
    await signIn(context, baseURL!, user);
    await openStepUp(page, 'administration');
    await continueButton(page, 'en').click();
    await expect(page).toHaveURL(chooserUrl, crossing);
    const relayed = page.url();

    // The link to Google is handed to someone else, who completes it in their own browser.
    const elsewhere = await browser.newContext();
    try {
      const away = await elsewhere.newPage();
      await away.goto(relayed);
      await chooserAccount(away, user.email).click();
      await expect(away).toHaveURL(`${baseURL}/login?error=auth_failed`, crossing);
      expect(await sessionCookieNames(elsewhere)).toEqual([]);
    } finally {
      await elsewhere.close();
    }
    expect(await world.markersOf(user)).toEqual([]);
    expect((await world.noncesOf(user))[0].status).toBe('open');
    expect(await world.grantsOf(user)).toEqual([user.sessionId]);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
  });

  test('another browser that signs in the ordinary way meanwhile is an ordinary sign-in: no marker, and the open step-up is not disturbed', async ({page, context, browser, baseURL}) => {
    const user = await googleMember();
    await signIn(context, baseURL!, user);
    await openStepUp(page, 'administration');
    await continueButton(page, 'en').click();
    await expect(page).toHaveURL(chooserUrl, crossing);

    const elsewhere = await browser.newContext();
    try {
      const away = await elsewhere.newPage();
      await away.goto(`${baseURL}/login`);
      await hydrated(away, 'main button');
      await away.getByRole('button', {name: label('en', 'login.google')}).click();
      await expect(away).toHaveURL(chooserUrl, crossing);
      await chooserAccount(away, user.email).click();
      await expect(away).toHaveURL(`${baseURL}/`, crossing);
      await expect(mainNav(away, 'en')).toBeVisible();
    } finally {
      await elsewhere.close();
    }
    expect(await world.markersOf(user)).toEqual([]);
    expect((await world.noncesOf(user))[0].status).toBe('open');
    const grants = await world.grantsOf(user);
    expect(grants).toHaveLength(2);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
  });

  test('a sign-in started any other way in the same browser is not mistaken for the step-up', async ({page, context, baseURL}) => {
    const user = await googleMember();
    await signIn(context, baseURL!, user);
    await openStepUp(page, 'administration');
    await continueButton(page, 'en').click();
    await expect(page).toHaveURL(chooserUrl, crossing);
    // The same browser (it holds the step-up cookie) starts an ordinary sign-in from the sign-in page instead.
    await page.goto(`${baseURL}/login`);
    await hydrated(page, 'main button');
    await page.getByRole('button', {name: label('en', 'login.google')}).click();
    await expect(page).toHaveURL(chooserUrl, crossing);
    await chooserAccount(page, user.email).click();
    await expect(page).toHaveURL(`${baseURL}/`, crossing);
    await expect(mainNav(page, 'en')).toBeVisible();
    expect(await world.markersOf(user)).toEqual([]);
    expect((await world.noncesOf(user))[0].status).toBe('open');
    // The ordinary sign-in overwrote and consumed the one verifier this browser holds, so the step-up cannot come back
    // here: its cookie went with that sign-in. (The nonce stays open in the database until it expires or is replaced.)
    expect(await stepUpCookie(context)).toBeUndefined();
  });

  test('an expired nonce is rejected like a mismatch', async ({page, context, baseURL}) => {
    const user = await googleMember();
    await signIn(context, baseURL!, user);
    await openStepUp(page, 'administration');
    await continueButton(page, 'en').click();
    await expect(page).toHaveURL(chooserUrl, crossing);
    await world.ageNonces(user, 11);
    await chooserAccount(page, user.email).click();
    await expect(page).toHaveURL(`${baseURL}/login?error=step_up_failed`, crossing);
    await expect(alertOf(page)).toHaveText(label('en', 'login.error.step_up_failed'));
    expect((await world.noncesOf(user))[0].status).toBe('expired');
    expect(await world.markersOf(user)).toEqual([]);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
    expect(await sessionCookieNames(context)).toEqual([]);
  });

  test('a replaced nonce (a newer start) is rejected like a mismatch', async ({page, context, baseURL}) => {
    const user = await googleMember();
    await signIn(context, baseURL!, user);
    await openStepUp(page, 'administration');
    await continueButton(page, 'en').click();
    await expect(page).toHaveURL(chooserUrl, crossing);
    // Another start, from anywhere, voids this one.
    expect((await world.startStepUpFrom(user, user.sessionId)).outcome).toBe('started');
    await chooserAccount(page, user.email).click();
    await expect(page).toHaveURL(`${baseURL}/login?error=step_up_failed`, crossing);
    expect((await world.noncesOf(user)).map((nonce) => nonce.status)).toEqual(['voided', 'open']);
    expect(await world.markersOf(user)).toEqual([]);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
  });

  test('is denied, retryably, with nothing fresh, when the database fails while the sign-in is accepted', async ({page, context, baseURL}) => {
    const user = await googleMember();
    await signIn(context, baseURL!, user);
    // The second server shares the stack and the fake Google; its callback is allowed by the swap.
    const flaky = flakyBaseUrl(baseURL!);
    await openStepUp(page, 'administration', new URL(stepUpUrl('administration'), flaky).href);
    await continueButton(page, 'en').click();
    await expect(page).toHaveURL(chooserUrl, crossing);
    startOutage(user.id, {mode: 'down', rpc: ['complete_step_up']});
    try {
      await chooserAccount(page, user.email).click();
      await expect(page).toHaveURL(`${flaky}/login?error=auth_unavailable`, crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await world.markersOf(user)).toEqual([]);
    expect((await world.grantOf(user.sessionId))!.revoked_at).toBeNull();
    expect(await sessionCookieNames(context)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('"use a different Google account" shows Google\'s account chooser (AC-3)', () => {
  let fakeActive = false;
  test.beforeAll(async () => {
    fakeActive = await fakeGoogleActive(world.stack.apiUrl);
    if (!fakeActive && process.env.CI) throw new Error('The fake Google is not running, or the stack\'s Auth is not swapped to use it; CI swaps it in with `npm run fake-google:up` before the browser tests.');
  });

  for (const locale of locales) {
    test(`shows the chooser on phone and desktop, then the person signs in as whoever they choose (${locale})`, async ({page, context, baseURL}) => {
      test.skip(!fakeActive, 'The fake Google is not active. Run `npm run fake-google:up` against the local stack.');
      const tag = randomUUID().slice(0, 8);
      const person = await world.signedInUser({email: `again-${tag}@example.test`, subject: `google-${randomUUID()}`});
      await addFakeAccount({email: person.email, sub: person.subject});
      await signIn(context, baseURL!, person, {locale});
      await setPreferences(context, baseURL!, {locale});
      await page.goto('/register');
      await hydrated(page, 'main form.auth-switch button');
      await page.getByRole('button', {name: label(locale, 'register.switch')}).click();
      await expect(page).toHaveURL(chooserUrl, crossing);
      await expect(page.getByRole('heading', {name: 'Choose an account'})).toBeVisible();
      await expect(chooserAccount(page, person.email)).toBeVisible();
      expect(await world.sessionExists(person.sessionId)).toBe(false);
      await chooserAccount(page, person.email).click();
      // The same person, signed in again as a new session; they still have no Account, so Registration.
      await expect(page).toHaveURL(`${baseURL}/register`, crossing);
      const asked = await requestsFor(person.email);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({prompt: 'select_account', loginHint: null, chooser: true});
    });
  }
});
