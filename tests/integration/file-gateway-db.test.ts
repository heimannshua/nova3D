import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {canonicalize} from '@/lib/canonical-json';
import {GatewayError, GatewayUnavailableError} from '@/lib/gateway-client';
import {runTask} from '@/lib/job-tasks';
import {handleJobRequest} from '@/lib/jobs';
import {claimJobRun, finishJobRun, listExpiredStaging, revokeServiceKey} from '@/lib/lifecycle';
import {createHarness, uuidPattern} from '../support/accounts-db';
import {createMember, epochOf, roleUrl, sha256, type Member} from '../support/gateway-world';
import {signedCall, testSigningKeys} from '../support/qstash-signature';
import {jwtSecretOf, localStack, s3Of, stackEnvironment} from '../support/stack';
import {createS3Storage} from '../../workers/files/src/storage';

// Story 1.12, the database half, against the Supabase CLI stack: the Artifacts schema and its closure, the file gateway's own role and everything it
// can and cannot reach, the authorization view against api.authorize_session over every state, the redemption of tickets, the transfer handles, the
// staging leases and their one-way states, a key's revocation, the cleanup's list, the one writer of a manifest, the private bucket, the preflight and
// the receipts of the new scheduled task. (The gateway itself, over HTTP, is tests/integration/file-gateway.test.ts.)
//
// Most cases run inside a transaction that is rolled back. The Artifacts tables are append-only or final (no delete, no truncate), so a case that
// commits (the ones that need two real connections, or the gateway's own login) leaves rows behind: each asserts on its own IDs, never on a count of
// the table, and any lease it leaves in a state the cleanup would list is moved to `deleted` afterwards.

const {db, connect, committed, inTx, addUser, addSession, attempt, rows} = createHarness();

let env: Record<string, string>;
/** A real connection as the gateway's own role (nova3d_gateway, with the local password of supabase/seed.sql). */
let gateway: Client;
const left: string[] = [];

beforeAll(async () => {
  env = await stackEnvironment(db);
  gateway = new Client({connectionString: roleUrl()});
  await gateway.connect();
});
afterAll(async () => {
  await gateway?.query('rollback').catch(() => undefined);
  await gateway?.end().catch(() => undefined);
  // What a committing case left in a state the hourly cleanup would list is finished, so the next run (and the gateway tests) start clean.
  if (left.length) {
    await db.query(`update artifacts.staging_leases set state = 'released' where id = any($1) and state <> 'deleted' and state <> 'released'`, [left]).catch(() => undefined);
    await db.query(`update artifacts.staging_leases set state = 'deleted' where id = any($1) and state = 'released'`, [left]).catch(() => undefined);
  }
});

const member = () => createMember(db, env, {addUser, addSession, committedUsers: committed.users, committedInvitations: committed.invitationIds});
const svc = async (client: Client, sql: string, params: unknown[] = []) => (await rows(client, 'service_role', sql, params))[0];
const uniqueKid = () => `kid-${randomBytes(6).toString('hex')}`;
const newJti = () => randomBytes(16).toString('base64url');
const minutes = (count: number, from = new Date()) => new Date(from.getTime() + count * 60_000);
const MiB = 1024 * 1024;

/** Work on the gateway role's connection, in a transaction that is always rolled back. */
async function asGateway<T>(work: (client: Client) => Promise<T>) {
  await gateway.query('begin');
  try {
    return await work(gateway);
  } finally {
    await gateway.query('rollback');
  }
}

type RedemptionInput = {jti?: string; kid: string; account: string; typ?: 'ticket' | 'command'; issuer?: string; session?: string | null; direction?: string | null; kind?: string; target?: string; expires?: Date};
const redemptionSql = `insert into artifacts.ticket_redemptions (jti, typ, issuer, kid, account_id, session_id, direction, target_kind, target_id, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning jti`;
function redemptionParams(o: RedemptionInput) {
  const typ = o.typ ?? 'ticket';
  return [
    o.jti ?? newJti(),
    typ,
    o.issuer ?? 'application',
    o.kid,
    o.account,
    o.session === undefined ? (typ === 'ticket' ? randomUUID() : null) : o.session,
    o.direction === undefined ? (typ === 'ticket' ? 'upload' : null) : o.direction,
    o.kind ?? (typ === 'ticket' ? 'staging' : 'delete-staging'),
    o.target ?? randomUUID(),
    o.expires ?? minutes(5),
  ];
}
const redeem = (client: Client, o: RedemptionInput) => client.query(redemptionSql, redemptionParams(o));

type HandleInput = {jti: string; kid: string; account: string; session?: string; epoch?: number; direction?: string; kind?: string; target?: string; hash?: Buffer; created?: Date; expires?: Date};
const handleSql = `insert into artifacts.transfer_handles (hash, jti, session_id, account_id, epoch, direction, target_kind, target_id, kid, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning hash`;
function handleParams(o: HandleInput) {
  const created = o.created ?? new Date();
  return [o.hash ?? randomBytes(32), o.jti, o.session ?? randomUUID(), o.account, o.epoch ?? 1, o.direction ?? 'upload', o.kind ?? 'staging', o.target ?? randomUUID(), o.kid, created, o.expires ?? minutes(30, created)];
}
const openHandle = (client: Client, o: HandleInput) => client.query(handleSql, handleParams(o));

type LeaseInput = {id?: string; account: string; kid?: string; kind?: string; length?: number; sha?: string; ct?: string; received?: number; state?: string; expires?: Date; created?: Date};
const leaseSql = `insert into artifacts.staging_leases (id, account_id, kid, kind, length, sha256, content_type, received_length, state, created_at, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`;
function leaseParams(o: LeaseInput) {
  const state = o.state ?? 'receiving';
  const length = o.length ?? 1000;
  const kind = o.kind ?? 'file';
  return [
    o.id ?? randomUUID(),
    o.account,
    o.kid ?? 'test-kid',
    kind,
    length,
    o.sha ?? randomBytes(32).toString('hex'),
    o.ct ?? (kind === 'picture' ? 'image/png' : 'application/octet-stream'),
    o.received ?? (state === 'complete' || state === 'attached' ? length : 0),
    state,
    o.created ?? new Date(),
    o.expires ?? new Date(Date.now() + 24 * 3600_000),
  ];
}
const addLease = async (client: Client, o: LeaseInput) => (await client.query(leaseSql, leaseParams(o))).rows[0].id as string;

async function waitingOnLock(pid: number) {
  for (let tries = 0; tries < 100; tries += 1) {
    const {rows: waiting} = await db.query('select wait_event_type as type, wait_event as event from pg_stat_activity where pid = $1', [pid]);
    if (waiting[0]?.type === 'Lock') return waiting[0].event as string;
    await sleep(50);
  }
  throw new Error('The other connection never started waiting for the lock.');
}
const pidOf = async (client: Client) => Number((await client.query('select pg_backend_pid() as pid')).rows[0].pid);

const artifactsTables = ['attachment_transforms', 'manifests', 'service_key_revocations', 'staging_leases', 'ticket_redemptions', 'transfer_handles'];
const artifactsViews = ['instance', 'session_authority'];
const browserRoles = ['anon', 'authenticated', 'service_role'];

// ---------------------------------------------------------------------------------------------------
describe('the Artifacts schema is closed to every role but the owner and the gateway', () => {
  it('holds exactly the six tables and the two views, and no sequence and no other relation, and is not in public or lifecycle', async () => {
    const {rows: relations} = await db.query(
      `select c.relname as name, c.relkind as kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'artifacts' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') order by 1`,
    );
    expect(relations.filter((row) => row.kind === 'r').map((row) => row.name)).toEqual(artifactsTables);
    expect(relations.filter((row) => row.kind === 'v').map((row) => row.name)).toEqual(artifactsViews);
    expect(relations.filter((row) => !['r', 'v'].includes(row.kind))).toEqual([]);
    const {rows: elsewhere} = await db.query(`select schemaname, tablename from pg_tables where schemaname in ('public', 'lifecycle') and tablename = any($1)`, [artifactsTables]);
    expect(elsewhere).toEqual([]);
  });

  it('has row-level security on every table, and a policy only for the gateway role, for exactly the commands it is granted', async () => {
    const {rows: tables} = await db.query(
      `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'artifacts' and c.relkind = 'r' order by 1`,
    );
    expect(tables).toHaveLength(6);
    for (const table of tables) expect(table, table.name).toMatchObject({rls: true});
    const {rows: policies} = await db.query(
      `select c.relname as table, p.polname as name, p.polcmd as command, p.polpermissive as permissive,
              array(select case when r = 0 then 'public' else r::regrole::text end from unnest(p.polroles) r) as roles,
              pg_get_expr(p.polqual, p.polrelid) as using, pg_get_expr(p.polwithcheck, p.polrelid) as check
         from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'artifacts' order by 1, 2`,
    );
    // r = select, a = insert, w = update. Each is for the gateway role alone and admits every row: the GRANTS decide the commands and the columns.
    const gatewayOnly = {permissive: true, roles: ['nova3d_gateway']};
    expect(policies).toEqual([
      {table: 'staging_leases', name: 'gateway_insert', command: 'a', using: null, check: 'true', ...gatewayOnly},
      {table: 'staging_leases', name: 'gateway_select', command: 'r', using: 'true', check: null, ...gatewayOnly},
      {table: 'staging_leases', name: 'gateway_update', command: 'w', using: 'true', check: 'true', ...gatewayOnly},
      {table: 'ticket_redemptions', name: 'gateway_insert', command: 'a', using: null, check: 'true', ...gatewayOnly},
      {table: 'ticket_redemptions', name: 'gateway_select', command: 'r', using: 'true', check: null, ...gatewayOnly},
      {table: 'transfer_handles', name: 'gateway_insert', command: 'a', using: null, check: 'true', ...gatewayOnly},
      {table: 'transfer_handles', name: 'gateway_select', command: 'r', using: 'true', check: null, ...gatewayOnly},
    ]);
    // None of the other three tables has a policy, and none has a policy for a command its role holds no grant for.
    for (const table of ['manifests', 'attachment_transforms', 'service_key_revocations']) expect(policies.filter((policy) => policy.table === table), table).toEqual([]);
  });

  it('grants public, anon, authenticated and service_role nothing on the schema, any table, view, sequence or function, and PUBLIC is in no ACL', async () => {
    for (const role of browserRoles) {
      expect((await db.query(`select has_schema_privilege($1, 'artifacts', 'usage,create') as any`, [role])).rows[0].any, `${role} on the schema`).toBe(false);
      const {rows: relations} = await db.query(
        `select c.relname as name, c.relkind as kind,
                case when c.relkind = 'S' then has_sequence_privilege($1, c.oid, 'usage,select,update')
                     else has_table_privilege($1, c.oid, 'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege($1, c.oid, 'select,insert,update,references') end as any
           from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'artifacts' and c.relkind in ('r', 'v', 'S')`,
        [role],
      );
      expect(relations).toHaveLength(8);
      for (const relation of relations) expect(relation.any, `${role} on artifacts.${relation.name}`).toBe(false);
      const {rows: functions} = await db.query(
        `select p.proname as name, has_function_privilege($1, p.oid, 'execute') as can from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'artifacts'`,
        [role],
      );
      expect(functions.length).toBeGreaterThanOrEqual(5);
      for (const fn of functions) expect(fn.can, `${role} executes artifacts.${fn.name}`).toBe(false);
    }
    const {rows: publicGrants} = await db.query(
      `select 'schema' as kind, n.nspname as name from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'artifacts' and a.grantee = 0
       union all
       select 'relation', c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a where n.nspname = 'artifacts' and a.grantee = 0
       union all
       select 'function', p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a where n.nspname = 'artifacts' and a.grantee = 0
       union all
       select 'default', n.nspname from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a where n.nspname = 'artifacts' and a.grantee = 0`,
    );
    expect(publicGrants).toEqual([]);
    // No function of the schema has an implicit ACL (null means the built-in PUBLIC execute): each says who may.
    const {rows: implicit} = await db.query(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'artifacts' and p.proacl is null`);
    expect(implicit).toEqual([]);
  });

  it('is closed by default to what is made next: no default privilege grants to a browser role or PUBLIC, and a throwaway function, table and sequence are open to nobody', async () => {
    const {rows: defaults} = await db.query(
      `select d.defaclobjtype as kind, a.privilege_type as privilege, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
         from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
        where n.nspname = 'artifacts' and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))`,
    );
    expect(defaults).toEqual([]);
    await inTx(async (client) => {
      await client.query(`create function artifacts.throwaway() returns integer language sql as 'select 1'`);
      await client.query('create table artifacts.throwaway (id integer generated always as identity primary key)');
      for (const role of browserRoles) {
        expect((await client.query(`select has_function_privilege($1, 'artifacts.throwaway()', 'execute') as can`, [role])).rows[0].can, `${role} executes a new function`).toBe(false);
        const {rows: grant} = await client.query(
          `select has_table_privilege($1, 'artifacts.throwaway', 'select,insert,update,delete,truncate,references,trigger') as can, has_sequence_privilege($1, 'artifacts.throwaway_id_seq', 'usage,select,update') as can_sequence`,
          [role],
        );
        expect(grant[0], `${role} on a new table and its sequence`).toEqual({can: false, can_sequence: false});
      }
      const {rows: acl} = await client.query(`select count(*)::int as n from pg_proc p, aclexplode(p.proacl) a where p.oid = 'artifacts.throwaway()'::regprocedure and a.grantee = 0`);
      expect(acl[0].n).toBe(0);
    });
  });

  it('runs every function with an empty search_path, the two that read what the caller may not as their owner, and executable by nobody but the gateway (publish_attachment only)', async () => {
    const {rows: functions} = await db.query(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'artifacts' order by 1`,
    );
    expect(functions.map((fn) => fn.name)).toEqual(['guard_handle', 'guard_lease', 'guard_redemption', 'publish_attachment', 'refuse_change']);
    for (const fn of functions) {
      expect(String(fn.config), `artifacts.${fn.name} pins an empty search_path`).toContain('search_path=""');
      expect(fn.grantees, `artifacts.${fn.name}`).toEqual(fn.name === 'publish_attachment' ? ['nova3d_gateway'] : []);
    }
    // The ones that must act with the owner's rights: the redemption guard (reads the revocations the gateway cannot) and the one writer of a manifest.
    expect(functions.filter((fn) => fn.definer).map((fn) => fn.name)).toEqual(['guard_redemption', 'publish_attachment']);
  });

  it('is not exposed by the Data API: the REST API answers for none of its tables or views, to the service role or anyone', async () => {
    for (const key of [stack().serviceKey, stack().anonKey]) {
      for (const name of [...artifactsTables, ...artifactsViews]) {
        const response = await fetch(`${stack().apiUrl}/rest/v1/${name}?select=*`, {headers: {apikey: stack().anonKey, authorization: `Bearer ${key}`, 'accept-profile': 'artifacts'}});
        expect(response.status, `artifacts.${name}`).toBe(406);
      }
    }
    const {rows} = await db.query(`select rolname, rolconfig from pg_roles where rolname = 'authenticator'`);
    expect(JSON.stringify(rows)).not.toContain('artifacts');
  });
});

const stack = () => localStack();

