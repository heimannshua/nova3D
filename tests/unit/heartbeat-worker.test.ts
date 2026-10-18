import {spawnSync} from 'node:child_process';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import {resolve} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {readConfig, variableNames} from '../../workers/heartbeat/src/config';
import {dispatchDeadlineMs} from '@/lib/alarms';
import {mailTimeoutMs} from '@/lib/mailer';
import {lines, postTimeoutMs, run} from '../../workers/heartbeat/src/main';
import {heartbeatClaimsOf, verifyToken} from '@/lib/service-signing';
import {testKeys} from '../support/service-keys';

// Story 1.13: the heartbeat task (workers/heartbeat), a cron job that signs ONE heartbeat, posts it once to the application and exits 0 on a 200 and 1 on anything
// else. The application's side (the route that verifies it, records it and answers) is tests/unit/heartbeat-route.test.ts; this is the task, with a fake `fetch`,
// then once over real HTTP to a loopback server, then as the program the image runs.
const root = resolve(import.meta.dirname, '../..');
const instanceId = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const origin = 'https://origin-sentinel.example.test';
const keys = testKeys({issuer: 'heartbeat', active: 'heartbeat-1'});

const goodEnv = (): Record<string, string> => ({
  APP_ENV: 'staging',
  INSTANCE_ID: instanceId,
  APP_ORIGIN: origin,
  SERVICE_KEYS_HEARTBEAT: keys.json,
  SERVICE_SIGNING_KEY_HEARTBEAT: keys.privateKey,
});

type Call = {url: string; init: RequestInit};
function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const call = {url, init};
    calls.push(call);
    return answer(call);
  };
  return {fetch, calls};
}
const respond = (status: number) => () => new Response(JSON.stringify({state: 'recorded', receipt_age_seconds: 212}), {status, headers: {'content-type': 'application/json'}});

async function execute(env: Record<string, string | undefined>, answer: (call: Call) => Response | Promise<Response>, now = () => 1_800_000_000_000) {
  const { fetch, calls } = fakeFetch(answer);
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(env, {fetch, now, log: (line) => out.push(line), error: (line) => err.push(line)});
  return {code, calls, out, err};
}

describe('the configuration: five names, and a problem names the variable and never its value', () => {
  it('reads a complete environment into the endpoint, the lower-cased instance and a signer that is the private half of the active key', () => {
    const read = readConfig({...goodEnv(), INSTANCE_ID: instanceId.toUpperCase()});
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.config.endpoint).toBe(`${origin}/api/heartbeat`);
      expect(read.config.instanceId).toBe(instanceId);
      expect(read.config.appEnv).toBe('staging');
      expect(read.config.signer.kid).toBe(keys.active.kid);
      expect(read.config.signer.issuer).toBe('heartbeat');
    }
  });

  it('names the five variables when none is set, and a placeholder or a blank is as good as unset', () => {
    expect([...variableNames]).toEqual(['APP_ENV', 'INSTANCE_ID', 'APP_ORIGIN', 'SERVICE_KEYS_HEARTBEAT', 'SERVICE_SIGNING_KEY_HEARTBEAT']);
    for (const env of [{}, Object.fromEntries(variableNames.map((name) => [name, '  '])), Object.fromEntries(variableNames.map((name) => [name, 'replace-with-a-value']))]) {
      const read = readConfig(env);
      expect(read).toEqual({ok: false, problems: variableNames.map((name) => `${name} is not set`)});
    }
  });

  it('refuses a value that is wrong, naming the variable and never repeating the value', () => {
    const secret = 'value-that-must-never-be-printed';
    const cases: [Record<string, string>, string][] = [
      [{APP_ENV: secret}, 'APP_ENV must be local, staging or production'],
      [{INSTANCE_ID: secret}, 'INSTANCE_ID must be a UUID'],
      [{APP_ORIGIN: `${origin}/path`}, 'APP_ORIGIN must be an origin'],
      [{APP_ORIGIN: secret}, 'APP_ORIGIN must be an origin'],
      [{APP_ORIGIN: 'http://insecure.example.test'}, 'APP_ORIGIN must be an https origin for staging and production'],
      [{APP_ORIGIN: `https://user:${secret}@host.example.test`}, 'APP_ORIGIN must be an origin'],
      [{SERVICE_KEYS_HEARTBEAT: secret}, 'SERVICE_KEYS_HEARTBEAT: the key set is not JSON'],
      [{SERVICE_KEYS_HEARTBEAT: testKeys().json}, 'SERVICE_KEYS_HEARTBEAT: the key set is for another issuer than heartbeat'],
      [{SERVICE_SIGNING_KEY_HEARTBEAT: secret}, 'SERVICE_SIGNING_KEY_HEARTBEAT:'],
      [{SERVICE_SIGNING_KEY_HEARTBEAT: testKeys({issuer: 'heartbeat', active: 'heartbeat-other'}).privateKey}, 'SERVICE_SIGNING_KEY_HEARTBEAT: the private key is not the private half of the active public key'],
    ];
    for (const [change, expected] of cases) {
      const read = readConfig({...goodEnv(), ...change});
      expect(read.ok, JSON.stringify(Object.keys(change))).toBe(false);
      if (!read.ok) {
        expect(read.problems.join('\n'), JSON.stringify(Object.keys(change))).toContain(expected);
        const text = read.problems.join('\n');
        expect(text).not.toContain(secret);
        expect(text).not.toContain(keys.privateKey);
      }
    }
  });

  it('allows a plain http loopback origin for local, and only there', () => {
    expect(readConfig({...goodEnv(), APP_ENV: 'local', APP_ORIGIN: 'http://127.0.0.1:3000'}).ok).toBe(true);
    expect(readConfig({...goodEnv(), APP_ENV: 'production', APP_ORIGIN: 'http://127.0.0.1:3000'}).ok).toBe(false);
  });
});

