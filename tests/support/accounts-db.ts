import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {afterAll, beforeAll} from 'vitest';
import {insertAmrClaim, insertAuthSession, insertAuthUser, removeAccountData, type TestUser, type UserOptions} from './accounts-data';
import {localStack} from './stack';

export type {TestUser, UserOptions};
export {insertAmrClaim};

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

export type Attempt = {ok: true; rows: Record<string, any>[]} | {ok: false; message: string; code: string | undefined};

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
    await removeAccountData(client, {...committed, users, emails});
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
  const addUser = (client: Client, options: UserOptions = {}): Promise<TestUser> => insertAuthUser(client, options);

  /** A live Auth session of the user (removed with the user), which a session grant needs. */
  const addSession = (client: Client, userId: string): Promise<string> => insertAuthSession(client, userId);

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
      // Epochs are bigint, which node-postgres returns as text; they are small, so the harness hands back numbers.
      authorize: (userId: string, sessionId: string) =>
        call('select state, account_id, workspace_id, role, epoch::integer as epoch from api.authorize_session($1, $2)', [userId, sessionId]),
      issueGrant: (userId: string, sessionId: string) => call('select outcome, account_id, epoch::integer as epoch from api.issue_grant($1, $2)', [userId, sessionId]),
      revokeGrants: (options: {session?: string; user?: string; account?: string; except?: string; below?: number; actor?: string; reason?: string}) =>
        call('select revoked, live from api.revoke_grants($1, $2, $3, $4, $5, $6, $7)', [
          options.actor ?? 'seed:local:test',
          options.reason ?? 'test',
          options.session ?? null,
          options.user ?? null,
          options.account ?? null,
          options.except ?? null,
          options.below ?? null,
        ]),
      confirmRegistration: (userId: string, commandId: string, hash: string) => call('select confirmed from api.confirm_registration($1, $2, $3)', [userId, commandId, hash]),
      preflight: () => call('select ok from api.preflight()', []),
      startStepUp: (userId: string, sessionId: string, actionClass: string, secretHash: string, verifierHash: string) =>
        call('select outcome, expires_at from api.start_step_up($1, $2, $3, $4, $5)', [userId, sessionId, actionClass, secretHash, verifierHash]),
      completeStepUp: (userId: string, sessionId: string, secretHash: string, verifierHash: string) =>
        call('select outcome, reason, action_class from api.complete_step_up($1, $2, $3, $4)', [userId, sessionId, secretHash, verifierHash]),
      issueCsrf: (userId: string, sessionId: string, hash: string) => call('select outcome from api.issue_csrf($1, $2, $3)', [userId, sessionId, hash]),
      verifyCsrf: (userId: string, sessionId: string, hash: string) => call('select outcome from api.verify_csrf($1, $2, $3)', [userId, sessionId, hash]),
      useMarker: (userId: string, sessionId: string, actionClass: string, startedAfter: Date | string | null = null) =>
        call('select outcome from api.use_marker($1, $2, $3, $4)', [userId, sessionId, actionClass, startedAfter]),
      raiseEpoch: (accountId: string, actor = 'seed:local:test') =>
        call('select account_id, epoch::integer as epoch from api.raise_authorization_epoch($1, $2)', [accountId, actor]),
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

  return {db, connect, committed, cleanup, inTx, addUser, addSession, attempt, rows, api, count, invitationStatus, failuresOf};
}
