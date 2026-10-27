import {randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, describe, expect, it} from 'vitest';
import {createHarness} from '../support/accounts-db';
import {truncateGuards} from '../support/truncate-guard';
import {ledgerJob} from '../support/usage-ledger';

// Story 2.5 against the Supabase CLI stack: the provider permissions (a grant of one category, to one provider, for one Job of one Project of one Account, for one purpose and a
// closed list of outbound data, with a disclosed maximum for ONE request), the three api functions that grant, read and revoke it, and the permissioned form of api.reserve_cost
// that admits a request of Anthropic or Brave only under a live grant. Most cases run in a transaction that is rolled back, as the service role. The cases that need two real
// connections commit their data, and it is removed afterwards. Money is integer microdollars: 1,000,000 is $1.

const {db, connect: openConnection, committed, cleanup, inTx, addUser, attempt, rows, count} = createHarness();

/** Another connection for the cases that need two sessions; one that fails while it holds a lock must not leave the file waiting. */
async function connect() {
  const client = await openConnection();
  await client.query(`set idle_in_transaction_session_timeout = '40s'`);
  await client.query(`set lock_timeout = '40s'`);
  return client;
}

const tag = randomBytes(3).toString('hex');
let sequence = 0;
afterAll(async () => {
  // The rate schedules are global: remove this run's once nothing refers to them (the Accounts' data goes first).
  await cleanup();
  await db.query(`delete from usage.rate_schedules where model like $1`, [`%-${tag}`]);
});

const M = 1_000_000;
const DATA = ['confirmed_project_scope', 'project_evidence'];

// Fixtures ----------------------------------------------------------------------------------------------------------------------

type Fixture = {accountId: string; workspaceId: string; epoch: number};
type Sched = {id: string; provider: string; model: string; apiVersion: string};

/** An Account with its Workspace and its `initial` period, made the way registration makes one, and given a $10 allowance. */
async function account(client: Client): Promise<Fixture> {
  const user = await addUser(client);
  const {rows: made} = await client.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject]);
  const accountId = made[0].id as string;
  const {rows: workspace} = await client.query('select id from projects.workspaces where account_id = $1', [accountId]);
  await client.query('delete from usage.periods where account_id = $1', [accountId]);
  await client.query(
    `insert into usage.periods (account_id, seq, month_start, limit_microdollars, carried_settled_microdollars, carried_reserved_microdollars, cause, previous_limit_microdollars, actor, command_id, digest)
     values ($1, 1, usage.current_month(), $2::bigint, 0, 0, 'initial', null, 'system', null, usage.period_digest($1, 1, usage.current_month(), $2::bigint, 0::bigint, 0::bigint, 'initial'))`,
    [accountId, 10 * M],
  );
  return {accountId, workspaceId: workspace[0].id as string, epoch: 1};
}

async function committedAccount(): Promise<Fixture> {
  const made = await account(db);
  const {rows: found} = await db.query('select user_id from identity.accounts where id = $1', [made.accountId]);
  committed.users.push(found[0].user_id as string);
  return made;
}

async function project(client: Client, owner: Fixture): Promise<string> {
  const {rows: made} = await client.query(
    `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'Courtyard bench', 'researching') returning id`,
    [owner.workspaceId, owner.accountId],
  );
  return made[0].id as string;
}

/** A rate schedule of the provider: 1,000 microdollars for each output token and nothing for input, so a request with an output limit of 100 quotes 100,000. */
async function schedule(client: Client, provider: string): Promise<Sched> {
  sequence += 1;
  const model = `m${sequence}-${tag}`;
  const {rows: made} = await client.query(
    `insert into usage.rate_schedules (provider, model, version, api_version, currency, input_rate_num, input_rate_den, output_rate_num, output_rate_den, request_rate_num, request_rate_den,
                                       input_increment, output_increment, multiplier_num, multiplier_den)
     values ($1, $2, 1, '2023-06-01', 'USD', 0, 1, 1000, 1, 0, 1, 1, 1, 1, 1) returning id`,
    [provider, model],
  );
  return {id: made[0].id as string, provider, model, apiVersion: '2023-06-01'};
}

type Context = {owner: Fixture; projectId: string; job: Awaited<ReturnType<typeof ledgerJob>>; rate: Sched};
/** An Account, a live Project, a Job with a running attempt and `operations` planned operations, and an Anthropic rate schedule. */
async function context(client: Client, operations = 4, provider = 'anthropic'): Promise<Context> {
  const owner = await account(client);
  const projectId = await project(client, owner);
  const job = await ledgerJob(client, owner.accountId, operations, projectId);
  return {owner, projectId, job, rate: await schedule(client, provider)};
}

const GRANT = `select api.grant_provider_permission($1,$2,$3,$4,$5,$6,$7::text[],$8::bigint) as value`;
const GET = `select api.get_provider_permission($1,$2,$3,$4,$5) as value`;
const REVOKE = `select api.revoke_provider_permission($1,$2,$3,$4) as value`;
const RESERVE = `select * from api.reserve_cost($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18::text[])`;
const RESERVE_GENERIC = `select * from api.reserve_cost($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`;

