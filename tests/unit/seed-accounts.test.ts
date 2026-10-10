import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {userInfo} from 'node:os';
import {resolve} from 'node:path';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {hashInvitationCode} from '@/lib/accounts';

// The seed command's behaviour that needs no database: its guards, exit codes, messages and the requests
// it sends. A local HTTP server stands in for the Supabase REST endpoint, and staging is reached through
// the same fetch-wrapper technique as scripts/test-env.mjs: staging must use https, which a plain local
// server cannot serve, so https://fixture.supabase.co is forwarded to the local server by a preloaded
// wrapper (NODE_OPTIONS=--import, set only for the child process). Every other URL is untouched. The
// real database is exercised by tests/integration/accounts.test.ts.

const script = resolve(import.meta.dirname, '../../scripts/seed-accounts.mjs');
const FIXTURE_HOST = 'https://fixture.supabase.co';
const SERVICE_KEY = 'fixture-service-key-must-never-be-printed';
const ANON_KEY = 'fixture-anon-key-must-never-be-printed';
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const INVITATION_KEY = randomBytes(32).toString('base64');
const RATE_LIMIT_KEY = randomBytes(32).toString('base64');
const forwardFixtureHost = `const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  return url.origin === "${FIXTURE_HOST}" ? real(process.env.FIXTURE_ORIGIN + url.pathname + url.search, init) : real(input, init);
};`;
const preload = `--import=data:text/javascript,${encodeURIComponent(forwardFixtureHost)}`;

type Reply = {status?: number; body: unknown} | 'drop';
type Rpc = {name: string; body: Record<string, any>};
let server: Server;
let origin = '';
let rpcs: Rpc[] = [];
let identityReads = 0;
let answer: (rpc: Rpc) => Reply = () => ({body: {}});

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const authorized = request.headers.apikey === SERVICE_KEY && request.headers.authorization === `Bearer ${SERVICE_KEY}`;
      if (!authorized) return void response.writeHead(401, {'content-type': 'application/json'}).end('{"message":"denied"}');
      if (request.url?.startsWith('/rest/v1/instance_identity')) {
        identityReads += 1;
        return void response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify([{environment: 'staging', instance_id: INSTANCE}]));
      }
      const name = request.url?.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
      if (!name || request.headers['content-profile'] !== 'api') return void response.writeHead(404).end('{}');
      const rpc = {name, body: JSON.parse(Buffer.concat(chunks).toString() || '{}')};
      rpcs.push(rpc);
      const reply = answer(rpc);
      if (reply === 'drop') return void request.socket.destroy();
      response.writeHead(reply.status ?? 200, {'content-type': 'application/json'}).end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  rpcs = [];
  identityReads = 0;
  answer = () => ({body: {}});
});

const staging = (overrides: Record<string, string | undefined> = {}) => {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    NODE_OPTIONS: preload,
    FIXTURE_ORIGIN: origin,
    APP_ENV: 'staging',
    NEXT_PUBLIC_APP_ENV: 'staging',
    NEXT_PUBLIC_SUPABASE_URL: FIXTURE_HOST,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ADMINISTRATOR_EMAIL: 'admin@example.com',
    INSTANCE_ID: INSTANCE,
    PAID_ADAPTERS_ENABLED: 'false',
    SYNTHETIC_DATA_ENABLED: 'true',
    INVITATION_HASH_KEY: INVITATION_KEY,
    RATE_LIMIT_HASH_KEY: RATE_LIMIT_KEY,
    ...overrides,
  };
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as NodeJS.ProcessEnv;
};

const run = (args: string[], env = staging(), stdin?: string) =>
  new Promise<{code: number; stdout: string; stderr: string}>((done) => {
    const child = spawn(process.execPath, [script, ...args], {env});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => done({code: code ?? 1, stdout, stderr}));
    child.stdin.end(stdin ?? '');
  });

const ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

