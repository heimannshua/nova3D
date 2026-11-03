import {randomUUID} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import * as route from '@/app/api/dispatch/route';
import {
  configuredPublishing,
  dispatchConstants,
  dispatchPath,
  handleDispatchRequest,
  maxDispatchBodyBytes,
  publishRows,
  publishSubmitted,
  runOutboxSweep,
  runTestWorkload,
  sweepPublishLimit,
  workloadResultDigest,
} from '@/lib/job-dispatch';
import type {ClaimedAttempt, OutboxRow} from '@/lib/job-commands';
import {fakePublisher} from '../support/job-world';
import {signDelivery, signedCall, testSigningKeys} from '../support/qstash-signature';

// Dispatch (Story 2.7, lib/job-dispatch.ts) without a database: the constants, the publisher and the sweep's publishing, the deterministic test workload under a fence, and
// the dispatch route's order of checks. The database is a stand-in for the calls each makes (the instance identity read and the Story 2.7 functions); the real functions are
// covered by tests/integration/job-dispatch.test.ts, and signatures are made the way QStash makes them (tests/support/qstash-signature.ts: the real SDK Receiver verifies them).
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ATTEMPT = 'bb8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6c';
const JOB = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const STEP = 'dd8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6e';
const OPERATION = 'ee8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6f';
const SECOND_OPERATION = 'ee8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b70';
const FENCE = '2b8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b62';
const SCHEDULE = '3c8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b63';
const DIGEST = 'a'.repeat(64);
const at = '2026-10-29T12:00:00.123456+00:00';
const later = '2026-10-29T12:02:00.000000+00:00';

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
const calls = () => sent.map((call) => call.name);
const accounts = () => ({env, fetch: database});

// What the database answers, in the shapes of the composite types of the migration.
const claimFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'claimed',
  attempt_id: ATTEMPT,
  job_id: JOB,
  kind: 'test_workload',
  fence: FENCE,
  expires_at: later,
  plan: {},
  input_digest: DIGEST,
  project_revision: 7,
  account_epoch: 3,
  worker_version: 1,
  state: 'running',
  ...patch,
});
const operationWire = (patch: Record<string, unknown> = {}) => ({
  step_key: 'search',
  ordinal: 1,
  schedule_id: SCHEDULE,
  provider: 'fixture',
  model: 'fixture-model',
  api_version: 'fixture-1',
  request_bytes: 1000,
  image_count: 0,
  output_limit: 100,
  ...patch,
});
const stepped = (operation: string | null = OPERATION, outcome = 'stepped') => json({outcome, step_id: STEP, operation_id: operation, operation_state: operation === null ? null : 'dispatched', attempt_state: 'running'});
const operationFinished = (operation = OPERATION) => json({outcome: 'finished', operation_id: operation, state: 'completed', settled_microdollars: 2, released_microdollars: 3400, over_microdollars: 0});
const attemptFinished = (state: string, patch: Record<string, unknown> = {}) =>
  json({outcome: 'finished', attempt_id: ATTEMPT, state, stage: 'search', reason: state === 'failed' ? 'step_failed' : null, detail: state === 'failed' ? 'step_failed' : null, ...patch});
const outboxRow = (index: number) => ({
  id: `${index}`.padStart(8, '0') + '-0000-4000-8000-000000000000',
  attempt_id: `${index}`.padStart(8, 'a') + '-0000-4000-8000-000000000000',
  job_id: `${index}`.padStart(8, 'b') + '-0000-4000-8000-000000000000',
  kind: 'test_workload',
  created_at: at,
});

beforeEach(() => {
  sent = [];
  identityReads = 0;
  identity = () => json([{environment: 'local', instance_id: INSTANCE}]);
  answers = {};
});
afterEach(() => vi.restoreAllMocks());

describe('the recorded constants', () => {
  it('holds the numbers the story fixes: a 120-second lease renewed every 30, a 15-second publish grace and a 60-second publish lease, 3 open Jobs, alarms at 120 and 300 seconds, the built-in step version 1 and its one kind', () => {
    expect(dispatchConstants).toEqual({
      leaseSeconds: 120,
      renewalSeconds: 30,
      publishGraceSeconds: 15,
      publishLeaseSeconds: 60,
      openJobLimit: 3,
      outboxAlarmSeconds: 120,
      leaseAlarmSeconds: 300,
      builtinVersion: 1,
      builtinKind: 'test_workload',
    });
    expect(dispatchPath).toBe('/api/dispatch');
    expect(sweepPublishLimit).toBe(20);
  });

  it('keeps the renewal well inside the lease: a worker that renews on time never loses it', () => {
    expect(dispatchConstants.renewalSeconds * 2).toBeLessThan(dispatchConstants.leaseSeconds);
  });
});

