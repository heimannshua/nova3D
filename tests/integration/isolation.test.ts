import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {adoptPreferences, issueCsrf, issueGrant, issueInvitation, registerWithCode} from '@/lib/accounts';
import {codeHash, createHarness, originHash, stack, tag} from '../support/accounts-db';
import {jwtSecretOf, stackEnvironment} from '../support/stack';

// Story 1.4d, AC-1: two real Accounts, and everything one of them can try against the other. Each Account is
// registered the way the registration screen registers it (an Account, its Workspace), has a live Auth session
// with its grant, a CSRF token, a preferences record, and a private object in a private storage bucket. Then
// one tries the other through:
//
//   * the REST API (PostgREST), with a token the stack would accept for it, and with the anon key;
//   * direct database roles (anon, authenticated, and service_role, which has no table access either);
//   * the `api` functions, called with the OTHER Account's IDs;
//   * the Storage API and the storage tables, with the other Account's object identifiers;
//   * composite ownership foreign keys, which are what stops a cross-Workspace reference once the domain tables
//     exist (this story creates no domain table, so the pattern is proven on scratch tables, in a transaction that
//     is rolled back).
//
// The last part is the forward guard: it lists every relation, function and schema in `identity`, `projects` and
// `lifecycle` from the database itself, table by table, and fails for anything a browser role can touch. A table
// added by a later story is therefore checked without anyone remembering to add it here, and the guard is shown
// to fail on a table that is not closed.
//
// Committed data is removed afterwards (audit events are append-only and stay); everything else rolls back.

const {db, connect, committed, inTx, addUser, addSession, attempt, api} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A token PostgREST and Storage accept for `role`, signed with the local stack's JWT secret: what Auth would issue for that user. */
function tokenFor(account: Fixture | null, role: 'authenticated' | 'anon' = 'authenticated') {
  const claims = {iss: `${stack.apiUrl}/auth/v1`, aud: 'authenticated', role, sub: account?.user.id ?? randomUUID(), session_id: account?.sessionId ?? randomUUID(), exp: Math.floor(Date.now() / 1000) + 600};
  const unsigned = `${base64url({alg: 'HS256', typ: 'JWT'})}.${base64url(claims)}`;
  return `${unsigned}.${createHmac('sha256', jwtSecretOf(stack)).update(unsigned).digest('base64url')}`;
}
const claimsOf = (account: Fixture) => JSON.stringify({role: 'authenticated', aud: 'authenticated', sub: account.user.id, session_id: account.sessionId});

type Fixture = {
  label: 'A' | 'B';
  user: {id: string; email: string; subject: string};
  accountId: string;
  workspaceId: string;
  sessionId: string;
  commandId: string;
  codeHash: string;
  csrfHash: string;
  preferences: {locale: string | null; theme: string; detail: string; guidance: string};
  objectPath: string;
  secret: string;
};

