import {randomUUID} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as route from '@/app/api/workers/route';
import {handleWorkerRequest, maxWorkerBodyBytes} from '@/lib/worker-commands';
import {bodyDigest, newJti} from '@/lib/service-signing';
import {signRaw, testKeys} from '../support/service-keys';
import {testWorker} from '../support/job-world';

// The signed worker endpoint (Story 2.7, lib/worker-commands.ts) without a database: the handler is called with a Request signed by the tests' own worker keys, the database is a
// stand-in for the functions it calls (api.record_callback and the commands), and what the route does with a token, a digest, a body and an answer is read off the Response. The
// real functions are covered by tests/integration/job-dispatch.test.ts. The contract: ONE reasonless 401 for every verification failure, and nothing is written by a refused call.
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ATTEMPT = 'bb8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6c';
const JOB = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const STEP = 'dd8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6e';
const OPERATION = 'ee8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6f';
const WORKER = '1a8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b61';
const FENCE = '2b8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b62';
const SCHEDULE = '3c8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b63';
const DIGEST = 'a'.repeat(64);
const later = '2026-10-29T12:02:00.000000+00:00';

const cad = testWorker('cad-worker', INSTANCE);
const engine = testWorker('engine-worker', INSTANCE);
const baseEnv: Record<string, string> = {
  INSTANCE_ID: INSTANCE,
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only',
  ...cad.environment,
  ...engine.environment,
};

type Sent = {name: string; body: Record<string, unknown>};
let sent: Sent[];
let answers: Record<string, (body: Record<string, unknown>) => Response | Promise<Response>>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const database = async (input: string, init?: RequestInit): Promise<Response> => {
  const name = String(input).split('/rpc/')[1];
  const body = JSON.parse(String(init?.body));
  sent.push({name, body});
  const answer = answers[name];
  if (!answer) throw new Error(`the test did not expect api.${name}`);
  return answer(body);
};
const names = () => sent.map((call) => call.name);

beforeEach(() => {
  sent = [];
  answers = {record_callback: () => json({outcome: 'recorded'})};
});
afterEach(() => vi.restoreAllMocks());

const handle = (request: Request, env: Record<string, string | undefined> = baseEnv, now?: () => number) => handleWorkerRequest(request, {env, accounts: {fetch: database}, now});

// The claims of each command, and the body each takes.
const claims = {
  register: {cmd: 'register'} as const,
  claim: {cmd: 'claim', att: ATTEMPT, wid: WORKER} as const,
  renew: {cmd: 'renew', att: ATTEMPT, fence: FENCE} as const,
  step: {cmd: 'step', att: ATTEMPT, fence: FENCE} as const,
  operation: {cmd: 'operation', att: ATTEMPT, fence: FENCE} as const,
  finish: {cmd: 'finish', att: ATTEMPT, fence: FENCE, rev: 7} as const,
};
const registerBody = {worker_kind: 'test_cad', version: 2, image_digest: DIGEST, kinds: ['test_workload']};
const claimedFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'claimed',
  attempt_id: ATTEMPT,
  job_id: JOB,
  kind: 'test_workload',
  fence: FENCE,
  expires_at: later,
  plan: {outcome: 'fail', operations: [{step_key: 'search', ordinal: 1, schedule_id: SCHEDULE, provider: 'fixture', model: 'fixture-model', api_version: 'fixture-1', request_bytes: 1000, image_count: 0, output_limit: 100}]},
  input_digest: DIGEST,
  project_revision: 7,
  account_epoch: 3,
  worker_version: 2,
  state: 'running',
  ...patch,
});

/** A POST that carries a token the test made and a body as written, with whatever headers the test adds. */
const raw = (token: string | null, body: string, headers: Record<string, string> = {}) =>
  new Request('http://127.0.0.1:4173/api/workers', {method: 'POST', headers: {...(token === null ? {} : {authorization: `Bearer ${token}`}), 'content-type': 'application/json', ...headers}, body});

const invalid = async (response: Response) => {
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({error: 'invalid_token'});
};

/** A payload as the CAD worker would sign it, except for what a test changes; signed with `signer`. */
function forged(change: Record<string, unknown> = {}, signer = cad.signer, body = '{}') {
  const now = Math.floor(Date.now() / 1000);
  const payload = {iss: 'cad-worker', aud: 'application', env: INSTANCE, jti: newJti(), iat: now, exp: now + 300, typ: 'worker-command', cmd: 'claim', dig: bodyDigest(body), att: ATTEMPT, wid: WORKER, ...change};
  // (Through JSON, as a payload goes into a token: a member that is undefined is not there.)
  return signRaw(signer, JSON.parse(JSON.stringify(payload)));
}

