import {randomUUID} from 'node:crypto';
import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import type {Locale, MessageKey} from '../../lib/i18n';
import {projectFixtures} from '../../lib/project-fixtures';
import {projectStages, stageDefinition} from '../../lib/project-stage';
import {announcer, hydrated, label, mainNav, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {endOutage, flakyBaseUrl, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld, type ForgedUser} from '../support/forged-session';

// Story 1.7: Home, My Projects, a Project's overview with its Sources entry, the one unavailable page, and Rename, in a real browser
// against the production build and the local Supabase stack. Each test forges a member's session and gives the Account the Projects it
// needs directly in the database (nothing in the application creates one until Story 2.1; tests/support/forged-session.ts
// `addProject`). Auth still validates the token, so the application's own proxy, authorization and the database functions all run.
// Every flow runs on `desktop` and `phone`. Two windows are two pages of one browser context (one session).

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

type Options = {locale?: Locale; theme?: 'light' | 'dark'};

/** A member with an Account, signed in with a language and theme. */
async function member(context: BrowserContext, baseURL: string, options: Options = {}) {
  const user = await world.signedInUser();
  await world.activate(user);
  await signIn(context, baseURL, user, {locale: options.locale ?? 'en', theme: options.theme ?? 'light'});
  return user;
}

const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const unavailableTitle = (locale: Locale) => `${t(locale, 'meta.projectUnavailable')} · nova3D`;

/** Opens a page, expecting its status, and waits for its one heading. */
async function open(page: Page, url: string, status = 200) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(status);
  await expect(page.getByRole('heading', {level: 1}), url).toBeVisible();
  return response!;
}

const cards = (page: Page) => page.locator('article.project-card');
const cardTitles = async (page: Page) => (await cards(page).locator('.project-title').allInnerTexts()).map((title) => title.trim());
const renameButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'project.rename'), exact: true});
const renameDialog = (page: Page, locale: Locale = 'en') => page.getByRole('dialog', {name: t(locale, 'project.rename.title')});
const nameField = (page: Page, locale: Locale = 'en') => renameDialog(page, locale).getByLabel(t(locale, 'project.rename.label'));
const saveButton = (page: Page, locale: Locale = 'en') => renameDialog(page, locale).getByRole('button', {name: t(locale, 'project.rename.save')});
const alerts = (page: Page) => page.locator('.notice[role="alert"]');
const crossing = {timeout: 20_000};

/** Opens a Project's overview and waits until React has taken over its controls. */
async function openOverview(page: Page, projectId: string) {
  await open(page, `/projects/${projectId}`);
  await hydrated(page, 'main button');
}

