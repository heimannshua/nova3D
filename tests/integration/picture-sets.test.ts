import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {readProjectRequest, recordPictureSet, releaseStagedPictures, renameProjectCommand} from '@/lib/projects';
import {createHarness, stack} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 2.2 against the Supabase CLI stack: the pictures of a request, kept privately. The unconfirmed state of a request revision, the closed table of
// its ordered pictures (projects.request_images), the trigger that numbers revisions, the one idempotent writer of a picture revision and of the Project
// the first one is born with (api.record_picture_set), the release of uploads that were never saved (api.release_staged_pictures), the read of the pictures
// (api.read_project_request), the rename that now refuses a command ID a revision used, and the preflight. Every database-level row of the I/O matrix.
//
// Most cases run inside a transaction that is rolled back, as the service role, with leases inserted directly as the table owner (so a case chooses the
// state, the creation time and the expiry a lease has; the gateway that really makes them is tests/integration/file-gateway.test.ts). The cases that need
// several real connections, and the typed calls the application makes over REST, commit data: the Accounts and their Projects are removed afterwards
// (tests/support/accounts-data.ts deletes pictures before revisions), and the leases, which are never deleted, are moved to `deleted`.

const {db, connect, committed, inTx, addUser, attempt, rows} = createHarness();

let env: Record<string, string>;
/** Leases a committing case made: moved to `deleted` when the file is done, so the hourly cleanup's list and the quota stay as they were. */
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

const MiB = 1024 * 1024;

// Fixtures ---------------------------------------------------------------------------------------------------------------------

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; epoch: number};

/** An Account with its Workspace, made the way registration makes one (identity.activate_account). */
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

/** A Project, inserted directly (the owner can). A Project made this way has no request revision. */
async function project(client: Client, owner: Fixture, options: {title?: string; stage?: string} = {}): Promise<string> {
  const {rows: made} = await client.query(`insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, $3, $4) returning id`, [
    owner.workspaceId,
    owner.accountId,
    options.title ?? 'Courtyard bench',
    options.stage ?? 'researching',
  ]);
  return made[0].id as string;
}

type Lease = {id: string; sha: string; length: number; ct: string};
type LeaseOptions = {
  kind?: 'picture' | 'file';
  length?: number;
  ct?: string;
  state?: 'receiving' | 'complete' | 'attached' | 'released' | 'deleted';
  /** Seconds since the lease was created (the database's clock). */
  age?: number;
  /** Seconds until the lease expires (negative: it has expired). */
  expires?: number;
  sha?: string;
};

/** A staging lease, inserted as the owner: a complete, unexpired picture of a thousand bytes unless the options say otherwise. */
async function lease(client: Client, owner: Fixture | string, options: LeaseOptions = {}): Promise<Lease> {
  const kind = options.kind ?? 'picture';
  const state = options.state ?? 'complete';
  const length = options.length ?? 1000;
  const ct = options.ct ?? (kind === 'picture' ? 'image/png' : 'application/octet-stream');
  const sha = options.sha ?? randomBytes(32).toString('hex');
  const id = randomUUID();
  await client.query(
    `insert into artifacts.staging_leases (id, account_id, kid, kind, length, sha256, content_type, received_length, state, created_at, expires_at)
     values ($1, $2, 'test-kid', $3, $4, $5, $6, $7, $8, clock_timestamp() - make_interval(secs => $9::float8), clock_timestamp() + make_interval(secs => $10::float8))`,
    [id, typeof owner === 'string' ? owner : owner.accountId, kind, length, sha, ct, state === 'receiving' ? 0 : length, state, options.age ?? 60, options.expires ?? 20 * 3600],
  );
  return {id, sha, length, ct};
}
async function leases(client: Client, owner: Fixture | string, count: number, options: LeaseOptions = {}): Promise<Lease[]> {
  const made: Lease[] = [];
  for (let index = 0; index < count; index += 1) made.push(await lease(client, owner, options));
  return made;
}
const ids = (set: Lease[]) => set.map((entry) => entry.id);
const leaseRow = async (client: Client, id: string) =>
  (await client.query('select id, state, created_at, expires_at, received_length::int as received, length::int as length from artifacts.staging_leases where id = $1', [id])).rows[0];
const dbNow = async (client: Client) => (await client.query('select clock_timestamp() as now')).rows[0].now as Date;

const TITLE = 'Picture request';
type Save = {epoch?: number | null; command?: string | null; project?: string | null; title?: string | null; uploads: (string | null)[] | string | null};
const recordSql = 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)';
const recordValues = (who: Fixture, save: Save) => [
  who.accountId,
  save.epoch === undefined ? who.epoch : save.epoch,
  save.command === undefined ? randomUUID() : save.command,
  save.project ?? null,
  save.title === undefined ? (save.project ? null : TITLE) : save.title,
  save.uploads,
];
const recordRaw = (client: Client, who: Fixture, save: Save) => attempt(client, 'service_role', recordSql, recordValues(who, save));
async function record(client: Client, who: Fixture, save: Save) {
  const result = await recordRaw(client, who, save);
  if (!result.ok) throw new Error(`api.record_picture_set failed: ${result.message}`);
  return result.rows[0] as {outcome: string; project_id: string | null; request_id: string | null; seq: number | null; position: number | null; released: number | null};
}
/** The same calls on a connection that is not in a transaction (the committed cases): no savepoint, so a refusal is an exception. */
const recordCommitted = async (client: Client, who: Fixture, save: Save) => (await client.query(recordSql, recordValues(who, save))).rows[0] as Awaited<ReturnType<typeof record>>;
const readCommitted = async (client: Client, who: Fixture, projectId: string, epoch: number = who.epoch) =>
  (await client.query('select * from api.read_project_request($1, $2, $3)', [who.accountId, epoch, projectId])).rows[0];
async function committedPictureProject(who: Fixture, set: Lease[]) {
  const made = await recordCommitted(db, who, {uploads: ids(set)});
  expect(made.outcome).toBe('created');
  return {projectId: made.project_id as string, requestId: made.request_id as string};
}
const nothingRecorded = {project_id: null, request_id: null, seq: null, position: null, released: null};
const asService = async (client: Client, sql: string, params: unknown[]) => (await rows(client, 'service_role', sql, params))[0];
const read = (client: Client, who: Fixture, projectId: string, epoch: number = who.epoch) => asService(client, 'select * from api.read_project_request($1, $2, $3)', [who.accountId, epoch, projectId]);
const release = (client: Client, who: Fixture, uploads: (string | null)[] | string | null, epoch: number = who.epoch) =>
  attempt(client, 'service_role', 'select * from api.release_staged_pictures($1, $2, $3)', [who.accountId, epoch, uploads]);
const rename = (client: Client, who: Fixture, input: {projectId: string; title: string; command: string; expected?: number}) =>
  asService(client, 'select * from api.rename_project($1, $2, $3, $4, $5, $6)', [who.accountId, who.epoch, input.command, input.projectId, input.expected ?? 1, input.title]);

/** The digest the function builds: SHA-256 of 'record_picture_set', a newline, the project (a dash when creating), then for each position the position, the upload, its SHA-256, length and type, each `<byte length>:<value>`. */
const part = (value: string | null) => (value === null ? '-' : `${Buffer.byteLength(value, 'utf8')}:${value}`);
const digestOf = (projectId: string | null, set: Lease[]) =>
  createHash('sha256')
    .update(`record_picture_set\n${part(projectId)}${set.map((entry, index) => [String(index + 1), entry.id, entry.sha, String(entry.length), entry.ct].map(part).join('')).join('')}`, 'utf8')
    .digest('hex');

const projectsOf = async (client: Client, accountId: string) =>
  (await client.query('select id, title, stage, current_version, revision::int as revision, workspace_id, created_at, updated_at, deleted_at from projects.projects where account_id = $1 order by created_at, id', [accountId])).rows;
const revisionsOf = async (client: Client, accountId: string) =>
  (
    await client.query(
      `select id, project_id, seq, command_id, mode, subject_id, scope, outcome, description, personalization_wording as wording, personalization_text as text,
              personalization_style as style, personalization_applied as applied, personalization_reason as reason, digest, confirmed_at, created_at
         from projects.request_revisions where account_id = $1 order by project_id, seq`,
      [accountId],
    )
  ).rows;
const imagesOf = async (client: Client, revisionId: string) =>
  (await client.query('select position, upload_id, sha256, length::int as length, content_type from projects.request_images where revision_id = $1 order by position', [revisionId])).rows;
const counts = async (client: Client, accountId: string) => ({
  projects: (await projectsOf(client, accountId)).length,
  revisions: (await revisionsOf(client, accountId)).length,
  images: (await client.query('select count(*)::int as n from projects.request_images where account_id = $1', [accountId])).rows[0].n as number,
});
/** Everything a command could have written or changed for the Account and these leases, to compare before and after a refusal. */
async function snapshot(client: Client, who: Fixture, uploadIds: string[] = []) {
  return {
    projects: await projectsOf(client, who.accountId),
    revisions: await revisionsOf(client, who.accountId),
    images: (await client.query('select revision_id, position, upload_id from projects.request_images where account_id = $1 order by revision_id, position', [who.accountId])).rows,
    leases: (await client.query('select id, state, expires_at from artifacts.staging_leases where id = any($1) order by id', [uploadIds])).rows,
  };
}

/** A picture Project made by the writer under test: its first revision holds `set`. */
async function pictureProject(client: Client, who: Fixture, set: Lease[]) {
  const made = await record(client, who, {uploads: ids(set)});
  expect(made.outcome).toBe('created');
  return {projectId: made.project_id as string, requestId: made.request_id as string};
}

