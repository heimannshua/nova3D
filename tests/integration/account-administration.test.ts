import {randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {
  accountRefusalActions,
  authorizeSession,
  disableAccount,
  enableAccount,
  guardOperation,
  issueGrant,
  issueInvitation,
  listAccounts,
  recordAccountRefusal,
  registerWithCode,
} from '@/lib/accounts';
import {authorizeStep, operationOf, registerCanceller, runCancellers} from '@/lib/authority';
import {codeHash, createHarness, stack} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 1.5 against the Supabase CLI stack: disabling and re-enabling an Account, the authority contract (the guard for the
// application's steps and the SQL assertion for steps that publish), the audit of refused changes, and the preflight. Most
// cases run inside a transaction that is rolled back, as the service role. The cases that need several real connections (a
// disable racing a publication, two windows disabling at once, a grant being issued while the Account is disabled), and the
// typed calls over REST as the application makes them, commit data that is removed afterwards. Audit events are append-only
// and stay, which is why every test that counts them uses an Account of its own.

const {db, connect, committed, inTx, addUser, addSession, attempt, rows, api, count} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

const ACTOR = 'user:00000000-0000-4000-8000-000000000001';

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; sessions: string[]};

/** An Account (registered the way the registration screen does it), the given number of live Auth sessions, each with its grant. */
async function account(client: Client, options: {role?: 'member' | 'administrator'; sessions?: number; kind?: 'general' | 'named'; label?: string} = {}): Promise<Fixture> {
  const svc = api(client);
  const user = await addUser(client);
  const hash = codeHash();
  await svc.issue(hash, options.kind ?? 'general', options.kind === 'named' ? (options.label ?? 'Dana') : null);
  const receipt = await svc.register(user.id, hash);
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  if (options.role === 'administrator') await client.query(`update identity.accounts set role = 'administrator' where id = $1`, [receipt.account_id]);
  const sessions: string[] = [];
  for (let index = 0; index < (options.sessions ?? 2); index += 1) {
    const sessionId = await addSession(client, user.id);
    const issued = await svc.issueGrant(user.id, sessionId);
    if (issued.outcome !== 'issued') throw new Error(`The test grant was not issued (${issued.outcome}).`);
    sessions.push(sessionId);
  }
  return {user, accountId: receipt.account_id as string, workspaceId: receipt.workspace_id as string, sessions};
}

/** The same, committed (for the cases that need real connections), removed with the harness's other committed data. */
async function committedAccount(options: {sessions?: number} = {}): Promise<Fixture> {
  const user = await addUser(db);
  committed.users.push(user.id);
  const issued = await issueInvitation({kind: 'named', label: `admin ${user.id.slice(0, 8)}`, actor: 'seed:local:account-administration'}, {env});
  if (issued.outcome !== 'issued') throw new Error('The code was not issued.');
  committed.invitationIds.push(issued.invitationId);
  const receipt = await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: `203.0.113.${Math.floor(Math.random() * 250) + 1}`}, {env});
  if (receipt.outcome !== 'registered') throw new Error(`The test Account was not created (${receipt.outcome}).`);
  const sessions: string[] = [];
  for (let index = 0; index < (options.sessions ?? 1); index += 1) {
    const sessionId = await addSession(db, user.id);
    const grant = await issueGrant(user.id, sessionId, {env});
    if (grant.outcome !== 'issued') throw new Error(`The test grant was not issued (${grant.outcome}).`);
    sessions.push(sessionId);
  }
  return {user, accountId: receipt.accountId as string, workspaceId: receipt.workspaceId as string, sessions};
}

const accountRow = async (client: Client, accountId: string) =>
  (await client.query('select status, role, authorization_epoch::int as epoch from identity.accounts where id = $1', [accountId])).rows[0] as {status: string; role: string; epoch: number};
const grantsOf = async (client: Client, accountId: string) =>
  (await client.query('select session_id, epoch::int as epoch, revoked_at, revoked_by, revoked_reason from identity.session_grants where account_id = $1 order by issued_at, session_id', [accountId])).rows as {
    session_id: string;
    epoch: number;
    revoked_at: Date | null;
    revoked_by: string | null;
    revoked_reason: string | null;
  }[];
const authSessionsOf = async (client: Client, userId: string) => (await client.query('select id from auth.sessions where user_id = $1 order by id', [userId])).rows.map((row) => row.id as string);
const workspaceOf = async (client: Client, accountId: string) => (await client.query('select id, account_id, created_at from projects.workspaces where account_id = $1', [accountId])).rows;
const auditFor = async (client: Client, action: string, target: string) =>
  (await client.query('select actor, action, target, occurred_at from identity.audit_events where action = $1 and target = $2 order by id', [action, target])).rows as {actor: string; action: string; target: string | null; occurred_at: Date}[];
const eventsBy = async (client: Client, actor: string, action?: string) =>
  (await client.query(`select actor, action, target, occurred_at from identity.audit_events where actor = $1 ${action ? 'and action = $2' : ''} order by id`, action ? [actor, action] : [actor])).rows as {
    actor: string;
    action: string;
    target: string | null;
    occurred_at: Date;
  }[];

const disable = (client: Client, accountId: string, actor = ACTOR) => rows(client, 'service_role', 'select outcome, sessions_ended, grants_revoked, epoch::int as epoch from api.disable_account($1, $2)', [actor, accountId]).then((found) => found[0]);
const enable = (client: Client, accountId: string, actor = ACTOR) => rows(client, 'service_role', 'select outcome, epoch::int as epoch from api.enable_account($1, $2)', [actor, accountId]).then((found) => found[0]);
const guard = (client: Client, accountId: string, epoch: number) => rows(client, 'service_role', 'select outcome, epoch::int as epoch from api.guard_operation($1, $2)', [accountId, epoch]).then((found) => found[0]);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until the backend is blocked on a lock, so a test knows the other connection really is waiting for it. */
async function untilBlocked(pid: number) {
  for (let attemptNumber = 0; attemptNumber < 100; attemptNumber += 1) {
    const { rows: found } = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await wait(50);
  }
  throw new Error('The other connection never started waiting for the lock.');
}

