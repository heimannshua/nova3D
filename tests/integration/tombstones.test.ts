import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {authorizeStep, authorizeTarget, operationOf} from '@/lib/authority';
import {createFixtureLedgerStore} from '@/lib/ledger-fixture';
import {relayLedger, verifyChain} from '@/lib/ledger';
import {claimLedgerEvents, finishLedgerEvents, guardTarget, ledgerPending, lookupStatus, recordTombstone} from '@/lib/lifecycle';
import {mergeStatus, type StatusReply} from '@/lib/hidden-state';
import {readProject} from '@/lib/projects';
import {resolveProjectTarget} from '@/lib/project-target';
import {codeHash, createHarness, originHash, stack, tag} from '../support/accounts-db';
import {jwtSecretOf, stackEnvironment} from '../support/stack';

// Story 1.8 against the Supabase CLI stack: the tombstone record and its one writer, the guard beside the epoch guard, the Account's status
// handle, the transactional outbox and the relay's lease, the status lookup and its rate limit, the closure of every new object and the
// preflight; every row of the I/O matrix at the database. Most cases run inside a transaction that is rolled back, as the service role. The
// cases that need several real connections, and the typed calls the application makes over REST, commit data that is removed afterwards.
//
// Tombstones and outbox rows are append-only and have no foreign key, so what a committed case writes STAYS (the audit trail does too).
// Every case therefore asserts on its own IDs, never on a global count; the cases that need an exact backlog first mark what is pending
// as relayed (the one change an outbox row allows), inside the rolled-back transaction, or once for the file where the data is committed.

const {db, connect, committed, inTx, addUser, addSession, attempt, rows, api} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});
beforeEach(async () => {
  // A case that holds the relay lease must not leave it for the next.
  await db.query('update lifecycle.ledger_relay set holder = null, lease_expires_at = null');
});
afterAll(async () => {
  const client = await connect().catch(() => null);
  if (client) await client.query('update lifecycle.ledger_relay set holder = null, lease_expires_at = null');
});

// Fixtures ---------------------------------------------------------------------------------------------------------------------

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; epoch: number};

/** An Account with its Workspace, made the way registration makes one (identity.activate_account). */
async function account(client: Client, role: 'member' | 'administrator' = 'member'): Promise<Fixture> {
  const user = await addUser(client);
  const {rows: made} = await client.query(`select identity.activate_account($1, $2, $3, 'invitation') as id`, [user.id, user.subject, role]);
  const accountId = made[0].id as string;
  const {rows: workspace} = await client.query('select id from projects.workspaces where account_id = $1', [accountId]);
  return {user, accountId, workspaceId: workspace[0].id as string, epoch: 1};
}
async function committedAccount(): Promise<Fixture> {
  const made = await account(db);
  committed.users.push(made.user.id);
  return made;
}
async function project(client: Client, owner: Fixture, options: {title?: string; deleted?: boolean} = {}): Promise<string> {
  const {rows: made} = await client.query(
    `insert into projects.projects (workspace_id, account_id, title, stage, deleted_at) values ($1, $2, $3, 'researching', case when $4 then now() end) returning id`,
    [owner.workspaceId, owner.accountId, options.title ?? 'Courtyard bench', options.deleted === true],
  );
  return made[0].id as string;
}
/** A live session of the Account's user with its grant. */
async function session(client: Client, owner: Fixture) {
  const sessionId = await addSession(client, owner.user.id);
  const grant = await api(client).issueGrant(owner.user.id, sessionId);
  if (grant.outcome !== 'issued') throw new Error(`The test grant was not issued (${grant.outcome}).`);
  return sessionId;
}

const svc = async (client: Client, sql: string, params: unknown[] = []) => (await rows(client, 'service_role', sql, params))[0];
const tombstone = (client: Client, kind: string, id: string) => svc(client, 'select outcome, kind, target_id, revision::int as revision from api.record_tombstone($1, $2)', [kind, id]);
const guardOp = (client: Client, who: Fixture, epoch = who.epoch) => svc(client, 'select outcome, epoch::int as epoch from api.guard_operation($1, $2)', [who.accountId, epoch]);
const guard = (client: Client, who: Fixture, kind: string, id: string, epoch = who.epoch) =>
  svc(client, 'select outcome, epoch::int as epoch from api.guard_target($1, $2, $3, $4)', [who.accountId, epoch, kind, id]);
const lookup = (client: Client, handle: string, origin = originHash()) => svc(client, 'select outcome, revision::int as revision, retry_after from api.lookup_status($1, $2)', [handle, origin]);
const handleOf = async (client: Client, kind: 'account' | 'project', id: string) =>
  (await client.query(`select encode(status_handle, 'hex') as handle from ${kind === 'account' ? 'identity.accounts' : 'projects.projects'} where id = $1`, [id])).rows[0].handle as string;
const tombstoneRow = async (client: Client, kind: string, id: string) =>
  (await client.query(`select kind, target_id, encode(status_handle, 'hex') as handle, revision::int as revision, recorded_at from lifecycle.tombstones where kind = $1 and target_id = $2`, [kind, id])).rows[0] as
    | {kind: string; target_id: string; handle: string; revision: number; recorded_at: Date}
    | undefined;
const accountRow = async (client: Client, id: string) =>
  (await client.query('select status, authorization_epoch::int as epoch from identity.accounts where id = $1', [id])).rows[0] as {status: string; epoch: number};
const projectRow = async (client: Client, id: string) =>
  (await client.query('select revision::int as revision, deleted_at, title from projects.projects where id = $1', [id])).rows[0] as {revision: number; deleted_at: Date | null; title: string};

type Event = {seq: number; id: string; event: Record<string, unknown>};
const lastSeq = async (client: Client) => Number((await client.query('select coalesce(max(seq), 0) as n from lifecycle.ledger_outbox')).rows[0].n);
const eventsAfter = async (client: Client, seq: number) => (await client.query('select seq::int as seq, id, event from lifecycle.ledger_outbox where seq > $1 order by seq', [seq])).rows as Event[];
/** Marks everything pending as relayed (the one change an outbox row allows), so a case can count exactly. */
const drain = (client: Client) => client.query('update lifecycle.ledger_outbox set relayed_at = clock_timestamp() where relayed_at is null');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function untilBlocked(pid: number) {
  for (let attemptNumber = 0; attemptNumber < 100; attemptNumber += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await wait(50);
  }
  throw new Error('The other connection never started waiting for the lock.');
}