/** A revision inserted directly as the owner, to check the table's own rules. Every field can be changed with `patch`. */
async function insertRevision(client: Client, owner: Fixture, projectId: string, patch: Record<string, unknown> = {}) {
  const v = {
    seq: 1,
    command_id: randomUUID(),
    mode: 'evidence_images',
    subject_id: null,
    scope: null,
    outcome: null,
    description: null,
    personalization_wording: null,
    personalization_text: null,
    personalization_style: null,
    personalization_applied: false,
    personalization_reason: null,
    digest: 'a'.repeat(64),
    confirmed_at: null,
    account_id: owner.accountId,
    ...patch,
  };
  return attempt(
    client,
    null,
    `insert into projects.request_revisions (project_id, account_id, seq, command_id, mode, subject_id, scope, outcome, description, personalization_wording, personalization_text,
                                              personalization_style, personalization_applied, personalization_reason, digest, confirmed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
    [projectId, v.account_id, v.seq, v.command_id, v.mode, v.subject_id, v.scope, v.outcome, v.description, v.personalization_wording, v.personalization_text, v.personalization_style, v.personalization_applied, v.personalization_reason, v.digest, v.confirmed_at],
  );
}
/** An image inserted directly as the owner. */
async function insertImage(client: Client, revision: {id: string; projectId: string; accountId: string}, patch: Record<string, unknown> = {}) {
  const v = {
    revision_id: revision.id,
    project_id: revision.projectId,
    account_id: revision.accountId,
    position: 1,
    upload_id: randomUUID(),
    sha256: 'c'.repeat(64),
    length: 1000,
    content_type: 'image/png',
    ...patch,
  };
  return attempt(client, null, `insert into projects.request_images (revision_id, project_id, account_id, position, upload_id, sha256, length, content_type) values ($1, $2, $3, $4, $5, $6, $7, $8) returning position`, [
    v.revision_id,
    v.project_id,
    v.account_id,
    v.position,
    v.upload_id,
    v.sha256,
    v.length,
    v.content_type,
  ]);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until the backend is blocked on a lock, so a test knows the other connection really is waiting for it. */
async function untilBlocked(pid: number) {
  for (let attemptNumber = 0; attemptNumber < 100; attemptNumber += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await wait(50);
  }
  throw new Error('The other connection never started waiting for the lock.');
}

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: the first save creates the Project and its first picture revision', () => {
  it('creates both in the Account\'s Workspace in one transaction: the stage request_draft, revision 1, revision seq 1, the pictures in the person\'s order, the digest of the length-prefixed fields', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [first, second, third] = [await lease(client, a, {ct: 'image/png', length: 1111}), await lease(client, a, {ct: 'image/jpeg', length: 2222}), await lease(client, a, {ct: 'image/webp', length: 3333})];
      // The person's order is not the order the uploads were made in.
      const set = [third, first, second];
      const done = await record(client, a, {uploads: ids(set)});
      expect(done).toEqual({outcome: 'created', project_id: expect.stringMatching(/^[0-9a-f-]{36}$/), request_id: expect.stringMatching(/^[0-9a-f-]{36}$/), seq: 1, position: null, released: 0});

      const [stored] = await projectsOf(client, a.accountId);
      expect(stored).toMatchObject({id: done.project_id, title: TITLE, stage: 'request_draft', current_version: 0, revision: 1, workspace_id: a.workspaceId, deleted_at: null});
      const [revision] = await revisionsOf(client, a.accountId);
      expect(revision).toMatchObject({
        id: done.request_id,
        project_id: done.project_id,
        seq: 1,
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
        digest: digestOf(null, set),
      });
      // Each picture is what its LEASE says (the function takes nothing about a file from the caller), at the position the person gave it.
      expect(await imagesOf(client, done.request_id as string)).toEqual(
        set.map((entry, index) => ({position: index + 1, upload_id: entry.id, sha256: entry.sha, length: entry.length, content_type: entry.ct})),
      );
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 1, images: 3});
    });
  });

  it('takes the Account, epoch, command, Project, title and upload IDs and nothing about a file: no SHA-256, length or type is an argument', async () => {
    const {rows: signature} = await db.query(`select pg_get_function_arguments('api.record_picture_set(uuid,bigint,uuid,uuid,text,uuid[])'::regprocedure) as args`);
    expect(signature[0].args).toBe('p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_title text, p_upload_ids uuid[]');
    const {rows: release_} = await db.query(`select pg_get_function_arguments('api.release_staged_pictures(uuid,bigint,uuid[])'::regprocedure) as args`);
    expect(release_[0].args).toBe('p_account_id uuid, p_epoch bigint, p_upload_ids uuid[]');
  });

  it('records what the lease holds even when a lie would have been easy: the SHA-256, length and type of a picture are the lease\'s, whatever order or number', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = [await lease(client, a, {length: 12 * MiB, ct: 'image/webp'}), await lease(client, a, {length: 1, ct: 'image/jpeg'})];
      const done = await record(client, a, {uploads: ids(set)});
      expect(await imagesOf(client, done.request_id as string)).toEqual([
        {position: 1, upload_id: set[0].id, sha256: set[0].sha, length: 12 * MiB, content_type: 'image/webp'},
        {position: 2, upload_id: set[1].id, sha256: set[1].sha, length: 1, content_type: 'image/jpeg'},
      ]);
    });
  });

  it('accepts one picture and twelve, and keeps a title in any script', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      expect((await record(client, a, {uploads: ids(await leases(client, a, 1))})).outcome).toBe('created');
      expect((await record(client, a, {uploads: ids(await leases(client, a, 12)), title: 'בקשה מתמונות'})).outcome).toBe('created');
      const made = await projectsOf(client, a.accountId);
      expect(made.map((entry) => entry.title).sort()).toEqual([TITLE, 'בקשה מתמונות'].sort());
      expect((await counts(client, a.accountId)).images).toBe(13);
    });
  });

  it('renews every included lease to 24 hours from the database clock and leaves the others alone', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2, {age: 3600, expires: 600});
      const bystander = await lease(client, a, {expires: 600});
      const before = await dbNow(client);
      await record(client, a, {uploads: ids(set)});
      const after = await dbNow(client);
      for (const entry of set) {
        const row = await leaseRow(client, entry.id);
        expect(row.state).toBe('complete');
        expect(row.expires_at.getTime()).toBeGreaterThanOrEqual(before.getTime() + 24 * 3600_000);
        expect(row.expires_at.getTime()).toBeLessThanOrEqual(after.getTime() + 24 * 3600_000);
      }
      // A lease the revision does not carry is not renewed (and not released: nothing says it is the person's to give up).
      const other = await leaseRow(client, bystander.id);
      expect(other.state).toBe('complete');
      expect(other.expires_at.getTime()).toBeLessThan(before.getTime() + 3600_000);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: a successor', () => {
  it('appends seq + 1, raises the Project\'s revision by exactly one, sets updated_at, leaves the previous revision and its pictures as they were, and releases what left the set', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [one, two, three] = await leases(client, a, 3);
      const four = await lease(client, a, {ct: 'image/jpeg', length: 4444});
      const { projectId, requestId } = await pictureProject(client, a, [one, two, three]);
      const [before] = await projectsOf(client, a.accountId);
      const firstRevision = (await revisionsOf(client, a.accountId))[0];
      const firstImages = await imagesOf(client, requestId);

      const set = [three, two, four];
      const done = await record(client, a, {project: projectId, uploads: ids(set)});
      expect(done).toEqual({outcome: 'revised', project_id: projectId, request_id: expect.stringMatching(/^[0-9a-f-]{36}$/), seq: 2, position: null, released: 1});
      expect(done.request_id).not.toBe(requestId);

      const [after] = await projectsOf(client, a.accountId);
      expect(after).toMatchObject({id: projectId, title: TITLE, stage: 'request_draft', revision: 2, workspace_id: a.workspaceId});
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      expect(after.created_at).toEqual(before.created_at);
      const [revisionOne, revisionTwo] = await revisionsOf(client, a.accountId);
      // The previous revision is exactly as it was, and so are its pictures.
      expect(revisionOne).toEqual(firstRevision);
      expect(await imagesOf(client, requestId)).toEqual(firstImages);
      expect(revisionTwo).toMatchObject({id: done.request_id, seq: 2, mode: 'evidence_images', scope: null, confirmed_at: null, digest: digestOf(projectId, set)});
      expect(await imagesOf(client, done.request_id as string)).toEqual(set.map((entry, index) => ({position: index + 1, upload_id: entry.id, sha256: entry.sha, length: entry.length, content_type: entry.ct})));
      // The upload that left the set is released at once; the others are not, and the new one is kept.
      expect((await leaseRow(client, one.id)).state).toBe('released');
      for (const entry of set) expect((await leaseRow(client, entry.id)).state, entry.id).toBe('complete');
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 2, images: 6});
    });
  });

  it('numbers a third revision 3 and raises the Project to revision 3, and the read answers the latest', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, [set[0], set[1]]);
      expect((await record(client, a, {project: projectId, uploads: [set[1].id, set[0].id]})).seq).toBe(2);
      const third = await record(client, a, {project: projectId, uploads: [set[1].id, set[0].id, set[2].id]});
      expect(third).toMatchObject({outcome: 'revised', seq: 3, released: 0});
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({revision: 3});
      expect(await read(client, a, projectId)).toMatchObject({outcome: 'found', seq: 3, request_id: third.request_id});
    });
  });

  it('keeps an upload that another Project\'s latest revision still uses, and releases it once that Project has moved on', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [shared, mine, theirs, extra] = await leases(client, a, 4);
      const first = await pictureProject(client, a, [mine, shared]);
      const second = await pictureProject(client, a, [theirs, shared]);
      // The first Project drops `shared`; the second still uses it in its latest revision, so it stays.
      const dropped = await record(client, a, {project: first.projectId, uploads: [mine.id]});
      expect(dropped).toMatchObject({outcome: 'revised', released: 0});
      expect((await leaseRow(client, shared.id)).state).toBe('complete');
      // The second Project drops it too; nothing's latest revision uses it any more, so it is released.
      const moved = await record(client, a, {project: second.projectId, uploads: [theirs.id, extra.id]});
      expect(moved).toMatchObject({outcome: 'revised', released: 1});
      expect((await leaseRow(client, shared.id)).state).toBe('released');
    });
  });

  it('releases every upload the previous revision used that the new set does not, and only those (a lease the Account never saved is left alone)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 4);
      const stray = await lease(client, a);
      const { projectId } = await pictureProject(client, a, set);
      const done = await record(client, a, {project: projectId, uploads: [set[3].id]});
      expect(done).toMatchObject({outcome: 'revised', released: 3});
      for (const entry of set.slice(0, 3)) expect((await leaseRow(client, entry.id)).state).toBe('released');
      expect((await leaseRow(client, set[3].id)).state).toBe('complete');
      expect((await leaseRow(client, stray.id)).state).toBe('complete');
    });
  });

  it('holds the Project row FOR UPDATE before it reads the leases: a tombstone of the Project waits for a save that is still waiting for a lease row, and the save commits first', async () => {
    const a = await committedAccount();
    const set = await leases(db, a, 2);
    left.push(...ids(set));
    const { projectId } = await committedPictureProject(a, [set[0]]);
    const locker = await connect();
    const saver = await connect();
    const recorder = await connect();
    const [{pid: lockerPid}, {pid: saverPid}, {pid: recorderPid}] = await Promise.all(
      [locker, saver, recorder].map(async (client) => (await client.query('select pg_backend_pid() as pid')).rows[0] as {pid: number}),
    );
    const blockedBy = async (pid: number) => ((await db.query('select pg_blocking_pids($1) as pids', [pid])).rows[0].pids as number[]).sort();

    // A third connection holds one of the lease rows the save includes (the way a release or a renewal made by the gateway would).
    await locker.query('begin');
    await locker.query('select id from artifacts.staging_leases where id = $1 for update', [set[1].id]);

    // The save passes the Project row (it is locked FOR UPDATE at step 6) and then waits for the lease row at step 7: the lock it waits for is the third connection's.
    const saving = saver.query(recordSql, recordValues(a, {project: projectId, uploads: ids(set)}));
    let saved = false;
    saving.then(() => (saved = true), () => (saved = true));
    await untilBlocked(saverPid);
    expect(await blockedBy(saverPid)).toEqual([lockerPid]);

    // The tombstone takes the Project row FOR UPDATE too, so it waits for the save, which holds that row while it waits for the lease. (A save that only read the
    // Project would hold nothing here, and the tombstone would go straight through: this is the lock the test is about.)
    const hiding = recorder.query('select outcome from api.record_tombstone($1, $2)', ['project', projectId]);
    let hidden = false;
    hiding.then(() => (hidden = true), () => (hidden = true));
    await untilBlocked(recorderPid);
    expect(await blockedBy(recorderPid)).toEqual([saverPid]);
    expect(saved).toBe(false);
    expect(hidden).toBe(false);
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 1, images: 1});

    // Release the lease row: the save goes on and commits first, and only then does the tombstone proceed.
    await locker.query('rollback');
    expect((await saving).rows[0]).toMatchObject({outcome: 'revised', seq: 2});
    expect((await hiding).rows[0].outcome).toBe('recorded');
    // Both revisions are there, and the Project is hidden from every function after the save committed.
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 2, images: 3});
    expect(await readCommitted(db, a, projectId)).toMatchObject({outcome: 'unavailable'});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: the command is idempotent', () => {
  it('answers `replayed` with the original IDs for the same command and the same set, and writes nothing more', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const command = randomUUID();
      const first = await record(client, a, {command, uploads: ids(set)});
      expect(first.outcome).toBe('created');
      const state = await snapshot(client, a, ids(set));
      const again = await record(client, a, {command, uploads: ids(set)});
      expect(again).toEqual({outcome: 'replayed', project_id: first.project_id, request_id: first.request_id, seq: 1, position: null, released: null});
      // Nothing changed, the leases included (a replay does not renew them again).
      expect(await snapshot(client, a, ids(set))).toEqual(state);
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 1, images: 3});
    });
  });

  it('answers `replayed` for a successor\'s command too, and after the Project moved on, a rename and a later save', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, [set[0], set[1]]);
      const command = randomUUID();
      const revised = await record(client, a, {command, project: projectId, uploads: [set[1].id, set[0].id]});
      expect(revised.outcome).toBe('revised');
      expect((await rename(client, a, {projectId, title: 'Renamed', command: randomUUID(), expected: 2})).outcome).toBe('renamed');
      expect((await record(client, a, {project: projectId, uploads: ids(set)})).outcome).toBe('revised');
      const again = await record(client, a, {command, project: projectId, uploads: [set[1].id, set[0].id]});
      expect(again).toMatchObject({outcome: 'replayed', project_id: projectId, request_id: revised.request_id, seq: 2});
      expect((await counts(client, a.accountId)).revisions).toBe(3);
    });
  });

  it('recognises a replay after its uploads were released or expired: a lease keeps its SHA-256, length and type for ever', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [one, two] = await leases(client, a, 2);
      const command = randomUUID();
      const first = await record(client, a, {command, uploads: ids([one, two])});
      // Released by a later save, and expired besides.
      const { projectId } = { projectId: first.project_id as string };
      expect((await record(client, a, {project: projectId, uploads: [two.id]})).released).toBe(1);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 hour' where id = any($1)`, [ids([one, two])]);
      expect((await leaseRow(client, one.id)).state).toBe('released');
      expect(await record(client, a, {command, uploads: ids([one, two])})).toMatchObject({outcome: 'replayed', project_id: projectId, request_id: first.request_id, seq: 1});
    });
  });

  it('is `unavailable`, with no ID, once the Project has been deleted or tombstoned: a receipt does not outlive its Project\'s visibility', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const deletedCommand = randomUUID();
      const gone = await record(client, a, {command: deletedCommand, uploads: [set[0].id]});
      await client.query('update projects.projects set deleted_at = clock_timestamp(), revision = revision + 1 where id = $1', [gone.project_id]);
      expect(await record(client, a, {command: deletedCommand, uploads: [set[0].id]})).toEqual({outcome: 'unavailable', ...nothingRecorded});
      const hiddenCommand = randomUUID();
      const hidden = await record(client, a, {command: hiddenCommand, uploads: [set[1].id]});
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', hidden.project_id])).outcome).toBe('recorded');
      expect(await record(client, a, {command: hiddenCommand, uploads: [set[1].id]})).toEqual({outcome: 'unavailable', ...nothingRecorded});
      expect((await counts(client, a.accountId)).revisions).toBe(2);
    });
  });

  it('answers `reused` for the same command with another set (another order, another upload, fewer uploads), and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const command = randomUUID();
      expect((await record(client, a, {command, uploads: [set[0].id, set[1].id]})).outcome).toBe('created');
      const state = await snapshot(client, a, ids(set));
      for (const other of [[set[1].id, set[0].id], [set[0].id, set[2].id], [set[0].id], [set[0].id, set[1].id, set[2].id]]) {
        expect(await record(client, a, {command, uploads: other}), other.join()).toEqual({outcome: 'reused', ...nothingRecorded});
      }
      // Sent as a successor of the Project it made: the project is part of the digest, so it is another command.
      const made = (await projectsOf(client, a.accountId))[0];
      expect(await record(client, a, {command, project: made.id, uploads: [set[0].id, set[1].id]})).toEqual({outcome: 'reused', ...nothingRecorded});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });

  it('answers `reused` for a command ID a rename used, and a rename of a command ID a revision used is `reused` too: the lock is closed in both directions', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, [set[0]]);
      // A rename's command ID is not a picture command.
      const renamed = randomUUID();
      expect((await rename(client, a, {projectId, title: 'Renamed', command: renamed, expected: 1})).outcome).toBe('renamed');
      const state = await snapshot(client, a, ids(set));
      expect(await record(client, a, {command: renamed, uploads: ids(set)})).toEqual({outcome: 'reused', ...nothingRecorded});
      expect(await record(client, a, {command: renamed, project: projectId, uploads: ids(set)})).toEqual({outcome: 'reused', ...nothingRecorded});
      expect(await snapshot(client, a, ids(set))).toEqual(state);
      // And the other way: a picture revision's command ID may not be reused by a rename, whichever Project it names, and nothing is renamed.
      const revisionCommand = (await revisionsOf(client, a.accountId))[0].command_id as string;
      const before = (await projectsOf(client, a.accountId))[0];
      expect(await rename(client, a, {projectId, title: 'Again', command: revisionCommand, expected: before.revision})).toMatchObject({outcome: 'reused', project_id: null, title: null, revision: null});
      const other = await pictureProject(client, a, [set[1]]);
      expect((await rename(client, a, {projectId: other.projectId, title: 'Elsewhere', command: revisionCommand, expected: 1})).outcome).toBe('reused');
      expect((await projectsOf(client, a.accountId)).map((entry) => entry.title).sort()).toEqual([TITLE, 'Renamed'].sort());
      // A Project that is not available is still `unavailable` first (the Project row is locked before the ledger is read).
      expect((await rename(client, a, {projectId: randomUUID(), title: 'x', command: revisionCommand})).outcome).toBe('unavailable');
    });
  });

  it('keeps command IDs per Account: another Account\'s rename may use a command ID this Account\'s revision used', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const made = await pictureProject(client, a, await leases(client, a, 1));
      const mine = (await revisionsOf(client, a.accountId))[0].command_id as string;
      const theirProject = await project(client, b);
      expect((await rename(client, b, {projectId: theirProject, title: 'Fine', command: mine})).outcome).toBe('renamed');
      expect(made.projectId).toBeTruthy();
    });
  });

  it('answers `reused` between the two kinds of revision: a text request\'s command ID is not a picture command, and a picture command is not a text request\'s', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const create = 'select * from api.create_project_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)';
      const command = randomUUID();
      const text = await asService(client, create, [a.accountId, 1, command, 'The altar', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', 'Build the altar', null, null, null, false, null]);
      expect(text.outcome).toBe('created');
      const set = await leases(client, a, 1);
      expect(await record(client, a, {command, uploads: ids(set)})).toEqual({outcome: 'reused', ...nothingRecorded});
      const pictureCommand = randomUUID();
      expect((await record(client, a, {command: pictureCommand, uploads: ids(set)})).outcome).toBe('created');
      const sent = await asService(client, create, [a.accountId, 1, pictureCommand, 'The altar', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', 'Build the altar', null, null, null, false, null]);
      expect(sent).toEqual({outcome: 'reused', project_id: null, request_id: null});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: the Project it may write to', () => {
  it('answers ONE `unavailable`, with nothing in it, for another Account\'s Project, a deleted one, a tombstoned one and one that never existed; nothing is written or renewed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const mine = await leases(client, a, 3);
      const theirs = await pictureProject(client, b, await leases(client, b, 1));
      const deleted = await pictureProject(client, a, [mine[0]]);
      await client.query('update projects.projects set deleted_at = clock_timestamp(), revision = revision + 1 where id = $1', [deleted.projectId]);
      const hidden = await pictureProject(client, a, [mine[1]]);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', hidden.projectId])).outcome).toBe('recorded');
      const spare = await lease(client, a);
      const state = await snapshot(client, a, [...ids(mine), spare.id]);
      const answers = [];
      for (const target of [theirs.projectId, deleted.projectId, hidden.projectId, randomUUID()]) {
        answers.push(await record(client, a, {project: target, uploads: [spare.id, mine[2].id]}));
      }
      for (const answer of answers) expect(answer).toEqual({outcome: 'unavailable', ...nothingRecorded});
      expect(await snapshot(client, a, [...ids(mine), spare.id])).toEqual(state);
      expect((await counts(client, b.accountId)).revisions).toBe(1);
    });
  });

  it('answers `not_editable` for a Project whose request is a text request, a confirmed revision or nothing at all, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const create = 'select * from api.create_project_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)';
      const text = await asService(client, create, [a.accountId, 1, randomUUID(), 'The altar', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', 'Build the altar', null, null, null, false, null]);
      // A confirmed picture revision (a later story records one): confirmed, so no longer a draft.
      const confirmed = await asService(client, create, [a.accountId, 1, randomUUID(), 'From pictures', 'evidence_images', null, 'Scope', 'Outcome', 'Pictures', null, null, null, false, null]);
      const bare = await project(client, a, {title: 'No request'});
      const set = await leases(client, a, 2);
      const state = await snapshot(client, a, ids(set));
      for (const target of [text.project_id, confirmed.project_id, bare]) {
        expect(await record(client, a, {project: target, uploads: ids(set)}), String(target)).toEqual({outcome: 'not_editable', ...nothingRecorded});
      }
      expect(await snapshot(client, a, ids(set))).toEqual(state);
      expect((await projectsOf(client, a.accountId)).map((entry) => entry.revision)).toEqual([1, 1, 1]);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: every upload is read from its lease', () => {
  it('answers `unknown_upload` with the position for another Account\'s upload, an ID that is none, and a lease that is a file, and writes and renews nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const good = await leases(client, a, 2);
      const foreign = await lease(client, b);
      const file = await lease(client, a, {kind: 'file'});
      const state = await snapshot(client, a, [...ids(good), foreign.id, file.id]);
      const cases: [string, (string | null)[], number][] = [
        ['another Account\'s upload', [good[0].id, foreign.id, good[1].id], 2],
        ['an ID that names no upload', [good[0].id, good[1].id, randomUUID()], 3],
        ['a file, not a picture', [file.id, good[0].id], 1],
        ['the first problem in position order', [good[0].id, randomUUID(), foreign.id], 2],
      ];
      for (const [label, uploads, position] of cases) {
        expect(await record(client, a, {uploads}), label).toEqual({outcome: 'unknown_upload', ...nothingRecorded, position});
      }
      expect(await snapshot(client, a, [...ids(good), foreign.id, file.id])).toEqual(state);
      expect(await counts(client, a.accountId)).toEqual({projects: 0, revisions: 0, images: 0});
      // The same for a successor.
      const { projectId } = await pictureProject(client, a, [good[0]]);
      expect(await record(client, a, {project: projectId, uploads: [good[0].id, foreign.id]})).toEqual({outcome: 'unknown_upload', ...nothingRecorded, position: 2});
    });
  });

  it('tells a foreign upload from an unknown one by nothing: the same answer, so an ID cannot be used to find out whose upload it is', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const foreign = await lease(client, b);
      const asForeign = await record(client, a, {uploads: [foreign.id]});
      const asUnknown = await record(client, a, {uploads: [randomUUID()]});
      expect(asForeign).toEqual(asUnknown);
      // A foreign lease that is also expired or not complete is still `unknown_upload`, never `expired_upload` or `not_ready`.
      const foreignExpired = await lease(client, b, {expires: -3600});
      const foreignReceiving = await lease(client, b, {state: 'receiving'});
      expect(await record(client, a, {uploads: [foreignExpired.id]})).toEqual(asUnknown);
      expect(await record(client, a, {uploads: [foreignReceiving.id]})).toEqual(asUnknown);
    });
  });

  it('answers `not_ready` with the position for an upload that is still receiving, released, deleted or attached', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const good = await lease(client, a);
      const state = await snapshot(client, a, [good.id]);
      for (const lifecycle of ['receiving', 'released', 'deleted', 'attached'] as const) {
        const unready = await lease(client, a, {state: lifecycle});
        expect(await record(client, a, {uploads: [good.id, unready.id]}), lifecycle).toEqual({outcome: 'not_ready', ...nothingRecorded, position: 2});
      }
      // The first problem in position order wins, whatever kind it is.
      const receiving = await lease(client, a, {state: 'receiving'});
      const expired = await lease(client, a, {expires: -60});
      expect(await record(client, a, {uploads: [receiving.id, expired.id]})).toEqual({outcome: 'not_ready', ...nothingRecorded, position: 1});
      expect(await record(client, a, {uploads: [expired.id, receiving.id]})).toEqual({outcome: 'expired_upload', ...nothingRecorded, position: 1});
      expect((await snapshot(client, a, [good.id])).leases).toEqual(state.leases);
      expect(await counts(client, a.accountId)).toEqual({projects: 0, revisions: 0, images: 0});
    });
  });

  it('answers `expired_upload` with the position for a complete upload past its expiry, and accepts one that has seconds left', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const good = await leases(client, a, 2);
      const lapsed = await lease(client, a, {expires: -1});
      expect(await record(client, a, {uploads: [good[0].id, good[1].id, lapsed.id]})).toEqual({outcome: 'expired_upload', ...nothingRecorded, position: 3});
      const closing = await lease(client, a, {expires: 30});
      expect((await record(client, a, {uploads: [closing.id, good[0].id]})).outcome).toBe('created');
      // The expiry of a saved picture is the same refusal for a successor: replace it and save again.
      const { projectId } = await pictureProject(client, a, [good[1]]);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [good[1].id]);
      expect(await record(client, a, {project: projectId, uploads: [good[1].id, good[0].id]})).toEqual({outcome: 'expired_upload', ...nothingRecorded, position: 1});
    });
  });

  it('answers `too_large` when the lengths read from the leases add up to more than 60 MiB, and accepts exactly 60 MiB', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const twelve = await leases(client, a, 5, {length: 12 * MiB});
      const one = await lease(client, a, {length: 1});
      const state = await snapshot(client, a, [...ids(twelve), one.id]);
      expect(await record(client, a, {uploads: [...ids(twelve), one.id]})).toEqual({outcome: 'too_large', ...nothingRecorded});
      expect(await snapshot(client, a, [...ids(twelve), one.id])).toEqual(state);
      expect((await record(client, a, {uploads: ids(twelve)})).outcome).toBe('created');
      // The browser's own total is not what counts: a set of small pictures is fine whatever the browser said.
      expect((await record(client, a, {uploads: ids(await leases(client, a, 12, {length: 5 * MiB}))})).outcome).toBe('created');
      expect((await record(client, a, {uploads: ids(await leases(client, a, 6, {length: 10 * MiB + 1}))})).outcome).toBe('too_large');
    });
  });

  it('refuses an upload that is the Account\'s own but is not a picture lease (a file) even if the type and size look right', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const file = await lease(client, a, {kind: 'file'});
      expect(await record(client, a, {uploads: [file.id]})).toMatchObject({outcome: 'unknown_upload', position: 1});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: the same picture twice is refused from the leases, not from the browser\'s word', () => {
  it('answers `duplicate_image` with the position of the SECOND of two different uploads whose leases hold the same SHA-256, and records nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sha = randomBytes(32).toString('hex');
      const [one, other, third] = [await lease(client, a), await lease(client, a), await lease(client, a)];
      const copy = await lease(client, a, {sha});
      const original = await lease(client, a, {sha});
      const state = await snapshot(client, a, [one.id, other.id, third.id, copy.id, original.id]);
      // Two uploads, two lease rows, the same bytes: the browser was never asked, and it does not matter what it hashed.
      expect(await record(client, a, {uploads: ids([original, copy])})).toEqual({outcome: 'duplicate_image', ...nothingRecorded, position: 2});
      // The position is the later one, wherever it is in the set.
      expect(await record(client, a, {uploads: ids([one, original, other, copy])})).toEqual({outcome: 'duplicate_image', ...nothingRecorded, position: 4});
      expect(await record(client, a, {uploads: ids([original, copy, other])})).toEqual({outcome: 'duplicate_image', ...nothingRecorded, position: 2});
      expect(await record(client, a, {uploads: ids([copy, one, third, original])})).toEqual({outcome: 'duplicate_image', ...nothingRecorded, position: 4});
      expect(await snapshot(client, a, [one.id, other.id, third.id, copy.id, original.id])).toEqual(state);
      expect(await counts(client, a.accountId)).toEqual({projects: 0, revisions: 0, images: 0});
      // Exactly one picture for each digest is fine, whatever the other pictures of the set are.
      expect(await record(client, a, {uploads: ids([one, original, other, third])})).toMatchObject({outcome: 'created', seq: 1});
    });
  });

  it('judges a picture\'s own lease before it calls it a duplicate, and the first problem by position wins', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const sha = randomBytes(32).toString('hex');
      const original = await lease(client, a, {sha});
      const copy = await lease(client, a, {sha});
      const copyReceiving = await lease(client, a, {sha, state: 'receiving'});
      const copyExpired = await lease(client, a, {sha, expires: -60});
      const copyForeign = await lease(client, b, {sha});
      const copyFile = await lease(client, a, {sha, kind: 'file'});
      const expiredLater = await lease(client, a, {expires: -60});
      // The duplicate's own lease is judged first: a foreign, unknown or file lease is `unknown_upload`, an unfinished one `not_ready`, a lapsed one `expired_upload`.
      expect(await record(client, a, {uploads: ids([original, copyForeign])})).toEqual({outcome: 'unknown_upload', ...nothingRecorded, position: 2});
      expect(await record(client, a, {uploads: ids([original, copyFile])})).toEqual({outcome: 'unknown_upload', ...nothingRecorded, position: 2});
      expect(await record(client, a, {uploads: ids([original, copyReceiving])})).toEqual({outcome: 'not_ready', ...nothingRecorded, position: 2});
      expect(await record(client, a, {uploads: ids([original, copyExpired])})).toEqual({outcome: 'expired_upload', ...nothingRecorded, position: 2});
      // An earlier position's problem wins over a later duplicate, and a duplicate wins over a later problem of another picture.
      expect(await record(client, a, {uploads: ids([expiredLater, original, copy])})).toEqual({outcome: 'expired_upload', ...nothingRecorded, position: 1});
      expect(await record(client, a, {uploads: ids([original, copy, expiredLater])})).toEqual({outcome: 'duplicate_image', ...nothingRecorded, position: 2});
      expect(await record(client, a, {uploads: [original.id, copy.id, randomUUID()]})).toEqual({outcome: 'duplicate_image', ...nothingRecorded, position: 2});
      expect(await counts(client, a.accountId)).toEqual({projects: 0, revisions: 0, images: 0});
    });
  });

  it('is the same for a successor: the set is refused, and the Project, its revisions, its pictures and every lease are as they were (no renewal, no release)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sha = randomBytes(32).toString('hex');
      const [kept, dropped] = await leases(client, a, 2);
      const original = await lease(client, a, {sha});
      const copy = await lease(client, a, {sha});
      const { projectId } = await pictureProject(client, a, [kept, dropped]);
      const state = await snapshot(client, a, [kept.id, dropped.id, original.id, copy.id]);
      expect(await record(client, a, {project: projectId, uploads: ids([kept, original, copy])})).toEqual({outcome: 'duplicate_image', ...nothingRecorded, position: 3});
      expect(await snapshot(client, a, [kept.id, dropped.id, original.id, copy.id])).toEqual(state);
      expect((await leaseRow(client, dropped.id)).state).toBe('complete');
      expect((await projectsOf(client, a.accountId))[0].revision).toBe(1);
    });
  });

  it('is not the argument error of the same upload ID named twice, which is 22023 before anything is read', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [entry, other] = await leases(client, a, 2);
      const twice = await recordRaw(client, a, {uploads: [entry.id, other.id, entry.id]});
      expect(twice.ok).toBe(false);
      if (!twice.ok) expect(twice.code).toBe('22023');
      // Two uploads of the same file are two uploads: that is the lease's finding, not the arguments'.
      const sha = randomBytes(32).toString('hex');
      const copies = [await lease(client, a, {sha}), await lease(client, a, {sha})];
      expect((await record(client, a, {uploads: ids(copies)})).outcome).toBe('duplicate_image');
    });
  });

  it('takes the digest as the picture\'s identity: two leases with the same SHA-256 are one picture, whatever their length or type say', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sha = randomBytes(32).toString('hex');
      // The gateway checked each upload's bytes against its digest, so the same SHA-256 is the same picture.
      const png = await lease(client, a, {sha, ct: 'image/png', length: 1000});
      const jpeg = await lease(client, a, {sha, ct: 'image/jpeg', length: 2000});
      expect(await record(client, a, {uploads: ids([png, jpeg])})).toEqual({outcome: 'duplicate_image', ...nothingRecorded, position: 2});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: the arguments', () => {
  const invalid: [string, (set: Lease[], project: string) => Partial<Save>][] = [
    ['no upload IDs', () => ({uploads: []})],
    ['thirteen upload IDs', () => ({uploads: Array.from({length: 13}, () => randomUUID())})],
    ['a repeated upload ID', (set) => ({uploads: [set[0].id, set[1].id, set[0].id]})],
    ['a null upload ID', (set) => ({uploads: [set[0].id, null]})],
    ['no array', () => ({uploads: null})],
    ['an array of two dimensions', (set) => ({uploads: `{{${set[0].id},${set[1].id}},{${set[1].id},${set[0].id}}}`})],
    ['an array that does not start at 1', (set) => ({uploads: `[0:1]={${set[0].id},${set[1].id}}`})],
    ['a title when a Project is named', (set, project) => ({project, title: TITLE, uploads: ids(set)})],
    ['no title when a Project is created', (set) => ({title: null, uploads: ids(set)})],
    ['a blank title', (set) => ({title: '', uploads: ids(set)})],
    ['a padded title', (set) => ({title: ' Picture request', uploads: ids(set)})],
    ['a title over 120 characters', (set) => ({title: 'x'.repeat(121), uploads: ids(set)})],
    ['a title with a control character', (set) => ({title: 'Picture\u0007 request', uploads: ids(set)})],
    ['a title with a newline', (set) => ({title: 'Picture\nrequest', uploads: ids(set)})],
    ['no epoch', (set) => ({epoch: null, uploads: ids(set)})],
    ['an epoch of 0', (set) => ({epoch: 0, uploads: ids(set)})],
    ['a negative epoch', (set) => ({epoch: -1, uploads: ids(set)})],
    ['no command ID', (set) => ({command: null, uploads: ids(set)})],
  ];

  it.each(invalid)('raises 22023 for %s, and writes nothing', async (_label, patch) => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, [set[0]]);
      const state = await snapshot(client, a, ids(set));
      const result = await recordRaw(client, a, {uploads: null, ...patch(set, projectId)});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(await snapshot(client, a, ids(set))).toEqual(state);
    });
  });

  it('accepts twelve upload IDs and a title of exactly 120 characters', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 12);
      expect((await record(client, a, {title: 'x'.repeat(120), uploads: ids(set)})).outcome).toBe('created');
    });
  });

  it('checks the arguments before the Account: a disabled Account or one that does not exist that sends nonsense is told so, not `denied`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      const nonsense = await recordRaw(client, a, {epoch: 2, uploads: []});
      expect(nonsense.ok).toBe(false);
      if (!nonsense.ok) expect(nonsense.code).toBe('22023');
      const ghost = await recordRaw(client, {...a, accountId: randomUUID()}, {uploads: [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]});
      expect(ghost.ok).toBe(false);
      if (!ghost.ok) expect(ghost.code).toBe('22023');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: unchanged', () => {
  it('answers `unchanged` for the same pictures in the same order as the latest revision: no revision, no change to the Project and nothing released, but the leases ARE renewed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3, {expires: 7200});
      const { projectId, requestId } = await pictureProject(client, a, set);
      // The first save renewed them to 24 hours; make them look older so a renewal shows.
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() + interval '2 hours' where id = any($1)`, [ids(set)]);
      const before = await snapshot(client, a, ids(set));
      const again = await record(client, a, {project: projectId, uploads: ids(set)});
      expect(again).toEqual({outcome: 'unchanged', project_id: projectId, request_id: requestId, seq: 1, position: null, released: null});
      const after = await snapshot(client, a, ids(set));
      // What a recorded save would have written is not written: the Project row (its revision and updated_at included), the revisions and the pictures are as they were.
      expect(after.projects).toEqual(before.projects);
      expect(after.revisions).toEqual(before.revisions);
      expect(after.images).toEqual(before.images);
      expect((await projectsOf(client, a.accountId))[0].revision).toBe(1);
      // Nothing is released: every lease is still complete. But each was renewed to 24 hours from now (from the 2 hours it had).
      expect(after.leases.map((row) => row.state)).toEqual(['complete', 'complete', 'complete']);
      const now = await dbNow(client);
      for (const [index, row] of after.leases.entries()) {
        expect(row.expires_at.getTime(), `lease ${index}`).toBeGreaterThan(before.leases[index].expires_at.getTime() + 21 * 3600_000);
        expect(row.expires_at.getTime() - now.getTime(), `lease ${index}`).toBeGreaterThan(23.9 * 3600_000);
        expect(row.expires_at.getTime() - now.getTime(), `lease ${index}`).toBeLessThanOrEqual(24 * 3600_000);
      }
    });
  });

  it('renews on `unchanged` within the same bound: never past 7 days from the lease\'s creation', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [young, old] = [await lease(client, a, {age: 600}), await lease(client, a, {age: 6.5 * 24 * 3600, expires: 3600})];
      const { projectId } = await pictureProject(client, a, [young, old]);
      // The bound cut the first save too; now age the second lease's expiry to be near.
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() + interval '1 hour' where id = any($1)`, [ids([young, old])]);
      expect((await record(client, a, {project: projectId, uploads: ids([young, old])})).outcome).toBe('unchanged');
      const [youngRow, oldRow] = [await leaseRow(client, young.id), await leaseRow(client, old.id)];
      const now = await dbNow(client);
      expect(youngRow.expires_at.getTime() - now.getTime()).toBeGreaterThan(23.9 * 3600_000);
      // 6.5 days old: 12 hours are left of its 7 days, so that is all the renewal gives.
      expect(oldRow.expires_at.getTime()).toBeLessThanOrEqual(oldRow.created_at.getTime() + 7 * 24 * 3600_000);
      expect(oldRow.expires_at.getTime() - now.getTime()).toBeLessThanOrEqual(12.1 * 3600_000);
      expect(oldRow.expires_at.getTime() - now.getTime()).toBeGreaterThan(11.9 * 3600_000);
      expect([youngRow.state, oldRow.state]).toEqual(['complete', 'complete']);
    });
  });

  it('is not `unchanged` for another order, another set or one picture fewer, which are successors', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      expect((await record(client, a, {project: projectId, uploads: [set[1].id, set[0].id, set[2].id]})).outcome).toBe('revised');
      expect((await record(client, a, {project: projectId, uploads: [set[1].id, set[0].id]})).outcome).toBe('revised');
      expect((await record(client, a, {project: projectId, uploads: [set[1].id, set[0].id]})).outcome).toBe('unchanged');
    });
  });

  it('looks at the uploads first: the same set with a picture that has expired is `expired_upload`, never `unchanged`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, set);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 minute' where id = $1`, [set[1].id]);
      expect(await record(client, a, {project: projectId, uploads: ids(set)})).toEqual({outcome: 'expired_upload', ...nothingRecorded, position: 2});
    });
  });

  it('records nothing for the command it answered, so the same command ID may be used later for a change', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, set);
      const command = randomUUID();
      expect((await record(client, a, {command, project: projectId, uploads: ids(set)})).outcome).toBe('unchanged');
      expect((await revisionsOf(client, a.accountId)).some((revision) => revision.command_id === command)).toBe(false);
      expect(await record(client, a, {command, project: projectId, uploads: [set[1].id, set[0].id]})).toMatchObject({outcome: 'revised', seq: 2});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_picture_set: lease renewal is bounded', () => {
  const hours = (count: number) => count * 3600_000;

  it('renews a lease saved at hour 23 to 24 hours from now, not 24 hours from its creation', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [entry] = await leases(client, a, 1, {age: 23 * 3600, expires: 3600});
      const before = await dbNow(client);
      await record(client, a, {uploads: [entry.id]});
      const after = await dbNow(client);
      const row = await leaseRow(client, entry.id);
      expect(row.expires_at.getTime()).toBeGreaterThanOrEqual(before.getTime() + hours(24));
      expect(row.expires_at.getTime()).toBeLessThanOrEqual(after.getTime() + hours(24));
      expect(row.expires_at.getTime()).toBeLessThan(row.created_at.getTime() + 7 * 24 * hours(1));
    });
  });

  it('never renews a lease past 7 days after it was created: at day 6.5 the new expiry is the 7th day', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [entry] = await leases(client, a, 1, {age: 6.5 * 24 * 3600, expires: 3600});
      await record(client, a, {uploads: [entry.id]});
      const row = await leaseRow(client, entry.id);
      const {rows: bound} = await client.query(`select (expires_at = created_at + interval '7 days') as at_bound, expires_at - clock_timestamp() as left from artifacts.staging_leases where id = $1`, [entry.id]);
      expect(bound[0].at_bound).toBe(true);
      // About half a day is left (12 hours less the moment since), not 24 hours.
      expect(row.expires_at.getTime() - Date.now()).toBeLessThan(hours(13));
      expect(row.expires_at.getTime() - Date.now()).toBeGreaterThan(hours(11));
    });
  });

  it('answers `expired_upload` after day 7: a lease that was kept alive is not kept for ever', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      // A lease created eight days ago whose renewals ran out at the bound.
      const [entry] = await leases(client, a, 1, {age: 8 * 24 * 3600, expires: -3600});
      expect(await record(client, a, {uploads: [entry.id]})).toEqual({outcome: 'expired_upload', ...nothingRecorded, position: 1});
      // Saved every day: each save renewed it, but the last renewal could not pass the 7th day, so the 8th day it has lapsed.
      const [kept] = await leases(client, a, 1, {age: 6.9 * 24 * 3600, expires: 3600});
      expect((await record(client, a, {uploads: [kept.id]})).outcome).toBe('created');
      const {rows: bound} = await client.query(`select (expires_at <= created_at + interval '7 days') as within from artifacts.staging_leases where id = $1`, [kept.id]);
      expect(bound[0].within).toBe(true);
    });
  });

  it('renews the leases of a successor in the same way, and a lease already at its bound stays at it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [old, fresh] = [await lease(client, a, {age: 6.9 * 24 * 3600, expires: 3600}), await lease(client, a, {age: 100, expires: 3600})];
      const { projectId } = await pictureProject(client, a, [old]);
      expect((await record(client, a, {project: projectId, uploads: [old.id, fresh.id]})).outcome).toBe('revised');
      const {rows: oldRow} = await client.query(`select (expires_at = created_at + interval '7 days') as at_bound from artifacts.staging_leases where id = $1`, [old.id]);
      expect(oldRow[0].at_bound).toBe(true);
      const freshRow = await leaseRow(client, fresh.id);
      expect(freshRow.expires_at.getTime()).toBeGreaterThan(Date.now() + hours(23));
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.release_staged_pictures', () => {
  it('releases the Account\'s own picture uploads that are receiving or complete and that no revision uses, and answers how many', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const receiving = await lease(client, a, {state: 'receiving'});
      const complete = await lease(client, a);
      const answer = await release(client, a, [receiving.id, complete.id]);
      expect(answer).toEqual({ok: true, rows: [{outcome: 'released', released: 2}]});
      for (const entry of [receiving, complete]) expect((await leaseRow(client, entry.id)).state).toBe('released');
      // Again: nothing is left to release.
      expect(await release(client, a, [receiving.id, complete.id])).toEqual({ok: true, rows: [{outcome: 'released', released: 0}]});
    });
  });

  it('frees the quota at once: the Account\'s open staging (receiving and complete, unexpired) no longer counts a released upload', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const [big, small] = [await lease(client, a, {length: 10 * MiB}), await lease(client, a, {length: 1 * MiB})];
      const open = async () => Number((await client.query(`select coalesce(sum(length), 0) as total from artifacts.staging_leases where account_id = $1 and state in ('receiving', 'complete') and expires_at > clock_timestamp()`, [a.accountId])).rows[0].total);
      expect(await open()).toBe(11 * MiB);
      await release(client, a, [big.id]);
      expect(await open()).toBe(1 * MiB);
      expect(small.id).toBeTruthy();
    });
  });

  it('leaves alone, and does not count, an upload a revision uses (even an old revision), another Account\'s upload, one that does not exist, a file, and one already released, deleted or attached', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const [used, dropped] = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, [used, dropped]);
      // `dropped` left the set and was released by the save; `used` is still in the latest revision. Both are in a revision's pictures.
      await record(client, a, {project: projectId, uploads: [used.id]});
      const foreign = await lease(client, b);
      const file = await lease(client, a, {kind: 'file'});
      const released = await lease(client, a, {state: 'released'});
      const deleted = await lease(client, a, {state: 'deleted'});
      const attached = await lease(client, a, {state: 'attached'});
      const free = await lease(client, a);
      const all = [used, dropped, foreign, file, released, deleted, attached, free].map((entry) => entry.id);
      const before = await Promise.all(all.map((id) => leaseRow(client, id)));
      const answer = await release(client, a, [...all, randomUUID()].slice(0, 12));
      expect(answer).toEqual({ok: true, rows: [{outcome: 'released', released: 1}]});
      const after = await Promise.all(all.map((id) => leaseRow(client, id)));
      expect(after.map((row) => row.state)).toEqual(before.map((row, index) => (all[index] === free.id ? 'released' : row.state)));
      expect((await leaseRow(client, used.id)).state).toBe('complete');
    });
  });

  it('answers `released` 0 for a list of nothing it can release, and `denied` to a disabled, stale-epoch or tombstoned Account, changing nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const entry = await lease(client, a);
      expect(await release(client, a, [randomUUID()])).toEqual({ok: true, rows: [{outcome: 'released', released: 0}]});
      expect(await release(client, a, [entry.id], 7)).toEqual({ok: true, rows: [{outcome: 'denied', released: null}]});
      expect(await release(client, {...a, accountId: randomUUID()}, [entry.id])).toEqual({ok: true, rows: [{outcome: 'denied', released: null}]});
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      for (const epoch of [1, 2]) expect(await release(client, a, [entry.id], epoch), String(epoch)).toEqual({ok: true, rows: [{outcome: 'denied', released: null}]});
      const b = await account(client);
      const theirs = await lease(client, b);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['account', b.accountId])).outcome).toBe('recorded');
      for (const epoch of [1, 2]) expect(await release(client, b, [theirs.id], epoch), String(epoch)).toEqual({ok: true, rows: [{outcome: 'denied', released: null}]});
      expect((await leaseRow(client, entry.id)).state).toBe('complete');
      expect((await leaseRow(client, theirs.id)).state).toBe('complete');
    });
  });

  it.each([
    ['no upload IDs', () => []],
    ['thirteen upload IDs', () => Array.from({length: 13}, () => randomUUID())],
    ['a null upload ID', () => [randomUUID(), null]],
    ['no array', () => null],
    ['an array that does not start at 1', () => `[0:0]={${randomUUID()}}`],
    ['an array of two dimensions', () => `{{${randomUUID()}},{${randomUUID()}}}`],
  ] as [string, () => (string | null)[] | string | null][])('raises 22023 for %s', async (_label, uploads) => {
    await inTx(async (client) => {
      const a = await account(client);
      const result = await release(client, a, uploads());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });

  it('checks the shape of epoch and Account first (22023) and refuses a missing epoch', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const epoch of [null, 0, -3]) {
        const result = await attempt(client, 'service_role', 'select * from api.release_staged_pictures($1, $2, $3)', [a.accountId, epoch, [randomUUID()]]);
        expect(result.ok, String(epoch)).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
      const none = await attempt(client, 'service_role', 'select * from api.release_staged_pictures($1, $2, $3)', [null, 1, [randomUUID()]]);
      expect(none.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('authority: record_picture_set begins with identity.assert_operation_authority', () => {
  const denied = {outcome: 'denied', ...nothingRecorded};

  it('answers `denied`, writing and renewing nothing, to a disabled Account, a stale epoch, an Account that does not exist and a tombstoned Account', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, [set[0]]);
      const state = await snapshot(client, a, ids(set));
      // A stale epoch, and then a disabled Account (which raises the epoch).
      expect(await record(client, a, {epoch: 9, uploads: ids(set)})).toEqual(denied);
      expect(await record(client, a, {epoch: 9, project: projectId, uploads: ids(set)})).toEqual(denied);
      expect(await snapshot(client, a, ids(set))).toEqual(state);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      for (const epoch of [1, 2]) {
        expect(await record(client, a, {epoch, uploads: ids(set)}), String(epoch)).toEqual(denied);
        expect(await record(client, a, {epoch, project: projectId, uploads: ids(set)}), String(epoch)).toEqual(denied);
      }
      expect(await record(client, {...a, accountId: randomUUID()}, {epoch: 1, uploads: ids(set)})).toEqual(denied);
      expect(await snapshot(client, a, ids(set))).toEqual(state);
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 1, images: 1});
      // A tombstoned Account.
      const b = await account(client);
      const theirs = await leases(client, b, 1);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['account', b.accountId])).outcome).toBe('recorded');
      for (const epoch of [1, 2]) expect(await record(client, b, {epoch, uploads: ids(theirs)})).toEqual(denied);
      expect(await counts(client, b.accountId)).toEqual({projects: 0, revisions: 0, images: 0});
    });
  });

  it('asks before it looks at the command: a denied Account is told nothing about a command it sent (a replay, a reused ID)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const command = randomUUID();
      expect((await record(client, a, {command, uploads: ids(set)})).outcome).toBe('created');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect(await record(client, a, {command, epoch: 2, uploads: ids(set)})).toEqual(denied);
      expect(await record(client, a, {command, epoch: 2, uploads: [randomUUID()]})).toEqual(denied);
    });
  });

  it('waits for a disable that holds the Account, and is then denied and writes nothing; a disable waits for a save that passed the check, and the save commits', async () => {
    const a = await committedAccount();
    const set = await leases(db, a, 2);
    left.push(...ids(set));
    const disabler = await connect();
    const saver = await connect();
    const { rows: pid } = await saver.query('select pg_backend_pid() as pid');
    await disabler.query('begin');
    await disabler.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
    const saving = saver.query(recordSql, recordValues(a, {uploads: ids(set)}));
    let settled = false;
    saving.then(() => (settled = true), () => (settled = true));
    await untilBlocked(pid[0].pid);
    expect(settled).toBe(false);
    await disabler.query('commit');
    expect((await saving).rows[0]).toMatchObject({outcome: 'denied'});
    expect(await counts(db, a.accountId)).toEqual({projects: 0, revisions: 0, images: 0});

    const b = await committedAccount();
    const mine = await leases(db, b, 1);
    left.push(...ids(mine));
    const writer = await connect();
    const turner = await connect();
    const { rows: turnerPid } = await turner.query('select pg_backend_pid() as pid');
    await writer.query('begin');
    expect((await writer.query(recordSql, recordValues(b, {uploads: ids(mine)}))).rows[0].outcome).toBe('created');
    const disabling = turner.query('select outcome from api.disable_account($1, $2)', ['user:00000000-0000-4000-8000-000000000001', b.accountId]);
    await untilBlocked(turnerPid[0].pid);
    await writer.query('commit');
    expect((await disabling).rows[0].outcome).toBe('disabled');
    expect(await counts(db, b.accountId)).toEqual({projects: 1, revisions: 1, images: 1});
    expect((await recordRawOn(writer, b, {epoch: 1, uploads: ids(mine)})).outcome).toBe('denied');
    expect((await recordRawOn(writer, b, {epoch: 2, uploads: ids(mine)})).outcome).toBe('denied');
  });
});

const recordRawOn = async (client: Client, who: Fixture, save: Save) => (await client.query(recordSql, recordValues(who, save))).rows[0];

// ---------------------------------------------------------------------------------------------------
describe('the record: unconfirmed revisions', () => {
  it('lets confirmed_at, description, scope and outcome be null together and only together', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      expect((await insertRevision(client, a, await project(client, a))).ok).toBe(true);
      const confirmedOnly = {confirmed_at: new Date(), scope: 'Scope', outcome: 'Outcome', description: 'Description'};
      expect((await insertRevision(client, a, await project(client, a), confirmedOnly)).ok).toBe(true);
      // Each of the four alone, with the others absent, and each of the four missing from a confirmed revision: refused.
      for (const field of Object.keys(confirmedOnly)) {
        const alone = await insertRevision(client, a, await project(client, a), {[field]: (confirmedOnly as Record<string, unknown>)[field]});
        expect(alone.ok, `only ${field}`).toBe(false);
        if (!alone.ok) expect(alone.code, `only ${field}`).toBe('23514');
        const missing = await insertRevision(client, a, await project(client, a), {...confirmedOnly, [field]: null});
        expect(missing.ok, `without ${field}`).toBe(false);
        if (!missing.ok) expect(missing.code, `without ${field}`).toBe('23514');
      }
    });
  });

  it('still requires them for a text request, and checks a value that is present as before', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const unconfirmedText = await insertRevision(client, a, await project(client, a), {mode: 'evidence_text', subject_id: 'middot-altar-ramp'});
      expect(unconfirmedText.ok).toBe(false);
      if (!unconfirmedText.ok) expect(unconfirmedText.code).toBe('23514');
      const confirmedText = {mode: 'evidence_text', subject_id: 'middot-altar-ramp', confirmed_at: new Date(), scope: 'Scope', outcome: 'Outcome', description: 'Description'};
      expect((await insertRevision(client, a, await project(client, a), confirmedText)).ok).toBe(true);
      for (const patch of [{scope: ' padded'}, {scope: 'x'.repeat(301)}, {outcome: ''}, {description: 'bell\u0007'}]) {
        const result = await insertRevision(client, a, await project(client, a), {...confirmedText, ...patch});
        expect(result.ok, JSON.stringify(patch)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(patch)).toBe('23514');
      }
    });
  });

  it('lets an unconfirmed revision claim nothing: no subject, no wish, not applied', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const patch of [
        {subject_id: 'middot-altar-ramp'},
        {personalization_wording: 'Add "x"', personalization_reason: 'no_quoted_text'},
        {personalization_wording: 'Add "x"', personalization_text: 'x', personalization_style: 'raised', personalization_applied: true},
        {personalization_applied: true},
      ]) {
        const result = await insertRevision(client, a, await project(client, a), patch);
        expect(result.ok, JSON.stringify(patch)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(patch)).toBe('23514');
      }
      // Another mode may be unconfirmed too (Story 2.3 records the explicit choice as a successor).
      expect((await insertRevision(client, a, await project(client, a), {mode: 'image_direct'})).ok).toBe(true);
    });
  });

  it('keeps the table immutable: no update, and a truncate meets the triggers or the foreign key from the pictures', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const made = await pictureProject(client, a, await leases(client, a, 1));
      for (const change of ["scope = 'Changed'", 'seq = 2', "mode = 'image_direct'", 'confirmed_at = now()', "digest = '" + 'b'.repeat(64) + "'", 'id = id']) {
        const result = await attempt(client, null, `update projects.request_revisions set ${change} where id = $1`, [made.requestId]);
        expect(result.ok, change).toBe(false);
        if (!result.ok) expect(result.code, change).toBe('55000');
      }
      const alone = await attempt(client, null, 'truncate projects.request_revisions');
      expect(alone.ok).toBe(false);
      if (!alone.ok) expect(alone.code).toBe('0A000');
      const together = await attempt(client, null, 'truncate projects.request_revisions, projects.request_images');
      expect(together.ok).toBe(false);
      if (!together.ok) expect(together.code).toBe('55000');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the record: the seq trigger numbers a Project\'s revisions', () => {
  it('makes seq exactly the Project\'s highest plus one: 1 first, then 2, and never a gap, a repeat, 0 or a negative number', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const projectId = await project(client, a);
      for (const seq of [0, -1, 2, 5]) {
        const first = await insertRevision(client, a, projectId, {seq});
        expect(first.ok, `first revision ${seq}`).toBe(false);
        if (!first.ok) expect(first.code, `first revision ${seq}`).toBe('23514');
      }
      expect((await insertRevision(client, a, projectId, {seq: 1})).ok).toBe(true);
      for (const seq of [1, 3, 0, 7]) {
        const bad = await insertRevision(client, a, projectId, {seq});
        expect(bad.ok, `after 1: ${seq}`).toBe(false);
        if (!bad.ok) expect(bad.code, `after 1: ${seq}`).toBe('23514');
      }
      expect((await insertRevision(client, a, projectId, {seq: 2})).ok).toBe(true);
      const gap = await insertRevision(client, a, projectId, {seq: 4});
      expect(gap.ok).toBe(false);
      expect((await insertRevision(client, a, projectId, {seq: 3})).ok).toBe(true);
      // Another Project starts at 1 again.
      expect((await insertRevision(client, a, await project(client, a), {seq: 1})).ok).toBe(true);
    });
  });

  it('keeps the unique key as the second line: two writers that both pass the check for seq 1 meet it, and one fails with 23505', async () => {
    const a = await committedAccount();
    const projectId = await project(db, a);
    const one = await connect();
    const two = await connect();
    const { rows: pid } = await two.query('select pg_backend_pid() as pid');
    const insertSql = `insert into projects.request_revisions (project_id, account_id, seq, command_id, mode, personalization_applied, digest) values ($1, $2, 1, $3, 'evidence_images', false, $4)`;
    await one.query('begin');
    await one.query(insertSql, [projectId, a.accountId, randomUUID(), 'a'.repeat(64)]);
    // The second writer's trigger sees no revision yet (the first has not committed), so it passes and then waits for the unique key.
    const racing = two.query(insertSql, [projectId, a.accountId, randomUUID(), 'a'.repeat(64)]).then(() => ({code: undefined as string | undefined}), (error: {code?: string}) => ({code: error.code}));
    await untilBlocked(pid[0].pid);
    await one.query('commit');
    expect((await racing).code).toBe('23505');
    expect((await revisionsOf(db, a.accountId)).map((revision) => revision.seq)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the record: projects.request_images', () => {
  async function revisionToHold(client: Client) {
    const a = await account(client);
    const projectId = await project(client, a);
    const inserted = await insertRevision(client, a, projectId);
    if (!inserted.ok) throw new Error(inserted.message);
    return {a, revision: {id: inserted.rows[0].id as string, projectId, accountId: a.accountId}};
  }

  it('has exactly the columns the story lists, all required, and none that names a manifest, a root, a retained copy, a pin or an ordinal', async () => {
    const { rows: columns } = await db.query(
      `select column_name as name, is_nullable = 'NO' as required from information_schema.columns where table_schema = 'projects' and table_name = 'request_images' order by column_name`,
    );
    // On purpose changed (Story 2.3): four nullable columns are added (the person's label and the browser's three measurements: all four or none), and no other.
    // On purpose changed again (Story 2.12): three more nullable columns, the pins (the retained copy's manifest root, SHA-256 and length: all three or none).
    const required = ['revision_id', 'project_id', 'account_id', 'position', 'upload_id', 'sha256', 'length', 'content_type'];
    const added = ['view_label', 'short_edge_px', 'blur_variance', 'clipped_fraction', 'retained_root', 'retained_sha256', 'retained_length'];
    expect(columns.map((column) => column.name)).toEqual([...required, ...added].sort());
    expect(columns.filter((column) => column.required).map((column) => column.name)).toEqual(required.sort());
    expect(columns.filter((column) => !column.required).map((column) => column.name)).toEqual(added.sort());
    // On purpose changed (Story 2.12): `root` and `retain` are allowed in the three pin columns `retained_*` (and in no other name); the rest stay banned.
    for (const column of columns) expect(column.name.replace(/^retained_(root|sha256|length)$/, ''), column.name).not.toMatch(/manifest|root|retain|pin|ordinal|digest|approv|permission|payment|cost|job/);
  });

  it('has the primary key (revision_id, position), a unique (revision_id, upload_id) and foreign keys that restrict', async () => {
    const { rows: constraints } = await db.query(
      `select contype, pg_get_constraintdef(oid) as definition, confdeltype from pg_constraint where conrelid = 'projects.request_images'::regclass and contype in ('p', 'u', 'f') order by contype, conname`,
    );
    const by = (type: string) => constraints.filter((constraint) => constraint.contype === type);
    expect(by('p').map((constraint) => constraint.definition)).toEqual(['PRIMARY KEY (revision_id, "position")']);
    expect(by('u').map((constraint) => constraint.definition)).toEqual(['UNIQUE (revision_id, upload_id)']);
    expect(by('f')).toHaveLength(2);
    for (const key of by('f')) expect(key.confdeltype, key.definition).toBe('r');
    expect(by('f').map((key) => key.definition).sort()).toEqual([
      'FOREIGN KEY (project_id, account_id) REFERENCES projects.projects(id, account_id) ON DELETE RESTRICT',
      'FOREIGN KEY (revision_id, project_id, account_id) REFERENCES projects.request_revisions(id, project_id, account_id) ON DELETE RESTRICT',
    ]);
  });

  it('refuses a position outside 1 to 12, a SHA-256 that is not 64 lower-case hexadecimal digits, a length outside 1 byte to 12 MiB and a type that is not JPEG, PNG or WebP', async () => {
    await inTx(async (client) => {
      const { revision } = await revisionToHold(client);
      expect((await insertImage(client, revision, {position: 1, length: 1})).ok).toBe(true);
      expect((await insertImage(client, revision, {position: 12, length: 12 * MiB, content_type: 'image/webp'})).ok).toBe(true);
      expect((await insertImage(client, revision, {position: 2, content_type: 'image/jpeg'})).ok).toBe(true);
      const refused: [string, Record<string, unknown>][] = [
        ['position 0', {position: 0}],
        ['position 13', {position: 13}],
        ['a short SHA-256', {sha256: 'c'.repeat(63)}],
        ['an upper-case SHA-256', {sha256: 'C'.repeat(64)}],
        ['a SHA-256 that is not hexadecimal', {sha256: 'g'.repeat(64)}],
        ['length 0', {length: 0}],
        ['length 12 MiB + 1', {length: 12 * MiB + 1}],
        ['a GIF', {content_type: 'image/gif'}],
        ['a HEIC', {content_type: 'image/heic'}],
        ['a file type', {content_type: 'application/octet-stream'}],
      ];
      for (const [label, patch] of refused) {
        const result = await insertImage(client, revision, {position: 3, ...patch});
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('23514');
      }
    });
  });

  it('holds a position once and an upload once for a revision', async () => {
    await inTx(async (client) => {
      const { revision } = await revisionToHold(client);
      const upload = randomUUID();
      expect((await insertImage(client, revision, {position: 1, upload_id: upload})).ok).toBe(true);
      const samePosition = await insertImage(client, revision, {position: 1});
      expect(samePosition.ok).toBe(false);
      if (!samePosition.ok) expect(samePosition.code).toBe('23505');
      const sameUpload = await insertImage(client, revision, {position: 2, upload_id: upload});
      expect(sameUpload.ok).toBe(false);
      if (!sameUpload.ok) expect(sameUpload.code).toBe('23505');
    });
  });

  it('cannot name another Account\'s or another Project\'s revision (the foreign key is composite), and a revision or Project with pictures cannot be deleted before them', async () => {
    await inTx(async (client) => {
      const { a, revision } = await revisionToHold(client);
      const b = await account(client);
      const crossAccount = await insertImage(client, revision, {account_id: b.accountId});
      expect(crossAccount.ok).toBe(false);
      if (!crossAccount.ok) expect(crossAccount.code).toBe('23503');
      const otherProject = await project(client, a);
      const crossProject = await insertImage(client, revision, {project_id: otherProject});
      expect(crossProject.ok).toBe(false);
      if (!crossProject.ok) expect(crossProject.code).toBe('23503');
      const unknown = await insertImage(client, revision, {revision_id: randomUUID()});
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.code).toBe('23503');
      expect((await insertImage(client, revision)).ok).toBe(true);
      for (const [sql, param] of [['delete from projects.request_revisions where id = $1', revision.id], ['delete from projects.projects where id = $1', revision.projectId]]) {
        const removal = await attempt(client, null, sql, [param]);
        expect(removal.ok, sql).toBe(false);
        if (!removal.ok) expect(removal.code, sql).toBe('23503');
      }
      // The purge (Epic 8) removes the pictures, then the revision, then the Project.
      expect((await attempt(client, null, 'delete from projects.request_images where revision_id = $1', [revision.id])).ok).toBe(true);
      expect((await attempt(client, null, 'delete from projects.request_revisions where id = $1', [revision.id])).ok).toBe(true);
      expect((await attempt(client, null, 'delete from projects.projects where id = $1', [revision.projectId])).ok).toBe(true);
    });
  });

  it('is never updated and never truncated', async () => {
    await inTx(async (client) => {
      const { revision } = await revisionToHold(client);
      const upload = randomUUID();
      expect((await insertImage(client, revision, {upload_id: upload})).ok).toBe(true);
      for (const change of ['position = 2', "sha256 = '" + 'd'.repeat(64) + "'", 'length = 2', "content_type = 'image/jpeg'", 'upload_id = gen_random_uuid()', 'revision_id = revision_id']) {
        const result = await attempt(client, null, `update projects.request_images set ${change} where upload_id = $1`, [upload]);
        expect(result.ok, change).toBe(false);
        if (!result.ok) expect(result.code, change).toBe('55000');
      }
      const truncate = await attempt(client, null, 'truncate projects.request_images');
      expect(truncate.ok).toBe(false);
      if (!truncate.ok) expect(truncate.code).toBe('55000');
      expect((await client.query('select count(*)::int as n from projects.request_images where upload_id = $1', [upload])).rows[0].n).toBe(1);
    });
  });

  it('is closed: row-level security on, no policy, no privilege for public, anon, authenticated or service_role, no ACL entry for PUBLIC, and nothing over REST', async () => {
    const { rows: found } = await db.query(
      `select c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies from pg_class c where c.oid = 'projects.request_images'::regclass`,
    );
    expect(found[0]).toEqual({rls: true, policies: 0});
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      const { rows: privilege } = await db.query(`select has_table_privilege($1, 'projects.request_images', 'select,insert,update,delete,truncate,references,trigger') as any_privilege`, [role]);
      expect(privilege[0].any_privilege, role).toBe(false);
    }
    const { rows: publicGrants } = await db.query(`select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = 'projects.request_images'::regclass and a.grantee = 0`);
    expect(publicGrants).toEqual([]);
    for (const key of [stack.anonKey, stack.serviceKey]) {
      const headers = {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'accept-profile': 'projects', 'content-profile': 'projects'};
      expect((await fetch(`${stack.apiUrl}/rest/v1/request_images?select=*`, {headers})).status).toBe(406);
      expect((await fetch(`${stack.apiUrl}/rest/v1/request_images`, {method: 'POST', headers, body: '{}'})).status).toBe(406);
      expect((await fetch(`${stack.apiUrl}/rest/v1/request_images?select=*`, {method: 'DELETE', headers})).status).toBe(406);
    }
    await inTx(async (client) => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const sql of ['select * from projects.request_images', 'insert into projects.request_images default values', 'delete from projects.request_images', 'truncate projects.request_images']) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('closure: the new functions are reached by the service role only', () => {
  const newOnes = ['api.record_picture_set(uuid,bigint,uuid,uuid,text,uuid[])', 'api.release_staged_pictures(uuid,bigint,uuid[])', 'api.read_project_request(uuid,bigint,uuid)'];
  const helpers = ['projects.picture_set_digest(uuid,uuid,uuid[])', 'projects.check_revision_seq()', 'projects.refuse_image_change()'];

  it('runs the api functions as their owner with a pinned search_path, executable by service_role and by no other role (public included)', async () => {
    for (const signature of newOnes) {
      const { rows: found } = await db.query(
        `select p.prosecdef as definer, p.proconfig as config, p.proacl is null as default_acl,
                coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1)
                            from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
           from pg_proc p where p.oid = $1::regprocedure`,
        [signature],
      );
      expect(found[0].definer, signature).toBe(true);
      expect(String(found[0].config), signature).toContain('search_path=');
      expect(found[0].default_acl, signature).toBe(false);
      expect(found[0].grantees, signature).toEqual(['service_role']);
      for (const role of ['anon', 'authenticated']) expect((await db.query(`select has_function_privilege($1, $2, 'execute') as can`, [role, signature])).rows[0].can, `${role} ${signature}`).toBe(false);
      expect((await db.query(`select has_function_privilege('service_role', $1, 'execute') as can`, [signature])).rows[0].can, signature).toBe(true);
    }
  });

  it('refuses the new functions to anon and authenticated with a permission error', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const role of ['anon', 'authenticated']) {
        const saved = await attempt(client, role, recordSql, [a.accountId, 1, randomUUID(), null, TITLE, [randomUUID()]]);
        expect(saved.ok, role).toBe(false);
        if (!saved.ok) expect(saved.code, role).toBe('42501');
        const freed = await attempt(client, role, 'select * from api.release_staged_pictures($1, 1, $2)', [a.accountId, [randomUUID()]]);
        expect(freed.ok, role).toBe(false);
        if (!freed.ok) expect(freed.code, role).toBe('42501');
      }
    });
  });

  it('grants the helpers to nobody: the digest, the seq check and the guard are called by SQL that runs as the owner', async () => {
    for (const signature of helpers) {
      const { rows: found } = await db.query(
        `select p.proacl is null as default_acl,
                coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1)
                            from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees,
                p.proconfig as config
           from pg_proc p where p.oid = $1::regprocedure`,
        [signature],
      );
      expect(found[0].grantees, signature).toEqual([]);
      expect(String(found[0].config), signature).toContain('search_path=');
      for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
        expect((await db.query(`select has_function_privilege($1, $2, 'execute') as can`, [role, signature])).rows[0].can, `${role} ${signature}`).toBe(false);
      }
    }
    await inTx(async (client) => {
      const result = await attempt(client, 'service_role', `select projects.picture_set_digest($1, null, array[$2]::uuid[])`, [randomUUID(), randomUUID()]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('42501');
    });
  });

  it('computes the digest of a set that is not the Account\'s own as null (such a set cannot be the one a revision recorded), and the same digest the writer stores', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const mine = await lease(client, a);
      const theirs = await lease(client, b);
      const digest = async (accountId: string, projectId: string | null, uploads: string[]) =>
        (await client.query('select projects.picture_set_digest($1, $2, $3::uuid[]) as digest', [accountId, projectId, uploads])).rows[0].digest as string | null;
      expect(await digest(a.accountId, null, [mine.id])).toBe(digestOf(null, [mine]));
      expect(await digest(a.accountId, null, [mine.id, theirs.id])).toBeNull();
      expect(await digest(a.accountId, null, [randomUUID()])).toBeNull();
      const projectId = randomUUID();
      expect(await digest(a.accountId, projectId, [mine.id])).toBe(digestOf(projectId, [mine]));
      expect(await digest(a.accountId, projectId, [mine.id])).not.toBe(await digest(a.accountId, null, [mine.id]));
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.read_project_request: confirmed, and the pictures', () => {
  // On purpose changed (Story 2.3): a picture of a set that was never reviewed has the four review members, all null.
  const unreviewed = {label: null, short_edge_px: null, blur_variance: null, clipped_fraction: null};

  it('has the columns the story lists, in this order, and none that names a manifest, job, cost, price or payment', async () => {
    const { rows: columns } = await db.query(
      `select a.attname as name from pg_type t join pg_attribute a on a.attrelid = t.typrelid where t.oid = 'api.project_request_view'::regtype and a.attnum > 0 and not a.attisdropped order by a.attnum`,
    );
    expect(columns.map((column) => column.name)).toEqual([
      'outcome', 'request_id', 'project_id', 'seq', 'mode', 'subject_id', 'scope', 'intended_outcome', 'description', 'personalization_wording', 'personalization_text',
      'personalization_style', 'personalization_applied', 'personalization_reason', 'confirmed_at', 'confirmed', 'images',
      // On purpose changed (Story 2.3): the review of the revision comes last.
      'obstruction_confirmed', 'obstruction_confirmed_at', 'acknowledged', 'acknowledged_at',
    ]);
    for (const column of columns) expect(column.name, column.name).not.toMatch(/manifest|job|cost|price|payment/);
  });

  it('answers an unconfirmed picture revision: not confirmed, no scope, outcome, description or time, the mode evidence_images, and the pictures in order with what each lease holds', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = [await lease(client, a, {length: 111, ct: 'image/jpeg'}), await lease(client, a, {length: 222, ct: 'image/webp'}), await lease(client, a, {length: 333})];
      const { projectId, requestId } = await pictureProject(client, a, [set[2], set[0], set[1]]);
      const found = await read(client, a, projectId);
      const [expiry] = (await client.query('select expires_at from artifacts.staging_leases where id = $1', [set[0].id])).rows;
      expect(found).toMatchObject({
        outcome: 'found',
        request_id: requestId,
        project_id: projectId,
        seq: 1,
        mode: 'evidence_images',
        subject_id: null,
        scope: null,
        intended_outcome: null,
        description: null,
        personalization_wording: null,
        personalization_text: null,
        personalization_style: null,
        personalization_applied: false,
        personalization_reason: null,
        confirmed_at: null,
        confirmed: false,
        obstruction_confirmed: false,
        obstruction_confirmed_at: null,
        acknowledged: false,
        acknowledged_at: null,
      });
      expect(found.images).toEqual([
        {position: 1, upload_id: set[2].id, sha256: set[2].sha, length: 333, content_type: 'image/png', expires_at: expect.any(String), available: true, ...unreviewed},
        {position: 2, upload_id: set[0].id, sha256: set[0].sha, length: 111, content_type: 'image/jpeg', expires_at: expect.any(String), available: true, ...unreviewed},
        {position: 3, upload_id: set[1].id, sha256: set[1].sha, length: 222, content_type: 'image/webp', expires_at: expect.any(String), available: true, ...unreviewed},
      ]);
      expect(new Date(found.images[1].expires_at).getTime()).toBe(expiry.expires_at.getTime());
    });
  });

  it('says a picture is available only while its upload is complete and unexpired', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 4);
      const { projectId } = await pictureProject(client, a, set);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [set[1].id]);
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[2].id]);
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[3].id]);
      await client.query(`update artifacts.staging_leases set state = 'deleted' where id = $1`, [set[3].id]);
      const found = await read(client, a, projectId);
      expect(found.images.map((image: {position: number; available: boolean}) => [image.position, image.available])).toEqual([[1, true], [2, false], [3, false], [4, false]]);
    });
  });

  it('answers only the latest revision\'s pictures, and a text revision as confirmed with none', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, [set[0], set[1]]);
      await record(client, a, {project: projectId, uploads: [set[2].id]});
      const latest = await read(client, a, projectId);
      expect(latest).toMatchObject({seq: 2, confirmed: false});
      expect(latest.images.map((image: {upload_id: string}) => image.upload_id)).toEqual([set[2].id]);
      const create = 'select * from api.create_project_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)';
      const text = await asService(client, create, [a.accountId, 1, randomUUID(), 'The altar', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', 'Build the altar', null, null, null, false, null]);
      const textual = await read(client, a, text.project_id);
      expect(textual).toMatchObject({outcome: 'found', confirmed: true, images: [], scope: 'Scope', intended_outcome: 'Outcome', description: 'Build the altar'});
      expect(textual.confirmed_at).toBeInstanceOf(Date);
    });
  });

  it('answers nothing in `confirmed` and `images` when there is no revision, no authority or no Project, and the same row for every kind of unavailable', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const bare = await project(client, a);
      const none = await read(client, a, bare);
      expect(none).toMatchObject({outcome: 'none', confirmed: null, images: null, scope: null, confirmed_at: null});
      const theirs = await pictureProject(client, b, await leases(client, b, 1));
      const gone = await pictureProject(client, a, await leases(client, a, 1));
      await client.query('update projects.projects set deleted_at = clock_timestamp(), revision = revision + 1 where id = $1', [gone.projectId]);
      const unavailable = await read(client, a, randomUUID());
      expect(unavailable).toMatchObject({outcome: 'unavailable', confirmed: null, images: null});
      for (const target of [theirs.projectId, gone.projectId]) expect(await read(client, a, target), target).toEqual(unavailable);
      expect(await read(client, a, bare, 9)).toMatchObject({outcome: 'denied', confirmed: null, images: null});
    });
  });

  it('holds no key of Storage, no address and no download URL in what it answers: a picture is eleven values (seven, and the label and three measurements of a review)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const { projectId } = await pictureProject(client, a, await leases(client, a, 2));
      const found = await read(client, a, projectId);
      for (const image of found.images) expect(Object.keys(image).sort()).toEqual(['available', 'blur_variance', 'clipped_fraction', 'content_type', 'expires_at', 'label', 'length', 'position', 'sha256', 'short_edge_px', 'upload_id']);
      const text = JSON.stringify(found);
      expect(text).not.toMatch(/staging\/|objects\/|https?:|\/storage\/|signed|token|ticket|private-files/i);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries the Story 2.2 table and functions', () => {
  const functions = ['api.record_picture_set(uuid,bigint,uuid,uuid,text,uuid[])', 'api.release_staged_pictures(uuid,bigint,uuid[])', 'projects.picture_set_digest(uuid,uuid,uuid[])'];

  it('answers ok to the service role, and names the table, the block of this story, the three functions and every earlier block', async () => {
    await inTx(async (client) => {
      expect(await asService(client, 'select ok from api.preflight()', [])).toEqual({ok: true});
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [
      'projects.request_images', 'y.revision_id', 'y.upload_id', 'y.sha256', 'y.content_type', 'Story 2.2 migration', ...functions,
      // Every earlier probe is still there.
      'projects.request_revisions', 'Story 2.1 migration', 'Story 1.13 migration', 'Story 1.12 migration', 'Story 1.9 migration', 'Story 1.8 migration', 'Story 1.7 migration', 'Story 1.6 migration', 'Story 1.5 migration',
      'artifacts.staging_leases', 'lifecycle.alarms', 'auth.mfa_amr_claims', 'private-files',
    ]) expect(definition, needle).toContain(needle);
    // The service role must be able to execute all thirty-eight api functions (Story 2.3 added the thirty-sixth, Story 2.12 the last two), the two of this story among them; the bucket check is still the last of all.
    const check = definition.indexOf('where not has_function_privilege');
    const executable = definition.slice(definition.lastIndexOf('unnest(array[', check), check);
    // On purpose changed (Story 2.11): forty-seven since it added the six functions of the Job records (it was forty-one after the three functions of the usage limits).
    // On purpose changed (Story 2.6): fifty since it added the three functions of the cost reservations (it was forty-seven after the six functions of the Job records).
    expect(executable.match(/'api\.[a-z_]+\([^']*\)'/g)).toHaveLength(50);
    expect(executable).toContain(functions[0]);
    expect(executable).toContain(functions[1]);
    expect(definition.indexOf('Story 2.2 migration')).toBeLessThan(check);
    expect(definition.indexOf("b.id = 'private-files'")).toBeGreaterThan(definition.indexOf("has_table_privilege('auth.users', 'DELETE')"));
  });

  it.each(functions)('fails the build with one line naming %s when it is missing', async (signature) => {
    await inTx(async (client) => {
      await client.query(`drop function ${signature.replace(/,/g, ', ')} cascade`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('Story 2.2');
        expect(result.message).toContain(signature.split('(')[0]);
      }
    });
  });

  it('fails, naming the privilege, when the service role cannot execute one of the new api functions', async () => {
    await inTx(async (client) => {
      await client.query('revoke execute on function api.release_staged_pictures(uuid, bigint, uuid[]) from service_role');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('api.release_staged_pictures');
      }
    });
  });

  it('is refused to anon and authenticated', async () => {
    await inTx(async (client) => {
      for (const role of ['anon', 'authenticated']) expect((await attempt(client, role, 'select * from api.preflight()')).ok, role).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('two connections at once (real connections, committed data)', () => {
  const callOn = async (client: Client, who: Fixture, save: Save) => (await client.query(recordSql, recordValues(who, save))).rows[0];

  it('is one Project and one revision, and one replay, when the same command arrives twice at once, over 8 rounds', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 8; round += 1) {
      const a = await committedAccount();
      const set = await leases(db, a, 3);
      left.push(...ids(set));
      const command = randomUUID();
      const answers = await Promise.all([one, two].map((client) => callOn(client, a, {command, uploads: ids(set)})));
      expect(answers.map((answer) => answer.outcome).sort(), `round ${round}`).toEqual(['created', 'replayed']);
      expect(answers[0].project_id, `round ${round}`).toBe(answers[1].project_id);
      expect(answers[0].request_id, `round ${round}`).toBe(answers[1].request_id);
      expect(await counts(db, a.accountId), `round ${round}`).toEqual({projects: 1, revisions: 1, images: 3});
    }
  });

  it('is one creation and one refusal when the same command ID arrives at once for two different sets, and the second can never overwrite the first', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 4; round += 1) {
      const a = await committedAccount();
      const set = await leases(db, a, 2);
      left.push(...ids(set));
      const command = randomUUID();
      const answers = await Promise.all([callOn(one, a, {command, uploads: [set[0].id]}), callOn(two, a, {command, uploads: [set[1].id]})]);
      expect(answers.map((answer) => answer.outcome).sort(), `round ${round}`).toEqual(['created', 'reused']);
      expect(await counts(db, a.accountId), `round ${round}`).toEqual({projects: 1, revisions: 1, images: 1});
    }
  });

  it('numbers two successors sent at once 2 and 3 in turn, raises the Project to revision 3, and keeps what the latest of them carries', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 4; round += 1) {
      const a = await committedAccount();
      const set = await leases(db, a, 3);
      left.push(...ids(set));
      const { projectId } = await committedPictureProject(a, [set[0], set[1]]);
      // A reorders what is there; B adds a third: whichever comes second finds the other's revision as the latest, and both are changes.
      const answers = await Promise.all([callOn(one, a, {project: projectId, uploads: [set[1].id, set[0].id]}), callOn(two, a, {project: projectId, uploads: ids(set)})]);
      expect(answers.map((answer) => answer.outcome), `round ${round}`).toEqual(['revised', 'revised']);
      expect(answers.map((answer) => answer.seq).sort(), `round ${round}`).toEqual([2, 3]);
      expect((await projectsOf(db, a.accountId))[0].revision, `round ${round}`).toBe(3);
      expect((await revisionsOf(db, a.accountId)).map((revision) => revision.seq), `round ${round}`).toEqual([1, 2, 3]);
      // The latest revision is whichever came second, and everything it carries is still staged (what the earlier revision carried and it does not was released).
      const latest = await readCommitted(db, a, projectId);
      expect(latest.seq, `round ${round}`).toBe(3);
      expect(latest.images.every((image: {available: boolean}) => image.available), `round ${round}`).toBe(true);
      for (const image of latest.images) expect((await leaseRow(db, image.upload_id)).state, `round ${round} ${image.upload_id}`).toBe('complete');
    }
  });

  it('never records an upload that a save just before it released: of two successors that drop each other\'s pictures, the one that comes second is `not_ready` or both are recorded in turn', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 4; round += 1) {
      const a = await committedAccount();
      const set = await leases(db, a, 3);
      left.push(...ids(set));
      const { projectId } = await committedPictureProject(a, [set[0], set[1]]);
      // A drops set[0] (and releases it); B keeps it and drops set[1] (and releases that), adding a third.
      const answers = await Promise.all([callOn(one, a, {project: projectId, uploads: [set[1].id]}), callOn(two, a, {project: projectId, uploads: [set[0].id, set[2].id]})]);
      const outcomes = answers.map((answer) => answer.outcome).sort();
      expect(['not_ready,revised', 'revised,revised'], `round ${round}`).toContain(outcomes.join());
      const revisions = await revisionsOf(db, a.accountId);
      expect(revisions.map((revision) => revision.seq), `round ${round}`).toEqual(outcomes.includes('not_ready') ? [1, 2] : [1, 2, 3]);
      expect((await projectsOf(db, a.accountId))[0].revision, `round ${round}`).toBe(revisions.length);
      // Whatever the latest revision carries is still there to be read.
      const latest = await readCommitted(db, a, projectId);
      if (outcomes.includes('not_ready')) continue;
      expect(latest.images.every((image: {available: boolean}) => image.available), `round ${round}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls, over REST as the application makes them (committed data)', () => {
  it('records, replays, revises, finds nothing changed and refuses a reused command, every answer checked', async () => {
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const options = {env};
    const set = await leases(db, a, 3);
    left.push(...ids(set));
    const command = randomUUID();

    const created = await recordPictureSet(operation, {commandId: command, projectId: null, title: TITLE, uploadIds: ids(set)}, options);
    expect(created).toEqual({outcome: 'created', projectId: expect.stringMatching(/^[0-9a-f-]{36}$/), requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), seq: 1, released: 0});
    if (created.outcome !== 'created') throw new Error('not created');
    expect(await recordPictureSet(operation, {commandId: command, projectId: null, title: TITLE, uploadIds: ids(set)}, options)).toEqual({...created, outcome: 'replayed', released: 0});
    expect(await recordPictureSet(operation, {commandId: command, projectId: null, title: TITLE, uploadIds: [set[0].id]}, options)).toEqual({outcome: 'reused'});
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 1, images: 3});
    expect((await projectsOf(db, a.accountId))[0]).toMatchObject({id: created.projectId, title: TITLE, stage: 'request_draft', revision: 1});

    // The IDs of a request are lower-cased, and an upper-case ID is the same upload.
    const revised = await recordPictureSet(operation, {commandId: randomUUID(), projectId: created.projectId, title: null, uploadIds: [set[2].id.toUpperCase(), set[0].id, set[1].id]}, options);
    expect(revised).toMatchObject({outcome: 'revised', projectId: created.projectId, seq: 2, released: 0});
    expect(await recordPictureSet(operation, {commandId: randomUUID(), projectId: created.projectId, title: null, uploadIds: [set[2].id, set[0].id, set[1].id]}, options)).toMatchObject({outcome: 'unchanged', projectId: created.projectId, seq: 2});
    const smaller = await recordPictureSet(operation, {commandId: randomUUID(), projectId: created.projectId, title: null, uploadIds: [set[1].id]}, options);
    expect(smaller).toMatchObject({outcome: 'revised', seq: 3, released: 2});
    expect((await leaseRow(db, set[0].id)).state).toBe('released');
  });

  it('maps every refusal: unknown_upload, not_ready, expired_upload and duplicate_image with their position, too_large, unavailable, not_editable and denied', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const options = {env};
    const good = await lease(db, a);
    const foreign = await lease(db, b);
    const receiving = await lease(db, a, {state: 'receiving'});
    const expired = await lease(db, a, {expires: -60});
    const big = await leases(db, a, 6, {length: 11 * MiB});
    const sameBytes = randomBytes(32).toString('hex');
    const same = await lease(db, a, {sha: sameBytes});
    const original = await lease(db, a, {sha: sameBytes});
    left.push(good.id, foreign.id, receiving.id, expired.id, same.id, original.id, ...ids(big));
    const send = (uploadIds: string[], over: {projectId?: string | null; title?: string | null; epoch?: number} = {}) =>
      recordPictureSet({accountId: a.accountId, epoch: over.epoch ?? 1}, {commandId: randomUUID(), projectId: over.projectId ?? null, title: over.title === undefined ? (over.projectId ? null : TITLE) : over.title, uploadIds}, options);

    expect(await send([good.id, foreign.id])).toEqual({outcome: 'unknown_upload', position: 2});
    expect(await send([randomUUID()])).toEqual({outcome: 'unknown_upload', position: 1});
    expect(await send([good.id, receiving.id])).toEqual({outcome: 'not_ready', position: 2});
    expect(await send([expired.id, good.id])).toEqual({outcome: 'expired_upload', position: 1});
    expect(await send([good.id, original.id, same.id])).toEqual({outcome: 'duplicate_image', position: 3});
    expect(await send(ids(big))).toEqual({outcome: 'too_large'});
    expect(await send([good.id], {projectId: randomUUID()})).toEqual({outcome: 'unavailable'});
    const bare = await project(db, a);
    expect(await send([good.id], {projectId: bare})).toEqual({outcome: 'not_editable'});
    expect(await send([good.id], {epoch: 7})).toEqual({outcome: 'denied'});
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 0, images: 0});
  });

  it('releases, and reads the pictures back: confirmed false, no scope, and every picture with its expiry and whether it is available', async () => {
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const options = {env};
    const set = await leases(db, a, 2, {ct: 'image/jpeg', length: 5000});
    const stray = await lease(db, a);
    const file = await lease(db, a, {kind: 'file'});
    left.push(...ids(set), stray.id, file.id);
    const created = await recordPictureSet(operation, {commandId: randomUUID(), projectId: null, title: TITLE, uploadIds: ids(set)}, options);
    if (created.outcome !== 'created') throw new Error('not created');

    // Only the stray picture upload is released: the saved ones are used by a revision and the file is not a picture.
    expect(await releaseStagedPictures(operation, [stray.id, set[0].id, file.id, randomUUID()], options)).toEqual({outcome: 'released', released: 1});
    expect(await releaseStagedPictures(operation, [stray.id], options)).toEqual({outcome: 'released', released: 0});
    expect(await releaseStagedPictures({accountId: a.accountId, epoch: 4}, [stray.id], options)).toEqual({outcome: 'denied'});

    const found = await readProjectRequest(operation, created.projectId, options);
    expect(found.outcome).toBe('found');
    if (found.outcome !== 'found') return;
    expect(found.request).toMatchObject({
      id: created.requestId,
      projectId: created.projectId,
      seq: 1,
      mode: 'evidence_images',
      confirmed: false,
      subjectId: null,
      scope: null,
      outcome: null,
      description: null,
      confirmedAt: null,
      personalization: {wording: null, text: null, style: null, applied: false, reason: null},
    });
    expect(found.request.images).toEqual(
      set.map((entry, index) => ({position: index + 1, uploadId: entry.id, sha256: entry.sha, length: 5000, contentType: 'image/jpeg', expiresAt: expect.any(String), available: true, label: null, shortEdgePx: null, blurVariance: null, clippedFraction: null})),
    );
    // A picture whose lease has lapsed is read as not available.
    await db.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 minute' where id = $1`, [set[1].id]);
    const lapsed = await readProjectRequest(operation, created.projectId, options);
    if (lapsed.outcome === 'found') expect(lapsed.request.images.map((image) => image.available)).toEqual([true, false]);
  });

  it('a rename that reuses a revision\'s command ID is refused by the typed call too, and the Project keeps its name', async () => {
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const set = await leases(db, a, 1);
    left.push(...ids(set));
    const command = randomUUID();
    const created = await recordPictureSet(operation, {commandId: command, projectId: null, title: TITLE, uploadIds: ids(set)}, {env});
    if (created.outcome !== 'created') throw new Error('not created');
    expect(await renameProjectCommand(operation, {commandId: command, projectId: created.projectId, expectedRevision: 1, title: 'Renamed'}, {env})).toEqual({outcome: 'reused'});
    expect((await projectsOf(db, a.accountId))[0]).toMatchObject({title: TITLE, revision: 1});
    expect(await renameProjectCommand(operation, {commandId: randomUUID(), projectId: created.projectId, expectedRevision: 1, title: 'Renamed'}, {env})).toMatchObject({outcome: 'renamed'});
  });

  it('refuses arguments that are not shaped like arguments before the database is asked, and throws when it cannot be reached or refuses the call', async () => {
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const good = randomUUID();
    const base = {commandId: randomUUID(), projectId: null, title: TITLE};
    await expect(recordPictureSet(operation, {...base, uploadIds: []}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureSet(operation, {...base, uploadIds: Array.from({length: 13}, () => randomUUID())}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureSet(operation, {...base, uploadIds: [good, good]}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureSet(operation, {...base, uploadIds: [good, 'not-an-id']}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureSet(operation, {...base, commandId: 'not-an-id', uploadIds: [good]}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureSet(operation, {...base, projectId: 'not-an-id', title: null, uploadIds: [good]}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(recordPictureSet({accountId: a.accountId, epoch: 0}, {...base, uploadIds: [good]}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(releaseStagedPictures(operation, [], {env})).rejects.toBeInstanceOf(TypeError);
    await expect(releaseStagedPictures(operation, [good, good], {env})).rejects.toBeInstanceOf(TypeError);
    const unreachable = {env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}};
    await expect(recordPictureSet(operation, {...base, uploadIds: [good]}, unreachable)).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true, outcomeUnknown: true});
    await expect(releaseStagedPictures(operation, [good], unreachable)).rejects.toBeInstanceOf(AccountsUnavailableError);
    // A key that may not execute the function: the database says no, and the answer is an error.
    const refused = {env: {...env, SUPABASE_SERVICE_ROLE_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY}};
    await expect(recordPictureSet(operation, {...base, uploadIds: [good]}, refused)).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: false, code: '42501'});
    await expect(releaseStagedPictures(operation, [good], refused)).rejects.toMatchObject({code: '42501'});
    expect(await counts(db, a.accountId)).toEqual({projects: 0, revisions: 0, images: 0});
  });

  describe('refuses an answer that is not an answer', () => {
    const answering = (body: unknown) => ({env, fetch: (async () => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}})) as typeof fetch});
    const operation = {accountId: randomUUID(), epoch: 1};
    const sent = {commandId: randomUUID(), projectId: null, title: TITLE, uploadIds: [randomUUID(), randomUUID()]};
    const uploadId = randomUUID();
    const picture = {position: 1, upload_id: uploadId, sha256: 'a'.repeat(64), length: 10, content_type: 'image/png', expires_at: '2026-10-19T12:00:00+00:00', available: true, label: null, short_edge_px: null, blur_variance: null, clipped_fraction: null};
    const found = {
      outcome: 'found', request_id: randomUUID(), project_id: randomUUID(), seq: 1, mode: 'evidence_images', subject_id: null, scope: null, intended_outcome: null, description: null,
      personalization_wording: null, personalization_text: null, personalization_style: null, personalization_applied: false, personalization_reason: null, confirmed_at: null, confirmed: false,
      images: [picture], obstruction_confirmed: false, obstruction_confirmed_at: null, acknowledged: false, acknowledged_at: null,
    };

    it.each([
      ['an outcome that is none of the outcomes', {outcome: 'surprise'}],
      ['no outcome', {}],
      ['an answer about an upload that does not say which', {outcome: 'unknown_upload', position: null}],
      ['a position past the end of the set', {outcome: 'not_ready', position: 3}],
      ['a position of 0', {outcome: 'expired_upload', position: 0}],
      ['a recorded set with no Project', {outcome: 'created', project_id: null, request_id: randomUUID(), seq: 1, released: 0}],
      ['a recorded set with a Project that is not an ID', {outcome: 'revised', project_id: 'x', request_id: randomUUID(), seq: 2, released: 0}],
      ['a recorded set with no number', {outcome: 'unchanged', project_id: randomUUID(), request_id: randomUUID(), seq: null, released: null}],
      ['a recorded set with a negative count of released uploads', {outcome: 'created', project_id: randomUUID(), request_id: randomUUID(), seq: 1, released: -1}],
    ])('from record_picture_set: %s', async (_label, body) => {
      await expect(recordPictureSet(operation, sent, answering(body))).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: true});
    });

    it('from release_staged_pictures: an outcome that is none, and a count that passes what was asked', async () => {
      await expect(releaseStagedPictures(operation, [uploadId], answering({outcome: 'surprise', released: 1}))).rejects.toMatchObject({outcomeUnknown: true});
      await expect(releaseStagedPictures(operation, [uploadId], answering({outcome: 'released', released: 2}))).rejects.toMatchObject({outcomeUnknown: true});
      await expect(releaseStagedPictures(operation, [uploadId], answering({outcome: 'released', released: null}))).rejects.toMatchObject({outcomeUnknown: true});
    });

    it('from read_project_request: pictures that are not in order, not a picture, or a revision that contradicts itself', async () => {
      const bad: [string, Record<string, unknown>][] = [
        ['pictures that are not an array', {images: {}}],
        ['a first picture at position 2', {images: [{...picture, position: 2}]}],
        ['a SHA-256 that is not one', {images: [{...picture, sha256: 'abc'}]}],
        ['a type that is not a picture\'s', {images: [{...picture, content_type: 'image/gif'}]}],
        ['a length of 0', {images: [{...picture, length: 0}]}],
        ['an upload that is not an ID', {images: [{...picture, upload_id: 'x'}]}],
        ['no availability', {images: [{...picture, available: null}]}],
        ['more than twelve pictures', {images: Array.from({length: 13}, (_x, index) => ({...picture, position: index + 1, upload_id: randomUUID()}))}],
        ['no `confirmed`', {confirmed: null}],
        ['an unconfirmed revision with a scope', {scope: 'Scope'}],
        ['an unconfirmed revision with a subject', {subject_id: 'middot-altar-ramp'}],
        ['an unconfirmed text request', {mode: 'evidence_text'}],
        ['a confirmed revision with no description', {confirmed: true, confirmed_at: '2026-10-19T12:00:00+00:00', scope: 'Scope', intended_outcome: 'Outcome'}],
      ];
      for (const [label, patch] of bad) {
        const projectId = String((found as Record<string, unknown>).project_id);
        await expect(readProjectRequest(operation, projectId, answering({...found, ...patch})), label).rejects.toMatchObject({name: 'AccountsUnavailableError', outcomeUnknown: true});
      }
      // The same row with nothing wrong is read.
      const good = await readProjectRequest(operation, String(found.project_id), answering(found));
      expect(good.outcome).toBe('found');
    });
  });
});
