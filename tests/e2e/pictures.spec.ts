import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {expect, test, type BrowserContext, type Locator, type Page, type Request} from '@playwright/test';
import {translate, type Locale, type MessageKey} from '../../lib/i18n';
import {formatBytes, formatParams, maxPictureBytes, maxPictures, maxSetBytes, shortSha} from '../../lib/picture-set';
import {createS3Storage} from '../../workers/files/src/storage';
import {announcer, hydrated, label, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';
import {MiB, jpeg, palette, pictureFile, png, pngOfLength, sha256Of, views, webp, type PictureFile} from '../support/pictures-world';
import {s3Of} from '../support/stack';

// Story 2.2: choose or photograph several views of one subject, put them in order and keep them privately, in a real browser against the production build,
// the local Supabase stack and the REAL file gateway (the third web server of playwright.config.ts, another origin than the application's). The browser hashes each
// file, asks the application for a ticket and sends the file to the gateway across origins; Save records the ordered set as an unconfirmed request revision. Every
// flow runs on `desktop` and `phone`. The rules of the set, the upload and the camera are held at length by tests/unit/picture-*.test.ts, and the database half by
// tests/integration/picture-sets.test.ts; this is the wiring, for real.

// A fake camera for the whole file (Chromium's own: a moving test pattern, no hardware). It is a launch option, which a describe group cannot set. The tests that
// need the camera to be refused or absent say so themselves in the page, so they do not depend on the flags.
test.use({launchOptions: {args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']}});

let world: AccountsWorld;
const accounts: string[] = [];

test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  try {
    // What the specs staged is taken out of Storage with the stack's own key (the hourly cleanup is not running here).
    const storage = createS3Storage(s3Of(world.stack));
    const { rows } = await world.db.query('select id, account_id from artifacts.staging_leases where account_id = any($1)', [accounts]);
    for (const row of rows) await storage.deletePrefix(`staging/${row.account_id}/${row.id}`).catch(() => 0);
  } finally {
    await world.close();
  }
});

type Options = {locale?: Locale; theme?: 'light' | 'dark'};
type TestUser = Awaited<ReturnType<AccountsWorld['signedInUser']>>;

/** A member with an Account, signed in with a language and theme. */
async function member(context: BrowserContext, baseURL: string, options: Options = {}) {
  const user = await world.signedInUser();
  await world.activate(user);
  await signIn(context, baseURL, user, {locale: options.locale ?? 'en', theme: options.theme ?? 'light'});
  const account = await world.accountOf(user);
  accounts.push(account.id as string);
  return {user, accountId: account.id as string};
}

const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const crossing = {timeout: 20_000};
const newPath = '/projects/new/pictures';
const picturesPath = (projectId: string) => `/projects/${projectId}/pictures`;

// What a person does -----------------------------------------------------------------------------------------------------------

const heading = (page: Page) => page.getByRole('heading', {level: 1});
const main = (page: Page) => page.getByRole('main');
const rowsOf = (page: Page) => page.locator('.picture-item');
const chooser = (page: Page) => page.locator('input[type="file"][multiple]');
const saveButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'picture.save'), exact: true});
const alerts = (page: Page) => page.locator('.notice[role="alert"]');
const textOf = async (locator: Locator) => ((await locator.innerText()) ?? '').replace(/\s+/g, ' ').trim();

async function openNew(page: Page, locale: Locale = 'en') {
  const response = await page.goto(newPath);
  expect(response?.status(), newPath).toBe(200);
  await expect(heading(page)).toHaveText(t(locale, 'picture.title.new'));
  await hydrated(page, 'main button[type="submit"]');
}

async function openChange(page: Page, projectId: string, locale: Locale = 'en') {
  const response = await page.goto(picturesPath(projectId));
  expect(response?.status(), picturesPath(projectId)).toBe(200);
  await expect(heading(page)).toHaveText(t(locale, 'picture.title.change'));
  await hydrated(page, 'main button[type="submit"]');
}

const choose = (page: Page, files: (PictureFile | string)[]) => chooser(page).setInputFiles(files as never);

/** Waits until `count` pictures are in the list and every one of them is staged. */
async function allReady(page: Page, count: number, locale: Locale = 'en') {
  await expect(rowsOf(page)).toHaveCount(count, crossing);
  await expect(rowsOf(page).filter({hasText: t(locale, 'picture.item.ready')})).toHaveCount(count, crossing);
}

const rowTitles = (page: Page) => rowsOf(page).locator('h3').allInnerTexts();
/** The SHA-256 of what each row's preview shows, in the order the rows are in: the order the person sees, read from the pictures themselves. */
const shownOrder = (page: Page) =>
  rowsOf(page)
    .locator('img')
    .evaluateAll((images) =>
      Promise.all(
        images.map(async (image) => {
          const bytes = await (await fetch((image as HTMLImageElement).src)).arrayBuffer();
          return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        }),
      ),
    );

type Revision = {id: string; seq: number; mode: string; scope: string | null; outcome: string | null; description: string | null; confirmed_at: Date | null; subject_id: string | null; applied: boolean; digest: string};
type Saved = {position: number; upload_id: string; sha256: string; length: number; content_type: string};

/** The Projects of the user's Account with their picture revisions, oldest first: what Save stored, exactly. */
async function stored(user: TestUser) {
  const projects = (
    await world.db.query(
      `select p.id, p.title, p.stage, p.revision::int as revision from projects.projects p join identity.accounts a on a.id = p.account_id where a.user_id = $1 order by p.created_at, p.id`,
      [user.id],
    )
  ).rows as {id: string; title: string; stage: string; revision: number}[];
  const revisions = (
    await world.db.query(
      `select r.id, r.project_id, r.seq, r.mode, r.scope, r.outcome, r.description, r.confirmed_at, r.subject_id, r.personalization_applied as applied, r.digest
         from projects.request_revisions r join identity.accounts a on a.id = r.account_id where a.user_id = $1 order by r.project_id, r.seq`,
      [user.id],
    )
  ).rows as (Revision & {project_id: string})[];
  const images = (
    await world.db.query(
      `select i.revision_id, i.position, i.upload_id, i.sha256, i.length::int as length, i.content_type
         from projects.request_images i join identity.accounts a on a.id = i.account_id where a.user_id = $1 order by i.revision_id, i.position`,
      [user.id],
    )
  ).rows as (Saved & {revision_id: string})[];
  return projects.map((project) => ({
    ...project,
    revisions: revisions
      .filter((revision) => revision.project_id === project.id)
      .map((revision) => ({...revision, images: images.filter((image) => image.revision_id === revision.id).map(({revision_id: _revision, ...image}) => image)})),
  }));
}

const leaseOf = async (id: string) =>
  (await world.db.query('select state, kind, length::int as length, sha256, content_type, created_at, expires_at from artifacts.staging_leases where id = $1', [id])).rows[0] as
    | {state: string; kind: string; length: number; sha256: string; content_type: string; created_at: Date; expires_at: Date}
    | undefined;

/** A signed-in member on the empty picture screen with `files` chosen and uploaded, ready to be saved. */
async function withPictures(page: Page, context: BrowserContext, baseURL: string, files: PictureFile[], options: Options = {}) {
  const who = await member(context, baseURL, options);
  await openNew(page, options.locale ?? 'en');
  await choose(page, files);
  await allReady(page, files.length, options.locale ?? 'en');
  return who;
}

async function saveAndLand(page: Page, locale: Locale = 'en') {
  await saveButton(page, locale).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
  return new URL(page.url()).pathname.split('/').pop()!;
}

