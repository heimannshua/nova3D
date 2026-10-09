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
import {createServer} from 'node:http';
import {after, before, describe, it} from 'node:test';
import {resolve} from 'node:path';

const script = resolve(import.meta.dirname, 'check-env.mjs');
const SERVICE_KEY = 'fixture-service-key-must-never-be-printed';
const ANON_KEY = 'fixture-anon-key-must-never-be-printed';
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_INSTANCE = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const DB_PASSWORD = 'db-password-must-never-be-printed';
const STRIPE_KEY = 'sk_test_must_never_be_printed';
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
let origin = '';
let server;
const requests = [];

before(async () => {
  server = createServer((request, response) => {
    requests.push({url: request.url, headers: request.headers});
    const authorized = request.headers.apikey === SERVICE_KEY && request.headers.authorization === `Bearer ${SERVICE_KEY}`;
    if (!authorized || request.headers['accept-profile'] !== 'lifecycle' || !request.url?.startsWith('/rest/v1/instance_identity')) {
      response.writeHead(401, {'content-type': 'application/json'}).end('{"message":"denied"}');
      return;
    }
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(rows));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// A complete, valid local environment pointing at the fixture. Each case changes only what it tests.
const local = () => ({
  APP_ENV: 'local',
  NEXT_PUBLIC_APP_ENV: 'local',
  NEXT_PUBLIC_SUPABASE_URL: origin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  ADMINISTRATOR_EMAIL: 'admin@example.com',
  INSTANCE_ID: INSTANCE,
  AUTH_ALLOWED_EMAILS: 'heimannshua@gmail.com,daniel@orvex.ai',
  PAID_ADAPTERS_ENABLED: 'false',
  SYNTHETIC_DATA_ENABLED: 'true',
});
const staging = () => ({...local(), APP_ENV: 'staging', NEXT_PUBLIC_APP_ENV: 'staging', NEXT_PUBLIC_SUPABASE_URL: FIXTURE_HOST});
const preview = () => {
  const {NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ...rest} = staging();
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
    assert.ok(requests.at(-1).url.startsWith('/rest/v1/instance_identity'));
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

describe('static rules kept from the seed', () => {
  it('rejects placeholder credentials', async () => {
    rejected(await run({...local(), NEXT_PUBLIC_SUPABASE_ANON_KEY: 'replace-with-local-anon-key'}), 'placeholder values are not allowed');
    rejected(await run({...local(), INSTANCE_ID: '<staging-instance-id>'}), 'placeholder values are not allowed');
  });

  it('requires the interim allowlist until Story 1.3 replaces it', async () => {
    rejected(await run({...local(), AUTH_ALLOWED_EMAILS: ''}), 'AUTH_ALLOWED_EMAILS must contain at least one email address');
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