describe('configuredPublishing', () => {
  const good = {
    QSTASH_TOKEN: 'qstash-token-for-tests-only-0123456789',
    QSTASH_URL: 'https://qstash-us-east-1.upstash.io',
    APP_ORIGIN: 'https://nova3d.example.test',
    INSTANCE_ID: INSTANCE,
    APP_ENV: 'staging',
  };

  it('is the queue\'s client and the address <APP_ORIGIN>/api/dispatch for this instance when everything is set', () => {
    const config = configuredPublishing(good);
    expect(config).not.toBeNull();
    expect(config!.url).toBe('https://nova3d.example.test/api/dispatch');
    expect(config!.instanceId).toBe(INSTANCE);
    expect(typeof config!.publish).toBe('function');
  });

  it('lower-cases and trims the instance', () => {
    expect(configuredPublishing({...good, INSTANCE_ID: ` ${INSTANCE.toUpperCase()} `})!.instanceId).toBe(INSTANCE);
  });

  it.each([
    ['no token', {QSTASH_TOKEN: undefined}],
    ['an empty token', {QSTASH_TOKEN: '  '}],
    ['a placeholder token', {QSTASH_TOKEN: 'replace-with-the-queue-token'}],
    ['no endpoint', {QSTASH_URL: undefined}],
    ['a placeholder endpoint', {QSTASH_URL: 'replace-with-the-endpoint'}],
    ['no origin', {APP_ORIGIN: undefined}],
    ['a placeholder origin', {APP_ORIGIN: '<the origin>'}],
    ['an origin with a path', {APP_ORIGIN: 'https://nova3d.example.test/app'}],
    ['an origin with a trailing slash', {APP_ORIGIN: 'https://nova3d.example.test/'}],
    ['an origin with credentials', {APP_ORIGIN: 'https://user:pass@nova3d.example.test'}],
    ['an origin that is not an origin', {APP_ORIGIN: 'nova3d'}],
    ['an insecure origin for staging', {APP_ORIGIN: 'http://nova3d.example.test'}],
    ['no instance', {INSTANCE_ID: undefined}],
    ['an instance that is not a UUID', {INSTANCE_ID: 'prod'}],
    ['a placeholder instance', {INSTANCE_ID: 'changeme'}],
  ])('is null with %s, and never says which part is missing', (_label, change) => {
    expect(configuredPublishing({...good, ...change})).toBeNull();
  });

  it('is null in an environment that holds nothing, and reads the process\'s environment by default without throwing', () => {
    expect(configuredPublishing({})).toBeNull();
    expect(() => configuredPublishing()).not.toThrow();
  });

  it('accepts a plain http origin where the environment is local', () => {
    expect(configuredPublishing({...good, APP_ENV: 'local', APP_ORIGIN: 'http://127.0.0.1:3000'})!.url).toBe('http://127.0.0.1:3000/api/dispatch');
  });

  describe('the real publisher: what the queue receives', () => {
    // The SDK's client is real; only the network under it is stood in for. This is the one place that proves the two settings that make a dispatch safe: the queue never retries a
    // failed dispatch (a failed attempt is terminal until the user retries), and a message published twice is held once (the outbox row's ID is its deduplication ID).
    const OUTBOX_ID = '0a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
    const published: {url: string; method: string; headers: Headers; body: string}[] = [];

    const stubNetwork = (answer: () => Response = () => new Response(JSON.stringify({messageId: 'msg_from_the_queue'}), {status: 201, headers: {'content-type': 'application/json'}})) => {
      published.length = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown, init?: RequestInit) => {
          const request = input instanceof Request ? input : null;
          published.push({
            url: request ? request.url : String(input),
            method: request ? request.method : String(init?.method),
            headers: new Headers(request ? request.headers : (init?.headers as HeadersInit)),
            body: request ? await request.text() : String(init?.body),
          });
          return answer();
        }),
      );
    };
    afterEach(() => vi.unstubAllGlobals());

    const publishOnce = () => configuredPublishing(good)!.publish({url: 'https://nova3d.example.test/api/dispatch', body: {attempt: ATTEMPT, instance: INSTANCE}, deduplicationId: OUTBOX_ID});

    it('sends one POST to the queue for the dispatch route, with {attempt, instance} as JSON, Upstash-Retries 0 and the outbox ID as Upstash-Deduplication-Id', async () => {
      stubNetwork();
      expect(await publishOnce()).toEqual({messageId: 'msg_from_the_queue'});
      expect(published).toHaveLength(1);
      const [request] = published;
      expect(request.method).toBe('POST');
      // The queue's endpoint is the configured region's, and the destination is the application's own dispatch route.
      expect(request.url).toBe('https://qstash-us-east-1.upstash.io/v2/publish/https://nova3d.example.test/api/dispatch');
      expect(JSON.parse(request.body)).toEqual({attempt: ATTEMPT, instance: INSTANCE});
      expect(request.headers.get('content-type')).toBe('application/json');
      expect(request.headers.get('authorization')).toBe(`Bearer ${good.QSTASH_TOKEN}`);
      // The two settings that matter: no retry by the queue, and the outbox row's ID to deduplicate by.
      expect(request.headers.get('upstash-retries')).toBe('0');
      expect(request.headers.get('upstash-deduplication-id')).toBe(OUTBOX_ID);
    });

    it('carries nothing else of the Job: no Account, no Project, no plan, no fence, in the body or in the headers', async () => {
      stubNetwork();
      await publishOnce();
      expect(Object.keys(JSON.parse(published[0].body)).sort()).toEqual(['attempt', 'instance']);
      const forwarded = [...published[0].headers.keys()].filter((name) => name.startsWith('upstash-forward-'));
      expect(forwarded).toEqual([]);
    });

    it('uses the deduplication ID of the row each time: two rows are two ID\'s, the same row is the same ID', async () => {
      stubNetwork();
      const publish = configuredPublishing(good)!.publish;
      const other = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
      await publish({url: 'https://nova3d.example.test/api/dispatch', body: {attempt: ATTEMPT, instance: INSTANCE}, deduplicationId: OUTBOX_ID});
      await publish({url: 'https://nova3d.example.test/api/dispatch', body: {attempt: ATTEMPT, instance: INSTANCE}, deduplicationId: OUTBOX_ID});
      await publish({url: 'https://nova3d.example.test/api/dispatch', body: {attempt: ATTEMPT, instance: INSTANCE}, deduplicationId: other});
      expect(published.map((request) => request.headers.get('upstash-deduplication-id'))).toEqual([OUTBOX_ID, OUTBOX_ID, other]);
      expect(published.every((request) => request.headers.get('upstash-retries') === '0')).toBe(true);
    });

    it('lets a refusal of the queue reach the caller as an error (the row is then left for the sweep), and does not retry it on its own', async () => {
      stubNetwork(() => new Response(JSON.stringify({error: 'unauthorized'}), {status: 401, headers: {'content-type': 'application/json'}}));
      await expect(publishOnce()).rejects.toBeDefined();
      // (The SDK may retry a failed request of its own; this module asks it not to retry the DELIVERY, which is the header above. Here the refusal is simply not swallowed.)
      expect(published.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('publishRows', () => {
  beforeEach(() => {
    answers.mark_published = (body) => json({outcome: 'marked', message_id: body.p_message_id});
  });
  const rows = (count: number): OutboxRow[] =>
    Array.from({length: count}, (_, index) => {
      const row = outboxRow(index + 1);
      return {id: row.id, attemptId: row.attempt_id, jobId: row.job_id, kind: row.kind, createdAt: row.created_at};
    });

  it('publishes each row once to <origin>/api/dispatch with {attempt, instance} and the OUTBOX ID as the deduplication ID, then records the message ID under the row', async () => {
    const queue = fakePublisher();
    const report = await publishRows(rows(2), queue.config(INSTANCE, 'https://nova3d.example.test'), accounts());
    expect(report).toEqual({published: 2, failed: 0});
    expect(queue.calls.map((call) => [call.url, call.body, call.deduplicationId])).toEqual(
      rows(2).map((row) => ['https://nova3d.example.test/api/dispatch', {attempt: row.attemptId, instance: INSTANCE}, row.id]),
    );
    expect(sent.map((call) => call.name)).toEqual(['mark_published', 'mark_published']);
    expect(sent.map((call) => call.body)).toEqual(rows(2).map((row, index) => ({p_outbox_id: row.id, p_message_id: queue.calls[index].messageId})));
  });

  it('counts a publication the queue refuses and goes on with the rest: one refusal does not keep the others from being published, and a refused row is not marked', async () => {
    const queue = fakePublisher();
    queue.failNext(1);
    const report = await publishRows(rows(3), queue.config(INSTANCE), accounts());
    expect(report).toEqual({published: 2, failed: 1});
    expect(queue.asked()).toBe(3);
    expect(sent.map((call) => call.body.p_outbox_id)).toEqual([rows(3)[1].id, rows(3)[2].id]);
  });

  it('counts a row whose message ID cannot be recorded (the database does not answer) as failed, and still goes on', async () => {
    const queue = fakePublisher();
    let first = true;
    answers.mark_published = (body) => {
      if (first) {
        first = false;
        return json({message: 'down'}, 503);
      }
      return json({outcome: 'marked', message_id: body.p_message_id});
    };
    expect(await publishRows(rows(2), queue.config(INSTANCE), accounts())).toEqual({published: 1, failed: 1});
    // The queue took both: publishing the first again later is deduplicated by the outbox ID and answers the same message ID.
    expect(queue.calls).toHaveLength(2);
  });

  it('counts a row that already holds another message ID (the conflict) as published: the queue deduplicated this one, and the row has its one message ID', async () => {
    const queue = fakePublisher();
    answers.mark_published = () => json({outcome: 'conflict', message_id: 'msg_first'});
    expect(await publishRows(rows(1), queue.config(INSTANCE), accounts())).toEqual({published: 1, failed: 0});
  });

  it('publishes nothing for no rows, never throws, and a publisher that throws something that is not an Error is a refusal too', async () => {
    const queue = fakePublisher();
    expect(await publishRows([], queue.config(INSTANCE), accounts())).toEqual({published: 0, failed: 0});
    const strange = {publish: async () => { throw 'a string'; }, url: 'http://127.0.0.1:4173/api/dispatch', instanceId: INSTANCE};
    expect(await publishRows(rows(1), strange as never, accounts())).toEqual({published: 0, failed: 1});
  });

  it('publishes a row once even when the queue is asked twice under one outbox ID: the queue answers the same message ID', async () => {
    const queue = fakePublisher();
    await publishRows(rows(1), queue.config(INSTANCE), accounts());
    await publishRows(rows(1), queue.config(INSTANCE), accounts());
    expect(new Set(queue.calls.map((call) => call.messageId)).size).toBe(1);
  });
});

describe('publishSubmitted', () => {
  beforeEach(() => {
    answers.mark_published = (body) => json({outcome: 'marked', message_id: body.p_message_id});
  });
  const OUTBOX = outboxRow(1).id;

  it('claims the one named row at any age and publishes it at once', async () => {
    answers.claim_outbox = () => json({claimed: 1, items: [outboxRow(1)]});
    const queue = fakePublisher();
    expect(await publishSubmitted(OUTBOX, {config: queue.config(INSTANCE), accounts: accounts()})).toBe('published');
    expect(sent[0]).toEqual({name: 'claim_outbox', body: {p_limit: 1, p_outbox_id: OUTBOX}});
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0].deduplicationId).toBe(OUTBOX);
  });

  it('is `skipped` when nothing was claimed: another publisher holds the row, or it is already published', async () => {
    answers.claim_outbox = () => json({claimed: 0, items: []});
    const queue = fakePublisher();
    expect(await publishSubmitted(OUTBOX, {config: queue.config(INSTANCE), accounts: accounts()})).toBe('skipped');
    expect(queue.calls).toEqual([]);
    expect(calls()).toEqual(['claim_outbox']);
  });

  it('is `failed`, and leaves the row for the sweep, when the queue refuses', async () => {
    answers.claim_outbox = () => json({claimed: 1, items: [outboxRow(1)]});
    const queue = fakePublisher();
    queue.setFailing(true);
    expect(await publishSubmitted(OUTBOX, {config: queue.config(INSTANCE), accounts: accounts()})).toBe('failed');
    expect(calls()).toEqual(['claim_outbox']);
  });

  it('is `failed` and asks nothing when no queue is configured (a deployment without one: the sweep has nothing to publish with either)', async () => {
    expect(await publishSubmitted(OUTBOX, {config: null, accounts: accounts()})).toBe('failed');
    expect(await publishSubmitted(OUTBOX, {env: {}, accounts: accounts()})).toBe('failed');
    expect(sent).toEqual([]);
  });

  it('never throws: a database that does not answer the claim is `failed` too', async () => {
    answers.claim_outbox = () => json({message: 'down'}, 503);
    const queue = fakePublisher();
    expect(await publishSubmitted(OUTBOX, {config: queue.config(INSTANCE), accounts: accounts()})).toBe('failed');
    answers.claim_outbox = () => json('nonsense');
    expect(await publishSubmitted(OUTBOX, {config: queue.config(INSTANCE), accounts: accounts()})).toBe('failed');
    expect(queue.calls).toEqual([]);
  });
});

describe('runOutboxSweep', () => {
  beforeEach(() => {
    answers.sweep_attempts = () => json({expired: 1, cancelled: 2, settled: 3, marked: 4, reconciled: 5, failed: 6});
    answers.mark_published = (body) => json({outcome: 'marked', message_id: body.p_message_id});
  });

  it('sweeps the database first, then claims at most 20 rows and publishes them, and reports every count', async () => {
    answers.claim_outbox = () => json({claimed: 2, items: [outboxRow(1), outboxRow(2)]});
    const queue = fakePublisher();
    expect(await runOutboxSweep({config: queue.config(INSTANCE), accounts: accounts()})).toEqual({
      expired: 1,
      cancelled: 2,
      settled: 3,
      marked: 4,
      reconciled: 5,
      failed: 6,
      claimed: 2,
      published: 2,
      publishFailed: 0,
      configured: true,
    });
    expect(calls()).toEqual(['sweep_attempts', 'claim_outbox', 'mark_published', 'mark_published']);
    expect(sent[1].body).toEqual({p_limit: 20, p_outbox_id: null});
  });

  it('counts a refused publication and still reports the rest', async () => {
    answers.claim_outbox = () => json({claimed: 2, items: [outboxRow(1), outboxRow(2)]});
    const queue = fakePublisher();
    queue.failNext(1);
    expect(await runOutboxSweep({config: queue.config(INSTANCE), accounts: accounts()})).toMatchObject({claimed: 2, published: 1, publishFailed: 1, configured: true});
  });

  it('does the database\'s work and claims nothing with no queue configured: claiming would only hold the rows for a minute', async () => {
    expect(await runOutboxSweep({config: null, accounts: accounts()})).toEqual({expired: 1, cancelled: 2, settled: 3, marked: 4, reconciled: 5, failed: 6, claimed: 0, published: 0, publishFailed: 0, configured: false});
    expect(await runOutboxSweep({env: {}, accounts: accounts()})).toMatchObject({claimed: 0, configured: false});
    expect(calls()).toEqual(['sweep_attempts', 'sweep_attempts']);
  });

  it('reports a sweep that marked, reconciled and failed nothing as zeros, and carries the three counts of Story 2.8 into the report whatever else it did', async () => {
    answers.sweep_attempts = () => json({expired: 0, cancelled: 0, settled: 0, marked: 0, reconciled: 0, failed: 0});
    expect(await runOutboxSweep({config: null, accounts: accounts()})).toEqual({
      expired: 0,
      cancelled: 0,
      settled: 0,
      marked: 0,
      reconciled: 0,
      failed: 0,
      claimed: 0,
      published: 0,
      publishFailed: 0,
      configured: false,
    });
  });

  it('refuses a sweep answer that lacks one of the three new counts (the shape is checked, nothing is invented)', async () => {
    answers.sweep_attempts = () => json({expired: 1, cancelled: 2, settled: 3});
    await expect(runOutboxSweep({config: null, accounts: accounts()})).rejects.toMatchObject({name: 'AccountsUnavailableError'});
  });

  it('publishes nothing when no row is old enough', async () => {
    answers.claim_outbox = () => json({claimed: 0, items: []});
    const queue = fakePublisher();
    expect(await runOutboxSweep({config: queue.config(INSTANCE), accounts: accounts()})).toMatchObject({claimed: 0, published: 0, publishFailed: 0, configured: true});
    expect(queue.calls).toEqual([]);
  });

  it('publishes the rows even when the database does not answer the sweep, and then fails the run (a dispatch does not wait for a lease to be cleaned up; the scheduler retries)', async () => {
    answers.sweep_attempts = () => json({message: 'down'}, 503);
    answers.claim_outbox = () => json({claimed: 2, items: [outboxRow(1), outboxRow(2)]});
    const queue = fakePublisher();
    await expect(runOutboxSweep({config: queue.config(INSTANCE), accounts: accounts()})).rejects.toMatchObject({name: 'AccountsUnavailableError'});
    // Bite: a sweep that stops at the first failure would call nothing after sweep_attempts and publish nothing.
    expect(calls()).toEqual(['sweep_attempts', 'claim_outbox', 'mark_published', 'mark_published']);
    expect(queue.calls).toHaveLength(2);
    expect(queue.calls.map((call) => call.deduplicationId)).toEqual([outboxRow(1).id, outboxRow(2).id]);
  });

  it('fails the run for a failed sweep even with no queue configured (nothing to publish with), and for one that fails on top of a refused publication', async () => {
    answers.sweep_attempts = () => json({message: 'down'}, 503);
    await expect(runOutboxSweep({config: null, accounts: accounts()})).rejects.toMatchObject({name: 'AccountsUnavailableError'});
    expect(calls()).toEqual(['sweep_attempts']);
    answers.claim_outbox = () => json({claimed: 1, items: [outboxRow(1)]});
    const queue = fakePublisher();
    queue.setFailing(true);
    await expect(runOutboxSweep({config: queue.config(INSTANCE), accounts: accounts()})).rejects.toMatchObject({name: 'AccountsUnavailableError'});
  });

  it('throws when the database does not answer the claim, after the sweep', async () => {
    answers.claim_outbox = () => json({message: 'down'}, 503);
    await expect(runOutboxSweep({config: fakePublisher().config(INSTANCE), accounts: accounts()})).rejects.toMatchObject({name: 'AccountsUnavailableError'});
    expect(calls()).toEqual(['sweep_attempts', 'claim_outbox']);
  });
});

describe('workloadResultDigest', () => {
  it('is sha256 of "nova3d-test-workload:v1:" followed by the input digest, in lower-case hex', () => {
    expect(workloadResultDigest(DIGEST)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is a function of the input digest alone, and a different input digest gives a different result', () => {
    expect(workloadResultDigest(DIGEST)).toBe(workloadResultDigest(DIGEST));
    expect(workloadResultDigest('b'.repeat(64))).not.toBe(workloadResultDigest(DIGEST));
  });

  it('is exactly the SHA-256 of the labelled text (checked against the platform\'s own)', async () => {
    const bytes = new TextEncoder().encode(`nova3d-test-workload:v1:${DIGEST}`);
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    expect(workloadResultDigest(DIGEST)).toBe(hash);
  });
});

describe('runTestWorkload', () => {
  const claim = (plan: ClaimedAttempt['plan']): ClaimedAttempt => ({
    attemptId: ATTEMPT,
    jobId: JOB,
    kind: 'test_workload',
    fence: FENCE,
    expiresAt: later,
    plan,
    inputDigest: DIGEST,
    projectRevision: 7,
    accountEpoch: 3,
    workerVersion: 1,
    ...{},
  });
  const operation = (patch: Record<string, unknown> = {}) => ({
    stepKey: 'search',
    ordinal: 1,
    scheduleId: SCHEDULE,
    provider: 'fixture',
    model: 'fixture-model',
    apiVersion: 'fixture-1',
    requestBytes: 1000,
    imageCount: 0,
    outputLimit: 100,
    ...patch,
  });
  beforeEach(() => {
    answers.run_step = () => stepped();
    answers.finish_operation = (request) => operationFinished(String(request.p_operation_id));
    answers.finish_attempt = (body) => attemptFinished(body.p_to === 'failed' ? 'failed' : 'completed');
  });

  it('with no operation begins the one step `work`, then finishes the attempt completed with the digest of the labelled input', async () => {
    answers.run_step = () => stepped(null);
    expect(await runTestWorkload(claim({}), accounts())).toEqual({end: 'completed', refusal: null});
    expect(sent).toEqual([
      {name: 'run_step', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_step_key: 'work', p_ordinal: null}},
      {name: 'finish_attempt', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_to: 'completed', p_result_digest: workloadResultDigest(DIGEST), p_revision: null}},
    ]);
  });

  it('runs each planned operation in order: its own step and ordinal first (run_step), then its completion with 1 input and 1 output token and the requested model (finish_operation), then finishes completed', async () => {
    let step = 0;
    answers.run_step = () => stepped([OPERATION, SECOND_OPERATION][step++]);
    const plan = {operations: [operation(), operation({stepKey: 'synthesize', ordinal: 2, model: 'second-model'})]};
    expect(await runTestWorkload(claim(plan), accounts())).toEqual({end: 'completed', refusal: null});
    expect(sent).toEqual([
      {name: 'run_step', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_step_key: 'search', p_ordinal: 1}},
      {name: 'finish_operation', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_operation_id: OPERATION, p_outcome: 'completed', p_input_tokens: 1, p_output_tokens: 1, p_returned_model: 'fixture-model', p_request_id: null}},
      {name: 'run_step', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_step_key: 'synthesize', p_ordinal: 2}},
      {name: 'finish_operation', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_operation_id: SECOND_OPERATION, p_outcome: 'completed', p_input_tokens: 1, p_output_tokens: 1, p_returned_model: 'second-model', p_request_id: null}},
      {name: 'finish_attempt', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_to: 'completed', p_result_digest: workloadResultDigest(DIGEST), p_revision: null}},
    ]);
  });

  it('does not begin the step `work` when there are operations', async () => {
    await runTestWorkload(claim({operations: [operation()]}), accounts());
    expect(sent.map((call) => call.body.p_step_key)).not.toContain('work');
  });

  it('when the plan says fail, dispatches the first operation and fails the attempt there: the operation is never completed (it stays chargeable) and the second is never begun', async () => {
    const plan = {outcome: 'fail' as const, operations: [operation(), operation({stepKey: 'synthesize', ordinal: 2})]};
    expect(await runTestWorkload(claim(plan), accounts())).toEqual({end: 'failed', refusal: null});
    expect(sent).toEqual([
      {name: 'run_step', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_step_key: 'search', p_ordinal: 1}},
      {name: 'finish_attempt', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_to: 'failed', p_result_digest: null, p_revision: null}},
    ]);
  });

  it('when the plan says fail with no operation, begins the step `work` and fails the attempt', async () => {
    answers.run_step = () => stepped(null);
    expect(await runTestWorkload(claim({outcome: 'fail'}), accounts())).toEqual({end: 'failed', refusal: null});
    expect(calls()).toEqual(['run_step', 'finish_attempt']);
    expect(sent[0].body.p_step_key).toBe('work');
    expect(sent[1].body).toMatchObject({p_to: 'failed'});
  });

  it('with the plan outcome `complete` stated, completes as it does without one', async () => {
    expect(await runTestWorkload(claim({outcome: 'complete', operations: [operation()]}), accounts())).toEqual({end: 'completed', refusal: null});
  });

  it('treats a step that already exists (a duplicate delivery of the same step) as a step, and goes on', async () => {
    answers.run_step = () => stepped(OPERATION, 'replayed');
    expect(await runTestWorkload(claim({operations: [operation()]}), accounts())).toEqual({end: 'completed', refusal: null});
  });

  it.each(['fence_mismatch', 'cancelled', 'expired', 'revoked', 'not_running', 'unavailable', 'not_planned'])(
    'stops where it is, with nothing further called and no finish, when a step is refused with %s',
    async (refusal) => {
      let step = 0;
      answers.run_step = () => (step++ === 0 ? stepped() : json({outcome: refusal}));
      const plan = {operations: [operation(), operation({stepKey: 'synthesize', ordinal: 2}), operation({stepKey: 'third', ordinal: 3})]};
      expect(await runTestWorkload(claim(plan), accounts())).toEqual({end: 'stopped', refusal});
      // The first operation ran; the second step was refused; the third was never tried and the attempt was never finished.
      expect(calls()).toEqual(['run_step', 'finish_operation', 'run_step']);
    },
  );

  it.each(['fence_mismatch', 'cancelled', 'expired', 'revoked', 'not_running', 'unavailable', 'not_dispatched', 'invalid_transition', 'already_settled', 'invalid_evidence', 'not_found'])(
    'stops, with the attempt not finished, when an operation\'s completion is refused with %s',
    async (refusal) => {
      answers.finish_operation = () => json({outcome: refusal, operation_id: OPERATION, state: 'planned'});
      expect(await runTestWorkload(claim({operations: [operation(), operation({stepKey: 'synthesize', ordinal: 2})]}), accounts())).toEqual({end: 'stopped', refusal});
      expect(calls()).toEqual(['run_step', 'finish_operation']);
    },
  );

  it('stops when the step names no operation although an ordinal was asked for (an answer the typed call would refuse as well)', async () => {
    answers.run_step = () => json({outcome: 'not_planned'});
    expect(await runTestWorkload(claim({operations: [operation()]}), accounts())).toEqual({end: 'stopped', refusal: 'not_planned'});
    expect(calls()).toEqual(['run_step']);
  });

  it('ends `rejected` when the result is refused because the Project moved: nothing is published', async () => {
    answers.finish_attempt = () => attemptFinished('failed', {outcome: 'rejected', detail: 'stale_revision'});
    expect(await runTestWorkload(claim({operations: [operation()]}), accounts())).toEqual({end: 'rejected', refusal: null});
  });

  it.each(['open_operations', 'fence_mismatch', 'cancelled', 'expired', 'revoked', 'not_running', 'unavailable'])('stops when the finish is refused with %s', async (refusal) => {
    answers.finish_attempt = () => json({outcome: refusal, attempt_id: ATTEMPT, state: 'running', stage: 'search'});
    expect(await runTestWorkload(claim({operations: [operation()]}), accounts())).toEqual({end: 'stopped', refusal});
  });

  it('counts a replay of the finish as the end it was', async () => {
    answers.run_step = () => stepped(null);
    answers.finish_attempt = () => attemptFinished('completed', {outcome: 'replayed'});
    expect(await runTestWorkload(claim({}), accounts())).toEqual({end: 'completed', refusal: null});
    answers.finish_attempt = () => attemptFinished('failed', {outcome: 'replayed'});
    expect(await runTestWorkload(claim({outcome: 'fail'}), accounts())).toEqual({end: 'failed', refusal: null});
  });

  it('throws, and finishes nothing, when the database does not answer a step (the lease runs out and the sweep fails the attempt)', async () => {
    answers.run_step = () => json({message: 'down'}, 503);
    await expect(runTestWorkload(claim({}), accounts())).rejects.toMatchObject({name: 'AccountsUnavailableError'});
    expect(calls()).toEqual(['run_step']);
  });

  it('starts nothing external: it calls no provider, only the four database functions', async () => {
    await runTestWorkload(claim({operations: [operation()]}), accounts());
    for (const name of calls()) expect(['run_step', 'finish_operation', 'finish_attempt']).toContain(name);
  });
});