// ---------------------------------------------------------------------------------------------------
test.describe('C-03: choose pictures, put them in order and save them (UX-DR9, UX-DR33)', () => {
  test('previews three pictures in order with their place, kind and size, stages them one at a time at the gateway, and Save makes the Project and its first revision', async ({page, context, baseURL}) => {
    const problems = watchForProblems(page);
    const { user } = await member(context, baseURL!);
    await openNew(page);
    const files = [pictureFile('front.png', palette[0]), pictureFile('left.png', palette[1]), {name: 'top.jpg', mimeType: 'image/jpeg', buffer: jpeg(3)}];
    // Empty first: the empty state, the limits in words, what staging means (how long, and that location data is kept), and the button to save is there but says what is missing.
    await expect(main(page).getByRole('heading', {name: t('en', 'picture.empty.title')})).toBeVisible();
    await expect(main(page).getByText(t('en', 'picture.privacy'))).toBeVisible();
    await expect(main(page).getByText(t('en', 'picture.save.note'))).toBeVisible();
    expect(t('en', 'picture.save.note')).toMatch(/24 hours after your last save[^.]*each save renews that[^.]*7 days after they were uploaded/);
    await expect(main(page).getByText(t('en', 'picture.limits', {count: maxPictures, ...formatParams, size: formatBytes(maxPictureBytes), total: formatBytes(maxSetBytes)}))).toBeVisible();

    const gatewayRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT') gatewayRequests.push(request.url());
    });
    await choose(page, files);
    await allReady(page, 3);
    expect(await rowTitles(page)).toEqual([1, 2, 3].map((position) => t('en', 'picture.item.title', {position, count: 3}).replace(/⁨|⁩/g, '')));
    // The browser holds each file: a preview is a local object URL, the only picture ever shown.
    const sources = await rowsOf(page).locator('img').evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
    expect(sources).toHaveLength(3);
    for (const source of sources) expect(source).toMatch(/^blob:/);
    await expect(rowsOf(page).nth(0)).toContainText('PNG');
    await expect(rowsOf(page).nth(2)).toContainText('JPEG');
    await expect(rowsOf(page).nth(0)).toContainText(formatBytes(files[0].buffer.length));
    await expect(main(page).getByText(t('en', 'picture.totals', {count: 3, max: maxPictures, size: formatBytes(files.reduce((sum, file) => sum + file.buffer.length, 0)), total: formatBytes(maxSetBytes)}))).toBeVisible();
    // Each picture went straight to the gateway (another origin), one request each, and nothing else did.
    expect(gatewayRequests).toHaveLength(3);
    for (const url of gatewayRequests) expect(new URL(url).origin).not.toBe(new URL(baseURL!).origin);

    const projectId = await saveAndLand(page);
    const [project] = await stored(user);
    expect(project).toMatchObject({id: projectId, stage: 'request_draft', revision: 1});
    // The title is the phrase in the person's language and the UTC date of the first save, so two drafts can be told apart in My Projects (and holds no isolate character).
    expect(project.title).toBe(translate('en', 'picture.projectTitle', {date: new Date().toISOString().slice(0, 10)}, {isolate: false}));
    expect(project.title).toMatch(/^Picture request \d{4}-\d{2}-\d{2}$/);
    expect(project.revisions).toHaveLength(1);
    const [revision] = project.revisions;
    expect(revision).toMatchObject({seq: 1, mode: 'evidence_images', scope: null, outcome: null, description: null, confirmed_at: null, subject_id: null, applied: false});
    // The pictures in the order shown, with the SHA-256, length and type of the files (read from the leases by the database).
    expect(revision.images.map((image) => [image.position, image.sha256, image.length, image.content_type])).toEqual(
      files.map((file, index) => [index + 1, sha256Of(file.buffer), file.buffer.length, file.mimeType]),
    );
    for (const image of revision.images) expect(await leaseOf(image.upload_id)).toMatchObject({state: 'complete', kind: 'picture'});

    // The Project page: its stage in words, the Pictures part in order, "not confirmed yet", Change pictures, and no picture itself.
    await expect(page.getByText(t('en', 'stage.request_draft.label'), {exact: true}).first()).toBeVisible();
    await expect(page.getByText(t('en', 'stage.request_draft.next'))).toBeVisible();
    expect(t('en', 'stage.request_draft.next')).toMatch(/24 hours after your last save[^;]*; the Project page shows when they lapse, in UTC/);
    const section = page.getByRole('region', {name: t('en', 'request.section.title'), exact: true});
    await expect(section.getByText(t('en', 'picture.section.notConfirmed'))).toBeVisible();
    await expect(section.locator('.picture-saved-item')).toHaveCount(3);
    await expect(section.locator('.picture-saved-item').nth(1)).toContainText(shortSha(sha256Of(files[1].buffer)));
    await expect(section.locator('img, video, a[download]')).toHaveCount(0);
    await expect(section.getByRole('link', {name: t('en', 'picture.section.change')})).toHaveAttribute('href', picturesPath(projectId));
    expect(problems).toEqual([]);
  });

  test('moves a picture earlier and later with real buttons, announces each change, keeps focus on the moved picture, and saves the order shown', async ({page, context, baseURL}) => {
    const { user } = await withPictures(page, context, baseURL!, views(3));
    const first = rowsOf(page).nth(0);
    // The first cannot go earlier, the last cannot go later.
    await expect(moveButton(first, 'earlier', 1)).toBeDisabled();
    await expect(moveButton(rowsOf(page).nth(2), 'later', 3)).toBeDisabled();
    // The words on the button are short; what a screen reader says names the picture (and reads in the order of the language).
    await expect(first.getByRole('button', {name: t('en', 'picture.item.laterNamed', {position: 1})}).locator('[aria-hidden="true"]')).toHaveText(t('en', 'picture.item.later'));

    await moveButton(first, 'later', 1).click();
    await expect(announcer(page)).toHaveText(t('en', 'picture.announce.moved', {position: 2, count: 3}));
    // The moved picture is now second and the focus is still on its button.
    await expect(moveButton(rowsOf(page).nth(1), 'later', 2)).toBeFocused();
    await moveButton(rowsOf(page).nth(2), 'earlier', 3).click();
    await expect(announcer(page)).toHaveText(t('en', 'picture.announce.moved', {position: 2, count: 3}));
    // [v1, v2, v3] became [v2, v1, v3] with the first move, and [v2, v3, v1] when v3 moved earlier: the order on the screen, and then in the record.
    const order = views(3);
    expect(await shownOrder(page)).toEqual([order[1], order[2], order[0]].map((file) => sha256Of(file.buffer)));
    await saveAndLand(page);
    const [project] = await stored(user);
    expect(project.revisions[0].images.map((image) => image.sha256)).toEqual([views(3)[1], views(3)[2], views(3)[0]].map((file) => sha256Of(file.buffer)));
  });
});

// The words of a file problem and of an upload problem, as the screen says them.
const fileProblemKey = {
  type: 'picture.problem.type',
  empty: 'picture.problem.empty',
  too_large: 'picture.problem.too_large',
  too_many: 'picture.problem.too_many',
  set_too_large: 'picture.problem.set_too_large',
  duplicate: 'picture.problem.duplicate',
  unreadable: 'picture.problem.unreadable',
} as const;
const fileProblemText = (locale: Locale, name: string, problem: keyof typeof fileProblemKey) =>
  t(locale, fileProblemKey[problem], {name, ...formatParams, size: formatBytes(problem === 'set_too_large' ? maxSetBytes : maxPictureBytes), count: maxPictures});
const problemLines = (page: Page) => page.locator('.picture-problems li').allInnerTexts();
const retryButton = (row: Locator, locale: Locale = 'en') => row.getByRole('button', {name: new RegExp(`^${t(locale, 'picture.item.retry')}`)});
const rowButton = (row: Locator, key: MessageKey, locale: Locale = 'en') => row.getByRole('button', {name: new RegExp(`^${t(locale, key)}`)});
/** A move button by what a screen reader says of it ("Move picture 2 earlier"), which names its picture. */
const moveButton = (row: Locator, direction: 'earlier' | 'later', position: number, locale: Locale = 'en') =>
  row.getByRole('button', {name: t(locale, direction === 'earlier' ? 'picture.item.earlierNamed' : 'picture.item.laterNamed', {position}), exact: true});

/** The lease of the file with this digest, polled until it is in `state` (a release is made by the database a moment after the click). */
async function leaseOfFile(accountId: string, file: PictureFile) {
  const { rows } = await world.db.query('select id, state from artifacts.staging_leases where account_id = $1 and sha256 = $2 order by created_at', [accountId, sha256Of(file.buffer)]);
  return rows as {id: string; state: string}[];
}
const openQuota = async (accountId: string) =>
  Number((await world.db.query(`select coalesce(sum(length), 0) as n from artifacts.staging_leases where account_id = $1 and state in ('receiving', 'complete') and expires_at > now()`, [accountId])).rows[0].n);

