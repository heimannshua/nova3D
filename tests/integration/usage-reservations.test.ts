import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {quoteCost, reserveCost, settleCost, usageConstants} from '@/lib/usage-reservations';
import {createHarness, sha, stack} from '../support/accounts-db';
import {jwtSecretOf, stackEnvironment} from '../support/stack';
import {truncateGuards} from '../support/truncate-guard';
import {insertReservation, ledgerJob, setFigures} from '../support/usage-ledger';

// Story 2.6 against the Supabase CLI stack: the Usage ledgers (immutable versioned rate schedules, the reservation and settlement ledgers, the overrun incidents and the
// receipts of the commands), the ONE checked integer/rational calculator in SQL, the figures of a period as signed deltas from the ledgers, the Job exposure, and the
// three api functions: api.quote_cost (read-only), api.reserve_cost (the admission) and api.settle_cost (no Account epoch, status or Project check). Most cases run
// inside a transaction that is rolled back, as the service role. The cases that need several real connections (the same command at once, reservations near each limit,
// a reserve against a limit change, a settle and a tombstone) and the typed calls as the application will make them commit data that is removed afterwards. The rate
// schedules are global: the file makes its own, under a provider of its own, and removes them when it is done. Money is integer microdollars: 1,000,000 is $1.

const {db, connect: openConnection, committed, cleanup, inTx, addUser, attempt, rows, count} = createHarness();

/** Another connection, for the cases that need two sessions at once. A test that fails while it holds a lock must not leave the rest of the file waiting for it: the session gives up. */
async function connect() {
  const client = await openConnection();
  await client.query(`set idle_in_transaction_session_timeout = '40s'`);
  await client.query(`set lock_timeout = '40s'`);
  return client;
}

const tag = randomBytes(3).toString('hex');
const provider = `t26-${tag}`;
let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});
afterAll(async () => {
  // The schedules are global: remove this run's once nothing refers to them (the Accounts' data goes first; the harness's own hook then finds nothing to do).
  await cleanup();
  await db.query(`delete from usage.rate_schedules where provider like $1`, [`t26-${tag}%`]);
});

const M = 1_000_000;

// Fixtures ----------------------------------------------------------------------------------------------------------------------

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; epoch: number};

/** An Account with its Workspace and its `initial` period, made the way registration makes one (identity.activate_account). */
async function account(client: Client, role: 'member' | 'administrator' = 'member'): Promise<Fixture> {
  const user = await addUser(client);
  const {rows: made} = await client.query(`select identity.activate_account($1, $2, $3, 'invitation') as id`, [user.id, user.subject, role]);
  const accountId = made[0].id as string;
  const {rows: workspace} = await client.query('select id from projects.workspaces where account_id = $1', [accountId]);
  return {user, accountId, workspaceId: workspace[0].id as string, epoch: 1};
}

async function committedAccount(role: 'member' | 'administrator' = 'member'): Promise<Fixture> {
  const made = await account(db, role);
  committed.users.push(made.user.id);
  return made;
}

/** The Account's allowance for this month: its `initial` period put back as the owner, with the given limit (a period is never edited, but the owner may delete and insert). */
async function allowance(client: Client, accountId: string, limit: number) {
  await client.query('delete from usage.periods where account_id = $1', [accountId]);
  await client.query(
    `insert into usage.periods (account_id, seq, month_start, limit_microdollars, carried_settled_microdollars, carried_reserved_microdollars, cause, previous_limit_microdollars, actor, command_id, digest)
     values ($1, 1, usage.current_month(), $2::bigint, 0, 0, 'initial', null, 'system', null, usage.period_digest($1, 1, usage.current_month(), $2::bigint, 0::bigint, 0::bigint, 'initial'))`,
    [accountId, limit],
  );
}

/** The Account's periods put back as the owner: `monthsAgo` months before this UTC month (so a rollover can be provoked). Only for an Account with no ledger row. */
async function periodsAgo(client: Client, accountId: string, specs: {seq: number; monthsAgo: number; limit: number; cause?: string}[]) {
  await client.query('delete from usage.periods where account_id = $1', [accountId]);
  const ids: string[] = [];
  for (const spec of specs) {
    const month = `(usage.current_month() - make_interval(months => $3::int))::date`;
    const made = await client.query(
      `insert into usage.periods (account_id, seq, month_start, limit_microdollars, carried_settled_microdollars, carried_reserved_microdollars, cause, previous_limit_microdollars, actor, command_id, digest)
       values ($1, $2, ${month}, $4::bigint, 0, 0, $5, $6::bigint, 'system', null, usage.period_digest($1, $2, ${month}, $4::bigint, 0::bigint, 0::bigint, $5))
       returning id`,
      [accountId, spec.seq, spec.monthsAgo, spec.limit, spec.cause ?? (spec.seq === 1 ? 'initial' : 'month'), spec.seq === 1 ? null : spec.limit],
    );
    ids.push(made.rows[0].id as string);
  }
  return ids;
}

/** A live Project of the Account, inserted directly. */
async function project(client: Client, owner: Fixture): Promise<string> {
  const {rows: made} = await client.query(
    `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'Courtyard bench', 'researching') returning id`,
    [owner.workspaceId, owner.accountId],
  );
  return made[0].id as string;
}

type Sched = {id: string; provider: string; model: string; apiVersion: string};
type Rates = Partial<{
  inN: number; inD: number; outN: number; outD: number; reqN: number; reqD: number; incIn: number; incOut: number; multN: number; multD: number;
  currency: string; version: number; provider: string; model: string; apiVersion: string;
}>;
let sequence = 0;
/**
 * A rate schedule, inserted as the owner (nothing else writes one): by default USD, 3 microdollars per input token and 15 per output token, no request price, increments
 * of 1 token and a multiplier of 1. The standard request (10,000 bytes, 2 images, 16,000 output tokens) is then 24,200 x 3 + 16,000 x 15 = 312,600 microdollars.
 */
async function schedule(client: Client, rates: Rates = {}): Promise<Sched> {
  sequence += 1;
  const spec = {inN: 3, inD: 1, outN: 15, outD: 1, reqN: 0, reqD: 1, incIn: 1, incOut: 1, multN: 1, multD: 1, currency: 'USD', version: 1, provider, model: `m${sequence}-${tag}`, apiVersion: '2023-06-01', ...rates};
  const {rows: made} = await client.query(
    `insert into usage.rate_schedules (provider, model, version, api_version, currency, input_rate_num, input_rate_den, output_rate_num, output_rate_den, request_rate_num, request_rate_den,
                                       input_increment, output_increment, multiplier_num, multiplier_den)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [spec.provider, spec.model, spec.version, spec.apiVersion, spec.currency, spec.inN, spec.inD, spec.outN, spec.outD, spec.reqN, spec.reqD, spec.incIn, spec.incOut, spec.multN, spec.multD],
  );
  return {id: made[0].id as string, provider: spec.provider, model: spec.model, apiVersion: spec.apiVersion};
}
/** 1,000 microdollars for each output token and nothing for input: an output limit of 1,000 reserves exactly $1 (the operation cap), 500 reserves $0.50. */
const round = (client: Client, rates: Rates = {}) => schedule(client, {inN: 0, outN: 1000, ...rates});

// A reference calculator, written separately in BigInt so the SQL one is checked against hand-checked arithmetic and not against itself. -------------------------------

const big = (value: number | bigint) => BigInt(value);
const ceilDiv = (numerator: bigint, denominator: bigint) => (numerator + denominator - BigInt(1)) / denominator;
const refBound = (bytes: number, images: number) => ceilDiv((big(bytes) + BigInt(2000) + BigInt(5000) * big(images)) * BigInt(11), BigInt(10));
type RefRates = {inN: number; inD: number; outN: number; outD: number; reqN: number; reqD: number; incIn: number; incOut: number; multN: number; multD: number};
function refPrice(rates: RefRates, inputTokens: bigint, outputTokens: bigint, requests: number): bigint {
  const upTo = (tokens: bigint, increment: number) => ceilDiv(tokens, big(increment)) * big(increment);
  const input = upTo(inputTokens, rates.incIn);
  const output = upTo(outputTokens, rates.incOut);
  const numerator =
    (input * big(rates.inN) * big(rates.outD) * big(rates.reqD) + output * big(rates.outN) * big(rates.inD) * big(rates.reqD) + big(requests) * big(rates.reqN) * big(rates.inD) * big(rates.outD)) *
    big(rates.multN);
  return ceilDiv(numerator, big(rates.inD) * big(rates.outD) * big(rates.reqD) * big(rates.multD));
}

// Calling the three commands ---------------------------------------------------------------------------------------------------

const QUOTE = `select outcome, reason, detail, input_bound::float8 as input_bound, input_units::float8 as input_units, output_units::float8 as output_units, microdollars::float8 as microdollars
                 from api.quote_cost($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
const RESERVE = `select outcome, reservation_id, operation_id, job_id, period_id, rate_schedule_id, input_bound::float8 as input_bound, reserved_microdollars::float8 as reserved, state, reason, detail,
                        requested_microdollars::float8 as requested, limit_microdollars::float8 as "limit", used_microdollars::float8 as used, available_microdollars::float8 as available
                   from api.reserve_cost($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
const SETTLE = `select outcome, settlement_id, reservation_id, operation_id, period_id, classification, settled_microdollars::float8 as settled, released_microdollars::float8 as released,
                       over_microdollars::float8 as over, incident_id, state, due_at, reason
                  from api.settle_cost($1, $2, $3, $4, $5, $6, $7)`;

type Who = {accountId: string; epoch: number};
type Request = {schedule: Sched; bytes?: number; images?: number; output?: number; options?: unknown; provider?: string; model?: string; apiVersion?: string};
type QuoteRequest = Request & {count?: number; epoch?: number};
type ReserveRequest = Request & {operationId: string; command?: string; epoch?: number};

const quoteArgs = (who: Who, o: QuoteRequest) => [
  who.accountId, o.epoch ?? who.epoch, o.schedule.id, o.provider ?? o.schedule.provider, o.model ?? o.schedule.model, o.apiVersion ?? o.schedule.apiVersion,
  o.bytes ?? 10_000, o.images ?? 2, o.output ?? 16_000, o.count ?? 1, JSON.stringify(o.options ?? {}),
];
const reserveArgs = (who: Who, o: ReserveRequest) => [
  who.accountId, o.epoch ?? who.epoch, o.command ?? randomUUID(), o.operationId, o.schedule.id, o.provider ?? o.schedule.provider, o.model ?? o.schedule.model,
  o.apiVersion ?? o.schedule.apiVersion, o.bytes ?? 10_000, o.images ?? 2, o.output ?? 16_000, JSON.stringify(o.options ?? {}),
];
const quote = async (client: Client, who: Who, o: QuoteRequest) => (await rows(client, 'service_role', QUOTE, quoteArgs(who, o)))[0];
const reserve = async (client: Client, who: Who, o: ReserveRequest) => (await rows(client, 'service_role', RESERVE, reserveArgs(who, o)))[0];

type SettleRequest = {operationId: string; classification: 'evidence' | 'deadline' | 'noncharge' | 'unused'; command?: string; input?: number | null; output?: number | null; model?: string | null};
const settleArgs = (accountId: string, o: SettleRequest) => {
  const evidence = o.classification === 'evidence';
  return [accountId, o.command ?? randomUUID(), o.operationId, o.classification, o.input === undefined ? (evidence ? 1000 : null) : o.input, o.output === undefined ? (evidence ? 500 : null) : o.output, o.model === undefined ? (evidence ? 'claude-test-0001' : null) : o.model];
};
const settle = async (client: Client, accountId: string, o: SettleRequest) => (await rows(client, 'service_role', SETTLE, settleArgs(accountId, o)))[0];
// The same calls on a connection that is not inside a transaction (the committed cases), as the owner: the api functions are security definer all the same.
const quoteNow = async (client: Client, who: Who, o: QuoteRequest) => (await client.query(QUOTE, quoteArgs(who, o))).rows[0];
const reserveNow = async (client: Client, who: Who, o: ReserveRequest) => (await client.query(RESERVE, reserveArgs(who, o))).rows[0];
const settleNow = async (client: Client, accountId: string, o: SettleRequest) => (await client.query(SETTLE, settleArgs(accountId, o))).rows[0];

// Reading the ledgers -----------------------------------------------------------------------------------------------------------

const ledgerOf = async (client: Client, accountId: string) => ({
  reservations: await count(client, 'select count(*) as n from usage.reservations where account_id = $1', [accountId]),
  settlements: await count(client, 'select count(*) as n from usage.settlements where account_id = $1', [accountId]),
  incidents: await count(client, 'select count(*) as n from usage.overrun_incidents where account_id = $1', [accountId]),
  commands: await count(client, 'select count(*) as n from usage.commands where account_id = $1', [accountId]),
});
type Ledger = Awaited<ReturnType<typeof ledgerOf>>;

/** The figures of the Account's current period as the page shows them (carried + the period's figure), and what follows from them. */
async function figuresOf(client: Client, accountId: string) {
  const found = (
    await client.query(
      `select p.seq, p.limit_microdollars::float8 as "limit", (p.carried_settled_microdollars + f.settled_microdollars)::float8 as settled, (p.carried_reserved_microdollars + f.reserved_microdollars)::float8 as reserved,
              f.settled_microdollars::float8 as settled_figure, f.reserved_microdollars::float8 as reserved_figure
         from usage.periods p cross join lateral usage.period_figures(p.id) f where p.account_id = $1 order by p.seq desc limit 1`,
      [accountId],
    )
  ).rows[0];
  const used = found.settled + found.reserved;
  return {
    seq: found.seq as number,
    limit: found.limit as number,
    settled: found.settled as number,
    reserved: found.reserved as number,
    settledFigure: found.settled_figure as number,
    reservedFigure: found.reserved_figure as number,
    used,
    available: Math.max(found.limit - used, 0),
    over: Math.max(used - found.limit, 0),
  };
}
/** The amounts reconcile: settled + reserved + available = limit, or limit + over = used. */
const reconciles = (f: Awaited<ReturnType<typeof figuresOf>>) => (f.over > 0 ? f.available === 0 && f.limit + f.over === f.used : f.settled + f.reserved + f.available === f.limit);
const availableOf = async (client: Client, accountId: string) => Number((await client.query('select usage.available_microdollars($1)::float8 as available', [accountId])).rows[0].available);
const exposureOf = async (client: Client, jobId: string) => Number((await client.query('select usage.job_exposure($1)::float8 as exposure', [jobId])).rows[0].exposure);

const reservationRow = async (client: Client, id: string) =>
  (
    await client.query(
      `select id, account_id, period_id, job_id, operation_id, rate_schedule_id, provider, requested_model, api_version, request_bytes::float8 as request_bytes, image_count, output_limit,
              input_bound::float8 as input_bound, reserved_microdollars::float8 as reserved, digest, created_at
         from usage.reservations where id = $1`,
      [id],
    )
  ).rows[0];
const settlementRow = async (client: Client, id: string) =>
  (
    await client.query(
      `select id, account_id, reservation_id, period_id, classification, settled_microdollars::float8 as settled, released_microdollars::float8 as released, input_tokens::float8 as input_tokens,
              output_tokens::float8 as output_tokens, returned_model, digest, created_at
         from usage.settlements where id = $1`,
      [id],
    )
  ).rows[0];

// Operations ------------------------------------------------------------------------------------------------------------------------

type OperationTarget = 'dispatched' | 'completed' | 'ambiguous' | 'noncharge' | 'settled' | 'abandoned';
/**
 * Moves a planned operation to a state as the OWNER, along the guarded path (the triggers of Story 2.11 still judge every step). `outcomeAgo` backdates the outcome
 * of an ambiguous or completed operation (an interval such as `23 hours 59 minutes`), which a command never can, so the 24-hour deadline can be tried at its edge.
 */
async function moveTo(client: Client, operationId: string, target: OperationTarget, outcomeAgo = '0 seconds') {
  const at = `clock_timestamp() - interval '${outcomeAgo}'`;
  const set = (sql: string) => client.query(`update jobs.operations set ${sql} where id = $1`, [operationId]);
  if (target === 'abandoned') return set(`state = 'abandoned'`);
  await set(`state = 'dispatched', dispatched_at = clock_timestamp()`);
  if (target === 'dispatched') return;
  if (target === 'completed') return set(`state = 'completed', outcome_at = ${at}`);
  if (target === 'noncharge') return set(`state = 'noncharge', outcome_at = ${at}, request_id = 'req_noncharge_1'`);
  await set(`state = 'ambiguous', outcome_at = ${at}`);
  if (target === 'settled') await set(`state = 'settled'`);
}

/** A Job with a running attempt and `n` planned operations, inserted directly, for the Account (it names one of the Account's Projects, or makes one). */
const jobWith = (client: Client, who: Fixture, n = 1) => ledgerJob(client, who.accountId, n);

/** An operation that has a reservation made by the command, for the standard request under the schedule (or under the round one with the given output). */
async function reserved(client: Client, who: Fixture, sched: Sched, request: Partial<Request> = {}) {
  const job = await jobWith(client, who);
  const answer = await reserve(client, who, {...request, schedule: sched, operationId: job.operationIds[0]});
  expect(answer.outcome).toBe('reserved');
  return {...job, operationId: job.operationIds[0], reservationId: answer.reservation_id as string, amount: answer.reserved as number, answer};
}

/** The Administrator changes a limit or resets the count, as the service role calls api.set_usage_limit. */
async function changeLimit(client: Client, admin: Fixture, target: Fixture, kind: 'change' | 'reset', limit: number | null, expectedSeq: number) {
  return (
    await rows(client, 'service_role', 'select outcome, seq from api.set_usage_limit($1, $2, $3, $4, $5, $6, $7, $8)', [
      `user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), kind, limit, expectedSeq,
    ])
  )[0] as {outcome: string; seq: number};
}