// The route --------------------------------------------------------------------------------------------------------------------------------------

const body = (attempt = ATTEMPT, instance = INSTANCE) => ({attempt, instance});
const post = (call: {body: string; headers: Record<string, string>}, options: {env?: Record<string, string | undefined>; method?: string} = {}) =>
  handleDispatchRequest(new Request('http://127.0.0.1:4173/api/dispatch', {method: options.method ?? 'POST', headers: call.headers, ...(options.method === 'GET' ? {} : {body: call.body})}), {
    env: options.env ?? env,
    accounts: {fetch: database},
  });
const call = (overrides: Parameters<typeof signedCall>[1] = {}, content: unknown = body()) =>
  signedCall(typeof content === 'string' ? content : JSON.stringify(content), {scheduleId: null, ...overrides});

describe('the dispatch route is one POST', () => {
  it('exports a POST handler and no other method, so Next.js answers 405 for the rest, and is never static', () => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic']);
    expect(route.dynamic).toBe('force-dynamic');
    expect(maxDispatchBodyBytes).toBe(1024);
  });
});

describe('dispatch 1. method', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])('answers 405 with Allow: POST for %s, whatever it carries, and asks nothing', async (method) => {
    const response = await handleDispatchRequest(new Request('http://127.0.0.1:4173/api/dispatch', {method, headers: call().headers}), {env, accounts: {fetch: database}});
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  });

  it('is checked before the keys: a GET to an unconfigured server is a 405, not a 503', async () => {
    expect((await post(call(), {env: {}, method: 'GET'})).status).toBe(405);
  });
});

