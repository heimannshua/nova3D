import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Receiver} from '@upstash/qstash';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as route from '@/app/api/jobs/route';
import {handleJobRequest, maxJobBodyBytes} from '@/lib/jobs';
import {runTask} from '@/lib/job-tasks';
import {signDelivery, signedCall, testSigningKeys} from '../support/qstash-signature';

// The scheduled-job route (Story 1.9, lib/jobs.ts) without a database: the handler is called with a Request, the database is a stand-in for
// the four calls it makes (the instance identity read, api.claim_job_run, api.finish_job_run and, for the tasks, theirs), and what the route
// does with a signature, a body, a header and an answer is read off the Response. Signatures are made the way QStash makes them (the real
// SDK `Receiver` verifies them: tests/support/qstash-signature.ts). The real database is covered by tests/integration/scheduled-jobs.test.ts
// and the route over HTTP by tests/e2e/jobs.spec.ts; the proxy's part (no origin check for this one path) by tests/unit/proxy-gating.test.ts.
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const RECEIPT = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a';
const env = {
  APP_ENV: 'local',
  NEXT_PUBLIC_APP_ENV: 'local',
  ADMINISTRATOR_EMAIL: 'admin@example.test',
  INSTANCE_ID: INSTANCE,
  PAID_ADAPTERS_ENABLED: 'false',
  SYNTHETIC_DATA_ENABLED: 'false',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-for-tests-only',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only',
  QSTASH_CURRENT_SIGNING_KEY: testSigningKeys.current,
  QSTASH_NEXT_SIGNING_KEY: testSigningKeys.next,
};

type Sent = {name: string; body: Record<string, unknown>};
let sent: Sent[];
let identityReads: number;
let identity: () => Response;
let answers: Record<string, (body: Record<string, unknown>) => Response | Promise<Response>>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

const database = async (input: string, init?: RequestInit): Promise<Response> => {
  if (String(input).includes('/rest/v1/instance_identity')) {
    identityReads += 1;
    return identity();
  }
  const name = String(input).split('/rpc/')[1];
  const body = JSON.parse(String(init?.body));
  sent.push({name, body});
  const answer = answers[name];
  if (!answer) throw new Error(`the test did not expect api.${name}`);
  return answer(body);
};
const claimed = (attempt = 1) => json({outcome: 'claimed', receipt_id: RECEIPT, attempt});

beforeEach(() => {
  sent = [];
  identityReads = 0;
  identity = () => json([{environment: 'local', instance_id: INSTANCE}]);
  answers = {
    claim_job_run: () => claimed(),
    finish_job_run: () => json({outcome: 'finished'}),
    ledger_pending: () => json({pending: 0, oldest_seconds: null}),
    purge_dormant_identities: () => json({deleted: 2, kept: 1, locked: 0, remaining: 0}),
  };
});
afterEach(() => vi.restoreAllMocks());

const calls = () => sent.map((call) => call.name);
const body = (task = 'ledger-relay', instance = INSTANCE) => ({task, instance});

/** Sends a call as QStash would: a POST with the signature, message ID and schedule ID of a scheduled message. */
function post(call: ReturnType<typeof signedCall> | {body: string; headers: Record<string, string>}, options: {env?: Record<string, string | undefined>; run?: typeof runTask; task?: {ledgerStore?: never | null}; method?: string} = {}) {
  const request = new Request('http://127.0.0.1:4173/api/jobs', {method: options.method ?? 'POST', headers: call.headers, ...(options.method === 'GET' ? {} : {body: call.body})});
  return handleJobRequest(request, {env: options.env ?? env, accounts: {fetch: database}, run: options.run, task: options.task as never});
}
const call = (overrides: Parameters<typeof signedCall>[1] = {}, content = body()) => signedCall(content, overrides);
const dropSignature = (headers: Record<string, string>) => Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'upstash-signature'));

describe('the route is one POST', () => {
  it('exports a POST handler and no other method, so Next.js answers 405 for the rest, and is never static', () => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});

describe('1. method', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('answers 405 with Allow: POST for %s, whatever it carries, and asks nothing', async (method) => {
    const request = new Request('http://127.0.0.1:4173/api/jobs', {method, headers: call().headers});
    const response = await handleJobRequest(request, {env, accounts: {fetch: database}});
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  });

  it('is checked before the keys: a GET to an unconfigured server is a 405, not a 503', async () => {
    const response = await post(call(), {env: {}, method: 'GET'});
    expect(response.status).toBe(405);
  });
});

