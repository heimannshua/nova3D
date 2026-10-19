import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {listProjects, readProject, renameProjectCommand} from '@/lib/projects';
import {resolveProjectTarget} from '@/lib/project-target';
import {projectStages} from '@/lib/project-stage';
import {createHarness, stack} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 1.7 against the Supabase CLI stack: the Project record, its ledger of commands, and the three functions behind My Projects and
// the Project overview. Most cases run inside a transaction that is rolled back, as the service role. The cases that need several real
// connections (two windows renaming at once, one command sent twice at once, a disable racing a rename) and the typed calls over REST as
// the application makes them commit data that is removed afterwards (tests/support/accounts-data.ts clears Projects and commands first).

const {db, connect, committed, inTx, addUser, attempt, rows, api} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; epoch: number};

/** An Account with its Workspace, made the way registration makes one (identity.activate_account). */
async function account(client: Client): Promise<Fixture> {
  const user = await addUser(client);
  const { rows: made } = await client.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject]);
  const accountId = made[0].id as string;
  const { rows: workspace } = await client.query('select id from projects.workspaces where account_id = $1', [accountId]);
  return {user, accountId, workspaceId: workspace[0].id as string, epoch: 1};
}

async function committedAccount(): Promise<Fixture> {
  const made = await account(db);
  committed.users.push(made.user.id);
  return made;
}

type NewProject = {title?: string; stage?: string; version?: number; updatedAt?: string; deleted?: boolean};
/** A Project, inserted directly (the owner can; nothing in the application creates one until Story 2.1). */
async function project(client: Client, owner: Fixture, options: NewProject = {}): Promise<string> {
  const { rows: made } = await client.query(
    `insert into projects.projects (workspace_id, account_id, title, stage, current_version, updated_at, deleted_at)
     values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), case when $7 then now() end) returning id`,
    [owner.workspaceId, owner.accountId, options.title ?? 'Courtyard bench', options.stage ?? 'researching', options.version ?? 0, options.updatedAt ?? null, options.deleted === true],
  );
  return made[0].id as string;
}

/** One call on a connection of its own (outside a transaction, so no savepoint): the functions run as their owner either way. */
const call = async (client: Client, sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0];
const asService = async (client: Client, sql: string, params: unknown[]) => (await rows(client, 'service_role', sql, params))[0];
const list = (client: Client, who: Fixture, limit = 200, epoch = who.epoch) => asService(client, 'select * from api.list_projects($1, $2, $3)', [who.accountId, epoch, limit]);
const get = (client: Client, who: Fixture, projectId: string, epoch = who.epoch) => asService(client, 'select * from api.get_project($1, $2, $3)', [who.accountId, epoch, projectId]);
const rename = (client: Client, who: Fixture, input: {projectId: string; title: string; expected?: number; command?: string; epoch?: number}) =>
  asService(client, 'select * from api.rename_project($1, $2, $3, $4, $5, $6)', [who.accountId, input.epoch ?? who.epoch, input.command ?? randomUUID(), input.projectId, input.expected ?? 1, input.title]);
const stored = async (client: Client, projectId: string) =>
  (await client.query('select title, stage, current_version, revision::int as revision, updated_at, deleted_at from projects.projects where id = $1', [projectId])).rows[0] as {
    title: string;
    stage: string;
    current_version: number;
    revision: number;
    updated_at: Date;
    deleted_at: Date | null;
  };
const ledger = async (client: Client, accountId: string) =>
  (await client.query('select command_id, project_id, command, payload_hash, expected_revision::int as expected_revision, title, revision::int as revision from projects.project_commands where account_id = $1 order by created_at, command_id', [accountId])).rows;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until the backend is blocked on a lock, so a test knows the other connection really is waiting for it. */
async function untilBlocked(pid: number) {
  for (let attemptNumber = 0; attemptNumber < 100; attemptNumber += 1) {
    const { rows: found } = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await wait(50);
  }
  throw new Error('The other connection never started waiting for the lock.');
}