describe('the route is one POST', () => {
  it('exports a POST handler and no other method, so Next.js answers 405 for the rest, and is never static', () => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic']);
    expect(route.dynamic).toBe('force-dynamic');
    expect(maxWorkerBodyBytes).toBe(8192);
  });
});

describe('1. method, 2. origin, 3. configuration', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('answers 405 with Allow: POST for %s and asks nothing', async (method) => {
    const response = await handle(new Request('http://127.0.0.1:4173/api/workers', {method}));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(sent).toEqual([]);
  });

  it('answers 403 for a request that names an Origin (a browser, not a worker), before it looks at the token, and asks nothing', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:4173']) {
      const response = await handle(cad.request(claims.claim, {}, {}, {origin}));
      expect([response.status, await response.json()]).toEqual([403, {error: 'forbidden_origin'}]);
    }
    expect(sent).toEqual([]);
  });

  it.each([
    ['no instance', {INSTANCE_ID: undefined}],
    ['an empty instance', {INSTANCE_ID: '  '}],
    ['a placeholder instance', {INSTANCE_ID: 'replace-with-the-instance'}],
  ])('answers 503, never a success, with %s, for a command that is signed and one that is not', async (_name, change) => {
    for (const request of [cad.request(claims.claim, {}), raw(null, '{}')]) {
      const response = await handle(request, {...baseEnv, ...change});
      expect([response.status, await response.json()]).toEqual([503, {error: 'unavailable'}]);
    }
    expect(sent).toEqual([]);
  });
});