// ---------------------------------------------------------------------------------------------------
test.describe('the same in Hebrew', () => {
  test('is right to left, says everything in Hebrew, and saves the same set', async ({page, context, baseURL}) => {
    const { user } = await member(context, baseURL!, {locale: 'he'});
    await openNew(page, 'he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(main(page).getByText(t('he', 'picture.empty.title'))).toBeVisible();
    await choose(page, views(2));
    await allReady(page, 2, 'he');
    expect(await rowTitles(page)).toEqual([1, 2].map((position) => t('he', 'picture.item.title', {position, count: 2})));
    await expect(moveButton(rowsOf(page).nth(0), 'later', 1, 'he')).toBeVisible();
    await expect(main(page).getByText(t('he', 'picture.totals', {count: 2, max: maxPictures, size: formatBytes(views(2).reduce((sum, file) => sum + file.buffer.length, 0)), total: formatBytes(maxSetBytes)}))).toBeVisible();
    // Move one, and the announcement is in Hebrew.
    await moveButton(rowsOf(page).nth(0), 'later', 1, 'he').click();
    await expect(announcer(page)).toHaveText(t('he', 'picture.announce.moved', {position: 2, count: 2}));
    await saveAndLand(page, 'he');
    await expect(page.getByText(t('he', 'stage.request_draft.label'), {exact: true}).first()).toBeVisible();
    await expect(page.getByRole('region', {name: t('he', 'request.section.title'), exact: true}).getByText(t('he', 'picture.section.notConfirmed'))).toBeVisible();
    const [project] = await stored(user);
    expect(project.revisions[0].images.map((image) => image.sha256)).toEqual([views(2)[1], views(2)[0]].map((file) => sha256Of(file.buffer)));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('replace and remove release what was never saved (AC-4)', () => {
  test('a removed or replaced picture is released at once, frees the quota, and is not part of the saved set', async ({page, context, baseURL}) => {
    const files = views(3);
    const { user, accountId } = await withPictures(page, context, baseURL!, files);
    const before = await openQuota(accountId);
    expect(before).toBe(files.reduce((sum, file) => sum + file.buffer.length, 0));

    // Remove the second.
    await rowButton(rowsOf(page).nth(1), 'picture.item.remove').click();
    await expect(announcer(page)).toHaveText(t('en', 'picture.announce.removed', {count: 2}));
    await expect(rowsOf(page)).toHaveCount(2);
    await expect.poll(async () => (await leaseOfFile(accountId, files[1]))[0]?.state, crossing).toBe('released');
    expect(await openQuota(accountId)).toBe(before - files[1].buffer.length);

    // Replace the first (a file chooser of its own): the old upload is released, the new one staged in the same place.
    const replacement = pictureFile('again.png', [1, 2, 3]);
    const [chooserEvent] = await Promise.all([page.waitForEvent('filechooser'), rowButton(rowsOf(page).nth(0), 'picture.item.replace').click()]);
    await chooserEvent.setFiles(replacement);
    await expect(rowsOf(page)).toHaveCount(2);
    await expect(rowsOf(page).nth(0).getByText(t('en', 'picture.item.ready'))).toBeVisible(crossing);
    await expect.poll(async () => (await leaseOfFile(accountId, files[0]))[0]?.state, crossing).toBe('released');
    expect((await leaseOfFile(accountId, replacement))[0]?.state).toBe('complete');
    await saveAndLand(page);
    const [project] = await stored(user);
    expect(project.revisions[0].images.map((image) => image.sha256)).toEqual([replacement, files[2]].map((file) => sha256Of(file.buffer)));
    expect(await openQuota(accountId)).toBe(replacement.buffer.length + files[2].buffer.length);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('bad files (AC-3)', () => {
  for (const locale of ['en', 'he'] as const) {
    test(`names each one in words and adds none of them, in ${locale}: a text file, a HEIC picture, an empty file and one byte over 12 MiB`, async ({page, context, baseURL}) => {
      const { accountId } = await member(context, baseURL!, {locale});
      await openNew(page, locale);
      const valid = pictureFile('good.png', palette[0]);
      const files: PictureFile[] = [
        {name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture')},
        {name: 'phone.heic', mimeType: 'image/heic', buffer: Buffer.from('heic bytes')},
        {name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0)},
        {name: 'huge.png', mimeType: 'image/png', buffer: pngOfLength(palette[1], maxPictureBytes + 1)},
        valid,
      ];
      await choose(page, files);
      await allReady(page, 1, locale);
      expect(await problemLines(page)).toEqual([
        fileProblemText(locale, 'notes.txt', 'type'),
        fileProblemText(locale, 'phone.heic', 'type'),
        fileProblemText(locale, 'empty.png', 'empty'),
        fileProblemText(locale, 'huge.png', 'too_large'),
      ]);
      await expect(alerts(page).filter({hasText: t(locale, 'picture.problems.title')})).toBeVisible();
      // Plain words, with the three formats through a placeholder; the file input says it has a problem and what.
      for (const name of Object.values(formatParams)) expect(await problemLines(page).then((lines) => lines[0])).toContain(name);
      await expect(chooser(page)).toHaveAttribute('aria-invalid', 'true');
      expect(await descriptions(chooser(page))).toContain(await textOf(page.locator('.picture-problems').locator('xpath=ancestor::*[@id][1]')).then((text) => text));
      // Only the valid file was staged: nothing of the others reached the gateway.
      const leases = await world.db.query('select count(*)::int as n from artifacts.staging_leases where account_id = $1', [accountId]);
      expect(leases.rows[0].n).toBe(1);
      // Choosing more files replaces the list of problems: they are about the last choice.
      await choose(page, [pictureFile('second.png', palette[2])]);
      await allReady(page, 2, locale);
      await expect(page.locator('.picture-problems')).toHaveCount(0);
      // Files that are all refused are announced as such, once (nothing else is going on to speak over it).
      await choose(page, [{name: 'again.txt', mimeType: 'text/plain', buffer: Buffer.from('x')}]);
      await expect(announcer(page)).toHaveText(t(locale, 'picture.announce.notAdded', {count: 1}));
    });
  }

  test('is full at 12 pictures: the 13th is not added, and a set over 60 MiB stops at the picture that would pass it', async ({page, context, baseURL}, testInfo) => {
    const { accountId } = await member(context, baseURL!);
    await openNew(page);
    const twelve = views(12);
    await choose(page, twelve);
    await allReady(page, 12);
    const thirteenth = pictureFile('extra.png', palette[12]);
    await choose(page, [thirteenth]);
    await expect(rowsOf(page)).toHaveCount(12);
    expect(await problemLines(page)).toEqual([fileProblemText('en', 'extra.png', 'too_many')]);
    expect((await leaseOfFile(accountId, thirteenth)).length).toBe(0);

    // 60 MiB: five files of 12 MiB fit exactly; one more byte does not (it is told before anything of it is read, while the five are still on their way).
    await page.goto(newPath);
    await hydrated(page, 'main button[type="submit"]');
    // (Playwright takes at most 50 MB in memory for a choice: the big files are written out and chosen by path.)
    const big = Array.from({length: 5}, (_, index) => {
      const path = testInfo.outputPath(`big-${index + 1}.png`);
      writeFileSync(path, pngOfLength(palette[index], maxPictureBytes));
      return path;
    });
    await choose(page, big);
    await expect(rowsOf(page)).toHaveCount(5);
    expect(await problemLines(page)).toEqual([]);
    await choose(page, [pictureFile('one-more.png', palette[7])]);
    await expect(rowsOf(page)).toHaveCount(5);
    expect(await problemLines(page)).toEqual([fileProblemText('en', 'one-more.png', 'set_too_large')]);
  });

  test('does not add the same picture twice: it is told after the file is hashed, and nothing of it is uploaded', async ({page, context, baseURL}) => {
    const { accountId } = await member(context, baseURL!);
    await openNew(page);
    const original = pictureFile('original.png', palette[3]);
    await choose(page, [original, {...original, name: 'copy.png'}]);
    await expect(rowsOf(page)).toHaveCount(1, crossing);
    await expect(page.locator('.picture-problems li')).toHaveText([fileProblemText('en', 'copy.png', 'duplicate')], crossing);
    await allReady(page, 1);
    expect((await leaseOfFile(accountId, original)).length).toBe(1);
    // The same file again later is the same picture.
    await choose(page, [{...original, name: 'third.png'}]);
    await expect(page.locator('.picture-problems li')).toHaveText([fileProblemText('en', 'third.png', 'duplicate')], crossing);
    await expect(rowsOf(page)).toHaveCount(1);
  });

  test('shows the gateway\'s refusal of a file that is not what its name says, offers no Retry for it, and a replacement works', async ({page, context, baseURL}) => {
    const { accountId } = await member(context, baseURL!);
    await openNew(page);
    const lie: PictureFile = {name: 'lie.png', mimeType: 'image/png', buffer: Buffer.from('this is plain text, whatever the name says')};
    await choose(page, [lie]);
    const row = rowsOf(page).first();
    await expect(row.getByText(t('en', 'picture.upload.content'))).toBeVisible(crossing);
    await expect(retryButton(row)).toHaveCount(0);
    await expect(alerts(page).filter({hasText: t('en', 'picture.upload.content')})).toBeVisible();
    // Nothing is staged for it: its lease was released when the gateway refused it.
    await expect.poll(async () => (await leaseOfFile(accountId, lie)).map((lease) => lease.state), crossing).toEqual(['released']);
    // Save says a picture did not upload.
    await saveButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'picture.set.failed')})).toBeVisible();
    // Replace it, and it is staged.
    const [chooserEvent] = await Promise.all([page.waitForEvent('filechooser'), rowButton(row, 'picture.item.replace').click()]);
    await chooserEvent.setFiles(pictureFile('real.png', palette[4]));
    await allReady(page, 1);
    await expect(alerts(page).filter({hasText: t('en', 'picture.set.failed')})).toHaveCount(0);
  });
});

const descriptions = async (control: Locator) => {
  const ids = ((await control.getAttribute('aria-describedby')) ?? '').split(/\s+/).filter(Boolean);
  return Promise.all(ids.map((id) => control.page().locator(`[id="${id}"]`).innerText().then((text) => text.replace(/\s+/g, ' ').trim())));
};

// ---------------------------------------------------------------------------------------------------
test.describe('failures are named, and a picture that did not upload can be tried again (AC-3)', () => {
  test('a ticket the application cannot give is "try again", nothing reaches the gateway, and Retry then stages the picture', async ({page, context, baseURL}) => {
    const { accountId } = await member(context, baseURL!);
    await openNew(page);
    let refuse = true;
    await page.route('**/api/transfers/tickets', (route) =>
      refuse ? route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'unavailable'})}) : route.continue(),
    );
    const file = pictureFile('retry.png', palette[5]);
    await choose(page, [file]);
    const row = rowsOf(page).first();
    await expect(row.getByText(t('en', 'picture.upload.unavailable'))).toBeVisible(crossing);
    await expect(retryButton(row)).toBeVisible();
    await expect(announcer(page)).toHaveText(t('en', 'picture.announce.failed', {position: 1}));
    expect((await leaseOfFile(accountId, file)).length).toBe(0);
    // Saving now says a picture did not upload, and records nothing.
    await saveButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'picture.set.failed')})).toBeVisible();
    refuse = false;
    await retryButton(row).click();
    await allReady(page, 1);
    expect((await leaseOfFile(accountId, file)).map((lease) => lease.state)).toEqual(['complete']);
  });

  test('a session that needs refreshing says to reload the page and offers no Retry; a connection that breaks before the answer is "try again" with a new upload ID', async ({page, context, baseURL}) => {
    const { accountId } = await member(context, baseURL!);
    await openNew(page);
    const first = pictureFile('first.png', palette[6]);
    await page.route('**/api/transfers/tickets', (route) => route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: 'csrf_invalid'})}));
    await choose(page, [first]);
    const row = rowsOf(page).first();
    await expect(row.getByText(t('en', 'picture.upload.reload'))).toBeVisible(crossing);
    await expect(retryButton(row)).toHaveCount(0);
    await page.unroute('**/api/transfers/tickets');

    // A picture whose PUT is cut before any answer: the gateway cuts a refused upload on purpose, which a browser sees as a broken connection.
    const second = pictureFile('second.png', palette[7]);
    let cut = true;
    const attempts: string[] = [];
    await page.route(/\/v1\/uploads\//, (route) => {
      attempts.push(new URL(route.request().url()).pathname);
      return cut ? route.abort('connectionreset') : route.continue();
    });
    await rowButton(row, 'picture.item.remove').click();
    await choose(page, [second]);
    const next = rowsOf(page).first();
    await expect(next.getByText(t('en', 'picture.upload.network'))).toBeVisible(crossing);
    await expect(retryButton(next)).toBeVisible();
    cut = false;
    await retryButton(next).click();
    await allReady(page, 1);
    // Each attempt is its own upload: a new ID, and the gateway never saw the first.
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toBe(attempts[1]);
    expect((await leaseOfFile(accountId, second)).map((lease) => lease.state)).toEqual(['complete']);
  });

  test('an answer to Save that is lost may have been recorded: the person is told to look, and saving again makes no second Project', async ({page, context, baseURL}) => {
    const { user } = await withPictures(page, context, baseURL!, views(2));
    let lose = true;
    await page.route(`**${newPath}`, async (route) => {
      if (route.request().method() !== 'POST' || !lose) return route.continue();
      // The server gets the request and does what it asks; the browser never hears.
      await route.fetch();
      return route.abort('connectionreset');
    });
    await saveButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'picture.save.unknown')})).toBeVisible(crossing);
    expect((await stored(user)).length).toBe(1);
    lose = false;
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    const projects = await stored(user);
    expect(projects).toHaveLength(1);
    expect(projects[0].revisions).toHaveLength(1);
    expect(projects[0]).toMatchObject({stage: 'request_draft', revision: 1});
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('change the pictures: a successor revision (AC-2, AC-4)', () => {
  test('brings the saved set back as ordered rows without previews, saves a reorder, a replacement, a removal and an addition as ONE successor, and the same set again is unchanged', async ({page, context, baseURL}) => {
    const [a, b, c] = views(3);
    const d = pictureFile('d.png', palette[3]);
    const e = pictureFile('e.png', palette[4]);
    const { user, accountId } = await withPictures(page, context, baseURL!, [a, b, c]);
    const projectId = await saveAndLand(page);
    const first = (await stored(user))[0].revisions[0];

    await page.getByRole('link', {name: t('en', 'picture.section.change')}).click();
    await expect(page).toHaveURL(`${baseURL}${picturesPath(projectId)}`, crossing);
    await expect(heading(page)).toHaveText(t('en', 'picture.title.change'));
    await hydrated(page, 'main button[type="submit"]');
    // The saved set is there in order, ready, with no preview (nothing of a staged picture is ever fetched), and a way back.
    await expect(rowsOf(page)).toHaveCount(3);
    await expect(rowsOf(page).locator('img')).toHaveCount(0);
    for (const row of await rowsOf(page).all()) {
      await expect(row).toContainText(/Saved\. In private staging until \S*\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
      // Why there is no picture to see is visible text under the empty frame (not a tooltip).
      await expect(row.locator('.picture-nopreview')).toHaveText(t('en', 'picture.item.noPreview'));
    }
    await expect(page.getByRole('link', {name: t('en', 'picture.back')})).toHaveAttribute('href', `/projects/${projectId}`);
    // Remove the second (a saved picture: not discarded yet), replace the third with D, add E, move E earlier: [a, e, d].
    await rowButton(rowsOf(page).nth(1), 'picture.item.remove').click();
    await expect(rowsOf(page)).toHaveCount(2);
    expect((await leaseOfFile(accountId, b))[0].state).toBe('complete');
    const [replaceChooser] = await Promise.all([page.waitForEvent('filechooser'), rowButton(rowsOf(page).nth(1), 'picture.item.replace').click()]);
    await replaceChooser.setFiles(d);
    await expect(rowsOf(page).nth(1).getByText(t('en', 'picture.item.ready'))).toBeVisible(crossing);
    await choose(page, [e]);
    await allReady(page, 3);
    await moveButton(rowsOf(page).nth(2), 'earlier', 3).click();
    await saveButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${projectId}`, crossing);

    const [project] = await stored(user);
    expect(project).toMatchObject({id: projectId, stage: 'request_draft', revision: 2});
    expect(project.revisions.map((revision) => revision.seq)).toEqual([1, 2]);
    // The first revision is as it was; the successor holds the new order.
    expect(project.revisions[0].images.map((image) => image.sha256)).toEqual([a, b, c].map((file) => sha256Of(file.buffer)));
    expect(project.revisions[0].digest).toBe(first.digest);
    expect(project.revisions[1].images.map((image) => image.sha256)).toEqual([a, e, d].map((file) => sha256Of(file.buffer)));
    expect(project.revisions[1]).toMatchObject({mode: 'evidence_images', scope: null, confirmed_at: null});
    // What left the set is released at once; what stayed is renewed to 24 hours from now, never past 7 days from its creation.
    expect((await leaseOfFile(accountId, b))[0].state).toBe('released');
    expect((await leaseOfFile(accountId, c))[0].state).toBe('released');
    for (const file of [a, d, e]) {
      const lease = (await world.db.query('select state, created_at, expires_at from artifacts.staging_leases where account_id = $1 and sha256 = $2', [accountId, sha256Of(file.buffer)])).rows[0];
      expect(lease.state).toBe('complete');
      const hours = (lease.expires_at.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23.5);
      expect(hours).toBeLessThanOrEqual(24.01);
      expect(lease.expires_at.getTime()).toBeLessThanOrEqual(lease.created_at.getTime() + 7 * 24 * 3_600_000);
    }
    await expect(page.getByRole('region', {name: t('en', 'request.section.title'), exact: true}).locator('.picture-saved-item')).toHaveCount(3);

    // The same pictures in the same order again: no revision is recorded and nothing on the Project changes, but the uploads are kept for another 24 hours (never
    // past 7 days from their creation), which is what pressing Save on a set is for.
    const keptIds = project.revisions[1].images.map((image) => image.upload_id);
    await world.db.query(`update artifacts.staging_leases set expires_at = now() + interval '1 hour' where id = any($1)`, [keptIds]);
    const before = (await stored(user))[0];
    await openChange(page, projectId);
    await saveButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${projectId}`, crossing);
    const same = (await stored(user))[0];
    expect(same.revision).toBe(2);
    expect(same.revisions).toHaveLength(2);
    expect(same.revisions.map((revision) => revision.id)).toEqual(before.revisions.map((revision) => revision.id));
    for (const id of keptIds) {
      const lease = (await leaseOf(id))!;
      expect(lease.state).toBe('complete');
      expect((lease.expires_at.getTime() - Date.now()) / 3_600_000).toBeGreaterThan(23.5);
      expect(lease.expires_at.getTime()).toBeLessThanOrEqual(lease.created_at.getTime() + 7 * 24 * 3_600_000);
    }

    // A new order is revision 3.
    await openChange(page, projectId);
    await moveButton(rowsOf(page).nth(0), 'later', 1).click();
    await saveButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${projectId}`, crossing);
    const third = (await stored(user))[0];
    expect(third.revision).toBe(3);
    expect(third.revisions.map((revision) => revision.seq)).toEqual([1, 2, 3]);
    expect(third.revisions[2].images.map((image) => image.sha256)).toEqual([e, a, d].map((file) => sha256Of(file.buffer)));
  });

  test('warns of a picture whose private copy has lapsed, on the Project page and on the picture screen, and will not save until it is replaced', async ({page, context, baseURL}) => {
    const files = views(2);
    const { user, accountId } = await withPictures(page, context, baseURL!, files);
    const projectId = await saveAndLand(page);
    const lapsed = (await leaseOfFile(accountId, files[0]))[0].id;
    await world.db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [lapsed]);

    await page.goto(`/projects/${projectId}`);
    const section = page.getByRole('region', {name: t('en', 'request.section.title'), exact: true});
    await expect(section.locator('.picture-saved-item').nth(0).getByText(t('en', 'picture.section.unavailable'))).toBeVisible();
    await expect(section.locator('.picture-saved-item').nth(1).getByText(t('en', 'picture.section.unavailable'))).toHaveCount(0);

    await openChange(page, projectId);
    await expect(rowsOf(page).nth(0).getByText(t('en', 'picture.item.expired'))).toBeVisible();
    await saveButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'picture.set.expired')})).toBeVisible();
    expect((await stored(user))[0].revisions).toHaveLength(1);
    // Replace it, and the save is a successor.
    const [replaceChooser] = await Promise.all([page.waitForEvent('filechooser'), rowButton(rowsOf(page).nth(0), 'picture.item.replace').click()]);
    await replaceChooser.setFiles(pictureFile('fresh.png', palette[9]));
    await expect(rowsOf(page).nth(0).getByText(t('en', 'picture.item.ready'))).toBeVisible(crossing);
    await saveButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${projectId}`, crossing);
    expect((await stored(user))[0].revisions.map((revision) => revision.seq)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('what the database refuses, and what is not the Account\'s (AC-3)', () => {
  test('a foreign upload ID is refused by the database from its lease, says which picture, records nothing, and the picture can be sent again', async ({page, context, baseURL}) => {
    const { user } = await withPictures(page, context, baseURL!, views(2));
    // Another Account's upload: a complete lease of someone else's, with an ID this Account has no right to.
    const stranger = randomUUID();
    const other = await world.signedInUser();
    await world.activate(other);
    const otherAccount = (await world.accountOf(other)).id as string;
    accounts.push(otherAccount);
    await world.db.query(
      `insert into artifacts.staging_leases (id, account_id, kid, kind, length, sha256, content_type, received_length, state, expires_at)
       values ($1, $2, 'test-key', 'picture', 10, $3, 'image/png', 10, 'complete', now() + interval '1 hour')`,
      [stranger, otherAccount, sha256Of(Buffer.from('a stranger'))],
    );
    // The form is the browser's to send, so it can say anything: the second hidden upload ID is swapped for the stranger's.
    await page.locator('input[name="uploadId"]').nth(1).evaluate((input, id) => ((input as HTMLInputElement).value = id), stranger);
    await saveButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'picture.save.unknownUpload', {position: 2})})).toBeVisible(crossing);
    expect(await stored(user)).toEqual([]);
    expect(await world.projectCount(user)).toBe(0);
    // The answer is read against the uploads that were SUBMITTED, and the stranger's is none of this screen's pictures: no picture is marked, both are still ready, and
    // the form carries the screen's own uploads again, so the same Save, pressed again, records the two.
    await expect(rowsOf(page).filter({hasText: t('en', 'picture.item.ready')})).toHaveCount(2);
    await expect(page.locator('.picture-item .notice')).toHaveCount(0);
    await saveAndLand(page);
    expect((await stored(user))[0].revisions[0].images).toHaveLength(2);
  });

  test('the pictures of another Account\'s Project, or of none, are the one page that is not available; a request that is not an unconfirmed set of pictures cannot be changed here', async ({page, context, baseURL}) => {
    const { user } = await withPictures(page, context, baseURL!, views(1));
    const projectId = await saveAndLand(page);
    // A second member sees nothing of it, and the same page for an ID that never existed.
    const second = await browserContextFor(page, baseURL!);
    try {
      const answers: string[] = [];
      for (const id of [projectId, randomUUID()]) {
        const response = await second.page.goto(picturesPath(id));
        expect(response?.status(), id).toBe(404);
        await expect(second.page.getByRole('heading', {level: 1})).toHaveText(t('en', 'project.unavailable.title'));
        answers.push(await textOf(second.page.getByRole('main')));
        expect(await second.page.content()).not.toContain(t('en', 'picture.projectTitle'));
      }
      // The Project of another Account and one that never existed are the very same page.
      expect(answers[0]).toBe(answers[1]);
    } finally {
      await second.context.close();
    }
    // A text request (confirmed, Story 2.1) is not an unconfirmed set of pictures.
    const accountId = (await world.accountOf(user)).id as string;
    const { rows } = await world.db.query(
      `select (api.create_project_request(a.id, a.authorization_epoch, gen_random_uuid(), 'A text request', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', 'altar', null, null, null, false, null)).project_id as id
         from identity.accounts a where a.id = $1`,
      [accountId],
    );
    const textProject = rows[0].id as string;
    const response = await page.goto(picturesPath(textProject));
    expect(response?.status()).toBe(200);
    await expect(main(page).getByRole('heading', {name: t('en', 'picture.locked.title')})).toBeVisible();
    await expect(page.getByRole('link', {name: t('en', 'picture.locked.back')})).toHaveAttribute('href', `/projects/${textProject}`);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    // ... and the Project page of a text request offers no Change pictures.
    await page.goto(`/projects/${textProject}`);
    await expect(page.getByRole('link', {name: t('en', 'picture.section.change')})).toHaveCount(0);
  });
});