// ---------------------------------------------------------------------------------------------------
describe('the record: a Project belongs to one Workspace and Account, and only the commands change it', () => {
  it('starts at revision 1 and Version 0, with a random 128-bit status handle that is unique and exactly 16 bytes', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const first = await project(client, a);
      const second = await project(client, a, {title: 'Garden arch study'});
      const found = (await client.query('select id, revision::int as revision, current_version, octet_length(status_handle) as bytes, encode(status_handle, \'hex\') as handle, deleted_at from projects.projects where account_id = $1 order by title', [a.accountId])).rows;
      expect(found).toHaveLength(2);
      for (const row of found) expect(row).toMatchObject({revision: 1, current_version: 0, bytes: 16, deleted_at: null});
      expect(new Set(found.map((row) => row.handle)).size).toBe(2);
      expect([first, second].sort()).toEqual(found.map((row) => row.id).sort());
      // Not the all-zero handle, and not derived from the ID.
      for (const row of found) expect(row.handle).not.toBe('0'.repeat(32));
    });
  });

  it('knows exactly the eight stages (Story 2.1 added request_confirmed to Story 1.7\'s six, Story 2.2 request_draft), and refuses any other', async () => {
    expect([...projectStages]).toHaveLength(8);
    await inTx(async (client) => {
      const a = await account(client);
      for (const stage of projectStages) await project(client, a, {title: `In ${stage}`, stage});
      for (const stage of ['draft', 'Researching', '', 'export-ready']) {
        const result = await attempt(client, null, `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'x', $3)`, [a.workspaceId, a.accountId, stage]);
        expect(result.ok, stage).toBe(false);
        if (!result.ok) expect(result.code, stage).toBe('23514');
      }
    });
  });

  it('refuses a title that is blank, padded, over 120 characters or holds a control character, and accepts one of 120 characters in any script', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const title of ['', ' ', ' padded', 'padded ', 'x'.repeat(121), 'tab\there', 'line\nbreak', 'bell\u0007', 'c1\u0085control', 'del\u007f']) {
        const result = await attempt(client, null, `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, $3, 'researching')`, [a.workspaceId, a.accountId, title]);
        expect(result.ok, JSON.stringify(title)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(title)).toBe('23514');
      }
      for (const title of ['x'.repeat(120), 'ש'.repeat(120), '😀'.repeat(120), 'Garden arch study', 'המזבח החיצון והכבש']) {
        expect((await attempt(client, null, `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, $3, 'researching')`, [a.workspaceId, a.accountId, title])).ok, title.slice(0, 12)).toBe(true);
      }
    });
  });

  it('is tied to its Workspace and Account by a composite foreign key: a Project cannot point at another Account\'s Workspace', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const projectA = await project(client, a);
      const crossed = await attempt(client, null, `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'x', 'researching')`, [a.workspaceId, b.accountId]);
      expect(crossed.ok).toBe(false);
      if (!crossed.ok) expect(crossed.code).toBe('23503');
      const unknown = await attempt(client, null, `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'x', 'researching')`, [randomUUID(), a.accountId]);
      if (!unknown.ok) expect(unknown.code).toBe('23503');
      expect(unknown.ok).toBe(false);
      // A command's receipt is tied to the Project and Account the same way.
      const receipt = await attempt(client, null, `insert into projects.project_commands (account_id, command_id, project_id, command, payload_hash, expected_revision, title, revision) values ($1, $2, $3, 'rename', $4, 1, 'x', 2)`, [b.accountId, randomUUID(), projectA, 'a'.repeat(64)]);
      expect(receipt.ok).toBe(false);
      if (!receipt.ok) expect(receipt.code).toBe('23503');
      // And a Workspace with Projects cannot be deleted from under them.
      const removal = await attempt(client, null, 'delete from projects.workspaces where id = $1', [a.workspaceId]);
      expect(removal.ok).toBe(false);
      if (!removal.ok) expect(removal.code).toBe('23503');
    });
  });

  it('keeps who a Project is for good: its ID, Workspace, Account, status handle and creation time cannot change', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const id = await project(client, a);
      for (const change of [
        `id = '${randomUUID()}'`,
        `workspace_id = '${b.workspaceId}'`,
        `account_id = '${b.accountId}'`,
        `status_handle = extensions.gen_random_bytes(16)`,
        `created_at = created_at - interval '1 day'`,
      ]) {
        const result = await attempt(client, null, `update projects.projects set ${change}, revision = revision + 1 where id = $1`, [id]);
        expect(result.ok, change).toBe(false);
        if (!result.ok) expect(result.code, change).toBe('55000');
      }
      expect((await stored(client, id)).revision).toBe(1);
    });
  });

  it('raises the revision by exactly one with every change, and no other way', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      for (const change of ['title = \'Other\'', 'title = \'Other\', revision = revision', 'title = \'Other\', revision = revision + 2', 'title = \'Other\', revision = 1', 'revision = revision - 1']) {
        const result = await attempt(client, null, `update projects.projects set ${change} where id = $1`, [id]);
        expect(result.ok, change).toBe(false);
        if (!result.ok) expect(result.code, change).toBe('55000');
      }
      expect((await attempt(client, null, `update projects.projects set title = 'Other', revision = revision + 1 where id = $1`, [id])).ok).toBe(true);
      expect(await stored(client, id)).toMatchObject({title: 'Other', revision: 2});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('access: closed to every role but the service role, and the status handle goes nowhere', () => {
  it('gives anon, authenticated and service_role no privilege on either table, with row-level security on and no policy', async () => {
    for (const table of ['projects.projects', 'projects.project_commands']) {
      const { rows: found } = await db.query(`select c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies from pg_class c where c.oid = $1::regclass`, [table]);
      expect(found[0], table).toEqual({rls: true, policies: 0});
      for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
        const { rows: privilege } = await db.query(`select has_table_privilege($1, $2, 'select,insert,update,delete,truncate,references,trigger') as any_privilege`, [role, table]);
        expect(privilege[0].any_privilege, `${role} on ${table}`).toBe(false);
      }
    }
  });

  it('lets only the service role execute the three functions, each as its owner with an empty search path', async () => {
    const { rows: found } = await db.query(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname in ('list_projects', 'get_project', 'rename_project') order by 1`,
    );
    expect(found.map((row) => row.name)).toEqual(['get_project', 'list_projects', 'rename_project']);
    for (const row of found) {
      expect(row.grantees, row.name).toEqual(['service_role']);
      expect(row.definer, row.name).toBe(true);
      expect(String(row.config), row.name).toContain('search_path=');
    }
    await inTx(async (client) => {
      const who = await account(client);
      for (const role of ['anon', 'authenticated']) {
        for (const sql of [
          'select * from api.list_projects($1, 1, 10)',
          'select * from api.get_project($1, 1, gen_random_uuid())',
          'select * from api.rename_project($1, 1, gen_random_uuid(), gen_random_uuid(), 1, \'x\')',
        ]) {
          const result = await attempt(client, role, sql, [who.accountId]);
          expect(result.ok, `${role} ${sql}`).toBe(false);
          if (!result.ok) expect(result.code).toBe('42501');
        }
      }
    });
  });

  it('is not callable at all: identity.assert_operation_authority belongs to no API role', async () => {
    await inTx(async (client) => {
      const who = await account(client);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const result = await attempt(client, role, 'select identity.assert_operation_authority($1, 1)', [who.accountId]);
        expect(result.ok, role).toBe(false);
      }
    });
  });

  it('returns the status handle in no answer, in any spelling: not from a function as the service role, and not over REST', async () => {
    const a = await committedAccount();
    const id = await project(db, a, {title: 'Handle probe'});
    const { rows: found } = await db.query(`select status_handle as raw, encode(status_handle, 'hex') as hex from projects.projects where id = $1`, [id]);
    const handle = found[0].raw as Buffer;
    const hex = found[0].hex as string;
    expect(handle).toHaveLength(16);
    const spellings = [
      hex, hex.toUpperCase(), `\\x${hex}`, `\\\\x${hex}`, handle.toString('base64'), handle.toString('base64').replace(/=+$/, ''), handle.toString('base64url'),
      [...handle].join(','), JSON.stringify([...handle]), handle.toString('latin1'),
    ];
    const texts: string[] = [];
    // As the service role through the database connection: every function that touches the Project, and the preflight.
    await inTx(async (client) => {
      texts.push(JSON.stringify(await list(client, a)));
      texts.push(JSON.stringify(await get(client, a, id)));
      texts.push(JSON.stringify(await rename(client, a, {projectId: id, title: 'Handle probe renamed', expected: 1})));
      texts.push(JSON.stringify(await rename(client, a, {projectId: id, title: 'Stale probe', expected: 1})));
      texts.push(JSON.stringify(await api(client).preflight()));
    });
    // And as the wire carries them: the very text PostgREST sends, for each function, for a refusal and for an invalid call.
    const call = async (name: string, body: Record<string, unknown>) => {
      const response = await fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {apikey: stack.serviceKey, authorization: `Bearer ${stack.serviceKey}`, 'content-type': 'application/json', 'content-profile': 'api'},
        body: JSON.stringify(body),
      });
      return `${response.status} ${await response.text()}`;
    };
    texts.push(await call('list_projects', {p_account_id: a.accountId, p_epoch: 1, p_limit: 10}));
    texts.push(await call('get_project', {p_account_id: a.accountId, p_epoch: 1, p_project_id: id}));
    texts.push(await call('rename_project', {p_account_id: a.accountId, p_epoch: 1, p_command_id: randomUUID(), p_project_id: id, p_expected_revision: 2, p_title: 'Wire probe'}));
    texts.push(await call('rename_project', {p_account_id: a.accountId, p_epoch: 1, p_command_id: randomUUID(), p_project_id: id, p_expected_revision: 2, p_title: ''}));
    texts.push(await call('get_project', {p_account_id: a.accountId, p_epoch: 99, p_project_id: id}));
    texts.push(await call('preflight', {}));
    expect(texts).toHaveLength(11);
    for (const text of texts) for (const spelling of spellings) expect(text.includes(spelling), `${spelling.slice(0, 12)} in ${text.slice(0, 80)}`).toBe(false);
    // The probe was real: the Project is renamed, so the answers did say something about it.
    expect(texts.join(' ')).toContain('Handle probe renamed');
  });

  it('returns the status handle from no function: no return type holds one, and the only functions of the api schema that name the column are the preflight, the tombstone writer and the status lookup (tombstones.test.ts shows what each lets out)', async () => {
    const { rows: types } = await db.query(
      `select t.typname, a.attname from pg_type t join pg_class c on c.oid = t.typrelid join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
        where t.typnamespace = 'api'::regnamespace and a.attname ilike '%handle%'`,
    );
    expect(types).toEqual([]);
    const { rows: functions } = await db.query(`select p.proname as name, pg_get_functiondef(p.oid) as definition from pg_proc p where p.pronamespace = 'api'::regnamespace`);
    const naming = functions.filter((row) => /status_handle/.test(row.definition));
    // Story 1.8 gave the handle two uses: record_tombstone copies it into the tombstone, and lookup_status finds a target by it. Neither returns it.
    expect(naming.map((row) => row.name).sort()).toEqual(['lookup_status', 'preflight', 'record_tombstone']);
    // The preflight only checks that the column exists: it reads it and discards it.
    const preflight = naming.find((row) => row.name === 'preflight');
    for (const line of preflight.definition.split('\n').filter((entry: string) => /status_handle/.test(entry))) expect(line.trim().startsWith('perform')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.list_projects', () => {
  it('lists the Account\'s Projects newest update first, each with its fields and none of another Account\'s', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const old = await project(client, a, {title: 'Old', updatedAt: '2026-10-01T10:00:00Z', stage: 'export_ready', version: 3});
      const recent = await project(client, a, {title: 'Recent', updatedAt: '2026-10-12T10:00:00Z', stage: 'generating', version: 1});
      await project(client, b, {title: 'Someone else\'s', updatedAt: '2026-10-13T10:00:00Z'});
      const listed = await list(client, a);
      expect(listed.outcome).toBe('listed');
      expect(listed.total).toBe(2);
      expect(listed.projects.map((entry: {id: string}) => entry.id)).toEqual([recent, old]);
      expect(listed.projects[0]).toMatchObject({title: 'Recent', stage: 'generating', current_version: 1, revision: 1});
      expect(Object.keys(listed.projects[0]).sort()).toEqual(['created_at', 'current_version', 'id', 'revision', 'stage', 'title', 'updated_at']);
      expect(JSON.stringify(listed)).not.toContain('Someone else');
    });
  });

  it('is an empty list, and a total of 0, for an Account with no Projects', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      expect(await list(client, a)).toEqual({outcome: 'listed', total: 0, projects: []});
    });
  });

  it('leaves a deleted Project out of the list and out of the count', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      await project(client, a, {title: 'Kept'});
      await project(client, a, {title: 'Gone', deleted: true});
      const listed = await list(client, a);
      expect(listed.total).toBe(1);
      expect(listed.projects.map((entry: {title: string}) => entry.title)).toEqual(['Kept']);
    });
  });

  it('carries at most the limit, and counts all of them', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (let index = 0; index < 5; index += 1) await project(client, a, {title: `P${index}`, updatedAt: `2026-10-0${index + 1}T10:00:00Z`});
      const listed = await list(client, a, 3);
      expect(listed.total).toBe(5);
      expect(listed.projects.map((entry: {title: string}) => entry.title)).toEqual(['P4', 'P3', 'P2']);
    });
  });

  it('counts and lists from ONE snapshot, so a Project inserted while it runs is in both or in neither', async () => {
    const definition = (await db.query(`select pg_get_functiondef('api.list_projects(uuid,bigint,integer)'::regprocedure) as text`)).rows[0].text as string;
    expect(definition.match(/from projects\.projects/g)).toHaveLength(1);
    expect(definition).toMatch(/count\(\*\) over \(\)/);
    const a = await committedAccount();
    const [reader, writer] = await Promise.all([connect(), connect()]);
    const inserting = (async () => {
      for (let index = 0; index < 60; index += 1) {
        await writer.query(
          `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, $3, 'researching')`,
          [a.workspaceId, a.accountId, `Inserted while listing ${index}`],
        );
      }
    })();
    const seen: {total: number; length: number}[] = [];
    for (let round = 0; round < 120; round += 1) {
      const answer = await call(reader, 'select * from api.list_projects($1, 1, 200)', [a.accountId]);
      seen.push({total: answer.total, length: answer.projects.length});
      const limited = await call(reader, 'select * from api.list_projects($1, 1, 7)', [a.accountId]);
      expect(limited.projects.length, `round ${round}`).toBe(Math.min(7, limited.total));
    }
    await inserting;
    expect(seen.filter((entry) => entry.length !== entry.total)).toEqual([]);
    expect(seen.some((entry) => entry.total > 0 && entry.total < 60)).toBe(true);
    const final = await call(db, 'select * from api.list_projects($1, 1, 200)', [a.accountId]);
    expect(final.total).toBe(60);
    expect(final.projects).toHaveLength(60);
  });

  it('refuses a limit that is not 1 to 200 as an invalid argument', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const limit of [0, -1, 201, null]) {
        const result = await attempt(client, 'service_role', 'select * from api.list_projects($1, 1, $2)', [a.accountId, limit]);
        expect(result.ok, String(limit)).toBe(false);
        if (!result.ok) expect(result.code, String(limit)).toBe('22023');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.get_project: foreign, deleted, unknown and malformed all answer one thing', () => {
  it('answers the Project\'s fields for its owner', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {title: 'Ramp', stage: 'awaiting_model_approval', version: 2});
      expect(await get(client, a, id)).toMatchObject({outcome: 'found', id, title: 'Ramp', stage: 'awaiting_model_approval', current_version: 2, revision: '1'});
    });
  });

  it('answers `unavailable` with every field empty, and the very same row, for another Account\'s Project, a deleted one and one that never existed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const foreign = await project(client, b, {title: 'Secret plans'});
      const deleted = await project(client, a, {title: 'Deleted plans', deleted: true});
      const answers = [await get(client, a, foreign), await get(client, a, deleted), await get(client, a, randomUUID())];
      const empty = {outcome: 'unavailable', id: null, title: null, stage: null, current_version: null, revision: null, created_at: null, updated_at: null};
      for (const answer of answers) expect(answer).toEqual(empty);
      expect(JSON.stringify(answers)).not.toMatch(/Secret|Deleted plans/);
    });
  });

  it('refuses a malformed Project ID before any lookup (the application never sends one: it answers unavailable itself)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const result = await attempt(client, 'service_role', 'select * from api.get_project($1, 1, $2)', [a.accountId, 'not-an-id']);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22P02');
      const missing = await attempt(client, 'service_role', 'select * from api.get_project($1, 1, null)', [a.accountId]);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe('22023');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.rename_project: the first command, with an expected revision', () => {
  it('commits at the current revision: the title changes, the revision rises by one, the ledger holds the receipt (AC-4)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {title: 'Before', updatedAt: '2026-10-01T10:00:00Z'});
      const command = randomUUID();
      const answer = await rename(client, a, {projectId: id, title: 'After', expected: 1, command});
      expect(answer).toMatchObject({outcome: 'renamed', project_id: id, title: 'After', revision: '2', replayed: false});
      const row = await stored(client, id);
      expect(row).toMatchObject({title: 'After', revision: 2});
      expect(row.updated_at.getTime()).toBeGreaterThan(new Date('2026-10-01T10:00:00Z').getTime());
      const receipts = await ledger(client, a.accountId);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({command_id: command, project_id: id, command: 'rename', expected_revision: 1, title: 'After', revision: 2});
      expect(receipts[0].payload_hash).toMatch(/^[0-9a-f]{64}$/);
      // The new title and revision show everywhere.
      expect((await list(client, a)).projects[0]).toMatchObject({title: 'After', revision: 2});
      expect(await get(client, a, id)).toMatchObject({title: 'After', revision: '2'});
    });
  });

  it('rejects a stale expected revision with the current title and revision, and changes nothing: no bump, no ledger row (AC-4)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {title: 'Before'});
      expect((await rename(client, a, {projectId: id, title: 'Second window', expected: 1})).outcome).toBe('renamed');
      const before = await stored(client, id);
      const answer = await rename(client, a, {projectId: id, title: 'First window', expected: 1});
      expect(answer).toMatchObject({outcome: 'stale', project_id: id, title: 'Second window', revision: '2', replayed: false});
      expect(await stored(client, id)).toEqual(before);
      expect(await ledger(client, a.accountId)).toHaveLength(1);
      // A revision from the future is stale too: the Project is not at it.
      expect(await rename(client, a, {projectId: id, title: 'Future', expected: 9})).toMatchObject({outcome: 'stale', revision: '2'});
      expect(await stored(client, id)).toEqual(before);
      // ... and with the current revision the same change commits and bumps once.
      expect(await rename(client, a, {projectId: id, title: 'First window', expected: 2})).toMatchObject({outcome: 'renamed', title: 'First window', revision: '3'});
      expect((await stored(client, id)).revision).toBe(3);
    });
  });

  it('answers the original receipt for the same command sent again, without a second bump, even after the Project changed again', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {title: 'Before'});
      const command = randomUUID();
      const first = await rename(client, a, {projectId: id, title: 'After', expected: 1, command});
      expect(first).toMatchObject({outcome: 'renamed', revision: '2', replayed: false});
      const replay = await rename(client, a, {projectId: id, title: 'After', expected: 1, command});
      expect(replay).toMatchObject({outcome: 'renamed', project_id: id, title: 'After', revision: '2', replayed: true});
      expect((await stored(client, id)).revision).toBe(2);
      expect(await ledger(client, a.accountId)).toHaveLength(1);
      // Another command renames it again; the replay still answers what the first command did.
      expect((await rename(client, a, {projectId: id, title: 'Later', expected: 2})).outcome).toBe('renamed');
      expect(await rename(client, a, {projectId: id, title: 'After', expected: 1, command})).toMatchObject({outcome: 'renamed', title: 'After', revision: '2', replayed: true});
      expect(await stored(client, id)).toMatchObject({title: 'Later', revision: 3});
    });
  });

  it('refuses the same command ID with another payload, and changes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {title: 'Before'});
      const other = await project(client, a, {title: 'Other project'});
      const command = randomUUID();
      expect((await rename(client, a, {projectId: id, title: 'After', expected: 1, command})).outcome).toBe('renamed');
      const before = [await stored(client, id), await stored(client, other)];
      for (const changed of [
        {projectId: id, title: 'Different title', expected: 1},
        {projectId: id, title: 'After', expected: 2},
        {projectId: other, title: 'After', expected: 1},
      ]) {
        expect(await rename(client, a, {...changed, command}), JSON.stringify(changed)).toEqual({outcome: 'reused', project_id: null, title: null, revision: null, replayed: null});
      }
      expect([await stored(client, id), await stored(client, other)]).toEqual(before);
      expect(await ledger(client, a.accountId)).toHaveLength(1);
    });
  });

  it('keeps command IDs to the Account: another Account may use the same ID for a Project of its own', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const projectA = await project(client, a);
      const projectB = await project(client, b);
      const command = randomUUID();
      expect((await rename(client, a, {projectId: projectA, title: 'A renamed', command})).outcome).toBe('renamed');
      expect((await rename(client, b, {projectId: projectB, title: 'B renamed', command})).outcome).toBe('renamed');
      expect((await stored(client, projectB)).title).toBe('B renamed');
    });
  });

  it('answers `unavailable`, and changes nothing, for another Account\'s Project, a deleted one and one that never existed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const foreign = await project(client, b, {title: 'Secret plans'});
      const deleted = await project(client, a, {title: 'Deleted plans', deleted: true});
      for (const target of [foreign, deleted, randomUUID()]) {
        expect(await rename(client, a, {projectId: target, title: 'Taken over'}), target).toEqual({outcome: 'unavailable', project_id: null, title: null, revision: null, replayed: null});
      }
      expect((await stored(client, foreign)).title).toBe('Secret plans');
      expect((await stored(client, deleted)).title).toBe('Deleted plans');
      expect(await ledger(client, a.accountId)).toEqual([]);
      expect(await ledger(client, b.accountId)).toEqual([]);
    });
  });

  it('refuses a replay of a command whose Project has since been deleted: it is unavailable, not a receipt', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {title: 'Before'});
      const command = randomUUID();
      expect((await rename(client, a, {projectId: id, title: 'After', command})).outcome).toBe('renamed');
      await client.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [id]);
      expect((await rename(client, a, {projectId: id, title: 'After', command})).outcome).toBe('unavailable');
    });
  });

  it('refuses a title that is not valid as an invalid argument, and changes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {title: 'Before'});
      for (const title of ['', ' ', ' padded', 'padded ', 'x'.repeat(121), 'tab\there', 'new\nline', 'nul\u0001']) {
        const result = await attempt(client, 'service_role', 'select * from api.rename_project($1, 1, gen_random_uuid(), $2, 1, $3)', [a.accountId, id, title]);
        expect(result.ok, JSON.stringify(title)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(title)).toBe('22023');
      }
      for (const [expected, command] of [[0, randomUUID()], [null, randomUUID()], [1, null]] as const) {
        const result = await attempt(client, 'service_role', 'select * from api.rename_project($1, 1, $2, $3, $4, \'Fine\')', [a.accountId, command, id, expected]);
        expect(result.ok, String(expected)).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
      expect(await stored(client, id)).toMatchObject({title: 'Before', revision: 1});
      expect(await ledger(client, a.accountId)).toEqual([]);
    });
  });

  it('accepts a title of 120 characters and one in Hebrew, and stores them as given', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      const long = 'ש'.repeat(120);
      expect(await rename(client, a, {projectId: id, title: long, expected: 1})).toMatchObject({outcome: 'renamed', title: long});
      expect(await rename(client, a, {projectId: id, title: 'המזבח החיצון והכבש', expected: 2})).toMatchObject({outcome: 'renamed', title: 'המזבח החיצון והכבש', revision: '3'});
    });
  });

  it('keeps the ledger immutable: a receipt cannot be edited or emptied, and has the Project and Account of its command', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      expect((await rename(client, a, {projectId: id, title: 'After'})).outcome).toBe('renamed');
      for (const sql of [
        `update projects.project_commands set title = 'Rewritten'`,
        `update projects.project_commands set revision = 99`,
        `update projects.project_commands set payload_hash = '${'b'.repeat(64)}'`,
        'truncate projects.project_commands',
      ]) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      expect((await ledger(client, a.accountId))[0]).toMatchObject({title: 'After', revision: 2});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('authority: a refusal answers `denied` and nothing is read or written (the Account is checked first)', () => {
  it('denies all three to a disabled Account, to a stale epoch, to an epoch from the future and to an Account that does not exist', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a, {title: 'Before'});
      // A stale epoch: the Account's epoch was raised after the request was authorized.
      expect((await api(client).raiseEpoch(a.accountId)).epoch).toBe(2);
      const denied = {outcome: 'denied'};
      expect(await list(client, a, 200, 1)).toMatchObject({...denied, total: null, projects: null});
      expect(await get(client, a, id, 1)).toMatchObject({...denied, id: null, title: null});
      expect(await rename(client, a, {projectId: id, title: 'Changed', epoch: 1})).toMatchObject({...denied, title: null});
      expect(await rename(client, a, {projectId: id, title: 'Changed', epoch: 99})).toMatchObject(denied);
      // The current epoch is allowed, a disabled Account is not, whatever its epoch.
      expect((await get(client, a, id, 2)).outcome).toBe('found');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect((await list(client, a, 200, 3)).outcome).toBe('denied');
      expect((await get(client, a, id, 3)).outcome).toBe('denied');
      expect((await rename(client, a, {projectId: id, title: 'Changed', epoch: 3})).outcome).toBe('denied');
      // An Account that does not exist.
      const ghost = {...a, accountId: randomUUID()};
      expect((await list(client, ghost)).outcome).toBe('denied');
      expect((await get(client, ghost, id)).outcome).toBe('denied');
      expect((await rename(client, ghost, {projectId: id, title: 'Changed'})).outcome).toBe('denied');
      // Nothing changed, and no receipt was written.
      expect(await stored(client, id)).toMatchObject({title: 'Before', revision: 1});
      expect(await ledger(client, a.accountId)).toEqual([]);
    });
  });

  it('checks the Account before it looks at the Project: a denied request cannot tell a Project that exists from one that does not', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const foreign = await project(client, b);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      const real = await get(client, a, foreign, 2);
      const unknown = await get(client, a, randomUUID(), 2);
      expect(real).toEqual(unknown);
      expect(real.outcome).toBe('denied');
    });
  });

  it('refuses an epoch that is not positive as an invalid argument', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const epoch of [0, -1, null]) {
        const result = await attempt(client, 'service_role', 'select * from api.list_projects($1, $2, 10)', [a.accountId, epoch]);
        expect(result.ok, String(epoch)).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('two connections at once (real connections, committed data)', () => {
  it('is one commit and one `stale` when two windows rename the same Project from the same revision, over 8 rounds', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 8; round += 1) {
      const a = await committedAccount();
      const id = await project(db, a, {title: 'Before'});
      const [first, second] = await Promise.all([
        call(one, 'select * from api.rename_project($1, 1, $2, $3, 1, \'From the first window\')', [a.accountId, randomUUID(), id]),
        call(two, 'select * from api.rename_project($1, 1, $2, $3, 1, \'From the second window\')', [a.accountId, randomUUID(), id]),
      ]);
      expect([first.outcome, second.outcome].sort(), `round ${round}`).toEqual(['renamed', 'stale']);
      const winner = first.outcome === 'renamed' ? first : second;
      const loser = first.outcome === 'renamed' ? second : first;
      // The loser is told what the winner did, and nothing else changed.
      expect(loser).toMatchObject({title: winner.title, revision: '2'});
      expect(await stored(db, id)).toMatchObject({title: winner.title, revision: 2});
      expect(await ledger(db, a.accountId)).toHaveLength(1);
    }
  });

  it('is one commit and one replay when the same command arrives twice at once, over 8 rounds', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 8; round += 1) {
      const a = await committedAccount();
      const id = await project(db, a, {title: 'Before'});
      const command = randomUUID();
      const answers = await Promise.all([one, two].map((client) => call(client, 'select * from api.rename_project($1, 1, $2, $3, 1, \'Once\')', [a.accountId, command, id])));
      expect(answers.map((answer) => answer.outcome), `round ${round}`).toEqual(['renamed', 'renamed']);
      expect(answers.map((answer) => answer.replayed).sort(), `round ${round}`).toEqual([false, true]);
      expect(answers.map((answer) => answer.revision)).toEqual(['2', '2']);
      expect(await stored(db, id)).toMatchObject({title: 'Once', revision: 2});
      expect(await ledger(db, a.accountId)).toHaveLength(1);
    }
  });

  it('is one refusal when the same command ID arrives at once for two different changes, and the second can never overwrite the first', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    const a = await committedAccount();
    const first = await project(db, a, {title: 'First'});
    const second = await project(db, a, {title: 'Second'});
    const command = randomUUID();
    const answers = await Promise.all([
      call(one, 'select * from api.rename_project($1, 1, $2, $3, 1, \'One\')', [a.accountId, command, first]),
      call(two, 'select * from api.rename_project($1, 1, $2, $3, 1, \'Two\')', [a.accountId, command, second]),
    ]);
    expect(answers.map((answer) => answer.outcome).sort()).toEqual(['renamed', 'reused']);
    expect(await ledger(db, a.accountId)).toHaveLength(1);
    const changed = [await stored(db, first), await stored(db, second)].filter((row) => row.revision === 2);
    expect(changed).toHaveLength(1);
  });

  it('waits for the Account\'s disable and is then denied, and writes nothing, when the disable commits first', async () => {
    const a = await committedAccount();
    const id = await project(db, a, {title: 'Before'});
    const disabler = await connect();
    const renamer = await connect();
    const { rows: pid } = await renamer.query('select pg_backend_pid() as pid');
    await disabler.query('begin');
    await disabler.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
    const renaming = renamer.query('select * from api.rename_project($1, 1, $2, $3, 1, \'Too late\')', [a.accountId, randomUUID(), id]);
    let settled = false;
    renaming.then(() => (settled = true), () => (settled = true));
    await untilBlocked(pid[0].pid);
    expect(settled).toBe(false);
    await disabler.query('commit');
    expect((await renaming).rows[0].outcome).toBe('denied');
    expect(await stored(db, id)).toMatchObject({title: 'Before', revision: 1});
    expect(await ledger(db, a.accountId)).toEqual([]);
  });

  it('holds the Account FOR SHARE for the transaction, so a disable waits for a rename that passed the check, and the rename commits', async () => {
    const a = await committedAccount();
    const id = await project(db, a, {title: 'Before'});
    const renamer = await connect();
    const disabler = await connect();
    const { rows: pid } = await disabler.query('select pg_backend_pid() as pid');
    await renamer.query('begin');
    expect((await renamer.query('select outcome from api.rename_project($1, 1, $2, $3, 1, \'In time\')', [a.accountId, randomUUID(), id])).rows[0].outcome).toBe('renamed');
    const disabling = disabler.query('select outcome from api.disable_account($1, $2)', ['user:00000000-0000-4000-8000-000000000001', a.accountId]);
    await untilBlocked(pid[0].pid);
    await renamer.query('commit');
    expect((await disabling).rows[0].outcome).toBe('disabled');
    expect(await stored(db, id)).toMatchObject({title: 'In time', revision: 2});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls, over REST as the application makes them (committed data)', () => {
  it('lists, reads and renames through lib/projects.ts, and every answer is checked', async () => {
    const a = await committedAccount();
    const other = await committedAccount();
    const older = await project(db, a, {title: 'Older', updatedAt: '2026-10-01T10:00:00Z', stage: 'export_ready', version: 4});
    const newer = await project(db, a, {title: 'המזבח החיצון והכבש', updatedAt: '2026-10-05T10:00:00Z', stage: 'awaiting_model_approval', version: 2});
    const foreign = await project(db, other, {title: 'Not yours'});
    const operation = {accountId: a.accountId, epoch: 1};
    const options = {env};

    const listed = await listProjects(operation, {}, options);
    expect(listed).toMatchObject({outcome: 'listed', total: 2});
    if (listed.outcome === 'listed') {
      expect(listed.projects.map((entry) => entry.id)).toEqual([newer, older]);
      expect(listed.projects[0]).toMatchObject({title: 'המזבח החיצון והכבש', stage: 'awaiting_model_approval', currentVersion: 2, revision: 1});
    }
    expect(await listProjects(operation, {limit: 1}, options)).toMatchObject({outcome: 'listed', total: 2, projects: [expect.objectContaining({id: newer})]});

    expect(await readProject(operation, older, options)).toMatchObject({outcome: 'found', project: {id: older, title: 'Older', stage: 'export_ready', currentVersion: 4}});
    // Foreign, unknown and malformed are one answer; a malformed ID never reaches the database.
    for (const target of [foreign, randomUUID(), 'not-an-id', '', undefined, 42]) expect(await readProject(operation, target, options), String(target)).toEqual({outcome: 'unavailable'});

    const command = randomUUID();
    const renamed = await renameProjectCommand(operation, {commandId: command, projectId: older, expectedRevision: 1, title: 'Renamed'}, options);
    expect(renamed).toEqual({outcome: 'renamed', projectId: older, title: 'Renamed', revision: 2, replayed: false});
    expect(await renameProjectCommand(operation, {commandId: command, projectId: older, expectedRevision: 1, title: 'Renamed'}, options)).toEqual({outcome: 'renamed', projectId: older, title: 'Renamed', revision: 2, replayed: true});
    expect(await renameProjectCommand(operation, {commandId: randomUUID(), projectId: older, expectedRevision: 1, title: 'Late'}, options)).toEqual({outcome: 'stale', projectId: older, title: 'Renamed', revision: 2});
    expect(await renameProjectCommand(operation, {commandId: command, projectId: older, expectedRevision: 1, title: 'Another'}, options)).toEqual({outcome: 'reused'});
    expect(await renameProjectCommand(operation, {commandId: randomUUID(), projectId: foreign, expectedRevision: 1, title: 'Taken'}, options)).toEqual({outcome: 'unavailable'});
    expect((await stored(db, foreign)).title).toBe('Not yours');
  });

  it('answers `denied` for an operation under another epoch, and throws, as a fail-closed read, when the database says no', async () => {
    const a = await committedAccount();
    const id = await project(db, a);
    const stale = {accountId: a.accountId, epoch: 7};
    const options = {env};
    expect(await listProjects(stale, {}, options)).toEqual({outcome: 'denied'});
    expect(await readProject(stale, id, options)).toEqual({outcome: 'denied'});
    expect(await renameProjectCommand(stale, {commandId: randomUUID(), projectId: id, expectedRevision: 1, title: 'x'}, options)).toEqual({outcome: 'denied'});
    expect((await stored(db, id)).title).toBe('Courtyard bench');
    // A service that refuses the call is an error, never an empty list or an "unavailable" Project.
    const refused = { ...options, env: { ...env, SUPABASE_SERVICE_ROLE_KEY: stackAnon() } };
    await expect(listProjects({accountId: a.accountId, epoch: 1}, {}, refused)).rejects.toBeInstanceOf(AccountsUnavailableError);
    await expect(readProject({accountId: a.accountId, epoch: 1}, id, refused)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('resolves a Project target for an operation: resolved, unavailable, denied or unreachable, and never throws', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    const mine = await project(db, a, {title: 'Mine'});
    const theirs = await project(db, b, {title: 'Theirs'});
    const options = {env, log: () => undefined};
    expect(await resolveProjectTarget({accountId: a.accountId, epoch: 1}, mine, options)).toEqual({outcome: 'resolved', accountId: a.accountId, projectId: mine, revision: 1});
    for (const target of [theirs, randomUUID(), 'not-an-id', null]) expect(await resolveProjectTarget({accountId: a.accountId, epoch: 1}, target, options), String(target)).toEqual({outcome: 'unavailable'});
    expect(await resolveProjectTarget({accountId: a.accountId, epoch: 2}, mine, options)).toEqual({outcome: 'denied'});
    await db.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
    expect(await resolveProjectTarget({accountId: a.accountId, epoch: 2}, mine, options)).toEqual({outcome: 'denied'});
    // The database cannot be reached: a denial that is not "unavailable".
    expect(await resolveProjectTarget({accountId: b.accountId, epoch: 1}, theirs, {...options, env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}})).toEqual({outcome: 'unreachable'});
  });
});

function stackAnon() {
  // The anon key is a valid key that may not execute the api functions: the database answers a permission error.
  return env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

// ---------------------------------------------------------------------------------------------------
describe('the preflight probes the Story 1.7 tables and functions', () => {
  it('answers ok to the service role', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
    });
  });

  it('fails in one line, naming the migration, when a function is missing', async () => {
    await inTx(async (client) => {
      await client.query('drop function api.get_project(uuid, bigint, uuid)');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('Story 1.7 migration');
        expect(result.message).toContain('api.get_project(uuid,bigint,uuid)');
      }
    });
  });

  it('fails, naming the function, when the service role cannot execute one', async () => {
    await inTx(async (client) => {
      await client.query('revoke execute on function api.rename_project(uuid, bigint, uuid, uuid, bigint, text) from service_role');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('api.rename_project(uuid,bigint,uuid,uuid,bigint,text)');
      }
    });
  });

  it('still probes every earlier function: the Story 1.5 and 1.6 ones are named in the same preflight', async () => {
    const { rows: found } = await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as definition`);
    for (const signature of ['api.list_accounts()', 'api.disable_account(text,uuid)', 'api.guard_operation(uuid,bigint)', 'identity.assert_operation_authority(uuid,bigint)', 'api.issue_recovery(text,text)', 'api.redeem_recovery(text,text,uuid,uuid)', 'identity.record_recovery_refusal(text,text,text)']) {
      expect(found[0].definition, signature).toContain(signature);
    }
    for (const table of ['identity.session_grants', 'identity.account_preferences', 'identity.fresh_authentications', 'identity.recovery_tokens', 'auth.sessions', 'auth.mfa_amr_claims']) expect(found[0].definition, table).toContain(table);
  });
});
