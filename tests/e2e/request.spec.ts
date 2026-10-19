import {randomUUID} from 'node:crypto';
import {expect, test, type BrowserContext, type Locator, type Page} from '@playwright/test';
import type {Locale, MessageKey} from '../../lib/i18n';
import {declineReasons, maxPersonalizationText, type DeclineReason} from '../../lib/request-intake';
import {middotManifest} from '../../packages/domains/middot/manifest';
import {announcer, hydrated, label, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {endOutage, flakyBaseUrl, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';

// Story 2.1: describe a model in words, check what was understood, confirm it, and find the request on the Project's page. C-01 (the Create
// dialog, made real for text), C-02 (the description) and C-06 (the understood request), in a real browser against the production build and
// the local Supabase stack. Each test forges a member's session; the Project and its first request revision come from the application's own
// Confirm, so the Server Action, the database function and the Project page all run. Every flow runs on `desktop` and `phone`.
//
// The default registry holds Middot's one subject, so the several-subjects question (C-06 ambiguous) cannot be reached here: it is held by
// tests/unit with the fixture registry.

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
const crossing = {timeout: 20_000};
const subject = middotManifest.subjects[0];
const subjectName = subject.displayName;
const newPath = '/projects/new';

// What a person does -----------------------------------------------------------------------------------------------------------

const heading = (page: Page) => page.getByRole('heading', {level: 1});
const descriptionField = (page: Page, locale: Locale = 'en') => page.getByLabel(t(locale, 'request.description.label'), {exact: true});
const wishField = (page: Page, locale: Locale = 'en') => page.getByLabel(t(locale, 'request.personalization.label'), {exact: true});
const continueButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'request.continue'), exact: true});
const scopeField = (page: Page, locale: Locale = 'en') => page.getByLabel(t(locale, 'request.review.scope'), {exact: true});
const outcomeField = (page: Page, locale: Locale = 'en') => page.getByLabel(t(locale, 'request.review.outcome'), {exact: true});
const confirmButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'request.review.confirm'), exact: true});
const editButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'request.review.edit'), exact: true});
const requestSection = (page: Page, locale: Locale = 'en') => page.getByRole('region', {name: t(locale, 'request.section.title'), exact: true});
const createButton = (page: Page, locale: Locale = 'en') => page.getByRole('navigation', {name: t(locale, 'a11y.mainNavigation')}).getByRole('button', {name: t(locale, 'nav.create')});
const createDialog = (page: Page, locale: Locale = 'en') => page.getByRole('dialog', {name: t(locale, 'create.title')});

/** Opens C-02 and waits until React has taken over its controls. */
async function openNew(page: Page, locale: Locale = 'en', base = '') {
  const response = await page.goto(`${base}${newPath}`);
  expect(response?.status(), newPath).toBe(200);
  await expect(heading(page)).toHaveText(t(locale, 'request.title'));
  await hydrated(page, 'main button[type="submit"]');
}

/** Fills C-02 and presses Continue. */
async function describe(page: Page, text: string, wish = '', locale: Locale = 'en') {
  await descriptionField(page, locale).fill(text);
  if (wish) await wishField(page, locale).fill(wish);
  await continueButton(page, locale).click();
}

/** From nothing to C-06 with the description understood (or not): the heading the step ends on. */
async function reachReview(page: Page, text: string, wish = '', locale: Locale = 'en', ends: MessageKey = 'request.review.title', base = '') {
  await openNew(page, locale, base);
  await describe(page, text, wish, locale);
  await expect(heading(page)).toHaveText(t(locale, ends), crossing);
}

/** The whole flow, to the Project page: describe, check, confirm. Returns the Project's ID from the address. */
async function confirmRequest(page: Page, text: string, wish = '', locale: Locale = 'en') {
  await reachReview(page, text, wish, locale);
  await confirmButton(page, locale).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
  await expect(heading(page)).toHaveText(subjectName);
  return new URL(page.url()).pathname.split('/').pop()!;
}

/** The command IDs this browser keeps for the requests it has tried to confirm (lib/request-view.ts `commandIdFor`), by request key. */
const storedCommands = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('nova3d-request-commands') ?? '{}') as Record<string, {id: string; at: number}>);
const defaultOutcome = (locale: Locale = 'en') => t(locale, 'request.review.outcomeDefault');
const alerts = (page: Page) => page.locator('.notice[role="alert"]');

