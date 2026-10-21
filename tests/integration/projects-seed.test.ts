import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {projectFixtures} from '@/lib/project-fixtures';
import {projectStages} from '@/lib/project-stage';
import {createHarness, stack, tag} from '../support/accounts-db';
import {insertIncident, insertReservation, insertSettlement} from '../support/usage-ledger';

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
  it('removes a fixture-titled Project that has a Job, with its attempts, step and operation and the reservation, settlement and overrun incident of that operation, keeps the Job and the ledger rows of another Project, and leaves the Account\'s command receipts (Stories 2.11 and 2.6)', async () => {
    const a = await account();
    const digest = 'a'.repeat(64);
    expect((await run(['--email', a.email])).code).toBe(0);
    const { rows: fixture } = await db.query('select id from projects.projects where account_id = $1 and title = $2', [a.accountId, projectFixtures[0].title]);
    const doomed = fixture[0].id as string;
    const kept = (
      await db.query(
        `insert into projects.projects (workspace_id, account_id, title, stage) select w.id, w.account_id, 'My own project', 'generating' from projects.workspaces w where w.account_id = $1 returning id`,
        [a.accountId],
      )
    ).rows[0].id as string;

    // A Job with two attempts (the first failed with a charge still open, the retry waiting), a step and an operation, in each Project: as the service role makes
    // them, in one transaction, committed.
    const makeJob = async (projectId: string) => {
      const call = async (sql: string, params: unknown[]) => (await rows(db, 'service_role', sql, params))[0];
      const accepted = await call('select * from api.accept_job($1, 1, $2, $3, $4, $5)', [a.accountId, randomUUID(), projectId, 'research', digest]);
      expect(accepted.outcome).toBe('created');
      expect((await call('select * from api.move_attempt($1, 1, $2, $3, $4, $5)', [a.accountId, randomUUID(), accepted.attempt_id, 'running', null])).outcome).toBe('moved');
      const step = await call('select * from api.begin_step($1, 1, $2, $3, $4, $5)', [a.accountId, randomUUID(), accepted.attempt_id, 'search', 1]);
      expect(step.outcome).toBe('created');
      expect((await call('select * from api.advance_operation($1, 1, $2, $3, $4, $5)', [a.accountId, randomUUID(), step.operation_id, 'dispatched', null])).outcome).toBe('advanced');
      expect((await call('select * from api.move_attempt($1, 1, $2, $3, $4, $5)', [a.accountId, randomUUID(), accepted.attempt_id, 'failed', 'step_failed'])).outcome).toBe('moved');
      expect((await call('select * from api.request_retry($1, 1, $2, $3, 1, $4)', [a.accountId, randomUUID(), accepted.job_id, digest])).outcome).toBe('created');
      return accepted.job_id as string;
    };
    await db.query('begin');
    try {
      await makeJob(doomed);
      await makeJob(kept);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }

    // The Usage ledger rows of each Project's operation (Story 2.6): a reservation, a settlement that is above it, and the overrun incident that made, as the owner makes them.
    const periodId = (await db.query('select id from usage.periods where account_id = $1', [a.accountId])).rows[0].id as string;
    for (const projectId of [doomed, kept]) {
      const operation = (
        await db.query(
          `select o.id, j.id as job_id from jobs.operations o join jobs.steps s on s.id = o.step_id join jobs.attempts t on t.id = s.attempt_id join jobs.jobs j on j.id = t.job_id where j.project_id = $1`,
          [projectId],
        )
      ).rows[0];
      const reservationId = await insertReservation(db, {accountId: a.accountId, periodId, jobId: operation.job_id, operationId: operation.id, amount: 1_000_000});
      const settlementId = await insertSettlement(db, {accountId: a.accountId, reservationId, periodId, classification: 'evidence', settled: 1_500_000});
      await insertIncident(db, {accountId: a.accountId, reservationId, settlementId});
    }
    // The ledger rows of a Project, by the Project (through its Jobs).
    const ledgerOf = async (projectId: string) =>
      (
        await db.query(
          `select (select count(*) from usage.reservations r join jobs.jobs j on j.id = r.job_id where j.project_id = $1)::int as reservations,
                  (select count(*) from usage.settlements s join usage.reservations r on r.id = s.reservation_id join jobs.jobs j on j.id = r.job_id where j.project_id = $1)::int as settlements,
                  (select count(*) from usage.overrun_incidents i join usage.reservations r on r.id = i.reservation_id join jobs.jobs j on j.id = r.job_id where j.project_id = $1)::int as incidents`,
          [projectId],
        )
      ).rows[0] as Record<'reservations' | 'settlements' | 'incidents', number>;
    expect(await ledgerOf(doomed)).toEqual({reservations: 1, settlements: 1, incidents: 1});
    expect(await ledgerOf(kept)).toEqual({reservations: 1, settlements: 1, incidents: 1});

    // Every family of the Job records of a Project, by the Project.
    const familiesOf = async (projectId: string) =>
      (
        await db.query(
          `select (select count(*) from jobs.jobs j where j.project_id = $1)::int as jobs,
                  (select count(*) from jobs.attempts t join jobs.jobs j on j.id = t.job_id where j.project_id = $1)::int as attempts,
                  (select count(*) from jobs.steps s join jobs.attempts t on t.id = s.attempt_id join jobs.jobs j on j.id = t.job_id where j.project_id = $1)::int as steps,
                  (select count(*) from jobs.operations o join jobs.steps s on s.id = o.step_id join jobs.attempts t on t.id = s.attempt_id join jobs.jobs j on j.id = t.job_id where j.project_id = $1)::int as operations`,
          [projectId],
        )
      ).rows[0] as Record<'jobs' | 'attempts' | 'steps' | 'operations', number>;
    const projectsOf = async (projectId: string) => (await db.query('select count(*)::int as n from projects.projects where id = $1', [projectId])).rows[0].n as number;
    const receipts = async () => (await db.query('select count(*)::int as n from jobs.commands where account_id = $1', [a.accountId])).rows[0].n as number;
    expect(await familiesOf(doomed)).toEqual({jobs: 1, attempts: 2, steps: 1, operations: 1});
    expect(await familiesOf(kept)).toEqual({jobs: 1, attempts: 2, steps: 1, operations: 1});
    const receiptsBefore = await receipts();
    expect(receiptsBefore).toBe(2 * 6);

    // A Job restricts its Project (23503 for anyone who tries to delete it directly), so --remove must take the Job records first. A reservation restricts its Job and
    // its operation in turn, and its settlement and incident restrict it: the ledger rows go before the Job records.
    const direct = await db.query('delete from projects.projects where id = $1', [doomed]).then(() => 'deleted', (error: {code?: string}) => error.code);
    expect(direct).toBe('23503');
    const directJob = await db.query('delete from jobs.jobs where project_id = $1', [doomed]).then(() => 'deleted', (error: {code?: string}) => error.code);
    expect(directJob).toBe('23503');

    const removed = await run(['--remove', '--email', a.email]);
    expect(removed.code, removed.stderr).toBe(0);
    expect(removed.stdout).toContain(`Removed ${projectFixtures.length} fixture Project`);
    // Gone: the Project, and every Job, attempt, step and operation of it.
    expect(await projectsOf(doomed)).toBe(0);
    expect(await familiesOf(doomed)).toEqual({jobs: 0, attempts: 0, steps: 0, operations: 0});
    expect(await ledgerOf(doomed)).toEqual({reservations: 0, settlements: 0, incidents: 0});
    // Not a fixture by title: the other Project keeps its Job, attempts, step and operation, and its reservation, settlement and incident.
    expect(await projectsOf(kept)).toBe(1);
    expect(await familiesOf(kept)).toEqual({jobs: 1, attempts: 2, steps: 1, operations: 1});
    expect(await ledgerOf(kept)).toEqual({reservations: 1, settlements: 1, incidents: 1});
    // The receipts of the commands are the Account's, and stay (as the script's comment says).
    expect(await receipts()).toBe(receiptsBefore);
  });
});