/** A second signed-in member in a browser context of its own. */
async function browserContextFor(page: Page, baseURL: string) {
  const context = await page.context().browser()!.newContext({baseURL, ...(await page.evaluate(() => ({viewport: {width: window.innerWidth, height: window.innerHeight}})))});
  const user = await world.signedInUser();
  await world.activate(user);
  await signIn(context, baseURL, user, {locale: 'en', theme: 'light'});
  accounts.push((await world.accountOf(user)).id as string);
  return {context, page: await context.newPage(), user};
}

// ---------------------------------------------------------------------------------------------------
test.describe('no picture crosses the application, and no download URL exists (AC-3)', () => {
  test('the page never asks the gateway for a download, the application never sees an image body, and no page or payload names a download address', async ({page, context, baseURL}) => {
    const appOrigin = new URL(baseURL!).origin;
    const seen: {url: string; method: string; size: number; type: string}[] = [];
    page.on('request', (request: Request) => {
      if (request.url().startsWith('data:') || request.url().startsWith('blob:')) return;
      seen.push({url: request.url(), method: request.method(), size: request.postDataBuffer()?.length ?? 0, type: request.headers()['content-type'] ?? ''});
    });
    const files = views(3);
    const { user } = await withPictures(page, context, baseURL!, files);
    const projectId = await saveAndLand(page);
    await openChange(page, projectId);
    const pages = [await page.content(), await (await page.request.get(`/projects/${projectId}`)).text(), await (await page.request.get(picturesPath(projectId))).text()];
    for (const html of pages) {
      expect(html).not.toMatch(/\/v1\/files\/|\/d\/[A-Za-z0-9_.-]{20,}|\/h\/[A-Za-z0-9_-]{43}|private-files|staging\/[0-9a-f-]{36}|presign|signedUrl/i);
      expect(html).not.toMatch(/<a\b[^>]*\bdownload\b/i);
    }
    // Every request the page made: to the gateway only uploads (PUT) and their preflights; to the application nothing that carries an image.
    for (const request of seen) {
      const url = new URL(request.url);
      if (url.origin === appOrigin) {
        expect(request.size, `${request.method} ${request.url}`).toBeLessThan(16 * 1024);
        expect(request.type, request.url).not.toMatch(/^image\/|octet-stream/);
      } else {
        expect(['PUT', 'OPTIONS'], `${request.method} ${request.url}`).toContain(request.method);
        expect(url.pathname, request.url).toMatch(/^\/v1\/uploads\/[0-9a-f-]{36}$/);
      }
    }
    expect(seen.filter((request) => new URL(request.url).origin !== appOrigin && request.method === 'PUT')).toHaveLength(3);
    // The application's database holds no URL: the recorded pictures are IDs and digests.
    const { rows } = await world.db.query(`select row_to_json(i)::text as row from projects.request_images i join identity.accounts a on a.id = i.account_id where a.user_id = $1`, [user.id]);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.row).not.toMatch(/https?:|\/v1\/|staging\//);
  });
});