describe('4. size and 5. the token: ONE reasonless 401, and nothing is written', () => {
  const refused = async (response: Response) => {
    await invalid(response);
    // Nothing was recorded and nothing was run.
    expect(sent).toEqual([]);
  };

  it('refuses a call with no Authorization header, one that is not a Bearer token, and one with no token', async () => {
    await refused(await handle(raw(null, '{}')));
    await refused(await handle(raw(null, '{}', {authorization: 'Basic dXNlcjpwYXNz'})));
    await refused(await handle(raw(null, '{}', {authorization: 'Bearer'})));
    await refused(await handle(raw(null, '{}', {authorization: 'Bearer '})));
    await refused(await handle(raw(null, '{}', {authorization: 'Bearer two tokens'})));
    await refused(await handle(raw(null, '{}', {authorization: 'Heartbeat abc.def.ghi'})));
  });

  it('refuses a token that is not shaped like one, and one that is far too long', async () => {
    for (const token of ['not-a-token', 'a.b.c', '..', `${'a'.repeat(5000)}.b.c`, `${'a'.repeat(30)}.${Buffer.from('{"iss":"cad-worker"}').toString('base64url')}.${'c'.repeat(86)}`]) {
      await refused(await handle(raw(token, '{}')));
    }
  });

  it('refuses a body over 8 KB (declared or sent), a content-length that is not a number, and a stream that fails, as a failed verification', async () => {
    const big = JSON.stringify({padding: 'x'.repeat(maxWorkerBodyBytes)});
    await refused(await handle(cad.request(claims.claim, big)));
    await refused(await handle(raw(cad.token(claims.claim, '{}'), '{}', {'content-length': '99999999'})));
    await refused(await handle(raw(cad.token(claims.claim, '{}'), '{}', {'content-length': 'many'})));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
        controller.error(new Error('connection reset'));
      },
    });
    const failing = new Request('http://127.0.0.1:4173/api/workers', {method: 'POST', headers: {authorization: `Bearer ${cad.token(claims.claim, '{}')}`}, body: stream, duplex: 'half'} as RequestInit);
    await refused(await handle(failing));
  });

  it('refuses a token for another environment', async () => {
    await refused(await handle(cad.request(claims.claim, {}, {environment: randomUUID()})));
  });

  it('refuses a token for another audience, another type and another issuer than the worker route takes', async () => {
    await refused(await handle(raw(forged({aud: 'gateway'}), '{}')));
    await refused(await handle(raw(forged({typ: 'ticket'}), '{}')));
    await refused(await handle(raw(forged({typ: 'heartbeat'}), '{}')));
    await refused(await handle(raw(forged({iss: 'application'}), '{}')));
    await refused(await handle(raw(forged({iss: 'heartbeat'}), '{}')));
    await refused(await handle(raw(forged({iss: 'gateway'}), '{}')));
    await refused(await handle(raw(forged({iss: undefined}), '{}')));
  });

  it('refuses a signature that was altered, and a token signed with a key of another worker type', async () => {
    const good = cad.token(claims.claim, '{}');
    const [header, payload, signature] = good.split('.');
    const flipped = `${header}.${payload}.${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;
    await refused(await handle(raw(flipped, '{}')));
    // The engine worker's key signs a token that names the CAD worker: the CAD worker's key set does not verify it.
    await refused(await handle(raw(forged({}, engine.signer), '{}')));
    // ... and the CAD worker's key signs a token that names the engine worker: the engine's key set does not.
    await refused(await handle(raw(forged({iss: 'engine-worker'}, cad.signer), '{}')));
  });

  it('refuses a token signed by a key that is not the issuer\'s active key (or its retiring key): a key set the worker route has never heard of', async () => {
    const stranger = testWorker('cad-worker', INSTANCE, {label: 'cad-worker-stranger'});
    await refused(await handle(stranger.request(claims.claim, {})));
  });

  it('refuses a token whose issuer has no key set in this environment (an issuer that is not configured), however well it is signed', async () => {
    const {SERVICE_KEYS_ENGINE_WORKER: _dropped, ...withoutEngine} = baseEnv;
    await refused(await handle(engine.request(claims.claim, {}), withoutEngine));
    await refused(await handle(engine.request(claims.claim, {}), {...baseEnv, SERVICE_KEYS_ENGINE_WORKER: '   '}));
    await refused(await handle(engine.request(claims.claim, {}), {...baseEnv, SERVICE_KEYS_ENGINE_WORKER: 'replace-with-the-public-keys'}));
    await refused(await handle(engine.request(claims.claim, {}), {...baseEnv, SERVICE_KEYS_ENGINE_WORKER: 'not json'}));
    // A key set for the other issuer under this issuer's name is refused too.
    await refused(await handle(engine.request(claims.claim, {}), {...baseEnv, SERVICE_KEYS_ENGINE_WORKER: cad.keySetJson}));
    // The CAD worker is unaffected.
    answers.claim_attempt = () => json(claimedFields());
    expect((await handle(cad.request(claims.claim, {}), withoutEngine)).status).toBe(200);
  });

  it('refuses a token that lives longer than five minutes, one issued more than a minute ahead and one that has expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    await refused(await handle(raw(forged({iat: now, exp: now + 301}), '{}')));
    await refused(await handle(raw(forged({iat: now, exp: now}), '{}')));
    await refused(await handle(raw(forged({iat: now + 120, exp: now + 400}), '{}')));
    await refused(await handle(cad.request(claims.claim, {}, {now: now + 120})));
    await refused(await handle(cad.request(claims.claim, {}, {now: now - 1000, lifetimeSeconds: 300})));
    // A skew inside a minute is allowed, as is a token that is about to expire.
    answers.claim_attempt = () => json(claimedFields());
    expect((await handle(cad.request(claims.claim, {}, {now: now + 30}))).status).toBe(200);
    expect((await handle(cad.request(claims.claim, {}, {now: now - 290, lifetimeSeconds: 300}))).status).toBe(200);
  });

  it('takes its clock from the handler\'s `now`, in seconds (the tests pin it)', async () => {
    const fixed = 1_800_000_000;
    answers.claim_attempt = () => json(claimedFields());
    expect((await handle(cad.request(claims.claim, {}, {now: fixed}), baseEnv, () => fixed)).status).toBe(200);
    sent = [];
    await refused(await handle(cad.request(claims.claim, {}, {now: fixed}), baseEnv, () => fixed + 400));
  });

  it.each([
    ['an unknown command', {cmd: 'delete'}],
    ['no command', {cmd: undefined}],
    ['a claim with no attempt', {att: undefined}],
    ['a claim with an attempt that is not an ID', {att: 'nope'}],
    ['a claim with no worker', {wid: undefined}],
    ['a claim with a fence as well', {fence: FENCE}],
    ['a claim with a revision as well', {rev: 3}],
    ['a claim with a claim of its own invention', {extra: 'x'}],
    ['no digest', {dig: undefined}],
    ['a digest in upper case', {dig: bodyDigest('{}').toUpperCase()}],
    ['a register with an attempt', {cmd: 'register'}],
    ['a renew with no fence', {cmd: 'renew', wid: undefined}],
    ['a finish with no revision', {cmd: 'finish', wid: undefined, fence: FENCE}],
    ['a finish with a revision of 0', {cmd: 'finish', wid: undefined, fence: FENCE, rev: 0}],
  ])('refuses a token that carries %s', async (_label, change) => {
    await refused(await handle(raw(forged(change), '{}')));
  });
});

describe('5. a key that is rotating', () => {
  it('accepts a token signed by the retiring key inside its window, and refuses one past its `until`', async () => {
    const now = Date.now();
    const retiringSigner = testWorker('cad-worker', INSTANCE, {label: 'cad-worker-1'});
    answers.claim_attempt = () => json(claimedFields());
    const inside = testKeys({issuer: 'cad-worker', active: 'cad-worker-2', retiring: {label: 'cad-worker-1', until: new Date(now + 5 * 60_000)}}).json;
    const insideResponse = await handle(retiringSigner.request(claims.claim, {}), {...baseEnv, SERVICE_KEYS_CAD_WORKER: inside});
    expect(insideResponse.status).toBe(200);
    expect(names()).toEqual(['record_callback', 'claim_attempt']);
    expect(sent[0].body.p_kid).toBe('test-cad-worker-1');

    sent = [];
    const past = testKeys({issuer: 'cad-worker', active: 'cad-worker-2', retiring: {label: 'cad-worker-1', until: new Date(now - 60_000)}}).json;
    await invalid(await handle(retiringSigner.request(claims.claim, {}), {...baseEnv, SERVICE_KEYS_CAD_WORKER: past}));
    expect(sent).toEqual([]);
  });

  it('accepts the new active key at once, and the old active key is refused when it is neither active nor retiring', async () => {
    answers.claim_attempt = () => json(claimedFields());
    const newer = testWorker('cad-worker', INSTANCE, {label: 'cad-worker-2'});
    expect((await handle(newer.request(claims.claim, {}), {...baseEnv, ...newer.environment})).status).toBe(200);
    sent = [];
    await invalid(await handle(cad.request(claims.claim, {}), {...baseEnv, ...newer.environment}));
    expect(sent).toEqual([]);
  });
});

describe('6. the digest', () => {
  it('refuses a body that is not the one the token vouches for: one character more, one less, other bytes, a different spacing', async () => {
    const token = cad.token(claims.claim, '{}');
    for (const body of ['{ }', '{}\n', '', '[]', '{"a":1}', ' {}']) {
      await invalid(await handle(raw(token, body)));
    }
    expect(sent).toEqual([]);
  });

  it('accepts the exact bytes, whatever the JSON means: the digest is over the raw body', async () => {
    answers.claim_attempt = () => json(claimedFields());
    expect((await handle(raw(cad.token(claims.claim, '{}'), '{}'))).status).toBe(200);
  });

  it('is checked before the callback is recorded: a refused digest records nothing', async () => {
    await invalid(await handle(raw(cad.token(claims.renew, '{}'), '{"x":1}')));
    expect(names()).not.toContain('record_callback');
  });
});

describe('7. the record: a replayed jti and a revoked key', () => {
  it('records the jti, issuer, key ID, type, command, attempt and the digest of the raw body, once, before the command runs', async () => {
    answers.renew_lease = () => json({outcome: 'renewed', attempt_id: ATTEMPT, expires_at: later, state: 'running'});
    const request = cad.request(claims.renew, {});
    const token = request.headers.get('authorization')!.slice('Bearer '.length);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect((await handle(request)).status).toBe(200);
    expect(names()).toEqual(['record_callback', 'renew_lease']);
    expect(sent[0].body).toEqual({
      p_jti: payload.jti,
      p_issuer: 'cad-worker',
      p_kid: 'test-cad-worker-1',
      p_typ: 'worker-command',
      p_command: 'renew',
      p_attempt_id: ATTEMPT,
      p_digest: bodyDigest('{}'),
    });
  });

  it('records no attempt for a registration, and the issuer of the token for an engine worker', async () => {
    answers.register_worker = () => json({outcome: 'registered', worker_id: WORKER, version: 2, retired: 0});
    expect((await handle(engine.request(claims.register, registerBody))).status).toBe(200);
    expect(sent[0].body).toMatchObject({p_issuer: 'engine-worker', p_kid: 'test-engine-worker-1', p_command: 'register', p_attempt_id: null});
  });

  it('refuses a replayed jti with the one 401 and runs nothing: the same token sent twice runs once', async () => {
    const seen = new Set<string>();
    answers.record_callback = (body) => {
      const duplicate = seen.has(String(body.p_jti));
      seen.add(String(body.p_jti));
      return json({outcome: duplicate ? 'duplicate' : 'recorded'});
    };
    answers.renew_lease = () => json({outcome: 'renewed', attempt_id: ATTEMPT, expires_at: later, state: 'running'});
    const request = () => cad.request(claims.renew, {}, {jti: 'REPLAYEDREPLAYEDREPLAY'.slice(0, 22)});
    expect((await handle(request())).status).toBe(200);
    await invalid(await handle(request()));
    expect(names()).toEqual(['record_callback', 'renew_lease', 'record_callback']);
  });

  it('refuses a revoked key with the one 401 and runs nothing', async () => {
    answers.record_callback = () => json({outcome: 'revoked'});
    await invalid(await handle(cad.request(claims.renew, {})));
    expect(names()).toEqual(['record_callback']);
  });

  it('answers 503, not a 401 and not a success, when the database does not answer the record: the worker may send a new token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const answer of [() => json({message: 'down'}, 503), () => { throw new TypeError('fetch failed'); }]) {
      sent = [];
      answers.record_callback = answer;
      const response = await handle(cad.request(claims.renew, {}));
      expect([response.status, await response.json()]).toEqual([503, {error: 'unavailable'}]);
      expect(names()).toEqual(['record_callback']);
    }
    // One fixed sentence, nothing from the request.
    expect(error.mock.calls.every((entry) => entry.length === 1 && entry[0] === 'A worker command could not be recorded.')).toBe(true);
  });

  it('answers 503 when the database answers the record with something that is not an answer', async () => {
    answers.record_callback = () => json({outcome: 'maybe'});
    expect((await handle(cad.request(claims.renew, {}))).status).toBe(503);
  });
});

describe('8. the body', () => {
  const badBody = async (claim: Parameters<typeof cad.request>[0], body: unknown) => {
    sent = [];
    const response = await handle(cad.request(claim, body));
    expect([response.status, await response.json()]).toEqual([400, {error: 'invalid_request'}]);
    // The token was good, so the callback was recorded (the jti is spent), and no command ran.
    expect(names()).toEqual(['record_callback']);
  };

  it('answers 400 for a body that is not JSON, not an object or not the command\'s, after recording the callback', async () => {
    await badBody(claims.claim, 'not json');
    await badBody(claims.claim, '[]');
    await badBody(claims.claim, 'null');
    await badBody(claims.claim, '"x"');
    await badBody(claims.claim, '{"extra":1}');
    await badBody(claims.renew, '{"extra":1}');
    await badBody(claims.register, '{}');
    await badBody(claims.register, {...registerBody, extra: 1});
    await badBody(claims.register, {worker_kind: 'test_cad', version: '2', image_digest: DIGEST, kinds: ['a']});
    await badBody(claims.register, {...registerBody, kinds: [1]});
    await badBody(claims.step, {});
    await badBody(claims.step, {step_key: 'work', ordinal: '1'});
    await badBody(claims.step, {step_key: 'work', ordinal: 1, extra: true});
    await badBody(claims.operation, {operation: OPERATION});
    await badBody(claims.operation, {operation: OPERATION, outcome: 'ambiguous'});
    await badBody(claims.operation, {operation: OPERATION, outcome: 'completed', input_tokens: 1, output_tokens: 1});
    await badBody(claims.operation, {operation: OPERATION, outcome: 'completed', input_tokens: 1, output_tokens: 1, returned_model: 'm', request_id: 'r'});
    await badBody(claims.operation, {operation: OPERATION, outcome: 'noncharge'});
    await badBody(claims.operation, {operation: OPERATION, outcome: 'noncharge', request_id: 7});
    await badBody(claims.operation, {outcome: 'completed', input_tokens: 1, output_tokens: 1, returned_model: 'm'});
    await badBody(claims.finish, {});
    await badBody(claims.finish, {to: 'cancelled'});
    await badBody(claims.finish, {to: 'completed', result_digest: 7});
  });

  it('answers 400 for a value the typed call refuses (a TypeError), after recording: a step key with a capital, an ordinal of 0, a digest that is short', async () => {
    await badBody(claims.step, {step_key: 'Search'});
    await badBody(claims.step, {step_key: 'search', ordinal: 0});
    await badBody(claims.register, {...registerBody, image_digest: 'abc'});
    await badBody(claims.register, {...registerBody, version: 0});
    await badBody(claims.register, {...registerBody, kinds: []});
    await badBody(claims.operation, {operation: 'nope', outcome: 'noncharge', request_id: 'req_1'});
    await badBody(claims.finish, {to: 'completed'});
    await badBody(claims.finish, {to: 'failed', result_digest: DIGEST});
    await badBody(claims.finish, {to: 'completed', result_digest: 'abc'});
  });
});

describe('9. the commands', () => {
  it('registers a worker as the issuer of the token, and answers the registration', async () => {
    answers.register_worker = () => json({outcome: 'registered', worker_id: WORKER, version: 2, retired: 1});
    const response = await handle(cad.request(claims.register, registerBody));
    expect([response.status, await response.json()]).toEqual([200, {state: 'registered', worker: WORKER, version: 2, retired: 1}]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(sent[1]).toEqual({name: 'register_worker', body: {p_issuer: 'cad-worker', p_worker_kind: 'test_cad', p_version: 2, p_image_digest: DIGEST, p_kinds: ['test_workload']}});
  });

  it('answers a replayed registration 200, and a superseded one 409 with the version in service', async () => {
    answers.register_worker = () => json({outcome: 'replayed', worker_id: WORKER, version: 2, retired: 0});
    expect(await (await handle(cad.request(claims.register, registerBody))).json()).toMatchObject({state: 'replayed'});
    answers.register_worker = () => json({outcome: 'superseded', worker_id: WORKER, version: 5, retired: 0});
    const response = await handle(cad.request(claims.register, registerBody));
    expect([response.status, await response.json()]).toEqual([409, {state: 'superseded', version: 5}]);
  });

  it('claims for the attempt and the worker the token names, and answers the fence, the expiry and what the attempt is pinned to, the plan in snake_case', async () => {
    answers.claim_attempt = () => json(claimedFields());
    const response = await handle(cad.request(claims.claim, {}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: 'claimed',
      attempt: ATTEMPT,
      job: JOB,
      kind: 'test_workload',
      fence: FENCE,
      expires_at: later,
      plan: claimedFields().plan,
      input_digest: DIGEST,
      revision: 7,
      epoch: 3,
      worker_version: 2,
    });
    // The VERIFIED issuer of the token goes with the worker ID, so the database can refuse a worker that belongs to another issuer.
    expect(sent[1]).toEqual({name: 'claim_attempt', body: {p_attempt_id: ATTEMPT, p_worker_id: WORKER, p_issuer: 'cad-worker'}});
  });

  it('passes the issuer that SIGNED the claim, whichever it is: the engine worker\'s token names engine-worker, never the issuer of the worker it names', async () => {
    answers.claim_attempt = () => json(claimedFields());
    const response = await handle(engine.request(claims.claim, {}));
    expect(response.status).toBe(200);
    expect(sent[1].body).toEqual({p_attempt_id: ATTEMPT, p_worker_id: WORKER, p_issuer: 'engine-worker'});
    // A worker of the other issuer is refused by the database with `incompatible`, which the route answers 409.
    answers.claim_attempt = () => json(claimedFields({outcome: 'incompatible', fence: null, state: 'waiting'}));
    const refused = await handle(engine.request(claims.claim, {}));
    expect([refused.status, await refused.json()]).toEqual([409, {state: 'incompatible'}]);
  });

  it('answers a replay of the claim 200 with the same fence', async () => {
    answers.claim_attempt = () => json(claimedFields({outcome: 'replayed'}));
    expect(await (await handle(cad.request(claims.claim, {}))).json()).toMatchObject({state: 'replayed', fence: FENCE});
  });

  it.each(['already_claimed', 'blocked', 'waiting_for_worker', 'incompatible', 'revoked', 'unavailable'])('answers 409 {state: %s} when the claim is refused', async (outcome) => {
    answers.claim_attempt = () => json(claimedFields({outcome, fence: null}));
    const response = await handle(cad.request(claims.claim, {}));
    expect([response.status, await response.json()]).toEqual([409, {state: outcome}]);
  });

  it('answers 409 not_waiting with the attempt\'s state', async () => {
    answers.claim_attempt = () => json({outcome: 'not_waiting', state: 'cancelled'});
    const response = await handle(cad.request(claims.claim, {}));
    expect([response.status, await response.json()]).toEqual([409, {state: 'not_waiting', attempt_state: 'cancelled'}]);
  });

  it('renews the lease of the attempt and fence the token names, and answers the new expiry', async () => {
    answers.renew_lease = () => json({outcome: 'renewed', attempt_id: ATTEMPT, expires_at: later, state: 'running'});
    const response = await handle(cad.request(claims.renew, {}));
    expect([response.status, await response.json()]).toEqual([200, {state: 'renewed', expires_at: later}]);
    expect(sent[1]).toEqual({name: 'renew_lease', body: {p_attempt_id: ATTEMPT, p_fence: FENCE}});
  });

  it.each(['fence_mismatch', 'cancelled', 'expired', 'revoked', 'not_running', 'unavailable'])('answers 409 {state: %s} when a fenced command is refused', async (outcome) => {
    const refusal = () => json({outcome, attempt_id: ATTEMPT});
    answers.renew_lease = refusal;
    answers.run_step = refusal;
    answers.finish_operation = refusal;
    answers.finish_attempt = refusal;
    const requests = [
      cad.request(claims.renew, {}),
      cad.request(claims.step, {step_key: 'search', ordinal: 1}),
      cad.request(claims.operation, {operation: OPERATION, outcome: 'noncharge', request_id: 'req_1'}),
      cad.request(claims.finish, {to: 'failed'}),
    ];
    for (const request of requests) {
      const response = await handle(request);
      expect([response.status, await response.json()]).toEqual([409, {state: outcome}]);
    }
  });

  it('begins a step with its ordinal, and a step with none, and answers the step and the operation', async () => {
    answers.run_step = (body) => json({outcome: 'stepped', step_id: STEP, operation_id: body.p_ordinal === null ? null : OPERATION, operation_state: body.p_ordinal === null ? null : 'dispatched', attempt_state: 'running'});
    const withOperation = await handle(cad.request(claims.step, {step_key: 'search', ordinal: 1}));
    expect([withOperation.status, await withOperation.json()]).toEqual([200, {state: 'stepped', step: STEP, operation: OPERATION, operation_state: 'dispatched'}]);
    expect(sent[1]).toEqual({name: 'run_step', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_step_key: 'search', p_ordinal: 1}});
    const none = await handle(cad.request(claims.step, {step_key: 'work'}));
    expect(await none.json()).toEqual({state: 'stepped', step: STEP, operation: null, operation_state: null});
    expect(sent.at(-1)!.body.p_ordinal).toBeNull();
    const nullOrdinal = await handle(cad.request(claims.step, {step_key: 'work', ordinal: null}));
    expect(nullOrdinal.status).toBe(200);
  });

  it('answers a replayed step 200, and a step that names no planned operation 409 not_planned', async () => {
    answers.run_step = () => json({outcome: 'replayed', step_id: STEP, operation_id: OPERATION, operation_state: 'completed', attempt_state: 'running'});
    expect(await (await handle(cad.request(claims.step, {step_key: 'search', ordinal: 1}))).json()).toMatchObject({state: 'replayed'});
    answers.run_step = () => json({outcome: 'not_planned'});
    const response = await handle(cad.request(claims.step, {step_key: 'search', ordinal: 9}));
    expect([response.status, await response.json()]).toEqual([409, {state: 'not_planned'}]);
  });

  it('reports a completed operation with its usage, and answers the settlement', async () => {
    answers.finish_operation = () => json({outcome: 'finished', operation_id: OPERATION, state: 'completed', settled_microdollars: 2, released_microdollars: 3400, over_microdollars: 0});
    const response = await handle(cad.request(claims.operation, {operation: OPERATION, outcome: 'completed', input_tokens: 1, output_tokens: 1, returned_model: 'fixture-model'}));
    expect([response.status, await response.json()]).toEqual([
      200,
      {state: 'finished', operation: OPERATION, operation_state: 'completed', settled_microdollars: 2, released_microdollars: 3400},
    ]);
    expect(sent[1]).toEqual({
      name: 'finish_operation',
      body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_operation_id: OPERATION, p_outcome: 'completed', p_input_tokens: 1, p_output_tokens: 1, p_returned_model: 'fixture-model', p_request_id: null},
    });
  });

  it('reports a noncharge with the provider\'s request ID, and answers null amounts for an operation that holds no reservation', async () => {
    answers.finish_operation = () => json({outcome: 'finished', operation_id: OPERATION, state: 'noncharge', settled_microdollars: null, released_microdollars: null, over_microdollars: null});
    const response = await handle(cad.request(claims.operation, {operation: OPERATION, outcome: 'noncharge', request_id: 'req_1'}));
    expect([response.status, await response.json()]).toEqual([200, {state: 'finished', operation: OPERATION, operation_state: 'noncharge', settled_microdollars: null, released_microdollars: null}]);
    expect(sent[1].body).toMatchObject({p_outcome: 'noncharge', p_request_id: 'req_1', p_input_tokens: null});
  });

  it.each(['not_found', 'not_dispatched', 'invalid_transition', 'already_settled', 'invalid_evidence'])('answers 409 {state: %s} when an operation\'s outcome is refused', async (outcome) => {
    answers.finish_operation = () => json({outcome, operation_id: OPERATION, state: 'planned'});
    const response = await handle(cad.request(claims.operation, {operation: OPERATION, outcome: 'noncharge', request_id: 'req_1'}));
    expect([response.status, await response.json()]).toEqual([409, {state: outcome}]);
  });

  it('finishes the attempt completed with its result digest, and failed with none, and answers the attempt\'s state', async () => {
    answers.finish_attempt = (body) => json({outcome: 'finished', attempt_id: ATTEMPT, state: body.p_to, stage: 'search', reason: body.p_to === 'failed' ? 'step_failed' : null, detail: body.p_to === 'failed' ? 'step_failed' : null});
    const completed = await handle(cad.request(claims.finish, {to: 'completed', result_digest: DIGEST}));
    expect([completed.status, await completed.json()]).toEqual([200, {state: 'finished', attempt_state: 'completed'}]);
    // The signed `rev` claim (7) goes with a completion: the database rejects a result computed from another revision than the one the attempt is bound to.
    expect(sent[1]).toEqual({name: 'finish_attempt', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_to: 'completed', p_result_digest: DIGEST, p_revision: 7}});
    const failed = await handle(cad.request(claims.finish, {to: 'failed'}));
    expect(await failed.json()).toEqual({state: 'finished', attempt_state: 'failed'});
    expect(sent.at(-1)!.body).toMatchObject({p_to: 'failed', p_result_digest: null, p_revision: 7});
  });

  it('passes the revision of the token\'s own `rev` claim, not a number from the body: a result computed from another revision is 409 rejected', async () => {
    answers.finish_attempt = () => json({outcome: 'rejected', attempt_id: ATTEMPT, state: 'failed', stage: 'search', reason: 'step_failed', detail: 'stale_revision'});
    const response = await handle(cad.request({...claims.finish, rev: 3}, {to: 'completed', result_digest: DIGEST}));
    expect([response.status, await response.json()]).toEqual([409, {state: 'rejected'}]);
    expect(sent[1].body).toMatchObject({p_to: 'completed', p_revision: 3});
    // A body that tries to name a revision is not the command's body: 400, after the callback was recorded.
    const smuggled = await handle(cad.request({...claims.finish, rev: 3}, {to: 'completed', result_digest: DIGEST, revision: 7}));
    expect(smuggled.status).toBe(400);
  });

  it('answers a replayed finish 200, and a result for a stale revision 409 rejected, and an attempt with open operations 409 open_operations', async () => {
    answers.finish_attempt = () => json({outcome: 'replayed', attempt_id: ATTEMPT, state: 'completed', stage: 'search', reason: null, detail: null});
    expect(await (await handle(cad.request(claims.finish, {to: 'completed', result_digest: DIGEST}))).json()).toEqual({state: 'replayed', attempt_state: 'completed'});
    answers.finish_attempt = () => json({outcome: 'rejected', attempt_id: ATTEMPT, state: 'failed', stage: 'search', reason: 'step_failed', detail: 'stale_revision'});
    const rejected = await handle(cad.request(claims.finish, {to: 'completed', result_digest: DIGEST}));
    expect([rejected.status, await rejected.json()]).toEqual([409, {state: 'rejected'}]);
    answers.finish_attempt = () => json({outcome: 'open_operations', attempt_id: ATTEMPT, state: 'running', stage: 'search', reason: null, detail: null});
    const open = await handle(cad.request(claims.finish, {to: 'completed', result_digest: DIGEST}));
    expect([open.status, await open.json()]).toEqual([409, {state: 'open_operations'}]);
  });

  it('answers 503 and logs one fixed sentence when the database does not answer the command, or answers something that is not an answer', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const answer of [() => json({message: 'down'}, 503), () => json('nonsense'), () => json({outcome: 'maybe'})]) {
      answers.renew_lease = answer;
      const response = await handle(cad.request(claims.renew, {}));
      expect([response.status, await response.json()]).toEqual([503, {error: 'unavailable'}]);
    }
    expect(error.mock.calls.every((entry) => entry.length === 1 && entry[0] === 'A worker command could not be run.')).toBe(true);
  });

  it('never reflects the token, the fence, the digest or a key in an answer or a log', async () => {
    const log = [vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined), vi.spyOn(console, 'log').mockImplementation(() => undefined)];
    const request = cad.request(claims.step, {step_key: 'search', ordinal: 1});
    const token = request.headers.get('authorization')!.slice('Bearer '.length);
    answers.run_step = () => json({message: 'down'}, 503);
    const response = await handle(request);
    const refused = await handle(raw(`${token.slice(0, -4)}AAAA`, '{}'));
    const printed = JSON.stringify([await response.text(), await refused.text(), log.map((spy) => spy.mock.calls), [...response.headers.entries()]]);
    for (const secret of [token, token.slice(0, 30), FENCE, cad.keySetJson, 'service-key-for-tests-only']) expect(printed).not.toContain(secret);
  });

  it('runs a command for either worker type under its own issuer', async () => {
    answers.register_worker = () => json({outcome: 'registered', worker_id: WORKER, version: 2, retired: 0});
    for (const worker of [cad, engine]) {
      sent = [];
      expect((await handle(worker.request(claims.register, registerBody))).status).toBe(200);
      expect(sent[1].body.p_issuer).toBe(worker.issuer);
    }
  });
});

describe('the whole order', () => {
  it('checks the method, then the origin, then the instance, then the token, then the digest, then the record, then the body, then runs the command: each refusal stops everything after it', async () => {
    // Method before origin before configuration.
    expect((await handle(new Request('http://127.0.0.1:4173/api/workers', {method: 'GET', headers: {origin: 'https://evil.example'}}), {})).status).toBe(405);
    expect((await handle(cad.request(claims.claim, {}, {}, {origin: 'https://evil.example'}), {})).status).toBe(403);
    expect((await handle(cad.request(claims.claim, {}), {})).status).toBe(503);
    // A bad token with a bad digest and a bad body is a 401, and records nothing.
    await invalid(await handle(raw(forged({aud: 'gateway'}), 'not json')));
    // A good token with a bad digest is a 401 and records nothing.
    await invalid(await handle(raw(cad.token(claims.claim, '{}'), '{"x":1}')));
    expect(sent).toEqual([]);
    // A good token and digest with a replayed jti is a 401 and runs nothing; with a bad body it would have been a 400.
    answers.record_callback = () => json({outcome: 'duplicate'});
    await invalid(await handle(cad.request(claims.claim, {extra: 1})));
    expect(names()).toEqual(['record_callback']);
  });
});
