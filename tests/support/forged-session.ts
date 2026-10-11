import {randomBytes, randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {adoptPreferences, checkMarker, hashClientAddress, hashKey, issueGrant, issueInvitation, raiseAuthorizationEpoch, registerWithCode, revokeInvitation, revokeSessionGrant, seedPreauthorization, startStepUp, type MarkerOutcome} from '../../lib/accounts';
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

  /**
   * Gives the user an Account by redeeming a fresh code, exactly as the registration screen does, and issues the
   * grant of their forged session, as the application does when a session becomes an Account's. Pass
   * `{grant: false}` for a session that predates session grants (an existing session at the cutover).
   */
  async function activate(user: ForgedUser, options: {grant?: boolean} = {}) {
    const {code} = await issueCode(`e2e ${user.id.slice(0, 8)}`);
    const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code, clientAddress: null}, {env});
    if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
    if (options.grant !== false) await grant(user, user.sessionId);
    return receipt;
  }

  /**
   * Registers the user with a fresh code under the given command ID and issues NO grant: what a registration
   * whose answer was lost leaves behind (the Account exists, the session has no grant). Returns the code, which
   * the person typed and the form still holds.
   */
  async function registerWithoutGrant(user: TestUser, commandId: string) {
    const {code} = await issueCode(`e2e retry ${user.id.slice(0, 8)}`);
    const receipt = await registerWithCode({userId: user.id, commandId, code, clientAddress: null}, {env});
    if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
    return code;
  }

  /** Puts back an Auth session that Auth deleted (a sign-out), so a test can tell the grant's refusal from Auth's. */
  async function restoreSession(user: TestUser, sessionId: string) {
    await db.query(`insert into auth.sessions (id, user_id, created_at, updated_at, aal, refreshed_at) values ($1, $2, now(), now(), 'aal1', now())`, [sessionId, user.id]);
  }

  /** Issues the grant of a session of the user's, as the callback does at sign-in. */
  async function grant(user: TestUser, sessionId: string) {
    const receipt = await issueGrant(user.id, sessionId, {env});
    if (receipt.outcome !== 'issued' && receipt.outcome !== 'exists') throw new Error(`The test grant was not issued (${receipt.outcome}).`);
    return receipt;
  }

  /** Another signed-in session of the same user (another browser or device), with its own cookie. It has no grant until `grant` is called. */
  async function extraSession(user: TestUser): Promise<{sessionId: string; cookie: {name: string; value: string}}> {
    const sessionId = randomUUID();
    await db.query(`insert into auth.sessions (id, user_id, created_at, updated_at, aal, refreshed_at) values ($1, $2, now(), now(), 'aal1', now())`, [sessionId, user.id]);
    const value = sessionCookieValue({supabaseUrl: stack.apiUrl, userId: user.id, email: user.email, sessionId, jwtSecret: jwtSecretOf(stack)});
    return {sessionId, cookie: {name: sessionCookieName(env.NEXT_PUBLIC_SUPABASE_URL!), value}};
  }

  /** Ends the grant of a session the way sign-out does. */
  const revokeGrant = (user: TestUser, sessionId: string, reason = 'sign_out') => revokeSessionGrant({sessionId, userId: user.id, actor: `user:${user.id}`, reason}, {env});
  /** Raises the Account's authorization epoch, which refuses every grant issued before. */
  const raiseEpoch = async (user: TestUser) => {
    const account = await accountOf(user);
    return raiseAuthorizationEpoch({accountId: account.id, actor: 'seed:local:e2e'}, {env});
  };
  /** Moves a grant back in time: when it was issued, and when it was last used, as days before now. */
  const ageGrant = (sessionId: string, issuedDaysAgo: number, usedDaysAgo = 0) =>
    db.query(
      `update identity.session_grants set issued_at = clock_timestamp() - $2 * interval '1 day', last_used_at = clock_timestamp() - $3 * interval '1 day' where session_id = $1`,
      [sessionId, issuedDaysAgo, usedDaysAgo],
    );
  const grantOf = async (sessionId: string) => (await db.query('select * from identity.session_grants where session_id = $1', [sessionId])).rows[0] as
    | {
        session_id: string;
        epoch: string;
        issued_at: Date;
        last_used_at: Date;
        revoked_at: Date | null;
        revoked_by: string | null;
        revoked_reason: string | null;
        csrf_hash: string | null;
        csrf_issued_at: Date | null;
      }
    | undefined;
  /** Moves the stored CSRF hash back in time by this many seconds (Story 1.4c): the cookie was lost a while ago. */
  const ageCsrf = (sessionId: string, seconds: number) =>
    db.query(`update identity.session_grants set csrf_issued_at = csrf_issued_at - $2 * interval '1 second' where session_id = $1 and csrf_hash is not null`, [sessionId, seconds]);
  const grantsOf = async (user: TestUser) =>
    (await db.query('select g.session_id from identity.session_grants g join identity.accounts a on a.id = g.account_id where a.user_id = $1 order by g.issued_at', [user.id])).rows.map((row) => row.session_id as string);
  const auditEvents = async (action: string, target: string) =>
    (await db.query('select actor, action, target from identity.audit_events where action = $1 and target = $2 order by id', [action, target])).rows as {actor: string; action: string; target: string}[];

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

  // Preferences (Story 1.4d) ---------------------------------------------------------------------------

  /** The Account's preferences record as stored, or undefined when it has none. */
  const preferencesOf = async (user: TestUser) =>
    (
      await db.query(
        'select p.locale, p.theme, p.detail, p.guidance from identity.account_preferences p join identity.accounts a on a.id = p.account_id where a.user_id = $1',
        [user.id],
      )
    ).rows[0] as {locale: string | null; theme: string; detail: string; guidance: string} | undefined;
  /** Gives the Account a record the way its first sign-in would (`adopt`), so the next navigation does not adopt the device's cookies. */
  const adoptPreferencesFor = async (user: TestUser, values: {locale?: string | null; theme?: string; detail?: string; guidance?: string} = {}) => {
    const account = await accountOf(user);
    const receipt = await adoptPreferences({accountId: account.id, locale: values.locale ?? null, theme: values.theme ?? 'light', detail: values.detail ?? 'simple', guidance: values.guidance ?? 'shown'}, {env});
    if (receipt !== 'created') throw new Error(`The test record was not created (${receipt}).`);
  };

  // Step-up (Story 1.4b) ------------------------------------------------------------------------------

  /** The fresh-authentication markers of the user's Account, oldest first. */
  const markersOf = async (user: TestUser) =>
    (await db.query('select m.* from identity.fresh_authentications m join identity.accounts a on a.id = m.account_id where a.user_id = $1 order by m.issued_at', [user.id])).rows as {
      session_id: string;
      action_class: string;
      issued_at: Date;
      expires_at: Date;
      consumed_at: Date | null;
      step_up_started_at: Date;
    }[];
  /** The step-up nonces of the user's Account, oldest first. */
  const noncesOf = async (user: TestUser) =>
    (await db.query('select n.* from identity.step_up_nonces n join identity.accounts a on a.id = n.account_id where a.user_id = $1 order by n.started_at', [user.id])).rows as {
      session_id: string;
      action_class: string;
      status: string;
      started_at: Date;
      expires_at: Date;
      completed_session_id: string | null;
    }[];
  /** Starts a step-up from a session the way the Server Action does (with secrets nobody will use), e.g. to replace the open one or to fill the hourly limit. */
  const startStepUpFrom = (user: TestUser, sessionId: string, actionClass = 'administration') =>
    startStepUp({userId: user.id, sessionId, actionClass, secretHash: randomBytes(32).toString('hex'), verifierHash: randomBytes(32).toString('base64url')}, {env});
  /** Checks (and for the two destructive classes consumes) a session's marker, as a later story's command will. */
  const markerOutcome = (user: TestUser, sessionId: string, actionClass: string, startedAfter?: Date): Promise<MarkerOutcome> =>
    checkMarker({userId: user.id, sessionId, actionClass, ...(startedAfter ? {startedAfter} : {})}, {env});
  /** Moves the user's open nonce back in time by this many minutes. */
  const ageNonces = (user: TestUser, minutes: number) =>
    db.query(
      `update identity.step_up_nonces n set started_at = n.started_at - $2 * interval '1 minute', expires_at = n.expires_at - $2 * interval '1 minute'
        from identity.accounts a where a.id = n.account_id and a.user_id = $1`,
      [user.id, minutes],
    );
  /** The Auth user a real Google sign-in created for this address, registered for cleanup with the world. Undefined if there is none. */
  async function adoptUser(email: string) {
    const id = (await db.query('select id from auth.users where email = $1', [email])).rows[0]?.id as string | undefined;
    if (id && !committed.users.includes(id)) committed.users.push(id);
    return id;
  }
  const authSessionsOf = async (userId: string) => (await db.query('select id from auth.sessions where user_id = $1', [userId])).rows.map((row) => row.id as string);
  const hasGrantAtAll = async (sessionId: string) => (await db.query('select 1 from identity.session_grants where session_id = $1', [sessionId])).rowCount === 1;

  return {
    env, stack, db, connect, close, signedInUser, issueCode, revokeCode, preauthorize, activate, registerWithoutGrant, restoreSession, grant, extraSession, revokeGrant, raiseEpoch, ageGrant, ageCsrf, grantOf, grantsOf, auditEvents,
    resetLimiter, setStatus, accountOf, workspacesOf, commandsOf, invitationStatus, sessionExists,
    markersOf, noncesOf, startStepUpFrom, markerOutcome, ageNonces, adoptUser, authSessionsOf, hasGrantAtAll,
    preferencesOf, adoptPreferencesFor,
  };
}

export type AccountsWorld = ReturnType<typeof accountsWorld>;