describe('dispatch 2. keys', () => {
  it.each([
    ['neither key set', {QSTASH_CURRENT_SIGNING_KEY: undefined, QSTASH_NEXT_SIGNING_KEY: undefined}],
    ['no current key', {QSTASH_CURRENT_SIGNING_KEY: undefined}],
    ['no next key', {QSTASH_NEXT_SIGNING_KEY: undefined}],
    ['an empty key', {QSTASH_CURRENT_SIGNING_KEY: '   '}],
    ['a placeholder key', {QSTASH_NEXT_SIGNING_KEY: 'replace-with-the-next-signing-key'}],
  ])('answers 503, never 200, with %s, for a call that is signed and one that is not, and asks nothing', async (_name, change) => {
    for (const candidate of [call(), {body: JSON.stringify(body()), headers: {}}]) {
      const response = await post(candidate, {env: {...env, ...change}});
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({error: 'unavailable'});
    }
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  });
});

describe('dispatch 3. signature', () => {
  const refused = async (response: Response) => {
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({error: 'unauthorized'});
    // A foreign or invalid call claims nothing and asks nothing.
    expect(sent).toEqual([]);
    expect(identityReads).toBe(0);
  };
  const text = JSON.stringify(body());
  const withSignature = (signature: string | null) => {
    const {'upstash-signature': _dropped, ...rest} = call().headers;
    return {body: text, headers: signature === null ? rest : {...rest, 'upstash-signature': signature}};
  };

  it('refuses a call with no signature, an empty one, one that is not a token and one that is far too long', async () => {
    await refused(await post(withSignature(null)));
    await refused(await post(withSignature('')));
    await refused(await post(withSignature('not-a-token')));
    await refused(await post(withSignature(`${'a'.repeat(5000)}.b.c`)));
  });

  it('does not read the body of a call with no signature at all: it is refused first', async () => {
    const pulled = vi.fn();
    const stream = new ReadableStream(
      {
        pull(controller) {
          pulled();
          controller.enqueue(new TextEncoder().encode(text));
          controller.close();
        },
      },
      {highWaterMark: 0},
    );
    const {'upstash-signature': _dropped, ...unsigned} = call().headers;
    const request = new Request('http://127.0.0.1:4173/api/dispatch', {method: 'POST', headers: unsigned, body: stream, duplex: 'half'} as RequestInit);
    const response = await handleDispatchRequest(request, {env, accounts: {fetch: database}});
    expect(response.status).toBe(401);
    expect(pulled).not.toHaveBeenCalled();
  });

  it('refuses a token signed with a key that is neither the current nor the next one', async () => {
    await refused(await post(call({key: 'some-other-queues-signing-key-0000000000'})));
  });

  it('refuses a token for another body, even a one-character difference: the hash is over the raw body', async () => {
    const other = signDelivery(JSON.stringify(body(JOB)));
    await refused(await post({body: text, headers: {...call().headers, 'upstash-signature': other}}));
    await refused(await post({body: `${text} `, headers: call().headers}));
  });

  it('refuses an expired token, one not yet valid and one from another issuer', async () => {
    const now = Math.floor(Date.now() / 1000);
    await refused(await post(call({now: now - 3600, lifetime: 300})));
    await refused(await post(call({now: now + 3600})));
    await refused(await post(call({claims: {iss: 'Somebody Else'}})));
  });

  it('accepts a call signed with the current key and one signed with the next (a rotation in progress)', async () => {
    answers.claim_attempt = () => json(claimFields({outcome: 'already_claimed', fence: null}));
    expect((await post(call({key: testSigningKeys.current}))).status).toBe(200);
    expect((await post(call({key: testSigningKeys.next}))).status).toBe(200);
  });

  it('reads the body before it can check the signature: an oversize body is a 400 whether the call is signed or not, and a call with no signature at all is a 401', async () => {
    const big = JSON.stringify({attempt: ATTEMPT, instance: INSTANCE, padding: 'x'.repeat(maxDispatchBodyBytes)});
    const signed = call();
    const send = (headers: Record<string, string>, content: BodyInit) =>
      handleDispatchRequest(new Request('http://127.0.0.1:4173/api/dispatch', {method: 'POST', headers, body: content}), {env, accounts: {fetch: database}});
    for (const [headers, content] of [
      [{...signed.headers, 'upstash-signature': 'not-a-token'}, big],
      [{...signed.headers, 'upstash-signature': 'not-a-token', 'content-length': '99999999'}, text],
      [{...signed.headers, 'upstash-signature': 'not-a-token', 'content-length': 'many'}, text],
      [{...signed.headers, 'upstash-signature': signDelivery(big)}, big],
    ] as const) {
      const response = await send(headers, content);
      expect([response.status, await response.json()]).toEqual([400, {error: 'invalid_request'}]);
    }
    const {'upstash-signature': _dropped, ...unsigned} = signed.headers;
    const none = await send(unsigned, big);
    expect([none.status, await none.json()]).toEqual([401, {error: 'unauthorized'}]);
    expect(sent).toEqual([]);
  });

  it('never reflects the signature or a key in an answer or a log', async () => {
    const log = [vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined), vi.spyOn(console, 'log').mockImplementation(() => undefined)];
    const response = await post(call({key: 'some-other-queues-signing-key-0000000000'}));
    const printed = JSON.stringify([await response.text(), log.map((spy) => spy.mock.calls), [...response.headers.entries()]]);
    for (const secret of [testSigningKeys.current, testSigningKeys.next, 'some-other-queues-signing-key', call().headers['upstash-signature'].slice(0, 20)]) expect(printed).not.toContain(secret);
  });
});