const textOf = async (locator: Locator) => ((await locator.innerText()) ?? '').replace(/\s+/g, ' ').trim();
/** The id list a control is described by, as the elements' text. */
const descriptions = async (control: Locator) => {
  const ids = ((await control.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
  return Promise.all(ids.map((id) => control.page().locator(`[id="${id}"]`).innerText()));
};

// ---------------------------------------------------------------------------------------------------
test.describe('C-01: the Create dialog starts the text flow (UX-DR31)', () => {
  test('Enter text goes on to the description page when Continue is pressed, and the dialog is gone', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await page.goto('/');
    await hydrated(page, 'main button, header button');
    await createButton(page).click();
    const dialog = createDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', {name: new RegExp(t('en', 'create.textTitle'))}).check();
    await expect(dialog.getByText(t('en', 'create.textSelected'))).toBeVisible();
    await dialog.getByRole('link', {name: t('en', 'create.continue')}).click();
    await expect(page).toHaveURL(`${baseURL}${newPath}`, crossing);
    await expect(dialog).toHaveCount(0);
    await expect(heading(page)).toHaveText(t('en', 'request.title'));
  });

  test('Upload picture keeps its radio, and its Continue leads to the picture screen (Story 2.2), with no message that picture upload arrives later', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await page.goto('/');
    await hydrated(page, 'main button, header button');
    await createButton(page).click();
    const dialog = createDialog(page);
    await dialog.getByRole('radio', {name: new RegExp(t('en', 'create.imageTitle'))}).check();
    await expect(dialog.getByText(t('en', 'create.imageSelected'))).toBeVisible();
    expect(await textOf(dialog)).not.toMatch(/later release|arrives/i);
    await expect(page).toHaveURL(`${baseURL}/`);
    await dialog.getByRole('link', {name: t('en', 'create.continue')}).click();
    await expect(page).toHaveURL(`${baseURL}/projects/new/pictures`, crossing);
    await expect(heading(page)).toHaveText(t('en', 'picture.title.new'));
  });

  test('no longer says that creating is unavailable', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await page.goto('/');
    await hydrated(page, 'main button, header button');
    await createButton(page).click();
    const footnote = createDialog(page).locator('.dialog-footnote');
    await expect(footnote).toContainText(t('en', 'create.footnote'));
    expect(await textOf(footnote)).not.toMatch(/later release|arrives|unavailable/i);
  });

  test('is the same in Hebrew: the Continue link of each choice', async ({page, context, baseURL}) => {
    await member(context, baseURL!, {locale: 'he'});
    await page.goto('/');
    await hydrated(page, 'main button, header button');
    await createButton(page, 'he').click();
    const dialog = createDialog(page, 'he');
    await dialog.getByRole('radio', {name: new RegExp(t('he', 'create.imageTitle'))}).check();
    await expect(dialog.getByText(t('he', 'create.imageSelected'))).toBeVisible();
    await expect(dialog.getByRole('link', {name: t('he', 'create.continue')})).toHaveAttribute('href', '/projects/new/pictures');
    await dialog.getByRole('radio', {name: new RegExp(t('he', 'create.textTitle'))}).check();
    await dialog.getByRole('link', {name: t('he', 'create.continue')}).click();
    await expect(page).toHaveURL(`${baseURL}${newPath}`, crossing);
    await expect(heading(page)).toHaveText(t('he', 'request.title'));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('C-02: the description (UX-DR32)', () => {
  test('has a labelled description and an optional personalization, each with its example and help as visible text, and nothing pre-filled or in a placeholder', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await openNew(page);
    await expect(page).toHaveTitle(`${t('en', 'meta.newProject')} · nova3D`);
    const description = descriptionField(page);
    const wish = wishField(page);
    for (const field of [description, wish]) {
      await expect(field).toBeVisible();
      await expect(field).toHaveValue('');
      expect(await field.getAttribute('placeholder')).toBeNull();
    }
    await expect(description).toHaveAttribute('aria-required', 'true');
    expect(await descriptions(description)).toEqual([t('en', 'request.description.example'), t('en', 'request.description.help', {max: 2000})]);
    expect((await descriptions(wish))[0]).toBe(t('en', 'request.personalization.example'));
    await expect(page.getByText(t('en', 'request.personalization.help'), {exact: false})).toBeVisible();
    // Nothing is stored by looking.
    expect(await world.projectCount(user)).toBe(0);
  });

  test('says what is missing when Continue is pressed with nothing written: a field error, focus on the field, nothing stored', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await openNew(page);
    await continueButton(page).click();
    const description = descriptionField(page);
    await expect(description).toBeFocused();
    await expect(description).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => descriptions(description)).toContain(t('en', 'request.error.description.empty'));
    await expect(announcer(page)).toHaveText(t('en', 'request.announce.invalid'));
    await expect(heading(page)).toHaveText(t('en', 'request.title'));
    expect(await world.projectCount(user)).toBe(0);
    // Writing clears the error; the field is no longer marked.
    await description.fill('Build the altar');
    await expect(description).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('names a description that is too long, one with a control character, and a personalization that is too long, each on its own field', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await openNew(page);
    await describe(page, 'x'.repeat(2001));
    await expect(descriptionField(page)).toBeFocused();
    await expect.poll(() => descriptions(descriptionField(page))).toContain(t('en', 'request.error.description.tooLong', {max: 2000}));

    await descriptionField(page).fill('Build the altar\u0007 and ramp');
    await continueButton(page).click();
    await expect(descriptionField(page)).toBeFocused();
    await expect.poll(() => descriptions(descriptionField(page))).toContain(t('en', 'request.error.description.control'));

    // A valid description with a wish that is too long: the problem is the wish's, and focus goes to it.
    await descriptionField(page).fill('Build the altar and ramp');
    await wishField(page).fill('y'.repeat(301));
    await continueButton(page).click();
    await expect(wishField(page)).toBeFocused();
    await expect(wishField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(descriptionField(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => descriptions(wishField(page))).toContain(t('en', 'request.error.personalization.tooLong', {max: 300}));

    // Both at once: both marked, focus on the description (the first).
    await descriptionField(page).fill('');
    await continueButton(page).click();
    await expect(descriptionField(page)).toBeFocused();
    await expect(wishField(page)).toHaveAttribute('aria-invalid', 'true');
    expect(await world.projectCount(user)).toBe(0);
  });

  test('accepts a description of exactly 2,000 characters and a newline in it', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    // A matching word, a line break, and padding up to the limit.
    const text = `Build the altar\nand ramp ${'z'.repeat(2000 - 'Build the altar\nand ramp '.length)}`;
    expect(text).toHaveLength(2000);
    await describe(page, text);
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('C-06: the understood request, clear (UX-DR36)', () => {
  test('shows the subject, the scope and outcome prefilled and editable, the mode in words and that confirming starts nothing; Edit keeps every value; nothing is stored', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await openNew(page);
    await describe(page, 'Build the altar and ramp', 'Add "David" engraved on the base');
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
    // After the step: focus on the new heading, and the result announced.
    await expect(heading(page)).toBeFocused();
    await expect(announcer(page)).toHaveText(t('en', 'request.announce.clear'));

    const main = page.getByRole('main');
    await expect(main.locator('dl bdi', {hasText: subjectName})).toHaveCount(1);
    await expect(main.getByText(t('en', 'request.mode.evidence_text'))).toBeVisible();
    await expect(main.locator('.request-quote bdi')).toHaveText('Build the altar and ramp');
    await expect(scopeField(page)).toHaveValue(subjectName);
    await expect(outcomeField(page)).toHaveValue(t('en', 'request.review.outcomeDefault'));
    await expect(main.getByText(t('en', 'request.review.confirmNote'))).toBeVisible();
    // The wish as understood: the text, recessed, and that it is the person's own addition.
    await expect(main.locator('.wish-text')).toHaveText('David');
    await expect(main.locator('.request-wish')).toContainText(t('en', 'request.personalization.style.recessed'));
    await expect(main.locator('.request-wish')).toContainText(t('en', 'request.personalization.userAdded'));
    // It offers no way to approve, authorize or pay for anything.
    await expect(main.getByRole('button')).toHaveText([t('en', 'request.review.confirm'), t('en', 'request.review.edit')]);
    expect(await world.projectCount(user)).toBe(0);
    expect(await world.requestsOf(user)).toEqual([]);

    // Edit: back to C-02 with every value kept, focus on its heading.
    await scopeField(page).fill('My own scope');
    await editButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'request.title'));
    await expect(heading(page)).toBeFocused();
    await expect(announcer(page)).toHaveText(t('en', 'request.announce.edit'));
    await expect(descriptionField(page)).toHaveValue('Build the altar and ramp');
    await expect(wishField(page)).toHaveValue('Add "David" engraved on the base');
    expect(await world.projectCount(user)).toBe(0);

    // Continue again: the review is back, and the scope the person edited is still theirs.
    await continueButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
    await expect(heading(page)).toBeFocused();
    await expect(scopeField(page)).toHaveValue('My own scope');
    expect(await world.projectCount(user)).toBe(0);
  });

  test('matches the words a person writes: whole words only, case folded, Hebrew points removed, Hebrew prefixes allowed', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    for (const text of ['Altar,', 'RAMP', 'the Mizbeach of the Temple', 'מִזְבֵּחַ', 'המזבח', 'לכבש']) {
      await descriptionField(page).fill(text);
      await continueButton(page).click();
      await expect(heading(page), text).toHaveText(t('en', 'request.review.title'), crossing);
      await editButton(page).click();
      await expect(heading(page)).toHaveText(t('en', 'request.title'));
    }
    for (const text of ['altarpiece', 'ramps', 'kevesher']) {
      await descriptionField(page).fill(text);
      await continueButton(page).click();
      await expect(heading(page), text).toHaveText(t('en', 'request.noMatch.title'), crossing);
      await page.getByRole('button', {name: t('en', 'request.noMatch.edit')}).click();
      await expect(heading(page)).toHaveText(t('en', 'request.title'));
    }
  });

  test('checks scope and outcome before it sends anything: an empty one is a field error, focus on it, nothing stored', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'Build the altar and ramp');
    await scopeField(page).fill('   ');
    await confirmButton(page).click();
    await expect(scopeField(page)).toBeFocused();
    await expect(scopeField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => descriptions(scopeField(page))).toContain(t('en', 'request.error.scope.empty'));
    await scopeField(page).fill('x'.repeat(301));
    await outcomeField(page).fill('');
    await confirmButton(page).click();
    await expect(scopeField(page)).toBeFocused();
    await expect.poll(() => descriptions(scopeField(page))).toContain(t('en', 'request.error.scope.tooLong', {max: 300}));
    await expect(outcomeField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => descriptions(outcomeField(page))).toContain(t('en', 'request.error.outcome.empty'));
    expect(await world.projectCount(user)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('Confirm creates the Project and its first revision (AC-2, AC-3)', () => {
  test('stores exactly the edited values, goes to the Project, and shows the Request section, the stage and that nothing has started', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'Build the altar and ramp', 'Add "David" engraved on the base');
    await scopeField(page).fill('The altar only, without the ramp');
    await outcomeField(page).fill('A model to print for a classroom display');
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    const projectId = new URL(page.url()).pathname.split('/').pop()!;

    // One Project and one revision, holding exactly what the person confirmed.
    expect(await world.projectCount(user)).toBe(1);
    const stored = await world.requestsOf(user);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      project_id: projectId,
      seq: 1,
      mode: 'evidence_text',
      subject_id: subject.id,
      scope: 'The altar only, without the ramp',
      outcome: 'A model to print for a classroom display',
      description: 'Build the altar and ramp',
      personalization_wording: 'Add "David" engraved on the base',
      personalization_text: 'David',
      personalization_style: 'recessed',
      personalization_applied: true,
      personalization_reason: null,
      project_title: subjectName,
      project_stage: 'request_confirmed',
      project_revision: 1,
      project_version: 0,
    });

    // The Project's page: titled with the subject's display name, in the new stage, and saying nothing has started.
    await expect(page).toHaveTitle(`${subjectName} · nova3D`);
    await expect(page.locator('.project-stage')).toContainText(t('en', 'stage.request_confirmed.label'));
    await expect(page.locator('section.next-action')).toContainText(t('en', 'stage.request_confirmed.next'));
    expect(t('en', 'stage.request_confirmed.next')).toMatch(/nothing has started and nothing was charged/i);

    const section = requestSection(page);
    await expect(section).toBeVisible();
    await expect(section.getByRole('heading', {level: 2, name: t('en', 'request.section.title')})).toBeVisible();
    const facts = await textOf(section);
    for (const expected of [subjectName, 'The altar only, without the ramp', 'A model to print for a classroom display', t('en', 'request.mode.evidence_text'), 'David', t('en', 'request.personalization.style.recessed'), t('en', 'request.section.nothingStarted')]) {
      expect(facts, expected).toContain(expected);
    }
    // The section sits between the facts and the next action.
    const order = await page.locator('main').evaluate((main) => [...main.querySelectorAll('dl.project-facts:not(.request-facts), section.request-section, section.next-action')].map((element) => element.className));
    expect(order[0]).toContain('project-facts');
    expect(order[1]).toContain('request-section');
    expect(order[2]).toContain('next-action');
    // The time is UTC, in the format of the page's other times.
    await expect(section.locator('time')).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    const stamp = await section.locator('time').getAttribute('datetime');
    expect(Math.abs(Date.parse(stamp ?? '') - stored[0].confirmed_at.getTime())).toBeLessThan(1000);

    // No Job, permission, approval or payment is on the page: no control but Rename, Sources and the shell's own.
    await expect(page.getByRole('main').getByRole('button')).toHaveText([t('en', 'project.rename')]);
    await expect(page.getByRole('main').getByRole('link', {name: t('en', 'project.nextLink')})).toHaveCount(0);

    // My Projects lists it in its new stage.
    await page.goto('/projects');
    await expect(page.locator('article.project-card')).toHaveCount(1);
    await expect(page.locator('article.project-card')).toContainText(t('en', 'stage.request_confirmed.label'));
    await expect(page.locator('article.project-card')).toContainText(subjectName);
  });

  test('renames with Story 1.7\'s Rename: the Request section stays', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await confirmRequest(page, 'Build the altar and ramp');
    await hydrated(page, 'main button');
    await page.getByRole('button', {name: t('en', 'project.rename'), exact: true}).click();
    const dialog = page.getByRole('dialog', {name: t('en', 'project.rename.title')});
    await dialog.getByLabel(t('en', 'project.rename.label')).fill('Altar for the school');
    await dialog.getByRole('button', {name: t('en', 'project.rename.save')}).click();
    await expect(heading(page)).toHaveText('Altar for the school', crossing);
    await expect(requestSection(page)).toContainText(subjectName);
  });

  test('is a new Project for each request that is asked for: other words are another command', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await confirmRequest(page, 'Build the altar and ramp');
    await confirmRequest(page, 'Build the ramp');
    expect(await world.projectCount(user)).toBe(2);
    expect(await world.requestsOf(user)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('personalization (AC-2, AC-4)', () => {
  test('applies a quoted text with a recessed word, and raised with no style word, in English and Hebrew text', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await confirmRequest(page, 'Build the altar and ramp', 'Add "David" engraved on the base');
    await confirmRequest(page, 'Build the altar and ramp', 'Add "דוד"');
    await confirmRequest(page, 'Build the altar and ramp', 'Put «Sara» raised on the ramp');
    const stored = await world.requestsOf(user);
    expect(stored.map((row) => [row.personalization_text, row.personalization_style, row.personalization_applied, row.personalization_reason])).toEqual([
      ['David', 'recessed', true, null],
      ['דוד', 'raised', true, null],
      ['Sara', 'raised', true, null],
    ]);
  });

  test('records no wish at all as no wording, not applied, no reason', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'Build the altar and ramp');
    await expect(page.locator('.request-wish')).toHaveText(t('en', 'request.personalization.none'));
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    const [stored] = await world.requestsOf(user);
    expect(stored).toMatchObject({personalization_wording: null, personalization_text: null, personalization_style: null, personalization_applied: false, personalization_reason: null});
    await expect(requestSection(page)).toContainText(t('en', 'request.personalization.none'));
  });

  const unsupported: [string, string, DeclineReason][] = [
    ['has no quoted text', 'Add something nice', 'no_quoted_text'],
    ['has two texts', 'Add "David" and "Sara"', 'several_texts'],
    ['asks for raised and recessed together', 'Add "David" raised and engraved', 'conflicting_styles'],
    [`has a text of ${maxPersonalizationText + 1} characters`, `Add "${'W'.repeat(maxPersonalizationText + 1)}"`, 'text_too_long'],
  ];
  for (const [name, wording, reason] of unsupported) {
    test(`explains a wish that ${name} in plain words, still allows Confirm, and records it not applied with its reason`, async ({page, context, baseURL}) => {
      const user = await member(context, baseURL!);
      await reachReview(page, 'Build the altar and ramp', wording);
      const wish = page.locator('.request-wish');
      // The sentence's own words (the reason is added to it, and read below).
      await expect(wish).toContainText(t('en', 'request.personalization.notApplied').replace('{reason}', '').trim());
      await expect(wish).toContainText(t('en', `request.personalization.reason.${reason}` as MessageKey, {max: maxPersonalizationText}));
      await expect(wish).toContainText(t('en', 'request.personalization.declinedNote'));
      await expect(wish.locator('bdi')).toHaveText(wording);
      await expect(confirmButton(page)).toBeEnabled();
      await confirmButton(page).click();
      await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
      const [stored] = await world.requestsOf(user);
      expect(stored).toMatchObject({personalization_wording: wording, personalization_text: null, personalization_style: null, personalization_applied: false, personalization_reason: reason});
      // The Project page says the same: not applied, and why.
      await expect(requestSection(page)).toContainText(t('en', `request.personalization.reason.${reason}` as MessageKey, {max: maxPersonalizationText}));
    });
  }

  test('has a plain-words explanation, in both languages, for every reason a wish can be declined for', () => {
    for (const reason of declineReasons) {
      for (const locale of ['en', 'he'] as const) expect(t(locale, `request.personalization.reason.${reason}` as MessageKey, {max: 24}).length, `${locale}:${reason}`).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('C-06: nothing fits (AC-1)', () => {
  test('names the supported subject, offers a picture instead as a button that opens C-01 with Upload picture chosen, has no Confirm and stores nothing', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'a lighthouse', '', 'en', 'request.noMatch.title');
    await expect(heading(page)).toBeFocused();
    await expect(announcer(page)).toHaveText(t('en', 'request.announce.noMatch'));
    const main = page.getByRole('main');
    await expect(main.getByText(t('en', 'request.noMatch.body'))).toBeVisible();
    await expect(main.locator('.request-subjects bdi')).toHaveText([subjectName]);
    await expect(main.getByText(t('en', 'request.noMatch.hint'))).toBeVisible();
    await expect(confirmButton(page)).toHaveCount(0);
    await expect(main.locator('input[name="scope"], input[name="outcome"], input[name="commandId"]')).toHaveCount(0);

    await main.getByRole('button', {name: t('en', 'request.noMatch.picture')}).click();
    const dialog = createDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', {name: new RegExp(t('en', 'create.imageTitle'))})).toBeChecked();
    await expect(dialog.getByText(t('en', 'create.imageSelected'))).toBeVisible();
    await expect(dialog.getByRole('link', {name: t('en', 'create.continue')})).toHaveAttribute('href', '/projects/new/pictures');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await world.projectCount(user)).toBe(0);
    expect(await world.requestsOf(user)).toEqual([]);

    // The description can be changed, and then it matches.
    await main.getByRole('button', {name: t('en', 'request.noMatch.edit')}).click();
    await expect(heading(page)).toHaveText(t('en', 'request.title'));
    await expect(descriptionField(page)).toHaveValue('a lighthouse');
    await describe(page, 'a lighthouse with an altar');
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a retried Confirm creates at most one Project (idempotency)', () => {
  test('the same request confirmed in two windows of one browser is one Project: the second window is answered with the first one\'s Project', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const other = await context.newPage();
    await reachReview(page, 'Build the altar and ramp', 'Add "David" engraved');
    await reachReview(other, 'Build the altar and ramp', 'Add "David" engraved');
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    await confirmButton(other).click();
    // Both windows land on the same Project, and the database holds one Project and one revision.
    await expect(other).toHaveURL(page.url(), crossing);
    await expect(heading(other)).toHaveText(subjectName);
    expect(await world.projectCount(user)).toBe(1);
    const stored = await world.requestsOf(user);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({project_stage: 'request_confirmed', project_revision: 1, seq: 1});
    await other.close();
  });

  test('another request confirmed in a second window (a different scope) is a second Project', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const other = await context.newPage();
    await reachReview(page, 'Build the altar and ramp');
    await reachReview(other, 'Build the altar and ramp');
    await scopeField(other).fill('A different scope');
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    await confirmButton(other).click();
    await expect(other).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect(other.url()).not.toBe(page.url());
    expect(await world.projectCount(user)).toBe(2);
    expect((await world.requestsOf(user)).map((row) => row.scope).sort()).toEqual(['A different scope', subjectName].sort());
    await other.close();
  });

  test('a confirmation sent again by the same window after its answer was lost is the same command, and the Project is made once', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'Build the altar and ramp');
    // Pressing Confirm, then pressing it again while the first is in flight, sends one request.
    await confirmButton(page).dblclick();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect(await world.projectCount(user)).toBe(1);
  });

  test('says the outcome is unknown when the database is down, keeps what was typed, and a retry creates one Project', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const account = (await world.accountOf(user)).id as string;
    await reachReview(page, 'Build the altar and ramp', '', 'en', 'request.review.title', flakyBaseUrl(baseURL!));
    await scopeField(page).fill('Typed during the outage');
    startOutage(account, {rpc: ['create_project_request'], mode: 'down'});
    try {
      await confirmButton(page).click();
      await expect(page.locator('.notice[role="alert"]')).toContainText(t('en', 'request.confirm.unknown'), crossing);
      await expect(scopeField(page)).toHaveValue('Typed during the outage');
      await expect(announcer(page)).toHaveText(t('en', 'request.confirm.unknown'));
      expect(await world.projectCount(user)).toBe(0);
    } finally {
      endOutage(account);
    }
    // The ID was chosen when Confirm was pressed (the field is empty again once the answer is in), and the browser kept it for the retry.
    const sent = Object.values(await storedCommands(page));
    expect(sent).toHaveLength(1);
    const commandId = sent[0].id;
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect(await world.projectCount(user)).toBe(1);
    const stored = await world.requestsOf(user);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({scope: 'Typed during the outage', command_id: commandId});
  });

  test('says the same when the database answers with an error', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const account = (await world.accountOf(user)).id as string;
    await reachReview(page, 'Build the altar and ramp', '', 'en', 'request.review.title', flakyBaseUrl(baseURL!));
    startOutage(account, {rpc: ['create_project_request'], mode: 'error'});
    try {
      await confirmButton(page).click();
      await expect(page.locator('.notice[role="alert"]')).toContainText(t('en', 'request.confirm.unknown'), crossing);
    } finally {
      endOutage(account);
    }
    expect(await world.projectCount(user)).toBe(0);
  });

  test('is refused at the gate when the Account was disabled while the review was open, and nothing is stored', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'Build the altar and ramp');
    await world.setStatus(user, 'disabled');
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/login\?error=(?:account_disabled|not_signed_in)$/, crossing);
    expect(await world.projectCount(user)).toBe(0);
    expect(await world.requestsOf(user)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the command ID is chosen when Confirm is pressed, and kept for a retry (D3)', () => {
  test('is not on the review form or in the browser\'s storage until then; afterwards it is the stored revision\'s command', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'Build the altar and ramp');
    // Looking at the review, and typing in it, mint nothing: no ID in the form and nothing kept.
    await expect(page.locator('input[name="commandId"]')).toHaveValue('');
    await scopeField(page).fill('Typing');
    await scopeField(page).fill('Typing more');
    await outcomeField(page).fill('And more');
    await expect(page.locator('input[name="commandId"]')).toHaveValue('');
    expect(await storedCommands(page)).toEqual({});
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    const kept = Object.values(await storedCommands(page));
    expect(kept).toHaveLength(1);
    const [stored] = await world.requestsOf(user);
    expect(kept[0].id).toBe(stored.command_id);
    expect(Math.abs(Date.now() - kept[0].at)).toBeLessThan(5 * 60_000);
    expect(stored).toMatchObject({scope: 'Typing more', outcome: 'And more'});
  });

  test('recovers from a command ID the database says was used for something else: the next Confirm sends a new one and creates the Project', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const accountId = (await world.accountOf(user)).id as string;
    // A Project of this Account that already has a revision, so its command ID can be taken.
    const earlier = await world.addProject(user, {title: 'Made earlier'});
    await reachReview(page, 'Build the altar and ramp');
    // One Confirm that never reaches the server: the browser files the ID it chose under the key it uses for this request.
    await page.route('**/projects/new', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await confirmButton(page).click();
    await expect(alerts(page)).toContainText(t('en', 'request.confirm.unknown'), crossing);
    await page.unroute('**/projects/new');
    const filed = await storedCommands(page);
    expect(Object.keys(filed)).toHaveLength(1);
    const [key] = Object.keys(filed);
    expect(await world.projectCount(user)).toBe(1);

    // That key now points at a known ID, which another request of the Account (another digest) has already used.
    const taken = randomUUID();
    await page.evaluate(([name, id]) => localStorage.setItem('nova3d-request-commands', JSON.stringify({[name]: {id, at: Date.now()}})), [key, taken]);
    await world.db.query(
      `insert into projects.request_revisions (project_id, account_id, seq, command_id, mode, subject_id, scope, outcome, description, personalization_applied, digest, confirmed_at)
       values ($1, $2, 1, $3, 'evidence_text', $4, 'Earlier scope', 'Earlier outcome', 'Earlier description', false, $5, now())`,
      [earlier, accountId, taken, subject.id, 'a'.repeat(64)],
    );

    // The browser sends the ID it has filed; the database says it was used for something else; nothing is written, and the ID is dropped.
    await confirmButton(page).click();
    await expect(alerts(page)).toContainText(t('en', 'request.confirm.reused'), crossing);
    await expect(announcer(page)).toHaveText(t('en', 'request.confirm.reused'));
    await expect(page).toHaveURL(`${baseURL}${newPath}`);
    expect(await world.projectCount(user)).toBe(1);
    expect(await world.requestsOf(user)).toHaveLength(1);
    expect(await storedCommands(page)).toEqual({});

    // The next Confirm sends a different command ID and makes the Project.
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    const created = (await world.requestsOf(user)).filter((row) => row.project_id !== earlier);
    expect(created).toHaveLength(1);
    expect(created[0].command_id).not.toBe(taken);
    expect(created[0]).toMatchObject({scope: subjectName, project_stage: 'request_confirmed', project_revision: 1});
    expect(await world.projectCount(user)).toBe(2);
    // The browser now keeps the new ID for the request, in place of the one it dropped.
    const kept = Object.values(await storedCommands(page));
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(created[0].command_id);
  });

  test('says the project made from the request is gone when the same request is confirmed again after that Project was deleted, goes nowhere, and the next Confirm makes a new Project', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const first = await confirmRequest(page, 'Build the altar and ramp');
    // A deletion hides the Project (Story 8.x does it for real); the browser still holds the ID the request was confirmed with.
    await world.hideProject(first);
    await reachReview(page, 'Build the altar and ramp');
    await confirmButton(page).click();
    await expect(alerts(page)).toContainText(t('en', 'request.confirm.gone'), crossing);
    await expect(announcer(page)).toHaveText(t('en', 'request.confirm.gone'));
    // No redirect to a page that is not there, and nothing new is written.
    await expect(page).toHaveURL(`${baseURL}${newPath}`);
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'));
    expect(await world.projectCount(user)).toBe(1);
    expect(await world.requestsOf(user)).toHaveLength(1);
    // The ID is dropped, so confirming again is a new command and a new Project.
    expect(await storedCommands(page)).toEqual({});
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    const second = new URL(page.url()).pathname.split('/').pop()!;
    expect(second).not.toBe(first);
    expect(await world.projectCount(user)).toBe(2);
    expect(new Set((await world.requestsOf(user)).map((row) => row.command_id)).size).toBe(2);
    await expect(heading(page)).toHaveText(subjectName);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('what Confirm answered belongs to the review it was answered on (D2)', () => {
  test('Edit description leaves no field problem and no failure notice behind for the next review, and a retry after it is still one Project', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const account = (await world.accountOf(user)).id as string;
    await reachReview(page, 'Build the altar and ramp', '', 'en', 'request.review.title', flakyBaseUrl(baseURL!));

    // A field problem found before anything is sent.
    await scopeField(page).fill('   ');
    await confirmButton(page).click();
    await expect(scopeField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => descriptions(scopeField(page))).toContain(t('en', 'request.error.scope.empty'));
    await editButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'request.title'));
    await continueButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
    await expect(scopeField(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(t('en', 'request.error.scope.empty'))).toHaveCount(0);
    await expect(page.locator('.notice-danger')).toHaveCount(0);

    // A failure the service answered.
    await scopeField(page).fill('A scope that survives the outage');
    startOutage(account, {rpc: ['create_project_request'], mode: 'down'});
    try {
      await confirmButton(page).click();
      await expect(alerts(page)).toContainText(t('en', 'request.confirm.unknown'), crossing);
    } finally {
      endOutage(account);
    }
    expect(await world.projectCount(user)).toBe(0);
    await editButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'request.title'));
    await continueButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
    // The new review shows nothing of the old attempt, and keeps what the person typed.
    await expect(alerts(page)).toHaveCount(0);
    await expect(page.getByText(t('en', 'request.confirm.unknown'))).toHaveCount(0);
    await expect(page.locator('.notice-danger')).toHaveCount(0);
    await expect(scopeField(page)).toHaveValue('A scope that survives the outage');

    // Confirming again is the same command as the lost one (the browser kept its ID), so the Project is made once.
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect(await world.projectCount(user)).toBe(1);
    expect((await world.requestsOf(user))[0]).toMatchObject({scope: 'A scope that survives the outage'});
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the no-match screen (D5)', () => {
  for (const locale of ['en', 'he'] as const) {
    test(`makes changing the description the main button and the picture offer the second, with no later-release note after them, in ${locale}`, async ({page, context, baseURL}) => {
      const user = await member(context, baseURL!, {locale});
      await reachReview(page, locale === 'he' ? 'מגדלור' : 'a lighthouse', '', locale, 'request.noMatch.title');
      const main = page.getByRole('main');
      const change = main.getByRole('button', {name: t(locale, 'request.noMatch.edit'), exact: true});
      const picture = main.getByRole('button', {name: t(locale, 'request.noMatch.picture'), exact: true});
      await expect(change).toHaveClass(/btn-primary/);
      await expect(picture).toHaveClass(/btn-secondary/);
      // In the order they are read and tabbed.
      await expect(main.locator('.request-actions button')).toHaveText([t(locale, 'request.noMatch.edit'), t(locale, 'request.noMatch.picture')]);
      // Story 2.2 made the picture offer real: nothing follows the two buttons, and nothing says picture requests arrive later.
      expect(await main.locator('.request-actions').evaluate((actions) => actions.nextElementSibling === null)).toBe(true);
      expect(await textOf(main)).not.toMatch(/later release|בגרסה מאוחרת/);
      // The offer is still there and still opens C-01 with Upload picture chosen.
      await picture.click();
      await expect(createDialog(page, locale).getByRole('radio', {name: new RegExp(t(locale, 'create.imageTitle'))})).toBeChecked();
      expect(await world.projectCount(user)).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------------------------------
test.describe('what the wording means at the edges (B1, B2)', () => {
  test('takes the verb forms of the style words as whole words: engraving is recessed, embossing is raised, engravedish is neither (so raised)', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    const style = async (wording: string) => {
      await describe(page, 'Build the altar', wording);
      await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
      const wish = page.locator('.request-wish');
      await expect(wish.locator('.wish-text')).toHaveText('David');
      const text = await textOf(wish);
      await editButton(page).click();
      await expect(heading(page)).toHaveText(t('en', 'request.title'));
      return text;
    };
    expect(await style('Add "David" engraving')).toContain(t('en', 'request.personalization.style.recessed'));
    expect(await style('Add "David" embossing')).toContain(t('en', 'request.personalization.style.raised'));
    expect(await style('Add "David" engravedish')).toContain(t('en', 'request.personalization.style.raised'));
    expect(await style('Add "David" unraised')).toContain(t('en', 'request.personalization.style.raised'));
  });

  test('declines one quoted text with a stray quotation mark as several texts, naming the quotation marks that are understood, and records it so', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'Build the altar', '"צה"ל"');
    const wish = page.locator('.request-wish');
    await expect(wish).toContainText(t('en', 'request.personalization.reason.several_texts'));
    // The explanation names the three kinds of quotation mark, and says to put the exact text between one pair.
    const sentence = await textOf(wish);
    for (const named of ['straight', 'curly', '«…»', 'one pair']) expect(sentence, named).toContain(named);
    await expect(wish.locator('bdi')).toHaveText('"צה"ל"');
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect((await world.requestsOf(user))[0]).toMatchObject({personalization_wording: '"צה"ל"', personalization_text: null, personalization_style: null, personalization_applied: false, personalization_reason: 'several_texts'});
  });

  test('declines a lone quotation mark as no quoted text, and a pair with another mark after it as several texts', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    const reason = async (wording: string) => {
      await describe(page, 'Build the altar', wording);
      await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
      const text = await textOf(page.locator('.request-wish'));
      await editButton(page).click();
      await expect(heading(page)).toHaveText(t('en', 'request.title'));
      return text;
    };
    expect(await reason('Add "David engraved')).toContain(t('en', 'request.personalization.reason.no_quoted_text'));
    expect(await reason('Add “David engraved')).toContain(t('en', 'request.personalization.reason.no_quoted_text'));
    expect(await reason('Add "David" engraved "')).toContain(t('en', 'request.personalization.reason.several_texts'));
    expect(await reason('Add «David» raised»')).toContain(t('en', 'request.personalization.reason.several_texts'));
  });

  test('explains both in Hebrew, naming the quotation marks too', async ({page, context, baseURL}) => {
    await member(context, baseURL!, {locale: 'he'});
    await reachReview(page, 'המזבח', '"צה"ל"', 'he');
    const wish = page.locator('.request-wish');
    await expect(wish).toContainText(t('he', 'request.personalization.reason.several_texts'));
    expect(await textOf(wish)).toContain('«…»');
    await editButton(page, 'he').click();
    await wishField(page, 'he').fill('הוסיפו "דוד');
    await continueButton(page, 'he').click();
    await expect(heading(page)).toHaveText(t('he', 'request.review.title'), crossing);
    await expect(page.locator('.request-wish')).toContainText(t('he', 'request.personalization.reason.no_quoted_text'));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('text that draws nothing, and bidirectional controls (A3)', () => {
  test('refuses a scope of only zero-width characters and an outcome of only fill characters as empty, with focus on the field, and stores nothing', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await reachReview(page, 'Build the altar and ramp');
    await scopeField(page).fill('\u200b\u200b\u200d');
    await confirmButton(page).click();
    await expect(scopeField(page)).toBeFocused();
    await expect(scopeField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => descriptions(scopeField(page))).toContain(t('en', 'request.error.scope.empty'));
    await scopeField(page).fill('A real scope');
    await outcomeField(page).fill('\u2800\u3164');
    await confirmButton(page).click();
    await expect(outcomeField(page)).toBeFocused();
    await expect.poll(() => descriptions(outcomeField(page))).toContain(t('en', 'request.error.outcome.empty'));
    expect(await world.projectCount(user)).toBe(0);
    expect(await storedCommands(page)).toEqual({});
  });

  test('refuses a bidirectional override in the description and in the wording, each on its own field', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await openNew(page);
    await describe(page, 'Build the altar\u202e and ramp');
    await expect(descriptionField(page)).toBeFocused();
    await expect(descriptionField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => descriptions(descriptionField(page))).toContain(t('en', 'request.error.description.control'));
    await descriptionField(page).fill('Build the altar and ramp');
    await wishField(page).fill('Add "David"\u2066');
    await continueButton(page).click();
    await expect(wishField(page)).toBeFocused();
    await expect.poll(() => descriptions(wishField(page))).toContain(t('en', 'request.error.personalization.control'));
    await expect(descriptionField(page)).not.toHaveAttribute('aria-invalid', 'true');
    expect(await world.projectCount(user)).toBe(0);
  });

  test('accepts a zero-width non-joiner inside a word (Persian, Hebrew) and keeps it exactly as typed', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    const text = 'Build the altar and ramp: می\u200cخواهم و בנו\u200cאת';
    await reachReview(page, text);
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect((await world.requestsOf(user))[0].description).toBe(text);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the fields (D4)', () => {
  test('read in the direction of what is typed, and have no length limit that would cut it silently', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    for (const field of [descriptionField(page), wishField(page)]) {
      await expect(field).toHaveAttribute('dir', 'auto');
      expect(await field.getAttribute('maxlength')).toBeNull();
    }
    // Long text is kept whole, and the limit is a message, not a cut.
    await descriptionField(page).fill('x'.repeat(2500));
    expect((await descriptionField(page).inputValue()).length).toBe(2500);
    await descriptionField(page).fill('Build the altar and ramp');
    await continueButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
    for (const field of [scopeField(page), outcomeField(page)]) {
      await expect(field).toHaveAttribute('dir', 'auto');
      expect(await field.getAttribute('maxlength')).toBeNull();
    }
    await scopeField(page).fill('s'.repeat(400));
    expect((await scopeField(page).inputValue()).length).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('Hebrew, right to left (UX-DR5)', () => {
  /** The words on the page that are not the interface's: in a <bdi> (a person's text, the subject's name, a time). Whatever is left must be Hebrew. */
  const englishCopy = (page: Page) =>
    page.getByRole('main').evaluate((main) => {
      const copy = main.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('bdi').forEach((node) => node.remove());
      return ((copy.textContent ?? '').match(/[A-Za-z]{2,}/g) ?? []).filter((word) => !['nova', 'D'].includes(word));
    });

  test('runs the whole flow in Hebrew and dark: labels, errors, review, Project page, with no English copy outside the person\'s own text', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!, {locale: 'he', theme: 'dark'});
    await openNew(page, 'he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page).toHaveTitle(`${t('he', 'meta.newProject')} · nova3D`);
    expect(await englishCopy(page)).toEqual([]);
    await expect(wishField(page, 'he')).toBeVisible();
    await expect(page.getByText(t('he', 'request.description.example'))).toBeVisible();

    // An error, in Hebrew, on the field.
    await continueButton(page, 'he').click();
    await expect(descriptionField(page, 'he')).toBeFocused();
    await expect.poll(() => descriptions(descriptionField(page, 'he'))).toContain(t('he', 'request.error.description.empty'));
    expect(await englishCopy(page)).toEqual([]);

    // The description names the subject by its Hebrew alias with an article; the wish has no style word, so it is raised.
    await describe(page, 'בנו את המזבח והכבש', 'הוסיפו "דוד" על הבסיס', 'he');
    await expect(heading(page)).toHaveText(t('he', 'request.review.title'), crossing);
    await expect(heading(page)).toBeFocused();
    await expect(announcer(page)).toHaveText(t('he', 'request.announce.clear'));
    await expect(page.getByText(t('he', 'request.mode.evidence_text'))).toBeVisible();
    await expect(page.locator('.wish-text')).toHaveText('דוד');
    await expect(page.locator('.request-wish')).toContainText(t('he', 'request.personalization.style.raised'));
    await expect(page.getByText(t('he', 'request.review.confirmNote'))).toBeVisible();
    expect(await englishCopy(page)).toEqual([]);

    await confirmButton(page, 'he').click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    await expect(heading(page)).toHaveText(subjectName);
    const section = requestSection(page, 'he');
    await expect(section).toBeVisible();
    await expect(section).toContainText(t('he', 'request.personalization.style.raised'));
    await expect(page.locator('.project-stage')).toContainText(t('he', 'stage.request_confirmed.label'));
    await expect(page.locator('section.next-action')).toContainText(t('he', 'stage.request_confirmed.next'));
    expect(await englishCopy(page)).toEqual([]);
    const [stored] = await world.requestsOf(user);
    expect(stored).toMatchObject({description: 'בנו את המזבח והכבש', personalization_text: 'דוד', personalization_style: 'raised', personalization_applied: true, subject_id: subject.id});
  });

  test('matches a Hebrew description with an article (המזבח) and points (מִזְבֵּחַ)', async ({page, context, baseURL}) => {
    await member(context, baseURL!, {locale: 'he'});
    for (const text of ['המזבח', 'מִזְבֵּחַ', 'במזבח']) {
      await reachReview(page, text, '', 'he');
    }
  });

  test('explains a wish that cannot be applied in Hebrew, and says the confirmation starts nothing', async ({page, context, baseURL}) => {
    await member(context, baseURL!, {locale: 'he'});
    await reachReview(page, 'המזבח', 'משהו יפה', 'he');
    await expect(page.locator('.request-wish')).toContainText(t('he', 'request.personalization.reason.no_quoted_text'));
    await expect(page.getByText(t('he', 'request.review.confirmNote'))).toBeVisible();
  });

  test('says nothing fits in Hebrew, with the English name of the subject isolated in its own run', async ({page, context, baseURL}) => {
    await member(context, baseURL!, {locale: 'he'});
    await reachReview(page, 'מגדלור', '', 'he', 'request.noMatch.title');
    await expect(page.locator('.request-subjects bdi')).toHaveText([subjectName]);
    await expect(page.getByRole('button', {name: t('he', 'request.noMatch.picture')})).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('accessibility and layout', () => {
  type Entry = {name: string; reach: (page: Page, locale: Locale) => Promise<void>};
  const pages: Entry[] = [
    {name: 'C-02 the description', reach: (page, locale) => openNew(page, locale)},
    {
      name: 'C-02 with its field errors',
      reach: async (page, locale) => {
        await openNew(page, locale);
        await wishField(page, locale).fill('y'.repeat(301));
        await continueButton(page, locale).click();
        await expect(descriptionField(page, locale)).toBeFocused();
      },
    },
    {name: 'C-06 the understood request', reach: (page, locale) => reachReview(page, locale === 'he' ? 'בנו את המזבח' : 'Build the altar and ramp', locale === 'he' ? 'הוסיפו "דוד" חרוט' : 'Add "David" engraved', locale)},
    {name: 'C-06 with a declined wish', reach: (page, locale) => reachReview(page, locale === 'he' ? 'בנו את המזבח' : 'Build the altar and ramp', locale === 'he' ? 'משהו יפה' : 'Add something nice', locale)},
    {name: 'C-06 nothing fits', reach: (page, locale) => reachReview(page, locale === 'he' ? 'מגדלור' : 'a lighthouse', '', locale, 'request.noMatch.title')},
    {
      name: 'the Project page with its Request section',
      reach: async (page, locale) => {
        await confirmRequest(page, locale === 'he' ? 'בנו את המזבח' : 'Build the altar and ramp', locale === 'he' ? 'הוסיפו "דוד" חרוט' : 'Add "David" engraved', locale);
        await expect(requestSection(page, locale)).toBeVisible();
      },
    },
  ];

  for (const variant of variants) {
    for (const entry of pages) {
      test(`${entry.name} has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
        await member(context, baseURL!, variant);
        const problems = watchForProblems(page);
        const failed: string[] = [];
        page.on('response', (response) => {
          if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
        });
        await entry.reach(page, variant.locale);
        await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
        await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
        expect(await violations(page)).toEqual([]);
        expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
        expect(failed).toEqual([]);
        expect(problems).toEqual([]);
      });
    }
  }

  for (const entry of pages) {
    test(`${entry.name} fits at 320 px with the text at 200%`, async ({page, context, baseURL}) => {
      await member(context, baseURL!);
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      await entry.reach(page, 'en');
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    });
  }

  test('keeps a 2,000-character description and a 300-character scope and outcome of unbroken letters inside the window at 320 px and 200% text, on every page that carries them', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    // The first word matches; the rest is one long unbroken run.
    await reachReview(page, `altar ${'W'.repeat(1990)}`, `Add "${'V'.repeat(24)}" engraved ${'U'.repeat(200)}`);
    expect(await overflowReport(page), 'the review').toEqual({scroll: 0, clipped: []});
    await scopeField(page).fill('S'.repeat(300));
    await outcomeField(page).fill('O'.repeat(300));
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    await expect(requestSection(page)).toContainText('S'.repeat(300));
    expect(await overflowReport(page), 'the Project page').toEqual({scroll: 0, clipped: []});
  });

  test('uses the phone width well: the whole flow is done with the same controls', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await page.setViewportSize({width: 360, height: 740});
    await confirmRequest(page, 'Build the altar and ramp', 'Add "David" engraved');
    expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    expect(await world.projectCount(user)).toBe(1);
  });

  test('puts the keyboard on every control of the flow in order, each with a visible focus ring, and Enter in the wish field... adds a line, while the button submits', async ({page, context, baseURL}) => {
    const user = await member(context, baseURL!);
    await openNew(page);
    const ring = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).outlineStyle !== 'none' && parseFloat(getComputedStyle(element).outlineWidth) > 0);
    await descriptionField(page).focus();
    await page.keyboard.type('Build the altar');
    // Enter in a text area is a line break, not a submission.
    await page.keyboard.press('Enter');
    await page.keyboard.type('and ramp');
    await expect(descriptionField(page)).toHaveValue('Build the altar\nand ramp');
    await expect(heading(page)).toHaveText(t('en', 'request.title'));
    await page.keyboard.press('Tab');
    await expect(wishField(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(continueButton(page)).toBeFocused();
    expect(await ring(continueButton(page))).toBe(true);
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
    await expect(heading(page)).toBeFocused();
    // The review: Tab goes to the scope, the outcome, Confirm and Edit, in that order.
    for (const control of [scopeField(page), outcomeField(page), confirmButton(page), editButton(page)]) {
      await page.keyboard.press('Tab');
      await expect(control).toBeFocused();
      expect(await ring(control)).toBe(true);
    }
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText(t('en', 'request.title'));
    await expect(descriptionField(page)).toHaveValue('Build the altar\nand ramp');
    expect(await world.projectCount(user)).toBe(0);
    // Back to the review, and Confirm with the keyboard.
    await continueButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText(t('en', 'request.review.title'), crossing);
    await confirmButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect(await world.projectCount(user)).toBe(1);
    // A description with a line break is stored as typed, with a newline.
    expect((await world.requestsOf(user))[0].description).toBe('Build the altar\nand ramp');
  });
});