describe('the --confirm guard outside local', () => {
  const commands: Array<[string, string[]]> = [
    ['preauthorize', ['preauthorize']],
    ['unauthorize', ['unauthorize', '--email', 'someone@example.com']],
    ['issue (named)', ['issue', '--name', 'Daniel']],
    ['issue (general)', ['issue', '--general']],
    ['revoke', ['revoke', '--id', ID]],
    ['list', ['list']],
  ];

  it.each(commands)('refuses %s without --confirm, with exit 2 and no write', async (_name, args) => {
    const result = await run(args);
    expect(result.code, result.stderr).toBe(2);
    expect(result.stderr).toContain('--confirm staging');
    expect(rpcs).toEqual([]);
    expect(result.stdout).toBe('');
  });

  it.each(commands)('refuses %s with the wrong --confirm', async (_name, args) => {
    for (const wrong of ['production', 'local', 'Staging', '', 'staging ']) {
      const result = await run([...args, '--confirm', wrong]);
      expect(result.code, `"${wrong}": ${result.stderr}`).toBe(2);
      expect(rpcs, `"${wrong}"`).toEqual([]);
    }
  });

  it('proceeds with the right --confirm, after checking the environment against the database', async () => {
    answer = ({name}) => ({body: name === 'list_invitations' ? [] : {preauthorization_id: ID, role: 'administrator', created: true, consumed: false, other_administrators: 0}});
    const list = await run(['list', '--confirm', 'staging']);
    expect(list.code, list.stderr).toBe(0);
    expect(list.stdout).toContain('No invitations.');
    const seed = await run(['preauthorize', '--confirm', 'staging']);
    expect(seed.code, seed.stderr).toBe(0);
    expect(rpcs.map((rpc) => rpc.name)).toEqual(['list_invitations', 'seed_preauthorization']);
    expect(identityReads).toBe(2);
  });

  it('checks the identity row before anything is written, and a mixed-up environment writes nothing', async () => {
    const mixed = await run(['preauthorize', '--confirm', 'staging'], staging({INSTANCE_ID: '11111111-1111-4111-8111-111111111111'}));
    expect(mixed.code).toBe(1);
    expect(mixed.stderr).toContain('INSTANCE_ID differs');
    expect(rpcs).toEqual([]);
  });

  it('writes nothing when usage is wrong, even with the right --confirm', async () => {
    for (const args of [[], ['bogus'], ['issue', '--confirm', 'staging'], ['unauthorize', '--confirm', 'staging'], ['revoke', '--confirm', 'staging']]) {
      expect((await run(args)).code, args.join(' ')).toBe(2);
    }
    expect(rpcs).toEqual([]);
    expect(identityReads).toBe(0);
  });

  it('never prints a key', async () => {
    answer = () => ({body: []});
    for (const args of [['list'], ['preauthorize'], ['issue', '--name', 'A']]) {
      const result = await run([...args, '--confirm', 'staging']);
      for (const secret of [SERVICE_KEY, ANON_KEY, INVITATION_KEY, RATE_LIMIT_KEY]) expect(result.stdout + result.stderr, args.join(' ')).not.toContain(secret);
    }
  });
});

describe('the audit actor', () => {
  it('is seed:<APP_ENV>:<operating-system user> on every command', async () => {
    answer = ({name}) => {
      if (name === 'revoke_invitation') return {body: {invitation_id: ID, outcome: 'revoked'}};
      if (name === 'withdraw_preauthorization') return {body: {outcome: 'withdrawn'}};
      if (name === 'issue_invitation') return {body: {outcome: 'issued', invitation_id: ID, kind: 'named', replaced_invitation_id: null}};
      return {body: {preauthorization_id: ID, role: 'administrator', created: true, consumed: false, other_administrators: 0}};
    };
    const operator = userInfo().username.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown';
    for (const args of [['preauthorize'], ['unauthorize', '--email', 'a@b.co'], ['issue', '--name', 'Daniel'], ['revoke', '--id', ID]]) {
      expect((await run([...args, '--confirm', 'staging'])).code, args.join(' ')).toBe(0);
    }
    expect(rpcs.length).toBe(4);
    for (const rpc of rpcs) expect(rpc.body.p_actor, rpc.name).toBe(`seed:staging:${operator}`);
    for (const rpc of rpcs) expect(rpc.body.p_actor).toMatch(/^[a-z][a-z_]*(:[A-Za-z0-9_-]{1,64}){0,2}$/);
  });
});

