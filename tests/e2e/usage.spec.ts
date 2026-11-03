import {randomUUID} from 'node:crypto';
import {expect, test, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {consumePreauthorization, seedPreauthorization} from '../../lib/accounts';
import {isolateLtr, type Locale, type MessageKey} from '../../lib/i18n';
import {stepUpUrl} from '../../lib/step-up';
import {addFakeAccount, chooserAccount, chooserUrl, fakeGoogleActive} from '../support/fake-google';
import {alertOf, announcer, hydrated, label, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {endGlobalOutage, endOutage, flakyBaseUrl, startGlobalOutage, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld, type ForgedUser} from '../support/forged-session';
import {insertIncident, insertReservation, insertSettlement, ledgerJob, removeLedger, setFigures as makeLedgerFigures} from '../support/usage-ledger';

// Story 2.4: the Administrator's Usage and limits page (AD-03), in a real browser against the production build and the local Supabase stack.
// Each test forges the Administrator's session and, where the flow needs one, the fresh-authentication marker a completed step-up writes
// (tests/support/forged-session.ts); one test drives the REAL step-up with the fake Google, from the refusal on this page to the change that works.
// The settled and reserved amounts of an Account come from the Usage ledgers (Story 2.6 replaced the stand-in usage.fixture_figures), so the tests that need a
// state other than "nothing used" make real ledger rows as the owner (tests/support/usage-ledger.ts: a Job, an operation, a reservation and a settlement of the
// wanted amounts, bypassing admission). Every flow runs on `desktop` and `phone`.
//
// Story 2.8 adds the overrun incidents: a section above the Accounts that lists each incident (provider, operation, reserved, reported, over, when, open or cleared and by
// whom) and lets the freshly authenticated Administrator review and clear an open one. An incident is a real ledger row made by the owner (a Job, an operation, a reservation
// and an evidence settlement above it, then the incident), against a rate schedule with a provider of its own, so an open incident of a test blocks no provider any other test
// uses; the schedule and the ledger rows are removed after each test.
//
// The page lists every Account of a database every test shares, so tests find their own card by the address of the Account they made.

// The page lists the newest 200 Accounts of a database every test shares, each with two forms, and a test reloads or runs the accessibility check on
// it several times: a generous allowance, so a busy machine and a full database are not read as a stuck page.
// (Story 2.8: the page also lists the overrun incidents of every test that runs now, and a full run makes an axe pass on it more than a minute long on a busy machine: 240 s.)
test.describe.configure({timeout: 240_000});

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const path = '/admin/usage';
const crossing = {timeout: 20_000};
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);

// Money, written as the page writes it (lib/usage-view.ts formatDollars, which a browser spec does not import) ---------------------------------

const dollars = (microdollars: number) => {
  const whole = Math.floor(microdollars / 1_000_000);
  const fraction = microdollars % 1_000_000;
  const decimals = fraction % 10_000 === 0 ? String(fraction).padStart(6, '0').slice(0, 2) : String(fraction).padStart(6, '0').replace(/0+$/, '');
  return `$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimals}`;
};
const microdollars = (text: string) => {
  const match = /^\$([\d,]+)\.(\d+)$/.exec(text.trim());
  if (!match) throw new Error(`Not an amount: "${text}"`);
  return Number(match[1].replace(/,/g, '')) * 1_000_000 + Number(match[2].padEnd(6, '0'));
};

// The world ---------------------------------------------------------------------------------------------------------------------------------

type Options = {locale?: Locale; theme?: 'light' | 'dark'; marker?: boolean | 'expired'; preauthorized?: boolean; before?: (user: ForgedUser) => Promise<void>};

/** An Administrator with an Account, the grant of their forged session and, if asked, a marker; signed in, on the page, hydrated. */
async function administrator(page: Page, context: BrowserContext, baseURL: string, options: Options = {}) {
  let user: ForgedUser;
  if (options.preauthorized) {
    user = await preauthorizedAdministrator();
  } else {
    user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
  }
  if (options.marker) await world.forgeMarker(user, user.sessionId, {expired: options.marker === 'expired'});
  await signIn(context, baseURL, user, {locale: options.locale ?? 'en', theme: options.theme ?? 'light'});
  // What a test needs to exist before the page is first read (an incident that this Administrator cleared, say).
  if (options.before) await options.before(user);
  await open(page);
  return user;
}

/**
 * The Administrator the way the seed command makes one: pre-authorized for an address, whose first sign-in activates the Account with the role
 * `administrator` (the default limit of the Administrator is $50.00). An Account made with a code and promoted afterwards keeps the $25.00 it began with.
 */
async function preauthorizedAdministrator() {
  const user = await world.signedInUser();
  await seedPreauthorization({email: user.email, role: 'administrator', actor: 'seed:local:e2e'}, {env: world.env});
  const receipt = await consumePreauthorization(user.id, {env: world.env});
  if (receipt.outcome !== 'registered') throw new Error(`The test Administrator was not created (${receipt.outcome}).`);
  await world.grant(user, user.sessionId);
  return user;
}

/** A member with an Account. Its usage period (this UTC month, $25.00) was made with the Account. */
async function member(options: {email?: string} = {}) {
  const user = await world.signedInUser(options.email ? {email: options.email} : {});
  await world.activate(user);
  return user;
}

async function open(page: Page, url: string = path) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await hydrated(page, 'main form button');
}

/** The periods of the user's Account, oldest first: the whole record, with the amounts as numbers. */
async function periodsOf(user: ForgedUser) {
  const {rows} = await world.db.query(
    `select p.id, p.seq, p.month_start::text as month_start, p.limit_microdollars::float8 as "limit", p.carried_settled_microdollars::float8 as carried_settled,
            p.carried_reserved_microdollars::float8 as carried_reserved, p.cause, p.previous_limit_microdollars::float8 as previous_limit, p.actor, p.command_id, p.digest, p.created_at
       from usage.periods p join identity.accounts a on a.id = p.account_id where a.user_id = $1 order by p.seq`,
    [user.id],
  );
  return rows as {
    id: string;
    seq: number;
    month_start: string;
    limit: number;
    carried_settled: number;
    carried_reserved: number;
    cause: string;
    previous_limit: number | null;
    actor: string;
    command_id: string | null;
    digest: string;
    created_at: Date;
  }[];
}
const currentOf = async (user: ForgedUser) => (await periodsOf(user)).at(-1)!;
/**
 * The settled and reserved FIGURES of the Account's current period, as real ledger rows made by the owner (the page shows carried + figure). It REPLACES what an earlier
 * call made, as the stand-in's upsert did: the Account's ledger rows go first.
 */
async function setFigures(user: ForgedUser, settled: number, reserved = 0) {
  const period = await currentOf(user);
  await removeLedger(world.db, (await world.accountOf(user)).id);
  await makeLedgerFigures(world.db, period.id, settled, reserved);
}
const currentMonth = async () => (await world.db.query(`select to_char(usage.current_month(), 'YYYY-MM') as month`)).rows[0].month as string;
const actorOf = (user: ForgedUser) => `user:${user.id}`;
const targetOf = async (user: ForgedUser) => `account:${(await world.accountOf(user)).id}`;

// Overrun incidents (Story 2.8) ------------------------------------------------------------------------------------------------------------------

type MadeIncident = {id: string; provider: string; operationId: string; accountId: string; reserved: number; evidence: number; over: number};
const madeSchedules: string[] = [];
const madeOn: string[] = [];
test.afterEach(async () => {
  const accounts = madeOn.splice(0);
  const schedules = madeSchedules.splice(0);
  for (const accountId of accounts) await removeLedger(world.db, accountId);
  if (schedules.length) await world.db.query('delete from usage.rate_schedules where id = any($1::uuid[])', [schedules]);
});

/**
 * An overrun incident for the person's Account: a Job with an operation, a reservation of `reserved`, an evidence settlement of `evidence` above it, and the incident. Its
 * provider is its own (`provider`, or a name made for the incident), so it blocks no provider another test uses; the ledger rows and the schedule go after the test.
 */
async function makeIncident(owner: ForgedUser, spec: {reserved?: number; evidence?: number; provider?: string} = {}): Promise<MadeIncident> {
  const account = await world.accountOf(owner);
  const period = await currentOf(owner);
  const reserved = spec.reserved ?? 1_000_000;
  const evidence = spec.evidence ?? reserved + 750_000;
  const provider = spec.provider ?? `e2e-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const schedule = (
    await world.db.query(
      `insert into usage.rate_schedules (provider, model, version, api_version, currency, input_rate_num, input_rate_den, output_rate_num, output_rate_den, request_rate_num, request_rate_den,
                                         input_increment, output_increment, multiplier_num, multiplier_den)
       values ($1, 'e2e-model', 1, 'e2e-1', 'USD', 1, 1, 1, 1, 0, 1, 1, 1, 1, 1) returning id`,
      [provider],
    )
  ).rows[0].id as string;
  madeSchedules.push(schedule);
  madeOn.push(account.id);
  const job = await ledgerJob(world.db, account.id, 1);
  const reservation = await insertReservation(world.db, {accountId: account.id, periodId: period.id, jobId: job.jobId, operationId: job.operationIds[0], amount: reserved, scheduleId: schedule});
  const settlement = await insertSettlement(world.db, {accountId: account.id, reservationId: reservation, periodId: period.id, classification: 'evidence', settled: evidence});
  const id = await insertIncident(world.db, {accountId: account.id, reservationId: reservation, settlementId: settlement});
  return {id, provider, operationId: job.operationIds[0], accountId: account.id, reserved, evidence, over: evidence - reserved};
}
/** The incident's row: when it was cleared and by whom (null while it is open); undefined once it is gone. */
const incidentRow = async (id: string) =>
  (await world.db.query('select cleared_at, cleared_by from usage.overrun_incidents where id = $1', [id])).rows[0] as {cleared_at: Date | null; cleared_by: string | null} | undefined;
/** The clearing, as another window (or anything but the page) would have made it: the owner writes the one change an incident allows. No audit event comes with it. */
const clearAsOwner = (id: string, by: ForgedUser) => world.db.query('update usage.overrun_incidents set cleared_at = clock_timestamp(), cleared_by = $2 where id = $1', [id, actorOf(by)]);
/** When the incident was recorded, as the page writes it (UTC, to the minute). */
const whenOf = async (id: string) => (await world.db.query(`select to_char(created_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') as at from usage.overrun_incidents where id = $1`, [id])).rows[0].at as string;

const incidentCard = (page: Page, incident: {provider: string}) => page.locator('.usage-incident').filter({hasText: incident.provider});
const incidentsHeading = (page: Page, locale: Locale = 'en') => page.getByRole('heading', {level: 2, name: t(locale, 'usage.incidents.title')});
const clearButton = (item: Locator, locale: Locale = 'en') => item.getByRole('button', {name: t(locale, 'usage.incident.clear.button')});
const clearLabel = async (locale: Locale, incident: MadeIncident) => t(locale, 'usage.incident.clear.label', {provider: isolateLtr(incident.provider), operation: isolateLtr(incident.operationId.slice(0, 8)), when: isolateLtr(await whenOf(incident.id))});
const confirmClear = (page: Page, locale: Locale = 'en') => dialog(page).getByRole('button', {name: t(locale, 'usage.incident.clear.confirm'), exact: true});
const clearedMessage = (locale: Locale, incident: {provider: string}) => t(locale, 'usage.incident.done', {provider: isolateLtr(incident.provider)});
/** The message above the incidents (where an answer goes when the card's own control is gone), not a card's. */
const aboveIncidents = (page: Page, locale: Locale = 'en') => page.locator('.settings-section').filter({has: incidentsHeading(page, locale)}).locator(':scope > .invite-notice');
/** Review and clear, then the confirming button of its dialog, the way a person does. */
async function clearThroughDialog(page: Page, item: Locator, locale: Locale = 'en') {
  await clearButton(item, locale).click();
  await confirmClear(page, locale).click();
}
type IncidentFacts = {account: string; operation: string; reserved: string; reported: string; over: string; recorded: string; cleared?: string; clearedBy?: string};
/** What an incident's card says, read from its terms and their values, in the page's language. */
async function incidentFacts(item: Locator, locale: Locale = 'en'): Promise<IncidentFacts> {
  const pairs = await item.locator('dl.usage-incident-meta > div').evaluateAll((divs) => divs.map((div) => [div.querySelector('dt')!.textContent!.trim(), div.querySelector('dd')!.textContent!.trim()] as const));
  const byName = new Map(pairs);
  const value = (key: MessageKey) => byName.get(t(locale, key));
  return {
    account: value('usage.incident.row.account') ?? '',
    operation: value('usage.incident.row.operation') ?? '',
    reserved: value('usage.incident.row.reserved') ?? '',
    reported: value('usage.incident.row.evidence') ?? '',
    over: value('usage.incident.row.over') ?? '',
    recorded: value('usage.incident.row.when') ?? '',
    ...(value('usage.incident.row.clearedAt') ? {cleared: value('usage.incident.row.clearedAt'), clearedBy: value('usage.incident.row.clearedBy')} : {}),
  };
}

// The page ---------------------------------------------------------------------------------------------------------------------------------

const card = (page: Page, email: string) => page.locator('.usage-item').filter({hasText: email});
const dialog = (page: Page) => page.getByRole('dialog');
const limitField = (page: Page, email: string, locale: Locale = 'en') => page.getByLabel(t(locale, 'usage.change.label', {name: email}), {exact: true});
const changeButton = (page: Page, email: string, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'usage.change.submitLabel', {name: email})});
const resetButton = (page: Page, email: string, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'usage.reset.label', {name: email})});
const stepUpLink = (page: Page, locale: Locale = 'en') => page.getByRole('link', {name: t(locale, 'invitations.confirm.action')});
const meter = (item: Locator) => item.getByRole('meter');
/** The messages a card shows in answer to something the person did (not Next.js's own empty route announcer, which is also an alert). */
const alertsIn = (item: Locator) => item.locator('.notice[role="alert"]');
const listHeading = (page: Page, locale: Locale = 'en') => page.getByRole('heading', {level: 2, name: t(locale, 'usage.list.title')});
const stateBadge = (item: Locator, locale: Locale, state: 'under' | 'nearly' | 'reached') => item.locator('.status-badge').filter({hasText: new RegExp(`^${t(locale, `usage.state.${state}`)}$`)});

