import {execFile} from 'node:child_process';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {localStack} from '../support/stack';

const stack = localStack();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let db: Client;

beforeAll(async () => {
  db = new Client({connectionString: stack.dbUrl});
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

/** Runs statements inside a transaction that is always rolled back, optionally as another role. */
async function rolledBack<T>(role: string | null, work: () => Promise<T>) {
  await db.query('begin');
  try {
    if (role) await db.query(`set local role ${role}`);
    return await work();
  } finally {
    await db.query('rollback');
  }
}

describe('lifecycle.instance_identity migration', () => {
  it('creates the contracted columns', async () => {
    const {rows} = await db.query(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'lifecycle' and table_name = 'instance_identity'
        order by ordinal_position`,
    );
    expect(rows.map((row) => [row.column_name, row.data_type, row.is_nullable])).toEqual([
      ['id', 'boolean', 'NO'],
      ['environment', 'text', 'NO'],
      ['instance_id', 'uuid', 'NO'],
      ['created_at', 'timestamp with time zone', 'NO'],
    ]);
    expect(rows[2].column_default).toContain('gen_random_uuid()');
  });

  it('is the only table the story adds', async () => {
    const {rows} = await db.query(
      `select schemaname, tablename from pg_tables where schemaname in ('public', 'lifecycle') order by 1, 2`,
    );
    expect(rows).toEqual([{schemaname: 'lifecycle', tablename: 'instance_identity'}]);
  });

  it('holds exactly one row, named local, with a random UUID', async () => {
    const {rows} = await db.query('select id, environment, instance_id, created_at from lifecycle.instance_identity');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(true);
    expect(rows[0].environment).toBe('local');
    expect(rows[0].instance_id).toMatch(uuid);
    expect(rows[0].instance_id).not.toBe('00000000-0000-0000-0000-000000000000');
  });

  it('refuses a second row', async () => {
    await expect(rolledBack(null, () => db.query(`insert into lifecycle.instance_identity (environment) values ('staging')`))).rejects.toThrow(/duplicate key/);
    await expect(rolledBack(null, () => db.query(`insert into lifecycle.instance_identity (id, environment) values (false, 'staging')`))).rejects.toThrow(/check constraint/);
  });

  it('refuses an unknown environment name', async () => {
    await expect(
      rolledBack(null, async () => {
        await db.query('delete from lifecycle.instance_identity');
        await db.query(`insert into lifecycle.instance_identity (environment) values ('qa')`);
      }),
    ).rejects.toThrow(/check constraint/);
  });

  it('accepts each environment name and generates a fresh UUID', async () => {
    const seen = new Set<string>();
    for (const name of ['local', 'staging', 'production']) {
      const {rows} = await rolledBack(null, async () => {
        await db.query('delete from lifecycle.instance_identity');
        return db.query(`insert into lifecycle.instance_identity (environment) values ($1) returning instance_id`, [name]);
      });
      expect(rows[0].instance_id).toMatch(uuid);
      seen.add(rows[0].instance_id);
    }
    expect(seen.size).toBe(3);
  });
});

describe('lifecycle.instance_identity access', () => {
  it('has row-level security on and no policies', async () => {
    const {rows} = await db.query(
      `select c.relrowsecurity, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'lifecycle' and c.relname = 'instance_identity'`,
    );
    expect(rows).toEqual([{relrowsecurity: true, policies: 0}]);
  });

  it('grants anon and authenticated nothing', async () => {
    for (const role of ['anon', 'authenticated']) {
      const {rows} = await db.query(
        `select has_schema_privilege($1, 'lifecycle', 'usage') as usage,
                bool_or(has_table_privilege($1, 'lifecycle.instance_identity', p)) as any_table
           from unnest(array['select','insert','update','delete','truncate','references','trigger']) as p`,
        [role],
      );
      expect(rows[0], role).toEqual({usage: false, any_table: false});
    }
  });

  it('lets the service role read the row and nothing else', async () => {
    const {rows} = await rolledBack('service_role', () => db.query('select environment from lifecycle.instance_identity'));
    expect(rows).toEqual([{environment: 'local'}]);
    await expect(rolledBack('service_role', () => db.query(`update lifecycle.instance_identity set environment = 'production'`))).rejects.toThrow(/permission denied/);
    await expect(rolledBack('service_role', () => db.query('delete from lifecycle.instance_identity'))).rejects.toThrow(/permission denied/);
    await expect(rolledBack('service_role', () => db.query(`insert into lifecycle.instance_identity (environment) values ('staging')`))).rejects.toThrow(/permission denied/);
  });

  it('denies anon and authenticated at the database', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(rolledBack(role, () => db.query('select * from lifecycle.instance_identity')), role).rejects.toThrow(/permission denied for schema lifecycle/);
    }
  });
});

describe('lifecycle.instance_identity over the REST API', () => {
  const url = `${stack.apiUrl}/rest/v1/instance_identity?select=environment,instance_id`;
  const get = (key: string, profile: string | null = 'lifecycle') =>
    fetch(url, {headers: {apikey: key, authorization: `Bearer ${key}`, ...(profile ? {'accept-profile': profile} : {})}});

  it('returns the row to the service role', async () => {
    const response = await get(stack.serviceKey);
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].environment).toBe('local');
    expect(rows[0].instance_id).toMatch(uuid);
  });

  it('refuses the anon key', async () => {
    const response = await get(stack.anonKey);
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(response.status).toBeLessThan(500);
    expect(JSON.stringify(await response.json())).not.toContain('"environment"');
  });

  it('does not expose the table through the public schema', async () => {
    const response = await get(stack.serviceKey, null);
    expect(response.status).toBe(404);
  });
});

describe('local Auth follows supabase/config.toml', () => {
  it('enables Google only and keeps sign-ups on', async () => {
    const response = await fetch(`${stack.apiUrl}/auth/v1/settings`, {headers: {apikey: stack.anonKey}});
    expect(response.status).toBe(200);
    const settings = await response.json();
    const enabled = Object.entries(settings.external as Record<string, boolean>).filter(([, on]) => on).map(([name]) => name);
    expect(enabled).toEqual(['google']);
    expect(settings.disable_signup).toBe(false);
    expect(settings.mailer_autoconfirm).toBeDefined();
  });
});

describe('check-env --live against the local stack', () => {
  const script = resolve(import.meta.dirname, '../../scripts/check-env.mjs');
  const environment = (instanceId: string): Record<string, string> => ({
    PATH: process.env.PATH ?? '',
    APP_ENV: 'local',
    NEXT_PUBLIC_APP_ENV: 'local',
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
    ADMINISTRATOR_EMAIL: 'admin@example.com',
    INSTANCE_ID: instanceId,
    AUTH_ALLOWED_EMAILS: 'admin@example.com',
    PAID_ADAPTERS_ENABLED: 'false',
    SYNTHETIC_DATA_ENABLED: 'true',
  });
  const check = (env: Record<string, string>) =>
    new Promise<{code: number; stdout: string; stderr: string}>((done) => {
      execFile(process.execPath, [script, '--live'], {env: env as NodeJS.ProcessEnv}, (error, stdout, stderr) => {
        done({code: error ? Number(error.code) || 1 : 0, stdout, stderr});
      });
    });

  it('passes with the stack identity and fails with another UUID', async () => {
    const {rows} = await db.query('select instance_id from lifecycle.instance_identity');
    const good = await check(environment(rows[0].instance_id));
    expect(good.code, good.stderr).toBe(0);
    expect(good.stdout).toContain('Instance identity verified');

    const bad = await check(environment('11111111-1111-4111-8111-111111111111'));
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('INSTANCE_ID differs from the instance_identity row');
    expect(bad.stderr).not.toContain(stack.serviceKey);

    const mixed = await check({...environment(rows[0].instance_id), APP_ENV: 'staging', NEXT_PUBLIC_APP_ENV: 'staging'});
    // The stack is plain http on loopback, so the https rule for hosted environments stops this
    // before the database is asked. The row-versus-label comparison itself is covered by
    // scripts/test-env.mjs and the unit tests, which can serve https.
    expect(mixed.code).toBe(1);
    expect(mixed.stderr).toContain('must use https for staging and production');
    expect(mixed.stderr).not.toContain(stack.serviceKey);
  });
});