// ---------------------------------------------------------------------------------------------------
describe('the Account\'s status handle', () => {
  it('is 16 random bytes, created with the Account, different for each, and not null', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const {rows: found} = await client.query('select octet_length(status_handle) as bytes, encode(status_handle, \'hex\') as hex from identity.accounts where id = any($1)', [[a.accountId, b.accountId]]);
      expect(found.map((row) => row.bytes)).toEqual([16, 16]);
      expect(new Set(found.map((row) => row.hex)).size).toBe(2);
      for (const row of found) expect(row.hex).toMatch(/^[0-9a-f]{32}$/);
      const {rows: column} = await client.query(`select is_nullable, column_default from information_schema.columns where table_schema = 'identity' and table_name = 'accounts' and column_name = 'status_handle'`);
      expect(column[0].is_nullable).toBe('NO');
      expect(column[0].column_default).toContain('gen_random_bytes(16)');
    });
  });

  it('is held by every Account now in the database, each one different (a count of the current rows: the populated-database apply is the hosted-status-check item)', async () => {
    const {rows} = await db.query('select count(*)::int as accounts, count(distinct status_handle)::int as handles from identity.accounts');
    expect(rows[0].handles).toBe(rows[0].accounts);
  });

  it('is unique, and never changes', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const duplicate = await attempt(client, null, `update identity.accounts set status_handle = (select status_handle from identity.accounts where id = $2) where id = $1`, [a.accountId, b.accountId]);
      expect(duplicate.ok).toBe(false);
    });
    await inTx(async (client) => {
      const a = await account(client);
      const before = await handleOf(client, 'account', a.accountId);
      const changed = await attempt(client, null, `update identity.accounts set status_handle = extensions.gen_random_bytes(16) where id = $1`, [a.accountId]);
      expect(changed.ok).toBe(false);
      if (!changed.ok) expect(changed.code).toBe('55000');
      expect(await handleOf(client, 'account', a.accountId)).toBe(before);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.record_tombstone: the one writer', () => {
  it('records an Account: the Account is disabled under an epoch raised by one, and the tombstone holds its kind, ID, handle, that revision and the time', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const handle = await handleOf(client, 'account', a.accountId);
      const result = await tombstone(client, 'account', a.accountId);
      expect(result).toEqual({outcome: 'recorded', kind: 'account', target_id: a.accountId, revision: 2});
      expect(await accountRow(client, a.accountId)).toEqual({status: 'disabled', epoch: 2});
      const row = await tombstoneRow(client, 'account', a.accountId);
      expect(row).toMatchObject({kind: 'account', target_id: a.accountId, handle, revision: 2});
      expect(Date.now() - row!.recorded_at.getTime()).toBeLessThan(60_000);
      const {rows: columns} = await client.query(`select column_name from information_schema.columns where table_schema = 'lifecycle' and table_name = 'tombstones' order by ordinal_position`);
      expect(columns.map((column) => column.column_name)).toEqual(['kind', 'target_id', 'status_handle', 'revision', 'recorded_at']);
    });
  });

  it('records a Project: it gets deleted_at and its revision rises by one, and the tombstone holds that revision and its handle', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const handle = await handleOf(client, 'project', id);
      const before = await projectRow(client, id);
      expect(before).toMatchObject({revision: 1, deleted_at: null});
      expect(await tombstone(client, 'project', id)).toEqual({outcome: 'recorded', kind: 'project', target_id: id, revision: 2});
      const after = await projectRow(client, id);
      expect(after.revision).toBe(2);
      expect(after.deleted_at).not.toBeNull();
      expect(await tombstoneRow(client, 'project', id)).toMatchObject({kind: 'project', target_id: id, handle, revision: 2});
      // The Account is untouched by a Project's deletion.
      expect(await accountRow(client, a.accountId)).toEqual({status: 'active', epoch: 1});
    });
  });

  it('hides FIRST: when the tombstone is inserted the target is already hidden (an Account disabled under its raised epoch, a Project deleted)', async () => {
    await inTx(async (client) => {
      await client.query('create table public.zz_probe_seen (kind text, status text, epoch bigint, deleted boolean)');
      await client.query(`create function public.zz_probe() returns trigger language plpgsql as $$
        begin
          if new.kind = 'account' then
            insert into public.zz_probe_seen select 'account', a.status, a.authorization_epoch, null from identity.accounts a where a.id = new.target_id;
          else
            insert into public.zz_probe_seen select 'project', null, p.revision, p.deleted_at is not null from projects.projects p where p.id = new.target_id;
          end if;
          return new;
        end $$`);
      await client.query('create trigger zz_probe before insert on lifecycle.tombstones for each row execute function public.zz_probe()');
      const a = await account(client);
      const id = await project(client, a);
      await tombstone(client, 'project', id);
      await tombstone(client, 'account', a.accountId);
      const {rows: seen} = await client.query('select * from public.zz_probe_seen order by kind');
      expect(seen).toEqual([
        {kind: 'account', status: 'disabled', epoch: '2', deleted: null},
        {kind: 'project', status: null, epoch: '2', deleted: true},
      ]);
    });
  });

  it('queues its ledger event in the same transaction: the tombstone\'s, after the Account\'s own disable (a Project\'s deletion queues the tombstone alone)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const since = await lastSeq(client);
      await tombstone(client, 'project', id);
      const projectEvents = await eventsAfter(client, since);
      expect(projectEvents.map((entry) => entry.event.type)).toEqual(['tombstone']);
      expect(projectEvents[0].event).toEqual({id: projectEvents[0].id, type: 'tombstone', kind: 'project', target_id: id, handle: await handleOf(client, 'project', id), revision: 2});
      const mark = await lastSeq(client);
      await tombstone(client, 'account', a.accountId);
      const accountEvents = await eventsAfter(client, mark);
      expect(accountEvents.map((entry) => entry.event.type)).toEqual(['account_authority', 'tombstone']);
      expect(accountEvents[0].event).toEqual({id: accountEvents[0].id, type: 'account_authority', account_id: a.accountId, status: 'disabled', epoch: 2});
      expect(accountEvents[1].event).toEqual({id: accountEvents[1].id, type: 'tombstone', kind: 'account', target_id: a.accountId, handle: await handleOf(client, 'account', a.accountId), revision: 2});
    });
  });

  it('is idempotent: a second call changes nothing, queues nothing and answers `exists` with the first revision', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      for (const [kind, target] of [['project', id], ['account', a.accountId]] as const) {
        const first = await tombstone(client, kind, target);
        expect(first.outcome).toBe('recorded');
        const stateBefore = [await accountRow(client, a.accountId), await projectRow(client, id), await tombstoneRow(client, kind, target)];
        const since = await lastSeq(client);
        const second = await tombstone(client, kind, target);
        expect(second).toEqual({outcome: 'exists', kind, target_id: target, revision: first.revision});
        expect([await accountRow(client, a.accountId), await projectRow(client, id), await tombstoneRow(client, kind, target)]).toEqual(stateBefore);
        expect(await eventsAfter(client, since)).toEqual([]);
      }
    });
  });

  it('raises the epoch of an Account that is disabled already, by exactly one, so the tombstone has a revision of its own', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      expect(await accountRow(client, a.accountId)).toEqual({status: 'disabled', epoch: 2});
      expect(await tombstone(client, 'account', a.accountId)).toMatchObject({outcome: 'recorded', revision: 3});
      expect(await accountRow(client, a.accountId)).toEqual({status: 'disabled', epoch: 3});
    });
  });

  it('ends the Account\'s Auth sessions with the hide, as api.disable_account does, and only that person\'s: no refresh token can mint another access token', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const first = await session(client, a);
      const second = await addSession(client, a.user.id);
      const others = await session(client, b);
      const authSessions = async (userId: string) => (await client.query('select id from auth.sessions where user_id = $1 order by id', [userId])).rows.map((row) => row.id as string);
      expect(await authSessions(a.user.id)).toEqual([first, second].sort());
      const auditSince = Number((await client.query('select coalesce(max(id), 0) as n from identity.audit_events')).rows[0].n);

      expect(await tombstone(client, 'account', a.accountId)).toMatchObject({outcome: 'recorded', revision: 2});
      expect(await authSessions(a.user.id)).toEqual([]);
      expect(await authSessions(b.user.id)).toEqual([others]);
      // The grants are ended by the epoch, as for a disable: the Account says `disabled` to a session it had.
      expect(await api(client).authorize(a.user.id, first)).toMatchObject({state: 'disabled'});
      // Nothing is audited by the sessions' deletion: the only audit event is the one the Account guard has always written for a status change.
      const audit = (await client.query('select actor, action, target from identity.audit_events where id > $1 order by id', [auditSince])).rows;
      expect(audit).toEqual([{actor: 'system:accounts', action: 'account.epoch_raised', target: `account:${a.accountId}`}]);

      // A second call changes nothing, sessions included: a session made after the tombstone is left alone.
      const later = await addSession(client, a.user.id);
      expect(await tombstone(client, 'account', a.accountId)).toMatchObject({outcome: 'exists', revision: 2});
      expect(await authSessions(a.user.id)).toEqual([later]);
    });
  });

  it('leaves the owner\'s Auth sessions alone when it is a Project that is tombstoned', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const kept = await session(client, a);
      await tombstone(client, 'project', id);
      expect((await client.query('select id from auth.sessions where user_id = $1', [a.user.id])).rows.map((row) => row.id)).toEqual([kept]);
      expect(await api(client).authorize(a.user.id, kept)).toMatchObject({state: 'active'});
    });
  });

  it('records the next revision of a Project that has changed: its revision plus one', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      await svc(client, `select * from api.rename_project($1, 1, $2, $3, 1, 'Renamed')`, [a.accountId, randomUUID(), id]);
      expect((await projectRow(client, id)).revision).toBe(2);
      expect(await tombstone(client, 'project', id)).toMatchObject({outcome: 'recorded', revision: 3});
    });
  });

  it('answers `not_found` for a target that is not there and has no tombstone, and writes nothing; and `exists` once the row is gone but the tombstone stays', async () => {
    await inTx(async (client) => {
      const since = await lastSeq(client);
      for (const kind of ['account', 'project']) {
        const missing = randomUUID();
        expect(await tombstone(client, kind, missing)).toEqual({outcome: 'not_found', kind, target_id: missing, revision: null});
        expect(await tombstoneRow(client, kind, missing)).toBeUndefined();
      }
      expect(await eventsAfter(client, since)).toEqual([]);
      const a = await account(client);
      const id = await project(client, a);
      const recorded = await tombstone(client, 'project', id);
      await client.query('delete from projects.projects where id = $1', [id]);
      expect(await tombstone(client, 'project', id)).toEqual({outcome: 'exists', kind: 'project', target_id: id, revision: recorded.revision});
    });
  });

  it('refuses a kind that is not account or project and an ID that is null, as an invalid argument', async () => {
    await inTx(async (client) => {
      for (const params of [['workspace', randomUUID()], [null, randomUUID()], ['account', null], ['', randomUUID()]]) {
        const result = await attempt(client, 'service_role', 'select * from api.record_tombstone($1, $2)', params);
        expect(result.ok, JSON.stringify(params)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(params)).toBe('22023');
      }
    });
  });

  it('is executable by the service role alone', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const role of ['anon', 'authenticated']) {
        const result = await attempt(client, role, 'select * from api.record_tombstone($1, $2)', ['account', a.accountId]);
        expect(result.ok, role).toBe(false);
      }
      expect(await tombstoneRow(client, 'account', a.accountId)).toBeUndefined();
      expect(await accountRow(client, a.accountId)).toEqual({status: 'active', epoch: 1});
    });
  });

  it('is one recording when two arrive at once: one `recorded`, one `exists`, one tombstone, one revision bump', async () => {
    const a = await committedAccount();
    const id = await project(db, a);
    const [first, second] = await Promise.all([connect(), connect()]);
    const answers = await Promise.all([first, second].map((client) => client.query('select outcome, revision::int as revision from api.record_tombstone($1, $2)', ['project', id])));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['exists', 'recorded']);
    expect(new Set(answers.map((answer) => answer.rows[0].revision))).toEqual(new Set([2]));
    expect((await projectRow(db, id)).revision).toBe(2);
    expect((await db.query('select count(*)::int as n from lifecycle.tombstones where target_id = $1', [id])).rows[0].n).toBe(1);
    expect((await eventsAfter(db, 0)).filter((entry) => entry.event.target_id === id)).toHaveLength(1);
  });

  it('waits for a rename that holds the Project, then hides it: nothing the rename committed is lost, and the Project is gone after', async () => {
    const a = await committedAccount();
    const id = await project(db, a, {title: 'Before'});
    const renamer = await connect();
    const recorder = await connect();
    const {rows: pid} = await recorder.query('select pg_backend_pid() as pid');
    await renamer.query('begin');
    expect((await renamer.query(`select outcome from api.rename_project($1, 1, $2, $3, 1, 'In time')`, [a.accountId, randomUUID(), id])).rows[0].outcome).toBe('renamed');
    const recording = recorder.query('select outcome, revision::int as revision from api.record_tombstone($1, $2)', ['project', id]);
    await untilBlocked(pid[0].pid);
    await renamer.query('commit');
    expect((await recording).rows[0]).toEqual({outcome: 'recorded', revision: 3});
    expect(await projectRow(db, id)).toMatchObject({title: 'In time', revision: 3});
    expect((await projectRow(db, id)).deleted_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a tombstone is never updated, deleted or truncated', () => {
  it('refuses an update, a delete and a truncate, by any role that could try, and keeps the row as it was', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await tombstone(client, 'account', a.accountId);
      const before = await tombstoneRow(client, 'account', a.accountId);
      for (const sql of [
        `update lifecycle.tombstones set revision = revision + 1 where target_id = $1`,
        `update lifecycle.tombstones set revision = 1 where target_id = $1`,
        `update lifecycle.tombstones set kind = 'project' where target_id = $1`,
        `update lifecycle.tombstones set status_handle = extensions.gen_random_bytes(16) where target_id = $1`,
        `delete from lifecycle.tombstones where target_id = $1`,
        `delete from lifecycle.tombstones`,
        `truncate lifecycle.tombstones`,
      ]) {
        const result = await attempt(client, null, sql, sql.startsWith('truncate') || sql === 'delete from lifecycle.tombstones' ? [] : [a.accountId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      expect(await tombstoneRow(client, 'account', a.accountId)).toEqual(before);
    });
  });

  it('is unique per target and per handle', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      await tombstone(client, 'account', a.accountId);
      const sameTarget = await attempt(client, null, `insert into lifecycle.tombstones (kind, target_id, status_handle, revision) values ('account', $1, extensions.gen_random_bytes(16), 9)`, [a.accountId]);
      expect(sameTarget.ok).toBe(false);
      if (!sameTarget.ok) expect(sameTarget.code).toBe('23505');
      const sameHandle = await attempt(client, null, `insert into lifecycle.tombstones (kind, target_id, status_handle, revision) values ('account', $1, (select status_handle from lifecycle.tombstones where target_id = $2), 9)`, [b.accountId, a.accountId]);
      expect(sameHandle.ok).toBe(false);
      if (!sameHandle.ok) expect(sameHandle.code).toBe('23505');
    });
  });

  it('holds only what a tombstone may: a kind of account or project, a 16-byte handle and a revision of at least 1', async () => {
    await inTx(async (client) => {
      for (const values of [`('workspace', gen_random_uuid(), extensions.gen_random_bytes(16), 1)`, `('account', gen_random_uuid(), extensions.gen_random_bytes(8), 1)`, `('account', gen_random_uuid(), extensions.gen_random_bytes(16), 0)`]) {
        const result = await attempt(client, null, `insert into lifecycle.tombstones (kind, target_id, status_handle, revision) values ${values}`);
        expect(result.ok, values).toBe(false);
        if (!result.ok) expect(result.code, values).toBe('23514');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a deleted ID is never reused, and a tombstoned target never comes back', () => {
  it('refuses to insert a Project with a tombstoned ID, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      await tombstone(client, 'project', id);
      await client.query('delete from projects.projects where id = $1', [id]);
      const before = Number((await client.query('select count(*) as n from projects.projects where account_id = $1', [a.accountId])).rows[0].n);
      const reused = await attempt(client, null, `insert into projects.projects (id, workspace_id, account_id, title, stage) values ($1, $2, $3, 'Back again', 'researching')`, [id, a.workspaceId, a.accountId]);
      expect(reused.ok).toBe(false);
      if (!reused.ok) expect(reused.code).toBe('55000');
      expect(Number((await client.query('select count(*) as n from projects.projects where account_id = $1', [a.accountId])).rows[0].n)).toBe(before);
    });
  });

  it('refuses to insert an Account with a tombstoned ID, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await tombstone(client, 'account', a.accountId);
      const other = await addUser(client);
      const reused = await attempt(client, null, `insert into identity.accounts (id, user_id, google_subject, role, source) values ($1, $2, $3, 'member', 'invitation')`, [a.accountId, other.id, other.subject]);
      expect(reused.ok).toBe(false);
      if (!reused.ok) expect(reused.code).toBe('55000');
      expect((await client.query('select count(*)::int as n from identity.accounts where user_id = $1', [other.id])).rows[0].n).toBe(0);
    });
  });

  it('lets an ID that is tombstoned as one kind be used as the other: a tombstone is per kind and target', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await tombstone(client, 'account', a.accountId);
      const id = randomUUID();
      const made = await attempt(client, null, `insert into projects.projects (id, workspace_id, account_id, title, stage) values ($1, $2, $3, 'Fine', 'researching')`, [id, a.workspaceId, a.accountId]);
      expect(made.ok).toBe(true);
    });
  });

  it('cannot enable a tombstoned Account: api.enable_account answers not_found and the guard trigger refuses any other way', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await tombstone(client, 'account', a.accountId);
      const before = await accountRow(client, a.accountId);
      expect(await svc(client, `select outcome, epoch from api.enable_account('seed:local:test', $1)`, [a.accountId])).toEqual({outcome: 'not_found', epoch: null});
      const direct = await attempt(client, null, `update identity.accounts set status = 'active' where id = $1`, [a.accountId]);
      expect(direct.ok).toBe(false);
      if (!direct.ok) expect(direct.code).toBe('55000');
      expect(await accountRow(client, a.accountId)).toEqual(before);
      // The epoch may still rise (a revocation is never refused), but the Account stays disabled.
      await client.query(`select * from api.raise_authorization_epoch($1, 'seed:local:test')`, [a.accountId]);
      expect(await accountRow(client, a.accountId)).toEqual({status: 'disabled', epoch: before.epoch + 1});
    });
  });

  it('refuses an enable that was waiting for the tombstone\'s transaction: api.enable_account answers not_found, and a direct update is refused by the trigger, both after the lock', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    await db.query(`select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
    await db.query(`select * from api.disable_account('seed:local:test', $1)`, [b.accountId]);
    const recorder = await connect();
    const enabler = await connect();
    const updater = await connect();
    const {rows: enablerPid} = await enabler.query('select pg_backend_pid() as pid');
    const {rows: updaterPid} = await updater.query('select pg_backend_pid() as pid');
    await recorder.query('begin');
    await recorder.query('select * from api.record_tombstone($1, $2)', ['account', a.accountId]);
    await recorder.query('select * from api.record_tombstone($1, $2)', ['account', b.accountId]);
    const enabling = enabler.query(`select outcome from api.enable_account('seed:local:test', $1)`, [a.accountId]);
    const updating = updater.query(`update identity.accounts set status = 'active' where id = $1`, [b.accountId]);
    const updated = updating.then(() => 'updated', (error: {code?: string}) => error.code);
    await untilBlocked(enablerPid[0].pid);
    await untilBlocked(updaterPid[0].pid);
    await recorder.query('commit');
    expect((await enabling).rows[0].outcome).toBe('not_found');
    expect(await updated).toBe('55000');
    for (const who of [a, b]) expect((await accountRow(db, who.accountId)).status).toBe('disabled');
  });

  it('still enables an Account that has no tombstone, as before (nothing else changed)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      expect(await svc(client, `select outcome, epoch::int as epoch from api.enable_account('seed:local:test', $1)`, [a.accountId])).toEqual({outcome: 'enabled', epoch: 3});
    });
  });

  it('cannot show a tombstoned Project again', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      await tombstone(client, 'project', id);
      const shown = await attempt(client, null, `update projects.projects set deleted_at = null, revision = revision + 1 where id = $1`, [id]);
      expect(shown.ok).toBe(false);
      if (!shown.ok) expect(shown.code).toBe('55000');
      expect((await projectRow(client, id)).deleted_at).not.toBeNull();
    });
  });

  it('still lets a hidden Project that has no tombstone be handled as in Story 1.7 (the existing hide by deleted_at is unchanged)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {deleted: true});
      expect(await guard(client, a, 'project', id)).toEqual({outcome: 'unavailable', epoch: 1});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the guard rejects a tombstoned target before any other effect, and says nothing about it', () => {
  it('lifecycle.assert_not_tombstoned raises N3010 (tombstoned) for a tombstoned Account or Project, and passes any other', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      for (const [kind, target] of [['account', a.accountId], ['project', id]] as const) {
        expect((await attempt(client, null, 'select lifecycle.assert_not_tombstoned($1, $2)', [kind, target])).ok, `${kind} before`).toBe(true);
        await tombstone(client, kind, target);
        const refused = await attempt(client, null, 'select lifecycle.assert_not_tombstoned($1, $2)', [kind, target]);
        expect(refused.ok, `${kind} after`).toBe(false);
        if (!refused.ok) {
          expect(refused.code).toBe('N3010');
          expect(refused.message).toContain('tombstoned');
        }
      }
      const invalid = await attempt(client, null, `select lifecycle.assert_not_tombstoned('workspace', $1)`, [randomUUID()]);
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.code).toBe('22023');
    });
  });

  it('is callable by no API role: the helpers belong to nobody', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const sql of ['select lifecycle.assert_not_tombstoned(\'account\', $1)', 'select lifecycle.is_tombstoned(\'account\', $1)']) {
          const result = await attempt(client, role, sql, [a.accountId]);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
        }
      }
    });
  });

  it('is the first thing identity.assert_operation_authority checks: a tombstoned Account is `tombstoned`, not disabled or stale, whatever epoch the operation holds', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await tombstone(client, 'account', a.accountId);
      for (const epoch of [1, 2, 3, 99]) {
        const refused = await attempt(client, null, 'select identity.assert_operation_authority($1, $2)', [a.accountId, epoch]);
        expect(refused.ok, `epoch ${epoch}`).toBe(false);
        if (!refused.ok) {
          expect(refused.code).toBe('N3010');
          expect(refused.message).toBe('operation authority denied: tombstoned');
        }
      }
      // An Account that is merely disabled still says disabled, and one that is gone still says no_account (nothing about those changed).
      const b = await account(client);
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [b.accountId]);
      const disabled = await attempt(client, null, 'select identity.assert_operation_authority($1, 2)', [b.accountId]);
      expect(disabled.ok).toBe(false);
      if (!disabled.ok) {
        expect(disabled.code).toBe('N3010');
        expect(disabled.message).toBe('operation authority denied: disabled');
      }
      const gone = await attempt(client, null, 'select identity.assert_operation_authority($1, 1)', [randomUUID()]);
      expect(gone.ok).toBe(false);
      if (!gone.ok) {
        expect(gone.code).toBe('N3010');
        expect(gone.message).toBe('operation authority denied: no_account');
      }
    });
  });

  it('is the first thing api.guard_operation answers: `tombstoned`, with the epoch, for any epoch; and the four old answers are as they were', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const c = await account(client);
      expect(await guardOp(client, a)).toEqual({outcome: 'allowed', epoch: 1});
      expect(await guardOp(client, a, 7)).toEqual({outcome: 'stale_epoch', epoch: 1});
      expect(await guardOp(client, {...a, accountId: randomUUID()})).toEqual({outcome: 'no_account', epoch: null});
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [b.accountId]);
      expect(await guardOp(client, b, 2)).toEqual({outcome: 'disabled', epoch: 2});
      await tombstone(client, 'account', c.accountId);
      for (const epoch of [1, 2, 3]) expect(await guardOp(client, c, epoch), `epoch ${epoch}`).toEqual({outcome: 'tombstoned', epoch: 2});
      // The row may be gone (a purge); the tombstone still answers.
      await client.query('delete from projects.workspaces where account_id = $1', [c.accountId]);
      await client.query('delete from identity.accounts where id = $1', [c.accountId]);
      expect(await guardOp(client, c, 2)).toEqual({outcome: 'tombstoned', epoch: null});
    });
  });

  it('ends every operation registered under an older epoch: it was allowed before the tombstone, and is `tombstoned` after, and stays so', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      expect(await guardOp(client, a, 1)).toMatchObject({outcome: 'allowed'});
      await tombstone(client, 'account', a.accountId);
      expect(await guardOp(client, a, 1)).toMatchObject({outcome: 'tombstoned'});
      // Not even a re-enable path brings it back (there is none), and an operation can hold no epoch the Account has not reached.
      await svc(client, `select * from api.enable_account('seed:local:test', $1)`, [a.accountId]);
      expect(await guardOp(client, a, 1)).toMatchObject({outcome: 'tombstoned'});
      expect(await guardOp(client, a, 2)).toMatchObject({outcome: 'tombstoned'});
    });
  });

  it('gives a tombstoned Account no session: its grants are stale, its Auth user gets no new grant, and every function that guards on authority refuses it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const existing = await session(client, a);
      const later = await addSession(client, a.user.id);
      const csrf = codeHash();
      expect(await api(client).authorize(a.user.id, existing)).toMatchObject({state: 'active'});
      await tombstone(client, 'account', a.accountId);
      expect(await api(client).authorize(a.user.id, existing)).toMatchObject({state: 'disabled', account_id: null});
      expect(await api(client).issueGrant(a.user.id, later)).toMatchObject({outcome: 'disabled'});
      expect(await api(client).issueCsrf(a.user.id, existing, csrf)).toEqual({outcome: 'denied'});
      expect(await api(client).setPreference(a.accountId, 'theme', 'dark')).toEqual({outcome: 'denied'});
      expect(await api(client).startStepUp(a.user.id, existing, 'administration', codeHash(), randomBytes(32).toString('base64url'))).toEqual({outcome: 'refused', expires_at: null});
      expect((await client.query('select count(*)::int as n from identity.session_grants where session_id = $1', [later])).rows[0].n).toBe(0);
    });
  });

  it('answers a Project call of a tombstoned Account `denied`, and reads and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      await tombstone(client, 'account', a.accountId);
      const epoch = 2;
      expect(await svc(client, 'select outcome, total, projects from api.list_projects($1, $2, 5)', [a.accountId, epoch])).toEqual({outcome: 'denied', total: null, projects: null});
      expect((await svc(client, 'select outcome, id, title from api.get_project($1, $2, $3)', [a.accountId, epoch, id])).outcome).toBe('denied');
      expect((await svc(client, `select outcome from api.rename_project($1, $2, $3, $4, 1, 'Too late')`, [a.accountId, epoch, randomUUID(), id])).outcome).toBe('denied');
      expect(await projectRow(client, id)).toMatchObject({title: 'Courtyard bench', revision: 1});
    });
  });

  it('answers every Project function `unavailable` for a tombstoned Project, the very row it gives for an unknown or foreign one, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const gone = await project(client, a, {title: 'Tombstoned plans'});
      const foreign = await project(client, b, {title: 'Foreign plans'});
      await project(client, a, {title: 'Kept'});
      await tombstone(client, 'project', gone);
      const receipts = Number((await client.query('select count(*) as n from projects.project_commands')).rows[0].n);

      const empty = {outcome: 'unavailable', id: null, title: null, stage: null, current_version: null, revision: null, created_at: null, updated_at: null};
      const reads = [gone, foreign, randomUUID()].map((id) => svc(client, 'select * from api.get_project($1, 1, $2)', [a.accountId, id]));
      for (const answer of await Promise.all(reads)) expect(answer).toEqual(empty);
      const renames = [];
      for (const id of [gone, foreign, randomUUID()]) renames.push(await svc(client, `select outcome, project_id, title, revision, replayed from api.rename_project($1, 1, $2, $3, 2, 'New name')`, [a.accountId, randomUUID(), id]));
      for (const answer of renames) expect(answer).toEqual({outcome: 'unavailable', project_id: null, title: null, revision: null, replayed: null});
      const listed = await svc(client, 'select outcome, total, projects from api.list_projects($1, 1, 200)', [a.accountId]);
      expect(listed.total).toBe(1);
      expect(JSON.stringify(listed)).not.toMatch(/Tombstoned plans|Foreign plans/);
      expect(Number((await client.query('select count(*) as n from projects.project_commands')).rows[0].n)).toBe(receipts);
      expect((await projectRow(client, gone)).title).toBe('Tombstoned plans');
    });
  });

  it('does not answer a replayed command of a tombstoned Project with its receipt (the Project is refused before the ledger is read)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const command = randomUUID();
      expect((await svc(client, `select outcome from api.rename_project($1, 1, $2, $3, 1, 'First')`, [a.accountId, command, id])).outcome).toBe('renamed');
      await tombstone(client, 'project', id);
      expect((await svc(client, `select outcome from api.rename_project($1, 1, $2, $3, 1, 'First')`, [a.accountId, command, id])).outcome).toBe('unavailable');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.guard_target: allowed, the existing denials, tombstoned or unavailable', () => {
  it('allows the Account\'s own live Project, and the Account itself', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      expect(await guard(client, a, 'project', id)).toEqual({outcome: 'allowed', epoch: 1});
      expect(await guard(client, a, 'account', a.accountId)).toEqual({outcome: 'allowed', epoch: 1});
    });
  });

  it('answers the one `unavailable`, with the same row, for a Project that is another Account\'s, unknown, deleted or tombstoned', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const foreign = await project(client, b);
      const deleted = await project(client, a, {deleted: true});
      const tombstoned = await project(client, a);
      await tombstone(client, 'project', tombstoned);
      const answers = [];
      for (const id of [foreign, randomUUID(), deleted, tombstoned]) answers.push(await guard(client, a, 'project', id));
      for (const answer of answers) expect(answer).toEqual({outcome: 'unavailable', epoch: 1});
      // Another Account's Account, and a tombstoned other Account, are as unavailable as an unknown one.
      await tombstone(client, 'account', b.accountId);
      expect(await guard(client, a, 'account', b.accountId)).toEqual({outcome: 'unavailable', epoch: 1});
      expect(await guard(client, a, 'account', randomUUID())).toEqual({outcome: 'unavailable', epoch: 1});
      // ... and a Project of a tombstoned Account is, for the Account that asks, still not its own.
      expect(await guard(client, a, 'project', foreign)).toEqual({outcome: 'unavailable', epoch: 1});
    });
  });

  it('asks the Account first: disabled, a stale epoch, no such Account and a tombstoned Account are answered as the operation guard answers them, for either kind', async () => {
    await inTx(async (client) => {
      const disabled = await account(client);
      const stale = await account(client);
      const gone = await account(client);
      const idOfDisabled = await project(client, disabled);
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [disabled.accountId]);
      expect(await guard(client, disabled, 'project', idOfDisabled, 2)).toEqual({outcome: 'disabled', epoch: 2});
      expect(await guard(client, stale, 'project', randomUUID(), 5)).toEqual({outcome: 'stale_epoch', epoch: 1});
      expect(await guard(client, {...stale, accountId: randomUUID()}, 'account', randomUUID())).toEqual({outcome: 'no_account', epoch: null});
      const idOfGone = await project(client, gone);
      await tombstone(client, 'account', gone.accountId);
      expect(await guard(client, gone, 'project', idOfGone, 2)).toEqual({outcome: 'tombstoned', epoch: 2});
      expect(await guard(client, gone, 'account', gone.accountId, 2)).toEqual({outcome: 'tombstoned', epoch: 2});
    });
  });

  it('discloses nothing but the outcome and the Account\'s own epoch, and reads only', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const foreign = await project(client, b, {title: 'Secret plans'});
      const answer = await svc(client, 'select * from api.guard_target($1, 1, $2, $3)', [a.accountId, 'project', foreign]);
      expect(Object.keys(answer).sort()).toEqual(['epoch', 'outcome']);
      expect(JSON.stringify(answer)).not.toContain('Secret');
      const stable = (await client.query(`select provolatile from pg_proc where oid = 'api.guard_target(uuid,bigint,text,uuid)'::regprocedure`)).rows[0].provolatile;
      expect(stable).toBe('s');
    });
  });

  it('refuses a kind that is not account or project, and null arguments, as invalid', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const params of [[a.accountId, 1, 'file', randomUUID()], [a.accountId, 1, null, randomUUID()], [a.accountId, 1, 'project', null], [a.accountId, 0, 'project', randomUUID()], [null, 1, 'project', randomUUID()]]) {
        const result = await attempt(client, 'service_role', 'select * from api.guard_target($1, $2, $3, $4)', params);
        expect(result.ok, JSON.stringify(params)).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });

  it('is executable by the service role alone', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const role of ['anon', 'authenticated']) {
        const result = await attempt(client, role, 'select * from api.guard_target($1, 1, \'account\', $1)', [a.accountId]);
        expect(result.ok, role).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('every committed change queues exactly one ledger event, in its own transaction', () => {
  it('queues one event for a disable, a re-enable and an epoch raise: {id, type, account_id, status, epoch}, in that key order', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      let since = await lastSeq(client);
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      let events = await eventsAfter(client, since);
      expect(events).toHaveLength(1);
      expect(events[0].event).toEqual({id: events[0].id, type: 'account_authority', account_id: a.accountId, status: 'disabled', epoch: 2});
      expect(Object.keys(events[0].event)).toEqual(['id', 'type', 'account_id', 'status', 'epoch']);

      since = await lastSeq(client);
      await svc(client, `select * from api.enable_account('seed:local:test', $1)`, [a.accountId]);
      events = await eventsAfter(client, since);
      expect(events).toHaveLength(1);
      expect(events[0].event).toMatchObject({type: 'account_authority', account_id: a.accountId, status: 'active', epoch: 3});

      since = await lastSeq(client);
      await svc(client, `select * from api.raise_authorization_epoch($1, 'seed:local:test')`, [a.accountId]);
      events = await eventsAfter(client, since);
      expect(events).toHaveLength(1);
      expect(events[0].event).toMatchObject({type: 'account_authority', account_id: a.accountId, status: 'active', epoch: 4});
    });
  });

  it('queues one event for an invitation consumed by registration: the invitation and the Account, never the code or its hash', async () => {
    await inTx(async (client) => {
      const user = await addUser(client);
      const hash = codeHash();
      await api(client).issue(hash, 'named', `ledger ${tag()}`);
      const invitation = (await client.query('select id from identity.invitations where code_hash = $1', [hash])).rows[0].id as string;
      const since = await lastSeq(client);
      const receipt = await api(client).register(user.id, hash);
      expect(receipt.outcome).toBe('registered');
      const events = await eventsAfter(client, since);
      expect(events).toHaveLength(1);
      expect(events[0].event).toEqual({id: events[0].id, type: 'invitation_consumed', invitation_id: invitation, account_id: receipt.account_id});
      expect(JSON.stringify(events)).not.toContain(hash);
    });
  });

  it('queues no event for a refused registration: nothing changed, so there is nothing to queue', async () => {
    await inTx(async (client) => {
      const user = await addUser(client);
      const since = await lastSeq(client);
      expect((await api(client).register(user.id, codeHash())).outcome).toBe('refused');
      expect(await eventsAfter(client, since)).toEqual([]);
    });
  });

  it('queues one event for a pre-authorization consumed: the pre-authorization and the Account, never the address', async () => {
    await inTx(async (client) => {
      const user = await addUser(client);
      const seeded = await api(client).seed(user.email, 'member');
      const since = await lastSeq(client);
      const receipt = await api(client).consume(user.id);
      expect(receipt.outcome).toBe('registered');
      const events = await eventsAfter(client, since);
      expect(events).toHaveLength(1);
      expect(events[0].event).toEqual({id: events[0].id, type: 'preauthorization_consumed', preauthorization_id: seeded.preauthorization_id, account_id: receipt.account_id});
      expect(JSON.stringify(events)).not.toContain(user.email);
    });
  });

  it('queues one event for an invitation revoked, and one for a rotation (the old code revoked; issuing the new one queues none)', async () => {
    await inTx(async (client) => {
      const hash = codeHash();
      const issued = await api(client).issue(hash, 'named', `ledger ${tag()}`);
      let since = await lastSeq(client);
      expect((await api(client).revoke({id: issued.invitation_id})).outcome).toBe('revoked');
      let events = await eventsAfter(client, since);
      expect(events).toHaveLength(1);
      expect(events[0].event).toEqual({id: events[0].id, type: 'invitation_revoked', invitation_id: issued.invitation_id});
      // Revoking again is no change.
      since = await lastSeq(client);
      expect((await api(client).revoke({id: issued.invitation_id})).outcome).toBe('already_revoked');
      expect(await eventsAfter(client, since)).toEqual([]);
      // A rotation of the general code: the current one is revoked, the new one is issued.
      const first = await api(client).issue(codeHash(), 'general', null);
      since = await lastSeq(client);
      const second = await api(client).issue(codeHash(), 'general', null, 'seed:local:test', true);
      expect(second.replaced_invitation_id).toBe(first.invitation_id);
      events = await eventsAfter(client, since);
      expect(events.map((entry) => entry.event)).toEqual([{id: events[0].id, type: 'invitation_revoked', invitation_id: first.invitation_id}]);
    });
  });

  it('queues two events for a recovery redemption (the epoch it raises and the redemption itself), and none for a refused one', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const hash = codeHash();
      const {rows: token} = await client.query(
        `insert into identity.recovery_tokens (account_id, token_hash, issued_at, expires_at) values ($1, $2, clock_timestamp(), clock_timestamp() + interval '15 minutes') returning id`,
        [admin.accountId, hash],
      );
      const fresh = await addSession(client, admin.user.id);
      let since = await lastSeq(client);
      const redeemed = await svc(client, 'select outcome, epoch::int as epoch from api.redeem_recovery($1, $2, $3, $4)', [hash, admin.user.email, admin.user.id, fresh]);
      expect(redeemed).toEqual({outcome: 'redeemed', epoch: 2});
      const events = await eventsAfter(client, since);
      // The redemption marks the token used first and then raises the epoch (api.redeem_recovery's own order), and each queues its event.
      expect(events.map((entry) => entry.event)).toEqual([
        {id: events[0].id, type: 'recovery_redeemed', recovery_id: token[0].id, account_id: admin.accountId},
        {id: events[1].id, type: 'account_authority', account_id: admin.accountId, status: 'active', epoch: 2},
      ]);
      expect(JSON.stringify(events)).not.toContain(hash);

      // The same token again is refused (`used`), and the whole attempt leaves no event.
      since = await lastSeq(client);
      expect((await svc(client, 'select outcome from api.redeem_recovery($1, $2, $3, $4)', [hash, admin.user.email, admin.user.id, fresh])).outcome).toBe('used');
      expect(await eventsAfter(client, since)).toEqual([]);
    });
  });

  it('leaves no event when a redemption is undone half way (the new session cannot be given a grant): the sub-transaction takes its events with it', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const stranger = await addUser(client);
      const foreignSession = await addSession(client, stranger.id);
      const hash = codeHash();
      await client.query(`insert into identity.recovery_tokens (account_id, token_hash, issued_at, expires_at) values ($1, $2, clock_timestamp(), clock_timestamp() + interval '15 minutes')`, [admin.accountId, hash]);
      const since = await lastSeq(client);
      expect((await svc(client, 'select outcome from api.redeem_recovery($1, $2, $3, $4)', [hash, admin.user.email, admin.user.id, foreignSession])).outcome).toBe('administrator');
      expect(await eventsAfter(client, since)).toEqual([]);
      expect(await accountRow(client, admin.accountId)).toEqual({status: 'active', epoch: 1});
    });
  });

  it('queues nothing for what is not one of these changes: a role change, a preference, a session grant, an issued invitation, a seeded or withdrawn pre-authorization, a rename, a voided token', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const sessionId = await addSession(client, a.user.id);
      const since = await lastSeq(client);
      await client.query(`update identity.accounts set role = 'administrator' where id = $1`, [a.accountId]);
      await api(client).adoptPreferences(a.accountId);
      await api(client).setPreference(a.accountId, 'theme', 'dark');
      await api(client).issueGrant(a.user.id, sessionId);
      await api(client).revokeGrants({session: sessionId});
      await api(client).issue(codeHash(), 'named', `quiet ${tag()}`);
      const email = `quiet-${tag()}@example.test`;
      await api(client).seed(email, 'member');
      await api(client).withdraw(email);
      await svc(client, `select * from api.rename_project($1, 1, $2, $3, 1, 'Quiet')`, [a.accountId, randomUUID(), id]);
      expect(await eventsAfter(client, since)).toEqual([]);
    });
  });

  it('leaves no event when the change is rolled back, in a savepoint or a whole transaction', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const since = await lastSeq(client);
      await client.query('savepoint try_disable');
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      expect(await eventsAfter(client, since)).toHaveLength(1);
      await client.query('rollback to savepoint try_disable');
      expect(await eventsAfter(client, since)).toEqual([]);
    });
    const a = await committedAccount();
    const before = await db.query('select count(*)::int as n from lifecycle.ledger_outbox');
    const other = await connect();
    await other.query('begin');
    await other.query(`select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
    await other.query('rollback');
    expect((await db.query('select count(*)::int as n from lifecycle.ledger_outbox')).rows[0].n).toBe(before.rows[0].n);
    expect((await accountRow(db, a.accountId)).status).toBe('active');
  });

  it('commits the event with the change and with nothing else: after a commit, both are there', async () => {
    const a = await committedAccount();
    const since = await lastSeq(db);
    const other = await connect();
    await other.query('begin');
    await other.query(`select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
    // Not visible to anyone else until the commit, change and event alike.
    expect(await eventsAfter(db, since)).toEqual([]);
    expect((await accountRow(db, a.accountId)).status).toBe('active');
    await other.query('commit');
    const events = await eventsAfter(db, since);
    expect(events.filter((entry) => entry.event.account_id === a.accountId)).toHaveLength(1);
    expect((await accountRow(db, a.accountId)).status).toBe('disabled');
  });

  it('holds opaque identifiers, statuses and revisions only: no event carries an address, a title, a label, a code or a hash of one', async () => {
    await inTx(async (client) => {
      const since = await lastSeq(client);
      const user = await addUser(client);
      const other = await addUser(client);
      const label = `Visible label ${tag()}`;
      const codeOne = codeHash();
      await api(client).issue(codeOne, 'named', label);
      const registered = await api(client).register(user.id, codeOne);
      expect((await api(client).seed(other.email, 'member')).created).toBe(true);
      expect((await api(client).consume(other.id)).outcome).toBe('registered');
      const id = await project(client, {user, accountId: registered.account_id, workspaceId: registered.workspace_id, epoch: 1}, {title: 'A private title'});
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [registered.account_id]);
      await tombstone(client, 'project', id);
      await tombstone(client, 'account', registered.account_id);
      // An invitation of its own, revoked by its hash: the revocation is an event too, and neither its label nor its hash may be in it.
      const secondLabel = `Revoked label ${tag()}`;
      const codeTwo = codeHash();
      await api(client).issue(codeTwo, 'named', secondLabel);
      expect((await svc(client, 'select outcome from api.revoke_invitation($1, null, $2)', ['seed:local:test', codeTwo])).outcome).toBe('revoked');
      const events = await eventsAfter(client, since);
      expect([...new Set(events.map((entry) => entry.event.type))].sort()).toEqual(['account_authority', 'invitation_consumed', 'invitation_revoked', 'preauthorization_consumed', 'tombstone']);
      const text = JSON.stringify(events);
      for (const secret of [user.email, other.email, label, secondLabel, codeOne, codeTwo, 'A private title', user.subject, other.subject]) {
        expect(text, secret).not.toContain(secret);
      }
      // Every field is an ID, a status, a kind, a revision or the tombstone's handle; nothing else.
      const allowed = new Set(['id', 'type', 'account_id', 'status', 'epoch', 'invitation_id', 'preauthorization_id', 'recovery_id', 'kind', 'target_id', 'handle', 'revision']);
      for (const entry of events) {
        expect(entry.event.id, 'the event names itself').toBe(entry.id);
        for (const [key, value] of Object.entries(entry.event)) {
          expect(allowed.has(key), `${entry.event.type}.${key}`).toBe(true);
          expect(['string', 'number'], `${entry.event.type}.${key}`).toContain(typeof value);
        }
        // Only a tombstone event carries a handle.
        expect('handle' in entry.event, String(entry.event.type)).toBe(entry.event.type === 'tombstone');
      }
      expect(events.map((entry) => entry.seq)).toEqual([...events.map((entry) => entry.seq)].sort((x, y) => x - y));
      expect(new Set(events.map((entry) => entry.id)).size).toBe(events.length);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the outbox is immutable apart from being marked relayed, once', () => {
  async function queuedEvent(client: Client) {
    const a = await account(client);
    const since = await lastSeq(client);
    await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
    return (await eventsAfter(client, since))[0];
  }

  it('marks an event relayed once: the first time it is allowed, the second and an un-marking are not', async () => {
    await inTx(async (client) => {
      const event = await queuedEvent(client);
      expect((await client.query('select relayed_at from lifecycle.ledger_outbox where id = $1', [event.id])).rows[0].relayed_at).toBeNull();
      await client.query('update lifecycle.ledger_outbox set relayed_at = clock_timestamp() where id = $1', [event.id]);
      expect((await client.query('select relayed_at from lifecycle.ledger_outbox where id = $1', [event.id])).rows[0].relayed_at).not.toBeNull();
      for (const sql of [
        'update lifecycle.ledger_outbox set relayed_at = clock_timestamp() where id = $1',
        'update lifecycle.ledger_outbox set relayed_at = null where id = $1',
      ]) {
        const result = await attempt(client, null, sql, [event.id]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
    });
  });

  it('refuses to change an event, its ID, its place or its time, to delete one or to truncate the outbox', async () => {
    await inTx(async (client) => {
      const event = await queuedEvent(client);
      for (const sql of [
        `update lifecycle.ledger_outbox set event = '{"id":"${event.id}","type":"changed"}' where id = $1`,
        `update lifecycle.ledger_outbox set id = gen_random_uuid() where id = $1`,
        `update lifecycle.ledger_outbox set created_at = created_at - interval '1 day' where id = $1`,
        `update lifecycle.ledger_outbox set created_at = created_at - interval '1 day', relayed_at = clock_timestamp() where id = $1`,
        `delete from lifecycle.ledger_outbox where id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [event.id]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      const truncate = await attempt(client, null, 'truncate lifecycle.ledger_outbox');
      expect(truncate.ok).toBe(false);
      if (!truncate.ok) expect(truncate.code).toBe('55000');
      expect((await eventsAfter(client, event.seq - 1))[0]).toEqual(event);
    });
  });

  it('refuses an event that does not name itself or has no type', async () => {
    await inTx(async (client) => {
      for (const event of [`{"id":"${randomUUID()}","type":"x"}`, `{"type":"account_authority"}`, `[]`, `{"id":"nope","type":"x"}`]) {
        const result = await attempt(client, null, `insert into lifecycle.ledger_outbox (id, event) values (gen_random_uuid(), $1)`, [event]);
        expect(result.ok, event).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the relay\'s lease and its pending count (api.claim_ledger_events, api.finish_ledger_events, api.ledger_pending)', () => {
  const claim = (client: Client, holder: string, limit = 50, lease = 30) => svc(client, 'select outcome, events from api.claim_ledger_events($1, $2, $3)', [holder, limit, lease]);
  const finish = (client: Client, holder: string, ids: string[], release = false) => svc(client, 'select marked, released from api.finish_ledger_events($1, $2, $3)', [holder, ids, release]);
  const pending = (client: Client) => svc(client, 'select pending, oldest_seconds::int as oldest_seconds from api.ledger_pending()');

  /** `count` events queued in this transaction by real changes, on top of an outbox that has been emptied of everything older. */
  async function queued(client: Client, count: number) {
    await drain(client);
    await client.query('update lifecycle.ledger_relay set holder = null, lease_expires_at = null');
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const a = await account(client);
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      ids.push(a.accountId);
    }
    return ids;
  }

  it('claims the oldest pending events in outbox order, as {id, seq, event, at}, with the event as it was written and its own time to the millisecond', async () => {
    await inTx(async (client) => {
      const accounts = await queued(client, 3);
      const holder = randomUUID();
      const claimed = await claim(client, holder);
      expect(claimed.outcome).toBe('claimed');
      expect(claimed.events).toHaveLength(3);
      expect(claimed.events.map((item: {event: {account_id: string}}) => item.event.account_id)).toEqual(accounts);
      const seqs = claimed.events.map((item: {seq: number}) => item.seq);
      expect(seqs).toEqual([...seqs].sort((x: number, y: number) => x - y));
      for (const item of claimed.events) {
        expect(Object.keys(item)).toEqual(['id', 'seq', 'event', 'at']);
        expect(item.event.id).toBe(item.id);
        expect(Object.keys(item.event)).toEqual(['id', 'type', 'account_id', 'status', 'epoch']);
        expect(item.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
      // `at` is the event's own time: the same at every claim, and the outbox's created_at to the millisecond (in UTC).
      const again = await claim(client, holder);
      expect(again.events.map((item: {at: string}) => item.at)).toEqual(claimed.events.map((item: {at: string}) => item.at));
      const {rows: times} = await client.query(`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at from lifecycle.ledger_outbox where id = $1`, [claimed.events[0].id]);
      expect(times[0].at).toBe(claimed.events[0].at);
    });
  });

  it('claims at most the limit, and what is already relayed no more', async () => {
    await inTx(async (client) => {
      await queued(client, 4);
      const holder = randomUUID();
      const first = await claim(client, holder, 2);
      expect(first.events).toHaveLength(2);
      await finish(client, holder, first.events.map((item: {id: string}) => item.id));
      const second = await claim(client, holder, 10);
      expect(second.events).toHaveLength(2);
      expect(second.events.map((item: {id: string}) => item.id)).not.toEqual(expect.arrayContaining(first.events.map((item: {id: string}) => item.id)));
    });
  });

  it('keeps the lease for its holder, answers `busy` to another holder, and renews it for the holder who asks again', async () => {
    await inTx(async (client) => {
      await queued(client, 1);
      const holder = randomUUID();
      const other = randomUUID();
      expect((await claim(client, holder)).outcome).toBe('claimed');
      expect(await claim(client, other)).toEqual({outcome: 'busy', events: []});
      expect((await claim(client, holder)).outcome).toBe('claimed');
      expect((await client.query('select holder from lifecycle.ledger_relay')).rows[0].holder).toBe(holder);
    });
  });

  it('lets the lease run out: a crashed relay\'s holder is replaced by the next', async () => {
    await inTx(async (client) => {
      await queued(client, 1);
      const crashed = randomUUID();
      const next = randomUUID();
      expect((await claim(client, crashed, 50, 5)).outcome).toBe('claimed');
      expect((await claim(client, next)).outcome).toBe('busy');
      await client.query(`update lifecycle.ledger_relay set lease_expires_at = clock_timestamp() - interval '1 second'`);
      expect((await claim(client, next)).outcome).toBe('claimed');
      expect((await client.query('select holder from lifecycle.ledger_relay')).rows[0].holder).toBe(next);
    });
  });

  it('marks events relayed once, whoever holds the lease now, and lets go of the lease only for its holder', async () => {
    await inTx(async (client) => {
      await queued(client, 2);
      const holder = randomUUID();
      const claimed = await claim(client, holder);
      const ids = claimed.events.map((item: {id: string}) => item.id);
      expect(await finish(client, randomUUID(), [ids[0]], true)).toEqual({marked: 1, released: false});
      expect((await client.query('select holder from lifecycle.ledger_relay')).rows[0].holder).toBe(holder);
      expect(await finish(client, holder, [ids[0]])).toEqual({marked: 0, released: false});
      expect(await finish(client, holder, [ids[1], randomUUID()], true)).toEqual({marked: 1, released: true});
      expect((await client.query('select holder, lease_expires_at from lifecycle.ledger_relay')).rows[0]).toEqual({holder: null, lease_expires_at: null});
      expect(await finish(client, holder, [], true)).toEqual({marked: 0, released: false});
    });
  });

  it('counts what is pending and how old the oldest is, and counts nothing once it is relayed', async () => {
    await inTx(async (client) => {
      expect(await (async () => { await drain(client); return pending(client); })()).toEqual({pending: 0, oldest_seconds: null});
      await queued(client, 3);
      expect(await pending(client)).toMatchObject({pending: 3});
      expect((await pending(client)).oldest_seconds).toBeGreaterThanOrEqual(0);
      const holder = randomUUID();
      const claimed = await claim(client, holder);
      await finish(client, holder, claimed.events.slice(0, 2).map((item: {id: string}) => item.id));
      expect(await pending(client)).toMatchObject({pending: 1});
      await finish(client, holder, claimed.events.map((item: {id: string}) => item.id), true);
      expect(await pending(client)).toEqual({pending: 0, oldest_seconds: null});
    });
  });

  it('measures the age from the oldest event\'s own time', async () => {
    await inTx(async (client) => {
      await queued(client, 1);
      // Age the event the way a stuck relay would: the outbox forbids it, so look at an event that really is old by waiting for the clock.
      await wait(1100);
      expect((await pending(client)).oldest_seconds).toBeGreaterThanOrEqual(1);
    });
  });

  it('refuses a holder, a limit, a lease or a list out of range as invalid', async () => {
    await inTx(async (client) => {
      for (const [sql, params] of [
        ['select * from api.claim_ledger_events($1, 0, 30)', [randomUUID()]],
        ['select * from api.claim_ledger_events($1, 201, 30)', [randomUUID()]],
        ['select * from api.claim_ledger_events($1, 10, 0)', [randomUUID()]],
        ['select * from api.claim_ledger_events($1, 10, 301)', [randomUUID()]],
        ['select * from api.claim_ledger_events(null, 10, 30)', []],
        ['select * from api.finish_ledger_events(null, \'{}\', false)', []],
        ['select * from api.finish_ledger_events($1, null, false)', [randomUUID()]],
        ['select * from api.finish_ledger_events($1, \'{}\', null)', [randomUUID()]],
      ] as const) {
        const result = await attempt(client, 'service_role', sql, [...params]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('22023');
      }
    });
  });

  it('keeps its one row: the lease can be neither deleted nor truncated, and there is never a second', async () => {
    await inTx(async (client) => {
      for (const sql of ['delete from lifecycle.ledger_relay', 'truncate lifecycle.ledger_relay']) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      for (const sql of ['insert into lifecycle.ledger_relay (id) values (true)', 'insert into lifecycle.ledger_relay (id) values (false)', 'update lifecycle.ledger_relay set holder = gen_random_uuid()']) {
        expect((await attempt(client, null, sql)).ok, sql).toBe(false);
      }
      expect((await client.query('select count(*)::int as n from lifecycle.ledger_relay')).rows[0].n).toBe(1);
    });
  });

  it('is executable by the service role alone', async () => {
    await inTx(async (client) => {
      for (const sql of ['select * from api.claim_ledger_events(gen_random_uuid(), 1, 5)', 'select * from api.finish_ledger_events(gen_random_uuid(), \'{}\', false)', 'select * from api.ledger_pending()']) {
        for (const role of ['anon', 'authenticated']) expect((await attempt(client, role, sql)).ok, `${role}: ${sql}`).toBe(false);
      }
    });
  });

  it('gives the lease to exactly one of two relays that claim at once (real connections), and the other is busy', async () => {
    await drain(db);
    const [first, second] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 6; round += 1) {
      await db.query('update lifecycle.ledger_relay set holder = null, lease_expires_at = null');
      const answers = await Promise.all([first, second].map((client) => client.query('select outcome from api.claim_ledger_events($1, 5, 30)', [randomUUID()])));
      expect(answers.map((answer) => answer.rows[0].outcome).sort(), `round ${round}`).toEqual(['busy', 'claimed']);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the relay against the real database and the fixture store (the typed calls, over REST)', () => {
  const instance = () => env.INSTANCE_ID;

  /** Commits `count` events of our own (a disable each) and returns the Accounts. */
  async function disableSome(count: number) {
    const made: Fixture[] = [];
    for (let index = 0; index < count; index += 1) {
      const a = await committedAccount();
      await db.query(`select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      made.push(a);
    }
    return made;
  }
  const ours = (store: ReturnType<typeof createFixtureLedgerStore>, accounts: Fixture[]) =>
    store.objects().map((object) => JSON.parse(object.body) as {sequence: number; event: Record<string, unknown>}).filter((body) => accounts.some((a) => body.event.account_id === a.accountId));

  it('appends the pending events in outbox order as a valid hash chain, leaves nothing pending, and appends nothing the second time', async () => {
    await drain(db);
    const accounts = await disableSome(3);
    const store = createFixtureLedgerStore();
    expect(await ledgerPending({env})).toMatchObject({pending: 3});
    const report = await relayLedger({store, instanceId: instance(), accounts: {env}});
    expect(report).toEqual({outcome: 'relayed', claimed: 3, appended: 3, marked: 3});
    expect(verifyChain(instance(), store.objects())).toEqual({ok: true, length: 3});
    expect(ours(store, accounts).map((body) => body.event.account_id)).toEqual(accounts.map((a) => a.accountId));
    expect(ours(store, accounts).map((body) => body.event.epoch)).toEqual([2, 2, 2]);
    expect(await ledgerPending({env})).toEqual({pending: 0, oldestSeconds: null});
    expect(await relayLedger({store, instanceId: instance(), accounts: {env}})).toEqual({outcome: 'relayed', claimed: 0, appended: 0, marked: 0});
    expect(store.size).toBe(3);
    // The lease is let go.
    expect((await db.query('select holder from lifecycle.ledger_relay')).rows[0].holder).toBeNull();
  });

  it('keeps the change in force and the event pending, counted, when the store is down, and resumes in order when it is back', async () => {
    await drain(db);
    const accounts = await disableSome(2);
    const store = createFixtureLedgerStore();
    store.setOutage(true);
    expect(await relayLedger({store, instanceId: instance(), accounts: {env}})).toEqual({outcome: 'store_unavailable', claimed: 2, appended: 0, marked: 0});
    for (const a of accounts) expect((await accountRow(db, a.accountId)).status).toBe('disabled');
    expect(await ledgerPending({env})).toMatchObject({pending: 2});
    expect((await ledgerPending({env})).oldestSeconds).toBeGreaterThanOrEqual(0);
    store.setOutage(false);
    expect(await relayLedger({store, instanceId: instance(), accounts: {env}})).toMatchObject({outcome: 'relayed', appended: 2, marked: 2});
    expect(ours(store, accounts).map((body) => body.event.account_id)).toEqual(accounts.map((a) => a.accountId));
    expect(await ledgerPending({env})).toEqual({pending: 0, oldestSeconds: null});
  });

  it('marks, and does not append again, an event a crashed run left at the store\'s head', async () => {
    await drain(db);
    const accounts = await disableSome(2);
    const store = createFixtureLedgerStore();
    // The run dies after the store accepted the first event and before it was marked.
    const failing = vi.fn(async (input: Parameters<typeof finishLedgerEvents>[0], options?: Parameters<typeof finishLedgerEvents>[1]) => {
      if (input.eventIds.length) throw new AccountsUnavailableError('The accounts database did not answer.', {retryable: true});
      return finishLedgerEvents(input, options);
    });
    await expect(relayLedger({store, instanceId: instance(), accounts: {env}, finish: failing})).rejects.toBeInstanceOf(AccountsUnavailableError);
    expect(store.size).toBe(1);
    expect(await ledgerPending({env})).toMatchObject({pending: 2});
    expect(await relayLedger({store, instanceId: instance(), accounts: {env}})).toEqual({outcome: 'relayed', claimed: 2, appended: 1, marked: 2});
    expect(store.size).toBe(2);
    expect(ours(store, accounts).map((body) => body.event.account_id)).toEqual(accounts.map((a) => a.accountId));
    expect(verifyChain(instance(), store.objects())).toEqual({ok: true, length: 2});
  });

  it('reports busy, and reads and writes nothing, for a second relay while one holds the lease; the lease runs out after a crash', async () => {
    await drain(db);
    await disableSome(1);
    const store = createFixtureLedgerStore();
    const holder = randomUUID();
    expect((await claimLedgerEvents({holder}, {env})).outcome).toBe('claimed');
    expect(await relayLedger({store, instanceId: instance(), accounts: {env}})).toEqual({outcome: 'busy', claimed: 0, appended: 0, marked: 0});
    expect(store.calls).toEqual({head: 0, putIfAbsent: 0});
    await db.query(`update lifecycle.ledger_relay set lease_expires_at = clock_timestamp() - interval '1 second'`);
    expect(await relayLedger({store, instanceId: instance(), accounts: {env}})).toMatchObject({outcome: 'relayed', appended: 1});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.lookup_status: what became of a handle, with no sign-in', () => {
  // The revision of a Project's reply is its own revision PLUS its Account's authorization epoch (the amended spec): both only rise.
  it('answers active for an Account and a Project: the Account\'s epoch, and the Project\'s own revision plus that epoch', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      await svc(client, `select * from api.rename_project($1, 1, $2, $3, 1, 'Renamed')`, [a.accountId, randomUUID(), id]);
      expect(await lookup(client, await handleOf(client, 'account', a.accountId))).toEqual({outcome: 'active', revision: 1, retry_after: null});
      // Revision 2 (renamed once) plus epoch 1.
      expect(await lookup(client, await handleOf(client, 'project', id))).toEqual({outcome: 'active', revision: 3, retry_after: null});
    });
  });

  it('answers disabled for a disabled Account, with the raised epoch, and for its Projects (their revision plus that epoch), and active again, higher, after the re-enable', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const handles = {account: await handleOf(client, 'account', a.accountId), project: await handleOf(client, 'project', id)};
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      expect(await lookup(client, handles.account)).toEqual({outcome: 'disabled', revision: 2, retry_after: null});
      // Revision 1 plus epoch 2.
      expect(await lookup(client, handles.project)).toEqual({outcome: 'disabled', revision: 3, retry_after: null});
      await svc(client, `select * from api.enable_account('seed:local:test', $1)`, [a.accountId]);
      expect(await lookup(client, handles.account)).toEqual({outcome: 'active', revision: 3, retry_after: null});
      // Revision 1 plus epoch 3: higher than the disabled reply's 3, so a device lifts it.
      expect(await lookup(client, handles.project)).toEqual({outcome: 'active', revision: 4, retry_after: null});
    });
  });

  it('lets a device see a Project active again after its Account is disabled and enabled: the replies, merged in the order they come, end active', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const handles = {account: await handleOf(client, 'account', a.accountId), project: await handleOf(client, 'project', id)};
      const ask = async (handle: string): Promise<StatusReply> => {
        const answer = await lookup(client, handle);
        return {state: answer.outcome, revision: answer.revision};
      };
      let accountKnown: StatusReply | null = null;
      let projectKnown: StatusReply | null = null;
      const hear = async () => {
        accountKnown = mergeStatus(accountKnown, await ask(handles.account));
        projectKnown = mergeStatus(projectKnown, await ask(handles.project));
      };
      await hear();
      expect([accountKnown, projectKnown]).toEqual([{state: 'active', revision: 1}, {state: 'active', revision: 2}]);

      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      await hear();
      expect([accountKnown, projectKnown]).toEqual([{state: 'disabled', revision: 2}, {state: 'disabled', revision: 3}]);

      await svc(client, `select * from api.enable_account('seed:local:test', $1)`, [a.accountId]);
      await hear();
      // The Account is active under a newer epoch, and so is the Project: it is not stuck at `disabled`.
      expect([accountKnown, projectKnown]).toEqual([{state: 'active', revision: 3}, {state: 'active', revision: 4}]);

      // The same replies heard late and out of order cannot lock it again: a stale `disabled` (revision 3) is below what is known.
      expect(mergeStatus(projectKnown, {state: 'disabled', revision: 3})).toEqual({state: 'active', revision: 4});
    });
  });

  it('raises a Project\'s reply revision strictly with every disable, every re-enable and every rename, and never repeats a number across them', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const handle = await handleOf(client, 'project', id);
      let epoch = 1;
      let revision = 1;
      const seen: {step: string; state: string; revision: number}[] = [];
      const note = async (step: string) => {
        const answer = await lookup(client, handle);
        seen.push({step, state: answer.outcome, revision: answer.revision});
      };
      const rename = async (title: string) => {
        const renamed = await svc(client, 'select outcome, revision::int as revision from api.rename_project($1, $2, $3, $4, $5, $6)', [a.accountId, epoch, randomUUID(), id, revision, title]);
        expect(renamed.outcome).toBe('renamed');
        revision = renamed.revision;
      };
      await note('opened');
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      epoch += 1;
      await note('disabled');
      await svc(client, `select * from api.enable_account('seed:local:test', $1)`, [a.accountId]);
      epoch += 1;
      await note('enabled');
      await rename('Renamed once');
      await note('renamed');
      await svc(client, `select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
      epoch += 1;
      await note('disabled again');
      await svc(client, `select * from api.enable_account('seed:local:test', $1)`, [a.accountId]);
      epoch += 1;
      await note('enabled again');
      await rename('Renamed twice');
      await note('renamed again');
      expect(seen.map((entry) => entry.state)).toEqual(['active', 'disabled', 'active', 'active', 'disabled', 'active', 'active']);
      expect(seen.map((entry) => entry.revision)).toEqual([2, 3, 4, 5, 6, 7, 8]);
      for (let index = 1; index < seen.length; index += 1) expect(seen[index].revision, `${seen[index].step} is above ${seen[index - 1].step}`).toBeGreaterThan(seen[index - 1].revision);
      // ... and the number is always the Project's revision plus the Account's epoch.
      expect(seen[seen.length - 1].revision).toBe(revision + epoch);
    });
  });

  it('answers deleted from the tombstone, with the revision it was recorded at (not the Project\'s revision plus its epoch: deleted is terminal), for an Account and a Project', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const handles = {account: await handleOf(client, 'account', a.accountId), project: await handleOf(client, 'project', id)};
      await tombstone(client, 'project', id);
      await tombstone(client, 'account', a.accountId);
      expect(await lookup(client, handles.project)).toEqual({outcome: 'deleted', revision: 2, retry_after: null});
      expect(await lookup(client, handles.account)).toEqual({outcome: 'deleted', revision: 2, retry_after: null});
    });
  });

  it('answers deleted for a hidden Project that has no tombstone (hidden is not shown as active)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {deleted: true});
      // Not a tombstone's number (it has none): the Project's revision 1 plus its Account's epoch 1.
      expect(await lookup(client, await handleOf(client, 'project', id))).toMatchObject({outcome: 'deleted', revision: 2});
    });
  });

  it('keeps answering deleted after the Account, its Workspace and its Auth user are gone: the tombstone is enough, and no session is asked for', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const handles = [await handleOf(client, 'account', a.accountId), await handleOf(client, 'project', id)];
      await tombstone(client, 'project', id);
      await tombstone(client, 'account', a.accountId);
      // The purge of Epic 8, by hand: everything but the tombstones.
      await client.query('delete from projects.projects where account_id = $1', [a.accountId]);
      await client.query('delete from projects.workspaces where account_id = $1', [a.accountId]);
      await client.query('delete from identity.accounts where id = $1', [a.accountId]);
      await client.query('delete from auth.users where id = $1', [a.user.id]);
      for (const handle of handles) expect(await lookup(client, handle)).toEqual({outcome: 'deleted', revision: 2, retry_after: null});
      // The call takes no user, no session and no Account: only a handle and an origin.
      const args = (await client.query(`select pg_get_function_arguments('api.lookup_status(text,text)'::regprocedure) as args`)).rows[0].args;
      expect(args).toBe('p_handle text, p_origin_hash text');
    });
  });

  it('answers unknown for a handle no row holds, and nothing else about it', async () => {
    await inTx(async (client) => {
      const answer = await lookup(client, randomBytes(16).toString('hex'));
      expect(answer).toEqual({outcome: 'unknown', revision: null, retry_after: null});
    });
  });

  it('answers a state and a revision and nothing else: no ID, no handle, no Account', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const handle = await handleOf(client, 'account', a.accountId);
      const answer = await svc(client, 'select * from api.lookup_status($1, $2)', [handle, originHash()]);
      expect(Object.keys(answer).sort()).toEqual(['outcome', 'retry_after', 'revision']);
      expect(JSON.stringify(answer)).not.toContain(handle);
      expect(JSON.stringify(answer)).not.toContain(a.accountId);
    });
  });

  it('refuses a handle that is not 32 lower-case hexadecimal characters and an origin that is not a hash, as invalid', async () => {
    await inTx(async (client) => {
      const handle = randomBytes(16).toString('hex');
      for (const params of [[handle.toUpperCase(), originHash()], [handle.slice(1), originHash()], [`${handle}0`, originHash()], ['g'.repeat(32), originHash()], [null, originHash()], [handle, 'origin'], [handle, null], [handle, originHash().toUpperCase()]]) {
        const result = await attempt(client, 'service_role', 'select * from api.lookup_status($1, $2)', params);
        expect(result.ok, JSON.stringify(params)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(params)).toBe('22023');
      }
    });
  });

  it('is executable by the service role alone', async () => {
    await inTx(async (client) => {
      for (const role of ['anon', 'authenticated']) {
        const result = await attempt(client, role, 'select * from api.lookup_status($1, $2)', ['0'.repeat(32), originHash()]);
        expect(result.ok, role).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the status lookup counts every request first, and limits an origin and everyone', () => {
  const windowOf = async (client: Client) => Number((await client.query('select floor(extract(epoch from clock_timestamp()) / 60)::bigint as w')).rows[0].w);
  const counter = async (client: Client, scope: 'origin' | 'global', origin: string, window: number) =>
    Number((await client.query('select coalesce(sum(requests), 0)::int as n from lifecycle.status_requests where scope = $1 and key_hash = $2 and window_id = $3', [scope, scope === 'global' ? 'global' : origin, window])).rows[0].n);

  /** Runs `work` in a transaction, again if the minute turned over while it ran (a counter is per minute). */
  async function inOneMinute(work: (client: Client, window: number) => Promise<void>) {
    for (let tries = 0; tries < 3; tries += 1) {
      let finished = false;
      let sameMinute = true;
      await inTx(async (client) => {
        const window = await windowOf(client);
        await work(client, window);
        sameMinute = (await windowOf(client)) === window;
        finished = true;
      }).catch((error) => {
        if (sameMinute) throw error;
      });
      if (finished && sameMinute) return;
      await wait(1000);
    }
    throw new Error('The minute kept turning over during the case.');
  }

  it('answers 120 requests from one origin in a minute and limits the 121st, with the seconds left, looking nothing up', async () => {
    await inOneMinute(async (client, window) => {
      const a = await account(client);
      const handle = await handleOf(client, 'account', a.accountId);
      const origin = originHash();
      for (let index = 0; index < 120; index += 1) expect((await lookup(client, handle, origin)).outcome, `request ${index + 1}`).toBe('active');
      const limited = await lookup(client, handle, origin);
      expect(limited.outcome).toBe('limited');
      expect(limited.retry_after).toBeGreaterThanOrEqual(1);
      expect(limited.retry_after).toBeLessThanOrEqual(60);
      expect(limited.revision).toBeNull();
      // Every request is counted, the limited one included, and a limited origin stays limited for the rest of the minute.
      expect(await counter(client, 'origin', origin, window)).toBe(121);
      expect((await lookup(client, handle, origin)).outcome).toBe('limited');
      expect(await counter(client, 'origin', origin, window)).toBe(122);
      // Another origin has a budget of its own.
      expect((await lookup(client, handle, originHash())).outcome).toBe('active');
    });
  });

  it('counts a request for a handle nobody holds exactly like any other (guessing is what the limit is for)', async () => {
    await inOneMinute(async (client, window) => {
      const origin = originHash();
      for (let index = 0; index < 120; index += 1) expect((await lookup(client, randomBytes(16).toString('hex'), origin)).outcome).toBe('unknown');
      expect((await lookup(client, randomBytes(16).toString('hex'), origin)).outcome).toBe('limited');
      expect(await counter(client, 'origin', origin, window)).toBe(121);
    });
  });

  it('limits everyone together at 1,200 a minute: the 1,200th request still answers, the 1,201st is limited whoever sends it', async () => {
    await inOneMinute(async (client, window) => {
      const a = await account(client);
      const handle = await handleOf(client, 'account', a.accountId);
      await client.query(
        `insert into lifecycle.status_requests (scope, key_hash, window_id, requests, expires_at) values ('global', 'global', $1::bigint, 1198, to_timestamp(($1::bigint + 2) * 60))
         on conflict (scope, key_hash, window_id) do update set requests = 1198`,
        [window],
      );
      expect((await lookup(client, handle)).outcome).toBe('active');
      expect((await lookup(client, handle)).outcome).toBe('active');
      expect(await counter(client, 'global', '', window)).toBe(1200);
      const limited = await lookup(client, handle);
      expect(limited).toMatchObject({outcome: 'limited', revision: null});
      expect(limited.retry_after).toBeGreaterThanOrEqual(1);
      expect(await counter(client, 'global', '', window)).toBe(1201);
    });
  });

  it('starts a new count each minute, and drops windows that have expired, a few at a time', async () => {
    await inTx(async (client) => {
      const old = originHash();
      await client.query(`insert into lifecycle.status_requests (scope, key_hash, window_id, requests, expires_at) values ('origin', $1, 1, 999, clock_timestamp() - interval '1 hour')`, [old]);
      expect((await lookup(client, '0'.repeat(32))).outcome).toBe('unknown');
      expect((await client.query('select count(*)::int as n from lifecycle.status_requests where key_hash = $1', [old])).rows[0].n).toBe(0);
      // A count from another minute does not carry over to this one.
      const origin = originHash();
      await client.query(`insert into lifecycle.status_requests (scope, key_hash, window_id, requests, expires_at) values ('origin', $1, 1, 999, clock_timestamp() + interval '1 hour')`, [origin]);
      expect((await lookup(client, '0'.repeat(32), origin)).outcome).toBe('unknown');
    });
  });

  it('counts without a miss when many connections ask at once (real connections): ten requests, a count of ten', async () => {
    const origin = originHash();
    const clients = await Promise.all(Array.from({length: 10}, () => connect()));
    try {
      await Promise.all(clients.map((client) => client.query('select * from api.lookup_status($1, $2)', ['0'.repeat(32), origin])));
      expect(Number((await db.query('select coalesce(sum(requests), 0)::int as n from lifecycle.status_requests where scope = \'origin\' and key_hash = $1', [origin])).rows[0].n)).toBe(10);
    } finally {
      await db.query('delete from lifecycle.status_requests where key_hash = $1', [origin]);
    }
  });

  it('keeps an origin as a keyed hash: the table has no column for an address', async () => {
    const {rows} = await db.query(`select column_name from information_schema.columns where table_schema = 'lifecycle' and table_name = 'status_requests' order by ordinal_position`);
    expect(rows.map((row) => row.column_name)).toEqual(['scope', 'key_hash', 'window_id', 'requests', 'expires_at']);
    await inTx(async (client) => {
      const refused = await attempt(client, null, `insert into lifecycle.status_requests (scope, key_hash, window_id, requests, expires_at) values ('origin', '203.0.113.9', 1, 1, now())`);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('23514');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('no function returns a status handle but the tombstone\'s ledger event, and a lookup receives one', () => {
  it('lets a handle out of the database in one place: the claimed tombstone event (as hex), and nowhere in any other answer', async () => {
    await inTx(async (client) => {
      await drain(client);
      const a = await account(client);
      const id = await project(client, a);
      const handles = [await handleOf(client, 'account', a.accountId), await handleOf(client, 'project', id)];
      const raw = [(await client.query('select status_handle as raw from identity.accounts where id = $1', [a.accountId])).rows[0].raw as Buffer, (await client.query('select status_handle as raw from projects.projects where id = $1', [id])).rows[0].raw as Buffer];
      const spellings = (handle: string, buffer: Buffer) => [handle.toUpperCase(), `\\x${handle}`, buffer.toString('base64'), buffer.toString('base64url'), [...buffer].join(','), buffer.toString('latin1')];
      const answers: string[] = [];
      // Everything a caller can ask about these targets, before and after the tombstones.
      const everything = async () => {
        const session = await addSession(client, a.user.id);
        answers.push(JSON.stringify(await guardOp(client, a)));
        answers.push(JSON.stringify(await guard(client, a, 'project', id)));
        answers.push(JSON.stringify(await guard(client, a, 'account', a.accountId)));
        answers.push(JSON.stringify(await svc(client, 'select * from api.list_projects($1, $2, 10)', [a.accountId, (await accountRow(client, a.accountId)).epoch])));
        answers.push(JSON.stringify(await svc(client, 'select * from api.get_project($1, $2, $3)', [a.accountId, (await accountRow(client, a.accountId)).epoch, id])));
        answers.push(JSON.stringify(await api(client).authorize(a.user.id, session)));
        answers.push(JSON.stringify(await svc(client, 'select * from api.ledger_pending()')));
        answers.push(JSON.stringify(await svc(client, 'select * from api.list_accounts() where account_id = $1', [a.accountId])));
        answers.push(JSON.stringify(await api(client).preflight()));
        for (const handle of handles) answers.push(JSON.stringify(await lookup(client, handle)));
      };
      await everything();
      answers.push(JSON.stringify(await tombstone(client, 'project', id)), JSON.stringify(await tombstone(client, 'account', a.accountId)), JSON.stringify(await tombstone(client, 'account', a.accountId)));
      await everything();
      for (const text of answers) {
        handles.forEach((handle, index) => {
          for (const spelling of [handle, ...spellings(handle, raw[index])]) expect(text.includes(spelling), `${spelling.slice(0, 12)} in ${text.slice(0, 80)}`).toBe(false);
        });
      }
      // The claim is where it leaves: the tombstone events carry the hex handle, and nothing else it returns does.
      const claimed = await svc(client, 'select events from api.claim_ledger_events($1, 50, 30)', [randomUUID()]);
      const carrying = claimed.events.filter((item: {event: Record<string, unknown>}) => JSON.stringify(item).includes('handle'));
      expect(carrying.map((item: {event: {type: string}}) => item.event.type)).toEqual(['tombstone', 'tombstone']);
      expect(carrying.map((item: {event: {handle: string}}) => item.event.handle).sort()).toEqual([...handles].sort());
      for (const item of claimed.events.filter((entry: {event: {type: string}}) => entry.event.type !== 'tombstone')) {
        for (const handle of handles) expect(JSON.stringify(item).includes(handle)).toBe(false);
      }
    });
  });

  it('names the column only in the guards that keep it unchanged, the preflight, the tombstone writer and its event, and the lookup, and in no composite type', async () => {
    const {rows: types} = await db.query(
      `select t.typname, a.attname from pg_type t join pg_class c on c.oid = t.typrelid join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
        where t.typnamespace = 'api'::regnamespace and a.attname ilike '%handle%'`,
    );
    expect(types).toEqual([]);
    const {rows: functions} = await db.query(`select p.proname as name from pg_proc p where p.pronamespace in ('api'::regnamespace, 'lifecycle'::regnamespace, 'identity'::regnamespace, 'projects'::regnamespace) and pg_get_functiondef(p.oid) ~ 'status_handle' order by 1`);
    expect(functions.map((row) => row.name)).toEqual(['guard_account', 'guard_project', 'lookup_status', 'preflight', 'queue_tombstone', 'record_tombstone']);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the new tables and functions are closed to every role but the service role, over REST and over the wire', () => {
  const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  function authenticatedToken() {
    const claims = {iss: `${stack.apiUrl}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: randomUUID(), session_id: randomUUID(), exp: Math.floor(Date.now() / 1000) + 600};
    const unsigned = `${base64url({alg: 'HS256', typ: 'JWT'})}.${base64url(claims)}`;
    return `${unsigned}.${createHmac('sha256', jwtSecretOf(stack)).update(unsigned).digest('base64url')}`;
  }
  const rest = (token: string, path: string, init: RequestInit & {profile?: string} = {}) =>
    fetch(`${stack.apiUrl}/rest/v1/${path}`, {
      ...init,
      headers: {apikey: stack.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.profile ? {'accept-profile': init.profile, 'content-profile': init.profile} : {}), ...init.headers},
    });

  it('refuses every read, write and delete of the four tables to anon, authenticated and the service role: a permission error, and no row', async () => {
    const a = await committedAccount();
    await db.query('select * from api.record_tombstone($1, $2)', ['account', a.accountId]);
    for (const token of [stack.anonKey, authenticatedToken(), stack.serviceKey]) {
      for (const table of ['tombstones', 'ledger_outbox', 'ledger_relay', 'status_requests']) {
        const read = await rest(token, `${table}?select=*`, {profile: 'lifecycle'});
        const text = await read.text();
        expect([401, 403], `${table} read ${read.status}`).toContain(read.status);
        expect(JSON.parse(text).code, table).toBe('42501');
        expect(text).not.toContain(a.accountId);
        // A filter on a real column, because PostgREST refuses an unfiltered update or delete before the database is asked.
        const filter = {tombstones: 'kind=eq.account', ledger_outbox: 'seq=eq.1', ledger_relay: 'id=eq.true', status_requests: 'scope=eq.origin'}[table];
        for (const [method, path, body] of [['POST', table, '{}'], ['DELETE', `${table}?${filter}`, undefined], ['PATCH', `${table}?${filter}`, '{}']] as const) {
          const write = await rest(token, path, {method, profile: 'lifecycle', body});
          expect([401, 403], `${method} ${table}`).toContain(write.status);
        }
      }
    }
    expect(await tombstoneRow(db, 'account', a.accountId)).toBeDefined();
  });

  it('does not publish the new tables in what the API lists to a browser role', async () => {
    for (const token of [stack.anonKey, authenticatedToken()]) {
      const response = await rest(token, '', {profile: 'lifecycle', headers: {accept: 'application/openapi+json'}});
      const text = await response.text();
      for (const name of ['tombstones', 'ledger_outbox', 'ledger_relay', 'status_requests']) expect(text, name).not.toContain(`"/${name}"`);
    }
  });

  it('does not let anyone call the helpers of the lifecycle schema as a function over REST', async () => {
    for (const token of [stack.anonKey, authenticatedToken(), stack.serviceKey]) {
      for (const name of ['assert_not_tombstoned', 'is_tombstoned', 'append_event']) {
        const response = await rest(token, `rpc/${name}`, {method: 'POST', profile: 'lifecycle', body: JSON.stringify({p_kind: 'account', p_target_id: randomUUID(), p_event: {}})});
        expect(response.status, name).toBeGreaterThanOrEqual(400);
        expect(response.status, name).toBeLessThan(500);
      }
    }
  });

  it('refuses the six functions to the anon key and an authenticated token with a permission error, the service role being the one that may', async () => {
    const bodies: Record<string, unknown> = {
      record_tombstone: {p_kind: 'account', p_target_id: randomUUID()},
      guard_target: {p_account_id: randomUUID(), p_epoch: 1, p_kind: 'project', p_target_id: randomUUID()},
      lookup_status: {p_handle: '0'.repeat(32), p_origin_hash: originHash()},
      claim_ledger_events: {p_holder: randomUUID(), p_limit: 1, p_lease_seconds: 5},
      finish_ledger_events: {p_holder: randomUUID(), p_event_ids: [], p_release: true},
      ledger_pending: {},
    };
    for (const token of [stack.anonKey, authenticatedToken()]) {
      for (const [name, body] of Object.entries(bodies)) {
        const response = await rest(token, `rpc/${name}`, {method: 'POST', profile: 'api', body: JSON.stringify(body)});
        expect([401, 403], name).toContain(response.status);
        expect((await response.json()).code, name).toBe('42501');
      }
    }
    for (const [name, body] of Object.entries(bodies).filter(([name]) => !['record_tombstone', 'claim_ledger_events'].includes(name))) {
      const response = await rest(stack.serviceKey, `rpc/${name}`, {method: 'POST', profile: 'api', body: JSON.stringify(body)});
      expect(response.status, name).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries every earlier probe and the new ones', () => {
  it('answers ok to the service role', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
    });
  });

  it('reads the new tables and the Account\'s handle, and still reads the old ones', async () => {
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [
      'identity.session_grants', 'identity.accounts', 'a.status_handle', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
      'delete on auth.sessions', 'api.list_accounts()', 'api.issue_recovery(text,text)', 'api.rename_project(uuid,bigint,uuid,uuid,bigint,text)',
      'api.record_tombstone(text,uuid)', 'api.guard_target(uuid,bigint,text,uuid)', 'api.claim_ledger_events(uuid,integer,integer)', 'api.finish_ledger_events(uuid,uuid[],boolean)', 'api.ledger_pending()', 'api.lookup_status(text,text)', 'lifecycle.assert_not_tombstoned(text,uuid)',
    ]) expect(definition, needle).toContain(needle);
  });

  it.each(['api.record_tombstone(text, uuid)', 'api.guard_target(uuid, bigint, text, uuid)', 'api.claim_ledger_events(uuid, integer, integer)', 'api.finish_ledger_events(uuid, uuid[], boolean)', 'api.ledger_pending()', 'api.lookup_status(text, text)', 'lifecycle.assert_not_tombstoned(text, uuid)'])(
    'fails the build with one line naming %s when it is missing',
    async (signature) => {
      await inTx(async (client) => {
        await client.query(`drop function ${signature}`);
        const result = await attempt(client, 'service_role', 'select * from api.preflight()');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('N3020');
          expect(result.message).toContain('Story 1.8');
          expect(result.message).toContain(signature.replace(/, /g, ','));
        }
      });
    },
  );

  it('fails when the service role cannot execute one of the new functions', async () => {
    await inTx(async (client) => {
      await client.query('revoke execute on function api.lookup_status(text, text) from service_role');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('api.lookup_status(text,text)');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls against the real stack: a committed Account and Project, hidden first, then unreachable to every guard', () => {
  it('guards a Project and an Account before and after their tombstones, through lib/authority.ts, lib/projects.ts and lib/project-target.ts', async () => {
    const a = await committedAccount();
    const id = await project(db, a, {title: 'Typed calls'});
    const operation = operationOf({accountId: a.accountId, epoch: 1});
    const options = {env, log: () => undefined};

    expect(await authorizeStep(operation, options)).toEqual({allowed: true, epoch: 1});
    expect(await authorizeTarget(operation, {kind: 'project', id}, options)).toEqual({allowed: true, epoch: 1});
    expect(await guardTarget({accountId: a.accountId, epoch: 1, kind: 'project', id}, {env})).toEqual({outcome: 'allowed', epoch: 1});
    expect(await resolveProjectTarget(operation, id, options)).toMatchObject({outcome: 'resolved', projectId: id});

    // The Project's tombstone: unavailable to every guard, and nothing of it is read.
    expect(await recordTombstone({kind: 'project', id}, {env})).toEqual({outcome: 'recorded', kind: 'project', targetId: id, revision: 2});
    expect(await recordTombstone({kind: 'project', id}, {env})).toEqual({outcome: 'exists', kind: 'project', targetId: id, revision: 2});
    expect(await authorizeTarget(operation, {kind: 'project', id}, options)).toEqual({allowed: false, reason: 'unavailable'});
    expect(await authorizeTarget(operation, {kind: 'project', id: randomUUID()}, options)).toEqual({allowed: false, reason: 'unavailable'});
    expect(await resolveProjectTarget(operation, id, options)).toEqual({outcome: 'unavailable'});
    expect(await readProject(operation, id, {env})).toEqual({outcome: 'unavailable'});
    expect(await authorizeStep(operation, options)).toEqual({allowed: true, epoch: 1});

    // The Account's: tombstoned to every guard, and an operation registered under the old epoch stays denied.
    expect(await recordTombstone({kind: 'account', id: a.accountId}, {env})).toEqual({outcome: 'recorded', kind: 'account', targetId: a.accountId, revision: 2});
    expect(await authorizeStep(operation, options)).toEqual({allowed: false, reason: 'tombstoned'});
    expect(await authorizeStep({accountId: a.accountId, epoch: 2}, options)).toEqual({allowed: false, reason: 'tombstoned'});
    expect(await authorizeTarget(operation, {kind: 'account', id: a.accountId}, options)).toEqual({allowed: false, reason: 'tombstoned'});
    expect(await resolveProjectTarget(operation, id, options)).toEqual({outcome: 'denied'});
  });

  it('looks a handle up as the route does, and a merge of the replies keeps a deletion', async () => {
    const a = await committedAccount();
    const handle = await handleOf(db, 'account', a.accountId);
    const first = await lookupStatus({handle, clientAddress: `198.51.100.${Math.floor(Math.random() * 250) + 1}`}, {env});
    expect(first).toEqual({outcome: 'found', state: 'active', revision: 1});
    await db.query(`select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
    const second = await lookupStatus({handle, clientAddress: null}, {env});
    expect(second).toEqual({outcome: 'found', state: 'disabled', revision: 2});
    await recordTombstone({kind: 'account', id: a.accountId}, {env});
    const third = await lookupStatus({handle, clientAddress: null}, {env});
    expect(third).toEqual({outcome: 'found', state: 'deleted', revision: 3});
    // A late, stale `active` reply cannot undo any of it.
    let known: StatusReply | null = null;
    for (const reply of [third, first, second]) if (reply.outcome === 'found') known = mergeStatus(known, {state: reply.state, revision: reply.revision});
    expect(known).toEqual({state: 'deleted', revision: 3});
    expect(await lookupStatus({handle: randomBytes(16).toString('hex'), clientAddress: null}, {env})).toEqual({outcome: 'unknown'});
  });

  it('claims, marks and counts through the typed calls', async () => {
    await drain(db);
    const a = await committedAccount();
    await db.query(`select * from api.disable_account('seed:local:test', $1)`, [a.accountId]);
    const holder = randomUUID();
    const claimed = await claimLedgerEvents({holder, limit: 10}, {env});
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;
    expect(claimed.events.map((item) => item.event.account_id)).toEqual([a.accountId]);
    expect(await ledgerPending({env})).toMatchObject({pending: 1});
    expect(await finishLedgerEvents({holder, eventIds: claimed.events.map((item) => item.id), release: true}, {env})).toEqual({marked: 1, released: true});
    expect(await ledgerPending({env})).toEqual({pending: 0, oldestSeconds: null});
  });
});