type Shown = {month: string; limit: number; settled: number; reserved: number; available: number; over: number; began: string};

/** What the card says, read from its terms and their values, in the page's language. */
async function shown(item: Locator, locale: Locale = 'en'): Promise<Shown> {
  const pairs = await item.locator('dl.usage-meta > div').evaluateAll((divs) => divs.map((div) => [div.querySelector('dt')!.textContent!.trim(), div.querySelector('dd')!.textContent!.trim()] as const));
  const byName = new Map(pairs);
  const value = (key: MessageKey) => byName.get(t(locale, key));
  return {
    month: value('usage.row.month') ?? '',
    limit: microdollars(value('usage.row.limit')!),
    settled: microdollars(value('usage.row.settled')!),
    reserved: microdollars(value('usage.row.reserved')!),
    available: microdollars(value('usage.row.available')!),
    over: value('usage.row.over') ? microdollars(value('usage.row.over')!) : 0,
    began: value('usage.row.began') ?? '',
  };
}
/** The four amounts reconcile: settled + reserved + available is the limit, or, over it, the limit + the amount over is what is used. */
function expectReconciled(figures: Shown) {
  if (figures.over > 0) {
    expect(figures.available, 'nothing is available over the limit').toBe(0);
    expect(figures.limit + figures.over).toBe(figures.settled + figures.reserved);
  } else {
    expect(figures.settled + figures.reserved + figures.available).toBe(figures.limit);
  }
}
/**
 * The accessibility run, once the document has its title. A Server Action's refresh swaps the page's head, and for a moment the document has no
 * title element; an axe run in that moment reports a missing title that no person would see. (A title that never comes back fails here, by name.)
 */
async function axe(page: Page, locale: Locale = 'en') {
  await expect(page).toHaveTitle(`${t(locale, 'meta.usage')} · nova3D`, crossing);
  return violations(page);
}
/** A message about a typed limit, as the page writes it: the bounds of a limit are filled in by the one formatter and isolated left to right. */
const problemText = (locale: Locale, key: MessageKey) => t(locale, key, {min: isolateLtr(dollars(0)), max: isolateLtr(dollars(10_000_000_000))});
const doneMessage = (locale: Locale, email: string, limit: number) => t(locale, 'usage.change.done', {name: email, limit: isolateLtr(dollars(limit))});

/** Types a limit and presses Change limit. */
async function changeTo(page: Page, email: string, typed: string, locale: Locale = 'en') {
  await limitField(page, email, locale).fill(typed);
  await changeButton(page, email, locale).click();
}
/** Resets through the dialog, the way a person does: Reset count, then the confirming button. */
async function resetThroughDialog(page: Page, email: string, locale: Locale = 'en') {
  await resetButton(page, email, locale).click();
  await dialog(page).getByRole('button', {name: t(locale, 'usage.reset.confirm')}).click();
}
/** The ID of the command a Server Action request carries (the multipart body names its fields `<n>_commandId`). */
const commandIdOf = (postData: string | null) => /name="_?\d+_commandId"\r?\n\r?\n([0-9a-f-]{36})/.exec(postData ?? '')?.[1] ?? null;

