import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {describe, expect, it} from 'vitest';
import {
  AccountsUnavailableError,
  accountStatus,
  consumePreauthorization,
  generateInvitationCode,
  hashClientAddress,
  hashInvitationCode,
  issueInvitation,
  listInvitations,
  registerWithCode,
} from '@/lib/accounts';
import {codeHash, createHarness, generic, originHash, stack, tag, uuidPattern, withoutCommand, type UserOptions} from '../support/accounts-db';
import {jwtSecretOf} from '../support/stack';

// Story 1.3 Part A against the Supabase CLI stack: every row of the I/O matrix and every Part A
// acceptance criterion. Most cases run inside a transaction that is rolled back, as the service role.
// The cases that need several real connections are in accounts-concurrency.test.ts, and the seed command
// run against the database is in accounts-seed.test.ts.

const {db, connect, committed, cleanup, inTx, addUser, attempt, rows, api, count, invitationStatus, failuresOf} = createHarness();
const committedUsers = committed.users;
const committedOrigins = committed.origins;
const committedHashes = committed.hashes;
const committedInvitationIds = committed.invitationIds;

// ---------------------------------------------------------------------------------------------------
describe('schema, access and AC-8: anon and authenticated can execute and read nothing', () => {
  const tables = {
    identity: [
      'accounts',
      'audit_events',
      'fresh_authentications',
      'invitations',
      'preauthorizations',
      'rate_limit_counters',
      'registration_attempts',
      'registration_commands',
      'session_grants',
      'step_up_nonces',
    ],
    projects: ['workspaces'],
  };
  const apiFunctions = [
    'account_status',
    'authorize_session',
    'before_user_created',
    'complete_step_up',
    'confirm_registration',
    'consume_preauthorization',
    'issue_grant',
    'issue_invitation',
    'list_invitations',
    'preflight',
    'raise_authorization_epoch',
    'register_with_code',
    'revoke_grants',
    'revoke_invitation',
    'seed_preauthorization',
    'start_step_up',
    'use_marker',
    'withdraw_preauthorization',
  ];

  it('creates the tables in the unexposed schemas, and only there', async () => {
    const {rows: found} = await db.query(
      `select schemaname, tablename from pg_tables where schemaname in ('identity', 'projects', 'api') order by 1, 2`,
    );
    expect(found).toEqual([
      ...tables.identity.map((tablename) => ({schemaname: 'identity', tablename})),
      ...tables.projects.map((tablename) => ({schemaname: 'projects', tablename})),
    ]);
  });

  it('has row-level security on and no policies on every table', async () => {
    const {rows: found} = await db.query(
      `select n.nspname || '.' || c.relname as name, c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname in ('identity', 'projects') and c.relkind = 'r' order by 1`,
    );
    expect(found).toHaveLength(11);
    for (const row of found) expect(row, row.name).toMatchObject({rls: true, policies: 0});
  });

  it('grants public, anon, authenticated and service_role nothing on any schema, table or sequence', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const schema of ['identity', 'projects']) {
        const {rows: usage} = await db.query('select has_schema_privilege($1, $2, $3) as usage', [role, schema, 'usage']);
        expect(usage[0].usage, `${role} usage on ${schema}`).toBe(false);
      }
      const {rows: objects} = await db.query(
        `select n.nspname || '.' || c.relname as name, c.relkind,
                case when c.relkind = 'S' then has_sequence_privilege($1, c.oid, 'usage,select,update')
                     else has_table_privilege($1, c.oid, 'select,insert,update,delete,truncate,references,trigger') end as any_privilege
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('identity', 'projects') and c.relkind in ('r', 'S')`,
        [role],
      );
      expect(objects.length).toBeGreaterThanOrEqual(10);
      for (const object of objects) expect(object.any_privilege, `${role} on ${object.name}`).toBe(false);
    }
    // PUBLIC (grantee 0) appears in no ACL of any schema, table or sequence either.
    const {rows: publicGrants} = await db.query(
      `select n.nspname as name from pg_namespace n, aclexplode(n.nspacl) a where n.nspname in ('identity', 'projects', 'api') and a.grantee = 0
       union all
       select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
        where n.nspname in ('identity', 'projects') and a.grantee = 0`,
    );
    expect(publicGrants).toEqual([]);
  });

  it('lets only service_role execute an api function (the Auth hook belongs to supabase_auth_admin) and nothing in identity or projects', async () => {
    const {rows: functions} = await db.query(
      `select n.nspname as schema, p.proname as name, p.prosecdef as definer, p.proconfig as config, p.proacl is null as default_acl,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1)
                          from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('api', 'identity', 'projects') order by 1, 2`,
    );
    expect(functions.filter((f) => f.schema === 'api').map((f) => f.name)).toEqual(apiFunctions);
    for (const f of functions) {
      expect(f.default_acl, `${f.schema}.${f.name} has an explicit ACL`).toBe(false);
      expect(String(f.config), `${f.schema}.${f.name} pins search_path`).toContain('search_path=');
      if (f.schema !== 'api') expect(f.grantees, `${f.schema}.${f.name}`).toEqual([]);
      else if (f.name === 'before_user_created') expect(f.grantees).toEqual(['supabase_auth_admin']);
      else {
        expect(f.grantees, `api.${f.name}`).toEqual(['service_role']);
        expect(f.definer, `api.${f.name} runs as its owner`).toBe(true);
      }
    }
  });

  it('keeps the api schema for service_role and supabase_auth_admin only', async () => {
    const {rows: grants} = await db.query(
      `select case when a.grantee = 0 then 'public' else a.grantee::regrole::text end as grantee
         from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'api' and a.grantee <> n.nspowner order by 1`,
    );
    expect(grants).toEqual([{grantee: 'service_role'}, {grantee: 'supabase_auth_admin'}]);
  });

  it('makes accounts.user_id reference auth.users with ON DELETE RESTRICT', async () => {
    const {rows: constraints} = await db.query(
      `select confdeltype from pg_constraint where conrelid = 'identity.accounts'::regclass and confrelid = 'auth.users'::regclass and contype = 'f'`,
    );
    expect(constraints).toEqual([{confdeltype: 'r'}]);
  });

  it('takes no address or email from the caller when consuming a pre-authorization', async () => {
    const {rows: signature} = await db.query(`select pg_get_function_arguments('api.consume_preauthorization(uuid)'::regprocedure) as args`);
    expect(signature[0].args).toBe('p_user_id uuid');
  });

  it('closes a new function or table by default: a throwaway one made here is executable and readable by nobody', async () => {
    await inTx(async (client) => {
      for (const schema of ['api', 'identity', 'projects']) {
        await client.query(`create function ${schema}.throwaway() returns integer language sql as 'select 1'`);
        const {rows: acl} = await client.query(
          `select p.proacl::text as acl, (select count(*)::int from aclexplode(p.proacl) a where a.grantee = 0) as public_grants
             from pg_proc p where p.oid = '${schema}.throwaway()'::regprocedure`,
        );
        expect(acl[0], `${schema}.throwaway() has an explicit ACL`).toMatchObject({public_grants: 0});
        expect(acl[0].acl, schema).not.toBeNull();
        for (const role of ['anon', 'authenticated', 'service_role']) {
          const {rows: grant} = await client.query(`select has_function_privilege($1, '${schema}.throwaway()', 'execute') as can`, [role]);
          expect(grant[0].can, `${role} on ${schema}.throwaway()`).toBe(false);
          const denied = await attempt(client, role, `select ${schema}.throwaway()`);
          expect(denied.ok, `${role} calls ${schema}.throwaway()`).toBe(false);
        }
      }
      for (const schema of ['identity', 'projects']) {
        await client.query(`create table ${schema}.throwaway (id integer generated always as identity primary key)`);
        for (const role of ['anon', 'authenticated', 'service_role']) {
          const {rows: grant} = await client.query(
            `select has_table_privilege($1, '${schema}.throwaway', 'select,insert,update,delete,truncate,references,trigger') as can,
                    has_sequence_privilege($1, '${schema}.throwaway_id_seq', 'usage,select,update') as can_sequence`,
            [role],
          );
          expect(grant[0], `${role} on ${schema}.throwaway`).toEqual({can: false, can_sequence: false});
        }
      }
      // The same statement in the public schema is unchanged: Supabase's own grants to its API roles apply there.
      await client.query(`create function public.throwaway() returns integer language sql as 'select 1'`);
      const {rows: open} = await client.query(`select has_function_privilege('anon', 'public.throwaway()', 'execute') as anon`);
      expect(open[0].anon).toBe(true);
    });
  });

  it('denies anon and authenticated every api function and every table at the database', async () => {
    await inTx(async (client) => {
      const calls = [
        'select * from api.account_status(gen_random_uuid())',
        'select * from api.authorize_session(gen_random_uuid(), gen_random_uuid())',
        'select * from api.issue_grant(gen_random_uuid(), gen_random_uuid())',
        `select * from api.revoke_grants('seed', 'test', gen_random_uuid())`,
        `select * from api.confirm_registration(gen_random_uuid(), gen_random_uuid(), repeat('a', 64))`,
        'select * from api.preflight()',
        `select * from api.raise_authorization_epoch(gen_random_uuid(), 'seed')`,
        'select * from api.consume_preauthorization(gen_random_uuid())',
        `select * from api.register_with_code(gen_random_uuid(), gen_random_uuid(), repeat('a', 64), repeat('b', 64))`,
        `select * from api.seed_preauthorization('a@b.co', 'member', 'seed')`,
        `select * from api.withdraw_preauthorization('a@b.co', 'seed')`,
        `select * from api.issue_invitation(repeat('a', 64), 'general', null, 'seed', false)`,
        `select * from api.revoke_invitation('seed', gen_random_uuid(), null)`,
        'select * from api.list_invitations()',
        `select api.before_user_created('{}'::jsonb)`,
      ];
      for (const role of ['anon', 'authenticated']) {
        for (const sql of calls) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.message).toMatch(/permission denied for schema api/);
        }
        for (const [schema, names] of Object.entries(tables)) {
          for (const name of names) {
            const result = await attempt(client, role, `select * from ${schema}.${name}`);
            expect(result.ok, `${role} reads ${schema}.${name}`).toBe(false);
            if (!result.ok) expect(result.message).toMatch(new RegExp(`permission denied for schema ${schema}`));
            const write = await attempt(client, role, `delete from ${schema}.${name}`);
            expect(write.ok, `${role} writes ${schema}.${name}`).toBe(false);
          }
        }
      }
    });
  });

  it('gives service_role no direct table access, and no access to the hook', async () => {
    await inTx(async (client) => {
      for (const [schema, names] of Object.entries(tables)) {
        for (const name of names) {
          const result = await attempt(client, 'service_role', `select * from ${schema}.${name}`);
          expect(result.ok, `${schema}.${name}`).toBe(false);
          if (!result.ok) expect(result.message).toMatch(new RegExp(`permission denied for schema ${schema}`));
        }
      }
      const hook = await attempt(client, 'service_role', `select api.before_user_created('{}'::jsonb)`);
      expect(hook.ok).toBe(false);
      const internal = await attempt(client, 'service_role', `select identity.record_audit('seed', 'x.y')`);
      expect(internal.ok).toBe(false);
      const workspace = await attempt(client, 'service_role', `select projects.provision_workspace(gen_random_uuid())`);
      expect(workspace.ok).toBe(false);
      expect((await attempt(client, 'service_role', 'select * from api.account_status(gen_random_uuid())')).ok).toBe(true);
    });
  });

  describe('over the REST API', () => {
    const rpc = (key: string, name: string, body: unknown = {}) =>
      fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-profile': 'api'},
        body: JSON.stringify(body),
      });
    const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    /** A token PostgREST accepts for the `authenticated` role, signed with the local stack's JWT secret. */
    const authenticatedToken = () => {
      const unsigned = `${base64url({alg: 'HS256', typ: 'JWT'})}.${base64url({role: 'authenticated', aud: 'authenticated', sub: randomUUID(), exp: Math.floor(Date.now() / 1000) + 600})}`;
      return `${unsigned}.${createHmac('sha256', jwtSecretOf(stack)).update(unsigned).digest('base64url')}`;
    };

    it('refuses anon and authenticated on every api function with a database permission error', async () => {
      const bodies: Record<string, unknown> = {
        account_status: {p_user_id: randomUUID()},
        authorize_session: {p_user_id: randomUUID(), p_session_id: randomUUID()},
        issue_grant: {p_user_id: randomUUID(), p_session_id: randomUUID()},
        revoke_grants: {p_actor: 'seed', p_reason: 'test', p_session_id: randomUUID()},
        confirm_registration: {p_user_id: randomUUID(), p_command_id: randomUUID(), p_code_hash: codeHash()},
        preflight: {},
        raise_authorization_epoch: {p_account_id: randomUUID(), p_actor: 'seed'},
        consume_preauthorization: {p_user_id: randomUUID()},
        register_with_code: {p_user_id: randomUUID(), p_command_id: randomUUID(), p_code_hash: codeHash(), p_origin_hash: originHash()},
        seed_preauthorization: {p_email: 'a@b.co', p_role: 'member', p_actor: 'seed'},
        withdraw_preauthorization: {p_email: 'a@b.co', p_actor: 'seed'},
        issue_invitation: {p_code_hash: codeHash(), p_kind: 'general', p_label: null, p_actor: 'seed', p_replace: false},
        revoke_invitation: {p_actor: 'seed', p_invitation_id: randomUUID()},
        list_invitations: {},
        before_user_created: {event: {}},
      };
      for (const [label, key] of [['anon', stack.anonKey], ['authenticated', authenticatedToken()]] as const) {
        for (const [name, body] of Object.entries(bodies)) {
          const response = await rpc(key, name, body);
          const payload = await response.json();
          expect(response.status, `${label} ${name}`).toBeGreaterThanOrEqual(401);
          expect(response.status).toBeLessThan(500);
          // 42501 proves the request ran as that role and was refused by the database, not by a bad token.
          expect(payload.code, `${label} ${name}`).toBe('42501');
          expect(JSON.stringify(payload)).not.toMatch(/outcome|account_id/);
        }
      }
    });

    it('answers the service role, and does not expose the tables behind the api', async () => {
      const response = await rpc(stack.serviceKey, 'account_status', {p_user_id: randomUUID()});
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({status: 'none', account_id: null, workspace_id: null, role: null});

      for (const key of [stack.serviceKey, stack.anonKey, authenticatedToken()]) {
        for (const [schema, name] of [['identity', 'accounts'], ['projects', 'workspaces'], ['identity', 'audit_events']]) {
          const read = await fetch(`${stack.apiUrl}/rest/v1/${name}?select=*`, {headers: {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'accept-profile': schema}});
          expect(read.status, `${schema}.${name}`).toBe(406);
        }
        const direct = await fetch(`${stack.apiUrl}/rest/v1/accounts?select=*`, {headers: {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'accept-profile': 'api'}});
        expect(direct.status).toBeGreaterThanOrEqual(400);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('AC-1: registration is atomic, single-use and idempotent', () => {
  it('creates the Account and its Workspace together from a valid code, as a member', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      const hash = codeHash();
      await svc.issue(hash, 'named', 'Daniel');

      const receipt = await svc.register(user.id, hash);
      expect(receipt).toMatchObject({outcome: 'registered', role: 'member', replayed: false});
      expect(receipt.account_id).toMatch(uuidPattern);
      expect(receipt.workspace_id).toMatch(uuidPattern);

      const {rows: accounts} = await client.query('select * from identity.accounts where user_id = $1', [user.id]);
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({id: receipt.account_id, role: 'member', status: 'active', source: 'invitation', google_subject: user.subject});
      const {rows: workspaces} = await client.query('select * from projects.workspaces where account_id = $1', [receipt.account_id]);
      expect(workspaces).toEqual([expect.objectContaining({id: receipt.workspace_id})]);
      const {rows: invitation} = await client.query('select status, redeemed_account_id from identity.invitations where code_hash = $1', [hash]);
      expect(invitation).toEqual([{status: 'redeemed', redeemed_account_id: receipt.account_id}]);
      expect(await svc.status(user.id)).toEqual({status: 'active', account_id: receipt.account_id, workspace_id: receipt.workspace_id, role: 'member'});
    });
  });

  it('retry: the same command and payload return the original receipt and change nothing', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      const hash = codeHash();
      const command = randomUUID();
      await svc.issue(hash, 'general', null);

      const first = await svc.register(user.id, hash, {command});
      const second = await svc.register(user.id, hash, {command});
      expect(first.outcome).toBe('registered');
      expect(second).toEqual({...first, replayed: true});
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id])).toBe(1);
      expect(await count(client, 'select count(*) as n from projects.workspaces where account_id = $1', [first.account_id])).toBe(1);
      expect(await count(client, `select count(*) as n from identity.audit_events where action = 'account.activated' and actor = $1`, [`account:${first.account_id}`])).toBe(1);
    });
  });

  it('changed payload: the same command ID with another code is refused, generically and counted, and the other code stays unused', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      const [hash, other] = [codeHash(), codeHash()];
      const [command, origin] = [randomUUID(), originHash()];
      await svc.issue(hash, 'named', 'First');
      await svc.issue(other, 'named', 'Second');

      const first = await svc.register(user.id, hash, {command, origin});
      expect(first.outcome).toBe('registered');
      const changed = await svc.register(user.id, other, {command, origin});
      expect(withoutCommand(changed)).toEqual(generic);
      expect(await invitationStatus(client, other)).toBe('unused');
      expect(await failuresOf(client, origin)).toBe(1);
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id])).toBe(1);
    });
  });

  it('refuses a command ID that already belongs to another user, with their code, without returning their receipt', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [owner, intruder] = [await addUser(client), await addUser(client)];
      const hash = codeHash();
      const command = randomUUID();
      await svc.issue(hash, 'named', 'Owner');
      await svc.register(owner.id, hash, {command});

      const replay = await svc.register(intruder.id, hash, {command});
      expect(withoutCommand(replay)).toEqual(generic);
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [intruder.id])).toBe(0);
    });
  });

  it('records no command for a failure, so a corrected retry under the same command ID can succeed', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      const [good, bad] = [codeHash(), codeHash()];
      const command = randomUUID();
      await svc.issue(good, 'named', 'Late');
      expect(withoutCommand(await svc.register(user.id, bad, {command}))).toEqual(generic);
      expect(await count(client, 'select count(*) as n from identity.registration_commands where command_id = $1', [command])).toBe(0);
      expect((await svc.register(user.id, good, {command})).outcome).toBe('registered');
    });
  });

  it('an Auth user that already has an Account is returned that Account and consumes no further code', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      const [first, second] = [codeHash(), codeHash()];
      await svc.issue(first, 'named', 'One');
      await svc.issue(second, 'named', 'Two');
      const registered = await svc.register(user.id, first);
      const again = await svc.register(user.id, second);
      expect(again).toMatchObject({outcome: 'registered', account_id: registered.account_id, replayed: true});
      expect(await invitationStatus(client, second)).toBe('unused');
    });
  });

  it('refuses an identity that is not a verified Google identity, leaving the code unused and counting the attempt', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const hash = codeHash();
      await svc.issue(hash, 'general', null);
      const ineligible = [
        await addUser(client, {verified: false}),
        await addUser(client, {confirmed: false}),
        await addUser(client, {provider: 'email'}),
        await addUser(client, {identity: false}),
        await addUser(client, {anonymous: true}),
        await addUser(client, {banned: true}),
        await addUser(client, {deleted: true}),
        // Google verified another address than the one on the Auth user.
        await addUser(client, {identityEmail: `someone-else-${tag()}@example.test`}),
      ];
      for (const user of ineligible) {
        const origin = originHash();
        expect(withoutCommand(await svc.register(user.id, hash, {origin})), user.email).toEqual(generic);
        expect(await failuresOf(client, origin), user.email).toBe(1);
      }
      expect(await invitationStatus(client, hash)).toBe('unused');
      expect(withoutCommand(await svc.register(randomUUID(), hash, {origin: originHash()}))).toEqual(generic);
      expect((await svc.register((await addUser(client)).id, hash)).outcome).toBe('registered');
    });
  });

  it('accepts a ban that has ended, and an address that differs from the identity only in case or padding', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const hash = codeHash();
      await svc.issue(hash, 'general', null);
      const expired = await addUser(client, {banExpired: true});
      expect((await svc.register(expired.id, hash)).outcome).toBe('registered');
      const second = codeHash();
      await svc.issue(second, 'named', 'Case');
      const email = `Mixed-${tag()}@Example.Test`;
      const user = await addUser(client, {email, identityEmail: ` ${email.toLowerCase()} `});
      expect((await svc.register(user.id, second)).outcome).toBe('registered');
    });
  });

  it('answers a retry, and a user who already has an Account, even from an origin at its limit; only new guesses are limited', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await client.query('delete from identity.rate_limit_counters');
      const user = await addUser(client);
      const [hash, other] = [codeHash(), codeHash()];
      const [command, origin] = [randomUUID(), originHash()];
      await svc.issue(hash, 'named', 'Replay');
      await svc.issue(other, 'named', 'Other');
      const first = await svc.register(user.id, hash, {command, origin});
      expect(first.outcome).toBe('registered');

      // Spend the origin's whole budget on wrong codes from other users.
      for (let guess = 0; guess < 5; guess += 1) expect((await svc.register((await addUser(client)).id, codeHash(), {origin})).outcome).toBe('refused');
      expect(await failuresOf(client, origin)).toBe(5);
      expect((await svc.register((await addUser(client)).id, other, {origin})).outcome, 'a new guess is limited').toBe('limited');

      const retried = await svc.register(user.id, hash, {command, origin});
      expect(retried).toEqual({...first, replayed: true});
      const repeated = await svc.register(user.id, other, {origin});
      expect(repeated).toMatchObject({outcome: 'registered', account_id: first.account_id, replayed: true});
      expect(await invitationStatus(client, other), 'a repeat consumes no code').toBe('unused');
      // The same command ID with another code is a new guess, so the limit applies to it.
      expect((await svc.register(user.id, other, {command, origin})).outcome).toBe('limited');
      expect(await failuresOf(client, origin)).toBe(5);
      // A retry persists the attempt time too.
      expect(await count(client, 'select count(*) as n from identity.registration_attempts where user_id = $1', [user.id])).toBe(1);
    });
  });

  it('never reports a disabled Account as registered: on a retry, on a repeat, when consuming, or in its status', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [hash, other] = [codeHash(), codeHash()];
      const command = randomUUID();
      await svc.issue(hash, 'named', 'Disabled');
      await svc.issue(other, 'named', 'Spare');
      const user = await addUser(client);
      const registered = await svc.register(user.id, hash, {command});
      expect(registered.outcome).toBe('registered');
      expect(await svc.consume(user.id)).toMatchObject({outcome: 'active', account_id: registered.account_id});

      // Story 1.5 owns disabling; here the table owner does it.
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [registered.account_id]);
      expect(await svc.status(user.id)).toEqual({status: 'disabled', account_id: registered.account_id, workspace_id: registered.workspace_id, role: 'member'});
      expect(await svc.register(user.id, hash, {command})).toMatchObject({outcome: 'disabled', account_id: registered.account_id, replayed: true});
      expect(await svc.register(user.id, other)).toMatchObject({outcome: 'disabled', account_id: registered.account_id, replayed: true});
      expect(await invitationStatus(client, other)).toBe('unused');
      expect(await svc.consume(user.id)).toMatchObject({outcome: 'disabled', account_id: registered.account_id, role: 'member'});

      // An Account that came from a pre-authorization is the same.
      const email = `disabled-${tag()}@example.test`;
      await svc.seed(email, 'member');
      const member = await addUser(client, {email});
      const consumed = await svc.consume(member.id);
      expect(consumed.outcome).toBe('registered');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [consumed.account_id]);
      expect(await svc.consume(member.id)).toMatchObject({outcome: 'disabled', account_id: consumed.account_id});
      expect((await svc.status(member.id)).status).toBe('disabled');

      // Enabled again, both are reported as before.
      await client.query(`update identity.accounts set status = 'active' where id = any($1)`, [[registered.account_id, consumed.account_id]]);
      expect((await svc.register(user.id, hash, {command})).outcome).toBe('registered');
      expect((await svc.consume(member.id)).outcome).toBe('active');
    });
  });

  it('lets only the expected failures be counted as a bad code; anything else propagates, undoes the attempt and is not counted', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await client.query(
        `create function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'injected failure' using errcode = tg_argv[0]; end $$`,
      );
      const expected = ['23505', '23503', '23514', '23502', 'P0001'];
      // Including the guards' own code (55000) and its whole class, to which lock_not_available (55P03) belongs.
      const unexpected = ['40P01', '40001', '55000', '55P03', '55006', '53100', '53200', '54000', 'XX000', '57014', '08006'];
      const run = async (errcode: string) => {
        const user = await addUser(client);
        const [hash, origin] = [codeHash(), originHash()];
        await svc.issue(hash, 'named', 'Boom');
        await client.query(`create trigger test_boom before insert on projects.workspaces for each row execute function public.test_boom('${errcode}')`);
        const result = await attempt(client, 'service_role', 'select * from api.register_with_code($1, $2, $3, $4)', [user.id, randomUUID(), hash, origin]);
        await client.query('drop trigger test_boom on projects.workspaces');
        return {user, hash, origin, result};
      };

      for (const errcode of expected) {
        const {user, hash, origin, result} = await run(errcode);
        expect(result.ok, errcode).toBe(true);
        if (result.ok) expect(withoutCommand(result.rows[0]), errcode).toEqual(generic);
        expect(await failuresOf(client, origin), `${errcode} is counted as a bad code`).toBe(1);
        expect(await invitationStatus(client, hash), errcode).toBe('unused');
        expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id]), errcode).toBe(0);
      }
      for (const errcode of unexpected) {
        const {user, hash, origin, result} = await run(errcode);
        expect(result.ok, `${errcode} propagates`).toBe(false);
        if (!result.ok) expect(result.code, errcode).toBe(errcode);
        // Everything the attempt did is undone: no failure counted, no attempt time, no counter row, no Account.
        expect(await count(client, 'select count(*) as n from identity.rate_limit_counters where key_hash = $1', [origin]), `${errcode} leaves no counter`).toBe(0);
        expect(await count(client, 'select count(*) as n from identity.registration_attempts where user_id = $1', [user.id]), errcode).toBe(0);
        expect(await invitationStatus(client, hash), errcode).toBe('unused');
        expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id]), errcode).toBe(0);
      }
    });
  });

  it('leaves no partial Account when anything fails after the code check, and the code stays usable', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await client.query(`create function public.test_boom() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
      for (const table of ['projects.workspaces', 'identity.registration_commands', 'identity.invitations']) {
        const user = await addUser(client);
        const hash = codeHash();
        const origin = originHash();
        const before = await count(client, 'select count(*) as n from identity.audit_events');
        await svc.issue(hash, 'named', 'Boom');
        const issuedAudit = await count(client, 'select count(*) as n from identity.audit_events');
        expect(issuedAudit).toBe(before + 1);

        const event = table === 'identity.invitations' ? 'update' : 'insert';
        await client.query(`create trigger test_boom before ${event} on ${table} for each row ${table === 'identity.invitations' ? `when (new.status = 'redeemed') ` : ''}execute function public.test_boom()`);
        const receipt = await svc.register(user.id, hash, {origin});
        expect(withoutCommand(receipt), table).toEqual(generic);
        expect(await invitationStatus(client, hash), table).toBe('unused');
        expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id]), table).toBe(0);
        expect(await count(client, 'select count(*) as n from projects.workspaces w join identity.accounts a on a.id = w.account_id where a.user_id = $1', [user.id])).toBe(0);
        expect(await count(client, 'select count(*) as n from identity.registration_commands where code_hash = $1', [hash])).toBe(0);
        expect(await count(client, 'select count(*) as n from identity.audit_events'), table).toBe(issuedAudit);
        expect(await failuresOf(client, origin), `${table} is counted`).toBe(1);
        expect(await count(client, 'select count(*) as n from identity.registration_attempts where user_id = $1', [user.id])).toBe(1);

        await client.query(`drop trigger test_boom on ${table}`);
        expect((await svc.register(user.id, hash, {origin})).outcome, `${table} works again`).toBe('registered');
      }
    });
  });

});

// ---------------------------------------------------------------------------------------------------
describe('AC-2: codes are single-use, never expire, and only a successful general redemption retires the general code', () => {
  it('keeps named and general codes independent through redemption and revocation', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [named, general, spare] = [codeHash(), codeHash(), codeHash()];
      await svc.issue(general, 'general', null);
      await svc.issue(named, 'named', 'Named');
      await svc.issue(spare, 'named', 'Spare');
      const [a, b, c] = [await addUser(client), await addUser(client), await addUser(client)];

      expect((await svc.register(a.id, named)).outcome).toBe('registered');
      expect(await invitationStatus(client, general)).toBe('unused');
      expect(await svc.revoke({hash: spare})).toMatchObject({outcome: 'revoked'});
      expect(await invitationStatus(client, general)).toBe('unused');
      expect(withoutCommand(await svc.register(c.id, spare))).toEqual(generic);

      // A failed attempt on the general code does not retire it.
      const unverified = await addUser(client, {verified: false});
      expect(withoutCommand(await svc.register(unverified.id, general))).toEqual(generic);
      expect(await invitationStatus(client, general)).toBe('unused');

      expect((await svc.register(b.id, general)).outcome).toBe('registered');
      expect(await invitationStatus(client, general)).toBe('redeemed');
      expect(withoutCommand(await svc.register(c.id, general))).toEqual(generic);
      expect(await invitationStatus(client, named)).toBe('redeemed');
      expect(withoutCommand(await svc.register(c.id, named))).toEqual(generic);
    });
  });

  it('never expires an unused code', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const hash = codeHash();
      await client.query(`insert into identity.invitations (code_hash, kind, label, issued_by, created_at) values ($1, 'named', 'Old', 'seed', now() - interval '10 years')`, [hash]);
      const {rows: found} = await client.query(`select code_hash from identity.invitations where created_at < now() - interval '9 years'`);
      expect(found).toEqual([{code_hash: hash}]);
      expect((await svc.register((await addUser(client)).id, hash)).outcome).toBe('registered');
    });
  });

  it('keeps existing Accounts valid when their code is revoked or the general code is replaced', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [hash, next] = [codeHash(), codeHash()];
      await svc.issue(hash, 'general', null);
      const user = await addUser(client);
      const registered = await svc.register(user.id, hash);
      expect(await svc.revoke({hash})).toMatchObject({outcome: 'redeemed'});
      await svc.issue(next, 'general', null);
      expect(await svc.issue(codeHash(), 'general', null, 'seed', true)).toMatchObject({kind: 'general'});
      expect(await svc.status(user.id)).toMatchObject({status: 'active', account_id: registered.account_id});
    });
  });

  it('allows one current general code, replaced only on request, and revokes by ID or by hash', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      // Whatever general code this local database holds is set aside inside this rolled-back transaction.
      await client.query(`update identity.invitations set status = 'revoked', revoked_at = now(), revoked_by = 'test_isolation' where kind = 'general' and status = 'unused'`);
      const [first, second] = [codeHash(), codeHash()];
      const issued = await svc.issue(first, 'general', null);
      expect(issued).toMatchObject({outcome: 'issued', kind: 'general', replaced_invitation_id: null});

      // A second general code is a stable outcome, not an error, and stores nothing.
      const clash = await svc.issue(second, 'general', null, 'seed:local:test', false);
      expect(clash).toMatchObject({outcome: 'exists', kind: 'general', invitation_id: issued.invitation_id, replaced_invitation_id: null});
      expect(await invitationStatus(client, second)).toBeUndefined();
      expect(await invitationStatus(client, first)).toBe('unused');

      const replaced = await svc.issue(second, 'general', null, 'seed:local:test', true);
      expect(replaced).toMatchObject({outcome: 'issued'});
      expect(replaced.replaced_invitation_id).toBe(issued.invitation_id);
      expect(await invitationStatus(client, first)).toBe('revoked');
      expect(await invitationStatus(client, second)).toBe('unused');
      expect(withoutCommand(await svc.register((await addUser(client)).id, first))).toEqual(generic);

      expect(await svc.revoke({id: replaced.invitation_id})).toEqual({invitation_id: replaced.invitation_id, outcome: 'revoked'});
      expect(await svc.revoke({id: replaced.invitation_id})).toEqual({invitation_id: replaced.invitation_id, outcome: 'already_revoked'});
      expect(await svc.revoke({id: randomUUID()})).toMatchObject({outcome: 'not_found'});
      expect(await svc.revoke({hash: codeHash()})).toMatchObject({outcome: 'not_found'});
      const bad = await attempt(client, 'service_role', 'select * from api.revoke_invitation($1, $2, $3)', ['seed', null, null]);
      expect(bad.ok).toBe(false);
    });
  });

  it('answers a code hash that already exists with the same stable outcome and changes nothing', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const hash = codeHash();
      const first = await svc.issue(hash, 'named', 'First');
      expect(first.outcome).toBe('issued');
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      expect(await svc.issue(hash, 'named', 'Second')).toMatchObject({outcome: 'exists', invitation_id: null});
      expect(await count(client, 'select count(*) as n from identity.audit_events')).toBe(before);
      // The same collision on a replacing general issue leaves the code it would have replaced in place.
      const general = codeHash();
      const current = await svc.issue(general, 'general', null);
      expect(await svc.issue(hash, 'general', null, 'seed:local:test', true)).toMatchObject({outcome: 'exists'});
      expect(await invitationStatus(client, general), 'the current general code was not revoked').toBe('unused');
      expect(current.outcome).toBe('issued');
    });
  });

  it('lists invitations with their ID, kind, label, state and time, and never a hash or a code', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [named, spare, general] = [codeHash(), codeHash(), codeHash()];
      const a = await svc.issue(named, 'named', 'Listed A');
      const b = await svc.issue(spare, 'named', 'Listed B');
      const g = await svc.issue(general, 'general', null);
      await svc.revoke({id: b.invitation_id});
      await svc.register((await addUser(client)).id, named);

      const listed = await svc.list();
      expect(Object.keys(listed[0]).sort()).toEqual(['created_at', 'invitation_id', 'kind', 'label', 'state']);
      const byId = new Map(listed.map((row) => [row.invitation_id, row]));
      expect(byId.get(a.invitation_id)).toMatchObject({kind: 'named', label: 'Listed A', state: 'redeemed'});
      expect(byId.get(b.invitation_id)).toMatchObject({kind: 'named', label: 'Listed B', state: 'revoked'});
      expect(byId.get(g.invitation_id)).toMatchObject({kind: 'general', label: null, state: 'unused'});
      for (const row of listed) expect(row.created_at).toBeInstanceOf(Date);
      const times = listed.map((row) => row.created_at.getTime());
      expect(times).toEqual([...times].sort((x, y) => y - x));
      expect(JSON.stringify(listed)).not.toMatch(new RegExp(`${named}|${spare}|${general}`));
      expect(await attempt(client, 'anon', 'select * from api.list_invitations()')).toMatchObject({ok: false});
      expect(await attempt(client, 'authenticated', 'select * from api.list_invitations()')).toMatchObject({ok: false});
    });
  });

  it('accepts an actor of up to three segments (kind, environment, operator) and refuses more or any free text', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      for (const actor of ['seed', 'seed:local', 'seed:staging:josh', 'seed:local:Josh_H-2', `seed:local:${'a'.repeat(64)}`]) {
        expect((await svc.issue(codeHash(), 'named', 'Actor', actor)).outcome, actor).toBe('issued');
      }
      for (const actor of ['seed:local:josh:extra', 'Seed', 'seed:', 'seed::josh', 'seed:local:josh smith', 'seed:local:josh@x.co', `seed:local:${'a'.repeat(65)}`, '1seed']) {
        const result = await attempt(client, 'service_role', 'select * from api.issue_invitation($1, $2, $3, $4, $5)', [codeHash(), 'named', 'Actor', actor, false]);
        expect(result.ok, actor).toBe(false);
        if (!result.ok) expect(result.code, actor).toBe('22023');
        const audit = await attempt(client, null, 'select identity.record_audit($1, $2, $3)', [actor, 'test.event', null]);
        expect(audit.ok, `audit ${actor}`).toBe(false);
      }
    });
  });

  it('requires a label for a named code and none for a general code, and refuses a malformed hash or actor', async () => {
    await inTx(async (client) => {
      const cases: Array<[string, unknown[]]> = [
        ['named without a label', [codeHash(), 'named', null, 'seed', false]],
        ['named with a blank label', [codeHash(), 'named', '   ', 'seed', false]],
        ['general with a label', [codeHash(), 'general', 'Label', 'seed', false]],
        ['unknown kind', [codeHash(), 'other', null, 'seed', false]],
        ['short hash', ['abc', 'general', null, 'seed', false]],
        ['upper-case hash', [codeHash().toUpperCase(), 'general', null, 'seed', false]],
        ['actor with spaces', [codeHash(), 'general', null, 'a person', false]],
        ['actor that is an address', [codeHash(), 'general', null, 'josh@example.com', false]],
      ];
      for (const [name, params] of cases) {
        const result = await attempt(client, 'service_role', 'select * from api.issue_invitation($1, $2, $3, $4, $5)', params);
        expect(result.ok, name).toBe(false);
      }
    });
  });

  it('makes a redeemed or revoked invitation final, and an invitation immutable', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const hash = codeHash();
      await svc.issue(hash, 'named', 'Final');
      await svc.revoke({hash});
      const reopen = await attempt(client, null, `update identity.invitations set status = 'unused', revoked_at = null, revoked_by = null where code_hash = $1`, [hash]);
      expect(reopen.ok).toBe(false);
      if (!reopen.ok) expect(reopen.message).toMatch(/final/);

      const open = codeHash();
      await svc.issue(open, 'named', 'Open');
      const rewrite = await attempt(client, null, `update identity.invitations set code_hash = $2 where code_hash = $1`, [open, codeHash()]);
      expect(rewrite.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('AC-3: bad codes are generic and counted, and the limits hold', () => {
  it('answers an invalid, used, revoked and never-issued code identically, and counts each', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [used, revoked, unused] = [codeHash(), codeHash(), codeHash()];
      await svc.issue(used, 'named', 'Used');
      await svc.issue(revoked, 'named', 'Revoked');
      await svc.issue(unused, 'named', 'Unused');
      await svc.revoke({hash: revoked});
      await svc.register((await addUser(client)).id, used);

      const origin = originHash();
      const user = await addUser(client);
      for (const hash of [codeHash(), used, revoked, 'f'.repeat(64)]) expect(withoutCommand(await svc.register(user.id, hash, {origin}))).toEqual(generic);
      expect(await failuresOf(client, origin)).toBe(4);
      expect(await invitationStatus(client, unused)).toBe('unused');
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id])).toBe(0);
    });
  });

  it('refuses the sixth attempt from one origin within 15 minutes, even with a valid code, and only that origin', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await client.query('delete from identity.rate_limit_counters');
      const hash = codeHash();
      await svc.issue(hash, 'general', null);
      const [origin, elsewhere] = [originHash(), originHash()];
      const user = await addUser(client);

      for (let attemptNumber = 1; attemptNumber <= 5; attemptNumber += 1) {
        expect(withoutCommand(await svc.register(user.id, codeHash(), {origin})), `failure ${attemptNumber}`).toEqual(generic);
      }
      expect(await failuresOf(client, origin)).toBe(5);

      const sixth = await svc.register(user.id, hash, {origin});
      expect(sixth).toMatchObject({outcome: 'limited', account_id: null, workspace_id: null, role: null});
      expect(await invitationStatus(client, hash)).toBe('unused');
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id])).toBe(0);
      expect(await failuresOf(client, origin)).toBe(5);
      // The limit is for the origin: the persisted attempt time still moves.
      expect(await count(client, 'select count(*) as n from identity.registration_attempts where user_id = $1', [user.id])).toBe(1);

      expect((await svc.register(user.id, hash, {origin: elsewhere})).outcome).toBe('registered');
    });
  });

  it('refuses the 101st failure within an hour for everyone, whatever the origin', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await client.query('delete from identity.rate_limit_counters');
      const hash = codeHash();
      await svc.issue(hash, 'general', null);
      const user = await addUser(client);

      for (let origin = 0; origin < 25; origin += 1) {
        const key = originHash();
        for (let failure = 0; failure < 4; failure += 1) {
          expect((await svc.register(user.id, codeHash(), {origin: key})).outcome).toBe('refused');
        }
      }
      const {rows: global} = await client.query(`select failures from identity.rate_limit_counters where scope = 'global'`);
      expect(global).toEqual([{failures: 100}]);

      for (let fresh = 0; fresh < 3; fresh += 1) {
        const refused = await svc.register(user.id, hash, {origin: originHash()});
        expect(refused.outcome).toBe('limited');
      }
      expect(await invitationStatus(client, hash)).toBe('unused');
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id])).toBe(0);
    });
  });

  it('keys the windows by floor(epoch / 900) per origin and floor(epoch / 3600) globally, and starts afresh in the next window', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await client.query('delete from identity.rate_limit_counters');
      const user = await addUser(client);
      const origin = originHash();
      const hash = codeHash();
      await svc.issue(hash, 'general', null);

      const before = Math.floor(Date.now() / 1000);
      for (let failure = 0; failure < 5; failure += 1) await svc.register(user.id, codeHash(), {origin});
      const after = Math.floor(Date.now() / 1000);
      const {rows: counters} = await client.query(`select scope, key_hash, window_id::int as window_id, failures, expires_at > now() as live from identity.rate_limit_counters order by scope`);
      expect(counters).toHaveLength(2);
      const [globalRow, originRow] = counters;
      expect(originRow).toMatchObject({scope: 'origin', key_hash: origin, failures: 5, live: true});
      expect([Math.floor(before / 900), Math.floor(after / 900)]).toContain(originRow.window_id);
      expect(globalRow).toMatchObject({scope: 'global', key_hash: 'global', failures: 5, live: true});
      expect([Math.floor(before / 3600), Math.floor(after / 3600)]).toContain(globalRow.window_id);

      expect((await svc.register(user.id, hash, {origin})).outcome).toBe('limited');
      // The previous window no longer counts.
      await client.query(`update identity.rate_limit_counters set window_id = window_id - 1 where scope = 'origin'`);
      expect((await svc.register(user.id, hash, {origin})).outcome).toBe('registered');
    });
  });

  it('drops long-expired counters as it goes', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const stale = originHash();
      await client.query('delete from identity.rate_limit_counters where expires_at < now()');
      await client.query(`insert into identity.rate_limit_counters (scope, key_hash, window_id, failures, expires_at) values ('origin', $1, 1, 4, now() - interval '3 hours')`, [stale]);
      await svc.register(randomUUID(), codeHash());
      expect(await count(client, `select count(*) as n from identity.rate_limit_counters where key_hash = $1`, [stale])).toBe(0);
    });
  });

  it('rejects malformed hashes and identifiers outright', async () => {
    await inTx(async (client) => {
      const good = [randomUUID(), randomUUID(), codeHash(), originHash()];
      const variants: unknown[][] = [
        [null, good[1], good[2], good[3]],
        [good[0], null, good[2], good[3]],
        [good[0], good[1], 'plain-code-1234', good[3]],
        [good[0], good[1], good[2], '203.0.113.9'],
        [good[0], good[1], null, good[3]],
      ];
      for (const params of variants) {
        const result = await attempt(client, 'service_role', 'select * from api.register_with_code($1, $2, $3, $4)', params);
        expect(result.ok, JSON.stringify(params)).toBe(false);
        if (!result.ok) expect(result.code).toBe('22023');
      }
      expect((await attempt(client, null, `insert into identity.rate_limit_counters (scope, key_hash, window_id, expires_at) values ('origin', '203.0.113.9', 1, now())`)).ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('AC-5: a registration holds the identity lock against a purge (single connection)', () => {
  it('refuses to delete an Auth user that owns an Account', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      const hash = codeHash();
      await svc.issue(hash, 'named', 'Restrict');
      await svc.register(user.id, hash);
      const result = await attempt(client, null, 'delete from auth.users where id = $1', [user.id]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('23503');
    });
  });

  it('persists the attempt time under the lock on every outcome, and removes it with the Auth user', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const user = await addUser(client);
      await svc.register(user.id, codeHash());
      const {rows: first} = await client.query('select last_attempt_at from identity.registration_attempts where user_id = $1', [user.id]);
      expect(first).toHaveLength(1);
      await client.query(`update identity.registration_attempts set last_attempt_at = now() - interval '2 days' where user_id = $1`, [user.id]);
      await svc.consume(user.id);
      const {rows: second} = await client.query(`select last_attempt_at > now() - interval '1 minute' as recent from identity.registration_attempts where user_id = $1`, [user.id]);
      expect(second).toEqual([{recent: true}]);
      await client.query('delete from auth.users where id = $1', [user.id]);
      expect(await count(client, 'select count(*) as n from identity.registration_attempts where user_id = $1', [user.id])).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('AC-4: the Before User Created hook admits only a verified Google identity', () => {
  const event = (user: Record<string, unknown>) => ({metadata: {name: 'before-user-created'}, user});
  const google = {
    id: randomUUID(),
    aud: 'authenticated',
    role: '',
    email: 'someone@example.test',
    phone: '',
    app_metadata: {provider: 'google', providers: ['google']},
    user_metadata: {email_verified: true, iss: 'https://accounts.google.com', sub: '1234567890'},
    identities: [],
    is_anonymous: false,
  };
  const hook = async (payload: unknown) => (await db.query('select api.before_user_created($1::jsonb) as result', [JSON.stringify(payload)])).rows[0].result;
  const rejection = {error: {http_code: 403, message: 'Sign-in is not available for this account.'}};

  it('accepts a Google identity with a verified email', async () => {
    expect(await hook(event(google))).toEqual({});
    expect(await hook(event({...google, user_metadata: {email_verified: 'true'}}))).toEqual({});
  });

  it('rejects email, phone, anonymous and every other provider', async () => {
    const reject = async (user: Record<string, unknown>) => expect(await hook(event(user)), JSON.stringify(user.app_metadata)).toEqual(rejection);
    await reject({...google, app_metadata: {provider: 'email', providers: ['email']}, user_metadata: {email_verified: true}});
    await reject({...google, app_metadata: {provider: 'email', providers: ['email']}, user_metadata: {}});
    await reject({...google, app_metadata: {provider: 'phone', providers: ['phone']}, email: '', phone: '+15551234567'});
    await reject({...google, app_metadata: {provider: 'anonymous', providers: ['anonymous']}, email: '', is_anonymous: true});
    await reject({...google, app_metadata: {provider: 'github', providers: ['github']}});
    await reject({...google, app_metadata: {provider: 'apple', providers: ['apple']}});
    await reject({...google, app_metadata: {providers: ['google']}});
    await reject({...google, app_metadata: {provider: 'google', providers: ['google', 'email']}});
    await reject({...google, app_metadata: {provider: 'Google', providers: ['Google']}});
    await reject({...google, app_metadata: {}});
    const {app_metadata: _removed, ...noMetadata} = google;
    await reject(noMetadata);
  });

  it('rejects a Google identity whose email is missing, blank or unverified', async () => {
    const reject = async (user: Record<string, unknown>) => expect(await hook(event(user))).toEqual(rejection);
    await reject({...google, user_metadata: {email_verified: false}});
    await reject({...google, user_metadata: {email_verified: 'false'}});
    await reject({...google, user_metadata: {email_verified: 1}});
    await reject({...google, user_metadata: {email_verified: null}});
    await reject({...google, user_metadata: {}});
    await reject({...google, user_metadata: null});
    const {user_metadata: _removed, ...noClaims} = google;
    await reject(noClaims);
    await reject({...google, email: ''});
    await reject({...google, email: '   '});
    await reject({...google, email: null});
    await reject({...google, email: 42});
    await reject({...google, phone: '+15551234567'});
    await reject({...google, is_anonymous: true});
  });

  it('rejects anything it cannot read, and never raises', async () => {
    for (const payload of [null, {}, [], 'text', 7, true, {user: null}, {user: 'someone'}, {user: []}, {user: 7}, {metadata: {}}]) {
      expect(await hook(payload), JSON.stringify(payload)).toEqual(rejection);
    }
    expect((await db.query(`select api.before_user_created(null) as result`)).rows[0].result).toEqual(rejection);
  });

  it('reads the same fields GoTrue sends for a signup, as captured from the running Auth service', async () => {
    // The shape Supabase Auth v2.197 sent to the hook for an email signup (captured once with a logging hook).
    const captured = {
      user: {
        id: '79eabdd7-27ce-4bbd-9caa-195bbc22ff9f',
        aud: 'authenticated',
        role: '',
        email: 'exp1@example.com',
        phone: '',
        created_at: '0001-01-01T00:00:00Z',
        identities: [],
        updated_at: '0001-01-01T00:00:00Z',
        app_metadata: {provider: 'email', providers: ['email']},
        is_anonymous: false,
        user_metadata: {},
      },
      metadata: {name: 'before-user-created', time: '2026-10-10T18:37:34.55922222Z', uuid: 'c66020e9-5a03-4520-8527-6e15bb8ad175', ip_address: '172.18.0.1'},
    };
    expect(await hook(captured)).toEqual(rejection);
  });

  describe('live, through the running Auth service', () => {
    const invite = (email: string) =>
      fetch(`${stack.apiUrl}/auth/v1/invite`, {
        method: 'POST',
        headers: {apikey: stack.serviceKey, authorization: `Bearer ${stack.serviceKey}`, 'content-type': 'application/json'},
        body: JSON.stringify({email}),
      });

    // Email, phone and anonymous sign-up are switched off, so Auth refuses them before it would ask the hook;
    // an invitation sent with the service key is not blocked by those switches and reaches the hook, so it
    // proves Auth really calls api.before_user_created and honours its rejection.
    it('has Auth call the hook for an invitation and refuse it with the hook\'s own message, creating no user', async () => {
      const email = `invited-${tag()}@example.test`;
      try {
        const response = await invite(email);
        const body = await response.json();
        expect(response.status).toBe(403);
        expect(body.msg).toBe('Sign-in is not available for this account.');
        expect(await count(db, 'select count(*) as n from auth.users where lower(email) = $1', [email])).toBe(0);
        expect(await count(db, 'select count(*) as n from auth.identities where lower(email) = $1', [email])).toBe(0);
      } finally {
        // Only reached with a user if the hook did not run, which is the failure this test exists to catch.
        await db.query('delete from auth.users where lower(email) = $1', [email]);
      }
    });

    it('does not call the hook for the Auth admin create-user endpoint, which needs the service key', async () => {
      const email = `admin-created-${tag()}@example.test`;
      try {
        const response = await fetch(`${stack.apiUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {apikey: stack.serviceKey, authorization: `Bearer ${stack.serviceKey}`, 'content-type': 'application/json'},
          body: JSON.stringify({email, email_confirm: true}),
        });
        // Documented limit, not a goal: whoever holds the service key can create an Auth user directly. Such a
        // user still has no Account, and no private path without one (Part B).
        expect(response.status).toBe(200);
        const {rows: created} = await db.query('select id from auth.users where lower(email) = $1', [email]);
        expect(created).toHaveLength(1);
        expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [created[0].id])).toBe(0);
      } finally {
        await db.query('delete from auth.users where lower(email) = $1', [email]);
      }
    });

    it('still lets email, phone and anonymous sign-up be refused by the provider switches', async () => {
      const post = (body: unknown) =>
        fetch(`${stack.apiUrl}/auth/v1/signup`, {method: 'POST', headers: {apikey: stack.anonKey, 'content-type': 'application/json'}, body: JSON.stringify(body)});
      const email = `signup-${tag()}@example.test`;
      for (const response of [await post({email, password: 'Correct-horse-battery-staple-9'}), await post({phone: '+15551230000', password: 'Correct-horse-battery-staple-9'}), await post({})]) {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
      expect(await count(db, 'select count(*) as n from auth.users where email = $1 or phone = $2', [email, '15551230000'])).toBe(0);
    });
  });

  it('is granted to the Auth service role only', async () => {
    const {rows: grants} = await db.query(
      `select has_function_privilege('supabase_auth_admin', 'api.before_user_created(jsonb)', 'execute') as auth_admin,
              has_function_privilege('service_role', 'api.before_user_created(jsonb)', 'execute') as service,
              has_function_privilege('anon', 'api.before_user_created(jsonb)', 'execute') as anon,
              has_function_privilege('authenticated', 'api.before_user_created(jsonb)', 'execute') as authenticated`,
    );
    expect(grants).toEqual([{auth_admin: true, service: false, anon: false, authenticated: false}]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('AC-7: pre-authorizations are seeded once and consumed at the first verified Google sign-in', () => {
  it('seeds each address once however often it runs, and audits only what it creates', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [admin, member] = [`admin-${tag()}@example.test`, `member-${tag()}@example.test`];
      const first = await svc.seed(admin, 'administrator');
      const again = await svc.seed(admin.toUpperCase(), 'administrator');
      expect(first).toMatchObject({role: 'administrator', created: true, consumed: false});
      expect(again).toEqual({...first, created: false});
      await svc.seed(member, 'member');
      await svc.seed(` ${member} `, 'member');
      expect(await count(client, 'select count(*) as n from identity.preauthorizations where email = any($1)', [[admin, member]])).toBe(2);
      expect(await count(client, `select count(*) as n from identity.audit_events where action = 'preauthorization.created' and target = any($1)`, [[`preauthorization:${first.preauthorization_id}`]])).toBe(1);

      // The same address with another role is refused with its own stable code, and changes nothing.
      const conflict = await attempt(client, 'service_role', 'select * from api.seed_preauthorization($1, $2, $3)', [member, 'administrator', 'seed']);
      expect(conflict).toMatchObject({ok: false, code: 'N3002'});
      expect(await count(client, 'select count(*) as n from identity.preauthorizations where email = $1 and role = $2', [member, 'member'])).toBe(1);
      for (const [email, role, actor] of [['not-an-email', 'member', 'seed'], [member, 'owner', 'seed'], [member, 'member', 'Josh Heimann'], [`a,b@${tag()}.test`, 'member', 'seed'], [`${'a'.repeat(250)}@b.co`, 'member', 'seed']]) {
        const invalid = await attempt(client, 'service_role', 'select * from api.seed_preauthorization($1, $2, $3)', [email, role, actor]);
        expect(invalid, String(email).slice(0, 30)).toMatchObject({ok: false, code: '22023'});
      }
    });
  });

  it('counts the administrator pre-authorizations of other addresses, so a second Administrator can be warned about', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      await client.query(`delete from identity.preauthorizations where role = 'administrator'`);
      const [first, second] = [`admin-a-${tag()}@example.test`, `admin-b-${tag()}@example.test`];
      expect(await svc.seed(first, 'administrator')).toMatchObject({created: true, other_administrators: 0});
      expect(await svc.seed(first, 'administrator')).toMatchObject({created: false, other_administrators: 0});
      expect(await svc.seed(second, 'administrator')).toMatchObject({created: true, other_administrators: 1});
      expect(await svc.seed(first, 'administrator')).toMatchObject({other_administrators: 1});
      expect(await svc.seed(`member-${tag()}@example.test`, 'member')).toMatchObject({other_administrators: 0});
    });
  });

  it('refuses an address that already owns an Account, with a stable code, while a repeat of a consumed seed stays idempotent', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      // An Account that came from an invitation: a pre-authorization for its address could never be consumed.
      const hash = codeHash();
      await svc.issue(hash, 'named', 'Owner');
      const owner = await addUser(client, {email: `Owner-${tag()}@Example.Test`});
      expect((await svc.register(owner.id, hash)).outcome).toBe('registered');
      for (const role of ['administrator', 'member']) {
        for (const email of [owner.email, owner.email.toLowerCase(), ` ${owner.email.toUpperCase()} `]) {
          const refused = await attempt(client, 'service_role', 'select * from api.seed_preauthorization($1, $2, $3)', [email, role, 'seed']);
          expect(refused, `${role} ${email}`).toMatchObject({ok: false, code: 'N3001'});
        }
      }
      expect(await count(client, 'select count(*) as n from identity.preauthorizations where email = $1', [owner.email.toLowerCase()])).toBe(0);

      // A pre-authorization that was consumed is not that case: seeding it again is the idempotent no-op.
      const email = `consumed-${tag()}@example.test`;
      const pre = await svc.seed(email, 'member');
      await svc.consume((await addUser(client, {email})).id);
      expect(await svc.seed(email, 'member')).toMatchObject({preauthorization_id: pre.preauthorization_id, created: false, consumed: true});
    });
  });

  it('withdraws a pre-authorization nobody has used, audited, and leaves a consumed one alone', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [waiting, used] = [`waiting-${tag()}@example.test`, `used-${tag()}@example.test`];
      const pre = await svc.seed(waiting, 'member');
      await svc.seed(used, 'member');
      const user = await addUser(client, {email: used});
      expect((await svc.consume(user.id)).outcome).toBe('registered');

      expect(await svc.withdraw(` ${waiting.toUpperCase()} `, 'seed:local:josh')).toEqual({outcome: 'withdrawn'});
      expect(await count(client, 'select count(*) as n from identity.preauthorizations where email = $1', [waiting])).toBe(0);
      const {rows: audit} = await client.query(`select actor, action, target from identity.audit_events where action = 'preauthorization.withdrawn' and target = $1`, [`preauthorization:${pre.preauthorization_id}`]);
      expect(audit).toEqual([{actor: 'seed:local:josh', action: 'preauthorization.withdrawn', target: `preauthorization:${pre.preauthorization_id}`}]);
      expect(JSON.stringify(audit)).not.toContain(waiting);

      expect(await svc.withdraw(waiting)).toEqual({outcome: 'not_found'});
      expect(await svc.withdraw(used)).toEqual({outcome: 'consumed'});
      expect(await count(client, 'select count(*) as n from identity.preauthorizations where email = $1 and consumed_at is not null', [used])).toBe(1);
      expect(await svc.status(user.id)).toMatchObject({status: 'active'});

      // A withdrawn address can be seeded again, and then signs in as usual.
      expect(await svc.seed(waiting, 'member')).toMatchObject({created: true});
      expect((await svc.consume((await addUser(client, {email: waiting})).id)).outcome).toBe('registered');
      for (const [email, actor] of [['nope', 'seed'], [waiting, 'a person'], [`${'a'.repeat(250)}@b.co`, 'seed']]) {
        expect((await attempt(client, 'service_role', 'select * from api.withdraw_preauthorization($1, $2)', [email, actor])).ok, email).toBe(false);
      }
      expect((await attempt(client, 'anon', `select * from api.withdraw_preauthorization('a@b.co', 'seed')`)).ok).toBe(false);
    });
  });

  it('activates exactly one Account at the first verified Google sign-in, and pins the Google subject', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const [adminEmail, memberEmail] = [`admin-${tag()}@example.test`, `member-${tag()}@example.test`];
      await svc.seed(adminEmail, 'administrator');
      await svc.seed(memberEmail, 'member');
      await svc.seed(adminEmail, 'administrator');
      await svc.seed(memberEmail, 'member');

      const admin = await addUser(client, {email: adminEmail});
      const member = await addUser(client, {email: memberEmail.toUpperCase()});

      const adminReceipt = await svc.consume(admin.id);
      expect(adminReceipt).toMatchObject({outcome: 'registered', role: 'administrator'});
      expect(adminReceipt.account_id).toMatch(uuidPattern);
      expect(adminReceipt.workspace_id).toMatch(uuidPattern);
      const memberReceipt = await svc.consume(member.id);
      expect(memberReceipt).toMatchObject({outcome: 'registered', role: 'member'});

      const {rows: accounts} = await client.query(`select user_id, role, source, google_subject from identity.accounts where user_id = any($1) order by role`, [[admin.id, member.id]]);
      expect(accounts).toEqual([
        {user_id: admin.id, role: 'administrator', source: 'preauthorization', google_subject: admin.subject},
        {user_id: member.id, role: 'member', source: 'preauthorization', google_subject: member.subject},
      ]);
      const {rows: pinned} = await client.query(`select email, role, google_subject, consumed_at is not null as consumed, account_id from identity.preauthorizations where email = any($1) order by role`, [[adminEmail, memberEmail]]);
      expect(pinned).toEqual([
        {email: adminEmail, role: 'administrator', google_subject: admin.subject, consumed: true, account_id: adminReceipt.account_id},
        {email: memberEmail, role: 'member', google_subject: member.subject, consumed: true, account_id: memberReceipt.account_id},
      ]);
      expect(await count(client, 'select count(*) as n from projects.workspaces where account_id = any($1)', [[adminReceipt.account_id, memberReceipt.account_id]])).toBe(2);
      expect(await count(client, `select count(*) as n from identity.audit_events where action = 'account.activated' and actor = any($1)`, [[`account:${adminReceipt.account_id}`, `account:${memberReceipt.account_id}`]])).toBe(2);

      // Signing in again changes nothing.
      expect(await svc.consume(admin.id)).toMatchObject({outcome: 'active', account_id: adminReceipt.account_id, role: 'administrator'});
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = any($1)', [[admin.id, member.id]])).toBe(2);
      expect(await svc.seed(adminEmail, 'administrator')).toMatchObject({created: false, consumed: true});
    });
  });

  it('refuses the same email under another Google subject, creates no Account and audits it', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const email = `admin-${tag()}@example.test`;
      const pre = await svc.seed(email, 'administrator');
      const admin = await addUser(client, {email});
      await svc.consume(admin.id);

      const impostor = await addUser(client, {email: email.toUpperCase().replace('@EXAMPLE.TEST', '@example.test'), subject: 'another-subject'});
      expect(impostor.email).not.toBe(email);
      const refused = await svc.consume(impostor.id);
      expect(refused).toMatchObject({outcome: 'refused', account_id: null, workspace_id: null, role: null});
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [impostor.id])).toBe(0);
      expect(await svc.status(impostor.id)).toMatchObject({status: 'none'});
      const {rows: audit} = await client.query(`select actor, action, target from identity.audit_events where actor = $1`, [`user:${impostor.id}`]);
      expect(audit).toEqual([{actor: `user:${impostor.id}`, action: 'registration.subject_mismatch', target: `preauthorization:${pre.preauthorization_id}`}]);
      const {rows: pinned} = await client.query('select google_subject from identity.preauthorizations where id = $1', [pre.preauthorization_id]);
      expect(pinned).toEqual([{google_subject: admin.subject}]);

      // The same user, refused again and again, gets nothing and adds no further row within the hour.
      for (let again = 0; again < 5; again += 1) expect((await svc.consume(impostor.id)).outcome).toBe('refused');
      expect(await count(client, 'select count(*) as n from identity.audit_events where actor = $1', [`user:${impostor.id}`])).toBe(1);
      // Another user is audited separately.
      const other = await addUser(client, {email: email.replace('admin-', 'ADMIN-'), subject: 'a-third-subject'});
      expect((await svc.consume(other.id)).outcome).toBe('refused');
      expect(await count(client, 'select count(*) as n from identity.audit_events where actor = $1', [`user:${other.id}`])).toBe(1);
    });
  });

  it('audits a repeated refusal again once an hour has passed', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const email = `admin-${tag()}@example.test`;
      const pre = await svc.seed(email, 'administrator');
      await svc.consume((await addUser(client, {email})).id);
      const impostor = await addUser(client, {email: email.toUpperCase().replace('@EXAMPLE.TEST', '@example.test'), subject: 'another-subject'});
      const target = `preauthorization:${pre.preauthorization_id}`;
      // An hour-old event does not suppress a new one (the table is append-only, so it is inserted aged).
      await client.query(`insert into identity.audit_events (occurred_at, actor, action, target) values (now() - interval '61 minutes', $1, 'registration.subject_mismatch', $2)`, [`user:${impostor.id}`, target]);
      expect((await svc.consume(impostor.id)).outcome).toBe('refused');
      expect(await count(client, 'select count(*) as n from identity.audit_events where actor = $1', [`user:${impostor.id}`])).toBe(2);
      expect((await svc.consume(impostor.id)).outcome).toBe('refused');
      expect(await count(client, 'select count(*) as n from identity.audit_events where actor = $1', [`user:${impostor.id}`])).toBe(2);
      // The suppression is per action and target: a different action is a different event.
      await client.query(`insert into identity.audit_events (actor, action, target) values ($1, 'registration.other_event', $2)`, [`user:${impostor.id}`, target]);
      expect(await count(client, 'select count(*) as n from identity.audit_events where actor = $1', [`user:${impostor.id}`])).toBe(3);
    });
  });

  it('refuses, audited, a Google subject that is already pinned to another Account, and never leaks a unique violation', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      // An Account whose Auth identity was later unlinked: the subject stays pinned to the Account.
      const hash = codeHash();
      await svc.issue(hash, 'named', 'Pinned');
      const first = await addUser(client, {subject: `shared-${tag()}`});
      const registered = await svc.register(first.id, hash);
      expect(registered.outcome).toBe('registered');
      await client.query(`delete from auth.identities where user_id = $1`, [first.id]);

      // The same Google subject now arrives on another Auth user whose address is pre-authorized.
      const email = `subject-in-use-${tag()}@example.test`;
      const pre = await svc.seed(email, 'member');
      const second = await addUser(client, {email, subject: first.subject});
      const refused = await attempt(client, 'service_role', 'select * from api.consume_preauthorization($1)', [second.id]);
      expect(refused.ok).toBe(true);
      if (refused.ok) expect(refused.rows[0]).toMatchObject({outcome: 'refused', account_id: null, workspace_id: null, role: null});
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [second.id])).toBe(0);
      expect(await count(client, 'select count(*) as n from projects.workspaces w join identity.accounts a on a.id = w.account_id where a.user_id = $1', [second.id])).toBe(0);
      expect(await count(client, 'select count(*) as n from identity.preauthorizations where id = $1 and consumed_at is null', [pre.preauthorization_id])).toBe(1);
      const {rows: audit} = await client.query('select actor, action, target from identity.audit_events where actor = $1', [`user:${second.id}`]);
      expect(audit).toEqual([{actor: `user:${second.id}`, action: 'registration.subject_in_use', target: `preauthorization:${pre.preauthorization_id}`}]);
      // Once an hour: asking again adds nothing.
      expect((await svc.consume(second.id)).outcome).toBe('refused');
      expect(await count(client, 'select count(*) as n from identity.audit_events where actor = $1', [`user:${second.id}`])).toBe(1);
      // The first Account is untouched.
      expect(await svc.status(first.id)).toMatchObject({status: 'active', account_id: registered.account_id});
    });
  });

  it('gives an unlisted or ineligible identity no Account and leaves the pre-authorization unused', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const unlisted = await addUser(client);
      expect(await svc.consume(unlisted.id)).toMatchObject({outcome: 'none', account_id: null});
      expect(withoutCommand(await svc.register(unlisted.id, codeHash()))).toEqual(generic);
      expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [unlisted.id])).toBe(0);

      const variants: UserOptions[] = [
        {verified: false},
        {confirmed: false},
        {provider: 'email'},
        {identity: false},
        {anonymous: true},
        {banned: true},
        {deleted: true},
        // Google verified another address than the one the pre-authorization names.
        {identityEmail: `not-the-same-${tag()}@example.test`},
      ];
      for (const [index, options] of variants.entries()) {
        const email = `variant-${index}-${tag()}@example.test`;
        await svc.seed(email, 'member');
        const user = await addUser(client, {...options, email});
        expect((await svc.consume(user.id)).outcome, JSON.stringify(options)).toBe('none');
        expect(await count(client, 'select count(*) as n from identity.accounts where user_id = $1', [user.id]), JSON.stringify(options)).toBe(0);
        expect(await count(client, 'select count(*) as n from identity.preauthorizations where email = $1 and consumed_at is null', [email])).toBe(1);
      }
      // The address Google verified is the one that must be pre-authorized, not the Auth user's other address.
      const [authEmail, googleEmail] = [`auth-${tag()}@example.test`, `google-${tag()}@example.test`];
      await svc.seed(googleEmail, 'member');
      const split = await addUser(client, {email: authEmail, identityEmail: googleEmail});
      expect((await svc.consume(split.id)).outcome).toBe('none');
      // A ban that has ended, and a different case or padding of the same address, do not block a sign-in.
      const [expiredEmail, paddedEmail] = [`expired-${tag()}@example.test`, `padded-${tag()}@example.test`];
      await svc.seed(expiredEmail, 'member');
      await svc.seed(paddedEmail, 'member');
      expect((await svc.consume((await addUser(client, {email: expiredEmail, banExpired: true})).id)).outcome).toBe('registered');
      expect((await svc.consume((await addUser(client, {email: paddedEmail.toUpperCase(), identityEmail: ` ${paddedEmail} `})).id)).outcome).toBe('registered');
      expect((await svc.consume(randomUUID())).outcome).toBe('none');
      expect(await svc.status(randomUUID())).toEqual({status: 'none', account_id: null, workspace_id: null, role: null});
    });
  });

  it('never lets an Account change who it is: its Auth user, Google subject, source and creation stay as they were', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const hash = codeHash();
      await svc.issue(hash, 'named', 'Immutable');
      const user = await addUser(client);
      const { account_id: accountId } = await svc.register(user.id, hash);
      const other = await addUser(client);
      for (const sql of [
        `update identity.accounts set user_id = '${other.id}' where id = $1`,
        `update identity.accounts set google_subject = 'someone-else' where id = $1`,
        `update identity.accounts set source = 'preauthorization' where id = $1`,
        `update identity.accounts set created_at = now() - interval '1 year' where id = $1`,
        `update identity.accounts set id = gen_random_uuid() where id = $1`,
        `update identity.accounts set user_id = '${other.id}', google_subject = 'x', source = 'preauthorization' where id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [accountId]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) {
          expect(result.code, sql).toBe('55000');
          expect(result.message).toMatch(/cannot change its identity/);
        }
      }
      // Status and role stay changeable for the stories that own them, and an update that changes nothing passes.
      for (const sql of [
        `update identity.accounts set status = 'disabled' where id = $1`,
        `update identity.accounts set status = 'active' where id = $1`,
        `update identity.accounts set role = 'administrator' where id = $1`,
        `update identity.accounts set google_subject = google_subject where id = $1`,
      ]) {
        expect((await attempt(client, null, sql, [accountId])).ok, sql).toBe(true);
      }
      expect(await svc.status(user.id)).toMatchObject({status: 'active', role: 'administrator'});
      const {rows: unchanged} = await client.query('select user_id, google_subject, source from identity.accounts where id = $1', [accountId]);
      expect(unchanged).toEqual([{user_id: user.id, google_subject: user.subject, source: 'invitation'}]);
    });
  });

  it('makes a consumed pre-authorization final', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const email = `final-${tag()}@example.test`;
      const pre = await svc.seed(email, 'member');
      await svc.consume((await addUser(client, {email})).id);
      for (const sql of [
        `update identity.preauthorizations set role = 'administrator' where id = $1`,
        `update identity.preauthorizations set google_subject = 'other' where id = $1`,
        `update identity.preauthorizations set consumed_at = null, account_id = null, google_subject = null where id = $1`,
      ]) {
        const result = await attempt(client, null, sql, [pre.preauthorization_id]);
        expect(result.ok, sql).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('audit events are append-only and carry no content (AC-8, constraints)', () => {
  it('refuses update, delete and truncate, even from the owner', async () => {
    await inTx(async (client) => {
      await client.query(`select identity.record_audit('seed', 'test.append_only', 'thing:one')`);
      const {rows: written} = await client.query(`select id from identity.audit_events where action = 'test.append_only'`);
      expect(written).toHaveLength(1);
      for (const sql of [
        `update identity.audit_events set action = 'test.changed' where id = ${written[0].id}`,
        `delete from identity.audit_events where id = ${written[0].id}`,
        'delete from identity.audit_events',
        'truncate identity.audit_events',
        'truncate identity.audit_events restart identity',
      ]) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.message).toMatch(/append-only/);
      }
      expect(await count(client, `select count(*) as n from identity.audit_events where action = 'test.append_only'`)).toBe(1);
    });
  });

  it('records an actor, an action, an opaque target and the time, and refuses free text', async () => {
    await inTx(async (client) => {
      const {rows: columns} = await client.query(
        `select column_name from information_schema.columns where table_schema = 'identity' and table_name = 'audit_events' order by ordinal_position`,
      );
      expect(columns.map((column) => column.column_name)).toEqual(['id', 'occurred_at', 'actor', 'action', 'target']);
      const rejected: Array<[string, string, string | null]> = [
        ['josh@example.com', 'test.event', null],
        ['a person', 'test.event', null],
        ['seed', 'Not An Action', null],
        ['seed', 'plain', null],
        ['seed', 'test.event', 'someone@example.com'],
        ['seed', 'test.event', 'invitation:with space'],
        ['seed', 'test.event', 'x'.repeat(80)],
      ];
      for (const [actor, action, target] of rejected) {
        const result = await attempt(client, null, 'select identity.record_audit($1, $2, $3)', [actor, action, target]);
        expect(result.ok, `${actor} ${action} ${target}`).toBe(false);
      }
      expect((await attempt(client, null, 'select identity.record_audit($1, $2, $3)', ['account:' + randomUUID(), 'account.activated', 'invitation:' + randomUUID()])).ok).toBe(true);
    });
  });

  it('audits issuing, revoking and activating without recording a label, an address or a code', async () => {
    await inTx(async (client) => {
      const svc = api(client);
      const before = await count(client, 'select count(*) as n from identity.audit_events');
      const hash = codeHash();
      const issued = await svc.issue(hash, 'named', 'Private Label');
      await svc.revoke({id: issued.invitation_id});
      const email = `audit-${tag()}@example.test`;
      await svc.seed(email, 'member');
      const {rows: events} = await client.query(`select actor, action, target from identity.audit_events order by id offset $1`, [before]);
      expect(events).toEqual([
        {actor: 'seed:local:test', action: 'invitation.issued', target: `invitation:${issued.invitation_id}`},
        {actor: 'seed:local:test', action: 'invitation.revoked', target: `invitation:${issued.invitation_id}`},
        {actor: 'seed:local:test', action: 'preauthorization.created', target: expect.stringMatching(/^preauthorization:/)},
      ]);
      const everything = JSON.stringify((await client.query('select * from identity.audit_events order by id offset $1', [before])).rows);
      for (const secret of ['Private Label', email, hash]) expect(everything).not.toContain(secret);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('AC-3 and AC-6 through the library and the REST API: hashes only, and closed when unreachable', () => {
  const env = () => ({
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
    INVITATION_HASH_KEY: randomBytes(32).toString('base64'),
    RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64'),
  });

  /** A named code through the library; the test fails if it was not issued. */
  async function issueNamed(label: string, options: {env: ReturnType<typeof env>}) {
    const issued = await issueInvitation({kind: 'named', label, actor: 'seed:local:test'}, options);
    if (issued.outcome !== 'issued') throw new Error('expected an issued code');
    if (issued.invitationId) committedInvitationIds.push(issued.invitationId);
    return issued;
  }

  it('issues a code, stores only its hash, registers with it once and never records the code or the address', async () => {
    const options = {env: env()};
    const issued = await issueNamed(`Library ${tag()}`, options);
    const user = await addUser(db);
    committedUsers.push(user.id);
    const address = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
    const key = Buffer.from(options.env.INVITATION_HASH_KEY, 'base64');
    committedOrigins.push(hashClientAddress(address, Buffer.from(options.env.RATE_LIMIT_HASH_KEY, 'base64')));

    // A wrong code first, so the limiter has recorded the address by the time the dump below runs.
    const wrong = await registerWithCode({userId: user.id, commandId: randomUUID(), code: generateInvitationCode(), clientAddress: address}, options);
    expect(wrong.outcome).toBe('refused');

    const command = randomUUID();
    const receipt = await registerWithCode({userId: user.id, commandId: command, code: issued.code.toLowerCase(), clientAddress: address}, options);
    expect(receipt).toMatchObject({commandId: command, outcome: 'registered', role: 'member', replayed: false});
    const replay = await registerWithCode({userId: user.id, commandId: command, code: issued.code, clientAddress: address}, options);
    expect(replay).toEqual({...receipt, replayed: true});
    const changed = await registerWithCode({userId: user.id, commandId: command, code: generateInvitationCode(), clientAddress: address}, options);
    expect(changed.outcome).toBe('refused');
    expect(await accountStatus(user.id, options)).toMatchObject({status: 'active', accountId: receipt.accountId, role: 'member'});
    expect(await consumePreauthorization(user.id, options)).toMatchObject({outcome: 'active', accountId: receipt.accountId});

    const {rows: stored} = await db.query('select code_hash, kind, status from identity.invitations where id = $1', [issued.invitationId]);
    expect(stored).toEqual([{code_hash: hashInvitationCode(issued.code, key), kind: 'named', status: 'redeemed'}]);

    // Nothing in any table holds the code, its canonical form, the address or the keys.
    let everything = '';
    for (const table of ['identity.invitations', 'identity.registration_commands', 'identity.rate_limit_counters', 'identity.registration_attempts', 'identity.accounts', 'identity.audit_events', 'identity.preauthorizations', 'projects.workspaces']) {
      everything += JSON.stringify((await db.query(`select t.* from ${table} t`)).rows);
    }
    const dotted = address.split('.');
    for (const secret of [issued.code, issued.code.replaceAll('-', ''), issued.code.toLowerCase(), address, options.env.INVITATION_HASH_KEY, options.env.RATE_LIMIT_HASH_KEY, `${dotted[0]}.${dotted[1]}.${dotted[2]}`]) {
      expect(everything, secret).not.toContain(secret);
    }
    const {rows: counter} = await db.query(`select key_hash from identity.rate_limit_counters where key_hash = $1`, [hashClientAddress(address, Buffer.from(options.env.RATE_LIMIT_HASH_KEY, 'base64'))]);
    expect(counter).toHaveLength(1);
    expect(counter[0].key_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('issues codes of 160 bits with only the hash in the database', async () => {
    const options = {env: env()};
    const key = Buffer.from(options.env.INVITATION_HASH_KEY, 'base64');
    const issued = await issueNamed(`Entropy ${tag()}`, options);
    const {rows: columns} = await db.query(`select column_name from information_schema.columns where table_schema = 'identity' and table_name = 'invitations' order by ordinal_position`);
    expect(columns.map((column) => column.column_name)).not.toContain('code');
    const {rows: stored} = await db.query('select code_hash from identity.invitations where id = $1', [issued.invitationId]);
    expect(stored[0].code_hash).toBe(hashInvitationCode(issued.code, key));
    expect(issued.code.replaceAll('-', '')).toHaveLength(32);
    await db.query('begin');
    await api(db).revoke({id: issued.invitationId});
    await db.query('commit');
  });

  it('refuses what is not shaped like a code without touching the database: no limiter budget is spent', async () => {
    const options = {env: env()};
    const user = await addUser(db);
    committedUsers.push(user.id);
    const address = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
    const origin = hashClientAddress(address, Buffer.from(options.env.RATE_LIMIT_HASH_KEY, 'base64'));
    committedOrigins.push(origin);
    const before = await count(db, 'select count(*) as n from identity.registration_attempts');
    for (let guess = 0; guess < 20; guess += 1) {
      const result = await registerWithCode({userId: user.id, commandId: randomUUID(), code: `guess ${guess}`, clientAddress: address}, options);
      expect(result).toMatchObject({outcome: 'refused', accountId: null});
    }
    expect(await count(db, 'select count(*) as n from identity.rate_limit_counters where key_hash = $1', [origin])).toBe(0);
    expect(await count(db, 'select count(*) as n from identity.registration_attempts')).toBe(before);
    // A real code from the same address is not limited: the twenty guesses cost it nothing.
    const issued = await issueNamed(`Unlimited ${tag()}`, options);
    expect((await registerWithCode({userId: user.id, commandId: randomUUID(), code: issued.code, clientAddress: address}, options)).outcome).toBe('registered');
  });

  it('reports a disabled Account as disabled through the library, and lists invitations without a hash or a code', async () => {
    const options = {env: env()};
    const issued = await issueNamed(`Disabled ${tag()}`, options);
    const user = await addUser(db);
    committedUsers.push(user.id);
    const command = randomUUID();
    const registered = await registerWithCode({userId: user.id, commandId: command, code: issued.code, clientAddress: null}, options);
    expect(registered.outcome).toBe('registered');
    await db.query(`update identity.accounts set status = 'disabled' where id = $1`, [registered.accountId]);
    expect(await registerWithCode({userId: user.id, commandId: command, code: issued.code, clientAddress: null}, options)).toMatchObject({outcome: 'disabled', accountId: registered.accountId, replayed: true});
    expect(await consumePreauthorization(user.id, options)).toMatchObject({outcome: 'disabled'});
    expect(await accountStatus(user.id, options)).toMatchObject({status: 'disabled'});

    const listed = await listInvitations(options);
    const mine = listed.find((item) => item.invitationId === issued.invitationId);
    expect(mine).toMatchObject({kind: 'named', state: 'redeemed'});
    expect(mine?.label).toMatch(/^Disabled /);
    expect(JSON.stringify(listed)).not.toContain(issued.code);
    expect(JSON.stringify(listed)).not.toContain(hashInvitationCode(issued.code, Buffer.from(options.env.INVITATION_HASH_KEY, 'base64')));
  });

  it('fails closed: an unreachable or refusing database never yields a success', async () => {
    const user = randomUUID();
    const input = {userId: user, commandId: randomUUID(), code: generateInvitationCode(), clientAddress: '203.0.113.5'};
    await expect(registerWithCode(input, {env: {...env(), NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}, timeoutMs: 3000})).rejects.toBeInstanceOf(AccountsUnavailableError);
    const asAnon = await registerWithCode(input, {env: {...env(), SUPABASE_SERVICE_ROLE_KEY: stack.anonKey}}).catch((error: unknown) => error as AccountsUnavailableError);
    expect(asAnon).toBeInstanceOf(AccountsUnavailableError);
    expect((asAnon as AccountsUnavailableError).code).toBe('42501');
    expect(await count(db, 'select count(*) as n from identity.accounts where user_id = $1', [user])).toBe(0);
  });
});

