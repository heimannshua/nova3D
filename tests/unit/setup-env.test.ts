import {execFile} from 'node:child_process';
import {chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {decodeHashKey, hashKeyProblem} from '@/lib/environment';

const repo = resolve(import.meta.dirname, '../..');
const script = join(repo, 'scripts/setup-env.mjs');
const ID = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const STUB_ANON = 'stub-anon-key-never-printed';
const STUB_SERVICE = 'stub-service-key-never-printed';
const HOSTED_URL = 'https://abcdefgh.supabase.co';

let server: Server;
let origin = '';
let work: string;
let bin: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const ok = request.headers.apikey === STUB_SERVICE && request.headers['accept-profile'] === 'lifecycle';
    response.writeHead(ok ? 200 : 401, {'content-type': 'application/json'}).end(JSON.stringify(ok ? [{environment: 'local', instance_id: ID}] : {message: 'denied'}));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
});
afterAll(() => {
  server.close();
});

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'nova3d-setup-env-'));
  bin = join(work, 'bin');
  mkdirSync(bin);
  copyFileSync(join(repo, '.env.example'), join(work, '.env.example'));
  stubSupabase(0);
});
afterEach(() => {
  rmSync(work, {recursive: true, force: true});
});

/** A `supabase` that answers `status -o env` the way the CLI does (shell builtins only: PATH holds nothing else). */
function stubSupabase(exitCode: number) {
  const body = exitCode === 0
    ? `printf '%s\\n' 'API_URL="${origin}"' 'ANON_KEY="${STUB_ANON}"' 'SERVICE_ROLE_KEY="${STUB_SERVICE}"'`
    : `echo 'no such container' >&2; exit ${exitCode}`;
  writeFileSync(join(bin, 'supabase'), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, 'supabase'), 0o755);
}

function setup(path = bin) {
  const env: Record<string, string> = {PATH: path, NOVA3D_SETUP_ROOT: work};
  return new Promise<{code: number; stdout: string; stderr: string}>((done) => {
    execFile(process.execPath, [script, 'local'], {env: env as NodeJS.ProcessEnv, encoding: 'utf8'}, (error, stdout, stderr) => {
      done({code: error ? Number(error.code) || 1 : 0, stdout, stderr});
    });
  });
}

const envFile = () => join(work, '.env.local');
const backupFile = () => join(work, '.env.local.bak');
const read = (path: string) => readFileSync(path, 'utf8');
const mode = (path: string) => statSync(path).mode & 0o777;
const valuesOf = (text: string, name: string) => [...text.matchAll(new RegExp(`^(?:export\\s+)?${name}=(.*)$`, 'gm'))].map((match) => match[1]);

const hostedFile = [
  '# my notes',
  'APP_ENV=staging',
  'NEXT_PUBLIC_APP_ENV=staging',
  `NEXT_PUBLIC_SUPABASE_URL=${HOSTED_URL}`,
  'NEXT_PUBLIC_SUPABASE_ANON_KEY=hosted-anon-key',
  'SUPABASE_SERVICE_ROLE_KEY=hosted-service-key',
  'SEED_ACCOUNT_EMAILS=a@b.co',
  'UNRELATED=keep-me',
  '',
].join('\n');