// ---------------------------------------------------------------------------------------------------
type CameraSpy = {calls: number; streams: MediaStream[]};
declare global {
  interface Window {
    __camera: CameraSpy;
  }
}
const takePhoto = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'picture.camera.take'), exact: true});
const cameraCalls = (page: Page) => page.evaluate(() => window.__camera.calls);
const tracksEnded = (page: Page) => page.evaluate(() => window.__camera.streams.length > 0 && window.__camera.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')));

test.describe('Take photo, with a camera (UX-DR9)', () => {
  test.use({permissions: ['camera']});

  test.beforeEach(async ({page}) => {
    // Counts every ask for the camera and keeps the streams, so the test can see when it was asked and that every track was stopped.
    await page.addInitScript(() => {
      window.__camera = {calls: 0, streams: []};
      const devices = navigator.mediaDevices;
      const original = devices.getUserMedia.bind(devices);
      devices.getUserMedia = async (constraints) => {
        window.__camera.calls += 1;
        const stream = await original(constraints);
        window.__camera.streams.push(stream);
        return stream;
      };
    });
  });

  test('asks for the camera only when Take photo is pressed, shows a live preview with Capture and Cancel, adds the frame as the next angle (a JPEG), stops every track, and saves it with the others', async ({page, context, baseURL}) => {
    const { user } = await member(context, baseURL!);
    await openNew(page);
    await expect(takePhoto(page)).toBeVisible();
    // Loading the page, choosing a file and looking at the screen never ask.
    await choose(page, [pictureFile('chosen.png', palette[0])]);
    await allReady(page, 1);
    expect(await cameraCalls(page)).toBe(0);

    await takePhoto(page).click();
    const video = page.locator('video.picture-video');
    await expect(video).toBeVisible(crossing);
    await expect(page.getByRole('button', {name: t('en', 'picture.camera.capture'), exact: true})).toBeFocused();
    await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).videoWidth), crossing).toBeGreaterThan(0);
    expect(await cameraCalls(page)).toBe(1);
    // Cancel stops the camera and adds nothing, and the focus returns to Take photo.
    await page.getByRole('button', {name: t('en', 'picture.camera.cancel'), exact: true}).click();
    await expect(video).toHaveCount(0);
    expect(await tracksEnded(page)).toBe(true);
    await expect(takePhoto(page)).toBeFocused();
    await expect(rowsOf(page)).toHaveCount(1);

    // Again, and capture.
    await takePhoto(page).click();
    await expect.poll(() => video.evaluate((element) => (element as HTMLVideoElement).videoWidth), crossing).toBeGreaterThan(0);
    expect(await cameraCalls(page)).toBe(2);
    await page.getByRole('button', {name: t('en', 'picture.camera.capture'), exact: true}).click();
    await expect(video).toHaveCount(0);
    await allReady(page, 2);
    expect(await tracksEnded(page)).toBe(true);
    await expect(announcer(page)).toHaveText(t('en', 'picture.announce.ready', {position: 2}), crossing);
    await expect(rowsOf(page).nth(1)).toContainText('JPEG');
    await saveAndLand(page);
    const [project] = await stored(user);
    const [chosen, photo] = project.revisions[0].images;
    expect(chosen.content_type).toBe('image/png');
    expect(photo).toMatchObject({position: 2, content_type: 'image/jpeg'});
    expect(photo.length).toBeGreaterThan(0);
  });

  test('stops the camera when the screen is left with it on', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    await takePhoto(page).click();
    await expect(page.locator('video.picture-video')).toBeVisible(crossing);
    await page.evaluate(() => {
      // The stream is kept to look at after the page has gone: its tracks are what is checked.
      (window as unknown as {__kept: MediaStream[]}).__kept = window.__camera.streams;
    });
    await page.getByRole('navigation', {name: t('en', 'a11y.mainNavigation')}).getByRole('link', {name: t('en', 'nav.projects')}).click();
    await expect(page).toHaveURL(/\/projects$/, crossing);
    expect(await page.evaluate(() => window.__camera.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')))).toBe(true);
  });
});

