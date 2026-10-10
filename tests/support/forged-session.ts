import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {hashClientAddress, hashKey, issueInvitation, registerWithCode, revokeInvitation, seedPreauthorization} from '../../lib/accounts';
import {insertAuthUser, releaseOrigins, removeAccountData, type CommittedData, type TestUser, type UserOptions} from './accounts-data';
import {sessionCookieName, sessionCookieValue} from './session-cookie';
import {serverEnv} from './server-env';
import {jwtSecretOf, localStack} from './stack';

// Local Google sign-in cannot be driven, so the browser tests forge a session: a Google user and an
// `auth.sessions` row go into the local stack's database, an HS256 access token is signed with the stack's
// JWT secret (with `session_id`), and the @supabase/ssr cookie is set in the browser. Auth still validates
// the token, so the application's real getUser() path runs: only the Google round trip is skipped.

export type ForgedUser = TestUser & {sessionId: string; cookie: {name: string; value: string}};

export function accountsWorld() {
  const stack = localStack();
  const env = serverEnv();
  const db = new Client({connectionString: stack.dbUrl});
  const committed: CommittedData = {users: [], emails: [], origins: [], hashes: [], invitationIds: []};
  // Requests from a test browser carry no platform address header, so they all share this one origin.
  const sharedOrigin = hashClientAddress(null, hashKey(env, 'RATE_LIMIT_HASH_KEY'));
  committed.origins.push(sharedOrigin);

  async function connect() {
    await db.connect();
  }

  /** Removes everything this world created (the append-only audit events stay) and closes the connection. */
  async function close() {
    try {
      await removeAccountData(db, committed);
    } finally {
      await db.end();
    }
  }

  /**
   * A Google user with a live Auth session and no Account: what a stranger holds after Google sign-in.
   * The token-like columns are empty strings, not NULL, because Auth reads them into strings.
   */
  async function signedInUser(options: UserOptions = {}): Promise<ForgedUser> {
    const user = await insertAuthUser(db, options);
    committed.users.push(user.id);
    committed.emails.push(user.email);
    await db.query(
      `update auth.users set confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '',
         email_change_token_current = '', phone_change = '', phone_change_token = '', reauthentication_token = '' where id = $1`,
      [user.id],
    );
    const sessionId = randomUUID();
    await db.query(`insert into auth.sessions (id, user_id, created_at, updated_at, aal, refreshed_at) values ($1, $2, now(), now(), 'aal1', now())`, [sessionId, user.id]);
    const value = sessionCookieValue({supabaseUrl: stack.apiUrl, userId: user.id, email: user.email, sessionId, jwtSecret: jwtSecretOf(stack)});
    return {...user, sessionId, cookie: {name: sessionCookieName(env.NEXT_PUBLIC_SUPABASE_URL!), value}};
  }

  /** A new named invitation code, issued the way the audited seed command issues one, under the server's key. */
  async function issueCode(label: string) {
    const issued = await issueInvitation({kind: 'named', label, actor: 'seed:local:e2e'}, {env});
    if (issued.outcome !== 'issued') throw new Error('The invitation code was not issued.');
    committed.invitationIds.push(issued.invitationId);
    return {code: issued.code, invitationId: issued.invitationId};
  }

  /** Pre-authorizes an address the way the audited seed command does. Removed with the world (the address is registered for cleanup). */
  async function preauthorize(email: string) {
    committed.emails.push(email);
    const receipt = await seedPreauthorization({email, role: 'member', actor: 'seed:local:e2e'}, {env});
    if (!receipt.created) throw new Error('The address was already pre-authorized.');
    return receipt;
  }

  /** Revokes an unused code the way the audited seed command does. */
  async function revokeCode(invitationId: string) {
    const receipt = await revokeInvitation({actor: 'seed:local:e2e', invitationId}, {env});
    if (receipt.outcome !== 'revoked') throw new Error(`The test code was not revoked (${receipt.outcome}).`);
  }

  /** Gives the user an Account by redeeming a fresh code, exactly as the registration screen does. */
  async function activate(user: ForgedUser) {
    const {code} = await issueCode(`e2e ${user.id.slice(0, 8)}`);
    const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code, clientAddress: null}, {env});
    if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
    return receipt;
  }

  /** Forgets the failures the shared test origin has counted, so the 5-per-15-minutes limit never trips between tests. */
  async function resetLimiter() {
    await releaseOrigins(db, [sharedOrigin]);
  }

  const setStatus = (user: TestUser, status: 'active' | 'disabled') => db.query('update identity.accounts set status = $2 where user_id = $1', [user.id, status]);
  const accountOf = async (user: TestUser) => (await db.query('select id, status, role, google_subject, source from identity.accounts where user_id = $1', [user.id])).rows[0];
  const workspacesOf = async (user: TestUser) =>
    Number((await db.query('select count(*) as n from projects.workspaces w join identity.accounts a on a.id = w.account_id where a.user_id = $1', [user.id])).rows[0].n);
  const commandsOf = async (user: TestUser) =>
    (await db.query('select c.command_id from identity.registration_commands c join identity.accounts a on a.id = c.account_id where a.user_id = $1', [user.id])).rows.map((row) => row.command_id as string);
  const invitationStatus = async (invitationId: string) => (await db.query('select status from identity.invitations where id = $1', [invitationId])).rows[0]?.status as string | undefined;
  const sessionExists = async (sessionId: string) => (await db.query('select 1 from auth.sessions where id = $1', [sessionId])).rowCount === 1;

  return {env, stack, db, connect, close, signedInUser, issueCode, revokeCode, preauthorize, activate, resetLimiter, setStatus, accountOf, workspacesOf, commandsOf, invitationStatus, sessionExists};
}

export type AccountsWorld = ReturnType<typeof accountsWorld>;