// ---------------------------------------------------------------------------------------------------
describe('the append-only and final tables refuse a truncate, by a trigger the catalog shows', () => {
  // A TRUNCATE takes the strongest lock on the table before it checks anything, and the Artifacts tables are shared with every other session on this
  // stack, so the statement is not tried on them: the catalog shows each table has the trigger, and the trigger is shown to refuse on a scratch table.
  it.each(['service_key_revocations', 'staging_leases', 'ticket_redemptions', 'transfer_handles', 'attachment_transforms', 'manifests'])('artifacts.%s has a BEFORE TRUNCATE trigger that is artifacts.refuse_change, and a DELETE one (a lease, a redemption, a handle and a manifest are never deleted)', async (table) => {
    const {rows} = await db.query(
      `select t.tgname as name, (t.tgtype & 32) <> 0 as on_truncate, (t.tgtype & 8) <> 0 as on_delete, (t.tgtype & 2) <> 0 as before, p.proname as function
         from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = $1::regclass and not t.tgisinternal`,
      [`artifacts.${table}`],
    );
    const truncating = rows.filter((row) => row.on_truncate);
    expect(truncating, table).toEqual([expect.objectContaining({before: true, function: 'refuse_change'})]);
    expect(rows.filter((row) => row.on_delete && row.before).map((row) => row.function), table).toEqual(['refuse_change']);
  });

  it('refuses with 55000: the trigger function does, on a scratch table that carries it', async () => {
    await inTx(async (client) => {
      await client.query('create table artifacts.scratch_truncate (id integer)');
      await client.query('create trigger scratch_no_truncate before truncate on artifacts.scratch_truncate for each statement execute function artifacts.refuse_change()');
      await client.query('create trigger scratch_no_delete before delete on artifacts.scratch_truncate for each row execute function artifacts.refuse_change()');
      await client.query('insert into artifacts.scratch_truncate values (1)');
      for (const sql of ['truncate artifacts.scratch_truncate', 'delete from artifacts.scratch_truncate']) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
    });
  });
});

