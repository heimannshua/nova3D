import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {projectFixtures} from '@/lib/project-fixtures';
import {projectStages} from '@/lib/project-stage';
import {createHarness, stack, tag} from '../support/accounts-db';

// The local fixture seed (scripts/seed-projects.mjs) run against the Supabase CLI stack: one Project for each of the stages (six in Story 1.7, seven since Story 2.1 added request_confirmed, eight since Story 2.2 added request_draft), nothing
// twice, nothing for an Account that is not active, and removal that takes only the fixtures. Its refusals are in tests/unit/seed-projects.test.ts.
const {db, committed, addUser, rows} = createHarness();
const script = resolve(import.meta.dirname, '../../scripts/seed-projects.mjs');

const run = (args: string[], overrides: Record<string, string> = {}) =>
  new Promise<{code: number | null; stdout: string; stderr: string}>((done) => {
    const env = Object.fromEntries(Object.entries({PATH: process.env.PATH ?? '', APP_ENV: 'local', NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl, SEED_DATABASE_URL: stack.dbUrl, ADMINISTRATOR_EMAIL: '', ...overrides})) as NodeJS.ProcessEnv;
    const child = spawn(process.execPath, [script, ...args], {env, cwd: resolve(import.meta.dirname, '../..')});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => done({code, stdout, stderr}));
  });

async function account() {
  const email = `seed-projects-${tag()}@example.test`;
  const user = await addUser(db, {email});
  committed.users.push(user.id);
  committed.emails.push(email);
  const { rows } = await db.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject]);
  return {user, email, accountId: rows[0].id as string};
}
const stored = async (accountId: string) =>
  (await db.query('select title, stage, current_version, revision::int as revision, updated_at from projects.projects where account_id = $1 order by updated_at desc', [accountId])).rows;