describe('dispatch 4. body (the call is authentic from here on)', () => {
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
    ['a string', `"${ATTEMPT}"`],
    ['no instance', JSON.stringify({attempt: ATTEMPT})],
    ['no attempt', JSON.stringify({instance: INSTANCE})],
    ['the task body of the scheduled-job route', JSON.stringify({task: 'ledger-relay', instance: INSTANCE})],
    ['an extra key', JSON.stringify({attempt: ATTEMPT, instance: INSTANCE, extra: 1})],
    ['an attempt that is not a string', JSON.stringify({attempt: 7, instance: INSTANCE})],
    ['an attempt that is not an ID', JSON.stringify({attempt: 'nope', instance: INSTANCE})],
    ['an attempt with padding', JSON.stringify({attempt: ` ${ATTEMPT}`, instance: INSTANCE})],
    ['an instance that is not a string', JSON.stringify({attempt: ATTEMPT, instance: 7})],
    ['an instance far too long', JSON.stringify({attempt: ATTEMPT, instance: 'x'.repeat(80)})],
  ])('answers 400 for a signed body that is %s, and claims nothing', async (_name, content) => {
    await bad(await post(call({}, content)));
  });

  it('answers 400 for a body over 1 KB, signed, and does not read the rest of it', async () => {
    const big = JSON.stringify({attempt: ATTEMPT, instance: INSTANCE, padding: 'x'.repeat(maxDispatchBodyBytes)});
    await bad(await post(call({}, big)));
    await bad(await post({body: big, headers: {...call().headers, 'content-length': '99999999'}}));
  });

  it('answers 400 for a body that is not UTF-8, and for a stream that fails part way', async () => {
    const notText = new Request('http://127.0.0.1:4173/api/dispatch', {method: 'POST', headers: call().headers, body: new Uint8Array([0xff, 0xfe, 0x7b])});
    await bad(await handleDispatchRequest(notText, {env, accounts: {fetch: database}}));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"attempt"'));
        controller.error(new Error('connection reset'));
      },
    });
    const failing = new Request('http://127.0.0.1:4173/api/dispatch', {method: 'POST', headers: call().headers, body: stream, duplex: 'half'} as RequestInit);
    await bad(await handleDispatchRequest(failing, {env, accounts: {fetch: database}}));
  });

  it('needs no message ID and no schedule ID: a dispatch is a one-off message, not a scheduled one', async () => {
    answers.claim_attempt = () => json(claimFields({outcome: 'already_claimed', fence: null}));
    const signed = call();
    const headers: Record<string, string> = {...signed.headers};
    delete headers['upstash-message-id'];
    expect((await post({body: signed.body, headers})).status).toBe(200);
  });

  it('is checked before the environment: a bad body for another instance is a 400, not a 403', async () => {
    await bad(await post(call({}, JSON.stringify({attempt: 'nope', instance: randomUUID()}))));
  });
});