describe('the gateway role holds exactly its list and nothing else', () => {
  it('has the attributes of a role with no power: it can log in, and is no superuser and cannot create databases or roles, replicate or bypass row-level security, and belongs to no role', async () => {
    const {rows} = await db.query(
      `select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, (select count(*)::int from pg_auth_members m where m.member = r.oid) as memberships
         from pg_roles r where rolname = 'nova3d_gateway'`,
    );
    expect(rows).toEqual([{rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, memberships: 0}]);
    // It is a login that really works, with the local password (the connection of this file), as itself.
    expect((await gateway.query('select current_user as who')).rows).toEqual([{who: 'nova3d_gateway'}]);
  });

  it('carries its limits as role defaults: statements and idle transactions end after 15 seconds, and at most 20 connections are open at once', async () => {
    const {rows} = await db.query(`select rolconfig, rolconnlimit from pg_roles where rolname = 'nova3d_gateway'`);
    expect(rows).toHaveLength(1);
    expect([...(rows[0].rolconfig as string[])].sort()).toEqual(['idle_in_transaction_session_timeout=15s', 'statement_timeout=15s']);
    expect(rows[0].rolconnlimit).toBe(20);
    // A session the role opens has them without asking (this file's own connection as the gateway is one).
    expect((await gateway.query(`select current_setting('statement_timeout') as statement, current_setting('idle_in_transaction_session_timeout') as idle`)).rows).toEqual([{statement: '15s', idle: '15s'}]);
  });

  it('has no password in any migration: a password in the repository would be a secret in the repository', () => {
    const directory = join(import.meta.dirname, '../../supabase/migrations');
    const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql'));
    expect(migrations).toContain('20261015120000_file_gateway.sql');
    for (const name of migrations) {
      const code = readFileSync(join(directory, name), 'utf8').replace(/^\s*--.*$/gm, '');
      expect(code, name).not.toMatch(/\b(?:create|alter)\s+role\b[^;]*\bpassword\b/i);
      expect(code, name).not.toMatch(/nova3d-gateway-local/);
    }
    // The local one is set by the seed, which hosted environments never run, and said to be local.
    const seed = readFileSync(join(import.meta.dirname, '../../supabase/seed.sql'), 'utf8');
    expect(seed).toMatch(/alter role nova3d_gateway with password '[^']+'/);
    expect(readFileSync(join(directory, '20261015120000_file_gateway.sql'), 'utf8')).toMatch(/NO password here/);
  });

  it('can reach exactly what its list says, read from the catalog over every relation, column and function of api, identity, projects, lifecycle, artifacts, storage, auth and public', async () => {
    const schemas = ['api', 'identity', 'projects', 'lifecycle', 'artifacts', 'storage', 'auth', 'public'];
    const {rows: usage} = await db.query(
      `select nspname as name, has_schema_privilege('nova3d_gateway', oid, 'usage') as usage, has_schema_privilege('nova3d_gateway', oid, 'create') as create from pg_namespace where nspname = any($1) order by 1`,
      [schemas],
    );
    // Usage on its own schema (and on public, which every role has and which holds nothing it can use); create nowhere.
    expect(usage.filter((row) => row.usage).map((row) => row.name)).toEqual(['artifacts', 'public']);
    for (const row of usage) expect(row.create, `create on ${row.name}`).toBe(false);

    const {rows: relations} = await db.query(
      `select n.nspname as schema, c.relname as name,
              array_remove(array[
                case when has_table_privilege('nova3d_gateway', c.oid, 'select') then 'select' end,
                case when has_table_privilege('nova3d_gateway', c.oid, 'insert') then 'insert' end,
                case when has_table_privilege('nova3d_gateway', c.oid, 'update') then 'update' end,
                case when has_table_privilege('nova3d_gateway', c.oid, 'delete') then 'delete' end,
                case when has_table_privilege('nova3d_gateway', c.oid, 'truncate') then 'truncate' end,
                case when has_table_privilege('nova3d_gateway', c.oid, 'references') then 'references' end,
                case when has_table_privilege('nova3d_gateway', c.oid, 'trigger') then 'trigger' end
              ], null) as table_privileges,
              array(select a.attname::text from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                       and (has_column_privilege('nova3d_gateway', c.oid, a.attnum, 'update') or has_column_privilege('nova3d_gateway', c.oid, a.attnum, 'insert')
                            or has_column_privilege('nova3d_gateway', c.oid, a.attnum, 'references')) order by a.attname) as writable_columns,
              case when c.relkind = 'S' then has_sequence_privilege('nova3d_gateway', c.oid, 'usage,select,update') else false end as sequence
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') order by 1, 2`,
      [schemas],
    );
    expect(relations.length).toBeGreaterThan(40);
    const granted: Record<string, {privileges: string[]; writable?: string[]}> = {
      'artifacts.instance': {privileges: ['select']},
      'artifacts.session_authority': {privileges: ['select']},
      'artifacts.ticket_redemptions': {privileges: ['select', 'insert'], writable: ['account_id', 'direction', 'expires_at', 'issuer', 'jti', 'kid', 'redeemed_at', 'session_id', 'target_id', 'target_kind', 'typ']},
      'artifacts.transfer_handles': {privileges: ['select', 'insert'], writable: ['account_id', 'created_at', 'direction', 'ended_at', 'epoch', 'expires_at', 'hash', 'jti', 'kid', 'session_id', 'target_id', 'target_kind']},
      // Insert and select on the whole table; UPDATE on its three progress columns only (the column list below is insert plus update).
      'artifacts.staging_leases': {privileges: ['select', 'insert'], writable: ['account_id', 'content_type', 'created_at', 'expires_at', 'id', 'kid', 'kind', 'length', 'received_length', 'sha256', 'state']},
    };
    for (const relation of relations) {
      const name = `${relation.schema}.${relation.name}`;
      const wanted = granted[name];
      expect(relation.table_privileges, name).toEqual(wanted ? wanted.privileges : []);
      expect(relation.writable_columns, name).toEqual(wanted?.writable ?? []);
      expect(relation.sequence, `${name} as a sequence`).toBe(false);
    }
    expect(Object.keys(granted).every((name) => relations.some((relation) => `${relation.schema}.${relation.name}` === name))).toBe(true);

    // The one update it holds is on its progress columns.
    const {rows: updatable} = await db.query(
      `select a.attname::text as name from pg_attribute a where a.attrelid = 'artifacts.staging_leases'::regclass and a.attnum > 0 and not a.attisdropped
          and has_column_privilege('nova3d_gateway', 'artifacts.staging_leases'::regclass, a.attnum, 'update') order by 1`,
    );
    expect(updatable.map((row) => row.name)).toEqual(['expires_at', 'received_length', 'state']);

    // Functions: reachable means the schema is usable and execute is held. Only artifacts.publish_attachment is. (Functions of `auth` and `storage`
    // that PUBLIC may execute are not reachable: it has no usage on those schemas.)
    const {rows: functions} = await db.query(
      `select n.nspname as schema, p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = any($1) and has_function_privilege('nova3d_gateway', p.oid, 'execute') and has_schema_privilege('nova3d_gateway', n.oid, 'usage') order by 1, 2`,
      [schemas],
    );
    expect(functions).toEqual([{schema: 'artifacts', name: 'publish_attachment'}]);
  });

  it('is refused for the rest when it tries, as itself: no api, identity, projects, lifecycle, storage or auth object, no other artifacts table, no delete, no truncate', async () => {
    await asGateway(async (client) => {
      for (const sql of [
        'select * from identity.accounts',
        'select * from identity.session_grants',
        'select * from projects.projects',
        'select * from lifecycle.instance_identity',
        'select * from lifecycle.tombstones',
        'select * from auth.users',
        'select * from storage.buckets',
        'select * from storage.objects',
        'select * from artifacts.manifests',
        'select * from artifacts.service_key_revocations',
        'select * from artifacts.attachment_transforms',
        'select * from api.preflight()',
        'select * from api.authorize_session(gen_random_uuid(), gen_random_uuid())',
        'select * from api.list_expired_staging(1)',
        `select * from api.revoke_service_key('application', 'x', 'compromise')`,
        'select identity.subject_pinned(gen_random_uuid(), $1)',
        `select lifecycle.is_tombstoned('account', gen_random_uuid())`,
        'select artifacts.refuse_change()',
        'select artifacts.guard_redemption()',
      ]) {
        const result = await attempt(client, null, sql, sql.includes('$1') ? ['x'] : []);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('42501');
      }
      // It cannot make a table, a view or a function anywhere, or grant anything.
      for (const sql of ['create table artifacts.mine (id integer)', 'create table public.mine (id integer)', 'create function artifacts.mine() returns integer language sql as $$ select 1 $$']) {
        expect((await attempt(client, null, sql)).ok, sql).toBe(false);
      }
      // A GRANT by a role that holds no grant option is not an error but a warning, and grants nothing: the point is that anon still has nothing.
      await client.query('grant select on artifacts.staging_leases to anon');
      expect((await db.query(`select has_table_privilege('anon', 'artifacts.staging_leases', 'select') as can`)).rows[0].can).toBe(false);
      expect((await client.query(`select has_table_privilege('anon', 'artifacts.staging_leases', 'select') as can`)).rows[0].can).toBe(false);
      // (It holds no TRUNCATE either: the catalog test above says so. The statement itself is not tried on the shared tables, because it takes the
      // strongest table lock BEFORE its privileges are checked and would queue behind, and in front of, every other session using them.)
      // What it may read, it reads; what it may not change, it cannot.
      expect((await attempt(client, null, 'select count(*) from artifacts.staging_leases')).ok).toBe(true);
      for (const sql of [
        'delete from artifacts.staging_leases',
        'delete from artifacts.ticket_redemptions',
        'delete from artifacts.transfer_handles',
        'update artifacts.ticket_redemptions set kid = kid',
        'update artifacts.transfer_handles set ended_at = now()',
        'insert into artifacts.manifests (root, id, account_id, upload_id, kind, digest, length, serialization, activity, body) values (repeat($1, 64), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), $2, repeat($1, 64), 1, 1, $3, $4)',
        `insert into artifacts.attachment_transforms (name) values ('strip')`,
        `insert into artifacts.service_key_revocations (issuer, kid, reason) values ('application', 'x', 'compromise')`,
      ]) {
        const result = await attempt(client, null, sql, sql.includes('$1') ? ['a', 'file', 'upload:none', '{}'] : []);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('42501');
      }
      // Of a lease it may change the three progress columns and no other, and it cannot rewrite what a lease is.
      const account = randomUUID();
      const id = await addLease(client, {account});
      expect((await attempt(client, null, 'update artifacts.staging_leases set received_length = 10, expires_at = now() + interval \'1 day\' where id = $1', [id])).ok).toBe(true);
      expect((await attempt(client, null, `update artifacts.staging_leases set state = 'released' where id = $1`, [id])).ok).toBe(true);
      for (const column of ['id', 'account_id', 'kid', 'kind', 'length', 'sha256', 'content_type', 'created_at']) {
        const result = await attempt(client, null, `update artifacts.staging_leases set ${column} = ${column} where id = $1`, [id]);
        expect(result.ok, column).toBe(false);
        if (!result.ok) expect(result.code, column).toBe('42501');
      }
    });
  });

  it('can run the one function it has and no other function, and the browser roles and the service role cannot run even that one', async () => {
    for (const role of browserRoles) {
      expect((await db.query(`select has_function_privilege($1, 'artifacts.publish_attachment(uuid, bigint, uuid, text, text, text)', 'execute') as can`, [role])).rows[0].can, role).toBe(false);
    }
    await inTx(async (client) => {
      for (const role of browserRoles) {
        const result = await attempt(client, role, `select * from artifacts.publish_attachment(gen_random_uuid(), 1, gen_random_uuid(), 'none', repeat('a', 64), '{}')`);
        expect(result.ok, role).toBe(false);
      }
    });
    // The gateway itself can call it (an unknown lease is `not_found`, an answer, and the Account's authority is asked first).
    const who = await member();
    await asGateway(async (client) => {
      const {rows: answer} = await client.query(`select * from artifacts.publish_attachment($1, $2, gen_random_uuid(), 'none', repeat('a', 64), '{}')`, [who.accountId, await epochOf(db, who.accountId)]);
      expect(answer[0].outcome).toBe('not_found');
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('artifacts.session_authority answers what api.authorize_session answers, for every state, and never writes', () => {
  type Seen = {view: string | null; auth: string; rows: number};
  /** The view first (it writes nothing), then authorize_session (which may touch or revoke the grant). */
  async function seen(client: Client, who: Member): Promise<Seen> {
    const {rows: view} = await client.query('select state from artifacts.session_authority where session_id = $1', [who.sessionId]);
    const {rows: auth} = await client.query('select state from api.authorize_session($1, $2)', [who.userId, who.sessionId]);
    return {view: view[0]?.state ?? null, auth: auth[0].state, rows: view.length};
  }

  type Scenario = {name: string; change: (client: Client, who: Member) => Promise<void>; view: string; auth: string};
  const grantUpdate = (set: string) => (client: Client, who: Member) => client.query(`update identity.session_grants set ${set} where session_id = $1`, [who.sessionId]).then(() => undefined);
  const accountUpdate = (set: string) => (client: Client, who: Member) => client.query(`update identity.accounts set ${set} where id = $1`, [who.accountId]).then(() => undefined);
  const seconds = (count: number) => `interval '${count} seconds'`;

  const scenarios: Scenario[] = [
    {name: 'active', change: async () => undefined, view: 'active', auth: 'active'},
    {name: 'disabled', change: accountUpdate(`status = 'disabled'`), view: 'disabled', auth: 'disabled'},
    {name: 'no Auth session', change: (client, who) => client.query('delete from auth.sessions where id = $1', [who.sessionId]).then(() => undefined), view: 'no_session', auth: 'no_session'},
    {name: 'revoked', change: grantUpdate(`revoked_at = now(), revoked_by = 'seed:local:test', revoked_reason = 'test'`), view: 'revoked', auth: 'revoked'},
    {name: 'revoked for a subject mismatch', change: grantUpdate(`revoked_at = now(), revoked_by = 'system:authorization', revoked_reason = 'subject_mismatch'`), view: 'subject_mismatch', auth: 'subject_mismatch'},
    {name: 'issued 31 days ago', change: grantUpdate(`issued_at = clock_timestamp() - interval '31 days', last_used_at = clock_timestamp()`), view: 'expired', auth: 'expired'},
    {name: 'issued 30 days and 5 seconds ago', change: grantUpdate(`issued_at = clock_timestamp() - interval '30 days' - ${seconds(5)}, last_used_at = clock_timestamp()`), view: 'expired', auth: 'expired'},
    {name: 'issued 30 days minus 5 seconds ago', change: grantUpdate(`issued_at = clock_timestamp() - interval '30 days' + ${seconds(5)}, last_used_at = clock_timestamp()`), view: 'active', auth: 'active'},
    {name: 'last used 8 days ago', change: grantUpdate(`issued_at = clock_timestamp() - interval '20 days', last_used_at = clock_timestamp() - interval '8 days'`), view: 'idle', auth: 'idle'},
    {name: 'last used 7 days and 5 seconds ago', change: grantUpdate(`issued_at = clock_timestamp() - interval '20 days', last_used_at = clock_timestamp() - interval '7 days' - ${seconds(5)}`), view: 'idle', auth: 'idle'},
    {name: 'last used 7 days minus 5 seconds ago', change: grantUpdate(`issued_at = clock_timestamp() - interval '20 days', last_used_at = clock_timestamp() - interval '7 days' + ${seconds(5)}`), view: 'active', auth: 'active'},
    {name: 'issued under an older epoch', change: accountUpdate('authorization_epoch = authorization_epoch + 1'), view: 'stale_epoch', auth: 'stale_epoch'},
    {
      name: 'a second Google identity linked to the user',
      change: (client, who) =>
        client.query(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ($1, $2, '{}', 'google', now(), now())`, [`second-${randomUUID()}`, who.userId]).then(() => undefined),
      view: 'subject_mismatch',
      auth: 'subject_mismatch',
    },
    {name: 'the pinned subject replaced', change: (client, who) => client.query(`update auth.identities set provider_id = $2 where user_id = $1`, [who.userId, `replaced-${randomUUID()}`]).then(() => undefined), view: 'subject_mismatch', auth: 'subject_mismatch'},
    {name: 'no Google identity left', change: (client, who) => client.query('delete from auth.identities where user_id = $1', [who.userId]).then(() => undefined), view: 'subject_mismatch', auth: 'subject_mismatch'},
    {name: 'disabled, with no session and a revoked grant (the order of the questions)', change: async (client, who) => {
      await accountUpdate(`status = 'disabled'`)(client, who);
      await client.query('delete from auth.sessions where id = $1', [who.sessionId]);
      await grantUpdate(`revoked_at = now(), revoked_by = 'seed:local:test', revoked_reason = 'test'`)(client, who);
    }, view: 'disabled', auth: 'disabled'},
    {name: 'no session and a revoked grant: the session is asked before the grant', change: async (client, who) => {
      await client.query('delete from auth.sessions where id = $1', [who.sessionId]);
      await grantUpdate(`revoked_at = now(), revoked_by = 'seed:local:test', revoked_reason = 'test'`)(client, who);
    }, view: 'no_session', auth: 'no_session'},
    {name: 'revoked and expired: the revocation is asked first', change: grantUpdate(`issued_at = clock_timestamp() - interval '40 days', last_used_at = clock_timestamp() - interval '10 days', revoked_at = now(), revoked_by = 'seed:local:test', revoked_reason = 'test'`), view: 'revoked', auth: 'revoked'},
    {name: 'expired and idle: the age is asked before the idleness', change: grantUpdate(`issued_at = clock_timestamp() - interval '40 days', last_used_at = clock_timestamp() - interval '10 days'`), view: 'expired', auth: 'expired'},
    {name: 'idle and stale: the idleness is asked before the epoch', change: async (client, who) => {
      await grantUpdate(`issued_at = clock_timestamp() - interval '20 days', last_used_at = clock_timestamp() - interval '8 days'`)(client, who);
      await accountUpdate('authorization_epoch = authorization_epoch + 1')(client, who);
    }, view: 'idle', auth: 'idle'},
    {name: 'stale and with another subject: the epoch is asked before the subject', change: async (client, who) => {
      await accountUpdate('authorization_epoch = authorization_epoch + 1')(client, who);
      await client.query(`update auth.identities set provider_id = $2 where user_id = $1`, [who.userId, `replaced-${randomUUID()}`]);
    }, view: 'stale_epoch', auth: 'stale_epoch'},
  ];

  it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))('agrees for: %s', async (_name, scenario) => {
    const who = await member();
    await inTx(async (client) => {
      await scenario.change(client, who);
      const answer = await seen(client, who);
      expect(answer, scenario.name).toEqual({view: scenario.view, auth: scenario.auth, rows: 1});
      // The one thing they must always agree on: whether this is access.
      expect(answer.view === 'active', scenario.name).toBe(answer.auth === 'active');
    });
  });

  it('answers `tombstoned` for an Account that api.record_tombstone deleted, where authorize_session says `disabled` (the Account was disabled first): neither is access', async () => {
    const who = await member();
    await inTx(async (client) => {
      expect(await svc(client, 'select outcome from api.record_tombstone($1, $2)', ['account', who.accountId])).toEqual({outcome: 'recorded'});
      const answer = await seen(client, who);
      // The tombstone is asked first, as the tombstone guard is; the hide had also ended the Auth sessions, but `disabled` is asked before that.
      expect(answer).toEqual({view: 'tombstoned', auth: 'disabled', rows: 1});
      expect(answer.view === 'active' || answer.auth === 'active').toBe(false);
    });
  });

  it('is stricter than authorize_session for a tombstone that was recorded without the hide (a state the one writer never leaves): the view refuses, the function does not look', async () => {
    const who = await member();
    await inTx(async (client) => {
      await client.query(`insert into lifecycle.tombstones (kind, target_id, status_handle, revision) values ('account', $1, $2, 1)`, [who.accountId, randomBytes(16)]);
      expect(await seen(client, who)).toEqual({view: 'tombstoned', auth: 'active', rows: 1});
    });
  });

  it('has one row per grant, and none for a session that has no grant', async () => {
    const who = await member();
    await inTx(async (client) => {
      const extra = await addSession(client, who.userId);
      const {rows: view} = await client.query('select state from artifacts.session_authority where session_id = $1', [extra]);
      expect(view).toEqual([]);
      expect((await client.query('select state from api.authorize_session($1, $2)', [who.userId, extra])).rows[0].state).toBe('no_grant');
      // The view and the grants have the same rows, each session once.
      const {rows: counts} = await client.query(
        `select (select count(*)::int from artifacts.session_authority) as view_rows,
                (select count(distinct session_id)::int from artifacts.session_authority) as distinct_sessions,
                (select count(*)::int from identity.session_grants) as grants`,
      );
      expect(counts[0].view_rows).toBe(counts[0].grants);
      expect(counts[0].distinct_sessions).toBe(counts[0].grants);
    });
  });

  it('writes nothing: reading it leaves the last use alone (authorize_session moves it) and does not revoke a grant whose subject changed (authorize_session does)', async () => {
    const who = await member();
    await inTx(async (client) => {
      await client.query(`update identity.session_grants set issued_at = clock_timestamp() - interval '3 days', last_used_at = clock_timestamp() - interval '2 hours' where session_id = $1`, [who.sessionId]);
      const before = (await client.query('select last_used_at from identity.session_grants where session_id = $1', [who.sessionId])).rows[0].last_used_at as Date;
      expect((await client.query('select state from artifacts.session_authority where session_id = $1', [who.sessionId])).rows[0].state).toBe('active');
      expect((await client.query('select last_used_at from identity.session_grants where session_id = $1', [who.sessionId])).rows[0].last_used_at).toEqual(before);
      await client.query('select * from api.authorize_session($1, $2)', [who.userId, who.sessionId]);
      expect(((await client.query('select last_used_at from identity.session_grants where session_id = $1', [who.sessionId])).rows[0].last_used_at as Date).getTime()).toBeGreaterThan(before.getTime());

      await client.query(`update auth.identities set provider_id = $2 where user_id = $1`, [who.userId, `replaced-${randomUUID()}`]);
      expect((await client.query('select state from artifacts.session_authority where session_id = $1', [who.sessionId])).rows[0].state).toBe('subject_mismatch');
      expect((await client.query('select revoked_at, revoked_reason from identity.session_grants where session_id = $1', [who.sessionId])).rows[0]).toEqual({revoked_at: null, revoked_reason: null});
      await client.query('select * from api.authorize_session($1, $2)', [who.userId, who.sessionId]);
      expect((await client.query('select revoked_reason from identity.session_grants where session_id = $1', [who.sessionId])).rows[0]).toEqual({revoked_reason: 'subject_mismatch'});
    });
  });

  it('is readable by the gateway role with no privilege on identity, lifecycle or auth, and calls no function of those schemas', async () => {
    const who = await member();
    const epoch = await epochOf(db, who.accountId);
    await asGateway(async (client) => {
      const {rows} = await client.query('select state, account_id, epoch::int as epoch from artifacts.session_authority where session_id = $1', [who.sessionId]);
      expect(rows).toEqual([{state: 'active', account_id: who.accountId, epoch}]);
      // The gateway has no right to the tables the view reads, nor to the functions that decided the same thing before.
      for (const sql of ['select * from identity.session_grants', 'select * from identity.accounts', 'select * from auth.sessions', 'select * from auth.identities', 'select * from lifecycle.tombstones']) {
        expect((await attempt(client, null, sql)).ok, sql).toBe(false);
      }
      // Reading the view is the only way it sees any of it: a view's functions are checked against the CALLER, so the view calls none.
      expect((await client.query('select count(*)::int as n from artifacts.session_authority')).rows[0].n).toBeGreaterThanOrEqual(1);
    });
    const {rows: definition} = await db.query(`select pg_get_viewdef('artifacts.session_authority'::regclass, true) as text`);
    expect(definition[0].text).not.toMatch(/\b(?:identity|lifecycle|api|artifacts)\.\w+\s*\(/);
    expect(definition[0].text).toContain('lifecycle.tombstones');
    expect(definition[0].text).toContain('auth.identities');
  });

  it('is the owner\'s view: it is not security_invoker, and the owner is the migration role', async () => {
    const {rows} = await db.query(
      `select c.reloptions as options, pg_get_userbyid(c.relowner) as owner from pg_class c where c.oid = 'artifacts.session_authority'::regclass`,
    );
    expect(String(rows[0].options ?? '')).not.toContain('security_invoker=true');
    expect(rows[0].owner).toBe('postgres');
  });
});

describe('artifacts.instance answers the environment and instance of this database, to the gateway role alone', () => {
  it('is the one row of lifecycle.instance_identity, read as the gateway, and nobody else may read it', async () => {
    const {rows: identity} = await db.query('select environment, instance_id from lifecycle.instance_identity');
    expect(identity).toHaveLength(1);
    await asGateway(async (client) => {
      const {rows} = await client.query('select environment, instance_id from artifacts.instance');
      expect(rows).toEqual(identity);
      expect(rows[0].instance_id).toBe(env.INSTANCE_ID);
      expect(rows[0].environment).toBe('local');
    });
    expect((await db.query(`select pg_get_viewdef('artifacts.instance'::regclass, true) as text`)).rows[0].text).toMatch(/lifecycle\.instance_identity/);
    await inTx(async (client) => {
      for (const role of browserRoles) expect((await attempt(client, role, 'select * from artifacts.instance')).ok, role).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('ticket_redemptions: a token is redeemed once, by the insert of its jti', () => {
  it('redeems a ticket and a command as the gateway, and refuses a replay of either with a unique violation, whoever replays it', async () => {
    const account = randomUUID();
    const kid = uniqueKid();
    await asGateway(async (client) => {
      const ticket = newJti();
      expect((await redeem(client, {jti: ticket, kid, account})).rows).toEqual([{jti: ticket}]);
      for (const again of [{kid, account}, {kid: uniqueKid(), account: randomUUID(), kind: 'other', direction: 'download'}]) {
        const result = await attempt(client, null, redemptionSql, redemptionParams({jti: ticket, ...again}));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('23505');
      }
      const command = newJti();
      expect((await redeem(client, {jti: command, typ: 'command', kind: 'delete-staging', kid, account})).rows).toEqual([{jti: command}]);
      const replay = await attempt(client, null, redemptionSql, redemptionParams({jti: command, typ: 'command', kind: 'delete-staging', kid, account}));
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.code).toBe('23505');
      // A command and a ticket share the one key: the command's jti cannot be a ticket's either.
      const crossed = await attempt(client, null, redemptionSql, redemptionParams({jti: command, kid, account}));
      expect(crossed.ok).toBe(false);
      if (!crossed.ok) expect(crossed.code).toBe('23505');
    });
  });

  it('holds a ticket to its shape: a session and a direction, and a command to none of them', async () => {
    const account = randomUUID();
    const kid = uniqueKid();
    await asGateway(async (client) => {
      for (const [label, input] of [
        ['a ticket with no session', {kid, account, session: null}],
        ['a ticket with no direction', {kid, account, direction: null}],
        ['a ticket with another direction', {kid, account, direction: 'sideways'}],
        ['a command with a session', {kid, account, typ: 'command' as const, session: randomUUID()}],
        ['a command with a direction', {kid, account, typ: 'command' as const, direction: 'upload'}],
        ['another type', {kid, account, typ: 'token' as never}],
        ['another issuer', {kid, account, issuer: 'someone-else'}],
        ['a key ID that is not one', {kid: 'a b', account}],
        ['a key ID that is empty', {kid: '', account}],
        ['a jti that is too short', {kid, account, jti: 'short'}],
        ['a jti that is not base64url', {kid, account, jti: `${'a'.repeat(21)}+`}],
        ['a target that is neither a UUID nor a SHA-256', {kid, account, target: '../../etc/passwd'}],
        ['a target kind with capitals', {kid, account, kind: 'Staging'}],
      ] as [string, RedemptionInput][]) {
        const result = await attempt(client, null, redemptionSql, redemptionParams(input));
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('23514');
      }
      // The targets of a command that deletes a root: a SHA-256, which a ticket's target (a UUID) never is, and a command's may be either.
      expect((await redeem(client, {kid, account, typ: 'command', kind: 'delete-root', target: sha256('root')})).rows).toHaveLength(1);
    });
  });

  it('is append-only: no update, no delete, no truncate, not even by the owner', async () => {
    const account = randomUUID();
    const kid = uniqueKid();
    await inTx(async (client) => {
      const jti = (await redeem(client, {kid, account})).rows[0].jti as string;
      for (const sql of ['update artifacts.ticket_redemptions set kid = kid', 'delete from artifacts.ticket_redemptions']) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      expect((await client.query('select count(*)::int as n from artifacts.ticket_redemptions where jti = $1', [jti])).rows[0].n).toBe(1);
    });
  });

  it('refuses a key that has been revoked with N3040, as the gateway, though the gateway role cannot read the revocations', async () => {
    const account = randomUUID();
    const kid = uniqueKid();
    expect((await db.query('select outcome from api.revoke_service_key($1, $2, $3)', ['application', kid, 'compromise'])).rows).toEqual([{outcome: 'revoked'}]);
    await asGateway(async (client) => {
      expect((await attempt(client, null, 'select * from artifacts.service_key_revocations')).ok).toBe(false);
      for (const input of [{kid, account}, {kid, account, typ: 'command' as const, kind: 'delete-staging'}]) {
        const result = await attempt(client, null, redemptionSql, redemptionParams(input));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('N3040');
      }
      // Nothing was left of the refused insert, and a key that is not revoked still redeems.
      expect((await redeem(client, {kid: uniqueKid(), account})).rows).toHaveLength(1);
      // The revocation is of the issuer's key: another issuer's key of the same ID is another key.
      expect((await redeem(client, {kid, account, issuer: 'gateway'})).rows).toHaveLength(1);
    });
  });

  it('is serial with a revocation: a redemption in flight is ended by it, and a revocation in flight refuses the redemption that waits for it', async () => {
    const account = randomUUID();
    // 1. The redemption (and the handle opened with it) is first: the revocation waits for it, then ends the handle.
    {
      const kid = uniqueKid();
      const redeemer = new Client({connectionString: roleUrl()});
      await redeemer.connect();
      const revoker = await connect();
      try {
        await redeemer.query('begin');
        const jti = (await redeem(redeemer, {kid, account})).rows[0].jti as string;
        await openHandle(redeemer, {jti, kid, account});
        // (A connection's process ID is read BEFORE its statement is sent: afterwards the question would queue behind the statement that waits.)
        const revokerPid = await pidOf(revoker);
        let finished = false;
        const revocation = revoker.query('select leases, transfers, outcome from api.revoke_service_key($1, $2, $3)', ['application', kid, 'compromise']).then((result) => {
          finished = true;
          return result;
        });
        await waitingOnLock(revokerPid);
        expect(finished, 'the revocation waits for the redemption in flight').toBe(false);
        await redeemer.query('commit');
        expect((await revocation).rows[0]).toEqual({leases: 0, transfers: 1, outcome: 'revoked'});
        expect((await db.query('select ended_at is not null as ended from artifacts.transfer_handles where jti = $1', [(await db.query('select jti from artifacts.ticket_redemptions where kid = $1', [kid])).rows[0].jti])).rows).toEqual([{ended: true}]);
      } finally {
        await redeemer.query('rollback').catch(() => undefined);
        await redeemer.end();
      }
    }
    // 2. The revocation is first (not yet committed): the redemption waits for it, then finds the key revoked.
    {
      const kid = uniqueKid();
      const redeemer = new Client({connectionString: roleUrl()});
      await redeemer.connect();
      const revoker = await connect();
      try {
        await revoker.query('begin');
        await revoker.query('select * from api.revoke_service_key($1, $2, $3)', ['application', kid, 'compromise']);
        const redeemerPid = await pidOf(redeemer);
        let finished = false;
        const refused = redeem(redeemer, {kid, account}).then(
          () => ({ok: true as const}),
          (error: {code?: string}) => ({ok: false as const, code: error.code}),
        ).then((result) => {
          finished = true;
          return result;
        });
        await waitingOnLock(redeemerPid);
        expect(finished, 'the redemption waits for the revocation in flight').toBe(false);
        await revoker.query('commit');
        expect(await refused).toEqual({ok: false, code: 'N3040'});
      } finally {
        await revoker.query('rollback').catch(() => undefined);
        await redeemer.end();
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('transfer_handles: bound to a redeemed ticket, at most 30 minutes, ended once', () => {
  async function ticket(client: Client, kid = uniqueKid(), account = randomUUID()) {
    const jti = (await redeem(client, {kid, account})).rows[0].jti as string;
    return {jti, kid, account};
  }

  it('is opened by the gateway for a redeemed ticket, holding the hash of the handle and never the handle', async () => {
    await asGateway(async (client) => {
      const base = await ticket(client);
      const hash = randomBytes(32);
      expect((await openHandle(client, {...base, hash})).rows).toEqual([{hash}]);
      const {rows} = await client.query('select * from artifacts.transfer_handles where jti = $1', [base.jti]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({jti: base.jti, account_id: base.account, kid: base.kid, direction: 'upload', target_kind: 'staging', ended_at: null});
      expect(rows[0].hash).toEqual(hash);
      expect(Object.keys(rows[0]).sort()).toEqual(['account_id', 'created_at', 'direction', 'ended_at', 'epoch', 'expires_at', 'hash', 'jti', 'kid', 'session_id', 'target_id', 'target_kind']);
    });
  });

  it('holds the hash to 32 bytes, the expiry to at most 30 minutes after creation (and after it), and the shape of every other column', async () => {
    await asGateway(async (client) => {
      const base = await ticket(client);
      const now = new Date();
      const refused = async (label: string, input: Partial<HandleInput>, code = '23514') => {
        const fresh = await ticket(client);
        const result = await attempt(client, null, handleSql, handleParams({...fresh, ...input, jti: input.jti ?? fresh.jti}));
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe(code);
      };
      await refused('a hash of 31 bytes', {hash: randomBytes(31)});
      await refused('a hash of 33 bytes', {hash: randomBytes(33)});
      await refused('31 minutes', {created: now, expires: minutes(31, now)});
      await refused('30 minutes and a second', {created: now, expires: new Date(now.getTime() + 30 * 60_000 + 1000)});
      await refused('no lifetime at all', {created: now, expires: now});
      await refused('a lifetime that ends before it began', {created: now, expires: minutes(-1, now)});
      await refused('an epoch of 0', {epoch: 0});
      await refused('another direction', {direction: 'sideways'});
      await refused('a target that is a SHA-256 and not a UUID', {target: sha256('x')});
      await refused('a key ID that is not one', {kid: 'a b'});
      await refused('a ticket that was never redeemed', {jti: newJti()}, '23503');
      // Exactly 30 minutes is allowed.
      expect((await openHandle(client, {...base, created: now, expires: minutes(30, now)})).rows).toHaveLength(1);
      // One handle for each ticket, and one hash for each handle.
      const again = await attempt(client, null, handleSql, handleParams({...base}));
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.code).toBe('23505');
    });
  });

  it('is immutable but for being ended, once, and is never deleted or truncated: not by the owner either; the gateway cannot even end one', async () => {
    await inTx(async (client) => {
      const base = await ticket(client);
      await openHandle(client, base);
      const changes: Record<string, string> = {
        hash: `hash = '\\x${randomBytes(32).toString('hex')}'`,
        session_id: 'session_id = gen_random_uuid()',
        account_id: 'account_id = gen_random_uuid()',
        epoch: 'epoch = epoch + 1',
        direction: `direction = 'download'`,
        target_kind: `target_kind = 'other'`,
        target_id: 'target_id = gen_random_uuid()::text',
        kid: `kid = 'another'`,
        created_at: `created_at = created_at - interval '1 minute'`,
        expires_at: `expires_at = expires_at + interval '1 minute'`,
      };
      for (const [column, set] of Object.entries(changes)) {
        const result = await attempt(client, null, `update artifacts.transfer_handles set ${set} where jti = $1`, [base.jti]);
        expect(result.ok, column).toBe(false);
        if (!result.ok) expect(result.code, column).toBe('55000');
      }
      expect((await attempt(client, null, `update artifacts.transfer_handles set ended_at = now() where jti = $1`, [base.jti])).ok).toBe(true);
      for (const sql of [`update artifacts.transfer_handles set ended_at = now() where jti = $1`, `update artifacts.transfer_handles set ended_at = null where jti = $1`, 'delete from artifacts.transfer_handles']) {
        const result = await attempt(client, null, sql, sql.includes('$1') ? [base.jti] : []);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('staging_leases: one-way states, immutable but for their progress', () => {
  const states = ['receiving', 'complete', 'attached', 'released', 'deleted'];
  const legal = new Set(['receiving>complete', 'receiving>released', 'complete>attached', 'complete>released', 'attached>released', 'released>deleted']);

  it('goes receiving -> complete | released, complete -> attached | released, attached -> released and released -> deleted, and no other way: every pair', async () => {
    await inTx(async (client) => {
      for (const from of states) {
        for (const to of states) {
          if (from === to) continue;
          const id = await addLease(client, {account: randomUUID(), state: from, length: 1000});
          const result = await attempt(client, null, `update artifacts.staging_leases set state = $2, received_length = case when $2 in ('complete', 'attached') then length else received_length end where id = $1`, [id, to]);
          if (legal.has(`${from}>${to}`)) {
            expect(result.ok, `${from} -> ${to}`).toBe(true);
          } else {
            expect(result.ok, `${from} -> ${to}`).toBe(false);
            if (!result.ok) expect(result.code, `${from} -> ${to}`).toBe('55000');
          }
          expect((await client.query('select state from artifacts.staging_leases where id = $1', [id])).rows[0].state, `${from} -> ${to}`).toBe(legal.has(`${from}>${to}`) ? to : from);
        }
      }
    });
  });

  it('is final once deleted: not even its expiry changes; a lease that is not deleted may be renewed', async () => {
    await inTx(async (client) => {
      const live = await addLease(client, {account: randomUUID(), state: 'complete'});
      expect((await attempt(client, null, `update artifacts.staging_leases set expires_at = now() + interval '2 days' where id = $1`, [live])).ok).toBe(true);
      expect((await attempt(client, null, `update artifacts.staging_leases set state = state where id = $1`, [live])).ok).toBe(true);
      const dead = await addLease(client, {account: randomUUID(), state: 'deleted'});
      for (const sql of [`update artifacts.staging_leases set expires_at = now() + interval '2 days' where id = $1`, `update artifacts.staging_leases set state = state where id = $1`]) {
        const result = await attempt(client, null, sql, [dead]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
    });
  });

  it('cannot change what a lease is: its ID, Account, key, kind, length, SHA-256, content type and creation time', async () => {
    await inTx(async (client) => {
      const id = await addLease(client, {account: randomUUID(), kind: 'file'});
      for (const set of [
        'id = gen_random_uuid()',
        'account_id = gen_random_uuid()',
        `kid = 'another'`,
        `kind = 'picture'`,
        'length = length + 1',
        `sha256 = repeat('a', 64)`,
        `content_type = 'image/png'`,
        `created_at = created_at - interval '1 hour'`,
      ]) {
        const result = await attempt(client, null, `update artifacts.staging_leases set ${set} where id = $1`, [id]);
        expect(result.ok, set).toBe(false);
        if (!result.ok) expect(result.code, set).toBe('55000');
      }
    });
  });

  it('receives bytes only while receiving, and the count only rises', async () => {
    await inTx(async (client) => {
      const id = await addLease(client, {account: randomUUID(), length: 1000});
      const progress = (to: number) => attempt(client, null, 'update artifacts.staging_leases set received_length = $2 where id = $1', [id, to]);
      expect((await progress(400)).ok).toBe(true);
      expect((await progress(400)).ok).toBe(true);
      const backwards = await progress(399);
      expect(backwards.ok).toBe(false);
      if (!backwards.ok) expect(backwards.code).toBe('55000');
      const over = await progress(1001);
      expect(over.ok).toBe(false);
      if (!over.ok) expect(over.code).toBe('23514');
      // Complete needs every byte, and then the count is frozen.
      const early = await attempt(client, null, `update artifacts.staging_leases set state = 'complete' where id = $1`, [id]);
      expect(early.ok).toBe(false);
      if (!early.ok) expect(early.code).toBe('23514');
      expect((await attempt(client, null, `update artifacts.staging_leases set state = 'complete', received_length = 1000 where id = $1`, [id])).ok).toBe(true);
      const frozen = await progress(1000);
      expect(frozen.ok).toBe(true);
      const moved = await attempt(client, null, 'update artifacts.staging_leases set received_length = 999 where id = $1', [id]);
      expect(moved.ok).toBe(false);
      if (!moved.ok) expect(moved.code).toBe('55000');
    });
  });

  it.each([
    ['a picture over 12 MiB', {kind: 'picture', length: 12 * MiB + 1}],
    ['a picture that is not an image type', {kind: 'picture', ct: 'application/octet-stream'}],
    ['a file that is an image type', {kind: 'file', ct: 'image/png'}],
    ['a file over 100 MiB', {kind: 'file', length: 100 * MiB + 1}],
    ['a content type that is not allowed', {kind: 'file', ct: 'text/html'}],
    ['a length of 0', {length: 0}],
    ['a SHA-256 that is not hex', {sha: 'z'.repeat(64)}],
    ['a SHA-256 in capitals', {sha: 'A'.repeat(64)}],
    ['a kind that is neither', {kind: 'video'}],
    ['a state that does not exist', {state: 'lost'}],
    ['more bytes than the length', {length: 10, received: 11}],
    ['complete with bytes missing', {state: 'complete', length: 10, received: 9}],
    ['a key ID that is not one', {kid: 'a b'}],
  ] as [string, Partial<LeaseInput>][])('refuses %s', async (_label, input) => {
    await inTx(async (client) => {
      const result = await attempt(client, null, leaseSql, leaseParams({account: randomUUID(), ...input}));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('23514');
    });
  });

  it('accepts a picture of exactly 12 MiB of each type, and a file of exactly 100 MiB', async () => {
    await inTx(async (client) => {
      for (const ct of ['image/jpeg', 'image/png', 'image/webp']) expect(await addLease(client, {account: randomUUID(), kind: 'picture', length: 12 * MiB, ct})).toMatch(uuidPattern);
      expect(await addLease(client, {account: randomUUID(), kind: 'file', length: 100 * MiB})).toMatch(uuidPattern);
    });
  });

  it('takes an upload ID once: a second lease with it, for anyone, is a unique violation that leaves the first alone; and is never deleted or truncated', async () => {
    await inTx(async (client) => {
      const id = await addLease(client, {account: randomUUID(), length: 123});
      const other = await attempt(client, null, leaseSql, leaseParams({id, account: randomUUID(), length: 456}));
      expect(other.ok).toBe(false);
      if (!other.ok) expect(other.code).toBe('23505');
      expect((await client.query('select length::int as length from artifacts.staging_leases where id = $1', [id])).rows).toEqual([{length: 123}]);
      for (const sql of ['delete from artifacts.staging_leases']) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.revoke_service_key: a compromised key ends everything opened under it, at once', () => {
  /** Handles and leases opened under `kid` (and some under another key, which a revocation must leave alone), written as the owner in the open transaction. */
  async function openedUnder(client: Client, kid: string) {
    const account = randomUUID();
    const other = uniqueKid();
    const handle = async (key: string, ended = false) => {
      const jti = (await redeem(client, {kid: key, account})).rows[0].jti as string;
      await openHandle(client, {jti, kid: key, account});
      if (ended) await client.query('update artifacts.transfer_handles set ended_at = clock_timestamp() where jti = $1', [jti]);
      return jti;
    };
    const handles = {open: [await handle(kid), await handle(kid)], ended: await handle(kid, true), other: await handle(other)};
    const leases = {
      receiving: await addLease(client, {account, kid, state: 'receiving'}),
      complete: await addLease(client, {account, kid, state: 'complete'}),
      attached: await addLease(client, {account, kid, state: 'attached'}),
      released: await addLease(client, {account, kid, state: 'released'}),
      deleted: await addLease(client, {account, kid, state: 'deleted'}),
      other: await addLease(client, {account, kid: other, state: 'receiving'}),
    };
    return {account, other, handles, leases};
  }
  const states = async (client: Client, leases: Record<string, string>) =>
    Object.fromEntries(await Promise.all(Object.entries(leases).map(async ([name, id]) => [name, (await client.query('select state from artifacts.staging_leases where id = $1', [id])).rows[0].state])));
  const endedAt = async (client: Client, jti: string) => (await client.query('select ended_at from artifacts.transfer_handles where jti = $1', [jti])).rows[0].ended_at as Date | null;

  it('records the revocation and, in the same transaction, ends every open transfer and every receiving or complete lease of the key, counting each, and nothing else', async () => {
    const kid = uniqueKid();
    await inTx(async (client) => {
      const opened = await openedUnder(client, kid);
      expect(await svc(client, 'select outcome, leases, transfers from api.revoke_service_key($1, $2, $3)', ['application', kid, 'compromise'])).toEqual({outcome: 'revoked', leases: 2, transfers: 2});
      for (const jti of opened.handles.open) expect(await endedAt(client, jti), 'an open transfer is ended').toBeInstanceOf(Date);
      expect(await endedAt(client, opened.handles.ended), 'an ended one stays as it was ended').toBeInstanceOf(Date);
      expect(await endedAt(client, opened.handles.other), 'another key\'s transfer is left alone').toBeNull();
      expect(await states(client, opened.leases)).toEqual({receiving: 'released', complete: 'released', attached: 'attached', released: 'released', deleted: 'deleted', other: 'receiving'});
      expect((await client.query('select issuer, kid, reason, revoked_at is not null as stamped from artifacts.service_key_revocations where kid = $1', [kid])).rows).toEqual([{issuer: 'application', kid, reason: 'compromise', stamped: true}]);
      // A repeat records nothing new, ends what is still open (nothing now) and says so.
      expect(await svc(client, 'select outcome, leases, transfers from api.revoke_service_key($1, $2, $3)', ['application', kid, 'compromise'])).toEqual({outcome: 'exists', leases: 0, transfers: 0});
      expect((await client.query('select count(*)::int as n from artifacts.service_key_revocations where kid = $1', [kid])).rows[0].n).toBe(1);
      // A ticket or a command under it is refused from this moment, in the owner's own statements too; another key still redeems.
      for (const input of [{kid, account: opened.account}, {kid, account: opened.account, typ: 'command' as const, kind: 'delete-root', target: sha256('r')}]) {
        const result = await attempt(client, null, redemptionSql, redemptionParams(input));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe('N3040');
      }
      expect((await redeem(client, {kid: opened.other, account: opened.account})).rows).toHaveLength(1);
    });
    // It was all one transaction: with that rolled back, neither the revocation nor anything it ended is left.
    expect((await db.query('select count(*)::int as n from artifacts.service_key_revocations where kid = $1', [kid])).rows[0].n).toBe(0);
  });

  it('ends only the application\'s: a revoked key of another issuer is recorded and ends nothing, even with the same key ID', async () => {
    const kid = uniqueKid();
    await inTx(async (client) => {
      const opened = await openedUnder(client, kid);
      for (const issuer of ['gateway', 'cad-worker', 'engine-worker', 'backup-service', 'heartbeat']) {
        expect(await svc(client, 'select outcome, leases, transfers from api.revoke_service_key($1, $2, $3)', [issuer, kid, 'compromise']), issuer).toEqual({outcome: 'revoked', leases: 0, transfers: 0});
      }
      expect(await endedAt(client, opened.handles.open[0])).toBeNull();
      expect((await states(client, opened.leases)).receiving).toBe('receiving');
      // ... and the application's own key of that ID is not revoked by it: it still redeems.
      expect((await redeem(client, {kid, account: opened.account})).rows).toHaveLength(1);
    });
  });

  it.each([
    ['an issuer that does not exist', ['someone', 'k1', 'compromise']],
    ['no issuer', [null, 'k1', 'compromise']],
    ['an issuer in capitals', ['Application', 'k1', 'compromise']],
    ['a key ID with a space', ['application', 'a b', 'compromise']],
    ['an empty key ID', ['application', '', 'compromise']],
    ['no key ID', ['application', null, 'compromise']],
    ['a key ID that starts with a dot', ['application', '.k', 'compromise']],
    ['a key ID of 65 characters', ['application', 'k'.repeat(65), 'compromise']],
    ['a reason in capitals', ['application', 'k1', 'Compromise']],
    ['an empty reason', ['application', 'k1', '']],
    ['no reason', ['application', 'k1', null]],
    ['a reason that is a sentence', ['application', 'k1', 'it was seen in a log']],
    ['a reason of 41 characters', ['application', 'k1', 'r'.repeat(41)]],
  ] as [string, unknown[]][])('refuses %s with the stable invalid-argument code, and records nothing', async (_label, params) => {
    await inTx(async (client) => {
      const result = await attempt(client, 'service_role', 'select * from api.revoke_service_key($1, $2, $3)', params);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
    });
  });

  it('is the service role\'s alone: anon and authenticated are refused, and so is the gateway role', async () => {
    await inTx(async (client) => {
      for (const role of ['anon', 'authenticated']) {
        const result = await attempt(client, role, `select * from api.revoke_service_key('application', 'k-denied', 'compromise')`);
        expect(result.ok, role).toBe(false);
      }
      expect((await attempt(client, 'service_role', `select * from api.revoke_service_key('application', $1, 'compromise')`, [uniqueKid()])).ok).toBe(true);
    });
  });

  it('is called as the application calls it: the typed call, over REST, and again for a key already revoked', async () => {
    const kid = uniqueKid();
    expect(await revokeServiceKey({issuer: 'application', kid, reason: 'compromise'}, {env})).toEqual({outcome: 'revoked', leases: 0, transfers: 0});
    expect(await revokeServiceKey({issuer: 'application', kid, reason: 'compromise'}, {env})).toEqual({outcome: 'exists', leases: 0, transfers: 0});
    await expect(revokeServiceKey({issuer: 'nobody', kid, reason: 'compromise'}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(revokeServiceKey({issuer: 'application', kid: 'a b', reason: 'compromise'}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(revokeServiceKey({issuer: 'application', kid, reason: 'Because'}, {env})).rejects.toBeInstanceOf(TypeError);
  });

  it('is append-only: a revocation is never updated, deleted or lifted', async () => {
    const kid = uniqueKid();
    await inTx(async (client) => {
      await svc(client, 'select * from api.revoke_service_key($1, $2, $3)', ['application', kid, 'compromise']);
      for (const sql of ['update artifacts.service_key_revocations set reason = $1', 'delete from artifacts.service_key_revocations where kid = $1']) {
        const result = await attempt(client, null, sql, [sql.startsWith('update') ? 'other' : kid]);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.list_expired_staging: what the hourly cleanup removes', () => {
  // The leases of these cases are written far in the past (the year 2000 and after), so that they are the OLDEST in the list whatever other rows the
  // shared stack holds, and in a transaction that is rolled back.
  const longAgo = (index: number) => new Date(Date.UTC(2000, 0, 1 + index));
  const list = async (client: Client, limit?: number) => {
    const row = limit === undefined ? await svc(client, 'select leases from api.list_expired_staging()') : await svc(client, 'select leases from api.list_expired_staging($1)', [limit]);
    return row.leases as {upload_id: string; account_id: string}[];
  };

  /** Moves every lease the cleanup would list out of the way, in the open transaction only, so the list holds what the case wrote and nothing the shared stack left. */
  const clearTheWay = async (client: Client) => {
    await client.query(`update artifacts.staging_leases set state = 'released' where state <> 'deleted' and state <> 'released' and expires_at <= clock_timestamp()`);
    await client.query(`update artifacts.staging_leases set state = 'deleted' where state = 'released'`);
  };

  it('names expired leases of any state but deleted, and released ones whatever their expiry, oldest first, as {upload_id, account_id}', async () => {
    await inTx(async (client) => {
      await clearTheWay(client);
      const account = randomUUID();
      const expiredReceiving = await addLease(client, {account, state: 'receiving', expires: longAgo(0)});
      const expiredComplete = await addLease(client, {account, state: 'complete', expires: longAgo(1)});
      const expiredAttached = await addLease(client, {account, state: 'attached', expires: longAgo(2)});
      const releasedLater = await addLease(client, {account, state: 'released', expires: new Date(Date.now() + 24 * 3600_000)});
      const expiredReleased = await addLease(client, {account, state: 'released', expires: longAgo(3)});
      await addLease(client, {account, state: 'deleted', expires: longAgo(4)});
      await addLease(client, {account, state: 'receiving'});
      await addLease(client, {account, state: 'complete'});
      await addLease(client, {account, state: 'attached'});
      const named = await list(client, 50);
      const mine = named.filter((lease) => lease.account_id === account);
      // Oldest first by expiry: the four that expired long ago, and then the released lease whose expiry is still ahead of it. No active lease, and
      // no deleted one, is named.
      expect(named.map((lease) => lease.upload_id)).toEqual([expiredReceiving, expiredComplete, expiredAttached, expiredReleased, releasedLater]);
      expect(mine).toHaveLength(5);
      for (const lease of named) expect(Object.keys(lease).sort()).toEqual(['account_id', 'upload_id']);
    });
  });

  it('no longer names a lease that was renewed meanwhile, or one that was deleted', async () => {
    await inTx(async (client) => {
      const account = randomUUID();
      const lapsed = await addLease(client, {account, state: 'receiving', expires: longAgo(10)});
      expect((await list(client, 50)).map((lease) => lease.upload_id)).toContain(lapsed);
      await client.query(`update artifacts.staging_leases set expires_at = clock_timestamp() + interval '24 hours' where id = $1`, [lapsed]);
      expect((await list(client, 50)).map((lease) => lease.upload_id)).not.toContain(lapsed);
      await client.query(`update artifacts.staging_leases set expires_at = $2 where id = $1`, [lapsed, longAgo(10)]);
      expect((await list(client, 50)).map((lease) => lease.upload_id)).toContain(lapsed);
      await client.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [lapsed]);
      await client.query(`update artifacts.staging_leases set state = 'deleted' where id = $1`, [lapsed]);
      expect((await list(client, 50)).map((lease) => lease.upload_id)).not.toContain(lapsed);
    });
  });

  it('lists at most the limit (1 to 50, and 50 by default) and refuses any other', async () => {
    await inTx(async (client) => {
      await clearTheWay(client);
      const account = randomUUID();
      const made = [];
      for (let index = 0; index < 5; index += 1) made.push(await addLease(client, {account, state: 'released', expires: longAgo(20 + index)}));
      expect((await list(client, 1)).map((lease) => lease.upload_id)).toEqual(made.slice(0, 1));
      expect((await list(client, 3)).map((lease) => lease.upload_id)).toEqual(made.slice(0, 3));
      expect((await list(client)).map((lease) => lease.upload_id)).toEqual(made);
      // (The default is 50, and it is a ceiling: with sixty to remove, a firing names fifty.)
      for (let index = 0; index < 60; index += 1) await addLease(client, {account, state: 'released', expires: longAgo(100 + index)});
      expect((await list(client)).length).toBe(50);
      expect((await list(client, 50)).length).toBe(50);
      for (const limit of [0, 51, -1, null]) {
        const result = await attempt(client, 'service_role', 'select * from api.list_expired_staging($1)', [limit]);
        expect(result.ok, String(limit)).toBe(false);
        if (!result.ok) expect(result.code, String(limit)).toBe('22023');
      }
    });
  });

  it('answers an empty list as [] and never null', async () => {
    await inTx(async (client) => {
      // Every lease the stack holds that the cleanup would list is moved out of the way, in this transaction only.
      await client.query(`update artifacts.staging_leases set state = 'released' where state <> 'deleted' and state <> 'released' and expires_at <= clock_timestamp()`);
      await client.query(`update artifacts.staging_leases set state = 'deleted' where state = 'released'`);
      expect(await list(client, 50)).toEqual([]);
    });
  });

  it('is the service role\'s alone, and reads only: nothing it lists changes', async () => {
    await inTx(async (client) => {
      const account = randomUUID();
      const id = await addLease(client, {account, state: 'receiving', expires: longAgo(30)});
      for (const role of ['anon', 'authenticated']) expect((await attempt(client, role, 'select * from api.list_expired_staging(5)')).ok, role).toBe(false);
      await list(client, 50);
      expect((await client.query('select state from artifacts.staging_leases where id = $1', [id])).rows).toEqual([{state: 'receiving'}]);
      expect((await db.query(`select p.provolatile as volatility from pg_proc p where p.oid = 'api.list_expired_staging(integer)'::regprocedure`)).rows).toEqual([{volatility: 's'}]);
    });
  });

  it('is read as the application reads it: the typed call returns opaque IDs, oldest first', async () => {
    const account = randomUUID();
    const first = await addLease(db, {account, state: 'released', expires: longAgo(40)});
    left.push(first);
    const second = await addLease(db, {account, state: 'receiving', expires: longAgo(41)});
    left.push(second);
    const named = await listExpiredStaging({limit: 50}, {env});
    expect(named.length).toBeLessThanOrEqual(50);
    const mine = named.filter((lease) => lease.accountId === account);
    // 41 days after the epoch of the year 2000 is later than 40; both are far older than anything a real run leaves.
    expect(mine).toEqual([{uploadId: first, accountId: account}, {uploadId: second, accountId: account}]);
    await expect(listExpiredStaging({limit: 0}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(listExpiredStaging({limit: 51}, {env})).rejects.toBeInstanceOf(TypeError);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('artifacts.publish_attachment: the one writer of a manifest', () => {
  type Lease = {id: string; kind: 'picture' | 'file'; length: number; sha: string; ct: string};
  async function completeLease(client: Client, who: Member, options: {kind?: 'picture' | 'file'; length?: number; expires?: Date} = {}): Promise<Lease> {
    const kind = options.kind ?? 'file';
    const length = options.length ?? 4096;
    const sha = randomBytes(32).toString('hex');
    const ct = kind === 'picture' ? 'image/png' : 'application/octet-stream';
    const id = await addLease(client, {account: who.accountId, kind, length, sha, ct, state: 'complete', expires: options.expires});
    return {id, kind, length, sha, ct};
  }
  const bodyOf = (who: Member, lease: Lease, transform = 'none') => ({id: lease.id, scope: who.accountId, activity: `upload:${transform}`, kind: lease.kind, digest: lease.sha, length: lease.length, serialization: 1, children: [] as unknown[]});
  type Call = {epoch?: number; transform?: string; body?: string; root?: string; account?: string; upload?: string};
  /** The statement the gateway sends: the manifest body of this lease, serialized as RFC 8785, and its SHA-256 as the root. */
  async function publish(client: Client, who: Member, lease: Lease, call: Call = {}) {
    const text = call.body ?? canonicalize(bodyOf(who, lease, call.transform ?? 'none'));
    const root = call.root ?? sha256(text);
    const {rows} = await client.query('select outcome, root, manifest_id from artifacts.publish_attachment($1, $2, $3, $4, $5, $6)', [
      call.account ?? who.accountId,
      call.epoch ?? (await epochOf(db, who.accountId)),
      call.upload ?? lease.id,
      call.transform ?? 'none',
      root,
      text,
    ]);
    return {...rows[0], text, expected: root} as {outcome: string; root: string | null; manifest_id: string | null; text: string; expected: string};
  }
  const manifestsOf = async (client: Client, upload: string) => (await client.query('select * from artifacts.manifests where upload_id = $1', [upload])).rows;
  const stateOfLease = async (client: Client, id: string) => (await client.query('select state from artifacts.staging_leases where id = $1', [id])).rows[0].state as string;

  it('publishes the manifest of a complete lease once: the canonical body, its SHA-256 as the root, the lease attached', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who);
      const answer = await publish(client, who, lease);
      expect(answer).toMatchObject({outcome: 'published', root: answer.expected, manifest_id: lease.id});
      const [manifest, ...more] = await manifestsOf(client, lease.id);
      expect(more).toEqual([]);
      expect(manifest).toMatchObject({root: answer.expected, id: lease.id, account_id: who.accountId, upload_id: lease.id, kind: 'file', digest: lease.sha, length: String(lease.length), serialization: 1, activity: 'upload:none', body: answer.text});
      // The root IS the SHA-256 of the body's bytes, and the body is the canonical serialization of what it says.
      expect(manifest.root).toBe(sha256(manifest.body));
      expect(manifest.body).toBe(canonicalize(JSON.parse(manifest.body)));
      expect(JSON.parse(manifest.body)).toEqual({activity: 'upload:none', children: [], digest: lease.sha, id: lease.id, kind: 'file', length: lease.length, scope: who.accountId, serialization: 1});
      expect(await stateOfLease(client, lease.id)).toBe('attached');
    });
  });

  it('answers a repeat with the same manifest and writes nothing: one manifest for an upload', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who, {kind: 'picture', length: 2048});
      const first = await publish(client, who, lease);
      const again = await publish(client, who, lease);
      expect(first.outcome).toBe('published');
      expect(again).toMatchObject({outcome: 'exists', root: first.root, manifest_id: first.manifest_id});
      expect(await manifestsOf(client, lease.id)).toHaveLength(1);
      // Another root for the same upload is not a repeat: it is refused, and the first manifest stands.
      const other = await publish(client, who, lease, {body: canonicalize({...bodyOf(who, lease), length: 1})});
      expect(other).toMatchObject({outcome: 'root_mismatch', root: first.root});
      expect((await manifestsOf(client, lease.id)).map((row) => row.root)).toEqual([first.root]);
    });
  });

  it.each([
    ['a disabled Account', async (client: Client, who: Member) => void (await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [who.accountId])), undefined],
    ['a tombstoned Account', async (client: Client, who: Member) => void (await client.query(`select * from api.record_tombstone('account', $1)`, [who.accountId])), 1],
    ['an Account whose epoch has risen since the operation began', async (client: Client, who: Member) => void (await client.query('update identity.accounts set authorization_epoch = authorization_epoch + 1 where id = $1', [who.accountId])), 1],
  ])('is denied, writing nothing, for %s', async (_label, change, epoch) => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who);
      await change(client, who);
      const answer = await publish(client, who, lease, {epoch: epoch ?? 1});
      expect(answer.outcome).toBe('denied');
      expect(answer.root).toBeNull();
      expect(await manifestsOf(client, lease.id)).toEqual([]);
      expect(await stateOfLease(client, lease.id)).toBe('complete');
    });
  });

  it('is denied for an epoch the operation did not start under, in either direction, and refuses an epoch that is no epoch', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who);
      const current = await epochOf(db, who.accountId);
      expect((await publish(client, who, lease, {epoch: current + 1})).outcome).toBe('denied');
      expect(await manifestsOf(client, lease.id)).toEqual([]);
      const refused = await attempt(client, null, `select * from artifacts.publish_attachment($1, 0, $2, 'none', repeat('a', 64), '{}')`, [who.accountId, lease.id]);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe('22023');
    });
  });

  it('answers not_found for another Account\'s lease and for none, touching neither', async () => {
    const owner = await member();
    const stranger = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, owner);
      // The stranger names the owner's upload: it is not found for them, exactly as an upload that does not exist.
      const foreign = await publish(client, stranger, lease, {body: canonicalize({...bodyOf(stranger, lease)})});
      expect(foreign.outcome).toBe('not_found');
      const none = await publish(client, owner, lease, {upload: randomUUID()});
      expect(none.outcome).toBe('not_found');
      expect(await manifestsOf(client, lease.id)).toEqual([]);
      expect(await stateOfLease(client, lease.id)).toBe('complete');
    });
  });

  it.each(['receiving', 'released', 'deleted'])('answers not_complete for a lease that is %s', async (state) => {
    const who = await member();
    await inTx(async (client) => {
      const length = 4096;
      const sha = randomBytes(32).toString('hex');
      const id = await addLease(client, {account: who.accountId, kind: 'file', length, sha, state});
      const lease: Lease = {id, kind: 'file', length, sha, ct: 'application/octet-stream'};
      expect((await publish(client, who, lease)).outcome).toBe('not_complete');
      expect(await manifestsOf(client, id)).toEqual([]);
      expect(await stateOfLease(client, id)).toBe(state);
    });
  });

  it('answers not_complete for an attached lease that somehow holds no manifest (the lease says attached, the manifest table says none)', async () => {
    const who = await member();
    await inTx(async (client) => {
      const id = await addLease(client, {account: who.accountId, kind: 'file', length: 10, state: 'attached'});
      const lease: Lease = {id, kind: 'file', length: 10, sha: 'a'.repeat(64), ct: 'application/octet-stream'};
      expect((await publish(client, who, lease)).outcome).toBe('not_complete');
    });
  });

  it('answers transform_unknown for a transform that is not registered, and `none` is the one that is', async () => {
    const who = await member();
    await inTx(async (client) => {
      expect((await client.query('select name from artifacts.attachment_transforms order by 1')).rows).toEqual([{name: 'none'}]);
      const lease = await completeLease(client, who);
      for (const transform of ['strip-metadata', 'resize', 'none2']) {
        expect((await publish(client, who, lease, {transform})).outcome, transform).toBe('transform_unknown');
      }
      expect(await manifestsOf(client, lease.id)).toEqual([]);
      expect(await stateOfLease(client, lease.id)).toBe('complete');
      // A transform that is registered is accepted, with the activity that says which one.
      await client.query(`insert into artifacts.attachment_transforms (name) values ('strip-metadata')`);
      const answer = await publish(client, who, lease, {transform: 'strip-metadata'});
      expect(answer.outcome).toBe('published');
      expect((await manifestsOf(client, lease.id))[0].activity).toBe('upload:strip-metadata');
    });
  });

  it('answers root_mismatch when the root is not the SHA-256 of the body, whatever it is instead', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who);
      const text = canonicalize(bodyOf(who, lease));
      for (const root of [sha256('something else'), sha256(`${text} `), sha256(JSON.stringify(bodyOf(who, lease))), '0'.repeat(64), sha256(text).toUpperCase().replace(/[A-F]/g, 'a').slice(0, 63) + 'b']) {
        if (root === sha256(text)) continue;
        const answer = await publish(client, who, lease, {root});
        expect(answer.outcome, root).toBe('root_mismatch');
      }
      expect(await manifestsOf(client, lease.id)).toEqual([]);
      expect(await stateOfLease(client, lease.id)).toBe('complete');
    });
  });

  it('answers body_mismatch, writing nothing, for a body that is not exactly the manifest of this lease: every field, an extra member, a missing one, not an object, not JSON', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who);
      const stranger = randomUUID();
      const good = bodyOf(who, lease);
      const variants: [string, string][] = [
        ['another activity', canonicalize({...good, activity: 'upload:other'})],
        ['a child', canonicalize({...good, children: [{id: randomUUID()}]})],
        ['another digest', canonicalize({...good, digest: sha256('other')})],
        ['an upper-case digest', canonicalize({...good, digest: lease.sha.toUpperCase()})],
        ['another ID', canonicalize({...good, id: randomUUID()})],
        ['another kind', canonicalize({...good, kind: 'picture'})],
        ['another length', canonicalize({...good, length: lease.length + 1})],
        ['the length as text', canonicalize({...good, length: String(lease.length)})],
        ['another scope', canonicalize({...good, scope: stranger})],
        ['another serialization', canonicalize({...good, serialization: 2})],
        ['an extra member', canonicalize({...good, extra: true})],
        ['a missing activity', canonicalize(Object.fromEntries(Object.entries(good).filter(([name]) => name !== 'activity')))],
        ['a missing children', canonicalize(Object.fromEntries(Object.entries(good).filter(([name]) => name !== 'children')))],
        ['an array', '[]'],
        ['a string', '"x"'],
        ['null', 'null'],
        ['not JSON', 'not json'],
      ];
      for (const [label, body] of variants) {
        const answer = await publish(client, who, lease, {body});
        expect(answer.outcome, label).toBe('body_mismatch');
      }
      expect(await manifestsOf(client, lease.id)).toEqual([]);
      expect(await stateOfLease(client, lease.id)).toBe('complete');
      // The same lease with the right body, afterwards, still publishes.
      expect((await publish(client, who, lease)).outcome).toBe('published');
    });
  });

  it('accepts the gateway\'s own body, byte for byte, for every kind, a range of lengths and a registered transform (the canonical text the function builds is the one RFC 8785 gives)', async () => {
    const who = await member();
    await inTx(async (client) => {
      for (const [kind, length] of [['picture', 1], ['picture', 4096], ['picture', 12 * 1024 * 1024], ['file', 1], ['file', 1_000_000_007 % (100 * 1024 * 1024)], ['file', 100 * 1024 * 1024]] as const) {
        const lease = await completeLease(client, who, {kind, length});
        const text = canonicalize(bodyOf(who, lease));
        // The one text the function accepts is the one the gateway's canonicalizer writes: compact, members in RFC 8785 order, integers plain.
        expect(text).toBe(`{"activity":"upload:none","children":[],"digest":"${lease.sha}","id":"${lease.id}","kind":"${kind}","length":${length},"scope":"${who.accountId}","serialization":1}`);
        const answer = await publish(client, who, lease, {body: text});
        expect(answer, `${kind} ${length}`).toMatchObject({outcome: 'published', root: sha256(text)});
      }
    });
  });

  it('refuses, writing nothing, a body that says the same thing in another spelling: whitespace, reordered members, a repeated member, an escape, a number spelt another way', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who);
      const good = bodyOf(who, lease);
      const canonical = canonicalize(good);
      // An escaped letter is the same string to a JSON parser, and not the same bytes: it is built without writing the escape in this source.
      const escaped = canonical.replace('"kind":"file"', `"kind":"fi${String.fromCharCode(92)}u006ce"`);
      const variants: [string, string][] = [
        ['whitespace between tokens', canonical.replaceAll(',', ', ').replaceAll(':', ': ')],
        ['indentation and newlines', JSON.stringify(JSON.parse(canonical), null, 2)],
        ['a trailing newline', `${canonical}\n`],
        ['a leading space', ` ${canonical}`],
        ['members in insertion order (not RFC 8785 order)', JSON.stringify(good)],
        ['members in reverse order', JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(canonical)).reverse()))],
        ['a repeated member', canonical.replace('"serialization":1}', '"serialization":1,"serialization":1}')],
        ['a repeated member whose last value is the right one', canonical.replace('"length":', '"length":0,"length":')],
        ['an escaped letter', escaped],
        ['the length as 1.0', canonical.replace(`"length":${lease.length}`, `"length":${lease.length}.0`)],
        ['the length with an exponent', canonical.replace(`"length":${lease.length}`, `"length":${lease.length}e0`)],
        ['the serialization as 1.0', canonical.replace('"serialization":1', '"serialization":1.0')],
        ['an upper-case digest', canonical.replace(lease.sha, lease.sha.toUpperCase())],
      ];
      for (const [label, body] of variants) {
        // Each is a body whose root is its own SHA-256, so only the text itself can be what is refused.
        expect(body, label).not.toBe(canonical);
        const answer = await publish(client, who, lease, {body});
        expect(answer.outcome, label).toBe('body_mismatch');
      }
      expect(await manifestsOf(client, lease.id)).toEqual([]);
      expect(await stateOfLease(client, lease.id)).toBe('complete');
      // The canonical text, afterwards, publishes.
      expect((await publish(client, who, lease, {body: canonical})).outcome).toBe('published');
    });
  });

  it('answers `expired` for a complete lease whose time has run out, writing nothing, and still answers `exists` for a lease that was attached before it ran out', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lapsed = await completeLease(client, who, {expires: new Date(Date.now() - 60_000)});
      const answer = await publish(client, who, lapsed);
      expect(answer).toMatchObject({outcome: 'expired', root: null, manifest_id: null});
      expect(await manifestsOf(client, lapsed.id)).toEqual([]);
      expect(await stateOfLease(client, lapsed.id)).toBe('complete');
      // The lease may be renewed by activity (an expiry only moves with the lease's progress), and then it publishes.
      await client.query(`update artifacts.staging_leases set expires_at = now() + interval '1 hour' where id = $1`, [lapsed.id]);
      expect((await publish(client, who, lapsed)).outcome).toBe('published');
      // A repeat is answered from the manifest, whatever the lease's expiry has become: the repeat of an attachment is not a new attachment.
      await client.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [lapsed.id]);
      expect(await publish(client, who, lapsed)).toMatchObject({outcome: 'exists'});
      expect(await manifestsOf(client, lapsed.id)).toHaveLength(1);
      // The order of the checks: a lease that is not complete is `not_complete` even when it has also expired.
      const receiving = await addLease(client, {account: who.accountId, state: 'receiving', expires: new Date(Date.now() - 60_000)});
      const text = canonicalize({...bodyOf(who, lapsed), id: receiving});
      const notComplete = await client.query('select outcome from artifacts.publish_attachment($1, $2, $3, $4, $5, $6)', [who.accountId, await epochOf(db, who.accountId), receiving, 'none', sha256(text), text]);
      expect(notComplete.rows[0].outcome).toBe('not_complete');
    });
  });

  it('refuses arguments that are not arguments with the stable invalid-argument code', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who);
      const text = canonicalize(bodyOf(who, lease));
      const good = [who.accountId, 1, lease.id, 'none', sha256(text), text];
      for (const [label, index, value] of [
        ['no Account', 0, null],
        ['no epoch', 1, null],
        ['no upload', 2, null],
        ['no transform', 3, null],
        ['a transform with capitals', 3, 'None'],
        ['a transform that is a path', 3, '../none'],
        ['no root', 4, null],
        ['a root that is not hex', 4, 'z'.repeat(64)],
        ['a root of 63 characters', 4, 'a'.repeat(63)],
        ['no body', 5, null],
        ['a body of over 4 KiB', 5, 'x'.repeat(4097)],
      ] as [string, number, unknown][]) {
        const params = [...good];
        params[index] = value as never;
        const result = await attempt(client, null, 'select * from artifacts.publish_attachment($1, $2, $3, $4, $5, $6)', params);
        expect(result.ok, label).toBe(false);
        if (!result.ok) expect(result.code, label).toBe('22023');
      }
      expect(await manifestsOf(client, lease.id)).toEqual([]);
    });
  });

  it('keeps manifests immutable and append-only, one for each upload, and the root the SHA-256 of the body, by the table itself', async () => {
    const who = await member();
    await inTx(async (client) => {
      const lease = await completeLease(client, who);
      const answer = await publish(client, who, lease);
      for (const sql of ['update artifacts.manifests set kind = kind', 'update artifacts.manifests set body = body', 'delete from artifacts.manifests']) {
        const result = await attempt(client, null, sql);
        expect(result.ok, sql).toBe(false);
        if (!result.ok) expect(result.code, sql).toBe('55000');
      }
      const insert = `insert into artifacts.manifests (root, id, account_id, upload_id, kind, digest, length, serialization, activity, body) values ($1, $2, $3, $4, 'file', $5, 1, 1, 'upload:none', $6)`;
      // A second manifest for the same upload, or with the same ID: a unique violation.
      const body = canonicalize({id: 'x', other: 1});
      const sameUpload = await attempt(client, null, insert, [sha256(body), randomUUID(), who.accountId, lease.id, sha256('d'), body]);
      expect(sameUpload.ok).toBe(false);
      if (!sameUpload.ok) expect(sameUpload.code).toBe('23505');
      const sameId = await attempt(client, null, insert, [sha256(body), lease.id, who.accountId, randomUUID(), sha256('d'), body]);
      expect(sameId.ok).toBe(false);
      if (!sameId.ok) expect(sameId.code).toBe('23505');
      // A root that is not the SHA-256 of the body cannot be written, even by the owner, whatever function does not call it.
      const wrongRoot = await attempt(client, null, insert, [sha256('not the body'), randomUUID(), who.accountId, randomUUID(), sha256('d'), body]);
      expect(wrongRoot.ok).toBe(false);
      if (!wrongRoot.ok) expect(wrongRoot.code).toBe('23514');
      expect(await manifestsOf(client, lease.id)).toHaveLength(1);
      expect(answer.outcome).toBe('published');
      // And the one root cannot name two manifests.
      const sameRoot = await attempt(client, null, insert, [answer.expected, randomUUID(), who.accountId, randomUUID(), sha256('d'), answer.text]);
      expect(sameRoot.ok).toBe(false);
      if (!sameRoot.ok) expect(sameRoot.code).toBe('23505');
    });
  });

  it('can be called by the gateway role over a committed lease, as the gateway calls it, and by no other role', async () => {
    const who = await member();
    const lease = await completeLease(db, who);
    left.push(lease.id);
    await asGateway(async (client) => {
      const answer = await publish(client, who, lease);
      expect(answer.outcome).toBe('published');
    });
    // That was rolled back with the transaction: the lease is complete and no manifest exists.
    expect(await stateOfLease(db, lease.id)).toBe('complete');
    expect(await manifestsOf(db, lease.id)).toEqual([]);
  });

  describe('holds the Account\'s row while it writes, so a disable cannot commit between the check and the write (two real connections)', () => {
    it('the publication first: the disable waits for it, and the manifest stands', async () => {
      const who = await member();
      const lease = await completeLease(db, who);
      left.push(lease.id);
      const publisher = await connect();
      const disabler = await connect();
      try {
        await publisher.query('begin');
        expect((await publish(publisher, who, lease)).outcome).toBe('published');
        const disablerPid = await pidOf(disabler);
        let finished = false;
        const disabling = disabler.query(`update identity.accounts set status = 'disabled' where id = $1`, [who.accountId]).then(() => {
          finished = true;
        });
        await waitingOnLock(disablerPid);
        expect(finished, 'the disable waits for the publication that holds the Account').toBe(false);
        await publisher.query('commit');
        await disabling;
        expect(await manifestsOf(db, lease.id)).toHaveLength(1);
        expect((await db.query('select status from identity.accounts where id = $1', [who.accountId])).rows).toEqual([{status: 'disabled'}]);
      } finally {
        await publisher.query('rollback').catch(() => undefined);
      }
    });

    it('the disable first: the publication waits for it, is denied once it commits, and writes nothing', async () => {
      const who = await member();
      const lease = await completeLease(db, who);
      left.push(lease.id);
      const publisher = await connect();
      const disabler = await connect();
      try {
        await disabler.query('begin');
        await disabler.query(`update identity.accounts set status = 'disabled' where id = $1`, [who.accountId]);
        const publisherPid = await pidOf(publisher);
        let finished = false;
        const publishing = publish(publisher, who, lease).then((answer) => {
          finished = true;
          return answer;
        });
        await waitingOnLock(publisherPid);
        expect(finished, 'the publication waits for the disable that holds the Account').toBe(false);
        await disabler.query('commit');
        expect((await publishing).outcome).toBe('denied');
        expect(await manifestsOf(db, lease.id)).toEqual([]);
        expect(await stateOfLease(db, lease.id)).toBe('complete');
      } finally {
        await disabler.query('rollback').catch(() => undefined);
      }
    });
  });

  it('yields ONE manifest when two connections publish the same upload at once: one publishes, the other finds it', async () => {
    const who = await member();
    const lease = await completeLease(db, who);
    left.push(lease.id);
    const first = await connect();
    const second = await connect();
    try {
      await first.query('begin');
      const published = await publish(first, who, lease);
      const secondPid = await pidOf(second);
      let finished = false;
      await second.query('begin');
      const racing = publish(second, who, lease).then((answer) => {
        finished = true;
        return answer;
      });
      await waitingOnLock(secondPid);
      expect(finished, 'the second publication waits for the lease the first holds').toBe(false);
      await first.query('commit');
      const found = await racing;
      await second.query('commit');
      expect([published.outcome, found.outcome].sort()).toEqual(['exists', 'published']);
      expect(found.root).toBe(published.root);
      expect(await manifestsOf(db, lease.id)).toHaveLength(1);
    } finally {
      await first.query('rollback').catch(() => undefined);
      await second.query('rollback').catch(() => undefined);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the private-files bucket: private, and reachable only by the gateway\'s own Storage key', () => {
  const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  /** A token the Storage API accepts for `authenticated`, signed with the stack's JWT secret: what Auth would issue for a signed-in person. */
  function authenticatedToken() {
    const claims = {iss: `${stack().apiUrl}/auth/v1`, aud: 'authenticated', role: 'authenticated', sub: randomUUID(), session_id: randomUUID(), exp: Math.floor(Date.now() / 1000) + 600};
    const unsigned = `${base64url({alg: 'HS256', typ: 'JWT'})}.${base64url(claims)}`;
    return `${unsigned}.${createHmac('sha256', jwtSecretOf(stack())).update(unsigned).digest('base64url')}`;
  }

  it('exists, is not public, has the 100 MiB limit of the largest object, and no policy of storage.objects names it or opens every bucket to a browser role', async () => {
    const {rows} = await db.query(`select id, name, public, file_size_limit::bigint::text as file_size_limit, allowed_mime_types from storage.buckets where id = 'private-files'`);
    expect(rows).toEqual([{id: 'private-files', name: 'private-files', public: false, file_size_limit: String(100 * MiB), allowed_mime_types: null}]);
    const {rows: policies} = await db.query(
      `select p.polname as name, array(select case when r = 0 then 'public' else r::regrole::text end from unnest(p.polroles) r) as roles, pg_get_expr(p.polqual, p.polrelid) as using, pg_get_expr(p.polwithcheck, p.polrelid) as check
         from pg_policy p where p.polrelid = 'storage.objects'::regclass or p.polrelid = 'storage.buckets'::regclass`,
    );
    for (const policy of policies) {
      expect(`${policy.using} ${policy.check}`, policy.name).not.toMatch(/private-files/);
      expect(policy.roles, policy.name).not.toEqual(expect.arrayContaining(['anon']));
      expect(policy.roles, policy.name).not.toEqual(expect.arrayContaining(['authenticated']));
      expect(policy.roles, policy.name).not.toContain('public');
    }
    expect(policies).toEqual([]);
    // The migration made it with the one statement this file reads back: private, and no other public bucket was made by this story.
    const migration = readFileSync(join(import.meta.dirname, '../../supabase/migrations/20261015120000_file_gateway.sql'), 'utf8');
    expect(migration).toMatch(/insert into storage\.buckets \(id, name, public, file_size_limit\)\s+values \('private-files', 'private-files', false, 104857600\)/);
  });

  it('shows an object put with the gateway\'s key to the owner and to no browser role: not through SQL, and not through the Storage REST API with the anon key or a signed-in person\'s token', async () => {
    const s3 = createS3Storage(s3Of(stack()));
    const account = randomUUID();
    const id = randomUUID();
    const key = `staging/${account}/${id}`;
    const secret = `the-private-bytes-${randomBytes(8).toString('hex')}`;
    async function* body() {
      yield Buffer.from(secret);
    }
    await s3.put(key, body(), {contentType: 'application/octet-stream'});
    try {
      // The Storage service's own tables know the object, to its owner.
      expect((await db.query(`select count(*)::int as n from storage.objects where bucket_id = 'private-files' and name = $1`, [key])).rows[0].n).toBe(1);
      await inTx(async (client) => {
        for (const role of ['anon', 'authenticated']) {
          const result = await attempt(client, role, `select count(*)::int as n from storage.objects where bucket_id = 'private-files'`);
          expect(result.ok ? result.rows[0].n : 0, `${role} sees no object of the bucket`).toBe(0);
          const named = await attempt(client, role, `select name from storage.objects where name = $1`, [key]);
          expect(named.ok ? named.rows : [], `${role} cannot find it by name`).toEqual([]);
        }
      });
      // The gateway role cannot read the Storage tables either: its own key is how it reaches the bucket.
      await asGateway(async (client) => {
        expect((await attempt(client, null, 'select * from storage.objects')).ok).toBe(false);
      });
      for (const [label, token] of [['the anon key', stack().anonKey], ['a signed-in person\'s token', authenticatedToken()]] as const) {
        const headers = {apikey: stack().anonKey, authorization: `Bearer ${token}`};
        for (const path of [`object/private-files/${key}`, `object/authenticated/private-files/${key}`, `object/public/private-files/${key}`, `object/info/private-files/${key}`]) {
          const response = await fetch(`${stack().apiUrl}/storage/v1/${path}`, {headers});
          const text = await response.text();
          expect(response.status, `${label}: ${path}`).toBeGreaterThanOrEqual(400);
          expect(text, `${label}: ${path}`).not.toContain(secret);
        }
        // Listing it, and asking for a signed URL for it: nothing is named, nothing is signed.
        const listed = await fetch(`${stack().apiUrl}/storage/v1/object/list/private-files`, {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({prefix: `staging/${account}`, limit: 10})});
        const listedText = await listed.text();
        expect(listedText, label).not.toContain(id);
        const signed = await fetch(`${stack().apiUrl}/storage/v1/object/sign/private-files/${key}`, {method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({expiresIn: 60})});
        expect(signed.status, label).toBeGreaterThanOrEqual(400);
        expect(await signed.text(), label).not.toMatch(/signedURL|token=/);
      }
    } finally {
      await s3.deletePrefix(key);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries every earlier probe and the new ones (Story 1.12)', () => {
  const newSignatures = ['api.revoke_service_key(text, text, text)', 'api.list_expired_staging(integer)', 'artifacts.publish_attachment(uuid, bigint, uuid, text, text, text)'];

  it('answers ok to the service role, reads the six tables and two views and their columns, looks for the three functions, and checks the bucket is private', async () => {
    await inTx(async (client) => {
      expect(await svc(client, 'select ok from api.preflight()')).toEqual({ok: true});
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of [
      // Every earlier probe is still there (the earlier stories' own tests name them one by one as well).
      'identity.session_grants', 'identity.accounts', 'a.status_handle', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts', 'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
      'delete on auth.sessions', 'delete Auth identities', 'api.list_accounts()', 'api.issue_recovery(text,text)', 'api.rename_project(uuid,bigint,uuid,uuid,bigint,text)',
      'api.record_tombstone(text,uuid)', 'api.guard_target(uuid,bigint,text,uuid)', 'api.claim_job_run(text,text,text,integer)', 'api.purge_dormant_identities(integer)', 'lifecycle.job_result_ok(json)',
      // And the new ones: the six tables with the columns the gateway and the functions use, the two views, the functions, the bucket.
      'artifacts.staging_leases', 'l.received_length', 'l.content_type', 'artifacts.ticket_redemptions', 'd.jti', 'd.redeemed_at', 'artifacts.transfer_handles', 'h.hash', 'h.ended_at', 'artifacts.manifests', 'f.root', 'f.body',
      'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'v.revoked_at', 'artifacts.session_authority', 'w.state', 'artifacts.instance', 'n.instance_id',
      'api.revoke_service_key(text,text,text)', 'api.list_expired_staging(integer)', 'artifacts.publish_attachment(uuid,bigint,uuid,text,text,text)', 'Story 1.12 migration', 'private-files', 'storage.buckets',
    ]) expect(definition, needle).toContain(needle);
    // The two new `api` functions are among those the service role must be able to execute (thirty-one in all since Story 1.13 added seven, thirty-three since Story 2.1 added two).
    const check = definition.indexOf('where not has_function_privilege');
    const executable = definition.slice(definition.lastIndexOf('unnest(array[', check), check);
    expect(check).toBeGreaterThan(-1);
    expect(executable.match(/'api\.[a-z_]+\([^']*\)'/g)).toHaveLength(33);
    for (const signature of ['api.revoke_service_key(text,text,text)', 'api.list_expired_staging(integer)']) {
      expect((await db.query(`select has_function_privilege('service_role', $1, 'execute') as can`, [signature])).rows[0].can).toBe(true);
    }
  });

  it.each(newSignatures)('fails the build with one line naming %s when it is missing', async (signature) => {
    await inTx(async (client) => {
      await client.query(`drop function ${signature} cascade`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('Story 1.12');
        expect(result.message).toContain(signature.replace(/, /g, ','));
      }
    });
  });

  it.each(['api.revoke_service_key(text, text, text)', 'api.list_expired_staging(integer)'])('fails when the service role cannot execute %s', async (signature) => {
    await inTx(async (client) => {
      await client.query(`revoke execute on function ${signature} from service_role`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(signature.replace(/, /g, ','));
      }
    });
  });

  it('fails when the private-files bucket is public, and when it is missing, naming the bucket', async () => {
    await inTx(async (client) => {
      await client.query(`update storage.buckets set public = true where id = 'private-files'`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('private-files');
        expect(result.message).toContain('public');
      }
    });
    await inTx(async (client) => {
      // (Storage refuses to delete a bucket that holds objects, and to rename one; with row triggers off, in this transaction only, a bucket can be made to be gone.)
      await client.query('set local session_replication_role = replica');
      await client.query(`update storage.buckets set id = 'renamed-private-files', name = 'renamed-private-files' where id = 'private-files'`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('missing or public');
      }
    });
    // And the real bucket is private again, the real preflight ok.
    expect((await db.query(`select public from storage.buckets where id = 'private-files'`)).rows).toEqual([{public: false}]);
  });

  // The functions run as their owner. Hand this one to `anon`, which can use the schemas but read none of their tables, and give it the right to read
  // all but one of the Artifacts relations, inside a transaction that is rolled back, to see that each read is made and named.
  it.each(['artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance'])(
    'fails, naming a permission and not answering ok, when the role it runs as cannot read %s',
    async (blocked) => {
      const everything = [
        'identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions',
        'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts',
        'artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance',
        'lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats',
        'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
      ];
      await inTx(async (client) => {
        await client.query('grant usage on schema api, identity, projects, lifecycle, artifacts to anon');
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
    },
  );

  it('checks the bucket last, after every privilege check, and reads it through row-level security: a role that reaches that check passes it only if it sees the bucket (a connection as the stack\'s superuser, in a transaction that is rolled back)', async () => {
    const url = new URL(stack().dbUrl);
    url.username = 'supabase_admin';
    const admin = new Client({connectionString: url.toString()});
    await admin.connect().catch((error: Error) => {
      throw new Error(`The superuser connection this case needs (supabase_admin on the local stack) failed: ${error.message}`);
    });
    const preflightAsServiceRole = async () => {
      await admin.query('savepoint probe');
      try {
        await admin.query('set local role service_role');
        const result = await admin.query('select ok from api.preflight()');
        await admin.query('reset role');
        await admin.query('release savepoint probe');
        return {ok: true as const, rows: result.rows};
      } catch (error) {
        await admin.query('rollback to savepoint probe');
        return {ok: false as const, message: (error as Error).message, code: (error as {code?: string}).code};
      }
    };
    const tables = [
      'identity.session_grants', 'identity.accounts', 'identity.account_preferences', 'identity.step_up_nonces', 'identity.fresh_authentications', 'identity.recovery_tokens', 'projects.projects', 'projects.project_commands', 'projects.request_revisions',
      'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'lifecycle.ledger_relay', 'lifecycle.status_requests', 'lifecycle.job_receipts',
      'artifacts.staging_leases', 'artifacts.ticket_redemptions', 'artifacts.transfer_handles', 'artifacts.manifests', 'artifacts.attachment_transforms', 'artifacts.service_key_revocations', 'artifacts.session_authority', 'artifacts.instance',
      'lifecycle.alarms', 'lifecycle.alarm_notices', 'lifecycle.heartbeats',
      'auth.sessions', 'auth.identities', 'auth.mfa_amr_claims',
    ];
    await admin.query('begin');
    try {
      await admin.query('create role preflight_probe_bucket nologin');
      await admin.query('grant usage on schema api, identity, projects, lifecycle, auth, artifacts, storage to preflight_probe_bucket');
      await admin.query('grant create on schema api to preflight_probe_bucket');
      for (const table of tables) await admin.query(`grant select on ${table} to preflight_probe_bucket`);
      await admin.query('grant select on storage.buckets to preflight_probe_bucket');
      await admin.query('grant delete on auth.sessions, auth.users to preflight_probe_bucket');
      await admin.query('alter function api.preflight() owner to preflight_probe_bucket');
      // Without the power to see the whole bucket table (row-level security hides it from this role), the last check fails, and says the bucket: it is
      // reached only AFTER the checks of what the owner may read and delete, which all passed.
      const hidden = await preflightAsServiceRole();
      expect(hidden.ok).toBe(false);
      if (!hidden.ok) {
        expect(hidden.code).toBe('N3020');
        expect(hidden.message).toContain('private-files');
      }
      await admin.query('alter role preflight_probe_bucket bypassrls');
      expect(await preflightAsServiceRole()).toEqual({ok: true, rows: [{ok: true}]});
      // ... and a bucket that is public fails it again.
      await admin.query(`update storage.buckets set public = true where id = 'private-files'`);
      const exposed = await preflightAsServiceRole();
      expect(exposed.ok).toBe(false);
      if (!exposed.ok) expect(exposed.message).toContain('missing or public');
    } finally {
      await admin.query('rollback').catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
    expect((await db.query(`select count(*)::int as n from pg_roles where rolname = 'preflight_probe_bucket'`)).rows[0].n).toBe(0);
    expect((await db.query(`select pg_get_userbyid(proowner) as owner from pg_proc where oid = 'api.preflight()'::regprocedure`)).rows[0].owner).toBe('postgres');
    expect((await db.query(`select public from storage.buckets where id = 'private-files'`)).rows).toEqual([{public: false}]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the staging-cleanup task and its receipts (Story 1.12 registers the third scheduled task)', () => {
  const instance = () => env.INSTANCE_ID;
  const jobEnv = () => ({...env, QSTASH_CURRENT_SIGNING_KEY: testSigningKeys.current, QSTASH_NEXT_SIGNING_KEY: testSigningKeys.next, ADMINISTRATOR_EMAIL: 'admin@example.test', NEXT_PUBLIC_APP_ENV: 'local', PAID_ADAPTERS_ENABLED: 'false', SYNTHETIC_DATA_ENABLED: 'false'});
  const fresh = () => ({schedule: `scd_${randomUUID()}`, message: `msg_${randomUUID()}`});
  const longAgo = (index: number) => new Date(Date.UTC(2000, 0, 1 + index));
  const receipts = async (key: {schedule: string; message: string}) =>
    (await db.query('select task, attempt, outcome, result from lifecycle.job_receipts where schedule_id = $1 and message_id = $2 order by attempt', [key.schedule, key.message])).rows as {task: string; attempt: number; outcome: string | null; result: Record<string, unknown> | null}[];
  const send = (call: ReturnType<typeof signedCall>, task: NonNullable<Parameters<typeof handleJobRequest>[1]>['task']) =>
    handleJobRequest(new Request('http://127.0.0.1:4173/api/jobs', {method: 'POST', headers: call.headers, body: call.body}), {env: jobEnv(), task});

  /**
   * A gateway of the tests': what the real one does with a `delete-staging` command, on the shared database as the owner, but ONLY for the leases the case
   * wrote (every other lease it is asked about is `kept`, so the case never deletes what another test is using). It runs the gateway's one statement,
   * `claimDeletion`, then marks the lease deleted.
   */
  function gatewayFor(mine: string[], options: {beforeClaim?: (uploadId: string) => Promise<void>} = {}) {
    const asked: string[] = [];
    return {
      asked,
      client: {
        async deleteStaging(input: {accountId: string; uploadId: string}) {
          asked.push(input.uploadId);
          if (!mine.includes(input.uploadId)) return {outcome: 'kept' as const};
          await options.beforeClaim?.(input.uploadId);
          const claimed = await db.query(
            `update artifacts.staging_leases set state = 'released' where id = $1 and account_id = $2 and state <> 'deleted' and (state = 'released' or expires_at <= clock_timestamp()) returning id`,
            [input.uploadId, input.accountId],
          );
          if (claimed.rows.length === 0) return {outcome: 'kept' as const};
          await db.query(`update artifacts.staging_leases set state = 'deleted' where id = $1`, [input.uploadId]);
          return {outcome: 'deleted' as const};
        },
        async deleteRoot() {
          throw new Error('the cleanup deletes no root');
        },
        async attach() {
          throw new Error('the cleanup attaches nothing');
        },
      },
    };
  }

  it('is `no_store` with no gateway, and reads nothing: not even the database is asked', async () => {
    let calls = 0;
    const answer = await runTask('staging-cleanup', {
      instanceId: instance(),
      accounts: {env, fetch: async () => {
        calls += 1;
        throw new Error('the database must not be asked');
      }},
      gateway: null,
    });
    expect(answer).toEqual({outcome: 'no_store', result: {configured: false}});
    expect(calls).toBe(0);
  });

  it('is `idle` when nothing is expired or released, and the gateway is not called', async () => {
    const gateway = gatewayFor([]);
    const answer = await runTask('staging-cleanup', {instanceId: instance(), accounts: {env, fetch: async () => Response.json({leases: []})}, gateway: gateway.client});
    expect(answer).toEqual({outcome: 'idle', result: {expired: 0}});
    expect(gateway.asked).toEqual([]);
  });

  it('removes expired and released leases one by one through signed commands, and keeps a lease that was renewed between the list and the command', async () => {
    const account = randomUUID();
    const expired = await addLease(db, {account, state: 'receiving', expires: longAgo(50)});
    const released = await addLease(db, {account, state: 'released', expires: longAgo(51)});
    const renewed = await addLease(db, {account, state: 'complete', expires: longAgo(52)});
    left.push(expired, released, renewed);
    const gateway = gatewayFor([expired, released, renewed], {
      // The renewal lands after the list was read and before the gateway's own check, which is what the one statement exists for.
      beforeClaim: async (uploadId) => {
        if (uploadId === renewed) await db.query(`update artifacts.staging_leases set expires_at = clock_timestamp() + interval '24 hours' where id = $1`, [uploadId]);
      },
    });
    const answer = await runTask('staging-cleanup', {instanceId: instance(), accounts: {env}, gateway: gateway.client});
    expect(answer.outcome).toBe('ran');
    const result = answer.result as {expired: number; deleted: number; kept: number};
    expect(result.expired).toBeGreaterThanOrEqual(3);
    expect(result.deleted).toBe(2);
    expect(result.deleted + result.kept).toBe(result.expired);
    expect(Object.keys(result).sort()).toEqual(['deleted', 'expired', 'kept']);
    // The oldest first: the three of this case were asked about, in that order, and the renewed one is as it was: complete, with its object kept.
    expect(gateway.asked.filter((id) => [expired, released, renewed].includes(id))).toEqual([expired, released, renewed]);
    const states = await db.query('select id, state from artifacts.staging_leases where id = any($1)', [[expired, released, renewed]]);
    expect(Object.fromEntries(states.rows.map((row) => [row.id, row.state]))).toEqual({[expired]: 'deleted', [released]: 'deleted', [renewed]: 'complete'});
    // The next firing no longer names the ones that were removed, nor the one that was renewed.
    const next = (await listExpiredStaging({limit: 50}, {env})).map((lease) => lease.uploadId);
    for (const id of [expired, released, renewed]) expect(next).not.toContain(id);
  });

  it('records the three outcomes as receipts of the new task, with counts and booleans only (the database accepts them)', async () => {
    for (const [outcome, result] of [['ran', {expired: 3, deleted: 2, kept: 1}], ['idle', {expired: 0}], ['no_store', {configured: false}], ['failed', {error_class: 'GatewayUnavailableError'}]] as const) {
      const key = fresh();
      const claimed = await claimJobRun({task: 'staging-cleanup', scheduleId: key.schedule, messageId: key.message}, {env});
      expect(claimed).toMatchObject({outcome: 'claimed', attempt: 1});
      if (claimed.outcome !== 'claimed') throw new Error('unreachable');
      expect(await finishJobRun({receiptId: claimed.receiptId, outcome: outcome, result}, {env})).toEqual({outcome: 'finished'});
      expect((await receipts(key))[0]).toMatchObject({task: 'staging-cleanup', attempt: 1, outcome, result});
    }
  });

  it('through the route: `no_store` with no gateway, a failed run (class name only) and a retry that succeeds, all as receipts of the schedule\'s own messages', async () => {
    const instanceId = instance();
    // 1. No gateway configured.
    const none = fresh();
    const unconfigured = await send(signedCall({task: 'staging-cleanup', instance: instanceId}, {scheduleId: none.schedule, messageId: none.message}), {gateway: null});
    expect([unconfigured.status, await unconfigured.json()]).toEqual([200, {outcome: 'no_store'}]);
    expect((await receipts(none))[0]).toMatchObject({task: 'staging-cleanup', outcome: 'no_store', result: {configured: false}});

    // 2. A gateway that is down fails the run, and the receipt names the class and never the message; the delivery comes again and the run succeeds.
    const account = randomUUID();
    const lease = await addLease(db, {account, state: 'released', expires: longAgo(60)});
    left.push(lease);
    const key = fresh();
    const down = {
      async deleteStaging(): Promise<never> {
        // The real class (the task stops on an UNAVAILABLE answer by its class, Review P10), with a message that must never reach the receipt.
        throw Object.assign(new GatewayUnavailableError(), {message: 'the gateway at https://files.internal.example refused the token abc'});
      },
      async deleteRoot(): Promise<never> {
        throw new Error('unused');
      },
      async attach(): Promise<never> {
        throw new Error('unused');
      },
    };
    const failed = await send(signedCall({task: 'staging-cleanup', instance: instanceId}, {scheduleId: key.schedule, messageId: key.message}), {gateway: down});
    expect([failed.status, await failed.json()]).toEqual([500, {outcome: 'failed'}]);
    const [failure] = await receipts(key);
    expect(failure).toMatchObject({task: 'staging-cleanup', attempt: 1, outcome: 'failed', result: {error_class: 'GatewayUnavailableError'}});
    expect(JSON.stringify(failure)).not.toMatch(/files\.internal|abc/);

    const gateway = gatewayFor([lease]);
    const retried = await send(signedCall({task: 'staging-cleanup', instance: instanceId}, {scheduleId: key.schedule, messageId: key.message}), {gateway: gateway.client});
    expect([retried.status, await retried.json()]).toEqual([200, {outcome: 'ran'}]);
    expect((await receipts(key)).map((row) => [row.attempt, row.outcome])).toEqual([[1, 'failed'], [2, 'ran']]);
    expect((await db.query('select state from artifacts.staging_leases where id = $1', [lease])).rows).toEqual([{state: 'deleted'}]);
    // A third delivery of the message is a duplicate: nothing runs.
    const again = await send(signedCall({task: 'staging-cleanup', instance: instanceId}, {scheduleId: key.schedule, messageId: key.message}), {gateway: gateway.client});
    expect([again.status, await again.json()]).toEqual([200, {outcome: 'duplicate'}]);
  });

  it('through the route: a lease the gateway refuses fails the run by the cleanup\'s own class (nothing else in the receipt), after the leases behind it were cleaned; the retry cleans the poison one', async () => {
    const instanceId = instance();
    const account = randomUUID();
    const poison = await addLease(db, {account, state: 'released', expires: longAgo(61)});
    const behind = await addLease(db, {account, state: 'released', expires: longAgo(62)});
    left.push(poison, behind);
    const refusing = gatewayFor([poison, behind]);
    const picky = {
      ...refusing.client,
      async deleteStaging(input: {accountId: string; uploadId: string}) {
        if (input.uploadId === poison) throw Object.assign(new GatewayError(403), {message: `the gateway refused ${input.accountId}`});
        return refusing.client.deleteStaging(input);
      },
    };
    const key = fresh();
    const failed = await send(signedCall({task: 'staging-cleanup', instance: instanceId}, {scheduleId: key.schedule, messageId: key.message}), {gateway: picky});
    expect([failed.status, await failed.json()]).toEqual([500, {outcome: 'failed'}]);
    const [failure] = await receipts(key);
    expect(failure).toMatchObject({task: 'staging-cleanup', attempt: 1, outcome: 'failed', result: {error_class: 'StagingCleanupIncompleteError'}});
    expect(JSON.stringify(failure)).not.toContain(account);
    expect((await db.query('select id, state from artifacts.staging_leases where id = any($1)', [[poison, behind]])).rows.map((row) => [row.id, row.state]).sort()).toEqual([[behind, 'deleted'], [poison, 'released']].sort());

    const gateway = gatewayFor([poison]);
    const retried = await send(signedCall({task: 'staging-cleanup', instance: instanceId}, {scheduleId: key.schedule, messageId: key.message}), {gateway: gateway.client});
    expect([retried.status, await retried.json()]).toEqual([200, {outcome: 'ran'}]);
    expect((await db.query('select state from artifacts.staging_leases where id = $1', [poison])).rows).toEqual([{state: 'deleted'}]);
  });
});