describe('2. keys', () => {
  it.each([
    ['neither key set', {QSTASH_CURRENT_SIGNING_KEY: undefined, QSTASH_NEXT_SIGNING_KEY: undefined}],
    ['no current key', {QSTASH_CURRENT_SIGNING_KEY: undefined}],
    ['no next key', {QSTASH_NEXT_SIGNING_KEY: undefined}],
    ['an empty key', {QSTASH_CURRENT_SIGNING_KEY: '   '}],
    ['a placeholder key', {QSTASH_NEXT_SIGNING_KEY: 'replace-with-the-next-signing-key'}],
  ])('answers 503, never 200, with %s, even for a call that is signed and one that is not, and asks nothing', async (_name, change) => {
    const environment = {...env, ...change};
    for (const candidate of [call(), {body: JSON.stringify(body()), headers: {}}]) {
      const response = await post(candidate, {env: environment});
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({error: 'unavailable'});
    }
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  });

  it('answers 503 with no keys in an environment that holds nothing else either', async () => {
    expect((await post(call(), {env: {}})).status).toBe(503);
  });
});

describe('3. signature', () => {
  const refused = async (response: Response) => {
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({error: 'unauthorized'});
    // A foreign or invalid call runs nothing, claims nothing and writes no receipt.
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  };
  const text = JSON.stringify(body());
  const withSignature = (signature: string | null) => {
    const { 'upstash-signature': _dropped, ...rest } = call().headers;
    return {body: text, headers: signature === null ? rest : {...rest, 'upstash-signature': signature}};
  };

  it('refuses a call with no signature, an empty one, one that is not a token, and one that is far too long', async () => {
    await refused(await post(withSignature(null)));
    await refused(await post(withSignature('')));
    await refused(await post(withSignature('not-a-token')));
    await refused(await post(withSignature('a.b.c')));
    await refused(await post(withSignature(`${'a'.repeat(5000)}.b.c`)));
  });

  it('refuses a token signed with a key that is neither the current nor the next one', async () => {
    await refused(await post(call({key: 'some-other-queues-signing-key-0000000000'})));
    await refused(await post(call({key: ''.padEnd(32, 'k')})));
  });

  it('refuses a token for another body, even a one-character difference: the hash is over the raw body', async () => {
    const other = signDelivery(JSON.stringify(body('dormant-identity-purge')));
    await refused(await post({body: text, headers: {...call().headers, 'upstash-signature': other}}));
    await refused(await post({body: `${text} `, headers: call().headers}));
    await refused(await post({body: JSON.stringify(body(), null, 1), headers: {...call().headers, 'upstash-signature': signDelivery(text)}}));
  });

  it('refuses an expired token, one not yet valid, and one from another issuer', async () => {
    const now = Math.floor(Date.now() / 1000);
    await refused(await post(call({now: now - 3600, lifetime: 300})));
    await refused(await post(call({now: now + 3600})));
    await refused(await post(call({claims: {iss: 'Somebody Else'}})));
  });

  it('refuses a token with no body claim, a token with an unsigned header (alg none) and one that is not HS256', async () => {
    await refused(await post(call({claims: {body: undefined}})));
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({iss: 'Upstash', body: 'x', exp: 9999999999})).toString('base64url')}.`;
    await refused(await post(withSignature(unsigned)));
    const signed = call().headers['upstash-signature'].split('.');
    const otherAlgorithm = `${Buffer.from('{"alg":"HS384","typ":"JWT"}').toString('base64url')}.${signed[1]}.${signed[2]}`;
    await refused(await post(withSignature(otherAlgorithm)));
  });

  it('accepts a call signed with the current key and one signed with the next key (a rotation in progress)', async () => {
    expect((await post(call({key: testSigningKeys.current}))).status).toBe(200);
    expect((await post(call({key: testSigningKeys.next}))).status).toBe(200);
  });

  it('is checked before the body: a bad signature on a bad body is a 401', async () => {
    await refused(await post({body: 'not json', headers: {...call().headers, 'upstash-signature': 'nope'}}));
  });

  it('reads the body before it can check the signature, so an oversize body is a 400 even when the call is unsigned or wrongly signed; a call with no signature at all is a 401 and its body is not read', async () => {
    const big = JSON.stringify({task: 'ledger-relay', instance: INSTANCE, padding: 'x'.repeat(maxJobBodyBytes)});
    const signed = call();
    const noSignature = dropSignature(signed.headers);
    const request = (headers: Record<string, string>, content: BodyInit) => new Request('http://127.0.0.1:4173/api/jobs', {method: 'POST', headers, body: content});
    const send = (headers: Record<string, string>, content: BodyInit) => handleJobRequest(request(headers, content), {env, accounts: {fetch: database}});

    // No `Upstash-Signature` header: refused before the body is read, however large it is or what it declares.
    for (const [headers, content] of [[noSignature, big], [{...noSignature, 'content-length': '99999999'}, big], [noSignature, JSON.stringify(body())]] as const) {
      const response = await send(headers, content);
      expect([response.status, await response.json()]).toEqual([401, {error: 'unauthorized'}]);
    }
    // A signature header that is not one that verifies, with a body over the cap, a content-length over the cap or one that is not a number: 400.
    for (const [headers, content] of [
      [{...signed.headers, 'upstash-signature': 'not-a-token'}, big],
      [{...signed.headers, 'upstash-signature': 'not-a-token', 'content-length': '99999999'}, JSON.stringify(body())],
      [{...signed.headers, 'upstash-signature': 'not-a-token', 'content-length': 'many'}, JSON.stringify(body())],
      [{...signed.headers, 'upstash-signature': signDelivery(big)}, big],
    ] as const) {
      const response = await send(headers, content);
      expect([response.status, await response.json()]).toEqual([400, {error: 'invalid_request'}]);
    }
    // Within the cap, the same wrong signature is a 401.
    const within = await send({...signed.headers, 'upstash-signature': 'not-a-token'}, JSON.stringify(body()));
    expect([within.status, await within.json()]).toEqual([401, {error: 'unauthorized'}]);
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  });

  it('never reflects the signature or a key in an answer or a log', async () => {
    const log = [vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined), vi.spyOn(console, 'log').mockImplementation(() => undefined)];
    const response = await post(call({key: 'some-other-queues-signing-key-0000000000'}));
    const printed = JSON.stringify([await response.text(), log.map((spy) => spy.mock.calls), [...response.headers.entries()]]);
    for (const secret of [testSigningKeys.current, testSigningKeys.next, 'some-other-queues-signing-key', call().headers['upstash-signature'].slice(0, 20)]) expect(printed).not.toContain(secret);
  });
});

describe('4. body and headers (the call is authentic from here on)', () => {
  const bad = async (response: Response) => {
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({error: 'invalid_request'});
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  };

  it.each([
    ['not JSON', 'not json'],
    ['empty', ''],
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"ledger-relay"'],
    ['no instance', JSON.stringify({task: 'ledger-relay'})],
    ['no task', JSON.stringify({instance: INSTANCE})],
    ['an extra key', JSON.stringify({task: 'ledger-relay', instance: INSTANCE, extra: 1})],
    ['a task that is not a string', JSON.stringify({task: 7, instance: INSTANCE})],
    ['an instance that is not a string', JSON.stringify({task: 'ledger-relay', instance: 7})],
    ['an instance far too long', JSON.stringify({task: 'ledger-relay', instance: 'x'.repeat(80)})],
    ['an unknown task', JSON.stringify(body('session-cleanup'))],
    ['a task that is a property of every object', JSON.stringify(body('constructor'))],
    ['a task that is a prototype', JSON.stringify(body('__proto__'))],
    ['a task with a different case', JSON.stringify(body('Ledger-Relay'))],
    ['a task with padding', JSON.stringify(body(' ledger-relay'))],
  ])('answers 400 for a signed body that is %s, and runs nothing', async (_name, content) => {
    await bad(await post(call({}, content as never)));
  });

  it('answers 400 for a body over 1 KB, signed or not, and does not read the rest of it', async () => {
    const big = JSON.stringify({task: 'ledger-relay', instance: INSTANCE, padding: 'x'.repeat(maxJobBodyBytes)});
    await bad(await post(call({}, big as never)));
    await bad(await post({body: big, headers: {...call({}, big as never).headers, 'content-length': String(big.length)}}));
    await bad(await post({body: big, headers: {...call().headers, 'content-length': '99999999'}}));
    await bad(await post({body: big, headers: {...call().headers, 'content-length': 'many'}}));
  });

  it('answers 400 for a body that is not UTF-8', async () => {
    const request = new Request('http://127.0.0.1:4173/api/jobs', {method: 'POST', headers: call().headers, body: new Uint8Array([0xff, 0xfe, 0x7b])});
    await bad(await handleJobRequest(request, {env, accounts: {fetch: database}}));
  });

  it('answers 400 for a body stream that fails part way', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"task"'));
        controller.error(new Error('connection reset'));
      },
    });
    const request = new Request('http://127.0.0.1:4173/api/jobs', {method: 'POST', headers: call().headers, body: stream, duplex: 'half'} as RequestInit);
    await bad(await handleJobRequest(request, {env, accounts: {fetch: database}}));
  });

  it.each([
    ['no message ID', {'upstash-message-id': undefined}],
    ['an empty message ID', {'upstash-message-id': ''}],
    ['a message ID that is not an ID', {'upstash-message-id': 'msg 1; drop table'}],
    ['a message ID far too long', {'upstash-message-id': 'm'.repeat(200)}],
    ['no schedule ID: a message that is not from a schedule is refused', {'upstash-schedule-id': undefined}],
    ['an empty schedule ID', {'upstash-schedule-id': ''}],
    ['a schedule ID that is not an ID', {'upstash-schedule-id': 'scd/1'}],
  ])('answers 400 for %s', async (_name, change) => {
    const signed = call();
    const headers: Record<string, string> = {...signed.headers};
    for (const [name, value] of Object.entries(change)) {
      if (value === undefined) delete headers[name];
      else headers[name] = value;
    }
    await bad(await post({body: signed.body, headers}));
  });

  it('is checked before the environment: a bad body for another instance is a 400, not a 403', async () => {
    await bad(await post(call({}, JSON.stringify({task: 'nope', instance: randomUUID()}) as never)));
  });
});

describe('5. environment', () => {
  const wrong = async (response: Response) => {
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({error: 'wrong_environment'});
    expect(calls()).toEqual([]);
  };

  it('answers 403 for a call made for another instance, with no claim and no database read at all', async () => {
    await wrong(await post(call({}, body('ledger-relay', randomUUID()))));
    expect(identityReads).toBe(0);
  });

  it('compares the instance without regard to case or padding, as INSTANCE_ID is compared everywhere', async () => {
    expect((await post(call({}, body('ledger-relay', ` ${INSTANCE.toUpperCase()} `)))).status).toBe(200);
  });

  it('answers 403 when this server has no instance ID, or the database row names another instance or another environment', async () => {
    await wrong(await post(call(), {env: {...env, INSTANCE_ID: undefined}}));
    identity = () => json([{environment: 'local', instance_id: randomUUID()}]);
    await wrong(await post(call()));
    identity = () => json([{environment: 'staging', instance_id: INSTANCE}]);
    await wrong(await post(call()));
    identity = () => json([]);
    await wrong(await post(call()));
    expect(identityReads).toBe(3);
  });

  it('answers 403, not 200, when the environment is not one (APP_ENV and NEXT_PUBLIC_APP_ENV differ)', async () => {
    await wrong(await post(call(), {env: {...env, NEXT_PUBLIC_APP_ENV: 'staging'}}));
  });

  it('answers 503, not 403, when the database does not answer the identity read: retry, do not give up', async () => {
    for (const make of [() => json({message: 'down'}, 503), () => { throw new TypeError('fetch failed'); }]) {
      identity = make;
      const response = await post(call());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({error: 'unavailable'});
    }
    expect(calls()).toEqual([]);
  });

  it('answers 403 for an identity read the database refuses outright (a 4xx is final)', async () => {
    identity = () => json({code: '42501'}, 401);
    await wrong(await post(call()));
  });
});

describe('6. the claim', () => {
  it('claims before anything runs: one claim for this schedule and message, then the task, then the finish', async () => {
    const signed = call({scheduleId: 'scd_abc', messageId: 'msg_def'});
    const response = await post(signed);
    expect([response.status, await response.json()]).toEqual([200, {outcome: 'idle'}]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(sent.map((entry) => entry.name)).toEqual(['claim_job_run', 'ledger_pending', 'finish_job_run']);
    expect(sent[0].body).toEqual({p_task: 'ledger-relay', p_schedule_id: 'scd_abc', p_message_id: 'msg_def', p_lease_seconds: 300});
    expect(sent[2].body).toEqual({p_receipt_id: RECEIPT, p_outcome: 'idle', p_result: {pending: 0}});
  });

  it('answers 200 duplicate and runs nothing when the latest attempt of this message finished', async () => {
    answers.claim_job_run = () => json({outcome: 'duplicate', receipt_id: RECEIPT, attempt: 1});
    const response = await post(call());
    expect([response.status, await response.json()]).toEqual([200, {outcome: 'duplicate'}]);
    expect(calls()).toEqual(['claim_job_run']);
  });

  it('answers 409 running and runs nothing when the latest attempt is unfinished and inside its lease', async () => {
    answers.claim_job_run = () => json({outcome: 'running', receipt_id: RECEIPT, attempt: 1});
    const response = await post(call());
    expect([response.status, await response.json()]).toEqual([409, {outcome: 'running'}]);
    expect(calls()).toEqual(['claim_job_run']);
  });

  it('answers 503, never 200, when the database does not answer the claim, refuses it, or answers something that is not an answer', async () => {
    const down = [() => { throw new TypeError('fetch failed'); }, () => json({message: 'down'}, 503), () => json({code: '42501'}, 401), () => json({code: '22023'}, 400)];
    const nonsense = [json('claimed'), json([]), json({outcome: 'maybe', receipt_id: RECEIPT, attempt: 1}), json({outcome: 'claimed', receipt_id: 'not-a-uuid', attempt: 1}), json({outcome: 'claimed', receipt_id: RECEIPT, attempt: 0}), json({outcome: 'claimed', attempt: 1})];
    for (const make of [...down, ...nonsense.map((response) => () => response.clone())]) {
      answers.claim_job_run = make;
      const response = await post(call());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({error: 'unavailable'});
    }
    expect(calls().filter((name) => name !== 'claim_job_run')).toEqual([]);
  });

  it('claims each task under its own ID', async () => {
    await post(call({}, body('dormant-identity-purge')));
    expect(sent[0].body).toMatchObject({p_task: 'dormant-identity-purge'});
  });
});

describe('7. the run and the receipt', () => {
  it('records the outcome and the counts of a task that ran, once, and answers its outcome', async () => {
    const response = await post(call({}, body('dormant-identity-purge')));
    expect([response.status, await response.json()]).toEqual([200, {outcome: 'ran'}]);
    expect(sent.map((entry) => entry.name)).toEqual(['claim_job_run', 'purge_dormant_identities', 'finish_job_run']);
    expect(sent[1].body).toEqual({p_limit: 100});
    expect(sent[2].body).toEqual({p_receipt_id: RECEIPT, p_outcome: 'ran', p_result: {deleted: 2, kept: 1, locked: 0, remaining: 0}});
  });

  it('records `failed` with the error\'s class and answers 500 when the task throws, so the scheduler retries', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers.purge_dormant_identities = () => json({message: 'password authentication failed for user someone@example.test'}, 500);
    const response = await post(call({}, body('dormant-identity-purge')));
    expect([response.status, await response.json()]).toEqual([500, {outcome: 'failed'}]);
    expect(sent.at(-1)).toEqual({name: 'finish_job_run', body: {p_receipt_id: RECEIPT, p_outcome: 'failed', p_result: {error_class: 'AccountsUnavailableError'}}});
    // One line, naming the task and the class, and nothing else: no message, no body, no address.
    expect(error.mock.calls).toEqual([['A scheduled task failed.', 'dormant-identity-purge', 'AccountsUnavailableError']]);
  });

  it('records the class name and never the message, or `Error` when the name is not a plain class name', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    class WithAddress extends Error {
      constructor() {
        super('could not reach someone@example.test');
        this.name = 'someone@example.test';
      }
    }
    for (const [thrown, expected] of [[new TypeError('secret detail'), 'TypeError'], [new WithAddress(), 'Error'], ['a string', 'Error'], [undefined, 'Error'], [{name: 'TypeError'}, 'Error']] as const) {
      sent = [];
      const response = await post(call(), {run: async () => { throw thrown; }});
      expect(response.status).toBe(500);
      expect(sent.at(-1)?.body).toEqual({p_receipt_id: RECEIPT, p_outcome: 'failed', p_result: {error_class: expected}});
      expect(JSON.stringify(sent)).not.toMatch(/secret detail|someone@example\.test/);
    }
  });

  it('is `failed` when a task answers something a receipt could not hold (an address, an ID, a message), and holds none of it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const result of [{address: 'someone@example.test'}, {id: RECEIPT}, {message: 'Something went wrong here'}, {nested: {a: 1}}, {count: -1}, {count: 1.5}, {Count: 1}, {list: [1]}]) {
      sent = [];
      const response = await post(call(), {run: async () => ({outcome: 'ran', result} as never)});
      expect(response.status, JSON.stringify(result)).toBe(500);
      expect(sent.at(-1)?.body).toEqual({p_receipt_id: RECEIPT, p_outcome: 'failed', p_result: {error_class: 'TypeError'}});
    }
  });

  it('answers 503 when the receipt cannot be finished after a run, and 500 after a failure: both are retried, and the lease replaces the unfinished receipt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers.finish_job_run = () => json({message: 'down'}, 503);
    const ran = await post(call());
    expect([ran.status, await ran.json()]).toEqual([503, {error: 'unavailable'}]);
    const failed = await post(call(), {run: async () => { throw new TypeError('x'); }});
    expect([failed.status, await failed.json()]).toEqual([500, {outcome: 'failed'}]);
  });

  it('answers 503 when the database says the receipt does not exist (nothing finished), after a run and after a failure: a success with no receipt to show is not a success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers.finish_job_run = () => json({outcome: 'not_found'});
    const ran = await post(call());
    expect([ran.status, await ran.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(calls()).toEqual(['claim_job_run', 'ledger_pending', 'finish_job_run']);
    const failed = await post(call(), {run: async () => { throw new TypeError('x'); }});
    expect([failed.status, await failed.json()]).toEqual([500, {outcome: 'failed'}]);
  });

  it('keeps its answer when the receipt was already finished (an earlier delivery of a slow run finished it first): harmless', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers.finish_job_run = () => json({outcome: 'already_finished'});
    const ran = await post(call());
    expect([ran.status, await ran.json()]).toEqual([200, {outcome: 'idle'}]);
    const failed = await post(call(), {run: async () => { throw new TypeError('x'); }});
    expect([failed.status, await failed.json()]).toEqual([500, {outcome: 'failed'}]);
  });

  it('answers 503 for a finish answer that is not an answer at all', async () => {
    for (const make of [() => json({outcome: 'done'}), () => json('finished'), () => json([])]) {
      answers.finish_job_run = make;
      expect((await post(call())).status).toBe(503);
    }
  });

  it('records a damaged ledger chain as `failed` with the class name only, answers 500, and leaves the events pending (the real task, a store that holds something else)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const eventId = randomUUID();
    answers.ledger_pending = () => json({pending: 1, oldest_seconds: 5});
    answers.claim_ledger_events = () => json({outcome: 'claimed', events: [{id: eventId, seq: 1, event: {id: eventId, type: 'account_authority', account_id: randomUUID(), status: 'disabled', epoch: 2}, at: '2026-10-14T09:00:00.000Z'}]});
    answers.finish_ledger_events = () => json({marked: 0, released: true});
    const conflicting = {head: async () => null, putIfAbsent: async () => 'exists' as const};
    const corrupt = {head: async () => ({key: 'not-a-ledger-key', body: 'not a body'}), putIfAbsent: async () => 'created' as const};
    for (const [store, expected] of [[conflicting, 'LedgerConflictError'], [corrupt, 'LedgerCorruptError']] as const) {
      sent = [];
      error.mockClear();
      const response = await post(call(), {task: {ledgerStore: store as never}});
      expect([response.status, await response.json()]).toEqual([500, {outcome: 'failed'}]);
      const finished = sent.find((entry) => entry.name === 'finish_job_run');
      expect(finished?.body).toEqual({p_receipt_id: RECEIPT, p_outcome: 'failed', p_result: {error_class: expected}});
      // Nothing was marked relayed past the damage: the only finish of events is the release of the lease.
      expect(sent.filter((entry) => entry.name === 'finish_ledger_events').every((entry) => (entry.body.p_event_ids as string[]).length === 0)).toBe(true);
      expect(error.mock.calls).toEqual([['A scheduled task failed.', 'ledger-relay', expected]]);
    }
  });

  it('never throws: whatever goes wrong inside, the answer is a response the scheduler retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new Request('http://127.0.0.1:4173/api/jobs', {method: 'POST', headers: call().headers, body: call().body});
    Object.defineProperty(request, 'headers', {get() { throw new Error('boom'); }});
    const response = await handleJobRequest(request, {env, accounts: {fetch: database}});
    expect(response.status).toBe(503);
  });
});

describe('the answers carry nothing of the call', () => {
  it('has the same fixed shape for every status, and never a header or a value of the request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'canary-value-that-must-not-come-back';
    const signed = call({messageId: secret, scheduleId: 'scd_canary'});
    const responses = [
      await post(signed),
      await post({...signed, headers: {...signed.headers, 'upstash-signature': secret}}),
      await post({...signed, headers: {...signed.headers, 'upstash-schedule-id': `${secret}!`}}),
      await post(call({}, body('ledger-relay', secret))),
    ];
    for (const response of responses) {
      const printed = JSON.stringify([await response.text(), [...response.headers.entries()]]);
      expect(printed).not.toContain(secret);
      expect(printed).not.toContain('scd_canary');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(responses.map((response) => response.status)).toEqual([200, 401, 400, 403]);
  });
});

// The SDK switches to signing keys that are PUBLISHED in its own source when `devMode` is undefined and QSTASH_DEV is set in the process environment
// (node_modules/@upstash/qstash/index.js: shouldUseDevelopmentMode, getReceiverSigningKeys, DEV_CREDENTIALS). Anyone can sign with those, so the route
// builds its Receiver with `devMode: false`. This pins that by what the route DOES, not by what its source says: it signs a body with the SDK's own
// development keys, read from the SDK at run time (they are public, and matching them here would put a key-shaped string in the repository).
describe('the SDK\'s development mode is never on, whatever QSTASH_DEV says (devMode: false)', () => {
  const sdkSource = readFileSync(createRequire(import.meta.url).resolve('@upstash/qstash'), 'utf8');
  const block = /DEV_CREDENTIALS\s*=\s*\{([^}]*)\}/.exec(sdkSource)?.[1] ?? '';
  const development = {current: /currentSigningKey:\s*"([^"]+)"/.exec(block)?.[1] ?? '', next: /nextSigningKey:\s*"([^"]+)"/.exec(block)?.[1] ?? ''};

  it('finds the SDK\'s published development keys, and they are not the keys this environment is configured with', () => {
    expect(development.current.length).toBeGreaterThan(16);
    expect(development.next.length).toBeGreaterThan(16);
    expect(development.current).not.toBe(development.next);
    expect([development.current, development.next]).not.toContain(env.QSTASH_CURRENT_SIGNING_KEY);
    expect([development.current, development.next]).not.toContain(env.QSTASH_NEXT_SIGNING_KEY);
  });

  it('is a signature the SDK itself accepts in its development mode (so a 401 below is the route\'s doing, not a malformed token)', async () => {
    vi.stubEnv('QSTASH_DEV', 'true');
    for (const key of [development.current, development.next]) {
      const signed = call({key});
      // A Receiver that leaves `devMode` undefined, as the SDK's default does, takes the published keys from the SDK when QSTASH_DEV is set.
      expect(await new Receiver({currentSigningKey: testSigningKeys.current, nextSigningKey: testSigningKeys.next}).verify({signature: signed.headers['upstash-signature'], body: signed.body})).toBe(true);
      // ... and the same SDK refuses it once development mode is explicitly off, which is how the route builds its Receiver.
      await expect(new Receiver({devMode: false, currentSigningKey: testSigningKeys.current, nextSigningKey: testSigningKeys.next}).verify({signature: signed.headers['upstash-signature'], body: signed.body})).rejects.toThrow();
    }
  });

  it.each(['true', '1'])('answers 401, and claims nothing and writes no receipt, for a body signed with either development key when QSTASH_DEV=%s', async (value) => {
    vi.stubEnv('QSTASH_DEV', value);
    for (const key of [development.current, development.next]) {
      const response = await post(call({key}));
      expect([response.status, await response.json()]).toEqual([401, {error: 'unauthorized'}]);
    }
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  });

  it('answers 401 for the same calls with QSTASH_DEV unset, and 200 for a call signed with the configured keys whatever it says', async () => {
    expect((await post(call({key: development.current}))).status).toBe(401);
    for (const value of ['true', '1', 'false', '']) {
      vi.stubEnv('QSTASH_DEV', value);
      expect((await post(call({key: testSigningKeys.current}))).status, value).toBe(200);
      expect((await post(call({key: testSigningKeys.next}))).status, value).toBe(200);
    }
  });
});