type GrantSpec = {projectId?: string; jobId?: string; category?: string; provider?: string; purpose?: string; data?: string[]; maximum?: number; accountId?: string};
const grantArgs = (ctx: Context, o: GrantSpec = {}) => [
  o.accountId ?? ctx.owner.accountId, o.projectId ?? ctx.projectId, o.jobId ?? ctx.job.jobId, o.category ?? 'synthesis_vision', o.provider ?? 'anthropic',
  o.purpose ?? 'identify material', o.data ?? DATA, o.maximum ?? M,
];
/** Grants as the service role; returns the permission, or undefined when the grant was refused without an error (no row). */
async function grant(client: Client, ctx: Context, o: GrantSpec = {}) {
  const found = await rows(client, 'service_role', GRANT, grantArgs(ctx, o));
  return found[0]?.value as Record<string, unknown> | undefined;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The id of a grant that was made: a refusal that follows must not be one that a missing grant would give. */
const grantId = async (client: Client, ctx: Context, o: GrantSpec = {}) => {
  const id = (await grant(client, ctx, o))?.id;
  expect(id, 'the grant was made').toMatch(UUID);
  return id as string;
};

type ReserveSpec = {
  operationId?: string; permissionId?: string; command?: string; epoch?: number; purpose?: string; data?: string[]; category?: string; provider?: string; projectId?: string;
  jobId?: string; output?: number; accountId?: string;
};
const reserveArgs = (ctx: Context, o: ReserveSpec) => [
  o.accountId ?? ctx.owner.accountId, o.epoch ?? ctx.owner.epoch, o.command ?? randomUUID(), o.operationId ?? ctx.job.operationIds[0], ctx.rate.id,
  o.provider ?? ctx.rate.provider, ctx.rate.model, ctx.rate.apiVersion, 100, 0, o.output ?? 100, '{}', o.permissionId ?? randomUUID(), o.projectId ?? ctx.projectId,
  o.jobId ?? ctx.job.jobId, o.category ?? 'synthesis_vision', o.purpose ?? 'identify material', o.data ?? DATA,
];
const reserve = async (client: Client, ctx: Context, o: ReserveSpec = {}) => (await rows(client, 'service_role', RESERVE, reserveArgs(ctx, o)))[0];

/** The same calls on a connection that is not inside a transaction (the committed cases), as the owner: the api functions are security definer all the same. */
const grantNow = async (client: Client, ctx: Context, o: GrantSpec = {}) => {
  const id = (await client.query(GRANT, grantArgs(ctx, o))).rows[0]?.value?.id;
  expect(id, 'the grant was made').toMatch(UUID);
  return id as string;
};
const reserveNow = async (client: Client, ctx: Context, o: ReserveSpec = {}) => (await client.query(RESERVE, reserveArgs(ctx, o))).rows[0];

/** Revokes a grant as the service role, and says it was revoked (a refusal that follows must be for the revocation). */
const revokeGrant = async (client: Client, ctx: Context, id: string) =>
  expect((await rows(client, 'service_role', REVOKE, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, id]))[0]?.value, 'the grant was revoked').toEqual({revoked: true});

const ledgerOf = async (client: Client, accountId: string) => ({
  reservations: await count(client, 'select count(*) as n from usage.reservations where account_id = $1', [accountId]),
  commands: await count(client, 'select count(*) as n from usage.commands where account_id = $1', [accountId]),
  permissions: await count(client, 'select count(*) as n from provider_private.permissions where account_id = $1', [accountId]),
});

/** The Job's attempt fails, through the api (a failed attempt carries its reason). */
const failAttempt = async (client: Client, ctx: Context) =>
  expect((await rows(client, 'service_role', 'select outcome from api.move_attempt($1,$2,$3,$4,$5,$6)', [ctx.owner.accountId, ctx.owner.epoch, randomUUID(), ctx.job.attemptId, 'failed', 'step_failed']))[0].outcome).toBe('moved');

const untilBlocked = async (pid: number) => {
  for (let poll = 0; poll < 200; poll += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The backend never waited for a lock.');
};
const pidOf = async (client: Client) => (await client.query('select pg_backend_pid() as pid')).rows[0].pid as number;

/** The update guard refuses every edit of a grant but its revocation, so a case that must age a grant switches it off for its own, rolled-back transaction. */
async function withoutGuard<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query('alter table provider_private.permissions disable trigger provider_permissions_guard');
  try {
    return await work();
  } finally {
    await client.query('alter table provider_private.permissions enable trigger provider_permissions_guard');
  }
}

