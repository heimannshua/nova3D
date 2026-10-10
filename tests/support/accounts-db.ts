import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll, beforeAll} from 'vitest';
import {localStack} from './stack';

// Shared helpers for the Story 1.3 integration tests, which run against the Supabase CLI stack. Most
// cases run inside a transaction that is rolled back, as the service role, so they leave nothing
// behind. The cases that need real commits (concurrent connections, the REST API, the seed command) use
// unique data, register it in `committed`, and have it removed afterwards; audit events are
// append-only and stay.

export const stack = localStack();
export const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export const originHash = () => randomBytes(32).toString('hex');
export const codeHash = () => randomBytes(32).toString('hex');
export const tag = () => randomBytes(4).toString('hex');
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type TestUser = {id: string; email: string; subject: string};
export type Attempt = {ok: true; rows: Record<string, any>[]} | {ok: false; message: string; code: string | undefined};

export type UserOptions = {
  email?: string;
  subject?: string;
  provider?: string;
  verified?: boolean;
  confirmed?: boolean;
  identity?: boolean;
  anonymous?: boolean;
  /** A ban that has not ended. */
  banned?: boolean;
  /** A ban that ended an hour ago. */
  banExpired?: boolean;
  /** Soft-deleted by Auth. */
  deleted?: boolean;
  /** The address Google reports on the identity, when it differs from the Auth user's. */
  identityEmail?: string;
};

export const generic = {outcome: 'refused', account_id: null, workspace_id: null, role: null, replayed: false};
export const withoutCommand = ({command_id: _ignored, ...rest}: Record<string, unknown>) => rest;