test.describe('Take photo, without one (UX-DR9, AC-1)', () => {
  test('is not offered where the browser has no camera API, and Choose files works', async ({page, context, baseURL}) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', {value: undefined, configurable: true}));
    await member(context, baseURL!);
    await openNew(page);
    await expect(takePhoto(page)).toHaveCount(0);
    await choose(page, [pictureFile('chosen.png', palette[0])]);
    await allReady(page, 1);
  });

  test('says in words that the camera cannot be used when permission is refused, leaves Choose files working, and records nothing about the camera', async ({page, context, baseURL}) => {
    await page.addInitScript(() => {
      window.__camera = {calls: 0, streams: []};
      navigator.mediaDevices.getUserMedia = () => {
        window.__camera.calls += 1;
        return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      };
    });
    const { user } = await member(context, baseURL!);
    await openNew(page);
    await expect(takePhoto(page)).toBeVisible();
    // Permission is asked only when the button is pressed (AC-1).
    expect(await cameraCalls(page)).toBe(0);
    await takePhoto(page).click();
    const notice = page.locator('.notice').filter({hasText: t('en', 'picture.camera.deniedTitle')});
    await expect(notice).toBeVisible(crossing);
    await expect(notice).toContainText(t('en', 'picture.camera.denied'));
    expect(await cameraCalls(page)).toBe(1);
    await expect(announcer(page)).toHaveText(t('en', 'picture.announce.cameraDenied'));
    await expect(page.locator('video')).toHaveCount(0);
    // The file picker keeps working, and the camera can be tried again.
    await choose(page, [pictureFile('chosen.png', palette[0])]);
    await allReady(page, 1);
    await takePhoto(page).click();
    await expect.poll(() => cameraCalls(page)).toBe(2);
    await saveAndLand(page);
    // Nothing was recorded about the camera: the stored request is the same shape as any other.
    expect((await stored(user))[0].revisions[0].images).toHaveLength(1);
    expect(await page.evaluate(() => JSON.stringify(Object.keys(localStorage)) + JSON.stringify(Object.keys(sessionStorage)))).not.toMatch(/camera|permission|photo/i);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the secure context', () => {
  test('says so when the page cannot hash a file, and leaves nothing to press', async ({page, context, baseURL}) => {
    await page.addInitScript(() => Object.defineProperty(crypto, 'subtle', {value: undefined, configurable: true}));
    await member(context, baseURL!);
    await page.goto(newPath);
    await expect(heading(page)).toHaveText(t('en', 'picture.title.new'));
    await expect(main(page).getByText(t('en', 'picture.secure.title'))).toBeVisible(crossing);
    await expect(chooser(page)).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('keyboard (UX-DR9)', () => {
  test('is complete without a pointer: choose, move, replace, remove and save with the keys', async ({page, context, baseURL, browserName}) => {
    test.skip(browserName !== 'chromium', 'Tab order is checked in Chromium.');
    const { user } = await member(context, baseURL!);
    await openNew(page);
    // Tab to Choose files and open the chooser with Enter.
    await focusByTab(page, () => page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === 'file'));
    await expect(chooser(page)).toBeFocused();
    const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Enter')]);
    await fileChooser.setFiles(views(3));
    await allReady(page, 3);
    // Move the first picture later with its button, by keys only.
    await focusByTab(page, () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.startsWith('Move later') === true));
    await page.keyboard.press('Enter');
    await expect(announcer(page)).toHaveText(t('en', 'picture.announce.moved', {position: 2, count: 3}));
    // Remove the (new) first picture with Space on its Remove button.
    await focusByTab(page, () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.startsWith('Remove') === true), true);
    await page.keyboard.press('Space');
    await expect(rowsOf(page)).toHaveCount(2);
    // Save with the keys.
    await focusByTab(page, () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.startsWith('Save pictures') === true));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
    expect((await stored(user))[0].revisions[0].images).toHaveLength(2);
  });
});

/** Presses Tab (up to 80 times) until `reached` says the focus is where the test wants it. */
async function focusByTab(page: Page, reached: () => Promise<boolean>, fromStart = false) {
  if (fromStart) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press('Tab');
    if (await reached()) return;
  }
  throw new Error('The focus never reached the control.');
}