const untilBlocked = async (pid: number) => {
  for (let poll = 0; poll < 200; poll += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The backend never waited for a lock.');
};
const pidOf = async (client: Client) => (await client.query('select pg_backend_pid() as pid')).rows[0].pid as number;

/** What a refusal leaves behind: the ledgers as they were. */
const unchanged = async (client: Client, accountId: string, before: Ledger) => expect(await ledgerOf(client, accountId)).toEqual(before);

// ---------------------------------------------------------------------------------------------------
describe('access: the ledgers are closed, and only the service role reaches the three api functions', () => {
  const tables = ['rate_schedules', 'reservations', 'settlements', 'overrun_incidents', 'commands'];

  it('has five new tables with row-level security on, no policy, and no privilege for any role, the gateway or PUBLIC', async () => {
    const {rows: found} = await db.query(
      `select c.relname as name, c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies,
              (select count(*)::int from aclexplode(c.relacl) a where a.grantee <> c.relowner) as other_grants
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'usage' and c.relname = any($1) order by 1`,
      [tables],
    );
    expect(found).toEqual([...tables].sort().map((name) => ({name, rls: true, policies: 0, other_grants: 0})));
    for (const role of ['anon', 'authenticated', 'service_role', 'nova3d_gateway']) {
      for (const table of tables) {
        const {rows: held} = await db.query(
          `select has_table_privilege($1, $2, 'select,insert,update,delete,truncate,references,trigger') as can, has_any_column_privilege($1, $2, 'select,insert,update,references') as column_can`,
          [role, `usage.${table}`],
        );
        expect(held[0], `${role} on usage.${table}`).toEqual({can: false, column_can: false});
      }
    }
  });

  it('refuses every role a direct read or write of a ledger, and every internal function: Usage is reached only through the api schema', async () => {
    await inTx(async (client) => {
      for (const sql of [
        ...tables.map((table) => `select * from usage.${table}`),
        'delete from usage.reservations',
        'insert into usage.commands (account_id, command_id, kind, digest, subject_id) values (gen_random_uuid(), gen_random_uuid(), $$reserve$$, repeat($$a$$, 64), gen_random_uuid())',
        'select usage.input_bound(1, 1)',
        'select usage.billed_units(1, 1)',
        'select * from usage.price(gen_random_uuid(), 1, 1, 1)',
        'select * from usage.bound_cost(gen_random_uuid(), $$a$$, $$b$$, $$c$$, 1, 1, 1, 1, $${}$$::jsonb)',
        'select usage.job_exposure(gen_random_uuid())',
        'select usage.overhead_tokens()',
        'select usage.operation_cap()',
        'select usage.ambiguity_deadline()',
        'select usage.cost_digest($$reserve_cost$$, array[$$a$$])',
      ]) {
        for (const role of ['service_role', 'anon', 'authenticated']) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.code, `${role}: ${sql}`).toBe('42501');
        }
      }
    });
  });

  it('puts the three api functions in the api schema, running as their owner with an empty search path, executable by the service role alone, with exactly these arguments', async () => {
    const {rows: found} = await db.query(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
              coalesce((select array_agg(a.grantee::regrole::text order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname in ('quote_cost', 'reserve_cost', 'settle_cost') order by 1`,
    );
    expect(found.map((fn) => fn.name)).toEqual(['quote_cost', 'reserve_cost', 'settle_cost']);
    for (const fn of found) {
      expect(fn.definer, fn.name).toBe(true);
      expect(fn.config, fn.name).toEqual(['search_path=""']);
      expect(fn.grantees, fn.name).toEqual(['service_role']);
    }
    const byName = Object.fromEntries(found.map((fn) => [fn.name, fn]));
    expect(byName.quote_cost.args).toBe(
      "p_account_id uuid, p_epoch bigint, p_rate_schedule_id uuid, p_provider text, p_model text, p_api_version text, p_request_bytes bigint, p_image_count integer, p_output_limit integer, p_request_count integer DEFAULT 1, p_options jsonb DEFAULT '{}'::jsonb",
    );
    expect(byName.reserve_cost.args).toBe(
      "p_account_id uuid, p_epoch bigint, p_command_id uuid, p_operation_id uuid, p_rate_schedule_id uuid, p_provider text, p_model text, p_api_version text, p_request_bytes bigint, p_image_count integer, p_output_limit integer, p_options jsonb DEFAULT '{}'::jsonb",
    );
    expect(byName.settle_cost.args).toBe(
      'p_account_id uuid, p_command_id uuid, p_operation_id uuid, p_classification text, p_input_tokens bigint DEFAULT NULL::bigint, p_output_tokens bigint DEFAULT NULL::bigint, p_returned_model text DEFAULT NULL::text',
    );
    // Settling takes no epoch: the argument is not there to be checked.
    expect(byName.settle_cost.args).not.toMatch(/epoch/);
    expect(byName.quote_cost.result).toBe('api.cost_quotation');
    expect(byName.reserve_cost.result).toBe('api.cost_reservation');
    expect(byName.settle_cost.result).toBe('api.cost_settlement');
  });

  it('keeps every function of the usage schema callable by no API role, with its search path pinned', async () => {
    const {rows: functions} = await db.query(
      `select p.proname as name, p.proconfig as config, p.proacl is null as default_acl,
              (select count(*)::int from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) as other_grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'usage'`,
    );
    expect(functions.length).toBeGreaterThanOrEqual(30);
    for (const fn of functions) {
      expect(fn.default_acl, `usage.${fn.name} has an explicit ACL`).toBe(false);
      expect(String(fn.config), `usage.${fn.name} pins search_path`).toContain('search_path=');
      expect(fn.other_grantees, `usage.${fn.name} is executable by nobody else`).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the recorded constants live in SQL and the module mirrors them', () => {
  it('holds the same value in each constant function as in usageConstants', async () => {
    const {rows: found} = await db.query(
      `select usage.overhead_tokens() as overhead, usage.image_tokens() as image, usage.margin_percent() as margin, usage.input_ceiling() as input_ceiling,
              usage.output_ceiling() as output_ceiling, usage.request_ceiling() as request_ceiling, usage.operation_cap()::float8 as operation_cap, usage.job_cap()::float8 as job_cap,
              extract(epoch from usage.ambiguity_deadline())::float8 / 3600 as deadline_hours`,
    );
    expect(found[0]).toEqual({
      overhead: usageConstants.overheadTokens,
      image: usageConstants.imageTokens,
      margin: usageConstants.marginPercent,
      input_ceiling: usageConstants.inputCeiling,
      output_ceiling: usageConstants.outputCeiling,
      request_ceiling: usageConstants.requestCeiling,
      operation_cap: usageConstants.operationCap,
      job_cap: usageConstants.jobCap,
      deadline_hours: usageConstants.ambiguityDeadlineHours,
    });
    // And they are the recorded ones.
    expect(usageConstants).toEqual({
      overheadTokens: 2000, imageTokens: 5000, marginPercent: 10, inputCeiling: 200_000, outputCeiling: 16_000, requestCeiling: 20, operationCap: 1_000_000, jobCap: 5_000_000, ambiguityDeadlineHours: 24,
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the calculator: one SQL implementation, exact integers and rationals, rounded up once per operation', () => {
  it.each([
    [0, 0, 2200],
    [1, 0, 2202],
    [100, 1, 7810],
    [10_000, 0, 13_200],
    [10_000, 1, 18_700],
    [10_000, 2, 24_200],
    [0, 12, 68_200],
    [179_818, 0, 200_000],
    [179_819, 0, 200_001],
  ])('derives the input bound of %s bytes and %s images as %s tokens: ceil((bytes + 2000 + 5000 x images) x 11 / 10)', async (bytes, images, expected) => {
    const {rows: found} = await db.query('select usage.input_bound($1, $2)::text as bound', [bytes, images]);
    expect(found[0].bound).toBe(String(expected));
    expect(BigInt(found[0].bound)).toBe(refBound(bytes, images));
  });

  it('is exact for any size: the bound of an enormous request is an integer, never rounded or overflowed', async () => {
    const {rows: found} = await db.query(`select usage.input_bound(9223372036854775807, 2147483647)::text as bound`);
    expect(BigInt(found[0].bound)).toBe(ceilDiv((BigInt('9223372036854775807') + BigInt(2000) + BigInt(5000) * BigInt(2147483647)) * BigInt(11), BigInt(10)));
  });

  it('quotes the standard request as 24,200 input tokens and 312,600 microdollars (24,200 x 3 + 16,000 x 15), and a request with no image and no text as the overhead alone', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      expect(await quote(client, a, {schedule: std})).toEqual({outcome: 'quoted', reason: null, detail: null, input_bound: 24_200, input_units: 24_200, output_units: 16_000, microdollars: 312_600});
      // 2,200 x 3 + 0 x 15 = 6,600.
      expect(await quote(client, a, {schedule: std, bytes: 0, images: 0, output: 0})).toMatchObject({outcome: 'quoted', input_bound: 2200, microdollars: 6600});
    });
  });

  it('admits a bound equal to the 200,000-token ceiling and refuses one above it; each image counts 5,000 before the margin', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      expect(await quote(client, a, {schedule: std, bytes: 179_818, images: 0})).toMatchObject({outcome: 'quoted', input_bound: 200_000, microdollars: 600_000 + 240_000});
      expect(await quote(client, a, {schedule: std, bytes: 179_819, images: 0})).toMatchObject({outcome: 'unavailable_bound', reason: 'over_input_ceiling', input_bound: null, microdollars: null});
      // (2000 + 5000 x 35) x 1.1 = 194,700 passes; 36 images make 200,200.
      expect(await quote(client, a, {schedule: std, bytes: 0, images: 35})).toMatchObject({outcome: 'quoted', input_bound: 194_700});
      expect(await quote(client, a, {schedule: std, bytes: 0, images: 36})).toMatchObject({outcome: 'unavailable_bound', reason: 'over_input_ceiling'});
    });
  });

  it('rounds up ONCE per operation: a rational price is summed exactly and the sum is rounded, never each term', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      // 3/7 of a microdollar for each input token billed in 1,000s, 1/3 for each output token billed in 100s, 1/6 for each request.
      const rational = await schedule(client, {inN: 3, inD: 7, outN: 1, outD: 3, reqN: 1, reqD: 6, incIn: 1000, incOut: 100});
      // 24,200 input tokens bill as 25,000: 25,000 x 3/7 = 10,714.2857...; 100 output tokens: 33.3333...; their sum 10,747.619... rounds up to 10,748 (each term on its own would be 10,715 + 34 = 10,749).
      expect(await quote(client, a, {schedule: rational, output: 100})).toMatchObject({outcome: 'quoted', input_bound: 24_200, input_units: 25_000, output_units: 100, microdollars: 10_748});
      // Three requests add 3 x 1/6 = 0.5: 10,748.119... rounds up to 10,749.
      expect(await quote(client, a, {schedule: rational, output: 100, count: 3})).toMatchObject({outcome: 'quoted', microdollars: 10_749});
      // A multiplier of 3/2 (a geography multiplier) multiplies the exact sum: (10,714.2857 + 33.3333) x 1.5 = 16,121.43, rounded up to 16,122.
      const multiplied = await schedule(client, {inN: 3, inD: 7, outN: 1, outD: 3, incIn: 1000, incOut: 100, multN: 3, multD: 2});
      expect(await quote(client, a, {schedule: multiplied, output: 100})).toMatchObject({outcome: 'quoted', microdollars: 16_122});
    });
  });

  it('bills tokens rounded up to each increment, separately for input and output', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const incremental = await schedule(client, {inN: 1, outN: 1, incIn: 1000, incOut: 4096});
      // 24,200 bills as 25,000; 100 as 4,096; 1 microdollar each.
      expect(await quote(client, a, {schedule: incremental, output: 100})).toMatchObject({input_units: 25_000, output_units: 4096, microdollars: 29_096});
      // An exact multiple is not rounded further: 13,200 tokens (10,000 bytes, no image) are not 14,000.
      expect(await quote(client, a, {schedule: incremental, bytes: 10_000, images: 0, output: 4096})).toMatchObject({input_bound: 13_200, input_units: 14_000});
      expect(await quote(client, a, {schedule: incremental, bytes: 10_000, images: 0, output: 4096})).toMatchObject({output_units: 4096});
    });
  });

  it('agrees with an independent BigInt calculation across rational rates, increments, multipliers and sizes', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      let seed = 12345;
      const next = (limit: number) => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return seed % limit;
      };
      const increments = [1, 7, 100, 1000, 65_536];
      for (let sample = 0; sample < 40; sample += 1) {
        const multD = next(100) + 1;
        const rates: RefRates = {
          inN: next(1_000_000) + 1, inD: next(1000) + 1, outN: next(1_000_000), outD: next(1000) + 1, reqN: next(1_000_000), reqD: next(1000) + 1,
          incIn: increments[next(increments.length)], incOut: increments[next(increments.length)], multN: multD + next(multD + 1), multD,
        };
        const sched = await schedule(client, rates);
        const bytes = next(150_000);
        const images = next(6);
        const output = next(16_001);
        const count = next(20) + 1;
        const bound = refBound(bytes, images);
        const expected = refPrice(rates, bound, big(output), count);
        const answer = await quote(client, a, {schedule: sched, bytes, images, output, count});
        expect(answer, JSON.stringify({rates, bytes, images, output, count})).toMatchObject({outcome: 'quoted', input_bound: Number(bound), microdollars: Number(expected)});
      }
    });
  });

  it('admits a price of exactly 1e15 microdollars and refuses one above it as `overflow`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      // 1e12 microdollars for each output token and nothing for input: 1,000 output tokens are exactly 1e15.
      const huge = await schedule(client, {inN: 0, outN: 1_000_000_000_000});
      expect(await quote(client, a, {schedule: huge, output: 1000})).toMatchObject({outcome: 'quoted', microdollars: 1e15});
      expect(await quote(client, a, {schedule: huge, output: 1001})).toMatchObject({outcome: 'unavailable_bound', reason: 'overflow', microdollars: null});
      // The largest rate and the largest bound together overflow too.
      const dear = await schedule(client, {inN: 1_000_000_000_000, outN: 1_000_000_000_000, multN: 1_000_000_000_000, multD: 1});
      expect(await quote(client, a, {schedule: dear, bytes: 179_818, images: 0, output: 16_000})).toMatchObject({outcome: 'unavailable_bound', reason: 'overflow'});
    });
  });

  it('refuses a request that prices nothing as `unpriced`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const free = await schedule(client, {inN: 0, outN: 0, reqN: 0});
      expect(await quote(client, a, {schedule: free})).toMatchObject({outcome: 'unavailable_bound', reason: 'unpriced'});
      // One output token on a schedule that charges for output only is priced; none is not.
      const outputOnly = await schedule(client, {inN: 0, outN: 1});
      expect(await quote(client, a, {schedule: outputOnly, output: 1})).toMatchObject({outcome: 'quoted', microdollars: 1});
      expect(await quote(client, a, {schedule: outputOnly, output: 0})).toMatchObject({outcome: 'unavailable_bound', reason: 'unpriced'});
    });
  });

  it('refuses an unknown schedule, and a schedule whose provider, model or API version differ from those given, as `unknown_rate` and `foreign_rate`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      expect(await quote(client, a, {schedule: {...std, id: randomUUID()}})).toMatchObject({outcome: 'unavailable_bound', reason: 'unknown_rate'});
      for (const wrong of [{provider: 'another'}, {model: 'another-model'}, {apiVersion: '2024-01-01'}]) {
        expect(await quote(client, a, {schedule: std, ...wrong}), JSON.stringify(wrong)).toMatchObject({outcome: 'unavailable_bound', reason: 'foreign_rate', detail: null});
      }
    });
  });

  it('refuses a schedule in another currency as `foreign_currency`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const currency of ['EUR', 'GBP', 'USX']) {
        const foreign = await schedule(client, {currency});
        expect(await quote(client, a, {schedule: foreign}), currency).toMatchObject({outcome: 'unavailable_bound', reason: 'foreign_currency'});
      }
    });
  });

  it.each(['cache', 'batch', 'server_tools', 'fallbacks', 'speed', 'streaming', 'anything_else'])('refuses the option %s as unsupported, naming it, whatever its value', async (key) => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      for (const value of [true, false, null, 0, 'x', {nested: true}]) {
        expect(await quote(client, a, {schedule: std, options: {[key]: value}}), `${key}=${JSON.stringify(value)}`).toMatchObject({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: key});
      }
    });
  });

  it('names the first option key in byte order when there are several, and an empty key as an empty name', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      expect(await quote(client, a, {schedule: std, options: {speed: 'fast', batch: true, cache: true}})).toMatchObject({reason: 'unsupported_option', detail: 'batch'});
      expect(await quote(client, a, {schedule: std, options: {'': 1}})).toMatchObject({reason: 'unsupported_option', detail: ''});
      // An empty object is no option at all.
      expect(await quote(client, a, {schedule: std, options: {}})).toMatchObject({outcome: 'quoted'});
    });
  });

  it('refuses an output limit above 16,000 and a request count above 20, and admits the ceilings themselves', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      expect(await quote(client, a, {schedule: std, output: 16_000})).toMatchObject({outcome: 'quoted'});
      expect(await quote(client, a, {schedule: std, output: 16_001})).toMatchObject({outcome: 'unavailable_bound', reason: 'over_output_ceiling'});
      expect(await quote(client, a, {schedule: std, count: 20})).toMatchObject({outcome: 'quoted'});
      expect(await quote(client, a, {schedule: std, count: 21})).toMatchObject({outcome: 'unavailable_bound', reason: 'over_request_ceiling'});
    });
  });

  it('judges the reasons in the order the story names: rate, currency, option, input ceiling, output ceiling, request ceiling, overflow', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const euro = await schedule(client, {currency: 'EUR'});
      const everything = {bytes: 1_000_000, images: 0, output: 99_999, count: 99, options: {cache: true}};
      expect(await quote(client, a, {schedule: {...std, id: randomUUID()}, provider: 'another', ...everything})).toMatchObject({reason: 'unknown_rate'});
      expect(await quote(client, a, {schedule: euro, provider: 'another', ...everything})).toMatchObject({reason: 'foreign_rate'});
      expect(await quote(client, a, {schedule: euro, ...everything})).toMatchObject({reason: 'foreign_currency'});
      expect(await quote(client, a, {schedule: std, ...everything})).toMatchObject({reason: 'unsupported_option', detail: 'cache'});
      expect(await quote(client, a, {schedule: std, ...everything, options: {}})).toMatchObject({reason: 'over_input_ceiling'});
      expect(await quote(client, a, {schedule: std, ...everything, options: {}, bytes: 100})).toMatchObject({reason: 'over_output_ceiling'});
      expect(await quote(client, a, {schedule: std, ...everything, options: {}, bytes: 100, output: 100})).toMatchObject({reason: 'over_request_ceiling'});
      const huge = await schedule(client, {inN: 0, outN: 1_000_000_000_000});
      expect(await quote(client, a, {schedule: huge, output: 1001, bytes: 100})).toMatchObject({reason: 'overflow'});
    });
  });

  it('is read-only and takes no lock of its own: it writes nothing, and answers while another session holds the Account\'s usage lock and the command lock', async () => {
    const a = await committedAccount();
    const std = await schedule(db);
    const before = [await ledgerOf(db, a.accountId), await count(db, 'select count(*) as n from usage.periods where account_id = $1', [a.accountId])];
    const holder = await connect();
    await holder.query('begin');
    await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d:usage:' || $1::text, 0))`, [a.accountId]);
    await holder.query(`select pg_advisory_xact_lock(hashtextextended('nova3d:usage-command:' || $1::text || ':' || $2::text, 0))`, [a.accountId, '00000000-0000-0000-0000-000000000000']);
    const answered = await Promise.race([
      quoteNow(db, a, {schedule: std}).then(() => true, () => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    await holder.query('rollback');
    expect(answered).toBe(true);
    expect([await ledgerOf(db, a.accountId), await count(db, 'select count(*) as n from usage.periods where account_id = $1', [a.accountId])]).toEqual(before);
  });

  it('answers `denied` to a stale epoch, a disabled Account and a tombstoned Account, and raises 22023 for a shape the application would never send', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      expect(await quote(client, a, {schedule: std, epoch: 2})).toMatchObject({outcome: 'denied', reason: null, microdollars: null});
      expect(await quote(client, {accountId: randomUUID(), epoch: 1}, {schedule: std})).toMatchObject({outcome: 'denied'});
      const bad: [string, Partial<QuoteRequest> & {epoch?: number}][] = [
        ['a negative size', {bytes: -1}],
        ['a negative image count', {images: -1}],
        ['a negative output limit', {output: -1}],
        ['no requests', {count: 0}],
        ['an epoch of 0', {epoch: 0}],
        ['a provider that is not a word', {provider: 'Not A Word'}],
        ['an empty model', {model: ''}],
        ['an API version with a space', {apiVersion: '2023 06'}],
        ['options that are an array', {options: []}],
        ['options that are null', {options: null}],
        ['options that are text', {options: 'cache'}],
      ];
      for (const [label, change] of bad) {
        const args = quoteArgs(a, {schedule: std, ...change});
        if (change.options === null) args[10] = 'null';
        const result = await attempt(client, 'service_role', QUOTE, args);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      // A null where an argument is required.
      const nulls = await attempt(client, 'service_role', QUOTE, [null, 1, std.id, std.provider, std.model, std.apiVersion, 1, 1, 1, 1, '{}']);
      expect(nulls.ok).toBe(false);
      const disabled = await account(client);
      await rows(client, 'service_role', `select * from api.disable_account('seed:local:usage', $1)`, [disabled.accountId]);
      expect(await quote(client, disabled, {schedule: std})).toMatchObject({outcome: 'denied'});
      const gone = await account(client);
      await rows(client, 'service_role', `select * from api.record_tombstone('account', $1)`, [gone.accountId]);
      expect(await quote(client, gone, {schedule: std})).toMatchObject({outcome: 'denied'});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('reserving: one reservation for one operation, judged in order, and nothing written by a refusal', () => {
  it('reserves the standard request: a reservation with its pins, inputs, period and amount, the period reserved up and available down, and a receipt', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const job = await jobWith(client, a);
      const before = await figuresOf(client, a.accountId);
      expect(before).toMatchObject({limit: 25 * M, settled: 0, reserved: 0, available: 25 * M});
      const command = randomUUID();
      const answer = await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command});
      expect(answer).toMatchObject({
        outcome: 'reserved', operation_id: job.operationIds[0], job_id: job.jobId, rate_schedule_id: std.id, input_bound: 24_200, reserved: 312_600,
        state: null, reason: null, detail: null, requested: null, limit: null, used: null, available: null,
      });
      const row = await reservationRow(client, answer.reservation_id);
      expect(row).toMatchObject({
        account_id: a.accountId, job_id: job.jobId, operation_id: job.operationIds[0], rate_schedule_id: std.id, provider: std.provider, requested_model: std.model, api_version: std.apiVersion,
        request_bytes: 10_000, image_count: 2, output_limit: 16_000, input_bound: 24_200, reserved: 312_600,
      });
      expect(row.digest).toMatch(/^[0-9a-f]{64}$/);
      const period = (await client.query('select id from usage.periods where account_id = $1 order by seq desc limit 1', [a.accountId])).rows[0].id;
      expect(row.period_id).toBe(period);
      expect(answer.period_id).toBe(period);
      const after = await figuresOf(client, a.accountId);
      expect(after).toMatchObject({settled: 0, reserved: 312_600, available: 25 * M - 312_600});
      expect(reconciles(after)).toBe(true);
      expect(await availableOf(client, a.accountId)).toBe(25 * M - 312_600);
      expect(await exposureOf(client, job.jobId)).toBe(312_600);
      expect((await client.query('select kind, digest, subject_id from usage.commands where account_id = $1 and command_id = $2', [a.accountId, command])).rows).toEqual([
        {kind: 'reserve', digest: row.digest, subject_id: answer.reservation_id},
      ]);
    });
  });

  it('answers the original reservation to the same command sent again, and writes nothing more', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const job = await jobWith(client, a);
      const command = randomUUID();
      const first = await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command});
      const ledger = await ledgerOf(client, a.accountId);
      const again = await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command});
      expect(again).toMatchObject({outcome: 'replayed', reservation_id: first.reservation_id, reserved: 312_600, input_bound: 24_200, period_id: first.period_id});
      expect(await ledgerOf(client, a.accountId)).toEqual(ledger);
      expect((await figuresOf(client, a.accountId)).reserved).toBe(312_600);
    });
  });

  it('refuses the same command ID with another payload as `reused`, writing nothing, whatever part of the payload changed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const other = await schedule(client);
      const job = await jobWith(client, a, 2);
      const command = randomUUID();
      await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command});
      const ledger = await ledgerOf(client, a.accountId);
      for (const change of [
        {bytes: 10_001}, {images: 1}, {output: 15_999}, {operationId: job.operationIds[1]}, {schedule: other}, {options: {cache: true}},
      ] as Partial<ReserveRequest>[]) {
        const answer = await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command, ...change});
        expect(answer, JSON.stringify(change)).toMatchObject({outcome: 'reused', reservation_id: null, reserved: null});
      }
      expect(await ledgerOf(client, a.accountId)).toEqual(ledger);
    });
  });

  it('answers another command ID with the same payload for the same operation as `replayed` and records it; another payload is `already_reserved` and carries the reservation; nothing is duplicated', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const job = await jobWith(client, a);
      const first = await reserve(client, a, {schedule: std, operationId: job.operationIds[0]});
      const ledger = await ledgerOf(client, a.accountId);
      const second = randomUUID();
      const same = await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command: second});
      expect(same).toMatchObject({outcome: 'replayed', reservation_id: first.reservation_id, reserved: 312_600});
      expect(await ledgerOf(client, a.accountId)).toEqual({...ledger, commands: ledger.commands + 1});
      expect((await client.query('select subject_id from usage.commands where account_id = $1 and command_id = $2', [a.accountId, second])).rows).toEqual([{subject_id: first.reservation_id}]);
      // The recorded command now replays by itself too.
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command: second})).toMatchObject({outcome: 'replayed', reservation_id: first.reservation_id});
      // Another payload for an operation that already holds a reservation is refused, carrying the reservation, writing nothing.
      const different = await reserve(client, a, {schedule: std, operationId: job.operationIds[0], output: 8000});
      expect(different).toMatchObject({outcome: 'already_reserved', reservation_id: first.reservation_id, reserved: 312_600, input_bound: 24_200});
      expect(await ledgerOf(client, a.accountId)).toEqual({...ledger, commands: ledger.commands + 1});
      expect(await count(client, 'select count(*) as n from usage.reservations where operation_id = $1', [job.operationIds[0]])).toBe(1);
      expect((await figuresOf(client, a.accountId)).reserved).toBe(312_600);
    });
  });

  it.each(['dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned'] as const)('refuses an operation that is %s as `not_reservable`, carrying its state and writing nothing; an existing reservation still replays', async (target) => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const fresh = await jobWith(client, a);
      await moveTo(client, fresh.operationIds[0], target);
      const ledger = await ledgerOf(client, a.accountId);
      expect(await reserve(client, a, {schedule: std, operationId: fresh.operationIds[0]})).toMatchObject({outcome: 'not_reservable', state: target, reservation_id: null, reserved: null, requested: null});
      await unchanged(client, a.accountId, ledger);
      // An operation that was reserved while it was planned, and has moved on since, still answers its own command.
      const held = await jobWith(client, a);
      const command = randomUUID();
      const made = await reserve(client, a, {schedule: std, operationId: held.operationIds[0], command});
      await moveTo(client, held.operationIds[0], target);
      expect(await reserve(client, a, {schedule: std, operationId: held.operationIds[0], command})).toMatchObject({outcome: 'replayed', reservation_id: made.reservation_id});
      expect(await reserve(client, a, {schedule: std, operationId: held.operationIds[0]})).toMatchObject({outcome: 'replayed', reservation_id: made.reservation_id});
      expect(await reserve(client, a, {schedule: std, operationId: held.operationIds[0], output: 100})).toMatchObject({outcome: 'already_reserved', reservation_id: made.reservation_id});
    });
  });

  it('admits an operation of exactly $1 and refuses one above it as `over_operation_cap`, with the exact cost block and nothing written', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      const jobs = await jobWith(client, a, 2);
      expect(await reserve(client, a, {schedule: exact, operationId: jobs.operationIds[0], output: 1000})).toMatchObject({outcome: 'reserved', reserved: 1_000_000});
      const ledger = await ledgerOf(client, a.accountId);
      const refused = await reserve(client, a, {schedule: exact, operationId: jobs.operationIds[1], output: 1001});
      expect(refused).toMatchObject({outcome: 'over_operation_cap', requested: 1_001_000, limit: 1_000_000, used: 0, available: 1_000_000, reservation_id: null, reserved: null});
      await unchanged(client, a.accountId, ledger);
    });
  });

  it('refuses what would take a Job past $5 across its operations as `over_job_cap`, and admits exactly $5', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      const job = await jobWith(client, a, 7);
      for (let index = 0; index < 5; index += 1) {
        expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[index], output: 1000}), `operation ${index + 1}`).toMatchObject({outcome: 'reserved'});
      }
      expect(await exposureOf(client, job.jobId)).toBe(5_000_000);
      const ledger = await ledgerOf(client, a.accountId);
      // Not one more microdollar: $1 refused, and so is the smallest priced request.
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[5], output: 1000})).toMatchObject({
        outcome: 'over_job_cap', requested: 1_000_000, limit: 5_000_000, used: 5_000_000, available: 0,
      });
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[5], output: 1})).toMatchObject({outcome: 'over_job_cap', requested: 1000, available: 0});
      await unchanged(client, a.accountId, ledger);
    });
  });

  it('counts an ambiguous charge, a settled amount and an overrun against the Job cap, and what a settlement released no more', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      const job = await jobWith(client, a, 9);
      const [held, partly, none, over, ...rest] = job.operationIds;
      // An ambiguous charge holds its whole reservation.
      expect((await reserve(client, a, {schedule: exact, operationId: held, output: 1000})).outcome).toBe('reserved');
      await moveTo(client, held, 'ambiguous');
      expect(await exposureOf(client, job.jobId)).toBe(1_000_000);
      // A settled reservation counts what it settled: $0.40 of $1.00.
      expect((await reserve(client, a, {schedule: exact, operationId: partly, output: 1000})).outcome).toBe('reserved');
      await moveTo(client, partly, 'completed');
      expect(await settle(client, a.accountId, {operationId: partly, classification: 'evidence', input: 0, output: 400})).toMatchObject({outcome: 'settled', settled: 400_000, released: 1_000_000, over: 0});
      expect(await exposureOf(client, job.jobId)).toBe(1_400_000);
      // A charge that was never made counts nothing.
      expect((await reserve(client, a, {schedule: exact, operationId: none, output: 1000})).outcome).toBe('reserved');
      await moveTo(client, none, 'abandoned');
      expect(await settle(client, a.accountId, {operationId: none, classification: 'unused'})).toMatchObject({outcome: 'settled', settled: 0, released: 1_000_000});
      expect(await exposureOf(client, job.jobId)).toBe(1_400_000);
      // An overrun counts at the evidence: $1.50 settled for a $1.00 reservation.
      expect((await reserve(client, a, {schedule: exact, operationId: over, output: 1000})).outcome).toBe('reserved');
      await moveTo(client, over, 'completed');
      expect(await settle(client, a.accountId, {operationId: over, classification: 'evidence', input: 0, output: 1500})).toMatchObject({outcome: 'settled', settled: 1_500_000, over: 500_000});
      expect(await exposureOf(client, job.jobId)).toBe(2_900_000);
      // The overrun blocks the provider; the owner clears it, as Story 2.8 will, and the Job has $2.10 left: two $1.00 operations fit, then $0.10 exactly, and not a microdollar more.
      await client.query(`update usage.overrun_incidents set cleared_at = clock_timestamp(), cleared_by = 'user:administrator' where account_id = $1`, [a.accountId]);
      expect(await reserve(client, a, {schedule: exact, operationId: rest[0], output: 1000})).toMatchObject({outcome: 'reserved'});
      expect(await reserve(client, a, {schedule: exact, operationId: rest[1], output: 1000})).toMatchObject({outcome: 'reserved'});
      expect(await reserve(client, a, {schedule: exact, operationId: rest[2], output: 101})).toMatchObject({outcome: 'over_job_cap', requested: 101_000, used: 4_900_000, available: 100_000});
      expect(await reserve(client, a, {schedule: exact, operationId: rest[2], output: 100})).toMatchObject({outcome: 'reserved', reserved: 100_000});
      expect(await exposureOf(client, job.jobId)).toBe(5_000_000);
    });
  });

  it('counts the earlier attempts of a Job: a later attempt\'s reservation is judged against everything the Job holds', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      const real = (sql: string, params: unknown[]) => rows(client, 'service_role', sql, params).then((found) => found[0]);
      const projectId = await project(client, a);
      const accepted = await real('select * from api.accept_job($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), projectId, 'research', sha('input')]);
      expect(accepted.outcome).toBe('created');
      expect((await real('select * from api.move_attempt($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'running', null])).outcome).toBe('moved');
      // Attempt 1 reserves $4 over four operations, completes them, and fails; the charges are reconciled, not settled.
      const operationsOf1: string[] = [];
      for (let ordinal = 1; ordinal <= 4; ordinal += 1) {
        const begun = await real('select * from api.begin_step($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'search', ordinal]);
        expect(begun.outcome).toBe('created');
        operationsOf1.push(begun.operation_id);
        expect((await reserve(client, a, {schedule: exact, operationId: begun.operation_id, output: 1000})).outcome).toBe('reserved');
        for (const to of ['dispatched', 'completed']) {
          expect((await real('select * from api.advance_operation($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), begun.operation_id, to, null])).outcome).toBe('advanced');
        }
      }
      expect((await real('select * from api.move_attempt($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'failed', 'step_failed'])).outcome).toBe('moved');
      const retry = await real('select * from api.request_retry($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.job_id, 1, sha('retry')]);
      expect(retry).toMatchObject({outcome: 'created', attempt_number: 2});
      expect((await real('select * from api.move_attempt($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), retry.attempt_id, 'running', null])).outcome).toBe('moved');
      // Attempt 2: $1 fits ($5 in all), and then the next is over the cap although this attempt holds only $1 itself.
      const first = await real('select * from api.begin_step($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), retry.attempt_id, 'search', 1]);
      expect(await reserve(client, a, {schedule: exact, operationId: first.operation_id, output: 1000})).toMatchObject({outcome: 'reserved'});
      const second = await real('select * from api.begin_step($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), retry.attempt_id, 'search', 2]);
      expect(await reserve(client, a, {schedule: exact, operationId: second.operation_id, output: 1})).toMatchObject({outcome: 'over_job_cap', requested: 1000, limit: 5_000_000, used: 5_000_000, available: 0});
      expect(await exposureOf(client, accepted.job_id)).toBe(5_000_000);
    });
  });

  it('admits a request exactly equal to what is available and refuses one microdollar more as `insufficient_allowance`, with the exact cost block', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      await allowance(client, a.accountId, M);
      const job = await jobWith(client, a, 3);
      const other = await jobWith(client, a, 1);
      // $0.50 reserved, $0.50 left: exactly equal passes.
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[0], output: 500})).toMatchObject({outcome: 'reserved', reserved: 500_000});
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[1], output: 501})).toMatchObject({
        outcome: 'insufficient_allowance', requested: 501_000, limit: M, used: 500_000, available: 500_000,
      });
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[1], output: 500})).toMatchObject({outcome: 'reserved', reserved: 500_000});
      // Now nothing is left, and the reservations that run are untouched.
      const ledger = await ledgerOf(client, a.accountId);
      expect(await reserve(client, a, {schedule: exact, operationId: other.operationIds[0], output: 1})).toMatchObject({outcome: 'insufficient_allowance', requested: 1000, limit: M, used: M, available: 0});
      await unchanged(client, a.accountId, ledger);
      const figures = await figuresOf(client, a.accountId);
      expect(figures).toMatchObject({settled: 0, reserved: M, available: 0});
      expect(reconciles(figures)).toBe(true);
    });
  });

  it('refuses everything while the limit is 0, and while the Account is over its limit, saying so in the cost block', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      await allowance(client, a.accountId, 0);
      const job = await jobWith(client, a, 2);
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[0], output: 1})).toMatchObject({outcome: 'insufficient_allowance', requested: 1000, limit: 0, used: 0, available: 0});
      // Over the limit: a ledger row the owner made for $0.30 against a limit of $0.20.
      await allowance(client, a.accountId, 200_000);
      const [period] = (await client.query('select id from usage.periods where account_id = $1', [a.accountId])).rows;
      await setFigures(client, period.id, 0, 300_000);
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[1], output: 1})).toMatchObject({outcome: 'insufficient_allowance', limit: 200_000, used: 300_000, available: 0});
    });
  });

  it('blocks a provider for every Account while it has an uncleared overrun incident, and admits again when it is cleared; another provider is unaffected', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const std = await schedule(client);
      const elsewhere = await schedule(client, {provider: `${provider}-other`});
      const held = await reserved(client, a, std);
      await moveTo(client, held.operationId, 'completed');
      // Evidence of 30,000 input tokens and 16,000 output tokens is 330,000 microdollars, above the 312,600 reserved.
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', input: 30_000, output: 16_000})).toMatchObject({outcome: 'settled', settled: 330_000, over: 17_400});
      const incident = (await client.query('select id, provider, reserved_microdollars::float8 as reserved, evidence_microdollars::float8 as evidence, cleared_at from usage.overrun_incidents where account_id = $1', [a.accountId])).rows[0];
      expect(incident).toMatchObject({provider: std.provider, reserved: 312_600, evidence: 330_000, cleared_at: null});
      // Both Accounts are refused for that provider, with the cost block (the Account's allowance) and nothing written; the other provider is not.
      const jobA = await jobWith(client, a);
      const jobB = await jobWith(client, b);
      const ledgerB = await ledgerOf(client, b.accountId);
      expect(await reserve(client, a, {schedule: std, operationId: jobA.operationIds[0]})).toMatchObject({outcome: 'provider_blocked', requested: 312_600, limit: 25 * M, used: 330_000, available: 25 * M - 330_000});
      expect(await reserve(client, b, {schedule: std, operationId: jobB.operationIds[0]})).toMatchObject({outcome: 'provider_blocked', requested: 312_600, limit: 25 * M, used: 0, available: 25 * M});
      await unchanged(client, b.accountId, ledgerB);
      expect(await reserve(client, b, {schedule: elsewhere, operationId: jobB.operationIds[0]})).toMatchObject({outcome: 'reserved'});
      // Cleared (as the owner here, as the fresh-authenticated Administrator in Story 2.8): admitted again.
      await client.query(`update usage.overrun_incidents set cleared_at = clock_timestamp(), cleared_by = 'user:administrator' where id = $1`, [incident.id]);
      expect(await reserve(client, a, {schedule: std, operationId: jobA.operationIds[0]})).toMatchObject({outcome: 'reserved'});
    });
  });

  it('judges refusals in order: the bound, then the provider, then the operation cap, then the Job cap, then the allowance', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      await allowance(client, a.accountId, 6 * M);
      const job = await jobWith(client, a, 4);
      const ops = job.operationIds;
      // A provider block: the evidence of an earlier operation was $0.001 above its reservation.
      const blocker = await reserved(client, a, exact, {output: 1000});
      await moveTo(client, blocker.operationId, 'completed');
      expect(await settle(client, a.accountId, {operationId: blocker.operationId, classification: 'evidence', input: 0, output: 1001})).toMatchObject({outcome: 'settled', over: 1000});
      // No bound (an option) beats the blocked provider, which beats everything else.
      expect(await reserve(client, a, {schedule: exact, operationId: ops[0], output: 1000, options: {cache: true}})).toMatchObject({outcome: 'unavailable_bound', reason: 'unsupported_option', requested: null});
      expect(await reserve(client, a, {schedule: exact, operationId: ops[0], output: 5100})).toMatchObject({outcome: 'provider_blocked', requested: 5_100_000});
      await client.query(`update usage.overrun_incidents set cleared_at = clock_timestamp(), cleared_by = 'user:administrator' where account_id = $1`, [a.accountId]);
      // Over the operation cap, the Job cap and the allowance at once: the operation cap.
      expect(await reserve(client, a, {schedule: exact, operationId: ops[0], output: 5100})).toMatchObject({outcome: 'over_operation_cap', requested: 5_100_000, limit: M, used: 0, available: M});
      // The Job holds $4.50 (the owner makes that reservation: admission would have judged it), the Account has used $5.501 of $6 and has $0.499 left. $0.60 is over the
      // Job cap and over the allowance: the Job cap.
      const periodId = (await client.query('select id from usage.periods where account_id = $1', [a.accountId])).rows[0].id as string;
      await insertReservation(client, {accountId: a.accountId, periodId, jobId: job.jobId, operationId: ops[3], amount: 4_500_000, scheduleId: exact.id});
      expect(await reserve(client, a, {schedule: exact, operationId: ops[0], output: 600})).toMatchObject({outcome: 'over_job_cap', requested: 600_000, limit: 5_000_000, used: 4_500_000, available: 500_000});
      // $0.50 fits the Job and not the allowance: the allowance, last.
      expect(await reserve(client, a, {schedule: exact, operationId: ops[0], output: 500})).toMatchObject({outcome: 'insufficient_allowance', requested: 500_000, limit: 6 * M, used: 5_501_000, available: 499_000});
      expect(await reserve(client, a, {schedule: exact, operationId: ops[0], output: 499})).toMatchObject({outcome: 'reserved', reserved: 499_000});
    });
  });

  it('answers `unavailable_bound` with the reason, and no requested amount, for an unknown schedule, a foreign rate and an unsupported option, writing nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const job = await jobWith(client, a);
      const ledger = await ledgerOf(client, a.accountId);
      expect(await reserve(client, a, {schedule: {...std, id: randomUUID()}, operationId: job.operationIds[0]})).toMatchObject({
        outcome: 'unavailable_bound', reason: 'unknown_rate', detail: null, requested: null, limit: 25 * M, used: 0, available: 25 * M, reservation_id: null,
      });
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0], model: 'another-model'})).toMatchObject({outcome: 'unavailable_bound', reason: 'foreign_rate'});
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0], options: {streaming: true}})).toMatchObject({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: 'streaming'});
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0], bytes: 200_000})).toMatchObject({outcome: 'unavailable_bound', reason: 'over_input_ceiling'});
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0], output: 16_001})).toMatchObject({outcome: 'unavailable_bound', reason: 'over_output_ceiling'});
      const euro = await schedule(client, {currency: 'EUR'});
      expect(await reserve(client, a, {schedule: euro, operationId: job.operationIds[0]})).toMatchObject({outcome: 'unavailable_bound', reason: 'foreign_currency'});
      const free = await schedule(client, {inN: 0, outN: 0});
      expect(await reserve(client, a, {schedule: free, operationId: job.operationIds[0]})).toMatchObject({outcome: 'unavailable_bound', reason: 'unpriced'});
      const huge = await schedule(client, {inN: 0, outN: 1_000_000_000_000});
      expect(await reserve(client, a, {schedule: huge, operationId: job.operationIds[0], output: 1001})).toMatchObject({outcome: 'unavailable_bound', reason: 'overflow'});
      await unchanged(client, a.accountId, ledger);
    });
  });

  it('turns the month when work is first asked for: a reservation lands in the new period, which carries what was reserved before', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const [last] = await periodsAgo(client, a.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M}]);
      const earlier = await jobWith(client, a);
      await insertReservation(client, {accountId: a.accountId, periodId: last, jobId: earlier.jobId, operationId: earlier.operationIds[0], amount: 2 * M});
      const job = await jobWith(client, a);
      const made = await reserve(client, a, {schedule: std, operationId: job.operationIds[0]});
      expect(made.outcome).toBe('reserved');
      const periods = (await client.query('select seq, cause, carried_settled_microdollars::float8 as carried_settled, carried_reserved_microdollars::float8 as carried_reserved from usage.periods where account_id = $1 order by seq', [a.accountId])).rows;
      expect(periods).toEqual([
        {seq: 1, cause: 'initial', carried_settled: 0, carried_reserved: 0},
        {seq: 2, cause: 'month', carried_settled: 0, carried_reserved: 2 * M},
      ]);
      expect(made.period_id).toBe((await client.query('select id from usage.periods where account_id = $1 and seq = 2', [a.accountId])).rows[0].id);
      const figures = await figuresOf(client, a.accountId);
      expect(figures).toMatchObject({seq: 2, settled: 0, reserved: 2 * M + 312_600, available: 25 * M - 2 * M - 312_600});
      expect(reconciles(figures)).toBe(true);
    });
  });

  it('does not reserve for a refused request even by a failed command: a refusal rolls back nothing but leaves no reservation and no receipt', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      const job = await jobWith(client, a);
      const command = randomUUID();
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[0], output: 5000, command})).toMatchObject({outcome: 'over_operation_cap'});
      expect(await count(client, 'select count(*) as n from usage.commands where account_id = $1 and command_id = $2', [a.accountId, command])).toBe(0);
      // The same command ID, with a payload that fits, is a new command: it is not `reused` by the refusal.
      expect(await reserve(client, a, {schedule: exact, operationId: job.operationIds[0], output: 500, command})).toMatchObject({outcome: 'reserved'});
    });
  });

  it('answers `denied` for a stale epoch, a disabled Account and a tombstoned Account, writing nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const job = await jobWith(client, a, 3);
      const ledger = await ledgerOf(client, a.accountId);
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0], epoch: 5})).toMatchObject({outcome: 'denied', reservation_id: null, requested: null});
      await rows(client, 'service_role', `select * from api.disable_account('seed:local:usage', $1)`, [a.accountId]);
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0]})).toMatchObject({outcome: 'denied'});
      await rows(client, 'service_role', `select * from api.enable_account('seed:local:usage', $1)`, [a.accountId]);
      // Enabling again gives a newer epoch: the old operation stays refused.
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0]})).toMatchObject({outcome: 'denied'});
      await unchanged(client, a.accountId, ledger);
      const gone = await account(client);
      const goneJob = await jobWith(client, gone);
      await rows(client, 'service_role', `select * from api.record_tombstone('account', $1)`, [gone.accountId]);
      expect(await reserve(client, gone, {schedule: std, operationId: goneJob.operationIds[0]})).toMatchObject({outcome: 'denied'});
      expect(await count(client, 'select count(*) as n from usage.reservations where account_id = $1', [gone.accountId])).toBe(0);
    });
  });

  it('answers the same `unavailable`, with nothing in it, for a foreign, an unknown, a deleted and a tombstoned Project\'s operation, writing nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const std = await schedule(client);
      const theirs = await jobWith(client, b);
      const deleted = await jobWith(client, a);
      await client.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = (select project_id from jobs.jobs where id = $1)', [deleted.jobId]);
      // A second Project of the Account, tombstoned.
      const tombstonedProject = await project(client, a);
      const tombstoned = await ledgerJob(client, a.accountId, 1, tombstonedProject);
      await rows(client, 'service_role', `select * from api.record_tombstone('project', $1)`, [tombstonedProject]);
      const before = [await ledgerOf(client, a.accountId), await ledgerOf(client, b.accountId)];
      for (const [label, operationId] of [['foreign', theirs.operationIds[0]], ['unknown', randomUUID()], ['deleted', deleted.operationIds[0]], ['tombstoned', tombstoned.operationIds[0]]] as const) {
        const answer = await reserve(client, a, {schedule: std, operationId});
        expect(answer, label).toMatchObject({outcome: 'unavailable'});
        for (const [field, value] of Object.entries(answer)) if (field !== 'outcome') expect(value, `${label} ${field}`).toBeNull();
      }
      expect([await ledgerOf(client, a.accountId), await ledgerOf(client, b.accountId)]).toEqual(before);
    });
  });

  it('answers `unavailable`, not the original receipt, to a replay once the Project is tombstoned: a receipt does not outlive its Project\'s visibility', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const job = await jobWith(client, a);
      const command = randomUUID();
      expect((await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command})).outcome).toBe('reserved');
      const projectId = (await client.query('select project_id from jobs.jobs where id = $1', [job.jobId])).rows[0].project_id as string;
      await rows(client, 'service_role', `select * from api.record_tombstone('project', $1)`, [projectId]);
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command})).toMatchObject({outcome: 'unavailable', reservation_id: null});
    });
  });

  it('raises 22023 for a shape the application would never send, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const job = await jobWith(client, a);
      const ledger = await ledgerOf(client, a.accountId);
      const base = (): unknown[] => reserveArgs(a, {schedule: std, operationId: job.operationIds[0]});
      const change = (index: number, value: unknown) => {
        const args = base();
        args[index] = value;
        return args;
      };
      const bad: [string, unknown[]][] = [
        ['an epoch of 0', change(1, 0)],
        ['no command ID', change(2, null)],
        ['no operation', change(3, null)],
        ['no schedule', change(4, null)],
        ['a provider that is not a word', change(5, 'Not A Word')],
        ['a model that is not a word', change(6, '')],
        ['an API version with a space', change(7, '2023 06')],
        ['a negative size', change(8, -1)],
        ['a negative image count', change(9, -1)],
        ['a negative output limit', change(10, -1)],
        ['options that are an array', change(11, '[]')],
        ['options that are null', change(11, 'null')],
        ['options that are text', change(11, '"cache"')],
        ['no options', change(11, null)],
      ];
      for (const [label, args] of bad) {
        const result = await attempt(client, 'service_role', RESERVE, args);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      await unchanged(client, a.accountId, ledger);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('settling: evidence, deadline, noncharge and unused each release the whole reservation and settle what happened', () => {
  it('settles evidence below the reservation at its price and releases the rest: the standard request, 1,000 input and 500 output tokens', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      expect(held.amount).toBe(312_600);
      await moveTo(client, held.operationId, 'completed');
      const command = randomUUID();
      const answer = await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', command, input: 1000, output: 500, model: 'claude-test-20260101'});
      // 1,000 x 3 + 500 x 15 = 10,500.
      expect(answer).toMatchObject({
        outcome: 'settled', reservation_id: held.reservationId, operation_id: held.operationId, classification: 'evidence', settled: 10_500, released: 312_600, over: 0, incident_id: null,
        state: null, due_at: null, reason: null,
      });
      expect(await settlementRow(client, answer.settlement_id)).toMatchObject({
        account_id: a.accountId, reservation_id: held.reservationId, classification: 'evidence', settled: 10_500, released: 312_600, input_tokens: 1000, output_tokens: 500, returned_model: 'claude-test-20260101',
      });
      const period = (await client.query('select id from usage.periods where account_id = $1 order by seq desc limit 1', [a.accountId])).rows[0].id;
      expect(answer.period_id).toBe(period);
      const figures = await figuresOf(client, a.accountId);
      expect(figures).toMatchObject({settled: 10_500, reserved: 0, available: 25 * M - 10_500});
      expect(reconciles(figures)).toBe(true);
      expect(await exposureOf(client, held.jobId)).toBe(10_500);
      expect(await count(client, 'select count(*) as n from usage.overrun_incidents where account_id = $1', [a.accountId])).toBe(0);
    });
  });

  it('prices the evidence by the calculator at the pinned schedule: billing increments apply, and the schedule the reservation pinned is the one used', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const incremental = await schedule(client, {inN: 3, inD: 7, outN: 1, outD: 3, incIn: 1000, incOut: 100});
      const held = await reserved(client, a, incremental, {output: 100});
      await moveTo(client, held.operationId, 'completed');
      // 1 input token bills as 1,000 (3/7 x 1,000 = 428.57) and 1 output token as 100 (33.33): 461.9 rounds up to 462.
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', input: 1, output: 1})).toMatchObject({outcome: 'settled', settled: 462});
      expect(BigInt(462)).toBe(refPrice({inN: 3, inD: 7, outN: 1, outD: 3, reqN: 0, reqD: 1, incIn: 1000, incOut: 100, multN: 1, multD: 1}, BigInt(1), BigInt(1), 1));
    });
  });

  it('settles evidence equal to the reservation at the reservation, with no incident', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      await moveTo(client, held.operationId, 'completed');
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', input: 24_200, output: 16_000})).toMatchObject({outcome: 'settled', settled: 312_600, released: 312_600, over: 0, incident_id: null});
      expect(await count(client, 'select count(*) as n from usage.overrun_incidents where account_id = $1', [a.accountId])).toBe(0);
    });
  });

  it('settles evidence above the reservation AT the evidence, records one incident, counts it against the period and the Job cap, and blocks the provider', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      await moveTo(client, held.operationId, 'ambiguous');
      const answer = await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', input: 30_000, output: 16_000});
      expect(answer).toMatchObject({outcome: 'settled', settled: 330_000, released: 312_600, over: 17_400});
      expect(answer.incident_id).toMatch(/^[0-9a-f-]{36}$/);
      const incident = (
        await client.query(
          `select id, account_id, reservation_id, settlement_id, provider, reserved_microdollars::float8 as reserved, evidence_microdollars::float8 as evidence, cleared_at, cleared_by from usage.overrun_incidents where id = $1`,
          [answer.incident_id],
        )
      ).rows[0];
      expect(incident).toEqual({
        id: answer.incident_id, account_id: a.accountId, reservation_id: held.reservationId, settlement_id: answer.settlement_id, provider: std.provider, reserved: 312_600, evidence: 330_000,
        cleared_at: null, cleared_by: null,
      });
      // The period counts the evidence, not the reservation; so does the Job.
      const figures = await figuresOf(client, a.accountId);
      expect(figures).toMatchObject({settled: 330_000, reserved: 0, available: 25 * M - 330_000});
      expect(await exposureOf(client, held.jobId)).toBe(330_000);
      // And the provider is blocked for the next reservation.
      const job = await jobWith(client, a);
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0]})).toMatchObject({outcome: 'provider_blocked'});
    });
  });

  it('lets the evidence push an Account past its limit: the period shows the amount over, and the amounts still reconcile', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      await allowance(client, a.accountId, M);
      const held = await reserved(client, a, exact, {output: 1000});
      await moveTo(client, held.operationId, 'completed');
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', input: 0, output: 1300})).toMatchObject({outcome: 'settled', settled: 1_300_000, over: 300_000});
      const figures = await figuresOf(client, a.accountId);
      expect(figures).toMatchObject({limit: M, settled: 1_300_000, reserved: 0, available: 0, over: 300_000});
      expect(reconciles(figures)).toBe(true);
    });
  });

  it.each([
    ['evidence', ['planned', 'dispatched', 'noncharge', 'abandoned'], ['completed', 'ambiguous', 'settled']],
    ['deadline', ['planned', 'dispatched', 'completed', 'noncharge', 'abandoned'], ['ambiguous', 'settled']],
    ['noncharge', ['planned', 'dispatched', 'completed', 'ambiguous', 'settled', 'abandoned'], ['noncharge']],
    ['unused', ['planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled'], ['abandoned']],
  ] as const)('settles %s only for an operation in a state that fits: %s do not, and carry the state', async (classification, wrongStates, rightStates) => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      for (const state of wrongStates) {
        const held = await reserved(client, a, std);
        if (state !== 'planned') await moveTo(client, held.operationId, state as OperationTarget, '25 hours');
        const ledger = await ledgerOf(client, a.accountId);
        expect(await settle(client, a.accountId, {operationId: held.operationId, classification}), `${classification} on ${state}`).toMatchObject({outcome: 'not_settleable', state, settlement_id: null, settled: null});
        await unchanged(client, a.accountId, ledger);
      }
      for (const state of rightStates) {
        const held = await reserved(client, a, std);
        await moveTo(client, held.operationId, state as OperationTarget, '25 hours');
        expect((await settle(client, a.accountId, {operationId: held.operationId, classification})).outcome, `${classification} on ${state}`).toBe('settled');
      }
    });
  });

  it('settles a deadline at the reservation only 24 hours after the outcome: 23 hours 59 minutes is `not_due`, carrying the due time; 24 hours settles', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const early = await reserved(client, a, std);
      await moveTo(client, early.operationId, 'ambiguous', '23 hours 59 minutes');
      const ledger = await ledgerOf(client, a.accountId);
      const refused = await settle(client, a.accountId, {operationId: early.operationId, classification: 'deadline'});
      expect(refused).toMatchObject({outcome: 'not_due', settlement_id: null});
      const due = (await client.query(`select (outcome_at + interval '24 hours') as due from jobs.operations where id = $1`, [early.operationId])).rows[0].due as Date;
      expect(new Date(refused.due_at).getTime()).toBe(due.getTime());
      expect(due.getTime()).toBeGreaterThan(Date.now() - 1000);
      await unchanged(client, a.accountId, ledger);
      const late = await reserved(client, a, std);
      await moveTo(client, late.operationId, 'ambiguous', '24 hours');
      const answer = await settle(client, a.accountId, {operationId: late.operationId, classification: 'deadline'});
      expect(answer).toMatchObject({outcome: 'settled', classification: 'deadline', settled: 312_600, released: 312_600, over: 0, incident_id: null});
      const figures = await figuresOf(client, a.accountId);
      expect(figures).toMatchObject({settled: 312_600, reserved: 312_600});
      expect(reconciles(figures)).toBe(true);
    });
  });

  it('settles a charge that was never made at 0 and gives the headroom back: noncharge and unused', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      await allowance(client, a.accountId, M);
      const first = await reserved(client, a, exact, {output: 1000});
      expect((await figuresOf(client, a.accountId)).available).toBe(0);
      await moveTo(client, first.operationId, 'noncharge');
      expect(await settle(client, a.accountId, {operationId: first.operationId, classification: 'noncharge'})).toMatchObject({outcome: 'settled', classification: 'noncharge', settled: 0, released: M, over: 0});
      expect(await figuresOf(client, a.accountId)).toMatchObject({settled: 0, reserved: 0, available: M});
      const second = await reserved(client, a, exact, {output: 1000});
      await moveTo(client, second.operationId, 'abandoned');
      expect(await settle(client, a.accountId, {operationId: second.operationId, classification: 'unused'})).toMatchObject({outcome: 'settled', classification: 'unused', settled: 0, released: M});
      expect(await figuresOf(client, a.accountId)).toMatchObject({settled: 0, reserved: 0, available: M});
      // The headroom is real: the same request fits again.
      const third = await jobWith(client, a);
      expect(await reserve(client, a, {schedule: exact, operationId: third.operationIds[0], output: 1000})).toMatchObject({outcome: 'reserved'});
    });
  });

  it('answers `not_reserved` for an operation that holds no reservation', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await jobWith(client, a);
      await moveTo(client, job.operationIds[0], 'abandoned');
      const ledger = await ledgerOf(client, a.accountId);
      expect(await settle(client, a.accountId, {operationId: job.operationIds[0], classification: 'unused'})).toMatchObject({outcome: 'not_reserved', settlement_id: null});
      await unchanged(client, a.accountId, ledger);
    });
  });

  it('settles once: the same command, or another with the same class and evidence, replays; anything else is `already_settled`, carrying the settlement', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      await moveTo(client, held.operationId, 'completed');
      const command = randomUUID();
      const first = await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', command, input: 2000, output: 100});
      expect(first.outcome).toBe('settled');
      const ledger = await ledgerOf(client, a.accountId);
      // The same command.
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', command, input: 2000, output: 100})).toMatchObject({outcome: 'replayed', settlement_id: first.settlement_id, settled: first.settled});
      expect(await ledgerOf(client, a.accountId)).toEqual(ledger);
      // Another command ID with the same class and evidence: replayed, and recorded.
      const second = randomUUID();
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', command: second, input: 2000, output: 100})).toMatchObject({outcome: 'replayed', settlement_id: first.settlement_id});
      expect(await ledgerOf(client, a.accountId)).toEqual({...ledger, commands: ledger.commands + 1});
      expect((await client.query('select subject_id from usage.commands where account_id = $1 and command_id = $2', [a.accountId, second])).rows).toEqual([{subject_id: first.settlement_id}]);
      // Another class or another evidence is refused, carrying what was settled.
      for (const change of [{classification: 'evidence' as const, input: 2001, output: 100}, {classification: 'evidence' as const, input: 2000, output: 100, model: 'another-model'}, {classification: 'deadline' as const}, {classification: 'noncharge' as const}]) {
        expect(await settle(client, a.accountId, {operationId: held.operationId, ...change}), JSON.stringify(change)).toMatchObject({
          outcome: 'already_settled', settlement_id: first.settlement_id, classification: 'evidence', settled: first.settled, released: 312_600,
        });
      }
      expect(await count(client, 'select count(*) as n from usage.settlements where reservation_id = $1', [held.reservationId])).toBe(1);
      expect(await ledgerOf(client, a.accountId)).toEqual({...ledger, commands: ledger.commands + 1});
    });
  });

  it('does not answer a replay from a receipt whose reservation or settlement is gone: the ledger no longer agrees with its receipts, which is an error (55000) and not a `replayed` with nothing in it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const job = await jobWith(client, a);
      const reserveCommand = randomUUID();
      const settleCommand = randomUUID();
      const made = await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command: reserveCommand});
      await moveTo(client, job.operationIds[0], 'completed');
      const settled = await settle(client, a.accountId, {operationId: job.operationIds[0], classification: 'evidence', command: settleCommand, input: 10, output: 10});
      expect([made.outcome, settled.outcome]).toEqual(['reserved', 'settled']);
      // Both replay while the rows are there.
      expect((await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command: reserveCommand})).outcome).toBe('replayed');
      expect((await settle(client, a.accountId, {operationId: job.operationIds[0], classification: 'evidence', command: settleCommand, input: 10, output: 10})).outcome).toBe('replayed');
      // The settlement goes (as the owner, as a purge or a bad restore might): the settle receipt names nothing.
      await client.query('delete from usage.settlements where id = $1', [settled.settlement_id]);
      const settleReplay = await attempt(client, 'service_role', SETTLE, settleArgs(a.accountId, {operationId: job.operationIds[0], classification: 'evidence', command: settleCommand, input: 10, output: 10}));
      expect(settleReplay.ok).toBe(false);
      if (!settleReplay.ok) {
        expect(settleReplay.code).toBe('55000');
        expect(settleReplay.message).toContain('receipt subject missing');
      }
      // The reservation goes too: the reserve receipt names nothing.
      await client.query('delete from usage.reservations where id = $1', [made.reservation_id]);
      const reserveReplay = await attempt(client, 'service_role', RESERVE, reserveArgs(a, {schedule: std, operationId: job.operationIds[0], command: reserveCommand}));
      expect(reserveReplay.ok).toBe(false);
      if (!reserveReplay.ok) {
        expect(reserveReplay.code).toBe('55000');
        expect(reserveReplay.message).toContain('receipt subject missing');
      }
      // Nothing was written by either refusal: the two receipts are all that is left of the ledgers.
      expect(await ledgerOf(client, a.accountId)).toEqual({reservations: 0, settlements: 0, incidents: 0, commands: 2});
    });
  });

  it('refuses a command ID that was used for another payload, or for a reservation, as `reused`', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      await moveTo(client, held.operationId, 'completed');
      const command = randomUUID();
      expect((await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', command, input: 1, output: 1})).outcome).toBe('settled');
      const ledger = await ledgerOf(client, a.accountId);
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', command, input: 2, output: 1})).toMatchObject({outcome: 'reused', settlement_id: null});
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'deadline', command})).toMatchObject({outcome: 'reused'});
      // The command ID of the reservation is not a settlement's, and a settlement's is not a reservation's.
      const reservingCommand = (await client.query(`select command_id from usage.commands where account_id = $1 and kind = 'reserve'`, [a.accountId])).rows[0].command_id as string;
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', command: reservingCommand, input: 1, output: 1})).toMatchObject({outcome: 'reused'});
      const job = await jobWith(client, a);
      expect(await reserve(client, a, {schedule: std, operationId: job.operationIds[0], command})).toMatchObject({outcome: 'reused'});
      await unchanged(client, a.accountId, ledger);
    });
  });

  it('answers `invalid_evidence` when the evidence prices above the largest amount, writing nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const dear = await schedule(client, {inN: 1_000_000_000_000, outN: 0});
      const job = await jobWith(client, a);
      const period = (await client.query('select id from usage.periods where account_id = $1', [a.accountId])).rows[0].id;
      await insertReservation(client, {accountId: a.accountId, periodId: period, jobId: job.jobId, operationId: job.operationIds[0], amount: 1, scheduleId: dear.id});
      await moveTo(client, job.operationIds[0], 'completed');
      const ledger = await ledgerOf(client, a.accountId);
      expect(await settle(client, a.accountId, {operationId: job.operationIds[0], classification: 'evidence', input: 1001, output: 0})).toMatchObject({outcome: 'invalid_evidence', reason: 'overflow', settlement_id: null});
      await unchanged(client, a.accountId, ledger);
      // Exactly 1e15 is a settlement: 1,000 input tokens at 1e12 each.
      expect(await settle(client, a.accountId, {operationId: job.operationIds[0], classification: 'evidence', input: 1000, output: 0})).toMatchObject({outcome: 'settled', settled: 1e15, over: 1e15 - 1});
    });
  });

  it('raises 22023 for a class that does not exist, for evidence given with another class or missing with evidence, and for evidence that is not a number or a model', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const job = await jobWith(client, a);
      const operationId = job.operationIds[0];
      const ledger = await ledgerOf(client, a.accountId);
      const bad: [string, unknown[]][] = [
        ['a class that does not exist', [a.accountId, randomUUID(), operationId, 'refund', null, null, null]],
        ['no class', [a.accountId, randomUUID(), operationId, null, null, null, null]],
        ['evidence with no tokens', [a.accountId, randomUUID(), operationId, 'evidence', null, null, 'claude-test']],
        ['evidence with no model', [a.accountId, randomUUID(), operationId, 'evidence', 1, 1, null]],
        ['evidence with no output', [a.accountId, randomUUID(), operationId, 'evidence', 1, null, 'claude-test']],
        ['negative input', [a.accountId, randomUUID(), operationId, 'evidence', -1, 1, 'claude-test']],
        ['negative output', [a.accountId, randomUUID(), operationId, 'evidence', 1, -1, 'claude-test']],
        ['a model with a space', [a.accountId, randomUUID(), operationId, 'evidence', 1, 1, 'claude test']],
        ['evidence given for a deadline', [a.accountId, randomUUID(), operationId, 'deadline', 1, 1, 'claude-test']],
        ['tokens given for a noncharge', [a.accountId, randomUUID(), operationId, 'noncharge', 1, null, null]],
        ['a model given for unused', [a.accountId, randomUUID(), operationId, 'unused', null, null, 'claude-test']],
        ['no Account', [null, randomUUID(), operationId, 'unused', null, null, null]],
        ['no command', [a.accountId, null, operationId, 'unused', null, null, null]],
        ['no operation', [a.accountId, randomUUID(), null, 'unused', null, null, null]],
      ];
      for (const [label, args] of bad) {
        const result = await attempt(client, 'service_role', SETTLE, args);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      await unchanged(client, a.accountId, ledger);
    });
  });

  it('answers `unavailable` for an operation that is another Account\'s or unknown, with nothing in it, writing nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const std = await schedule(client);
      const theirs = await reserved(client, b, std);
      await moveTo(client, theirs.operationId, 'noncharge');
      const before = [await ledgerOf(client, a.accountId), await ledgerOf(client, b.accountId)];
      for (const operationId of [theirs.operationId, randomUUID()]) {
        const answer = await settle(client, a.accountId, {operationId, classification: 'noncharge'});
        expect(answer).toMatchObject({outcome: 'unavailable'});
        for (const [field, value] of Object.entries(answer)) if (field !== 'outcome') expect(value, field).toBeNull();
      }
      expect([await ledgerOf(client, a.accountId), await ledgerOf(client, b.accountId)]).toEqual(before);
      expect(await figuresOf(client, b.accountId)).toMatchObject({reserved: 312_600});
    });
  });

  it('settles for an Account that is disabled, tombstoned or on another epoch, and for a deleted or tombstoned Project: settling is never refused for want of authority, so no money is stranded', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const disabled = await reserved(client, a, std);
      const deleted = await reserved(client, a, std);
      const tombstoned = await reserved(client, a, std);
      const accountGone = await reserved(client, a, std);
      for (const held of [disabled, deleted, tombstoned, accountGone]) await moveTo(client, held.operationId, 'noncharge');
      await rows(client, 'service_role', `select * from api.disable_account('seed:local:usage', $1)`, [a.accountId]);
      expect(await settle(client, a.accountId, {operationId: disabled.operationId, classification: 'noncharge'})).toMatchObject({outcome: 'settled', released: 312_600});
      // The Project is deleted, and another one is tombstoned.
      const projectOf = async (jobId: string) => (await client.query('select project_id from jobs.jobs where id = $1', [jobId])).rows[0].project_id as string;
      await client.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [await projectOf(deleted.jobId)]);
      expect(await settle(client, a.accountId, {operationId: deleted.operationId, classification: 'noncharge'})).toMatchObject({outcome: 'settled'});
      await rows(client, 'service_role', `select * from api.record_tombstone('project', $1)`, [await projectOf(tombstoned.jobId)]);
      expect(await settle(client, a.accountId, {operationId: tombstoned.operationId, classification: 'noncharge'})).toMatchObject({outcome: 'settled'});
      // The Account itself is tombstoned: its row stays until the purge, and what it holds is still released.
      await rows(client, 'service_role', `select * from api.record_tombstone('account', $1)`, [a.accountId]);
      expect(await settle(client, a.accountId, {operationId: accountGone.operationId, classification: 'noncharge'})).toMatchObject({outcome: 'settled'});
      expect(await figuresOf(client, a.accountId)).toMatchObject({settled: 0, reserved: 0});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('periods: the figures are signed deltas from the ledgers, and a limit change, a reset and a new month keep every reservation counted', () => {
  it('shows a reservation made last month and settled this month as a negative reserved delta and a positive settled one, and the successor carries the reservation', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const admin = await account(client, 'administrator');
      const unit = await schedule(client, {inN: 1, outN: 0});
      const [last] = await periodsAgo(client, a.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M}]);
      const job = await jobWith(client, a);
      // $1 reserved last month (the owner makes it: admission would have judged it then), settled this month at $0.40 of evidence.
      await insertReservation(client, {accountId: a.accountId, periodId: last, jobId: job.jobId, operationId: job.operationIds[0], amount: M, scheduleId: unit.id});
      await moveTo(client, job.operationIds[0], 'completed');
      expect((await figuresOf(client, a.accountId))).toMatchObject({seq: 1, reserved: M});
      const answer = await settle(client, a.accountId, {operationId: job.operationIds[0], classification: 'evidence', input: 400_000, output: 0});
      expect(answer).toMatchObject({outcome: 'settled', settled: 400_000, released: M});
      const periods = (await client.query('select id, seq, cause, carried_settled_microdollars::float8 as cs, carried_reserved_microdollars::float8 as cr from usage.periods where account_id = $1 order by seq', [a.accountId])).rows;
      expect(periods.map((p) => [p.seq, p.cause, p.cs, p.cr])).toEqual([[1, 'initial', 0, 0], [2, 'month', 0, M]]);
      expect(answer.period_id).toBe(periods[1].id);
      const figures = await figuresOf(client, a.accountId);
      // This month's figures: reserved -$1.00 (it released last month's reservation), settled +$0.40; shown: reserved 0, settled $0.40, $24.60 available.
      expect(figures).toMatchObject({seq: 2, reservedFigure: -M, settledFigure: 400_000, reserved: 0, settled: 400_000, available: 25 * M - 400_000});
      expect(reconciles(figures)).toBe(true);
      // Last month's own figures did not move.
      expect((await client.query('select reserved_microdollars::float8 as reserved, settled_microdollars::float8 as settled from usage.period_figures($1)', [last])).rows[0]).toEqual({reserved: M, settled: 0});
      // The Administrator's list shows the same.
      const listed = (await rows(client, 'service_role', 'select accounts from api.list_usage($1, $2)', [admin.accountId, admin.epoch]))[0].accounts as Record<string, unknown>[];
      expect(listed.find((entry) => entry.account_id === a.accountId)).toMatchObject({seq: 2, settled_microdollars: 400_000, reserved_microdollars: 0});
    });
  });

  it('keeps every reservation counted through a limit change and a reset, and the amounts reconcile at each step', async () => {
    await inTx(async (client) => {
      const target = await account(client);
      const admin = await account(client, 'administrator');
      const exact = await round(client);
      const std = await schedule(client);
      const change = async (kind: 'change' | 'reset', limit: number | null, expectedSeq: number) =>
        (
          await rows(client, 'service_role', 'select outcome, seq from api.set_usage_limit($1, $2, $3, $4, $5, $6, $7, $8)', [
            `user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), kind, limit, expectedSeq,
          ])
        )[0];
      const first = await reserved(client, target, exact, {output: 1000});
      const second = await reserved(client, target, std);
      let figures = await figuresOf(client, target.accountId);
      expect(figures).toMatchObject({seq: 1, reserved: M + 312_600, settled: 0});
      // A change to $40: the successor carries both reservations.
      expect(await change('change', 40 * M, 1)).toMatchObject({outcome: 'changed', seq: 2});
      figures = await figuresOf(client, target.accountId);
      expect(figures).toMatchObject({seq: 2, limit: 40 * M, reserved: M + 312_600, settled: 0, reservedFigure: 0});
      expect(reconciles(figures)).toBe(true);
      // The first settles in the new period at $0.40: it releases a reservation of the earlier period.
      await moveTo(client, first.operationId, 'completed');
      expect(await settle(client, target.accountId, {operationId: first.operationId, classification: 'evidence', input: 0, output: 400})).toMatchObject({outcome: 'settled', settled: 400_000, released: M});
      figures = await figuresOf(client, target.accountId);
      expect(figures).toMatchObject({seq: 2, reserved: 312_600, settled: 400_000, reservedFigure: -M, settledFigure: 400_000, available: 40 * M - 712_600});
      expect(reconciles(figures)).toBe(true);
      // A reset restarts the count and keeps what is still reserved.
      expect(await change('reset', null, 2)).toMatchObject({outcome: 'reset', seq: 3});
      figures = await figuresOf(client, target.accountId);
      expect(figures).toMatchObject({seq: 3, reserved: 312_600, settled: 0, available: 40 * M - 312_600});
      expect(reconciles(figures)).toBe(true);
      // The second is abandoned and released in the third period: reserved goes to 0.
      await moveTo(client, second.operationId, 'abandoned');
      expect(await settle(client, target.accountId, {operationId: second.operationId, classification: 'unused'})).toMatchObject({outcome: 'settled', released: 312_600});
      figures = await figuresOf(client, target.accountId);
      expect(figures).toMatchObject({seq: 3, reserved: 0, settled: 0, reservedFigure: -312_600, available: 40 * M});
      expect(reconciles(figures)).toBe(true);
      // The earlier periods never moved.
      const earlier = (await client.query('select p.seq, f.settled_microdollars::float8 as settled, f.reserved_microdollars::float8 as reserved from usage.periods p cross join lateral usage.period_figures(p.id) f where p.account_id = $1 order by p.seq', [target.accountId])).rows;
      expect(earlier).toEqual([{seq: 1, settled: 0, reserved: M + 312_600}, {seq: 2, settled: 400_000, reserved: -M}, {seq: 3, settled: 0, reserved: -312_600}]);
    });
  });

  it('keeps the identity through a month that turns while a reservation is outstanding, and counts a reservation made in the new month beside it', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const exact = await round(client);
      const [last] = await periodsAgo(client, a.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M}]);
      const old = await jobWith(client, a);
      await insertReservation(client, {accountId: a.accountId, periodId: last, jobId: old.jobId, operationId: old.operationIds[0], amount: 3 * M, scheduleId: exact.id});
      const job = await jobWith(client, a);
      expect((await reserve(client, a, {schedule: exact, operationId: job.operationIds[0], output: 1000})).outcome).toBe('reserved');
      const figures = await figuresOf(client, a.accountId);
      expect(figures).toMatchObject({seq: 2, reserved: 4 * M, settled: 0, available: 21 * M});
      expect(reconciles(figures)).toBe(true);
      // Nothing was rewritten: the earlier period is as it was.
      expect(await count(client, 'select count(*) as n from usage.periods where account_id = $1', [a.accountId])).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the allowance is judged by everything the period carries in', () => {
  it('counts what a month turn, a limit change and a reset carried in: exactly the remainder is reserved, one microdollar more is `insufficient_allowance`, and the cost block is the carry-inclusive figures', async () => {
    await inTx(async (client) => {
      const target = await account(client);
      const admin = await account(client, 'administrator');
      const unit = await schedule(client, {inN: 1, outN: 0});
      const exact = await round(client);
      const [last] = await periodsAgo(client, target.accountId, [{seq: 1, monthsAgo: 1, limit: 25 * M}]);
      const jobs = [];
      for (let index = 0; index < 8; index += 1) jobs.push(await jobWith(client, target));
      const [a, b, c, d, e, f] = jobs.map((job) => job.operationIds[0]);
      const ask = (operationId: string, output: number) => reserve(client, target, {schedule: exact, operationId, output});
      const periodRow = async (seq: number) =>
        (await client.query('select limit_microdollars::float8 as "limit", carried_settled_microdollars::float8 as carried_settled, carried_reserved_microdollars::float8 as carried_reserved, cause from usage.periods where account_id = $1 and seq = $2', [target.accountId, seq])).rows[0];

      // Last month the Account reserved $1.00 (a) and $2.00 (b). The owner makes those two (admission judged them then); neither is settled.
      await insertReservation(client, {accountId: target.accountId, periodId: last, jobId: jobs[0].jobId, operationId: a, amount: M, scheduleId: unit.id});
      await insertReservation(client, {accountId: target.accountId, periodId: last, jobId: jobs[1].jobId, operationId: b, amount: 2 * M, scheduleId: unit.id});
      // This month, work is first asked for: (a) settles at $0.40, which turns the month; and (c) reserves $0.50.
      await moveTo(client, a, 'completed');
      expect(await settle(client, target.accountId, {operationId: a, classification: 'evidence', input: 400_000, output: 0})).toMatchObject({outcome: 'settled', settled: 400_000, released: M});
      expect(await ask(c, 500)).toMatchObject({outcome: 'reserved', reserved: 500_000});
      expect(await periodRow(2)).toEqual({limit: 25 * M, carried_settled: 0, carried_reserved: 3 * M, cause: 'month'});
      expect(await figuresOf(client, target.accountId)).toMatchObject({seq: 2, settled: 400_000, reserved: 2_500_000});

      // A change to $3.40: the successor carries settled $0.40 and reserved $2.50, so $2.90 is used and $0.50 is left.
      expect(await changeLimit(client, admin, target, 'change', 3_400_000, 2)).toMatchObject({outcome: 'changed', seq: 3});
      expect(await periodRow(3)).toEqual({limit: 3_400_000, carried_settled: 400_000, carried_reserved: 2_500_000, cause: 'change'});
      const afterChange = await figuresOf(client, target.accountId);
      expect(afterChange).toMatchObject({seq: 3, settled: 400_000, reserved: 2_500_000, used: 2_900_000, available: 500_000});
      expect(reconciles(afterChange)).toBe(true);
      expect(await availableOf(client, target.accountId)).toBe(500_000);
      // One microdollar over the remainder is refused, with the cost block of the carry-inclusive figures; the remainder itself is reserved.
      expect(await ask(d, 501)).toMatchObject({outcome: 'insufficient_allowance', requested: 501_000, limit: 3_400_000, used: 2_900_000, available: 500_000});
      expect(await ask(d, 500)).toMatchObject({outcome: 'reserved', reserved: 500_000});
      expect(await ask(e, 1)).toMatchObject({outcome: 'insufficient_allowance', requested: 1000, limit: 3_400_000, used: 3_400_000, available: 0});
      expect(await availableOf(client, target.accountId)).toBe(0);

      // A reset restarts the settled count and keeps the limit and every reservation: $3.00 reserved, $0.40 left.
      expect(await changeLimit(client, admin, target, 'reset', null, 3)).toMatchObject({outcome: 'reset', seq: 4});
      expect(await periodRow(4)).toEqual({limit: 3_400_000, carried_settled: 0, carried_reserved: 3 * M, cause: 'reset'});
      const afterReset = await figuresOf(client, target.accountId);
      expect(afterReset).toMatchObject({seq: 4, settled: 0, reserved: 3 * M, used: 3 * M, available: 400_000});
      expect(reconciles(afterReset)).toBe(true);
      expect(await availableOf(client, target.accountId)).toBe(400_000);
      expect(await ask(f, 401)).toMatchObject({outcome: 'insufficient_allowance', requested: 401_000, limit: 3_400_000, used: 3 * M, available: 400_000});
      expect(await ask(f, 400)).toMatchObject({outcome: 'reserved', reserved: 400_000});
      expect(await figuresOf(client, target.accountId)).toMatchObject({used: 3_400_000, available: 0});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('an operation is exactly one provider request: a reservation and a settlement are priced with a request count of 1', () => {
  // A request rate of 5/4 and a geography multiplier of 3/2, so the one request is part of the price and the multiplier multiplies it.
  const rates: RefRates = {inN: 3, inD: 7, outN: 1, outD: 3, reqN: 5, reqD: 4, incIn: 1000, incOut: 100, multN: 3, multD: 2};

  it('reserves what the reference calculator prices for one request, and the quote of one request says the same', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sched = await schedule(client, rates);
      const bound = refBound(10_000, 2);
      const one = refPrice(rates, bound, BigInt(100), 1);
      // The request rate counts: with no request the price would be another amount, so a call site that priced 0 requests would not pass.
      expect(refPrice(rates, bound, BigInt(100), 0)).not.toBe(one);
      expect(refPrice(rates, bound, BigInt(100), 2)).not.toBe(one);
      const job = await jobWith(client, a);
      expect(await quote(client, a, {schedule: sched, output: 100})).toMatchObject({outcome: 'quoted', microdollars: Number(one)});
      expect(await reserve(client, a, {schedule: sched, operationId: job.operationIds[0], output: 100})).toMatchObject({outcome: 'reserved', reserved: Number(one), input_bound: Number(bound)});
    });
  });

  it('settles evidence at the reference price of one request', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sched = await schedule(client, rates);
      const held = await reserved(client, a, sched, {output: 100});
      await moveTo(client, held.operationId, 'completed');
      const expected = refPrice(rates, BigInt(1234), BigInt(77), 1);
      expect(refPrice(rates, BigInt(1234), BigInt(77), 0)).not.toBe(expected);
      expect(Number(expected)).toBeLessThan(held.amount);
      expect(await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', input: 1234, output: 77})).toMatchObject({outcome: 'settled', settled: Number(expected), over: 0});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the ledgers are immutable, owned by composite keys, and guarded where they are written', () => {
  it('refuses any update and any truncate of a schedule, a reservation, a settlement and a receipt (55000), and lets the purge delete them', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      await moveTo(client, held.operationId, 'completed');
      const settled = await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', input: 10, output: 10});
      for (const sql of [
        `update usage.rate_schedules set version = version + 1 where id = '${std.id}'`,
        `update usage.rate_schedules set input_rate_num = 0 where id = '${std.id}'`,
        `update usage.reservations set reserved_microdollars = 1 where id = '${held.reservationId}'`,
        `update usage.reservations set operation_id = operation_id where id = '${held.reservationId}'`,
        `update usage.reservations set created_at = now() where id = '${held.reservationId}'`,
        `update usage.settlements set settled_microdollars = 0 where id = '${settled.settlement_id}'`,
        `update usage.settlements set classification = 'unused' where id = '${settled.settlement_id}'`,
        `update usage.commands set digest = repeat('0', 64) where account_id = '${a.accountId}'`,
        `update usage.commands set kind = 'settle' where account_id = '${a.accountId}'`,
      ]) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      // Truncating one of them is refused too. (A table another one refers to is named with its referrers, so the trigger and not the foreign key answers.)
      const together = await attempt(client, null, 'truncate usage.periods, usage.rate_schedules, usage.reservations, usage.settlements, usage.overrun_incidents, usage.commands');
      expect(together.ok).toBe(false);
      if (!together.ok) expect(together.code).toBe('55000');
      const alone = await attempt(client, null, 'truncate usage.commands');
      expect(alone.ok).toBe(false);
      if (!alone.ok) expect(alone.code).toBe('55000');
      expect(await ledgerOf(client, a.accountId)).toMatchObject({reservations: 1, settlements: 1, commands: 2});
      // Delete is left for the purge (Epic 8), children first.
      expect((await client.query('delete from usage.commands where account_id = $1', [a.accountId])).rowCount).toBe(2);
      expect((await client.query('delete from usage.settlements where account_id = $1', [a.accountId])).rowCount).toBe(1);
      expect((await client.query('delete from usage.reservations where account_id = $1', [a.accountId])).rowCount).toBe(1);
      expect((await client.query('delete from usage.rate_schedules where id = $1', [std.id])).rowCount).toBe(1);
    });
  });

  it('has, on every table that is never emptied, an enabled BEFORE TRUNCATE trigger that raises 55000 of its own (a truncate can also be refused by a foreign key, or by the trigger of another table named with it)', async () => {
    const guards = await truncateGuards(db, ['usage.periods', 'usage.rate_schedules', 'usage.reservations', 'usage.settlements', 'usage.overrun_incidents', 'usage.commands', 'jobs.operations']);
    for (const [table, found] of Object.entries(guards)) expect(found.length, `${table} has a BEFORE TRUNCATE trigger that raises 55000`).toBeGreaterThanOrEqual(1);
    // The two tables nothing refers to are refused by their own trigger when they are truncated alone.
    await inTx(async (client) => {
      for (const table of ['usage.commands', 'usage.overrun_incidents']) {
        const result = await attempt(client, null, `truncate ${table}`);
        expect(result.ok, table).toBe(false);
        if (!result.ok) expect(result.code, table).toBe('55000');
      }
    });
  });

  it('lets an incident change in one way only: its clearing, once, with the time and the Administrator together', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      await moveTo(client, held.operationId, 'completed');
      const answer = await settle(client, a.accountId, {operationId: held.operationId, classification: 'evidence', input: 40_000, output: 16_000});
      expect(answer.incident_id).not.toBeNull();
      const id = answer.incident_id as string;
      for (const sql of [
        `update usage.overrun_incidents set provider = 'other' where id = '${id}'`,
        `update usage.overrun_incidents set evidence_microdollars = evidence_microdollars + 1 where id = '${id}'`,
        `update usage.overrun_incidents set reserved_microdollars = 1 where id = '${id}'`,
        `update usage.overrun_incidents set created_at = now() where id = '${id}'`,
        `update usage.overrun_incidents set cleared_at = now() where id = '${id}'`,
        `update usage.overrun_incidents set cleared_by = 'user:administrator' where id = '${id}'`,
        `update usage.overrun_incidents set cleared_at = now(), cleared_by = 'administrator' where id = '${id}'`,
        `update usage.overrun_incidents set cleared_at = now(), cleared_by = 'user:administrator', provider = 'other' where id = '${id}'`,
        'truncate usage.overrun_incidents',
      ]) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
      }
      expect((await client.query(`update usage.overrun_incidents set cleared_at = clock_timestamp(), cleared_by = 'user:administrator' where id = $1`, [id])).rowCount).toBe(1);
      for (const sql of [
        `update usage.overrun_incidents set cleared_at = now(), cleared_by = 'user:someone-else' where id = '${id}'`,
        `update usage.overrun_incidents set cleared_at = null, cleared_by = null where id = '${id}'`,
      ]) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      expect((await client.query('delete from usage.overrun_incidents where id = $1', [id])).rowCount).toBe(1);
    });
  });

  it('guards what is written: a reservation for an operation of another Job, with the pins of another schedule, or for another Account is refused; so is a double reservation', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const std = await schedule(client);
      const other = await schedule(client);
      const jobA = await jobWith(client, a, 2);
      const jobA2 = await jobWith(client, a);
      const jobB = await jobWith(client, b);
      const periodA = (await client.query('select id from usage.periods where account_id = $1', [a.accountId])).rows[0].id as string;
      /** Tries to insert a reservation (the defaults are a good one) and says what the database answered; a good one is kept only when asked. */
      const tryInsert = async (spec: Partial<Parameters<typeof insertReservation>[1]>, keep = false) => {
        await client.query('savepoint guarded');
        try {
          await insertReservation(client, {accountId: a.accountId, periodId: periodA, jobId: jobA.jobId, operationId: jobA.operationIds[0], amount: 1000, scheduleId: std.id, ...spec});
          await client.query(keep ? 'release savepoint guarded' : 'rollback to savepoint guarded');
          return 'ok';
        } catch (error) {
          await client.query('rollback to savepoint guarded');
          return (error as {code?: string}).code ?? 'error';
        }
      };
      expect(await tryInsert({})).toBe('ok');
      // The operation is another Job's, or another Account's: the trigger refuses it before the keys are looked at.
      expect(await tryInsert({jobId: jobA2.jobId})).toBe('23514');
      expect(await tryInsert({operationId: jobB.operationIds[0]})).toBe('23514');
      expect(await tryInsert({jobId: jobB.jobId})).toBe('23514');
      // The pins are those of the schedule.
      expect(await tryInsert({provider: 'another'})).toBe('23514');
      expect(await tryInsert({model: 'another-model'})).toBe('23514');
      expect(await tryInsert({apiVersion: '2024-01-01'})).toBe('23514');
      // A whole set of another Account's with this Account's period: the composite key refuses it.
      expect(await tryInsert({accountId: b.accountId, jobId: jobB.jobId, operationId: jobB.operationIds[0]})).toBe('23503');
      // An amount of 0, and one above 1e15.
      expect(await tryInsert({amount: 0})).toBe('23514');
      expect(await tryInsert({amount: 1e15 + 2})).toBe('23514');
      // The good one lands; a second for the same operation does not.
      expect(await tryInsert({scheduleId: other.id}, true)).toBe('ok');
      expect(await tryInsert({})).toBe('23505');
      // A reservation whose input bound is not the calculator's is refused.
      const wrongBound = await attempt(
        client,
        null,
        `insert into usage.reservations (account_id, period_id, job_id, operation_id, rate_schedule_id, provider, requested_model, api_version, request_bytes, image_count, output_limit, input_bound, reserved_microdollars, digest)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 0, 1, 1, repeat('a', 64))`,
        [a.accountId, periodA, jobA.jobId, jobA.operationIds[1], std.id, std.provider, std.model, std.apiVersion],
      );
      expect(wrongBound.ok).toBe(false);
      if (!wrongBound.ok) expect(wrongBound.code).toBe('23514');
    });
  });

  it('guards the settlements: the whole reservation is released, a deadline settles the reservation, nothing is settled for a noncharge or unused, evidence has its fields, and a period is never before its reservation\'s', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      const periodId = (await client.query('select id from usage.periods where account_id = $1', [a.accountId])).rows[0].id as string;
      const insert = async (values: Record<string, unknown>) => {
        const spec = {
          account_id: a.accountId, reservation_id: held.reservationId, period_id: periodId, classification: 'deadline', settled_microdollars: 312_600, released_microdollars: 312_600,
          input_tokens: null, output_tokens: null, returned_model: null, digest: 'a'.repeat(64), ...values,
        };
        const keys = Object.keys(spec);
        await client.query('savepoint settlement');
        try {
          await client.query(`insert into usage.settlements (${keys.join(', ')}) values (${keys.map((_, index) => `$${index + 1}`).join(', ')})`, keys.map((key) => spec[key as keyof typeof spec]));
          await client.query('rollback to savepoint settlement');
          return 'ok';
        } catch (error) {
          await client.query('rollback to savepoint settlement');
          return (error as {code?: string}).code ?? 'error';
        }
      };
      expect(await insert({})).toBe('ok');
      expect(await insert({released_microdollars: 312_599})).toBe('23514');
      expect(await insert({released_microdollars: 312_601})).toBe('23514');
      expect(await insert({settled_microdollars: 1})).toBe('23514');
      expect(await insert({classification: 'noncharge', settled_microdollars: 1})).toBe('23514');
      expect(await insert({classification: 'unused', settled_microdollars: 1})).toBe('23514');
      expect(await insert({classification: 'noncharge', settled_microdollars: 0})).toBe('ok');
      expect(await insert({classification: 'evidence', settled_microdollars: 5})).toBe('23514');
      expect(await insert({classification: 'evidence', settled_microdollars: 5, input_tokens: 1, output_tokens: 1, returned_model: 'claude-test'})).toBe('ok');
      expect(await insert({input_tokens: 1})).toBe('23514');
      expect(await insert({settled_microdollars: -1, classification: 'evidence', input_tokens: 1, output_tokens: 1, returned_model: 'claude-test'})).toBe('23514');
      expect(await insert({classification: 'refund'})).toBe('23514');
      // Another Account's reservation or period.
      const b = await account(client);
      const periodB = (await client.query('select id from usage.periods where account_id = $1', [b.accountId])).rows[0].id as string;
      expect(await insert({account_id: b.accountId})).toBe('23514');
      expect(await insert({period_id: periodB})).toBe('23503');
      // An earlier period than the reservation's.
      const [before, now] = await (async () => {
        const c = await account(client);
        const ids = await periodsAgo(client, c.accountId, [{seq: 1, monthsAgo: 2, limit: 25 * M}, {seq: 2, monthsAgo: 1, limit: 25 * M}]);
        const job = await jobWith(client, c);
        const reservation = await insertReservation(client, {accountId: c.accountId, periodId: ids[1], jobId: job.jobId, operationId: job.operationIds[0], amount: 1000});
        return [{account: c.accountId, period: ids[0], reservation}, {account: c.accountId, period: ids[1], reservation}];
      })();
      expect(await insert({account_id: before.account, reservation_id: before.reservation, period_id: before.period, settled_microdollars: 1000, released_microdollars: 1000})).toBe('23514');
      expect(await insert({account_id: now.account, reservation_id: now.reservation, period_id: now.period, settled_microdollars: 1000, released_microdollars: 1000})).toBe('ok');
      // A second settlement for the reservation.
      await client.query(`insert into usage.settlements (account_id, reservation_id, period_id, classification, settled_microdollars, released_microdollars, digest) values ($1, $2, $3, 'deadline', 312600, 312600, repeat('b', 64))`, [a.accountId, held.reservationId, periodId]);
      expect(await insert({})).toBe('23505');
    });
  });

  it('keeps the ledgers with ON DELETE RESTRICT: a period, a Job, an operation, an Account or a schedule that a ledger row refers to cannot be deleted', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const held = await reserved(client, a, std);
      for (const sql of [
        [`delete from usage.periods where account_id = $1`, a.accountId],
        [`delete from jobs.jobs where id = $1`, held.jobId],
        [`delete from jobs.operations where id = $1`, held.operationId],
        [`delete from identity.accounts where id = $1`, a.accountId],
        [`delete from usage.rate_schedules where id = $1`, std.id],
      ] as const) {
        const result = await attempt(client, null, sql[0], [sql[1]]);
        expect(result.ok, sql[0]).toBe(false);
        if (!result.ok) expect(result.code, sql[0]).toBe('23503');
      }
    });
  });

  it('describes its tables as the story names them: shapes, ranges and keys', async () => {
    const column = async (table: string, name: string) =>
      (await db.query(`select data_type, is_nullable from information_schema.columns where table_schema = 'usage' and table_name = $1 and column_name = $2`, [table, name])).rows[0];
    for (const [table, names] of [
      ['rate_schedules', ['input_rate_num', 'input_rate_den', 'output_rate_num', 'output_rate_den', 'request_rate_num', 'request_rate_den', 'multiplier_num', 'multiplier_den']],
      ['reservations', ['request_bytes', 'reserved_microdollars', 'input_bound']],
      ['settlements', ['settled_microdollars', 'released_microdollars', 'input_tokens', 'output_tokens']],
      ['overrun_incidents', ['reserved_microdollars', 'evidence_microdollars']],
    ] as const) {
      for (const name of names) expect(await column(table, name), `${table}.${name}`).toMatchObject({data_type: 'bigint'});
    }
    const keys = (await db.query(`select conrelid::regclass::text as table, conname, contype from pg_constraint where connamespace = 'usage'::regnamespace and contype in ('u', 'p') order by 1, 2`)).rows.map((row) => `${row.table}.${row.conname}`);
    for (const expected of [
      'usage.rate_schedules.rate_schedules_provider_model_version_key', 'usage.reservations.reservations_operation_key', 'usage.settlements.settlements_reservation_key',
      'usage.overrun_incidents.overrun_incidents_reservation_key', 'usage.overrun_incidents.overrun_incidents_settlement_key', 'usage.commands.commands_pkey', 'usage.periods.periods_id_account_key',
    ]) expect(keys, expected).toContain(expected);
    expect((await db.query(`select conname from pg_constraint where conrelid = 'jobs.operations'::regclass and conname = 'operations_id_account_key'`)).rows).toHaveLength(1);
    // The schedule's constraints.
    const bad: [string, Rates][] = [
      ['a zero denominator', {inD: 0}], ['a negative numerator', {inN: -1}], ['a numerator above 1e12', {outN: 1_000_000_000_001}], ['an increment of 0', {incIn: 0}],
      ['an increment above 1,000,000', {incOut: 1_000_001}], ['a multiplier below 1', {multN: 1, multD: 2}], ['a currency in lower case', {currency: 'usd'}], ['a version of 0', {version: 0}],
      ['an API version with a space', {apiVersion: 'a b'}], ['a provider that is not a word', {provider: 'Not A Word'}],
    ];
    await inTx(async (client) => {
      for (const [label, rates] of bad) {
        await client.query('savepoint shape');
        let code = '';
        try {
          await schedule(client, rates);
        } catch (error) {
          code = (error as {code?: string}).code ?? '';
        }
        await client.query('rollback to savepoint shape');
        expect(code, label).toBe('23514');
      }
      const first = await schedule(client);
      await client.query('savepoint twice');
      let code = '';
      try {
        await schedule(client, {provider: first.provider, model: first.model});
      } catch (error) {
        code = (error as {code?: string}).code ?? '';
      }
      await client.query('rollback to savepoint twice');
      expect(code).toBe('23505');
      // A new version of the same model is another schedule.
      expect((await schedule(client, {provider: first.provider, model: first.model, version: 2})).id).not.toBe(first.id);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the stand-in is retired: the figures of a period come from the ledgers', () => {
  it('has no usage.fixture_figures, no fixture row, and no function that names it', async () => {
    expect((await db.query(`select to_regclass('usage.fixture_figures') as name`)).rows[0].name).toBeNull();
    const {rows: named} = await db.query(
      `with ours as materialized (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('usage', 'api') and p.prokind = 'f')
       select ours.oid::regprocedure::text as name from ours where pg_get_functiondef(ours.oid) ilike '%fixture_figures%'`,
    );
    expect(named).toEqual([]);
  });

  it('shows in api.list_usage the amounts the ledgers hold, and nothing else', async () => {
    await inTx(async (client) => {
      const admin = await account(client, 'administrator');
      const member = await account(client);
      const listed = async () => ((await rows(client, 'service_role', 'select accounts from api.list_usage($1, $2)', [admin.accountId, admin.epoch]))[0].accounts as Record<string, unknown>[]).find((entry) => entry.account_id === member.accountId);
      expect(await listed()).toMatchObject({settled_microdollars: 0, reserved_microdollars: 0, limit_microdollars: 25 * M});
      const [period] = (await client.query('select id from usage.periods where account_id = $1', [member.accountId])).rows;
      await setFigures(client, period.id, 10 * M, 2 * M);
      expect(await listed()).toMatchObject({settled_microdollars: 10 * M, reserved_microdollars: 2 * M});
      expect(await availableOf(client, member.accountId)).toBe(13 * M);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the whole path through the real commands: accept a Job, start it, begin a step, reserve, dispatch, complete, settle', () => {
  it('reserves and settles an operation made by the Jobs commands, and the Job exposure follows the settlement', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const real = (sql: string, params: unknown[]) => rows(client, 'service_role', sql, params).then((found) => found[0]);
      const projectId = await project(client, a);
      const accepted = await real('select * from api.accept_job($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), projectId, 'research', sha('input')]);
      // Not yet: the attempt is waiting, so a step cannot be begun and there is no operation to reserve for.
      expect((await real('select * from api.begin_step($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'search', 1])).outcome).toBe('not_running');
      await real('select * from api.move_attempt($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'running', null]);
      const begun = await real('select * from api.begin_step($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'search', 1]);
      const reservation = await reserve(client, a, {schedule: std, operationId: begun.operation_id});
      expect(reservation).toMatchObject({outcome: 'reserved', job_id: accepted.job_id, reserved: 312_600});
      for (const to of ['dispatched', 'completed']) expect((await real('select * from api.advance_operation($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), begun.operation_id, to, null])).outcome).toBe('advanced');
      // A completed operation is no longer reservable, and an existing reservation still replays.
      expect(await reserve(client, a, {schedule: std, operationId: begun.operation_id})).toMatchObject({outcome: 'replayed', reservation_id: reservation.reservation_id});
      expect(await settle(client, a.accountId, {operationId: begun.operation_id, classification: 'evidence', input: 20_000, output: 3000})).toMatchObject({outcome: 'settled', settled: 105_000, released: 312_600});
      expect(await exposureOf(client, accepted.job_id)).toBe(105_000);
      expect(await figuresOf(client, a.accountId)).toMatchObject({settled: 105_000, reserved: 0});
      // The attempt can finish: nothing is open. (The Jobs module is untouched by Usage.)
      expect((await real('select * from api.move_attempt($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'completed', null])).outcome).toBe('moved');
    });
  });

  it('settles a cancelled attempt\'s never-dispatched operation as `unused`: its planned operation is abandoned, and the headroom comes back', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const std = await schedule(client);
      const real = (sql: string, params: unknown[]) => rows(client, 'service_role', sql, params).then((found) => found[0]);
      const projectId = await project(client, a);
      const accepted = await real('select * from api.accept_job($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), projectId, 'research', sha('input')]);
      await real('select * from api.move_attempt($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'running', null]);
      const begun = await real('select * from api.begin_step($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'search', 1]);
      expect((await reserve(client, a, {schedule: std, operationId: begun.operation_id})).outcome).toBe('reserved');
      expect((await figuresOf(client, a.accountId)).reserved).toBe(312_600);
      // Cancelling does not release the reservation by itself; the operation is abandoned and then settled `unused`.
      expect((await real('select * from api.move_attempt($1, $2, $3, $4, $5, $6)', [a.accountId, a.epoch, randomUUID(), accepted.attempt_id, 'cancelled', 'user_cancelled'])).outcome).toBe('moved');
      expect((await figuresOf(client, a.accountId)).reserved).toBe(312_600);
      expect(await reserve(client, a, {schedule: std, operationId: begun.operation_id, output: 100})).toMatchObject({outcome: 'already_reserved'});
      expect(await settle(client, a.accountId, {operationId: begun.operation_id, classification: 'unused'})).toMatchObject({outcome: 'settled', settled: 0, released: 312_600});
      expect(await figuresOf(client, a.accountId)).toMatchObject({settled: 0, reserved: 0, available: 25 * M});
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('concurrency: one lock for an Account makes the limits hold however many ask at once (committed data)', () => {
  /** An Account with its schedule and `n` Jobs of one operation, or one Job of `n` operations, committed. */
  async function world(limit: number, shape: {jobs?: number; operations?: number}) {
    const a = await committedAccount();
    await allowance(db, a.accountId, limit);
    const exact = await round(db);
    const jobs = [];
    for (let index = 0; index < (shape.jobs ?? 1); index += 1) jobs.push(await ledgerJob(db, a.accountId, shape.operations ?? 1));
    return {a, exact, jobs};
  }
  const concurrently = async (n: number, work: (client: Client, index: number) => Promise<unknown>) => {
    const clients = await Promise.all(Array.from({length: n}, () => connect()));
    return Promise.all(clients.map((client, index) => work(client, index)));
  };
  const outcomes = (answers: unknown[]) => (answers as {rows: {outcome: string}[]}[]).map((answer) => answer.rows[0].outcome).sort();

  it('makes one reservation of identical commands sent together: one `reserved`, the rest `replayed`, one row and one receipt', async () => {
    const {a, exact, jobs} = await world(25 * M, {});
    const command = randomUUID();
    const answers = await concurrently(8, (client) => client.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: jobs[0].operationIds[0], output: 500, command})));
    expect(outcomes(answers)).toEqual(['replayed', 'replayed', 'replayed', 'replayed', 'replayed', 'replayed', 'replayed', 'reserved']);
    expect(new Set(answers.map((answer) => (answer as {rows: {reservation_id: string}[]}).rows[0].reservation_id)).size).toBe(1);
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 1, commands: 1});
    expect((await figuresOf(db, a.accountId)).reserved).toBe(500_000);
  });

  it('makes one reservation of different commands with the same payload for one operation: one `reserved`, the rest `replayed` and recorded', async () => {
    const {a, exact, jobs} = await world(25 * M, {});
    const answers = await concurrently(6, (client) => client.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: jobs[0].operationIds[0], output: 500})));
    expect(outcomes(answers)).toEqual(['replayed', 'replayed', 'replayed', 'replayed', 'replayed', 'reserved']);
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 1, commands: 6});
  });

  it('admits exactly the reservations that fit the allowance when many ask near the limit, and settled plus reserved never exceeds it', async () => {
    const {a, exact, jobs} = await world(3 * M, {jobs: 9});
    const answers = await concurrently(9, (client, index) => client.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: jobs[index].operationIds[0], output: 1000})));
    expect(outcomes(answers)).toEqual(['insufficient_allowance', 'insufficient_allowance', 'insufficient_allowance', 'insufficient_allowance', 'insufficient_allowance', 'insufficient_allowance', 'reserved', 'reserved', 'reserved']);
    const figures = await figuresOf(db, a.accountId);
    expect(figures).toMatchObject({settled: 0, reserved: 3 * M, available: 0});
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 3, commands: 3});
  });

  it('admits exactly $5 to a Job when many operations of it ask together', async () => {
    const {a, exact, jobs} = await world(10_000_000_000, {operations: 9});
    const answers = await concurrently(9, (client, index) => client.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: jobs[0].operationIds[index], output: 1000})));
    expect(outcomes(answers)).toEqual(['over_job_cap', 'over_job_cap', 'over_job_cap', 'over_job_cap', 'reserved', 'reserved', 'reserved', 'reserved', 'reserved']);
    expect(await exposureOf(db, jobs[0].jobId)).toBe(5_000_000);
  });

  it('judges a reserve that waits for a limit change against the NEW limit, and a change that waits for a reserve carries the reservation', async () => {
    const admin = await committedAccount('administrator');
    const target = await committedAccount();
    await allowance(db, target.accountId, 2 * M);
    const exact = await round(db);
    const jobs = [await ledgerJob(db, target.accountId, 1), await ledgerJob(db, target.accountId, 1)];
    const CHANGE = 'select outcome, seq from api.set_usage_limit($1, $2, $3, $4, $5, $6, $7, $8)';
    const changeArgs = (limit: number, expectedSeq: number) => [`user:${admin.user.id}`, admin.accountId, admin.epoch, target.accountId, randomUUID(), 'change', limit, expectedSeq];
    const changing = await connect();
    const reserving = await connect();
    // The limit change holds the Account's lock; the reserve waits, and then finds $0.50 where $1.00 is asked.
    await changing.query('begin');
    expect((await changing.query(CHANGE, changeArgs(500_000, 1))).rows[0].outcome).toBe('changed');
    const reservingPid = await pidOf(reserving);
    const waiting = reserving.query(RESERVE, reserveArgs(target, {schedule: exact, operationId: jobs[0].operationIds[0], output: 1000}));
    await untilBlocked(reservingPid);
    await changing.query('commit');
    expect((await waiting).rows[0]).toMatchObject({outcome: 'insufficient_allowance', limit: 500_000, available: 500_000});
    // The reserve holds the lock; the change waits, and the successor carries the reservation.
    const holder = await connect();
    const changer = await connect();
    await holder.query('begin');
    expect((await holder.query(RESERVE, reserveArgs(target, {schedule: exact, operationId: jobs[1].operationIds[0], output: 400}))).rows[0].outcome).toBe('reserved');
    const changerPid = await pidOf(changer);
    const waitingChange = changer.query(CHANGE, changeArgs(1_000_000, 2));
    await untilBlocked(changerPid);
    await holder.query('commit');
    expect((await waitingChange).rows[0]).toMatchObject({outcome: 'changed', seq: 3});
    expect(await figuresOf(db, target.accountId)).toMatchObject({seq: 3, limit: 1_000_000, reserved: 400_000, settled: 0, available: 600_000});
  });

  it('lets a reserve wait for a settlement and then use the headroom it released', async () => {
    const a = await committedAccount();
    await allowance(db, a.accountId, M);
    const exact = await round(db);
    const jobs = [await ledgerJob(db, a.accountId, 1), await ledgerJob(db, a.accountId, 1)];
    expect((await reserveNow(db, a, {schedule: exact, operationId: jobs[0].operationIds[0], output: 1000})).outcome).toBe('reserved');
    await moveTo(db, jobs[0].operationIds[0], 'noncharge');
    // Without the settlement the allowance is full.
    expect((await reserveNow(db, a, {schedule: exact, operationId: jobs[1].operationIds[0], output: 1000})).outcome).toBe('insufficient_allowance');
    const settler = await connect();
    const reserver = await connect();
    await settler.query('begin');
    expect((await settler.query(SETTLE, settleArgs(a.accountId, {operationId: jobs[0].operationIds[0], classification: 'noncharge'}))).rows[0].outcome).toBe('settled');
    const reserverPid = await pidOf(reserver);
    const waiting = reserver.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: jobs[1].operationIds[0], output: 1000}));
    await untilBlocked(reserverPid);
    await settler.query('commit');
    expect((await waiting).rows[0].outcome).toBe('reserved');
    expect(await figuresOf(db, a.accountId)).toMatchObject({settled: 0, reserved: M, available: 0});
  });

  it('never lets a reservation land after a tombstone: a reserve that waits for api.record_tombstone finds the Project gone and answers `unavailable`', async () => {
    const a = await committedAccount();
    const exact = await round(db);
    const job = await ledgerJob(db, a.accountId, 1);
    const projectId = (await db.query('select project_id from jobs.jobs where id = $1', [job.jobId])).rows[0].project_id as string;
    const recorder = await connect();
    const reserving = await connect();
    await recorder.query('begin');
    expect((await recorder.query(`select outcome from api.record_tombstone('project', $1)`, [projectId])).rows[0].outcome).toBe('recorded');
    const reservingPid = await pidOf(reserving);
    const waiting = reserving.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: job.operationIds[0], output: 500}));
    await untilBlocked(reservingPid);
    await recorder.query('commit');
    expect((await waiting).rows[0]).toMatchObject({outcome: 'unavailable', reservation_id: null});
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 0, commands: 0});
  });

  it('lets a tombstone wait for a reservation that holds the Project: the reservation lands first, and nothing lands after', async () => {
    const a = await committedAccount();
    const exact = await round(db);
    const job = await ledgerJob(db, a.accountId, 2);
    const projectId = (await db.query('select project_id from jobs.jobs where id = $1', [job.jobId])).rows[0].project_id as string;
    const holder = await connect();
    const recorder = await connect();
    await holder.query('begin');
    expect((await holder.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: job.operationIds[0], output: 500}))).rows[0].outcome).toBe('reserved');
    const recorderPid = await pidOf(recorder);
    const recording = recorder.query(`select outcome from api.record_tombstone('project', $1)`, [projectId]);
    await untilBlocked(recorderPid);
    await holder.query('commit');
    expect((await recording).rows[0].outcome).toBe('recorded');
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 1});
    expect(await reserveNow(db, a, {schedule: exact, operationId: job.operationIds[1], output: 500})).toMatchObject({outcome: 'unavailable'});
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 1});
  });

  it('serializes a reservation and a dispatch of the same operation: a dispatch that commits first makes the operation `not_reservable`, and a reservation that commits first is kept by the dispatch', async () => {
    const a = await committedAccount();
    const exact = await round(db);
    const job = await ledgerJob(db, a.accountId, 2);
    const ADVANCE = 'select outcome, state from api.advance_operation($1, $2, $3, $4, $5, $6)';
    const advanceArgs = (operationId: string) => [a.accountId, a.epoch, randomUUID(), operationId, 'dispatched', null];
    // The dispatch holds the operation; the reserve waits for it and then finds a dispatched operation.
    const dispatcher = await connect();
    const reserver = await connect();
    await dispatcher.query('begin');
    expect((await dispatcher.query(ADVANCE, advanceArgs(job.operationIds[0]))).rows[0]).toMatchObject({outcome: 'advanced', state: 'dispatched'});
    const reserverPid = await pidOf(reserver);
    const waiting = reserver.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: job.operationIds[0], output: 500}));
    await untilBlocked(reserverPid);
    await dispatcher.query('commit');
    expect((await waiting).rows[0]).toMatchObject({outcome: 'not_reservable', state: 'dispatched', reservation_id: null});
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 0, commands: 0});
    // The reservation holds the operation; the dispatch waits for it, and then goes on: the reservation was of a planned operation, and it is kept.
    const holder = await connect();
    const advancer = await connect();
    await holder.query('begin');
    expect((await holder.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: job.operationIds[1], output: 500}))).rows[0].outcome).toBe('reserved');
    const advancerPid = await pidOf(advancer);
    const advancing = advancer.query(ADVANCE, advanceArgs(job.operationIds[1]));
    await untilBlocked(advancerPid);
    await holder.query('commit');
    expect((await advancing).rows[0]).toMatchObject({outcome: 'advanced', state: 'dispatched'});
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 1, commands: 1});
    expect((await db.query('select state from jobs.operations where id = $1', [job.operationIds[1]])).rows[0].state).toBe('dispatched');
    expect((await figuresOf(db, a.accountId)).reserved).toBe(500_000);
  });

  it('serializes a reservation and the abandonment of a failed attempt: the operation is abandoned with no reservation, or abandoned with a reservation that settles `unused`', async () => {
    const a = await committedAccount();
    const exact = await round(db);
    const first = await ledgerJob(db, a.accountId, 1);
    const second = await ledgerJob(db, a.accountId, 1);
    const MOVE = 'select outcome, state from api.move_attempt($1, $2, $3, $4, $5, $6)';
    const failArgs = (attemptId: string) => [a.accountId, a.epoch, randomUUID(), attemptId, 'failed', 'step_failed'];
    // The attempt fails first (its planned operation is abandoned); the reserve waits for it and is refused.
    const failing = await connect();
    const reserver = await connect();
    await failing.query('begin');
    expect((await failing.query(MOVE, failArgs(first.attemptId))).rows[0]).toMatchObject({outcome: 'moved', state: 'failed'});
    const reserverPid = await pidOf(reserver);
    const waiting = reserver.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: first.operationIds[0], output: 500}));
    await untilBlocked(reserverPid);
    await failing.query('commit');
    expect((await waiting).rows[0]).toMatchObject({outcome: 'not_reservable', state: 'abandoned', reservation_id: null});
    expect((await db.query('select state from jobs.operations where id = $1', [first.operationIds[0]])).rows[0].state).toBe('abandoned');
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 0, commands: 0});
    // The reservation comes first; the abandonment waits for it, and then abandons an operation that holds a reservation: the way out is `unused`, which gives the headroom back.
    const holder = await connect();
    const mover = await connect();
    await holder.query('begin');
    expect((await holder.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: second.operationIds[0], output: 500}))).rows[0].outcome).toBe('reserved');
    const moverPid = await pidOf(mover);
    const moving = mover.query(MOVE, failArgs(second.attemptId));
    await untilBlocked(moverPid);
    await holder.query('commit');
    expect((await moving).rows[0]).toMatchObject({outcome: 'moved', state: 'failed'});
    expect((await db.query('select state from jobs.operations where id = $1', [second.operationIds[0]])).rows[0].state).toBe('abandoned');
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 1});
    expect((await figuresOf(db, a.accountId)).reserved).toBe(500_000);
    // Nothing is stuck: the abandoned operation still replays its reservation, and settles `unused`.
    expect(await reserveNow(db, a, {schedule: exact, operationId: second.operationIds[0], output: 100})).toMatchObject({outcome: 'already_reserved'});
    expect(await settleNow(db, a.accountId, {operationId: second.operationIds[0], classification: 'unused'})).toMatchObject({outcome: 'settled', settled: 0, released: 500_000});
    expect(await figuresOf(db, a.accountId)).toMatchObject({reserved: 0, settled: 0});
  });

  it('settles a reservation once however many ask together: one `settled`, the others `replayed` for the same evidence and `already_settled` for another, and one settlement', async () => {
    const a = await committedAccount();
    const exact = await round(db);
    const job = await ledgerJob(db, a.accountId, 2);
    for (const operationId of job.operationIds) {
      expect((await reserveNow(db, a, {schedule: exact, operationId, output: 1000})).outcome).toBe('reserved');
      await moveTo(db, operationId, 'completed');
    }
    // The same evidence under six command IDs.
    const same = await concurrently(6, (client) => client.query(SETTLE, settleArgs(a.accountId, {operationId: job.operationIds[0], classification: 'evidence', input: 0, output: 400})));
    expect(outcomes(same)).toEqual(['replayed', 'replayed', 'replayed', 'replayed', 'replayed', 'settled']);
    expect(new Set(same.map((answer) => (answer as {rows: {settlement_id: string}[]}).rows[0].settlement_id)).size).toBe(1);
    expect(await count(db, 'select count(*) as n from usage.settlements where reservation_id = (select id from usage.reservations where operation_id = $1)', [job.operationIds[0]])).toBe(1);
    // Different evidence under different command IDs: one wins, the other is told what was settled.
    const different = await concurrently(2, (client, index) => client.query(SETTLE, settleArgs(a.accountId, {operationId: job.operationIds[1], classification: 'evidence', input: 0, output: 300 + index})));
    expect(outcomes(different)).toEqual(['already_settled', 'settled']);
    expect(await count(db, 'select count(*) as n from usage.settlements where reservation_id = (select id from usage.reservations where operation_id = $1)', [job.operationIds[1]])).toBe(1);
    expect(await ledgerOf(db, a.accountId)).toMatchObject({reservations: 2, settlements: 2, commands: 2 + 6 + 1});
    const settled = (await db.query('select classification, count(*)::int as n from usage.settlements where account_id = $1 group by 1', [a.accountId])).rows;
    expect(settled).toEqual([{classification: 'evidence', n: 2}]);
    expect(await figuresOf(db, a.accountId)).toMatchObject({reserved: 0});
  });

  it('is one winner every time when an Account is disabled while a reservation runs: the reservation commits first, or it is `denied`', async () => {
    const outcomesSeen = new Set<string>();
    for (let turn = 0; turn < 4; turn += 1) {
      const {a, exact, jobs} = await world(25 * M, {});
      const [one, two] = await Promise.all([connect(), connect()]);
      const [reserving, disabling] = await Promise.all([
        one.query(RESERVE, reserveArgs(a, {schedule: exact, operationId: jobs[0].operationIds[0], output: 500})),
        two.query(`select outcome from api.disable_account('seed:local:usage', $1)`, [a.accountId]),
      ]);
      expect(disabling.rows[0].outcome).toBe('disabled');
      outcomesSeen.add(reserving.rows[0].outcome);
      expect(['reserved', 'denied']).toContain(reserving.rows[0].outcome);
      expect(await count(db, 'select count(*) as n from usage.reservations where account_id = $1', [a.accountId])).toBe(reserving.rows[0].outcome === 'reserved' ? 1 : 0);
    }
    expect([...outcomesSeen].every((outcome) => outcome === 'reserved' || outcome === 'denied')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed module over REST, as the application will call it (committed data)', () => {
  it('quotes, reserves, replays, refuses and settles through lib/usage-reservations.ts', async () => {
    const a = await committedAccount();
    const std = await schedule(db);
    const exact = await round(db);
    const elsewhere = await schedule(db, {provider: `${provider}-b`});
    const job = await ledgerJob(db, a.accountId, 4);
    const operation = {accountId: a.accountId, epoch: a.epoch};
    const calculation = (sched: Sched) => ({rateScheduleId: sched.id, provider: sched.provider, model: sched.model, apiVersion: sched.apiVersion, requestBytes: 10_000, imageCount: 2, outputLimit: 16_000});

    expect(await quoteCost(operation, calculation(std), {env})).toEqual({outcome: 'quoted', inputBound: 24_200, inputUnits: 24_200, outputUnits: 16_000, microdollars: 312_600});
    expect(await quoteCost(operation, {...calculation(std), options: {cache: true}}, {env})).toEqual({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: 'cache'});
    expect(await quoteCost({accountId: a.accountId, epoch: 9}, calculation(std), {env})).toEqual({outcome: 'denied'});

    const commandId = randomUUID();
    const [first, second, third, fourth] = job.operationIds;
    const made = await reserveCost(operation, {...calculation(std), commandId, operationId: first}, {env});
    expect(made).toMatchObject({outcome: 'reserved', reservation: {operationId: first, jobId: job.jobId, rateScheduleId: std.id, inputBound: 24_200, reservedMicrodollars: 312_600}});
    expect(await reserveCost(operation, {...calculation(std), commandId, operationId: first}, {env})).toEqual(made.outcome === 'reserved' ? {outcome: 'replayed', reservation: made.reservation} : made);
    expect(await reserveCost(operation, {...calculation(std), commandId, operationId: first, outputLimit: 100}, {env})).toEqual({outcome: 'reused'});
    expect(await reserveCost(operation, {...calculation(std), commandId: randomUUID(), operationId: first, outputLimit: 100}, {env})).toMatchObject({outcome: 'already_reserved'});
    expect(await reserveCost({accountId: a.accountId, epoch: 9}, {...calculation(std), commandId: randomUUID(), operationId: first}, {env})).toEqual({outcome: 'denied'});
    expect(await reserveCost(operation, {...calculation(std), commandId: randomUUID(), operationId: randomUUID()}, {env})).toEqual({outcome: 'unavailable'});
    expect(await reserveCost(operation, {...calculation(std), commandId: randomUUID(), operationId: second, options: {batch: true}}, {env})).toEqual({
      outcome: 'unavailable_bound', reason: 'unsupported_option', detail: 'batch', cost: {requested: null, limit: 25 * M, used: 312_600, available: 25 * M - 312_600},
    });
    expect(await reserveCost(operation, {...calculation(exact), commandId: randomUUID(), operationId: second, outputLimit: 1001}, {env})).toEqual({
      outcome: 'over_operation_cap', cost: {requested: 1_001_000, limit: 1_000_000, used: 0, available: 1_000_000},
    });
    // An operation under a provider no incident touches.
    expect(await reserveCost(operation, {...calculation(elsewhere), commandId: randomUUID(), operationId: third}, {env})).toMatchObject({outcome: 'reserved'});

    // Settling takes the Account alone: not settleable while the operation is planned, then evidence above the reservation, which makes an incident and blocks the provider.
    expect(await settleCost({accountId: a.accountId}, {commandId: randomUUID(), operationId: first, classification: 'unused'}, {env})).toEqual({outcome: 'not_settleable', state: 'planned'});
    await moveTo(db, first, 'completed');
    const evidence = {inputTokens: 30_000, outputTokens: 16_000, returnedModel: 'claude-test-20260101'};
    const settlement = await settleCost({accountId: a.accountId}, {commandId: randomUUID(), operationId: first, classification: 'evidence', evidence}, {env});
    expect(settlement).toMatchObject({outcome: 'settled', settlement: {operationId: first, classification: 'evidence', settledMicrodollars: 330_000, releasedMicrodollars: 312_600, overMicrodollars: 17_400}});
    expect(settlement.outcome === 'settled' && settlement.settlement.incidentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await settleCost({accountId: a.accountId}, {commandId: randomUUID(), operationId: first, classification: 'evidence', evidence}, {env})).toMatchObject({outcome: 'replayed'});
    expect(await settleCost({accountId: a.accountId}, {commandId: randomUUID(), operationId: first, classification: 'noncharge'}, {env})).toMatchObject({outcome: 'already_settled'});
    expect(await settleCost({accountId: a.accountId}, {commandId: randomUUID(), operationId: randomUUID(), classification: 'noncharge'}, {env})).toEqual({outcome: 'unavailable'});
    expect(await reserveCost(operation, {...calculation(std), commandId: randomUUID(), operationId: second}, {env})).toMatchObject({outcome: 'provider_blocked', cost: {requested: 312_600}});
    expect(await reserveCost(operation, {...calculation(elsewhere), commandId: randomUUID(), operationId: fourth}, {env})).toMatchObject({outcome: 'reserved'});

    // A disabled Account is `denied` for a reservation and still settles what it holds: the money is never stranded.
    await db.query(`select * from api.disable_account('seed:local:usage', $1)`, [a.accountId]);
    expect(await reserveCost(operation, {...calculation(std), commandId: randomUUID(), operationId: second}, {env})).toEqual({outcome: 'denied'});
    await moveTo(db, third, 'abandoned');
    expect(await settleCost({accountId: a.accountId}, {commandId: randomUUID(), operationId: third, classification: 'unused'}, {env})).toMatchObject({
      outcome: 'settled', settlement: {classification: 'unused', settledMicrodollars: 0, releasedMicrodollars: 312_600, overMicrodollars: 0, incidentId: null},
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries the Story 2.6 tables and functions', () => {
  const apiSignatures = [
    'api.quote_cost(uuid,bigint,uuid,text,text,text,bigint,integer,integer,integer,jsonb)',
    'api.reserve_cost(uuid,bigint,uuid,uuid,uuid,text,text,text,bigint,integer,integer,jsonb)',
    'api.settle_cost(uuid,uuid,uuid,text,bigint,bigint,text)',
  ];
  const internalSignatures = [
    'usage.input_bound(bigint,integer)', 'usage.price(uuid,numeric,numeric,integer)', 'usage.job_exposure(uuid)', 'usage.overhead_tokens()', 'usage.image_tokens()', 'usage.margin_percent()',
    'usage.input_ceiling()', 'usage.output_ceiling()', 'usage.request_ceiling()', 'usage.operation_cap()', 'usage.job_cap()', 'usage.ambiguity_deadline()',
  ];
  const newTables = ['usage.rate_schedules', 'usage.reservations', 'usage.settlements', 'usage.overrun_incidents', 'usage.commands'];

  it('answers ok to the service role, reads the five new tables, no longer reads the stand-in, and looks for the functions (fifty in all)', async () => {
    await inTx(async (client) => {
      expect((await rows(client, 'service_role', 'select ok from api.preflight()'))[0]).toEqual({ok: true});
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [...newTables, 'rv.reserved_microdollars', 'st.released_microdollars', 'oi.cleared_by', 'uc.subject_id', 'rs.multiplier_den', ...apiSignatures, ...internalSignatures, 'Story 2.6 migration',
      // Every earlier probe is still there.
      'Story 1.5 migration', 'Story 2.4 migration', 'Story 2.11 migration', 'Story 2.12 migration', 'usage.periods', 'jobs.commands', 'lifecycle.heartbeats', 'private-files']) {
      expect(definition, needle).toContain(needle);
    }
    expect(definition).not.toContain('fixture_figures');
    const check = definition.indexOf('where not has_function_privilege');
    const executable = definition.slice(definition.lastIndexOf('unnest(array[', check), check);
    expect(executable.match(/'api\.[a-z_]+\([^']*\)'/g)).toHaveLength(50);
    for (const signature of apiSignatures) expect(executable, signature).toContain(`'${signature}'`);
    expect(definition.indexOf('private-files')).toBeGreaterThan(definition.indexOf('delete Auth identities'));
  });

  it.each([...apiSignatures, ...internalSignatures])('fails the build with one line naming %s when it is missing, and says which migration is not applied', async (signature) => {
    await inTx(async (client) => {
      const spec = (await client.query(`select to_regprocedure($1)::text as name`, [signature])).rows[0].name;
      await client.query(`drop function ${spec} cascade`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain(signature);
        expect(result.message).toContain('Story 2.6');
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

  it.each(newTables)('fails, naming a permission and not answering ok, when the role it runs as cannot read %s', async (blocked) => {
    const everything = [
      'identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions', 'projects.request_images',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts',
      'artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance', 'artifacts.retained_pictures',
      'lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats', 'usage.periods', 'jobs.jobs', 'jobs.attempts', 'jobs.steps', 'jobs.operations', 'jobs.commands', ...newTables,
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

// ---------------------------------------------------------------------------------------------------
describe('closure: no browser role and not the gateway reaches the new tables or functions', () => {
  it('has nothing for anon, authenticated or the gateway role: no schema usage, no table privilege, no function execute', async () => {
    for (const role of ['anon', 'authenticated', 'nova3d_gateway']) {
      expect((await db.query(`select has_schema_privilege($1, 'usage', 'usage') as can`, [role])).rows[0].can, role).toBe(false);
      const {rows: functions} = await db.query(
        `select p.oid::regprocedure::text as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where ((n.nspname = 'usage') or (n.nspname = 'api' and p.proname in ('quote_cost', 'reserve_cost', 'settle_cost'))) and has_function_privilege($1, p.oid, 'execute')`,
        [role],
      );
      expect(functions, role).toEqual([]);
    }
  });

  it('is unreachable over REST for the anon key, an anon token and the signed-in user\'s own token (the three functions, with the Account\'s own IDs)', async () => {
    const a = await account(db);
    committed.users.push(a.user.id);
    const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    /** A token PostgREST accepts for `role`, signed with the local stack's JWT secret: what Auth would issue to that user. */
    const tokenFor = (role: 'authenticated' | 'anon', userId: string) => {
      const claims = {iss: `${stack.apiUrl}/auth/v1`, aud: 'authenticated', role, sub: userId, session_id: randomUUID(), exp: Math.floor(Date.now() / 1000) + 600};
      const unsigned = `${base64url({alg: 'HS256', typ: 'JWT'})}.${base64url(claims)}`;
      return `${unsigned}.${createHmac('sha256', jwtSecretOf(stack)).update(unsigned).digest('base64url')}`;
    };
    const tokens = [
      ['the anon key', stack.anonKey],
      ['an anon-role token', tokenFor('anon', randomUUID())],
      ['the authenticated token of the Account\'s own user', tokenFor('authenticated', a.user.id)],
    ] as const;
    const bodies: Record<string, unknown> = {
      quote_cost: {p_account_id: a.accountId, p_epoch: 1, p_rate_schedule_id: randomUUID(), p_provider: 'x', p_model: 'x', p_api_version: '1', p_request_bytes: 1, p_image_count: 0, p_output_limit: 1, p_request_count: 1, p_options: {}},
      reserve_cost: {p_account_id: a.accountId, p_epoch: 1, p_command_id: randomUUID(), p_operation_id: randomUUID(), p_rate_schedule_id: randomUUID(), p_provider: 'x', p_model: 'x', p_api_version: '1', p_request_bytes: 1, p_image_count: 0, p_output_limit: 1, p_options: {}},
      settle_cost: {p_account_id: a.accountId, p_command_id: randomUUID(), p_operation_id: randomUUID(), p_classification: 'unused', p_input_tokens: null, p_output_tokens: null, p_returned_model: null},
    };
    const before = await ledgerOf(db, a.accountId);
    for (const [label, token] of tokens) {
      for (const [name, body] of Object.entries(bodies)) {
        const response = await fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: {apikey: stack.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-profile': 'api'},
          body: JSON.stringify(body),
        });
        const text = await response.text();
        expect(response.status, `${label} calls ${name}`).toBeGreaterThanOrEqual(401);
        expect(response.status, `${label} calls ${name}`).toBeLessThan(500);
        // 42501 proves the request ran as that role and was refused by the database, not by a bad request.
        expect(JSON.parse(text).code, `${label} calls ${name}`).toBe('42501');
        expect(text).not.toContain(a.accountId);
      }
    }
    expect(await ledgerOf(db, a.accountId)).toEqual(before);
  });
});