describe('a run: one signed request, one fixed line, and an exit code', () => {
  it('posts once to <APP_ORIGIN>/api/heartbeat, a POST with Authorization: Heartbeat <token>, no body, no cookie, no Origin, a timeout, no redirect and no cache', async () => {
    const {code, calls} = await execute(goodEnv(), respond(200));
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    const [{url, init}] = calls;
    expect(url).toBe(`${origin}/api/heartbeat`);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Thirty seconds (it was fifteen): the route may spend up to the mail dispatch's ten-second deadline plus one ten-second send before it answers.
    expect(postTimeoutMs).toBe(30_000);
    expect(postTimeoutMs).toBeGreaterThan(dispatchDeadlineMs + mailTimeoutMs);
    const headers = new Headers(init.headers);
    expect([...headers.keys()]).toEqual(['authorization']);
    expect(headers.get('authorization')).toMatch(/^Heartbeat [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('exits 0 on a 200 and prints the one fixed line, to the normal output', async () => {
    const {code, out, err} = await execute(goodEnv(), respond(200));
    expect([code, out, err]).toEqual([0, [lines.recorded], []]);
  });

  it.each([401, 403, 400, 409, 503, 500, 204, 202])('exits 1 on a %i, with the one fixed line and nothing else, after exactly one request', async (status) => {
    const {code, calls, out, err} = await execute(goodEnv(), () => new Response(status === 204 ? null : JSON.stringify({error: 'invalid_token'}), {status}));
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect([out, err]).toEqual([[], [lines.refused]]);
  });

  it('exits 1 when the request fails: a network error, a timeout, an abort and a redirect (fetch refuses one with redirect: error)', async () => {
    const failures = [new TypeError('fetch failed'), Object.assign(new Error('timed out'), {name: 'TimeoutError'}), Object.assign(new Error('aborted'), {name: 'AbortError'}), new TypeError('redirect mode is set to error')];
    for (const failure of failures) {
      const {code, calls, out, err} = await execute(goodEnv(), () => {
        throw failure;
      });
      expect(code, failure.name).toBe(1);
      expect(calls).toHaveLength(1);
      expect([out, err]).toEqual([[], [lines.unreachable]]);
    }
  });

  it('exits 1 before signing or sending anything when the configuration is wrong, and lists the variables, never their values', async () => {
    const secret = 'value-that-must-never-be-printed';
    const empty = await execute({}, respond(200));
    expect(empty.code).toBe(1);
    expect(empty.calls).toHaveLength(0);
    expect(empty.out).toEqual([]);
    expect(empty.err[0]).toBe(lines.notStarted);
    for (const name of variableNames) expect(empty.err.join('\n'), name).toContain(name);

    const wrong = await execute({...goodEnv(), APP_ENV: secret, SERVICE_SIGNING_KEY_HEARTBEAT: secret}, respond(200));
    expect(wrong.code).toBe(1);
    expect(wrong.calls).toHaveLength(0);
    expect(wrong.err.join('\n')).toContain('APP_ENV');
    expect(wrong.err.join('\n')).toContain('SERVICE_SIGNING_KEY_HEARTBEAT');
    expect(wrong.err.join('\n')).not.toContain(secret);
  });

  it('prints nothing of the run: no token, key, origin, URL, instance or answer is in any line, whatever happened', async () => {
    const seen: string[] = [];
    for (const answer of [respond(200), respond(401), () => { throw new TypeError(`cannot reach ${origin}`); }] as ((call: Call) => Response)[]) {
      const result = await execute(goodEnv(), (call) => {
        seen.push(new Headers(call.init.headers).get('authorization') ?? '');
        return answer(call);
      });
      const text = [...result.out, ...result.err].join('\n');
      for (const forbidden of [origin, 'origin-sentinel', keys.privateKey, instanceId, 'receipt_age_seconds', 'invalid_token', ...seen.map((header) => header.replace('Heartbeat ', ''))]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
      expect(Object.values(lines)).toEqual(expect.arrayContaining(result.out.concat(result.err.filter((line) => !line.startsWith(' ')))));
    }
  });

  it('signs a heartbeat the application accepts: heartbeat issuer, application audience, this instance, type heartbeat, five minutes, a fresh jti each run, no claim beyond the standard ones', async () => {
    const tokens: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const {calls} = await execute(goodEnv(), respond(200), () => 1_800_000_000_000);
      tokens.push((new Headers(calls[0].init.headers).get('authorization') ?? '').replace('Heartbeat ', ''));
    }
    expect(tokens[0]).not.toBe(tokens[1]);
    for (const token of tokens) {
      const verified = await verifyToken(token, {issuer: 'heartbeat', audience: 'application', environment: instanceId, keySet: keys.keySet, now: 1_800_000_000, type: 'heartbeat'});
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.kid).toBe(keys.active.kid);
        expect(heartbeatClaimsOf(verified.payload)).toEqual({});
        expect(Object.keys(verified.payload).sort()).toEqual(['aud', 'env', 'exp', 'iat', 'iss', 'jti', 'typ']);
        expect([verified.payload.iss, verified.payload.aud, verified.payload.env, verified.payload.typ]).toEqual(['heartbeat', 'application', instanceId, 'heartbeat']);
        expect(verified.payload.exp - verified.payload.iat).toBe(300);
        expect(verified.payload.iat).toBe(1_800_000_000);
      }
    }
    // ... and the application rejects it as another issuer's, or for another environment, as it must.
    const other = await verifyToken(tokens[0], {issuer: 'heartbeat', audience: 'application', environment: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', keySet: keys.keySet, now: 1_800_000_000, type: 'heartbeat'});
    expect(other.ok).toBe(false);
  });
});

describe('over real HTTP: a loopback server stands in for the application', () => {
  let server: Server;
  let base = '';
  let status = 200;
  let redirectTo: string | null = null;
  const seen: {method?: string; url?: string; headers: IncomingMessage['headers']; body: string}[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        seen.push({method: request.method, url: request.url, headers: request.headers, body});
        if (redirectTo) response.writeHead(302, {location: redirectTo}).end();
        else response.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify({state: 'recorded', receipt_age_seconds: null}));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  });
  afterAll(() => {
    server.close();
  });

  const localEnv = () => ({...goodEnv(), APP_ENV: 'local', APP_ORIGIN: base});

  it('sends a POST with the heartbeat header and no body, no cookie and no Origin, and exits 0 on a 200', async () => {
    seen.length = 0;
    status = 200;
    redirectTo = null;
    const out: string[] = [];
    expect(await run(localEnv(), {log: (line) => out.push(line), error: (line) => out.push(line)})).toBe(0);
    expect(out).toEqual([lines.recorded]);
    expect(seen).toHaveLength(1);
    expect([seen[0].method, seen[0].url, seen[0].body]).toEqual(['POST', '/api/heartbeat', '']);
    expect(seen[0].headers.authorization).toMatch(/^Heartbeat \S+$/);
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(seen[0].headers.origin).toBeUndefined();
  });

  it('exits 1 on a refusal, and does NOT follow a redirect: the token is sent once, to the one address', async () => {
    seen.length = 0;
    redirectTo = null;
    status = 401;
    expect(await run(localEnv(), {log: () => undefined, error: () => undefined})).toBe(1);
    expect(seen).toHaveLength(1);

    seen.length = 0;
    redirectTo = `${base}/somewhere-else`;
    const err: string[] = [];
    expect(await run(localEnv(), {log: () => undefined, error: (line) => err.push(line)})).toBe(1);
    expect(seen).toHaveLength(1);
    expect(err).toEqual([lines.unreachable]);
  });

  it('exits 1 when nothing answers', async () => {
    const err: string[] = [];
    // A port that nothing listens on: the connection is refused at once.
    expect(await run({...localEnv(), APP_ORIGIN: 'http://127.0.0.1:1'}, {log: () => undefined, error: (line) => err.push(line)})).toBe(1);
    expect(err).toEqual([lines.unreachable]);
  });
});

describe('as the program the image runs', () => {
  it('exits 1 with no environment, listing the five names and no value', () => {
    const result = spawnSync(process.execPath, ['workers/heartbeat/src/main.ts'], {cwd: root, encoding: 'utf8', env: {PATH: process.env.PATH ?? ''} as unknown as NodeJS.ProcessEnv, timeout: 20_000});
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    for (const name of variableNames) expect(result.stderr, name).toContain(name);
    expect(result.stderr).toContain(lines.notStarted);
  });

  it('exits 1 with the one fixed line when nothing answers, through the real entry point (a relative path: the entry check compares real paths), without leaking the key', () => {
    const result = spawnSync(process.execPath, ['workers/heartbeat/src/main.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: {PATH: process.env.PATH ?? '', ...goodEnv(), APP_ENV: 'local', APP_ORIGIN: 'http://127.0.0.1:1'} as unknown as NodeJS.ProcessEnv,
      timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(lines.unreachable);
    expect(result.stdout).toBe('');
    expect(result.stderr + result.stdout).not.toContain(keys.privateKey);
  });
});
