import {createHash} from 'node:crypto';
import {expect, test, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {translate, type Locale, type MessageKey} from '../../lib/i18n';
import {formatBytes} from '../../lib/picture-set';
import type {ViewLabel} from '../../lib/picture-quality';
import {readOrientation} from '../../workers/files/src/strip';
import {createS3Storage} from '../../workers/files/src/storage';
import {announcer, hydrated, label, overflowReport, setFontSize, signIn, variants, violations} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';
import {baselineJpeg, contains, gpsJpeg, gpsJpegOrientation, gpsMarker, markersIn, segmentsOfJpeg} from '../support/metadata-pictures';
import {MiB, palette, pngOfLength, sha256Of, sharpPng, sharpViews, type PictureFile} from '../support/pictures-world';
import {s3Of} from '../support/stack';

// Story 2.12: retain the confirmed pictures as immutable Project artifacts, in a real browser against the production build, the local Supabase stack and the REAL file
// gateway (another origin). Confirm now KEEPS the pictures first (a read-only pre-check, then the gateway's signed attach with the transform that strips every metadata
// segment but the EXIF orientation) and records the review only when every picture is kept, so a failure confirms nothing and a retry is safe. These flows are the
// wiring, for real: the retained object is read out of the local Storage and shown to hold no location data; the pins are read out of the database; a reload reads the
// pictures back from their retained roots with no staging read; every refusal is its own message with its remedy, in both languages, on a phone and a desktop. The strip
// is held at length by tests/unit/strip.test.ts, the database half by tests/integration/retained-pictures.test.ts, the gateway half by
// tests/integration/file-gateway.test.ts and tests/unit/gateway-server.test.ts.
//
// Fixtures: a picture that is CONFIRMED goes through the real strip, which refuses what it cannot parse, so these are real decodable files: PNGs
// (tests/support/pictures-world.ts) and a JPEG that carries GPS EXIF and an orientation (tests/support/metadata-pictures.ts). Everything staged or kept is taken out of
// Storage afterwards with the stack's own key.

test.describe.configure({timeout: 150_000});

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
    const kept = await world.db.query(`select account_id, root from artifacts.manifests where account_id = any($1) and body not like 'kept %'`, [accounts]);
    for (const row of kept.rows) await storage.delete(`objects/${row.account_id}/${row.root}`).catch(() => undefined);
  } finally {
    await world.close();
  }
});

type Options = {locale?: Locale; theme?: 'light' | 'dark'};

async function member(context: BrowserContext, baseURL: string, options: Options = {}) {
  const user = await world.signedInUser();
  await world.activate(user);
  await signIn(context, baseURL, user, {locale: options.locale ?? 'en', theme: options.theme ?? 'light'});
  const account = await world.accountOf(user);
  accounts.push(account.id as string);
  return {user, accountId: account.id as string};
}

const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const crossing = {timeout: 40_000};
const newPath = '/projects/new/pictures';
const reviewPath = (projectId: string) => `/projects/${projectId}/pictures/review`;
const picturesPath = (projectId: string) => `/projects/${projectId}/pictures`;
const heading = (page: Page) => page.getByRole('heading', {level: 1});
const main = (page: Page) => page.getByRole('main');
const itemsOf = (page: Page) => page.locator('.review-item');
const chooser = (page: Page) => page.locator('input[type="file"][multiple]');
const alerts = (page: Page) => page.locator('.notice[role="alert"]');
const nextButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'review.next'), exact: true});
const obstructionBox = (page: Page, locale: Locale = 'en') => page.getByRole('checkbox', {name: t(locale, 'review.obstruction.label')});
const pathRadio = (page: Page, mode: 'image_direct' | 'evidence_images') => page.locator(`input[name="path"][value="${mode}"]`);
const confirmButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'review.confirm.button'), exact: true});
const saveChoiceButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'review.confirm.save'), exact: true});
const labelSelect = (page: Page, position: number, locale: Locale = 'en') => page.getByLabel(t(locale, 'review.picture.label', {position}), {exact: true});
const retainingStatus = (page: Page) => page.locator('[role="status"][data-phase="retaining"]');
const failureNotice = (page: Page) => page.locator('form.review-confirm .invite-notice[tabindex="-1"]');
const textOf = async (locator: Locator) => ((await locator.innerText()) ?? '').replace(/\s+/g, ' ').trim();
const plain = (value: string) => value.replace(/[⁦-⁩]/g, '');
const rowButton = (row: Locator, key: MessageKey, locale: Locale = 'en') => row.getByRole('button', {name: new RegExp(`^${t(locale, key)}`)});

// What a person does ------------------------------------------------------------------------------------------------------

const storage = () => createS3Storage(s3Of(world.stack));

async function readObject(key: string): Promise<Buffer> {
  const object = await storage().get(key, null);
  const parts: Buffer[] = [];
  for await (const part of object.body) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}
async function putObject(key: string, bytes: Buffer, contentType: string) {
  await storage().put(
    key,
    (async function* () {
      yield bytes;
    })(),
    {contentType},
  );
}
const stagingKey = (accountId: string, uploadId: string) => `staging/${accountId}/${uploadId}`;
const objectKey = (accountId: string, root: string) => `objects/${accountId}/${root}`;

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

async function openReviewFromProject(page: Page, locale: Locale = 'en') {
  await page.getByRole('link', {name: t(locale, 'review.section.review'), exact: true}).click();
  await expect(heading(page)).toHaveText(t(locale, 'review.title.check'), crossing);
  await hydrated(page, 'main button');
}
async function openReview(page: Page, projectId: string, locale: Locale = 'en') {
  const response = await page.goto(reviewPath(projectId));
  expect(response?.status(), reviewPath(projectId)).toBe(200);
  await expect(heading(page)).toHaveText(t(locale, 'review.title.check'), crossing);
  await hydrated(page, 'main button');
}
async function measured(page: Page) {
  await expect(page.locator('.review-item[data-state="measuring"]')).toHaveCount(0, {timeout: 60_000});
}
async function labelAll(page: Page, labels: ViewLabel[], locale: Locale = 'en') {
  for (const [index, value] of labels.entries()) await labelSelect(page, index + 1, locale).selectOption(value);
}
const threeViews: ViewLabel[] = ['front', 'left', 'top'];