describe('revoke and unauthorize', () => {
  const revoke = (outcome: string) => {
    answer = () => ({body: {invitation_id: outcome === 'not_found' ? null : ID, outcome}});
  };

  it.each([
    ['revoked', 0, 'Revoked.'],
    ['already_revoked', 0, 'Already revoked.'],
    ['redeemed', 1, 'already redeemed'],
    ['not_found', 1, 'No such invitation.'],
  ])('exits %s with %i', async (outcome, code, message) => {
    revoke(outcome);
    const result = await run(['revoke', '--id', ID, '--confirm', 'staging']);
    expect(result.code, result.stderr).toBe(code);
    expect(result.stdout).toContain(message);
  });

  it('revokes by a code read from standard input, sending only its hash', async () => {
    revoke('revoked');
    const code = '7H2K-9QXM-3NRT-0AB4-VWXY-1234-5678-ZZZZ';
    const result = await run(['revoke', '--code-stdin', '--confirm', 'staging'], staging(), `${code.toLowerCase()}\n`);
    expect(result.code, result.stderr).toBe(0);
    expect(rpcs[0].body.p_code_hash).toBe(hashInvitationCode(code, Buffer.from(INVITATION_KEY, 'base64')));
    expect(JSON.stringify(rpcs)).not.toContain(code);
    expect(result.stdout + result.stderr).not.toContain(code);
  });

  it('exits 2 for an empty standard input, without a request', async () => {
    for (const input of ['', '\n', '   \n\n']) {
      const result = await run(['revoke', '--code-stdin', '--confirm', 'staging'], staging(), input);
      expect(result.code, JSON.stringify(input)).toBe(2);
      expect(result.stderr).toContain('No code was given');
    }
    expect(rpcs).toEqual([]);
  });

  it('exits 1 for something piped in that is not a code, without a request', async () => {
    const result = await run(['revoke', '--code-stdin', '--confirm', 'staging'], staging(), 'hello\n');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('No such invitation.');
    expect(rpcs).toEqual([]);
  });

  it('exits 2 when standard input is an interactive terminal, without echoing a code', async () => {
    const python = spawnSync('python3', ['--version']);
    expect(python.status, 'python3 provides the pseudo-terminal').toBe(0);
    // pty.spawn gives the child a terminal as stdin, as if typed at a prompt.
    const result = spawnSync(
      'python3',
      ['-I', '-c', 'import os, pty, sys; sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))', process.execPath, script, 'revoke', '--code-stdin', '--confirm', 'staging'],
      {env: staging(), encoding: 'utf8', input: ''},
    );
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(result.stdout).toContain('--code-stdin reads the code from a pipe');
    expect(rpcs).toEqual([]);
  });

  it.each([
    ['withdrawn', 0, 'Withdrawn.'],
    ['consumed', 1, 'already signed in'],
    ['not_found', 1, 'No such pre-authorization.'],
  ])('unauthorize exits %s with %i', async (outcome, code, message) => {
    answer = () => ({body: {outcome}});
    const result = await run(['unauthorize', '--email', 'someone@example.com', '--confirm', 'staging']);
    expect(result.code, result.stderr).toBe(code);
    expect(result.stdout).toContain(message);
    expect(rpcs[0].body).toMatchObject({p_email: 'someone@example.com'});
  });
});