// ---------------------------------------------------------------------------------------------------
test.describe('accessibility, and the window it fits in', () => {
  for (const variant of variants) {
    test(`has no accessibility violation on the screen empty, with pictures and problems, on the Project page and on Change pictures, in ${variant.name}`, async ({page, context, baseURL}) => {
      await member(context, baseURL!, {locale: variant.locale, theme: variant.theme});
      await openNew(page, variant.locale);
      expect(await violations(page), 'empty').toEqual([]);
      await choose(page, [...views(3), {name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x')}]);
      await allReady(page, 3, variant.locale);
      await expect(page.locator('.picture-problems')).toBeVisible();
      expect(await violations(page), 'with pictures and a problem').toEqual([]);
      await saveAndLand(page, variant.locale);
      expect(await violations(page), 'the Project page').toEqual([]);
      await page.getByRole('link', {name: t(variant.locale, 'picture.section.change')}).click();
      await expect(heading(page)).toHaveText(t(variant.locale, 'picture.title.change'), crossing);
      await hydrated(page, 'main button[type="submit"]');
      expect(await violations(page), 'Change pictures').toEqual([]);
    });
  }

  test('has no violation with the camera on, with a failed upload and with an expired picture', async ({page, context, baseURL}) => {
    const { accountId } = await member(context, baseURL!);
    await openNew(page);
    await page.route('**/api/transfers/tickets', (route) => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"unavailable"}'}));
    await choose(page, [pictureFile('failing.png', palette[0])]);
    await expect(rowsOf(page).first().getByText(t('en', 'picture.upload.unavailable'))).toBeVisible(crossing);
    expect(await violations(page), 'a failed upload').toEqual([]);
    await page.unroute('**/api/transfers/tickets');
    await retryButton(rowsOf(page).first()).click();
    await allReady(page, 1);
    await saveAndLand(page);
    const projectId = new URL(page.url()).pathname.split('/').pop()!;
    const { rows } = await world.db.query('select upload_id from projects.request_images where account_id = $1', [accountId]);
    await world.db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [rows[0].upload_id]);
    await openChange(page, projectId);
    await expect(rowsOf(page).first().getByText(t('en', 'picture.item.expired'))).toBeVisible();
    expect(await violations(page), 'an expired picture').toEqual([]);
  });

  for (const locale of ['en', 'he'] as const) {
    test(`fits a 320 px window with the text at 200%, with pictures, a problem and a failure, in ${locale}`, async ({page, context, baseURL}) => {
      await member(context, baseURL!, {locale});
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      await openNew(page, locale);
      expect(await overflowReport(page), 'empty').toEqual({scroll: 0, clipped: []});
      await page.route('**/api/transfers/tickets', (route) => route.fulfill({status: 503, contentType: 'application/json', body: '{"error":"unavailable"}'}));
      await choose(page, [...views(2), {name: `${'long-'.repeat(20)}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x')}]);
      await expect(rowsOf(page).first().getByText(t(locale, 'picture.upload.unavailable'))).toBeVisible(crossing);
      await expect(page.locator('.picture-problems')).toBeVisible();
      await saveButton(page, locale).click();
      await expect(alerts(page).filter({hasText: t(locale, 'picture.set.failed')})).toBeVisible();
      expect(await overflowReport(page), 'pictures, a problem and a failure').toEqual({scroll: 0, clipped: []});
      await page.unroute('**/api/transfers/tickets');
      for (const row of await rowsOf(page).all()) await retryButton(row, locale).click();
      await expect(rowsOf(page).filter({hasText: t(locale, 'picture.item.ready')})).toHaveCount(2, crossing);
    });
  }

  test('keeps every control at least 44 px square on a phone', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    await choose(page, views(2));
    await allReady(page, 2);
    const small = await main(page).locator('button, label.btn, a.btn').evaluateAll((controls) =>
      controls.map((control) => ({name: control.textContent?.trim().slice(0, 30), box: control.getBoundingClientRect()})).filter(({box}) => box.width > 0 && (box.height < 43.5 || box.width < 43.5)).map(({name}) => name),
    );
    expect(small).toEqual([]);
  });
});


// ---------------------------------------------------------------------------------------------------
test.describe('the review patches', () => {
  const holdOpen = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    return {gate, release};
  };

  test('while a Save is out nothing can be added, moved, replaced or removed, and the screen is as it was when the answer comes back', async ({page, context, baseURL}) => {
    await withPictures(page, context, baseURL!, views(2));
    const {gate, release} = holdOpen();
    await page.route(`**${newPath}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await gate;
      return route.continue();
    });
    await saveButton(page).click();
    await expect(page.getByText(t('en', 'picture.save.pending'))).toBeVisible();
    await expect(chooser(page)).toBeDisabled();
    for (const [index, row] of (await rowsOf(page).all()).entries()) {
      for (const button of [moveButton(row, 'earlier', index + 1), moveButton(row, 'later', index + 1), rowButton(row, 'picture.item.replace'), rowButton(row, 'picture.item.remove')]) await expect(button).toBeDisabled();
    }
    await expect(takePhoto(page)).toBeDisabled();
    release();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/, crossing);
  });

  test('a command the database says was used for something else is forgotten: the next Save carries a different command ID', async ({page, context, baseURL}) => {
    const { user, accountId } = await withPictures(page, context, baseURL!, views(2));
    const projectId = await saveAndLand(page);
    // A rename receipt that holds a command ID this Account has used: a Save that carries it is `reused`.
    const used = randomUUID();
    await world.db.query(
      `insert into projects.project_commands (account_id, command_id, project_id, command, payload_hash, expected_revision, title, revision)
       values ($1, $2, $3, 'rename', $4, 1, 'A name', 2)`,
      [accountId, used, projectId, sha256Of(Buffer.from(used))],
    );
    await openChange(page, projectId);
    await moveButton(rowsOf(page).nth(0), 'later', 1).click();
    const sent: string[] = [];
    let swap = true;
    await page.route(`**${picturesPath(projectId)}`, async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.continue();
      const body = request.postDataBuffer()!.toString('latin1');
      const found = /(name="[^"]*commandId"\r\n\r\n)([0-9a-f-]{36})/.exec(body);
      expect(found, 'the command ID is in the form the Server Action receives').not.toBeNull();
      sent.push(found![2]);
      // The first Save is made to carry the used ID, as if the browser had picked it.
      return route.continue(swap ? {postData: Buffer.from(body.replace(found![2], used), 'latin1')} : {});
    });
    await saveButton(page).click();
    await expect(alerts(page).filter({hasText: t('en', 'picture.save.reused')})).toBeVisible(crossing);
    expect(await stored(user).then((projects) => projects[0].revisions)).toHaveLength(1);
    // The browser no longer keeps the command ID that was sent.
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('nova3d-request-commands') ?? '{}') as Record<string, {id: string}>);
    expect(Object.values(kept).map((entry) => entry.id)).not.toContain(sent[0]);
    swap = false;
    await saveButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${projectId}`, crossing);
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toBe(sent[0]);
    expect(sent[1]).not.toBe(used);
    expect((await stored(user))[0].revisions.map((revision) => revision.seq)).toEqual([1, 2]);
  });

  test('a replacement that is the same picture as another puts the original back in its place, with its upload and its preview, and says why', async ({page, context, baseURL}) => {
    const [a, b] = views(2);
    const { accountId } = await withPictures(page, context, baseURL!, [a, b]);
    const [chooserEvent] = await Promise.all([page.waitForEvent('filechooser'), rowButton(rowsOf(page).nth(1), 'picture.item.replace').click()]);
    await chooserEvent.setFiles({...a, name: 'copy-of-a.png'});
    await expect(page.locator('.picture-problems li')).toHaveText([fileProblemText('en', 'copy-of-a.png', 'duplicate')], crossing);
    // Two pictures, in the same order, the second still the second: nothing shifted, and nothing was given up.
    await expect(rowsOf(page)).toHaveCount(2);
    expect(await shownOrder(page)).toEqual([a, b].map((file) => sha256Of(file.buffer)));
    await expect(rowsOf(page).nth(1).getByText(t('en', 'picture.item.ready'))).toBeVisible();
    expect((await leaseOfFile(accountId, b))[0].state).toBe('complete');
    expect((await leaseOfFile(accountId, a)).map((lease) => lease.state)).toEqual(['complete']);
  });

  test('a saved picture whose replacement is the same as another keeps its slot', async ({page, context, baseURL}) => {
    const [a, b, c] = views(3);
    const { user } = await withPictures(page, context, baseURL!, [a, b, c]);
    const projectId = await saveAndLand(page);
    await openChange(page, projectId);
    const [chooserEvent] = await Promise.all([page.waitForEvent('filechooser'), rowButton(rowsOf(page).nth(1), 'picture.item.replace').click()]);
    await chooserEvent.setFiles({...c, name: 'copy-of-c.png'});
    await expect(page.locator('.picture-problems li')).toHaveText([fileProblemText('en', 'copy-of-c.png', 'duplicate')], crossing);
    await expect(rowsOf(page)).toHaveCount(3);
    await expect(rowsOf(page).nth(1).getByText(/Saved\. In private staging until/)).toBeVisible();
    await expect(rowsOf(page).nth(1).locator('h3')).toHaveText(t('en', 'picture.item.title', {position: 2, count: 3}).replace(/\u2068|\u2069/g, ''));
    // Saving it is the same set: nothing is recorded.
    await saveButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${projectId}`, crossing);
    expect((await stored(user))[0].revisions).toHaveLength(1);
  });

  test('a picture that the gateway found changed is hashed again before it is sent again; one that only lost its connection is not', async ({page, context, baseURL}) => {
    // What is hashed, by size: the page hashes other things of its own, so the picture's own hashing is counted by the length of what is hashed.
    await page.addInitScript(() => {
      (window as unknown as {__hashed: number[]}).__hashed = [];
      const original = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = ((algorithm: AlgorithmIdentifier, data: BufferSource) => {
        (window as unknown as {__hashed: number[]}).__hashed.push(data.byteLength);
        return original(algorithm, data);
      }) as SubtleCrypto['digest'];
    });
    const file = pictureFile('mutable.png', palette[2]);
    const digests = () => page.evaluate((size) => (window as unknown as {__hashed: number[]}).__hashed.filter((length) => length === size).length, file.buffer.length);
    await member(context, baseURL!);
    await openNew(page);
    const origin = new URL(baseURL!).origin;
    let mode: 'changed' | 'cut' | 'through' = 'changed';
    await page.route(/\/v1\/uploads\//, (route) => {
      if (mode === 'cut') return route.abort('connectionreset');
      if (mode === 'changed') {
        return route.fulfill({status: 400, contentType: 'application/json', headers: {'access-control-allow-origin': origin}, body: JSON.stringify({error: 'checksum_mismatch'})});
      }
      return route.continue();
    });
    await choose(page, [file]);
    const row = rowsOf(page).first();
    await expect(row.getByText(t('en', 'picture.upload.changed'))).toBeVisible(crossing);
    expect(await digests()).toBe(1);
    // Retry after "changed": the file is read and hashed again.
    mode = 'cut';
    await retryButton(row).click();
    await expect(row.getByText(t('en', 'picture.upload.network'))).toBeVisible(crossing);
    expect(await digests()).toBe(2);
    // Retry after a broken connection: the digest that was kept is used.
    mode = 'through';
    await retryButton(row).click();
    await allReady(page, 1);
    expect(await digests()).toBe(2);
  });

  test('uploads that are queued behind one that is on its way never start once the screen is left', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    const {gate, release} = holdOpen();
    let tickets = 0;
    let puts = 0;
    await page.route('**/api/transfers/tickets', (route) => {
      tickets += 1;
      return route.continue();
    });
    await page.route(/\/v1\/uploads\//, async (route) => {
      puts += 1;
      await gate;
      return route.abort('connectionreset');
    });
    await choose(page, views(3));
    await expect.poll(() => puts, crossing).toBe(1);
    // Leave by navigation inside the application (the screen is unmounted), then let the one that is out end.
    await page.getByRole('navigation', {name: t('en', 'a11y.mainNavigation')}).getByRole('link', {name: t('en', 'nav.projects')}).click();
    await expect(page).toHaveURL(/\/projects$/, crossing);
    release();
    await page.waitForTimeout(700);
    expect({tickets, puts}).toEqual({tickets: 1, puts: 1});
  });

  test('leaving the screen gives back what was staged and never saved, keeps what was saved, and the browser asks first while something is unsaved', async ({page, context, baseURL}) => {
    const files = views(2);
    const { accountId } = await withPictures(page, context, baseURL!, files);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    // A press, so the page has been used (a browser asks about leaving only a page the person has used).
    await moveButton(rowsOf(page).nth(0), 'later', 1).click();
    await page.close({runBeforeUnload: true});
    await expect.poll(() => dialogs, crossing).toEqual(['beforeunload']);
    expect(page.isClosed()).toBe(false);
    // Going elsewhere inside the application gives the uploads back (best effort, at once).
    await page.getByRole('navigation', {name: t('en', 'a11y.mainNavigation')}).getByRole('link', {name: t('en', 'nav.projects')}).click();
    await expect(page).toHaveURL(/\/projects$/, crossing);
    for (const file of files) await expect.poll(async () => (await leaseOfFile(accountId, file))[0]?.state, crossing).toBe('released');
    expect(await openQuota(accountId)).toBe(0);
  });

  test('saved pictures are never given back by leaving, and a screen with nothing unsaved does not ask', async ({page, context, baseURL}) => {
    const files = views(2);
    const { accountId } = await withPictures(page, context, baseURL!, files);
    const projectId = await saveAndLand(page);
    await openChange(page, projectId);
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await rowsOf(page).first().click();
    await page.getByRole('link', {name: t('en', 'picture.back')}).click();
    await expect(page).toHaveURL(`${baseURL}/projects/${projectId}`, crossing);
    await page.close({runBeforeUnload: true});
    await expect.poll(() => page.isClosed(), crossing).toBe(true);
    expect(dialogs).toEqual([]);
    for (const file of files) expect((await leaseOfFile(accountId, file))[0].state).toBe('complete');
  });

  test('previews show the whole picture in a frame of fixed size, load lazily, and a picture with no preview says why in visible words', async ({page, context, baseURL}) => {
    await withPictures(page, context, baseURL!, views(2));
    const style = await page.locator('.picture-thumb img').first().evaluate((image) => ({
      fit: getComputedStyle(image).objectFit,
      loading: image.getAttribute('loading'),
      decoding: image.getAttribute('decoding'),
      frame: [(image.parentElement as HTMLElement).getBoundingClientRect().width, (image.parentElement as HTMLElement).getBoundingClientRect().height],
    }));
    expect(style).toMatchObject({fit: 'contain', loading: 'lazy', decoding: 'async'});
    const frames = await page.locator('.picture-thumb').evaluateAll((frames) => frames.map((frame) => [frame.getBoundingClientRect().width, frame.getBoundingClientRect().height]));
    expect(frames[0]).toEqual(frames[1]);
  });

  test('says the lapse rule before Save, and that location data is kept, in both languages', async ({page, context, baseURL}) => {
    for (const locale of ['en', 'he'] as const) {
      await member(context, baseURL!, {locale});
      await openNew(page, locale);
      await expect(main(page).getByText(t(locale, 'picture.privacy'))).toBeVisible();
      await expect(main(page).getByText(t(locale, 'picture.save.note'))).toBeVisible();
      await expect(main(page).getByText(t(locale, 'picture.limits', {count: maxPictures, ...formatParams, size: formatBytes(maxPictureBytes), total: formatBytes(maxSetBytes)}))).toBeVisible();
    }
    expect(t('he', 'picture.limits', {count: 12, ...formatParams, size: '12 MiB', total: '60 MiB'})).toContain('או');
  });
});