/** The review from its first step to the last: every picture measured, labelled, the obstruction question confirmed, a path chosen. The Confirm button is then there. */
async function toLastStep(page: Page, mode: 'image_direct' | 'evidence_images', locale: Locale = 'en', labels: ViewLabel[] = threeViews) {
  await measured(page);
  await labelAll(page, labels, locale);
  await obstructionBox(page, locale).check();
  await nextButton(page, locale).click();
  await expect(heading(page)).toHaveText(t(locale, 'review.title.choose'));
  await pathRadio(page, mode).check();
  await nextButton(page, locale).click();
  await expect(heading(page)).toHaveText(t(locale, mode === 'image_direct' ? 'review.title.confirmDirect' : 'review.title.confirmResearch'));
}
/** The button that confirms on the last step: Confirm for a direct request, Save my choice for research-assisted. */
const finalButton = (page: Page, mode: 'image_direct' | 'evidence_images', locale: Locale = 'en') => (mode === 'image_direct' ? confirmButton(page, locale) : saveChoiceButton(page, locale));

/** A project reviewed from the picture screen's own Files and confirmed. */
async function retainedProject(page: Page, context: BrowserContext, baseURL: string, files: PictureFile[], mode: 'image_direct' | 'evidence_images', options: Options = {}) {
  const locale = options.locale ?? 'en';
  const who = await savedPictures(page, context, baseURL, files, options);
  await openReviewFromProject(page, locale);
  await toLastStep(page, mode, locale);
  await finalButton(page, mode, locale).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
  return who;
}

// What the database and Storage hold ------------------------------------------------------------------------------------------

type Pin = {position: number; upload_id: string; sha256: string; retained_root: string | null; retained_sha256: string | null; retained_length: number | null};
async function latestPins(projectId: string): Promise<Pin[]> {
  return (
    await world.db.query(
      `select i.position, i.upload_id, i.sha256, i.retained_root, i.retained_sha256, i.retained_length
         from projects.request_images i join projects.request_revisions r on r.id = i.revision_id
        where r.project_id = $1 and r.seq = (select max(seq) from projects.request_revisions where project_id = $1) order by i.position`,
      [projectId],
    )
  ).rows as Pin[];
}
async function projectOf(projectId: string) {
  const project = (await world.db.query('select stage, revision::int as revision from projects.projects where id = $1', [projectId])).rows[0] as {stage: string; revision: number};
  const revisions = (await world.db.query('select seq, mode, confirmed_at is not null as confirmed, obstruction_confirmed_at is not null as reviewed from projects.request_revisions where project_id = $1 order by seq', [projectId])).rows as {
    seq: number;
    mode: string;
    confirmed: boolean;
    reviewed: boolean;
  }[];
  return {...project, revisions};
}
type Manifest = {root: string; upload_id: string; kind: string; digest: string; length: number; activity: string; created_at: Date};
const manifestsOf = async (accountId: string) =>
  (await world.db.query(`select root, upload_id, kind, digest, length::int as length, activity, created_at from artifacts.manifests where account_id = $1 and body not like 'kept %' order by created_at, upload_id`, [accountId])).rows as Manifest[];
const leaseOf = async (uploadId: string) =>
  (await world.db.query('select state, expires_at <= now() as expired, expires_at from artifacts.staging_leases where id = $1', [uploadId])).rows[0] as {state: string; expired: boolean; expires_at: Date};
const attachCommands = async (accountId: string) =>
  Number((await world.db.query(`select count(*) as n from artifacts.ticket_redemptions where account_id = $1 and typ = 'command' and target_kind = 'attach'`, [accountId])).rows[0].n);

const attachCommandsFor = async (uploadId: string) =>
  Number((await world.db.query(`select count(*) as n from artifacts.ticket_redemptions where typ = 'command' and target_kind = 'attach' and target_id = $1`, [uploadId])).rows[0].n);

/** The staged copies are gone, as after the hourly cleanup: the leases released and deleted, the objects removed. */
async function cleanUpStaging(accountId: string, uploadIds: string[]) {
  for (const id of uploadIds) {
    await world.db.query(`update artifacts.staging_leases set state = 'released' where id = $1 and state in ('complete', 'attached')`, [id]);
    await world.db.query(`update artifacts.staging_leases set state = 'deleted' where id = $1 and state = 'released'`, [id]);
    await storage().deletePrefix(stagingKey(accountId, id)).catch(() => 0);
  }
}

/**
 * Every pin of the latest revision against what is really kept: the staged digest beside a retained digest that is not it, the manifest of that root, the object in
 * Storage with exactly that digest and length, and the staged lease attached and expiring.
 */
async function expectKept(projectId: string, accountId: string, files: PictureFile[]) {
  const pins = await latestPins(projectId);
  expect(pins).toHaveLength(files.length);
  const manifests = await manifestsOf(accountId);
  const retained: {file: PictureFile; bytes: Buffer}[] = [];
  for (const [index, pin] of pins.entries()) {
    const file = files[index];
    expect(pin.position).toBe(index + 1);
    expect(pin.sha256, `staged digest ${index + 1}`).toBe(sha256Of(file.buffer));
    expect(pin.retained_root, `root ${index + 1}`).toMatch(/^[0-9a-f]{64}$/);
    expect(pin.retained_sha256, `retained digest ${index + 1}`).toMatch(/^[0-9a-f]{64}$/);
    const manifest = manifests.find((entry) => entry.upload_id === pin.upload_id)!;
    expect(manifest, `manifest ${index + 1}`).toMatchObject({root: pin.retained_root, kind: 'picture', digest: pin.retained_sha256, length: pin.retained_length, activity: 'upload:strip-picture-metadata'});
    const bytes = await readObject(objectKey(accountId, pin.retained_root!));
    expect(sha256Of(bytes), `the object of ${index + 1}`).toBe(pin.retained_sha256);
    expect(bytes.length).toBe(pin.retained_length);
    // The staged copy is the person's original until the cleanup removes it, and it is already expiring.
    const staged = await readObject(stagingKey(accountId, pin.upload_id));
    expect(staged.equals(file.buffer)).toBe(true);
    const lease = await leaseOf(pin.upload_id);
    expect(lease, `lease ${index + 1}`).toMatchObject({state: 'attached', expired: true});
    retained.push({file, bytes});
  }
  expect(new Set(pins.map((pin) => pin.upload_id)).size).toBe(files.length);
  return {pins, retained};
}