describe('issue', () => {
  const issue = (replaced: string | null = null) => {
    answer = ({body}) => ({body: {outcome: 'issued', invitation_id: ID, kind: body.p_kind, replaced_invitation_id: replaced}});
  };

  it('prints a named code once, with its ID, and sends only the hash', async () => {
    issue();
    const result = await run(['issue', '--name', 'Daniel', '--confirm', 'staging']);
    expect(result.code, result.stderr).toBe(0);
    const code = result.stdout.match(/^ {2}((?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4})$/m)?.[1];
    expect(code).toBeTruthy();
    expect(result.stdout.split(code!).length - 1, 'the code is printed exactly once').toBe(1);
    expect(result.stdout).toContain(`Invitation ID: ${ID}`);
    expect(result.stderr).toBe('');
    expect(rpcs[0].body).toMatchObject({p_kind: 'named', p_label: 'Daniel', p_replace: false});
    expect(rpcs[0].body.p_code_hash).toBe(hashInvitationCode(code!, Buffer.from(INVITATION_KEY, 'base64')));
    expect(JSON.stringify(rpcs)).not.toContain(code!);
  });

  it('issues the general code, refuses a second without --replace, and replaces it on request (independent of any database)', async () => {
    issue();
    const first = await run(['issue', '--general', '--confirm', 'staging']);
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain('General invitation code');
    expect(rpcs[0].body).toMatchObject({p_kind: 'general', p_label: null, p_replace: false});

    answer = () => ({body: {outcome: 'exists', invitation_id: ID, kind: 'general', replaced_invitation_id: null}});
    const clash = await run(['issue', '--general', '--confirm', 'staging']);
    expect(clash.code).toBe(1);
    expect(clash.stderr).toContain('--replace');
    expect(clash.stdout).toBe('');

    issue('5b0c9f0e-1111-4222-8333-444455556666');
    const replaced = await run(['issue', '--general', '--replace', '--confirm', 'staging']);
    expect(replaced.code, replaced.stderr).toBe(0);
    expect(rpcs.at(-1)!.body).toMatchObject({p_kind: 'general', p_replace: true});
    expect(replaced.stdout).toContain('Revoked the previous general code: 5b0c9f0e-1111-4222-8333-444455556666');
  });

  it('says the outcome is unknown, and to list and revoke by ID, when the call fails after it may have been applied', async () => {
    for (const reply of [{status: 500, body: {code: 'XX000', message: 'boom'}}, {status: 502, body: {}}, {status: 504, body: {}}, 'drop' as const]) {
      answer = () => reply;
      const result = await run(['issue', '--name', 'Daniel', '--confirm', 'staging']);
      expect(result.code, JSON.stringify(reply)).toBe(1);
      expect(result.stderr).toContain('The outcome is unknown');
      expect(result.stderr).toContain('`list`');
      expect(result.stderr).toContain('revoke by ID');
      expect(result.stdout, 'no code is shown when nothing is known to be stored').toBe('');
    }
  });

  it('says plainly that nothing was issued when the database rejected the request', async () => {
    answer = () => ({status: 400, body: {code: '22023', message: 'invalid argument'}});
    const result = await run(['issue', '--name', 'Daniel', '--confirm', 'staging']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('rejected the input');
    expect(result.stderr).not.toContain('outcome is unknown');
    expect(result.stdout).toBe('');
  });

  it('refuses a missing or weak key before any request', async () => {
    const missing = await run(['issue', '--name', 'Daniel', '--confirm', 'staging'], staging({INVITATION_HASH_KEY: undefined}));
    expect(missing.code).toBe(1);
    // The environment check names it first now that both keys are required everywhere but a preview.
    expect(missing.stderr).toContain('missing required variables: INVITATION_HASH_KEY');
    const weak = await run(['issue', '--name', 'Daniel', '--confirm', 'staging'], staging({INVITATION_HASH_KEY: 'short'}));
    expect(weak.code).toBe(1);
    expect(rpcs).toEqual([]);
  });
});

describe('preauthorize', () => {
  it('seeds the Administrator and each member once, skipping a member that repeats the Administrator', async () => {
    answer = ({body}) => ({body: {preauthorization_id: ID, role: body.p_role, created: true, consumed: false, other_administrators: 0}});
    const result = await run(['preauthorize', '--confirm', 'staging'], staging({SEED_ACCOUNT_EMAILS: 'Admin@Example.com, m1@example.com, m2@example.com, M1@example.com'}));
    expect(result.code, result.stderr).toBe(0);
    expect(rpcs.map((rpc) => [rpc.body.p_email, rpc.body.p_role])).toEqual([
      ['admin@example.com', 'administrator'],
      ['m1@example.com', 'member'],
      ['m2@example.com', 'member'],
    ]);
    expect(result.stderr).toBe('');
  });

  it('warns, without failing, when another administrator pre-authorization exists', async () => {
    answer = ({body}) => ({body: {preauthorization_id: ID, role: body.p_role, created: true, consumed: false, other_administrators: body.p_role === 'administrator' ? 1 : 0}});
    const result = await run(['preauthorize', '--confirm', 'staging']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Warning: 1 other administrator pre-authorization/);
    expect(result.stderr).toContain('unauthorize --email');
    expect(result.stdout).toContain('administrator admin@example.com  pre-authorized');
  });

  it('reports an address that already owns an Account, keeps going, and exits 1', async () => {
    answer = ({body}) =>
      body.p_email === 'm1@example.com'
        ? {status: 400, body: {code: 'N3001', message: 'this address already has an Account'}}
        : {body: {preauthorization_id: ID, role: body.p_role, created: true, consumed: false, other_administrators: 0}};
    const result = await run(['preauthorize', '--confirm', 'staging'], staging({SEED_ACCOUNT_EMAILS: 'm1@example.com, m2@example.com'}));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('m1@example.com  refused');
    expect(result.stderr).toContain('already owns an Account');
    expect(result.stdout).toContain('m2@example.com  pre-authorized');
    expect(rpcs).toHaveLength(3);
  });

  it('tells the two conflicts apart by their codes', async () => {
    answer = () => ({status: 400, body: {code: 'N3002', message: 'another role'}});
    const result = await run(['preauthorize', '--confirm', 'staging']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('already pre-authorized with another role');
    expect(result.stderr).not.toContain('already owns an Account');
  });

  it('stops at once when the database cannot be reached', async () => {
    answer = () => 'drop';
    const result = await run(['preauthorize', '--confirm', 'staging'], staging({SEED_ACCOUNT_EMAILS: 'm1@example.com'}));
    expect(result.code).toBe(1);
    expect(rpcs).toHaveLength(1);
  });
});

describe('list', () => {
  it('prints ID, kind, state, time and label, and never a hash or a code', async () => {
    answer = () => ({
      body: [
        {invitation_id: ID, kind: 'named', label: 'Daniel', state: 'unused', created_at: '2026-10-10T10:00:00+00:00'},
        {invitation_id: '5b0c9f0e-1111-4222-8333-444455556666', kind: 'general', label: null, state: 'revoked', created_at: '2026-10-09T10:00:00+00:00'},
      ],
    });
    const result = await run(['list', '--confirm', 'staging']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${ID}  named   unused   2026-10-10T10:00:00+00:00  Daniel`);
    expect(result.stdout).toContain('5b0c9f0e-1111-4222-8333-444455556666  general revoked  2026-10-09T10:00:00+00:00');
    expect(rpcs[0].body).toEqual({});
  });
});

describe('which hashing keys each command needs', () => {
  const noKeys = {INVITATION_HASH_KEY: undefined, RATE_LIMIT_HASH_KEY: undefined};
  const onlyInvitation = {INVITATION_HASH_KEY: INVITATION_KEY, RATE_LIMIT_HASH_KEY: undefined};
  const onlyRateLimit = {INVITATION_HASH_KEY: undefined, RATE_LIMIT_HASH_KEY: RATE_LIMIT_KEY};
  const fine = (outcome = 'revoked') => {
    answer = ({name}) => {
      if (name === 'list_invitations') return {body: []};
      if (name === 'revoke_invitation') return {body: {invitation_id: ID, outcome}};
      if (name === 'withdraw_preauthorization') return {body: {outcome: 'withdrawn'}};
      if (name === 'seed_preauthorization') return {body: {preauthorization_id: ID, role: 'administrator', created: true, consumed: false, other_administrators: 0}};
      return {body: {invitation_id: ID, outcome: 'issued'}};
    };
  };

  it.each([
    ['list', ['list']],
    ['revoke --id', ['revoke', '--id', ID]],
    ['unauthorize', ['unauthorize', '--email', 'someone@example.com']],
    ['preauthorize', ['preauthorize']],
  ])('%s needs neither key', async (_name, args) => {
    fine();
    const result = await run([...args, '--confirm', 'staging'], staging(noKeys));
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('HASH_KEY');
    expect(rpcs.length).toBeGreaterThan(0);
  });

  it.each([
    ['list', ['list']],
    ['revoke --id', ['revoke', '--id', ID]],
    ['unauthorize', ['unauthorize', '--email', 'someone@example.com']],
    ['preauthorize', ['preauthorize']],
  ])('%s is not stopped by a malformed key it does not use', async (_name, args) => {
    fine();
    const result = await run([...args, '--confirm', 'staging'], staging({INVITATION_HASH_KEY: 'short', RATE_LIMIT_HASH_KEY: '<placeholder>'}));
    expect(result.code, result.stderr).toBe(0);
  });

  it.each([
    ['issue --name', ['issue', '--name', 'Daniel'], undefined],
    ['issue --general', ['issue', '--general'], undefined],
    ['revoke --code-stdin', ['revoke', '--code-stdin'], '7H2K-9QXM-3NRT-0AB4-VWXY-1234-5678-ZZZZ\n'],
  ])('%s needs INVITATION_HASH_KEY only', async (_name, args, input) => {
    fine();
    const withInvitation = await run([...args, '--confirm', 'staging'], staging(onlyInvitation), input);
    expect(withInvitation.code, withInvitation.stderr).toBe(0);
    rpcs = [];
    for (const missing of [noKeys, onlyRateLimit]) {
      const refused = await run([...args, '--confirm', 'staging'], staging(missing), input);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain('missing required variables: INVITATION_HASH_KEY');
      expect(refused.stderr).not.toContain('RATE_LIMIT_HASH_KEY');
    }
    expect(rpcs).toEqual([]);
  });

  it('still refuses a malformed key for the command that uses it, naming the variable and not the value', async () => {
    fine();
    const result = await run(['issue', '--name', 'Daniel', '--confirm', 'staging'], staging({INVITATION_HASH_KEY: 'short'}));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('INVITATION_HASH_KEY must decode to at least 32 bytes');
    expect(result.stderr).not.toContain('short');
  });

  it('keeps every other check: the service key, the identity row and the confirmation', async () => {
    fine();
    const noServiceKey = await run(['list', '--confirm', 'staging'], staging({...noKeys, SUPABASE_SERVICE_ROLE_KEY: undefined}));
    expect(noServiceKey.code).toBe(1);
    expect(noServiceKey.stderr).toContain('SUPABASE_SERVICE_ROLE_KEY');
    const mixed = await run(['list', '--confirm', 'staging'], staging({...noKeys, INSTANCE_ID: '11111111-1111-4111-8111-111111111111'}));
    expect(mixed.code).toBe(1);
    expect(mixed.stderr).toContain('INSTANCE_ID differs');
    const unconfirmed = await run(['list'], staging(noKeys));
    expect(unconfirmed.code).toBe(2);
    expect(rpcs).toEqual([]);
  });
});