test.describe('the camera, hardened (UX-DR9)', () => {
  test.use({permissions: ['camera']});

  test.beforeEach(async ({page}) => {
    // Counts the asks, keeps the constraints and the streams, and lets a test hold an answer back and release it by hand.
    await page.addInitScript(() => {
      type Spy = CameraSpy & {constraints: MediaStreamConstraints[]; release: (() => Promise<void>) | null; hold: boolean};
      const spy = {calls: 0, streams: [], constraints: [], release: null, hold: false} as Spy;
      (window as unknown as {__camera: Spy}).__camera = spy;
      const devices = navigator.mediaDevices;
      const original = devices.getUserMedia.bind(devices);
      devices.getUserMedia = (constraints) =>
        new Promise<MediaStream>((resolve, reject) => {
          spy.calls += 1;
          spy.constraints.push(constraints ?? {});
          const settle = async () => {
            try {
              const stream = await original(constraints);
              spy.streams.push(stream);
              resolve(stream);
            } catch (error) {
              reject(error);
            }
          };
          if (spy.hold) spy.release = settle;
          else void settle();
        });
    });
  });

  const hold = (page: Page) => page.evaluate(() => ((window as unknown as {__camera: {hold: boolean}}).__camera.hold = true));
  const release = (page: Page) => page.evaluate(() => (window as unknown as {__camera: {release: (() => Promise<void>) | null}}).__camera.release?.());
  const live = (page: Page) => page.locator('video.picture-video');

  test('asks for the rear camera, at 1920 by 1080 if it can, with no sound', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    await takePhoto(page).click();
    await expect(live(page)).toBeVisible(crossing);
    const constraints = await page.evaluate(() => (window as unknown as {__camera: {constraints: MediaStreamConstraints[]}}).__camera.constraints);
    expect(constraints).toEqual([{video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}, audio: false}]);
  });

  test('a second press of Capture while the frame is being made adds one picture, and a camera that goes by itself closes the preview with the failed notice', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await openNew(page);
    await takePhoto(page).click();
    await expect.poll(() => live(page).evaluate((element) => (element as HTMLVideoElement).videoWidth), crossing).toBeGreaterThan(0);
    await page.getByRole('button', {name: t('en', 'picture.camera.capture'), exact: true}).dblclick();
    await allReady(page, 1);
    expect(await tracksEnded(page)).toBe(true);
    // The device is lost while the preview is up (its track ends by itself: unplugged, or the permission taken back).
    await takePhoto(page).click();
    await expect(live(page)).toBeVisible(crossing);
    await page.evaluate(() => {
      const streams = (window as unknown as {__camera: CameraSpy}).__camera.streams;
      streams[streams.length - 1].getTracks()[0].dispatchEvent(new Event('ended'));
    });
    await expect(live(page)).toHaveCount(0);
    await expect(page.locator('.notice').filter({hasText: t('en', 'picture.camera.failed')})).toBeVisible();
    await expect(takePhoto(page)).toBeEnabled();
    await expect(rowsOf(page)).toHaveCount(1);
  });

  for (const how of ['Cancel', 'leaving the screen'] as const) {
    test(`a camera that answers after ${how} is stopped at once: every track ends and no preview appears`, async ({page, context, baseURL}) => {
      await member(context, baseURL!);
      await openNew(page);
      await hold(page);
      await takePhoto(page).click();
      await expect(page.getByText(t('en', 'picture.camera.asking'))).toBeVisible();
      if (how === 'Cancel') {
        await page.getByRole('button', {name: t('en', 'picture.camera.cancel'), exact: true}).click();
        await expect(page.getByText(t('en', 'picture.camera.asking'))).toHaveCount(0);
      } else {
        await page.getByRole('navigation', {name: t('en', 'a11y.mainNavigation')}).getByRole('link', {name: t('en', 'nav.projects')}).click();
        await expect(page).toHaveURL(/\/projects$/, crossing);
      }
      // Now the browser lets the camera go: the stream arrives at a screen that no longer wants it.
      await release(page);
      await expect.poll(() => tracksEnded(page), crossing).toBe(true);
      await expect(live(page)).toHaveCount(0);
      if (how === 'Cancel') await expect(takePhoto(page)).toBeEnabled();
    });
  }
});