/** Registers an Account, gives it a session and its grant, a CSRF token, a preferences record, and a secret to be found. */
async function createAccount(label: 'A' | 'B', preferences: Fixture['preferences']): Promise<Fixture> {
  const user = await addUser(db);
  committed.users.push(user.id);
  const issued = await issueInvitation({kind: 'named', label: `isolation ${label} ${user.id.slice(0, 8)}`, actor: 'seed:local:isolation'}, {env});
  if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
  committed.invitationIds.push(issued.invitationId);
  const commandId = randomUUID();
  const receipt = await registerWithCode({userId: user.id, commandId, code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
  if (receipt.outcome !== 'registered' || !receipt.accountId || !receipt.workspaceId) throw new Error(`The test Account was not created (${receipt.outcome}).`);
  const sessionId = await addSession(db, user.id);
  await issueGrant(user.id, sessionId, {env});
  const csrfHash = codeHash();
  expect(await issueCsrf({userId: user.id, sessionId, hash: csrfHash}, {env})).toBe('issued');
  expect(await adoptPreferences({accountId: receipt.accountId, ...preferences}, {env})).toBe('created');
  const {rows} = await db.query('select code_hash from identity.invitations where id = $1', [issued.invitationId]);
  return {
    label,
    user,
    accountId: receipt.accountId,
    workspaceId: receipt.workspaceId,
    sessionId,
    commandId,
    codeHash: rows[0].code_hash,
    csrfHash,
    preferences,
    objectPath: `${receipt.accountId}/private-${label}.txt`,
    secret: `the-private-contents-of-${label}-${randomBytes(6).toString('hex')}`,
  };
}

let a: Fixture;
let b: Fixture;
beforeAll(async () => {
  a = await createAccount('A', {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'});
  b = await createAccount('B', {locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown'});
});

/** Everything private about an Account that an isolation failure could change, read as the database owner. */
async function stateOf(account: Fixture) {
  const grant = await db.query('select session_id, revoked_at, csrf_hash from identity.session_grants where session_id = $1', [account.sessionId]);
  const record = await db.query('select locale, theme, detail, guidance from identity.account_preferences where account_id = $1', [account.accountId]);
  const row = await db.query('select status, authorization_epoch::int as epoch, role from identity.accounts where id = $1', [account.accountId]);
  const nonces = await db.query('select count(*)::int as n from identity.step_up_nonces where account_id = $1', [account.accountId]);
  const markers = await db.query('select count(*)::int as n from identity.fresh_authentications where account_id = $1', [account.accountId]);
  return {grant: grant.rows, record: record.rows, account: row.rows, nonces: nonces.rows[0].n, markers: markers.rows[0].n};
}

const rpc = (token: string, name: string, body: unknown) =>
  fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {apikey: stack.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-profile': 'api'},
    body: JSON.stringify(body),
  });
const rest = (token: string, path: string, init: RequestInit & {profile?: string} = {}) =>
  fetch(`${stack.apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: {apikey: stack.anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.profile ? {'accept-profile': init.profile, 'content-profile': init.profile} : {}), ...init.headers},
  });

// ---------------------------------------------------------------------------------------------------
describe('the fixture: two Accounts with private records of their own', () => {
  it('are two Accounts, two Workspaces, two sessions with grants, two tokens and two preferences records', async () => {
    expect(a.accountId).not.toBe(b.accountId);
    expect(a.workspaceId).not.toBe(b.workspaceId);
    for (const account of [a, b]) {
      const state = await stateOf(account);
      expect(state.grant).toEqual([expect.objectContaining({session_id: account.sessionId, revoked_at: null, csrf_hash: account.csrfHash})]);
      expect(state.record).toEqual([account.preferences]);
      expect(state.account).toEqual([{status: 'active', epoch: 1, role: 'member'}]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('through the REST API', () => {
  /** The api function bodies a caller holding the OTHER Account's IDs would send. Every function of the api schema must be here. */
  const bodiesAgainst = (victim: Fixture): Record<string, unknown> => ({
    account_status: {p_user_id: victim.user.id},
    adopt_preferences: {p_account_id: victim.accountId, p_locale: 'en', p_theme: 'dark', p_detail: 'technical', p_guidance: 'dismissed'},
    // Story 1.13: the alarm path's seven api functions.
    alarm_observations: {},
    alarms_due_mail: {p_limit: 5},
    authorize_session: {p_user_id: victim.user.id, p_session_id: victim.sessionId},
    before_user_created: {event: {}},
    check_recovery: {p_token_hash: codeHash(), p_administrator_email: victim.user.email},
    claim_job_run: {p_task: 'ledger-relay', p_schedule_id: 'scd_isolation', p_message_id: 'msg_isolation', p_lease_seconds: 300},
    claim_ledger_events: {p_holder: randomUUID(), p_limit: 5, p_lease_seconds: 5},
    complete_step_up: {p_user_id: victim.user.id, p_session_id: victim.sessionId, p_secret_hash: codeHash(), p_verifier_hash: randomBytes(32).toString('base64url')},
    confirm_registration: {p_user_id: victim.user.id, p_command_id: victim.commandId, p_code_hash: victim.codeHash},
    consume_preauthorization: {p_user_id: victim.user.id},
    // Story 2.1: confirming a request creates a Project and its first revision for an Account; reading one returns its latest revision.
    create_project_request: {
      p_account_id: victim.accountId, p_epoch: 1, p_command_id: randomUUID(), p_title: 'Created by another Account', p_mode: 'evidence_text', p_subject_id: 'middot-altar-ramp',
      p_scope: 'Scope', p_outcome: 'Outcome', p_description: 'Description', p_personalization_wording: null, p_personalization_text: null, p_personalization_style: null,
      p_personalization_applied: false, p_personalization_reason: null,
    },
    disable_account: {p_actor: 'seed', p_account_id: victim.accountId},
    enable_account: {p_actor: 'seed', p_account_id: victim.accountId},
    finish_job_run: {p_receipt_id: randomUUID(), p_outcome: 'ran', p_result: {}},
    finish_ledger_events: {p_holder: randomUUID(), p_event_ids: [], p_release: true},
    get_project: {p_account_id: victim.accountId, p_epoch: 1, p_project_id: randomUUID()},
    guard_operation: {p_account_id: victim.accountId, p_epoch: 1},
    guard_target: {p_account_id: victim.accountId, p_epoch: 1, p_kind: 'project', p_target_id: randomUUID()},
    issue_csrf: {p_user_id: victim.user.id, p_session_id: victim.sessionId, p_csrf_hash: codeHash()},
    issue_grant: {p_user_id: victim.user.id, p_session_id: victim.sessionId},
    issue_invitation: {p_code_hash: codeHash(), p_kind: 'general', p_label: null, p_actor: 'seed', p_replace: true},
    issue_recovery: {p_token_hash: codeHash(), p_administrator_email: victim.user.email},
    last_job_run: {p_task: 'ledger-relay'},
    list_accounts: {},
    list_alarms: {p_include_resolved: true, p_limit: 5},
    // Story 1.12: the file gateway's two api functions (the staging cleanup's list and a service key's revocation).
    list_expired_staging: {p_limit: 5},
    list_invitations: {},
    ledger_pending: {},
    list_projects: {p_account_id: victim.accountId, p_epoch: 1, p_limit: 10},
    lookup_status: {p_handle: '0'.repeat(32), p_origin_hash: codeHash()},
    preflight: {},
    purge_dormant_identities: {p_limit: 1},
    raise_alarm: {p_condition: 'isolation-test', p_subject: null, p_detail: {}},
    raise_authorization_epoch: {p_account_id: victim.accountId, p_actor: 'seed'},
    read_project_request: {p_account_id: victim.accountId, p_epoch: 1, p_project_id: randomUUID()},
    record_account_refusal: {p_user_id: victim.user.id, p_action: 'account.denied', p_account_id: victim.accountId},
    record_alarm_notice: {p_alarm_id: randomUUID(), p_outcome: 'sent'},
    record_heartbeat: {p_kid: 'isolation-test', p_jti: 'AAAAAAAAAAAAAAAAAAAAAA'},
    record_invitation_refusal: {p_user_id: victim.user.id, p_action: 'invitation.denied', p_invitation_id: null},
    // Story 2.2: saving the ordered pictures of a request for an Account (a Project is born at the first save), and releasing uploads that were never saved.
    record_picture_set: {p_account_id: victim.accountId, p_epoch: 1, p_command_id: randomUUID(), p_project_id: null, p_title: 'Created by another Account', p_upload_ids: [randomUUID()]},
    record_tombstone: {p_kind: 'account', p_target_id: victim.accountId},
    resolve_alarm: {p_condition: 'isolation-test', p_subject: null},
    release_staged_pictures: {p_account_id: victim.accountId, p_epoch: 1, p_upload_ids: [randomUUID()]},
    rename_project: {p_account_id: victim.accountId, p_epoch: 1, p_command_id: randomUUID(), p_project_id: randomUUID(), p_expected_revision: 1, p_title: 'Renamed by another Account'},
    redeem_recovery: {p_token_hash: codeHash(), p_administrator_email: victim.user.email, p_user_id: victim.user.id, p_session_id: victim.sessionId},
    register_with_code: {p_user_id: victim.user.id, p_command_id: victim.commandId, p_code_hash: victim.codeHash, p_origin_hash: originHash()},
    revoke_grants: {p_actor: 'seed', p_reason: 'test', p_account_id: victim.accountId},
    revoke_invitation: {p_actor: 'seed', p_invitation_id: randomUUID()},
    revoke_service_key: {p_issuer: 'application', p_kid: 'isolation-test', p_reason: 'test'},
    seed_preauthorization: {p_email: 'someone@example.test', p_role: 'administrator', p_actor: 'seed'},
    set_preference: {p_account_id: victim.accountId, p_name: 'theme', p_value: 'dark'},
    start_step_up: {p_user_id: victim.user.id, p_session_id: victim.sessionId, p_action_class: 'administration', p_secret_hash: codeHash(), p_verifier_hash: randomBytes(32).toString('base64url')},
    use_marker: {p_user_id: victim.user.id, p_session_id: victim.sessionId, p_action_class: 'administration', p_started_after: null},
    verify_csrf: {p_user_id: victim.user.id, p_session_id: victim.sessionId, p_csrf_hash: victim.csrfHash},
    void_recovery: {p_token_hash: codeHash(), p_definitive: true},
    withdraw_preauthorization: {p_email: 'someone@example.test', p_actor: 'seed'},
  });

  it('has a request body here for every function of the api schema, so a function added later is tried too', async () => {
    const {rows} = await db.query(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' order by 1`);
    expect(Object.keys(bodiesAgainst(b)).sort()).toEqual(rows.map((row) => row.name));
  });

  it('refuses every api function to the other Account\'s token and to anon, even with the other Account\'s IDs, with a database permission error and no data', async () => {
    const before = [await stateOf(a), await stateOf(b)];
    for (const [attacker, victim] of [[a, b], [b, a]] as const) {
      for (const [label, token] of [['the other Account\'s token', tokenFor(attacker)], ['an anon token', tokenFor(null, 'anon')], ['the anon key', stack.anonKey]] as const) {
        for (const [name, body] of Object.entries(bodiesAgainst(victim))) {
          const response = await rpc(token, name, body);
          const text = await response.text();
          expect(response.status, `${label} calls api.${name}`).toBeGreaterThanOrEqual(401);
          expect(response.status).toBeLessThan(500);
          // 42501 proves the request ran as that role and was refused by the database, not by a bad request.
          expect(JSON.parse(text).code, `${label} calls api.${name}`).toBe('42501');
          for (const secret of [victim.user.id, victim.accountId, victim.workspaceId, victim.sessionId, victim.csrfHash, victim.codeHash, victim.user.email]) expect(text).not.toContain(secret);
        }
      }
    }
    // Refused is not enough: nothing of either Account changed.
    expect([await stateOf(a), await stateOf(b)]).toEqual(before);
  });

  it('answers a read of any table of identity or projects with "not acceptable" (the schemas are not exposed), whoever asks, whatever the table holds', async () => {
    const {rows: tables} = await db.query(`select schemaname, tablename from pg_tables where schemaname in ('identity', 'projects') order by 1, 2`);
    expect(tables.length).toBeGreaterThanOrEqual(12);
    for (const token of [tokenFor(a), tokenFor(b), tokenFor(null, 'anon'), stack.anonKey]) {
      for (const {schemaname, tablename} of tables) {
        const read = await rest(token, `${tablename}?select=*`, {profile: schemaname});
        const text = await read.text();
        expect(read.status, `${schemaname}.${tablename}`).toBe(406);
        for (const secret of [a.user.email, b.user.email, a.csrfHash, b.csrfHash, a.accountId, b.accountId]) expect(text).not.toContain(secret);
        const write = await rest(token, tablename, {method: 'POST', profile: schemaname, body: JSON.stringify({})});
        expect(write.status, `write ${schemaname}.${tablename}`).toBe(406);
        const remove = await rest(token, `${tablename}?select=*`, {method: 'DELETE', profile: schemaname});
        expect(remove.status, `delete ${schemaname}.${tablename}`).toBe(406);
      }
    }
    expect([await stateOf(a), await stateOf(b)].map((state) => state.record.length)).toEqual([1, 1]);
  });

  it('refuses the one exposed table, lifecycle.instance_identity, to every browser role (a permission error, no row), while the service role reads it', async () => {
    for (const token of [tokenFor(a), tokenFor(b), tokenFor(null, 'anon'), stack.anonKey]) {
      // PostgREST answers a permission error with 401 for the anon role and 403 for an authenticated one.
      const read = await rest(token, 'instance_identity?select=*', {profile: 'lifecycle'});
      expect([401, 403]).toContain(read.status);
      expect((await read.json()).code).toBe('42501');
      const write = await rest(token, 'instance_identity', {method: 'POST', profile: 'lifecycle', body: JSON.stringify({environment: 'production'})});
      expect([401, 403]).toContain(write.status);
    }
    const server = await rest(stack.serviceKey, 'instance_identity?select=environment', {profile: 'lifecycle'});
    expect(server.status).toBe(200);
    expect(await server.json()).toEqual([{environment: 'local'}]);
  });

  it('does not list any table of identity, projects or lifecycle in what the API publishes to a browser role', async () => {
    for (const token of [tokenFor(a), stack.anonKey]) {
      for (const profile of ['public', 'api', 'lifecycle']) {
        const response = await rest(token, '', {profile, headers: {accept: 'application/openapi+json'}});
        const text = await response.text();
        for (const name of ['account_preferences', 'session_grants', 'audit_events', 'invitations', 'workspaces', 'projects', 'project_commands', 'request_revisions', 'request_images']) expect(text, `${profile} publishes ${name}`).not.toContain(`"/${name}"`);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('through direct database roles', () => {
  const relations = async (client: Client) =>
    (await client.query(
      `select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('identity', 'projects', 'lifecycle') and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1, 2`,
    )).rows as {schema: string; name: string}[];

  it('denies anon and authenticated every read and write of every table, with the other Account\'s claims as well as their own', async () => {
    await inTx(async (client) => {
      const tables = await relations(client);
      expect(tables.length).toBeGreaterThanOrEqual(13);
      for (const role of ['anon', 'authenticated']) {
        for (const claims of [claimsOf(a), claimsOf(b), '{}']) {
          await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
          for (const {schema, name} of tables) {
            for (const sql of [
              `select * from ${schema}.${name}`,
              `select count(*) from ${schema}.${name}`,
              `insert into ${schema}.${name} default values`,
              `update ${schema}.${name} set created_at = created_at`,
              `delete from ${schema}.${name}`,
              `truncate ${schema}.${name}`,
            ]) {
              const result = await attempt(client, role, sql);
              expect(result.ok, `${role} runs: ${sql}`).toBe(false);
              if (!result.ok) expect(result.code, `${role} runs: ${sql}`).toBe('42501');
            }
          }
        }
      }
    });
  });

  it('denies service_role the tables too: the server reaches them only through api functions, which take the Account the server derived', async () => {
    await inTx(async (client) => {
      for (const {schema, name} of await relations(client)) {
        const result = await attempt(client, 'service_role', `select * from ${schema}.${name}`);
        // lifecycle.instance_identity is the one table the server reads directly, and it holds no Account data.
        if (`${schema}.${name}` === 'lifecycle.instance_identity') expect(result.ok).toBe(true);
        else expect(result.ok, `${schema}.${name}`).toBe(false);
      }
    });
  });

  it('denies anon and authenticated every api function with the other Account\'s IDs', async () => {
    await inTx(async (client) => {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [claimsOf(a)]);
      for (const role of ['anon', 'authenticated']) {
        for (const sql of [
          'select * from api.authorize_session($1, $2)',
          'select * from api.issue_grant($1, $2)',
          'select * from api.verify_csrf($1, $2, repeat(\'a\', 64))',
          'select * from api.issue_csrf($1, $2, repeat(\'a\', 64))',
          'select * from api.use_marker($1, $2, \'administration\', null)',
          `select * from api.revoke_grants('seed', 'test', $2, $1)`,
        ]) {
          const result = await attempt(client, role, sql, [b.user.id, b.sessionId]);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.message).toMatch(/permission denied for schema api/);
        }
        for (const sql of [`select * from api.set_preference($1, 'theme', 'dark')`, `select * from api.adopt_preferences($1, null, 'dark', 'simple', 'shown')`, `select * from api.raise_authorization_epoch($1, 'seed')`]) {
          const result = await attempt(client, role, sql, [b.accountId]);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('through the api functions, with the other Account\'s IDs (what the server could be handed, as the service role)', () => {
  it('shows one Account nothing of the other\'s session: authorization pairs a user with ITS sessions only, and carries no record across', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      expect(await svc.authorizedPreferences(a.user.id, b.sessionId)).toEqual({state: 'no_session', preferences: null});
      expect(await svc.authorizedPreferences(b.user.id, a.sessionId)).toEqual({state: 'no_session', preferences: null});
      expect(await svc.authorizedPreferences(a.user.id, a.sessionId)).toEqual({state: 'active', preferences: a.preferences});
      expect(await svc.authorizedPreferences(b.user.id, b.sessionId)).toEqual({state: 'active', preferences: b.preferences});
    });
  });

  it('issues no grant, takes no CSRF token, ends no session and starts no step-up for a session that is not the user\'s', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const before = [await stateOf(a), await stateOf(b)];
      expect(await svc.issueGrant(a.user.id, b.sessionId)).toMatchObject({outcome: 'no_session'});
      expect(await svc.issueGrant(b.user.id, a.sessionId)).toMatchObject({outcome: 'no_session'});
      expect(await svc.issueCsrf(a.user.id, b.sessionId, codeHash())).toEqual({outcome: 'denied'});
      expect(await svc.verifyCsrf(a.user.id, b.sessionId, b.csrfHash)).toEqual({outcome: 'denied'});
      expect(await svc.verifyCsrf(b.user.id, b.sessionId, a.csrfHash)).toEqual({outcome: 'invalid'});
      expect(await svc.startStepUp(a.user.id, b.sessionId, 'administration', codeHash(), randomBytes(32).toString('base64url'))).toEqual({outcome: 'refused', expires_at: null});
      expect(await svc.useMarker(a.user.id, b.sessionId, 'administration')).toEqual({outcome: 'denied'});
      expect(await svc.revokeGrants({session: b.sessionId, user: a.user.id})).toEqual({revoked: 0, live: 0});
      expect(await svc.confirmRegistration(a.user.id, b.commandId, b.codeHash)).toEqual({confirmed: false});
      expect([await stateOf(a), await stateOf(b)]).toEqual(before);
    });
  });

  it('cannot take over the other Account\'s registration: its command, its code, and its user ID are all refused, and the Account stays one', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const intruder = await addUser(client);
      const replay = await svc.register(intruder.id, b.codeHash, {command: b.commandId});
      expect(replay).toMatchObject({outcome: 'refused', account_id: null, workspace_id: null, role: null});
      expect(await svc.status(intruder.id)).toMatchObject({status: 'none'});
      expect(await svc.status(b.user.id)).toMatchObject({status: 'active', account_id: b.accountId, workspace_id: b.workspaceId});
    });
  });

  it('adopts nothing over an existing record: the other device\'s cookies cannot replace what an Account chose', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      expect(await svc.adoptPreferences(b.accountId, {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'})).toEqual({outcome: 'exists'});
      expect((await stateOf(b)).record).toEqual([b.preferences]);
    });
  });

  it('keeps each Account\'s record its own: a change saved for one does not appear on the other', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await svc.setPreference(a.accountId, 'theme', 'light');
      expect((await svc.authorizedPreferences(a.user.id, a.sessionId)).preferences).toEqual({...a.preferences, theme: 'light'});
      expect((await svc.authorizedPreferences(b.user.id, b.sessionId)).preferences).toEqual(b.preferences);
    });
  });

  it('gives a disabled Account no way to read or change a record, and no way into the other Account\'s', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect(await svc.setPreference(a.accountId, 'theme', 'light')).toEqual({outcome: 'denied'});
      expect(await svc.authorizedPreferences(a.user.id, a.sessionId)).toEqual({state: 'disabled', preferences: null});
      expect((await svc.authorizedPreferences(b.user.id, b.sessionId)).preferences).toEqual(b.preferences);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('through a private storage bucket and its object identifiers', () => {
  const bucket = `isolation-${tag()}`;
  const object = (path: string) => `${stack.apiUrl}/storage/v1/object/${bucket}/${path}`;
  const storage = (token: string, url: string, init: RequestInit = {}) =>
    fetch(url, {...init, headers: {apikey: stack.anonKey, authorization: `Bearer ${token}`, ...init.headers}});

  beforeAll(async () => {
    const created = await storage(stack.serviceKey, `${stack.apiUrl}/storage/v1/bucket`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({id: bucket, name: bucket, public: false})});
    expect(created.status).toBe(200);
    for (const account of [a, b]) {
      const uploaded = await storage(stack.serviceKey, object(account.objectPath), {method: 'POST', headers: {'content-type': 'text/plain'}, body: account.secret});
      expect(uploaded.status).toBe(200);
    }
  });
  afterAll(async () => {
    await storage(stack.serviceKey, `${stack.apiUrl}/storage/v1/object/${bucket}`, {method: 'DELETE', headers: {'content-type': 'application/json'}, body: JSON.stringify({prefixes: [a.objectPath, b.objectPath]})});
    await storage(stack.serviceKey, `${stack.apiUrl}/storage/v1/bucket/${bucket}`, {method: 'DELETE'});
  });

  const privateOwnerReads = async (account: Fixture) => {
    const response = await storage(stack.serviceKey, object(account.objectPath));
    return {status: response.status, text: await response.text()};
  };

  it('pins that Supabase ships no policy on storage.objects or storage.buckets: a browser role is denied by default', async () => {
    const {rows} = await db.query(`select schemaname, tablename, policyname from pg_policies where schemaname = 'storage'`);
    expect(rows).toEqual([]);
    const {rows: rls} = await db.query(`select c.relname, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname in ('objects', 'buckets') order by 1`);
    expect(rls).toEqual([{relname: 'buckets', rls: true}, {relname: 'objects', rls: true}]);
  });

  it('has the bucket private, and its objects there for the owner of the keys', async () => {
    const {rows} = await db.query('select public from storage.buckets where id = $1', [bucket]);
    expect(rows).toEqual([{public: false}]);
    expect(await privateOwnerReads(a)).toEqual({status: 200, text: a.secret});
    expect(await privateOwnerReads(b)).toEqual({status: 200, text: b.secret});
  });

  it('refuses every read of the other Account\'s object, by every route and every role, and discloses neither its contents nor its existence', async () => {
    for (const [attacker, victim] of [[a, b], [b, a]] as const) {
      for (const token of [tokenFor(attacker), tokenFor(null, 'anon'), stack.anonKey]) {
        for (const url of [
          `${stack.apiUrl}/storage/v1/object/authenticated/${bucket}/${victim.objectPath}`,
          `${stack.apiUrl}/storage/v1/object/public/${bucket}/${victim.objectPath}`,
          object(victim.objectPath),
          `${stack.apiUrl}/storage/v1/object/info/${bucket}/${victim.objectPath}`,
          `${stack.apiUrl}/storage/v1/object/info/authenticated/${bucket}/${victim.objectPath}`,
        ]) {
          const response = await storage(token, url);
          const text = await response.text();
          expect(response.status, url).toBeGreaterThanOrEqual(400);
          expect(text).not.toContain(victim.secret);
          expect(text).not.toContain(victim.accountId);
        }
        // Not even their own object: with no policy, a browser role reads nothing from storage at all (Story 1.12's gateway builds on this).
        const own = await storage(token, `${stack.apiUrl}/storage/v1/object/authenticated/${bucket}/${attacker.objectPath}`);
        expect(own.status).toBeGreaterThanOrEqual(400);
        expect(await own.text()).not.toContain(attacker.secret);
      }
    }
  });

  it('lists nothing of the other Account\'s prefix, and nothing of the bucket, and shows no bucket', async () => {
    for (const token of [tokenFor(a), tokenFor(null, 'anon'), stack.anonKey]) {
      for (const prefix of [`${b.accountId}/`, `${a.accountId}/`, '']) {
        const listed = await storage(token, `${stack.apiUrl}/storage/v1/object/list/${bucket}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({prefix, limit: 100})});
        expect(listed.status).toBe(200);
        expect(await listed.json()).toEqual([]);
      }
      const buckets = await storage(token, `${stack.apiUrl}/storage/v1/bucket`);
      expect(await buckets.json()).toEqual([]);
      const one = await storage(token, `${stack.apiUrl}/storage/v1/bucket/${bucket}`);
      expect(one.status).toBeGreaterThanOrEqual(400);
    }
  });

  it('writes nothing and signs nothing for the other Account\'s identifiers: no upload, no overwrite, no delete, no move, no signed URL', async () => {
    for (const [attacker, victim] of [[a, b], [b, a]] as const) {
      const token = tokenFor(attacker);
      const results = [
        await storage(token, object(`${attacker.accountId}/new.txt`), {method: 'POST', headers: {'content-type': 'text/plain'}, body: 'planted'}),
        await storage(token, object(victim.objectPath), {method: 'POST', headers: {'content-type': 'text/plain'}, body: 'planted'}),
        await storage(token, object(victim.objectPath), {method: 'PUT', headers: {'content-type': 'text/plain'}, body: 'planted'}),
        await storage(token, object(victim.objectPath), {method: 'DELETE'}),
        await storage(token, `${stack.apiUrl}/storage/v1/object/${bucket}`, {method: 'DELETE', headers: {'content-type': 'application/json'}, body: JSON.stringify({prefixes: [victim.objectPath]})}),
        await storage(token, `${stack.apiUrl}/storage/v1/object/move`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({bucketId: bucket, sourceKey: victim.objectPath, destinationKey: `${attacker.accountId}/stolen.txt`})}),
        await storage(token, `${stack.apiUrl}/storage/v1/object/copy`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({bucketId: bucket, sourceKey: victim.objectPath, destinationKey: `${attacker.accountId}/stolen.txt`})}),
        await storage(token, `${stack.apiUrl}/storage/v1/object/sign/${bucket}/${victim.objectPath}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({expiresIn: 600})}),
        await storage(token, `${stack.apiUrl}/storage/v1/object/upload/sign/${bucket}/${victim.objectPath}`, {method: 'POST'}),
      ];
      for (const response of results) {
        const text = await response.text();
        // A delete of something the role cannot see may answer 200 with an empty list; nothing was signed or changed either way.
        if (response.status < 400) expect(JSON.parse(text)).toEqual([]);
        expect(text).not.toContain('signedURL');
      }
    }
    // Everything is exactly as the owner left it, and nothing new exists.
    expect(await privateOwnerReads(a)).toEqual({status: 200, text: a.secret});
    expect(await privateOwnerReads(b)).toEqual({status: 200, text: b.secret});
    const {rows} = await db.query('select name from storage.objects where bucket_id = $1 order by name', [bucket]);
    expect(rows.map((row) => row.name).sort()).toEqual([a.objectPath, b.objectPath].sort());
  });

  it('reads and writes nothing in storage.objects or storage.buckets as a database role, even though the rows are there', async () => {
    await inTx(async (client) => {
      const {rows: all} = await client.query('select count(*)::int as n from storage.objects where bucket_id = $1', [bucket]);
      expect(all[0].n).toBe(2);
      for (const claims of [claimsOf(a), claimsOf(b)]) {
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
        for (const role of ['anon', 'authenticated']) {
          const seen = await attempt(client, role, 'select count(*)::int as n from storage.objects where bucket_id = $1', [bucket]);
          expect(seen.ok && seen.rows[0].n, `${role} sees objects`).toBe(0);
          const buckets = await attempt(client, role, 'select count(*)::int as n from storage.buckets where id = $1', [bucket]);
          expect(buckets.ok && buckets.rows[0].n, `${role} sees the bucket`).toBe(0);
          const insert = await attempt(client, role, `insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`, [bucket, `${a.accountId}/direct.txt`, a.user.id]);
          expect(insert.ok, `${role} inserts`).toBe(false);
          if (!insert.ok) expect(insert.message).toMatch(/row-level security|permission denied/);
          const update = await attempt(client, role, `update storage.objects set name = name || 'x' where bucket_id = $1 returning name`, [bucket]);
          expect(update.ok && update.rows, `${role} updates`).toEqual([]);
          // Storage also refuses a direct delete outright (a trigger says to use the Storage API); either way nothing goes.
          const removed = await attempt(client, role, `delete from storage.objects where bucket_id = $1 returning name`, [bucket]);
          expect(!removed.ok || removed.rows.length === 0, `${role} deletes`).toBe(true);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('composite ownership foreign keys keep a reference inside one Workspace (scratch tables, rolled back)', () => {
  // The pattern every later module copies (AR-3): every owned table carries its Workspace, the parent has a unique
  // key that INCLUDES the Workspace, and a child references the pair. A child therefore cannot point at a parent
  // of another Workspace, at insert or at update, and a parent cannot move or go while children exist.
  async function scratch(client: Client) {
    await client.query(`
      create table projects.scratch_project (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null references projects.workspaces (id) on delete restrict,
        unique (workspace_id, id)
      );
      create table projects.scratch_source (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null,
        project_id uuid not null,
        unique (workspace_id, id),
        foreign key (workspace_id, project_id) references projects.scratch_project (workspace_id, id) on delete restrict
      );
      create table projects.scratch_decision (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null,
        source_id uuid not null,
        foreign key (workspace_id, source_id) references projects.scratch_source (workspace_id, id) on delete restrict
      );
      -- The control: a child that references only the parent's own key, which is what the pattern replaces.
      create table projects.scratch_loose (
        id uuid primary key default gen_random_uuid(),
        workspace_id uuid not null references projects.workspaces (id),
        project_id uuid not null references projects.scratch_project (id)
      );`);
    const insert = async (table: string, columns: Record<string, string>) => {
      const names = Object.keys(columns);
      const result = await attempt(client, null, `insert into projects.${table} (${names.join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(columns));
      return result;
    };
    const idOf = async (table: string, columns: Record<string, string>) => {
      const result = await insert(table, columns);
      if (!result.ok) throw new Error(result.message);
      return result.rows[0].id as string;
    };
    return {insert, idOf};
  }
  const refusedAsForeignKey = (result: Awaited<ReturnType<Awaited<ReturnType<typeof scratch>>['insert']>>) => {
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('23503');
  };

  it('accepts a reference inside the Workspace and refuses one that crosses to the other, at every level', async () => {
    await inTx(async (client) => {
      const {insert, idOf} = await scratch(client);
      const projectA = await idOf('scratch_project', {workspace_id: a.workspaceId});
      const projectB = await idOf('scratch_project', {workspace_id: b.workspaceId});
      const sourceA = await idOf('scratch_source', {workspace_id: a.workspaceId, project_id: projectA});
      await idOf('scratch_source', {workspace_id: b.workspaceId, project_id: projectB});
      await idOf('scratch_decision', {workspace_id: a.workspaceId, source_id: sourceA});

      // A's Workspace naming B's project, and B's naming A's: refused.
      refusedAsForeignKey(await insert('scratch_source', {workspace_id: a.workspaceId, project_id: projectB}));
      refusedAsForeignKey(await insert('scratch_source', {workspace_id: b.workspaceId, project_id: projectA}));
      // Two levels down, through a source of the other Workspace.
      const sourceB = (await client.query(`select id from projects.scratch_source where workspace_id = $1`, [b.workspaceId])).rows[0].id as string;
      refusedAsForeignKey(await insert('scratch_decision', {workspace_id: a.workspaceId, source_id: sourceB}));
      // A Workspace that does not exist, and a project that does not exist.
      refusedAsForeignKey(await insert('scratch_project', {workspace_id: randomUUID()}));
      refusedAsForeignKey(await insert('scratch_source', {workspace_id: a.workspaceId, project_id: randomUUID()}));
      // The reference needs both columns: a null is refused by NOT NULL, not let through by a partial foreign key.
      const missing = await attempt(client, null, `insert into projects.scratch_source (workspace_id) values ($1)`, [a.workspaceId]);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe('23502');
    });
  });

  it('refuses to move a row to the other Workspace, or to repoint it, once it is referenced', async () => {
    await inTx(async (client) => {
      const {idOf} = await scratch(client);
      const projectA = await idOf('scratch_project', {workspace_id: a.workspaceId});
      const projectB = await idOf('scratch_project', {workspace_id: b.workspaceId});
      const sourceA = await idOf('scratch_source', {workspace_id: a.workspaceId, project_id: projectA});
      await idOf('scratch_decision', {workspace_id: a.workspaceId, source_id: sourceA});

      for (const sql of [
        `update projects.scratch_source set workspace_id = '${b.workspaceId}' where id = '${sourceA}'`,
        `update projects.scratch_source set project_id = '${projectB}' where id = '${sourceA}'`,
        `update projects.scratch_project set workspace_id = '${b.workspaceId}' where id = '${projectA}'`,
        `update projects.scratch_decision set workspace_id = '${b.workspaceId}'`,
        `delete from projects.scratch_project where id = '${projectA}'`,
        `delete from projects.scratch_source where id = '${sourceA}'`,
      ]) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('23503');
      }
      // A Workspace that owns rows cannot be deleted either, nor can the Account that owns it.
      const workspace = await attempt(client, null, 'delete from projects.workspaces where id = $1', [a.workspaceId]);
      expect(workspace.ok).toBe(false);
      if (!workspace.ok) expect(workspace.code).toBe('23503');
      const account = await attempt(client, null, 'delete from identity.accounts where id = $1', [a.accountId]);
      expect(account.ok).toBe(false);
    });
  });

  it('is what the pattern is FOR: a child that references only the parent\'s own key can cross Workspaces', async () => {
    await inTx(async (client) => {
      const {insert, idOf} = await scratch(client);
      const projectB = await idOf('scratch_project', {workspace_id: b.workspaceId});
      const loose = await insert('scratch_loose', {workspace_id: a.workspaceId, project_id: projectB});
      expect(loose.ok, 'the single-column reference lets A\'s row point at B\'s project').toBe(true);
    });
  });

  it('closes a scratch table by default to every browser role, and to the service role: a new table needs a deliberate grant', async () => {
    await inTx(async (client) => {
      await scratch(client);
      for (const table of ['scratch_project', 'scratch_source', 'scratch_decision', 'scratch_loose']) {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          const result = await attempt(client, role, `select * from projects.${table}`);
          expect(result.ok, `${role} reads projects.${table}`).toBe(false);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
/**
 * Every way a browser role (anon, authenticated, or PUBLIC, which both inherit) can reach anything in `identity`,
 * `projects`, `lifecycle` or (Story 1.12) `artifacts`, read from the database itself. The list of relations is the catalog's, never a list
 * in this file, so a table added by a later story is checked without anyone adding it here. Each entry says what is
 * open. The `api` schema must hold no table or view at all: it is exposed to the Data API, and its functions are
 * the only thing that belongs there.
 */
async function openings(client: Client): Promise<string[]> {
  const found: string[] = [];
  const closed = ['identity', 'projects', 'lifecycle', 'artifacts'];
  const browser = ['anon', 'authenticated'];

  const {rows: schemas} = await client.query(`select nspname from pg_namespace where nspname = any($1)`, [[...closed, 'api']]);
  for (const {nspname} of schemas) {
    for (const role of browser) {
      const {rows} = await client.query(`select has_schema_privilege($1, $2, 'usage') as usage, has_schema_privilege($1, $2, 'create') as create`, [role, nspname]);
      if (rows[0].usage && closed.includes(nspname)) found.push(`${role} can use schema ${nspname}`);
      if (rows[0].create) found.push(`${role} can create in schema ${nspname}`);
    }
    const {rows: publicGrants} = await client.query(`select 1 from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = $1 and a.grantee = 0`, [nspname]);
    if (publicGrants.length) found.push(`PUBLIC holds a privilege on schema ${nspname}`);
  }

  const {rows: relations} = await client.query(
    `select n.nspname as schema, c.relname as name, c.oid, c.relkind, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') order by 1, 2`,
    [[...closed, 'api']],
  );
  for (const relation of relations) {
    const name = `${relation.schema}.${relation.name}`;
    if (relation.schema === 'api') {
      found.push(`${name} is a ${relation.relkind === 'S' ? 'sequence' : 'table or view'} in the api schema, which holds functions only`);
      continue;
    }
    const sequence = relation.relkind === 'S';
    for (const role of browser) {
      const {rows} = await client.query(
        sequence
          ? `select has_sequence_privilege($1, $2::oid, 'usage,select,update') as can, false as any_column`
          : `select has_table_privilege($1, $2::oid, 'select,insert,update,delete,truncate,references,trigger') as can, has_any_column_privilege($1, $2::oid, 'select,insert,update,references') as any_column`,
        [role, relation.oid],
      );
      if (rows[0].can) found.push(`${role} holds a privilege on ${name}`);
      if (rows[0].any_column) found.push(`${role} holds a column privilege on ${name}`);
    }
    const {rows: publicGrants} = await client.query(`select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = $1 and a.grantee = 0`, [relation.oid]);
    if (publicGrants.length) found.push(`PUBLIC holds a privilege on ${name}`);
    // A view has no row-level security to turn on (Story 1.12's two views in `artifacts` read tables as their owner and are closed by privilege alone: the
    // privilege checks above still apply to them, and a view that was granted to a browser role is still found).
    if (!sequence && relation.relkind !== 'v') {
      if (!relation.rls) found.push(`${name} has row-level security off`);
      // Story 1.12: the pattern is no policy, with ONE exception that its migration forces: a table the file gateway's own role must read and write
      // carries a policy for that role alone (row-level security with no policy admits no role that is not the owner, and the gateway is not). A policy
      // that names any other role, or PUBLIC, or the gateway together with another role, is an opening like any other.
      const {rows: policies} = await client.query(`select polname, polroles from pg_policy where polrelid = $1`, [relation.oid]);
      for (const policy of policies) {
        const roles = (policy.polroles as number[]).map(String);
        const gatewayOnly = roles.length === 1 && roles[0] !== '0' && (await client.query(`select $1::oid::regrole::text as role`, [roles[0]])).rows[0].role === 'nova3d_gateway';
        if (!gatewayOnly) found.push(`${name} has a policy (${policy.polname}); the pattern is none, but for the gateway role alone`);
      }
    }
  }

  const {rows: functions} = await client.query(
    `select n.nspname as schema, p.proname as name, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any($1) order by 1, 2`,
    [closed],
  );
  for (const fn of functions) {
    for (const role of browser) {
      const {rows} = await client.query(`select has_function_privilege($1, $2::oid, 'execute') as can`, [role, fn.oid]);
      if (rows[0].can) found.push(`${role} can execute ${fn.schema}.${fn.name}`);
    }
  }

  // The rules for what comes next: a default privilege that grants to a browser role (or to PUBLIC) opens every table made after it.
  const {rows: defaults} = await client.query(
    `select n.nspname as schema, d.defaclobjtype as kind, a.privilege_type as privilege, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
       from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
      where n.nspname = any($1) and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))`,
    [closed],
  );
  for (const rule of defaults) found.push(`a default privilege in ${rule.schema} grants ${rule.privilege} on new ${rule.kind} to ${rule.grantee}`);

  return found.sort();
}

describe('every table of identity, projects, lifecycle and artifacts is closed to anon and authenticated, table by table, and stays so', () => {
  it('finds the tables it is meant to check, so an empty list cannot pass for a closed one', async () => {
    const {rows} = await db.query(
      `select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('identity', 'projects', 'lifecycle', 'artifacts') and c.relkind in ('r', 'p') order by 1`,
    );
    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'identity.account_preferences',
        'identity.accounts',
        'identity.audit_events',
        'identity.fresh_authentications',
        'identity.invitations',
        'identity.preauthorizations',
        'identity.rate_limit_counters',
        'identity.recovery_tokens',
        'identity.registration_attempts',
        'identity.registration_commands',
        'identity.session_grants',
        'identity.step_up_nonces',
        'lifecycle.instance_identity',
        'lifecycle.ledger_outbox',
        'lifecycle.ledger_relay',
        'lifecycle.status_requests',
        'lifecycle.tombstones',
        'projects.project_commands',
        'projects.projects',
        'projects.request_images',
        'projects.request_revisions',
        'projects.workspaces',
        'artifacts.attachment_transforms',
        'artifacts.manifests',
        'artifacts.service_key_revocations',
        'artifacts.staging_leases',
        'artifacts.ticket_redemptions',
        'artifacts.transfer_handles',
      ]),
    );
  });

  it('finds nothing a browser role can reach: no schema, table, column, sequence, function, policy or default privilege', async () => {
    expect(await openings(db)).toEqual([]);
  });

  it('fails for every kind of opening, in each of the four schemas, so a table added later that is not closed fails this suite', async () => {
    for (const schema of ['identity', 'projects', 'lifecycle', 'artifacts']) {
      await inTx(async (client) => {
        const leak = async (name: string, ddl: string[]) => {
          await client.query('savepoint leak');
          for (const statement of ddl) await client.query(statement);
          const now = await openings(client);
          expect(now.filter((line) => line.includes(`${schema}.${name}`)), `${schema}.${name}: ${ddl.join('; ')}`).not.toEqual([]);
          await client.query('rollback to savepoint leak');
          expect(await openings(client)).toEqual([]);
        };
        const table = (name: string) => `create table ${schema}.${name} (id integer primary key, owner_id uuid)`;

        await leak('leak_select', [table('leak_select'), `alter table ${schema}.leak_select enable row level security`, `grant select on ${schema}.leak_select to anon`]);
        await leak('leak_write', [table('leak_write'), `alter table ${schema}.leak_write enable row level security`, `grant insert, update, delete on ${schema}.leak_write to authenticated`]);
        await leak('leak_column', [table('leak_column'), `alter table ${schema}.leak_column enable row level security`, `grant select (owner_id) on ${schema}.leak_column to authenticated`]);
        await leak('leak_public', [table('leak_public'), `alter table ${schema}.leak_public enable row level security`, `grant select on ${schema}.leak_public to public`]);
        await leak('leak_no_rls', [table('leak_no_rls')]);
        await leak('leak_policy', [table('leak_policy'), `alter table ${schema}.leak_policy enable row level security`, `create policy mine on ${schema}.leak_policy for select to authenticated using (owner_id = auth.uid())`]);
        await leak('leak_sequence', [`create sequence ${schema}.leak_sequence`, `grant usage on sequence ${schema}.leak_sequence to anon`]);
        await leak('leak_view', [`create view ${schema}.leak_view as select 1 as one`, `grant select on ${schema}.leak_view to authenticated`]);
        await leak('leak_function', [`create function ${schema}.leak_function() returns integer language sql as 'select 1'`, `grant execute on function ${schema}.leak_function() to authenticated`]);
        await leak('leak_function_public', [`create function ${schema}.leak_function_public() returns integer language sql as 'select 1'`, `grant execute on function ${schema}.leak_function_public() to public`]);

        // A grant on the schema itself, and a default privilege for what is created next.
        await client.query('savepoint schema_leak');
        await client.query(`grant usage on schema ${schema} to anon`);
        expect((await openings(client)).filter((line) => line.includes(`anon can use schema ${schema}`)), `usage on ${schema}`).toHaveLength(1);
        await client.query('rollback to savepoint schema_leak');
        await client.query(`alter default privileges for role postgres in schema ${schema} grant select on tables to authenticated`);
        expect((await openings(client)).filter((line) => line.includes(`a default privilege in ${schema}`)), `default privilege in ${schema}`).not.toEqual([]);
      });
    }
    // ... and the real database is exactly as it was.
    expect(await openings(db)).toEqual([]);
  });

  it('accepts a policy for the gateway role alone (Story 1.12) and nothing wider: one that also names a browser role, or PUBLIC, is an opening', async () => {
    await inTx(async (client) => {
      await client.query('create table artifacts.future_gateway_table (id integer primary key, owner_id uuid)');
      await client.query('alter table artifacts.future_gateway_table enable row level security');
      await client.query('create policy only_gateway on artifacts.future_gateway_table for select to nova3d_gateway using (true)');
      expect(await openings(client)).toEqual([]);
      await client.query('savepoint wider');
      await client.query('create policy gateway_and_anon on artifacts.future_gateway_table for select to nova3d_gateway, anon using (true)');
      expect((await openings(client)).filter((line) => line.includes('gateway_and_anon'))).toHaveLength(1);
      await client.query('rollback to savepoint wider');
      await client.query('create policy for_public on artifacts.future_gateway_table for select to public using (true)');
      expect((await openings(client)).filter((line) => line.includes('for_public'))).toHaveLength(1);
    });
  });

  it('fails for a table in the api schema, which is exposed to the Data API and holds functions only', async () => {
    await inTx(async (client) => {
      await client.query('create table api.leak_table (id integer)');
      expect((await openings(client)).filter((line) => line.includes('api.leak_table'))).toHaveLength(1);
    });
  });

  it('shows a table made the way a later story will make it, closed by default, passing; and the same table with one careless grant, failing', async () => {
    await inTx(async (client) => {
      await client.query('create table projects.future_projects (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references projects.workspaces (id))');
      await client.query('alter table projects.future_projects enable row level security');
      expect(await openings(client)).toEqual([]);
      await client.query('grant select on projects.future_projects to authenticated');
      expect(await openings(client)).toEqual(['authenticated holds a column privilege on projects.future_projects', 'authenticated holds a privilege on projects.future_projects']);
    });
  });

  it('tries every table as the role, not only by catalog: a real select by anon and by authenticated is refused for each', async () => {
    await inTx(async (client) => {
      const {rows} = await client.query(
        `select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('identity', 'projects', 'lifecycle', 'artifacts') and c.relkind in ('r', 'p') order by 1, 2`,
      );
      for (const {schema, name} of rows) {
        for (const role of ['anon', 'authenticated']) {
          const result = await attempt(client, role, `select * from ${schema}.${name}`);
          expect(result.ok, `${role} reads ${schema}.${name}`).toBe(false);
          if (!result.ok) expect(result.code).toBe('42501');
        }
      }
    });
  });
});