// ---------------------------------------------------------------------------------------------------
describe('access: the six functions are closed', () => {
  const apiSignatures = [
    'api.list_accounts()',
    'api.disable_account(text, uuid)',
    'api.enable_account(text, uuid)',
    'api.guard_operation(uuid, bigint)',
    'api.record_account_refusal(uuid, text, uuid)',
  ];

  it('puts the five in the api schema, runs them as their owner with an empty search path, and gives them to the service role alone', async () => {
    const { rows: found } = await db.query(
      `select p.oid::regprocedure::text as signature, p.prosecdef as definer, p.proconfig as config,
              (select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) as grantees
         from pg_proc p where p.oid = any($1::regprocedure[]) order by 1`,
      [apiSignatures],
    );
    expect(found).toHaveLength(5);
    for (const row of found) {
      expect(row.definer, row.signature).toBe(true);
      expect(row.config, row.signature).toEqual(['search_path=""']);
      expect(row.grantees, row.signature).toEqual(['service_role']);
    }
  });

  it('keeps the SQL assertion in the identity schema, callable by no API role at all', async () => {
    const { rows: found } = await db.query(
      `select r.rolname as role, has_function_privilege(r.oid, 'identity.assert_operation_authority(uuid, bigint)', 'execute') as can
         from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'supabase_auth_admin') order by 1`,
    );
    expect(Object.fromEntries(found.map((row) => [row.role, row.can]))).toEqual({anon: false, authenticated: false, service_role: false, supabase_auth_admin: false});
    const proc = await db.query(`select proconfig, proacl is null as default_acl from pg_proc where oid = 'identity.assert_operation_authority(uuid, bigint)'::regprocedure`);
    expect(proc.rows[0].proconfig).toEqual(['search_path=""']);
    expect(proc.rows[0].default_acl).toBe(false);
  });

  it('takes the actor and the Account, and nothing else, to disable or enable; and no reason, address or content to record a refusal', async () => {
    const args = async (signature: string) => (await db.query(`select pg_get_function_arguments('${signature}'::regprocedure) as args`)).rows[0].args as string;
    expect(await args('api.disable_account(text, uuid)')).toBe('p_actor text, p_account_id uuid');
    expect(await args('api.enable_account(text, uuid)')).toBe('p_actor text, p_account_id uuid');
    expect(await args('api.record_account_refusal(uuid, text, uuid)')).toBe('p_user_id uuid, p_action text, p_account_id uuid DEFAULT NULL::uuid');
    expect(await args('api.guard_operation(uuid, bigint)')).toBe('p_account_id uuid, p_epoch bigint');
    expect(await args('api.list_accounts()')).toBe('');
  });

  it.each(['anon', 'authenticated'])('refuses %s every one of them with a database permission error, and changes nothing', async (role) => {
    await inTx(async (client) => {
      const a = await account(client);
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      for (const sql of [
        'select * from api.list_accounts()',
        `select * from api.disable_account('user:x', '${a.accountId}')`,
        `select * from api.enable_account('user:x', '${a.accountId}')`,
        `select * from api.guard_operation('${a.accountId}', 1)`,
        `select * from api.record_account_refusal('${a.user.id}', 'account.denied', null)`,
      ]) {
        const result = await attempt(client, role, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.message).toMatch(/permission denied for schema api/);
      }
      expect(await accountRow(client, a.accountId)).toMatchObject({status: 'active', epoch: 1});
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before);
    });
  });

  it('refuses the service role the SQL assertion: it is for functions that run as the owner', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const result = await attempt(client, 'service_role', `select identity.assert_operation_authority('${a.accountId}', 1)`);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/permission denied for schema identity/);
    });
  });

  it('refuses the browser roles over REST with a permission error', async () => {
    const bodies: Record<string, unknown> = {
      list_accounts: {},
      disable_account: {p_actor: ACTOR, p_account_id: randomUUID()},
      enable_account: {p_actor: ACTOR, p_account_id: randomUUID()},
      guard_operation: {p_account_id: randomUUID(), p_epoch: 1},
      record_account_refusal: {p_user_id: randomUUID(), p_action: 'account.denied', p_account_id: null},
    };
    for (const [name, body] of Object.entries(bodies)) {
      const response = await fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {apikey: stack.anonKey, authorization: `Bearer ${stack.anonKey}`, 'content-type': 'application/json', 'content-profile': 'api'},
        body: JSON.stringify(body),
      });
      expect(response.status, name).toBeGreaterThanOrEqual(401);
      expect(response.status, name).toBeLessThan(500);
      expect((await response.json()).code, name).toBe('42501');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the list', () => {
  it('has exactly the columns the page shows, and none of a Workspace: no project, file or usage', async () => {
    const { rows: found } = await db.query(
      `select a.attname from pg_attribute a join pg_type t on t.typrelid = a.attrelid where t.oid = 'api.account_summary'::regtype and a.attnum > 0 and not a.attisdropped order by a.attnum`,
    );
    expect(found.map((row) => row.attname)).toEqual(['account_id', 'email', 'invitation_kind', 'invitation_label', 'role', 'status', 'created_at']);
  });

  it('lists each Account with its verified Google address, the invitation that made it, its role, status and creation time', async () => {
    await inTx(async (client) => {
      const named = await account(client, {kind: 'named', label: 'Dana Cohen', sessions: 0});
      const general = await account(client, {kind: 'general', sessions: 0});
      const admin = await account(client, {role: 'administrator', sessions: 0});
      await disable(client, general.accountId);
      const list = await rows(client, 'service_role', 'select * from api.list_accounts()');
      const mine = Object.fromEntries(list.filter((row) => [named, general, admin].some((fixture) => fixture.accountId === row.account_id)).map((row) => [row.account_id, row]));
      expect(mine[named.accountId]).toMatchObject({email: named.user.email, invitation_kind: 'named', invitation_label: 'Dana Cohen', role: 'member', status: 'active'});
      expect(mine[general.accountId]).toMatchObject({email: general.user.email, invitation_kind: 'general', invitation_label: null, role: 'member', status: 'disabled'});
      expect(mine[admin.accountId]).toMatchObject({email: admin.user.email, role: 'administrator', status: 'active'});
      expect(mine[named.accountId].created_at).toBeInstanceOf(Date);
    });
  });

  it('lists an Account no code made with no invitation, and an Account whose address Auth no longer vouches for with no address', async () => {
    await inTx(async (client) => {
      // An Account a pre-authorization made (the Administrator's way in): no code redeemed it.
      const direct = await addUser(client);
      const { rows: made } = await client.query(`select identity.activate_account($1, $2, 'member', 'preauthorization') as id`, [direct.id, direct.subject]);
      const gone = await account(client, {sessions: 0});
      await client.query(`update auth.users set deleted_at = now() where id = $1`, [gone.user.id]);
      const list = await rows(client, 'service_role', 'select * from api.list_accounts()');
      expect(list.find((row) => row.account_id === made[0].id)).toMatchObject({email: direct.email, invitation_kind: null, invitation_label: null});
      expect(list.find((row) => row.account_id === gone.accountId)).toMatchObject({email: null, invitation_kind: 'general'});
    });
  });

  it('lists the newest first', async () => {
    await inTx(async (client) => {
      const older = await account(client, {sessions: 0});
      const newer = await account(client, {sessions: 0});
      await client.query('alter table identity.accounts disable trigger accounts_guard');
      await client.query(`update identity.accounts set created_at = now() - interval '2 days' where id = $1`, [older.accountId]);
      await client.query(`update identity.accounts set created_at = now() - interval '1 day' where id = $1`, [newer.accountId]);
      await client.query('alter table identity.accounts enable trigger accounts_guard');
      const ids = (await rows(client, 'service_role', 'select account_id from api.list_accounts()')).map((row) => row.account_id as string);
      expect(ids.indexOf(newer.accountId)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(newer.accountId)).toBeLessThan(ids.indexOf(older.accountId));
    });
  });

  it('is read-only, and never more than 200 rows', async () => {
    await inTx(async (client) => {
      await client.query('set transaction read only');
      const list = await rows(client, 'service_role', 'select * from api.list_accounts()');
      expect(list.length).toBeLessThanOrEqual(200);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('disabling', () => {
  it('does it all in one step: status, the epoch, every grant, the Auth sessions and the audit event, and keeps the Workspace', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 2});
      const orphan = await addSession(client, a.user.id); // an Auth session with no grant (a sign-in that never completed)
      const workspaceBefore = await workspaceOf(client, a.accountId);
      expect(workspaceBefore).toHaveLength(1);

      const receipt = await disable(client, a.accountId);
      expect(receipt).toEqual({outcome: 'disabled', sessions_ended: 3, grants_revoked: 2, epoch: 2});

      expect(await accountRow(client, a.accountId)).toEqual({status: 'disabled', role: 'member', epoch: 2});
      // Every grant is revoked, by the actor, for "disabled"; the rows stay as history.
      const grants = await grantsOf(client, a.accountId);
      expect(grants.map((grant) => grant.session_id).sort()).toEqual([...a.sessions].sort());
      for (const grant of grants) {
        expect(grant.revoked_at).not.toBeNull();
        expect(grant).toMatchObject({revoked_by: ACTOR, revoked_reason: 'disabled'});
      }
      // The Auth sessions are gone, grant or not.
      expect(await authSessionsOf(client, a.user.id)).toEqual([]);
      expect(await authSessionsOf(client, a.user.id)).not.toContain(orphan);
      // The Workspace is untouched.
      expect(await workspaceOf(client, a.accountId)).toEqual(workspaceBefore);
      // The audit trail: who did what to which opaque target, and the per-grant revocations.
      expect(await auditFor(client, 'account.disabled', `account:${a.accountId}`)).toEqual([expect.objectContaining({actor: ACTOR, action: 'account.disabled', target: `account:${a.accountId}`})]);
      expect(await auditFor(client, 'account.epoch_raised', `account:${a.accountId}`)).toEqual([expect.objectContaining({actor: 'system:accounts'})]);
      for (const sessionId of a.sessions) expect(await auditFor(client, 'session.revoked', `session:${sessionId}`)).toEqual([expect.objectContaining({actor: ACTOR})]);
    });
  });

  it('refuses the old sessions at once and for good: authorization says disabled, even if the Auth session is put back; no grant can be issued', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await account(client, {sessions: 1});
      expect(await svc.authorize(a.user.id, a.sessions[0])).toMatchObject({state: 'active'});
      await disable(client, a.accountId);
      expect(await svc.authorize(a.user.id, a.sessions[0])).toMatchObject({state: 'disabled'});
      // Even a session Auth would still have (put back by hand) is refused: the Account is disabled.
      await client.query(`insert into auth.sessions (id, user_id, created_at, updated_at, aal, refreshed_at) values ($1, $2, now(), now(), 'aal1', now())`, [a.sessions[0], a.user.id]);
      expect(await svc.authorize(a.user.id, a.sessions[0])).toMatchObject({state: 'disabled'});
      const later = await addSession(client, a.user.id);
      expect(await svc.issueGrant(a.user.id, later)).toMatchObject({outcome: 'disabled'});
    });
  });

  it('leaves another Account alone: its status, its epoch, its grants and its sessions', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const target = await account(client, {sessions: 2});
      const bystander = await account(client, {sessions: 2});
      const grantsBefore = await grantsOf(client, bystander.accountId);
      await disable(client, target.accountId);
      expect(await accountRow(client, bystander.accountId)).toEqual({status: 'active', role: 'member', epoch: 1});
      expect(await grantsOf(client, bystander.accountId)).toEqual(grantsBefore);
      expect(await authSessionsOf(client, bystander.user.id)).toHaveLength(2);
      for (const sessionId of bystander.sessions) expect(await svc.authorize(bystander.user.id, sessionId)).toMatchObject({state: 'active'});
    });
  });

  it('disables an Account with no session at all: nothing to end, still disabled and audited', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      expect(await disable(client, a.accountId)).toEqual({outcome: 'disabled', sessions_ended: 0, grants_revoked: 0, epoch: 2});
      expect(await accountRow(client, a.accountId)).toMatchObject({status: 'disabled'});
      expect(await auditFor(client, 'account.disabled', `account:${a.accountId}`)).toHaveLength(1);
    });
  });

  it('counts a grant that was already revoked as ended by nobody now: it is final', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await account(client, {sessions: 2});
      await svc.revokeGrants({session: a.sessions[0], actor: 'user:earlier', reason: 'sign_out'});
      expect(await disable(client, a.accountId)).toMatchObject({outcome: 'disabled', sessions_ended: 2, grants_revoked: 1});
      const grants = await grantsOf(client, a.accountId);
      expect(grants.find((grant) => grant.session_id === a.sessions[0])).toMatchObject({revoked_by: 'user:earlier', revoked_reason: 'sign_out'});
      expect(grants.find((grant) => grant.session_id === a.sessions[1])).toMatchObject({revoked_by: ACTOR, revoked_reason: 'disabled'});
    });
  });

  it('says it is already disabled the second time, and changes and audits nothing more', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 2});
      await disable(client, a.accountId);
      const state = {account: await accountRow(client, a.accountId), grants: await grantsOf(client, a.accountId), trail: await auditFor(client, 'account.disabled', `account:${a.accountId}`)};
      expect(await disable(client, a.accountId)).toEqual({outcome: 'already_disabled', sessions_ended: null, grants_revoked: null, epoch: 2});
      expect(await accountRow(client, a.accountId)).toEqual(state.account);
      expect(await grantsOf(client, a.accountId)).toEqual(state.grants);
      expect(await auditFor(client, 'account.disabled', `account:${a.accountId}`)).toEqual(state.trail);
    });
  });

  it('refuses the Administrator\'s Account, and changes and audits nothing', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const admin = await account(client, {role: 'administrator', sessions: 2});
      const grantsBefore = await grantsOf(client, admin.accountId);
      const receipt = await disable(client, admin.accountId);
      expect(receipt).toMatchObject({outcome: 'administrator', sessions_ended: null, grants_revoked: null});
      expect(await accountRow(client, admin.accountId)).toEqual({status: 'active', role: 'administrator', epoch: 1});
      expect(await grantsOf(client, admin.accountId)).toEqual(grantsBefore);
      expect(await authSessionsOf(client, admin.user.id)).toHaveLength(2);
      expect(await svc.authorize(admin.user.id, admin.sessions[0])).toMatchObject({state: 'active'});
      expect(await auditFor(client, 'account.disabled', `account:${admin.accountId}`)).toEqual([]);
    });
  });

  it('says not found for an Account that does not exist', async () => {
    await inTx(async (client) => {
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      expect(await disable(client, randomUUID())).toEqual({outcome: 'not_found', sessions_ended: null, grants_revoked: null, epoch: null});
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before);
    });
  });

  it.each([
    ['no actor', [null, randomUUID()]],
    ['an actor that is not an actor', ['User: Admin', randomUUID()]],
    ['an actor with an injection', ["user:x'; drop table identity.accounts", randomUUID()]],
    ['no Account', [ACTOR, null]],
  ])('refuses %s as an invalid argument', async (_name, args) => {
    await inTx(async (client) => {
      const result = await attempt(client, 'service_role', 'select * from api.disable_account($1, $2)', args);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });

  it('is atomic: if ending the Auth sessions fails, nothing else happened (status, epoch, grants and audit are as they were)', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 2});
      const before = {account: await accountRow(client, a.accountId), grants: await grantsOf(client, a.accountId), audit: await count(client, 'select count(*) as n from identity.audit_events')};
      // Whatever refuses the deletion of the sessions stands for an environment that does not let the owner end them.
      await client.query(`create function public.refuse_session_delete() returns trigger language plpgsql as $$ begin raise exception 'sessions cannot be ended here' using errcode = '42501'; end $$`);
      await client.query('create trigger refuse_session_delete before delete on auth.sessions for each row execute function public.refuse_session_delete()');
      const result = await attempt(client, 'service_role', 'select * from api.disable_account($1, $2)', [ACTOR, a.accountId]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('sessions cannot be ended here');
      await client.query('drop trigger refuse_session_delete on auth.sessions');
      expect(await accountRow(client, a.accountId)).toEqual(before.account);
      expect(await grantsOf(client, a.accountId)).toEqual(before.grants);
      expect(await authSessionsOf(client, a.user.id)).toHaveLength(2);
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before.audit);
      for (const grant of await grantsOf(client, a.accountId)) expect(grant.revoked_at).toBeNull();
    });
  });

  it('holds no content in what it audits: the actor, the action, the opaque target and the time, and no address or name', async () => {
    await inTx(async (client) => {
      const a = await account(client, {kind: 'named', label: 'Sensitive Name', sessions: 1});
      await disable(client, a.accountId);
      await enable(client, a.accountId);
      const { rows: trail } = await client.query(
        `select * from identity.audit_events where target in ($1, $2) or actor = $3 order by id`,
        [`account:${a.accountId}`, `session:${a.sessions[0]}`, ACTOR],
      );
      expect(trail.length).toBeGreaterThanOrEqual(4);
      for (const row of trail) expect(Object.keys(row).sort()).toEqual(['action', 'actor', 'id', 'occurred_at', 'target']);
      const text = JSON.stringify(trail);
      for (const secret of [a.user.email, a.user.subject, 'Sensitive Name', a.workspaceId]) expect(text).not.toContain(secret);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('enabling again', () => {
  it('makes the Account active under a newer epoch and audits it; the grants stay revoked and the Auth sessions stay ended', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 2});
      await disable(client, a.accountId);
      const revoked = await grantsOf(client, a.accountId);
      expect(await enable(client, a.accountId)).toEqual({outcome: 'enabled', epoch: 3});
      expect(await accountRow(client, a.accountId)).toEqual({status: 'active', role: 'member', epoch: 3});
      expect(await auditFor(client, 'account.enabled', `account:${a.accountId}`)).toEqual([expect.objectContaining({actor: ACTOR, action: 'account.enabled', target: `account:${a.accountId}`})]);
      // Nothing was restored.
      expect(await grantsOf(client, a.accountId)).toEqual(revoked);
      expect(await authSessionsOf(client, a.user.id)).toEqual([]);
      expect(await auditFor(client, 'account.epoch_raised', `account:${a.accountId}`)).toHaveLength(2);
    });
  });

  it('refuses the old sessions even if Auth were to have them again: they are revoked, and a new sign-in is what lets the person in, under the newer epoch', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await account(client, {sessions: 1});
      await disable(client, a.accountId);
      await enable(client, a.accountId);
      // The old session, put back in Auth by hand: its grant is revoked for good.
      await client.query(`insert into auth.sessions (id, user_id, created_at, updated_at, aal, refreshed_at) values ($1, $2, now(), now(), 'aal1', now())`, [a.sessions[0], a.user.id]);
      expect(await svc.authorize(a.user.id, a.sessions[0])).toMatchObject({state: 'revoked'});
      expect(await svc.issueGrant(a.user.id, a.sessions[0])).toMatchObject({outcome: 'revoked'});
      // A new sign-in: a new session, a new grant at the newer epoch, and access.
      const anew = await addSession(client, a.user.id);
      expect(await svc.issueGrant(a.user.id, anew)).toMatchObject({outcome: 'issued', epoch: 3});
      expect(await svc.authorize(a.user.id, anew)).toMatchObject({state: 'active', epoch: 3});
    });
  });

  it('keeps the Workspace, the registration, the invitation and the preferences exactly as they were through a disable and an enable', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const a = await account(client, {kind: 'named', label: 'Keeper', sessions: 1});
      await svc.adoptPreferences(a.accountId, {theme: 'dark', locale: 'he'});
      const snapshot = async () => ({
        workspace: await workspaceOf(client, a.accountId),
        commands: (await client.query('select command_id, code_hash from identity.registration_commands where account_id = $1', [a.accountId])).rows,
        invitation: (await client.query('select id, status, label from identity.invitations where redeemed_account_id = $1', [a.accountId])).rows,
        preferences: (await client.query('select locale, theme, detail, guidance from identity.account_preferences where account_id = $1', [a.accountId])).rows,
      });
      const before = await snapshot();
      expect(before.workspace).toHaveLength(1);
      expect(before.preferences).toHaveLength(1);
      await disable(client, a.accountId);
      expect(await snapshot()).toEqual(before);
      await enable(client, a.accountId);
      expect(await snapshot()).toEqual(before);
    });
  });

  it('says it is already enabled for an Account that is, and changes and audits nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 1});
      expect(await enable(client, a.accountId)).toEqual({outcome: 'already_enabled', epoch: 1});
      expect(await accountRow(client, a.accountId)).toMatchObject({status: 'active', epoch: 1});
      expect(await auditFor(client, 'account.enabled', `account:${a.accountId}`)).toEqual([]);
      expect(await grantsOf(client, a.accountId)).toHaveLength(1);
      expect((await grantsOf(client, a.accountId))[0].revoked_at).toBeNull();
    });
  });

  it('says not found for an Account that does not exist, and refuses bad arguments', async () => {
    await inTx(async (client) => {
      expect(await enable(client, randomUUID())).toEqual({outcome: 'not_found', epoch: null});
      for (const args of [[null, randomUUID()], ['User: Admin', randomUUID()], [ACTOR, null]]) {
        const result = await attempt(client, 'service_role', 'select * from api.enable_account($1, $2)', args);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });

  it('can disable and enable again and again, each time under a newer epoch, with one audit event for each', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      for (const round of [1, 2, 3]) {
        expect((await disable(client, a.accountId)).epoch).toBe(round * 2);
        expect((await enable(client, a.accountId)).epoch).toBe(round * 2 + 1);
      }
      expect(await auditFor(client, 'account.disabled', `account:${a.accountId}`)).toHaveLength(3);
      expect(await auditFor(client, 'account.enabled', `account:${a.accountId}`)).toHaveLength(3);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the authority guard (api.guard_operation)', () => {
  it('allows an operation registered under the Account\'s current epoch, and says which epoch that is', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      expect(await guard(client, a.accountId, 1)).toEqual({outcome: 'allowed', epoch: 1});
    });
  });

  it('denies a disabled Account, whatever the epoch the operation holds', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      await disable(client, a.accountId);
      for (const epoch of [1, 2, 3]) expect(await guard(client, a.accountId, epoch)).toEqual({outcome: 'disabled', epoch: 2});
    });
  });

  it('denies an operation registered before a disable, also after the Account is enabled again: its epoch is stale', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      await disable(client, a.accountId);
      await enable(client, a.accountId);
      expect(await guard(client, a.accountId, 1)).toEqual({outcome: 'stale_epoch', epoch: 3});
      expect(await guard(client, a.accountId, 2)).toEqual({outcome: 'stale_epoch', epoch: 3});
      // An operation registered after the enable, under the live authorization of the new sign-in, is allowed.
      expect(await guard(client, a.accountId, 3)).toEqual({outcome: 'allowed', epoch: 3});
    });
  });

  it('denies an operation when the epoch is raised for any other reason too (a revocation by epoch)', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      await api(client).raiseEpoch(a.accountId);
      expect(await guard(client, a.accountId, 1)).toEqual({outcome: 'stale_epoch', epoch: 2});
    });
  });

  it('denies an epoch the Account has not reached: it is not one this Account registered', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      expect(await guard(client, a.accountId, 7)).toEqual({outcome: 'stale_epoch', epoch: 1});
    });
  });

  it('says no_account for an Account that does not exist', async () => {
    await inTx(async (client) => {
      expect(await guard(client, randomUUID(), 1)).toEqual({outcome: 'no_account', epoch: null});
    });
  });

  it.each([
    ['no Account', [null, 1]],
    ['no epoch', [randomUUID(), null]],
    ['an epoch of zero', [randomUUID(), 0]],
    ['a negative epoch', [randomUUID(), -4]],
  ])('refuses %s as an invalid argument', async (_name, args) => {
    await inTx(async (client) => {
      const result = await attempt(client, 'service_role', 'select * from api.guard_operation($1, $2)', args);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });

  it('only reads: it works in a read-only transaction, writes no audit event, and takes no lock a disable would wait for', async () => {
    const a = await committedAccount({sessions: 0});
    const asker = await connect();
    const disabler = await connect();
    await asker.query('begin read only');
    expect((await asker.query('select outcome from api.guard_operation($1, 1)', [a.accountId])).rows[0].outcome).toBe('allowed');
    // The disable is not blocked by the open transaction that asked.
    await disabler.query('set lock_timeout = 3000');
    expect((await disabler.query('select outcome from api.disable_account($1, $2)', [ACTOR, a.accountId])).rows[0].outcome).toBe('disabled');
    await asker.query('commit');
    expect((await db.query('select outcome from api.guard_operation($1, 1)', [a.accountId])).rows[0].outcome).toBe('disabled');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the SQL assertion (identity.assert_operation_authority), for steps that publish', () => {
  const assertAuthority = (client: Client, accountId: string | null, epoch: number | null) => attempt(client, null, 'select identity.assert_operation_authority($1, $2)', [accountId, epoch]);

  it('passes for an active Account under the epoch the operation registered under', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      expect((await assertAuthority(client, a.accountId, 1)).ok).toBe(true);
    });
  });

  it.each([
    ['a disabled Account', 'disabled'],
    ['an Account enabled again, for an operation registered before the disable', 'stale_epoch'],
    ['an Account that does not exist', 'no_account'],
  ] as const)('raises N3010, naming why, for %s, and the transaction can write nothing after it', async (_name, reason) => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      let accountId = a.accountId;
      if (reason === 'disabled') await disable(client, a.accountId);
      if (reason === 'stale_epoch') {
        await disable(client, a.accountId);
        await enable(client, a.accountId);
      }
      if (reason === 'no_account') accountId = randomUUID();
      const result = await assertAuthority(client, accountId, 1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3010');
        expect(result.message).toBe(`operation authority denied: ${reason}`);
      }
    });
  });

  it('raises for an epoch the Account has not reached, and refuses a missing Account or epoch as invalid', async () => {
    await inTx(async (client) => {
      const a = await account(client, {sessions: 0});
      const ahead = await assertAuthority(client, a.accountId, 9);
      expect(ahead.ok).toBe(false);
      if (!ahead.ok) expect(ahead.message).toBe('operation authority denied: stale_epoch');
      for (const [accountId, epoch] of [[null, 1], [a.accountId, null], [a.accountId, 0]] as const) {
        const result = await assertAuthority(client, accountId, epoch);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });

  it('holds the Account FOR SHARE until the transaction ends, so a disable waits for a publication that has passed the check, and then proceeds', async () => {
    const a = await committedAccount({sessions: 0});
    const publisher = await connect();
    const disabler = await connect();
    const { rows: pid } = await disabler.query('select pg_backend_pid() as pid');
    await publisher.query('begin');
    await publisher.query('select identity.assert_operation_authority($1, 1)', [a.accountId]);

    // The disable cannot commit between the check and the write: it waits for the row.
    const disabling = disabler.query('select outcome from api.disable_account($1, $2)', [ACTOR, a.accountId]);
    let settled = false;
    disabling.then(() => (settled = true), () => (settled = true));
    await untilBlocked(pid[0].pid);
    expect(settled).toBe(false);

    // The write that publishes. It is allowed to finish, because the check passed before the disable began.
    expect((await publisher.query(`select outcome from api.set_preference($1, 'theme', 'dark')`, [a.accountId])).rows[0].outcome).toBe('saved');
    await publisher.query('commit');

    expect((await disabling).rows[0].outcome).toBe('disabled');
    const published = await db.query('select theme, updated_at from identity.account_preferences where account_id = $1', [a.accountId]);
    expect(published.rows[0].theme).toBe('dark');
    const disabledAt = (await auditFor(db, 'account.disabled', `account:${a.accountId}`))[0].occurred_at;
    expect(published.rows[0].updated_at.getTime()).toBeLessThanOrEqual(disabledAt.getTime());
    expect(await accountRow(db, a.accountId)).toMatchObject({status: 'disabled'});
  });

  it('raises when the disable committed first, and nothing is written (a disable racing a publication: one wins cleanly)', async () => {
    const a = await committedAccount({sessions: 0});
    const publisher = await connect();
    // The operation registered under epoch 1, before the disable.
    expect((await db.query('select outcome from api.disable_account($1, $2)', [ACTOR, a.accountId])).rows[0].outcome).toBe('disabled');
    await publisher.query('begin');
    await expect(publisher.query('select identity.assert_operation_authority($1, 1)', [a.accountId])).rejects.toMatchObject({code: 'N3010', message: 'operation authority denied: disabled'});
    await publisher.query('rollback');
    expect((await db.query('select count(*)::int as n from identity.account_preferences where account_id = $1', [a.accountId])).rows[0].n).toBe(0);
  });

  it('is one winner every time when a publication and a disable start together (real connections, 12 rounds)', async () => {
    const publisher = await connect();
    const disabler = await connect();
    const outcomes = {published: 0, refused: 0};
    for (let round = 0; round < 12; round += 1) {
      const a = await committedAccount({sessions: 0});
      const publish = (async () => {
        await publisher.query('begin');
        try {
          await publisher.query('select identity.assert_operation_authority($1, 1)', [a.accountId]);
          await publisher.query(`select outcome from api.set_preference($1, 'theme', 'dark')`, [a.accountId]);
          await publisher.query('commit');
          return 'published';
        } catch (error) {
          await publisher.query('rollback');
          expect((error as {code?: string}).code).toBe('N3010');
          return 'refused';
        }
      })();
      const disabling = disabler.query('select outcome from api.disable_account($1, $2)', [ACTOR, a.accountId]);
      const [result] = await Promise.all([publish, disabling]);
      outcomes[result] += 1;
      const stored = await db.query('select theme, updated_at from identity.account_preferences where account_id = $1', [a.accountId]);
      expect(await accountRow(db, a.accountId)).toMatchObject({status: 'disabled'});
      if (result === 'published') {
        // The publication committed before the disable did.
        expect(stored.rows).toHaveLength(1);
        const disabledAt = (await auditFor(db, 'account.disabled', `account:${a.accountId}`))[0].occurred_at;
        expect(stored.rows[0].updated_at.getTime()).toBeLessThanOrEqual(disabledAt.getTime());
      } else {
        expect(stored.rows).toHaveLength(0);
      }
    }
    expect(outcomes.published + outcomes.refused).toBe(12);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('two windows, and a grant being issued, while an Account is disabled (real connections, committed data)', () => {
  it('lets one of two simultaneous disables win and tells the other it is already disabled; one audit event, one set of revocations', async () => {
    const a = await committedAccount({sessions: 2});
    const clients = await Promise.all([connect(), connect(), connect()]);
    const answers = await Promise.all(clients.map((client) => client.query('select outcome, sessions_ended, grants_revoked from api.disable_account($1, $2)', [ACTOR, a.accountId])));
    const outcomes = answers.map((answer) => answer.rows[0].outcome).sort();
    expect(outcomes).toEqual(['already_disabled', 'already_disabled', 'disabled']);
    expect(answers.find((answer) => answer.rows[0].outcome === 'disabled')!.rows[0]).toMatchObject({sessions_ended: 2, grants_revoked: 2});
    expect(await auditFor(db, 'account.disabled', `account:${a.accountId}`)).toHaveLength(1);
    for (const sessionId of a.sessions) expect(await auditFor(db, 'session.revoked', `session:${sessionId}`)).toHaveLength(1);
    expect(await accountRow(db, a.accountId)).toMatchObject({status: 'disabled', epoch: 2});
  });

  it('lets one of a simultaneous disable and enable win cleanly, and leaves the Account in a state one of them made', async () => {
    const a = await committedAccount({sessions: 1});
    await db.query('select * from api.disable_account($1, $2)', [ACTOR, a.accountId]);
    const [one, two] = await Promise.all([connect(), connect()]);
    const [enabled, disabled] = await Promise.all([
      one.query('select outcome from api.enable_account($1, $2)', [ACTOR, a.accountId]),
      two.query('select outcome from api.disable_account($1, $2)', [ACTOR, a.accountId]),
    ]);
    const final = (await accountRow(db, a.accountId)).status;
    // Either the enable ran first (then the disable disabled it again) or the disable found it still disabled.
    if (enabled.rows[0].outcome === 'enabled' && disabled.rows[0].outcome === 'disabled') expect(final).toBe('disabled');
    else expect([enabled.rows[0].outcome, disabled.rows[0].outcome]).toEqual(['enabled', 'already_disabled']);
    expect(['active', 'disabled']).toContain(final);
  });

  it('revokes a grant that was being issued when the disable started: either seen and revoked, or refused afterwards', async () => {
    const a = await committedAccount({sessions: 1});
    const issuer = await connect();
    const disabler = await connect();
    const later = await addSession(db, a.user.id);
    const { rows: pid } = await disabler.query('select pg_backend_pid() as pid');
    await issuer.query('begin');
    expect((await issuer.query('select outcome from api.issue_grant($1, $2)', [a.user.id, later])).rows[0].outcome).toBe('issued');
    const disabling = disabler.query('select outcome, sessions_ended, grants_revoked from api.disable_account($1, $2)', [ACTOR, a.accountId]);
    await untilBlocked(pid[0].pid);
    await issuer.query('commit');
    const done = (await disabling).rows[0];
    // The grant issued while the disable waited was in the table when the revocation read it.
    expect(done).toMatchObject({outcome: 'disabled', sessions_ended: 2, grants_revoked: 2});
    for (const grant of await grantsOf(db, a.accountId)) expect(grant.revoked_at).not.toBeNull();
    expect(await authSessionsOf(db, a.user.id)).toEqual([]);
    // And the other order: a grant asked for after the commit is refused.
    const after = await addSession(db, a.user.id);
    expect((await db.query('select outcome from api.issue_grant($1, $2)', [a.user.id, after])).rows[0].outcome).toBe('disabled');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('refusing a change is audited (api.record_account_refusal)', () => {
  const call = 'select outcome from api.record_account_refusal($1, $2, $3)';

  it('accepts each of the three refusals from exactly one of the two roles', async () => {
    await inTx(async (client) => {
      const member = await account(client, {sessions: 0});
      const admin = await account(client, {role: 'administrator', sessions: 0});
      const accepted: string[] = [];
      for (const action of accountRefusalActions) {
        for (const who of [member, admin]) if ((await attempt(client, 'service_role', call, [who.user.id, action, null])).ok) accepted.push(`${action}:${who === admin ? 'administrator' : 'member'}`);
      }
      expect(accepted.sort()).toEqual(['account.denied:member', 'account.disable_refused:administrator', 'account.enable_refused:administrator']);
    });
  });

  it.each([
    ['an action that is not a refusal', 'account.disabled'],
    ['an invitation refusal', 'invitation.denied'],
    ['another audit family', 'step_up.limited'],
    ['a different spelling', 'Account.Denied'],
    ['an empty action', ''],
    ['text that is no action', "account.denied'; delete from identity.audit_events"],
    ['no action', null],
  ])('refuses %s as an invalid argument, and writes nothing', async (_name, action) => {
    await inTx(async (client) => {
      const admin = await account(client, {role: 'administrator', sessions: 0});
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      const result = await attempt(client, 'service_role', call, [admin.user.id, action, null]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before);
    });
  });

  it('refuses a user with no Account, and no user, as invalid', async () => {
    await inTx(async (client) => {
      const stranger = await addUser(client);
      for (const user of [stranger.id, randomUUID(), null]) {
        const result = await attempt(client, 'service_role', call, [user, 'account.denied', null]);
        expect(result.ok, String(user)).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
    });
  });

  it('records the actor and the Account the attempt named, as an opaque target, and only if that Account exists', async () => {
    await inTx(async (client) => {
      const admin = await account(client, {role: 'administrator', sessions: 0});
      const target = await account(client, {sessions: 0});
      const actor = `user:${admin.user.id}`;
      expect((await client.query(call, [admin.user.id, 'account.disable_refused', target.accountId])).rows[0].outcome).toBe('recorded');
      // An ID that names nothing is recorded as an attempt with no target, so inventing IDs cannot grow the trail by target.
      expect((await client.query(call, [admin.user.id, 'account.enable_refused', randomUUID()])).rows[0].outcome).toBe('recorded');
      expect((await client.query(call, [admin.user.id, 'account.enable_refused', randomUUID()])).rows[0].outcome).toBe('repeated');
      expect((await eventsBy(client, actor)).map((event) => [event.action, event.target])).toEqual([
        ['account.disable_refused', `account:${target.accountId}`],
        ['account.enable_refused', null],
      ]);
    });
  });

  it('is once an hour for one actor, one action and one target, and again after the hour', async () => {
    await inTx(async (client) => {
      const admin = await account(client, {role: 'administrator', sessions: 0});
      const [one, two] = [await account(client, {sessions: 0}), await account(client, {sessions: 0})];
      const outcomes: string[] = [];
      for (const [action, target] of [
        ['account.disable_refused', one.accountId],
        ['account.disable_refused', one.accountId],
        ['account.disable_refused', two.accountId],
        ['account.enable_refused', one.accountId],
        ['account.enable_refused', one.accountId],
        ['account.disable_refused', null],
        ['account.disable_refused', null],
      ] as const) outcomes.push((await client.query(call, [admin.user.id, action, target])).rows[0].outcome);
      expect(outcomes).toEqual(['recorded', 'repeated', 'recorded', 'recorded', 'repeated', 'recorded', 'repeated']);
      expect(await eventsBy(client, `user:${admin.user.id}`, 'account.disable_refused')).toHaveLength(3);

      const other = await account(client, {role: 'administrator', sessions: 0});
      await client.query(`insert into identity.audit_events (occurred_at, actor, action) values (clock_timestamp() - interval '61 minutes', $1, 'account.disable_refused')`, [`user:${other.user.id}`]);
      expect((await client.query(call, [other.user.id, 'account.disable_refused', null])).rows[0].outcome).toBe('recorded');
      await client.query(`insert into identity.audit_events (occurred_at, actor, action) values (clock_timestamp() - interval '59 minutes', $1, 'account.enable_refused')`, [`user:${other.user.id}`]);
      expect((await client.query(call, [other.user.id, 'account.enable_refused', null])).rows[0].outcome).toBe('repeated');
    });
  });

  it('is exactly once when many refusals arrive at the same moment (real connections)', async () => {
    const admin = await committedAccount({sessions: 0});
    await db.query(`update identity.accounts set role = 'administrator' where id = $1`, [admin.accountId]);
    const target = await committedAccount({sessions: 0});
    const clients = await Promise.all(Array.from({length: 8}, () => connect()));
    const answers = await Promise.all(clients.map((client) => client.query(call, [admin.user.id, 'account.disable_refused', target.accountId])));
    const outcomes = answers.map((answer) => answer.rows[0].outcome);
    expect(outcomes.filter((outcome) => outcome === 'recorded')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'repeated')).toHaveLength(7);
    expect(await eventsBy(db, `user:${admin.user.id}`, 'account.disable_refused')).toHaveLength(1);
  });

  it('holds no content: no reason, marker outcome, address or name, and is immutable once written', async () => {
    await inTx(async (client) => {
      const member = await account(client, {sessions: 0});
      await client.query(call, [member.user.id, 'account.denied', member.accountId]);
      const events = await eventsBy(client, `user:${member.user.id}`);
      expect(events).toEqual([{actor: `user:${member.user.id}`, action: 'account.denied', target: `account:${member.accountId}`, occurred_at: expect.any(Date)}]);
      expect(JSON.stringify(events)).not.toContain(member.user.email);
      for (const sql of [`update identity.audit_events set action = 'account.enabled' where actor = $1`, `delete from identity.audit_events where actor = $1`]) {
        const result = await attempt(client, null, sql, [`user:${member.user.id}`]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code).toBe('55000');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight probes the Story 1.5 functions and the privilege to end Auth sessions', () => {
  it('answers ok', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
    });
  });

  it('fails the build with one line, naming what is missing, when a function of the migration is not there', async () => {
    await inTx(async (client) => {
      await client.query('drop function api.record_account_refusal(uuid, text, uuid)');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('api.record_account_refusal(uuid,text,uuid)');
      }
    });
  });

  it('fails when the SQL assertion is missing', async () => {
    await inTx(async (client) => {
      await client.query('drop function identity.assert_operation_authority(uuid, bigint)');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('identity.assert_operation_authority(uuid,bigint)');
    });
  });

  it('fails when the service role cannot execute one of the functions it calls', async () => {
    await inTx(async (client) => {
      await client.query('revoke execute on function api.disable_account(text, uuid) from service_role');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain('api.disable_account(text,uuid)');
      }
    });
  });

  it('fails when the role it runs as may read every table but not end Auth sessions, and says so', async () => {
    await inTx(async (client) => {
      await client.query('grant usage on schema api, identity, projects, lifecycle to anon');
      await client.query('grant create on schema api to anon');
      for (const table of [
        'identity.session_grants',
        'identity.accounts',
        'identity.account_preferences',
        'identity.step_up_nonces',
        'identity.fresh_authentications',
        'identity.recovery_tokens',
        'projects.projects',
        'projects.project_commands',
        'lifecycle.tombstones',
        'lifecycle.ledger_outbox',
        'lifecycle.ledger_relay',
        'lifecycle.status_requests',
        'lifecycle.job_receipts',
        'auth.sessions',
        'auth.identities',
        'auth.mfa_amr_claims',
      ]) await client.query(`grant select on ${table} to anon`);
      await client.query('alter function api.preflight() owner to anon');
      const refused = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.code).toBe('42501');
        expect(refused.message).toContain('end Auth sessions');
        expect(refused.message).toContain('auth.sessions');
      }
      // (The control is the test above: run as its real owner, which may delete from auth.sessions, it answers ok. `postgres`
      // holds DELETE on the table without the right to grant it, so a test cannot hand it to another role.)
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls and the authority module over REST, as the application makes them (committed data)', () => {
  it('lists, disables, guards, enables and records a refusal end to end', async () => {
    const admin = await committedAccount({sessions: 1});
    await db.query(`update identity.accounts set role = 'administrator' where id = $1`, [admin.accountId]);
    const member = await committedAccount({sessions: 2});
    const actor = `user:${admin.user.id}`;
    const operation = operationOf({accountId: member.accountId, epoch: 1});

    expect((await listAccounts({env})).find((row) => row.accountId === member.accountId)).toMatchObject({email: member.user.email, status: 'active', role: 'member', invitationKind: 'named'});
    expect(await guardOperation(operation, {env})).toEqual({outcome: 'allowed', epoch: 1});
    expect(await authorizeStep(operation, {env, log: () => undefined})).toEqual({allowed: true, epoch: 1});

    // The Administrator's own Account is refused; the member's is disabled, and a canceller then sees the guard already denying.
    expect(await disableAccount({accountId: admin.accountId, actor}, {env})).toMatchObject({outcome: 'administrator'});
    const seen: unknown[] = [];
    const remove = registerCanceller({
      name: 'integration-probe',
      cancel: async (target) => {
        seen.push([target, await authorizeStep(operation, {env, log: () => undefined})]);
        return 2;
      },
    });
    try {
      const receipt = await disableAccount({accountId: member.accountId, actor}, {env});
      expect(receipt).toEqual({outcome: 'disabled', sessionsEnded: 2, grantsRevoked: 2, epoch: 2});
      expect(await runCancellers({accountId: member.accountId, epoch: receipt.epoch!}, {log: () => undefined})).toEqual({cancellers: 1, cancelled: 2, failed: 0});
    } finally {
      remove();
    }
    expect(seen).toEqual([[{accountId: member.accountId, epoch: 2}, {allowed: false, reason: 'disabled'}]]);
    expect((await listAccounts({env})).find((row) => row.accountId === member.accountId)).toMatchObject({status: 'disabled'});
    expect(await authorizeSession(member.user.id, member.sessions[0], {env})).toMatchObject({state: 'disabled'});
    expect(await disableAccount({accountId: member.accountId, actor}, {env})).toMatchObject({outcome: 'already_disabled'});

    // Enabled again: the operation that registered before stays denied, a new one is allowed.
    expect(await enableAccount({accountId: member.accountId, actor}, {env})).toEqual({outcome: 'enabled', epoch: 3});
    expect(await authorizeStep(operation, {env, log: () => undefined})).toEqual({allowed: false, reason: 'stale_epoch'});
    expect(await authorizeStep({accountId: member.accountId, epoch: 3}, {env, log: () => undefined})).toEqual({allowed: true, epoch: 3});
    expect(await enableAccount({accountId: member.accountId, actor}, {env})).toMatchObject({outcome: 'already_enabled'});
    expect(await authorizeSession(member.user.id, member.sessions[0], {env})).toMatchObject({state: 'no_session'});

    // Refusals: the Administrator without a marker, a member who tried.
    expect(await recordAccountRefusal({userId: admin.user.id, action: 'account.disable_refused', accountId: member.accountId}, {env})).toBe('recorded');
    expect(await recordAccountRefusal({userId: admin.user.id, action: 'account.disable_refused', accountId: member.accountId}, {env})).toBe('repeated');
    expect(await recordAccountRefusal({userId: member.user.id, action: 'account.denied', accountId: member.accountId}, {env})).toBe('recorded');
    await expect(recordAccountRefusal({userId: member.user.id, action: 'account.disable_refused'}, {env})).rejects.toMatchObject({code: '22023', retryable: false});

    // The audit trail names who did what to which opaque target, and holds no address.
    expect((await eventsBy(db, actor)).map((event) => [event.action, event.target])).toEqual([
      ['session.revoked', expect.stringMatching(/^session:/)],
      ['session.revoked', expect.stringMatching(/^session:/)],
      ['account.disabled', `account:${member.accountId}`],
      ['account.enabled', `account:${member.accountId}`],
      ['account.disable_refused', `account:${member.accountId}`],
    ]);
    const trail = JSON.stringify((await db.query(`select * from identity.audit_events where actor = $1 or target = $2`, [actor, `account:${member.accountId}`])).rows);
    expect(trail).not.toContain(member.user.email);
    expect(trail).not.toContain(admin.user.email);
  });

  it('turns an answer it cannot get into a denial: an unknown Account is no_account, and a service that is not there is unreachable', async () => {
    expect(await authorizeStep({accountId: randomUUID(), epoch: 1}, {env, log: () => undefined})).toEqual({allowed: false, reason: 'no_account'});
    expect(await authorizeStep({accountId: randomUUID(), epoch: 1}, {env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}, timeoutMs: 1500, log: () => undefined})).toEqual({allowed: false, reason: 'unreachable'});
  });
});
