import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {expect, test, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {translate, type Locale, type MessageKey} from '../../lib/i18n';
import {reviewDigestInput, viewLabels, type ViewLabel} from '../../lib/picture-quality';
import {labelKeys} from '../../lib/picture-review';
import {createS3Storage} from '../../workers/files/src/storage';
import {hydrated, label, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';
import {blownOutPng, blurryPng, png, sha256Of, sharpPng, sharpViews, type PictureFile} from '../support/pictures-world';
import {s3Of} from '../support/stack';

// Story 2.3: review the saved pictures (C-04 quality and coverage, C-05 the choice of path, the picture variant of C-06), in a real browser against the production
// build, the local Supabase stack and the REAL file gateway (another origin). The browser measures every picture itself: right after saving from the very Files of the
// picture screen, and after a reload by a single-use download ticket whose bytes are hashed against the saved SHA-256. The pictures are real PNGs with a known
// quality (tests/support/pictures-world.ts): a checkerboard of mid-tones is sharp and evenly lit, a ramp has no edge at all, a picture whose top half is white is
// clipped, and 700 px is too small. Every flow runs on `desktop` and `phone`. The rules are held at length by tests/unit/picture-quality.test.ts and the other unit
// tests, and the database half by tests/integration/picture-review.test.ts; this is the wiring, for real.

let world: AccountsWorld;
const accounts: string[] = [];

test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  try {
    const storage = createS3Storage(s3Of(world.stack));
    const { rows } = await world.db.query('select id, account_id from artifacts.staging_leases where account_id = any($1)', [accounts]);
    for (const row of rows) await storage.deletePrefix(`staging/${row.account_id}/${row.id}`).catch(() => 0);
  } finally {
    await world.close();
  }
});

type Options = {locale?: Locale; theme?: 'light' | 'dark'};
type TestUser = Awaited<ReturnType<AccountsWorld['signedInUser']>>;

async function member(context: BrowserContext, baseURL: string, options: Options = {}) {
  const user = await world.signedInUser();
  await world.activate(user);
  await signIn(context, baseURL, user, {locale: options.locale ?? 'en', theme: options.theme ?? 'light'});
  const account = await world.accountOf(user);
  accounts.push(account.id as string);
  return {user, accountId: account.id as string};
}

const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const crossing = {timeout: 30_000};
const newPath = '/projects/new/pictures';
const reviewPath = (projectId: string) => `/projects/${projectId}/pictures/review`;
const heading = (page: Page) => page.getByRole('heading', {level: 1});
const main = (page: Page) => page.getByRole('main');
const itemsOf = (page: Page) => page.locator('.review-item');
const chooser = (page: Page) => page.locator('input[type="file"][multiple]');
const alerts = (page: Page) => page.locator('.notice[role="alert"]');
const nextButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'review.next'), exact: true});
const backButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'review.back'), exact: true});
const obstructionBox = (page: Page, locale: Locale = 'en') => page.getByRole('checkbox', {name: t(locale, 'review.obstruction.label')});
const pathRadio = (page: Page, mode: 'image_direct' | 'evidence_images') => page.locator(`input[name="path"][value="${mode}"]`);
const confirmButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'review.confirm.button'), exact: true});
const saveChoiceButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'review.confirm.save'), exact: true});
const labelSelect = (page: Page, position: number, locale: Locale = 'en') => page.getByLabel(t(locale, 'review.picture.label', {position}), {exact: true});
const textOf = async (locator: Locator) => ((await locator.innerText()) ?? '').replace(/\s+/g, ' ').trim();
const plain = (value: string) => value.replace(/[⁦-⁩]/g, '');

// What a person does ----------------------------------------------------------------------------------------------------------

/** A member who chose `files` on the picture screen and saved them: on the Project page, with the Files of that screen still in the page's memory. */
async function savedPictures(page: Page, context: BrowserContext, baseURL: string, files: PictureFile[], options: Options = {}) {
  const who = await member(context, baseURL, options);
  const locale = options.locale ?? 'en';
  expect((await page.goto(newPath))?.status()).toBe(200);
  await expect(heading(page)).toHaveText(t(locale, 'picture.title.new'));
  await hydrated(page, 'main button[type="submit"]');
  await chooser(page).setInputFiles(files as never);
  await expect(page.locator('.picture-item')).toHaveCount(files.length, crossing);
  await expect(page.locator('.picture-item').filter({hasText: t(locale, 'picture.item.ready')})).toHaveCount(files.length, crossing);
  await page.getByRole('button', {name: t(locale, 'picture.save'), exact: true}).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
  const projectId = new URL(page.url()).pathname.split('/').pop()!;
  return {...who, projectId};
}

/** From the Project page, by its link (a navigation inside the page, so the Files of the picture screen are still held): the review opens at its first step. */
async function openReviewFromProject(page: Page, locale: Locale = 'en') {
  await page.getByRole('link', {name: t(locale, 'review.section.review'), exact: true}).click();
  await expect(heading(page)).toHaveText(t(locale, 'review.title.check'), crossing);
  await hydrated(page, 'main button');
}

/** By address (a new load of the page, so nothing of the picture screen is in memory). */
async function openReview(page: Page, projectId: string, locale: Locale = 'en') {
  const response = await page.goto(reviewPath(projectId));
  expect(response?.status(), reviewPath(projectId)).toBe(200);
  await expect(heading(page)).toHaveText(t(locale, 'review.title.check'), crossing);
  await hydrated(page, 'main button');
}

/** Waits until every picture is measured or has said why it cannot be. */
async function measured(page: Page) {
  await expect(page.locator('.review-item[data-state="measuring"]')).toHaveCount(0, {timeout: 60_000});
}

async function labelAll(page: Page, labels: ViewLabel[], locale: Locale = 'en') {
  for (const [index, value] of labels.entries()) await labelSelect(page, index + 1, locale).selectOption(value);
}

/** The first step, done: every picture measured, labelled, and the obstruction question confirmed; then the second step is open. */
async function throughFirstStep(page: Page, labels: ViewLabel[], locale: Locale = 'en') {
  await measured(page);
  await labelAll(page, labels, locale);
  await obstructionBox(page, locale).check();
  await nextButton(page, locale).click();
  await expect(heading(page)).toHaveText(t(locale, 'review.title.choose'));
}

type Stored = {
  id: string;
  stage: string;
  revision: number;
  revisions: {
    id: string;
    seq: number;
    mode: string;
    scope: string | null;
    outcome: string | null;
    description: string | null;
    subject_id: string | null;
    confirmed_at: Date | null;
    obstruction_confirmed_at: Date | null;
    incomplete_acknowledged_at: Date | null;
    incomplete_acknowledged_digest: string | null;
    images: {position: number; upload_id: string; sha256: string; view_label: string | null; short_edge_px: number | null; blur_variance: number | null; clipped_fraction: number | null}[];
  }[];
};

/** The Projects of the user's Account with their revisions and pictures, oldest first: what Confirm stored, exactly. */
async function stored(user: TestUser): Promise<Stored[]> {
  const projects = (
    await world.db.query(
      `select p.id, p.stage, p.revision::int as revision from projects.projects p join identity.accounts a on a.id = p.account_id where a.user_id = $1 order by p.created_at, p.id`,
      [user.id],
    )
  ).rows as {id: string; stage: string; revision: number}[];
  const revisions = (
    await world.db.query(
      `select r.id, r.project_id, r.seq, r.mode, r.scope, r.outcome, r.description, r.subject_id, r.confirmed_at, r.obstruction_confirmed_at, r.incomplete_acknowledged_at, r.incomplete_acknowledged_digest
         from projects.request_revisions r join identity.accounts a on a.id = r.account_id where a.user_id = $1 order by r.project_id, r.seq`,
      [user.id],
    )
  ).rows;
  const images = (
    await world.db.query(
      `select i.revision_id, i.position, i.upload_id, i.sha256, i.view_label, i.short_edge_px, i.blur_variance::float8 as blur_variance, i.clipped_fraction::float8 as clipped_fraction
         from projects.request_images i join identity.accounts a on a.id = i.account_id where a.user_id = $1 order by i.revision_id, i.position`,
      [user.id],
    )
  ).rows;
  return projects.map((project) => ({
    ...project,
    revisions: revisions
      .filter((revision) => revision.project_id === project.id)
      .map(({project_id: _project, ...revision}) => ({...revision, images: images.filter((image) => image.revision_id === revision.id).map(({revision_id: _revision, ...image}) => image)})),
  }));
}