describe('the local fixture seed', () => {
  it('gives an Account one Project for each of the stages (eight), newest first in the order of the fixtures, and prints no ID', async () => {
    const a = await account();
    const result = await run(['--email', a.email]);
    expect(result.code, result.stderr).toBe(0);
    const rows = await stored(a.accountId);
    expect(rows.map((row) => row.stage)).toEqual(projectFixtures.map((fixture) => fixture.stage));
    expect(rows.map((row) => row.title)).toEqual(projectFixtures.map((fixture) => fixture.title));
    expect(rows.map((row) => row.current_version)).toEqual(projectFixtures.map((fixture) => fixture.currentVersion));
    expect(new Set(rows.map((row) => row.stage))).toEqual(new Set(projectStages));
    for (const row of rows) expect(row.revision).toBe(1);
    expect(result.stdout).toContain(`Added ${projectFixtures.length} fixture Projects`);
    expect(result.stdout).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('changes nothing the second time, and leaves a Project of the Account\'s own alone', async () => {
    const a = await account();
    await db.query(
      `insert into projects.projects (workspace_id, account_id, title, stage) select w.id, w.account_id, 'My own project', 'generating' from projects.workspaces w where w.account_id = $1`,
      [a.accountId],
    );
    expect((await run(['--email', a.email])).code).toBe(0);
    const first = await stored(a.accountId);
    const again = await run(['--email', a.email]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain(`Added 0 fixture Projects to ${a.email}; ${projectFixtures.length} already there.`);
    expect(await stored(a.accountId)).toEqual(first);
    expect(first).toHaveLength(projectFixtures.length + 1);
  });

  it('takes the Account from ADMINISTRATOR_EMAIL when no address is given', async () => {
    const a = await account();
    const result = await run([], {ADMINISTRATOR_EMAIL: a.email.toUpperCase()});
    expect(result.code, result.stderr).toBe(0);
    expect(await stored(a.accountId)).toHaveLength(projectFixtures.length);
  });

  it('refuses an address with no Account, a disabled Account and an Account that is another\'s, and writes nothing', async () => {
    const stranger = await addUser(db, {email: `no-account-${tag()}@example.test`});
    committed.users.push(stranger.id);
    const unknown = await run(['--email', stranger.email]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/No active Account is registered/);
    const a = await account();
    await db.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
    expect((await run(['--email', a.email])).code).toBe(1);
    expect(await stored(a.accountId)).toEqual([]);
    expect((await run(['--email', `nobody-${tag()}@example.test`])).code).toBe(1);
  });

  it('writes to the Account asked for and to no other', async () => {
    const a = await account();
    const b = await account();
    expect((await run(['--email', a.email])).code).toBe(0);
    expect(await stored(b.accountId)).toEqual([]);
  });

  it('removes the fixtures and their commands with --remove, and nothing else', async () => {
    const a = await account();
    await db.query(
      `insert into projects.projects (workspace_id, account_id, title, stage) select w.id, w.account_id, 'My own project', 'generating' from projects.workspaces w where w.account_id = $1`,
      [a.accountId],
    );
    expect((await run(['--email', a.email])).code).toBe(0);
    const { rows: fixture } = await db.query('select id from projects.projects where account_id = $1 and title = $2', [a.accountId, projectFixtures[0].title]);
    await db.query(`select * from api.rename_project($1, 1, gen_random_uuid(), $2, 1, 'Renamed fixture')`, [a.accountId, fixture[0].id]);
    // A renamed fixture is no longer a fixture by title: it stays, with its receipt.
    const removed = await run(['--remove', '--email', a.email]);
    expect(removed.code, removed.stderr).toBe(0);
    expect((await stored(a.accountId)).map((row) => row.title).sort()).toEqual(['My own project', 'Renamed fixture']);
    expect((await db.query('select count(*)::int as n from projects.project_commands where account_id = $1', [a.accountId])).rows[0].n).toBe(1);
  });

  it('removes a fixture-titled Project that a confirmed request made, with its request revision and its rename receipt, and keeps another confirmed Project and its revision (E6)', async () => {
    const a = await account();
    const fixtureTitle = projectFixtures[0].title;
    const ask = (description: string, command: string) => [
      a.accountId, 1, command, 'The outer altar and ramp (Middot 3)', 'evidence_text', 'middot-altar-ramp', 'Scope', 'Outcome', description, null, null, null, false, null,
    ];
    // Two confirmed requests as the service role would make them (one transaction, committed), and one of them renamed to a fixture's title.
    await db.query('begin');
    let doomed: string;
    let kept: string;
    try {
      const create = 'select * from api.create_project_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)';
      doomed = (await rows(db, 'service_role', create, ask('Build the altar', randomUUID())))[0].project_id as string;
      kept = (await rows(db, 'service_role', create, ask('Build the ramp', randomUUID())))[0].project_id as string;
      const renamed = await rows(db, 'service_role', 'select * from api.rename_project($1, 1, $2, $3, 1, $4)', [a.accountId, randomUUID(), doomed, fixtureTitle]);
      expect(renamed[0].outcome).toBe('renamed');
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
    const revisionsOf = async (projectId: string) => (await db.query('select count(*)::int as n from projects.request_revisions where project_id = $1', [projectId])).rows[0].n as number;
    const projectsOf = async (projectId: string) => (await db.query('select count(*)::int as n from projects.projects where id = $1', [projectId])).rows[0].n as number;
    const receiptsOf = async (projectId: string) => (await db.query('select count(*)::int as n from projects.project_commands where project_id = $1', [projectId])).rows[0].n as number;
    expect([await projectsOf(doomed), await revisionsOf(doomed), await receiptsOf(doomed)]).toEqual([1, 1, 1]);

    // The Project's revision restricts its deletion (23503 for anyone who tries it directly), so --remove must take the revision first.
    const direct = await db.query('delete from projects.projects where id = $1', [doomed]).then(() => 'deleted', (error: {code?: string}) => error.code);
    expect(direct).toBe('23503');

    const removed = await run(['--remove', '--email', a.email]);
    expect(removed.code, removed.stderr).toBe(0);
    expect(removed.stdout).toContain(`Removed 1 fixture Project from ${a.email}.`);
    // Gone: the Project, the revision the request made, and the receipt the rename left.
    expect([await projectsOf(doomed), await revisionsOf(doomed), await receiptsOf(doomed)]).toEqual([0, 0, 0]);
    // Not a fixture by title: it and its revision stay.
    expect([await projectsOf(kept), await revisionsOf(kept)]).toEqual([1, 1]);
    expect((await stored(a.accountId)).map((row) => row.title)).toEqual(['The outer altar and ramp (Middot 3)']);
  });
});
