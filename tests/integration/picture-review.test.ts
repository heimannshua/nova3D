import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {incomplete, reviewDigestInput, viewLabels, type Measurements, type ViewLabel} from '@/lib/picture-quality';
import {readProjectRequest, recordPictureReview, recordPictureSet} from '@/lib/projects';
import {createHarness} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 2.3 against the Supabase CLI stack: the review of a set of pictures. The labels and measurements of the pictures (claims of the browser, stored as sent),
// the obstruction confirmation, the acknowledgment pinned to the ordered pictures and the scope, the one idempotent writer (api.record_picture_review) that records
// a reviewed revision as a successor, the rule the database applies to the claims (projects.picture_review_incomplete, held equal to lib/picture-quality.ts over a
// table of cases), the picture-set writer that now accepts either picture mode, the read of all of it, the table checks, and the preflight. Every database-level row
// of the I/O matrix.
//
// Most cases run inside a transaction that is rolled back, as the service role, with leases inserted directly as the table owner. The cases that need several real
// connections, and the typed calls the application makes over REST, commit data and remove it afterwards.

const {db, connect, committed, inTx, addUser, attempt, rows} = createHarness();

let env: Record<string, string>;
const left: string[] = [];

beforeAll(async () => {
  env = await stackEnvironment(db);
});
afterAll(async () => {
  if (left.length) {
    await db.query(`update artifacts.staging_leases set state = 'released' where id = any($1) and state in ('receiving', 'complete')`, [left]).catch(() => undefined);
    await db.query(`update artifacts.staging_leases set state = 'deleted' where id = any($1) and state = 'released'`, [left]).catch(() => undefined);
  }
});

// Fixtures ---------------------------------------------------------------------------------------------------------------------

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; epoch: number};

async function account(client: Client): Promise<Fixture> {
  const user = await addUser(client);
  const {rows: made} = await client.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject]);
  const accountId = made[0].id as string;
  const {rows: workspace} = await client.query('select id from projects.workspaces where account_id = $1', [accountId]);
  return {user, accountId, workspaceId: workspace[0].id as string, epoch: 1};
}
async function committedAccount(): Promise<Fixture> {
  const made = await account(db);
  committed.users.push(made.user.id);
  return made;
}

type Lease = {id: string; sha: string; length: number; ct: string};
async function lease(client: Client, owner: Fixture | string, options: {state?: string; expires?: number; age?: number; kind?: string; length?: number} = {}): Promise<Lease> {
  const state = options.state ?? 'complete';
  const length = options.length ?? 1000;
  const sha = randomBytes(32).toString('hex');
  const id = randomUUID();
  await client.query(
    `insert into artifacts.staging_leases (id, account_id, kid, kind, length, sha256, content_type, received_length, state, created_at, expires_at)
     values ($1, $2, 'test-kid', $3, $4, $5, 'image/png', $6, $7, clock_timestamp() - make_interval(secs => $8::float8), clock_timestamp() + make_interval(secs => $9::float8))`,
    [id, typeof owner === 'string' ? owner : owner.accountId, options.kind ?? 'picture', length, sha, state === 'receiving' ? 0 : length, state, options.age ?? 60, options.expires ?? 20 * 3600],
  );
  return {id, sha, length, ct: 'image/png'};
}
async function leases(client: Client, owner: Fixture, count: number, options: Parameters<typeof lease>[2] = {}) {
  const made: Lease[] = [];
  for (let index = 0; index < count; index += 1) made.push(await lease(client, owner, options));
  return made;
}
const ids = (set: Lease[]) => set.map((entry) => entry.id);
const leaseRow = async (client: Client, id: string) => (await client.query('select id, state, created_at, expires_at from artifacts.staging_leases where id = $1', [id])).rows[0];
const dbNow = async (client: Client) => (await client.query('select clock_timestamp() as now')).rows[0].now as Date;
const asService = async (client: Client, sql: string, params: unknown[]) => (await rows(client, 'service_role', sql, params))[0];

/** A Project and its first (unreviewed) picture revision, made by the picture-set writer. */
async function pictureProject(client: Client, who: Fixture, set: Lease[]) {
  const made = await asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [who.accountId, who.epoch, randomUUID(), null, 'Picture request', ids(set)]);
  expect(made.outcome).toBe('created');
  return {projectId: made.project_id as string, requestId: made.request_id as string};
}

type Picture = {label: ViewLabel; short: number; blur: number; clipped: number};
const sharp = (label: ViewLabel): Picture => ({label, short: 1200, blur: 412.375, clipped: 0.0213});
const threeViews = (): Picture[] => [sharp('front'), sharp('left'), sharp('top')];
const imagesJson = (set: Lease[], pictures: Picture[]) => set.map((entry, index) => ({upload_id: entry.id, label: pictures[index].label, short_edge_px: pictures[index].short, blur_variance: pictures[index].blur, clipped_fraction: pictures[index].clipped}));

type Review = {
  epoch?: number | null;
  command?: string | null;
  project: string;
  seq?: number | null;
  mode?: string | null;
  scope?: string | null;
  outcome?: string | null;
  images: unknown;
  obstruction?: boolean | null;
  acknowledge?: boolean | null;
};
const SCOPE = 'The subject in my pictures';
const OUTCOME = 'A model made from my pictures';
const reviewSql = 'select * from api.record_picture_review($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)';
const reviewValues = (who: Fixture, review: Review) => [
  who.accountId,
  review.epoch === undefined ? who.epoch : review.epoch,
  review.command === undefined ? randomUUID() : review.command,
  review.project,
  review.seq === undefined ? 1 : review.seq,
  review.mode === undefined ? 'evidence_images' : review.mode,
  review.scope === undefined ? (review.mode === 'image_direct' ? SCOPE : null) : review.scope,
  review.outcome === undefined ? (review.mode === 'image_direct' ? OUTCOME : null) : review.outcome,
  JSON.stringify(review.images),
  review.obstruction === undefined ? true : review.obstruction,
  review.acknowledge === undefined ? false : review.acknowledge,
];
const reviewRaw = (client: Client, who: Fixture, review: Review) => attempt(client, 'service_role', reviewSql, reviewValues(who, review));
async function review(client: Client, who: Fixture, input: Review) {
  const result = await reviewRaw(client, who, input);
  if (!result.ok) throw new Error(`api.record_picture_review failed: ${result.message}`);
  return result.rows[0] as {outcome: string; project_id: string | null; request_id: string | null; seq: number | null; position: number | null};
}
const nothing = {project_id: null, request_id: null, seq: null, position: null};

const projectsOf = async (client: Client, accountId: string) =>
  (await client.query('select id, title, stage, current_version, revision::int as revision, updated_at, deleted_at from projects.projects where account_id = $1 order by created_at, id', [accountId])).rows;
const revisionsOf = async (client: Client, accountId: string) =>
  (
    await client.query(
      `select id, project_id, seq, command_id, mode, subject_id, scope, outcome, description, personalization_wording as wording, personalization_text as text,
              personalization_style as style, personalization_applied as applied, personalization_reason as reason, digest, confirmed_at, created_at,
              obstruction_confirmed_at, incomplete_acknowledged_at, incomplete_acknowledged_digest
         from projects.request_revisions where account_id = $1 order by project_id, seq`,
      [accountId],
    )
  ).rows;
const imagesOf = async (client: Client, revisionId: string) =>
  (
    await client.query(
      `select position, upload_id, sha256, length::int as length, content_type, view_label, short_edge_px, blur_variance::float8 as blur_variance, clipped_fraction::float8 as clipped_fraction
         from projects.request_images where revision_id = $1 order by position`,
      [revisionId],
    )
  ).rows;
async function snapshot(client: Client, who: Fixture, uploadIds: string[]) {
  return {
    projects: await projectsOf(client, who.accountId),
    revisions: await revisionsOf(client, who.accountId),
    images: (await client.query('select revision_id, position, upload_id, view_label, short_edge_px, blur_variance::text as blur from projects.request_images where account_id = $1 order by revision_id, position', [who.accountId])).rows,
    leases: (await client.query('select id, state, expires_at from artifacts.staging_leases where id = any($1) order by id', [uploadIds])).rows,
  };
}

/** A Project holding three good views, reviewed once already as research-assisted (revision seq 2): the starting point of the cases that change a review. */
async function reviewedProject(client: Client, who: Fixture, set?: Lease[], pictures: Picture[] = threeViews()) {
  const pictureSet = set ?? (await leases(client, who, pictures.length));
  const { projectId } = await pictureProject(client, who, pictureSet);
  const done = await review(client, who, {project: projectId, seq: 1, images: imagesJson(pictureSet, pictures)});
  expect(done.outcome).toBe('created');
  return {projectId, set: pictureSet, pictures, requestId: done.request_id as string};
}

