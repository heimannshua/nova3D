import {createHash, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, describe, expect, it} from 'vitest';
import {createHarness} from '../support/accounts-db';

// Story 2.12 against the Supabase CLI stack: retaining the pictures a person confirmed. The strip transform's rules in artifacts.publish_attachment (the retained
// digest and length from the canonical body, the 2 GiB quota under its advisory lock), the read-only pre-check api.check_picture_retention, the pins the review
// writer and the picture-set writer record, api.read_retained_pictures, the live-authorization view of the retained-picture resolver, and the table checks.
// The review writer's own cases (not_retained, unchanged needing the same pins, the staged copies expiring) are in tests/integration/picture-review.test.ts, and the
// real gateway against real Storage in tests/integration/file-gateway.test.ts.
//
// Most cases run inside a transaction that is rolled back, as the service role or the table owner, with leases inserted directly as the owner. The race at the
// quota's edge needs two real connections, commits its data, and removes what it can afterwards (a manifest is never deleted).

const {db, connect, committed, inTx, addUser, attempt, rows} = createHarness();

const MiB = 1024 * 1024;
const quota = 2 * 1024 * MiB;
const strip = 'strip-picture-metadata';
const left: string[] = [];

afterAll(async () => {
  if (left.length) {
    await db.query(`update artifacts.staging_leases set state = 'released' where id = any($1) and state in ('receiving', 'complete', 'attached')`, [left]).catch(() => undefined);
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

type Retained = {root: string; digest: string; length: number};
type Lease = {id: string; sha: string; length: number; retained?: Retained};

async function lease(client: Client, owner: Fixture | string, options: {state?: string; expires?: number; kind?: string; length?: number} = {}): Promise<Lease> {
  const state = options.state ?? 'complete';
  const length = options.length ?? 1000;
  const sha = randomBytes(32).toString('hex');
  const id = randomUUID();
  const kind = options.kind ?? 'picture';
  await client.query(
    `insert into artifacts.staging_leases (id, account_id, kid, kind, length, sha256, content_type, received_length, state, created_at, expires_at)
     values ($1, $2, 'test-kid', $3, $4, $5, $6, $7, $8, clock_timestamp() - interval '1 minute', clock_timestamp() + make_interval(secs => $9::float8))`,
    [id, typeof owner === 'string' ? owner : owner.accountId, kind, length, sha, kind === 'picture' ? 'image/png' : 'application/octet-stream', state === 'receiving' ? 0 : length, state, options.expires ?? 20 * 3600],
  );
  return {id, sha, length};
}
async function leases(client: Client, owner: Fixture, count: number, options: Parameters<typeof lease>[2] = {}) {
  const made: Lease[] = [];
  for (let index = 0; index < count; index += 1) made.push(await lease(client, owner, options));
  return made;
}
const ids = (set: Lease[]) => set.map((entry) => entry.id);

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
/** The canonical text (RFC 8785) of an upload's manifest, as the gateway builds it for a transform. */
const bodyOf = (accountId: string, uploadId: string, o: {digest: string; length: number; kind?: string; transform?: string}) =>
  `{"activity":"upload:${o.transform ?? strip}","children":[],"digest":"${o.digest}","id":"${uploadId}","kind":"${o.kind ?? 'picture'}","length":${o.length},"scope":"${accountId}","serialization":1}`;

type Publish = {outcome: string; root: string | null; manifest_id: string | null};
/** Calls the manifest's one writer the way the gateway does: the body and its root, for a transform. */
async function publish(client: Client, accountId: string, entry: Lease, o: {digest?: string; length?: number; transform?: string; epoch?: number; body?: string; root?: string; kind?: string} = {}): Promise<Publish> {
  const digest = o.digest ?? sha256(`retained:${entry.sha}`);
  const length = o.length ?? Math.max(1, entry.length - 7);
  const transform = o.transform ?? strip;
  const body = o.body ?? bodyOf(accountId, entry.id, {digest: transform === 'none' ? entry.sha : digest, length: transform === 'none' ? entry.length : length, kind: o.kind, transform});
  const root = o.root ?? sha256(body);
  const {rows: answered} = await client.query('select * from artifacts.publish_attachment($1, $2, $3, $4, $5, $6)', [accountId, o.epoch ?? 1, entry.id, transform, root, body]);
  if (answered[0].outcome === 'published') entry.retained = {root, digest: transform === 'none' ? entry.sha : digest, length: transform === 'none' ? entry.length : length};
  return answered[0] as Publish;
}
async function retainAll(client: Client, who: Fixture, set: Lease[]) {
  for (const entry of set) expect((await publish(client, who.accountId, entry, {epoch: who.epoch})).outcome).toBe('published');
}

/** A manifest of an upload that never existed, inserted by the owner to set what the Account already keeps (the root is the SHA-256 of any body). */
async function keep(client: Client, accountId: string, bytes: number, kind = 'picture') {
  const body = `kept ${randomUUID()}`;
  const id = randomUUID();
  await client.query(
    `insert into artifacts.manifests (root, id, account_id, upload_id, kind, digest, length, serialization, activity, body) values ($1, $2, $3, $2, $4, $5, $6, 1, 'upload:strip-picture-metadata', $7)`,
    [sha256(body), id, accountId, kind, randomBytes(32).toString('hex'), bytes, body],
  );
}

const asService = async (client: Client, sql: string, params: unknown[]) => (await rows(client, 'service_role', sql, params))[0];
const leaseRow = async (client: Client, id: string) => (await client.query('select id, state, created_at, expires_at from artifacts.staging_leases where id = $1', [id])).rows[0];

/** A Project and its first (unreviewed) picture revision, made by the picture-set writer. */
async function pictureProject(client: Client, who: Fixture, set: Lease[], command = randomUUID()) {
  const made = await asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [who.accountId, who.epoch, command, null, 'Picture request', ids(set)]);
  expect(made.outcome).toBe('created');
  return {projectId: made.project_id as string, requestId: made.request_id as string};
}
const savePictures = (client: Client, who: Fixture, projectId: string, set: Lease[]) =>
  asService(client, 'select * from api.record_picture_set($1, $2, $3, $4, $5, $6)', [who.accountId, who.epoch, randomUUID(), projectId, null, ids(set)]);

const imagesJson = (set: Lease[], labels: string[] = ['front', 'left', 'top']) =>
  set.map((entry, index) => ({upload_id: entry.id, label: labels[index % labels.length], short_edge_px: 1200, blur_variance: 412.375, clipped_fraction: 0.0213}));
const reviewSql = 'select * from api.record_picture_review($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)';
async function review(client: Client, who: Fixture, projectId: string, seq: number, set: Lease[], mode = 'evidence_images') {
  const direct = mode === 'image_direct';
  return asService(client, reviewSql, [who.accountId, who.epoch, randomUUID(), projectId, seq, mode, direct ? 'Scope' : null, direct ? 'Outcome' : null, JSON.stringify(imagesJson(set)), true, false]);
}

const check = (client: Client, who: Fixture, projectId: string, seq: number, uploadIds: string[], role: string | null = 'service_role') =>
  attempt(client, role, 'select * from api.check_picture_retention($1, $2, $3, $4, $5)', [who.accountId, who.epoch, projectId, seq, uploadIds]);
async function checked(client: Client, who: Fixture, projectId: string, seq: number, uploadIds: string[]) {
  const result = await check(client, who, projectId, seq, uploadIds);
  if (!result.ok) throw new Error(`api.check_picture_retention failed: ${result.message}`);
  return result.rows[0] as {outcome: string; seq: number | null; position: number | null; kept: string | null; asked: string | null; pictures: {position: number; upload_id: string; action: string; root: string | null}[] | null};
}
const pins = async (client: Client, revisionId: string) =>
  (await client.query('select position, upload_id, sha256, retained_root, retained_sha256, retained_length from projects.request_images where revision_id = $1 order by position', [revisionId])).rows;

async function counts(client: Client, who: Fixture, uploadIds: string[]) {
  return {
    manifests: (await client.query('select count(*)::int as n from artifacts.manifests where account_id = $1', [who.accountId])).rows[0].n,
    revisions: (await client.query('select count(*)::int as n from projects.request_revisions where account_id = $1', [who.accountId])).rows[0].n,
    images: (await client.query('select count(*)::int as n from projects.request_images where account_id = $1', [who.accountId])).rows[0].n,
    projects: (await client.query('select id, stage, revision::int as revision, updated_at from projects.projects where account_id = $1 order by id', [who.accountId])).rows,
    leases: (await client.query('select id, state, expires_at from artifacts.staging_leases where id = any($1) order by id', [uploadIds])).rows,
  };
}

// ---------------------------------------------------------------------------------------------------
describe('artifacts.publish_attachment with the transform strip-picture-metadata', () => {
  it('registers the transform beside none, and publishes the STRIPPED copy: the manifest holds the retained digest and length from the body, and the lease is attached', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const entry = await lease(client, a, {length: 5000});
      expect((await client.query('select name from artifacts.attachment_transforms order by 1')).rows).toEqual([{name: 'none'}, {name: strip}]);
      const digest = sha256('the stripped bytes');
      const answered = await publish(client, a.accountId, entry, {digest, length: 4123});
      expect(answered).toMatchObject({outcome: 'published', manifest_id: entry.id});
      const {rows: manifest} = await client.query('select root, id, account_id, upload_id, kind, digest, length::int as length, serialization, activity, body from artifacts.manifests where upload_id = $1', [entry.id]);
      expect(manifest).toEqual([
        {
          root: answered.root,
          id: entry.id,
          account_id: a.accountId,
          upload_id: entry.id,
          kind: 'picture',
          digest,
          length: 4123,
          serialization: 1,
          activity: `upload:${strip}`,
          body: `{"activity":"upload:${strip}","children":[],"digest":"${digest}","id":"${entry.id}","kind":"picture","length":4123,"scope":"${a.accountId}","serialization":1}`,
        },
      ]);
      expect(manifest[0].digest).not.toBe(entry.sha);
      expect((await leaseRow(client, entry.id)).state).toBe('attached');
      // The root is the SHA-256 of the canonical body, as for every manifest.
      expect(answered.root).toBe(sha256(manifest[0].body));
    });
  });

  it('answers a repeat with the same manifest (exists), and root_mismatch for another stripped copy of the same upload; nothing is written twice', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const entry = await lease(client, a);
      const first = await publish(client, a.accountId, entry);
      expect(first.outcome).toBe('published');
      expect(await publish(client, a.accountId, entry)).toMatchObject({outcome: 'exists', root: first.root, manifest_id: entry.id});
      expect(await publish(client, a.accountId, entry, {digest: sha256('another copy')})).toMatchObject({outcome: 'root_mismatch', root: first.root});
      expect((await client.query('select count(*)::int as n from artifacts.manifests where upload_id = $1', [entry.id])).rows[0].n).toBe(1);
    });
  });

  it('holds the retained length to 1 byte at least and the lease\'s length plus 4,096 at most, and the digest to 64 lower-case hexadecimal characters', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const [name, options, outcome] of [
        ['a length of 0', {length: 0}, 'body_mismatch'],
        ['a length above the lease plus 4,096', {length: 1000 + 4097}, 'body_mismatch'],
        ['a digest of 63 characters', {digest: 'a'.repeat(63)}, 'body_mismatch'],
        ['a digest in upper case', {digest: 'A'.repeat(64)}, 'body_mismatch'],
        ['a digest that is not hexadecimal', {digest: 'g'.repeat(64)}, 'body_mismatch'],
        ['a length at the lease plus 4,096', {length: 1000 + 4096}, 'published'],
      ] as const) {
        const entry = await lease(client, a);
        expect((await publish(client, a.accountId, entry, options)).outcome, name).toBe(outcome);
        expect((await client.query('select count(*)::int as n from artifacts.manifests where upload_id = $1', [entry.id])).rows[0].n, name).toBe(outcome === 'published' ? 1 : 0);
        expect((await leaseRow(client, entry.id)).state, name).toBe(outcome === 'published' ? 'attached' : 'complete');
      }
      const one = await lease(client, a);
      expect((await publish(client, a.accountId, one, {length: 1})).outcome).toBe('published');
    });
  });

  it('refuses a body that is not exactly the canonical text, whatever else is right: whitespace, another order, a repeated member, an escape, another upload, another Account', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const digest = sha256('x');
      const good = (entry: Lease) => bodyOf(a.accountId, entry.id, {digest, length: 900});
      const variants: [string, (entry: Lease) => string][] = [
        ['whitespace', (entry) => good(entry).replace('{"activity"', '{ "activity"')],
        ['another order of members', (entry) => `{"digest":"${digest}","activity":"upload:${strip}","children":[],"id":"${entry.id}","kind":"picture","length":900,"scope":"${a.accountId}","serialization":1}`],
        ['a repeated member', (entry) => good(entry).replace('"serialization":1}', '"serialization":1,"length":900}')],
        ['an escaped character', (entry) => good(entry).replace('picture', 'pic\\u0074ure')],
        ['another upload\'s ID', (entry) => good(entry).replace(entry.id, randomUUID())],
        ['another Account\'s scope', (entry) => good(entry).replace(a.accountId, randomUUID())],
        ['another activity', (entry) => good(entry).replace(`upload:${strip}`, 'upload:none')],
        ['children that are not empty', (entry) => good(entry).replace('"children":[]', '"children":["x"]')],
        ['a leading zero in the length', (entry) => good(entry).replace('"length":900', '"length":0900')],
        ['an exponent in the length', (entry) => good(entry).replace('"length":900', '"length":9e2')],
      ];
      for (const [name, change] of variants) {
        const entry = await lease(client, a);
        const body = change(entry);
        const outcome = (await publish(client, a.accountId, entry, {body, root: sha256(body)})).outcome;
        expect(['body_mismatch', 'root_mismatch'], name).toContain(outcome);
        expect((await client.query('select count(*)::int as n from artifacts.manifests where upload_id = $1', [entry.id])).rows[0].n, name).toBe(0);
      }
      // A root that is not the SHA-256 of the body is refused as before.
      const entry = await lease(client, a);
      expect((await publish(client, a.accountId, entry, {body: good(entry), root: sha256('else')})).outcome).toBe('root_mismatch');
    });
  });

  it('is for pictures: a file lease answers transform_unknown, and the transform none still describes the lease itself, exactly as before', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const file = await lease(client, a, {kind: 'file', length: 3000});
      expect((await publish(client, a.accountId, file, {kind: 'file'})).outcome).toBe('transform_unknown');
      expect((await leaseRow(client, file.id)).state).toBe('complete');
      const picture = await lease(client, a, {length: 3000});
      const none = await publish(client, a.accountId, picture, {transform: 'none'});
      expect(none.outcome).toBe('published');
      const {rows: manifest} = await client.query('select digest, length::int as length, activity from artifacts.manifests where upload_id = $1', [picture.id]);
      expect(manifest).toEqual([{digest: picture.sha, length: 3000, activity: 'upload:none'}]);
      // The six-argument function is the one the previous gateway calls: it is still there with the same grants.
      expect((await client.query(`select has_function_privilege('nova3d_gateway', 'artifacts.publish_attachment(uuid,bigint,uuid,text,text,text)', 'execute') as can`)).rows[0].can).toBe(true);
    });
  });

  it('keeps the rules it always had: authority first (denied), the lease the Account\'s own (not_found), complete (not_complete) and unexpired (expired)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const entry = await lease(client, a);
      expect((await publish(client, a.accountId, entry, {epoch: 9})).outcome).toBe('denied');
      expect((await publish(client, b.accountId, entry)).outcome).toBe('not_found');
      const released = await lease(client, a, {state: 'released'});
      expect((await publish(client, a.accountId, released)).outcome).toBe('not_complete');
      const lapsed = await lease(client, a, {expires: -5});
      expect((await publish(client, a.accountId, lapsed)).outcome).toBe('expired');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect((await publish(client, a.accountId, entry)).outcome).toBe('denied');
      expect((await client.query('select count(*)::int as n from artifacts.manifests where account_id = $1', [a.accountId])).rows[0].n).toBe(0);
    });
  });

  describe('the retained quota of 2 GiB (2,147,483,648 bytes) per Account', () => {
    it('admits a picture that brings the Account exactly to the limit, and refuses one byte more: quota_exceeded, nothing written, the lease still complete', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        const entry = await lease(client, a, {length: 12 * MiB});
        await keep(client, a.accountId, quota - 12 * MiB + 1);
        expect((await publish(client, a.accountId, entry, {length: 12 * MiB})).outcome).toBe('quota_exceeded');
        expect((await client.query('select count(*)::int as n from artifacts.manifests where upload_id = $1', [entry.id])).rows[0].n).toBe(0);
        expect((await leaseRow(client, entry.id)).state).toBe('complete');
        // One byte less is exactly at the limit: it passes.
        const edge = await lease(client, a, {length: 12 * MiB});
        expect((await publish(client, a.accountId, edge, {length: 12 * MiB - 1})).outcome).toBe('published');
        // ... and the next byte of anything does not.
        const more = await lease(client, a, {length: 100});
        expect((await publish(client, a.accountId, more, {length: 1})).outcome).toBe('quota_exceeded');
      });
    });

    it('counts the manifests of kind picture of THIS Account only: a file\'s, another Account\'s and a republished one change nothing', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        const b = await account(client);
        await keep(client, a.accountId, quota, 'file');
        await keep(client, b.accountId, quota);
        const entry = await lease(client, a, {length: 12 * MiB});
        expect((await publish(client, a.accountId, entry, {length: 12 * MiB})).outcome).toBe('published');
        expect((await publish(client, a.accountId, entry, {length: 12 * MiB})).outcome).toBe('exists');
      });
    });

    it('is not asked of the transform none, which the previous gateway uses and which never knew the quota', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        await keep(client, a.accountId, quota);
        const entry = await lease(client, a, {length: 1000});
        expect((await publish(client, a.accountId, entry, {transform: 'none'})).outcome).toBe('published');
      });
    });

    it('takes the advisory lock nova3d:retained:<account>, so two confirmations at the edge are serial: one is admitted and the other is refused', async () => {
      const a = await account(db);
      committed.users.push(a.user.id);
      const first = await lease(db, a, {length: 12 * MiB});
      const second = await lease(db, a, {length: 12 * MiB});
      left.push(first.id, second.id);
      await keep(db, a.accountId, quota - 12 * MiB - 100);
      const one = await connect();
      const two = await connect();
      const send = (client: Client, entry: Lease) => publish(client, a.accountId, entry, {length: 12 * MiB});
      await one.query('begin');
      await two.query('begin');
      try {
        const winner = await send(one, first);
        expect(winner.outcome).toBe('published');
        // The second waits behind the first's lock (the transaction of the first is still open), and so it sees the first's manifest once that commits.
        let settled = false;
        const waiting = send(two, second).then((answer) => {
          settled = true;
          return answer;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(settled).toBe(false);
        await one.query('commit');
        const loser = await waiting;
        expect(loser.outcome).toBe('quota_exceeded');
      } finally {
        // (Whatever happened, no transaction is left open: it would hold the rows of the cases that follow.)
        await one.query('rollback').catch(() => undefined);
        await two.query('rollback').catch(() => undefined);
      }
      expect((await db.query('select count(*)::int as n from artifacts.manifests where account_id = $1 and kind = $2', [a.accountId, 'picture'])).rows[0].n).toBe(2);
      // The refused one's lease is still complete and it left nothing: a retry (after room is made) is possible.
      expect((await leaseRow(db, second.id)).state).toBe('complete');
    });

    it('lets a lock held on ANOTHER Account\'s key go by: the lock is per Account', async () => {
      const a = await account(db);
      const b = await account(db);
      committed.users.push(a.user.id, b.user.id);
      const mine = await lease(db, a, {length: 1000});
      left.push(mine.id);
      const holder = await connect();
      await holder.query('begin');
      await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d:retained:' || $1::text, 0))`, [b.accountId]);
      try {
        const answered = await Promise.race([publish(db, a.accountId, mine), new Promise<string>((resolve) => setTimeout(() => resolve('blocked'), 3000))]);
        expect(typeof answered === 'string' ? answered : answered.outcome).toBe('published');
      } finally {
        await holder.query('rollback');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.check_picture_retention: the read-only pre-check', () => {
  it('answers, per position, attach (no manifest yet) or retained (a manifest of that upload exists, with its root), in order, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 4);
      const { projectId } = await pictureProject(client, a, set);
      // Positions 2 and 4 are retained already (a repeat of the confirmation, or a retry after a partial failure).
      await publish(client, a.accountId, set[1]);
      await publish(client, a.accountId, set[3]);
      const before = await counts(client, a, ids(set));
      const answer = await checked(client, a, projectId, 1, ids(set));
      expect(answer).toMatchObject({outcome: 'checked', seq: null, position: null, kept: null, asked: null});
      expect(answer.pictures).toEqual([
        {position: 1, upload_id: set[0].id, action: 'attach', root: null},
        {position: 2, upload_id: set[1].id, action: 'retained', root: set[1].retained!.root},
        {position: 3, upload_id: set[2].id, action: 'attach', root: null},
        {position: 4, upload_id: set[3].id, action: 'retained', root: set[3].retained!.root},
      ]);
      expect(await counts(client, a, ids(set))).toEqual(before);
      // Asked twice it says the same: nothing was taken or changed.
      expect(await checked(client, a, projectId, 1, ids(set))).toEqual(answer);
    });
  });

  it('answers retained for every picture the second time, with the same roots: a confirmation submitted twice creates no duplicate artifact', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const first = await checked(client, a, projectId, 1, ids(set));
      expect(first.pictures!.map((picture) => picture.action)).toEqual(['attach', 'attach', 'attach']);
      for (const entry of set) expect((await publish(client, a.accountId, entry)).outcome).toBe('published');
      const second = await checked(client, a, projectId, 1, ids(set));
      expect(second.pictures!.map((picture) => [picture.action, picture.root])).toEqual(set.map((entry) => ['retained', entry.retained!.root]));
      // Attaching again (the gateway's recomputation) is `exists`, with the same roots, and no second manifest.
      for (const entry of set) expect(await publish(client, a.accountId, entry)).toMatchObject({outcome: 'exists', root: entry.retained!.root});
      expect((await client.query('select count(*)::int as n from artifacts.manifests where account_id = $1', [a.accountId])).rows[0].n).toBe(3);
    });
  });

  it('treats an upload with a manifest as retained whatever has become of its staged copy: attached, released, deleted or lapsed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 4);
      const { projectId } = await pictureProject(client, a, set);
      for (const entry of set) await publish(client, a.accountId, entry);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 hour' where id = $1`, [set[1].id]);
      await client.query(`update artifacts.staging_leases set state = 'released' where id = any($1)`, [[set[2].id, set[3].id]]);
      await client.query(`update artifacts.staging_leases set state = 'deleted' where id = $1`, [set[3].id]);
      expect((await checked(client, a, projectId, 1, ids(set))).pictures!.map((picture) => picture.action)).toEqual(['retained', 'retained', 'retained', 'retained']);
    });
  });

  it('answers unknown_upload (another Account\'s, an unknown ID, a file), not_ready (not complete or attached) and expired_upload (without a manifest), each with its position, the first problem by position winning', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const foreign = await lease(client, b);
      const file = await lease(client, a, {kind: 'file'});
      const swap = async (position: number, uploadId: string) => {
        await client.query(`alter table projects.request_images disable trigger request_images_no_update`);
        await client.query(`update projects.request_images set upload_id = $1 where project_id = $2 and position = $3 and revision_id = (select id from projects.request_revisions where project_id = $2 order by seq desc limit 1)`, [uploadId, projectId, position]);
        await client.query(`alter table projects.request_images enable trigger request_images_no_update`);
      };
      const order = (...positions: Lease[]) => ids(positions);
      // (A revision that names an upload that is not the Account's own picture is made by the owner here, as no writer would.)
      await swap(2, foreign.id);
      expect(await checked(client, a, projectId, 1, order(set[0], foreign, set[2]))).toMatchObject({outcome: 'unknown_upload', position: 2, pictures: null});
      await swap(2, file.id);
      expect(await checked(client, a, projectId, 1, order(set[0], file, set[2]))).toMatchObject({outcome: 'unknown_upload', position: 2});
      const unknown = randomUUID();
      await swap(2, unknown);
      expect(await checked(client, a, projectId, 1, [set[0].id, unknown, set[2].id])).toMatchObject({outcome: 'unknown_upload', position: 2});
      await swap(2, set[1].id);
      // A lease that is neither complete nor attached is not ready; one that lapsed, with no manifest, has expired.
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[2].id]);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [set[1].id]);
      expect(await checked(client, a, projectId, 1, ids(set))).toMatchObject({outcome: 'expired_upload', position: 2});
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[0].id]);
      expect(await checked(client, a, projectId, 1, ids(set))).toMatchObject({outcome: 'not_ready', position: 1});
      // With a manifest the same lapsed copy is retained, and the first problem is the next one.
      await publish(client, a.accountId, set[1]).catch(() => undefined);
      expect((await checked(client, a, projectId, 1, ids(set))).position).toBe(1);
    });
  });

  it('answers stale (carrying the latest seq) unless the latest revision is the expected one and holds exactly these uploads in this order', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      expect(await checked(client, a, projectId, 2, ids(set))).toMatchObject({outcome: 'stale', seq: 1, pictures: null});
      expect(await checked(client, a, projectId, 1, [set[1].id, set[0].id, set[2].id])).toMatchObject({outcome: 'stale', seq: 1});
      expect(await checked(client, a, projectId, 1, [set[0].id, set[1].id])).toMatchObject({outcome: 'stale', seq: 1});
      expect(await checked(client, a, projectId, 1, [...ids(set), randomUUID()])).toMatchObject({outcome: 'stale', seq: 1});
      // A newer revision (the review recorded in another window) makes the old one stale, even for the same uploads.
      expect((await review(client, a, projectId, 1, set)).outcome).toBe('created');
      expect(await checked(client, a, projectId, 1, ids(set))).toMatchObject({outcome: 'stale', seq: 2});
      expect(await checked(client, a, projectId, 2, ids(set))).toMatchObject({outcome: 'checked'});
      // A Project with no request revision at all has nothing to retain.
      const {rows: bare} = await client.query(`insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'No request', 'request_draft') returning id`, [a.workspaceId, a.accountId]);
      expect(await checked(client, a, bare[0].id, 1, ids(set))).toMatchObject({outcome: 'stale', seq: null});
    });
  });

  it('answers not_editable for a text request and for a Project past the request stages', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const text = await asService(client, 'select * from api.create_project_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)', [
        a.accountId, a.epoch, randomUUID(), 'The altar', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', 'Build the altar', null, null, null, false, null,
      ]);
      expect(await checked(client, a, text.project_id, 1, ids(set))).toMatchObject({outcome: 'not_editable'});
      const { projectId } = await pictureProject(client, a, set);
      for (const stage of ['researching', 'awaiting_plan_approval', 'generating', 'awaiting_model_approval', 'validation_failed', 'export_ready']) {
        await client.query('update projects.projects set stage = $2, revision = revision + 1 where id = $1', [projectId, stage]);
        expect(await checked(client, a, projectId, 1, ids(set)), stage).toMatchObject({outcome: 'not_editable'});
      }
      for (const stage of ['request_draft', 'request_confirmed']) {
        await client.query('update projects.projects set stage = $2, revision = revision + 1 where id = $1', [projectId, stage]);
        expect((await checked(client, a, projectId, 1, ids(set))).outcome, stage).toBe('checked');
      }
    });
  });

  it('answers ONE unavailable for another Account\'s Project, a deleted one, a tombstoned one and one that never existed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const set = await leases(client, a, 1);
      const mine = await pictureProject(client, a, set);
      const theirSet = await leases(client, b, 1);
      const theirs = await pictureProject(client, b, theirSet);
      const deleted = await pictureProject(client, a, await leases(client, a, 1));
      await client.query('update projects.projects set deleted_at = clock_timestamp(), revision = revision + 1 where id = $1', [deleted.projectId]);
      const hidden = await pictureProject(client, a, await leases(client, a, 1));
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', hidden.projectId])).outcome).toBe('recorded');
      const answers = [theirs.projectId, deleted.projectId, hidden.projectId, randomUUID()].map((project) => checked(client, a, project, 1, ids(set)));
      for (const answer of await Promise.all(answers)) expect(answer).toEqual({outcome: 'unavailable', seq: null, position: null, kept: null, asked: null, pictures: null});
      expect((await checked(client, a, mine.projectId, 1, ids(set))).outcome).toBe('checked');
    });
  });

  it('answers denied, before anything else is read, to a disabled Account, a stale epoch, an Account that does not exist and a tombstoned Account', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId } = await pictureProject(client, a, set);
      const denied = {outcome: 'denied', seq: null, position: null, kept: null, asked: null, pictures: null};
      expect(await checked(client, {...a, epoch: 99}, projectId, 1, ids(set))).toEqual(denied);
      expect(await checked(client, {...a, accountId: randomUUID()}, projectId, 1, ids(set))).toEqual(denied);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect(await checked(client, a, projectId, 1, ids(set))).toEqual(denied);
      const b = await account(client);
      const bSet = await leases(client, b, 1);
      const bProject = await pictureProject(client, b, bSet);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['account', b.accountId])).outcome).toBe('recorded');
      expect(await checked(client, b, bProject.projectId, 1, ids(bSet))).toEqual(denied);
    });
  });

  describe('the quota', () => {
    it('adds the Account\'s kept pictures and the staged lengths of the uploads with no manifest, and refuses the WHOLE confirmation over 2 GiB with the bytes kept and the bytes asked', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        const set = await leases(client, a, 3, {length: 12 * MiB});
        const { projectId } = await pictureProject(client, a, set);
        // Kept 2 GiB - 10 MiB; asking 36 MiB (and one of the three is already retained, which is not asked again).
        await publish(client, a.accountId, set[0], {length: 12 * MiB});
        await keep(client, a.accountId, quota - 10 * MiB - 12 * MiB);
        const answer = await checked(client, a, projectId, 1, ids(set));
        expect(answer).toMatchObject({outcome: 'quota_exceeded', kept: String(quota - 10 * MiB), asked: String(24 * MiB), position: null, pictures: null});
        expect(await counts(client, a, ids(set))).toMatchObject({manifests: 2});
      });
    });

    it('passes exactly at the limit and fails one byte beyond it', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        const set = await leases(client, a, 1, {length: 12 * MiB});
        const { projectId } = await pictureProject(client, a, set);
        await keep(client, a.accountId, quota - 12 * MiB);
        expect((await checked(client, a, projectId, 1, ids(set))).outcome).toBe('checked');
        await keep(client, a.accountId, 1);
        expect(await checked(client, a, projectId, 1, ids(set))).toMatchObject({outcome: 'quota_exceeded', kept: String(quota - 12 * MiB + 1), asked: String(12 * MiB)});
      });
    });

    it('counts manifests of kind picture of this Account only', async () => {
      await inTx(async (client) => {
        const a = await account(client);
        const b = await account(client);
        const set = await leases(client, a, 1, {length: 12 * MiB});
        const { projectId } = await pictureProject(client, a, set);
        await keep(client, a.accountId, quota, 'file');
        await keep(client, b.accountId, quota);
        expect((await checked(client, a, projectId, 1, ids(set))).outcome).toBe('checked');
      });
    });
  });

  it('checks its arguments (22023): one to twelve uploads, none repeated, none null, a positive expected seq', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, set);
      const same = randomUUID();
      for (const [name, args] of [
        ['no uploads', [a.accountId, 1, projectId, 1, []]],
        ['thirteen uploads', [a.accountId, 1, projectId, 1, Array.from({length: 13}, () => randomUUID())]],
        ['a repeated upload', [a.accountId, 1, projectId, 1, [same, same]]],
        ['a null upload', [a.accountId, 1, projectId, 1, [same, null]]],
        ['no expected seq', [a.accountId, 1, projectId, null, [same]]],
        ['an expected seq of 0', [a.accountId, 1, projectId, 0, [same]]],
        ['no Project', [a.accountId, 1, null, 1, [same]]],
        ['no Account', [null, 1, projectId, 1, [same]]],
        ['no epoch', [a.accountId, null, projectId, 1, [same]]],
      ] as const) {
        const result = await attempt(client, 'service_role', 'select * from api.check_picture_retention($1, $2, $3, $4, $5::uuid[])', args as unknown as unknown[]);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('22023');
      }
    });
  });

  it('is executable by the service role alone: anon and authenticated may not call it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId } = await pictureProject(client, a, set);
      for (const role of ['anon', 'authenticated']) {
        const result = await check(client, a, projectId, 1, ids(set), role);
        expect(result.ok, role).toBe(false);
        if (!result.ok) expect(result.code, role).toBe('42501');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the pins: what the review writer and the picture-set writer record', () => {
  it('pins the ordered roots beside the staged digests they replace, taken from the Account\'s manifests, and answers the same roots for the same command', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      const command = randomUUID();
      const send = () => asService(client, reviewSql, [a.accountId, a.epoch, command, projectId, 1, 'evidence_images', null, null, JSON.stringify(imagesJson(set)), true, false]);
      const done = await send();
      expect(done).toMatchObject({outcome: 'created', seq: 2});
      const expected = set.map((entry, index) => ({position: index + 1, upload_id: entry.id, sha256: entry.sha, retained_root: entry.retained!.root, retained_sha256: entry.retained!.digest, retained_length: entry.retained!.length}));
      expect(await pins(client, done.request_id)).toEqual(expected);
      // Every retained digest maps to the staged digest the person confirmed, in order, and is not it.
      for (const pin of await pins(client, done.request_id)) expect(pin.retained_sha256).not.toBe(pin.sha256);
      // The same command again is the same receipt and the same roots.
      expect(await send()).toMatchObject({outcome: 'replayed', request_id: done.request_id, seq: 2});
      expect(await pins(client, done.request_id)).toEqual(expected);
    });
  });

  it('takes the pins from the manifests and from nothing the browser sends: a review names no root, digest or length', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      const sent = JSON.stringify([{...imagesJson(set)[0], retained_root: 'f'.repeat(64), retained_sha256: 'e'.repeat(64), retained_length: 1}]);
      const result = await attempt(client, 'service_role', reviewSql, [a.accountId, a.epoch, randomUUID(), projectId, 1, 'evidence_images', null, null, sent, true, false]);
      // The images argument has exactly five members: anything else is refused (22023) and nothing is written.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      const {rows: functionArguments} = await client.query(`select pg_get_function_arguments('api.record_picture_review(uuid,bigint,uuid,uuid,integer,text,text,text,jsonb,boolean,boolean)'::regprocedure) as args`);
      expect(functionArguments[0].args).not.toMatch(/root|retain|digest|length|sha/i);
    });
  });

  it('carries the pins of the retained pictures into the unreviewed successor of the picture-set writer, and stages the new picture with none: a picture change keeps the pins of the others', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      const reviewed = await review(client, a, projectId, 1, set);
      expect(reviewed.outcome).toBe('created');
      // The person replaces the third picture on the picture screen: the first two are kept (their staged copies are expiring or gone), the new one is staged.
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[0].id]);
      await client.query(`update artifacts.staging_leases set state = 'deleted' where id = $1`, [set[0].id]);
      const fresh = await lease(client, a);
      const next = [set[0], set[1], fresh];
      const saved = await savePictures(client, a, projectId, next);
      expect(saved).toMatchObject({outcome: 'revised', seq: 3, released: 0});
      expect(await pins(client, saved.request_id)).toEqual([
        {position: 1, upload_id: set[0].id, sha256: set[0].sha, retained_root: set[0].retained!.root, retained_sha256: set[0].retained!.digest, retained_length: set[0].retained!.length},
        {position: 2, upload_id: set[1].id, sha256: set[1].sha, retained_root: set[1].retained!.root, retained_sha256: set[1].retained!.digest, retained_length: set[1].retained!.length},
        {position: 3, upload_id: fresh.id, sha256: fresh.sha, retained_root: null, retained_sha256: null, retained_length: null},
      ]);
      // The successor is unreviewed (no labels), and the dropped, retained picture's lease is not released (it is already expiring).
      const {rows: labelled} = await client.query('select view_label from projects.request_images where revision_id = $1 order by position', [saved.request_id]);
      expect(labelled.map((row) => row.view_label)).toEqual([null, null, null]);
      expect((await leaseRow(client, set[2].id)).state).toBe('attached');
      // The new picture's lease is renewed as before; the retained pictures' are not given a new life.
      expect((await leaseRow(client, fresh.id)).expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
      expect((await leaseRow(client, set[1].id)).expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      // The same set again is unchanged, and reviewing it needs the new picture retained: the pre-check names it as the only one to attach.
      expect(await savePictures(client, a, projectId, next)).toMatchObject({outcome: 'unchanged'});
      const again = await checked(client, a, projectId, 3, ids(next));
      expect(again.pictures!.map((picture) => picture.action)).toEqual(['retained', 'retained', 'attach']);
    });
  });

  it('accepts a retained picture whose staged copy is attached, expired or deleted in a picture set, and still refuses an unretained one that is not complete or has lapsed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const kept = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, kept);
      await retainAll(client, a, kept);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 minute' where id = $1`, [kept[1].id]);
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [kept[2].id]);
      await client.query(`update artifacts.staging_leases set state = 'deleted' where id = $1`, [kept[2].id]);
      expect(await savePictures(client, a, projectId, [kept[2], kept[1], kept[0]])).toMatchObject({outcome: 'revised'});
      const lapsed = await lease(client, a, {expires: -5});
      expect(await savePictures(client, a, projectId, [kept[0], lapsed])).toMatchObject({outcome: 'expired_upload', position: 2});
      const released = await lease(client, a, {state: 'released'});
      expect(await savePictures(client, a, projectId, [kept[0], released])).toMatchObject({outcome: 'not_ready', position: 2});
      // A manifest of ANOTHER Account's upload makes it no retained picture of this one.
      const b = await account(client);
      const theirs = await lease(client, b);
      await publish(client, b.accountId, theirs);
      expect(await savePictures(client, a, projectId, [kept[0], theirs])).toMatchObject({outcome: 'unknown_upload', position: 2});
    });
  });

  it('still refuses the same bytes under two uploads as duplicates when one is retained: the staged digest, not the retained one, is compared', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const one = await lease(client, a);
      const two = await lease(client, a);
      await client.query(`alter table artifacts.staging_leases disable trigger staging_leases_guard`);
      await client.query(`update artifacts.staging_leases set sha256 = $2 where id = $1`, [two.id, one.sha]);
      await client.query(`alter table artifacts.staging_leases enable trigger staging_leases_guard`);
      const { projectId } = await pictureProject(client, a, [await lease(client, a)]);
      await publish(client, a.accountId, one);
      expect(await savePictures(client, a, projectId, [one, {...two, sha: one.sha}])).toMatchObject({outcome: 'duplicate_image', position: 2});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.read_project_request after retention', () => {
  it('reports available for a picture that is pinned, whatever has become of its staged copy, and for an attached, unexpired one; not for an unpinned, lapsed one', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      const read = async () => (await asService(client, 'select * from api.read_project_request($1, $2, $3)', [a.accountId, a.epoch, projectId])).images as {position: number; available: boolean; upload_id: string}[];
      expect((await read()).map((image) => image.available)).toEqual([true, true, true]);
      // Attached with no pin (a failed confirmation): the staged copy can be read (the staging resolver serves it), so it is available until it lapses.
      await publish(client, a.accountId, set[0]);
      expect((await read()).map((image) => image.available)).toEqual([true, true, true]);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [set[0].id]);
      expect((await read()).map((image) => image.available)).toEqual([false, true, true]);
      // Pinned, the picture is available whatever its staged copy: it is served from its retained root.
      await retainAll(client, a, set.slice(1));
      await publish(client, a.accountId, set[0]).catch(() => undefined);
      const done = await review(client, a, projectId, 1, set);
      expect(done.outcome).toBe('created');
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [set[1].id]);
      await client.query(`update artifacts.staging_leases set state = 'deleted' where id = $1`, [set[1].id]);
      expect((await read()).map((image) => image.available)).toEqual([true, true, true]);
    });
  });

  it('keeps the shape it had: the image keys and the view\'s columns are the Story 2.3 ones, and no root, digest or key of Storage is in the answer', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      expect((await review(client, a, projectId, 1, set)).outcome).toBe('created');
      const row = await asService(client, 'select * from api.read_project_request($1, $2, $3)', [a.accountId, a.epoch, projectId]);
      expect(Object.keys(row)).toEqual([
        'outcome', 'request_id', 'project_id', 'seq', 'mode', 'subject_id', 'scope', 'intended_outcome', 'description', 'personalization_wording', 'personalization_text',
        'personalization_style', 'personalization_applied', 'personalization_reason', 'confirmed_at', 'confirmed', 'images', 'obstruction_confirmed', 'obstruction_confirmed_at', 'acknowledged', 'acknowledged_at',
      ]);
      for (const image of row.images) {
        expect(Object.keys(image).sort()).toEqual(['available', 'blur_variance', 'clipped_fraction', 'content_type', 'expires_at', 'label', 'length', 'position', 'sha256', 'short_edge_px', 'upload_id'].sort());
      }
      const text = JSON.stringify(row);
      for (const entry of set) {
        expect(text).not.toContain(entry.retained!.root);
        expect(text).not.toContain(entry.retained!.digest);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.read_retained_pictures', () => {
  const read = (client: Client, who: Fixture, projectId: string, role: string | null = 'service_role') =>
    attempt(client, role, 'select * from api.read_retained_pictures($1, $2, $3)', [who.accountId, who.epoch, projectId]);
  async function found(client: Client, who: Fixture, projectId: string) {
    const result = await read(client, who, projectId);
    if (!result.ok) throw new Error(result.message);
    return result.rows[0] as {outcome: string; pictures: Record<string, unknown>[]};
  }

  it('answers the latest revision\'s pinned pictures in the confirmed order, each with exactly {position, upload_id, root, retained_sha256, retained_length, staged_sha256, label, content_type} and nothing else', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 3);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      expect((await review(client, a, projectId, 1, set)).outcome).toBe('created');
      const answer = await found(client, a, projectId);
      expect(Object.keys(answer)).toEqual(['outcome', 'pictures']);
      expect(answer.outcome).toBe('found');
      expect(answer.pictures).toEqual(
        set.map((entry, index) => ({
          position: index + 1,
          upload_id: entry.id,
          root: entry.retained!.root,
          retained_sha256: entry.retained!.digest,
          retained_length: entry.retained!.length,
          staged_sha256: entry.sha,
          label: ['front', 'left', 'top'][index],
          content_type: 'image/png',
        })),
      );
      for (const picture of answer.pictures) expect(Object.keys(picture).sort()).toEqual(['content_type', 'label', 'position', 'retained_length', 'retained_sha256', 'root', 'staged_sha256', 'upload_id']);
    });
  });

  it('answers none when nothing is pinned (a saved set, a Project with no revision), and only the pinned pictures of a revision that pins some', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, set);
      expect(await found(client, a, projectId)).toEqual({outcome: 'none', pictures: []});
      const {rows: bare} = await client.query(`insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'No request', 'request_draft') returning id`, [a.workspaceId, a.accountId]);
      expect(await found(client, a, bare[0].id)).toEqual({outcome: 'none', pictures: []});
      // One picture retained and one still staged, as after a picture change: only the pinned one is answered, at its position.
      await retainAll(client, a, [set[0]]);
      const fresh = await lease(client, a);
      const saved = await savePictures(client, a, projectId, [set[0], fresh]);
      expect(saved.outcome).toBe('revised');
      const answer = await found(client, a, projectId);
      expect(answer.outcome).toBe('found');
      expect(answer.pictures.map((picture) => [picture.position, picture.upload_id])).toEqual([[1, set[0].id]]);
    });
  });

  it('answers only the LATEST revision\'s pictures: an earlier pin that the latest does not carry is not answered', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const first = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, first);
      await retainAll(client, a, first);
      expect((await review(client, a, projectId, 1, first)).outcome).toBe('created');
      const other = await leases(client, a, 1);
      expect((await savePictures(client, a, projectId, other)).outcome).toBe('revised');
      expect(await found(client, a, projectId)).toEqual({outcome: 'none', pictures: []});
    });
  });

  it('answers ONE unavailable for another Account\'s, a deleted, a tombstoned and an unknown Project, and denied to an Account without authority', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const theirSet = await leases(client, b, 1);
      const theirs = await pictureProject(client, b, theirSet);
      await retainAll(client, b, theirSet);
      const mine = await pictureProject(client, a, await leases(client, a, 1));
      const deleted = await pictureProject(client, a, await leases(client, a, 1));
      await client.query('update projects.projects set deleted_at = clock_timestamp(), revision = revision + 1 where id = $1', [deleted.projectId]);
      const hidden = await pictureProject(client, a, await leases(client, a, 1));
      await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', hidden.projectId]);
      for (const project of [theirs.projectId, deleted.projectId, hidden.projectId, randomUUID()]) expect(await found(client, a, project)).toEqual({outcome: 'unavailable', pictures: null});
      expect((await found(client, a, mine.projectId)).outcome).toBe('none');
      expect(await found(client, {...a, epoch: 99}, mine.projectId)).toEqual({outcome: 'denied', pictures: null});
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect(await found(client, a, mine.projectId)).toEqual({outcome: 'denied', pictures: null});
    });
  });

  it('is executable by the service role alone', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const mine = await pictureProject(client, a, await leases(client, a, 1));
      for (const role of ['anon', 'authenticated']) {
        const result = await read(client, a, mine.projectId, role);
        expect(result.ok, role).toBe(false);
        if (!result.ok) expect(result.code, role).toBe('42501');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('artifacts.retained_pictures: the live authorization of the retained-picture resolver', () => {
  const viewOf = async (client: Client, accountId: string, uploadId: string) =>
    (await client.query('select account_id, upload_id, root, digest, length::int as length, content_type from artifacts.retained_pictures where upload_id = $1 and account_id = $2', [uploadId, accountId])).rows;

  it('holds one row for a picture a revision of a live Project of the same Account pins: the root, the retained digest and length, and the content type', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      expect(await viewOf(client, a.accountId, set[0].id)).toEqual([]);
      expect((await review(client, a, projectId, 1, set)).outcome).toBe('created');
      expect(await viewOf(client, a.accountId, set[0].id)).toEqual([
        {account_id: a.accountId, upload_id: set[0].id, root: set[0].retained!.root, digest: set[0].retained!.digest, length: set[0].retained!.length, content_type: 'image/png'},
      ]);
      // A successor that carries the same pins does not make a second row.
      expect((await savePictures(client, a, projectId, [set[0], await lease(client, a)])).outcome).toBe('revised');
      expect(await viewOf(client, a.accountId, set[0].id)).toHaveLength(1);
      // Another Account sees nothing of it.
      const b = await account(client);
      expect(await viewOf(client, b.accountId, set[0].id)).toEqual([]);
    });
  });

  it('holds no row for a picture that is retained but pinned by no revision (an orphan manifest of a failed confirmation)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      await pictureProject(client, a, set);
      await retainAll(client, a, set);
      expect(await viewOf(client, a.accountId, set[0].id)).toEqual([]);
    });
  });

  it('drops a picture when its Project is deleted or tombstoned, and not before', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 2);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      expect((await review(client, a, projectId, 1, set)).outcome).toBe('created');
      expect(await viewOf(client, a.accountId, set[0].id)).toHaveLength(1);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', projectId])).outcome).toBe('recorded');
      expect(await viewOf(client, a.accountId, set[0].id)).toEqual([]);
      expect(await viewOf(client, a.accountId, set[1].id)).toEqual([]);

      // Deleted without a tombstone (deleted_at alone) is gone as well.
      const second = await leases(client, a, 1);
      const other = await pictureProject(client, a, second);
      await retainAll(client, a, second);
      expect((await review(client, a, other.projectId, 1, second)).outcome).toBe('created');
      expect(await viewOf(client, a.accountId, second[0].id)).toHaveLength(1);
      await client.query('update projects.projects set deleted_at = clock_timestamp(), revision = revision + 1 where id = $1', [other.projectId]);
      expect(await viewOf(client, a.accountId, second[0].id)).toEqual([]);
    });
  });

  it('is selectable by the gateway role and by no browser role, and the gateway role has nothing behind it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId } = await pictureProject(client, a, set);
      await retainAll(client, a, set);
      await review(client, a, projectId, 1, set);
      // (What the gateway role reads through it, with real rows, is tests/integration/file-gateway.test.ts: its own connection sees only committed data.)
      expect((await client.query(`select has_table_privilege('nova3d_gateway', 'artifacts.retained_pictures', 'select') as can`)).rows[0].can).toBe(true);
      expect((await client.query(`select has_table_privilege('nova3d_gateway', 'projects.request_images', 'select') as can`)).rows[0].can).toBe(false);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const result = await attempt(client, role, 'select * from artifacts.retained_pictures');
        expect(result.ok, role).toBe(false);
        if (!result.ok) expect(result.code, role).toBe('42501');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the record: checks, immutability and closure', () => {
  async function pinnedRevision(client: Client) {
    const a = await account(client);
    const set = await leases(client, a, 2);
    const { projectId } = await pictureProject(client, a, set);
    await retainAll(client, a, set);
    const done = await review(client, a, projectId, 1, set);
    return {a, set, projectId, revisionId: done.request_id as string};
  }
  const owner = async (client: Client, sql: string, params: unknown[] = []) => attempt(client, null, sql, params);

  it('lets a picture have all three pins or none: one or two of them are refused by the table (23514)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId, requestId } = await pictureProject(client, a, set);
      const insert = (root: string | null, digest: string | null, length: number | null, position: number) =>
        owner(
          client,
          `insert into projects.request_images (revision_id, project_id, account_id, position, upload_id, sha256, length, content_type, retained_root, retained_sha256, retained_length)
           values ($1, $2, $3, $4, $5, $6, 100, 'image/png', $7, $8, $9)`,
          [requestId, projectId, a.accountId, position, randomUUID(), 'a'.repeat(64), root, digest, length],
        );
      for (const [name, root, digest, length] of [
        ['only a root', 'a'.repeat(64), null, null],
        ['a root and a digest', 'a'.repeat(64), 'b'.repeat(64), null],
        ['a digest and a length', null, 'b'.repeat(64), 10],
        ['only a length', null, null, 10],
      ] as const) {
        const result = await insert(root, digest, length, 2);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('23514');
      }
      expect((await insert('a'.repeat(64), 'b'.repeat(64), 10, 2)).ok).toBe(true);
      expect((await insert(null, null, null, 3)).ok).toBe(true);
    });
  });

  it('checks the shape of each pin: a 64-character lower-case hexadecimal root and digest, and a length of at least 1', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const set = await leases(client, a, 1);
      const { projectId, requestId } = await pictureProject(client, a, set);
      const insert = (root: string, digest: string, length: number, position: number) =>
        owner(
          client,
          `insert into projects.request_images (revision_id, project_id, account_id, position, upload_id, sha256, length, content_type, retained_root, retained_sha256, retained_length)
           values ($1, $2, $3, $4, $5, $6, 100, 'image/png', $7, $8, $9)`,
          [requestId, projectId, a.accountId, position, randomUUID(), 'a'.repeat(64), root, digest, length],
        );
      let position = 2;
      for (const [name, root, digest, length] of [
        ['a short root', 'a'.repeat(63), 'b'.repeat(64), 10],
        ['an upper-case root', 'A'.repeat(64), 'b'.repeat(64), 10],
        ['a root that is not hexadecimal', 'g'.repeat(64), 'b'.repeat(64), 10],
        ['a long digest', 'a'.repeat(64), 'b'.repeat(65), 10],
        ['an upper-case digest', 'a'.repeat(64), 'B'.repeat(64), 10],
        ['a length of 0', 'a'.repeat(64), 'b'.repeat(64), 0],
        ['a negative length', 'a'.repeat(64), 'b'.repeat(64), -5],
      ] as const) {
        const result = await insert(root, digest, length, position++);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('23514');
      }
    });
  });

  it('never edits a pin: an update of a retained column, or of any column, is refused, and the table cannot be truncated', async () => {
    await inTx(async (client) => {
      const { revisionId } = await pinnedRevision(client);
      for (const sql of [
        `update projects.request_images set retained_root = '${'c'.repeat(64)}' where revision_id = $1`,
        `update projects.request_images set retained_length = 5 where revision_id = $1`,
        `update projects.request_images set retained_root = null, retained_sha256 = null, retained_length = null where revision_id = $1`,
      ]) {
        const result = await owner(client, sql, [revisionId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      const truncated = await owner(client, 'truncate projects.request_images');
      expect(truncated.ok).toBe(false);
      if (!truncated.ok) expect(truncated.code).toBe('55000');
    });
  });

  it('keeps a manifest immutable and never deletes it: the retained copy\'s record cannot be changed or removed, even by the owner', async () => {
    await inTx(async (client) => {
      const { set } = await pinnedRevision(client);
      for (const sql of [
        `update artifacts.manifests set length = 1 where upload_id = $1`,
        `update artifacts.manifests set digest = '${'0'.repeat(64)}' where upload_id = $1`,
        `delete from artifacts.manifests where upload_id = $1`,
      ]) {
        const result = await owner(client, sql, [set[0].id]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      const truncated = await owner(client, 'truncate artifacts.manifests');
      expect(truncated.ok).toBe(false);
    });
  });

  it('is closed: no role but the owner reaches the pins, and the quota\'s index exists', async () => {
    await inTx(async (client) => {
      await pinnedRevision(client);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const sql of ['select retained_root from projects.request_images', 'select retained_sha256, retained_length from projects.request_images']) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role} ${sql}`).toBe(false);
        }
      }
      const {rows: index} = await client.query(`select indexdef from pg_indexes where schemaname = 'artifacts' and tablename = 'manifests' and indexname = 'manifests_account_kind'`);
      expect(index).toHaveLength(1);
      expect(index[0].indexdef).toMatch(/\(account_id, kind\)/);
    });
  });

  it('has exactly the three nullable pin columns, named for what they are, and adds no other column to the picture record', async () => {
    const { rows } = await db.query(
      `select column_name as name, is_nullable = 'YES' as nullable, data_type as type from information_schema.columns
        where table_schema = 'projects' and table_name = 'request_images' and column_name like 'retained%' order by 1`,
    );
    expect(rows).toEqual([
      {name: 'retained_length', nullable: true, type: 'integer'},
      {name: 'retained_root', nullable: true, type: 'text'},
      {name: 'retained_sha256', nullable: true, type: 'text'},
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.preflight after the Story 2.12 migration', () => {
  it('answers ok, and carries the new functions and the view', async () => {
    await inTx(async (client) => {
      expect(await asService(client, 'select * from api.preflight()', [])).toEqual({ok: true});
      const { rows } = await client.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as definition`);
      const definition = rows[0].definition as string;
      for (const needle of ['retained_root', 'retained_sha256', 'retained_length', 'artifacts.retained_pictures', 'api.check_picture_retention(uuid,bigint,uuid,integer,uuid[])', 'api.read_retained_pictures(uuid,bigint,uuid)', 'Story 2.12 migration']) {
        expect(definition, needle).toContain(needle);
      }
    });
  });

  it.each(['api.check_picture_retention(uuid,bigint,uuid,integer,uuid[])', 'api.read_retained_pictures(uuid,bigint,uuid)'])('fails with one line naming the Story 2.12 migration when %s is missing', async (signature) => {
    await inTx(async (client) => {
      await client.query(`drop function ${signature}`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('Story 2.12 migration');
        expect(result.message).toContain(signature);
      }
    });
  });

  it('refuses when the service role cannot execute a new function', async () => {
    await inTx(async (client) => {
      await client.query('revoke execute on function api.check_picture_retention(uuid, bigint, uuid, integer, uuid[]) from service_role');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('api.check_picture_retention');
      }
    });
  });
});
