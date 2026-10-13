import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

// The local fixture seed (scripts/seed-projects.mjs): what it refuses before it touches any database. What it writes is in
// tests/integration/projects-seed.test.ts. Every case here is refused before a connection is made, so none needs a stack.
const script = resolve(import.meta.dirname, '../../scripts/seed-projects.mjs');
const local = {
  APP_ENV: 'local',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  SEED_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/postgres',
  ADMINISTRATOR_EMAIL: 'someone@example.test',
};

const run = (args: string[], env: Record<string, string>) =>
  new Promise<{code: number | null; stdout: string; stderr: string}>((done) => {
    const child = spawn(process.execPath, [script, ...args], {env: Object.fromEntries(Object.entries({PATH: process.env.PATH ?? '', ...env})) as NodeJS.ProcessEnv, cwd: resolve(import.meta.dirname, '../..')});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => done({code, stdout, stderr}));
  });

describe('the local fixture seed refuses', () => {
  it.each([
    ['APP_ENV=staging', {APP_ENV: 'staging'}, /APP_ENV is "staging"/],
    ['APP_ENV=production', {APP_ENV: 'production'}, /APP_ENV is "production"/],
    ['an APP_ENV that is not set', {APP_ENV: ''}, /APP_ENV is not set/],
    ['a hosted Supabase URL', {NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co'}, /NEXT_PUBLIC_SUPABASE_URL is not a loopback address/],
    ['a Supabase URL that is no URL', {NEXT_PUBLIC_SUPABASE_URL: 'not a url'}, /NEXT_PUBLIC_SUPABASE_URL is not a loopback address/],
    ['a Supabase URL that only looks local', {NEXT_PUBLIC_SUPABASE_URL: 'https://127.0.0.1.evil.example'}, /NEXT_PUBLIC_SUPABASE_URL is not a loopback address/],
    ['a hosted database', {SEED_DATABASE_URL: 'postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres'}, /SEED_DATABASE_URL is not a loopback address/],
    ['a database that is no URL', {SEED_DATABASE_URL: 'nope'}, /SEED_DATABASE_URL is not a loopback address/],
    ['a database URL with no host', {SEED_DATABASE_URL: 'postgresql:///postgres'}, /SEED_DATABASE_URL is not a loopback address/],
    ['a list of hosts, one of them hosted', {SEED_DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1,db.abcdefgh.supabase.co/postgres'}, /SEED_DATABASE_URL is not a loopback address/],
    ['a loopback host that a host parameter replaces', {SEED_DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1/postgres?host=db.abcdefgh.supabase.co'}, /"host" parameter/],
    ['a loopback host that a HOST parameter in capitals replaces', {SEED_DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1/postgres?HOST=db.abcdefgh.supabase.co'}, /"host" parameter/],
    ['a loopback host that a hostaddr parameter replaces', {SEED_DATABASE_URL: 'postgresql://postgres:secret@localhost/postgres?hostaddr=203.0.113.9'}, /"hostaddr" parameter/],
    ['a service parameter', {SEED_DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1/postgres?service=hosted'}, /"service" parameter/],
    ['a servicefile parameter', {SEED_DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1/postgres?servicefile=/tmp/pg_service.conf'}, /"servicefile" parameter/],
    ['an options parameter', {SEED_DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1/postgres?options=-c%20search_path%3Dx'}, /"options" parameter/],
    ['a routing parameter among harmless ones', {SEED_DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1/postgres?connect_timeout=3&host=db.abcdefgh.supabase.co&sslmode=disable'}, /"host" parameter/],
  ])('%s, and does not print the database address or any key', async (_name, change, message) => {
    const result = await run([], {...local, ...change});
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toMatch(/secret|supabase\.co|postgresql:/);
  });

  it('without an Account to give the Projects to', async () => {
    const result = await run([], {...local, ADMINISTRATOR_EMAIL: ''});
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Name the Account/);
  });

  it('a stray argument, an unknown option and a missing value, as wrong usage', async () => {
    for (const args of [['extra'], ['--force'], ['--email']]) {
      const result = await run(args, local);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr).toMatch(/Usage:/);
    }
  });

  it('lets a harmless parameter through to the connection (it is refused for being unreachable, not for being a parameter)', async () => {
    const result = await run([], {...local, SEED_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:1/postgres?connect_timeout=2&sslmode=disable'});
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Could not connect to the local database/);
  });

  it('a database that is not there, in one line, without a stack trace', async () => {
    const result = await run([], local);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Could not connect to the local database/);
    expect(result.stderr).not.toMatch(/\bat \S+ \(/);
  });
});