// ---------------------------------------------------------------------------------------------------
describe('granting, reading and revoking a provider permission', () => {
  it('saves a grant for the Job\'s own Project, sorted, for seven days, and reads it back by its category and provider', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const made = await grant(client, ctx, {data: [...DATA].reverse()});
      expect(made).toMatchObject({
        account_id: ctx.owner.accountId, project_id: ctx.projectId, job_id: ctx.job.jobId, category: 'synthesis_vision', provider: 'anthropic', purpose: 'identify material',
        outbound_data: DATA, disclosed_maximum_microdollars: M, revoked_at: null, job_terminal: false,
      });
      const {rows: stamped} = await client.query(
        `select expires_at - granted_at = interval '7 days' as week, attempt_id = $2 as bound from provider_private.permissions where id = $1`,
        [made?.id, ctx.job.attemptId],
      );
      expect(stamped[0]).toEqual({week: true, bound: true});
      const read = (await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, 'synthesis_vision', 'anthropic']))[0]?.value;
      expect(read).toMatchObject({id: made?.id, job_terminal: false, outbound_data: DATA});
      for (const [category, provider] of [['research_search', 'brave'], ['synthesis_vision', 'brave'], ['research_search', 'anthropic']]) {
        expect(await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, category, provider])).toEqual([]);
      }
      // Nor is it read for another Account, Project or Job.
      const stranger = await context(client);
      for (const [label, args] of [
        ['another Account', [stranger.owner.accountId, ctx.projectId, ctx.job.jobId]],
        ['another Project', [ctx.owner.accountId, stranger.projectId, ctx.job.jobId]],
        ['another Job', [ctx.owner.accountId, ctx.projectId, stranger.job.jobId]],
      ] as const) {
        expect(await rows(client, 'service_role', GET, [...args, 'synthesis_vision', 'anthropic']), label).toEqual([]);
      }
    });
  });

  it('refuses a grant outside the Account, Project and Job it is for, and one for a Job that has ended, with no row and no error', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const stranger = await context(client);
      const otherProject = await project(client, ctx.owner);
      const before = await ledgerOf(client, ctx.owner.accountId);
      expect(await rows(client, 'service_role', GRANT, grantArgs(ctx, {accountId: stranger.owner.accountId}))).toEqual([]);
      expect(await rows(client, 'service_role', GRANT, grantArgs(ctx, {projectId: stranger.projectId}))).toEqual([]);
      expect(await rows(client, 'service_role', GRANT, grantArgs(ctx, {jobId: stranger.job.jobId}))).toEqual([]);
      expect(await rows(client, 'service_role', GRANT, grantArgs(ctx, {projectId: otherProject}))).toEqual([]);
      expect(await rows(client, 'service_role', GRANT, grantArgs(ctx, {jobId: randomUUID()}))).toEqual([]);
      await client.query(`update jobs.attempts set state = 'completed', ended_at = clock_timestamp() where id = $1`, [ctx.job.attemptId]);
      expect(await rows(client, 'service_role', GRANT, grantArgs(ctx))).toEqual([]);
      expect(await ledgerOf(client, ctx.owner.accountId)).toEqual(before);
      expect((await ledgerOf(client, stranger.owner.accountId)).permissions).toBe(0);
    });
  });

  it('refuses a grant of an unknown category or provider, a mismatched pair, any other outbound data than the category allows, a duplicate, and a purpose or maximum out of range, with 22023', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const bad: [string, GrantSpec][] = [
        ['unknown category', {category: 'billing'}],
        ['unknown provider', {provider: 'openai'}],
        ['case variant of a provider', {provider: 'Anthropic'}],
        ['search through the vision provider', {category: 'research_search', provider: 'anthropic', data: ['normalized_public_subject']}],
        ['vision through the search provider', {category: 'synthesis_vision', provider: 'brave'}],
        ['search with more than the subject', {category: 'research_search', provider: 'brave', data: ['normalized_public_subject', 'project_evidence']}],
        ['search with another datum', {category: 'research_search', provider: 'brave', data: ['project_evidence']}],
        ['vision with the public subject', {data: ['normalized_public_subject', 'project_evidence']}],
        ['an unknown datum', {data: ['confirmed_project_scope', 'private_diary']}],
        ['a duplicate datum', {data: ['project_evidence', 'project_evidence']}],
        ['no data', {data: []}],
        ['nine data', {data: Array.from({length: 9}, (_, index) => `d${index}`)}],
        ['an empty purpose', {purpose: ''}],
        ['a purpose of 501 characters', {purpose: 'x'.repeat(501)}],
        ['a maximum of zero', {maximum: 0}],
        ['a maximum above $1', {maximum: M + 1}],
      ];
      for (const [label, spec] of bad) {
        const result = await attempt(client, 'service_role', GRANT, grantArgs(ctx, spec));
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      for (const [label, index] of [['a missing Account', 0], ['a missing Project', 1], ['a missing Job', 2], ['a missing category', 3], ['a missing provider', 4], ['a missing purpose', 5], ['missing data', 6], ['a missing maximum', 7]] as const) {
        const args = grantArgs(ctx, {});
        args[index] = null as never;
        const result = await attempt(client, 'service_role', GRANT, args);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      expect((await ledgerOf(client, ctx.owner.accountId)).permissions).toBe(0);
      // The upper bounds themselves are fine: eight data would be allowed by the count, and a purpose of 500 characters and a maximum of $1 are.
      expect(await grant(client, ctx, {purpose: 'x'.repeat(500), maximum: M})).toMatchObject({disclosed_maximum_microdollars: M});
    });
  });

  it('lets a later grant of the same category and provider for the Job replace the earlier one, and leaves the grants of another category or provider alone', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const first = await grantId(client, ctx);
      const search = await grantId(client, ctx, {category: 'research_search', provider: 'brave', data: ['normalized_public_subject'], purpose: 'find public sources'});
      const second = await grantId(client, ctx, {purpose: 'identify the material again'});
      const {rows: found} = await client.query('select id, revoked_at is not null as revoked from provider_private.permissions where account_id = $1', [ctx.owner.accountId]);
      expect(Object.fromEntries(found.map((row) => [row.id, row.revoked]))).toEqual({[first]: true, [search]: false, [second]: false});
      const read = (await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, 'synthesis_vision', 'anthropic']))[0]?.value;
      expect(read).toMatchObject({id: second, purpose: 'identify the material again'});
    });
  });

  it('revokes only inside the Account, Project and Job the grant was saved under, once, and stops reading it', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const stranger = await context(client);
      const id = await grantId(client, ctx);
      const revoke = async (accountId: string, projectId: string, jobId: string, permissionId: string) =>
        (await rows(client, 'service_role', REVOKE, [accountId, projectId, jobId, permissionId]))[0]?.value;
      expect(await revoke(stranger.owner.accountId, ctx.projectId, ctx.job.jobId, id)).toEqual({revoked: false});
      expect(await revoke(ctx.owner.accountId, stranger.projectId, ctx.job.jobId, id)).toEqual({revoked: false});
      expect(await revoke(ctx.owner.accountId, ctx.projectId, stranger.job.jobId, id)).toEqual({revoked: false});
      expect(await revoke(ctx.owner.accountId, ctx.projectId, ctx.job.jobId, randomUUID())).toEqual({revoked: false});
      expect((await client.query('select revoked_at from provider_private.permissions where id = $1', [id])).rows[0].revoked_at).toBeNull();
      expect(await revoke(ctx.owner.accountId, ctx.projectId, ctx.job.jobId, id)).toEqual({revoked: true});
      expect(await revoke(ctx.owner.accountId, ctx.projectId, ctx.job.jobId, id)).toEqual({revoked: false});
      expect(await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, 'synthesis_vision', 'anthropic'])).toEqual([]);
    });
  });

  it('does not read a grant that has expired, and reports the grant of a failed Attempt as ended', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      await withoutGuard(client, () => client.query(`update provider_private.permissions set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [id]));
      expect(await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, 'synthesis_vision', 'anthropic'])).toEqual([]);
    });
    await inTx(async (client) => {
      const ctx = await context(client);
      await grantId(client, ctx);
      await failAttempt(client, ctx);
      const read = (await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, 'synthesis_vision', 'anthropic']))[0]?.value;
      expect(read).toMatchObject({job_terminal: true});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the table of grants is written once and revoked once', () => {
  it('refuses any edit of a grant but its revocation, and any truncate, with 55000, and lets a delete through', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      for (const [label, sql] of [
        ['a longer life', `update provider_private.permissions set expires_at = expires_at + interval '1 hour' where id = $1`],
        ['another id', `update provider_private.permissions set id = gen_random_uuid() where id = $1`],
        ['another Account', `update provider_private.permissions set account_id = gen_random_uuid() where id = $1`],
        ['another Project', `update provider_private.permissions set project_id = gen_random_uuid() where id = $1`],
        ['another category', `update provider_private.permissions set category = 'research_search' where id = $1`],
        ['another provider', `update provider_private.permissions set provider = 'brave' where id = $1`],
        ['an earlier grant time', `update provider_private.permissions set granted_at = granted_at - interval '1 hour' where id = $1`],
        ['a larger maximum', `update provider_private.permissions set disclosed_maximum_microdollars = 1 where id = $1`],
        ['another purpose', `update provider_private.permissions set purpose = 'anything' where id = $1`],
        ['other data', `update provider_private.permissions set outbound_data = array['project_evidence'] where id = $1`],
        ['another Job', `update provider_private.permissions set job_id = gen_random_uuid() where id = $1`],
        ['another attempt', `update provider_private.permissions set attempt_id = gen_random_uuid() where id = $1`],
        ['a revocation and another purpose together', `update provider_private.permissions set revoked_at = clock_timestamp(), purpose = 'anything' where id = $1`],
      ] as const) {
        const result = await attempt(client, null, sql, [id]);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('55000');
      }
      // The revocation itself passes, once, and cannot be taken back.
      expect((await attempt(client, null, `update provider_private.permissions set revoked_at = clock_timestamp() where id = $1`, [id])).ok).toBe(true);
      const undone = await attempt(client, null, `update provider_private.permissions set revoked_at = null where id = $1`, [id]);
      expect(undone.ok).toBe(false);
      if (!undone.ok) expect(undone.code).toBe('55000');
      const later = await attempt(client, null, `update provider_private.permissions set revoked_at = clock_timestamp() + interval '1 hour' where id = $1`, [id]);
      expect(later.ok).toBe(false);
      const emptied = await attempt(client, null, 'truncate provider_private.permissions');
      expect(emptied.ok).toBe(false);
      if (!emptied.ok) expect(emptied.code).toBe('55000');
      expect(await truncateGuards(client, ['provider_private.permissions'])).toEqual({'provider_private.permissions': ['provider_permissions_no_truncate']});
      expect((await attempt(client, null, 'delete from provider_private.permissions where id = $1', [id])).ok).toBe(true);
      expect((await ledgerOf(client, ctx.owner.accountId)).permissions).toBe(0);
    });
  });

  it('takes both times of a new grant from one clock reading, whatever the insert says', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const {rows: made} = await client.query(
        `insert into provider_private.permissions (account_id, project_id, job_id, attempt_id, category, provider, purpose, outbound_data, disclosed_maximum_microdollars, granted_at, expires_at)
         values ($1, $2, $3, $4, 'synthesis_vision', 'anthropic', 'identify material', array['project_evidence'], 5, now() - interval '30 days', now() + interval '60 days')
         returning expires_at - granted_at = interval '7 days' as week, granted_at > now() - interval '1 minute' as fresh`,
        [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, ctx.job.attemptId],
      );
      expect(made[0]).toEqual({week: true, fresh: true});
    });
  });

  it('stamps seven days as 168 hours in any time zone, and revokes from another zone than the one that granted', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      for (const zone of ['UTC', 'America/New_York', 'Pacific/Auckland', 'Australia/Lord_Howe', 'Asia/Kathmandu']) {
        await client.query(`select set_config('timezone', $1, true)`, [zone]);
        const id = await grantId(client, ctx, {purpose: `identify material in ${zone}`});
        const {rows: stamped} = await client.query('select extract(epoch from expires_at - granted_at)::bigint as seconds from provider_private.permissions where id = $1', [id]);
        expect(Number(stamped[0].seconds), zone).toBe(7 * 24 * 3600);
      }
    });
    await inTx(async (client) => {
      // A grant of seven days across the spring change of clock in New York (167 hours there, by the calendar) is revoked from a session in that zone: the constraint every
      // UPDATE re-checks reads the same seven days in every zone. (The stamp is switched off to give the grant fixed times.)
      const ctx = await context(client);
      await client.query(`select set_config('timezone', 'UTC', true)`);
      await client.query('alter table provider_private.permissions disable trigger provider_permissions_stamp');
      const {rows: made} = await client.query(
        `insert into provider_private.permissions (account_id, project_id, job_id, attempt_id, category, provider, purpose, outbound_data, disclosed_maximum_microdollars, granted_at, expires_at)
         values ($1, $2, $3, $4, 'synthesis_vision', 'anthropic', 'identify material', array['project_evidence'], 5, timestamptz '2027-03-10 12:00:00+00', timestamptz '2027-03-10 12:00:00+00' + interval '168 hours')
         returning id`,
        [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, ctx.job.attemptId],
      );
      await client.query('alter table provider_private.permissions enable trigger provider_permissions_stamp');
      await client.query(`select set_config('timezone', 'America/New_York', true)`);
      expect((await rows(client, 'service_role', REVOKE, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, made[0].id]))[0]?.value).toEqual({revoked: true});
    });
  });

  it('keeps its closed data vocabulary at the table, whoever inserts', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      for (const [label, category, provider, data] of [
        ['an unknown datum', 'synthesis_vision', 'anthropic', ['private_diary']],
        ['a public subject sent to the vision provider', 'synthesis_vision', 'anthropic', ['normalized_public_subject']],
        ['a search with more than the subject', 'research_search', 'brave', ['normalized_public_subject', 'project_evidence']],
        ['a duplicate datum', 'synthesis_vision', 'anthropic', ['project_evidence', 'project_evidence']],
      ] as const) {
        const result = await attempt(
          client, null,
          `insert into provider_private.permissions (account_id, project_id, job_id, category, provider, purpose, outbound_data, disclosed_maximum_microdollars) values ($1, $2, $3, $4, $5, 'p', $6::text[], 1)`,
          [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, category, provider, data],
        );
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('23514');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('admission under a grant (api.reserve_cost, the permissioned form)', () => {
  it('reserves for an operation of the grant\'s Job under a live grant, with the outbound data in any order, and for nothing else', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      expect(await reserve(client, ctx, {permissionId: id, operationId: ctx.job.operationIds[0]})).toMatchObject({outcome: 'reserved'});
      expect(await reserve(client, ctx, {permissionId: id, operationId: ctx.job.operationIds[1], data: [...DATA].reverse()})).toMatchObject({outcome: 'reserved'});
      const before = await ledgerOf(client, ctx.owner.accountId);
      const other = await project(client, ctx.owner);
      const otherJob = await ledgerJob(client, ctx.owner.accountId, 1, other);
      const stranger = await context(client);
      const strangerId = await grantId(client, stranger);
      const mismatches: [string, ReserveSpec][] = [
        ['no such grant', {permissionId: randomUUID()}],
        ['another purpose', {permissionId: id, purpose: 'identify something else'}],
        ['a part of the data', {permissionId: id, data: ['project_evidence']}],
        ['more data than the grant names', {permissionId: id, data: [...DATA, 'provider_image_derivatives']}],
        ['another set of the same size', {permissionId: id, data: ['project_evidence', 'provider_image_derivatives']}],
        ['another category with the same data', {permissionId: id, category: 'research_search'}],
        ['another category', {permissionId: id, category: 'research_search', data: ['normalized_public_subject']}],
        ['another provider', {permissionId: id, provider: 'brave'}],
        ['another Project', {permissionId: id, projectId: other}],
        ['another Job', {permissionId: id, jobId: otherJob.jobId}],
        ['the grant of another Account', {permissionId: strangerId}],
      ];
      for (const [label, spec] of mismatches) {
        const answer = await reserve(client, ctx, {operationId: ctx.job.operationIds[2], ...spec});
        expect(answer.outcome, label).toBe('permission_required');
        // A refusal names nothing but itself: every other column of the row is empty.
        expect(Object.entries(answer).filter(([key, value]) => key !== 'outcome' && value !== null), label).toEqual([]);
      }
      expect(await ledgerOf(client, ctx.owner.accountId)).toEqual(before);
    });
  });

  it('refuses an operation of another Job, or of another Project, whichever Job it names, and reserves nothing', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      const other = await project(client, ctx.owner);
      const otherJob = await ledgerJob(client, ctx.owner.accountId, 1, other);
      const sameProject = await ledgerJob(client, ctx.owner.accountId, 1, ctx.projectId);
      const before = await ledgerOf(client, ctx.owner.accountId);
      for (const [label, spec] of [
        ['an operation of the Job of another Project, naming the grant\'s Job', {operationId: otherJob.operationIds[0], jobId: ctx.job.jobId, projectId: ctx.projectId}],
        ['an operation of the Job of another Project, naming its own Job', {operationId: otherJob.operationIds[0], jobId: otherJob.jobId, projectId: other}],
        ['an operation of another Job of the same Project, naming the grant\'s Job', {operationId: sameProject.operationIds[0], jobId: ctx.job.jobId}],
        ['an operation of another Job of the same Project, naming its own Job', {operationId: sameProject.operationIds[0], jobId: sameProject.jobId}],
        ['an operation that does not exist', {operationId: randomUUID()}],
      ] as [string, ReserveSpec][]) {
        expect(await reserve(client, ctx, {permissionId: id, ...spec}), label).toMatchObject({outcome: 'permission_required', reservation_id: null});
      }
      expect(await ledgerOf(client, ctx.owner.accountId)).toEqual(before);
    });
  });

  it('answers the Account\'s authority before anything about the grant', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      const before = await ledgerOf(client, ctx.owner.accountId);
      // A stale epoch is `denied` whether the grant is real, unknown or missing, and whether or not the operation is the Job's.
      for (const spec of [{permissionId: id}, {permissionId: randomUUID()}, {permissionId: id, jobId: randomUUID()}, {permissionId: id, purpose: 'something else'}] as ReserveSpec[]) {
        expect(await reserve(client, ctx, {epoch: 99, ...spec})).toMatchObject({outcome: 'denied', reservation_id: null});
      }
      expect(await ledgerOf(client, ctx.owner.accountId)).toEqual(before);
    });
  });

  it('refuses a price above the disclosed maximum, accepts one equal to it, and tells the truth about a request that cannot be priced', async () => {
    await inTx(async (client) => {
      const ctx = await context(client, 6);
      const {rows: quoted} = await client.query(
        `select outcome, microdollars from api.quote_cost($1,$2,$3,$4,$5,$6,100,0,100,1,'{}'::jsonb)`,
        [ctx.owner.accountId, ctx.owner.epoch, ctx.rate.id, ctx.rate.provider, ctx.rate.model, ctx.rate.apiVersion],
      );
      expect(quoted[0].outcome).toBe('quoted');
      const price = Number(quoted[0].microdollars);
      expect(price).toBeGreaterThan(1);
      const tooLow = await grantId(client, ctx, {maximum: price - 1});
      expect(await reserve(client, ctx, {permissionId: tooLow, operationId: ctx.job.operationIds[0]})).toMatchObject({outcome: 'maximum_exceeded', reservation_id: null});
      const exact = await grantId(client, ctx, {maximum: price});
      expect(await reserve(client, ctx, {permissionId: exact, operationId: ctx.job.operationIds[0]})).toMatchObject({outcome: 'reserved'});
      // A request that has no price (an output limit beyond every ceiling) is refused by the reservation for what it is, not as a price above the maximum.
      const {rows: unpriced} = await client.query(
        `select outcome from api.quote_cost($1,$2,$3,$4,$5,$6,100,0,100000000,1,'{}'::jsonb)`,
        [ctx.owner.accountId, ctx.owner.epoch, ctx.rate.id, ctx.rate.provider, ctx.rate.model, ctx.rate.apiVersion],
      );
      expect(unpriced[0].outcome).not.toBe('quoted');
      const before = await ledgerOf(client, ctx.owner.accountId);
      const answer = await reserve(client, ctx, {permissionId: exact, operationId: ctx.job.operationIds[1], output: 100_000_000});
      expect(answer).toMatchObject({outcome: 'unavailable_bound', reservation_id: null});
      expect(answer.outcome).toBe(unpriced[0].outcome);
      expect(await ledgerOf(client, ctx.owner.accountId)).toEqual(before);
    });
  });

  it('refuses a grant that has expired, been revoked, or been replaced, one whose Project has been deleted, and one whose Job has ended', async () => {
    await inTx(async (client) => {
      const ctx = await context(client, 6);
      const refused = async (id: string, operation: number) =>
        expect(await reserve(client, ctx, {permissionId: id, operationId: ctx.job.operationIds[operation]})).toMatchObject({outcome: 'permission_required', reservation_id: null});
      const revoked = await grantId(client, ctx);
      await revokeGrant(client, ctx, revoked);
      await refused(revoked, 0);
      const replaced = await grantId(client, ctx, {purpose: 'identify material'});
      await grantId(client, ctx, {purpose: 'identify material, again'});
      await refused(replaced, 0);
      const expired = await grantId(client, ctx, {purpose: 'identify material'});
      await withoutGuard(client, () => client.query(`update provider_private.permissions set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [expired]));
      await refused(expired, 0);
      const live = await grantId(client, ctx);
      await client.query('update projects.projects set deleted_at = clock_timestamp(), revision = revision + 1 where id = $1', [ctx.projectId]);
      await refused(live, 0);
      expect(await rows(client, 'service_role', GRANT, grantArgs(ctx))).toEqual([]);
      // The read does not hand out what the admission would refuse.
      expect(await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, 'synthesis_vision', 'anthropic'])).toEqual([]);
    });
    await inTx(async (client) => {
      const ctx = await context(client);
      const live = await grantId(client, ctx);
      await client.query(`update jobs.attempts set state = 'completed', ended_at = clock_timestamp() where id = $1`, [ctx.job.attemptId]);
      expect(await reserve(client, ctx, {permissionId: live})).toMatchObject({outcome: 'permission_required', reservation_id: null});
    });
  });

  it('does not let a retry revive a grant: it ends with its Attempt, and the new Attempt needs a grant of its own', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const original = await grantId(client, ctx);
      expect(await reserve(client, ctx, {permissionId: original, operationId: ctx.job.operationIds[0]})).toMatchObject({outcome: 'reserved'});
      await failAttempt(client, ctx);
      await rows(client, 'service_role', 'select outcome from api.request_retry($1,$2,$3,$4,$5,$6)', [ctx.owner.accountId, ctx.owner.epoch, randomUUID(), ctx.job.jobId, 1, 'a'.repeat(64)]);
      const {rows: second} = await client.query('select id from jobs.attempts where job_id = $1 and number = 2', [ctx.job.jobId]);
      expect(second).toHaveLength(1);
      await client.query(`update jobs.attempts set state = 'running', stage = 'started', started_at = clock_timestamp() where id = $1`, [second[0].id]);
      const step = (await client.query(`insert into jobs.steps (account_id, attempt_id, step_key) values ($1, $2, 'ledger') returning id`, [ctx.owner.accountId, second[0].id])).rows[0].id as string;
      const operation = (await client.query(`insert into jobs.operations (account_id, step_id, ordinal, state) values ($1, $2, 1, 'planned') returning id`, [ctx.owner.accountId, step])).rows[0].id as string;

      // The old grant is not live for the new Attempt, though the Job is running again.
      expect(await reserve(client, ctx, {permissionId: original, operationId: operation})).toMatchObject({outcome: 'permission_required', reservation_id: null});
      const read = (await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, 'synthesis_vision', 'anthropic']))[0]?.value;
      expect(read).toMatchObject({id: original, job_terminal: true});
      const renewed = await grantId(client, ctx);
      expect(renewed).not.toBe(original);
      expect(await reserve(client, ctx, {permissionId: renewed, operationId: operation})).toMatchObject({outcome: 'reserved'});
      expect((await client.query('select attempt_id = $2 as second from provider_private.permissions where id = $1', [renewed, second[0].id])).rows[0].second).toBe(true);
    });
  });

  it('refuses a missing grant argument, or an operation of another Job, for a command that was answered before, rather than replaying it', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      const command = randomUUID();
      expect(await reserve(client, ctx, {permissionId: id, command})).toMatchObject({outcome: 'reserved'});
      const before = await ledgerOf(client, ctx.owner.accountId);
      const other = await ledgerJob(client, ctx.owner.accountId, 1, ctx.projectId);
      for (const [label, change] of [
        ['no grant', (args: unknown[]) => { args[12] = null; }],
        ['no Project', (args: unknown[]) => { args[13] = null; }],
        ['no Job', (args: unknown[]) => { args[14] = null; }],
        ['no category', (args: unknown[]) => { args[15] = null; }],
        ['no purpose', (args: unknown[]) => { args[16] = null; }],
        ['no data', (args: unknown[]) => { args[17] = null; }],
        ['an unknown category', (args: unknown[]) => { args[15] = 'billing'; }],
        ['the operation of another Job', (args: unknown[]) => { args[3] = other.operationIds[0]; }],
      ] as const) {
        const args: unknown[] = reserveArgs(ctx, {permissionId: id, command});
        change(args);
        expect((await rows(client, 'service_role', RESERVE, args))[0], label).toMatchObject({outcome: 'permission_required', reservation_id: null});
      }
      expect(await ledgerOf(client, ctx.owner.accountId)).toEqual(before);
    });
  });

  it.each([
    ['completed', null],
    ['failed', 'step_failed'],
    ['cancelled', 'user_cancelled'],
  ])('ends a grant with its Attempt when the Attempt is %s: no admission, no new grant, and the read says it has ended', async (state, reason) => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      await client.query(`update jobs.attempts set state = $2, reason = $3, ended_at = clock_timestamp() where id = $1`, [ctx.job.attemptId, state, reason]);
      expect(await reserve(client, ctx, {permissionId: id})).toMatchObject({outcome: 'permission_required', reservation_id: null});
      expect(await rows(client, 'service_role', GRANT, grantArgs(ctx))).toEqual([]);
      const read = (await rows(client, 'service_role', GET, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, 'synthesis_vision', 'anthropic']))[0]?.value;
      expect(read).toMatchObject({id, job_terminal: true});
    });
  });

  it('bounds each request by the disclosed maximum and the Job by its own $5 cap: one grant admits requests of that price until the cap, then the reservation says so', async () => {
    await inTx(async (client) => {
      const ctx = await context(client, 8);
      const {rows: quoted} = await client.query(
        `select outcome, microdollars from api.quote_cost($1,$2,$3,$4,$5,$6,100,0,900,1,'{}'::jsonb)`,
        [ctx.owner.accountId, ctx.owner.epoch, ctx.rate.id, ctx.rate.provider, ctx.rate.model, ctx.rate.apiVersion],
      );
      expect(quoted[0].outcome).toBe('quoted');
      const price = Number(quoted[0].microdollars);
      expect(price).toBeLessThanOrEqual(M);
      const fits = Math.floor(5 * M / price);
      expect(fits).toBeGreaterThanOrEqual(2);
      expect(fits).toBeLessThan(ctx.job.operationIds.length);
      const id = await grantId(client, ctx, {maximum: price});
      for (let operation = 0; operation < fits; operation += 1) {
        expect(await reserve(client, ctx, {permissionId: id, operationId: ctx.job.operationIds[operation], output: 900}), `operation ${operation + 1}`).toMatchObject({outcome: 'reserved'});
      }
      // The total is not what the grant bounds: the Job's cap does.
      expect(await reserve(client, ctx, {permissionId: id, operationId: ctx.job.operationIds[fits], output: 900})).toMatchObject({outcome: 'over_job_cap', reservation_id: null});
      expect((await ledgerOf(client, ctx.owner.accountId)).reservations).toBe(fits);
    });
  });

  it('answers a command that was answered before, whatever has become of the grant since', async () => {
    await inTx(async (client) => {
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      const command = randomUUID();
      const first = await reserve(client, ctx, {permissionId: id, command});
      expect(first).toMatchObject({outcome: 'reserved'});
      await revokeGrant(client, ctx, id);
      const before = await ledgerOf(client, ctx.owner.accountId);
      // The same command, the same request: the receipt, not a refusal for the revoked grant.
      expect(await reserve(client, ctx, {permissionId: id, command})).toMatchObject({outcome: 'replayed', reservation_id: first.reservation_id});
      // The same command with another request is not the same command.
      expect(await reserve(client, ctx, {permissionId: id, command, output: 99})).toMatchObject({outcome: 'reused', reservation_id: null});
      // Another command for an operation that holds a reservation finds the reservation, and another request is refused.
      expect(await reserve(client, ctx, {permissionId: id, output: 99})).toMatchObject({outcome: 'already_reserved', reservation_id: first.reservation_id});
      expect(await ledgerOf(client, ctx.owner.accountId)).toEqual(before);
      // The same request under another command ID is replayed, and recorded under that ID too.
      expect(await reserve(client, ctx, {permissionId: id})).toMatchObject({outcome: 'replayed', reservation_id: first.reservation_id});
      // A new operation under the revoked grant is refused.
      expect(await reserve(client, ctx, {permissionId: id, operationId: ctx.job.operationIds[1]})).toMatchObject({outcome: 'permission_required', reservation_id: null});
    });
    await inTx(async (client) => {
      // The same after the Job has ended and after the grant has expired.
      const ctx = await context(client);
      const id = await grantId(client, ctx);
      const command = randomUUID();
      const first = await reserve(client, ctx, {permissionId: id, command});
      await withoutGuard(client, () => client.query(`update provider_private.permissions set expires_at = clock_timestamp() - interval '1 second' where id = $1`, [id]));
      await client.query(`update jobs.attempts set state = 'completed', ended_at = clock_timestamp() where id = $1`, [ctx.job.attemptId]);
      expect(await reserve(client, ctx, {permissionId: id, command})).toMatchObject({outcome: 'replayed', reservation_id: first.reservation_id});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the generic form of api.reserve_cost (twelve arguments) never reserves for Anthropic or Brave', () => {
  const generic = async (client: Client, ctx: Context, provider: string | null, schedule = ctx.rate, operation = 0) => (await rows(client, 'service_role', RESERVE_GENERIC, [
    ctx.owner.accountId, ctx.owner.epoch, randomUUID(), ctx.job.operationIds[operation], schedule.id, provider, schedule.model, schedule.apiVersion, 100, 0, 100, '{}',
  ]))[0];

  it('refuses the providers whatever their case or padding, an absent provider, and a rate schedule of a permissioned provider under another name', async () => {
    await inTx(async (client) => {
      const ctx = await context(client, 2, `t25-${tag}`);
      const before = await ledgerOf(client, ctx.owner.accountId);
      for (const provider of ['anthropic', 'brave', 'Anthropic', 'BRAVE', 'Brave', ' brave ', '\tAnthropic\n', '\x0bbrave', '\x0cAnthropic\x0b', null]) {
        expect(await generic(client, ctx, provider), JSON.stringify(provider)).toMatchObject({outcome: 'permission_required', reservation_id: null});
      }
      const anthropic = await schedule(client, 'anthropic');
      expect(await generic(client, ctx, ctx.rate.provider, anthropic)).toMatchObject({outcome: 'permission_required', reservation_id: null});
      const brave = await schedule(client, 'brave');
      expect(await generic(client, ctx, ctx.rate.provider, brave)).toMatchObject({outcome: 'permission_required', reservation_id: null});
      expect(await ledgerOf(client, ctx.owner.accountId)).toEqual(before);
    });
  });

  it('still reserves for a provider that needs no grant', async () => {
    await inTx(async (client) => {
      const ctx = await context(client, 2, `t25-${tag}`);
      expect(await generic(client, ctx, ctx.rate.provider)).toMatchObject({outcome: 'reserved'});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the closure of the permissions', () => {
  const apiSignatures = [
    'api.grant_provider_permission(uuid,uuid,uuid,text,text,text,text[],bigint)', 'api.get_provider_permission(uuid,uuid,uuid,text,text)', 'api.revoke_provider_permission(uuid,uuid,uuid,uuid)',
    'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[])',
  ];
  const internalSignatures = [
    'provider_private.reserve_cost_unchecked(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)', 'provider_private.revoke_permission(uuid,uuid,uuid,uuid)',
    'provider_private.valid_outbound(text[])', 'provider_private.refusal(text)', 'provider_private.is_permissioned_provider(text)', 'provider_private.stamp_permission()',
    'provider_private.supersede_permission()', 'provider_private.guard_permission_change()',
  ];

  it('is reached by the service role alone: the table and the helpers are closed to every role, and the api functions to anon, authenticated and PUBLIC', async () => {
    const {rows: table} = await db.query(
      `select c.relrowsecurity as rls,
              (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies,
              (select count(*) from information_schema.role_table_grants g where g.table_schema = 'provider_private' and g.table_name = 'permissions' and g.grantee in ('anon', 'authenticated', 'PUBLIC'))::int as open_grants
         from pg_class c where c.oid = 'provider_private.permissions'::regclass`,
    );
    expect(table[0]).toEqual({rls: true, policies: 0, open_grants: 0});
    for (const role of ['anon', 'authenticated']) {
      const {rows: usage} = await db.query(`select has_schema_privilege($1, 'provider_private', 'usage') as usage`, [role]);
      expect(usage[0].usage, role).toBe(false);
      for (const signature of [...apiSignatures, ...internalSignatures]) {
        const {rows: execute} = await db.query(`select has_function_privilege($1, $2, 'execute') as execute`, [role, signature]);
        expect(execute[0].execute, `${role} executes ${signature}`).toBe(false);
      }
    }
    for (const signature of apiSignatures) {
      const {rows: execute} = await db.query(`select has_function_privilege('service_role', $1, 'execute') as execute`, [signature]);
      expect(execute[0].execute, signature).toBe(true);
    }
    // The helpers are for the functions that call them: not even the service role runs them.
    for (const signature of internalSignatures) {
      const {rows: execute} = await db.query(`select has_function_privilege('service_role', $1, 'execute') as execute`, [signature]);
      expect(execute[0].execute, signature).toBe(false);
    }
    // Nor does the service role touch the table: the api functions are security definers.
    for (const privilege of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
      const {rows: granted} = await db.query(`select has_table_privilege('service_role', 'provider_private.permissions', $1) as granted`, [privilege]);
      expect(granted[0].granted, privilege).toBe(false);
    }
  });

  it('reaches the unchecked reservation, the way round the gate, from the two overloads of api.reserve_cost and from nothing else', async () => {
    const {rows: callers} = await db.query(
      `select p.oid::regprocedure::text as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc like '%reserve_cost_unchecked%' and p.proname not in ('reserve_cost_unchecked', 'preflight')`,
    );
    // (api.preflight names it too, only to look for it in the catalog.)
    expect(callers.map((row) => row.name).sort()).toEqual([
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
      'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb,uuid,uuid,uuid,text,text,text[])',
    ]);
  });

  it('answers ok to the service role, and fails the build with one line naming a missing function, and says which migration is not applied', async () => {
    await inTx(async (client) => {
      expect((await rows(client, 'service_role', 'select ok from api.preflight()'))[0]).toEqual({ok: true});
    });
    for (const signature of [...apiSignatures.slice(0, 3), apiSignatures[3], ...internalSignatures]) {
      await inTx(async (client) => {
        const spec = (await client.query(`select to_regprocedure($1)::text as name`, [signature])).rows[0].name;
        await client.query(`drop function ${spec} cascade`);
        const result = await attempt(client, 'service_role', 'select * from api.preflight()');
        expect(result.ok, signature).toBe(false);
        if (!result.ok) {
          expect(result.code, signature).toBe('N3020');
          expect(result.message, signature).toContain(signature);
          expect(result.message, signature).toContain('Story 2.5');
        }
      });
    }
  });

  it('fails the build when the service role cannot execute one of the four api functions', async () => {
    for (const signature of apiSignatures) {
      await inTx(async (client) => {
        await client.query(`revoke execute on function ${signature.replace(/,/g, ', ')} from service_role`);
        const result = await attempt(client, 'service_role', 'select * from api.preflight()');
        expect(result.ok, signature).toBe(false);
        if (!result.ok) {
          expect(result.code, signature).toBe('42501');
          expect(result.message, signature).toContain(signature);
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('separate connections', () => {
  async function committedContext(): Promise<Context> {
    const owner = await committedAccount();
    const projectId = await project(db, owner);
    const job = await ledgerJob(db, owner.accountId, 3, projectId);
    return {owner, projectId, job, rate: await schedule(db, 'anthropic')};
  }

  it('makes a revocation wait for an admission that is using the grant, and refuses the next admission', async () => {
    const ctx = await committedContext();
    const id = await grantNow(db, ctx);
    const holder = await connect();
    const revoker = await connect();
    try {
      await holder.query('begin');
      expect(await reserveNow(holder, ctx, {permissionId: id, operationId: ctx.job.operationIds[0]})).toMatchObject({outcome: 'reserved'});
      const revokerPid = await pidOf(revoker);
      const revoking = revoker.query(REVOKE, [ctx.owner.accountId, ctx.projectId, ctx.job.jobId, id]);
      await untilBlocked(revokerPid);
      await holder.query('commit');
      expect((await revoking).rows[0].value).toEqual({revoked: true});
      expect(await reserveNow(db, ctx, {permissionId: id, operationId: ctx.job.operationIds[1]})).toMatchObject({outcome: 'permission_required', reservation_id: null});
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.end();
      await revoker.end();
    }
  });

  it('makes an admission wait for the command that ends the Job, and refuses it for want of a live grant, not for the state of its operation', async () => {
    const ctx = await committedContext();
    const id = await grantNow(db, ctx);
    const holder = await connect();
    const reserver = await connect();
    try {
      await holder.query('begin');
      const moved = (await holder.query('select outcome from api.move_attempt($1,$2,$3,$4,$5,$6)', [ctx.owner.accountId, ctx.owner.epoch, randomUUID(), ctx.job.attemptId, 'failed', 'step_failed'])).rows[0];
      expect(moved.outcome).toBe('moved');
      const reserverPid = await pidOf(reserver);
      const reserving = reserver.query(RESERVE, reserveArgs(ctx, {permissionId: id}));
      await untilBlocked(reserverPid);
      await holder.query('commit');
      expect((await reserving).rows[0]).toMatchObject({outcome: 'permission_required', reservation_id: null});
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.end();
      await reserver.end();
    }
  });

  it('makes a grant wait for a retry of the Job, and binds it to the new Attempt', async () => {
    const ctx = await committedContext();
    expect((await db.query('select outcome from api.move_attempt($1,$2,$3,$4,$5,$6)', [ctx.owner.accountId, ctx.owner.epoch, randomUUID(), ctx.job.attemptId, 'failed', 'step_failed'])).rows[0].outcome).toBe('moved');
    const holder = await connect();
    const granter = await connect();
    try {
      await holder.query('begin');
      await holder.query('select outcome from api.request_retry($1,$2,$3,$4,$5,$6)', [ctx.owner.accountId, ctx.owner.epoch, randomUUID(), ctx.job.jobId, 1, 'a'.repeat(64)]);
      const granterPid = await pidOf(granter);
      const granting = granter.query(GRANT, grantArgs(ctx, {}));
      await untilBlocked(granterPid);
      await holder.query('commit');
      const made = (await granting).rows[0]?.value;
      expect(made?.id).toMatch(UUID);
      const {rows: bound} = await db.query(
        `select pp.attempt_id = a.id as second from provider_private.permissions pp join jobs.attempts a on a.job_id = pp.job_id and a.number = 2 where pp.id = $1`,
        [made.id],
      );
      expect(bound).toEqual([{second: true}]);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.end();
      await granter.end();
    }
  });

  it('lets two grants for the same Job, category and provider at once leave exactly one of them live', async () => {
    const ctx = await committedContext();
    const [first, second] = await Promise.all([connect(), connect()]);
    try {
      const made = await Promise.all([
        first.query(GRANT, grantArgs(ctx, {purpose: 'identify material, first'})),
        second.query(GRANT, grantArgs(ctx, {purpose: 'identify material, second'})),
      ]);
      expect(made.map((result) => result.rows.length)).toEqual([1, 1]);
      const {rows: live} = await db.query('select count(*)::int as total, count(*) filter (where revoked_at is null)::int as live from provider_private.permissions where job_id = $1', [ctx.job.jobId]);
      expect(live[0]).toEqual({total: 2, live: 1});
    } finally {
      await first.end();
      await second.end();
    }
  });

  it('makes a grant wait for the command that ends the Job, and then refuses it', async () => {
    const ctx = await committedContext();
    const holder = await connect();
    const granter = await connect();
    try {
      await holder.query('begin');
      const moved = (await holder.query('select outcome from api.move_attempt($1,$2,$3,$4,$5,$6)', [ctx.owner.accountId, ctx.owner.epoch, randomUUID(), ctx.job.attemptId, 'failed', 'step_failed'])).rows[0];
      expect(moved.outcome).toBe('moved');
      const granterPid = await pidOf(granter);
      const granting = granter.query(GRANT, grantArgs(ctx, {}));
      await untilBlocked(granterPid);
      await holder.query('commit');
      expect((await granting).rows).toEqual([]);
      expect((await ledgerOf(db, ctx.owner.accountId)).permissions).toBe(0);
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.end();
      await granter.end();
    }
  });
});