// ---------------------------------------------------------------------------------------------------
test.describe('Home for a new Account (AC-1)', () => {
  test('shows the three primary actions with real counts, an honest empty state, and none of the sample content', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await open(page, '/');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'home.title'));
    const actions = page.getByRole('region', {name: t('en', 'a11y.primaryActions')});
    await expect(actions.getByRole('link', {name: new RegExp(t('en', 'nav.projects'))})).toContainText(t('en', 'home.projectsDetail', {count: 0}));
    await expect(actions.getByRole('link', {name: new RegExp(t('en', 'nav.projects'))})).toHaveAttribute('href', '/projects');
    await expect(actions.getByRole('button', {name: new RegExp(t('en', 'nav.create'))})).toBeVisible();
    await expect(actions.getByRole('link', {name: new RegExp(t('en', 'nav.progress'))})).toContainText(t('en', 'home.progressNone'));
    await expect(actions.getByRole('link', {name: new RegExp(t('en', 'nav.progress'))})).toHaveAttribute('href', '/progress');
    // Recent projects is an empty state with a way to create one.
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', {level: 2, name: t('en', 'projects.noneTitle')})).toBeVisible();
    await expect(main.getByRole('button', {name: t('en', 'projects.new')}).last()).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    // Nothing is a sample any more: no banner, no notice, no activity, no mode card, no sample name.
    await expect(page.getByRole('note')).toHaveCount(0);
    await expect(page.locator('.synthetic-banner, .mode-card, .activity-card, .notice')).toHaveCount(0);
    for (const sample of ['Josh', 'Good morning', 'Synthetic', 'Sample data', 'Outer Altar', 'Courtyard bench', 'Garden arch']) await expect(page.getByText(sample)).toHaveCount(0);
    expect(await world.projectCount(user)).toBe(0);
  });

  test('is usable at phone width: the three actions and the empty state are visible, and Create opens its dialog', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await open(page, '/');
    await hydrated(page, 'main button');
    for (const name of ['nav.projects', 'nav.create', 'nav.progress'] as const) await expect(page.getByRole('main').getByText(t('en', name), {exact: true}).first()).toBeVisible();
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'projects.noneTitle')})).toBeVisible();
    await page.getByRole('main').getByRole('button', {name: t('en', 'projects.new')}).last().click();
    await expect(page.getByRole('dialog', {name: t('en', 'create.title')})).toBeVisible();
    expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
  });

  test('counts the Projects and shows the three most recently updated, newest first, each opening its overview', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const ids = await world.addFixtureProjects(user);
    await open(page, '/');
    await expect(page.getByRole('region', {name: t('en', 'a11y.primaryActions')}).getByRole('link', {name: new RegExp(t('en', 'nav.projects'))})).toContainText(t('en', 'home.projectsDetail', {count: projectFixtures.length}));
    // Home asks for three: the most recent three of the six.
    await expect(cards(page)).toHaveCount(3);
    expect(await cardTitles(page)).toEqual(projectFixtures.slice(0, 3).map((fixture) => fixture.title));
    await expect(page.getByRole('link', {name: t('en', 'home.viewAll')})).toHaveAttribute('href', '/projects');
    await cards(page).first().getByRole('link').click();
    await expect(page).toHaveURL(`${baseURL}/projects/${ids[0]}`, crossing);
  });

  test('the Account panel shows the verified Google address, and notifications are an honest empty state', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await open(page, '/');
    await hydrated(page, 'main button');
    await page.getByRole('button', {name: t('en', 'notifications.title'), exact: true}).click();
    const notifications = page.getByRole('region', {name: t('en', 'notifications.title')});
    await expect(notifications).toContainText(t('en', 'notifications.emptyTitle'));
    await expect(notifications).toContainText(t('en', 'notifications.emptyBody'));
    await expect(page.locator('.notification-dot')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: t('en', 'nav.account'), exact: true}).click();
    const panel = page.getByRole('region', {name: t('en', 'account.title')});
    await expect(panel).toContainText(user.email);
    await expect(panel).toContainText(t('en', 'account.signedInWith'));
    await expect(panel).not.toContainText('Josh');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('My Projects (UX-DR28)', () => {
  test('is an empty state with Create for an Account with no Projects, and not the "no match" state', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await open(page, '/projects');
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'projects.noneTitle')})).toBeVisible();
    await expect(page.getByText(t('en', 'projects.noneBody'))).toBeVisible();
    await expect(page.getByRole('heading', {name: t('en', 'projects.emptyTitle')})).toHaveCount(0);
    await expect(page.getByRole('search')).toHaveCount(0);
    await expect(page).toHaveTitle(`${t('en', 'meta.projects')} · nova3D`);
  });

  test('lists the Projects newest update first, each with its Version, title, stage as a word and a shape, and time, and each opens its overview', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const ids = await world.addFixtureProjects(user);
    await open(page, '/projects');
    await expect(cards(page)).toHaveCount(projectFixtures.length);
    expect(await cardTitles(page)).toEqual(projectFixtures.map((fixture) => fixture.title));
    for (const [index, fixture] of projectFixtures.entries()) {
      const card = cards(page).nth(index);
      await expect(card.locator('.status-badge')).toContainText(t('en', stageDefinition(fixture.stage).label));
      await expect(card.locator('.status-badge svg')).toHaveCount(1);
      await expect(card).toContainText(fixture.currentVersion > 0 ? t('en', 'project.version', {version: fixture.currentVersion}) : t('en', 'project.versionNone'));
      await expect(card.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
      await expect(card.getByRole('link')).toHaveAttribute('href', `/projects/${ids[index]}`);
    }
    // The whole card is one target.
    const card = cards(page).nth(2);
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
    await expect(page).toHaveURL(`${baseURL}/projects/${ids[2]}`, crossing);
  });

  test('never lists another Account\'s Projects, and shows nothing of them anywhere on the page', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const other = await world.signedInUser();
    await world.activate(other);
    await world.addProject(other, {title: 'Somebody else\'s secret plans'});
    await world.addProject(user, {title: 'Mine'});
    await open(page, '/projects');
    expect(await cardTitles(page)).toEqual(['Mine']);
    expect(await page.content()).not.toContain('secret plans');
    await open(page, '/');
    expect(await page.content()).not.toContain('secret plans');
  });

  test('searches by title, announces the count, tells "no match" from "empty", and keeps what is typed out of every request and address', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await world.addFixtureProjects(user);
    await open(page, '/projects');
    await hydrated(page, 'main button');
    const requests: string[] = [];
    page.on('request', (request) => requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));
    const search = page.getByRole('searchbox', {name: t('en', 'projects.search')});
    await search.fill('bench');
    await expect(cards(page)).toHaveCount(1);
    expect(await cardTitles(page)).toEqual(['Courtyard bench']);
    await expect(announcer(page)).toHaveText(t('en', 'projects.resultCount', {count: 1}));
    await expect(page.locator('.result-count')).toHaveText(t('en', 'projects.resultCount', {count: 1}));
    // Case does not matter, and neither do spaces around it.
    await search.fill('  LAMP  ');
    expect(await cardTitles(page)).toEqual(['Reading lamp base']);
    // Hebrew titles are found as they were written.
    await search.fill('מזבח');
    expect(await cardTitles(page)).toEqual(['המזבח החיצון והכבש']);
    // Nothing matches: "No matching projects", which is not the empty state, and a way to clear it.
    await search.fill('zzz-no-such-project');
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'projects.emptyTitle')})).toBeVisible();
    await expect(page.getByRole('heading', {name: t('en', 'projects.noneTitle')})).toHaveCount(0);
    await expect(announcer(page)).toHaveText(t('en', 'projects.resultCount', {count: 0}));
    await page.getByRole('button', {name: t('en', 'projects.clearFilters')}).click();
    await expect(cards(page)).toHaveCount(projectFixtures.length);
    await expect(search).toHaveValue('');
    // The button that was pressed is gone with the "no match" state: focus is on the search field, not lost to the page.
    await expect(search).toBeFocused();
    // What was typed went nowhere: the address is unchanged and no request carried it.
    expect(page.url()).toBe(`${baseURL}/projects`);
    expect(requests.filter((request) => /bench|lamp|zzz|%D7|מזבח/i.test(request))).toEqual([]);
  });

  test('filters by stage, alone and with a search, and the stage list names every stage', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await world.addFixtureProjects(user);
    await world.addProject(user, {title: 'Another export', stage: 'export_ready', version: 1});
    await open(page, '/projects');
    await hydrated(page, 'main button');
    const filter = page.getByLabel(t('en', 'projects.filterLabel'));
    await expect(filter.locator('option')).toHaveText([t('en', 'projects.filterAllStages'), ...projectStages.map((stage) => t('en', stageDefinition(stage).label))]);
    await filter.selectOption('export_ready');
    expect((await cardTitles(page)).sort()).toEqual(['Another export', 'Reading lamp base']);
    await expect(announcer(page)).toHaveText(t('en', 'projects.resultCount', {count: 2}));
    await page.getByRole('searchbox', {name: t('en', 'projects.search')}).fill('another');
    expect(await cardTitles(page)).toEqual(['Another export']);
    await filter.selectOption('researching');
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'projects.emptyTitle')})).toBeVisible();
    await page.getByRole('button', {name: t('en', 'projects.clearFilters')}).click();
    await expect(page.getByRole('searchbox', {name: t('en', 'projects.search')})).toBeFocused();
    await expect(filter).toHaveValue('all');
    await expect(cards(page)).toHaveCount(projectFixtures.length + 1);
  });

  test('labels every stage, in words and in a shape of its own, including awaiting Model Approval and Export ready', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await world.addFixtureProjects(user);
    await open(page, '/projects');
    const labels = await cards(page).locator('.status-badge').allInnerTexts();
    // The cards are in the fixtures' order (newest first); together they hold every stage once (Story 2.1's `request_confirmed` is the last fixture).
    expect(labels.map((text) => text.trim())).toEqual(projectFixtures.map((fixture) => t('en', stageDefinition(fixture.stage).label)));
    expect(new Set(labels.map((text) => text.trim())).size).toBe(projectStages.length);
    expect(labels.map((text) => text.trim())).toEqual(expect.arrayContaining(['Request confirmed', 'Awaiting Model Approval', 'Export ready']));
    const shapes = await cards(page).locator('.status-badge svg').evaluateAll((icons) => icons.map((icon) => icon.innerHTML));
    expect(new Set(shapes).size).toBe(projectStages.length);
  });

  test('is an error state with a way to try again, and nothing else of the Projects, when the list cannot be read; asking again works', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await world.addProject(user, {title: 'Behind the outage'});
    const account = (await world.accountOf(user)).id as string;
    await open(page, '/projects');
    await expect(cards(page)).toHaveCount(1);
    startOutage(account, {rpc: ['list_projects'], mode: 'down'});
    try {
      await open(page, `${flakyBaseUrl(baseURL!)}/projects`);
      await expect(page.getByRole('heading', {level: 2, name: t('en', 'projects.error.title')})).toBeVisible();
      await expect(alerts(page).or(page.locator('.state-error[role="alert"]')).first()).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
      await expect(page.getByRole('search')).toHaveCount(0);
      await expect(page.getByRole('heading', {name: t('en', 'projects.noneTitle')})).toHaveCount(0);
      await expect(page.getByText('Behind the outage')).toHaveCount(0);
      await hydrated(page, 'main button');
      // Still down: trying again keeps saying so. The answer is waited for while the outage lasts, and the button is ready again.
      await Promise.all([page.waitForResponse((response) => response.url().includes('_rsc=')), page.getByRole('button', {name: t('en', 'state.retry')}).click()]);
      await expect(page.getByRole('heading', {level: 2, name: t('en', 'projects.error.title')})).toBeVisible();
      await expect(page.getByRole('button', {name: t('en', 'state.retry')})).not.toHaveAttribute('aria-disabled', 'true');
    } finally {
      endOutage(account);
    }
    await page.getByRole('button', {name: t('en', 'state.retry')}).click();
    await expect(cards(page)).toHaveCount(1, crossing);
    await expect(page.getByRole('heading', {name: t('en', 'projects.error.title')})).toHaveCount(0);
  });

  test('asks again one request at a time: while "Try again" is out the button says so, a second press sends nothing, and a polite status says it', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await world.addProject(user, {title: 'Behind the outage'});
    const account = (await world.accountOf(user)).id as string;
    startOutage(account, {rpc: ['list_projects'], mode: 'down'});
    try {
      await open(page, `${flakyBaseUrl(baseURL!)}/projects`);
      await expect(page.getByRole('heading', {level: 2, name: t('en', 'projects.error.title')})).toBeVisible();
      await hydrated(page, 'main button');
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let asked = 0;
      await page.route('**/projects?_rsc=*', async (route) => {
        asked += 1;
        await held;
        return route.continue();
      });
      const retry = page.getByRole('button', {name: t('en', 'state.retry')});
      await retry.click();
      const trying = page.getByRole('button', {name: t('en', 'state.retrying')});
      await expect(trying).toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('.state-error [role="status"]')).toHaveText(t('en', 'state.retrying'));
      await trying.click({force: true});
      await trying.click({force: true});
      release();
      // Still down: the error is back, with the button ready again, and exactly one request went out for the three presses.
      await expect(page.getByRole('button', {name: t('en', 'state.retry')})).not.toHaveAttribute('aria-disabled', 'true', crossing);
      await expect(page.locator('.state-error [role="status"]')).toHaveText('');
      expect(asked).toBe(1);
    } finally {
      endOutage(account);
    }
  });

  test('Home says it could not read the list, and not that there are none, when the database cannot answer', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const account = (await world.accountOf(user)).id as string;
    startOutage(account, {rpc: ['list_projects'], mode: 'error'});
    try {
      await open(page, `${flakyBaseUrl(baseURL!)}/`);
      await expect(page.getByRole('heading', {level: 2, name: t('en', 'projects.error.title')})).toBeVisible();
      await expect(page.getByRole('heading', {name: t('en', 'projects.noneTitle')})).toHaveCount(0);
      await expect(page.getByText(t('en', 'home.projectsDetail', {count: 0}))).toHaveCount(0);
      // The actions are still there.
      await expect(page.getByRole('region', {name: t('en', 'a11y.primaryActions')}).getByRole('link', {name: new RegExp(t('en', 'nav.progress'))})).toBeVisible();
    } finally {
      endOutage(account);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a Project\'s overview and its Sources entry (UX-DR29, AC-2)', () => {
  // One for each fixture, which together hold every stage once (`projectFixtures` is not in the order of `projectStages`: Story 2.1's stage is last).
  for (const [index, fixture] of projectFixtures.entries()) {
    const stage = fixture.stage;
    test(`shows the Project at ${stage}: stage, Version, next required action, Model and Sources entries, and Rename`, async ({page, context, baseURL}) => {
      const user = await member(context, baseURL!);
      const ids = await world.addFixtureProjects(user);
      await openOverview(page, ids[index]);
      await expect(page.getByRole('heading', {level: 1})).toHaveText(fixture.title);
      await expect(page).toHaveTitle(`${fixture.title} · nova3D`);
      // The stage in words and in a shape.
      const badge = page.locator('.project-stage .status-badge');
      await expect(badge).toHaveText(t('en', stageDefinition(stage).label));
      await expect(badge.locator('svg')).toHaveCount(1);
      // The Version, and when it was last updated.
      const facts = page.locator('.project-facts');
      await expect(facts).toContainText(fixture.currentVersion > 0 ? t('en', 'project.version', {version: fixture.currentVersion}) : t('en', 'project.versionNone'));
      await expect(facts.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
      // The next required action is stated; with no page to do it in yet, it is words, not a link.
      const next = page.getByRole('region', {name: t('en', 'project.nextTitle')});
      await expect(next).toContainText(t('en', stageDefinition(stage).nextAction));
      await expect(next.getByRole('link')).toHaveCount(0);
      await expect(next).toContainText(t('en', 'project.nextNoPage'));
      // The Model entry and the Sources entry.
      await expect(page.getByRole('heading', {level: 2, name: t('en', 'project.model.title')})).toBeVisible();
      await expect(page.getByRole('main')).toContainText(fixture.currentVersion > 0 ? t('en', 'project.model.current', {version: fixture.currentVersion}) : t('en', 'project.model.none'));
      await expect(page.getByRole('link', {name: t('en', 'project.sources.title')})).toHaveAttribute('href', `/projects/${ids[index]}/sources`);
      await expect(renameButton(page)).toBeVisible();
      // Only Sources and the shell lead anywhere: there is no dead link in the page.
      const hrefs = await page.getByRole('main').locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      expect(hrefs).toEqual([`/projects/${ids[index]}/sources`]);
    });
  }

  test('says awaiting Model Approval and Export ready in Hebrew, right to left, in dark, at phone width', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!, {locale: 'he', theme: 'dark'});
    const ids = await world.addFixtureProjects(user);
    for (const stage of ['awaiting_model_approval', 'export_ready'] as const) {
      const index = projectFixtures.findIndex((fixture) => fixture.stage === stage);
      await openOverview(page, ids[index]);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', {level: 1})).toHaveText(projectFixtures[index].title);
      await expect(page.locator('.project-stage .status-badge')).toHaveText(t('he', stageDefinition(stage).label));
      await expect(page.getByRole('main')).toContainText(t('he', stageDefinition(stage).nextAction));
      await expect(page.getByRole('main')).toContainText(t('he', 'project.version', {version: projectFixtures[index].currentVersion}));
    }
    expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
  });

  test('Sources is an honest placeholder that names the Project and leads back, and Back goes up one level at a time', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Ramp and landing', stage: 'generating', version: 1});
    await openOverview(page, id);
    await page.getByRole('link', {name: t('en', 'project.sources.title')}).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${id}/sources`, crossing);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'sources.title'));
    await expect(page).toHaveTitle(`${t('en', 'meta.sources')} · nova3D`);
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'sources.emptyTitle')})).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Ramp and landing');
    await expect(page.locator('.back-link')).toHaveAttribute('href', `/projects/${id}`);
    await page.getByRole('link', {name: t('en', 'sources.back')}).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${id}`, crossing);
    await expect(page.locator('.back-link')).toHaveAttribute('href', '/projects');
    await expect(page.locator('nav [aria-current="page"]')).toHaveText(t('en', 'nav.projects'));
  });

  test('keeps a title of 120 unbroken characters inside the window at 320 px and 200% text, on every page and in every notice that carries it', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const long = 'W'.repeat(120);
    const id = await world.addProject(user, {title: long});
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    for (const url of [`/projects/${id}`, `/projects/${id}/sources`, '/projects', '/']) {
      await open(page, url);
      expect(await overflowReport(page), url).toEqual({scroll: 0, clipped: []});
    }

    // The success notice carries the new title: rename to another 120 unbroken characters, with the notice showing.
    await openOverview(page, id);
    const renamed = 'V'.repeat(120);
    await renameButton(page).click();
    await nameField(page).fill(renamed);
    await saveButton(page).click();
    await expect(page.locator('.notice-success')).toContainText(renamed, crossing);
    await expect(renameDialog(page)).toHaveCount(0);
    expect(await overflowReport(page), 'the rename notice').toEqual({scroll: 0, clipped: []});

    // The stale notice carries the other window's title: another window renames first, and this one saves from a stale revision.
    const other = await context.newPage();
    await openOverview(other, id);
    await renameButton(other).click();
    await nameField(other).fill('U'.repeat(120));
    await saveButton(other).click();
    await expect(other.getByRole('heading', {level: 1})).toHaveText('U'.repeat(120), crossing);
    await other.close();
    await renameButton(page).click();
    await nameField(page).fill('T'.repeat(120));
    await saveButton(page).click();
    await expect(renameDialog(page).locator('.notice-warning')).toContainText('U'.repeat(120), crossing);
    expect(await overflowReport(page), 'the stale notice').toEqual({scroll: 0, clipped: []});
    const box = (await renameDialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(await renameDialog(page).evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true);
  });

  test('keeps the Account panel, with a long address, inside the window at 320 px and 200% text', async ({page, context, baseURL}) => {
    const address = `someone.with.a.very.long.address.${'x'.repeat(48)}@example.test`;
    const user = await world.signedInUser({email: address});
    await world.activate(user);
    await signIn(context, baseURL!, user);
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    await open(page, '/');
    await hydrated(page, 'main button, header button');
    await page.getByRole('button', {name: t('en', 'nav.account'), exact: true}).click();
    const panel = page.getByRole('region', {name: t('en', 'account.title')});
    await expect(panel).toContainText(address);
    expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a link that cannot be opened is one page, a 404 that shows nothing of any Project (AC-3)', () => {
  /** The words of the page, with nothing that differs between two links that lead nowhere. */
  const unavailablePage = async (page: Page) => ({
    heading: await page.getByRole('heading', {level: 1}).innerText(),
    title: await page.title(),
    main: await page.getByRole('main').innerHTML(),
    links: await page.getByRole('main').locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  });

  test('is the same for another Account\'s Project, a deleted one, one that never existed and an ID that is no ID, on the overview and on Sources', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const other = await world.signedInUser();
    await world.activate(other);
    const foreign = await world.addProject(other, {title: 'Somebody else\'s secret plans'});
    const deleted = await world.addProject(user, {title: 'My deleted plans', deleted: true});
    const targets = [foreign, deleted, randomUUID(), 'not-an-id', '12345', `${foreign}x`, foreign.toUpperCase().slice(0, 30)];
    const seen: Awaited<ReturnType<typeof unavailablePage>>[] = [];
    for (const target of targets) {
      for (const suffix of ['', '/sources']) {
        const response = await page.goto(`/projects/${target}${suffix}`);
        expect(response?.status(), `${target}${suffix}`).toBe(404);
        await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.unavailable.title'));
        await expect(page).toHaveTitle(unavailableTitle('en'));
        await expect(page.getByRole('link', {name: t('en', 'project.unavailable.action')})).toHaveAttribute('href', '/projects');
        const html = await page.content();
        expect(html, `${target}${suffix}`).not.toContain('secret plans');
        expect(html, `${target}${suffix}`).not.toContain('My deleted plans');
        seen.push(await unavailablePage(page));
      }
    }
    // Every one of them is the same page, word for word.
    for (const entry of seen) expect(entry).toEqual(seen[0]);
  });

  test('is the same page for a real Project\'s ID with white space or encoding around it: only the exact ID opens it', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Only by its own ID'});
    await open(page, `/projects/${id}`);
    await open(page, `/projects/${id.toUpperCase()}`);
    const seen: Awaited<ReturnType<typeof unavailablePage>>[] = [];
    for (const target of [`%20${id}%20`, `%20${id}`, `${id}%20`, `${id}%0A`, `%09${id}`, `%C2%A0${id}`, `${id}%2F`]) {
      for (const suffix of ['', '/sources']) {
        const response = await page.goto(`/projects/${target}${suffix}`);
        expect(response?.status(), `${target}${suffix}`).toBe(404);
        await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.unavailable.title'));
        expect(await page.content()).not.toContain('Only by its own ID');
        seen.push(await unavailablePage(page));
      }
    }
    for (const entry of seen) expect(entry).toEqual(seen[0]);
  });

  test('is the same page for IDs that are not IDs in any spelling: encoded, empty-looking, non-Latin and very long', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    const seen: Awaited<ReturnType<typeof unavailablePage>>[] = [];
    for (const target of ['%E0%A4%A', '%00', '%20', '..%2F..%2Fetc', encodeURIComponent('המזבח'), 'a'.repeat(2000), '0'.repeat(36), '00000000-0000-0000-0000-000000000000']) {
      for (const suffix of ['', '/sources']) {
        const response = await page.goto(`/projects/${target}${suffix}`);
        expect(response?.status(), `${target.slice(0, 20)}${suffix}`).toBe(404);
        await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.unavailable.title'));
        seen.push(await unavailablePage(page));
      }
    }
    for (const entry of seen) expect(entry).toEqual(seen[0]);
  });

  test('an undecodable link keeps working as a page: sign-out, language and theme (Server Actions), and the navigation payload all go to the same address', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const bad = '/projects/%E0%A4%A';

    // Capture the Server Actions a real browser sends from Settings (theme and language), to send them from the undecodable address.
    const sent: {headers: Record<string, string>; body: string}[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) sent.push({headers: request.headers(), body: request.postData() ?? ''});
    });
    await open(page, '/settings');
    await hydrated(page, 'input[type="radio"]');
    await page.getByRole('radio', {name: 'Dark', exact: true}).check();
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({theme: 'dark'});
    await page.getByRole('radio', {name: 'עברית', exact: true}).check();
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({locale: 'he'});
    expect(sent.length).toBeGreaterThanOrEqual(2);
    const [theme, language] = sent.slice(-2);
    await world.db.query(`update identity.account_preferences p set theme = 'light', locale = 'en' from identity.accounts a where a.id = p.account_id and a.user_id = $1`, [user.id]);
    expect(await world.preferencesOf(user)).toMatchObject({theme: 'light', locale: 'en'});

    // The undecodable address renders the one unavailable page, a 404.
    const response = await page.goto(bad);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.unavailable.title'));

    // The navigation payload (what router.refresh() asks for) is answered at that address, not with the router's error.
    const payload = await page.evaluate(async (url) => {
      const answer = await fetch(url, {headers: {RSC: '1', accept: 'text/x-component'}});
      return {status: answer.status, body: await answer.text()};
    }, bad);
    expect(payload.status).toBe(200);
    expect(payload.body).toContain('NEXT_HTTP_ERROR_FALLBACK;404');

    // The two preference Server Actions, sent from this address as the browser sends them, are accepted and saved.
    for (const action of [theme, language]) {
      const answer = await page.evaluate(
        async ({url, headers, body}) => {
          const keep = ['next-action', 'next-router-state-tree', 'content-type', 'accept'];
          const response = await fetch(url, {method: 'POST', headers: Object.fromEntries(keep.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]])), body});
          return {status: response.status, text: await response.text()};
        },
        {url: bad, headers: action.headers, body: action.body},
      );
      expect(answer.status, answer.text.slice(0, 200)).toBe(200);
      expect(answer.text).not.toContain('URI malformed');
    }
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({theme: 'dark', locale: 'he'});

    // And sign out, through the Account menu of that very page.
    await page.goto(bad);
    await hydrated(page, 'header button');
    await page.getByRole('button', {name: t('he', 'nav.account'), exact: true}).or(page.getByRole('button', {name: t('en', 'nav.account'), exact: true})).click();
    await page.getByRole('button', {name: new RegExp(`${t('he', 'account.signOut')}|${t('en', 'account.signOut')}`)}).click();
    await expect(page).toHaveURL(/\/login/, crossing);
    expect(await world.sessionExists(user.sessionId)).toBe(false);
  });

  test('the unavailable page of an undecodable link, as a first page request, carries the CSRF cookie and adopts the device\'s choices like any other page', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!, {locale: 'he', theme: 'dark'});
    expect(await world.preferencesOf(user)).toBeUndefined();
    const response = await page.goto('/projects/%E0%A4%A');
    expect(response?.status()).toBe(404);
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    expect((await context.cookies()).some((cookie) => cookie.name === 'nova3d-csrf' && cookie.value.length > 20)).toBe(true);
    await expect.poll(() => world.preferencesOf(user)).toMatchObject({locale: 'he', theme: 'dark'});
  });

  test('puts nothing of another Account\'s Project in the page or in the navigation payload of the unavailable page', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    const other = await world.signedInUser();
    await world.activate(other);
    const foreign = await world.addProject(other, {title: 'Somebody else\'s secret plans'});
    await open(page, `/projects/${foreign}`, 404);
    // The browser's own requests, as the router makes them: a document, and the navigation payload (a 200 that carries the not-found
    // boundary, which is how the router reads it).
    for (const suffix of ['', '/sources']) {
      for (const kind of ['document', 'payload'] as const) {
        const answer = await page.evaluate(
          async ({url, kind}) => {
            const response = await fetch(url, {headers: kind === 'payload' ? {RSC: '1', accept: 'text/x-component'} : {accept: 'text/html'}});
            return {status: response.status, body: await response.text()};
          },
          {url: `/projects/${foreign}${suffix}`, kind},
        );
        if (kind === 'document') expect(answer.status, `${kind}${suffix}`).toBe(404);
        else expect(answer.body, `${kind}${suffix}`).toContain('NEXT_HTTP_ERROR_FALLBACK;404');
        expect(answer.body, `${kind}${suffix}`).toContain(t('en', 'project.unavailable.title'));
        expect(answer.body, `${kind}${suffix}`).not.toContain('secret plans');
        expect(answer.body, `${kind}${suffix}`).not.toContain(other.email);
      }
    }
  });

  test('is a stale link too: a Project deleted while its page is open is the unavailable page on the next load', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'About to go'});
    await openOverview(page, id);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('About to go');
    await world.hideProject(id);
    const response = await page.reload();
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.unavailable.title'));
    await open(page, '/projects');
    await expect(page.getByText('About to go')).toHaveCount(0);
  });

  test('is a retryable error, never the unavailable page, when the database cannot answer', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Behind the outage'});
    const account = (await world.accountOf(user)).id as string;
    startOutage(account, {rpc: ['get_project'], mode: 'down'});
    try {
      for (const suffix of ['', '/sources']) {
        const response = await open(page, `${flakyBaseUrl(baseURL!)}/projects/${id}${suffix}`, 200);
        expect(response.status()).toBe(200);
        await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.error.title'));
        await expect(page.getByRole('heading', {name: t('en', 'project.unavailable.title')})).toHaveCount(0);
        await expect(page.getByRole('button', {name: t('en', 'state.retry')})).toBeVisible();
        await expect(page.getByText('Behind the outage')).toHaveCount(0);
      }
    } finally {
      endOutage(account);
    }
    await hydrated(page, 'main button');
    await page.getByRole('button', {name: t('en', 'state.retry')}).click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'sources.title'), crossing);
  });

  test('is private: a signed-out visitor is sent to sign in, and a disabled Account is signed out', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user);
    await open(page, `/projects/${id}`);
    await context.clearCookies();
    await page.goto(`/projects/${id}`);
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/login`));
    await signIn(context, baseURL!, user);
    await open(page, `/projects/${id}`);
    await world.setStatus(user, 'disabled');
    await page.goto(`/projects/${id}`);
    // Signed out either way: a page prefetch of the open page may already have ended the session, which reads "not signed in".
    await expect(page).toHaveURL(/\/login\?error=(?:account_disabled|not_signed_in)$/);
    expect(await page.content()).not.toContain('Courtyard bench');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('Rename (UX-DR30, AC-4)', () => {
  test('at the current revision commits: the title and the revision change everywhere, with a confirming notice', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before', updatedAt: '2026-10-01T10:00:00Z'});
    const other = await world.addProject(user, {title: 'Newest of the others', updatedAt: '2026-10-10T10:00:00Z'});
    await openOverview(page, id);
    await renameButton(page).click();
    await expect(renameDialog(page)).toBeVisible();
    // The field starts on the current name and takes focus.
    await expect(nameField(page)).toHaveValue('Before');
    await expect(nameField(page)).toBeFocused();
    await expect(renameDialog(page)).toHaveAttribute('aria-describedby', /.+/);
    await nameField(page).fill('  After the rename  ');
    await saveButton(page).click();
    await expect(renameDialog(page)).toHaveCount(0);
    // The page shows the new name, a confirming notice, and the name in the document title.
    await expect(page.getByRole('heading', {level: 1})).toHaveText('After the rename', crossing);
    await expect(page.locator('.notice-success')).toContainText(t('en', 'project.rename.done', {title: 'After the rename'}));
    await expect(announcer(page)).toHaveText(t('en', 'project.rename.done', {title: 'After the rename'}));
    await expect(page).toHaveTitle('After the rename · nova3D');
    await expect(renameButton(page)).toBeFocused();
    // The database: one rename, one bump, one receipt, and nothing else touched.
    expect(await world.projectOf(id)).toMatchObject({title: 'After the rename', revision: 2});
    expect(await world.projectOf(other)).toMatchObject({title: 'Newest of the others', revision: 1});
    expect(await world.renameReceipts(user)).toEqual([expect.objectContaining({project_id: id, command: 'rename', expected_revision: 1, title: 'After the rename', revision: 2})]);
    // Everywhere: My Projects lists it first now (it is the most recently updated), and Home shows it.
    await open(page, '/projects');
    expect(await cardTitles(page)).toEqual(['After the rename', 'Newest of the others']);
    await open(page, '/');
    expect(await cardTitles(page)).toEqual(['After the rename', 'Newest of the others']);
  });

  test('works from the keyboard alone, Enter saves, and focus returns to the Rename button', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    await renameButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(nameField(page)).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Typed with the keyboard');
    await page.keyboard.press('Enter');
    await expect(renameDialog(page)).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Typed with the keyboard', crossing);
    await expect(renameButton(page)).toBeFocused();
    expect((await world.projectOf(id))!.title).toBe('Typed with the keyboard');
  });

  test('closes with Escape or Cancel, changes nothing, and gives focus back', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    await renameButton(page).click();
    await nameField(page).fill('Never saved');
    await page.keyboard.press('Escape');
    await expect(renameDialog(page)).toHaveCount(0);
    await expect(renameButton(page)).toBeFocused();
    await renameButton(page).click();
    await expect(nameField(page)).toHaveValue('Before');
    await renameDialog(page).getByRole('button', {name: t('en', 'confirm.cancel')}).click();
    await expect(renameDialog(page)).toHaveCount(0);
    expect(await world.projectOf(id)).toMatchObject({title: 'Before', revision: 1});
    expect(await world.renameReceipts(user)).toEqual([]);
  });

  test('answers a bad title in a field error, in the person\'s language, and sends nothing', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    const posts: string[] = [];
    page.on('request', (request) => request.method() === 'POST' && posts.push(request.url()));
    await renameButton(page).click();
    const cases: [string, MessageKey][] = [
      ['', 'project.rename.error.empty'],
      ['     ', 'project.rename.error.empty'],
      ['x'.repeat(121), 'project.rename.error.tooLong'],
      ['two\tcolumns', 'project.rename.error.control'],
      ['Before', 'project.rename.error.same'],
    ];
    for (const [value, message] of cases) {
      await nameField(page).fill(value);
      await saveButton(page).click();
      await expect(nameField(page), JSON.stringify(value)).toBeFocused();
      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(renameDialog(page).locator('.notice-danger')).toHaveText(t('en', message, {max: 120}));
      await expect(renameDialog(page)).toBeVisible();
    }
    // Typing again clears the error.
    await nameField(page).fill('Fine');
    await expect(renameDialog(page).locator('.notice-danger')).toHaveCount(0);
    expect(posts).toEqual([]);
    expect(await world.projectOf(id)).toMatchObject({title: 'Before', revision: 1});
    expect(await world.renameReceipts(user)).toEqual([]);
  });

  test('keeps a title of 120 characters, in Hebrew too, exactly as it was written', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!, {locale: 'he'});
    const id = await world.addProject(user, {title: 'לפני'});
    await openOverview(page, id);
    await renameButton(page, 'he').click();
    const longHebrew = 'ש'.repeat(120);
    await nameField(page, 'he').fill(longHebrew);
    await saveButton(page, 'he').click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText(longHebrew, crossing);
    expect((await world.projectOf(id))!.title).toBe(longHebrew);
    await renameButton(page, 'he').click();
    await nameField(page, 'he').fill('המזבח החיצון והכבש');
    await saveButton(page, 'he').click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText('המזבח החיצון והכבש', crossing);
    await expect(page.locator('.notice-success')).toContainText(t('he', 'project.rename.done', {title: 'המזבח החיצון והכבש'}));
    expect(await world.projectOf(id)).toMatchObject({title: 'המזבח החיצון והכבש', revision: 3});
  });

  test('sends one command when Save is pressed twice at once', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    await renameButton(page).click();
    await nameField(page).fill('Pressed twice');
    await saveButton(page).dblclick();
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Pressed twice', crossing);
    expect(await world.renameReceipts(user)).toHaveLength(1);
    expect((await world.projectOf(id))!.revision).toBe(2);
  });

  test('keeps the dialog open while a save is in flight: Escape, a click outside and Cancel wait, and the outcome is shown', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/projects/${id}`, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST' || !request.headers()['next-action']) return route.continue();
      await held;
      return route.continue();
    });
    await renameButton(page).click();
    await nameField(page).fill('Saved while the dialog was held');
    await saveButton(page).click();
    await expect(renameDialog(page).locator('[role="status"]')).toHaveText(t('en', 'project.rename.pending'));
    const cancel = renameDialog(page).getByRole('button', {name: t('en', 'confirm.cancel')});
    await expect(cancel).toHaveAttribute('aria-disabled', 'true');
    // Nothing closes it: Escape (twice, which a browser would otherwise let through), the backdrop and Cancel.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(renameDialog(page)).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(renameDialog(page)).toBeVisible();
    // (Playwright will not click an aria-disabled control unless forced; a person can, so it is forced here.)
    await cancel.click({force: true});
    await expect(renameDialog(page)).toBeVisible();
    await expect(nameField(page)).toHaveValue('Saved while the dialog was held');
    expect((await world.projectOf(id))!.title).toBe('Before');
    // The answer comes, and it is shown: the dialog closes by itself, with the confirming notice.
    release();
    await expect(renameDialog(page)).toHaveCount(0, crossing);
    await expect(page.locator('.notice-success')).toContainText(t('en', 'project.rename.done', {title: 'Saved while the dialog was held'}));
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Saved while the dialog was held');
    expect(await world.renameReceipts(user)).toHaveLength(1);
  });

  test('shows a failure that arrives while the person tried to close the dialog, and Cancel works again once it is over', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/projects/${id}`, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST' || !request.headers()['next-action']) return route.continue();
      await held;
      return route.abort('connectionreset');
    });
    await renameButton(page).click();
    await nameField(page).fill('Never arrives');
    await saveButton(page).click();
    await expect(renameDialog(page).locator('[role="status"]')).toHaveText(t('en', 'project.rename.pending'));
    await page.keyboard.press('Escape');
    await renameDialog(page).getByRole('button', {name: t('en', 'confirm.cancel')}).click({force: true});
    await expect(renameDialog(page)).toBeVisible();
    release();
    // The error is there to be read, in the dialog the person tried to leave.
    await expect(renameDialog(page).locator('.notice[role="alert"]')).toContainText(t('en', 'project.rename.unknown'), crossing);
    await expect(renameDialog(page).getByRole('button', {name: t('en', 'confirm.cancel')})).not.toHaveAttribute('aria-disabled', 'true');
    await renameDialog(page).getByRole('button', {name: t('en', 'confirm.cancel')}).click();
    await expect(renameDialog(page)).toHaveCount(0);
    expect((await world.projectOf(id))!.title).toBe('Before');
  });

  test('retries a lost answer with the SAME command: the rename that committed is answered from its receipt, once, with no stale warning', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    // The first save reaches the server and COMMITS; its answer is then cut off on the way back. The second goes through.
    let posts = 0;
    let committedFirst = false;
    await page.route(`**/projects/${id}`, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST' || !request.headers()['next-action']) return route.continue();
      posts += 1;
      if (posts === 1) {
        await route.fetch();
        committedFirst = true;
        return route.abort('connectionreset');
      }
      return route.continue();
    });
    await renameButton(page).click();
    const commandId = renameDialog(page).locator('input[name="commandId"]');
    const expectedRevision = renameDialog(page).locator('input[name="expectedRevision"]');
    await nameField(page).fill('After a lost answer');
    const first = await commandId.inputValue();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await expect(expectedRevision).toHaveValue('1');
    await saveButton(page).click();

    // The person is told it is not known, and the rename in fact happened: one receipt, revision 2.
    await expect(renameDialog(page).locator('.notice[role="alert"]')).toContainText(t('en', 'project.rename.unknown'), crossing);
    expect(committedFirst).toBe(true);
    expect(await world.projectOf(id)).toMatchObject({title: 'After a lost answer', revision: 2});
    expect(await world.renameReceipts(user)).toHaveLength(1);
    // Nothing the dialog holds has changed: the very same command, for the very same revision and title.
    await expect(commandId).toHaveValue(first);
    await expect(expectedRevision).toHaveValue('1');
    await expect(nameField(page)).toHaveValue('After a lost answer');

    // The command is a function of what is being asked: another title is another command, and typing it back is the same one again.
    await nameField(page).fill('Some other title');
    const other = await commandId.inputValue();
    expect(other).not.toBe(first);
    expect(other).toMatch(/^[0-9a-f]{8}-/);
    await nameField(page).fill('After a lost answer');
    await expect(commandId).toHaveValue(first);

    // Save again: the database answers the original receipt. A success, not "someone renamed it first".
    await saveButton(page).click();
    await expect(renameDialog(page)).toHaveCount(0, crossing);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('After a lost answer', crossing);
    await expect(page.locator('.notice-success')).toContainText(t('en', 'project.rename.done', {title: 'After a lost answer'}));
    await expect(page.locator('.notice-warning')).toHaveCount(0);
    await expect(page.locator('.notice[role="alert"]')).toHaveCount(0);
    expect(posts).toBe(2);
    expect(await world.projectOf(id)).toMatchObject({title: 'After a lost answer', revision: 2});
    const receipts = await world.renameReceipts(user);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({command_id: first, project_id: id, expected_revision: 1, revision: 2, title: 'After a lost answer'});
  });

  test('uses another command when the revision changes under the dialog (a stale answer refreshes the page), and the ID is the same across a title change that is undone', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    const other = await context.newPage();
    await openOverview(other, id);
    await renameButton(other).click();
    await nameField(other).fill('Renamed elsewhere');
    await saveButton(other).click();
    await expect(other.getByRole('heading', {level: 1})).toHaveText('Renamed elsewhere', crossing);
    await other.close();

    await renameButton(page).click();
    const commandId = renameDialog(page).locator('input[name="commandId"]');
    await nameField(page).fill('Mine, from the old revision');
    const before = await commandId.inputValue();
    await expect(renameDialog(page).locator('input[name="expectedRevision"]')).toHaveValue('1');
    await saveButton(page).click();
    await expect(renameDialog(page).locator('.notice-warning')).toBeVisible(crossing);
    // The page refreshed to revision 2, and with it the dialog's revision and its command: the next save is a new attempt.
    await expect(renameDialog(page).locator('input[name="expectedRevision"]')).toHaveValue('2', crossing);
    await expect(commandId).not.toHaveValue(before);
    expect(await world.renameReceipts(user)).toHaveLength(1);
  });

  test('rejects a stale expected revision when another window renamed first: the current name is shown, nothing changes, and saving again commits once (AC-4)', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    const other = await context.newPage();
    await openOverview(other, id);

    // The second window renames first.
    await renameButton(other).click();
    await nameField(other).fill('Renamed in the second window');
    await saveButton(other).click();
    await expect(other.getByRole('heading', {level: 1})).toHaveText('Renamed in the second window', crossing);
    expect(await world.projectOf(id)).toMatchObject({title: 'Renamed in the second window', revision: 2});

    // The first window still shows the old name and revision 1. Its save is stale.
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Before');
    await renameButton(page).click();
    await nameField(page).fill('Renamed in the first window');
    await saveButton(page).click();
    const warning = renameDialog(page).locator('.notice-warning');
    await expect(warning).toContainText(t('en', 'project.rename.stale', {title: 'Renamed in the second window'}), crossing);
    await expect(warning).toHaveAttribute('role', 'alert');
    // Nothing changed: the other window's name stands, at revision 2, and no second receipt was written.
    expect(await world.projectOf(id)).toMatchObject({title: 'Renamed in the second window', revision: 2});
    expect(await world.renameReceipts(user)).toHaveLength(1);
    // The page behind the dialog shows the current name (the action refreshed it), and the dialog stays open with what was typed.
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Renamed in the second window', crossing);
    await expect(renameDialog(page)).toBeVisible();
    await expect(nameField(page)).toHaveValue('Renamed in the first window');

    // Saving again is a new attempt at the current revision, and commits once.
    await saveButton(page).click();
    await expect(renameDialog(page)).toHaveCount(0, crossing);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Renamed in the first window', crossing);
    expect(await world.projectOf(id)).toMatchObject({title: 'Renamed in the first window', revision: 3});
    expect(await world.renameReceipts(user)).toEqual([
      expect.objectContaining({title: 'Renamed in the second window', expected_revision: 1, revision: 2}),
      expect.objectContaining({title: 'Renamed in the first window', expected_revision: 2, revision: 3}),
    ]);
    await other.close();
  });

  test('says the outcome is unknown when the database is down, keeps the dialog and the typed name, and a retry commits once', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    const account = (await world.accountOf(user)).id as string;
    await open(page, `${flakyBaseUrl(baseURL!)}/projects/${id}`);
    await hydrated(page, 'main button');
    await renameButton(page).click();
    await nameField(page).fill('Typed during the outage');
    startOutage(account, {rpc: ['rename_project'], mode: 'down'});
    try {
      await saveButton(page).click();
      await expect(renameDialog(page).locator('.notice[role="alert"]')).toContainText(t('en', 'project.rename.unknown'), crossing);
      await expect(renameDialog(page)).toBeVisible();
      await expect(nameField(page)).toHaveValue('Typed during the outage');
      expect(await world.projectOf(id)).toMatchObject({title: 'Before', revision: 1});
    } finally {
      endOutage(account);
    }
    await saveButton(page).click();
    await expect(renameDialog(page)).toHaveCount(0, crossing);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Typed during the outage', crossing);
    expect(await world.renameReceipts(user)).toHaveLength(1);
    expect((await world.projectOf(id))!.revision).toBe(2);
  });

  test('says the same when the database answers with an error', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    const account = (await world.accountOf(user)).id as string;
    await page.goto(`${flakyBaseUrl(baseURL!)}/projects/${id}`);
    await hydrated(page, 'main button');
    await renameButton(page).click();
    await nameField(page).fill('Typed during the outage');
    startOutage(account, {rpc: ['rename_project'], mode: 'error'});
    try {
      await saveButton(page).click();
      await expect(renameDialog(page).locator('.notice[role="alert"]')).toContainText(t('en', 'project.rename.unknown'), crossing);
    } finally {
      endOutage(account);
    }
    expect(await world.projectOf(id)).toMatchObject({title: 'Before', revision: 1});
  });

  test('is refused at the gate when the Account was disabled while the dialog was open, and nothing changes', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    await renameButton(page).click();
    await nameField(page).fill('Too late');
    await world.setStatus(user, 'disabled');
    await saveButton(page).click();
    // The proxy refuses the request first and signs the browser out; the page then reloads and the gate sends it to sign-in.
    await expect(page).toHaveURL(/\/login\?error=(?:account_disabled|not_signed_in)$/, crossing);
    await expect(page.getByRole('navigation', {name: t('en', 'a11y.mainNavigation')})).toHaveCount(0);
    expect(await world.projectOf(id)).toMatchObject({title: 'Before', revision: 1});
    expect(await world.renameReceipts(user)).toEqual([]);
  });

  test('is refused when the session was signed out while the dialog was open, and nothing changes', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    await renameButton(page).click();
    await nameField(page).fill('Too late');
    await world.revokeGrant(user, user.sessionId);
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/login/, crossing);
    expect(await world.projectOf(id)).toMatchObject({title: 'Before', revision: 1});
    expect(await world.renameReceipts(user)).toEqual([]);
  });

  test('is refused when the epoch moved on (a recovery or a disable and re-enable) while the dialog was open', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    await renameButton(page).click();
    await nameField(page).fill('Too late');
    await world.raiseEpoch(user);
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/login/, crossing);
    expect(await world.projectOf(id)).toMatchObject({title: 'Before', revision: 1});
    expect(await world.renameReceipts(user)).toEqual([]);
  });

  test('is told the Project is gone, with nothing changed, when it was deleted while the dialog was open', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const id = await world.addProject(user, {title: 'Before'});
    await openOverview(page, id);
    await renameButton(page).click();
    await nameField(page).fill('Too late');
    await world.hideProject(id);
    await saveButton(page).click();
    // The page refreshed behind the dialog and is now the one unavailable page; whatever the dialog said, no name was set.
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.unavailable.title'), crossing);
    expect((await world.projectOf(id))!.title).toBe('Before');
    expect(await world.renameReceipts(user)).toEqual([]);
  });

  test('never renames another Account\'s Project, even with its ID in the form', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const mine = await world.addProject(user, {title: 'Mine'});
    const other = await world.signedInUser();
    await world.activate(other);
    const theirs = await world.addProject(other, {title: 'Theirs'});
    await openOverview(page, mine);
    await renameButton(page).click();
    await nameField(page).fill('Taken over');
    // A form that names someone else's Project: the hidden field is swapped before Save.
    await page.evaluate((target) => {
      (document.querySelector('dialog input[name="projectId"]') as HTMLInputElement).value = target;
    }, theirs);
    await saveButton(page).click();
    // The database does not know that Project for this Account: the answer is the one for a Project that is not available, and
    // the person's own page is as it was.
    await expect(renameDialog(page).locator('.notice[role="alert"]')).toContainText(t('en', 'project.rename.gone'), crossing);
    await expect(page.getByRole('heading', {level: 1})).toHaveText('Mine');
    expect((await world.projectOf(theirs))!.title).toBe('Theirs');
    expect((await world.projectOf(mine))!.title).toBe('Mine');
    expect(await world.renameReceipts(user)).toEqual([]);
    expect(await world.renameReceipts(other)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('accessible, localized and responsive on every Project page (WCAG 2.2 AA)', () => {
  type Opened = {name: string; open: (page: Page, ids: string[], locale: Locale) => Promise<void>; unavailable?: true};
  const pages: Opened[] = [
    {name: 'Home with Projects', open: async (page) => void (await open(page, '/'))},
    {name: 'My Projects', open: async (page) => void (await open(page, '/projects'))},
    {name: 'My Projects with no match', open: async (page, _ids, locale) => {
      await open(page, '/projects');
      await hydrated(page, 'main button');
      await page.getByRole('searchbox').fill('zzz-no-such-project');
      // Strictly the no-match state, so axe and the overflow check run on it and on nothing else.
      await expect(page.getByRole('heading', {level: 2, name: t(locale, 'projects.emptyTitle')})).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
    }},
    {name: 'a Project overview', open: async (page, ids) => openOverview(page, ids[3])},
    {name: 'a Project overview with Rename open', open: async (page, ids, locale) => {
      await openOverview(page, ids[4]);
      await renameButton(page, locale).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    }},
    {name: 'Rename with a field error', open: async (page, ids, locale) => {
      await openOverview(page, ids[5]);
      await renameButton(page, locale).click();
      await page.getByRole('dialog').getByRole('textbox').fill('');
      await page.getByRole('dialog').getByRole('button').last().click();
      await expect(page.getByRole('dialog').locator('.notice-danger')).toBeVisible();
    }},
    {name: 'Sources', open: async (page, ids) => void (await open(page, `/projects/${ids[0]}/sources`))},
    {name: 'the unavailable page', unavailable: true, open: async (page) => void (await open(page, `/projects/${randomUUID()}`, 404))},
    {name: 'In Progress', open: async (page) => void (await open(page, '/progress'))},
  ];

  for (const variant of variants) {
    for (const entry of pages) {
      test(`${entry.name} has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
        const user = await member(context, baseURL!, variant);
        const ids = await world.addFixtureProjects(user);
        const problems = watchForProblems(page);
        // Every response that is a failure, by address: nothing may be missing from any page, and the one page that is a 404 fails
        // only with its own document.
        const failed: string[] = [];
        page.on('response', (response) => {
          if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
        });
        await entry.open(page, ids, variant.locale);
        await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
        await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
        expect(await violations(page)).toEqual([]);
        if (!(await page.getByRole('dialog').count())) expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
        const expectedFailures = entry.unavailable ? [`404 ${new URL(page.url()).pathname}`] : [];
        expect(failed).toEqual(expectedFailures);
        // The browser reports a failed load as a console error without its address; it is excused only for the unavailable page's own
        // 404 document (checked by address just above), and a missing asset on any page, that one included, still fails the run.
        expect(problems.filter((problem) => !(entry.unavailable && /^error: Failed to load resource: the server responded with a status of 404/.test(problem)))).toEqual([]);
      });
    }
  }

  test('has no violations with high contrast requested, in light and dark', async ({page, context, baseURL}) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({contrast: 'more'});
      const user = await member(context, baseURL!, {theme});
      const ids = await world.addFixtureProjects(user);
      for (const url of ['/projects', `/projects/${ids[3]}`, '/']) {
        await open(page, url);
        expect(await violations(page), `${url} ${theme}`).toEqual([]);
      }
    }
  });

  test('reads right to left in Hebrew: the list, the overview and the dialog, with the title as written', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!, {locale: 'he', theme: 'dark'});
    const ids = await world.addFixtureProjects(user);
    await open(page, '/projects');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('he', 'nav.projects'));
    await expect(page.getByRole('searchbox', {name: t('he', 'projects.search')})).toBeVisible();
    await expect(page.getByLabel(t('he', 'projects.filterLabel'))).toBeVisible();
    await expect(cards(page).nth(3).locator('.project-title')).toHaveText('המזבח החיצון והכבש');
    await expect(cards(page).nth(3).locator('.status-badge')).toHaveText(t('he', stageDefinition('awaiting_model_approval').label));
    await openOverview(page, ids[3]);
    await renameButton(page, 'he').click();
    await expect(renameDialog(page, 'he')).toBeVisible();
    await expect(nameField(page, 'he')).toHaveValue('המזבח החיצון והכבש');
    expect(await violations(page)).toEqual([]);
  });

  for (const entry of pages.filter((candidate) => !/violations|no match|error/.test(candidate.name))) {
    test(`${entry.name} fits at 320 px with the text at 200%`, async ({page, context, baseURL}) => {
      const user = await member(context, baseURL!);
      const ids = await world.addFixtureProjects(user);
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      await entry.open(page, ids, 'en');
      if (!(await page.getByRole('dialog').count())) expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
      else expect(await page.getByRole('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true);
    });
  }

  test('puts the keyboard on every control in a sensible order, each with a visible focus ring', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const ids = await world.addFixtureProjects(user);
    for (const url of ['/projects', `/projects/${ids[3]}`]) {
      await open(page, url);
      await hydrated(page, 'main button');
      const problems: string[] = [];
      for (let step = 0; step < 30; step += 1) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || element === document.body) return null;
          const style = getComputedStyle(element);
          const wrapper = element.closest('.search-box, .filter-box') ? getComputedStyle(element.closest('.search-box, .filter-box') as HTMLElement) : null;
          const own = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
          const viaWrapper = wrapper !== null && wrapper.outlineStyle !== 'none' && parseFloat(wrapper.outlineWidth) >= 2;
          return {name: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 30) || element.tagName, visible: own || viaWrapper};
        });
        if (ring && !ring.visible) problems.push(ring.name);
      }
      expect(problems, url).toEqual([]);
    }
    // On the list the search comes first, then the stage filter, then the cards in order.
    await open(page, '/projects');
    const order = await page.evaluate(() => [...document.querySelectorAll('main input[type="search"], main select, main a.card-link')].map((element) => element.tagName.toLowerCase()));
    expect(order.slice(0, 2)).toEqual(['input', 'select']);
    expect(order.slice(2)).toEqual(Array(projectStages.length).fill('a'));
  });
});
