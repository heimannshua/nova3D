import {createHash, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {acceptJob, advanceOperation, beginStep, moveAttempt, readJob, requestRetry} from '@/lib/job-records';
import {createHarness, sha, stack} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 2.11 against the Supabase CLI stack: the Jobs-owned closed schema `jobs` (Jobs, attempts, steps, operations and the immutable receipts of their
// commands), the guarded states, the gate that holds a retry back while an earlier operation is potentially chargeable, the one derived public state, and the six
// api functions: accept_job, begin_step, advance_operation, move_attempt, request_retry and read_job. Most cases run inside a transaction that is rolled back, as the
// service role. The cases that need several real connections (the same command twice at once, a retry racing a reconcile, a step racing a tombstone) and the typed
// calls the application will make commit data that is removed afterwards (tests/support/accounts-data.ts deletes the jobs rows first).

const {db, connect, committed, inTx, addUser, attempt, rows, count} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

// Fixtures ----------------------------------------------------------------------------------------------------------------------

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

/** A Project, inserted directly (the owner can). */
async function project(client: Client, owner: Fixture, options: {deleted?: boolean} = {}): Promise<string> {
  const {rows: made} = await client.query(
    `insert into projects.projects (workspace_id, account_id, title, stage, deleted_at) values ($1, $2, 'Courtyard bench', 'researching', case when $3 then now() end) returning id`,
    [owner.workspaceId, owner.accountId, options.deleted === true],
  );
  return made[0].id as string;
}

const run = async (client: Client, sql: string, params: unknown[]) => (await rows(client, 'service_role', sql, params))[0];
const svc = run;
const D = (label: string) => sha(label);

const ACCEPT = 'select * from api.accept_job($1, $2, $3, $4, $5, $6)';
const BEGIN = 'select * from api.begin_step($1, $2, $3, $4, $5, $6)';
const ADVANCE = 'select * from api.advance_operation($1, $2, $3, $4, $5, $6)';
const MOVE = 'select * from api.move_attempt($1, $2, $3, $4, $5, $6)';
const RETRY = 'select * from api.request_retry($1, $2, $3, $4, $5, $6)';
const READ = 'select * from api.read_job($1, $2, $3)';

/** The six commands as the application sends them for one Account (the epoch can be overridden to provoke a refusal). */
function commands(client: Client, who: {accountId: string; epoch: number}, direct = false) {
  // `direct`: for the cases that commit, outside the harness's transaction (there is no savepoint to take).
  const call = direct ? async (sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0] : (sql: string, params: unknown[]) => run(client, sql, params);
  return {
    accept: (projectId: string, o: {command?: string; kind?: string; digest?: string; epoch?: number} = {}) =>
      call(ACCEPT, [who.accountId, o.epoch ?? who.epoch, o.command ?? randomUUID(), projectId, o.kind ?? 'research', o.digest ?? D('input')]),
    begin: (attemptId: string, key: string, ordinal: number | null = null, o: {command?: string; epoch?: number} = {}) =>
      call(BEGIN, [who.accountId, o.epoch ?? who.epoch, o.command ?? randomUUID(), attemptId, key, ordinal]),
    advance: (operationId: string, to: string, requestId: string | null = null, o: {command?: string; epoch?: number} = {}) =>
      call(ADVANCE, [who.accountId, o.epoch ?? who.epoch, o.command ?? randomUUID(), operationId, to, requestId]),
    move: (attemptId: string, to: string, reason: string | null = null, o: {command?: string; epoch?: number} = {}) =>
      call(MOVE, [who.accountId, o.epoch ?? who.epoch, o.command ?? randomUUID(), attemptId, to, reason]),
    retry: (jobId: string, expected: number, o: {command?: string; digest?: string; epoch?: number} = {}) =>
      call(RETRY, [who.accountId, o.epoch ?? who.epoch, o.command ?? randomUUID(), jobId, expected, o.digest ?? D('retry')]),
    read: (jobId: string, o: {epoch?: number} = {}) => call(READ, [who.accountId, o.epoch ?? who.epoch, jobId]),
  };
}

type Cmds = ReturnType<typeof commands>;

/** A Job whose attempt 1 is running. */
async function started(client: Client, who: Fixture, projectId?: string, direct = false) {
  const c = commands(client, who, direct);
  const pid = projectId ?? (await project(client, who));
  const accepted = await c.accept(pid);
  expect(accepted.outcome).toBe('created');
  const moved = await c.move(accepted.attempt_id, 'running');
  expect(moved.outcome).toBe('moved');
  return {c, projectId: pid, jobId: accepted.job_id as string, attemptId: accepted.attempt_id as string};
}

/** A step with one operation in a running attempt. */
async function stepWithOperation(c: Cmds, attemptId: string, key = 'search', ordinal = 1) {
  const begun = await c.begin(attemptId, key, ordinal);
  expect(begun.outcome).toBe('created');
  return {stepId: begun.step_id as string, operationId: begun.operation_id as string};
}

/** Attempt 1 failed with one operation in the given state (dispatched, ambiguous, completed, noncharge, settled, planned), and the retry waiting as attempt 2. */
async function failedWith(client: Client, who: Fixture, operationState: 'planned' | 'dispatched' | 'ambiguous' | 'completed' | 'noncharge' | 'settled' | 'none', direct = false) {
  const job = await started(client, who, undefined, direct);
  const {c} = job;
  let operationId: string | null = null;
  if (operationState !== 'none') {
    operationId = (await stepWithOperation(c, job.attemptId)).operationId;
    const path: Record<string, [string, string | null][]> = {
      planned: [],
      dispatched: [['dispatched', null]],
      ambiguous: [['dispatched', null], ['ambiguous', null]],
      completed: [['dispatched', null], ['completed', null]],
      noncharge: [['dispatched', null], ['noncharge', 'req_noncharge_1']],
      settled: [['dispatched', null], ['ambiguous', null], ['settled', null]],
    };
    for (const [to, requestId] of path[operationState]) expect((await c.advance(operationId, to, requestId)).outcome).toBe('advanced');
  }
  expect((await c.move(job.attemptId, 'failed', 'step_failed')).outcome).toBe('moved');
  return {...job, operationId};
}

const attemptRow = async (client: Client, id: string) =>
  (await client.query('select id, job_id, number, previous_attempt_id, input_digest, state, stage, reason, created_at, started_at, ended_at from jobs.attempts where id = $1', [id])).rows[0];
const operationRow = async (client: Client, id: string) =>
  (await client.query('select id, step_id, ordinal, state, request_id, created_at, dispatched_at, outcome_at from jobs.operations where id = $1', [id])).rows[0];
const tables = ['jobs', 'attempts', 'steps', 'operations', 'commands'] as const;
const counts = async (client: Client, accountId: string) => {
  const found: Record<string, number> = {};
  // One query at a time on one connection.
  for (const table of tables) found[table] = await count(client, `select count(*) as n from jobs.${table} where account_id = $1`, [accountId]);
  return found as Record<(typeof tables)[number], number>;
};
const commandRows = async (client: Client, accountId: string) =>
  (await client.query('select command_id, kind, digest, subject_id, created_at from jobs.commands where account_id = $1 order by created_at', [accountId])).rows;

/** The digest the commands build: SHA-256 of each part as `<byte length>:<value>` (a dash for none), the kind first. */
const part = (value: string | null) => (value === null ? '-' : `${Buffer.byteLength(value, 'utf8')}:${value}`);
const digestOf = (kind: string, ...args: (string | null)[]) => createHash('sha256').update([kind, ...args].map(part).join(''), 'utf8').digest('hex');

/** Waits until the backend is waiting for a lock. */
async function untilBlocked(pid: number) {
  for (let round = 0; round < 200; round += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The backend never waited for a lock.');
}

// ---------------------------------------------------------------------------------------------------
describe('access: the jobs schema is closed, and only the service role reaches the six api functions', () => {
  it('is a schema that no browser role, no API role, not the gateway and not PUBLIC can use or create in, and whose default privileges grant nothing', async () => {
    for (const role of ['anon', 'authenticated', 'service_role', 'nova3d_gateway']) {
      const {rows: found} = await db.query(`select has_schema_privilege($1, 'jobs', 'usage') as usage, has_schema_privilege($1, 'jobs', 'create') as "create"`, [role]);
      expect(found[0], role).toEqual({usage: false, create: false});
    }
    const {rows: acl} = await db.query(`select a.grantee::regrole::text as grantee from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'jobs' and a.grantee <> n.nspowner`);
    expect(acl).toEqual([]);
    const {rows: publicGrants} = await db.query(`select 1 from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'jobs' and a.grantee = 0`);
    expect(publicGrants).toEqual([]);
    const {rows: defaults} = await db.query(
      `select d.defaclobjtype as kind, a.grantee from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
        where n.nspname = 'jobs' and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))`,
    );
    expect(defaults).toEqual([]);
  });

  it('has exactly five tables, all with row-level security on, no policy, and no privilege for any role or PUBLIC', async () => {
    const {rows: found} = await db.query(
      `select c.relname as name, c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies,
              (select count(*)::int from aclexplode(c.relacl) a where a.grantee <> c.relowner) as other_grants
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'jobs' and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1`,
    );
    expect(found).toEqual(['attempts', 'commands', 'jobs', 'operations', 'steps'].map((name) => ({name, rls: true, policies: 0, other_grants: 0})));
    for (const role of ['anon', 'authenticated', 'service_role', 'nova3d_gateway']) {
      for (const table of ['jobs', 'attempts', 'steps', 'operations', 'commands']) {
        const {rows: held} = await db.query(
          `select has_table_privilege($1, $2, 'select,insert,update,delete,truncate,references,trigger') as can, has_any_column_privilege($1, $2, 'select,insert,update,references') as column_can`,
          [role, `jobs.${table}`],
        );
        expect(held[0], `${role} on jobs.${table}`).toEqual({can: false, column_can: false});
      }
    }
    const {rows: sequences} = await db.query(`select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'jobs' and c.relkind = 'S'`);
    expect(sequences).toEqual([]);
  });

  it('refuses the service role and the browser roles every direct read or write of a table, and every internal function: it reaches Jobs only through the api schema', async () => {
    await inTx(async (client) => {
      for (const sql of [
        'select * from jobs.jobs',
        'select * from jobs.attempts',
        'select * from jobs.steps',
        'select * from jobs.operations',
        'select * from jobs.commands',
        'delete from jobs.jobs',
        'insert into jobs.commands (account_id, command_id, kind, digest, subject_id) values (gen_random_uuid(), gen_random_uuid(), $$accept_job$$, repeat($$a$$, 64), gen_random_uuid())',
        'select jobs.charge_open(gen_random_uuid(), 2)',
        'select * from jobs.public_state(gen_random_uuid())',
        'select jobs.derived_reason(gen_random_uuid(), 1, $$waiting$$, null)',
        'select jobs.hold_project(gen_random_uuid(), gen_random_uuid())',
        'select jobs.command_digest($$accept_job$$, array[$$a$$])',
      ]) {
        for (const role of ['service_role', 'anon', 'authenticated', 'nova3d_gateway']) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.code, `${role}: ${sql}`).toBe('42501');
        }
      }
    });
  });

  it('holds exactly the functions the migration describes, each with its search path pinned, an explicit ACL, and an execute grant to nobody', async () => {
    const {rows: functions} = await db.query(
      `select p.proname as name, p.proconfig as config, p.proacl is null as default_acl,
              (select count(*)::int from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) as other_grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'jobs' order by 1`,
    );
    expect(functions.map((fn) => fn.name)).toEqual([
      'charge_open',
      'check_attempt',
      'check_operation',
      'check_step',
      'command_digest',
      'derived_reason',
      'guard_attempt_change',
      'guard_operation_change',
      'hold_project',
      'public_state',
      'record_command',
      'refuse_change',
    ]);
    for (const fn of functions) {
      expect(fn.default_acl, `jobs.${fn.name} has an explicit ACL`).toBe(false);
      expect(String(fn.config), `jobs.${fn.name} pins search_path`).toContain('search_path=');
      expect(fn.other_grantees, `jobs.${fn.name} is executable by nobody else`).toBe(0);
    }
  });

  it('reads the Job in one snapshot: the helpers it asks are stable, and the read is one statement that reads the attempts once', async () => {
    const {rows: found} = await db.query(
      `select n.nspname || '.' || p.proname as name, p.provolatile as volatility, pg_get_functiondef(p.oid) as def
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'jobs' and p.proname in ('charge_open', 'derived_reason', 'public_state')) or (n.nspname = 'api' and p.proname = 'read_job') order by 1`,
    );
    const byName = Object.fromEntries(found.map((fn) => [fn.name, fn]));
    // A stable function reads the snapshot of the statement that calls it, so the helpers inside the one statement of the read see what that statement sees.
    for (const name of ['jobs.charge_open', 'jobs.derived_reason', 'jobs.public_state']) expect(byName[name].volatility, name).toBe('s');
    // The read itself stays volatile (its authority check takes the Account's row FOR SHARE, which PostgREST's read-only transaction for a stable function refuses),
    // so it must not use two statements for the Job and its attempts: one statement, one snapshot.
    expect(byName['api.read_job'].volatility).toBe('v');
    const definition = (byName['api.read_job'].def as string).replace(/--.*$/gm, '');
    expect(definition.match(/FROM jobs\.attempts/gi)).toHaveLength(1);
    expect(definition.match(/jobs\.public_state\(/g)).toHaveLength(1);
    expect(definition.match(/jobs\.derived_reason\(/g)).toHaveLength(1);
    expect(definition).not.toMatch(/\bfor (?:update|share)\b/i);
    expect(definition).not.toMatch(/\b(?:insert into|update jobs|delete from|pg_advisory)/i);
    // And a stable function really is a read-only caller: it cannot write.
    expect(definition).not.toMatch(/record_command/);
  });

  it('puts the six api functions in the api schema, running as their owner with an empty search path, executable by the service role alone, with exactly these arguments and results', async () => {
    const {rows: found} = await db.query(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
              coalesce((select array_agg(a.grantee::regrole::text order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api' and p.proname in ('accept_job', 'begin_step', 'advance_operation', 'move_attempt', 'request_retry', 'read_job') order by 1`,
    );
    expect(found.map((fn) => fn.name)).toEqual(['accept_job', 'advance_operation', 'begin_step', 'move_attempt', 'read_job', 'request_retry']);
    for (const fn of found) {
      expect(fn.definer, fn.name).toBe(true);
      expect(fn.config, fn.name).toEqual(['search_path=""']);
      expect(fn.grantees, fn.name).toEqual(['service_role']);
    }
    const byName = Object.fromEntries(found.map((fn) => [fn.name, fn]));
    expect(byName.accept_job.args).toBe('p_account_id uuid, p_epoch bigint, p_command_id uuid, p_project_id uuid, p_kind text, p_input_digest text');
    expect(byName.accept_job.result).toBe('api.job_acceptance');
    expect(byName.begin_step.args).toBe('p_account_id uuid, p_epoch bigint, p_command_id uuid, p_attempt_id uuid, p_step_key text, p_ordinal integer DEFAULT NULL::integer');
    expect(byName.begin_step.result).toBe('api.step_beginning');
    expect(byName.advance_operation.args).toBe('p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_to text, p_request_id text DEFAULT NULL::text');
    expect(byName.advance_operation.result).toBe('api.operation_advance');
    expect(byName.move_attempt.args).toBe('p_account_id uuid, p_epoch bigint, p_command_id uuid, p_attempt_id uuid, p_to text, p_reason text DEFAULT NULL::text');
    expect(byName.move_attempt.result).toBe('api.attempt_move');
    expect(byName.request_retry.args).toBe('p_account_id uuid, p_epoch bigint, p_command_id uuid, p_job_id uuid, p_expected_number integer, p_input_digest text');
    expect(byName.request_retry.result).toBe('api.retry_request');
    // The read takes no command ID.
    expect(byName.read_job.args).toBe('p_account_id uuid, p_epoch bigint, p_job_id uuid');
    expect(byName.read_job.result).toBe('api.job_view');
    // The result types do not clash with the scheduled-job ones (api.job_claim, api.job_finish, api.job_last).
    const {rows: types} = await db.query(`select t.typname as name from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'api' and t.typname like 'job\\_%' order by 1`);
    expect(types.map((type) => type.name)).toEqual(['job_acceptance', 'job_claim', 'job_finish', 'job_last', 'job_view']);
  });

  it.each(['anon', 'authenticated'])('refuses %s every one of the six at the database, with a permission error, and writes nothing', async (role) => {
    await inTx(async (client) => {
      const who = await account(client);
      const pid = await project(client, who);
      const calls: [string, unknown[]][] = [
        [ACCEPT, [who.accountId, who.epoch, randomUUID(), pid, 'research', D('x')]],
        [BEGIN, [who.accountId, who.epoch, randomUUID(), randomUUID(), 'search', null]],
        [ADVANCE, [who.accountId, who.epoch, randomUUID(), randomUUID(), 'dispatched', null]],
        [MOVE, [who.accountId, who.epoch, randomUUID(), randomUUID(), 'running', null]],
        [RETRY, [who.accountId, who.epoch, randomUUID(), randomUUID(), 1, D('x')]],
        [READ, [who.accountId, who.epoch, randomUUID()]],
      ];
      for (const [sql, params] of calls) {
        const result = await attempt(client, role, sql, params);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.message, sql).toMatch(/permission denied for schema api/);
      }
      expect(await counts(client, who.accountId)).toEqual({jobs: 0, attempts: 0, steps: 0, operations: 0, commands: 0});
    });
  });

  it('refuses the browser roles over REST with a permission error, and lets the service role in', async () => {
    const bodies: Record<string, unknown> = {
      accept_job: {p_account_id: randomUUID(), p_epoch: 1, p_command_id: randomUUID(), p_project_id: randomUUID(), p_kind: 'research', p_input_digest: D('x')},
      begin_step: {p_account_id: randomUUID(), p_epoch: 1, p_command_id: randomUUID(), p_attempt_id: randomUUID(), p_step_key: 'search', p_ordinal: null},
      advance_operation: {p_account_id: randomUUID(), p_epoch: 1, p_command_id: randomUUID(), p_operation_id: randomUUID(), p_to: 'dispatched', p_request_id: null},
      move_attempt: {p_account_id: randomUUID(), p_epoch: 1, p_command_id: randomUUID(), p_attempt_id: randomUUID(), p_to: 'running', p_reason: null},
      request_retry: {p_account_id: randomUUID(), p_epoch: 1, p_command_id: randomUUID(), p_job_id: randomUUID(), p_expected_number: 1, p_input_digest: D('x')},
      read_job: {p_account_id: randomUUID(), p_epoch: 1, p_job_id: randomUUID()},
    };
    const post = (key: string, name: string, body: unknown) =>
      fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-profile': 'api'},
        body: JSON.stringify(body),
      });
    for (const [name, body] of Object.entries(bodies)) {
      const refused = await post(stack.anonKey, name, body);
      expect(refused.status, name).toBeGreaterThanOrEqual(401);
      expect(refused.status, name).toBeLessThan(500);
      expect((await refused.json()).code, name).toBe('42501');
      // The tables themselves are not exposed by the Data API at all.
    }
    for (const table of ['jobs', 'attempts', 'steps', 'operations', 'commands']) {
      const read = await fetch(`${stack.apiUrl}/rest/v1/${table}?select=*`, {headers: {apikey: stack.serviceKey, authorization: `Bearer ${stack.serviceKey}`, 'accept-profile': 'jobs'}});
      expect(read.status, table).toBeGreaterThanOrEqual(400);
    }
    // The service role gets an answer (an Account that does not exist is `denied`), which proves the functions are reachable by the one role meant to call them.
    for (const [name, body] of Object.entries(bodies)) {
      const answered = await post(stack.serviceKey, name, body);
      expect(answered.status, name).toBe(200);
      expect((await answered.json()).outcome, name).toBe('denied');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the tables: ownership, shape and uniqueness', () => {
  it('keys every row to its Account with RESTRICT, and a Job to its own Project through the composite key (a Job cannot name another Account\'s Project)', async () => {
    const {rows: keys} = await db.query(
      `select c.conrelid::regclass::text as table_name, c.conname as name, pg_get_constraintdef(c.oid) as def, c.confdeltype as on_delete
         from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'jobs' and c.contype = 'f' order by 1, 2`,
    );
    const defs = Object.fromEntries(keys.map((key) => [`${key.table_name}.${key.name}`, key]));
    expect(defs['jobs.jobs.jobs_project_fkey'].def).toContain('FOREIGN KEY (project_id, account_id) REFERENCES projects.projects(id, account_id)');
    expect(defs['jobs.attempts.attempts_job_fkey'].def).toContain('FOREIGN KEY (job_id, account_id) REFERENCES jobs.jobs(id, account_id)');
    expect(defs['jobs.steps.steps_attempt_fkey'].def).toContain('FOREIGN KEY (attempt_id, account_id) REFERENCES jobs.attempts(id, account_id)');
    expect(defs['jobs.operations.operations_step_fkey'].def).toContain('FOREIGN KEY (step_id, account_id) REFERENCES jobs.steps(id, account_id)');
    expect(defs['jobs.attempts.attempts_previous_fkey'].def).toContain('FOREIGN KEY (previous_attempt_id, job_id, account_id) REFERENCES jobs.attempts(id, job_id, account_id)');
    for (const name of ['jobs.jobs.jobs_project_fkey', 'jobs.attempts.attempts_job_fkey', 'jobs.steps.steps_attempt_fkey', 'jobs.operations.operations_step_fkey']) {
      expect(defs[name].on_delete, name).toBe('r');
    }
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const foreign = await project(client, b);
      const refused = await attempt(client, null, `insert into jobs.jobs (account_id, project_id, kind) values ($1, $2, 'research')`, [a.accountId, foreign]);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('23503');
      const own = await project(client, a);
      expect((await attempt(client, null, `insert into jobs.jobs (account_id, project_id, kind) values ($1, $2, 'research')`, [a.accountId, own])).ok).toBe(true);
      // An attempt, a step and an operation cannot name a parent of another Account either.
      const c = await started(client, a);
      const step = await stepWithOperation(c.c, c.attemptId);
      const other = await started(client, b);
      for (const [sql, params] of [
        [`insert into jobs.attempts (account_id, job_id, number, input_digest, state, stage) values ($1, $2, 2, $3, 'waiting', 'retry')`, [b.accountId, c.jobId, D('x')]],
        [`insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, 'other')`, [b.accountId, c.attemptId]],
        [`insert into jobs.operations (account_id, step_id, ordinal, state) values ($1, $2, 2, 'planned')`, [b.accountId, step.stepId]],
        [`insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, 'other')`, [a.accountId, other.attemptId]],
      ] as [string, unknown[]][]) {
        const result = await attempt(client, null, sql, params);
        expect(result.ok, sql).toBe(false);
        // The table's own trigger may judge an attempt first (23514); the composite key judges the rest (23503).
        if (!result.ok) expect(['23503', '23514'], sql).toContain(result.code);
      }
    });
  });

  it('shapes the columns: a kind, a stage and a step key are lower-case words, a digest is 64 hex digits, an ordinal is 1 to 100, and a request ID is printable ASCII without spaces', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const pid = await project(client, a);
      for (const kind of ['', 'Research', '1research', 're search', 're-search', 'x'.repeat(41), 'résumé']) {
        const result = await attempt(client, null, `insert into jobs.jobs (account_id, project_id, kind) values ($1, $2, $3)`, [a.accountId, pid, kind]);
        expect(result.ok, kind).toBe(false);
        if (!result.ok) expect(result.code, kind).toBe('23514');
      }
      for (const kind of ['r', 'x'.repeat(40), 'deep_research_2']) {
        expect((await attempt(client, null, `insert into jobs.jobs (account_id, project_id, kind) values ($1, $2, $3)`, [a.accountId, pid, kind])).ok, kind).toBe(true);
      }
      const job = await started(client, a, pid);
      for (const key of ['', 'Search', '9search', 'a b', 'x'.repeat(41)]) {
        const result = await attempt(client, null, `insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, $3)`, [a.accountId, job.attemptId, key]);
        expect(result.ok, key).toBe(false);
        if (!result.ok) expect(result.code, key).toBe('23514');
      }
      const step = await attempt(client, null, `insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, 'ok') returning id`, [a.accountId, job.attemptId]);
      expect(step.ok).toBe(true);
      const stepId = step.ok ? step.rows[0].id : '';
      for (const ordinal of [0, 101, -1]) {
        const result = await attempt(client, null, `insert into jobs.operations (account_id, step_id, ordinal, state) values ($1, $2, $3, 'planned')`, [a.accountId, stepId, ordinal]);
        expect(result.ok, String(ordinal)).toBe(false);
        if (!result.ok) expect(result.code, String(ordinal)).toBe('23514');
      }
      for (const ordinal of [1, 100]) {
        expect((await attempt(client, null, `insert into jobs.operations (account_id, step_id, ordinal, state) values ($1, $2, $3, 'planned')`, [a.accountId, stepId, ordinal])).ok, String(ordinal)).toBe(true);
      }
      // A request ID is checked by the table whoever writes it.
      const op = (await stepWithOperation(job.c, job.attemptId, 'checked', 1)).operationId;
      expect((await job.c.advance(op, 'dispatched')).outcome).toBe('advanced');
      for (const bad of ['', 'has space', 'tab\there', 'é', 'x'.repeat(201), 'new\nline']) {
        const result = await attempt(client, null, `update jobs.operations set state = 'ambiguous', request_id = $2, outcome_at = now() where id = $1`, [op, bad]);
        expect(result.ok, JSON.stringify(bad)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(bad)).toBe('23514');
      }
    });
  });

  it('is unique by (Job, number) for an attempt, by (attempt, step key) for a step and by (step, ordinal) for an operation, and has at most one open attempt for a Job', async () => {
    const {rows: uniques} = await db.query(
      `select i.indexrelid::regclass::text as name, pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'jobs' and i.indisunique and not i.indisprimary order by 1`,
    );
    const defs = uniques.map((row) => row.def as string);
    expect(defs.some((def) => def.includes('ON jobs.attempts USING btree (job_id, number)'))).toBe(true);
    expect(defs.some((def) => def.includes('ON jobs.steps USING btree (attempt_id, step_key)'))).toBe(true);
    expect(defs.some((def) => def.includes('ON jobs.operations USING btree (step_id, ordinal)'))).toBe(true);
    expect(defs.some((def) => /ON jobs\.attempts USING btree \(job_id\) WHERE \(state = ANY \(ARRAY\['waiting'::text, 'running'::text\]\)\)/.test(def))).toBe(true);
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const step = await stepWithOperation(job.c, job.attemptId);
      for (const [sql, params] of [
        [`insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, 'search')`, [a.accountId, job.attemptId]],
        [`insert into jobs.operations (account_id, step_id, ordinal, state) values ($1, $2, 1, 'planned')`, [a.accountId, step.stepId]],
        [`insert into jobs.attempts (account_id, job_id, number, input_digest, state, stage) values ($1, $2, 1, $3, 'waiting', 'accepted')`, [a.accountId, job.jobId, D('x')]],
      ] as [string, unknown[]][]) {
        const result = await attempt(client, null, sql, params);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(['23505', '23514'], sql).toContain(result.code);
      }
      // A second open attempt of one Job is refused whatever its number, even with the right link.
      const attemptOne = await attemptRow(client, job.attemptId);
      const second = await attempt(
        client,
        null,
        `insert into jobs.attempts (account_id, job_id, number, previous_attempt_id, input_digest, state, stage) values ($1, $2, 2, $3, $4, 'waiting', 'retry')`,
        [a.accountId, job.jobId, attemptOne.id, D('x')],
      );
      expect(second.ok).toBe(false);
    });
  });

  it('creates an attempt only waiting, as number 1 at stage accepted or as the next number linked to a FAILED attempt at stage retry, whoever writes it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const pid = await project(client, a);
      const job = (await client.query(`insert into jobs.jobs (account_id, project_id, kind) values ($1, $2, 'research') returning id`, [a.accountId, pid])).rows[0].id as string;
      const insert = (number: number, previous: string | null, state: string, stage: string, extra = '') =>
        attempt(
          client,
          null,
          `insert into jobs.attempts (account_id, job_id, number, previous_attempt_id, input_digest, state, stage${extra ? ', ' + extra.split('=')[0] : ''})
           values ($1, $2, $3, $4, $5, $6, $7${extra ? ', ' + extra.split('=')[1] : ''}) returning id`,
          [a.accountId, job, number, previous, D('x'), state, stage],
        );
      // The first attempt: number 1, no link, waiting, accepted.
      for (const bad of [await insert(2, null, 'waiting', 'accepted'), await insert(1, null, 'running', 'accepted'), await insert(1, null, 'waiting', 'retry'), await insert(1, null, 'waiting', 'started')]) {
        expect(bad.ok).toBe(false);
      }
      const first = await insert(1, null, 'waiting', 'accepted');
      expect(first.ok).toBe(true);
      const firstId = first.ok ? first.rows[0].id : '';
      // A later attempt follows only a failed attempt.
      expect((await insert(2, firstId, 'waiting', 'retry')).ok).toBe(false);
      await client.query(`update jobs.attempts set state = 'running', stage = 'started', started_at = now() where id = $1`, [firstId]);
      expect((await insert(2, firstId, 'waiting', 'retry')).ok).toBe(false);
      await client.query(`update jobs.attempts set state = 'failed', reason = 'step_failed', ended_at = now() where id = $1`, [firstId]);
      for (const bad of [await insert(3, firstId, 'waiting', 'retry'), await insert(2, null, 'waiting', 'retry'), await insert(2, firstId, 'waiting', 'accepted'), await insert(2, firstId, 'running', 'retry')]) {
        expect(bad.ok).toBe(false);
      }
      expect((await insert(2, firstId, 'waiting', 'retry')).ok).toBe(true);
    });
  });

  it('adds a step and an operation to a running attempt only, whoever writes it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const waiting = await commands(client, a).accept(await project(client, a));
      const toWaiting = await attempt(client, null, `insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, 'search')`, [a.accountId, waiting.attempt_id]);
      expect(toWaiting.ok).toBe(false);
      const job = await started(client, a);
      const step = await stepWithOperation(job.c, job.attemptId);
      expect((await attempt(client, null, `insert into jobs.operations (account_id, step_id, ordinal, state) values ($1, $2, 2, 'dispatched')`, [a.accountId, step.stepId])).ok).toBe(false);
      expect((await job.c.move(job.attemptId, 'failed', 'step_failed')).outcome).toBe('moved');
      const afterEnd = await attempt(client, null, `insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, 'late')`, [a.accountId, job.attemptId]);
      expect(afterEnd.ok).toBe(false);
      const operationAfterEnd = await attempt(client, null, `insert into jobs.operations (account_id, step_id, ordinal, state) values ($1, $2, 2, 'planned')`, [a.accountId, step.stepId]);
      expect(operationAfterEnd.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.accept_job: a Job and its first attempt', () => {
  it('creates one Job and attempt 1: waiting, stage accepted, reason awaiting_dispatch, with the kind and digest it was given and a receipt', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const pid = await project(client, a);
      const answer = await commands(client, a).accept(pid, {kind: 'deep_research', digest: D('input one')});
      expect(answer).toMatchObject({outcome: 'created', attempt_number: 1, state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch'});
      const job = (await client.query('select id, account_id, project_id, kind, created_at from jobs.jobs where account_id = $1', [a.accountId])).rows;
      expect(job).toHaveLength(1);
      expect(job[0]).toMatchObject({id: answer.job_id, project_id: pid, kind: 'deep_research'});
      const row = await attemptRow(client, answer.attempt_id);
      expect(row).toMatchObject({job_id: answer.job_id, number: 1, previous_attempt_id: null, input_digest: D('input one'), state: 'waiting', stage: 'accepted', reason: null, started_at: null, ended_at: null});
      expect(await counts(client, a.accountId)).toEqual({jobs: 1, attempts: 1, steps: 0, operations: 0, commands: 1});
    });
  });

  it('records a receipt whose digest is SHA-256 over the length-prefixed kind and every argument except the Account, the epoch and the command ID', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const pid = await project(client, a);
      const command = randomUUID();
      const answer = await commands(client, a).accept(pid, {command, kind: 'research', digest: D('x')});
      const [receipt] = await commandRows(client, a.accountId);
      expect(receipt).toMatchObject({command_id: command, kind: 'accept_job', digest: digestOf('accept_job', pid, 'research', D('x')), subject_id: answer.job_id});
    });
  });

  it('answers `replayed` for the same command: the same Job and attempt, one row of each, one receipt', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const pid = await project(client, a);
      const c = commands(client, a);
      const command = randomUUID();
      const first = await c.accept(pid, {command});
      const again = await c.accept(pid, {command});
      expect(again).toMatchObject({outcome: 'replayed', job_id: first.job_id, attempt_id: first.attempt_id, attempt_number: 1, state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch'});
      expect(await counts(client, a.accountId)).toEqual({jobs: 1, attempts: 1, steps: 0, operations: 0, commands: 1});
      // The replay shows attempt 1 as it is now.
      expect((await c.move(first.attempt_id, 'running')).outcome).toBe('moved');
      expect(await c.accept(pid, {command})).toMatchObject({outcome: 'replayed', job_id: first.job_id, state: 'running', stage: 'started', reason: null});
    });
  });

  it('answers `reused` for the same command ID with another kind, Project or digest, and writes nothing; another command ID makes another Job', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const pid = await project(client, a);
      const other = await project(client, a);
      const c = commands(client, a);
      const command = randomUUID();
      await c.accept(pid, {command, kind: 'research', digest: D('x')});
      const before = await counts(client, a.accountId);
      for (const changed of [{kind: 'generation'}, {digest: D('y')}]) expect((await c.accept(pid, {command, ...changed})).outcome).toBe('reused');
      expect((await c.accept(other, {command})).outcome).toBe('reused');
      expect(await counts(client, a.accountId)).toEqual(before);
      expect((await c.accept(pid, {kind: 'research', digest: D('x')})).outcome).toBe('created');
      expect((await counts(client, a.accountId)).jobs).toBe(2);
    });
  });

  it('refuses the same command ID of another kind of command: a begin_step cannot be replayed as an accept_job', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const command = randomUUID();
      expect((await job.c.begin(job.attemptId, 'search', null, {command})).outcome).toBe('created');
      const before = await counts(client, a.accountId);
      expect((await job.c.accept(job.projectId, {command})).outcome).toBe('reused');
      expect((await job.c.move(job.attemptId, 'failed', 'step_failed', {command})).outcome).toBe('reused');
      expect(await counts(client, a.accountId)).toEqual(before);
    });
  });

  it('raises 22023 for a shape the application would never send, before it asks about anything, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const pid = await project(client, a);
      const good = [a.accountId, a.epoch, randomUUID(), pid, 'research', D('x')];
      const bad: [string, unknown[]][] = [
        ['a missing Account', [null, ...good.slice(1)]],
        ['a missing epoch', [good[0], null, ...good.slice(2)]],
        ['a zero epoch', [good[0], 0, ...good.slice(2)]],
        ['a missing command', [good[0], good[1], null, ...good.slice(3)]],
        ['a missing Project', [...good.slice(0, 3), null, good[4], good[5]]],
        ['a missing kind', [...good.slice(0, 4), null, good[5]]],
        ['an upper-case kind', [...good.slice(0, 4), 'Research', good[5]]],
        ['a kind that starts with a digit', [...good.slice(0, 4), '1x', good[5]]],
        ['a kind of 41 characters', [...good.slice(0, 4), 'x'.repeat(41), good[5]]],
        ['an empty kind', [...good.slice(0, 4), '', good[5]]],
        ['a missing digest', [...good.slice(0, 5), null]],
        ['an upper-case digest', [...good.slice(0, 5), D('x').toUpperCase()]],
        ['a short digest', [...good.slice(0, 5), 'abc']],
      ];
      for (const [label, params] of bad) {
        const result = await attempt(client, 'service_role', ACCEPT, params);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      // Not even the authority is asked first: a stale epoch with a bad kind is 22023, not `denied`.
      const stale = await attempt(client, 'service_role', ACCEPT, [a.accountId, 99, randomUUID(), pid, 'Bad Kind', D('x')]);
      expect(stale.ok).toBe(false);
      expect(await counts(client, a.accountId)).toEqual({jobs: 0, attempts: 0, steps: 0, operations: 0, commands: 0});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('authority and the hidden state: nothing is written or revealed', () => {
  async function everyCommand(client: Client, who: Fixture, ids: {projectId: string; jobId: string; attemptId: string; operationId: string}, o: {epoch?: number} = {}) {
    const c = commands(client, who);
    return {
      accept: await c.accept(ids.projectId, o),
      begin: await c.begin(ids.attemptId, 'late_step', 1, o),
      advance: await c.advance(ids.operationId, 'dispatched', null, o),
      move: await c.move(ids.attemptId, 'failed', 'step_failed', o),
      retry: await c.retry(ids.jobId, 1, o),
      read: await c.read(ids.jobId, o),
    };
  }

  async function world(client: Client, who: Fixture) {
    const job = await started(client, who);
    const op = await stepWithOperation(job.c, job.attemptId, 'search', 1);
    return {projectId: job.projectId, jobId: job.jobId, attemptId: job.attemptId, operationId: op.operationId};
  }

  it('answers `denied` to every command and the read for a stale epoch, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const ids = await world(client, a);
      const before = await counts(client, a.accountId);
      const rowsBefore = [await attemptRow(client, ids.attemptId), await operationRow(client, ids.operationId)];
      for (const epoch of [a.epoch + 1, a.epoch + 40]) {
        const answers = await everyCommand(client, a, ids, {epoch});
        for (const [name, answer] of Object.entries(answers)) expect(answer.outcome, name).toBe('denied');
      }
      expect(await counts(client, a.accountId)).toEqual(before);
      expect([await attemptRow(client, ids.attemptId), await operationRow(client, ids.operationId)]).toEqual(rowsBefore);
    });
  });

  it('answers `denied` to every command and the read for a disabled Account, and again after it is enabled and the old epoch is used', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const ids = await world(client, a);
      const before = await counts(client, a.accountId);
      await svc(client, `select * from api.disable_account('seed:local:jobs', $1)`, [a.accountId]);
      for (const [name, answer] of Object.entries(await everyCommand(client, a, ids))) expect(answer.outcome, name).toBe('denied');
      await svc(client, `select * from api.enable_account('seed:local:jobs', $1)`, [a.accountId]);
      // Enabling again gives a newer epoch; the old operation stays refused.
      for (const [name, answer] of Object.entries(await everyCommand(client, a, ids))) expect(answer.outcome, name).toBe('denied');
      expect(await counts(client, a.accountId)).toEqual(before);
    });
  });

  it('answers `denied` to every command and the read for a tombstoned Account, and for an Account that does not exist', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const ids = await world(client, a);
      const before = await counts(client, a.accountId);
      await svc(client, `select * from api.record_tombstone('account', $1)`, [a.accountId]);
      for (const [name, answer] of Object.entries(await everyCommand(client, a, ids))) expect(answer.outcome, name).toBe('denied');
      const ghost = {accountId: randomUUID(), epoch: 1};
      const c = commands(client, ghost);
      expect((await c.accept(ids.projectId)).outcome).toBe('denied');
      expect((await c.read(ids.jobId)).outcome).toBe('denied');
      expect(await counts(client, a.accountId)).toEqual(before);
    });
  });

  it('answers the same `unavailable` for a foreign, a deleted, an unknown and a tombstoned Project, Job, attempt or operation, with nothing in it, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const mine = await world(client, a);
      const theirs = await world(client, b);
      const deletedWorld = await world(client, a);
      await client.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [deletedWorld.projectId]);
      const tombstonedWorld = await world(client, a);
      await svc(client, `select * from api.record_tombstone('project', $1)`, [tombstonedWorld.projectId]);
      const unknown = {projectId: randomUUID(), jobId: randomUUID(), attemptId: randomUUID(), operationId: randomUUID()};
      const before = [await counts(client, a.accountId), await counts(client, b.accountId)];
      const theirRows = [await attemptRow(client, theirs.attemptId), await operationRow(client, theirs.operationId)];
      for (const [label, ids] of [['foreign', theirs], ['deleted', deletedWorld], ['tombstoned', tombstonedWorld], ['unknown', unknown]] as const) {
        const answers = await everyCommand(client, a, ids);
        for (const [name, answer] of Object.entries(answers)) {
          expect(answer, `${label} ${name}`).toMatchObject({outcome: 'unavailable'});
          // Nothing but the outcome: not an ID, not a state, not a number.
          for (const [field, value] of Object.entries(answer)) if (field !== 'outcome') expect(value, `${label} ${name} ${field}`).toBeNull();
        }
      }
      expect(await counts(client, b.accountId)).toEqual(before[1]);
      expect(await counts(client, a.accountId)).toEqual(before[0]);
      expect([await attemptRow(client, theirs.attemptId), await operationRow(client, theirs.operationId)]).toEqual(theirRows);
      // And my own world still answers.
      expect((await commands(client, a).read(mine.jobId)).outcome).toBe('found');
    });
  });

  it('answers `unavailable`, not the original receipt, to a replay once the Project is deleted or tombstoned: a receipt does not outlive its Project\'s visibility', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const c = job.c;
      const acceptCommand = randomUUID();
      const accepted = await c.accept(job.projectId, {command: acceptCommand});
      const beginCommand = randomUUID();
      await c.begin(job.attemptId, 'search', 1, {command: beginCommand});
      await svc(client, `select * from api.record_tombstone('project', $1)`, [job.projectId]);
      expect((await c.accept(job.projectId, {command: acceptCommand})).outcome).toBe('unavailable');
      expect((await c.begin(job.attemptId, 'search', 1, {command: beginCommand})).outcome).toBe('unavailable');
      expect((await c.read(accepted.job_id)).outcome).toBe('unavailable');
    });
  });

  it('does not let one Account see another\'s numbers: a foreign request ID or ordinal never comes back', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const theirs = await started(client, b);
      const op = await stepWithOperation(theirs.c, theirs.attemptId);
      await theirs.c.advance(op.operationId, 'dispatched', 'secret_request_9');
      const answers = await everyCommand(client, a, {projectId: theirs.projectId, jobId: theirs.jobId, attemptId: theirs.attemptId, operationId: op.operationId});
      expect(JSON.stringify(answers)).not.toContain('secret_request_9');
      expect(JSON.stringify(answers)).not.toContain(op.operationId);
      expect(JSON.stringify(answers)).not.toContain(theirs.jobId);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.begin_step: a step and its operation are unique, and never recreated', () => {
  it('creates a step and its planned operation in a running attempt, and sets the stage to the step key', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const begun = await job.c.begin(job.attemptId, 'search', 1);
      expect(begun).toMatchObject({outcome: 'created', attempt_state: 'running'});
      expect(await operationRow(client, begun.operation_id)).toMatchObject({step_id: begun.step_id, ordinal: 1, state: 'planned', request_id: null, dispatched_at: null, outcome_at: null});
      expect(await attemptRow(client, job.attemptId)).toMatchObject({state: 'running', stage: 'search'});
      const step = (await client.query('select attempt_id, step_key from jobs.steps where id = $1', [begun.step_id])).rows[0];
      expect(step).toEqual({attempt_id: job.attemptId, step_key: 'search'});
      expect(await counts(client, a.accountId)).toMatchObject({steps: 1, operations: 1});
    });
  });

  it('records a receipt whose digest covers the attempt, the key and the ordinal (a dash for none)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const withOrdinal = randomUUID();
      const without = randomUUID();
      const one = await job.c.begin(job.attemptId, 'search', 1, {command: withOrdinal});
      const two = await job.c.begin(job.attemptId, 'plan', null, {command: without});
      const receipts = Object.fromEntries((await commandRows(client, a.accountId)).map((row) => [row.command_id, row]));
      expect(receipts[withOrdinal]).toMatchObject({kind: 'begin_step', digest: digestOf('begin_step', job.attemptId, 'search', '1'), subject_id: one.step_id});
      expect(receipts[without]).toMatchObject({kind: 'begin_step', digest: digestOf('begin_step', job.attemptId, 'plan', null), subject_id: two.step_id});
    });
  });

  it('makes one step and one operation for two commands (two IDs) for the same attempt, key and ordinal 1: the second answers `replayed` with the original IDs and is recorded', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const first = await job.c.begin(job.attemptId, 'search', 1);
      const secondCommand = randomUUID();
      const second = await job.c.begin(job.attemptId, 'search', 1, {command: secondCommand});
      expect(second).toMatchObject({outcome: 'replayed', step_id: first.step_id, operation_id: first.operation_id, attempt_state: 'running'});
      expect(await counts(client, a.accountId)).toMatchObject({steps: 1, operations: 1, commands: 4});
      expect((await commandRows(client, a.accountId)).find((row) => row.command_id === secondCommand)).toMatchObject({kind: 'begin_step', subject_id: first.step_id});
      // The second ID replays too: it is recorded now.
      expect(await job.c.begin(job.attemptId, 'search', 1, {command: secondCommand})).toMatchObject({outcome: 'replayed', step_id: first.step_id, operation_id: first.operation_id});
      expect((await counts(client, a.accountId)).commands).toBe(4);
    });
  });

  it('answers `reused` for the first command ID with ordinal 2, another key or another attempt, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const command = randomUUID();
      await job.c.begin(job.attemptId, 'search', 1, {command});
      const before = await counts(client, a.accountId);
      expect((await job.c.begin(job.attemptId, 'search', 2, {command})).outcome).toBe('reused');
      expect((await job.c.begin(job.attemptId, 'search', null, {command})).outcome).toBe('reused');
      expect((await job.c.begin(job.attemptId, 'plan', 1, {command})).outcome).toBe('reused');
      expect(await counts(client, a.accountId)).toEqual(before);
    });
  });

  it('adds a step for another key, another operation for another ordinal on an existing step, and a step with no operation; a repeated pair never adds a row', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const c = job.c;
      const one = await c.begin(job.attemptId, 'search', 1);
      const other = await c.begin(job.attemptId, 'synthesis', 1);
      expect(other).toMatchObject({outcome: 'created'});
      expect(other.step_id).not.toBe(one.step_id);
      expect(await attemptRow(client, job.attemptId)).toMatchObject({stage: 'synthesis'});
      // Another ordinal on the existing step is a new operation on the same step, and the stage is not touched (no step was created).
      const second = await c.begin(job.attemptId, 'search', 2);
      expect(second).toMatchObject({outcome: 'created', step_id: one.step_id});
      expect(second.operation_id).not.toBe(one.operation_id);
      expect(await attemptRow(client, job.attemptId)).toMatchObject({stage: 'synthesis'});
      // No ordinal: a step with no operation, or the existing step.
      const bare = await c.begin(job.attemptId, 'review');
      expect(bare).toMatchObject({outcome: 'created', operation_id: null});
      expect(await c.begin(job.attemptId, 'review')).toMatchObject({outcome: 'replayed', step_id: bare.step_id, operation_id: null});
      expect(await c.begin(job.attemptId, 'search')).toMatchObject({outcome: 'replayed', step_id: one.step_id, operation_id: null});
      expect(await c.begin(job.attemptId, 'search', 2)).toMatchObject({outcome: 'replayed', step_id: one.step_id, operation_id: second.operation_id});
      expect(await counts(client, a.accountId)).toMatchObject({steps: 3, operations: 3});
    });
  });

  it('keeps the steps of one attempt apart from another\'s: the same key in a later attempt is a new step', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, 'none');
      const first = (await client.query('select id from jobs.steps where attempt_id = $1', [job.attemptId])).rows;
      expect(first).toHaveLength(0);
      const one = await job.c.begin(job.attemptId, 'search', 1);
      expect(one.outcome).toBe('not_running');
      const retry = await job.c.retry(job.jobId, 1);
      expect((await job.c.move(retry.attempt_id, 'running')).outcome).toBe('moved');
      const two = await job.c.begin(retry.attempt_id, 'search', 1);
      expect(two.outcome).toBe('created');
    });
  });

  it.each(['waiting', 'failed', 'cancelled', 'completed'])('answers `not_running` with the state for a %s attempt, creates nothing, and still replays what exists', async (state) => {
    await inTx(async (client) => {
      const a = await account(client);
      const c = commands(client, a);
      const pid = await project(client, a);
      const accepted = await c.accept(pid);
      const attemptId = accepted.attempt_id as string;
      let existing: {stepId: string; operationId: string} | null = null;
      if (state !== 'waiting') {
        expect((await c.move(attemptId, 'running')).outcome).toBe('moved');
        existing = await stepWithOperation(c, attemptId, 'search', 1);
        if (state === 'completed') {
          await c.advance(existing.operationId, 'dispatched');
          await c.advance(existing.operationId, 'completed');
        }
        const target = { failed: ['failed', 'step_failed'], cancelled: ['cancelled', 'user_cancelled'], completed: ['completed', null] }[state] as [string, string | null];
        expect((await c.move(attemptId, target[0], target[1])).outcome).toBe('moved');
      }
      const before = await counts(client, a.accountId);
      const refused = await c.begin(attemptId, 'new_step', 1);
      expect(refused).toMatchObject({outcome: 'not_running', attempt_state: state, step_id: null, operation_id: null});
      expect(await c.begin(attemptId, 'new_step')).toMatchObject({outcome: 'not_running', attempt_state: state});
      expect(await counts(client, a.accountId)).toEqual(before);
      if (existing) {
        // What exists is returned, never recreated, whatever the attempt's state.
        expect(await c.begin(attemptId, 'search', 1)).toMatchObject({outcome: 'replayed', step_id: existing.stepId, operation_id: existing.operationId, attempt_state: state});
        // A step that exists but an operation that does not is a creation, and needs a running attempt.
        expect((await c.begin(attemptId, 'search', 2)).outcome).toBe('not_running');
        expect((await counts(client, a.accountId)).operations).toBe(before.operations);
      }
    });
  });

  it('raises 22023 for a bad step key, ordinal or attempt, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const good = [a.accountId, a.epoch, randomUUID(), job.attemptId, 'search', 1];
      const bad: [string, unknown[]][] = [
        ['a missing attempt', [...good.slice(0, 3), null, 'search', 1]],
        ['a missing key', [...good.slice(0, 4), null, 1]],
        ['an empty key', [...good.slice(0, 4), '', 1]],
        ['an upper-case key', [...good.slice(0, 4), 'Search', 1]],
        ['a key with a space', [...good.slice(0, 4), 'a b', 1]],
        ['a key of 41 characters', [...good.slice(0, 4), 'x'.repeat(41), 1]],
        ['ordinal 0', [...good.slice(0, 5), 0]],
        ['ordinal 101', [...good.slice(0, 5), 101]],
        ['a negative ordinal', [...good.slice(0, 5), -3]],
        ['a missing command', [good[0], good[1], null, ...good.slice(3)]],
      ];
      for (const [label, params] of bad) {
        const result = await attempt(client, 'service_role', BEGIN, params);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      expect(await counts(client, a.accountId)).toMatchObject({steps: 0, operations: 0});
      for (const ordinal of [1, 100]) expect((await job.c.begin(job.attemptId, `ok_${ordinal}`, ordinal)).outcome).toBe('created');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.advance_operation: the guarded states of an external operation', () => {
  it('moves planned -> dispatched -> completed and stamps the times: dispatched_at at the dispatch, outcome_at at the first outcome', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const op = await stepWithOperation(job.c, job.attemptId);
      const dispatched = await job.c.advance(op.operationId, 'dispatched');
      expect(dispatched).toMatchObject({outcome: 'advanced', operation_id: op.operationId, state: 'dispatched', request_id: null, attempt_state: 'running'});
      expect(await operationRow(client, op.operationId)).toMatchObject({state: 'dispatched', outcome_at: null});
      expect((await operationRow(client, op.operationId)).dispatched_at).toBeInstanceOf(Date);
      const completed = await job.c.advance(op.operationId, 'completed', 'req_ok_1');
      expect(completed).toMatchObject({outcome: 'advanced', state: 'completed', request_id: 'req_ok_1'});
      const row = await operationRow(client, op.operationId);
      expect(row).toMatchObject({state: 'completed', request_id: 'req_ok_1'});
      expect(row.dispatched_at).toBeInstanceOf(Date);
      expect(row.outcome_at).toBeInstanceOf(Date);
      expect(row.outcome_at.getTime()).toBeGreaterThanOrEqual(row.dispatched_at.getTime());
    });
  });

  it('moves dispatched -> ambiguous -> settled and ambiguous -> noncharge: reconciling keeps the time the outcome was first recorded', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const settled = await stepWithOperation(job.c, job.attemptId, 'one');
      const noncharge = await stepWithOperation(job.c, job.attemptId, 'two');
      for (const op of [settled, noncharge]) {
        await job.c.advance(op.operationId, 'dispatched');
        expect((await job.c.advance(op.operationId, 'ambiguous')).state).toBe('ambiguous');
      }
      const ambiguousAt = (await operationRow(client, settled.operationId)).outcome_at;
      expect(ambiguousAt).toBeInstanceOf(Date);
      expect((await job.c.advance(settled.operationId, 'settled')).state).toBe('settled');
      expect((await operationRow(client, settled.operationId)).outcome_at).toEqual(ambiguousAt);
      expect((await job.c.advance(noncharge.operationId, 'noncharge', 'req_rejected_7'))).toMatchObject({outcome: 'advanced', state: 'noncharge', request_id: 'req_rejected_7'});
      expect(await operationRow(client, noncharge.operationId)).toMatchObject({state: 'noncharge', request_id: 'req_rejected_7'});
    });
  });

  it('moves dispatched -> noncharge with a request ID, and planned -> abandoned in any attempt state', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const sent = await stepWithOperation(job.c, job.attemptId, 'one');
      const unsent = await stepWithOperation(job.c, job.attemptId, 'two');
      await job.c.advance(sent.operationId, 'dispatched');
      expect((await job.c.advance(sent.operationId, 'noncharge', 'req_pre_processing_1')).state).toBe('noncharge');
      expect((await job.c.advance(unsent.operationId, 'abandoned')).state).toBe('abandoned');
      expect(await operationRow(client, unsent.operationId)).toMatchObject({state: 'abandoned', dispatched_at: null, outcome_at: null});
    });
  });

  it('answers `invalid_transition` carrying the state for a move that is not listed: backwards, skipped, to planned, or out of a terminal state', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const planned = await stepWithOperation(job.c, job.attemptId, 'planned_one');
      const dispatched = await stepWithOperation(job.c, job.attemptId, 'dispatched_one');
      const ambiguous = await stepWithOperation(job.c, job.attemptId, 'ambiguous_one');
      const completed = await stepWithOperation(job.c, job.attemptId, 'completed_one');
      const noncharge = await stepWithOperation(job.c, job.attemptId, 'noncharge_one');
      const settled = await stepWithOperation(job.c, job.attemptId, 'settled_one');
      const abandoned = await stepWithOperation(job.c, job.attemptId, 'abandoned_one');
      const all = [dispatched, ambiguous, completed, noncharge, settled];
      for (const op of all) await job.c.advance(op.operationId, 'dispatched');
      await job.c.advance(ambiguous.operationId, 'ambiguous');
      await job.c.advance(completed.operationId, 'completed');
      await job.c.advance(noncharge.operationId, 'noncharge', 'req_n');
      await job.c.advance(settled.operationId, 'ambiguous');
      await job.c.advance(settled.operationId, 'settled');
      await job.c.advance(abandoned.operationId, 'abandoned');
      const states = ['planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned'];
      const allowed: Record<string, string[]> = {
        planned: ['dispatched', 'abandoned'],
        dispatched: ['completed', 'ambiguous', 'noncharge'],
        ambiguous: ['settled', 'noncharge'],
        completed: [],
        noncharge: [],
        settled: [],
        abandoned: [],
      };
      const ops: Record<string, string> = {planned: planned.operationId, dispatched: dispatched.operationId, ambiguous: ambiguous.operationId, completed: completed.operationId, noncharge: noncharge.operationId, settled: settled.operationId, abandoned: abandoned.operationId};
      for (const [from, operationId] of Object.entries(ops)) {
        const before = await operationRow(client, operationId);
        const commandsBefore = (await counts(client, a.accountId)).commands;
        for (const to of states) {
          if (to === from || allowed[from].includes(to)) continue;
          const answer = await job.c.advance(operationId, to, to === 'noncharge' ? 'req_x' : null);
          expect(answer, `${from} -> ${to}`).toMatchObject({outcome: 'invalid_transition', state: from, operation_id: operationId});
        }
        expect(await operationRow(client, operationId), from).toEqual(before);
        expect((await counts(client, a.accountId)).commands, from).toBe(commandsBefore);
      }
    });
  });

  it('refuses a noncharge without a request ID, and a changed request ID, with `invalid_transition` carrying the state', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const bare = await stepWithOperation(job.c, job.attemptId, 'bare');
      const named = await stepWithOperation(job.c, job.attemptId, 'named');
      await job.c.advance(bare.operationId, 'dispatched');
      await job.c.advance(named.operationId, 'dispatched', 'req_first');
      expect(await job.c.advance(bare.operationId, 'noncharge')).toMatchObject({outcome: 'invalid_transition', state: 'dispatched'});
      expect(await operationRow(client, bare.operationId)).toMatchObject({state: 'dispatched', request_id: null});
      expect(await job.c.advance(named.operationId, 'ambiguous', 'req_second')).toMatchObject({outcome: 'invalid_transition', state: 'dispatched', request_id: 'req_first'});
      expect(await operationRow(client, named.operationId)).toMatchObject({state: 'dispatched', request_id: 'req_first'});
      // A stored request ID satisfies a noncharge, and is kept when a later move gives none.
      expect(await job.c.advance(named.operationId, 'noncharge')).toMatchObject({outcome: 'advanced', state: 'noncharge', request_id: 'req_first'});
      // A request ID given later, once none was stored, is written once.
      const late = await stepWithOperation(job.c, job.attemptId, 'late');
      await job.c.advance(late.operationId, 'dispatched');
      await job.c.advance(late.operationId, 'ambiguous');
      expect(await job.c.advance(late.operationId, 'noncharge', 'req_late')).toMatchObject({outcome: 'advanced', request_id: 'req_late'});
    });
  });

  it('answers `replayed` for the state it is already in with the same request ID (under a second command ID too, which is recorded), and `invalid_transition` for another one', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const op = await stepWithOperation(job.c, job.attemptId);
      await job.c.advance(op.operationId, 'dispatched');
      const command = randomUUID();
      const first = await job.c.advance(op.operationId, 'noncharge', 'req_pre_1', {command});
      expect(first.outcome).toBe('advanced');
      const row = await operationRow(client, op.operationId);
      // Same command: replayed, nothing moves.
      expect(await job.c.advance(op.operationId, 'noncharge', 'req_pre_1', {command})).toMatchObject({outcome: 'replayed', state: 'noncharge', request_id: 'req_pre_1'});
      // Another command ID asking for the state it is already in: replayed, and recorded.
      const second = randomUUID();
      expect(await job.c.advance(op.operationId, 'noncharge', 'req_pre_1', {command: second})).toMatchObject({outcome: 'replayed', state: 'noncharge', request_id: 'req_pre_1'});
      expect((await commandRows(client, a.accountId)).find((entry) => entry.command_id === second)).toMatchObject({kind: 'advance_operation', subject_id: op.operationId});
      expect(await job.c.advance(op.operationId, 'noncharge', 'req_pre_1', {command: second})).toMatchObject({outcome: 'replayed'});
      // A changed request ID, or the same state with none where there was one to show, is not a replay of a changed fact.
      expect(await job.c.advance(op.operationId, 'noncharge', 'req_pre_2')).toMatchObject({outcome: 'invalid_transition', state: 'noncharge'});
      expect(await operationRow(client, op.operationId)).toEqual(row);
    });
  });

  it.each([
    ['dispatched', [['dispatched', null]], [['ambiguous', null]], 'ambiguous'],
    ['dispatched', [['dispatched', null]], [['completed', 'req_done_1']], 'completed'],
    ['ambiguous', [['dispatched', null], ['ambiguous', null]], [['settled', null]], 'settled'],
    ['ambiguous', [['dispatched', null], ['ambiguous', null]], [['noncharge', 'req_rejected_4']], 'noncharge'],
  ] as [string, [string, string | null][], [string, string | null][], string][])(
    'replays an earlier command that moved an operation to %s as the operation is now, after it moved on to %s: nothing moves, nothing is recorded again',
    async (to, before, after, now) => {
      await inTx(async (client) => {
        const a = await account(client);
        const job = await started(client, a);
        const op = await stepWithOperation(job.c, job.attemptId);
        const commandsOf: Record<string, string> = {};
        for (const [step, requestId] of before) {
          commandsOf[step] = randomUUID();
          expect((await job.c.advance(op.operationId, step, requestId, {command: commandsOf[step]})).outcome).toBe('advanced');
        }
        for (const [step, requestId] of after) expect((await job.c.advance(op.operationId, step, requestId)).outcome).toBe('advanced');
        const row = await operationRow(client, op.operationId);
        const commandsBefore = (await counts(client, a.accountId)).commands;
        const requestId = before.find(([step]) => step === to)![1];
        const replay = await job.c.advance(op.operationId, to, requestId, {command: commandsOf[to]});
        expect(replay).toMatchObject({outcome: 'replayed', operation_id: op.operationId, state: now});
        // Again, and from the Job's other earlier commands: the same answer, and no new receipt.
        expect(await job.c.advance(op.operationId, to, requestId, {command: commandsOf[to]})).toMatchObject({outcome: 'replayed', state: now});
        expect(await operationRow(client, op.operationId)).toEqual(row);
        expect((await counts(client, a.accountId)).commands).toBe(commandsBefore);
      });
    },
  );

  it('answers `reused` for the same command ID with another target state or request ID, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const op = await stepWithOperation(job.c, job.attemptId);
      const command = randomUUID();
      await job.c.advance(op.operationId, 'dispatched', null, {command});
      const row = await operationRow(client, op.operationId);
      const before = await counts(client, a.accountId);
      expect(await job.c.advance(op.operationId, 'abandoned', null, {command})).toMatchObject({outcome: 'reused', operation_id: null, state: null});
      expect((await job.c.advance(op.operationId, 'dispatched', 'req_other', {command})).outcome).toBe('reused');
      expect(await counts(client, a.accountId)).toEqual(before);
      expect(await operationRow(client, op.operationId)).toEqual(row);
    });
  });

  it('records the late outcome of an attempt that has ended: every move but a dispatch works in any attempt state', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const sent = await stepWithOperation(job.c, job.attemptId, 'sent');
      const unclear = await stepWithOperation(job.c, job.attemptId, 'unclear');
      const rejected = await stepWithOperation(job.c, job.attemptId, 'rejected');
      const unsent = await stepWithOperation(job.c, job.attemptId, 'unsent');
      for (const op of [sent, unclear, rejected]) await job.c.advance(op.operationId, 'dispatched');
      await job.c.advance(unclear.operationId, 'ambiguous');
      // The attempt fails: its planned operation is abandoned, and the dispatched and ambiguous ones stay as they are.
      expect((await job.c.move(job.attemptId, 'failed', 'lease_lost')).outcome).toBe('moved');
      expect((await operationRow(client, unsent.operationId)).state).toBe('abandoned');
      expect((await operationRow(client, sent.operationId)).state).toBe('dispatched');
      expect((await operationRow(client, unclear.operationId)).state).toBe('ambiguous');
      // The late outcomes are still recorded.
      expect(await job.c.advance(sent.operationId, 'completed', 'req_late_1')).toMatchObject({outcome: 'advanced', state: 'completed', attempt_state: 'failed'});
      expect(await job.c.advance(unclear.operationId, 'settled')).toMatchObject({outcome: 'advanced', state: 'settled', attempt_state: 'failed'});
      expect(await job.c.advance(rejected.operationId, 'noncharge', 'req_late_2')).toMatchObject({outcome: 'advanced', state: 'noncharge'});
      expect((await job.c.read(job.jobId)).attempts[0].chargeable_operations).toBe(0);
    });
  });

  it.each(['failed', 'cancelled', 'completed'])('answers `not_running` with the attempt\'s state for a dispatch in a %s attempt, moves nothing, and still replays a dispatch that was made', async (state) => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const sent = await stepWithOperation(job.c, job.attemptId, 'sent');
      const unsent = await stepWithOperation(job.c, job.attemptId, 'unsent');
      await job.c.advance(sent.operationId, 'dispatched');
      const dispatchCommand = (await commandRows(client, a.accountId)).find((entry) => entry.subject_id === sent.operationId)!.command_id as string;
      if (state === 'completed') {
        await job.c.advance(sent.operationId, 'completed');
        await job.c.advance(unsent.operationId, 'abandoned');
        expect((await job.c.move(job.attemptId, 'completed')).outcome).toBe('moved');
      } else {
        const target = state === 'failed' ? ['failed', 'step_failed'] : ['cancelled', 'user_cancelled'];
        expect((await job.c.move(job.attemptId, target[0], target[1])).outcome).toBe('moved');
        expect((await operationRow(client, unsent.operationId)).state).toBe('abandoned');
      }
      const before = [await operationRow(client, sent.operationId), await operationRow(client, unsent.operationId)];
      const commandsBefore = (await counts(client, a.accountId)).commands;
      // An operation that was abandoned, or has an outcome, is not sent in an attempt that is over.
      expect(await job.c.advance(unsent.operationId, 'dispatched')).toMatchObject({outcome: 'not_running', attempt_state: state, operation_id: unsent.operationId, state: 'abandoned'});
      expect(await job.c.advance(sent.operationId, 'dispatched')).toMatchObject({outcome: state === 'completed' ? 'not_running' : 'replayed', attempt_state: state});
      expect([await operationRow(client, sent.operationId), await operationRow(client, unsent.operationId)]).toEqual(before);
      // The command that dispatched it still answers, with the operation as it is now (completed, when the attempt completed).
      expect(await job.c.advance(sent.operationId, 'dispatched', null, {command: dispatchCommand})).toMatchObject({outcome: 'replayed', state: state === 'completed' ? 'completed' : 'dispatched'});
      expect((await counts(client, a.accountId)).commands).toBe(commandsBefore + (state === 'completed' ? 0 : 1));
    });
  });

  it('answers `not_running` for the dispatch of a planned operation in a waiting attempt (a state only the owner can provoke), and moves nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const op = await stepWithOperation(job.c, job.attemptId);
      // A planned operation cannot exist in a waiting attempt through the commands, so the owner puts the attempt back with the guards off.
      await client.query('alter table jobs.attempts disable trigger attempts_guard');
      await client.query(`update jobs.attempts set state = 'waiting', started_at = null where id = $1`, [job.attemptId]);
      await client.query('alter table jobs.attempts enable trigger attempts_guard');
      const row = await operationRow(client, op.operationId);
      expect(await job.c.advance(op.operationId, 'dispatched')).toMatchObject({outcome: 'not_running', state: 'planned', attempt_state: 'waiting'});
      expect(await operationRow(client, op.operationId)).toEqual(row);
      // The owner cannot send it by hand either: the table refuses a dispatch from an attempt that is not running.
      const by_hand = await attempt(client, null, `update jobs.operations set state = 'dispatched', dispatched_at = now() where id = $1`, [op.operationId]);
      expect(by_hand.ok).toBe(false);
      if (!by_hand.ok) expect(by_hand.code).toBe('55000');
    });
  });

  it('raises 22023 for a bad target state or request ID, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const op = await stepWithOperation(job.c, job.attemptId);
      const good = [a.accountId, a.epoch, randomUUID(), op.operationId, 'dispatched', null];
      const bad: [string, unknown[]][] = [
        ['a missing operation', [...good.slice(0, 3), null, 'dispatched', null]],
        ['a missing target', [...good.slice(0, 4), null, null]],
        ['an unknown target', [...good.slice(0, 4), 'charged', null]],
        ['an upper-case target', [...good.slice(0, 4), 'Dispatched', null]],
        ['an empty request ID', [...good.slice(0, 5), '']],
        ['a request ID with a space', [...good.slice(0, 5), 'req 1']],
        ['a request ID with a control character', [...good.slice(0, 5), 'req\u0001']],
        ['a request ID of 201 characters', [...good.slice(0, 5), 'r'.repeat(201)]],
        ['a request ID with a non-ASCII character', [...good.slice(0, 5), 'rèq']],
      ];
      for (const [label, params] of bad) {
        const result = await attempt(client, 'service_role', ADVANCE, params);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      expect((await operationRow(client, op.operationId)).state).toBe('planned');
      expect((await job.c.advance(op.operationId, 'dispatched', 'r'.repeat(200))).outcome).toBe('advanced');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.move_attempt: starting, completing, failing and cancelling an attempt', () => {
  it('starts a waiting attempt: running, stage started, started_at stamped, no reason', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const c = commands(client, a);
      const accepted = await c.accept(await project(client, a));
      const moved = await c.move(accepted.attempt_id, 'running');
      expect(moved).toMatchObject({outcome: 'moved', attempt_id: accepted.attempt_id, attempt_number: 1, state: 'running', stage: 'started', reason: null});
      const row = await attemptRow(client, accepted.attempt_id);
      expect(row).toMatchObject({state: 'running', stage: 'started', reason: null, ended_at: null});
      expect(row.started_at).toBeInstanceOf(Date);
    });
  });

  it('completes a running attempt whose operations are all settled one way or the other, leaving the stage as it was and stamping ended_at', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const op = await stepWithOperation(job.c, job.attemptId, 'synthesis');
      await job.c.advance(op.operationId, 'dispatched');
      expect(await job.c.move(job.attemptId, 'completed')).toMatchObject({outcome: 'open_operations', state: 'running', stage: 'synthesis'});
      await job.c.advance(op.operationId, 'ambiguous');
      expect((await job.c.move(job.attemptId, 'completed')).outcome).toBe('open_operations');
      await job.c.advance(op.operationId, 'settled');
      const done = await job.c.move(job.attemptId, 'completed');
      expect(done).toMatchObject({outcome: 'moved', state: 'completed', stage: 'synthesis', reason: null});
      const row = await attemptRow(client, job.attemptId);
      expect(row).toMatchObject({state: 'completed', stage: 'synthesis', reason: null});
      expect(row.ended_at).toBeInstanceOf(Date);
    });
  });

  it('refuses completion with a planned, dispatched or ambiguous operation (`open_operations`), and allows it with completed, noncharge, settled and abandoned ones', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const open of ['planned', 'dispatched', 'ambiguous']) {
        const job = await started(client, a);
        const op = await stepWithOperation(job.c, job.attemptId);
        if (open !== 'planned') await job.c.advance(op.operationId, 'dispatched');
        if (open === 'ambiguous') await job.c.advance(op.operationId, 'ambiguous');
        expect(await job.c.move(job.attemptId, 'completed'), open).toMatchObject({outcome: 'open_operations', state: 'running'});
        expect((await attemptRow(client, job.attemptId)).state, open).toBe('running');
      }
      const job = await started(client, a);
      const ok = ['completed', 'noncharge', 'settled', 'abandoned'];
      for (const state of ok) {
        const op = await stepWithOperation(job.c, job.attemptId, `step_${state}`);
        if (state === 'abandoned') await job.c.advance(op.operationId, 'abandoned');
        else {
          await job.c.advance(op.operationId, 'dispatched');
          if (state === 'completed') await job.c.advance(op.operationId, 'completed');
          if (state === 'noncharge') await job.c.advance(op.operationId, 'noncharge', 'req_nc');
          if (state === 'settled') {
            await job.c.advance(op.operationId, 'ambiguous');
            await job.c.advance(op.operationId, 'settled');
          }
        }
      }
      expect((await job.c.move(job.attemptId, 'completed')).outcome).toBe('moved');
    });
  });

  it('fails or cancels with a reason from the closed set, stamps ended_at, abandons the planned operations in the same transaction, and keeps the dispatched and ambiguous ones potentially chargeable', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const [to, reason] of [['failed', 'step_failed'], ['failed', 'lease_lost'], ['cancelled', 'user_cancelled'], ['cancelled', 'account_disabled']]) {
        const job = await started(client, a);
        const planned = await stepWithOperation(job.c, job.attemptId, 'planned_step');
        const dispatched = await stepWithOperation(job.c, job.attemptId, 'dispatched_step');
        const ambiguous = await stepWithOperation(job.c, job.attemptId, 'ambiguous_step');
        const completed = await stepWithOperation(job.c, job.attemptId, 'completed_step');
        for (const op of [dispatched, ambiguous, completed]) await job.c.advance(op.operationId, 'dispatched');
        await job.c.advance(ambiguous.operationId, 'ambiguous');
        await job.c.advance(completed.operationId, 'completed');
        const stage = (await attemptRow(client, job.attemptId)).stage;
        const moved = await job.c.move(job.attemptId, to, reason);
        expect(moved, `${to} ${reason}`).toMatchObject({outcome: 'moved', state: to, stage, reason});
        const row = await attemptRow(client, job.attemptId);
        expect(row, `${to} ${reason}`).toMatchObject({state: to, reason, stage});
        expect(row.ended_at).toBeInstanceOf(Date);
        expect((await operationRow(client, planned.operationId)).state).toBe('abandoned');
        expect((await operationRow(client, dispatched.operationId)).state).toBe('dispatched');
        expect((await operationRow(client, ambiguous.operationId)).state).toBe('ambiguous');
        expect((await operationRow(client, completed.operationId)).state).toBe('completed');
      }
    });
  });

  it('cancels a waiting attempt too, without a start time', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const c = commands(client, a);
      const accepted = await c.accept(await project(client, a));
      expect(await c.move(accepted.attempt_id, 'cancelled', 'user_cancelled')).toMatchObject({outcome: 'moved', state: 'cancelled', stage: 'accepted', reason: 'user_cancelled'});
      const row = await attemptRow(client, accepted.attempt_id);
      expect(row.started_at).toBeNull();
      expect(row.ended_at).toBeInstanceOf(Date);
    });
  });

  it('answers `invalid_transition` carrying the state for a move that is not listed, and a finished attempt can never be started, extended or changed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const c = commands(client, a);
      const pid = await project(client, a);
      const waiting = await c.accept(pid);
      // waiting -> completed | failed, and anything to waiting.
      for (const [to, reason] of [['completed', null], ['failed', 'step_failed']] as const) {
        expect(await c.move(waiting.attempt_id, to, reason), to).toMatchObject({outcome: 'invalid_transition', state: 'waiting', reason: 'awaiting_dispatch'});
      }
      expect((await attemptRow(client, waiting.attempt_id)).state).toBe('waiting');
      for (const [to, reason] of [['completed', null], ['failed', 'step_failed'], ['cancelled', 'user_cancelled']] as const) {
        const job = await started(client, a);
        expect((await c.move(job.attemptId, to, reason)).outcome).toBe('moved');
        const row = await attemptRow(client, job.attemptId);
        const before = await counts(client, a.accountId);
        for (const [next, nextReason] of [['running', null], ['waiting', null], ['completed', null], ['failed', 'lease_lost'], ['cancelled', 'account_disabled']] as const) {
          if (next === to) continue;
          expect(await c.move(job.attemptId, next, nextReason), `${to} -> ${next}`).toMatchObject({outcome: 'invalid_transition', state: to});
        }
        // ... and it cannot be given a step either, or a different reason.
        expect((await c.begin(job.attemptId, 'late_step', 1)).outcome).toBe('not_running');
        if (to !== 'completed') expect((await c.move(job.attemptId, to, to === 'failed' ? 'lease_lost' : 'account_disabled')).outcome).toBe('invalid_transition');
        expect(await attemptRow(client, job.attemptId)).toEqual(row);
        expect(await counts(client, a.accountId)).toEqual(before);
      }
      // A running attempt does not go back to waiting.
      const running = await started(client, a);
      expect(await c.move(running.attemptId, 'waiting')).toMatchObject({outcome: 'invalid_transition', state: 'running'});
    });
  });

  it('answers `replayed` for the same command, and for a second command ID that finds the attempt already in the state asked for (recorded), but not for a different reason', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const c = job.c;
      const command = randomUUID();
      expect((await c.move(job.attemptId, 'failed', 'step_failed', {command})).outcome).toBe('moved');
      const row = await attemptRow(client, job.attemptId);
      expect(await c.move(job.attemptId, 'failed', 'step_failed', {command})).toMatchObject({outcome: 'replayed', state: 'failed', reason: 'step_failed'});
      const second = randomUUID();
      expect(await c.move(job.attemptId, 'failed', 'step_failed', {command: second})).toMatchObject({outcome: 'replayed', state: 'failed', reason: 'step_failed'});
      expect((await commandRows(client, a.accountId)).find((entry) => entry.command_id === second)).toMatchObject({kind: 'move_attempt', subject_id: job.attemptId});
      expect((await c.move(job.attemptId, 'failed', 'lease_lost')).outcome).toBe('invalid_transition');
      // The running state is a replay too, once the attempt has moved on: the original command still answers.
      const startCommand = (await commandRows(client, a.accountId)).find((entry) => entry.kind === 'move_attempt')!.command_id as string;
      expect(await c.move(job.attemptId, 'running', null, {command: startCommand})).toMatchObject({outcome: 'replayed', state: 'failed'});
      expect(await attemptRow(client, job.attemptId)).toEqual(row);
    });
  });

  it('answers `reused` for the same command ID with another attempt, target or reason, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const c = job.c;
      const command = randomUUID();
      expect((await c.move(job.attemptId, 'failed', 'step_failed', {command})).outcome).toBe('moved');
      const other = await started(client, a);
      const before = await counts(client, a.accountId);
      expect((await c.move(job.attemptId, 'failed', 'lease_lost', {command})).outcome).toBe('reused');
      expect((await c.move(job.attemptId, 'cancelled', 'user_cancelled', {command})).outcome).toBe('reused');
      expect((await c.move(other.attemptId, 'failed', 'step_failed', {command})).outcome).toBe('reused');
      expect(await counts(client, a.accountId)).toEqual(before);
      expect((await attemptRow(client, other.attemptId)).state).toBe('running');
    });
  });

  it('raises 22023 for a bad target or a reason that does not belong to it, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const good = [a.accountId, a.epoch, randomUUID(), job.attemptId, 'failed', 'step_failed'];
      const bad: [string, unknown[]][] = [
        ['a missing attempt', [...good.slice(0, 3), null, 'failed', 'step_failed']],
        ['a missing target', [...good.slice(0, 4), null, 'step_failed']],
        ['an unknown target', [...good.slice(0, 4), 'paused', null]],
        ['a failed move without a reason', [...good.slice(0, 5), null]],
        ['a failed move with a cancel reason', [...good.slice(0, 5), 'user_cancelled']],
        ['a cancelled move without a reason', [...good.slice(0, 4), 'cancelled', null]],
        ['a cancelled move with a failure reason', [...good.slice(0, 4), 'cancelled', 'step_failed']],
        ['a reason outside the closed set', [...good.slice(0, 5), 'timeout']],
        ['a running move with a reason', [...good.slice(0, 4), 'running', 'step_failed']],
        ['a completed move with a reason', [...good.slice(0, 4), 'completed', 'step_failed']],
        ['a waiting move with a reason', [...good.slice(0, 4), 'waiting', 'awaiting_dispatch']],
        ['a derived reason as a stored one', [...good.slice(0, 4), 'failed', 'awaiting_reconciliation']],
      ];
      for (const [label, params] of bad) {
        const result = await attempt(client, 'service_role', MOVE, params);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      expect((await attemptRow(client, job.attemptId)).state).toBe('running');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the retry and its gate: a new attempt does not start while an earlier operation is potentially chargeable', () => {
  it('creates attempt 2 after a failed attempt 1 whose operations are all terminal, or none: waiting, stage retry, awaiting_dispatch; and starting it succeeds', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const op of ['none', 'planned', 'completed', 'noncharge', 'settled'] as const) {
        const job = await failedWith(client, a, op);
        const retry = await job.c.retry(job.jobId, 1, {digest: D('second input')});
        expect(retry, op).toMatchObject({outcome: 'created', job_id: job.jobId, attempt_number: 2, state: 'waiting', stage: 'retry', reason: 'awaiting_dispatch'});
        const row = await attemptRow(client, retry.attempt_id);
        expect(row, op).toMatchObject({number: 2, previous_attempt_id: job.attemptId, input_digest: D('second input'), state: 'waiting', stage: 'retry', reason: null, started_at: null});
        expect(await job.c.move(retry.attempt_id, 'running'), op).toMatchObject({outcome: 'moved', state: 'running', stage: 'started'});
      }
    });
  });

  it.each(['dispatched', 'ambiguous'] as const)('creates attempt 2 after a failed attempt 1 with a %s operation as waiting with reason awaiting_reconciliation, and refuses to start it', async (state) => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, state);
      const retry = await job.c.retry(job.jobId, 1);
      expect(retry).toMatchObject({outcome: 'created', attempt_number: 2, state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation'});
      const blocked = await job.c.move(retry.attempt_id, 'running');
      expect(blocked).toMatchObject({outcome: 'blocked', attempt_id: retry.attempt_id, state: 'waiting', reason: 'awaiting_reconciliation'});
      const row = await attemptRow(client, retry.attempt_id);
      expect(row).toMatchObject({state: 'waiting', stage: 'retry', reason: null, started_at: null});
      // The wait is the same however often it is asked, and a refusal leaves no receipt.
      const commandsBefore = (await counts(client, a.accountId)).commands;
      for (let round = 0; round < 3; round += 1) expect((await job.c.move(retry.attempt_id, 'running')).outcome).toBe('blocked');
      expect((await counts(client, a.accountId)).commands).toBe(commandsBefore);
      expect((await job.c.read(job.jobId))).toMatchObject({state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation', can_retry: false});
    });
  });

  it('opens the gate when the operation is settled, noncharge or completed: the reason then reads awaiting_dispatch and the start succeeds (wait, reconcile, start)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const reconcile of [
        [['ambiguous', null], ['settled', null]],
        [['noncharge', 'req_rejected_2']],
        [['completed', null]],
        [['ambiguous', null], ['noncharge', 'req_rejected_3']],
      ] as [string, string | null][][]) {
        const job = await failedWith(client, a, 'dispatched');
        const retry = await job.c.retry(job.jobId, 1);
        expect(retry.reason).toBe('awaiting_reconciliation');
        for (const [index, [to, requestId]] of reconcile.entries()) {
          expect((await job.c.move(retry.attempt_id, 'running')).outcome).toBe('blocked');
          expect((await job.c.advance(job.operationId as string, to, requestId)).outcome).toBe('advanced');
          const last = index === reconcile.length - 1;
          expect((await job.c.read(job.jobId)).reason, to).toBe(last ? 'awaiting_dispatch' : 'awaiting_reconciliation');
        }
        expect(await job.c.move(retry.attempt_id, 'running')).toMatchObject({outcome: 'moved', state: 'running', stage: 'started'});
      }
    });
  });

  it('looks at every earlier attempt: no attempt number, and no third attempt, passes an unresolved charge', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, 'ambiguous');
      const second = await job.c.retry(job.jobId, 1);
      // The gate, asked directly for any number past 1, is closed while attempt 1's operation is ambiguous.
      for (const number of [2, 3, 10, 1000]) expect((await client.query('select jobs.charge_open($1, $2) as open', [job.jobId, number])).rows[0].open, String(number)).toBe(true);
      expect((await client.query('select jobs.charge_open($1, 1) as open', [job.jobId])).rows[0].open).toBe(false);
      // A third attempt cannot be requested while attempt 2 waits (nothing but a failed attempt is retried), nor with a stale or invented number.
      expect(await job.c.retry(job.jobId, 2)).toMatchObject({outcome: 'not_retryable', state: 'waiting', attempt_number: 2});
      expect(await job.c.retry(job.jobId, 3)).toMatchObject({outcome: 'stale', attempt_number: 2});
      expect(await job.c.retry(job.jobId, 1)).toMatchObject({outcome: 'stale', attempt_number: 2});
      expect((await job.c.move(second.attempt_id, 'running')).outcome).toBe('blocked');
      // Not even the owner can start it by hand: the move to running is guarded by the table too, and only the command applies the gate.
      expect((await counts(client, a.accountId)).attempts).toBe(2);
      // An operation of an earlier attempt that is reconciled later in the chain still counts while it is open: three attempts, the first charge unresolved.
      const owner = await attempt(
        client,
        null,
        `insert into jobs.attempts (account_id, job_id, number, previous_attempt_id, input_digest, state, stage) values ($1, $2, 3, $3, $4, 'waiting', 'retry')`,
        [a.accountId, job.jobId, second.attempt_id, D('x')],
      );
      expect(owner.ok).toBe(false);
    });
  });

  it('closes the gate over the earlier attempts of a long chain: an unresolved charge in attempt 1 holds attempt 3 as it holds attempt 2', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const first = await failedWith(client, a, 'ambiguous');
      const second = await first.c.retry(first.jobId, 1);
      // Reconcile attempt 1's charge to open the gate, run attempt 2 with a charge of its own, and fail it.
      await first.c.advance(first.operationId as string, 'settled');
      expect((await first.c.move(second.attempt_id, 'running')).outcome).toBe('moved');
      const op = await stepWithOperation(first.c, second.attempt_id, 'again');
      await first.c.advance(op.operationId, 'dispatched');
      await first.c.move(second.attempt_id, 'failed', 'lease_lost');
      const third = await first.c.retry(first.jobId, 2);
      expect(third).toMatchObject({outcome: 'created', attempt_number: 3, reason: 'awaiting_reconciliation'});
      expect((await first.c.move(third.attempt_id, 'running')).outcome).toBe('blocked');
      expect((await client.query('select jobs.charge_open($1, 3) as open, jobs.charge_open($1, 2) as before_two', [first.jobId])).rows[0]).toEqual({open: true, before_two: false});
      await first.c.advance(op.operationId, 'completed');
      expect((await first.c.move(third.attempt_id, 'running')).outcome).toBe('moved');
    });
  });

  it('answers `stale` with the highest number when the person saw an older attempt, and `not_retryable` with the state unless the highest attempt has failed; nothing is created', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const c = commands(client, a);
      const pid = await project(client, a);
      const accepted = await c.accept(pid);
      const attemptId = accepted.attempt_id as string;
      // waiting
      expect(await c.retry(accepted.job_id, 1)).toMatchObject({outcome: 'not_retryable', state: 'waiting', attempt_number: 1});
      await c.move(attemptId, 'running');
      expect(await c.retry(accepted.job_id, 1)).toMatchObject({outcome: 'not_retryable', state: 'running'});
      await c.move(attemptId, 'completed');
      expect(await c.retry(accepted.job_id, 1)).toMatchObject({outcome: 'not_retryable', state: 'completed'});
      const cancelled = await started(client, a);
      await cancelled.c.move(cancelled.attemptId, 'cancelled', 'user_cancelled');
      expect(await cancelled.c.retry(cancelled.jobId, 1)).toMatchObject({outcome: 'not_retryable', state: 'cancelled'});
      expect(await c.retry(accepted.job_id, 7)).toMatchObject({outcome: 'stale', attempt_number: 1});
      expect(await c.retry(accepted.job_id, 2)).toMatchObject({outcome: 'stale', attempt_number: 1});
      expect((await counts(client, a.accountId)).attempts).toBe(2);
      // A stale number wins over a state that is not retryable, and over a good number.
      const failed = await failedWith(client, a, 'none');
      await failed.c.retry(failed.jobId, 1);
      expect(await failed.c.retry(failed.jobId, 1)).toMatchObject({outcome: 'stale', attempt_number: 2});
      expect((await counts(client, a.accountId)).attempts).toBe(4);
    });
  });

  it('answers `replayed` for the same retry command (the same attempt, its reason as it is now) and `reused` for another payload; a second command ID for the same number is stale', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, 'dispatched');
      const command = randomUUID();
      const created = await job.c.retry(job.jobId, 1, {command, digest: D('retry input')});
      expect(created).toMatchObject({outcome: 'created', reason: 'awaiting_reconciliation'});
      const receipt = (await commandRows(client, a.accountId)).find((entry) => entry.command_id === command);
      expect(receipt).toMatchObject({kind: 'request_retry', digest: digestOf('request_retry', job.jobId, '1', D('retry input')), subject_id: created.attempt_id});
      expect(await job.c.retry(job.jobId, 1, {command, digest: D('retry input')})).toMatchObject({outcome: 'replayed', attempt_id: created.attempt_id, attempt_number: 2, reason: 'awaiting_reconciliation'});
      // The original receipt shows the reason as it is now, after the charge is reconciled.
      await job.c.advance(job.operationId as string, 'completed');
      expect(await job.c.retry(job.jobId, 1, {command, digest: D('retry input')})).toMatchObject({outcome: 'replayed', reason: 'awaiting_dispatch'});
      expect((await job.c.retry(job.jobId, 1, {command, digest: D('other input')})).outcome).toBe('reused');
      expect((await job.c.retry(job.jobId, 2, {command, digest: D('retry input')})).outcome).toBe('reused');
      expect(await job.c.retry(job.jobId, 1)).toMatchObject({outcome: 'stale', attempt_number: 2});
      expect((await counts(client, a.accountId)).attempts).toBe(2);
    });
  });

  it('never retries by itself: only accept_job and request_retry insert attempts, and failing an attempt leaves exactly one', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, 'completed');
      expect((await counts(client, a.accountId)).attempts).toBe(1);
      const definitions = (
        await client.query(
          `select f.signature from (
             select p.oid, p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('api', 'jobs', 'identity', 'projects', 'lifecycle', 'usage', 'artifacts') and p.prokind = 'f' offset 0
           ) f where pg_get_functiondef(f.oid) ~* 'insert into jobs\\.attempts'`,
        )
      ).rows.map((row) => row.signature);
      expect(definitions.sort()).toEqual(['api.accept_job(uuid,bigint,uuid,uuid,text,text)', 'api.request_retry(uuid,bigint,uuid,uuid,integer,text)']);
    });
  });

  it('raises 22023 for a bad expected number or digest, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, 'none');
      const good = [a.accountId, a.epoch, randomUUID(), job.jobId, 1, D('x')];
      const bad: [string, unknown[]][] = [
        ['a missing Job', [...good.slice(0, 3), null, 1, D('x')]],
        ['a missing number', [...good.slice(0, 4), null, D('x')]],
        ['number 0', [...good.slice(0, 4), 0, D('x')]],
        ['a negative number', [...good.slice(0, 4), -1, D('x')]],
        ['a missing digest', [...good.slice(0, 5), null]],
        ['a short digest', [...good.slice(0, 5), 'abc']],
        ['an upper-case digest', [...good.slice(0, 5), D('x').toUpperCase()]],
      ];
      for (const [label, params] of bad) {
        const result = await attempt(client, 'service_role', RETRY, params);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      expect((await counts(client, a.accountId)).attempts).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the public state and api.read_job: the Job\'s state is its highest attempt\'s, and agrees with the records', () => {
  /** What the stored attempt rows say the Job\'s state is: the highest attempt\'s, with a waiting attempt\'s reason derived from the operations. */
  async function expectedState(client: Client, jobId: string) {
    const {rows: all} = await client.query(
      `select a.number, a.state, a.stage, a.reason,
              exists (select 1 from jobs.attempts e join jobs.steps s on s.attempt_id = e.id join jobs.operations o on o.step_id = s.id
                       where e.job_id = a.job_id and e.number < a.number and o.state in ('dispatched', 'ambiguous')) as gated
         from jobs.attempts a where a.job_id = $1 order by a.number desc limit 1`,
      [jobId],
    );
    const top = all[0];
    return {state: top.state, stage: top.stage, reason: top.state === 'waiting' ? (top.gated ? 'awaiting_reconciliation' : 'awaiting_dispatch') : top.reason};
  }

  it('shows exactly the fields it promises, and nothing else: no digest, no request ID, no step, no operation', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, 'ambiguous');
      await job.c.retry(job.jobId, 1);
      const read = await job.c.read(job.jobId);
      expect(Object.keys(read).sort()).toEqual(['attempts', 'can_retry', 'created_at', 'job_id', 'kind', 'outcome', 'project_id', 'reason', 'stage', 'state']);
      expect(read.attempts).toHaveLength(2);
      for (const entry of read.attempts) {
        expect(Object.keys(entry).sort()).toEqual(['chargeable_operations', 'created_at', 'ended_at', 'id', 'number', 'reason', 'stage', 'started_at', 'state']);
      }
      const text = JSON.stringify(read);
      expect(text).not.toContain(D('input'));
      expect(text).not.toContain(D('retry'));
    });
  });

  it('has the Job\'s state, stage and reason equal to the stored highest attempt through a whole life, including the derived reason of a waiting attempt', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const c = commands(client, a);
      const pid = await project(client, a);
      const accepted = await c.accept(pid);
      const check = async (label: string) => {
        const read = await c.read(accepted.job_id);
        const expected = await expectedState(client, accepted.job_id);
        expect({state: read.state, stage: read.stage, reason: read.reason}, label).toEqual(expected);
        expect(read.attempts[read.attempts.length - 1], label).toMatchObject({state: expected.state, stage: expected.stage, reason: expected.reason});
        return read;
      };
      expect(await check('accepted')).toMatchObject({state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch', can_retry: false, kind: 'research', project_id: pid});
      await c.move(accepted.attempt_id, 'running');
      expect(await check('started')).toMatchObject({state: 'running', stage: 'started', reason: null, can_retry: false});
      const op = await stepWithOperation(c, accepted.attempt_id, 'search');
      expect(await check('step')).toMatchObject({state: 'running', stage: 'search'});
      await c.advance(op.operationId, 'dispatched');
      expect((await check('dispatched')).attempts[0].chargeable_operations).toBe(1);
      await c.move(accepted.attempt_id, 'failed', 'step_failed');
      expect(await check('failed')).toMatchObject({state: 'failed', stage: 'search', reason: 'step_failed', can_retry: true});
      const retry = await c.retry(accepted.job_id, 1);
      expect(await check('retry')).toMatchObject({state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation', can_retry: false});
      await c.advance(op.operationId, 'ambiguous');
      expect((await check('ambiguous')).attempts[0].chargeable_operations).toBe(1);
      await c.advance(op.operationId, 'settled');
      const open = await check('settled');
      expect(open).toMatchObject({state: 'waiting', reason: 'awaiting_dispatch'});
      expect(open.attempts[0].chargeable_operations).toBe(0);
      await c.move(retry.attempt_id, 'running');
      await c.move(retry.attempt_id, 'cancelled', 'account_disabled');
      expect(await check('cancelled')).toMatchObject({state: 'cancelled', stage: 'started', reason: 'account_disabled', can_retry: false});
    });
  });

  it('lists every attempt in order with its times and its own count of potentially chargeable operations', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const first = await failedWith(client, a, 'ambiguous');
      const second = await first.c.retry(first.jobId, 1);
      await first.c.advance(first.operationId as string, 'settled');
      await first.c.move(second.attempt_id, 'running');
      const op = await stepWithOperation(first.c, second.attempt_id, 'again');
      await first.c.advance(op.operationId, 'dispatched');
      const read = await first.c.read(first.jobId);
      expect(read.attempts.map((entry: {number: number}) => entry.number)).toEqual([1, 2]);
      expect(read.attempts.map((entry: {id: string}) => entry.id)).toEqual([first.attemptId, second.attempt_id]);
      expect(read.attempts[0]).toMatchObject({state: 'failed', stage: 'search', reason: 'step_failed', chargeable_operations: 0});
      expect(read.attempts[1]).toMatchObject({state: 'running', stage: 'again', reason: null, chargeable_operations: 1});
      for (const entry of read.attempts) {
        expect(Date.parse(entry.created_at)).not.toBeNaN();
        expect(entry.started_at === null || Date.parse(entry.started_at) > 0).toBe(true);
      }
      expect(read.attempts[0].ended_at).not.toBeNull();
      expect(read.attempts[1].ended_at).toBeNull();
    });
  });

  it('derives the reason of a waiting attempt from the operations of the earlier ones and stores it nowhere', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, 'dispatched');
      const retry = await job.c.retry(job.jobId, 1);
      expect((await attemptRow(client, retry.attempt_id)).reason).toBeNull();
      expect((await job.c.read(job.jobId)).reason).toBe('awaiting_reconciliation');
      await job.c.advance(job.operationId as string, 'completed');
      expect((await attemptRow(client, retry.attempt_id)).reason).toBeNull();
      expect((await job.c.read(job.jobId)).reason).toBe('awaiting_dispatch');
      const {rows: columns} = await client.query(`select column_name from information_schema.columns where table_schema = 'jobs' and table_name = 'jobs' order by ordinal_position`);
      expect(columns.map((column) => column.column_name)).toEqual(['id', 'account_id', 'project_id', 'kind', 'created_at']);
      const {rows: derived} = await client.query(`select state, stage, reason from jobs.public_state($1)`, [job.jobId]);
      expect(derived).toEqual([{state: 'waiting', stage: 'retry', reason: 'awaiting_dispatch'}]);
    });
  });

  it('refuses the stored reasons that are not in the closed set, and a stored `awaiting` reason, whoever writes it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      for (const [state, reason] of [['failed', 'awaiting_dispatch'], ['failed', 'user_cancelled'], ['failed', null], ['cancelled', 'step_failed'], ['cancelled', null], ['completed', 'step_failed'], ['running', 'step_failed']]) {
        const result = await attempt(client, null, `update jobs.attempts set state = $2, reason = $3, ended_at = case when $2 = 'running' then null else now() end where id = $1`, [job.attemptId, state, reason]);
        expect(result.ok, `${state} ${reason}`).toBe(false);
      }
      expect((await attemptRow(client, job.attemptId)).state).toBe('running');
    });
  });

  it('answers `denied` for a stale epoch and `unavailable` for a foreign, deleted, unknown or tombstoned Job, with nothing in it; and raises 22023 for a bad shape', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const mine = await started(client, a);
      const theirs = await started(client, b);
      expect((await mine.c.read(mine.jobId)).outcome).toBe('found');
      expect(await mine.c.read(mine.jobId, {epoch: 5})).toMatchObject({outcome: 'denied', job_id: null, attempts: null});
      for (const id of [theirs.jobId, randomUUID()]) expect(await mine.c.read(id)).toMatchObject({outcome: 'unavailable', job_id: null, state: null, attempts: null});
      for (const [label, params] of [['a missing Account', [null, 1, mine.jobId]], ['a missing epoch', [a.accountId, null, mine.jobId]], ['a missing Job', [a.accountId, 1, null]]] as [string, unknown[]][]) {
        const result = await attempt(client, 'service_role', READ, params);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      await client.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [mine.projectId]);
      expect((await mine.c.read(mine.jobId)).outcome).toBe('unavailable');
      await svc(client, `select * from api.record_tombstone('project', $1)`, [theirs.projectId]);
      expect((await theirs.c.read(theirs.jobId)).outcome).toBe('unavailable');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('immutability: a record is not edited, and what finished stays finished', () => {
  it('refuses to update or truncate a Job, a step or a receipt, whoever tries and whichever column, and refuses to truncate an attempt or an operation', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const step = await stepWithOperation(job.c, job.attemptId);
      for (const [sql, params] of [
        [`update jobs.jobs set kind = 'other' where id = $1`, [job.jobId]],
        [`update jobs.jobs set created_at = now() where id = $1`, [job.jobId]],
        [`update jobs.jobs set project_id = project_id where id = $1`, [job.jobId]],
        [`update jobs.steps set step_key = 'other' where id = $1`, [step.stepId]],
        [`update jobs.steps set created_at = now() where id = $1`, [step.stepId]],
        [`update jobs.commands set digest = repeat('a', 64) where account_id = $1`, [a.accountId]],
        [`update jobs.commands set subject_id = gen_random_uuid() where account_id = $1`, [a.accountId]],
        [`truncate jobs.jobs cascade`, []],
        [`truncate jobs.steps cascade`, []],
        [`truncate jobs.commands`, []],
        [`truncate jobs.attempts cascade`, []],
        [`truncate jobs.operations`, []],
      ] as [string, unknown[]][]) {
        const result = await attempt(client, null, sql, params);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      expect(await counts(client, a.accountId)).toEqual({jobs: 1, attempts: 1, steps: 1, operations: 1, commands: 3});
    });
  });

  it('never changes an identity column of an attempt or an operation, and writes a time and a request ID once', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const op = await stepWithOperation(job.c, job.attemptId);
      await job.c.advance(op.operationId, 'dispatched', 'req_once_1');
      for (const [sql, params] of [
        [`update jobs.attempts set number = 9 where id = $1`, [job.attemptId]],
        [`update jobs.attempts set input_digest = repeat('b', 64) where id = $1`, [job.attemptId]],
        [`update jobs.attempts set job_id = gen_random_uuid() where id = $1`, [job.attemptId]],
        [`update jobs.attempts set created_at = now() where id = $1`, [job.attemptId]],
        [`update jobs.attempts set started_at = now() where id = $1`, [job.attemptId]],
        [`update jobs.attempts set id = gen_random_uuid() where id = $1`, [job.attemptId]],
        [`update jobs.operations set ordinal = 2 where id = $1`, [op.operationId]],
        [`update jobs.operations set step_id = gen_random_uuid() where id = $1`, [op.operationId]],
        [`update jobs.operations set created_at = now() where id = $1`, [op.operationId]],
        [`update jobs.operations set dispatched_at = now() where id = $1`, [op.operationId]],
        [`update jobs.operations set request_id = 'req_other' where id = $1`, [op.operationId]],
        [`update jobs.operations set request_id = null where id = $1`, [op.operationId]],
        [`update jobs.operations set state = 'ambiguous', request_id = 'req_other', outcome_at = now() where id = $1`, [op.operationId]],
      ] as [string, unknown[]][]) {
        const result = await attempt(client, null, sql, params);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(['55000', '23514'], sql).toContain(result.code);
      }
      await job.c.advance(op.operationId, 'ambiguous');
      const outcomeAt = (await operationRow(client, op.operationId)).outcome_at;
      const again = await attempt(client, null, `update jobs.operations set state = 'settled', outcome_at = now() where id = $1`, [op.operationId]);
      expect(again.ok).toBe(false);
      expect((await operationRow(client, op.operationId)).outcome_at).toEqual(outcomeAt);
    });
  });

  it('allows only the guarded moves of an attempt and of an operation to the owner too: a jump, a step back, a skipped state and a change out of a terminal state are refused', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await started(client, a);
      const op = await stepWithOperation(job.c, job.attemptId);
      // Operation: planned -> completed (skipped), planned -> settled, planned -> ambiguous.
      for (const to of ['completed', 'settled', 'ambiguous', 'noncharge', 'planned']) {
        const result = await attempt(client, null, `update jobs.operations set state = $2, dispatched_at = now(), outcome_at = now(), request_id = 'req_a' where id = $1`, [op.operationId, to]);
        expect(result.ok, to).toBe(false);
      }
      await job.c.advance(op.operationId, 'dispatched');
      for (const to of ['planned', 'dispatched', 'settled', 'abandoned']) {
        const result = await attempt(client, null, `update jobs.operations set state = $2 where id = $1`, [op.operationId, to]);
        expect(result.ok, `dispatched -> ${to}`).toBe(false);
      }
      await job.c.advance(op.operationId, 'completed');
      for (const to of ['dispatched', 'ambiguous', 'settled', 'noncharge', 'abandoned', 'planned']) {
        const result = await attempt(client, null, `update jobs.operations set state = $2 where id = $1`, [op.operationId, to]);
        expect(result.ok, `completed -> ${to}`).toBe(false);
        if (!result.ok) expect(result.code, `completed -> ${to}`).toBe('55000');
      }
      // Attempt: running -> waiting; and out of every terminal state.
      for (const to of ['waiting']) {
        const result = await attempt(client, null, `update jobs.attempts set state = $2, started_at = null where id = $1`, [job.attemptId, to]);
        expect(result.ok, `running -> ${to}`).toBe(false);
      }
      await job.c.move(job.attemptId, 'failed', 'step_failed');
      for (const to of ['running', 'waiting', 'completed', 'cancelled']) {
        const result = await attempt(client, null, `update jobs.attempts set state = $2 where id = $1`, [job.attemptId, to]);
        expect(result.ok, `failed -> ${to}`).toBe(false);
        if (!result.ok) expect(result.code, `failed -> ${to}`).toBe('55000');
      }
      expect((await attempt(client, null, `update jobs.attempts set stage = 'other' where id = $1`, [job.attemptId])).ok).toBe(false);
      expect((await attempt(client, null, `update jobs.attempts set reason = 'lease_lost' where id = $1`, [job.attemptId])).ok).toBe(false);
      expect((await attemptRow(client, job.attemptId))).toMatchObject({state: 'failed', reason: 'step_failed', stage: 'search'});
    });
  });

  it('allows deleting the records of an Account in dependency order (the Epic 8 purge), and RESTRICT holds the parents until the children are gone', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await failedWith(client, a, 'completed');
      await job.c.retry(job.jobId, 1);
      for (const sql of [`delete from jobs.jobs where account_id = $1`, `delete from jobs.attempts where account_id = $1`, `delete from jobs.steps where account_id = $1`]) {
        const result = await attempt(client, null, sql, [a.accountId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('23503');
      }
      for (const table of ['operations', 'steps', 'attempts', 'jobs', 'commands']) {
        expect((await attempt(client, null, `delete from jobs.${table} where account_id = $1`, [a.accountId])).ok, table).toBe(true);
      }
      expect(await counts(client, a.accountId)).toEqual({jobs: 0, attempts: 0, steps: 0, operations: 0, commands: 0});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('real connections: one command at a time for a command ID and for a Job', () => {
  it('makes one Job and two replays when the same accept arrives three times at once', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const clients = await Promise.all([connect(), connect(), connect()]);
    const command = randomUUID();
    const answers = await Promise.all(clients.map((client) => client.query(ACCEPT, [a.accountId, a.epoch, command, pid, 'research', D('x')])));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['created', 'replayed', 'replayed']);
    expect(new Set(answers.map((answer) => answer.rows[0].job_id)).size).toBe(1);
    expect(await counts(db, a.accountId)).toEqual({jobs: 1, attempts: 1, steps: 0, operations: 0, commands: 1});
  });

  it('makes one step and one operation when two commands (two IDs) for the same step arrive at once: one `created`, one `replayed` with the original IDs', async () => {
    const a = await committedAccount();
    const job = await started(db, a, undefined, true);
    const [one, two, three] = await Promise.all([connect(), connect(), connect()]);
    const answers = await Promise.all([one, two, three].map((client) => client.query(BEGIN, [a.accountId, a.epoch, randomUUID(), job.attemptId, 'search', 1])));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['created', 'replayed', 'replayed']);
    expect(new Set(answers.map((answer) => answer.rows[0].step_id)).size).toBe(1);
    expect(new Set(answers.map((answer) => answer.rows[0].operation_id)).size).toBe(1);
    expect(await counts(db, a.accountId)).toMatchObject({steps: 1, operations: 1});
    // All three are recorded as commands.
    expect((await counts(db, a.accountId)).commands).toBe(2 + 3);
  });

  it('makes one operation for each ordinal when different ordinals of one step arrive at once', async () => {
    const a = await committedAccount();
    const job = await started(db, a, undefined, true);
    const clients = await Promise.all([connect(), connect(), connect(), connect()]);
    const answers = await Promise.all(clients.map((client, index) => client.query(BEGIN, [a.accountId, a.epoch, randomUUID(), job.attemptId, 'search', (index % 2) + 1])));
    expect(answers.map((answer) => answer.rows[0].outcome).sort()).toEqual(['created', 'created', 'replayed', 'replayed']);
    expect(await counts(db, a.accountId)).toMatchObject({steps: 1, operations: 2});
  });

  it('gives a consistent gate answer when a retry races a reconcile of the earlier charge: the retry waits for the reconcile that holds the Job, then reads it as reconciled', async () => {
    const a = await committedAccount();
    const job = await failedWith(db, a, 'ambiguous', true);
    const reconciler = await connect();
    const retrier = await connect();
    const {rows: pid} = await retrier.query('select pg_backend_pid() as pid');
    await reconciler.query('begin');
    expect((await reconciler.query(ADVANCE, [a.accountId, a.epoch, randomUUID(), job.operationId, 'settled', null])).rows[0].outcome).toBe('advanced');
    const retrying = retrier.query(RETRY, [a.accountId, a.epoch, randomUUID(), job.jobId, 1, D('r')]);
    await untilBlocked(pid[0].pid);
    await reconciler.query('commit');
    expect((await retrying).rows[0]).toMatchObject({outcome: 'created', attempt_number: 2, reason: 'awaiting_dispatch'});
    expect((await job.c.move((await retrying).rows[0].attempt_id, 'running')).outcome).toBe('moved');
  });

  it('gives a consistent gate answer the other way round: a reconcile waits for a retry that holds the Job, and the start then passes', async () => {
    const a = await committedAccount();
    const job = await failedWith(db, a, 'dispatched', true);
    const retrier = await connect();
    const reconciler = await connect();
    const {rows: pid} = await reconciler.query('select pg_backend_pid() as pid');
    await retrier.query('begin');
    const created = (await retrier.query(RETRY, [a.accountId, a.epoch, randomUUID(), job.jobId, 1, D('r')])).rows[0];
    expect(created).toMatchObject({outcome: 'created', reason: 'awaiting_reconciliation'});
    const reconciling = reconciler.query(ADVANCE, [a.accountId, a.epoch, randomUUID(), job.operationId, 'completed', null]);
    await untilBlocked(pid[0].pid);
    await retrier.query('commit');
    expect((await reconciling).rows[0].outcome).toBe('advanced');
    expect((await job.c.read(job.jobId)).reason).toBe('awaiting_dispatch');
    expect((await job.c.move(created.attempt_id, 'running')).outcome).toBe('moved');
  });

  it('holds a start behind a reconcile that has not committed, and blocks it if the reconcile is rolled back', async () => {
    const a = await committedAccount();
    const job = await failedWith(db, a, 'ambiguous', true);
    const retry = await job.c.retry(job.jobId, 1);
    const reconciler = await connect();
    const starter = await connect();
    const {rows: pid} = await starter.query('select pg_backend_pid() as pid');
    await reconciler.query('begin');
    await reconciler.query(ADVANCE, [a.accountId, a.epoch, randomUUID(), job.operationId, 'settled', null]);
    const starting = starter.query(MOVE, [a.accountId, a.epoch, randomUUID(), retry.attempt_id, 'running', null]);
    await untilBlocked(pid[0].pid);
    await reconciler.query('rollback');
    expect((await starting).rows[0]).toMatchObject({outcome: 'blocked', reason: 'awaiting_reconciliation'});
    expect((await attemptRow(db, retry.attempt_id)).state).toBe('waiting');
  });

  it('never shows the Job in one state and its highest attempt in another: a command that commits while the read waits does not split the read', async () => {
    const a = await committedAccount();
    const job = await started(db, a, undefined, true);
    await stepWithOperation(job.c, job.attemptId, 'search');
    const holder = await connect();
    const reader = await connect();
    const {rows: pid} = await reader.query('select pg_backend_pid() as pid');
    // The holder takes the operations table and keeps it, so the read stops at the first thing it needs from it: for a read in two statements, between the one that
    // finds the Job's state (attempt 1 is running and does not need the operations) and the one that lists the attempts (which counts them).
    await holder.query('begin');
    await holder.query('lock table jobs.operations in access exclusive mode');
    const reading = reader.query(READ, [a.accountId, a.epoch, job.jobId]);
    await untilBlocked(pid[0].pid);
    expect((await holder.query(MOVE, [a.accountId, a.epoch, randomUUID(), job.attemptId, 'failed', 'step_failed'])).rows[0].outcome).toBe('moved');
    await holder.query('commit');
    const read = (await reading).rows[0];
    expect(read.outcome).toBe('found');
    const highest = read.attempts[read.attempts.length - 1];
    // The Job's state, stage and reason are its highest attempt's, whichever side of the commit the read saw.
    expect({state: read.state, stage: read.stage, reason: read.reason}).toEqual({state: highest.state, stage: highest.stage, reason: highest.reason});
    expect(read.can_retry).toBe(highest.state === 'failed');
    expect(['running', 'failed']).toContain(read.state);
    // The typed read accepts what the database answered (it fails closed on a Job whose state is not its highest attempt's).
    expect((await readJob({accountId: a.accountId, epoch: a.epoch}, {jobId: job.jobId}, {env})).outcome).toBe('found');
  });

  it('never lets a step land after a tombstone: a begin_step that waits for api.record_tombstone finds the Project gone and answers `unavailable`', async () => {
    const a = await committedAccount();
    const job = await started(db, a, undefined, true);
    const recorder = await connect();
    const stepper = await connect();
    const {rows: pid} = await stepper.query('select pg_backend_pid() as pid');
    await recorder.query('begin');
    expect((await recorder.query(`select outcome from api.record_tombstone('project', $1)`, [job.projectId])).rows[0].outcome).toBe('recorded');
    const stepping = stepper.query(BEGIN, [a.accountId, a.epoch, randomUUID(), job.attemptId, 'search', 1]);
    await untilBlocked(pid[0].pid);
    await recorder.query('commit');
    expect((await stepping).rows[0]).toMatchObject({outcome: 'unavailable', step_id: null, operation_id: null});
    expect(await counts(db, a.accountId)).toMatchObject({steps: 0, operations: 0});
  });

  it('lets a tombstone wait for a step that holds the Project: the step lands first, and nothing lands after', async () => {
    const a = await committedAccount();
    const job = await started(db, a, undefined, true);
    const stepper = await connect();
    const recorder = await connect();
    const {rows: pid} = await recorder.query('select pg_backend_pid() as pid');
    await stepper.query('begin');
    expect((await stepper.query(BEGIN, [a.accountId, a.epoch, randomUUID(), job.attemptId, 'search', 1])).rows[0].outcome).toBe('created');
    const recording = recorder.query(`select outcome from api.record_tombstone('project', $1)`, [job.projectId]);
    await untilBlocked(pid[0].pid);
    await stepper.query('commit');
    expect((await recording).rows[0].outcome).toBe('recorded');
    expect(await counts(db, a.accountId)).toMatchObject({steps: 1, operations: 1});
    // After the tombstone, every command is `unavailable` and nothing is added.
    const after = await job.c.begin(job.attemptId, 'later_step', 1);
    expect(after.outcome).toBe('unavailable');
    expect((await job.c.move(job.attemptId, 'failed', 'step_failed')).outcome).toBe('unavailable');
    expect(await counts(db, a.accountId)).toMatchObject({steps: 1, operations: 1});
  });

  it('is one winner every time when an Account is disabled while a command runs: the command commits first, or it is `denied`', async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < 5; round += 1) {
      const a = await committedAccount();
      const job = await started(db, a, undefined, true);
      const [one, two] = await Promise.all([connect(), connect()]);
      const [begun, disabled] = await Promise.all([
        one.query(BEGIN, [a.accountId, a.epoch, randomUUID(), job.attemptId, 'search', 1]),
        two.query(`select outcome from api.disable_account('seed:local:jobs', $1)`, [a.accountId]),
      ]);
      expect(disabled.rows[0].outcome).toBe('disabled');
      const outcome = begun.rows[0].outcome as string;
      outcomes.add(outcome);
      expect(['created', 'denied']).toContain(outcome);
      expect((await counts(db, a.accountId)).steps).toBe(outcome === 'created' ? 1 : 0);
    }
    expect([...outcomes].every((outcome) => outcome === 'created' || outcome === 'denied')).toBe(true);
  });

  it('waits for the Job\'s advisory lock `nova3d:job:<job>` and answers once it is released', async () => {
    const a = await committedAccount();
    const job = await started(db, a, undefined, true);
    const holder = await connect();
    const caller = await connect();
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d:job:' || $1::text, 0))`, [job.jobId]);
    const {rows: pid} = await caller.query('select pg_backend_pid() as pid');
    const running = caller.query(BEGIN, [a.accountId, a.epoch, randomUUID(), job.attemptId, 'search', 1]);
    await untilBlocked(pid[0].pid);
    await holder.query('commit');
    expect((await running).rows[0].outcome).toBe('created');
  });

  it('waits for the command lock `nova3d:jobs-command:<account>:<command>` and then replays', async () => {
    const a = await committedAccount();
    const job = await started(db, a, undefined, true);
    const command = randomUUID();
    const holder = await connect();
    const caller = await connect();
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d:jobs-command:' || $1::text || ':' || $2::text, 0))`, [a.accountId, command]);
    const {rows: pid} = await caller.query('select pg_backend_pid() as pid');
    const running = caller.query(BEGIN, [a.accountId, a.epoch, command, job.attemptId, 'search', 1]);
    await untilBlocked(pid[0].pid);
    // The holder does the work under the same lock, as a command in flight would.
    await holder.query(BEGIN, [a.accountId, a.epoch, command, job.attemptId, 'search', 1]);
    await holder.query('commit');
    expect((await running).rows[0].outcome).toBe('replayed');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls of lib/job-records.ts against the real database', () => {
  it('accepts a Job, begins a step, advances an operation, moves an attempt, asks for a retry and reads the Job, as the application will over REST', async () => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const accepted = await acceptJob(operation, {commandId: randomUUID(), projectId: pid, kind: 'research', inputDigest: D('one')}, {env});
    expect(accepted.outcome).toBe('created');
    if (accepted.outcome !== 'created') return;
    expect(accepted.attempt).toMatchObject({number: 1, state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch'});
    const attemptId = accepted.attempt.id;
    expect(await moveAttempt(operation, {commandId: randomUUID(), attemptId, to: 'running'}, {env})).toMatchObject({outcome: 'moved', attempt: {state: 'running', stage: 'started'}});
    const stepCommand = randomUUID();
    const begun = await beginStep(operation, {commandId: stepCommand, attemptId, stepKey: 'search', ordinal: 1}, {env});
    expect(begun).toMatchObject({outcome: 'created', attemptState: 'running'});
    if (begun.outcome !== 'created' || begun.operationId === null) return;
    expect(await beginStep(operation, {commandId: randomUUID(), attemptId, stepKey: 'search', ordinal: 1}, {env})).toMatchObject({outcome: 'replayed', stepId: begun.stepId, operationId: begun.operationId});
    expect(await beginStep(operation, {commandId: stepCommand, attemptId, stepKey: 'search', ordinal: 2}, {env})).toEqual({outcome: 'reused'});
    const dispatchCommand = randomUUID();
    expect(await advanceOperation(operation, {commandId: dispatchCommand, operationId: begun.operationId, to: 'dispatched', requestId: 'req_typed_1'}, {env})).toEqual({
      outcome: 'advanced',
      operationId: begun.operationId,
      state: 'dispatched',
      requestId: 'req_typed_1',
    });
    expect(await advanceOperation(operation, {commandId: randomUUID(), operationId: begun.operationId, to: 'planned'}, {env})).toEqual({outcome: 'invalid_transition', state: 'dispatched'});
    expect(await moveAttempt(operation, {commandId: randomUUID(), attemptId, to: 'completed'}, {env})).toEqual({outcome: 'open_operations'});
    expect(await moveAttempt(operation, {commandId: randomUUID(), attemptId, to: 'failed', reason: 'lease_lost'}, {env})).toMatchObject({outcome: 'moved', attempt: {state: 'failed', reason: 'lease_lost', stage: 'search'}});
    expect(await requestRetry(operation, {commandId: randomUUID(), jobId: accepted.jobId, expectedNumber: 2, inputDigest: D('two')}, {env})).toEqual({outcome: 'stale', number: 1});
    const retry = await requestRetry(operation, {commandId: randomUUID(), jobId: accepted.jobId, expectedNumber: 1, inputDigest: D('two')}, {env});
    expect(retry).toMatchObject({outcome: 'created', jobId: accepted.jobId, attempt: {number: 2, state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation'}});
    if (retry.outcome !== 'created') return;
    expect(await moveAttempt(operation, {commandId: randomUUID(), attemptId: retry.attempt.id, to: 'running'}, {env})).toEqual({outcome: 'blocked', reason: 'awaiting_reconciliation'});
    expect(await requestRetry(operation, {commandId: randomUUID(), jobId: accepted.jobId, expectedNumber: 2, inputDigest: D('three')}, {env})).toEqual({outcome: 'not_retryable', state: 'waiting'});
    const ambiguousCommand = randomUUID();
    expect(await advanceOperation(operation, {commandId: ambiguousCommand, operationId: begun.operationId, to: 'ambiguous'}, {env})).toMatchObject({outcome: 'advanced', state: 'ambiguous'});
    // A lost answer is recovered by sending the same command again: the operation as it is now, which has moved on from the state the command made it.
    expect(await advanceOperation(operation, {commandId: dispatchCommand, operationId: begun.operationId, to: 'dispatched', requestId: 'req_typed_1'}, {env})).toEqual({
      outcome: 'replayed',
      operationId: begun.operationId,
      state: 'ambiguous',
      requestId: 'req_typed_1',
    });
    const read = await readJob(operation, {jobId: accepted.jobId}, {env});
    expect(read.outcome).toBe('found');
    if (read.outcome !== 'found') return;
    expect(read.job).toMatchObject({id: accepted.jobId, projectId: pid, kind: 'research', state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation', canRetry: false});
    expect(read.job.attempts.map((entry) => [entry.number, entry.state, entry.chargeableOperations])).toEqual([[1, 'failed', 1], [2, 'waiting', 0]]);
    expect(await advanceOperation(operation, {commandId: randomUUID(), operationId: begun.operationId, to: 'noncharge'}, {env})).toMatchObject({outcome: 'advanced', state: 'noncharge', requestId: 'req_typed_1'});
    for (const [commandId, to, requestId] of [[dispatchCommand, 'dispatched', 'req_typed_1'], [ambiguousCommand, 'ambiguous', undefined]] as const) {
      expect(await advanceOperation(operation, {commandId, operationId: begun.operationId, to, requestId}, {env})).toEqual({
        outcome: 'replayed',
        operationId: begun.operationId,
        state: 'noncharge',
        requestId: 'req_typed_1',
      });
    }
    expect(await moveAttempt(operation, {commandId: randomUUID(), attemptId: retry.attempt.id, to: 'running'}, {env})).toMatchObject({outcome: 'moved', attempt: {state: 'running'}});
    // A stale epoch is `denied`, and another Account's Job is `unavailable`.
    expect(await readJob({accountId: a.accountId, epoch: a.epoch + 5}, {jobId: accepted.jobId}, {env})).toEqual({outcome: 'denied'});
    const b = await committedAccount();
    expect(await readJob({accountId: b.accountId, epoch: b.epoch}, {jobId: accepted.jobId}, {env})).toEqual({outcome: 'unavailable'});
    expect(await acceptJob({accountId: b.accountId, epoch: b.epoch}, {commandId: randomUUID(), projectId: pid, kind: 'research', inputDigest: D('one')}, {env})).toEqual({outcome: 'unavailable'});
  });
});

describe('the typed replay of an operation command after the operation moved on', () => {
  it.each([
    ['completed', [['dispatched', 'req_replay_1'], ['completed', undefined]], 'completed'],
    ['settled', [['dispatched', undefined], ['ambiguous', undefined], ['settled', undefined]], 'settled'],
  ] as [string, [string, string | undefined][], string][])('returns the operation as it is now, %s, to a caller that sends an earlier command again', async (_label, path, now) => {
    const a = await committedAccount();
    const pid = await project(db, a);
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const accepted = await acceptJob(operation, {commandId: randomUUID(), projectId: pid, kind: 'research', inputDigest: D('one')}, {env});
    if (accepted.outcome !== 'created') throw new Error('The Job was not created.');
    const attemptId = accepted.attempt.id;
    await moveAttempt(operation, {commandId: randomUUID(), attemptId, to: 'running'}, {env});
    const begun = await beginStep(operation, {commandId: randomUUID(), attemptId, stepKey: 'search', ordinal: 1}, {env});
    if (begun.outcome !== 'created' || begun.operationId === null) throw new Error('The step was not created.');
    const sent: {commandId: string; to: (typeof path)[number][0]; requestId: string | undefined}[] = [];
    for (const [to, requestId] of path) {
      const commandId = randomUUID();
      sent.push({commandId, to, requestId});
      const answer = await advanceOperation(operation, {commandId, operationId: begun.operationId, to: to as 'dispatched', requestId}, {env});
      expect(answer).toMatchObject({outcome: 'advanced', state: to});
    }
    const [first] = sent;
    const replay = await advanceOperation(operation, {commandId: first.commandId, operationId: begun.operationId, to: first.to as 'dispatched', requestId: first.requestId}, {env});
    expect(replay).toEqual({outcome: 'replayed', operationId: begun.operationId, state: now, requestId: first.requestId ?? null});
    // The last command replays as itself.
    const last = sent[sent.length - 1];
    expect(await advanceOperation(operation, {commandId: last.commandId, operationId: begun.operationId, to: last.to as 'dispatched', requestId: last.requestId}, {env})).toMatchObject({outcome: 'replayed', state: now});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries the Story 2.11 tables and functions', () => {
  const apiSignatures = [
    'api.accept_job(uuid,bigint,uuid,uuid,text,text)',
    'api.begin_step(uuid,bigint,uuid,uuid,text,integer)',
    'api.advance_operation(uuid,bigint,uuid,uuid,text,text)',
    'api.move_attempt(uuid,bigint,uuid,uuid,text,text)',
    'api.request_retry(uuid,bigint,uuid,uuid,integer,text)',
    'api.read_job(uuid,bigint,uuid)',
  ];

  it('answers ok to the service role, reads the five tables and their columns, and looks for the six functions (forty-seven in all)', async () => {
    await inTx(async (client) => {
      expect((await svc(client, 'select ok from api.preflight()', [])).ok).toBe(true);
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [
      'jobs.jobs', 'jobs.attempts', 'jobs.steps', 'jobs.operations', 'jobs.commands', 'at.previous_attempt_id', 'at.input_digest', 'op.outcome_at', 'cm.subject_id',
      ...apiSignatures,
      'Story 2.11 migration',
      // Every earlier probe is still there.
      'Story 1.5 migration', 'Story 2.4 migration', 'Story 2.12 migration', 'usage.periods', 'lifecycle.heartbeats', 'private-files',
    ]) expect(definition, needle).toContain(needle);
    const check = definition.indexOf('where not has_function_privilege');
    const executable = definition.slice(definition.lastIndexOf('unnest(array[', check), check);
    expect(executable.match(/'api\.[a-z_]+\([^']*\)'/g)).toHaveLength(47);
    for (const signature of apiSignatures) expect(executable, signature).toContain(`'${signature}'`);
    // The bucket check stays last.
    expect(definition.indexOf('private-files')).toBeGreaterThan(definition.indexOf('delete Auth identities'));
  });

  it.each(apiSignatures)('fails the build with one line naming %s when it is missing, and says which migration is not applied', async (signature) => {
    await inTx(async (client) => {
      const spec = (await client.query(`select to_regprocedure($1)::text as name`, [signature])).rows[0].name;
      await client.query(`drop function ${spec} cascade`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain(signature);
        expect(result.message).toContain('Story 2.11');
      }
    });
  });

  it.each(apiSignatures.map((signature) => [signature, signature.replace(/,/g, ', ')]))('fails when the service role cannot execute %s', async (signature, spaced) => {
    await inTx(async (client) => {
      await client.query(`revoke execute on function ${spaced} from service_role`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(signature);
      }
    });
  });

  it.each(['jobs.jobs', 'jobs.attempts', 'jobs.steps', 'jobs.operations', 'jobs.commands'])('fails, naming a permission and not answering ok, when the role it runs as cannot read %s', async (blocked) => {
    const everything = [
      'identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts',
      'artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance', 'artifacts.retained_pictures',
      'lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats', 'usage.periods', 'usage.fixture_figures',
      'jobs.jobs', 'jobs.attempts', 'jobs.steps', 'jobs.operations', 'jobs.commands',
      'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
    ];
    await inTx(async (client) => {
      await client.query('grant usage on schema api, identity, projects, lifecycle, artifacts, usage, jobs to anon');
      await client.query('grant create on schema api to anon');
      for (const table of everything.filter((name) => name !== blocked)) await client.query(`grant select on ${table} to anon`);
      await client.query('alter function api.preflight() owner to anon');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok, `${blocked} unreadable`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(blocked.split('.')[1]);
      }
    });
  });
});