describe('setup-env local', () => {
  it('creates .env.local from the template and points it at the stack', async () => {
    const result = await setup();
    expect(result.code, result.stderr).toBe(0);
    const text = read(envFile());
    expect(valuesOf(text, 'APP_ENV')).toEqual(['local']);
    expect(valuesOf(text, 'NEXT_PUBLIC_SUPABASE_URL')).toEqual([origin]);
    expect(valuesOf(text, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')).toEqual([STUB_ANON]);
    expect(valuesOf(text, 'SUPABASE_SERVICE_ROLE_KEY')).toEqual([STUB_SERVICE]);
    expect(valuesOf(text, 'INSTANCE_ID')).toEqual([ID]);
    expect(valuesOf(text, 'ADMINISTRATOR_EMAIL')).toHaveLength(1);
    expect(mode(envFile())).toBe(0o600);
    expect(existsSync(backupFile())).toBe(false);
    for (const secret of [STUB_ANON, STUB_SERVICE, ID]) expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it('re-points a hosted file, keeps unrelated lines, adds missing variables and backs it up once', async () => {
    writeFileSync(envFile(), hostedFile, {mode: 0o600});
    const result = await setup();
    expect(result.code, result.stderr).toBe(0);

    const text = read(envFile());
    expect(valuesOf(text, 'NEXT_PUBLIC_SUPABASE_URL')).toEqual([origin]);
    expect(valuesOf(text, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')).toEqual([STUB_ANON]);
    expect(valuesOf(text, 'SUPABASE_SERVICE_ROLE_KEY')).toEqual([STUB_SERVICE]);
    expect(valuesOf(text, 'APP_ENV')).toEqual(['local']);
    expect(valuesOf(text, 'INSTANCE_ID')).toEqual([ID]);
    expect(valuesOf(text, 'ADMINISTRATOR_EMAIL')).toHaveLength(1);
    expect(text).toContain('# my notes');
    expect(text).toContain('UNRELATED=keep-me');
    expect(text).toContain('SEED_ACCOUNT_EMAILS=a@b.co');
    expect(text).not.toContain(HOSTED_URL);
    expect(text).not.toContain('hosted-');

    expect(read(backupFile())).toBe(hostedFile);
    expect(mode(backupFile())).toBe(0o600);
    expect(result.stdout).toContain('.env.local.bak');
    for (const secret of [HOSTED_URL, 'hosted-anon-key', 'hosted-service-key', STUB_ANON, STUB_SERVICE, ID]) expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it('replaces export lines and every duplicate, and never overwrites an existing backup', async () => {
    writeFileSync(
      envFile(),
      [
        `export NEXT_PUBLIC_SUPABASE_URL="${HOSTED_URL}"`,
        'NEXT_PUBLIC_SUPABASE_URL=https://duplicate.supabase.co',
        'SUPABASE_SERVICE_ROLE_KEY=old-service-1',
        'export SUPABASE_SERVICE_ROLE_KEY=old-service-2',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=old-anon',
        'export INSTANCE_ID=old-instance',
        '',
      ].join('\n'),
    );
    writeFileSync(backupFile(), 'precious earlier backup\n');

    const result = await setup();
    expect(result.code, result.stderr).toBe(0);

    const text = read(envFile());
    expect(valuesOf(text, 'NEXT_PUBLIC_SUPABASE_URL')).toEqual([origin, origin]);
    expect(valuesOf(text, 'SUPABASE_SERVICE_ROLE_KEY')).toEqual([STUB_SERVICE, STUB_SERVICE]);
    expect(valuesOf(text, 'INSTANCE_ID')).toEqual([ID]);
    expect(text).toContain(`export NEXT_PUBLIC_SUPABASE_URL=${origin}`);
    expect(text).toContain(`export SUPABASE_SERVICE_ROLE_KEY=${STUB_SERVICE}`);
    expect(text).not.toMatch(/old-|duplicate\.supabase|abcdefgh/);

    expect(read(backupFile())).toBe('precious earlier backup\n');
    expect(result.stdout).toContain('already exists');
  });

  it('changes nothing on a second run', async () => {
    writeFileSync(envFile(), hostedFile, {mode: 0o600});
    expect((await setup()).code).toBe(0);
    const afterFirst = read(envFile());
    const backup = read(backupFile());

    const second = await setup();
    expect(second.code, second.stderr).toBe(0);
    expect(read(envFile())).toBe(afterFirst);
    expect(read(backupFile())).toBe(backup);
    expect(second.stdout).toContain('already matches');
    expect(second.stdout).not.toContain('Backed it up');
  });

  it('says so when the Supabase CLI is missing', async () => {
    const empty = join(work, 'empty');
    mkdirSync(empty);
    const result = await setup(empty);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not installed or not on PATH');
    expect(result.stderr).not.toContain('is not running');
  });

  it('says so when the stack is not running', async () => {
    stubSupabase(1);
    const result = await setup();
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('stack is not running');
    expect(result.stderr).not.toContain('not installed');
  });
});

describe('setup-env local hashing keys (Story 1.3)', () => {
  const names = ['INVITATION_HASH_KEY', 'RATE_LIMIT_HASH_KEY'];

  it('generates two different random keys of 32 bytes and never prints them', async () => {
    const result = await setup();
    expect(result.code, result.stderr).toBe(0);
    const text = read(envFile());
    const keys = names.map((name) => valuesOf(text, name));
    for (const [index, values] of keys.entries()) {
      expect(values, names[index]).toHaveLength(1);
      expect(hashKeyProblem(values[0]), names[index]).toBeNull();
      expect(decodeHashKey(values[0]).length).toBeGreaterThanOrEqual(32);
      expect(values[0]).not.toMatch(/replace-with/);
      expect(result.stdout + result.stderr).not.toContain(values[0]);
    }
    expect(keys[0][0]).not.toBe(keys[1][0]);
    expect(result.stdout).toContain('INVITATION_HASH_KEY');
    expect(result.stdout).toContain('RATE_LIMIT_HASH_KEY');
    expect(mode(envFile())).toBe(0o600);
  });

  it('keeps valid keys on a second run, so stored invitation hashes stay valid', async () => {
    expect((await setup()).code).toBe(0);
    const first = names.map((name) => valuesOf(read(envFile()), name)[0]);
    const second = await setup();
    expect(second.code, second.stderr).toBe(0);
    expect(names.map((name) => valuesOf(read(envFile()), name)[0])).toEqual(first);
    expect(second.stdout).toContain('already matches');
  });

  it('replaces a placeholder or malformed key, in every duplicate, and keeps a valid one', async () => {
    const keep = Buffer.from(Array.from({length: 32}, (_, index) => index * 7 + 3)).toString('base64');
    writeFileSync(envFile(), `INVITATION_HASH_KEY=replace-with-local-invitation-hash-key\nexport INVITATION_HASH_KEY=too-short\nRATE_LIMIT_HASH_KEY=${keep}\n`, {mode: 0o600});
    expect(hashKeyProblem(keep)).toBeNull();
    const result = await setup();
    expect(result.code, result.stderr).toBe(0);
    const text = read(envFile());
    const replaced = valuesOf(text, 'INVITATION_HASH_KEY');
    expect(replaced).toHaveLength(2);
    expect(replaced[0]).toBe(replaced[1]);
    expect(hashKeyProblem(replaced[0])).toBeNull();
    expect(valuesOf(text, 'RATE_LIMIT_HASH_KEY')).toEqual([keep]);
    expect(result.stdout).toContain('INVITATION_HASH_KEY');
    expect(result.stdout).not.toContain('RATE_LIMIT_HASH_KEY');
  });

  it('judges a key by its value, not by a trailing comment, and keeps it', async () => {
    const invitation = randomBytes(32).toString('base64');
    const rateLimit = randomBytes(32).toString('base64');
    const original = `INVITATION_HASH_KEY=${invitation} # made with openssl\nRATE_LIMIT_HASH_KEY=${rateLimit}\t# and this one\n`;
    writeFileSync(envFile(), original, {mode: 0o600});
    const result = await setup();
    expect(result.code, result.stderr).toBe(0);
    const text = read(envFile());
    expect(text).toContain(`INVITATION_HASH_KEY=${invitation} # made with openssl`);
    expect(text).toContain(`RATE_LIMIT_HASH_KEY=${rateLimit}\t# and this one`);
    expect(result.stdout).not.toMatch(/INVITATION_HASH_KEY|RATE_LIMIT_HASH_KEY/);

    // A comment around a bad value does not make it good.
    writeFileSync(envFile(), `INVITATION_HASH_KEY=short # looks fine\nRATE_LIMIT_HASH_KEY=${rateLimit}\n`, {mode: 0o600});
    expect((await setup()).code).toBe(0);
    const replaced = valuesOf(read(envFile()), 'INVITATION_HASH_KEY');
    expect(replaced).toHaveLength(1);
    expect(hashKeyProblem(replaced[0])).toBeNull();
    expect(replaced[0]).not.toContain('#');
    expect(valuesOf(read(envFile()), 'RATE_LIMIT_HASH_KEY')).toEqual([rateLimit]);
  });

  it('replaces RATE_LIMIT_HASH_KEY when both keys are valid but are the same key', async () => {
    const bytes = randomBytes(32);
    const same = bytes.toString('base64');
    writeFileSync(envFile(), `INVITATION_HASH_KEY=${same}\nRATE_LIMIT_HASH_KEY=${bytes.toString('base64url')} # the same key, spelled differently\n`, {mode: 0o600});
    const result = await setup();
    expect(result.code, result.stderr).toBe(0);
    const text = read(envFile());
    expect(valuesOf(text, 'INVITATION_HASH_KEY')).toEqual([same]);
    const [rateLimit] = valuesOf(text, 'RATE_LIMIT_HASH_KEY');
    expect(hashKeyProblem(rateLimit)).toBeNull();
    expect(decodeHashKey(rateLimit).equals(bytes)).toBe(false);
    expect(result.stdout).toContain('RATE_LIMIT_HASH_KEY');
    expect(result.stdout).not.toContain('INVITATION_HASH_KEY');
    expect(result.stdout + result.stderr).not.toContain(rateLimit);
    // Settled: a second run changes nothing.
    const settled = read(envFile());
    expect((await setup()).stdout).toContain('already matches');
    expect(read(envFile())).toBe(settled);
  });

  it('gives a different machine different keys', async () => {
    expect((await setup()).code).toBe(0);
    const first = valuesOf(read(envFile()), 'INVITATION_HASH_KEY')[0];
    rmSync(envFile());
    expect((await setup()).code).toBe(0);
    expect(valuesOf(read(envFile()), 'INVITATION_HASH_KEY')[0]).not.toBe(first);
  });
});