// What the browser asks for ------------------------------------------------------------------------------------------------

/** Everything a page shows or asks for, kept to be scanned afterwards: request addresses, console messages, documents and action answers, the download tickets and GETs. */
function watchTraffic(page: Page) {
  const urls: string[] = [];
  const messages: string[] = [];
  const bodies: string[] = [];
  const tickets: string[] = [];
  const gets: string[] = [];
  page.on('request', (request) => {
    urls.push(request.url());
    if (request.method() === 'POST' && request.url().endsWith('/api/transfers/tickets') && (request.postData() ?? '').includes('"download"')) tickets.push(request.postData() ?? '');
    if (request.method() === 'GET' && /\/v1\/files\//.test(request.url())) gets.push(request.url());
  });
  page.on('console', (message) => messages.push(message.text()));
  page.on('response', (response) => {
    const type = response.headers()['content-type'] ?? '';
    if (!/html|x-component/.test(type)) return;
    void response.text().then((text) => bodies.push(text), () => undefined);
  });
  return {urls, messages, bodies, tickets, gets};
}
type Traffic = ReturnType<typeof watchTraffic>;

/**
 * Delays the first Server Action of each kind named, so a state that lasts only as long as the action can be seen (and its announcement read): `retain` is the keeping of
 * the pictures (the first action of a Confirm, which has no command ID in it) and `record` is the recording of the review (the second, which carries the command ID). One
 * handler serves both, because a route that continues ends the handling and a second handler on the same address would never see what the first let through.
 */
async function slowActions(page: Page, delays: {retain?: number; record?: number}) {
  const spent = {retain: false, record: false};
  await page.route(/\/pictures\/review$/, async (route, request) => {
    if (request.method() === 'POST' && request.headers()['next-action'] !== undefined) {
      const kind = (request.postData() ?? '').includes('commandId') ? 'record' : 'retain';
      const milliseconds = delays[kind];
      if (milliseconds !== undefined && !spent[kind]) {
        spent[kind] = true;
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
      }
    }
    await route.continue();
  });
}
/** Delays the keeping of the pictures (the first Server Action of a Confirm, which has no command ID in it) so the "keeping" state can be seen. */
const slowRetain = (page: Page, milliseconds: number) => slowActions(page, {retain: milliseconds});
/** Drops the first Server Action of one kind (`retain`: no command ID; `record`: the one that carries it) before it reaches the application, as a connection that fails. */
async function dropAction(page: Page, kind: 'retain' | 'record') {
  let dropped = false;
  await page.route(/\/pictures\/review$/, async (route, request) => {
    const isAction = request.method() === 'POST' && request.headers()['next-action'] !== undefined;
    const isRecord = isAction && (request.postData() ?? '').includes('commandId');
    if (!dropped && isAction && (kind === 'record') === isRecord) {
      dropped = true;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
}

const failureOf = async (page: Page, locale: Locale, key: MessageKey, params: Record<string, string | number> = {}) => {
  await expect(alerts(page).filter({hasText: t(locale, key, params).slice(0, 40)})).toBeVisible(crossing);
  expect(plain(await textOf(failureNotice(page)))).toBe(plain(t(locale, key, params).replace(/\s+/g, ' ').trim()));
  await expect(failureNotice(page)).toBeFocused();
};

const gpsFile = (): PictureFile => ({name: 'gps.jpg', mimeType: 'image/jpeg', buffer: gpsJpeg({width: 1200, height: 900})});
const threeFiles = (): PictureFile[] => [gpsFile(), {name: 'two.png', mimeType: 'image/png', buffer: sharpPng(1200, 900, 22, 3)}, {name: 'three.png', mimeType: 'image/png', buffer: sharpPng(1200, 900, 26, 6)}];

// ---------------------------------------------------------------------------------------------------
test.describe('Confirm keeps the pictures privately before it records anything (AC-1, AC-4)', () => {
  test('research-assisted: shows the keeping, then the Project; the pins are the manifests\' in order beside the staged digests; the kept copy has no location and keeps its orientation; the staged copies expire', async ({page, context, baseURL}) => {
    const files = threeFiles();
    expect(contains(files[0].buffer, gpsMarker)).toBe(true);
    const who = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await toLastStep(page, 'evidence_images');
    // The kept copy removes location data and other metadata, and the page says so before the person confirms.
    await expect(page.locator('[data-note="kept"]')).toContainText(t('en', 'review.confirm.keptNote'));

    await slowActions(page, {retain: 1500, record: 1500});
    await saveChoiceButton(page).click();
    // The count of pictures being kept, in the status line and announced, with Confirm unavailable meanwhile; then the review is recorded and the Project opens.
    await expect(retainingStatus(page)).toHaveText(t('en', 'review.confirm.retaining', {count: 3}), crossing);
    await expect(announcer(page)).toHaveText(t('en', 'review.announce.retaining'), crossing);
    await expect(saveChoiceButton(page)).toHaveAttribute('aria-disabled', 'true');
    // Once every picture is kept the review is being recorded, and the live region says so (the recording is held for the same time as the keeping, to be read).
    await expect(announcer(page)).toHaveText(t('en', 'review.announce.saving'), crossing);
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);

    const project = await projectOf(who.projectId);
    expect(project).toMatchObject({stage: 'request_draft', revision: 2});
    expect(project.revisions.map((revision) => [revision.seq, revision.mode, revision.confirmed, revision.reviewed])).toEqual([
      [1, 'evidence_images', false, false],
      [2, 'evidence_images', false, true],
    ]);
    const { retained } = await expectKept(who.projectId, who.accountId, files);
    expect(await manifestsOf(who.accountId)).toHaveLength(3);
    // The JPEG had a location and an orientation: the kept copy has no location, and the orientation is the only thing of the camera's data that is left.
    const [gps, plainOne, plainTwo] = retained;
    expect(markersIn(gps.bytes)).toEqual([]);
    expect(contains(gps.bytes, gpsMarker)).toBe(false);
    expect(readOrientation('image/jpeg', gps.file.buffer)).toBe(gpsJpegOrientation);
    expect(readOrientation('image/jpeg', gps.bytes)).toBe(gpsJpegOrientation);
    expect(sha256Of(gps.bytes)).not.toBe(sha256Of(gps.file.buffer));
    // A picture with nothing to remove is kept byte for byte (the strip is lossless and removes metadata only).
    for (const entry of [plainOne, plainTwo]) expect(entry.bytes.equals(entry.file.buffer)).toBe(true);

    // The Project page says every picture is kept privately with this request, not that its staged copy lapses.
    const section = page.getByRole('region', {name: t('en', 'request.section.title'), exact: true});
    await expect(section.locator('[data-kept="true"]')).toHaveCount(3);
    for (const line of await section.locator('[data-kept="true"]').all()) await expect(line).toHaveText(t('en', 'picture.section.kept'));
    await expect(section).toContainText(t('en', 'picture.section.noteKept'));
    // ... and not the staging line of a picture that is only staged ("Kept privately until <time>"), nor the warning of an expired copy.
    await expect(section).not.toContainText('Kept privately until');
    await expect(section.getByText(t('en', 'picture.section.unavailable'))).toHaveCount(0);
  });

  test('direct, in Hebrew: Confirm keeps the pictures and confirms the request; the Project page says it in Hebrew; the pins are in order', async ({page, context, baseURL}) => {
    const files = sharpViews(3);
    const who = await savedPictures(page, context, baseURL!, files, {locale: 'he'});
    await openReviewFromProject(page, 'he');
    await toLastStep(page, 'image_direct', 'he');
    // Pictures that are not kept yet lapse, and Confirm keeps them: both are said before Confirm, in Hebrew.
    await expect(page.locator('[data-note="lapse"]')).toHaveText(t('he', 'review.confirm.lapseNote'));
    await expect(page.locator('[data-note="kept"]')).toHaveText(t('he', 'review.confirm.keptNote'));
    await slowActions(page, {retain: 1500, record: 1500});
    await confirmButton(page, 'he').click();
    // The live region says it in Hebrew: first that the pictures are being kept, then that the review is being recorded.
    await expect(announcer(page)).toHaveText(t('he', 'review.announce.retaining'), crossing);
    await expect(announcer(page)).toHaveText(t('he', 'review.announce.saving'), crossing);
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
    const project = await projectOf(who.projectId);
    expect(project).toMatchObject({stage: 'request_confirmed', revision: 2});
    expect(project.revisions.map((revision) => [revision.seq, revision.mode, revision.confirmed])).toEqual([
      [1, 'evidence_images', false],
      [2, 'image_direct', true],
    ]);
    await expectKept(who.projectId, who.accountId, files);
    const section = page.getByRole('region', {name: t('he', 'request.section.title'), exact: true});
    await expect(section.locator('[data-kept="true"]')).toHaveCount(3);
    for (const line of await section.locator('[data-kept="true"]').all()) await expect(line).toHaveText(t('he', 'picture.section.kept'));
    await expect(section.getByText(t('he', 'picture.section.unavailable'))).toHaveCount(0);
  });

  test('is the same Confirm twice: a double press records one revision, three manifests and three attaches', async ({page, context, baseURL}) => {
    const who = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await toLastStep(page, 'image_direct');
    await confirmButton(page).dblclick();
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
    const project = await projectOf(who.projectId);
    expect(project.revisions.map((revision) => revision.seq)).toEqual([1, 2]);
    expect(await manifestsOf(who.accountId)).toHaveLength(3);
    expect(await attachCommands(who.accountId)).toBe(3);
  });

  test('keeps nothing twice when the answer of the record is lost: Confirm again finds every picture kept, attaches nothing, and records one revision with the same roots', async ({page, context, baseURL}) => {
    const files = sharpViews(3);
    const who = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await toLastStep(page, 'evidence_images');
    await dropAction(page, 'record');
    await saveChoiceButton(page).click();
    // The pictures were kept, the record never arrived: the person is told it may or may not be recorded, and nothing is confirmed.
    await failureOf(page, 'en', 'review.confirm.unknown');
    const first = await manifestsOf(who.accountId);
    expect(first).toHaveLength(3);
    expect(await attachCommands(who.accountId)).toBe(3);
    expect((await projectOf(who.projectId)).revisions).toHaveLength(1);

    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
    const second = await manifestsOf(who.accountId);
    // The same artifacts: no duplicate, the same roots made at the same time, and no attach was sent the second time.
    expect(second.map((manifest) => [manifest.root, manifest.created_at.getTime()])).toEqual(first.map((manifest) => [manifest.root, manifest.created_at.getTime()]));
    expect(await attachCommands(who.accountId)).toBe(3);
    expect((await projectOf(who.projectId)).revisions.map((revision) => revision.seq)).toEqual([1, 2]);
    // The pins are those roots, in the person's order (the manifests were made in parallel, so their own order is not the pictures').
    const rootOf = new Map(first.map((manifest) => [manifest.upload_id, manifest.root]));
    expect((await latestPins(who.projectId)).map((pin) => pin.retained_root)).toEqual((await latestPins(who.projectId)).map((pin) => rootOf.get(pin.upload_id)));
    await expectKept(who.projectId, who.accountId, files);
  });

  test('says the private store did not answer when the keeping fails to arrive: nothing is confirmed, nothing is kept, and the retry succeeds', async ({page, context, baseURL}) => {
    const files = sharpViews(3);
    const who = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await toLastStep(page, 'image_direct');
    await dropAction(page, 'retain');
    await confirmButton(page).click();
    await failureOf(page, 'en', 'review.confirm.retainUnavailable');
    // The message says what to do, and the Project is as it was.
    expect(await textOf(failureNotice(page))).toContain('Nothing was confirmed. Try again');
    expect(await projectOf(who.projectId)).toMatchObject({stage: 'request_draft', revision: 1});
    expect(await manifestsOf(who.accountId)).toEqual([]);
    await confirmButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
    expect(await projectOf(who.projectId)).toMatchObject({stage: 'request_confirmed'});
    await expectKept(who.projectId, who.accountId, files);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('reading the pictures back from their retained roots (AC-3)', () => {
  test('a reload after the staged copies are gone shows every picture again, measured, from the retained roots only: tickets of the kind retained, no staging read; the lapse is not said', async ({page, context, baseURL}) => {
    const files = threeFiles();
    const traffic = watchTraffic(page);
    const who = await retainedProject(page, context, baseURL!, files, 'evidence_images');
    const pins = await latestPins(who.projectId);
    await cleanUpStaging(who.accountId, pins.map((pin) => pin.upload_id));
    for (const pin of pins) expect(await storage().get(stagingKey(who.accountId, pin.upload_id), null).then(() => true, () => false)).toBe(false);

    traffic.tickets.length = 0;
    traffic.gets.length = 0;
    await openReview(page, who.projectId);
    await measured(page);
    await expect(page.locator('.review-item[data-state="measured"]')).toHaveCount(3);
    await expect(page.locator('.review-item[data-state="unusable"]')).toHaveCount(0);
    // A thumbnail of each, made in the browser from the retained copy.
    await expect(itemsOf(page).locator('img')).toHaveCount(3);
    // The labels of the review are there.
    await expect(labelSelect(page, 1)).toHaveValue('front');
    await expect(labelSelect(page, 3)).toHaveValue('top');
    // Exactly the retained pictures were asked for: a ticket each of the kind retained, a GET each at the retained path, and nothing of staging.
    expect(traffic.tickets).toHaveLength(3);
    for (const [index, body] of traffic.tickets.entries()) expect(JSON.parse(body)).toEqual({direction: 'download', kind: 'retained', id: pins[index].upload_id});
    expect(traffic.gets.sort()).toEqual(pins.map((pin) => `${new URL(traffic.gets[0]).origin}/v1/files/retained/${pin.upload_id}`).sort());
    expect(traffic.gets.some((url) => url.includes('/v1/files/staging/'))).toBe(false);

    // On the last step the lapse of private copies is not said (every picture is kept), and what is kept is.
    await labelAll(page, threeViews);
    await obstructionBox(page).check();
    await nextButton(page).click();
    await pathRadio(page, 'evidence_images').check();
    await nextButton(page).click();
    await expect(page.locator('[data-note="kept"]')).toBeVisible();
    await expect(page.locator('[data-note="lapse"]')).toHaveCount(0);
  });

  test('a confirmed direct request can be reviewed again after its staged copies lapsed: the pictures come back, and the same review records nothing new', async ({page, context, baseURL}) => {
    const files = sharpViews(3);
    const who = await retainedProject(page, context, baseURL!, files, 'image_direct');
    const pins = await latestPins(who.projectId);
    await cleanUpStaging(who.accountId, pins.map((pin) => pin.upload_id));
    const traffic = watchTraffic(page);
    await openReview(page, who.projectId);
    await measured(page);
    await expect(page.locator('.review-item[data-state="measured"]')).toHaveCount(3);
    expect(traffic.gets.every((url) => url.includes('/v1/files/retained/'))).toBe(true);
    expect(traffic.gets).toHaveLength(3);
    // Nothing leads to a locked screen, and nothing says a copy lapsed.
    await expect(main(page).locator(`a[href="${picturesPath(who.projectId)}"]`)).toHaveCount(0);
    await expect(main(page)).not.toContainText(t('en', 'review.unusable.lapsed'));
    await obstructionBox(page).check();
    await nextButton(page).click();
    await pathRadio(page, 'image_direct').check();
    await nextButton(page).click();
    // Every picture is kept: what is kept is said, and the lapse of private copies is not.
    await expect(page.locator('[data-note="kept"]')).toBeVisible();
    await expect(page.locator('[data-note="lapse"]')).toHaveCount(0);
    await confirmButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
    // The latest revision already held exactly this review with these pins: nothing is recorded, and nothing is attached again.
    expect((await projectOf(who.projectId)).revisions.map((revision) => revision.seq)).toEqual([1, 2]);
    expect(await manifestsOf(who.accountId)).toHaveLength(3);
    expect(await attachCommands(who.accountId)).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('what stops the keeping, and what the person is told (AC-2)', () => {
  test('changed bytes: names the picture and says to add it again; nothing is confirmed or published for it; replacing it on the picture screen lets Confirm succeed without keeping the others twice', async ({page, context, baseURL}) => {
    const files = sharpViews(3);
    const who = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await toLastStep(page, 'evidence_images');
    const uploads = (await latestPins(who.projectId)).map((pin) => pin.upload_id);
    // The staged copy of picture 2 is replaced by other bytes after the review was measured.
    await putObject(stagingKey(who.accountId, uploads[1]), sharpPng(1200, 900, 40, 11), 'image/png');
    await saveChoiceButton(page).click();
    await failureOf(page, 'en', 'review.confirm.bytesChanged', {position: 2});
    expect(await textOf(failureNotice(page))).toContain('add it again');
    await expect(heading(page)).toHaveText(t('en', 'review.title.confirmResearch'));
    // Nothing is confirmed or recorded, and nothing is published for the picture that changed (the others may be kept, for the retry).
    expect(await projectOf(who.projectId)).toMatchObject({stage: 'request_draft', revision: 1});
    expect((await projectOf(who.projectId)).revisions).toHaveLength(1);
    const kept = await manifestsOf(who.accountId);
    expect(kept.some((manifest) => manifest.upload_id === uploads[1])).toBe(false);
    expect(kept.map((manifest) => manifest.upload_id).sort()).toEqual([uploads[0], uploads[2]].sort());
    expect((await leaseOf(uploads[1])).state).toBe('complete');

    // The remedy: the picture screen. Replace picture 2 with a new file and save; the kept pictures carry their pins into the successor.
    const before = kept.map((manifest) => [manifest.upload_id, manifest.root, manifest.created_at.getTime()]);
    await page.goto(picturesPath(who.projectId));
    await expect(heading(page)).toHaveText(t('en', 'picture.title.change'));
    await hydrated(page, 'main button[type="submit"]');
    const rows = page.locator('.picture-item');
    await expect(rows).toHaveCount(3);
    const [replaceChooser] = await Promise.all([page.waitForEvent('filechooser'), rowButton(rows.nth(1), 'picture.item.replace').click()]);
    const replacement: PictureFile = {name: 'again.png', mimeType: 'image/png', buffer: sharpPng(1200, 900, 34, 9)};
    await replaceChooser.setFiles(replacement);
    await expect(rows.nth(1).getByText(t('en', 'picture.item.ready'))).toBeVisible(crossing);
    await page.getByRole('button', {name: t('en', 'picture.save'), exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
    expect((await latestPins(who.projectId)).map((pin) => pin.retained_root !== null)).toEqual([true, false, true]);
    const section = page.getByRole('region', {name: t('en', 'request.section.title'), exact: true});
    await expect(section.locator('[data-kept="true"]')).toHaveCount(2);

    // Review again and Confirm: the kept pictures are not kept twice, the new one is.
    await openReviewFromProject(page);
    await toLastStep(page, 'evidence_images');
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
    const after = await manifestsOf(who.accountId);
    expect(after).toHaveLength(3);
    for (const [uploadId, root, createdAt] of before) {
      const same = after.find((manifest) => manifest.upload_id === uploadId)!;
      expect([same.root, same.created_at.getTime()]).toEqual([root, createdAt]);
    }
    // The first attempt sent three attaches (one refused); the second sent one, for the new picture only: the kept ones were not attached again.
    expect(await attachCommands(who.accountId)).toBe(4);
    for (const uploadId of [uploads[0], uploads[2]]) expect(await attachCommandsFor(uploadId)).toBe(1);
    expect(await attachCommandsFor(uploads[1])).toBe(1);
    await expectKept(who.projectId, who.accountId, [files[0], replacement, files[2]]);
    await expect(section.locator('[data-kept="true"]')).toHaveCount(3);
  });

  test('an expired copy with no kept copy: the message names the picture and says to replace it on the picture screen; nothing is confirmed', async ({page, context, baseURL}) => {
    const who = await savedPictures(page, context, baseURL!, sharpViews(3));
    await openReviewFromProject(page);
    await toLastStep(page, 'image_direct');
    const uploads = (await latestPins(who.projectId)).map((pin) => pin.upload_id);
    await world.db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [uploads[1]]);
    await confirmButton(page).click();
    await failureOf(page, 'en', 'review.confirm.expiredUpload', {position: 2});
    expect(await textOf(failureNotice(page))).toContain('Replace it on the pictures screen');
    expect(await projectOf(who.projectId)).toMatchObject({stage: 'request_draft', revision: 1});
    expect(await manifestsOf(who.accountId)).toEqual([]);
    expect(await attachCommands(who.accountId)).toBe(0);
  });

  test('a picture that cannot be read well enough to strip is refused, never kept unstripped: the message says to replace it; nothing is confirmed and nothing is published for it', async ({page, context, baseURL}) => {
    // A JPEG with three stray bytes between its segments: a browser skips them, decodes the picture and the review measures it; the strip does not guess what
    // they are, refuses the picture as damaged, and never keeps it as it is.
    const whole = baselineJpeg({width: 1200, height: 900, seed: 3});
    const at = segmentsOfJpeg(whole)[2].offset;
    const damaged = Buffer.concat([whole.subarray(0, at), Buffer.from([0x11, 0x22, 0x33]), whole.subarray(at)]);
    const files: PictureFile[] = [
      {name: 'one.png', mimeType: 'image/png', buffer: sharpPng(1200, 900, 22, 3)},
      {name: 'damaged.jpg', mimeType: 'image/jpeg', buffer: damaged},
      {name: 'three.png', mimeType: 'image/png', buffer: sharpPng(1200, 900, 26, 6)},
    ];
    const who = await savedPictures(page, context, baseURL!, files);
    await openReviewFromProject(page);
    await toLastStep(page, 'evidence_images');
    await saveChoiceButton(page).click();
    await failureOf(page, 'en', 'review.confirm.stripFailed', {position: 2});
    expect(await textOf(failureNotice(page))).toContain('Replace it on the pictures screen');
    expect(await projectOf(who.projectId)).toMatchObject({stage: 'request_draft', revision: 1});
    const uploads = (await latestPins(who.projectId)).map((pin) => pin.upload_id);
    expect((await manifestsOf(who.accountId)).some((manifest) => manifest.upload_id === uploads[1])).toBe(false);
    expect((await leaseOf(uploads[1])).state).toBe('complete');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the retained-picture quota of 2 GiB rejects the whole confirmation (AC-4)', () => {
  const quota = 2 * 1024 * MiB;
  /** A manifest of an upload that never existed, inserted by the database's owner, to set what the Account already keeps. */
  async function keep(accountId: string, bytes: number) {
    const body = `kept ${accountId} ${bytes}`;
    const id = (await world.db.query('select gen_random_uuid() as id')).rows[0].id as string;
    await world.db.query(
      `insert into artifacts.manifests (root, id, account_id, upload_id, kind, digest, length, serialization, activity, body)
       values (encode(sha256(convert_to($1, 'UTF8')), 'hex'), $2, $3, $2, 'picture', encode(sha256(convert_to($1 || 'x', 'UTF8')), 'hex'), $4, 1, 'upload:strip-picture-metadata', $1)`,
      [body, id, accountId, bytes],
    );
  }
  const bigSet = (): PictureFile[] => [{name: 'big.png', mimeType: 'image/png', buffer: pngOfLength(palette[0], 12 * MiB)}, ...sharpViews(2).map((file, index) => ({...file, name: `small-${index}.png`}))];
  const asked = (files: PictureFile[]) => files.reduce((sum, file) => sum + file.buffer.length, 0);

  test('kept 2 GiB less 10 MiB and 12 MiB asked: the whole confirmation is refused with the bytes kept and asked and the word that deleting arrives later; nothing is kept or recorded', async ({page, context, baseURL}) => {
    const files = bigSet();
    const who = await savedPictures(page, context, baseURL!, files);
    await keep(who.accountId, quota - 10 * MiB);
    await openReviewFromProject(page);
    await toLastStep(page, 'evidence_images');
    await saveChoiceButton(page).click();
    await failureOf(page, 'en', 'review.confirm.quota', {limit: '2 GiB', kept: formatBytes(quota - 10 * MiB), asked: formatBytes(asked(files))});
    expect(await textOf(failureNotice(page))).toContain('Deleting kept pictures arrives in a later release');
    expect(await projectOf(who.projectId)).toMatchObject({stage: 'request_draft', revision: 1});
    // Nothing of this confirmation was kept: only the Account's earlier (made-up) manifest is there.
    expect(await manifestsOf(who.accountId)).toEqual([]);
    expect(await attachCommands(who.accountId)).toBe(0);
    expect((await latestPins(who.projectId)).every((pin) => pin.retained_root === null)).toBe(true);
  });

  test('kept exactly to the limit with these pictures: it passes', async ({page, context, baseURL}) => {
    const files = bigSet();
    const who = await savedPictures(page, context, baseURL!, files);
    await keep(who.accountId, quota - asked(files));
    await openReviewFromProject(page);
    await toLastStep(page, 'evidence_images');
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
    expect(await manifestsOf(who.accountId)).toHaveLength(3);
    expect((await latestPins(who.projectId)).every((pin) => pin.retained_root !== null)).toBe(true);
  });

  test('is told in Hebrew too, with the sizes as parameters', async ({page, context, baseURL}) => {
    const files = bigSet();
    const who = await savedPictures(page, context, baseURL!, files, {locale: 'he'});
    await keep(who.accountId, quota - 10 * MiB);
    await openReviewFromProject(page, 'he');
    await toLastStep(page, 'evidence_images', 'he');
    await saveChoiceButton(page, 'he').click();
    await failureOf(page, 'he', 'review.confirm.quota', {limit: '2 GiB', kept: formatBytes(quota - 10 * MiB), asked: formatBytes(asked(files))});
    expect(await manifestsOf(who.accountId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('nothing about a kept picture leaks into an address, a log or a page', () => {
  test('no retained root and no object key is in any address, console message, document or action answer of the whole flow, reload included', async ({page, context, baseURL}) => {
    const traffic = watchTraffic(page);
    const files = threeFiles();
    const pages: string[] = [];
    const who = await retainedProject(page, context, baseURL!, files, 'evidence_images');
    pages.push(page.url(), await page.content());
    const pins = await latestPins(who.projectId);
    await cleanUpStaging(who.accountId, pins.map((pin) => pin.upload_id));
    await openReview(page, who.projectId);
    await measured(page);
    pages.push(page.url(), await page.content());
    await page.goto(`/projects/${who.projectId}`);
    pages.push(page.url(), await page.content());
    await page.goto(picturesPath(who.projectId));
    await hydrated(page, 'main button[type="submit"]');
    pages.push(page.url(), await page.content());
    await new Promise((resolve) => setTimeout(resolve, 500));

    const roots = pins.map((pin) => pin.retained_root!);
    const retainedDigests = pins.map((pin) => pin.retained_sha256!);
    expect(roots).toHaveLength(3);
    const haystack = [...traffic.urls, ...traffic.messages, ...traffic.bodies, ...pages].join('\n');
    for (const root of roots) expect(haystack, `root ${root.slice(0, 8)}`).not.toContain(root);
    expect(haystack).not.toContain('objects/');
    expect(haystack).not.toContain(`/${who.accountId}/`);
    // The retained digest is a fingerprint the page needs (it checks the bytes against it); it is not a key. Only the upload ID names a picture in an address.
    for (const url of traffic.urls.filter((candidate) => /\/v1\/files\/retained\//.test(candidate))) expect(url).toMatch(/\/v1\/files\/retained\/[0-9a-f-]{36}$/);
    expect(retainedDigests.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the states are readable on a phone and a desktop, in both languages', () => {
  /**
   * A project whose first review is open at the last step and whose second picture's staged copy was replaced, so Confirm is refused; the other two pictures are kept by
   * the attempt. `restore` puts the original bytes back, so the next Confirm succeeds.
   */
  async function refusable(page: Page, context: BrowserContext, baseURL: string, options: Options) {
    const locale = options.locale ?? 'en';
    const files = sharpViews(3);
    const who = await savedPictures(page, context, baseURL, files, options);
    await openReviewFromProject(page, locale);
    await toLastStep(page, 'evidence_images', locale);
    const uploads = (await latestPins(who.projectId)).map((pin) => pin.upload_id);
    await putObject(stagingKey(who.accountId, uploads[1]), sharpPng(1200, 900, 40, 11), 'image/png');
    return {...who, files, uploads, locale, restore: () => putObject(stagingKey(who.accountId, uploads[1]), files[1].buffer, 'image/png')};
  }

  for (const variant of variants) {
    test(`has no accessibility violation while the pictures are being kept, on a refusal, and on the Project page that says they are kept, in ${variant.name}`, async ({page, context, baseURL}) => {
      const { locale, projectId, restore } = await refusable(page, context, baseURL!, {locale: variant.locale, theme: variant.theme});
      await slowRetain(page, 2500);
      await saveChoiceButton(page, locale).click();
      await expect(retainingStatus(page)).toHaveText(t(locale, 'review.confirm.retaining', {count: 3}), crossing);
      expect(await violations(page), 'keeping').toEqual([]);
      await failureOf(page, locale, 'review.confirm.bytesChanged', {position: 2});
      expect(await violations(page), 'a refusal').toEqual([]);
      await restore();
      await saveChoiceButton(page, locale).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
      const section = page.getByRole('region', {name: t(locale, 'request.section.title'), exact: true});
      await expect(section.locator('[data-kept="true"]')).toHaveCount(3);
      expect(await violations(page), 'the Project page').toEqual([]);
    });
  }

  for (const locale of ['en', 'he'] as const) {
    test(`fits a 320 px window with the text at 200% while the pictures are being kept, on a refusal and on the Project page, in ${locale}`, async ({page, context, baseURL}) => {
      const files = sharpViews(3);
      const who = await savedPictures(page, context, baseURL!, files, {locale});
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      await openReviewFromProject(page, locale);
      await toLastStep(page, 'evidence_images', locale);
      const uploads = (await latestPins(who.projectId)).map((pin) => pin.upload_id);
      await putObject(stagingKey(who.accountId, uploads[1]), sharpPng(1200, 900, 40, 11), 'image/png');
      await slowRetain(page, 2500);
      await saveChoiceButton(page, locale).click();
      await expect(retainingStatus(page)).toBeVisible(crossing);
      expect(await overflowReport(page), 'keeping').toEqual({scroll: 0, clipped: []});
      await failureOf(page, locale, 'review.confirm.bytesChanged', {position: 2});
      expect(await overflowReport(page), 'a refusal').toEqual({scroll: 0, clipped: []});
      await putObject(stagingKey(who.accountId, uploads[1]), files[1].buffer, 'image/png');
      await saveChoiceButton(page, locale).click();
      await expect(page).toHaveURL(new RegExp(`/projects/${who.projectId}$`), crossing);
      expect(await overflowReport(page), 'the Project page with the kept pictures').toEqual({scroll: 0, clipped: []});
    });
  }

  test('fits a 320 px window with the text at 200% for the quota message too', async ({page, context, baseURL}) => {
    const quota = 2 * 1024 * MiB;
    const files = [{name: 'big.png', mimeType: 'image/png', buffer: pngOfLength(palette[0], 12 * MiB)}, ...sharpViews(2).map((file, index) => ({...file, name: `small-${index}.png`}))];
    const who = await savedPictures(page, context, baseURL!, files);
    const body = `kept ${who.accountId}`;
    const id = (await world.db.query('select gen_random_uuid() as id')).rows[0].id as string;
    await world.db.query(
      `insert into artifacts.manifests (root, id, account_id, upload_id, kind, digest, length, serialization, activity, body)
       values (encode(sha256(convert_to($1, 'UTF8')), 'hex'), $2, $3, $2, 'picture', encode(sha256(convert_to($1 || 'x', 'UTF8')), 'hex'), $4, 1, 'upload:strip-picture-metadata', $1)`,
      [body, id, who.accountId, quota - 10 * MiB],
    );
    await page.setViewportSize({width: 320, height: 640});
    await setFontSize(page, 32);
    await openReviewFromProject(page);
    await toLastStep(page, 'evidence_images');
    await saveChoiceButton(page).click();
    await failureOf(page, 'en', 'review.confirm.quota', {limit: '2 GiB', kept: formatBytes(quota - 10 * MiB), asked: formatBytes(files.reduce((sum, file) => sum + file.buffer.length, 0))});
    expect(await overflowReport(page), 'the quota message').toEqual({scroll: 0, clipped: []});
  });

  test('keeps every control at least 44 px square while the pictures are being kept, on a refusal and on the Project page', async ({page, context, baseURL}) => {
    const { projectId, restore } = await refusable(page, context, baseURL!, {});
    const small = async () =>
      main(page).locator('button, a.btn, select, input[type="checkbox"], input[type="radio"], label.review-checkbox').evaluateAll((controls) =>
        controls
          .map((control) => ({name: control.textContent?.trim().slice(0, 30) || control.tagName, box: (control.closest('label') ?? control).getBoundingClientRect()}))
          .filter(({box}) => box.width > 0 && (box.height < 43.5 || box.width < 43.5))
          .map(({name}) => name),
      );
    await slowRetain(page, 2500);
    await saveChoiceButton(page).click();
    await expect(retainingStatus(page)).toBeVisible(crossing);
    expect(await small(), 'keeping').toEqual([]);
    await failureOf(page, 'en', 'review.confirm.bytesChanged', {position: 2});
    expect(await small(), 'a refusal').toEqual([]);
    await restore();
    await saveChoiceButton(page).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`), crossing);
    await expect(page.locator('[data-kept="true"]')).toHaveCount(3);
    expect(await small(), 'the Project page').toEqual([]);
  });
});

// A hash is a hash: a kept picture's retained digest is the SHA-256 of the object, whoever reads it.
test('the retained digest recorded is the SHA-256 of the stored object, and the staged digest the person confirmed is the original\'s', async ({page, context, baseURL}) => {
  const files = threeFiles();
  const who = await retainedProject(page, context, baseURL!, files, 'evidence_images');
  const [pin] = await latestPins(who.projectId);
  const object = await readObject(objectKey(who.accountId, pin.retained_root!));
  expect(createHash('sha256').update(object).digest('hex')).toBe(pin.retained_sha256);
  expect(pin.sha256).toBe(sha256Of(files[0].buffer));
  expect(pin.retained_sha256).not.toBe(pin.sha256);
  expect(object.length).toBeLessThan(files[0].buffer.length);
  expect(pin.retained_length).toBe(object.length);
});
