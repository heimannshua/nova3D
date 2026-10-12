#!/usr/bin/env node
// Exercises scripts/check-env.mjs against fixture environments: every row of the Story 1.1
// I/O matrix. A local HTTP server stands in for the Supabase REST endpoint, so this needs no
// database, no credentials and no network. The real stack is covered by tests/integration.
//
// Staging and production must use https, which a plain local server cannot serve. Those cases use
// https://fixture.supabase.co, and a preloaded fetch wrapper (NODE_OPTIONS=--import, set only for the
// child process) forwards that one origin to the local server. Every other URL is untouched.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {after, before, beforeEach, describe, it} from 'node:test';
import {resolve} from 'node:path';

const script = resolve(import.meta.dirname, 'check-env.mjs');
const SERVICE_KEY = 'fixture-service-key-must-never-be-printed';
const ANON_KEY = 'fixture-anon-key-must-never-be-printed';
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_INSTANCE = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const DB_PASSWORD = 'db-password-must-never-be-printed';
const STRIPE_KEY = 'sk_test_must_never_be_printed';
// The three hashing keys (Story 1.3, and the recovery key of Story 1.6): random, at least 32 bytes, different from each other.
const hashKeys = () => ({
  INVITATION_HASH_KEY: randomBytes(32).toString('base64'),
  RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64'),
  RECOVERY_HASH_KEY: randomBytes(32).toString('base64'),
});
const MAIL_KEY = 'resend-fixture-key-must-never-be-printed';
const FIXTURE_HOST = 'https://fixture.supabase.co';
// An address nothing listens on: connections are refused at once and cannot race a freed port.
const NOTHING_LISTENS = 'https://127.0.0.1:1';
const forwardFixtureHost = `const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  return url.origin === "${FIXTURE_HOST}" ? real(process.env.FIXTURE_ORIGIN + url.pathname + url.search, init) : real(input, init);
};`;
const preload = `--import=data:text/javascript,${encodeURIComponent(forwardFixtureHost)}`;

let rows = [];
// What api.preflight answers (the accounts API preflight): an HTTP status and a JSON body.
const accountsOk = () => ({status: 200, body: {ok: true}});
let accountsAnswer = accountsOk();
let origin = '';
let server;
const requests = [];

before(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({url: request.url, method: request.method, headers: request.headers, body});
      const authorized = request.headers.apikey === SERVICE_KEY && request.headers.authorization === `Bearer ${SERVICE_KEY}`;
      if (authorized && request.method === 'POST' && request.headers['content-profile'] === 'api' && request.url === '/rest/v1/rpc/preflight') {
        response.writeHead(accountsAnswer.status, {'content-type': 'application/json'}).end(JSON.stringify(accountsAnswer.body));
        return;
      }
      if (!authorized || request.headers['accept-profile'] !== 'lifecycle' || !request.url?.startsWith('/rest/v1/instance_identity')) {
        response.writeHead(401, {'content-type': 'application/json'}).end('{"message":"denied"}');
        return;
      }
      response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(rows));
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// Every case starts with a healthy accounts API.
beforeEach(() => {
  accountsAnswer = accountsOk();
});

// A complete, valid local environment pointing at the fixture. Each case changes only what it tests.
const local = () => ({
  APP_ENV: 'local',
  NEXT_PUBLIC_APP_ENV: 'local',
  NEXT_PUBLIC_SUPABASE_URL: origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ADMINISTRATOR_EMAIL: 'admin@example.com',
  INSTANCE_ID: INSTANCE,
  PAID_ADAPTERS_ENABLED: 'false',
  SYNTHETIC_DATA_ENABLED: 'true',
  ...hashKeys(),
});
// Staging and production send the recovery mail through Resend and build its link from APP_ORIGIN (Story 1.6).
const staging = () => ({...local(), APP_ENV: 'staging', NEXT_PUBLIC_APP_ENV: 'staging', NEXT_PUBLIC_SUPABASE_URL: FIXTURE_HOST, RESEND_API_KEY: MAIL_KEY, APP_ORIGIN: 'https://nova3d-staging.example.test'});
// A preview holds no Supabase variables, no hashing key and no mail key.
const preview = () => {
  const {NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, INVITATION_HASH_KEY, RATE_LIMIT_HASH_KEY, RECOVERY_HASH_KEY, RESEND_API_KEY, ...rest} = staging();
  return {...rest, VERCEL: '1', VERCEL_ENV: 'preview'};
};
const deployment = () => ({...staging(), VERCEL: '1', VERCEL_ENV: 'production'});