/** Connects a database client for the file, and removes what the file committed when it is done. */
export function createHarness() {
  const db = new Client({connectionString: stack.dbUrl});
  const opened: Client[] = [db];
  const committed = {
    users: [] as string[],
    emails: [] as string[],
    origins: [] as string[],
    hashes: [] as string[],
    invitationIds: [] as string[],
  };

  /** Another connection, for tests that need two sessions at once. */
  async function connect() {
    const client = new Client({connectionString: stack.dbUrl});
    await client.connect();
    opened.push(client);
    return client;
  }

  /** Removes committed test data in dependency order (the audit family is append-only and stays). */
  async function cleanup(client: Client = db, users: string[] = committed.users, emails: string[] = committed.emails) {
    await client.query('begin');
    try {
      const accounts = `(select id from identity.accounts where user_id = any($1))`;
      await client.query(`delete from identity.registration_commands where account_id in ${accounts}`, [users]);
      await client.query(`delete from identity.invitations where redeemed_account_id in ${accounts} or code_hash = any($2) or id = any($3)`, [users, committed.hashes, committed.invitationIds]);
      await client.query(`delete from identity.preauthorizations where account_id in ${accounts} or email = any($2)`, [users, emails]);
      await client.query(`delete from projects.workspaces where account_id in ${accounts}`, [users]);
      await client.query('delete from identity.accounts where user_id = any($1)', [users]);
      await client.query('delete from auth.users where id = any($1)', [users]);
      if (committed.origins.length) {
        // Give back the global budget these origins used, so repeated local runs cannot trip the hourly limit.
        await client.query(
          `with spent as (
             select (window_id / 4) as global_window, sum(failures) as failures
               from identity.rate_limit_counters where scope = 'origin' and key_hash = any($1) group by 1
           )
           update identity.rate_limit_counters g set failures = greatest(g.failures - spent.failures, 0)
             from spent where g.scope = 'global' and g.window_id = spent.global_window`,
          [committed.origins],
        );
        await client.query('delete from identity.rate_limit_counters where key_hash = any($1)', [committed.origins]);
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }

  beforeAll(async () => {
    await db.connect();
  });
  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await Promise.all(opened.map((client) => client.end().catch(() => undefined)));
    }
  });

  /** Runs the work inside a transaction that is always rolled back. */
  async function inTx<T>(work: (client: Client) => Promise<T>) {
    await db.query('begin');
    try {
      return await work(db);
    } finally {
      await db.query('rollback');
    }
  }

  /** An Auth user as GoTrue would leave it after a Google sign-in (inserted directly: the hook only guards GoTrue). */
  async function addUser(client: Client, options: UserOptions = {}): Promise<TestUser> {
    const id = randomUUID();
    const email = options.email ?? `u-${id.slice(0, 8)}@example.test`;
    const subject = options.subject ?? `sub-${id}`;
    const provider = options.provider ?? 'google';
    const verified = options.verified !== false;
    await client.query(
      `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_anonymous, banned_until, deleted_at, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, $4, $5, $6, $7, $8, now(), now())`,
      [
        id,
        email,
        options.confirmed === false ? null : new Date(),
        JSON.stringify({provider, providers: [provider]}),
        JSON.stringify({email_verified: verified}),
        options.anonymous ?? false,
        options.banned ? new Date(Date.now() + 86_400_000) : options.banExpired ? new Date(Date.now() - 3_600_000) : null,
        options.deleted ? new Date() : null,
      ],
    );
    if (options.identity !== false) {
      await client.query(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ($1, $2, $3, $4, now(), now())`,
        [subject, id, JSON.stringify({sub: subject, email: options.identityEmail ?? email, email_verified: verified}), provider],
      );
    }
    return {id, email, subject};
  }

  /** One statement as a role, isolated by a savepoint so a denial does not abort the surrounding transaction. */
  async function attempt(client: Client, role: string | null, sql: string, params: unknown[] = []): Promise<Attempt> {
    await client.query('savepoint attempt');
    try {
      if (role) await client.query(`set local role ${role}`);
      const result = await client.query(sql, params);
      if (role) await client.query('reset role');
      await client.query('release savepoint attempt');
      return {ok: true, rows: result.rows};
    } catch (error) {
      await client.query('rollback to savepoint attempt');
      return {ok: false, message: (error as Error).message, code: (error as {code?: string}).code};
    }
  }

  async function rows(client: Client, role: string | null, sql: string, params: unknown[] = []) {
    const result = await attempt(client, role, sql, params);
    if (!result.ok) throw new Error(result.message);
    return result.rows;
  }

  /** The `api` surface as the service role does when it calls through PostgREST. Needs an open transaction. */
  function api(client: Client) {
    const call = async (sql: string, params: unknown[]) => (await rows(client, 'service_role', sql, params))[0];
    return {
      register: (userId: string, hash: string, options: {command?: string; origin?: string} = {}) =>
        call('select * from api.register_with_code($1, $2, $3, $4)', [userId, options.command ?? randomUUID(), hash, options.origin ?? originHash()]),
      consume: (userId: string) => call('select * from api.consume_preauthorization($1)', [userId]),
      status: (userId: string) => call('select * from api.account_status($1)', [userId]),
      seed: (email: string, role: string, actor = 'seed:local:test') => call('select * from api.seed_preauthorization($1, $2, $3)', [email, role, actor]),
      withdraw: (email: string, actor = 'seed:local:test') => call('select * from api.withdraw_preauthorization($1, $2)', [email, actor]),
      // A general code replaces the current one by default, so a test never depends on (or fails because of) a
      // general code already in this local database; it is rolled back with the rest of the transaction.
      issue: (hash: string, kind: string, label: string | null, actor = 'seed:local:test', replace = kind === 'general') =>
        call('select * from api.issue_invitation($1, $2, $3, $4, $5)', [hash, kind, label, actor, replace]),
      revoke: (options: {id?: string; hash?: string}, actor = 'seed:local:test') =>
        call('select * from api.revoke_invitation($1, $2, $3)', [actor, options.id ?? null, options.hash ?? null]),
      list: async () => rows(client, 'service_role', 'select * from api.list_invitations()'),
    };
  }

  const count = async (client: Client, sql: string, params: unknown[] = []) => Number((await client.query(sql, params)).rows[0].n);
  const invitationStatus = async (client: Client, hash: string) => (await client.query('select status from identity.invitations where code_hash = $1', [hash])).rows[0]?.status;
  const failuresOf = async (client: Client, origin: string) =>
    Number((await client.query(`select coalesce(sum(failures), 0) as n from identity.rate_limit_counters where scope = 'origin' and key_hash = $1`, [origin])).rows[0].n);

  return {db, connect, committed, cleanup, inTx, addUser, attempt, rows, api, count, invitationStatus, failuresOf};
}