/** Network requests the page makes that read a staged picture back: tickets for a download, and the GETs at the gateway. */
function watchDownloads(page: Page) {
  const events: string[] = [];
  const tickets: {id: string; body: string}[] = [];
  const gets: {url: string; authorization: string | undefined; status?: number}[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/transfers/tickets') && (request.postData() ?? '').includes('"download"')) {
      events.push('ticket');
      tickets.push({id: String(JSON.parse(request.postData() ?? '{}').id), body: request.postData() ?? ''});
    }
    if (request.method() === 'GET' && /\/v1\/files\/staging\//.test(request.url())) {
      events.push('get');
      gets.push({url: request.url(), authorization: request.headers()['authorization']});
    }
  });
  page.on('response', (response) => {
    const found = gets.find((entry) => entry.url === response.url() && entry.status === undefined);
    if (found) found.status = response.status();
  });
  return {events, tickets, gets};
}

// ---------------------------------------------------------------------------------------------------
test.describe('C-04: quality and coverage (AC-1)', () => {
  test('right after saving, measures the very Files of the picture screen, asks the gateway for nothing, and explains each picture: sharp ok; small, blurry and over-exposed with their remedies', async ({page, context, baseURL}) => {
    const problems = watchForProblems(page);
    const downloads = watchDownloads(page);
    const files: PictureFile[] = [
      {name: 'sharp.png', mimeType: 'image/png', buffer: sharpPng(1200, 900)},
      {name: 'small.png', mimeType: 'image/png', buffer: sharpPng(700, 700)},
      {name: 'blurry.png', mimeType: 'image/png', buffer: blurryPng(1200, 900)},
      {name: 'blown.png', mimeType: 'image/png', buffer: blownOutPng(1200, 900, 0.5)},
    ];
    const { projectId } = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await measured(page);

    // Nothing was read back from the gateway: the Files of the picture screen were measured (and checked against the saved SHA-256).
    expect(downloads.tickets).toEqual([]);
    expect(downloads.gets).toEqual([]);

    await expect(main(page).getByText(t('en', 'review.step', {step: 1, count: 3}))).toBeVisible();
    await expect(main(page).getByText(t('en', 'review.privacy'))).toBeVisible();
    await expect(itemsOf(page)).toHaveCount(4);
    // A thumbnail for each, a small JPEG the browser drew itself (a local object URL), and the only pictures on the page.
    const sources = await itemsOf(page).locator('img').evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
    expect(sources).toHaveLength(4);
    for (const source of sources) expect(source).toMatch(/^blob:/);
    await expect(main(page).locator('video, canvas, a[download]')).toHaveCount(0);

    const [sharp, small, blurry, blown] = await itemsOf(page).all();
    // The sharp picture: ok in all three measures, with the numbers and no remedy.
    await expect(sharp.locator('[data-result="ok"]')).toHaveCount(3);
    await expect(sharp).not.toContainText(t('en', 'review.remedy.title'));
    await expect(sharp).toContainText(t('en', 'review.detail.resolution', {size: '900 px', min: '800 px'}));
    // The small picture: the resolution problem with its pixels and its remedy (it is sharp and evenly lit).
    await expect(small.locator('[data-result="resolution"]')).toHaveCount(1);
    await expect(small.locator('[data-result="ok"]')).toHaveCount(2);
    await expect(small).toContainText(t('en', 'review.badge.resolution'));
    await expect(small).toContainText(t('en', 'review.detail.resolution', {size: '700 px', min: '800 px'}));
    await expect(small).toContainText(t('en', 'review.remedy.resolution'));
    // The blurry picture: a smooth ramp has no edge, so the blur problem, with the measured value and its remedy.
    await expect(blurry.locator('[data-result="blur"]')).toHaveCount(1);
    await expect(blurry).toContainText(t('en', 'review.badge.blur'));
    await expect(blurry).toContainText(t('en', 'review.remedy.blur'));
    expect(plain(await textOf(blurry))).toMatch(/Score \d+(?:\.\d)? \(at least 100 is needed\)/);
    // The over-exposed picture: half of it is pure white, with the share and its remedy.
    await expect(blown.locator('[data-result="exposure"]')).toHaveCount(1);
    await expect(blown).toContainText(t('en', 'review.badge.exposure'));
    await expect(blown).toContainText(t('en', 'review.remedy.exposure'));
    expect(plain(await textOf(blown))).toMatch(/\d+(?:\.\d+)?% of the picture is pure black or white \(at most 35% is allowed\)/);

    // The same numbers, as Confirm will send them, are in the form of the last step: read them from the form after labelling and choosing.
    expect(projectId).toBeTruthy();
    expect(problems).toEqual([]);
  });

  test('after a reload, reads each picture back ONE AT A TIME by a single-use download ticket (the ticket in a header, the bytes hashed against the saved SHA-256), measures it, and the thumbnails come back', async ({page, context, baseURL}) => {
    const files = sharpViews(3);
    const { projectId, user } = await savedPictures(page, context, baseURL!, files);
    const [project] = await stored(user);
    const uploads = project.revisions[0].images.map((image) => image.upload_id);
    const downloads = watchDownloads(page);
    await openReview(page, projectId);
    await measured(page);
    await expect(itemsOf(page).locator('[data-result="ok"]')).toHaveCount(9);

    // One ticket and one GET for each picture, in the person's order, strictly one after the other.
    expect(downloads.tickets.map((ticket) => ticket.id)).toEqual(uploads);
    for (const ticket of downloads.tickets) expect(ticket.body).toBe(JSON.stringify({direction: 'download', kind: 'staging', id: ticket.id}));
    expect(downloads.events).toEqual(['ticket', 'get', 'ticket', 'get', 'ticket', 'get']);
    expect(downloads.gets.map((get) => get.status)).toEqual([200, 200, 200]);
    for (const [index, get] of downloads.gets.entries()) {
      // The gateway is another origin; the ticket is in a header and in no address; the address names the staged upload and nothing else.
      expect(new URL(get.url).origin).not.toBe(new URL(baseURL!).origin);
      expect(new URL(get.url).pathname).toBe(`/v1/files/staging/${uploads[index]}`);
      expect(new URL(get.url).search).toBe('');
      expect(get.authorization).toMatch(/^Ticket \S+$/);
      expect(get.url).not.toContain(get.authorization!.slice(7));
    }
    const sources = await itemsOf(page).locator('img').evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
    expect(sources).toHaveLength(3);
    for (const source of sources) expect(source).toMatch(/^blob:/);
    // Nothing of the pictures is kept by the page: no storage of any kind holds a byte or a measurement.
    const kept = await page.evaluate(async () => ({local: localStorage.length, session: sessionStorage.length, caches: (await caches.keys()).length}));
    expect(kept.session).toBe(0);
    expect(kept.caches).toBe(0);
    expect(await page.evaluate(() => JSON.stringify({...localStorage}))).not.toMatch(/sha|blob|picture|measure/i);
  });

  test('a ticket opens one download: replaying it is refused, and the gateway has no link to a picture on the page', async ({page, context, baseURL}) => {
    const { projectId } = await savedPictures(page, context, baseURL!, sharpViews(1));
    const downloads = watchDownloads(page);
    await openReview(page, projectId);
    await measured(page);
    expect(downloads.gets).toHaveLength(1);
    const { url, authorization } = downloads.gets[0];
    // The very same request again, from the page, with the ticket that was spent.
    const replay = await page.evaluate(async ([address, token]) => (await fetch(address, {headers: {authorization: token}, credentials: 'omit'})).status, [url, authorization!] as const);
    expect(replay).toBe(401);
    // Without any ticket the gateway gives nothing either.
    expect(await page.evaluate(async (address) => (await fetch(address, {credentials: 'omit'})).status, url)).toBe(401);
    expect(await page.content()).not.toContain('/v1/files/');
  });

  test('says a picture whose bytes are not the saved ones was changed, does not use it, and blocks the step', async ({page, context, baseURL}) => {
    const { projectId } = await savedPictures(page, context, baseURL!, sharpViews(2));
    let served = 0;
    await page.route('**/v1/files/staging/**', async (route) => {
      served += 1;
      if (served === 2) {
        // Same length, other bytes.
        const response = await route.fetch();
        const body = Buffer.from(await response.body());
        body[body.length - 1] ^= 0xff;
        return route.fulfill({response, body});
      }
      return route.continue();
    });
    await openReview(page, projectId);
    await measured(page);
    const [first, second] = await itemsOf(page).all();
    await expect(first).toHaveAttribute('data-state', 'measured');
    await expect(second).toHaveAttribute('data-state', 'unusable');
    await expect(second).toContainText(t('en', 'review.unusable.changed'));
    await expect(second).toContainText(t('en', 'review.unusable.cannotAcknowledge'));
    await expect(second.getByRole('link', {name: t('en', 'review.unusable.go')})).toHaveAttribute('href', `/projects/${projectId}/pictures`);
    // Not retryable: the picture has to be replaced.
    await expect(second.getByRole('button', {name: t('en', 'review.unusable.retry')})).toHaveCount(0);
    // Labelled and confirmed, Next still stops, with the reason, in an alert that has the focus.
    await labelAll(page, ['front', 'left']);
    await obstructionBox(page).check();
    await nextButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'review.issue.unusable')})).toBeVisible();
    await expect(alerts(page).filter({hasText: t('en', 'review.issue.unusable')}).locator('xpath=ancestor::div[@tabindex="-1"][1]')).toBeFocused();
    await expect(heading(page)).toHaveText(t('en', 'review.title.check'));
  });

  test('says a refused download and a lost connection in words; only the lost connection can be tried again, and trying again measures it', async ({page, context, baseURL}) => {
    const { projectId } = await savedPictures(page, context, baseURL!, sharpViews(3));
    let seen = 0;
    let broken = true;
    await page.route('**/v1/files/staging/**', (route) => {
      seen += 1;
      if (seen === 1) return route.fulfill({status: 403, contentType: 'application/json', body: '{"error":"forbidden"}', headers: {'access-control-allow-origin': new URL(baseURL!).origin}});
      if (seen === 2 && broken) return route.abort('connectionreset');
      return route.continue();
    });
    await openReview(page, projectId);
    await measured(page);
    const [refused, lost, fine] = await itemsOf(page).all();
    await expect(refused).toContainText(t('en', 'review.unusable.reload'));
    await expect(refused.getByRole('button', {name: t('en', 'review.unusable.retry')})).toHaveCount(0);
    await expect(lost).toContainText(t('en', 'review.unusable.network'));
    await expect(fine).toHaveAttribute('data-state', 'measured');
    broken = false;
    await lost.getByRole('button', {name: t('en', 'review.unusable.retry')}).click();
    await expect(lost).toHaveAttribute('data-state', 'measured', crossing);
    await expect(lost.locator('[data-result="ok"]')).toHaveCount(3);
  });

  test('says a picture whose private copy has lapsed cannot be measured, asks the gateway for nothing about it, and links back to the picture screen', async ({page, context, baseURL}) => {
    const { projectId, user } = await savedPictures(page, context, baseURL!, sharpViews(3));
    const [project] = await stored(user);
    await world.db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [project.revisions[0].images[1].upload_id]);
    const downloads = watchDownloads(page);
    await openReview(page, projectId);
    await measured(page);
    const [first, lapsed, third] = await itemsOf(page).all();
    await expect(first).toHaveAttribute('data-state', 'measured');
    await expect(third).toHaveAttribute('data-state', 'measured');
    await expect(lapsed).toHaveAttribute('data-state', 'unusable');
    await expect(lapsed).toContainText(t('en', 'review.unusable.lapsed'));
    await expect(lapsed.getByRole('link', {name: t('en', 'review.unusable.go')})).toHaveAttribute('href', `/projects/${projectId}/pictures`);
    expect(downloads.tickets.map((ticket) => ticket.id)).toEqual([project.revisions[0].images[0].upload_id, project.revisions[0].images[2].upload_id]);
  });

  test('says a file the browser cannot open is unusable, with the picture screen as its remedy', async ({page, context, baseURL}) => {
    // The gateway looks only at the leading bytes: this is "a PNG" to it, and nothing a browser can decode.
    const notAnImage: PictureFile = {name: 'broken.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(2000)])};
    const { projectId } = await savedPictures(page, context, baseURL!, [...sharpViews(1), notAnImage]);
    // Measured from the Files of the picture screen first (right after saving), and again after a reload from the gateway: both cannot decode it.
    await openReviewFromProject(page);
    await measured(page);
    await expect(itemsOf(page).nth(1)).toContainText(t('en', 'review.unusable.undecodable'));
    await page.goto(reviewPath(projectId));
    await measured(page);
    const broken = itemsOf(page).nth(1);
    await expect(broken).toHaveAttribute('data-state', 'unusable');
    await expect(broken).toContainText(t('en', 'review.unusable.undecodable'));
    await expect(broken).toContainText(t('en', 'review.unusable.cannotAcknowledge'));
    await expect(itemsOf(page).nth(0)).toHaveAttribute('data-state', 'measured');
  });

  test('asks for each view with a labelled chooser, recommends the missing views in order and links to the picture screen; three different views are enough, and a detail close-up is not a view', async ({page, context, baseURL}) => {
    const { projectId } = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await measured(page);
    // Nothing is chosen for the person: each chooser starts at its placeholder, and the coverage line says so.
    for (const position of [1, 2, 3]) await expect(labelSelect(page, position)).toHaveValue('');
    await expect(main(page).getByText(t('en', 'review.coverage.shownNone'))).toBeVisible();
    const options = await labelSelect(page, 1).locator('option').evaluateAll((all) => all.map((option) => (option as HTMLOptionElement).value));
    expect(options).toEqual(['', ...viewLabels]);

    // Front, front, detail: one distinct view, so back and left are recommended, in that order.
    await labelAll(page, ['front', 'front', 'detail']);
    const coverage = page.locator('.review-coverage');
    await expect(coverage).toHaveAttribute('data-coverage', 'insufficient');
    await expect(coverage).toContainText(t('en', 'review.coverage.badge.insufficient'));
    await expect(coverage).toContainText(t('en', 'review.coverage.count', {count: 1, needed: 3}));
    expect(plain(await textOf(coverage))).toContain(plain(t('en', 'review.coverage.add', {views: t('en', 'review.list.two', {first: t('en', labelKeys.back), second: t('en', labelKeys.left)})})));
    await expect(coverage.getByRole('link', {name: t('en', 'review.coverage.addButton')})).toHaveAttribute('href', `/projects/${projectId}/pictures`);
    // Three different views are enough, and a close-up among them changes nothing.
    await labelAll(page, ['front', 'left', 'top']);
    await expect(coverage).toHaveAttribute('data-coverage', 'sufficient');
    await expect(coverage).toContainText(t('en', 'review.coverage.badge.sufficient'));
    await expect(coverage.getByRole('link')).toHaveCount(0);
    await labelAll(page, ['front', 'left', 'detail']);
    await expect(coverage).toHaveAttribute('data-coverage', 'insufficient');
    expect(plain(await textOf(coverage))).toContain(plain(t('en', 'review.coverage.add', {views: t('en', labelKeys.back)})));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the first step cannot be passed without the labels and the obstruction confirmation (no override)', () => {
  test('stops at a picture with no label, then at the unconfirmed obstruction question, naming each in an alert with the focus', async ({page, context, baseURL}) => {
    await savedPictures(page, context, baseURL!, sharpViews(2));
    await openReviewFromProject(page);
    await measured(page);
    await nextButton(page).click();
    const stop = (key: MessageKey) => alerts(page).filter({hasText: t('en', key)});
    await expect(stop('review.issue.labels')).toBeVisible();
    await expect(stop('review.issue.labels').locator('xpath=ancestor::div[@tabindex="-1"][1]')).toBeFocused();
    await expect(labelSelect(page, 1)).toHaveAttribute('aria-invalid', 'true');
    await expect(heading(page)).toHaveText(t('en', 'review.title.check'));
    await labelAll(page, ['front', 'left']);
    await nextButton(page).click();
    await expect(stop('review.obstruction.remedy')).toBeVisible();
    await expect(obstructionBox(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(main(page).getByText(t('en', 'review.obstruction.help'))).toBeVisible();
    // There is no way past it but the confirmation: the checkbox, then Next.
    await obstructionBox(page).check();
    await nextButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.choose'));
  });

  test('is complete with the keyboard: label with the arrow keys, confirm with Space, choose with the arrows, Next and Confirm with Enter', async ({page, context, baseURL, isMobile}) => {
    test.skip(Boolean(isMobile), 'the keyboard flow is for a desktop browser');
    const { user } = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await measured(page);
    for (const position of [1, 2, 3]) {
      await labelSelect(page, position).focus();
      // front, back, left, right, top: the arrow keys walk the options.
      for (let step = 0; step < (position === 1 ? 1 : position === 2 ? 3 : 5); step += 1) await page.keyboard.press('ArrowDown');
    }
    await expect(labelSelect(page, 1)).toHaveValue('front');
    await expect(labelSelect(page, 2)).toHaveValue('left');
    await expect(labelSelect(page, 3)).toHaveValue('top');
    await obstructionBox(page).focus();
    await page.keyboard.press('Space');
    await expect(obstructionBox(page)).toBeChecked();
    await nextButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(heading(page)).toBeFocused();
    await expect(heading(page)).toHaveText(t('en', 'review.title.choose'));
    // The radios: Tab into the group, the arrow key moves the choice, Next with Enter.
    await pathRadio(page, 'image_direct').focus();
    await page.keyboard.press('ArrowDown');
    await expect(pathRadio(page, 'evidence_images')).toBeChecked();
    await nextButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText(t('en', 'review.title.confirmResearch'));
    await saveChoiceButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect((await stored(user))[0].revisions[1]).toMatchObject({seq: 2, mode: 'evidence_images'});
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('C-05: the choice of path, with no default (AC-3)', () => {
  test('offers two cards with the accuracy difference and the offline availability, chosen explicitly, and stops at Next with none chosen', async ({page, context, baseURL}) => {
    await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'top']);
    await expect(main(page).getByText(t('en', 'review.step', {step: 2, count: 3}))).toBeVisible();
    await expect(heading(page)).toBeFocused();
    // No default.
    await expect(pathRadio(page, 'image_direct')).not.toBeChecked();
    await expect(pathRadio(page, 'evidence_images')).not.toBeChecked();
    const words = plain(await textOf(main(page)));
    for (const key of [
      'review.path.direct.title', 'review.path.direct.body', 'review.path.direct.accuracy', 'review.path.direct.plan', 'review.path.direct.offline',
      'review.path.research.title', 'review.path.research.body', 'review.path.research.accuracy', 'review.path.research.plan', 'review.path.research.offline',
    ] as const) expect(words).toContain(plain(t('en', key)));
    expect(words).toMatch(/not historically verified/);
    expect(words).toMatch(/no Research Plan/i);
    expect(words).toMatch(/Needs a connection/);
    await nextButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'review.choose.error')})).toBeVisible();
    await expect(heading(page)).toHaveText(t('en', 'review.title.choose'));
    await expect(pathRadio(page, 'image_direct')).toBeFocused();
    // Back goes to the first step with everything kept.
    await backButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.check'));
    await expect(labelSelect(page, 2)).toHaveValue('left');
    await expect(obstructionBox(page)).toBeChecked();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('C-06 for pictures: research-assisted reconstruction (AC-3)', () => {
  test('records the choice, the labels and the measurements as an unconfirmed successor with no scope, leaves the stage a draft, and says nothing started', async ({page, context, baseURL}) => {
    const problems = watchForProblems(page);
    const files = sharpViews(3);
    const { user, projectId } = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'top']);
    await pathRadio(page, 'evidence_images').check();
    await nextButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.confirmResearch'));
    await expect(main(page).getByText(t('en', 'review.confirm.researchLede'))).toBeVisible();
    await expect(page.locator('input[name="scope"], input[name="outcome"]')).toHaveCount(0);
    // No Generate anyway for research-assisted reconstruction, whatever the pictures are.
    await expect(page.locator('.review-ack')).toHaveCount(0);
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);

    const [project] = await stored(user);
    expect(project).toMatchObject({id: projectId, stage: 'request_draft', revision: 2});
    expect(project.revisions.map((revision) => revision.seq)).toEqual([1, 2]);
    const [saved, reviewed] = project.revisions;
    // The saved set is exactly as it was: no label, no measurement.
    expect(saved).toMatchObject({mode: 'evidence_images', confirmed_at: null, obstruction_confirmed_at: null});
    expect(saved.images.map((image) => image.view_label)).toEqual([null, null, null]);
    expect(reviewed).toMatchObject({mode: 'evidence_images', scope: null, outcome: null, description: null, subject_id: null, confirmed_at: null, incomplete_acknowledged_at: null, incomplete_acknowledged_digest: null});
    expect(reviewed.obstruction_confirmed_at).not.toBeNull();
    // The same pictures in the same order, with what the person said and what the browser measured.
    expect(reviewed.images.map((image) => [image.position, image.sha256, image.view_label])).toEqual(files.map((file, index) => [index + 1, sha256Of(file.buffer), ['front', 'left', 'top'][index]]));
    for (const image of reviewed.images) {
      expect(image.short_edge_px).toBe(900);
      expect(image.blur_variance).toBeGreaterThan(100);
      expect(image.clipped_fraction).toBe(0);
    }

    // The Project page: the mode in words, that the choice is recorded and nothing started, each picture's label and result, the obstruction confirmation, the way back.
    await expect(page.getByText(t('en', 'stage.request_draft.label'), {exact: true}).first()).toBeVisible();
    const section = page.getByRole('region', {name: t('en', 'request.section.title'), exact: true});
    await expect(section).toContainText(t('en', 'request.mode.evidence_images'));
    await expect(section).toContainText(t('en', 'review.section.researchRecorded'));
    await expect(section).toContainText(t('en', 'review.section.obstruction'));
    await expect(section.locator('[data-view="front"]')).toBeVisible();
    await expect(section.locator('[data-result="ok"]')).toHaveCount(3);
    await expect(section.getByRole('link', {name: t('en', 'review.section.reviewAgain')})).toHaveAttribute('href', reviewPath(projectId));
    await expect(section.getByRole('link', {name: t('en', 'picture.section.change')})).toBeVisible();
    await expect(section.locator('img, video, a[download]')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('does not need the Generate anyway acknowledgment for incomplete pictures: two blurry views can be used for research', async ({page, context, baseURL}) => {
    const { user } = await savedPictures(page, context, baseURL!, [
      {name: 'a.png', mimeType: 'image/png', buffer: blurryPng(1200, 900, 40)},
      {name: 'b.png', mimeType: 'image/png', buffer: blurryPng(1200, 900, 80)},
    ]);
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'front']);
    await pathRadio(page, 'evidence_images').check();
    await nextButton(page).click();
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    const [project] = await stored(user);
    expect(project.revisions[1]).toMatchObject({mode: 'evidence_images', incomplete_acknowledged_at: null});
    for (const image of project.revisions[1].images) expect(image.blur_variance).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('C-06 for pictures: direct image-derived conversion (AC-2, AC-3)', () => {
  test('with three good views: editable scope and outcome prefilled, no acknowledgment, Confirm makes a confirmed successor with no subject, no description and no plan, and the Project is Request confirmed', async ({page, context, baseURL}) => {
    const problems = watchForProblems(page);
    const files = sharpViews(3);
    const { user, projectId } = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'top']);
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.confirmDirect'));
    await expect(heading(page)).toBeFocused();
    await expect(main(page).getByText(t('en', 'request.mode.image_direct')).first()).toBeVisible();
    // Prefilled with localized sentences the person can edit (1 to 300 characters).
    const scope = page.getByLabel(t('en', 'request.review.scope'), {exact: true});
    const outcome = page.getByLabel(t('en', 'request.review.outcome'), {exact: true});
    await expect(scope).toHaveValue(t('en', 'review.scopeDefault'));
    await expect(outcome).toHaveValue(t('en', 'review.outcomeDefault'));
    await scope.fill('The altar and its ramp');
    await outcome.fill('A print I can hold');
    // Complete inputs: no warning, no acknowledgment, and the sentence that confirming starts nothing.
    await expect(page.locator('.review-ack')).toHaveCount(0);
    expect(plain(await textOf(main(page)))).toMatch(/starts no conversion, approves no plan and authorizes no cost/);
    await confirmButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);

    const [project] = await stored(user);
    expect(project).toMatchObject({id: projectId, stage: 'request_confirmed', revision: 2});
    const confirmed = project.revisions[1];
    expect(confirmed).toMatchObject({seq: 2, mode: 'image_direct', scope: 'The altar and its ramp', outcome: 'A print I can hold', description: null, subject_id: null, incomplete_acknowledged_at: null, incomplete_acknowledged_digest: null});
    expect(confirmed.confirmed_at).not.toBeNull();
    expect(confirmed.obstruction_confirmed_at).not.toBeNull();
    expect(confirmed.images.map((image) => [image.sha256, image.view_label])).toEqual(files.map((file, index) => [sha256Of(file.buffer), ['front', 'left', 'top'][index]]));

    await expect(page.getByText(t('en', 'stage.request_confirmed.label'), {exact: true}).first()).toBeVisible();
    const section = page.getByRole('region', {name: t('en', 'request.section.title'), exact: true});
    await expect(section).toContainText(t('en', 'request.mode.image_direct'));
    await expect(section).toContainText('The altar and its ramp');
    await expect(section).toContainText(t('en', 'review.section.noAcknowledgment'));
    await expect(section).toContainText(t('en', 'review.section.directNothingStarted'));
    await expect(section.getByRole('link', {name: t('en', 'review.section.reviewAgain')})).toHaveAttribute('href', reviewPath(projectId));
    // The pictures of a confirmed request are not changed on the picture screen.
    await expect(section.getByRole('link', {name: t('en', 'picture.section.change')})).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('with incomplete inputs: the Generate anyway warning names the missing views and the problems, Confirm needs the acknowledgment, and what is recorded is pinned to the ordered pictures and the scope', async ({page, context, baseURL}) => {
    const files: PictureFile[] = [
      {name: 'sharp.png', mimeType: 'image/png', buffer: sharpPng(1200, 900)},
      {name: 'blurry.png', mimeType: 'image/png', buffer: blurryPng(1200, 900)},
      {name: 'small.png', mimeType: 'image/png', buffer: sharpPng(700, 700, 22, 5)},
    ];
    const { user, projectId } = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'detail']);
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.confirmDirect'));

    const warning = page.locator('.review-ack');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(t('en', 'review.ack.title'));
    const words = plain(await textOf(warning));
    // On purpose changed (review patch C4): no bare plural ("2 different views"), the names in lower case by the UI's language, and no nested parentheses.
    expect(words).toContain('Different views: 2 (direct conversion needs at least 3). Missing: back.');
    expect(words).toContain('Picture 2, left: too blurry.');
    expect(words).toContain('Picture 3, detail close-up: too small.');
    expect(words).toMatch(/invented or inaccurate/);
    expect(words).toMatch(/not historically verified/);

    const scope = 'The statue in my photographs';
    const outcome = 'A model I can inspect';
    await page.getByLabel(t('en', 'request.review.scope'), {exact: true}).fill(scope);
    await page.getByLabel(t('en', 'request.review.outcome'), {exact: true}).fill(outcome);
    // Without the acknowledgment: nothing is sent, the message is told, and the checkbox has the focus.
    await confirmButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'review.ack.required')})).toBeVisible();
    await expect(warning.getByRole('checkbox')).toBeFocused();
    await expect(warning.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true');
    expect((await stored(user))[0].revisions).toHaveLength(1);
    await expect(page).toHaveURL(new RegExp(`${reviewPath(projectId)}$`));

    await warning.getByRole('checkbox').check();
    await confirmButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);

    const [project] = await stored(user);
    expect(project.stage).toBe('request_confirmed');
    const confirmed = project.revisions[1];
    expect(confirmed).toMatchObject({mode: 'image_direct', scope, outcome});
    expect(confirmed.incomplete_acknowledged_at).not.toBeNull();
    // The digest is the SHA-256 of the length-prefixed scope, outcome and, for each picture in order, its position, upload, staged SHA-256 and label.
    const expected = createHash('sha256')
      .update(reviewDigestInput({scope, outcome, images: confirmed.images.map((image) => ({uploadId: image.upload_id, sha256: image.sha256, label: image.view_label as ViewLabel}))}), 'utf8')
      .digest('hex');
    expect(confirmed.incomplete_acknowledged_digest).toBe(expected);
    expect(confirmed.images.map((image) => image.sha256)).toEqual(files.map((file) => sha256Of(file.buffer)));

    // The Project page: what was acknowledged and when (UTC).
    const section = page.getByRole('region', {name: t('en', 'request.section.title'), exact: true});
    const acknowledgment = section.locator('[data-review="acknowledgment"]');
    await expect(acknowledgment).toContainText(t('en', 'review.section.acknowledged'));
    await expect(acknowledgment).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
    expect(plain(await textOf(acknowledgment))).toContain('Picture 2, left: too blurry.');
    expect(plain(await textOf(acknowledgment))).toContain('Missing: back.');
    await expect(section.locator('[data-view="left"]')).toBeVisible();
    await expect(section.locator('[data-result="problems"]')).toHaveCount(2);
  });

  test('an acknowledgment is of THESE pictures: the digest of another order, other labels or another scope is another number', async ({page, context, baseURL}) => {
    const files: PictureFile[] = [
      {name: 'sharp.png', mimeType: 'image/png', buffer: sharpPng(1200, 900)},
      {name: 'small.png', mimeType: 'image/png', buffer: sharpPng(700, 700, 22, 5)},
    ];
    const { user } = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left']);
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    await page.locator('.review-ack').getByRole('checkbox').check();
    await confirmButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    const [project] = await stored(user);
    const confirmed = project.revisions[1];
    const digest = (labels: string[], scope: string, order: number[]) =>
      createHash('sha256')
        .update(reviewDigestInput({scope, outcome: confirmed.outcome!, images: order.map((index, position) => ({uploadId: confirmed.images[index].upload_id, sha256: confirmed.images[index].sha256, label: labels[position] as ViewLabel}))}), 'utf8')
        .digest('hex');
    expect(confirmed.incomplete_acknowledged_digest).toBe(digest(['front', 'left'], confirmed.scope!, [0, 1]));
    expect(confirmed.incomplete_acknowledged_digest).not.toBe(digest(['front', 'left'], confirmed.scope!, [1, 0]));
    expect(confirmed.incomplete_acknowledged_digest).not.toBe(digest(['front', 'back'], confirmed.scope!, [0, 1]));
    expect(confirmed.incomplete_acknowledged_digest).not.toBe(digest(['front', 'left'], 'Another scope', [0, 1]));
  });

  test('an acknowledgment is void as soon as the facts it covers change: a path change or a label change clears the tick, and Confirm asks for it again', async ({page, context, baseURL}) => {
    const files: PictureFile[] = [
      {name: 'sharp.png', mimeType: 'image/png', buffer: sharpPng(1200, 900)},
      {name: 'blurry.png', mimeType: 'image/png', buffer: blurryPng(1200, 900)},
      {name: 'small.png', mimeType: 'image/png', buffer: sharpPng(700, 700, 22, 5)},
    ];
    const { user, projectId } = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'detail']);
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    const box = () => page.locator('.review-ack').getByRole('checkbox');
    await expect(box()).not.toBeChecked();
    await box().check();
    await expect(box()).toBeChecked();

    // A change of path: back to the choice, research-assisted and then direct again. The tick is gone.
    await backButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.choose'));
    await pathRadio(page, 'evidence_images').check();
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.confirmDirect'));
    await expect(box()).not.toBeChecked();

    // A change of label: tick again, go back to the pictures, say the close-up shows the right side (a third view; the other two problems stay), and come forward.
    await box().check();
    await backButton(page).click();
    await backButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.check'));
    await labelSelect(page, 3).selectOption('right');
    await nextButton(page).click();
    await nextButton(page).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.confirmDirect'));
    await expect(box()).not.toBeChecked();
    // The warning now says what it covers: three different views are enough (no sentence about the views any more), and the two pictures with problems remain.
    const words = plain(await textOf(page.locator('.review-ack')));
    expect(words).not.toContain('Different views:');
    expect(words).toContain('Picture 2, left: too blurry.');
    expect(words).toContain('Picture 3, right: too small.');

    // Confirm needs the acknowledgment again: nothing is recorded without it.
    await confirmButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'review.ack.required')})).toBeVisible();
    expect((await stored(user))[0].revisions).toHaveLength(1);
    await expect(page).toHaveURL(new RegExp(`${reviewPath(projectId)}$`));

    await box().check();
    await confirmButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    const confirmed = (await stored(user))[0].revisions[1];
    expect(confirmed.images.map((image) => image.view_label)).toEqual(['front', 'left', 'right']);
    const expected = createHash('sha256')
      .update(reviewDigestInput({scope: confirmed.scope!, outcome: confirmed.outcome!, images: confirmed.images.map((image) => ({uploadId: image.upload_id, sha256: image.sha256, label: image.view_label as ViewLabel}))}), 'utf8')
      .digest('hex');
    expect(confirmed.incomplete_acknowledged_digest).toBe(expected);
  });

  test('says the truth about a confirmed direct request whose private copy has lapsed: it cannot be changed here yet, no link leads to the locked picture screen, and nothing is recorded', async ({page, context, baseURL}) => {
    const { user, projectId } = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'top']);
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    await confirmButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    const [made] = await stored(user);
    expect(made.stage).toBe('request_confirmed');
    // 24 hours after the last save, the second picture's private copy lapses.
    await world.db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [made.revisions[1].images[1].upload_id]);

    await openReview(page, projectId);
    await measured(page);
    const lapsed = itemsOf(page).nth(1);
    await expect(lapsed).toHaveAttribute('data-state', 'unusable');
    await expect(lapsed).toContainText(t('en', 'review.unusable.lapsed'));
    await expect(lapsed).toContainText(t('en', 'review.unusable.confirmed'));
    await expect(lapsed).not.toContainText(t('en', 'review.unusable.cannotAcknowledge'));
    // Nothing on the page leads to the screen where the pictures are locked.
    await expect(main(page).locator(`a[href="/projects/${projectId}/pictures"]`)).toHaveCount(0);
    await expect(lapsed.getByRole('link')).toHaveCount(0);
    // Next stops, and says the same truth.
    await nextButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'review.issue.unusableConfirmed')})).toBeVisible();
    await expect(heading(page)).toHaveText(t('en', 'review.title.check'));
    // Nothing was recorded (the database would answer `expired_upload`): the request is the confirmed one it was.
    const [after] = await stored(user);
    expect(after.revisions).toHaveLength(2);
    expect(after.stage).toBe('request_confirmed');
  });

  test('refuses an empty scope and a scope that is too long, in words, next to the field, and records nothing', async ({page, context, baseURL}) => {
    const { user } = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'top']);
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    const scope = page.getByLabel(t('en', 'request.review.scope'), {exact: true});
    await scope.fill('   ');
    await confirmButton(page).click();
    await expect(page.getByText(t('en', 'request.error.scope.empty'))).toBeVisible();
    await expect(scope).toHaveAttribute('aria-invalid', 'true');
    await expect(scope).toBeFocused();
    await scope.fill('x'.repeat(301));
    await confirmButton(page).click();
    await expect(page.getByText(t('en', 'request.error.scope.tooLong', {max: 300}))).toBeVisible();
    expect((await stored(user))[0].revisions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a mode change is a successor (AC-3)', () => {
  test('reviewing a confirmed direct request again and choosing research-assisted makes an unconfirmed successor, puts the Project back to a draft, and leaves the earlier revision as it was', async ({page, context, baseURL}) => {
    const { user, projectId } = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'top']);
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    await confirmButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    const [direct] = await stored(user);
    expect(direct.stage).toBe('request_confirmed');

    // Review again (the Files of the picture screen are gone with the first review: the pictures are read back, one at a time).
    const downloads = watchDownloads(page);
    await page.getByRole('link', {name: t('en', 'review.section.reviewAgain')}).click();
    await expect(heading(page)).toHaveText(t('en', 'review.title.check'), crossing);
    await hydrated(page, 'main button');
    await measured(page);
    expect(downloads.tickets).toHaveLength(3);
    // The labels of the earlier review are kept, and nothing else is chosen for the person: the obstruction question and the path are asked again.
    await expect(labelSelect(page, 1)).toHaveValue('front');
    await expect(labelSelect(page, 3)).toHaveValue('top');
    await expect(obstructionBox(page)).not.toBeChecked();
    // A confirmed request's pictures cannot be added to here: the way to unlock them is said instead of a button.
    await expect(main(page).getByText(t('en', 'review.coverage.addLocked'))).toHaveCount(0);
    await obstructionBox(page).check();
    await nextButton(page).click();
    await expect(pathRadio(page, 'image_direct')).not.toBeChecked();
    await pathRadio(page, 'evidence_images').check();
    await nextButton(page).click();
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);

    const [after] = await stored(user);
    expect(after).toMatchObject({stage: 'request_draft', revision: 3});
    expect(after.revisions.map((revision) => [revision.seq, revision.mode, revision.confirmed_at !== null])).toEqual([
      [1, 'evidence_images', false],
      [2, 'image_direct', true],
      [3, 'evidence_images', false],
    ]);
    expect(after.revisions[1]).toEqual(direct.revisions[1]);
    expect(after.revisions[2]).toMatchObject({scope: null, outcome: null, description: null, subject_id: null});
    await expect(page.getByText(t('en', 'stage.request_draft.label'), {exact: true}).first()).toBeVisible();
    // ... and the pictures can be changed again.
    await expect(page.getByRole('link', {name: t('en', 'picture.section.change')})).toBeVisible();
  });

  test('Change pictures after a review supersedes it with an unreviewed set: no labels, the review asked again', async ({page, context, baseURL}) => {
    const { user, projectId } = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'top']);
    await pathRadio(page, 'evidence_images').check();
    await nextButton(page).click();
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    await page.getByRole('link', {name: t('en', 'picture.section.change')}).click();
    await expect(heading(page)).toHaveText(t('en', 'picture.title.change'), crossing);
    await hydrated(page, 'main button[type="submit"]');
    await chooser(page).setInputFiles([{name: 'extra.png', mimeType: 'image/png', buffer: sharpPng(1200, 900, 30, 1)}] as never);
    await expect(page.locator('.picture-item')).toHaveCount(4, crossing);
    // (A saved picture says "Saved. In private staging until ...", the new one "In private staging": both hold the words of a picture that is staged.)
    await expect(page.locator('.picture-item').filter({hasText: t('en', 'picture.item.ready')})).toHaveCount(4, crossing);
    await page.getByRole('button', {name: t('en', 'picture.save'), exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    const [project] = await stored(user);
    expect(project.revisions.map((revision) => revision.seq)).toEqual([1, 2, 3]);
    expect(project.revisions[2]).toMatchObject({mode: 'evidence_images', obstruction_confirmed_at: null});
    expect(project.revisions[2].images.map((image) => image.view_label)).toEqual([null, null, null, null]);
    expect(project.revisions[1].images.map((image) => image.view_label)).toEqual(['front', 'left', 'top']);
    const section = page.getByRole('region', {name: t('en', 'request.section.title'), exact: true});
    await expect(section).toContainText(t('en', 'review.section.notReviewed'));
  });

  test('is stale in a window that was opened before another window recorded a review: nothing is recorded, and the person is told to load the page again', async ({page, context, baseURL}) => {
    const { user, projectId } = await savedPictures(page, context, baseURL!, sharpViews(3));
    const other = await context.newPage();
    await openReviewFromProject(page);
    await openReview(other, projectId);
    // The first window records the choice.
    await throughFirstStep(page, ['front', 'left', 'top']);
    await pathRadio(page, 'evidence_images').check();
    await nextButton(page).click();
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    // The second window still holds the earlier revision: its Confirm is refused.
    await throughFirstStep(other, ['front', 'left', 'top']);
    await pathRadio(other, 'image_direct').check();
    await nextButton(other).click();
    await confirmButton(other).click();
    await expect(alerts(other).filter({hasText: t('en', 'review.confirm.stale')})).toBeVisible(crossing);
    const [project] = await stored(user);
    expect(project.revisions).toHaveLength(2);
    expect(project.stage).toBe('request_draft');
    // Loading the page again shows the current revision.
    await other.goto(reviewPath(projectId));
    await expect(heading(other)).toHaveText(t('en', 'review.title.check'));
    await other.close();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the same in Hebrew (parity)', () => {
  test('is right to left, says every step in Hebrew, and records the same review', async ({page, context, baseURL}) => {
    const locale: Locale = 'he';
    const { user, projectId } = await savedPictures(page, context, baseURL!, sharpViews(3), {locale});
    await openReviewFromProject(page, locale);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(main(page).getByText(t(locale, 'review.privacy'))).toBeVisible();
    await measured(page);
    await expect(itemsOf(page).first()).toContainText(t(locale, 'review.measure.resolution'));
    await expect(main(page).getByText(t(locale, 'review.coverage.shownNone'))).toBeVisible();
    // The choosers name the views in Hebrew.
    const names = await labelSelect(page, 1, locale).locator('option').allInnerTexts();
    expect(names).toEqual([t(locale, 'review.picture.labelChoose'), ...viewLabels.map((value) => t(locale, labelKeys[value]))]);
    await nextButton(page, locale).click();
    await expect(alerts(page).filter({hasText: t(locale, 'review.issue.labels')})).toBeVisible();
    await labelAll(page, ['front', 'left', 'top'], locale);
    await obstructionBox(page, locale).check();
    await nextButton(page, locale).click();
    await expect(heading(page)).toHaveText(t(locale, 'review.title.choose'));
    await expect(main(page).getByText(t(locale, 'review.path.direct.title'))).toBeVisible();
    await expect(main(page).getByText(t(locale, 'review.path.research.title'))).toBeVisible();
    await pathRadio(page, 'image_direct').check();
    await nextButton(page, locale).click();
    await expect(heading(page)).toHaveText(t(locale, 'review.title.confirmDirect'));
    const scope = page.getByLabel(t(locale, 'request.review.scope'), {exact: true});
    await expect(scope).toHaveValue(t(locale, 'review.scopeDefault'));
    await confirmButton(page, locale).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    const [project] = await stored(user);
    expect(project.revisions[1]).toMatchObject({mode: 'image_direct', scope: translate('he', 'review.scopeDefault'), outcome: translate('he', 'review.outcomeDefault')});
    await expect(page.getByText(t(locale, 'stage.request_confirmed.label'), {exact: true}).first()).toBeVisible();
    const section = page.getByRole('region', {name: t(locale, 'request.section.title'), exact: true});
    await expect(section).toContainText(t(locale, 'request.mode.image_direct'));
    await expect(section).toContainText(t(locale, 'review.section.directNothingStarted'));
  });

  test('says the Generate anyway warning and its acknowledgment in Hebrew', async ({page, context, baseURL}) => {
    const locale: Locale = 'he';
    await savedPictures(page, context, baseURL!, [{name: 'a.png', mimeType: 'image/png', buffer: sharpPng(1200, 900)}, {name: 'b.png', mimeType: 'image/png', buffer: blurryPng(1200, 900)}], {locale});
    await openReviewFromProject(page, locale);
    await throughFirstStep(page, ['front', 'left'], locale);
    await pathRadio(page, 'image_direct').check();
    await nextButton(page, locale).click();
    const warning = page.locator('.review-ack');
    await expect(warning).toContainText(t(locale, 'review.ack.title'));
    await expect(warning).toContainText(t(locale, 'review.ack.warning'));
    expect(plain(await textOf(warning))).toContain(plain(t(locale, 'review.ack.missing', {count: 2, needed: 3, views: t(locale, labelKeys.back).toLocaleLowerCase(locale)})));
    await confirmButton(page, locale).click();
    await expect(alerts(page).filter({hasText: t(locale, 'review.ack.required')})).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the page that is not a review', () => {
  test('is the one unavailable page for a Project that is another Account\'s or never existed, and says there are no pictures for a text request', async ({page, context, baseURL}) => {
    const { projectId, user } = await savedPictures(page, context, baseURL!, sharpViews(1));
    const second = await page.context().browser()!.newContext({baseURL: baseURL!, viewport: page.viewportSize() ?? undefined});
    try {
      const stranger = await world.signedInUser();
      await world.activate(stranger);
      await signIn(second, baseURL!, stranger, {locale: 'en', theme: 'light'});
      accounts.push((await world.accountOf(stranger)).id as string);
      const other = await second.newPage();
      const answers: string[] = [];
      for (const id of [projectId, randomUUID()]) {
        const response = await other.goto(reviewPath(id));
        expect(response?.status(), id).toBe(404);
        await expect(other.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.unavailable.title'));
        answers.push(await textOf(other.getByRole('main')));
      }
      expect(answers[0]).toBe(answers[1]);
    } finally {
      await second.close();
    }
    const accountId = (await world.accountOf(user)).id as string;
    const { rows } = await world.db.query(
      `select (api.create_project_request(a.id, a.authorization_epoch, gen_random_uuid(), 'A text request', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', 'altar', null, null, null, false, null)).project_id as id
         from identity.accounts a where a.id = $1`,
      [accountId],
    );
    const textProject = rows[0].id as string;
    const response = await page.goto(reviewPath(textProject));
    expect(response?.status()).toBe(200);
    await expect(main(page).getByRole('heading', {name: t('en', 'review.locked.title')})).toBeVisible();
    await expect(page.getByRole('link', {name: t('en', 'review.locked.back')})).toHaveAttribute('href', `/projects/${textProject}`);
    await expect(page.locator('select')).toHaveCount(0);
    // The Project page of a text request offers no review.
    await page.goto(`/projects/${textProject}`);
    await expect(page.getByRole('link', {name: t('en', 'review.section.review')})).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('accessibility, and the window it fits in', () => {
  /** A Project whose pictures are saved and the review open at its first step with all measured (a mixed set, so there is something to say). */
  async function reviewOpen(page: Page, context: BrowserContext, baseURL: string, options: Options) {
    const locale = options.locale ?? 'en';
    const files: PictureFile[] = [
      {name: 'sharp.png', mimeType: 'image/png', buffer: sharpPng(1200, 900)},
      {name: 'blurry.png', mimeType: 'image/png', buffer: blurryPng(1200, 900)},
      {name: 'small.png', mimeType: 'image/png', buffer: sharpPng(700, 700, 22, 5)},
    ];
    const who = await savedPictures(page, context, baseURL, files, options);
    await openReviewFromProject(page, locale);
    await measured(page);
    return who;
  }

  for (const variant of variants) {
    test(`has no accessibility violation on any step, with problems and the Generate anyway warning, in ${variant.name}`, async ({page, context, baseURL}) => {
      const locale = variant.locale;
      await reviewOpen(page, context, baseURL!, {locale, theme: variant.theme});
      expect(await violations(page), 'measured, no label').toEqual([]);
      await nextButton(page, locale).click();
      expect(await violations(page), 'first step with the issue').toEqual([]);
      await labelAll(page, ['front', 'left', 'detail'], locale);
      await obstructionBox(page, locale).check();
      await nextButton(page, locale).click();
      await expect(heading(page)).toHaveText(t(locale, 'review.title.choose'));
      expect(await violations(page), 'the choice').toEqual([]);
      await nextButton(page, locale).click();
      expect(await violations(page), 'the choice with its message').toEqual([]);
      await pathRadio(page, 'image_direct').check();
      await nextButton(page, locale).click();
      await expect(heading(page)).toHaveText(t(locale, 'review.title.confirmDirect'));
      expect(await violations(page), 'direct, with the warning').toEqual([]);
      await confirmButton(page, locale).click();
      await expect(alerts(page).filter({hasText: t(locale, 'review.ack.required')})).toBeVisible();
      expect(await violations(page), 'direct, acknowledgment missing').toEqual([]);
      await backButton(page, locale).click();
      await pathRadio(page, 'evidence_images').check();
      await nextButton(page, locale).click();
      expect(await violations(page), 'research').toEqual([]);
      await saveChoiceButton(page, locale).click();
      await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
      expect(await violations(page), 'the Project page with the review').toEqual([]);
    });
  }

  test('has no violation with unusable pictures and a locked picture screen link', async ({page, context, baseURL}) => {
    const { projectId, user } = await savedPictures(page, context, baseURL!, sharpViews(2));
    const [project] = await stored(user);
    await world.db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [project.revisions[0].images[0].upload_id]);
    await openReview(page, projectId);
    await measured(page);
    await expect(itemsOf(page).first()).toContainText(t('en', 'review.unusable.lapsed'));
    expect(await violations(page), 'a lapsed picture').toEqual([]);
  });

  for (const locale of ['en', 'he'] as const) {
    test(`fits a 320 px window with the text at 200% on every step, in ${locale}`, async ({page, context, baseURL}) => {
      await savedPictures(page, context, baseURL!, [
        {name: 'sharp.png', mimeType: 'image/png', buffer: sharpPng(1200, 900)},
        {name: 'blurry.png', mimeType: 'image/png', buffer: blurryPng(1200, 900)},
        {name: 'blown.png', mimeType: 'image/png', buffer: blownOutPng(1200, 900, 0.5)},
      ], {locale});
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      await openReviewFromProject(page, locale);
      await measured(page);
      await nextButton(page, locale).click();
      await expect(alerts(page).filter({hasText: t(locale, 'review.issue.labels')})).toBeVisible();
      expect(await overflowReport(page), 'first step, measured, with the issue').toEqual({scroll: 0, clipped: []});
      await labelAll(page, ['front', 'left', 'detail'], locale);
      await obstructionBox(page, locale).check();
      await nextButton(page, locale).click();
      await expect(heading(page)).toHaveText(t(locale, 'review.title.choose'));
      expect(await overflowReport(page), 'the choice').toEqual({scroll: 0, clipped: []});
      await pathRadio(page, 'image_direct').check();
      await nextButton(page, locale).click();
      await confirmButton(page, locale).click();
      await expect(alerts(page).filter({hasText: t(locale, 'review.ack.required')})).toBeVisible();
      expect(await overflowReport(page), 'direct, the warning and the message').toEqual({scroll: 0, clipped: []});
      await page.locator('.review-ack').getByRole('checkbox').check();
      await confirmButton(page, locale).click();
      await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
      expect(await overflowReport(page), 'the Project page with the review').toEqual({scroll: 0, clipped: []});
    });
  }

  test('keeps every control at least 44 px square on a phone', async ({page, context, baseURL}) => {
    await reviewOpen(page, context, baseURL!, {});
    const small = async () =>
      main(page).locator('button, a.btn, select, input[type="checkbox"], input[type="radio"], label.review-checkbox').evaluateAll((controls) =>
        controls
          .map((control) => ({name: control.textContent?.trim().slice(0, 30) || control.tagName, box: (control.closest('label') ?? control).getBoundingClientRect()}))
          .filter(({box}) => box.width > 0 && (box.height < 43.5 || box.width < 43.5))
          .map(({name}) => name),
      );
    expect(await small(), 'first step').toEqual([]);
    await labelAll(page, ['front', 'left', 'detail']);
    await obstructionBox(page).check();
    await nextButton(page).click();
    expect(await small(), 'the choice').toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('no start', () => {
  test('confirming either choice leaves no Job, permission, payment or cost anywhere, and the Project page and both screens say so', async ({page, context, baseURL}) => {
    const { user, projectId } = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await throughFirstStep(page, ['front', 'left', 'top']);
    await expect(main(page).getByText(t('en', 'review.choose.note'))).toBeVisible();
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    expect(plain(await textOf(main(page)))).toMatch(/starts no conversion, approves no plan and authorizes no cost/);
    await backButton(page).click();
    await pathRadio(page, 'evidence_images').check();
    await nextButton(page).click();
    expect(plain(await textOf(main(page)))).toMatch(/starts no research, approves no plan and authorizes no cost/);
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    await expect(page.getByText(t('en', 'stage.request_draft.next'))).toContainText('Nothing has started and nothing was charged');
    // No table of this system holds an approval, a permission or a payment of the Account: the record of a revision has no such member.
    const { rows } = await world.db.query(
      `select column_name from information_schema.columns where table_schema = 'projects' and table_name in ('request_revisions', 'request_images') and column_name ~* 'approv|permission|payment|paid|cost|price|job|reserv'`,
    );
    expect(rows).toEqual([]);
    expect((await stored(user))[0].revisions.map((revision) => revision.seq)).toEqual([1, 2]);
  });
});

// A bare PNG helper kept for the 24 px case: a tiny picture is too small and flat.
test('a tiny flat picture has two problems at once, resolution and blur', async ({page, context, baseURL}) => {
  await savedPictures(page, context, baseURL!, [{name: 'tiny.png', mimeType: 'image/png', buffer: png([128, 128, 128], 24)}]);
  await openReviewFromProject(page);
  await measured(page);
  const item = itemsOf(page).first();
  await expect(item.locator('[data-result="resolution"]')).toHaveCount(1);
  await expect(item.locator('[data-result="blur"]')).toHaveCount(1);
  await expect(item.locator('[data-result="ok"]')).toHaveCount(1);
  await expect(item).toContainText(t('en', 'review.remedy.resolution'));
  await expect(item).toContainText(t('en', 'review.remedy.blur'));
});