const part = (value: string | null) => (value === null ? '-' : `${Buffer.byteLength(value, 'utf8')}:${value}`);
/** The digest of the COMMAND the function builds. */
const commandDigest = (input: {project: string; seq: number; mode: string; scope: string | null; outcome: string | null; obstruction: boolean; acknowledge: boolean; set: Lease[]; pictures: Picture[]}) =>
  createHash('sha256')
    .update(
      `record_picture_review\n${[input.project, String(input.seq), input.mode].map(part).join('')}${part(input.scope)}${part(input.outcome)}${part(String(input.obstruction))}${part(String(input.acknowledge))}${input.set
        .map((entry, index) => [String(index + 1), entry.id, entry.sha, input.pictures[index].label, String(input.pictures[index].short), String(input.pictures[index].blur), String(input.pictures[index].clipped)].map(part).join(''))
        .join('')}`,
      'utf8',
    )
    .digest('hex');

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: research-assisted reconstruction records the choice, the labels and the measurements, and no scope', () => {
  it('appends a successor (seq + 1) that is unconfirmed, with no scope, outcome, description or subject, the labels and measurements as sent, the obstruction confirmation, and the stage request_draft', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId, requestId: first } = await pictureProject(client, a, set);
      const before = (await projectsOf(client, a.accountId))[0];
      const pictures: Picture[] = [sharp('front'), {label: 'detail', short: 640, blur: 12.5, clipped: 0.5}, sharp('top')];
      const start = await dbNow(client);
      const done = await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, pictures)});
      expect(done).toEqual({outcome: 'created', project_id: projectId, request_id: expect.stringMatching(/^[0-9a-f-]{36}$/), seq: 2, position: null});

      const [earlier, successor] = await revisionsOf(client, a.accountId);
      expect(earlier).toMatchObject({id: first, seq: 1, mode: 'evidence_images', confirmed_at: null, obstruction_confirmed_at: null, incomplete_acknowledged_at: null, incomplete_acknowledged_digest: null});
      expect(successor).toMatchObject({
        id: done.request_id,
        seq: 2,
        mode: 'evidence_images',
        subject_id: null,
        scope: null,
        outcome: null,
        description: null,
        wording: null,
        text: null,
        style: null,
        applied: false,
        reason: null,
        confirmed_at: null,
        incomplete_acknowledged_at: null,
        incomplete_acknowledged_digest: null,
      });
      expect(successor.obstruction_confirmed_at.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(await imagesOf(client, done.request_id as string)).toEqual(
        set.map((entry, index) => ({
          position: index + 1,
          upload_id: entry.id,
          sha256: entry.sha,
          length: entry.length,
          content_type: 'image/png',
          view_label: pictures[index].label,
          short_edge_px: pictures[index].short,
          blur_variance: pictures[index].blur,
          clipped_fraction: pictures[index].clipped,
        })),
      );
      // The Project: revision raised by exactly one, still a draft, updated; the earlier revision's pictures are untouched.
      const after = (await projectsOf(client, a.accountId))[0];
      expect(after).toMatchObject({id: projectId, stage: 'request_draft', revision: before.revision + 1});
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      expect((await imagesOf(client, first)).map((image) => image.view_label)).toEqual([null, null, null]);
    });
  });

  it('is not an approval, a permission or a payment: the revision carries none, and the Project has no Job or cost', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set, pictures } = await reviewedProject(client, a);
      expect(pictures).toHaveLength(3);
      const columns = (await client.query(`select column_name from information_schema.columns where table_schema = 'projects' and table_name in ('request_revisions', 'request_images')`)).rows.map((row) => row.column_name as string);
      expect(columns.filter((name) => /approv|permission|payment|paid|cost|price|job|reserv|manifest|verdict|pass|fail/i.test(name))).toEqual([]);
      expect(set).toHaveLength(3);
      expect(projectId).toBeTruthy();
    });
  });

  it('needs no complete inputs: two blurry views are recorded as the research-assisted choice, with no acknowledgment', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, set);
      const poor: Picture[] = [{label: 'front', short: 300, blur: 0, clipped: 1}, {label: 'front', short: 300, blur: 0, clipped: 1}];
      const done = await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, poor), acknowledge: false});
      expect(done.outcome).toBe('created');
      expect((await revisionsOf(client, a.accountId))[1]).toMatchObject({incomplete_acknowledged_at: null, incomplete_acknowledged_digest: null, confirmed_at: null});
    });
  });

  it('records no acknowledgment even when one is sent: there is nothing to acknowledge in research-assisted mode', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId } = await pictureProject(client, a, set);
      const done = await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, [{label: 'front', short: 100, blur: 0, clipped: 1}]), acknowledge: true});
      expect(done.outcome).toBe('created');
      expect((await revisionsOf(client, a.accountId))[1]).toMatchObject({incomplete_acknowledged_at: null, incomplete_acknowledged_digest: null});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: direct image-derived conversion confirms the scope and outcome, with no subject and no Research Plan', () => {
  it('with complete inputs: a confirmed successor holding exactly the scope and outcome, no subject, no description, no wish, the stage request_confirmed and no acknowledgment', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const start = await dbNow(client);
      const done = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, threeViews())});
      expect(done).toEqual({outcome: 'created', project_id: projectId, request_id: expect.any(String), seq: 2, position: null});
      const [, successor] = await revisionsOf(client, a.accountId);
      expect(successor).toMatchObject({
        mode: 'image_direct',
        subject_id: null,
        scope: SCOPE,
        outcome: OUTCOME,
        description: null,
        wording: null,
        text: null,
        style: null,
        applied: false,
        reason: null,
        incomplete_acknowledged_at: null,
        incomplete_acknowledged_digest: null,
      });
      expect(successor.confirmed_at.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(successor.obstruction_confirmed_at.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({stage: 'request_confirmed', revision: 2});
    });
  });

  it('with incomplete inputs and the acknowledgment: records when, and the digest of the scope, the outcome and the ordered pictures with their staged SHA-256 and labels', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const pictures: Picture[] = [sharp('front'), {label: 'left', short: 1200, blur: 41, clipped: 0.01}, {label: 'detail', short: 900, blur: 200, clipped: 0.01}];
      const start = await dbNow(client);
      const done = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, pictures), acknowledge: true});
      expect(done.outcome).toBe('created');
      const [, successor] = await revisionsOf(client, a.accountId);
      expect(successor.incomplete_acknowledged_at.getTime()).toBeGreaterThanOrEqual(start.getTime());
      // The module's text, hashed here, is the database's digest: the acknowledgment is pinned to these pictures in this order and this scope.
      const expected = createHash('sha256')
        .update(reviewDigestInput({scope: SCOPE, outcome: OUTCOME, images: set.map((entry, index) => ({uploadId: entry.id, sha256: entry.sha, label: pictures[index].label}))}), 'utf8')
        .digest('hex');
      expect(successor.incomplete_acknowledged_digest).toBe(expected);
      expect(successor.digest).toBe(commandDigest({project: projectId, seq: 1, mode: 'image_direct', scope: SCOPE, outcome: OUTCOME, obstruction: true, acknowledge: true, set, pictures}));
      expect(successor.incomplete_acknowledged_digest).not.toBe(successor.digest);
      expect((await projectsOf(client, a.accountId))[0].stage).toBe('request_confirmed');
    });
  });

  it('pins the acknowledgment to the pictures, their order, their labels and the scope: another of any of them is another digest', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const pictures: Picture[] = [sharp('front'), sharp('left')];
      const digests: string[] = [];
      for (const variant of [
        {order: [0, 1], labels: ['front', 'left'], scope: SCOPE},
        {order: [1, 0], labels: ['left', 'front'], scope: SCOPE},
        {order: [0, 1], labels: ['front', 'back'], scope: SCOPE},
        {order: [0, 1], labels: ['front', 'left'], scope: 'Another scope'},
      ]) {
        const { projectId } = await pictureProject(client, a, variant.order.map((index) => set[index]));
        const arranged = variant.order.map((index, position) => ({...pictures[index], label: variant.labels[position] as ViewLabel}));
        const done = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', scope: variant.scope, images: imagesJson(variant.order.map((index) => set[index]), arranged), acknowledge: true});
        expect(done.outcome).toBe('created');
        digests.push((await revisionsOf(client, a.accountId)).find((revision) => revision.id === done.request_id)!.incomplete_acknowledged_digest as string);
      }
      expect(new Set(digests).size).toBe(4);
    });
  });

  it('answers `acknowledgment_required` for incomplete inputs without it, and writes and renews nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2, {expires: 600});
      const { projectId } = await pictureProject(client, a, set);
      const state = await snapshot(client, a, ids(set));
      // Two different views are fewer than three; and three views with one blurry picture, and one small, and one over-exposed.
      const cases: [string, Picture[], Lease[]][] = [
        ['two views', [sharp('front'), sharp('left')], set],
      ];
      for (const [name, pictures, uploads] of cases) {
        expect(await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(uploads, pictures), acknowledge: false}), name).toEqual({outcome: 'acknowledgment_required', ...nothing});
      }
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });

  it.each([
    ['a blurry picture', {...sharp('top'), blur: 99.999}],
    ['a small picture', {...sharp('top'), short: 799}],
    ['an over-exposed picture', {...sharp('top'), clipped: 0.3501}],
  ])('needs the acknowledgment for three views with %s, one step beyond the edge', async (_name, bad) => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const pictures = [sharp('front'), sharp('left'), bad];
      expect((await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, pictures)})).outcome).toBe('acknowledgment_required');
      expect((await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, pictures), acknowledge: true})).outcome).toBe('created');
    });
  });

  it('needs none exactly on the edges: 800 px, blur 100 and clipped 0.35 are ok', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const edge: Picture[] = [{label: 'front', short: 800, blur: 100, clipped: 0.35}, {label: 'left', short: 800, blur: 100, clipped: 0.35}, {label: 'top', short: 800, blur: 100, clipped: 0.35}];
      const done = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, edge)});
      expect(done.outcome).toBe('created');
      expect((await revisionsOf(client, a.accountId))[1]).toMatchObject({incomplete_acknowledged_at: null, incomplete_acknowledged_digest: null});
    });
  });

  it('does not count a detail close-up as a view: front, back and detail are incomplete, and front, back, left and detail are not', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      expect((await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, [sharp('front'), sharp('back'), sharp('detail')])})).outcome).toBe('acknowledgment_required');
      const four = await leases(client, a, 4);
      const other = await pictureProject(client, a, four);
      expect((await review(client, a, {project: other.projectId, seq: 1, mode: 'image_direct', images: imagesJson(four, [sharp('front'), sharp('back'), sharp('left'), sharp('detail')])})).outcome).toBe('created');
    });
  });

  it('applies the rule to the numbers it is SENT: all-ok measurements for a blurry picture need no acknowledgment, and are stored as sent', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      // (The picture itself is whatever it is: the server never decodes it, so a forged claim is stored as a claim.)
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const done = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, [sharp('front'), sharp('left'), {...sharp('top'), blur: 5000}])});
      expect(done.outcome).toBe('created');
      expect((await revisionsOf(client, a.accountId))[1].incomplete_acknowledged_at).toBeNull();
      expect((await imagesOf(client, done.request_id as string))[2]).toMatchObject({view_label: 'top', blur_variance: 5000});
    });
  });

  it('records no acknowledgment for complete inputs even when one is sent: the acknowledgment is recorded only when the database found the inputs incomplete', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      // Three different views at exactly each threshold (800 px, blur 100, clipped 0.35): complete by the rule.
      const edge: Picture[] = [{label: 'front', short: 800, blur: 100, clipped: 0.35}, {label: 'left', short: 800, blur: 100, clipped: 0.35}, {label: 'top', short: 800, blur: 100, clipped: 0.35}];
      expect(incomplete(edge.map((entry) => entry.label), edge.map((entry): Measurements => ({shortEdgePx: entry.short, blurVariance: entry.blur, clippedFraction: entry.clipped})))).toBe(false);
      const done = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, edge), acknowledge: true});
      expect(done.outcome).toBe('created');
      expect((await revisionsOf(client, a.accountId))[1]).toMatchObject({mode: 'image_direct', incomplete_acknowledged_at: null, incomplete_acknowledged_digest: null});
      const read = await asService(client, 'select * from api.read_project_request($1, $2, $3)', [a.accountId, a.epoch, projectId]);
      expect(read).toMatchObject({outcome: 'found', confirmed: true, acknowledged: false, acknowledged_at: null});
    });
  });

  it('refuses a confirmed direct review of a picture whose private copy has lapsed, and records nothing: a confirmed request cannot be reviewed again until pictures are retained', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const confirmed = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, threeViews())});
      expect(confirmed.outcome).toBe('created');
      // The second picture's copy lapses (24 hours after the last save).
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [set[1].id]);
      const state = await snapshot(client, a, ids(set));
      // Neither the same review nor a mode change (which would unlock the pictures) can be recorded: the leases are read again first.
      for (const mode of ['image_direct', 'evidence_images']) {
        expect(await review(client, a, {project: projectId, seq: 2, mode, images: imagesJson(set, threeViews())}), mode).toEqual({outcome: 'expired_upload', ...nothing, position: 2});
      }
      expect(await snapshot(client, a, ids(set))).toEqual(state);
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({stage: 'request_confirmed', revision: 2});
      expect(await revisionsOf(client, a.accountId)).toHaveLength(2);
      // The picture-set writer cannot change them either: a confirmed request is not editable there.
      expect(await asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), projectId, null, ids(set)])).toMatchObject({outcome: 'not_editable'});
    });
  });

  it('refuses the obstruction question first: without the confirmation nothing is recorded in either mode, and acknowledgment does not stand in for it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2, {expires: 600});
      const { projectId } = await pictureProject(client, a, set);
      const state = await snapshot(client, a, ids(set));
      for (const mode of ['evidence_images', 'image_direct']) {
        const answer = await review(client, a, {project: projectId, seq: 1, mode, images: imagesJson(set, [sharp('front'), sharp('left')]), obstruction: false, acknowledge: true});
        expect(answer, mode).toEqual({outcome: 'obstruction_not_confirmed', ...nothing});
      }
      // Both missing: the obstruction question is answered first.
      expect(await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, [sharp('front'), sharp('left')]), obstruction: false, acknowledge: false})).toEqual({outcome: 'obstruction_not_confirmed', ...nothing});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: successors, mode changes and the earlier revision', () => {
  it('changes mode with a successor: a confirmed direct revision, reviewed as research-assisted, is unconfirmed again, the stage goes back to request_draft, and the earlier revision is unchanged', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const direct = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, threeViews())});
      expect(direct.seq).toBe(2);
      const confirmed = (await revisionsOf(client, a.accountId))[1];
      expect((await projectsOf(client, a.accountId))[0].stage).toBe('request_confirmed');
      const research = await review(client, a, {project: projectId, seq: 2, mode: 'evidence_images', images: imagesJson(set, threeViews())});
      expect(research).toMatchObject({outcome: 'created', seq: 3});
      const revisions = await revisionsOf(client, a.accountId);
      expect(revisions.map((revision) => [revision.seq, revision.mode, revision.confirmed_at !== null])).toEqual([
        [1, 'evidence_images', false],
        [2, 'image_direct', true],
        [3, 'evidence_images', false],
      ]);
      // The confirmed revision is exactly as it was.
      expect(revisions[1]).toEqual(confirmed);
      expect(revisions[2]).toMatchObject({scope: null, outcome: null, description: null, subject_id: null, confirmed_at: null});
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({stage: 'request_draft', revision: 3});
    });
  });

  it('reviews a confirmed direct revision again as direct: another successor, with the scope the person edited', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, threeViews())});
      const again = await review(client, a, {project: projectId, seq: 2, mode: 'image_direct', scope: 'A new scope', outcome: 'A new outcome', images: imagesJson(set, threeViews())});
      expect(again).toMatchObject({outcome: 'created', seq: 3});
      expect((await revisionsOf(client, a.accountId))[2]).toMatchObject({scope: 'A new scope', outcome: 'A new outcome', mode: 'image_direct'});
    });
  });

  it('copies the ordered pictures with the lease\'s own SHA-256, length and type, not the caller\'s, and renews the leases within the 24 hour and 7 day bound', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const young = await lease(client, a, {age: 3600, expires: 600});
      const old = await lease(client, a, {age: 7 * 86400 - 3600, expires: 600});
      const set = [young, old];
      const { projectId } = await pictureProject(client, a, set);
      // (Saving renewed both once already; set them short again so this review's renewal is what is seen.)
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() + interval '10 minutes' where id = any($1)`, [ids(set)]);
      const before = await dbNow(client);
      const done = await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, [sharp('front'), sharp('left')])});
      expect(done.outcome).toBe('created');
      const [first, second] = await Promise.all(set.map((entry) => leaseRow(client, entry.id)));
      expect(first.expires_at.getTime()).toBeGreaterThanOrEqual(before.getTime() + 24 * 3600_000);
      // The old lease is kept, but never past 7 days from when it was created (an hour from now).
      expect(second.expires_at.getTime()).toBe(second.created_at.getTime() + 7 * 86400_000);
      expect(second.expires_at.getTime()).toBeLessThan(before.getTime() + 2 * 3600_000);
      expect((await imagesOf(client, done.request_id as string)).map((image) => [image.sha256, image.length, image.content_type])).toEqual(set.map((entry) => [entry.sha, entry.length, 'image/png']));
    });
  });

  it('releases nothing and retains nothing: the pictures stay the revision\'s, in their lease states', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { set } = await reviewedProject(client, a);
      for (const entry of set) expect((await leaseRow(client, entry.id)).state).toBe('complete');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: idempotency and the command ID', () => {
  it('replays the original receipt for the same command and the same payload, writing and renewing nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const command = randomUUID();
      const first = await review(client, a, {project: projectId, seq: 1, command, mode: 'image_direct', images: imagesJson(set, threeViews())});
      expect(first.outcome).toBe('created');
      const state = await snapshot(client, a, ids(set));
      const second = await review(client, a, {project: projectId, seq: 1, command, mode: 'image_direct', images: imagesJson(set, threeViews())});
      expect(second).toEqual({outcome: 'replayed', project_id: projectId, request_id: first.request_id, seq: 2, position: null});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
      expect((await revisionsOf(client, a.accountId)).length).toBe(2);
    });
  });

  it('answers `reused` for the same command with another payload (another mode, scope, label, measurement or flag), nothing written', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const command = randomUUID();
      const images = imagesJson(set, threeViews());
      await review(client, a, {project: projectId, seq: 1, command, mode: 'image_direct', images});
      const state = await snapshot(client, a, ids(set));
      const other = (patch: Partial<Review>) => review(client, a, {project: projectId, seq: 1, command, mode: 'image_direct', images, ...patch});
      expect(await other({mode: 'evidence_images'})).toEqual({outcome: 'reused', ...nothing});
      expect(await other({scope: 'Another'})).toEqual({outcome: 'reused', ...nothing});
      expect(await other({outcome: 'Another'})).toEqual({outcome: 'reused', ...nothing});
      expect(await other({acknowledge: true})).toEqual({outcome: 'reused', ...nothing});
      expect(await other({images: imagesJson(set, [sharp('front'), sharp('left'), {...sharp('top'), blur: 413}])})).toEqual({outcome: 'reused', ...nothing});
      expect(await other({images: imagesJson(set, [sharp('front'), sharp('left'), sharp('bottom')])})).toEqual({outcome: 'reused', ...nothing});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });

  it('answers `reused` for a command ID a rename used, a picture set used, or a text request used, and the rename of a revision\'s command ID is refused too', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const picturesCommand = (await revisionsOf(client, a.accountId))[0].command_id as string;
      const images = imagesJson(set, threeViews());
      expect(await review(client, a, {project: projectId, seq: 1, command: picturesCommand, images})).toEqual({outcome: 'reused', ...nothing});
      const renamed = randomUUID();
      expect((await asService(client, 'select * from api.rename_project($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, renamed, projectId, 1, 'Renamed'])).outcome).toBe('renamed');
      expect(await review(client, a, {project: projectId, seq: 1, command: renamed, images})).toEqual({outcome: 'reused', ...nothing});
      const done = await review(client, a, {project: projectId, seq: 1, images});
      const reviewCommand = (await revisionsOf(client, a.accountId)).find((revision) => revision.id === done.request_id)!.command_id as string;
      expect((await asService(client, 'select * from api.rename_project($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, reviewCommand, projectId, 3, 'Again'])).outcome).toBe('reused');
    });
  });

  it('keeps command IDs per Account: another Account may use the same command ID', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const command = randomUUID();
      const setA = await leases(client, a, 1);
      const setB = await leases(client, b, 1);
      const projectA = await pictureProject(client, a, setA);
      const projectB = await pictureProject(client, b, setB);
      expect((await review(client, a, {project: projectA.projectId, seq: 1, command, images: imagesJson(setA, [sharp('front')])})).outcome).toBe('created');
      expect((await review(client, b, {project: projectB.projectId, seq: 1, command, images: imagesJson(setB, [sharp('front')])})).outcome).toBe('created');
    });
  });

  it('answers `unavailable`, with no ID, for a replay whose Project has since been deleted or tombstoned: a receipt does not outlive its Project\'s visibility', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId } = await pictureProject(client, a, set);
      const command = randomUUID();
      const images = imagesJson(set, [sharp('front')]);
      expect((await review(client, a, {project: projectId, seq: 1, command, images})).outcome).toBe('created');
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', projectId])).outcome).toBe('recorded');
      expect(await review(client, a, {project: projectId, seq: 1, command, images})).toEqual({outcome: 'unavailable', ...nothing});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: the revision that was reviewed, and the Project', () => {
  it('answers `stale`, carrying the latest revision\'s seq, when the revision reviewed is not the latest: another window saved a newer set or review; nothing is written', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set } = await reviewedProject(client, a);
      const state = await snapshot(client, a, ids(set));
      const images = imagesJson(set, threeViews());
      // The latest is seq 2; reviewing seq 1 (an older window) is stale, and so is a number from the future.
      expect(await review(client, a, {project: projectId, seq: 1, images})).toEqual({outcome: 'stale', project_id: null, request_id: null, seq: 2, position: null});
      expect(await review(client, a, {project: projectId, seq: 3, images})).toEqual({outcome: 'stale', project_id: null, request_id: null, seq: 2, position: null});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });

  it('answers `stale` when the pictures are not exactly the latest revision\'s, in order: a different set, a different order, one fewer, one more', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const spare = await lease(client, a);
      const { projectId } = await pictureProject(client, a, set);
      const state = await snapshot(client, a, [...ids(set), spare.id]);
      const pictures = threeViews();
      const cases: [string, Lease[], Picture[]][] = [
        ['another set', [set[0], set[1], spare], pictures],
        ['another order', [set[1], set[0], set[2]], pictures],
        ['one fewer', [set[0], set[1]], pictures.slice(0, 2)],
        ['one more', [...set, spare], [...pictures, sharp('back')]],
      ];
      for (const [name, uploads, labelled] of cases) {
        expect(await review(client, a, {project: projectId, seq: 1, images: imagesJson(uploads, labelled)}), name).toMatchObject({outcome: 'stale', project_id: null, request_id: null});
      }
      expect(await snapshot(client, a, [...ids(set), spare.id])).toEqual(state);
    });
  });

  it('answers `stale` after the person changed the pictures in another window: the successor of the picture-set writer makes an older review stale', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set } = await reviewedProject(client, a);
      const extra = await lease(client, a);
      const changed = await asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), projectId, null, [...ids(set), extra.id]]);
      expect(changed).toMatchObject({outcome: 'revised', seq: 3});
      const answer = await review(client, a, {project: projectId, seq: 2, images: imagesJson(set, threeViews())});
      expect(answer).toMatchObject({outcome: 'stale', seq: 3});
    });
  });

  it('answers `stale` for a Project with no request revision at all, and `not_editable` for a text request', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const {rows: bare} = await client.query(`insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'No request', 'researching') returning id`, [a.workspaceId, a.accountId]);
      expect(await review(client, a, {project: bare[0].id, seq: 1, images: imagesJson(set, [sharp('front')])})).toMatchObject({outcome: 'stale', project_id: null, request_id: null});
      const text = await asService(client, 'select * from api.create_project_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)', [
        a.accountId, a.epoch, randomUUID(), 'The altar', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', 'Build the altar', null, null, null, false, null,
      ]);
      const state = await snapshot(client, a, ids(set));
      for (const seq of [1, 2]) expect(await review(client, a, {project: text.project_id, seq, images: imagesJson(set, [sharp('front')])}), String(seq)).toEqual({outcome: 'not_editable', ...nothing});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });

  it('answers ONE `unavailable`, with nothing in it, for another Account\'s Project, a deleted one, a tombstoned one and one that never existed; nothing is written', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const mine = await leases(client, a, 3);
      const theirSet = await leases(client, b, 1);
      const theirs = await pictureProject(client, b, theirSet);
      const deleted = await pictureProject(client, a, [mine[0]]);
      await client.query('update projects.projects set deleted_at = clock_timestamp(), revision = revision + 1 where id = $1', [deleted.projectId]);
      const hidden = await pictureProject(client, a, [mine[1]]);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', hidden.projectId])).outcome).toBe('recorded');
      const state = await snapshot(client, a, ids(mine));
      for (const target of [theirs.projectId, deleted.projectId, hidden.projectId, randomUUID()]) {
        expect(await review(client, a, {project: target, seq: 1, images: imagesJson([mine[2]], [sharp('front')])}), target).toEqual({outcome: 'unavailable', ...nothing});
      }
      expect(await snapshot(client, a, ids(mine))).toEqual(state);
      expect((await revisionsOf(client, b.accountId)).length).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: a review never moves a Project backwards', () => {
  // The service role has no privilege on the tables: a Project is moved on, as a later story's writer will, by the table owner (and the guard trigger wants the revision raised).
  const moveOn = (client: Client, projectId: string, stage: string) => client.query('update projects.projects set stage = $2, revision = revision + 1 where id = $1', [projectId, stage]);

  it.each(['researching', 'awaiting_plan_approval', 'generating', 'awaiting_model_approval', 'validation_failed', 'export_ready'])('answers `not_editable` for a Project at the stage %s, in either mode, and writes and renews nothing', async (stage) => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set } = await reviewedProject(client, a);
      await moveOn(client, projectId, stage);
      const state = await snapshot(client, a, ids(set));
      for (const mode of ['evidence_images', 'image_direct']) {
        expect(await review(client, a, {project: projectId, seq: 2, mode, images: imagesJson(set, threeViews())}), `${stage} ${mode}`).toEqual({outcome: 'not_editable', ...nothing});
      }
      // The stage is exactly what it was, the Project is not raised, no revision was added and no lease was renewed.
      expect(await snapshot(client, a, ids(set))).toEqual(state);
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({stage});
      expect(await revisionsOf(client, a.accountId)).toHaveLength(2);
    });
  });

  it('answers `not_editable` for a confirmed direct request whose Project went on, and does not bring it back to request_confirmed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      expect((await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, threeViews())})).outcome).toBe('created');
      await moveOn(client, projectId, 'generating');
      const state = await snapshot(client, a, ids(set));
      // Not even the same review pressed again (that would be `unchanged` for a Project still at the request stage).
      expect(await review(client, a, {project: projectId, seq: 2, mode: 'image_direct', images: imagesJson(set, threeViews())})).toEqual({outcome: 'not_editable', ...nothing});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });

  it('still reviews a Project at request_draft and at request_confirmed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      expect((await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, threeViews())})).outcome).toBe('created');
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({stage: 'request_confirmed'});
      expect((await review(client, a, {project: projectId, seq: 2, mode: 'evidence_images', images: imagesJson(set, threeViews())})).outcome).toBe('created');
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({stage: 'request_draft'});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: the same review confirmed again is not a new revision', () => {
  const expiries = async (client: Client, set: Lease[]) => (await client.query('select id, expires_at from artifacts.staging_leases where id = any($1) order by id', [ids(set)])).rows as {id: string; expires_at: Date}[];

  it('answers `unchanged` with the current ids for a research-assisted review pressed again under a new command after the answer was lost; nothing is written, the leases are renewed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set, requestId } = await reviewedProject(client, a);
      const before = await snapshot(client, a, ids(set));
      const earlier = await expiries(client, set);
      const again = await review(client, a, {project: projectId, seq: 2, images: imagesJson(set, threeViews())});
      expect(again).toEqual({outcome: 'unchanged', project_id: projectId, request_id: requestId, seq: 2, position: null});
      // No revision, no image and no Project change; the leases (the only thing that moved) were renewed within the bound of Story 2.2.
      const after = await snapshot(client, a, ids(set));
      expect({...after, leases: undefined}).toEqual({...before, leases: undefined});
      expect(await revisionsOf(client, a.accountId)).toHaveLength(2);
      const now = await dbNow(client);
      for (const lease of await expiries(client, set)) {
        const previous = earlier.find((entry) => entry.id === lease.id)!;
        expect(lease.expires_at.getTime()).toBeGreaterThan(previous.expires_at.getTime());
        expect(lease.expires_at.getTime()).toBeLessThanOrEqual(now.getTime() + 24 * 3600 * 1000);
        expect(lease.expires_at.getTime()).toBeGreaterThan(now.getTime() + 23 * 3600 * 1000);
      }
    });
  });

  it('keeps the 7 day bound when it renews: a picture nearly a week old is renewed to its limit and no further', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3, {age: 6.5 * 24 * 3600, expires: 3600});
      const { projectId } = await pictureProject(client, a, set);
      expect((await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, threeViews())})).outcome).toBe('created');
      expect((await review(client, a, {project: projectId, seq: 2, images: imagesJson(set, threeViews())})).outcome).toBe('unchanged');
      for (const entry of ids(set)) {
        const row = await leaseRow(client, entry);
        expect(row.expires_at.getTime()).toBeLessThanOrEqual(row.created_at.getTime() + 7 * 24 * 3600 * 1000);
      }
    });
  });

  it('answers `unchanged` for a confirmed direct review pressed again, with its acknowledgment: the same scope, outcome, pictures, labels, measurements and acknowledgment state', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const complete = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, threeViews())});
      expect(complete.outcome).toBe('created');
      expect(await review(client, a, {project: projectId, seq: 2, mode: 'image_direct', images: imagesJson(set, threeViews())})).toEqual({outcome: 'unchanged', project_id: projectId, request_id: complete.request_id, seq: 2, position: null});
      // With an acknowledgment: the second Confirm must acknowledge again (the rule is applied before anything is compared), and is then the same review.
      const poor: Picture[] = [sharp('front'), {label: 'left', short: 1200, blur: 41, clipped: 0.01}, sharp('detail')];
      const second = await review(client, a, {project: projectId, seq: 2, mode: 'image_direct', images: imagesJson(set, poor), acknowledge: true});
      expect(second).toMatchObject({outcome: 'created', seq: 3});
      expect(await review(client, a, {project: projectId, seq: 3, mode: 'image_direct', images: imagesJson(set, poor)})).toEqual({outcome: 'acknowledgment_required', ...nothing});
      expect(await review(client, a, {project: projectId, seq: 3, mode: 'image_direct', images: imagesJson(set, poor), acknowledge: true})).toEqual({outcome: 'unchanged', project_id: projectId, request_id: second.request_id, seq: 3, position: null});
      expect(await revisionsOf(client, a.accountId)).toHaveLength(3);
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({stage: 'request_confirmed', revision: 3});
    });
  });

  it.each([
    ['a label', (set: Lease[]) => ({images: imagesJson(set, [sharp('front'), sharp('left'), sharp('bottom')])})],
    ['a short edge', (set: Lease[]) => ({images: imagesJson(set, [sharp('front'), sharp('left'), {...sharp('top'), short: 1201}])})],
    ['a blur', (set: Lease[]) => ({images: imagesJson(set, [sharp('front'), sharp('left'), {...sharp('top'), blur: 412.376}])})],
    ['a clipped share', (set: Lease[]) => ({images: imagesJson(set, [sharp('front'), sharp('left'), {...sharp('top'), clipped: 0.0214}])})],
    ['the mode', (set: Lease[]) => ({mode: 'image_direct', images: imagesJson(set, threeViews())})],
  ])('records a successor when %s differs, as before', async (_name, change) => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set } = await reviewedProject(client, a);
      const next = await review(client, a, {project: projectId, seq: 2, ...change(set)});
      expect(next).toMatchObject({outcome: 'created', seq: 3});
      expect(await revisionsOf(client, a.accountId)).toHaveLength(3);
    });
  });

  it('records a successor when the scope or the outcome differs from a confirmed direct review', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, threeViews())});
      expect(await review(client, a, {project: projectId, seq: 2, mode: 'image_direct', scope: `${SCOPE}!`, images: imagesJson(set, threeViews())})).toMatchObject({outcome: 'created', seq: 3});
      expect(await review(client, a, {project: projectId, seq: 3, mode: 'image_direct', scope: `${SCOPE}!`, outcome: `${OUTCOME}!`, images: imagesJson(set, threeViews())})).toMatchObject({outcome: 'created', seq: 4});
    });
  });

  it('is `stale` first when the revision reviewed is not the latest, and still `replayed` for the command that made the revision', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const command = randomUUID();
      const first = await review(client, a, {project: projectId, seq: 1, command, images: imagesJson(set, threeViews())});
      expect(first.outcome).toBe('created');
      // The screen of the earlier revision (seq 1) pressed again: the pictures are the same, but it is the revision before the review.
      expect(await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, threeViews())})).toMatchObject({outcome: 'stale', seq: 2});
      expect(await review(client, a, {project: projectId, seq: 1, command, images: imagesJson(set, threeViews())})).toMatchObject({outcome: 'replayed', request_id: first.request_id, seq: 2});
    });
  });

  it('checks the leases and the obstruction question before it compares: a lapsed or released picture, or no confirmation, is never `unchanged`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set } = await reviewedProject(client, a);
      expect(await review(client, a, {project: projectId, seq: 2, obstruction: false, images: imagesJson(set, threeViews())})).toEqual({outcome: 'obstruction_not_confirmed', ...nothing});
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [set[1].id]);
      expect(await review(client, a, {project: projectId, seq: 2, images: imagesJson(set, threeViews())})).toEqual({outcome: 'expired_upload', ...nothing, position: 2});
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[0].id]);
      expect(await review(client, a, {project: projectId, seq: 2, images: imagesJson(set, threeViews())})).toEqual({outcome: 'not_ready', ...nothing, position: 1});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: every upload is read from its lease again', () => {
  it('answers `not_ready` for an upload released since it was saved, with its position, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[1].id]);
      const state = await snapshot(client, a, ids(set));
      expect(await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, threeViews())})).toEqual({outcome: 'not_ready', ...nothing, position: 2});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });

  it('answers `expired_upload` for an upload that lapsed since it was saved, with its position', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [set[2].id]);
      expect(await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, threeViews())})).toEqual({outcome: 'expired_upload', ...nothing, position: 3});
    });
  });

  it('answers `unknown_upload` for a picture whose lease is another Account\'s, and the first problem by position wins', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const set = await leases(client, a, 3);
      const foreign = await lease(client, b);
      const { projectId } = await pictureProject(client, a, set);
      // A revision that names another Account's upload (the owner can insert it; the writers never do): the review reads the lease again and refuses it.
      const {rows: revision} = await client.query(`select id from projects.request_revisions where project_id = $1`, [projectId]);
      await client.query(`alter table projects.request_images disable trigger request_images_no_update`);
      await client.query(`update projects.request_images set upload_id = $1 where revision_id = $2 and position = 2`, [foreign.id, revision[0].id]);
      await client.query(`alter table projects.request_images enable trigger request_images_no_update`);
      const uploads = [set[0], {...foreign}, set[2]];
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[2].id]);
      expect(await review(client, a, {project: projectId, seq: 1, images: imagesJson(uploads, threeViews())})).toEqual({outcome: 'unknown_upload', ...nothing, position: 2});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: authority', () => {
  it('answers `denied`, writing and renewing nothing, to a disabled Account, a stale epoch, an Account that does not exist and a tombstoned Account', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set } = await reviewedProject(client, a);
      const state = await snapshot(client, a, ids(set));
      const images = imagesJson(set, threeViews());
      expect(await review(client, a, {project: projectId, seq: 2, epoch: 99, images})).toEqual({outcome: 'denied', ...nothing});
      expect(await review(client, {...a, accountId: randomUUID()}, {project: projectId, seq: 2, images})).toEqual({outcome: 'denied', ...nothing});
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect(await review(client, a, {project: projectId, seq: 2, images})).toEqual({outcome: 'denied', ...nothing});
      expect(await snapshot(client, a, ids(set))).toEqual(state);

      const b = await account(client);
      const bSet = await leases(client, b, 1);
      const bProject = await pictureProject(client, b, bSet);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['account', b.accountId])).outcome).toBe('recorded');
      expect(await review(client, b, {project: bProject.projectId, seq: 1, images: imagesJson(bSet, [sharp('front')])})).toEqual({outcome: 'denied', ...nothing});
    });
  });

  it('checks the arguments before the Account: a disabled Account that sends nonsense is told so, not `denied`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId } = await reviewedProject(client, a);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      const result = await reviewRaw(client, a, {project: projectId, seq: 2, mode: 'sideways', images: []});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_review: arguments', () => {
  const good = (set: Lease[]) => imagesJson(set, [sharp('front')]);

  it.each([
    ['no command', {command: null}],
    ['no Project', {project: null as never}],
    ['a revision of 0', {seq: 0}],
    ['no revision', {seq: null}],
    ['a mode that is not a picture mode', {mode: 'evidence_text'}],
    ['no mode', {mode: null}],
    ['a scope for research-assisted', {mode: 'evidence_images', scope: 'x'}],
    ['an outcome for research-assisted', {mode: 'evidence_images', outcome: 'x'}],
    ['no scope for direct', {mode: 'image_direct', scope: null}],
    ['no outcome for direct', {mode: 'image_direct', outcome: null}],
    ['a scope with white space around it', {mode: 'image_direct', scope: ' scope '}],
    ['an empty scope', {mode: 'image_direct', scope: ''}],
    ['a scope of 301 characters', {mode: 'image_direct', scope: 'x'.repeat(301)}],
    ['a scope with a control character', {mode: 'image_direct', scope: 'The\u0007altar'}],
    ['a scope with a bidirectional control', {mode: 'image_direct', scope: 'The ‮altar'}],
    ['an invisible scope', {mode: 'image_direct', scope: '​​'}],
    ['an outcome of 301 characters', {mode: 'image_direct', outcome: 'y'.repeat(301)}],
    ['an outcome with a new line', {mode: 'image_direct', outcome: 'a\nb'}],
    ['no obstruction flag', {obstruction: null}],
    ['no acknowledge flag', {acknowledge: null}],
  ] as [string, Partial<Review>][])('raises 22023 for %s, before anything else is read', async (_name, patch) => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId } = await pictureProject(client, a, set);
      const result = await reviewRaw(client, a, {project: projectId, seq: 1, images: good(set), ...patch});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });

  it.each([
    ['no pictures', () => []],
    ['null', () => null],
    ['an object', () => ({})],
    ['a string', () => 'front'],
    ['thirteen pictures', (set: Lease[]) => Array.from({length: 13}, (_, index) => ({upload_id: randomUUID(), label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: index / 100}))],
    ['a picture that is not an object', (set: Lease[]) => [set[0].id]],
    ['a missing member', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 120}]],
    ['an extra member', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0, ok: true}]],
    ['an upload ID in capitals', (set: Lease[]) => [{upload_id: set[0].id.toUpperCase(), label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0}]],
    ['an upload ID that is none', () => [{upload_id: 'nope', label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0}]],
    ['an upload ID that is a number', () => [{upload_id: 5, label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0}]],
    ['a repeated upload', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0}, {upload_id: set[0].id, label: 'left', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0}]],
    ['a label that is none of the seven', (set: Lease[]) => [{upload_id: set[0].id, label: 'side', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0}]],
    ['a label in capitals', (set: Lease[]) => [{upload_id: set[0].id, label: 'Front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0}]],
    ['no label', (set: Lease[]) => [{upload_id: set[0].id, label: null, short_edge_px: 900, blur_variance: 120, clipped_fraction: 0}]],
    ['a short edge of 0', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 0, blur_variance: 120, clipped_fraction: 0}]],
    ['a short edge that is not whole', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900.5, blur_variance: 120, clipped_fraction: 0}]],
    ['a short edge that is text', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: '900', blur_variance: 120, clipped_fraction: 0}]],
    ['a negative blur', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: -1, clipped_fraction: 0}]],
    ['a blur with four decimals', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 1.2345, clipped_fraction: 0}]],
    ['a blur above what the kernel can give', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 1040400.001, clipped_fraction: 0}]],
    ['a clipped share above 1', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 1.0001}]],
    ['a clipped share with five decimals', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0.00001}]],
    ['a clipped share below 0', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: -0.1}]],
    ['a clipped share that is null', (set: Lease[]) => [{upload_id: set[0].id, label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: null}]],
  ] as [string, (set: Lease[]) => unknown][])('raises 22023 for %s', async (_name, make) => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId } = await pictureProject(client, a, set);
      const result = await reviewRaw(client, a, {project: projectId, seq: 1, images: make(set)});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });

  it('accepts every value on the edge of its range: 1 px, blur 0 and 1,040,400, clipped 0 and 1, all seven labels, and twelve pictures', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 12);
      const { projectId } = await pictureProject(client, a, set);
      const edges: Picture[] = Array.from({length: 12}, (_, index) => ({label: viewLabels[index % viewLabels.length], short: index === 0 ? 1 : 999999999, blur: index % 2 ? 1040400 : 0, clipped: index % 2 ? 1 : 0}));
      const done = await review(client, a, {project: projectId, seq: 1, images: imagesJson(set, edges)});
      expect(done.outcome).toBe('created');
      const stored = await imagesOf(client, done.request_id as string);
      expect(stored.map((image) => image.view_label)).toEqual(edges.map((edge) => edge.label));
      expect(stored[1]).toMatchObject({short_edge_px: 999999999, blur_variance: 1040400, clipped_fraction: 1});
    });
  });

  it('takes exactly the eleven arguments the story names, and no SHA-256, length, type, digest, stage, verdict or acknowledgment time', async () => {
    const {rows} = await db.query(`select pg_get_function_arguments('api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)'::regprocedure) as args`);
    expect(rows[0].args).toBe(
      'p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_expected_seq integer, p_mode text, p_scope text, p_outcome text, p_images jsonb, p_obstruction_confirmed boolean, p_acknowledge boolean',
    );
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the picture-set writer after a review (api.record_picture_set)', () => {
  it('supersedes a reviewed revision with an UNREVIEWED successor: the provisional mode, no labels or measurements, no obstruction confirmation, and the stage stays request_draft', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set } = await reviewedProject(client, a);
      const extra = await lease(client, a);
      const changed = await asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), projectId, null, [...ids(set), extra.id]]);
      expect(changed).toMatchObject({outcome: 'revised', seq: 3});
      const successor = (await revisionsOf(client, a.accountId))[2];
      expect(successor).toMatchObject({mode: 'evidence_images', confirmed_at: null, scope: null, obstruction_confirmed_at: null, incomplete_acknowledged_at: null});
      expect((await imagesOf(client, changed.request_id)).map((image) => [image.view_label, image.short_edge_px, image.blur_variance, image.clipped_fraction])).toEqual(Array(4).fill([null, null, null, null]));
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({stage: 'request_draft', revision: 3});
      // The reviewed revision is exactly as it was.
      expect((await imagesOf(client, (await revisionsOf(client, a.accountId))[1].id)).map((image) => image.view_label)).toEqual(['front', 'left', 'top']);
    });
  });

  it('answers `unchanged` for the same pictures in the same order as a reviewed revision: the review stands, nothing is recorded', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId, set } = await reviewedProject(client, a);
      const state = await snapshot(client, a, []);
      const same = await asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), projectId, null, ids(set)]);
      expect(same.outcome).toBe('unchanged');
      expect((await snapshot(client, a, [])).revisions).toEqual(state.revisions);
    });
  });

  it('accepts an unconfirmed picture revision of either mode, and refuses a confirmed one, a text request and a Project with no request', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const extra = await lease(client, a);
      const save = (projectId: string) => asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), projectId, null, [...ids(set), extra.id]]);
      // An unconfirmed image_direct revision: the owner inserts one (the writers of this story never leave one), in a Project of its own.
      const {rows: second} = await client.query(`insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'Direct draft', 'request_draft') returning id`, [a.workspaceId, a.accountId]);
      const {rows: revision} = await client.query(
        `insert into projects.request_revisions (project_id, account_id, seq, command_id, mode, personalization_applied, digest) values ($1, $2, 1, $3, 'image_direct', false, $4) returning id`,
        [second[0].id, a.accountId, randomUUID(), 'a'.repeat(64)],
      );
      await client.query(`insert into projects.request_images (revision_id, project_id, account_id, position, upload_id, sha256, length, content_type) values ($1, $2, $3, 1, $4, $5, $6, 'image/png')`, [revision[0].id, second[0].id, a.accountId, set[0].id, set[0].sha, set[0].length]);
      expect((await save(second[0].id)).outcome).toBe('revised');
      // A reviewed research-assisted revision is accepted too (see above), and a confirmed direct revision is not.
      const direct3 = await leases(client, a, 3);
      const confirmed = await pictureProject(client, a, direct3);
      await review(client, a, {project: confirmed.projectId, seq: 1, mode: 'image_direct', images: imagesJson(direct3, threeViews())});
      const answer = await asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), confirmed.projectId, null, [...ids(direct3), extra.id]]);
      expect(answer).toEqual({outcome: 'not_editable', project_id: null, request_id: null, seq: null, position: null, released: null});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.read_project_request: the review', () => {
  it('answers each picture\'s label and measurements, the obstruction confirmation and the acknowledgment with their times, and nothing else new', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const unreviewed = await asService(client, 'select * from api.read_project_request($1, $2, $3)', [a.accountId, a.epoch, projectId]);
      expect(unreviewed).toMatchObject({outcome: 'found', confirmed: false, obstruction_confirmed: false, obstruction_confirmed_at: null, acknowledged: false, acknowledged_at: null});
      expect(unreviewed.images.map((image: Record<string, unknown>) => Object.keys(image).sort())).toEqual(
        Array(3).fill(['available', 'blur_variance', 'clipped_fraction', 'content_type', 'expires_at', 'label', 'length', 'position', 'sha256', 'short_edge_px', 'upload_id']),
      );
      expect(unreviewed.images.map((image: Record<string, unknown>) => [image.label, image.short_edge_px, image.blur_variance, image.clipped_fraction])).toEqual(Array(3).fill([null, null, null, null]));

      const pictures: Picture[] = [sharp('front'), {label: 'left', short: 700, blur: 41.5, clipped: 0.4}, sharp('detail')];
      const done = await review(client, a, {project: projectId, seq: 1, mode: 'image_direct', images: imagesJson(set, pictures), acknowledge: true});
      expect(done.outcome).toBe('created');
      const read = await asService(client, 'select * from api.read_project_request($1, $2, $3)', [a.accountId, a.epoch, projectId]);
      expect(read).toMatchObject({outcome: 'found', seq: 2, mode: 'image_direct', confirmed: true, scope: SCOPE, intended_outcome: OUTCOME, description: null, subject_id: null, obstruction_confirmed: true, acknowledged: true});
      expect(read.obstruction_confirmed_at).toBeInstanceOf(Date);
      expect(read.acknowledged_at).toBeInstanceOf(Date);
      expect(read.images.map((image: Record<string, unknown>) => [image.position, image.label, image.short_edge_px, image.blur_variance, image.clipped_fraction])).toEqual([
        [1, 'front', 1200, 412.375, 0.0213],
        [2, 'left', 700, 41.5, 0.4],
        [3, 'detail', 1200, 412.375, 0.0213],
      ]);
      // Never a key, an address or a download, and never the digest of the acknowledgment.
      expect(JSON.stringify(read)).not.toMatch(/storage|bucket|https?:|ticket|handle|signed|download|incomplete_acknowledged/i);
    });
  });

  it('answers the view\'s columns in order, the new ones last', async () => {
    const {rows: columns} = await db.query(
      `select a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'api' and c.relname = 'project_request_view' and a.attnum > 0 and not a.attisdropped order by a.attnum`,
    );
    expect(columns.map((row) => row.attname)).toEqual([
      'outcome', 'request_id', 'project_id', 'seq', 'mode', 'subject_id', 'scope', 'intended_outcome', 'description', 'personalization_wording', 'personalization_text', 'personalization_style',
      'personalization_applied', 'personalization_reason', 'confirmed_at', 'confirmed', 'images', 'obstruction_confirmed', 'obstruction_confirmed_at', 'acknowledged', 'acknowledged_at',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the rule: the database and lib/picture-quality.ts agree on every case', () => {
  const edge = (label: ViewLabel, patch: Partial<Picture> = {}): Picture => ({label, short: 800, blur: 100, clipped: 0.35, ...patch});
  const cases: [string, Picture[]][] = [
    ['three views at every edge', [edge('front'), edge('left'), edge('top')]],
    ['short edge 799', [edge('front', {short: 799}), edge('left'), edge('top')]],
    ['short edge 800', [edge('front', {short: 800}), edge('left'), edge('top')]],
    ['blur 99.999', [edge('front', {blur: 99.999}), edge('left'), edge('top')]],
    ['blur 100', [edge('front', {blur: 100}), edge('left'), edge('top')]],
    ['blur 100.001', [edge('front', {blur: 100.001}), edge('left'), edge('top')]],
    ['clipped 0.35', [edge('front', {clipped: 0.35}), edge('left'), edge('top')]],
    ['clipped 0.3501', [edge('front', {clipped: 0.3501}), edge('left'), edge('top')]],
    ['clipped 0.3499', [edge('front', {clipped: 0.3499}), edge('left'), edge('top')]],
    ['two views', [edge('front'), edge('left')]],
    ['front, front, detail', [edge('front'), edge('front'), edge('detail')]],
    ['front, back, detail', [edge('front'), edge('back'), edge('detail')]],
    ['front, back, left, detail', [edge('front'), edge('back'), edge('left'), edge('detail')]],
    ['detail only', [edge('detail'), edge('detail'), edge('detail')]],
    ['six angles', [edge('front'), edge('back'), edge('left'), edge('right'), edge('top'), edge('bottom')]],
    ['one picture', [edge('front')]],
    ['a blurry detail among three views', [edge('front'), edge('left'), edge('top'), edge('detail', {blur: 3})]],
    ['an over-exposed picture of the fourth view', [edge('front'), edge('left'), edge('top'), edge('back', {clipped: 0.9})]],
    ['flat, tiny and blown out', [edge('front', {short: 10, blur: 0, clipped: 1}), edge('left'), edge('top')]],
    ['twelve good views of three angles', Array.from({length: 12}, (_, index) => edge((['front', 'left', 'top'] as ViewLabel[])[index % 3]))],
  ];

  it.each(cases)('%s', async (_name, pictures) => {
    const measurements: Measurements[] = pictures.map((picture) => ({shortEdgePx: picture.short, blurVariance: picture.blur, clippedFraction: picture.clipped}));
    const json = pictures.map((picture) => ({upload_id: randomUUID(), label: picture.label, short_edge_px: picture.short, blur_variance: picture.blur, clipped_fraction: picture.clipped}));
    const {rows: result} = await db.query('select projects.picture_review_images_valid($1::jsonb) as valid, projects.picture_review_incomplete($1::jsonb) as incomplete', [JSON.stringify(json)]);
    expect(result[0].valid).toBe(true);
    expect(result[0].incomplete).toBe(incomplete(pictures.map((picture) => picture.label), measurements));
  });

  it('agrees on 400 random sets, including the values either side of every threshold', async () => {
    const labels = viewLabels as readonly ViewLabel[];
    let seed = 20261020;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const pick = <T,>(values: readonly T[]) => values[Math.floor(next() * values.length)];
    for (let round = 0; round < 400; round += 1) {
      const count = 1 + Math.floor(next() * 12);
      const pictures: Picture[] = Array.from({length: count}, () => ({
        label: pick(labels),
        short: pick([1, 799, 800, 801, 1200, 4000]),
        blur: pick([0, 99.999, 100, 100.001, 412.375, 1040400]),
        clipped: pick([0, 0.3499, 0.35, 0.3501, 0.9, 1]),
      }));
      const json = pictures.map((picture) => ({upload_id: randomUUID(), label: picture.label, short_edge_px: picture.short, blur_variance: picture.blur, clipped_fraction: picture.clipped}));
      const {rows: result} = await db.query('select projects.picture_review_incomplete($1::jsonb) as incomplete', [JSON.stringify(json)]);
      const measurements = pictures.map((picture) => ({shortEdgePx: picture.short, blurVariance: picture.blur, clippedFraction: picture.clipped}));
      expect(result[0].incomplete, JSON.stringify(pictures)).toBe(incomplete(pictures.map((picture) => picture.label), measurements));
    }
  });

  it('builds the acknowledgment\'s digest as the module\'s text hashed, for any scope and outcome, including Hebrew, emoji and the empty-looking', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const uuids = ids(set);
      for (const [scope, outcome] of [
        ['The altar', 'A model'],
        ['מזבח ושביל', 'מודל להדפסה'],
        ['Scope 😀 with emoji', 'é à ü'],
        ['x'.repeat(300), 'y'.repeat(300)],
      ]) {
        const labels = ['front', 'left', 'detail'];
        const {rows} = await client.query('select projects.picture_review_digest($1, $2, $3, $4, $5) as digest', [a.accountId, scope, outcome, uuids, labels]);
        const expected = createHash('sha256')
          .update(reviewDigestInput({scope, outcome, images: set.map((entry, index) => ({uploadId: entry.id, sha256: entry.sha, label: labels[index] as ViewLabel}))}), 'utf8')
          .digest('hex');
        expect(rows[0].digest, scope).toBe(expected);
      }
      // Null when an upload is not the Account's own picture lease.
      const other = await account(client);
      const {rows: foreign} = await client.query('select projects.picture_review_digest($1, $2, $3, $4, $5) as digest', [other.accountId, 'a', 'b', uuids, ['front', 'left', 'detail']]);
      expect(foreign[0].digest).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the record: checks, immutability and closure', () => {
  async function fixtures(client: Client) {
    const a = await account(client);
    const set = await leases(client, a, 1);
    const made = await pictureProject(client, a, set);
    return {a, set, ...made};
  }
  const insertRevision = async (client: Client, who: Fixture, projectId: string, seq: number, patch: Record<string, unknown>) => {
    const v = {mode: 'image_direct', scope: null, outcome: null, description: null, subject_id: null, confirmed_at: null, obstruction_confirmed_at: null, incomplete_acknowledged_at: null, incomplete_acknowledged_digest: null, ...patch};
    return attempt(
      client,
      null,
      `insert into projects.request_revisions (project_id, account_id, seq, command_id, mode, subject_id, scope, outcome, description, personalization_applied, digest, confirmed_at,
                                                obstruction_confirmed_at, incomplete_acknowledged_at, incomplete_acknowledged_digest)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, $10, $11, $12, $13, $14) returning id`,
      [projectId, who.accountId, seq, randomUUID(), v.mode, v.subject_id, v.scope, v.outcome, v.description, 'a'.repeat(64), v.confirmed_at, v.obstruction_confirmed_at, v.incomplete_acknowledged_at, v.incomplete_acknowledged_digest],
    );
  };

  it('allows a confirmed image_direct revision with no description and no subject, and still requires one of a confirmed text or evidence-backed request', async () => {
    await inTx(async (client) => {
      const { a, projectId } = await fixtures(client);
      const now = new Date();
      expect((await insertRevision(client, a, projectId, 2, {mode: 'image_direct', scope: 'S', outcome: 'O', confirmed_at: now})).ok).toBe(true);
      // With a description and a subject, as Story 2.1's tests insert one, it still passes.
      expect((await insertRevision(client, a, projectId, 3, {mode: 'image_direct', scope: 'S', outcome: 'O', confirmed_at: now, description: 'D', subject_id: 'middot-altar-ramp'})).ok).toBe(true);
      for (const [seq, patch] of [
        [4, {mode: 'evidence_images', scope: 'S', outcome: 'O', confirmed_at: now}],
        [5, {mode: 'evidence_text', subject_id: 'middot-altar-ramp', scope: 'S', outcome: 'O', confirmed_at: now}],
      ] as const) {
        const refused = await insertRevision(client, a, projectId, seq, patch);
        expect(refused.ok, JSON.stringify(patch)).toBe(false);
        if (!refused.ok) expect(refused.code).toBe('23514');
      }
    });
  });

  it('refuses a half-confirmed revision: a time without a scope or an outcome, a scope without a time, and a description on an unconfirmed one', async () => {
    await inTx(async (client) => {
      const { a, projectId } = await fixtures(client);
      const now = new Date();
      const cases: Record<string, unknown>[] = [
        {confirmed_at: now, scope: 'S', outcome: null},
        {confirmed_at: now, scope: null, outcome: 'O'},
        {confirmed_at: null, scope: 'S', outcome: 'O'},
        {confirmed_at: null, scope: null, outcome: null, description: 'D'},
        {confirmed_at: now, scope: null, outcome: null},
      ];
      for (const [index, patch] of cases.entries()) {
        const refused = await insertRevision(client, a, projectId, 10 + index, patch);
        expect(refused.ok, JSON.stringify(patch)).toBe(false);
        if (!refused.ok) expect(refused.code).toBe('23514');
      }
    });
  });

  it('allows an acknowledgment only on a confirmed image_direct revision that also confirmed the obstruction question, both parts or neither', async () => {
    await inTx(async (client) => {
      const { a, projectId } = await fixtures(client);
      const now = new Date();
      const confirmed = {mode: 'image_direct', scope: 'S', outcome: 'O', confirmed_at: now, obstruction_confirmed_at: now};
      expect((await insertRevision(client, a, projectId, 2, {...confirmed, incomplete_acknowledged_at: now, incomplete_acknowledged_digest: 'b'.repeat(64)})).ok).toBe(true);
      const refused: [string, Record<string, unknown>][] = [
        ['a time without a digest', {...confirmed, incomplete_acknowledged_at: now}],
        ['a digest without a time', {...confirmed, incomplete_acknowledged_digest: 'b'.repeat(64)}],
        ['a digest that is not hex', {...confirmed, incomplete_acknowledged_at: now, incomplete_acknowledged_digest: 'XYZ'}],
        ['an upper-case digest', {...confirmed, incomplete_acknowledged_at: now, incomplete_acknowledged_digest: 'B'.repeat(64)}],
        ['research-assisted', {mode: 'evidence_images', obstruction_confirmed_at: now, incomplete_acknowledged_at: now, incomplete_acknowledged_digest: 'b'.repeat(64)}],
        ['an unconfirmed direct revision', {mode: 'image_direct', obstruction_confirmed_at: now, incomplete_acknowledged_at: now, incomplete_acknowledged_digest: 'b'.repeat(64)}],
        ['no obstruction confirmation', {...confirmed, obstruction_confirmed_at: null, incomplete_acknowledged_at: now, incomplete_acknowledged_digest: 'b'.repeat(64)}],
        ['an obstruction confirmation on a text request', {mode: 'evidence_text', subject_id: 'middot-altar-ramp', scope: 'S', outcome: 'O', description: 'D', confirmed_at: now, obstruction_confirmed_at: now}],
      ];
      for (const [index, [name, patch]] of refused.entries()) {
        const result = await insertRevision(client, a, projectId, 10 + index, patch);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('23514');
      }
    });
  });

  it('checks a picture\'s label and measurements: all four or none, the seven labels, and the ranges', async () => {
    await inTx(async (client) => {
      const { a, projectId, requestId, set } = await fixtures(client);
      const insert = (patch: Record<string, unknown>, position: number) => {
        const v = {view_label: 'front', short_edge_px: 900, blur_variance: 120, clipped_fraction: 0.1, ...patch};
        return attempt(
          client,
          null,
          `insert into projects.request_images (revision_id, project_id, account_id, position, upload_id, sha256, length, content_type, view_label, short_edge_px, blur_variance, clipped_fraction)
           values ($1, $2, $3, $4, $5, $6, 1000, 'image/png', $7, $8, $9, $10) returning position`,
          [requestId, projectId, a.accountId, position, randomUUID(), 'c'.repeat(64), v.view_label, v.short_edge_px, v.blur_variance, v.clipped_fraction],
        );
      };
      expect(set).toHaveLength(1);
      expect((await insert({}, 2)).ok).toBe(true);
      expect((await insert({view_label: null, short_edge_px: null, blur_variance: null, clipped_fraction: null}, 3)).ok).toBe(true);
      const refused: [string, Record<string, unknown>][] = [
        ['a label with no measurements', {short_edge_px: null, blur_variance: null, clipped_fraction: null}],
        ['measurements with no label', {view_label: null}],
        ['only one measurement missing', {blur_variance: null}],
        ['a label that is not one of the seven', {view_label: 'side'}],
        ['a short edge of 0', {short_edge_px: 0}],
        ['a negative blur', {blur_variance: -0.001}],
        ['a blur above 1,040,400', {blur_variance: 1040400.001}],
        ['a clipped share above 1', {clipped_fraction: 1.0001}],
        ['a negative clipped share', {clipped_fraction: -0.0001}],
      ];
      for (const [index, [name, patch]] of refused.entries()) {
        const result = await insert(patch, 4 + index);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(['23514', '22003'], name).toContain(result.code);
      }
      // The three decimals and four decimals are the columns' own.
      const {rows} = await client.query(`select numeric_scale as scale, column_name from information_schema.columns where table_schema = 'projects' and table_name = 'request_images' and column_name in ('blur_variance', 'clipped_fraction') order by column_name`);
      expect(rows).toEqual([{scale: 3, column_name: 'blur_variance'}, {scale: 4, column_name: 'clipped_fraction'}]);
    });
  });

  it('never edits a reviewed revision or its pictures: an update of the new columns is refused', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { requestId } = await reviewedProject(client, a);
      for (const sql of [
        `update projects.request_revisions set obstruction_confirmed_at = null where id = $1`,
        `update projects.request_revisions set incomplete_acknowledged_at = clock_timestamp(), incomplete_acknowledged_digest = repeat('a', 64) where id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [requestId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code).toBe('55000');
      }
      const image = await attempt(client, null, `update projects.request_images set view_label = 'back' where revision_id = $1`, [requestId]);
      expect(image.ok).toBe(false);
      if (!image.ok) expect(image.code).toBe('55000');
    });
  });

  it('is closed: the service role may execute the writer and the read and nothing of the helpers; anon and authenticated may execute none of them', async () => {
    const execute = async (role: string, signature: string) => (await db.query(`select has_function_privilege($1, $2, 'execute') as allowed`, [role, signature])).rows[0].allowed as boolean;
    const writer = 'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)';
    expect(await execute('service_role', writer)).toBe(true);
    expect(await execute('service_role', 'api.read_project_request(uuid,bigint,uuid)')).toBe(true);
    for (const role of ['anon', 'authenticated', 'public']) {
      expect(await execute(role, writer), role).toBe(false);
      expect(await execute(role, 'api.read_project_request(uuid,bigint,uuid)'), role).toBe(false);
    }
    for (const helper of [
      'projects.picture_review_images_valid(jsonb)',
      'projects.picture_review_incomplete(jsonb)',
      'projects.picture_review_digest(uuid,text,text,uuid[],text[])',
      'projects.picture_review_command_digest(uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)',
    ]) {
      for (const role of ['service_role', 'anon', 'authenticated']) expect(await execute(role, helper), `${role} ${helper}`).toBe(false);
    }
    // The writer is a definer with an empty search path.
    const {rows} = await db.query(`select prosecdef, proconfig from pg_proc where oid = 'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)'::regprocedure`);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toEqual(['search_path=""']);
    // The tables stay closed: no policy, no privilege.
    for (const table of ['projects.request_revisions', 'projects.request_images']) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        expect((await db.query(`select has_table_privilege($1, $2, 'select') as allowed`, [role, table])).rows[0].allowed, `${role} ${table}`).toBe(false);
      }
    }
  });

  it('is reached by no function that names handle, and the function names are the story\'s', async () => {
    const {rows} = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('api', 'projects') and p.proname like '%picture_review%' order by p.proname`);
    expect(rows.map((row) => row.proname)).toEqual(['picture_review_command_digest', 'picture_review_digest', 'picture_review_images_valid', 'picture_review_incomplete', 'record_picture_review']);
    for (const row of rows) expect(row.proname).not.toContain('handle');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.preflight after the Story 2.3 migration', () => {
  it('answers ok, and reads the new columns and functions', async () => {
    await inTx(async (client) => {
      expect((await asService(client, 'select ok from api.preflight()', [])).ok).toBe(true);
    });
    const {rows} = await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as def`);
    const def = rows[0].def as string;
    for (const needle of ['q.obstruction_confirmed_at', 'q.incomplete_acknowledged_at', 'q.incomplete_acknowledged_digest', 'y.view_label', 'y.short_edge_px', 'y.blur_variance', 'y.clipped_fraction', 'the Story 2.3 migration is not applied', 'api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)', 'the Story 2.2 migration is not applied']) {
      expect(def, needle).toContain(needle);
    }
    expect([...def.matchAll(/^\s+'api\.[a-z_]+\(/gm)].length).toBeGreaterThanOrEqual(36);
  });

  it('refuses with one line naming the Story 2.3 migration when the writer is missing', async () => {
    await inTx(async (client) => {
      await client.query('drop function api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)');
      const result = await attempt(client, 'service_role', 'select ok from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toMatch(/the Story 2\.3 migration is not applied/);
        expect(result.message).toContain('api.record_picture_review');
      }
    });
  });

  it('refuses when the service role cannot execute the writer', async () => {
    await inTx(async (client) => {
      await client.query('revoke execute on function api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean) from service_role');
      const result = await attempt(client, 'service_role', 'select ok from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('api.record_picture_review');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('two connections and the typed calls over REST', () => {
  it('records one revision when two connections send the same command at once: the second is the first\'s replay', async () => {
    const a = await committedAccount();
    const set = await leases(db, a, 3);
    left.push(...ids(set));
    const made = await db.query('select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), null, 'Picture request', ids(set)]);
    const projectId = made.rows[0].project_id as string;
    const other = await connect();
    const command = randomUUID();
    const images = JSON.stringify(imagesJson(set, threeViews()));
    const send = (client: Client) => client.query(reviewSql, [a.accountId, a.epoch, command, projectId, 1, 'image_direct', SCOPE, OUTCOME, images, true, false]);
    const [first, second] = await Promise.all([send(db), send(other)]);
    expect([first.rows[0].outcome, second.rows[0].outcome].sort()).toEqual(['created', 'replayed']);
    expect(first.rows[0].request_id).toBe(second.rows[0].request_id);
    expect((await revisionsOf(db, a.accountId)).length).toBe(2);
    expect((await projectsOf(db, a.accountId))[0].revision).toBe(2);
  });

  it('serves two different reviews of one revision once: the second is `stale`, whichever arrives first', async () => {
    const a = await committedAccount();
    const set = await leases(db, a, 3);
    left.push(...ids(set));
    const made = await db.query('select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), null, 'Picture request', ids(set)]);
    const projectId = made.rows[0].project_id as string;
    const other = await connect();
    const images = JSON.stringify(imagesJson(set, threeViews()));
    const direct = db.query(reviewSql, [a.accountId, a.epoch, randomUUID(), projectId, 1, 'image_direct', SCOPE, OUTCOME, images, true, false]);
    const research = other.query(reviewSql, [a.accountId, a.epoch, randomUUID(), projectId, 1, 'evidence_images', null, null, images, true, false]);
    const outcomes = (await Promise.all([direct, research])).map((result) => result.rows[0].outcome as string).sort();
    expect(outcomes).toEqual(['created', 'stale']);
    expect((await revisionsOf(db, a.accountId)).length).toBe(2);
  });

  it('waits for a tombstone of the Project and then is `unavailable`, or commits first and is then hidden: never a revision on a deleted Project', async () => {
    const a = await committedAccount();
    const set = await leases(db, a, 1);
    left.push(...ids(set));
    const made = await db.query('select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), null, 'Picture request', ids(set)]);
    const projectId = made.rows[0].project_id as string;
    const other = await connect();
    const hiding = other.query('select outcome from api.record_tombstone($1, $2)', ['project', projectId]);
    const reviewing = db.query(reviewSql, [a.accountId, a.epoch, randomUUID(), projectId, 1, 'evidence_images', null, null, JSON.stringify(imagesJson(set, [sharp('front')])), true, false]);
    const [tombstone, reviewed] = await Promise.all([hiding, reviewing]);
    expect(tombstone.rows[0].outcome).toBe('recorded');
    expect(['created', 'unavailable']).toContain(reviewed.rows[0].outcome);
    const revisions = await revisionsOf(db, a.accountId);
    expect(revisions.length).toBe(reviewed.rows[0].outcome === 'created' ? 2 : 1);
  });

  it('records through the typed calls over REST, reads the review back, and replays', async () => {
    const a = await committedAccount();
    const set = await leases(db, a, 3);
    left.push(...ids(set));
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const options = {env};
    const saved = await recordPictureSet(operation, {commandId: randomUUID(), projectId: null, title: 'Picture request', uploadIds: ids(set)}, options);
    expect(saved.outcome).toBe('created');
    if (saved.outcome !== 'created') return;
    const input = {
      commandId: randomUUID(),
      projectId: saved.projectId,
      expectedSeq: 1,
      mode: 'image_direct' as const,
      scope: SCOPE,
      outcome: OUTCOME,
      images: set.map((entry, index) => ({uploadId: entry.id, label: threeViews()[index].label, shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213})),
      obstructionConfirmed: true,
      acknowledge: false,
    };
    const done = await recordPictureReview(operation, input, options);
    expect(done).toMatchObject({outcome: 'created', projectId: saved.projectId, seq: 2});
    expect(await recordPictureReview(operation, input, options)).toMatchObject({outcome: 'replayed', projectId: saved.projectId, seq: 2});
    expect(await recordPictureReview(operation, {...input, commandId: randomUUID()}, options)).toMatchObject({outcome: 'stale', seq: 2});
    expect(await recordPictureReview(operation, {...input, commandId: input.commandId, scope: 'Another'}, options)).toEqual({outcome: 'reused'});
    const read = await readProjectRequest(operation, saved.projectId, options);
    expect(read).toMatchObject({
      outcome: 'found',
      request: {
        seq: 2,
        mode: 'image_direct',
        confirmed: true,
        subjectId: null,
        description: null,
        scope: SCOPE,
        outcome: OUTCOME,
        obstructionConfirmed: true,
        acknowledged: false,
        images: [
          {position: 1, label: 'front', shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213},
          {position: 2, label: 'left', shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213},
          {position: 3, label: 'top', shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213},
        ],
      },
    });
    expect(await recordPictureReview(operation, {...input, commandId: randomUUID(), expectedSeq: 2, mode: 'evidence_images', scope: null, outcome: null}, options)).toMatchObject({outcome: 'created', seq: 3});
    expect((await readProjectRequest(operation, saved.projectId, options)).outcome).toBe('found');
    const stage = (await db.query('select stage from projects.projects where id = $1', [saved.projectId])).rows[0].stage;
    expect(stage).toBe('request_draft');
  });

  it('answers a refusal of the database as an error that says the review certainly was not recorded, and an unknown outcome as an error', async () => {
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const input = {
      commandId: randomUUID(),
      projectId: randomUUID(),
      expectedSeq: 1,
      mode: 'image_direct' as const,
      scope: ' bad ',
      outcome: 'O',
      images: [{uploadId: randomUUID(), label: 'front' as const, shortEdgePx: 900, blurVariance: 120, clippedFraction: 0}],
      obstructionConfirmed: true,
      acknowledge: false,
    };
    await expect(recordPictureReview(operation, input, {env})).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: false, code: '22023'});
    expect(await recordPictureReview(operation, {...input, scope: 'good'}, {env})).toEqual({outcome: 'unavailable'});
  });
});