describe('dispatch 5. environment', () => {
  const wrong = async (response: Response) => {
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({error: 'wrong_environment'});
    expect(calls()).toEqual([]);
  };

  it('answers 403 for a call made for another instance, with no claim and no database read at all', async () => {
    await wrong(await post(call({}, body(ATTEMPT, randomUUID()))));
    expect(identityReads).toBe(0);
  });

  it('compares the instance without regard to case or padding, as INSTANCE_ID is compared everywhere', async () => {
    answers.claim_attempt = () => json(claimFields({outcome: 'already_claimed', fence: null}));
    expect((await post(call({}, body(ATTEMPT, ` ${INSTANCE.toUpperCase()} `)))).status).toBe(200);
  });

  it('answers 403 when this server has no instance ID, or the database row names another instance or another environment', async () => {
    await wrong(await post(call(), {env: {...env, INSTANCE_ID: undefined}}));
    identity = () => json([{environment: 'local', instance_id: randomUUID()}]);
    await wrong(await post(call()));
    identity = () => json([{environment: 'staging', instance_id: INSTANCE}]);
    await wrong(await post(call()));
    identity = () => json([]);
    await wrong(await post(call()));
    identity = () => json({code: '42501'}, 401);
    await wrong(await post(call()));
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
});

describe('dispatch 6. the claim and the run', () => {
  beforeEach(() => {
    answers.claim_attempt = () => json(claimFields());
    answers.run_step = () => stepped(null);
    answers.finish_operation = () => operationFinished();
    answers.finish_attempt = (request) => attemptFinished(request.p_to === 'failed' ? 'failed' : 'completed');
  });

  it('claims the attempt as the built-in step (no worker, no epoch), then runs the workload, and answers what ran', async () => {
    const response = await post(call());
    expect([response.status, await response.json()]).toEqual([200, {outcome: 'ran', end: 'completed'}]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(calls()).toEqual(['claim_attempt', 'run_step', 'finish_attempt']);
    // The built-in step names no worker, so there is no issuer to bind it to.
    expect(sent[0].body).toEqual({p_attempt_id: ATTEMPT, p_worker_id: null, p_issuer: null});
    expect(identityReads).toBe(1);
  });

  it('runs the plan the claim carries: operations in order, then the finish', async () => {
    answers.claim_attempt = () => json(claimFields({plan: {outcome: 'complete', operations: [operationWire()]}}));
    answers.run_step = () => stepped(OPERATION);
    const response = await post(call());
    expect([response.status, await response.json()]).toEqual([200, {outcome: 'ran', end: 'completed'}]);
    expect(calls()).toEqual(['claim_attempt', 'run_step', 'finish_operation', 'finish_attempt']);
  });

  it('answers a failing plan as it ended: ran, failed', async () => {
    answers.claim_attempt = () => json(claimFields({plan: {outcome: 'fail'}}));
    expect(await (await post(call())).json()).toEqual({outcome: 'ran', end: 'failed'});
  });

  it('answers a duplicate delivery 200 duplicate and does nothing: the claim is once', async () => {
    answers.claim_attempt = () => json(claimFields({outcome: 'already_claimed', fence: null, state: 'running'}));
    const response = await post(call());
    expect([response.status, await response.json()]).toEqual([200, {outcome: 'duplicate'}]);
    expect(calls()).toEqual(['claim_attempt']);
  });

  it('answers 200 not_waiting for an attempt that is already finished: a terminal attempt is never reclaimed, and nothing runs', async () => {
    for (const state of ['completed', 'failed', 'cancelled', 'running']) {
      sent = [];
      answers.claim_attempt = () => json(claimFields({outcome: 'not_waiting', fence: null, state}));
      const response = await post(call());
      expect([response.status, await response.json()]).toEqual([200, {outcome: 'not_waiting'}]);
      expect(calls()).toEqual(['claim_attempt']);
    }
  });

  it.each(['blocked', 'waiting_for_worker', 'incompatible', 'revoked', 'unavailable'])('answers 200 with the word %s and runs nothing: the attempt waits, or was cancelled', async (outcome) => {
    answers.claim_attempt = () => json(claimFields({outcome, fence: null, state: 'waiting'}));
    const response = await post(call());
    expect([response.status, await response.json()]).toEqual([200, {outcome}]);
    expect(calls()).toEqual(['claim_attempt']);
  });

  it('answers 503 and runs nothing when the database does not answer the claim, refuses it, or answers something that is not an answer', async () => {
    const failures = [() => json({message: 'down'}, 503), () => json({code: '42501'}, 401), () => json('claimed'), () => json(claimFields({outcome: 'maybe'})), () => json(claimFields({fence: 'nope'}))];
    for (const make of failures) {
      sent = [];
      answers.claim_attempt = make;
      const response = await post(call());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({error: 'unavailable'});
      expect(calls()).toEqual(['claim_attempt']);
    }
  });

  it('answers 503 and logs one fixed sentence when the workload cannot be finished (the database stops answering after the claim): the lease will run out and the sweep fails the attempt', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answers.run_step = () => json({message: 'down'}, 503);
    const response = await post(call());
    expect([response.status, await response.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(error.mock.calls).toEqual([['A dispatched test workload could not be finished.']]);
    expect(calls()).toEqual(['claim_attempt', 'run_step']);
  });

  it('answers ran/stopped, never a success of the workload, when a fenced command is refused after the claim', async () => {
    answers.run_step = () => json({outcome: 'cancelled'});
    expect(await (await post(call())).json()).toEqual({outcome: 'ran', end: 'stopped'});
    expect(calls()).toEqual(['claim_attempt', 'run_step']);
  });

  it('claims once for each delivery, whatever the schedule headers say, and never sends a fence it did not just get', async () => {
    await post(call({messageId: 'msg_a'}));
    await post(call({messageId: 'msg_b'}));
    expect(sent.filter((entry) => entry.name === 'claim_attempt')).toHaveLength(2);
    for (const entry of sent.filter((one) => one.name === 'run_step' || one.name === 'finish_attempt')) expect(entry.body.p_fence).toBe(FENCE);
  });
});