// Runs check-env with ONLY the given variables, so nothing leaks in from the developer's shell.
const run = (env, ...args) =>
  new Promise((done) => {
    execFile(process.execPath, [script, ...args], {env: {PATH: process.env.PATH, NODE_OPTIONS: preload, FIXTURE_ORIGIN: origin, ...env}, encoding: 'utf8'}, (error, stdout, stderr) => {
      done({status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr});
    });
  });

const rejected = (result, text) => {
  assert.equal(result.status, 1, `expected exit 1, got ${result.status}\n${result.stdout}${result.stderr}`);
  assert.ok(result.stderr.includes(text), `expected stderr to include "${text}":\n${result.stderr}`);
  for (const secret of [SERVICE_KEY, ANON_KEY, DB_PASSWORD, STRIPE_KEY]) {
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), 'a secret was printed');
  }
};
const passed = (result) => assert.equal(result.status, 0, `expected exit 0, got ${result.status}\n${result.stdout}${result.stderr}`);

describe('identity matrix', () => {
  it('matching identity: startup proceeds (--live)', async () => {
    rows = [{environment: 'local', instance_id: INSTANCE}];
    const result = await run(local(), '--live');
    passed(result);
    assert.match(result.stdout, /Instance identity verified/);
    assert.ok(requests.some((request) => request.url.startsWith('/rest/v1/instance_identity')));
  });

  it('mixed identity: the row says staging but APP_ENV=production', async () => {
    rows = [{environment: 'staging', instance_id: INSTANCE}];
    rejected(await run({...staging(), APP_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', SYNTHETIC_DATA_ENABLED: 'false', PAID_ADAPTERS_ENABLED: 'true'}, '--live'), 'row says "staging" but APP_ENV is "production"');
  });

  it('mixed identity: the UUID differs, and the error says how to fix it without printing a UUID', async () => {
    rows = [{environment: 'local', instance_id: OTHER_INSTANCE}];
    const result = await run(local(), '--live');
    rejected(result, 'INSTANCE_ID differs from the instance_identity row');
    assert.match(result.stderr, /fix: run node scripts\/setup-env\.mjs local after supabase db reset/);
    for (const uuid of [INSTANCE, OTHER_INSTANCE]) assert.ok(!result.stderr.includes(uuid), 'a UUID was printed');
  });

  it('staging and production must use https', async () => {
    rejected(await run({...staging(), NEXT_PUBLIC_SUPABASE_URL: 'http://abcdefgh.supabase.co'}), 'must use https for staging and production');
    rejected(await run({...staging(), APP_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', SYNTHETIC_DATA_ENABLED: 'false', PAID_ADAPTERS_ENABLED: 'true', NEXT_PUBLIC_SUPABASE_URL: 'http://abcdefgh.supabase.co'}), 'must use https for staging and production');
    passed(await run(staging()));
  });

  it('local with a non-loopback URL is rejected', async () => {
    rejected(await run({...local(), NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co'}), 'valid only against a loopback Supabase URL');
    // Look-alike hosts are not loopback.
    rejected(await run({...local(), NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1.nip.io:54321'}), 'loopback');
    rejected(await run({...local(), NEXT_PUBLIC_SUPABASE_URL: 'http://localhost.example.com'}), 'loopback');
    rejected(await run({...local(), NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1@evil.example.com'}), 'loopback');
  });

  it('local accepts every loopback spelling', async () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://127.1:54321']) {
      passed(await run({...local(), NEXT_PUBLIC_SUPABASE_URL: url}));
    }
  });

  it('preview with any Supabase, database or Stripe variable is rejected, naming it and never its value', async () => {
    const forbidden = {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SUPABASE_ACCESS_TOKEN: 'sbp_fixture_token',
      NEXT_PUBLIC_SUPABASE_URL: FIXTURE_HOST,
      SUPABASE_URL: FIXTURE_HOST,
      DATABASE_URL: `postgres://user:${DB_PASSWORD}@db.example.com/postgres`,
      POSTGRES_URL: `postgres://user:${DB_PASSWORD}@db.example.com/postgres`,
      POSTGRES_PASSWORD: DB_PASSWORD,
      STRIPE_SECRET_KEY: STRIPE_KEY,
      STRIPE_WEBHOOK_SECRET: STRIPE_KEY,
      INVITATION_HASH_KEY: randomBytes(32).toString('base64'),
      RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64'),
      RECOVERY_HASH_KEY: randomBytes(32).toString('base64'),
      RESEND_API_KEY: MAIL_KEY,
    };
    for (const [name, value] of Object.entries(forbidden)) {
      const result = await run({...preview(), [name]: value});
      rejected(result, 'hold no Supabase, database or Stripe variables');
      assert.ok(result.stderr.includes(name), `${name} was not named`);
      assert.ok(!result.stderr.includes(value), `${name}'s value was printed`);
    }
  });

  it('a development deployment is held to the same rule', async () => {
    rejected(await run({...preview(), VERCEL_ENV: 'development', STRIPE_SECRET_KEY: STRIPE_KEY}), 'hold no Supabase, database or Stripe variables');
  });

  it('preview without keys passes label-only checks and never reads the database', async () => {
    const before = requests.length;
    for (const args of [[], ['--live'], ['--deployment']]) passed(await run(preview(), ...args));
    assert.equal(requests.length, before, 'a preview contacted the database');
  });

  it('credential-free local build: --deployment does nothing without VERCEL', async () => {
    const result = await run({});
    assert.equal(result.status, 1, 'plain check-env still needs a full environment');
    const skipped = await run({}, '--deployment');
    passed(skipped);
    assert.match(skipped.stdout, /skipped/);
  });

  it('missing ADMINISTRATOR_EMAIL is rejected', async () => {
    const {ADMINISTRATOR_EMAIL, ...env} = local();
    rejected(await run(env), 'ADMINISTRATOR_EMAIL');
    rejected(await run({...local(), ADMINISTRATOR_EMAIL: ''}), 'ADMINISTRATOR_EMAIL');
    rejected(await run({...local(), ADMINISTRATOR_EMAIL: 'not-an-email'}), 'ADMINISTRATOR_EMAIL must be one email address');
    rejected(await run({...preview(), ADMINISTRATOR_EMAIL: ''}), 'ADMINISTRATOR_EMAIL');
  });

  it('missing or malformed INSTANCE_ID is rejected', async () => {
    const {INSTANCE_ID, ...env} = local();
    rejected(await run(env), 'INSTANCE_ID');
    rejected(await run({...local(), INSTANCE_ID: 'not-a-uuid'}), 'INSTANCE_ID must be a UUID');
  });

  it('staging deployment build: VERCEL set, VERCEL_ENV=production, row matches', async () => {
    rows = [{environment: 'staging', instance_id: INSTANCE}];
    const result = await run(deployment(), '--deployment');
    passed(result);
    assert.match(result.stdout, /Instance identity verified/);
  });

  it('deployment build fails closed when the row is absent', async () => {
    rows = [];
    rejected(await run(deployment(), '--deployment'), 'instance_identity has no row');
  });

  it('deployment build fails closed when the database is unreachable', async () => {
    rows = [{environment: 'staging', instance_id: INSTANCE}];
    rejected(await run({...deployment(), NEXT_PUBLIC_SUPABASE_URL: NOTHING_LISTENS}, '--deployment'), 'unreachable');
  });

  it('deployment build rejects a row that belongs to another environment', async () => {
    rows = [{environment: 'local', instance_id: INSTANCE}];
    rejected(await run(deployment(), '--deployment'), 'row says "local" but APP_ENV is "staging"');
  });

  it('--live rejects a wrong service key without echoing it', async () => {
    rows = [{environment: 'local', instance_id: INSTANCE}];
    rejected(await run({...local(), SUPABASE_SERVICE_ROLE_KEY: 'a-different-key'}, '--live'), 'HTTP 401');
  });
});

describe('the accounts API preflight (Story 1.3)', () => {
  const fixtureRows = () => {
    rows = [{environment: 'local', instance_id: INSTANCE}];
    accountsAnswer = accountsOk();
  };

  it('--live calls api.preflight with the service role and says so', async () => {
    fixtureRows();
    const before = requests.length;
    const result = await run(local(), '--live');
    passed(result);
    assert.match(result.stdout, /the accounts API answered/);
    const asked = requests.slice(before).find((request) => request.url === '/rest/v1/rpc/preflight');
    assert.ok(asked, 'authorize_session was not called');
    assert.equal(asked.method, 'POST');
    assert.equal(asked.headers['content-profile'], 'api');
    assert.deepEqual(JSON.parse(asked.body), {});
  });

  it('--live fails in one line when the api schema is not exposed, the migrations are missing or the key is refused', async () => {
    for (const [status, text] of [[406, 'HTTP 406'], [404, 'HTTP 404'], [401, 'HTTP 401'], [403, 'HTTP 403']]) {
      fixtureRows();
      accountsAnswer = {status, body: {message: 'nope'}};
      const result = await run(local(), '--live');
      rejected(result, 'the accounts API cannot be verified');
      assert.ok(result.stderr.includes(text), result.stderr);
      assert.ok(result.stderr.includes('api schema exposed'), result.stderr);
      assert.equal(result.stderr.split('\n').filter((line) => line.includes('accounts API')).length, 1, 'more than one line');
    }
  });

  it('--live fails when the answer is not ok', async () => {
    fixtureRows();
    accountsAnswer = {status: 200, body: {ok: false}};
    rejected(await run(local(), '--live'), 'api.preflight did not answer ok');
  });

  it('the deployment build runs it too, and fails closed', async () => {
    rows = [{environment: 'staging', instance_id: INSTANCE}];
    accountsAnswer = accountsOk();
    const result = await run(deployment(), '--deployment');
    passed(result);
    assert.match(result.stdout, /the accounts API answered/);
    accountsAnswer = {status: 406, body: {code: 'PGRST106'}};
    rejected(await run(deployment(), '--deployment'), 'the accounts API cannot be verified');
  });

  it('does not run without --live, and does not mask an identity mismatch', async () => {
    fixtureRows();
    accountsAnswer = {status: 406, body: {}};
    const before = requests.length;
    passed(await run(local()));
    assert.equal(requests.length, before, 'a plain check contacted the database');
    rows = [{environment: 'local', instance_id: OTHER_INSTANCE}];
    rejected(await run(local(), '--live'), 'INSTANCE_ID differs from the instance_identity row');
  });

  it('never runs for a preview', async () => {
    fixtureRows();
    accountsAnswer = {status: 406, body: {}};
    const before = requests.length;
    for (const args of [[], ['--live'], ['--deployment']]) passed(await run(preview(), ...args));
    assert.equal(requests.length, before, 'a preview contacted the database');
  });
});

describe('static rules kept from the seed', () => {
  it('rejects placeholder credentials', async () => {
    rejected(await run({...local(), NEXT_PUBLIC_SUPABASE_ANON_KEY: 'replace-with-local-anon-key'}), 'placeholder values are not allowed');
    rejected(await run({...local(), INSTANCE_ID: '<staging-instance-id>'}), 'placeholder values are not allowed');
  });

  it('requires all three hashing keys outside a preview (Stories 1.3 and 1.6)', async () => {
    for (const name of ['INVITATION_HASH_KEY', 'RATE_LIMIT_HASH_KEY', 'RECOVERY_HASH_KEY']) {
      const {[name]: _missing, ...without} = local();
      rejected(await run(without), `missing required variables: ${name}`);
      rejected(await run({...local(), [name]: ''}), name);
      rejected(await run({...local(), [name]: `<${name.toLowerCase()}>`}), 'placeholder values are not allowed');
      rejected(await run({...local(), [name]: 'too-short-to-be-a-key'}), `${name} must decode to at least 32 bytes`);
    }
    const same = randomBytes(32).toString('base64');
    rejected(await run({...local(), INVITATION_HASH_KEY: same, RATE_LIMIT_HASH_KEY: same}), 'must be different keys');
    rejected(await run({...local(), INVITATION_HASH_KEY: same, RECOVERY_HASH_KEY: same}), 'INVITATION_HASH_KEY and RECOVERY_HASH_KEY must be different keys');
    rejected(await run({...local(), RATE_LIMIT_HASH_KEY: same, RECOVERY_HASH_KEY: same}), 'RATE_LIMIT_HASH_KEY and RECOVERY_HASH_KEY must be different keys');
    passed(await run(local()));
    passed(await run(staging()));
  });

  it('requires the mail key and the link origin in staging and production, but not locally (Story 1.6)', async () => {
    const production = () => ({...staging(), APP_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', SYNTHETIC_DATA_ENABLED: 'false', PAID_ADAPTERS_ENABLED: 'true', APP_ORIGIN: 'https://nova3d.example.test'});
    for (const environment of [staging(), production()]) {
      for (const name of ['RESEND_API_KEY', 'APP_ORIGIN']) {
        const {[name]: _missing, ...without} = environment;
        rejected(await run(without), `missing required variables: ${name}`);
      }
      passed(await run(environment));
    }
    rejected(await run({...staging(), APP_ORIGIN: '<staging-app-origin>'}), 'placeholder values are not allowed');
    rejected(await run({...staging(), APP_ORIGIN: 'http://nova3d-staging.example.test'}), 'APP_ORIGIN must be an https origin for staging and production');
    rejected(await run({...staging(), APP_ORIGIN: 'https://nova3d-staging.example.test/recover'}), 'APP_ORIGIN must be an origin and nothing more');
    const spaced = 'a key with spaces that must never be printed';
    const result = await run({...staging(), RESEND_API_KEY: spaced});
    rejected(result, 'RESEND_API_KEY must be one token without spaces');
    assert.ok(!result.stderr.includes(spaced), 'the mail key was printed');
    // Locally the mail goes to the stack's Mailpit and the link uses the request's origin.
    passed(await run(local()));
  });

  it('does not require the keys in a preview, which must not hold them', async () => {
    passed(await run(preview()));
    rejected(await run({...preview(), RATE_LIMIT_HASH_KEY: randomBytes(32).toString('base64')}), 'RATE_LIMIT_HASH_KEY');
    rejected(await run({...preview(), RECOVERY_HASH_KEY: randomBytes(32).toString('base64')}), 'RECOVERY_HASH_KEY');
    rejected(await run({...preview(), RESEND_API_KEY: MAIL_KEY}), 'RESEND_API_KEY');
  });

  it('rejects synthetic data in production', async () => {
    rejected(await run({...local(), APP_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production', SYNTHETIC_DATA_ENABLED: 'true'}), 'production cannot enable synthetic data');
  });

  it('keeps previews on staging with paid adapters off', async () => {
    rejected(await run({...preview(), APP_ENV: 'production', NEXT_PUBLIC_APP_ENV: 'production'}), 'must use APP_ENV=staging');
    rejected(await run({...preview(), PAID_ADAPTERS_ENABLED: 'true'}), 'PAID_ADAPTERS_ENABLED=false');
    rejected(await run({...preview(), SYNTHETIC_DATA_ENABLED: 'false'}), 'SYNTHETIC_DATA_ENABLED=true');
  });

  it('rejects an unknown environment and a bad URL', async () => {
    rejected(await run({...local(), APP_ENV: 'qa', NEXT_PUBLIC_APP_ENV: 'qa', NEXT_PUBLIC_SUPABASE_URL: 'not-a-url'}), 'APP_ENV must be local');
    rejected(await run({...local(), NEXT_PUBLIC_SUPABASE_URL: 'not-a-url'}), 'NEXT_PUBLIC_SUPABASE_URL must be a valid URL');
  });

  it('no longer ties VERCEL_ENV=production to APP_ENV=production', async () => {
    rows = [{environment: 'staging', instance_id: INSTANCE}];
    passed(await run(deployment()));
  });

  it('rejects unknown options', async () => {
    assert.equal((await run(local(), '--bogus')).status, 2);
  });
});