// ---------------------------------------------------------------------------------------------------
test.describe('who may open the page', () => {
  test('a member gets the 404 page, titled as a page that does not exist, with no card, no control and no link to it', async ({page, context, baseURL}) => {
    const user = await member();
    await signIn(context, baseURL!, user);
    for (const url of [path, '/admin']) {
      const response = await page.goto(url);
      expect(response?.status(), url).toBe(404);
      await expect(page.getByRole('heading', {level: 1, name: t('en', 'notFound.title')})).toBeVisible();
      await expect(page).toHaveTitle(`${t('en', 'meta.notFound')} · nova3D`);
      await expect(page.locator('.usage-item')).toHaveCount(0);
      await expect(page.getByRole('button', {name: new RegExp(t('en', 'usage.change.submit'))})).toHaveCount(0);
    }
    await page.goto('/settings');
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  });

  test('a signed-out visitor is sent to sign in', async ({page, baseURL}) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/login`));
  });

  test('the Administrator finds it from the Administration index as its fourth section, and Back leads up one level at a time', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await signIn(context, baseURL!, user);
    await page.goto('/admin');
    await expect(page.getByRole('heading', {level: 2})).toHaveText([t('en', 'admin.invitations.title'), t('en', 'admin.accounts.title'), t('en', 'admin.operations.title'), t('en', 'admin.usage.title')]);
    await expect(page.getByText(t('en', 'admin.usage.help'))).toBeVisible();
    await page.getByRole('link', {name: t('en', 'admin.usage.open')}).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, crossing);
    await expect(page.getByRole('heading', {level: 1, name: t('en', 'usage.title')})).toBeVisible();
    await expect(page).toHaveTitle(`${t('en', 'meta.usage')} · nova3D`);
    await expect(page.locator('.back-link')).toHaveAttribute('href', '/admin');
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(`${baseURL}/admin`, crossing);
    await expect(page.locator('.back-link')).toHaveAttribute('href', '/settings');
  });

  test('an Administrator whose Account is disabled, or whose authority changed, is sent away from the page and sees nothing of it', async ({page, context, baseURL}) => {
    const user = await administrator(page, context, baseURL!, {marker: true});
    await world.setStatus(user, 'disabled');
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?error=/, crossing);
    await expect(page.locator('.usage-item')).toHaveCount(0);
    await world.setStatus(user, 'active');
    // A fresh grant under the new epoch is needed after a re-enable; the old session stays out.
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?error=/, crossing);
  });

  test('an Administrator who stopped being one while the page was open is denied, audited as denied, and nothing is appended', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await administrator(page, context, baseURL!, {marker: true});
    await world.db.query(`update identity.accounts set role = 'member' where user_id = $1`, [user.id]);
    await changeTo(page, person.email, '40');
    await expect(alertOf(page).filter({hasText: t('en', 'usage.error.denied')})).toBeVisible(crossing);
    expect(await periodsOf(person)).toHaveLength(1);
    expect(await world.auditBy(actorOf(user), 'usage.denied')).toEqual([expect.objectContaining({target: await targetOf(person)})]);
    expect(await world.auditBy(actorOf(user), 'usage.limit_changed')).toEqual([]);
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the cards', () => {
  test('show each Account with its month, limit, settled, reserved and available, its state as a word and a shape, and a meter with a text equivalent', async ({page, context, baseURL}) => {
    const person = await member();
    const problems = watchForProblems(page);
    const user = await administrator(page, context, baseURL!, {marker: false, preauthorized: true});
    const month = await currentMonth();

    const mine = card(page, person.email);
    await expect(mine).toBeVisible();
    await expect(mine.getByRole('heading', {level: 3})).toHaveText(person.email);
    await expect(mine).toContainText(t('en', 'usage.row.role.member'));
    await expect(mine.locator('dt')).toHaveText(['usage.row.month', 'usage.row.limit', 'usage.row.settled', 'usage.row.reserved', 'usage.row.available', 'usage.row.began'].map((key) => t('en', key as MessageKey)));
    expect(await shown(mine)).toEqual({month, limit: 25_000_000, settled: 0, reserved: 0, available: 25_000_000, over: 0, began: t('en', 'usage.cause.initial')});
    await expect(mine.locator('time')).toHaveAttribute('datetime', `${month}-01`);
    // A word and a shape, not a colour.
    const badge = stateBadge(mine, 'en', 'under');
    await expect(badge).toBeVisible();
    await expect(badge.locator('svg')).toHaveCount(1);
    await expect(mine).toContainText(t('en', 'usage.state.under.note'));
    // The meter: a name that names the Account, its value, and the same thing as text.
    const gauge = meter(mine);
    await expect(gauge).toHaveAttribute('aria-label', t('en', 'usage.meter.label', {name: person.email}));
    await expect(gauge).toHaveAttribute('aria-valuemin', '0');
    await expect(gauge).toHaveAttribute('aria-valuemax', '100');
    await expect(gauge).toHaveAttribute('aria-valuenow', '0');
    const text = t('en', 'usage.meter.text', {used: isolateLtr('$0.00'), limit: isolateLtr('$25.00'), settled: isolateLtr('$0.00'), reserved: isolateLtr('$0.00'), available: isolateLtr('$25.00')});
    await expect(gauge).toHaveAttribute('aria-valuetext', text);
    await expect(mine.locator('.usage-meter-text')).toHaveText(text);

    // The Administrator's own Account is listed, with $50.00.
    const own = card(page, user.email);
    await expect(own).toContainText(t('en', 'usage.row.role.administrator'));
    expect(await shown(own)).toMatchObject({limit: 50_000_000, available: 50_000_000});

    // Nothing of a Workspace or a Project is on the page: not its ID, not a word for one.
    const html = await page.content();
    for (const workspace of [await world.workspaceIdOf(person), await world.workspaceIdOf(user)]) expect(html).not.toContain(workspace!);
    expect(html).not.toMatch(/workspace_id|workspaces/i);
    expect(problems).toEqual([]);
  });

  test('give every Account its own names: a field, a Change limit and a Reset count button, and a meter, each naming the Account', async ({page, context, baseURL}) => {
    const first = await member();
    const second = await member();
    await administrator(page, context, baseURL!, {marker: false});
    for (const person of [first, second]) {
      await expect(limitField(page, person.email)).toHaveCount(1);
      await expect(changeButton(page, person.email)).toHaveCount(1);
      await expect(resetButton(page, person.email)).toHaveCount(1);
      await expect(page.getByRole('meter', {name: t('en', 'usage.meter.label', {name: person.email})})).toHaveCount(1);
      // Each button's visible text is inside its accessible name (label in name).
      await expect(changeButton(page, person.email)).toContainText(t('en', 'usage.change.submit'));
      await expect(resetButton(page, person.email)).toContainText(t('en', 'usage.reset.button'));
    }
    // The two Accounts' names differ, so no two controls of these cards share one.
    const names = await page.locator('.usage-item').filter({hasText: first.email}).or(page.locator('.usage-item').filter({hasText: second.email})).locator('[aria-label]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    expect(new Set(names).size).toBe(names.length);
  });

  test('show under, nearly and reached at their edges against $25.00, with the amounts reconciling and the meter in step (19,999,999 / 20,000,000 / 24,999,999 / 25,000,000)', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: false});
    const cases = [
      {settled: 0, reserved: 0, state: 'under', percent: 0},
      {settled: 19_999_999, reserved: 0, state: 'under', percent: 79},
      {settled: 20_000_000, reserved: 0, state: 'nearly', percent: 80},
      {settled: 15_000_000, reserved: 5_000_000, state: 'nearly', percent: 80},
      {settled: 24_999_999, reserved: 0, state: 'nearly', percent: 99},
      {settled: 25_000_000, reserved: 0, state: 'reached', percent: 100},
      {settled: 0, reserved: 25_000_000, state: 'reached', percent: 100},
      {settled: 10_000_000, reserved: 2_000_000, state: 'under', percent: 48},
      {settled: 30_000_000, reserved: 5_000_000, state: 'reached', percent: 100},
    ] as const;
    for (const { settled, reserved, state, percent } of cases) {
      await setFigures(person, settled, reserved);
      await page.reload();
      const mine = card(page, person.email);
      await expect(mine).toBeVisible();
      await expect(mine, `${settled}/${reserved}`).toHaveAttribute('data-state', state);
      await expect(stateBadge(mine, 'en', state)).toBeVisible();
      await expect(mine).toContainText(t('en', `usage.state.${state}.note`));
      const figures = await shown(mine);
      expect(figures, `${settled}/${reserved}`).toMatchObject({limit: 25_000_000, settled, reserved});
      expectReconciled(figures);
      await expect(meter(mine)).toHaveAttribute('aria-valuenow', String(percent));
      if (settled + reserved > 25_000_000) {
        expect(figures.over).toBe(settled + reserved - 25_000_000);
        await expect(mine).toContainText(t('en', 'usage.row.over'));
        await expect(mine.locator('.usage-meter-text')).toContainText(dollars(figures.over));
      } else {
        await expect(mine.locator('dt').filter({hasText: t('en', 'usage.row.over')})).toHaveCount(0);
      }
    }
  });

  test('say, when the limit is reached, that new paid work is blocked, that running work finishes and that disabling still cancels it', async ({page, context, baseURL}) => {
    const person = await member();
    await setFigures(person, 25_000_000);
    await administrator(page, context, baseURL!, {marker: false});
    const mine = card(page, person.email);
    const note = mine.locator('.usage-note');
    await expect(note).toHaveText(t('en', 'usage.state.reached.note'));
    await expect(note).toContainText('blocked');
    await expect(note).toContainText('already running finishes');
    await expect(note).toContainText('Disabling the Account still cancels it');
    // The same Account, nearly at its limit, is not blocked.
    await setFigures(person, 21_000_000);
    await page.reload();
    await expect(card(page, person.email).locator('.usage-note')).toHaveText(t('en', 'usage.state.nearly.note'));
    await expect(card(page, person.email).locator('.usage-note')).not.toContainText('blocked');
  });

  test('a limit of $0 is reached, whatever is used, and the meter is full; the amounts still reconcile', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    await changeTo(page, person.email, '0');
    const mine = card(page, person.email);
    await expect(mine.locator('.notice-success')).toContainText(doneMessage('en', person.email, 0), crossing);
    await expect(mine).toHaveAttribute('data-state', 'reached');
    await expect(stateBadge(mine, 'en', 'reached')).toBeVisible();
    const figures = await shown(mine);
    expect(figures).toMatchObject({limit: 0, settled: 0, reserved: 0, available: 0, over: 0});
    expectReconciled(figures);
    await expect(meter(mine)).toHaveAttribute('aria-valuenow', '100');
    expect(await periodsOf(person)).toEqual([expect.objectContaining({seq: 1, limit: 25_000_000}), expect.objectContaining({seq: 2, cause: 'change', limit: 0, previous_limit: 25_000_000})]);
    // Anything used against it is over the limit.
    await setFigures(person, 1_500, 0);
    await page.reload();
    const over = await shown(card(page, person.email));
    expect(over).toMatchObject({limit: 0, settled: 1_500, available: 0, over: 1_500});
    expectReconciled(over);
    await expect(card(page, person.email).locator('dd').filter({hasText: '$0.0015'}).first()).toBeVisible();
  });

  test('a disabled Account at its limit stays readable and has no controls, only the note; disabling it from the Accounts page behaves as it always did', async ({page, context, baseURL}) => {
    const person = await member();
    await setFigures(person, 26_000_000, 1_000_000);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const mine = card(page, person.email);
    await expect(mine).toHaveAttribute('data-state', 'reached');
    await expect(changeButton(page, person.email)).toBeVisible();

    // Disabled on the Accounts page (Story 1.5), through its dialog: nothing about that changes.
    await page.goto('/admin/accounts');
    await hydrated(page, 'main form button');
    const accountRow = page.locator('.invite-item').filter({hasText: person.email});
    await accountRow.getByRole('button', {name: t('en', 'accounts.row.disableLabel', {name: person.email})}).click();
    await page.getByRole('dialog').getByRole('button', {name: t('en', 'accounts.disable.confirm')}).click();
    await expect(accountRow.locator('.status-badge').filter({hasText: t('en', 'accounts.status.disabled')})).toBeVisible(crossing);
    expect(await world.accountOf(person)).toMatchObject({status: 'disabled', epoch: 2});
    expect(await world.auditEvents('account.disabled', await targetOf(person))).toEqual([expect.objectContaining({actor: actorOf(user)})]);

    // Its usage is still readable, as it was, and its limit cannot be changed until it is enabled again.
    await open(page);
    const after = card(page, person.email);
    await expect(after).toHaveAttribute('data-state', 'reached');
    expect(await shown(after)).toMatchObject({limit: 25_000_000, settled: 26_000_000, reserved: 1_000_000, available: 0, over: 2_000_000});
    await expect(after).toContainText(t('en', 'usage.row.disabled'));
    await expect(after.locator('.usage-disabled-note')).toHaveText(t('en', 'usage.row.disabledNote'));
    await expect(limitField(page, person.email)).toHaveCount(0);
    await expect(changeButton(page, person.email)).toHaveCount(0);
    await expect(resetButton(page, person.email)).toHaveCount(0);
    expect(await periodsOf(person)).toHaveLength(1);
  });

  test('an Account disabled while the page is open is told it is disabled when the Administrator tries to change it, above the list, with focus on the list; nothing is appended and the page catches up', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    await expect(changeButton(page, person.email)).toBeVisible();
    await world.setStatus(person, 'disabled');
    await changeTo(page, person.email, '40');
    // The card's controls are gone once the page catches up, so the answer is the list's, not the card's.
    const said = t('en', 'usage.error.disabled', {name: person.email});
    await expect(page.locator('.settings-section > .invite-notice .notice-warning').filter({hasText: said})).toBeVisible(crossing);
    await expect(announcer(page)).toHaveText(said);
    await expect(listHeading(page)).toBeFocused();
    await expect(card(page, person.email).locator('.usage-disabled-note')).toBeVisible(crossing);
    await expect(limitField(page, person.email)).toHaveCount(0);
    expect(await periodsOf(person)).toHaveLength(1);
    expect(await world.auditEvents('usage.limit_changed', await targetOf(person))).toEqual([]);
  });

  test('a reset of an Account disabled while the page is open says the same', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    await expect(resetButton(page, person.email)).toBeVisible();
    await world.setStatus(person, 'disabled');
    await resetThroughDialog(page, person.email);
    await expect(page.locator('.settings-section > .invite-notice .notice-warning').filter({hasText: t('en', 'usage.error.disabled', {name: person.email})})).toBeVisible(crossing);
    await expect(listHeading(page)).toBeFocused();
    expect(await periodsOf(person)).toHaveLength(1);
  });

  test('an Account that no longer exists is not found, said above the list with focus on it; nothing is appended and the card goes', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    await expect(card(page, person.email)).toBeVisible();
    await world.eraseAccount(person);
    await changeTo(page, person.email, '40');
    const said = t('en', 'usage.error.notFound', {name: person.email});
    await expect(page.locator('.settings-section > .invite-notice .notice-warning').filter({hasText: said})).toBeVisible(crossing);
    await expect(announcer(page)).toHaveText(said);
    await expect(card(page, person.email)).toHaveCount(0, crossing);
    await expect(listHeading(page)).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('without a fresh sign-in', () => {
  for (const marker of [false, 'expired', 'another class'] as const) {
    test(`a change and a reset are refused, nothing is appended, the step-up is offered, and the refusal is audited once (${marker === false ? 'no marker' : marker === 'expired' ? 'a marker that ran out' : 'only a marker of another class'})`, async ({page, context, baseURL}) => {
      const person = await member();
      const user = await administrator(page, context, baseURL!, {marker: marker === 'expired' ? 'expired' : false});
      if (marker === 'another class') await world.forgeMarker(user, user.sessionId, {actionClass: 'owner_deletion'});
      const actor = actorOf(user);
      const target = await targetOf(person);
      const before = await periodsOf(person);
      // Offered beforehand, as a link to the step-up for administration: the server picks where it returns to.
      await expect(stepUpLink(page)).toHaveAttribute('href', '/step-up?for=administration');
      await expect(page.locator('.notice-warning').filter({hasText: t('en', 'usage.confirm.needed')})).toBeVisible();
      await expect(page.locator('.notice-success')).toHaveCount(0);

      // Change limit.
      await changeTo(page, person.email, '40');
      const mine = card(page, person.email);
      const refused = alertsIn(mine).filter({hasText: t('en', 'usage.error.needsConfirm')});
      await expect(refused).toBeVisible(crossing);
      await expect(refused.getByRole('link', {name: t('en', 'invitations.confirm.action')})).toHaveAttribute('href', '/step-up?for=administration');
      // What was typed is still there, and nothing changed.
      await expect(limitField(page, person.email)).toHaveValue('40');
      expect(await periodsOf(person)).toEqual(before);
      expect(await world.auditBy(actor, 'usage.limit_refused')).toEqual([expect.objectContaining({actor, action: 'usage.limit_refused', target})]);

      // Pressing again is the same refusal and the same one audit event: once an hour.
      await changeButton(page, person.email).click();
      await expect(refused).toBeVisible();
      expect(await world.auditBy(actor, 'usage.limit_refused')).toHaveLength(1);

      // Reset count, confirmed in the dialog: refused the same way, in the same card, and still one audit event for this actor and Account.
      await resetThroughDialog(page, person.email);
      await expect(alertsIn(mine).filter({hasText: t('en', 'usage.error.needsConfirm')})).toHaveCount(2, crossing);
      expect(await periodsOf(person)).toEqual(before);
      expect(await world.auditBy(actor, 'usage.limit_refused')).toHaveLength(1);
      expect(await world.auditEvents('usage.limit_changed', target)).toEqual([]);
      expect(await world.auditEvents('usage.limit_reset', target)).toEqual([]);
    });
  }

  test('the link goes to the existing step-up, which says what is being confirmed and whose "Not now" returns to the Administration index, as before', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await administrator(page, context, baseURL!, {marker: false});
    await changeTo(page, person.email, '40');
    await alertsIn(card(page, person.email)).getByRole('link', {name: t('en', 'invitations.confirm.action')}).click();
    await expect(page).toHaveURL(`${baseURL}${stepUpUrl('administration')}`, crossing);
    await expect(page.getByText(t('en', 'stepUp.reason.administration'))).toBeVisible();
    await expect(page.getByText(t('en', 'stepUp.signedInAs', {email: user.email}))).toBeVisible();
    await expect(page.getByRole('link', {name: t('en', 'stepUp.cancel')})).toHaveAttribute('href', '/admin');
    expect(await periodsOf(person)).toHaveLength(1);
  });

  test('a fresh sign-in that runs out while the page is open re-reads the page: the green note gives way to the step-up note, and nothing is appended', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await administrator(page, context, baseURL!, {marker: true});
    await expect(page.locator('.notice-success').filter({hasText: t('en', 'usage.confirm.ok')})).toBeVisible();
    await expect(stepUpLink(page)).toHaveCount(0);
    await world.expireMarker(user.sessionId);
    await changeTo(page, person.email, '40');
    await expect(alertsIn(card(page, person.email)).filter({hasText: t('en', 'usage.error.needsConfirm')})).toBeVisible(crossing);
    await expect(page.locator('.notice-warning').filter({hasText: t('en', 'usage.confirm.needed')})).toBeVisible(crossing);
    await expect(page.locator('.notice-success').filter({hasText: t('en', 'usage.confirm.ok')})).toHaveCount(0);
    expect(await periodsOf(person)).toHaveLength(1);
  });

  test.describe('with the fake Google', () => {
    let fakeActive = false;
    test.beforeAll(async () => {
      fakeActive = await fakeGoogleActive(world.stack.apiUrl);
      if (!fakeActive && process.env.CI) throw new Error('The fake Google is not running, or the stack\'s Auth is not swapped to use it, so this flow cannot run. CI swaps it in with `npm run fake-google:up` before the browser tests.');
    });
    test.beforeEach(() => {
      test.skip(!fakeActive, 'The fake Google is not active. Run `npm run fake-google:up` against the local stack to run this flow.');
    });

    for (const locale of ['en', 'he'] as const) {
      test(`a real step-up from this page returns to the Administration index, and the change then works for five minutes (${locale})`, async ({page, context, baseURL}) => {
        const tag = randomUUID().slice(0, 8);
        const user = await world.signedInUser({email: `usage-${tag}@example.test`, subject: `google-${randomUUID()}`});
        await world.activate(user);
        await world.makeAdministrator(user);
        await addFakeAccount({email: user.email, sub: user.subject, name: `Usage ${tag}`});
        const person = await member();
        await signIn(context, baseURL!, user, {locale, theme: locale === 'he' ? 'dark' : 'light'});
        await open(page);

        // Not fresh: refused, and the link is the way to a fresh sign-in.
        await changeTo(page, person.email, '40', locale);
        const refused = alertsIn(card(page, person.email)).filter({hasText: t(locale, 'usage.error.needsConfirm')});
        await expect(refused).toBeVisible(crossing);
        expect(await periodsOf(person)).toHaveLength(1);
        await refused.getByRole('link', {name: t(locale, 'invitations.confirm.action')}).click();
        await expect(page).toHaveURL(`${baseURL}${stepUpUrl('administration')}`, crossing);
        await hydrated(page, 'main button[type="submit"], main a[href]');
        await page.getByRole('button', {name: new RegExp(`^(${t(locale, 'stepUp.continue')}|${t(locale, 'stepUp.pending')})$`)}).click();
        await expect(page).toHaveURL(chooserUrl, crossing);
        await chooserAccount(page, user.email).click();

        // Back on the Administration index (the class alone decides where to return), in the NEW session, which has the marker.
        await expect(page).toHaveURL(`${baseURL}/admin`, crossing);
        await expect(page.locator('.notice-success')).toContainText(t(locale, 'admin.confirm.ok'));
        await page.getByRole('link', {name: t(locale, 'admin.usage.open')}).click();
        await expect(page).toHaveURL(`${baseURL}${path}`, crossing);
        await expect(page.locator('.notice-success').filter({hasText: t(locale, 'usage.confirm.ok')})).toBeVisible();
        await expect(stepUpLink(page, locale)).toHaveCount(0);
        await hydrated(page, 'main form button');
        await changeTo(page, person.email, '40', locale);
        await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage(locale, person.email, 40_000_000), crossing);
        expect((await periodsOf(person)).map((period) => [period.seq, period.cause, period.limit])).toEqual([[1, 'initial', 25_000_000], [2, 'change', 40_000_000]]);
        // The same marker serves a second change inside its five minutes.
        await changeTo(page, person.email, '41', locale);
        await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage(locale, person.email, 41_000_000), crossing);
        expect(await periodsOf(person)).toHaveLength(3);
        // Five minutes later: refused again, and the step-up is offered again.
        const [marker] = await world.markersOf(user);
        await world.expireMarker(marker.session_id);
        await changeTo(page, person.email, '42', locale);
        await expect(alertsIn(card(page, person.email)).filter({hasText: t(locale, 'usage.error.needsConfirm')})).toBeVisible(crossing);
        expect(await periodsOf(person)).toHaveLength(3);
        expect(await world.auditBy(actorOf(user), 'usage.limit_refused')).toHaveLength(1);
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('changing a limit', () => {
  test('appends a successor period that carries what was counted, leaves every earlier row as it was, and writes one audit event', async ({page, context, baseURL}) => {
    const person = await member();
    // 10M settled and 2M reserved against the $25.00 limit, in the stand-in for the ledgers.
    await setFigures(person, 10_000_000, 2_000_000);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const target = await targetOf(person);
    const first = (await periodsOf(person))[0];
    expect(await shown(card(page, person.email))).toMatchObject({limit: 25_000_000, settled: 10_000_000, reserved: 2_000_000, available: 13_000_000});

    await changeTo(page, person.email, '40');
    const mine = card(page, person.email);
    await expect(mine.locator('.notice-success')).toContainText(doneMessage('en', person.email, 40_000_000), crossing);
    await expect(announcer(page)).toHaveText(doneMessage('en', person.email, 40_000_000));
    // The card shows the new limit, still counting everything so far: 40M - (10M + 2M) = 28M available.
    await expect(limitField(page, person.email)).toHaveValue('');
    await expect.poll(async () => (await shown(card(page, person.email))).limit, crossing).toBe(40_000_000);
    const figures = await shown(card(page, person.email));
    expect(figures).toMatchObject({limit: 40_000_000, settled: 10_000_000, reserved: 2_000_000, available: 28_000_000, over: 0, began: t('en', 'usage.cause.change')});
    expectReconciled(figures);

    // In the database: the old row untouched, the successor carrying the liabilities, and who/when/old/new on the row itself.
    const periods = await periodsOf(person);
    expect(periods).toHaveLength(2);
    expect(periods[0]).toEqual(first);
    expect(periods[1]).toMatchObject({seq: 2, cause: 'change', limit: 40_000_000, previous_limit: 25_000_000, carried_settled: 10_000_000, carried_reserved: 2_000_000, actor: actorOf(user), month_start: `${await currentMonth()}-01`});
    expect(periods[1].command_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(periods[1].created_at.getTime()).toBeGreaterThan(first.created_at.getTime());
    expect(await world.auditEvents('usage.limit_changed', target)).toEqual([{actor: actorOf(user), action: 'usage.limit_changed', target}]);
    // The trail holds the actor, the action, the opaque target and the time: no address, no amount.
    const trail = JSON.stringify((await world.db.query(`select * from identity.audit_events where target = $1 and action like 'usage.%'`, [target])).rows);
    expect(trail).not.toContain(person.email);
    expect(trail).not.toMatch(/40000000|40\.00/);

    // A second change, with cents: the next period, the earlier two untouched.
    await changeTo(page, person.email, '40.50');
    await expect.poll(async () => (await periodsOf(person)).length, crossing).toBe(3);
    const third = (await periodsOf(person))[2];
    expect(third).toMatchObject({seq: 3, cause: 'change', limit: 40_500_000, previous_limit: 40_000_000, carried_settled: 10_000_000, carried_reserved: 2_000_000});
    expect((await periodsOf(person)).slice(0, 2)).toEqual(periods);
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 40_500_000), crossing);
    expect(await world.auditEvents('usage.limit_changed', target)).toHaveLength(2);
  });

  test('accepts the ceiling and a single cent, in the ways a person writes them', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    for (const [typed, expected] of [['10000', 10_000_000_000], ['0.01', 10_000], ['$1,234.50', 1_234_500_000], ['12.340', 12_340_000]] as const) {
      await changeTo(page, person.email, typed);
      await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, expected), crossing);
      await expect.poll(async () => (await currentOf(person)).limit, crossing).toBe(expected);
    }
    expect(await periodsOf(person)).toHaveLength(5);
    await expect(card(page, person.email).locator('dd').filter({hasText: '$12.34'}).first()).toBeVisible();
  });

  test('lowering a limit below what is used is accepted: the Account is at its limit, with the amount over shown, and nothing already used is touched', async ({page, context, baseURL}) => {
    const person = await member();
    await setFigures(person, 20_000_000);
    await administrator(page, context, baseURL!, {marker: true});
    const mine = card(page, person.email);
    await expect(mine).toHaveAttribute('data-state', 'nearly');
    await changeTo(page, person.email, '10');
    await expect(mine.locator('.notice-success')).toContainText(doneMessage('en', person.email, 10_000_000), crossing);
    await expect(mine).toHaveAttribute('data-state', 'reached', crossing);
    const figures = await shown(mine);
    expect(figures).toMatchObject({limit: 10_000_000, settled: 20_000_000, reserved: 0, available: 0, over: 10_000_000});
    expectReconciled(figures);
    await expect(mine).toContainText(t('en', 'usage.row.over'));
    await expect(meter(mine)).toHaveAttribute('aria-valuenow', '100');
    expect(await periodsOf(person)).toEqual([expect.objectContaining({seq: 1, limit: 25_000_000}), expect.objectContaining({seq: 2, limit: 10_000_000, carried_settled: 20_000_000, carried_reserved: 0})]);
  });

  test('a change to the limit it already has is told so, appends nothing and writes no audit event', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    await changeTo(page, person.email, '25.00');
    const mine = card(page, person.email);
    await expect(mine.locator('.notice-info')).toContainText(t('en', 'usage.change.unchanged', {name: person.email, limit: isolateLtr('$25.00')}), crossing);
    expect(await periodsOf(person)).toHaveLength(1);
    expect(await world.auditEvents('usage.limit_changed', await targetOf(person))).toEqual([]);
    await expect(limitField(page, person.email)).toHaveValue('');
  });

  const invalid = [
    ['nothing', '', 'usage.error.empty'],
    ['spaces only', '   ', 'usage.error.empty'],
    ['more than whole cents', '12.345', 'usage.error.cents'],
    ['a negative amount', '-5', 'usage.error.negative'],
    ['text', 'abc', 'usage.error.format'],
    ['a word with digits', '40 dollars', 'usage.error.format'],
    ['over the ceiling', '10001', 'usage.error.range'],
    ['a cent over the ceiling', '10,000.01', 'usage.error.range'],
  ] as const;
  test('a limit that is not one is answered in the field, in the page\'s language, with the field focused, and nothing is sent', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await administrator(page, context, baseURL!, {marker: true});
    const posts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) posts.push(request.url());
    });
    const field = limitField(page, person.email);
    for (const [name, typed, key] of invalid) {
      await field.fill(typed);
      await changeButton(page, person.email).click();
      const problem = card(page, person.email).locator('.notice-danger[role="alert"]');
      await expect(problem, name).toHaveText(problemText('en', key), crossing);
      await expect(field, name).toBeFocused();
      await expect(field, name).toHaveAttribute('aria-invalid', 'true');
      // The message is the field's description, after the hint.
      const describedBy = (await field.getAttribute('aria-describedby'))!.split(' ');
      expect(describedBy, name).toHaveLength(2);
      expect(await page.locator(`[id="${describedBy[1]}"]`).textContent(), name).toContain(problemText('en', key));
      // Typing again takes the message away.
      await field.pressSequentially('1');
      await expect(problem, name).toHaveCount(0);
      await expect(field, name).not.toHaveAttribute('aria-invalid', 'true');
    }
    await page.waitForLoadState('networkidle');
    expect(posts, 'no request reached the server').toEqual([]);
    expect(await periodsOf(person)).toHaveLength(1);
    expect(await world.auditBy(actorOf(user), 'usage.limit_changed')).toEqual([]);
  });

  test('the same fields are answered in Hebrew, right to left', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true, locale: 'he', theme: 'dark'});
    for (const [typed, key] of [['', 'usage.error.empty'], ['12.345', 'usage.error.cents'], ['-5', 'usage.error.negative'], ['abc', 'usage.error.format'], ['10001', 'usage.error.range']] as const) {
      await limitField(page, person.email, 'he').fill(typed);
      await changeButton(page, person.email, 'he').click();
      await expect(card(page, person.email).locator('.notice-danger[role="alert"]')).toHaveText(problemText('he', key), crossing);
      expect(problemText('he', key)).not.toMatch(/[A-Za-z]{2,}/);
    }
    expect(await periodsOf(person)).toHaveLength(1);
  });

  test('shows Changing while it runs, takes one press to send one request, and sends one when it is double-clicked; one period is appended', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await administrator(page, context, baseURL!, {marker: true});
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
    const submit = changeButton(page, person.email);
    try {
      await limitField(page, person.email).fill('40');
      await submit.click();
      await expect(submit).toHaveAttribute('aria-disabled', 'true');
      await expect(submit).toHaveText(t('en', 'usage.change.pending'));
      await expect(card(page, person.email).getByRole('status').filter({hasText: t('en', 'usage.change.pendingStatus')})).toBeVisible();
      // Busy, but still the control that has focus: it is aria-disabled, not disabled. A second press does nothing.
      await submit.click({force: true});
      await submit.click({force: true});
    } finally {
      release();
    }
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 40_000_000), crossing);
    await page.waitForLoadState('networkidle');
    expect(posts, 'one request reached the server').toHaveLength(1);
    expect(await periodsOf(person)).toHaveLength(2);
    expect(await world.auditBy(actorOf(user), 'usage.limit_changed')).toHaveLength(1);
  });

  test('two windows at once: the second, which still shows the old period, is told the page was out of date, nothing is appended, and its page catches up so the next try works', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    const second = await context.newPage();
    await open(second);
    await expect(limitField(second, person.email)).toBeVisible();

    await changeTo(page, person.email, '40');
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 40_000_000), crossing);
    expect(await periodsOf(person)).toHaveLength(2);

    // The second window still has seq 1 in its form.
    await changeTo(second, person.email, '30');
    await expect(card(second, person.email).locator('.notice-warning')).toContainText(t('en', 'usage.error.stale', {name: person.email}), crossing);
    expect(await periodsOf(person)).toHaveLength(2);
    expect(await world.auditEvents('usage.limit_changed', await targetOf(person))).toHaveLength(1);
    // Its page caught up: the new limit is on it, and the same limit again is now a change.
    await expect.poll(async () => (await shown(card(second, person.email))).limit, crossing).toBe(40_000_000);
    await changeTo(second, person.email, '30');
    await expect(card(second, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 30_000_000), crossing);
    expect((await periodsOf(person)).map((period) => [period.seq, period.limit])).toEqual([[1, 25_000_000], [2, 40_000_000], [3, 30_000_000]]);
  });

  test('a reset from a window that shows an older period is stale too, and appends nothing', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    const second = await context.newPage();
    await open(second);
    await changeTo(page, person.email, '40');
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 40_000_000), crossing);
    await resetThroughDialog(second, person.email);
    await expect(card(second, person.email).locator('.notice-warning')).toContainText(t('en', 'usage.error.stale', {name: person.email}), crossing);
    expect(await periodsOf(person)).toHaveLength(2);
    expect(await world.auditEvents('usage.limit_reset', await targetOf(person))).toEqual([]);
  });

  test('keeps one command ID for a retry of the same command and makes a new one for the next, so a retry cannot be mistaken for a new command', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    const ids: (string | null)[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) ids.push(commandIdOf(request.postData()));
    });
    await changeTo(page, person.email, '40');
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 40_000_000), crossing);
    await changeTo(page, person.email, '41');
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 41_000_000), crossing);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
    expect((await periodsOf(person)).map((period) => period.command_id)).toEqual([null, ids[0], ids[1]]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('resetting the count', () => {
  test('asks first, in a dialog that starts on Cancel; Escape and Cancel change nothing; confirming appends a reset period that keeps what is reserved and the limit', async ({page, context, baseURL}) => {
    const person = await member();
    await setFigures(person, 10_000_000, 2_000_000);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const target = await targetOf(person);
    const first = (await periodsOf(person))[0];
    const reset = resetButton(page, person.email);
    await expect(reset).toHaveText(t('en', 'usage.reset.button'));

    await reset.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', {name: t('en', 'usage.reset.title')})).toBeVisible();
    await expect(dialog(page)).toContainText(person.email);
    // It starts on Cancel, so Enter does not reset by accident.
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(reset).toBeFocused();
    expect(await periodsOf(person)).toHaveLength(1);

    await reset.click();
    await dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')}).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await periodsOf(person)).toHaveLength(1);

    // The keyboard moves between the dialog's two buttons, and the page behind it is out of reach.
    await reset.click();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'usage.reset.confirm')})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'usage.reset.confirm')})).toBeFocused();

    await dialog(page).getByRole('button', {name: t('en', 'usage.reset.confirm')}).click();
    const mine = card(page, person.email);
    await expect(mine.locator('.notice-success')).toContainText(t('en', 'usage.reset.done', {name: person.email}), crossing);
    await expect(announcer(page)).toHaveText(t('en', 'usage.reset.done', {name: person.email}));
    // The count restarted: nothing settled, the 2M still reserved, the same limit: 25M - 2M = 23M available.
    await expect.poll(async () => (await shown(card(page, person.email))).settled, crossing).toBe(0);
    const figures = await shown(card(page, person.email));
    expect(figures).toMatchObject({limit: 25_000_000, settled: 0, reserved: 2_000_000, available: 23_000_000, over: 0, began: t('en', 'usage.cause.reset')});
    expectReconciled(figures);

    const periods = await periodsOf(person);
    expect(periods).toHaveLength(2);
    expect(periods[0]).toEqual(first);
    expect(periods[1]).toMatchObject({seq: 2, cause: 'reset', limit: 25_000_000, previous_limit: 25_000_000, carried_settled: 0, carried_reserved: 2_000_000, actor: actorOf(user)});
    expect(await world.auditEvents('usage.limit_reset', target)).toEqual([{actor: actorOf(user), action: 'usage.limit_reset', target}]);
    expect(await world.auditEvents('usage.limit_changed', target)).toEqual([]);
  });

  test('shows Resetting while it runs and sends one request when the dialog is confirmed and the button pressed again', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
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
    try {
      await resetThroughDialog(page, person.email);
      const busy = resetButton(page, person.email);
      await expect(busy).toHaveAttribute('aria-disabled', 'true');
      await expect(busy).toHaveText(t('en', 'usage.reset.pending'));
      await expect(card(page, person.email).getByRole('status').filter({hasText: t('en', 'usage.reset.pendingStatus')})).toBeVisible();
      await busy.click({force: true});
      await expect(dialog(page)).toHaveCount(0);
    } finally {
      release();
    }
    await expect(card(page, person.email).locator('.notice-success')).toContainText(t('en', 'usage.reset.done', {name: person.email}), crossing);
    await page.waitForLoadState('networkidle');
    expect(posts).toHaveLength(1);
    expect(await periodsOf(person)).toHaveLength(2);
  });

  test('a change after a reset keeps counting from the reset: what was settled before it stays out', async ({page, context, baseURL}) => {
    const person = await member();
    await setFigures(person, 10_000_000, 2_000_000);
    await administrator(page, context, baseURL!, {marker: true});
    await resetThroughDialog(page, person.email);
    await expect.poll(async () => (await periodsOf(person)).length, crossing).toBe(2);
    await expect(card(page, person.email).locator('.notice-success')).toContainText(t('en', 'usage.reset.done', {name: person.email}), crossing);
    await expect.poll(async () => (await shown(card(page, person.email))).settled, crossing).toBe(0);
    await changeTo(page, person.email, '40');
    await expect.poll(async () => (await periodsOf(person)).length, crossing).toBe(3);
    expect((await periodsOf(person))[2]).toMatchObject({seq: 3, cause: 'change', limit: 40_000_000, carried_settled: 0, carried_reserved: 2_000_000});
    await expect.poll(async () => (await shown(card(page, person.email))).available, crossing).toBe(38_000_000);
  });

  test('resets the same card twice in one page: each reset is its own command with its own ID, so the second is not answered as a reuse', async ({page, context, baseURL}) => {
    const person = await member();
    await setFigures(person, 10_000_000, 2_000_000);
    await administrator(page, context, baseURL!, {marker: true});
    const ids: (string | null)[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) ids.push(commandIdOf(request.postData()));
    });
    await resetThroughDialog(page, person.email);
    await expect(card(page, person.email).locator('.notice-success')).toContainText(t('en', 'usage.reset.done', {name: person.email}), crossing);
    await expect.poll(async () => (await periodsOf(person)).length, crossing).toBe(2);
    // The page has caught up with the new period (the forms carry the period they were made against), so the same mounted card now resets period 2.
    await expect(card(page, person.email).locator('input[name="expectedSeq"]').first()).toHaveValue('2', crossing);
    await resetThroughDialog(page, person.email);
    await expect.poll(async () => (await periodsOf(person)).length, crossing).toBe(3);
    await expect(card(page, person.email).locator('input[name="expectedSeq"]').first()).toHaveValue('3', crossing);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
    const periods = await periodsOf(person);
    expect(periods.map((period) => period.cause)).toEqual(['initial', 'reset', 'reset']);
    expect(periods.map((period) => period.command_id)).toEqual([null, ids[0], ids[1]]);
    // Neither was told it was out of date or reused.
    await expect(card(page, person.email).locator('.notice-warning')).toHaveCount(0);
    expect(await shown(card(page, person.email))).toMatchObject({settled: 0, reserved: 2_000_000, available: 23_000_000});
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('overrun incidents', () => {
  test('are listed with their provider, operation, reserved, reported and over amounts, when, and whether they are open or cleared and by whom, the open ones first', async ({page, context, baseURL}) => {
    const person = await member();
    const cleared = await makeIncident(person, {reserved: 30_000, evidence: 55_000});
    const open = await makeIncident(person);
    const problems = watchForProblems(page);
    const user = await administrator(page, context, baseURL!, {marker: false});
    await clearAsOwner(cleared.id, user);
    await page.reload();
    await hydrated(page, 'main form button');

    await expect(incidentsHeading(page)).toBeVisible();
    await expect(page.getByText(t('en', 'usage.incidents.help'))).toBeVisible();
    const mine = incidentCard(page, open);
    await expect(mine).toBeVisible();
    await expect(mine.getByRole('heading', {level: 3})).toHaveText(open.provider);
    expect(await incidentFacts(mine)).toEqual({account: person.email, operation: open.operationId, reserved: '$1.00', reported: '$1.75', over: '$0.75', recorded: await whenOf(open.id)});
    await expect(mine).toHaveAttribute('data-state', 'open');
    // A word and a shape, not a colour; and what it means for the provider.
    const badge = mine.locator('.status-badge').filter({hasText: new RegExp(`^${t('en', 'usage.incident.state.open')}$`)});
    await expect(badge).toBeVisible();
    await expect(badge.locator('svg')).toHaveCount(1);
    await expect(mine.locator('.usage-note')).toHaveText(t('en', 'usage.incident.state.open.note', {provider: isolateLtr(open.provider)}));
    // Review and clear names which incident it clears.
    await expect(clearButton(mine)).toHaveAttribute('aria-label', await clearLabel('en', open));

    const done = incidentCard(page, cleared);
    await expect(done).toHaveAttribute('data-state', 'cleared');
    expect(await incidentFacts(done)).toEqual({
      account: person.email,
      operation: cleared.operationId,
      reserved: '$0.03',
      reported: '$0.055',
      over: '$0.025',
      recorded: await whenOf(cleared.id),
      cleared: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
      clearedBy: user.email,
    });
    await expect(done.locator('.status-badge').filter({hasText: new RegExp(`^${t('en', 'usage.incident.state.cleared')}$`)})).toBeVisible();
    await expect(done.locator('.usage-note')).toHaveText(t('en', 'usage.incident.state.cleared.note', {provider: isolateLtr(cleared.provider)}));
    // Nothing is left to press on a cleared incident.
    await expect(done.getByRole('button')).toHaveCount(0);
    await expect(done.locator('form')).toHaveCount(0);

    // The open ones come first.
    const providers = await page.locator('.usage-incident h3').allInnerTexts();
    expect(providers.indexOf(open.provider)).toBeGreaterThanOrEqual(0);
    expect(providers.indexOf(open.provider)).toBeLessThan(providers.indexOf(cleared.provider));
    // The Accounts list is still there, after the incidents; nothing of a request, a key or a Project is on the page.
    expect((await page.locator('main section h2').allInnerTexts()).slice(0, 2)).toEqual([t('en', 'usage.incidents.title'), t('en', 'usage.list.title')]);
    const html = await page.content();
    expect(html).not.toMatch(/workspace_id|request_id|api[_-]?key|x-api-key/i);
    expect(problems).toEqual([]);
  });

  test('are cleared behind a confirmation that states the amounts and starts on Cancel; Escape and Cancel clear nothing; confirming clears once, audited, and the card becomes a cleared one', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const mine = incidentCard(page, incident);
    const actor = actorOf(user);
    const target = `incident:${incident.id}`;
    await expect(page.locator('.notice-success').filter({hasText: t('en', 'usage.confirm.ok')})).toBeVisible();

    // The dialog: what clearing does, with this incident's amounts; focus starts on Cancel.
    await clearButton(mine).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', {name: t('en', 'usage.incident.clear.title')})).toBeVisible();
    await expect(dialog(page)).toContainText(t('en', 'usage.incident.clear.body', {provider: isolateLtr(incident.provider), over: isolateLtr('$0.75'), reserved: isolateLtr('$1.00'), evidence: isolateLtr('$1.75')}));
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await clearButton(mine).click();
    await dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')}).click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
    expect(await world.auditEvents('usage.incident_cleared', target)).toEqual([]);

    // Confirm: cleared, said above the incidents with focus on their heading, and the card is a cleared one.
    await clearButton(mine).click();
    await confirmClear(page).click();
    const said = clearedMessage('en', incident);
    await expect(aboveIncidents(page).locator('.notice-success').filter({hasText: said})).toBeVisible(crossing);
    await expect(announcer(page)).toHaveText(said);
    await expect(incidentsHeading(page)).toBeFocused();
    await expect(mine).toHaveAttribute('data-state', 'cleared', crossing);
    await expect(mine.getByRole('button')).toHaveCount(0);
    const facts = await incidentFacts(mine);
    expect(facts.clearedBy).toBe(user.email);
    expect(facts.cleared).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // In the database: cleared once, by the Administrator, with one audit event in the same moment; nothing else about it changed.
    const row = await incidentRow(incident.id);
    expect(row?.cleared_by).toBe(actor);
    expect(row?.cleared_at).toBeInstanceOf(Date);
    expect(await world.auditEvents('usage.incident_cleared', target)).toEqual([{actor, action: 'usage.incident_cleared', target}]);
    expect(await world.auditBy(actor, 'usage.incident_refused')).toEqual([]);
    expect(await world.auditBy(actor, 'usage.denied')).toEqual([]);
    // The trail holds the actor, the action and the opaque target: no address, no provider, no amount.
    const trail = JSON.stringify((await world.db.query(`select * from identity.audit_events where target = $1`, [target])).rows);
    expect(trail).not.toContain(person.email);
    expect(trail).not.toContain(incident.provider);
    expect(trail).not.toMatch(/1750000|1\.75/);
  });

  test('shows Clearing while it runs, takes one press to send one request, and sends one when it is double-clicked; one clearing is written', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    const user = await administrator(page, context, baseURL!, {marker: true});
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
    const mine = incidentCard(page, incident);
    const submit = clearButton(mine);
    try {
      await clearThroughDialog(page, mine);
      await expect(submit).toHaveAttribute('aria-disabled', 'true');
      await expect(submit).toHaveText(t('en', 'usage.incident.clear.pending'));
      await expect(mine.getByRole('status').filter({hasText: t('en', 'usage.incident.clear.pendingStatus')})).toBeVisible();
      await submit.click({force: true});
      await submit.click({force: true});
      await expect(dialog(page)).toHaveCount(0);
    } finally {
      release();
    }
    await expect(aboveIncidents(page).locator('.notice-success').filter({hasText: clearedMessage('en', incident)})).toBeVisible(crossing);
    await page.waitForLoadState('networkidle');
    expect(posts, 'one request reached the server').toHaveLength(1);
    expect(await world.auditBy(actorOf(user), 'usage.incident_cleared')).toHaveLength(1);
  });

  test('gives each incident its own command ID, made when the form is sent', async ({page, context, baseURL}) => {
    const person = await member();
    const first = await makeIncident(person);
    const second = await makeIncident(person);
    await administrator(page, context, baseURL!, {marker: true});
    const ids: (string | null)[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) ids.push(commandIdOf(request.postData()));
    });
    await clearThroughDialog(page, incidentCard(page, first));
    await expect(aboveIncidents(page).locator('.notice-success').filter({hasText: clearedMessage('en', first)})).toBeVisible(crossing);
    await clearThroughDialog(page, incidentCard(page, second));
    await expect(aboveIncidents(page).locator('.notice-success').filter({hasText: clearedMessage('en', second)})).toBeVisible(crossing);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('one that another window cleared meanwhile is told so, as information: nothing is written again and the card catches up', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const mine = incidentCard(page, incident);
    await expect(clearButton(mine)).toBeVisible();
    await clearAsOwner(incident.id, user);
    const before = await incidentRow(incident.id);
    await clearThroughDialog(page, mine);
    const said = t('en', 'usage.incident.alreadyCleared', {provider: isolateLtr(incident.provider)});
    await expect(aboveIncidents(page).locator('.notice-info').filter({hasText: said})).toBeVisible(crossing);
    await expect(announcer(page)).toHaveText(said);
    await expect(incidentsHeading(page)).toBeFocused();
    await expect(mine).toHaveAttribute('data-state', 'cleared', crossing);
    expect(await incidentRow(incident.id)).toEqual(before);
    expect(await world.auditEvents('usage.incident_cleared', `incident:${incident.id}`)).toEqual([]);
  });

  test('one that is gone is not found, said above the incidents with focus on them; nothing is written and the card goes', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const mine = incidentCard(page, incident);
    await expect(clearButton(mine)).toBeVisible();
    await world.db.query('delete from usage.overrun_incidents where id = $1', [incident.id]);
    await clearThroughDialog(page, mine);
    const said = t('en', 'usage.incident.error.notFound', {provider: isolateLtr(incident.provider)});
    await expect(aboveIncidents(page).locator('.notice-warning').filter({hasText: said})).toBeVisible(crossing);
    await expect(announcer(page)).toHaveText(said);
    await expect(incidentsHeading(page)).toBeFocused();
    await expect(mine).toHaveCount(0, crossing);
    expect(await world.auditBy(actorOf(user), 'usage.incident_cleared')).toEqual([]);
  });

  test('an Administrator who stopped being one while the page was open is denied, audited as denied, and nothing is cleared; the page is then a 404', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    const user = await administrator(page, context, baseURL!, {marker: true});
    const mine = incidentCard(page, incident);
    await expect(clearButton(mine)).toBeVisible();
    await world.db.query(`update identity.accounts set role = 'member' where user_id = $1`, [user.id]);
    await clearThroughDialog(page, mine);
    await expect(alertOf(page).filter({hasText: t('en', 'usage.incident.error.denied')})).toBeVisible(crossing);
    expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
    expect(await world.auditBy(actorOf(user), 'usage.denied')).toEqual([expect.objectContaining({target: `account:${incident.accountId}`})]);
    expect(await world.auditBy(actorOf(user), 'usage.incident_cleared')).toEqual([]);
    expect(await world.auditBy(actorOf(user), 'usage.incident_refused')).toEqual([]);
    expect((await page.goto(path))?.status()).toBe(404);
  });

  test('a member gets the 404 page and none of the incidents: not a card, not a provider, not an operation', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    await signIn(context, baseURL!, person);
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.locator('.usage-incident')).toHaveCount(0);
    await expect(clearButton(page.locator('body'))).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(incident.provider);
    expect(html).not.toContain(incident.operationId);
    expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
  });

  test.describe('without a fresh sign-in', () => {
    for (const marker of [false, 'expired', 'another class'] as const) {
      test(`clearing is refused, nothing is cleared, the step-up is offered, and the refusal is audited once as an incident refusal (${marker === false ? 'no marker' : marker === 'expired' ? 'a marker that ran out' : 'only a marker of another class'})`, async ({page, context, baseURL}) => {
        const person = await member();
        const incident = await makeIncident(person);
        const user = await administrator(page, context, baseURL!, {marker: marker === 'expired' ? 'expired' : false});
        if (marker === 'another class') await world.forgeMarker(user, user.sessionId, {actionClass: 'owner_deletion'});
        const actor = actorOf(user);
        const target = `account:${incident.accountId}`;
        const mine = incidentCard(page, incident);
        // Offered beforehand, as a link to the step-up for administration.
        await expect(stepUpLink(page)).toHaveAttribute('href', '/step-up?for=administration');
        await expect(page.locator('.notice-warning').filter({hasText: t('en', 'usage.confirm.needed')})).toBeVisible();

        await clearThroughDialog(page, mine);
        const refused = alertsIn(mine).filter({hasText: t('en', 'usage.error.needsConfirm')});
        await expect(refused).toBeVisible(crossing);
        await expect(refused.getByRole('link', {name: t('en', 'invitations.confirm.action')})).toHaveAttribute('href', '/step-up?for=administration');
        // Still open, still pressable, nothing written but the refusal.
        await expect(mine).toHaveAttribute('data-state', 'open');
        await expect(clearButton(mine)).toBeVisible();
        expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
        expect(await world.auditBy(actor, 'usage.incident_refused')).toEqual([expect.objectContaining({actor, action: 'usage.incident_refused', target})]);
        expect(await world.auditBy(actor, 'usage.limit_refused')).toEqual([]);
        expect(await world.auditEvents('usage.incident_cleared', `incident:${incident.id}`)).toEqual([]);

        // Pressing again is the same refusal and the same one audit event: once an hour.
        await clearThroughDialog(page, mine);
        await expect(alertsIn(mine).filter({hasText: t('en', 'usage.error.needsConfirm')})).toBeVisible();
        expect(await world.auditBy(actor, 'usage.incident_refused')).toHaveLength(1);
        expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
      });
    }

    test('a fresh sign-in that runs out while the page is open re-reads the page: the green note gives way to the step-up note, and nothing is cleared', async ({page, context, baseURL}) => {
      const person = await member();
      const incident = await makeIncident(person);
      const user = await administrator(page, context, baseURL!, {marker: true});
      await expect(page.locator('.notice-success').filter({hasText: t('en', 'usage.confirm.ok')})).toBeVisible();
      await world.expireMarker(user.sessionId);
      await clearThroughDialog(page, incidentCard(page, incident));
      await expect(alertsIn(incidentCard(page, incident)).filter({hasText: t('en', 'usage.error.needsConfirm')})).toBeVisible(crossing);
      await expect(page.locator('.notice-warning').filter({hasText: t('en', 'usage.confirm.needed')})).toBeVisible(crossing);
      await expect(page.locator('.notice-success').filter({hasText: t('en', 'usage.confirm.ok')})).toHaveCount(0);
      expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
    });
  });

  test.describe('with the fake Google', () => {
    let fakeActive = false;
    test.beforeAll(async () => {
      fakeActive = await fakeGoogleActive(world.stack.apiUrl);
      if (!fakeActive && process.env.CI) throw new Error('The fake Google is not running, or the stack\'s Auth is not swapped to use it, so this flow cannot run. CI swaps it in with `npm run fake-google:up` before the browser tests.');
    });
    test.beforeEach(() => {
      test.skip(!fakeActive, 'The fake Google is not active. Run `npm run fake-google:up` against the local stack to run this flow.');
    });

    for (const locale of ['en', 'he'] as const) {
      test(`a real step-up from this page returns to the Administration index, and the incident is then cleared (${locale})`, async ({page, context, baseURL}) => {
        const tag = randomUUID().slice(0, 8);
        const user = await world.signedInUser({email: `incident-${tag}@example.test`, subject: `google-${randomUUID()}`});
        await world.activate(user);
        await world.makeAdministrator(user);
        await addFakeAccount({email: user.email, sub: user.subject, name: `Incident ${tag}`});
        const person = await member();
        const incident = await makeIncident(person);
        await signIn(context, baseURL!, user, {locale, theme: locale === 'he' ? 'dark' : 'light'});
        await open(page);
        const mine = incidentCard(page, incident);

        // Not fresh: refused, and the link is the way to a fresh sign-in.
        await clearThroughDialog(page, mine, locale);
        const refused = alertsIn(mine).filter({hasText: t(locale, 'usage.error.needsConfirm')});
        await expect(refused).toBeVisible(crossing);
        expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
        await refused.getByRole('link', {name: t(locale, 'invitations.confirm.action')}).click();
        await expect(page).toHaveURL(`${baseURL}${stepUpUrl('administration')}`, crossing);
        await hydrated(page, 'main button[type="submit"], main a[href]');
        await page.getByRole('button', {name: new RegExp(`^(${t(locale, 'stepUp.continue')}|${t(locale, 'stepUp.pending')})$`)}).click();
        await expect(page).toHaveURL(chooserUrl, crossing);
        await chooserAccount(page, user.email).click();

        // Back on the Administration index, in the NEW session, which has the marker; the incident clears.
        await expect(page).toHaveURL(`${baseURL}/admin`, crossing);
        await page.getByRole('link', {name: t(locale, 'admin.usage.open')}).click();
        await expect(page).toHaveURL(`${baseURL}${path}`, crossing);
        await expect(page.locator('.notice-success').filter({hasText: t(locale, 'usage.confirm.ok')})).toBeVisible();
        await hydrated(page, 'main form button');
        await clearThroughDialog(page, incidentCard(page, incident), locale);
        await expect(aboveIncidents(page, locale).locator('.notice-success').filter({hasText: clearedMessage(locale, incident)})).toBeVisible(crossing);
        const row = await incidentRow(incident.id);
        expect(row?.cleared_by).toBe(actorOf(user));
        expect(await world.auditEvents('usage.incident_cleared', `incident:${incident.id}`)).toEqual([expect.objectContaining({actor: actorOf(user)})]);
        expect(await world.auditBy(actorOf(user), 'usage.incident_refused')).toHaveLength(1);
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('when the database does not answer', () => {
  const flaky = (baseURL: string) => new URL(path, flakyBaseUrl(baseURL)).href;
  // The second server's switch for `list_usage` is global (the call names no user), so the tests that load the page through it take turns.
  const lock = `select pg_advisory_lock(hashtextextended('nova3d-e2e:flaky-usage', 0))`;
  const unlock = `select pg_advisory_unlock(hashtextextended('nova3d-e2e:flaky-usage', 0))`;
  test.beforeEach(() => world.db.query(lock));
  test.afterEach(() => {
    endGlobalOutage('list_usage');
    return world.db.query(unlock);
  });

  async function adminOnFlaky(page: Page, context: BrowserContext, baseURL: string) {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL, user);
    await open(page, flaky(baseURL));
    return user;
  }

  test('the usage cannot be read: the page still renders (200), says it could not be loaded, shows no card and no amount, and works again when the database does', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL!, user);
    const problems = watchForProblems(page);
    startGlobalOutage('list_usage', 'down');
    try {
      const response = await page.goto(flaky(baseURL!));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', {level: 1, name: t('en', 'usage.title')})).toBeVisible();
      await expect(page.getByRole('heading', {level: 3, name: t('en', 'usage.list.error.title')})).toBeVisible();
      await expect(page.locator('.state-error[role="alert"]')).toContainText(t('en', 'usage.list.error.body'));
      await expect(page.locator('.usage-item')).toHaveCount(0);
      await expect(page.getByRole('button', {name: new RegExp(`^(${t('en', 'usage.change.submit')}|${t('en', 'usage.reset.button')})`)})).toHaveCount(0);
      await expect(page.getByRole('meter')).toHaveCount(0);
      // No number is invented: no amount of dollars anywhere in the Accounts' section (the incidents are another read, and the tests that run now may have made some).
      expect(await page.locator('.settings-section').filter({has: listHeading(page)}).innerText()).not.toMatch(/\$\d/);
      expect(await violations(page)).toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    } finally {
      endGlobalOutage('list_usage');
    }
    expect(problems).toEqual([]);
    await page.reload();
    await expect(card(page, person.email)).toBeVisible();
    await expect(page.getByRole('heading', {level: 3, name: t('en', 'usage.list.error.title')})).toHaveCount(0);
  });

  test('the database answers with an error: the same page, and a Hebrew reader is told in Hebrew', async ({page, context, baseURL}) => {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await signIn(context, baseURL!, user, {locale: 'he', theme: 'dark'});
    startGlobalOutage('list_usage', 'error');
    try {
      const response = await page.goto(flaky(baseURL!));
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', {level: 3, name: t('he', 'usage.list.error.title')})).toBeVisible();
      await expect(page.locator('main')).toContainText(t('he', 'usage.list.error.body'));
      await expect(page.locator('.usage-item')).toHaveCount(0);
      expect(await violations(page)).toEqual([]);
    } finally {
      endGlobalOutage('list_usage');
    }
  });

  /** An Administrator with a marker, signed in on the page of the second server, for the tests that make something fail before the page is read. */
  async function adminBeforeRead(context: BrowserContext, baseURL: string, locale: Locale = 'en') {
    const user = await world.signedInUser();
    await world.activate(user);
    await world.makeAdministrator(user);
    await world.forgeMarker(user, user.sessionId);
    await signIn(context, baseURL, user, {locale, theme: locale === 'he' ? 'dark' : 'light'});
    return {user, accountId: (await world.accountOf(user)).id as string};
  }

  for (const locale of ['en', 'he'] as const) {
    test(`the incidents cannot be read: the page still renders (200), says they could not be loaded, lists none, still lists the Accounts, passes axe, and works again when the database does (${locale})`, async ({page, context, baseURL}) => {
      const person = await member();
      const incident = await makeIncident(person);
      const {accountId} = await adminBeforeRead(context, baseURL!, locale);
      const problems = watchForProblems(page);
      startOutage(accountId, {rpc: ['list_overrun_incidents'], mode: 'down'});
      try {
        const response = await page.goto(flaky(baseURL!));
        expect(response?.status()).toBe(200);
        await expect(page.getByRole('heading', {level: 3, name: t(locale, 'usage.incidents.error.title')})).toBeVisible();
        await expect(page.locator('.state-error[role="alert"]')).toContainText(t(locale, 'usage.incidents.error.body'));
        await expect(page.locator('.usage-incident')).toHaveCount(0);
        await expect(page.getByText(incident.provider)).toHaveCount(0);
        // The Accounts are a read of their own, and are there.
        await expect(card(page, person.email)).toBeVisible();
        expect(await axe(page, locale)).toEqual([]);
        expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      } finally {
        endOutage(accountId);
      }
      expect(problems).toEqual([]);
      await page.reload();
      await expect(incidentCard(page, incident)).toBeVisible();
      await expect(page.getByRole('heading', {level: 3, name: t(locale, 'usage.incidents.error.title')})).toHaveCount(0);
    });
  }

  test('the clearing gets no answer: the person is told it is not known, to check the incidents first (read again), and the retry is the same command, which goes through', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    const {accountId} = await adminBeforeRead(context, baseURL!);
    await open(page, flaky(baseURL!));
    const ids: (string | null)[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) ids.push(commandIdOf(request.postData()));
    });
    // An incident that appears while the page is open: "check the incidents" must point at a list read AFTER the attempt.
    const appeared = await makeIncident(person);
    await expect(incidentCard(page, appeared)).toHaveCount(0);
    startOutage(accountId, {rpc: ['clear_overrun_incident'], mode: 'error'});
    try {
      await clearThroughDialog(page, incidentCard(page, incident));
      await expect(alertsIn(incidentCard(page, incident)).filter({hasText: t('en', 'usage.incident.error.unknown')})).toBeVisible(crossing);
      await expect(incidentCard(page, appeared)).toBeVisible(crossing);
    } finally {
      endOutage(accountId);
    }
    expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
    // Sending it again is the same command, which now goes through.
    await clearThroughDialog(page, incidentCard(page, incident));
    await expect(aboveIncidents(page).locator('.notice-success').filter({hasText: clearedMessage('en', incident)})).toBeVisible(crossing);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toBe(ids[0]);
    expect((await incidentRow(incident.id))?.cleared_by).not.toBeNull();
    expect(await incidentRow(appeared.id)).toEqual({cleared_at: null, cleared_by: null});
  });

  test('the marker cannot be checked when an incident is to be cleared: a retryable notice, nothing is cleared, nothing is recorded as a refusal, and the next press works', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    const {user} = await adminBeforeRead(context, baseURL!);
    await open(page, flaky(baseURL!));
    startOutage(user.id, {rpc: ['use_marker'], mode: 'down'});
    try {
      await clearThroughDialog(page, incidentCard(page, incident));
      await expect(alertsIn(incidentCard(page, incident)).filter({hasText: t('en', 'usage.error.unavailable')})).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await incidentRow(incident.id)).toEqual({cleared_at: null, cleared_by: null});
    expect(await world.auditBy(actorOf(user), 'usage.incident_refused')).toEqual([]);
    await clearThroughDialog(page, incidentCard(page, incident));
    await expect(aboveIncidents(page).locator('.notice-success').filter({hasText: clearedMessage('en', incident)})).toBeVisible(crossing);
  });

  test('the marker cannot be checked: a retryable notice, nothing is appended, nothing is recorded as a refusal, and the next press works', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await adminOnFlaky(page, context, baseURL!);
    startOutage(user.id, {rpc: ['use_marker'], mode: 'down'});
    try {
      await changeTo(page, person.email, '40');
      await expect(alertsIn(card(page, person.email)).filter({hasText: t('en', 'usage.error.unavailable')})).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await periodsOf(person)).toHaveLength(1);
    expect(await world.auditBy(actorOf(user), 'usage.limit_refused')).toEqual([]);
    await changeButton(page, person.email).click();
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 40_000_000), crossing);
    expect(await periodsOf(person)).toHaveLength(2);
  });

  test('the change gets no answer: the person is told it is not known, to check the list first (which was read again), and the retry is the same command', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await adminOnFlaky(page, context, baseURL!);
    const ids: (string | null)[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) ids.push(commandIdOf(request.postData()));
    });
    // An Account that appears while the page is open: "check the list" must point at a list read AFTER the attempt.
    const appeared = await member();
    await expect(card(page, appeared.email)).toHaveCount(0);
    startOutage(user.id, {rpc: ['set_usage_limit'], mode: 'error'});
    try {
      await changeTo(page, person.email, '40');
      await expect(alertsIn(card(page, person.email)).filter({hasText: t('en', 'usage.error.unknown')})).toBeVisible(crossing);
      await expect(card(page, appeared.email)).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await periodsOf(person)).toHaveLength(1);
    // The field kept what was typed, and sending it again is the same command, which now goes through.
    await expect(limitField(page, person.email)).toHaveValue('40');
    await changeButton(page, person.email).click();
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 40_000_000), crossing);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBeNull();
    expect(ids[1]).toBe(ids[0]);
    expect(await periodsOf(person)).toHaveLength(2);
  });

  test('the reset gets no answer: the person is told it is not known, and the retry is the same command, which goes through', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await adminOnFlaky(page, context, baseURL!);
    const ids: (string | null)[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) ids.push(commandIdOf(request.postData()));
    });
    startOutage(user.id, {rpc: ['set_usage_limit'], mode: 'error'});
    try {
      await resetThroughDialog(page, person.email);
      await expect(alertsIn(card(page, person.email)).filter({hasText: t('en', 'usage.error.unknown')})).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await periodsOf(person)).toHaveLength(1);
    // Sending it again is the same command (the period it was made against is still the same), which now goes through.
    await resetThroughDialog(page, person.email);
    await expect(card(page, person.email).locator('.notice-success')).toContainText(t('en', 'usage.reset.done', {name: person.email}), crossing);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toBe(ids[0]);
    const periods = await periodsOf(person);
    expect(periods).toHaveLength(2);
    expect(periods[1]).toMatchObject({cause: 'reset', command_id: ids[0]});
  });

  test('a reset that gets no answer says the same', async ({page, context, baseURL}) => {
    const person = await member();
    const user = await adminOnFlaky(page, context, baseURL!);
    startOutage(user.id, {rpc: ['set_usage_limit'], mode: 'down'});
    try {
      await resetThroughDialog(page, person.email);
      await expect(alertsIn(card(page, person.email)).filter({hasText: t('en', 'usage.error.unknown')})).toBeVisible(crossing);
    } finally {
      endOutage(user.id);
    }
    expect(await periodsOf(person)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('on every screen', () => {
  for (const variant of variants) {
    test(`has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
      const under = await member();
      const nearly = await member();
      const over = await member();
      const disabled = await member();
      await setFigures(nearly, 21_000_000);
      await setFigures(over, 30_000_000, 5_000_000);
      await setFigures(disabled, 25_000_000);
      await world.setStatus(disabled, 'disabled');
      const problems = watchForProblems(page);
      const user = await administrator(page, context, baseURL!, {marker: false, locale: variant.locale, theme: variant.theme});
      const locale = variant.locale;
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
      for (const [who, state] of [[under, 'under'], [nearly, 'nearly'], [over, 'reached'], [disabled, 'reached']] as const) await expect(stateBadge(card(page, who.email), locale, state)).toBeVisible();
      expect(await axe(page, locale), 'the page, with the step-up offered, every state on it').toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});

      // A field message.
      await changeTo(page, under.email, '12.345', locale);
      await expect(card(page, under.email).locator('.notice-danger[role="alert"]')).toHaveText(t(locale, 'usage.error.cents'), crossing);
      expect(await axe(page, locale), 'a field message').toEqual([]);

      // A refusal, for a change and for a reset.
      await changeTo(page, under.email, '40', locale);
      await expect(alertsIn(card(page, under.email)).filter({hasText: t(locale, 'usage.error.needsConfirm')})).toBeVisible(crossing);
      expect(await axe(page, locale), 'a refusal').toEqual([]);

      // The confirmed page.
      await world.forgeMarker(user, user.sessionId);
      await open(page);
      await expect(page.locator('.notice-success').filter({hasText: t(locale, 'usage.confirm.ok')})).toBeVisible();
      expect(await axe(page, locale), 'confirmed').toEqual([]);

      // The reset dialog.
      await resetButton(page, under.email, locale).click();
      await expect(dialog(page)).toBeVisible();
      expect(await axe(page, locale), 'the reset confirmation').toEqual([]);
      await dialog(page).getByRole('button', {name: t(locale, 'confirm.cancel')}).click();

      // A change that happened, a change that was already so, and a reset that happened.
      await changeTo(page, under.email, '40', locale);
      await expect(card(page, under.email).locator('.notice-success')).toContainText(doneMessage(locale, under.email, 40_000_000), crossing);
      expect(await axe(page, locale), 'a change that happened').toEqual([]);
      await expect(limitField(page, under.email, locale)).toHaveValue('');
      await changeTo(page, under.email, '40', locale);
      await expect(card(page, under.email).locator('.notice-info')).toBeVisible(crossing);
      expect(await axe(page, locale), 'a change that was already so').toEqual([]);
      await resetThroughDialog(page, under.email, locale);
      await expect(card(page, under.email).locator('.notice-success').filter({hasText: t(locale, 'usage.reset.done', {name: under.email})})).toBeVisible(crossing);
      expect(await axe(page, locale), 'a reset that happened').toEqual([]);

      // Lowered below what is used: over the limit.
      await changeTo(page, nearly.email, '10', locale);
      await expect(card(page, nearly.email)).toHaveAttribute('data-state', 'reached', crossing);
      await expect(card(page, nearly.email)).toContainText(t(locale, 'usage.row.over'));
      expect(await axe(page, locale), 'lowered below what is used').toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      expect(problems).toEqual([]);
    });

    test(`the Administration index, with its fourth section, has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
      const user = await world.signedInUser();
      await world.activate(user);
      await world.makeAdministrator(user);
      await world.forgeMarker(user, user.sessionId);
      await signIn(context, baseURL!, user, {locale: variant.locale, theme: variant.theme});
      await page.goto('/admin');
      await expect(page.getByRole('heading', {level: 2, name: t(variant.locale, 'admin.usage.title')})).toBeVisible();
      expect(await violations(page)).toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    });
  }

  for (const variant of [variants[0], variants[3]]) {
    test(`reflows at 320 px wide with 200% text, with a long address, long amounts and a dialog: ${variant.name}`, async ({page, context, baseURL, browserName}) => {
      test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      const long = await member({email: `${'long-address-'.repeat(4)}${randomUUID().slice(0, 8)}@example.test`});
      // An amount with every decimal, over the limit: the longest things a card holds.
      await setFigures(long, 9_876_543_217, 1_234_567);
      await administrator(page, context, baseURL!, {marker: true, locale: variant.locale, theme: variant.theme});
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
      const mine = card(page, long.email);
      await expect(mine).toBeVisible();
      await expect(mine).toHaveAttribute('data-state', 'reached');
      expectReconciled(await shown(mine, variant.locale));
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      await limitField(page, long.email, variant.locale).fill('12.345');
      await changeButton(page, long.email, variant.locale).click();
      await expect(mine.locator('.notice-danger[role="alert"]')).toBeVisible();
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      await limitField(page, long.email, variant.locale).fill('40');
      await changeButton(page, long.email, variant.locale).click();
      await expect(mine.locator('.notice-success')).toBeVisible(crossing);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      await resetButton(page, long.email, variant.locale).click();
      const confirm = dialog(page);
      await expect(confirm).toBeVisible();
      const box = (await confirm.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(await axe(page, variant.locale)).toEqual([]);
      await confirm.getByRole('button', {name: t(variant.locale, 'usage.reset.confirm')}).click();
      await expect(mine.locator('.notice-success').filter({hasText: t(variant.locale, 'usage.reset.done', {name: long.email})})).toBeVisible(crossing);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    });
  }

  test('has targets of at least 44 px for the field and both buttons, on a phone and on a desktop', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: false});
    for (const control of [limitField(page, person.email), changeButton(page, person.email), resetButton(page, person.email)]) {
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await resetButton(page, person.email).click();
    for (const name of [t('en', 'confirm.cancel'), t('en', 'usage.reset.confirm')]) {
      const box = (await dialog(page).getByRole('button', {name}).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('reads in Hebrew, right to left: no Latin word on the card but the address, the amounts and the month stay left to right', async ({page, context, baseURL}) => {
    const person = await member();
    await setFigures(person, 21_000_000, 1_000_000);
    await administrator(page, context, baseURL!, {marker: true, locale: 'he', theme: 'dark'});
    await expect(page.getByRole('heading', {level: 1, name: t('he', 'usage.title')})).toBeVisible();
    await expect(page).toHaveTitle(`${t('he', 'meta.usage')} · nova3D`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const mine = card(page, person.email);
    await expect(mine.locator('.ltr-token').first()).toHaveCSS('direction', 'ltr');
    await expect(mine.locator('dd .ltr-token')).toHaveCount(5);
    for (const token of await mine.locator('dd .ltr-token').all()) await expect(token).toHaveCSS('direction', 'ltr');
    await expect(mine.locator('time').locator('xpath=..')).toHaveCSS('direction', 'ltr');
    await expect(limitField(page, person.email, 'he')).toHaveCSS('direction', 'ltr');
    await expect(stateBadge(mine, 'he', 'nearly')).toBeVisible();
    expect(await shown(mine, 'he')).toMatchObject({month: await currentMonth(), limit: 25_000_000, settled: 21_000_000, reserved: 1_000_000, available: 3_000_000});
    // Nothing in Latin letters on the card except the Account's address; none in the header either.
    const cardText = (await mine.innerText()).split(person.email).join('');
    expect(cardText).not.toMatch(/[A-Za-z]{2,}/);
    const header = await page.locator('main > .page > :is(.eyebrow, h1, .lede)').allInnerTexts();
    expect(header.join(' ')).not.toMatch(/[A-Za-z]{2,}/);
    expect(await mine.getByRole('meter').getAttribute('aria-valuetext')).not.toMatch(/[A-Za-z]{2,}/);
    // The whole flow reads in Hebrew.
    await changeTo(page, person.email, '40', 'he');
    await expect(mine.locator('.notice-success')).toContainText(doneMessage('he', person.email, 40_000_000), crossing);
    await resetThroughDialog(page, person.email, 'he');
    await expect(mine.locator('.notice-success').filter({hasText: t('he', 'usage.reset.done', {name: person.email})})).toBeVisible(crossing);
    await expect(mine.locator('dd').filter({hasText: t('he', 'usage.cause.reset')})).toBeVisible();
  });

  test('can be used with the keyboard alone, from the field to the answer, and from the Reset button through its dialog and back', async ({page, context, baseURL}) => {
    const person = await member();
    await administrator(page, context, baseURL!, {marker: true});
    const field = limitField(page, person.email);
    await field.focus();
    await field.pressSequentially('41');
    await page.keyboard.press('Enter');
    await expect(card(page, person.email).locator('.notice-success')).toContainText(doneMessage('en', person.email, 41_000_000), crossing);
    // Tab from the field reaches the buttons in the order they read: Change limit, then Reset count.
    await field.focus();
    await page.keyboard.press('Tab');
    await expect(changeButton(page, person.email)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(resetButton(page, person.email)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', {name: t('en', 'usage.reset.confirm')})).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card(page, person.email).locator('.notice-success').filter({hasText: t('en', 'usage.reset.done', {name: person.email})})).toBeVisible(crossing);
    await expect(dialog(page)).toHaveCount(0);
    expect((await periodsOf(person)).map((period) => period.cause)).toEqual(['initial', 'change', 'reset']);
  });
  for (const variant of variants) {
    test(`the overrun incidents have no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
      const locale = variant.locale;
      const person = await member();
      const blocking = await makeIncident(person);
      const closed = await makeIncident(person, {reserved: 30_000, evidence: 55_000});
      const late = await makeIncident(person);
      const gone = await makeIncident(person);
      const problems = watchForProblems(page);
      const user = await administrator(page, context, baseURL!, {marker: false, locale, theme: variant.theme, before: async (admin) => void (await clearAsOwner(closed.id, admin))});
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'he' ? 'rtl' : 'ltr');
      await expect(incidentCard(page, blocking)).toHaveAttribute('data-state', 'open');
      await expect(incidentCard(page, closed)).toHaveAttribute('data-state', 'cleared');
      expect(await axe(page, locale), 'open and cleared incidents, with the step-up offered').toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});

      // The confirmation, and the refusal that follows it without a fresh sign-in.
      await clearButton(incidentCard(page, blocking), locale).click();
      await expect(dialog(page)).toBeVisible();
      expect(await axe(page, locale), 'the clearing confirmation').toEqual([]);
      await confirmClear(page, locale).click();
      await expect(alertsIn(incidentCard(page, blocking)).filter({hasText: t(locale, 'usage.error.needsConfirm')})).toBeVisible(crossing);
      expect(await axe(page, locale), 'a refusal').toEqual([]);

      // With a fresh sign-in: cleared, said above the incidents.
      await world.forgeMarker(user, user.sessionId);
      await open(page);
      await expect(page.locator('.notice-success').filter({hasText: t(locale, 'usage.confirm.ok')})).toBeVisible();
      expect(await axe(page, locale), 'confirmed').toEqual([]);
      await clearThroughDialog(page, incidentCard(page, blocking), locale);
      await expect(aboveIncidents(page, locale).locator('.notice-success').filter({hasText: clearedMessage(locale, blocking)})).toBeVisible(crossing);
      await expect(incidentCard(page, blocking)).toHaveAttribute('data-state', 'cleared', crossing);
      expect(await axe(page, locale), 'an incident that was cleared').toEqual([]);

      // One that another window cleared meanwhile (information), and one that is gone (a warning).
      await clearAsOwner(late.id, user);
      await clearThroughDialog(page, incidentCard(page, late), locale);
      await expect(aboveIncidents(page, locale).locator('.notice-info')).toBeVisible(crossing);
      expect(await axe(page, locale), 'an incident that was already cleared').toEqual([]);
      await world.db.query('delete from usage.overrun_incidents where id = $1', [gone.id]);
      await clearThroughDialog(page, incidentCard(page, gone), locale);
      await expect(aboveIncidents(page, locale).locator('.notice-warning')).toBeVisible(crossing);
      expect(await axe(page, locale), 'an incident that is gone').toEqual([]);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      expect(problems).toEqual([]);
    });
  }

  for (const variant of [variants[0], variants[3]]) {
    test(`reflows the overrun incidents at 320 px wide with 200% text, with a long provider, a long address, long amounts and a dialog: ${variant.name}`, async ({page, context, baseURL, browserName}) => {
      test.skip(browserName !== 'chromium', 'Page.setFontSizes is a Chromium DevTools command');
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      const long = await member({email: `${'long-address-'.repeat(4)}${randomUUID().slice(0, 8)}@example.test`});
      // The longest name a provider has (80 characters), and the longest amounts an incident holds.
      const provider = `${'long-provider-'.repeat(5)}${randomUUID().replaceAll('-', '').slice(0, 10)}`;
      const incident = await makeIncident(long, {provider, reserved: 1_234_567, evidence: 9_876_543_217});
      await administrator(page, context, baseURL!, {marker: true, locale: variant.locale, theme: variant.theme});
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
      const mine = incidentCard(page, incident);
      await expect(mine).toBeVisible();
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      await clearButton(mine, variant.locale).click();
      const confirm = dialog(page);
      await expect(confirm).toBeVisible();
      const box = (await confirm.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(320);
      expect(await axe(page, variant.locale)).toEqual([]);
      await confirmClear(page, variant.locale).click();
      await expect(aboveIncidents(page, variant.locale).locator('.notice-success').filter({hasText: clearedMessage(variant.locale, incident)})).toBeVisible(crossing);
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    });
  }

  test('the overrun incidents have targets of at least 44 px for Review and clear and both buttons of its dialog, on a phone and on a desktop', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    await administrator(page, context, baseURL!, {marker: false});
    const button = clearButton(incidentCard(page, incident));
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await button.click();
    for (const name of [t('en', 'confirm.cancel'), t('en', 'usage.incident.clear.confirm')]) {
      const target = (await dialog(page).getByRole('button', {name}).boundingBox())!;
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('the overrun incidents read in Hebrew, right to left: no Latin word but the provider, the operation and the address, which stay left to right with the amounts and the times; the whole flow reads in Hebrew', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    const user = await administrator(page, context, baseURL!, {marker: true, locale: 'he', theme: 'dark'});
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(incidentsHeading(page, 'he')).toBeVisible();
    const mine = incidentCard(page, incident);
    await expect(mine).toBeVisible();
    // Six values on the card, each left to right: the address, the operation, three amounts and the time.
    await expect(mine.locator('dd .ltr-token')).toHaveCount(6);
    for (const token of await mine.locator('dd .ltr-token').all()) await expect(token).toHaveCSS('direction', 'ltr');
    await expect(mine.locator('h3 .ltr-token')).toHaveCSS('direction', 'ltr');
    await expect(mine.locator('time').locator('xpath=..')).toHaveCSS('direction', 'ltr');
    expect(await incidentFacts(mine, 'he')).toEqual({account: person.email, operation: incident.operationId, reserved: '$1.00', reported: '$1.75', over: '$0.75', recorded: await whenOf(incident.id)});
    const words = (await mine.innerText()).split(person.email).join('').split(incident.provider).join('').split(incident.operationId).join('');
    expect(words).not.toMatch(/[A-Za-z]{2,}/);
    const section = page.locator('.settings-section').filter({has: incidentsHeading(page, 'he')});
    expect((await section.locator(':scope > h2, :scope > .settings-help').allInnerTexts()).join(' ')).not.toMatch(/[A-Za-z]{2,}/);
    // The whole flow reads in Hebrew.
    await clearThroughDialog(page, mine, 'he');
    await expect(aboveIncidents(page, 'he').locator('.notice-success').filter({hasText: clearedMessage('he', incident)})).toBeVisible(crossing);
    await expect(mine.locator('.status-badge').filter({hasText: t('he', 'usage.incident.state.cleared')})).toBeVisible(crossing);
    await expect.poll(async () => (await incidentFacts(mine, 'he')).clearedBy, crossing).toBe(user.email);
  });

  test('the overrun incidents can be used with the keyboard alone: Review and clear, its dialog, and the answer', async ({page, context, baseURL}) => {
    const person = await member();
    const incident = await makeIncident(person);
    await administrator(page, context, baseURL!, {marker: true});
    const mine = incidentCard(page, incident);
    await clearButton(mine).focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirmClear(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(aboveIncidents(page).locator('.notice-success').filter({hasText: clearedMessage('en', incident)})).toBeVisible(crossing);
    await expect(dialog(page)).toHaveCount(0);
    await expect(incidentsHeading(page)).toBeFocused();
    expect((await incidentRow(incident.id))?.cleared_at).not.toBeNull();
  });
});
