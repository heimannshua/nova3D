import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {
  cancelAccountJobs,
  cancelJob,
  claimAttempt,
  claimOutbox,
  defaultListedJobs,
  defaultOutboxClaim,
  fenceRefusals,
  finishAttempt,
  finishOperation,
  listJobs,
  markPublished,
  maxListedJobs,
  maxOperationOrdinal,
  maxOutboxClaim,
  jsonbText,
  maxPlanBytes,
  maxPlannedOperations,
  planBytes,
  planFromWire,
  planOutcomes,
  planToWire,
  readJobDetail,
  reconcileOperation,
  reconcileReasons,
  reconcileRefusals,
  recordCallback,
  registerWorker,
  renewLease,
  runStep,
  submissionRefusals,
  submitJob,
  sweepAttempts,
  type WorkloadPlan,
} from '@/lib/job-commands';
import {endingDetails, finishedJobStates, isOpenState, jobStates, shownReasons, storedReasons, testWorkloadKind, waitingReasons} from '@/lib/job-view';

// The typed calls of the Story 2.7 functions (lib/job-commands.ts), against a fake fetch: what each sends (the Account and epoch from the operation, never a request's;
// the fence from the claim), what each accepts as an answer, and that an answer that cannot be got, or makes no sense, is an error: no state is invented. The real
// functions are tested against the real database in tests/integration/job-dispatch.test.ts.
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const JOB = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const ATTEMPT = 'bb8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6c';
const STEP = 'dd8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6e';
const OPERATION = 'ee8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6f';
const OUTBOX = 'ff8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b60';
const WORKER = '1a8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b61';
const FENCE = '2b8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b62';
const SCHEDULE = '3c8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b63';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const DIGEST = 'a'.repeat(64);
const RESULT = 'b'.repeat(64);
const JTI = 'AAAAAAAAAAAAAAAAAAAAAA';
const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only'};
const operation = {accountId: ACCOUNT, epoch: 3};
const at = '2026-10-29T12:00:00.123456+00:00';
const later = '2026-10-29T12:00:05.000000+00:00';

type Sent = {name: string; body: Record<string, unknown>; headers: Record<string, string>};
function fake(answer: unknown, status = 200) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    sent.push({name: input.split('/rpc/')[1], body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string>});
    return new Response(JSON.stringify(answer), {status, headers: {'content-type': 'application/json'}});
  });
  return {fetch, sent, options: {env, fetch}};
}
type Options = {env: typeof env; fetch: (input: string, init?: RequestInit) => Promise<Response>};
const down: Options = {
  env,
  fetch: async () => {
    throw new Error('connect ECONNREFUSED');
  },
};

/** A call that is refused (TypeError) before the database is asked. */
async function refusedBeforeAsking(call: (options: Options) => Promise<unknown>) {
  const {fetch, options} = fake({});
  await expect(call(options)).rejects.toBeInstanceOf(TypeError);
  expect(fetch).not.toHaveBeenCalled();
}
/** A call whose answer makes no sense: an AccountsUnavailableError, whose outcome may be unknown. */
async function noSense(call: (options: Options) => Promise<unknown>, answer: unknown) {
  await expect(call(fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  await expect(call(fake(answer).options)).rejects.toMatchObject({outcomeUnknown: true});
}

// A planned operation as the module takes it, and as the database takes it.
const planned = (patch: Record<string, unknown> = {}) => ({
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
const wired = (patch: Record<string, unknown> = {}) => ({
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

describe('the vocabularies (lib/job-view.ts), shared by the screens and the typed calls', () => {
  it('names the five states, the three waiting reasons (awaiting_worker is new), the four stored ones, and the seven endings of a lease', () => {
    expect(jobStates).toEqual(['waiting', 'running', 'completed', 'failed', 'cancelled']);
    expect(finishedJobStates).toEqual(['completed', 'failed', 'cancelled']);
    expect(waitingReasons).toEqual(['awaiting_dispatch', 'awaiting_reconciliation', 'awaiting_worker']);
    expect(storedReasons).toEqual(['step_failed', 'lease_lost', 'user_cancelled', 'account_disabled']);
    expect(shownReasons).toEqual([...waitingReasons, ...storedReasons]);
    expect(endingDetails).toEqual(['user_cancelled', 'account_disabled', 'lease_expired', 'stale_revision', 'revoked_epoch', 'tombstoned', 'step_failed']);
    expect(testWorkloadKind).toBe('test_workload');
  });

  it('says a Job is open exactly while its highest attempt is waiting or running', () => {
    expect(jobStates.filter(isOpenState)).toEqual(['waiting', 'running']);
  });

  it('names the plan outcomes, the limits of a plan and the refusals a submission can carry', () => {
    expect(planOutcomes).toEqual(['complete', 'fail']);
    expect([maxPlannedOperations, maxPlanBytes, maxOperationOrdinal]).toEqual([3, 4096, 100]);
    expect(submissionRefusals).toEqual(
      expect.arrayContaining(['unavailable_bound', 'provider_blocked', 'over_operation_cap', 'over_job_cap', 'insufficient_allowance', 'permission_required', 'maximum_exceeded']),
    );
    expect(fenceRefusals).toEqual(['fence_mismatch', 'cancelled', 'expired', 'revoked', 'not_running', 'unavailable']);
    expect([defaultListedJobs, maxListedJobs, defaultOutboxClaim, maxOutboxClaim]).toEqual([50, 200, 20, 100]);
  });
});

describe('planToWire', () => {
  it('sends nothing for no plan, and an outcome alone', () => {
    expect(planToWire(undefined)).toEqual({});
    expect(planToWire({})).toEqual({});
    expect(planToWire({outcome: 'fail'})).toEqual({outcome: 'fail'});
    expect(planToWire({outcome: 'complete', operations: []})).toEqual({outcome: 'complete', operations: []});
  });

  it('writes each operation in the form the database takes (snake_case), in the order given, and the options only when given', () => {
    const wire = planToWire({
      outcome: 'complete',
      operations: [planned(), planned({stepKey: 'synthesize', ordinal: 2, options: {}, requestBytes: 0, imageCount: 2, outputLimit: 0})],
    });
    expect(wire).toEqual({
      outcome: 'complete',
      operations: [wired(), wired({step_key: 'synthesize', ordinal: 2, request_bytes: 0, image_count: 2, output_limit: 0, options: {}})],
    });
  });

  it('accepts three operations, and the same step key with different ordinals', () => {
    const operations = [planned({ordinal: 1}), planned({ordinal: 2}), planned({stepKey: 'other', ordinal: 1})];
    expect((planToWire({operations}).operations as unknown[]).length).toBe(3);
  });

  it.each([
    ['a plan that is not an object', 'nope'],
    ['a plan that is an array', []],
    ['a member it does not know', {outcome: 'complete', extra: 1}],
    ['an outcome it does not know', {outcome: 'maybe'}],
    ['operations that are not a list', {operations: {}}],
    ['four operations', {operations: [planned({ordinal: 1}), planned({ordinal: 2}), planned({ordinal: 3}), planned({ordinal: 4})]}],
    ['an operation that is not an object', {operations: ['x']}],
    ['an operation with a member it does not know', {operations: [{...planned(), colour: 'red'}]}],
    ['two operations with one step key and ordinal', {operations: [planned(), planned()]}],
    ['a step key with a capital', {operations: [planned({stepKey: 'Search'})]}],
    ['an empty step key', {operations: [planned({stepKey: ''})]}],
    ['a step key of 41 characters', {operations: [planned({stepKey: 'x'.repeat(41)})]}],
    ['ordinal 0', {operations: [planned({ordinal: 0})]}],
    ['ordinal 101', {operations: [planned({ordinal: 101})]}],
    ['a fractional ordinal', {operations: [planned({ordinal: 1.5})]}],
    ['a schedule that is not an ID', {operations: [planned({scheduleId: 'nope'})]}],
    ['a provider with a capital', {operations: [planned({provider: 'Anthropic'})]}],
    ['a model that is empty', {operations: [planned({model: ''})]}],
    ['an API version with a space', {operations: [planned({apiVersion: 'v 1'})]}],
    ['an API version of 101 characters', {operations: [planned({apiVersion: 'v'.repeat(101)})]}],
    ['a negative size', {operations: [planned({requestBytes: -1})]}],
    ['a fractional size', {operations: [planned({imageCount: 0.5})]}],
    ['an image count above 999,999,999', {operations: [planned({imageCount: 1_000_000_000})]}],
    ['an output limit above 999,999,999', {operations: [planned({outputLimit: 1_000_000_000})]}],
    ['options that are not an object', {operations: [planned({options: [1]})]}],
  ])('refuses %s with a TypeError', (_label, plan) => {
    expect(() => planToWire(plan as WorkloadPlan)).toThrow(TypeError);
  });

  it('refuses a plan of more than 4 KB, as the outbox does', () => {
    const big = (index: number) => planned({ordinal: index, options: {note: 'x'.repeat(1500)}});
    expect(() => planToWire({operations: [big(1), big(2), big(3)]})).toThrow(TypeError);
    expect(() => planToWire({operations: [big(1), big(2)]})).not.toThrow();
  });
});

describe('the size of a plan is what the database counts: the length of its jsonb text', () => {
  const compact = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  /** The wire form of a plan with one operation, built by hand: planToWire itself refuses what is over the limit, and these tests need the plans on both sides of it. */
  const planToWireUnchecked = (plan: WorkloadPlan) => ({
    operations: (plan.operations ?? []).map((operation) => ({
      step_key: operation.stepKey,
      ordinal: operation.ordinal,
      schedule_id: operation.scheduleId,
      provider: operation.provider,
      model: operation.model,
      api_version: operation.apiVersion,
      request_bytes: operation.requestBytes,
      image_count: operation.imageCount,
      output_limit: operation.outputLimit,
      ...(operation.options === undefined ? {} : {options: operation.options}),
    })),
  });

  it('writes jsonb text: ", " between members and items, ": " after a key, strings escaped as JSON escapes them, numbers as numerics', () => {
    expect(jsonbText({})).toBe('{}');
    expect(jsonbText([])).toBe('[]');
    expect(jsonbText({a: 1, b: [1, 2, {c: null}], d: 'x', e: true, f: false})).toBe('{"a": 1, "b": [1, 2, {"c": null}], "d": "x", "e": true, "f": false}');
    expect(jsonbText('a "q" \\ \n \t \u0001 é')).toBe(JSON.stringify('a "q" \\ \n \t \u0001 é'));
    // Inside a string a comma and a colon are just characters.
    expect(jsonbText({'a, b: c': 'x, y: z'})).toBe('{"a, b: c": "x, y: z"}');
    // A numeric is never written with an exponent.
    expect(jsonbText([0, -3, 12, 1.5, 1e21, 1.5e-7, 1.234e25, -2.5e-9, 123456789012])).toBe('[0, -3, 12, 1.5, 1000000000000000000000, 0.00000015, 12340000000000000000000000, -0.0000000025, 123456789012]');
    expect(() => jsonbText(() => 1)).toThrow(TypeError);
  });

  it('counts the bytes of the jsonb text of what the database RECEIVES: undefined members are gone, a Date is its text, a multi-byte character is its bytes', () => {
    expect(planBytes({a: undefined, b: 1})).toBe(new TextEncoder().encode('{"b": 1}').length);
    expect(planBytes({when: new Date(0)})).toBe(new TextEncoder().encode('{"when": "1970-01-01T00:00:00.000Z"}').length);
    expect(planBytes({word: 'שלום'})).toBe(new TextEncoder().encode('{"word": "שלום"}').length);
    expect(planBytes({})).toBe(2);
  });

  it('refuses a plan the database would refuse although its compact JSON is within 4096 bytes, with the same TypeError as an oversize plan', () => {
    // One byte more for every comma between items: a list of numbers is the cheapest way to make the two measures differ.
    const withList = (count: number): WorkloadPlan => ({operations: [planned({options: {list: Array.from({length: count}, () => 0)}})]});
    let count = 1;
    while (planBytes(planToWireUnchecked(withList(count))) <= maxPlanBytes) count += 1;
    // `count` items is the first plan the database refuses; its compact JSON is smaller, and within the limit.
    const refusedWire = planToWireUnchecked(withList(count));
    expect(compact(refusedWire)).toBeLessThanOrEqual(maxPlanBytes);
    expect(planBytes(refusedWire)).toBeGreaterThan(maxPlanBytes);
    expect(() => planToWire(withList(count))).toThrow(TypeError);
    expect(() => planToWire(withList(count))).toThrow(/at most 4096 bytes/);
    // One item fewer is within the limit by the database's count, and passes.
    expect(planBytes(planToWireUnchecked(withList(count - 1)))).toBeLessThanOrEqual(maxPlanBytes);
    expect(() => planToWire(withList(count - 1))).not.toThrow();
  });

  it('measures a plan of exactly 4096 bytes by its jsonb text as within the limit, and of 4097 as over it', () => {
    const padded = (pad: number): WorkloadPlan => ({operations: [planned({options: {pad: 'x'.repeat(pad)}})]});
    let pad = 0;
    while (planBytes(planToWireUnchecked(padded(pad + 1))) <= maxPlanBytes) pad += 1;
    // `pad` is the longest padding within the limit, and one more byte of padding is one byte over.
    expect(planBytes(planToWireUnchecked(padded(pad)))).toBe(maxPlanBytes);
    expect(() => planToWire(padded(pad))).not.toThrow();
    expect(planBytes(planToWireUnchecked(padded(pad + 1)))).toBe(maxPlanBytes + 1);
    expect(() => planToWire(padded(pad + 1))).toThrow(TypeError);
  });
});

describe('planFromWire', () => {
  it('reads back what planToWire wrote', () => {
    const plan: WorkloadPlan = {outcome: 'fail', operations: [planned(), planned({stepKey: 'second', ordinal: 2, options: {}})]};
    expect(planFromWire(planToWire(plan))).toEqual(plan);
    expect(planFromWire({})).toEqual({});
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a member it does not know', {colour: 'red'}],
    ['an outcome it does not know', {outcome: 'maybe'}],
    ['operations that are not a list', {operations: 7}],
    ['four operations', {operations: [wired({ordinal: 1}), wired({ordinal: 2}), wired({ordinal: 3}), wired({ordinal: 4})]}],
    ['an operation with a member it does not know', {operations: [{...wired(), extra: 1}]}],
    ['a step key that is not a word', {operations: [wired({step_key: 'Bad Key'})]}],
    ['an ordinal above 100', {operations: [wired({ordinal: 101})]}],
    ['an ordinal of 0', {operations: [wired({ordinal: 0})]}],
    ['a schedule that is not an ID', {operations: [wired({schedule_id: 'x'})]}],
    ['a size that is negative', {operations: [wired({request_bytes: -1})]}],
    ['options that are not an object', {operations: [wired({options: 3})]}],
  ])('throws an unexpected-shape error for %s', (_label, value) => {
    expect(() => planFromWire(value)).toThrow(AccountsUnavailableError);
  });
});

// Submit ----------------------------------------------------------------------------------------------------------------------------------------

const submissionFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'accepted',
  job_id: JOB,
  attempt_id: ATTEMPT,
  outbox_id: OUTBOX,
  attempt_number: 1,
  state: 'waiting',
  stage: 'accepted',
  reason: 'awaiting_dispatch',
  open_jobs: null,
  open_limit: null,
  refusal: null,
  refusal_reason: null,
  refusal_detail: null,
  requested_microdollars: null,
  limit_microdollars: null,
  used_microdollars: null,
  available_microdollars: null,
  ...patch,
});

describe('submitJob', () => {
  const input = {commandId: COMMAND, projectId: PROJECT, inputDigest: DIGEST};

  it('sends the Account and epoch of the operation, the kind test_workload, the digest and the plan, as the service role, and reads the Job, its attempt and its outbox row', async () => {
    const {sent, options} = fake(submissionFields());
    expect(await submitJob(operation, {...input, plan: {outcome: 'fail', operations: [planned()]}, workerVersion: 2}, options)).toEqual({
      outcome: 'accepted',
      jobId: JOB,
      attemptId: ATTEMPT,
      outboxId: OUTBOX,
      attempt: {id: ATTEMPT, number: 1, state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch'},
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('submit_job');
    expect(sent[0].body).toEqual({
      p_account_id: ACCOUNT,
      p_epoch: 3,
      p_command_id: COMMAND,
      p_project_id: PROJECT,
      p_kind: 'test_workload',
      p_input_digest: DIGEST,
      p_plan: {outcome: 'fail', operations: [wired()]},
      p_worker_version: 2,
    });
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('sends an empty plan and no worker version (the built-in step) when it is given neither', async () => {
    const {sent, options} = fake(submissionFields());
    await submitJob(operation, input, options);
    expect(sent[0].body).toMatchObject({p_plan: {}, p_worker_version: null});
    const second = fake(submissionFields());
    await submitJob(operation, {...input, kind: 'test_workload', workerVersion: null}, second.options);
    expect(second.sent[0].body).toMatchObject({p_kind: 'test_workload', p_worker_version: null});
  });

  it('reads a waiting attempt that waits for a worker, or for reconciliation, as accepted', async () => {
    for (const reason of ['awaiting_worker', 'awaiting_reconciliation']) {
      const answer = await submitJob(operation, input, fake(submissionFields({reason})).options);
      expect(answer).toMatchObject({outcome: 'accepted', attempt: {reason}});
    }
  });

  it('reads a replay as the same Job and outbox row with attempt 1 as it is now', async () => {
    const answer = await submitJob(operation, input, fake(submissionFields({outcome: 'replayed', state: 'running', stage: 'started', reason: null})).options);
    expect(answer).toEqual({
      outcome: 'replayed',
      jobId: JOB,
      attemptId: ATTEMPT,
      outboxId: OUTBOX,
      attempt: {id: ATTEMPT, number: 1, state: 'running', stage: 'started', reason: null},
    });
  });

  it.each(['reused', 'denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await submitJob(operation, input, fake(submissionFields({outcome, job_id: null, attempt_id: null, outbox_id: null, attempt_number: null, state: null, stage: null, reason: null})).options)).toEqual({outcome});
  });

  it('reads at_capacity with the open count and the limit of 3', async () => {
    expect(await submitJob(operation, input, fake(submissionFields({outcome: 'at_capacity', open_jobs: 3, open_limit: 3, job_id: null, attempt_id: null, outbox_id: null})).options)).toEqual({
      outcome: 'at_capacity',
      open: 3,
      limit: 3,
    });
  });

  it.each([
    ['unavailable_bound', 'unknown_rate', null, {requested_microdollars: null, limit_microdollars: 25_000_000, used_microdollars: 1_000_000, available_microdollars: 24_000_000}, {requested: null, limit: 25_000_000, used: 1_000_000, available: 24_000_000}],
    ['unavailable_bound', 'unsupported_option', 'cache', {requested_microdollars: null, limit_microdollars: 10, used_microdollars: 0, available_microdollars: 10}, {requested: null, limit: 10, used: 0, available: 10}],
    ['provider_blocked', null, null, {requested_microdollars: 3400, limit_microdollars: 25_000_000, used_microdollars: 0, available_microdollars: 25_000_000}, {requested: 3400, limit: 25_000_000, used: 0, available: 25_000_000}],
    ['over_operation_cap', null, null, {requested_microdollars: 1_000_001, limit_microdollars: 1_000_000, used_microdollars: 0, available_microdollars: 1_000_000}, {requested: 1_000_001, limit: 1_000_000, used: 0, available: 1_000_000}],
    ['over_job_cap', null, null, {requested_microdollars: 900_000, limit_microdollars: 5_000_000, used_microdollars: 4_500_000, available_microdollars: 500_000}, {requested: 900_000, limit: 5_000_000, used: 4_500_000, available: 500_000}],
    ['insufficient_allowance', null, null, {requested_microdollars: 3400, limit_microdollars: 25_000_000, used_microdollars: 24_999_000, available_microdollars: 1000}, {requested: 3400, limit: 25_000_000, used: 24_999_000, available: 1000}],
  ])('reads refused for %s (reason %s, detail %s) with the exact cost block, and nothing was written', async (refusal, reason, detail, block, cost) => {
    const answer = await submitJob(
      operation,
      input,
      fake(submissionFields({outcome: 'refused', job_id: null, attempt_id: null, outbox_id: null, attempt_number: null, state: null, stage: null, reason: null, refusal, refusal_reason: reason, refusal_detail: detail, ...block})).options,
    );
    expect(answer).toEqual({outcome: 'refused', refusal, reason, detail, cost});
  });

  it.each(['permission_required', 'maximum_exceeded', 'not_reservable', 'already_reserved', 'reused', 'unavailable', 'denied'])(
    'reads refused for %s with no cost block: a refusal that is not about money carries none',
    async (refusal) => {
      const answer = await submitJob(operation, input, fake(submissionFields({outcome: 'refused', job_id: null, attempt_id: null, outbox_id: null, attempt_number: null, state: null, stage: null, reason: null, refusal})).options);
      expect(answer).toEqual({outcome: 'refused', refusal, reason: null, detail: null, cost: null});
    },
  );

  it.each([
    ['a kind other than test_workload', {kind: 'research' as never}],
    ['a short digest', {inputDigest: 'abc'}],
    ['an upper-case digest', {inputDigest: DIGEST.toUpperCase()}],
    ['a command that is not an ID', {commandId: 'nope'}],
    ['a Project that is not an ID', {projectId: 'nope'}],
    ['a worker version of 0', {workerVersion: 0}],
    ['a fractional worker version', {workerVersion: 1.5}],
    ['a worker version above 2^31 - 1', {workerVersion: 2_147_483_648}],
    ['a plan that is not an object', {plan: 'nope' as never}],
    ['a plan with four operations', {plan: {operations: [planned({ordinal: 1}), planned({ordinal: 2}), planned({ordinal: 3}), planned({ordinal: 4})]}}],
  ])('refuses %s before asking', async (_label, patch) => {
    await refusedBeforeAsking((options) => submitJob(operation, {...input, ...patch}, options));
  });

  it('refuses an operation that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(submitJob({accountId: 'not-an-id', epoch: 1}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(submitJob({accountId: ACCOUNT, epoch: 0}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(submitJob({accountId: ACCOUNT, epoch: 1.5}, input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not an object', []],
    ['an outcome it does not know', submissionFields({outcome: 'maybe'})],
    ['an accepted Job with no ID', submissionFields({job_id: null})],
    ['an accepted Job with no outbox row', submissionFields({outbox_id: null})],
    ['an accepted attempt that is not number 1', submissionFields({attempt_number: 2})],
    ['an accepted attempt that is not waiting', submissionFields({state: 'running', stage: 'started', reason: null})],
    ['an accepted attempt at another stage', submissionFields({stage: 'retry'})],
    ['an accepted attempt with a stored reason', submissionFields({reason: 'step_failed'})],
    ['a waiting attempt with no reason', submissionFields({reason: null})],
    ['at_capacity below the limit', submissionFields({outcome: 'at_capacity', open_jobs: 2, open_limit: 3})],
    ['at_capacity with no limit', submissionFields({outcome: 'at_capacity', open_jobs: 3, open_limit: null})],
    ['a refusal it does not know', submissionFields({outcome: 'refused', refusal: 'because'})],
    ['a refusal about money with no cost block', submissionFields({outcome: 'refused', refusal: 'insufficient_allowance'})],
    ['a refusal about permission with a cost block', submissionFields({outcome: 'refused', refusal: 'permission_required', limit_microdollars: 1, used_microdollars: 0, available_microdollars: 1})],
    ['a cost block missing a figure', submissionFields({outcome: 'refused', refusal: 'insufficient_allowance', requested_microdollars: 5, limit_microdollars: 10, used_microdollars: 0})],
    ['a cost block with a fraction', submissionFields({outcome: 'refused', refusal: 'over_job_cap', requested_microdollars: 5, limit_microdollars: 10.5, used_microdollars: 0, available_microdollars: 10})],
    ['a requested amount with no limit', submissionFields({outcome: 'refused', refusal: 'permission_required', requested_microdollars: 5})],
    ['a refusal reason that is not a word', submissionFields({outcome: 'refused', refusal: 'unavailable_bound', refusal_reason: 'Not A Word', limit_microdollars: 10, used_microdollars: 0, available_microdollars: 10})],
  ])('throws an unexpected-shape error for %s, and invents nothing', async (_label, answer) => {
    await noSense((options) => submitJob(operation, input, options), answer);
  });

  it('throws when the database is unreachable, and says the outcome may be unknown for a server error', async () => {
    await expect(submitJob(operation, input, down)).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    await expect(submitJob(operation, input, fake({code: 'XX000'}, 500).options)).rejects.toMatchObject({status: 500, outcomeUnknown: true});
    await expect(submitJob(operation, input, fake({code: '22023'}, 400).options)).rejects.toMatchObject({status: 400, outcomeUnknown: false});
  });
});

// Cancel ----------------------------------------------------------------------------------------------------------------------------------------

const cancellationFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'cancelled',
  job_id: JOB,
  attempt_id: ATTEMPT,
  attempt_number: 1,
  state: 'cancelled',
  stage: 'search',
  reason: 'user_cancelled',
  released: 1,
  ...patch,
});

describe('cancelJob', () => {
  const input = {commandId: COMMAND, jobId: JOB};

  it('sends the Account and epoch, the command and the Job, and reads the cancelled attempt and how many reservations were released', async () => {
    const {sent, options} = fake(cancellationFields());
    expect(await cancelJob(operation, input, options)).toEqual({
      outcome: 'cancelled',
      jobId: JOB,
      attempt: {id: ATTEMPT, number: 1, state: 'cancelled', stage: 'search', reason: 'user_cancelled'},
      released: 1,
    });
    expect(sent[0]).toMatchObject({name: 'cancel_job', body: {p_account_id: ACCOUNT, p_epoch: 3, p_command_id: COMMAND, p_job_id: JOB}});
  });

  it('reads a replay with the attempt as it is now, in any state', async () => {
    for (const patch of [{state: 'cancelled', reason: 'user_cancelled'}, {state: 'failed', reason: 'step_failed'}, {state: 'running', reason: null}, {state: 'waiting', reason: 'awaiting_dispatch'}]) {
      const answer = await cancelJob(operation, input, fake(cancellationFields({outcome: 'replayed', released: null, ...patch})).options);
      expect(answer).toEqual({outcome: 'replayed', jobId: JOB, attempt: expect.objectContaining({id: ATTEMPT, state: patch.state})});
    }
  });

  it.each(['completed', 'failed', 'cancelled'])('reads not_cancellable carrying the state %s', async (state) => {
    expect(await cancelJob(operation, input, fake({outcome: 'not_cancellable', job_id: JOB, attempt_id: ATTEMPT, attempt_number: 2, state, stage: 'search', reason: null}).options)).toEqual({outcome: 'not_cancellable', state});
  });

  it.each(['reused', 'denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await cancelJob(operation, input, fake({outcome, job_id: null}).options)).toEqual({outcome});
  });

  it('refuses a Job or a command that is not an ID before asking', async () => {
    await refusedBeforeAsking((options) => cancelJob(operation, {commandId: COMMAND, jobId: 'nope'}, options));
    await refusedBeforeAsking((options) => cancelJob(operation, {commandId: 'nope', jobId: JOB}, options));
    await refusedBeforeAsking((options) => cancelJob({accountId: ACCOUNT, epoch: 0}, input, options));
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['an outcome it does not know', cancellationFields({outcome: 'maybe'})],
    ['a cancelled attempt that is not cancelled', cancellationFields({state: 'running', reason: null})],
    ['a cancelled attempt cancelled for another reason', cancellationFields({reason: 'account_disabled'})],
    ['a cancelled attempt with no count of released reservations', cancellationFields({released: null})],
    ['a negative count', cancellationFields({released: -1})],
    ['another Job than the one asked about', cancellationFields({job_id: PROJECT})],
    ['not_cancellable for an open attempt', {outcome: 'not_cancellable', state: 'running'}],
    ['not_cancellable for a waiting attempt', {outcome: 'not_cancellable', state: 'waiting'}],
    ['a state it does not know', cancellationFields({state: 'paused'})],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await noSense((options) => cancelJob(operation, input, options), answer);
  });
});

// List and read ---------------------------------------------------------------------------------------------------------------------------------

const listItem = (patch: Record<string, unknown> = {}) => ({
  job_id: JOB,
  project_id: PROJECT,
  project_title: 'Courtyard bench',
  kind: 'test_workload',
  created_at: at,
  attempt_number: 1,
  state: 'running',
  stage: 'search',
  reason: null,
  started_at: at,
  ended_at: null,
  ...patch,
});

describe('listJobs', () => {
  it('asks for 50 by default, sends the Account and epoch, and reads each Job with its Project\'s title', async () => {
    const {sent, options} = fake({outcome: 'found', items: [listItem()]});
    expect(await listJobs(operation, {}, options)).toEqual({
      outcome: 'found',
      jobs: [
        {
          jobId: JOB,
          projectId: PROJECT,
          projectTitle: 'Courtyard bench',
          kind: 'test_workload',
          createdAt: at,
          attemptNumber: 1,
          state: 'running',
          stage: 'search',
          reason: null,
          startedAt: at,
          endedAt: null,
        },
      ],
    });
    expect(sent[0]).toMatchObject({name: 'list_jobs', body: {p_account_id: ACCOUNT, p_epoch: 3, p_limit: 50}});
    const second = fake({outcome: 'found', items: []});
    expect(await listJobs(operation, {limit: 200}, second.options)).toEqual({outcome: 'found', jobs: []});
    expect(second.sent[0].body.p_limit).toBe(200);
  });

  it('reads open Jobs first and then the ended ones, every state with the reason the state allows', async () => {
    const items = [
      listItem({state: 'running'}),
      listItem({state: 'waiting', stage: 'accepted', reason: 'awaiting_worker', started_at: null}),
      listItem({state: 'completed', reason: null, ended_at: later}),
      listItem({state: 'failed', reason: 'lease_lost', ended_at: later}),
      listItem({state: 'cancelled', reason: 'account_disabled', ended_at: later, started_at: null}),
    ];
    const answer = await listJobs(operation, {}, fake({outcome: 'found', items}).options);
    expect(answer.outcome === 'found' && answer.jobs.map((job) => [job.state, job.reason])).toEqual([
      ['running', null],
      ['waiting', 'awaiting_worker'],
      ['completed', null],
      ['failed', 'lease_lost'],
      ['cancelled', 'account_disabled'],
    ]);
  });

  it('answers denied with nothing else', async () => {
    expect(await listJobs(operation, {}, fake({outcome: 'denied', items: null}).options)).toEqual({outcome: 'denied'});
  });

  it.each([0, 201, 1.5, -1, Number.NaN])('refuses a limit of %s before asking', async (limit) => {
    await refusedBeforeAsking((options) => listJobs(operation, {limit}, options));
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['an outcome it does not know', {outcome: 'maybe', items: []}],
    ['items that are not a list', {outcome: 'found', items: {}}],
    ['more items than the limit', {outcome: 'found', items: [listItem(), listItem()]}],
    ['an open Job after an ended one', {outcome: 'found', items: [listItem({state: 'completed', ended_at: later}), listItem()]}],
    ['an open Job that has ended', {outcome: 'found', items: [listItem({ended_at: later})]}],
    ['an ended Job with no end', {outcome: 'found', items: [listItem({state: 'completed'})]}],
    ['a waiting Job that has started', {outcome: 'found', items: [listItem({state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch'})]}],
    ['a running Job that has not started', {outcome: 'found', items: [listItem({started_at: null})]}],
    ['a running Job with a reason', {outcome: 'found', items: [listItem({reason: 'step_failed'})]}],
    ['a failed Job with a waiting reason', {outcome: 'found', items: [listItem({state: 'failed', reason: 'awaiting_dispatch', ended_at: later})]}],
    ['a kind that is not a word', {outcome: 'found', items: [listItem({kind: 'Not A Kind'})]}],
    ['no Project title', {outcome: 'found', items: [listItem({project_title: null})]}],
    ['an attempt number of 0', {outcome: 'found', items: [listItem({attempt_number: 0})]}],
    ['a time that is not one', {outcome: 'found', items: [listItem({created_at: 'yesterday'})]}],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    // (The limit of 1 makes "more items than the limit" an item too many.)
    await noSense((options) => listJobs(operation, {limit: _label === 'more items than the limit' ? 1 : undefined}, options), answer);
  });
});

const attemptView = (patch: Record<string, unknown> = {}) => ({
  id: ATTEMPT,
  number: 1,
  state: 'waiting',
  stage: 'accepted',
  reason: 'awaiting_dispatch',
  created_at: at,
  started_at: null,
  ended_at: null,
  chargeable_operations: 0,
  ...patch,
});
const detailFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'found',
  job_id: JOB,
  project_id: PROJECT,
  project_title: 'Courtyard bench',
  kind: 'test_workload',
  created_at: at,
  state: 'waiting',
  stage: 'accepted',
  reason: 'awaiting_dispatch',
  can_cancel: true,
  can_retry: false,
  attempts: [attemptView()],
  progress: {steps: 1, steps_begun: 0, operations_planned: 1, operations_completed: 0},
  cost: {held: 3400, settled: 0, released: 0, chargeable_operations: 0},
  ending: null,
  ...patch,
});
/** A Job whose highest attempt (number 1) ended as given, with the lease detail that explains it. */
const ended = (state: string, reason: string | null, ending: string | null, startedAt: string | null = at) =>
  detailFields({
    state,
    stage: 'search',
    reason,
    can_cancel: false,
    can_retry: state === 'failed',
    attempts: [attemptView({state, stage: 'search', reason, started_at: startedAt, ended_at: later})],
    ending,
  });

describe('readJobDetail', () => {
  const input = {jobId: JOB};

  it('sends the Account, the epoch and the Job, and reads the Job, its Project\'s title, its attempts, progress, cost and ending', async () => {
    const {sent, options} = fake(detailFields());
    expect(await readJobDetail(operation, input, options)).toEqual({
      outcome: 'found',
      job: {
        jobId: JOB,
        projectId: PROJECT,
        projectTitle: 'Courtyard bench',
        kind: 'test_workload',
        createdAt: at,
        state: 'waiting',
        stage: 'accepted',
        reason: 'awaiting_dispatch',
        canCancel: true,
        canRetry: false,
        attempts: [{id: ATTEMPT, number: 1, state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch', createdAt: at, startedAt: null, endedAt: null, chargeableOperations: 0}],
        progress: {steps: 1, stepsBegun: 0, operationsPlanned: 1, operationsCompleted: 0},
        cost: {held: 3400, settled: 0, released: 0, chargeableOperations: 0},
        ending: null,
      },
    });
    expect(sent[0]).toMatchObject({name: 'read_job_detail', body: {p_account_id: ACCOUNT, p_epoch: 3, p_job_id: JOB}});
    // Nothing else is in the Job: no input digest, no request ID, no fence.
    const job = (await readJobDetail(operation, input, fake(detailFields()).options)) as {job: Record<string, unknown>};
    expect(Object.keys(job.job).sort()).toEqual(
      ['attempts', 'canCancel', 'canRetry', 'cost', 'createdAt', 'ending', 'jobId', 'kind', 'progress', 'projectId', 'projectTitle', 'reason', 'stage', 'state'].sort(),
    );
  });

  it.each([
    ['waiting, accepted and waiting for a worker', detailFields({reason: 'awaiting_worker', attempts: [attemptView({reason: 'awaiting_worker'})]})],
    ['waiting for reconciliation', detailFields({reason: 'awaiting_reconciliation', attempts: [attemptView({reason: 'awaiting_reconciliation'})]})],
    ['running', detailFields({state: 'running', stage: 'search', reason: null, attempts: [attemptView({state: 'running', stage: 'search', reason: null, started_at: at})]})],
    ['completed with no ending', ended('completed', null, null)],
    ['failed, the workload said so', ended('failed', 'step_failed', 'step_failed')],
    ['failed, the result was stale', ended('failed', 'step_failed', 'stale_revision')],
    ['failed, the lease ran out', ended('failed', 'lease_lost', 'lease_expired')],
    ['failed with no lease at all', ended('failed', 'step_failed', null)],
    ['cancelled by the user', ended('cancelled', 'user_cancelled', 'user_cancelled')],
    ['cancelled before it started (no lease)', ended('cancelled', 'user_cancelled', null, null)],
    ['cancelled, the Account was disabled', ended('cancelled', 'account_disabled', 'account_disabled')],
    ['cancelled, the epoch moved', ended('cancelled', 'account_disabled', 'revoked_epoch')],
    ['cancelled, the Account was tombstoned', ended('cancelled', 'account_disabled', 'tombstoned')],
  ])('reads a Job that is %s', async (_label, answer) => {
    const read = await readJobDetail(operation, input, fake(answer).options);
    expect(read.outcome).toBe('found');
    if (read.outcome !== 'found') return;
    expect(read.job.state).toBe(answer.state);
    expect(read.job.reason).toBe(answer.reason);
    expect(read.job.ending).toBe(answer.ending);
    expect(read.job.canCancel).toBe(isOpenState(read.job.state));
    expect(read.job.canRetry).toBe(read.job.state === 'failed');
  });

  it('reads two attempts, and the Job\'s state is its highest attempt\'s; what may still be charged is the sum of the attempts\'', async () => {
    const answer = detailFields({
      attempts: [
        attemptView({state: 'failed', stage: 'search', reason: 'step_failed', started_at: at, ended_at: later, chargeable_operations: 2}),
        attemptView({id: STEP, number: 2, stage: 'retry', reason: 'awaiting_reconciliation', chargeable_operations: 1}),
      ],
      stage: 'retry',
      reason: 'awaiting_reconciliation',
      cost: {held: 6800, settled: 0, released: 0, chargeable_operations: 3},
    });
    const read = await readJobDetail(operation, input, fake(answer).options);
    expect(read.outcome === 'found' && read.job.attempts.map((attempt) => [attempt.number, attempt.state, attempt.chargeableOperations])).toEqual([
      [1, 'failed', 2],
      [2, 'waiting', 1],
    ]);
    expect(read.outcome === 'found' && read.job.cost.chargeableOperations).toBe(3);
  });

  it.each(['denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await readJobDetail(operation, input, fake({outcome, job_id: null}).options)).toEqual({outcome});
  });

  it('refuses a Job that is not an ID before asking', async () => {
    await refusedBeforeAsking((options) => readJobDetail(operation, {jobId: 'nope'}, options));
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['an outcome it does not know', detailFields({outcome: 'maybe'})],
    ['no attempts', detailFields({attempts: []})],
    ['attempts that are not a list', detailFields({attempts: {}})],
    ['a Job whose state is not its highest attempt\'s', detailFields({state: 'running', reason: null})],
    ['a Job whose stage is not its highest attempt\'s', detailFields({stage: 'search'})],
    ['a Job whose reason is not its highest attempt\'s', detailFields({reason: 'awaiting_worker'})],
    ['attempts not numbered from 1', detailFields({attempts: [attemptView({number: 2})]})],
    ['an open attempt below the highest', detailFields({attempts: [attemptView(), attemptView({number: 2, stage: 'retry'})], stage: 'retry'})],
    ['can_cancel for a finished Job', {...ended('completed', null, null), can_cancel: true}],
    ['no can_cancel for an open Job', detailFields({can_cancel: false})],
    ['can_retry for a Job that has not failed', detailFields({can_retry: true})],
    ['no can_retry for a failed Job', {...ended('failed', 'step_failed', 'step_failed'), can_retry: false}],
    ['an ending for an open Job', detailFields({ending: 'user_cancelled'})],
    ['an ending of a failed Job that is a cancellation\'s', ended('failed', 'step_failed', 'user_cancelled')],
    ['an ending for a completed Job', ended('completed', null, 'step_failed')],
    ['an ending it does not know', ended('failed', 'step_failed', 'because')],
    ['a cancelled Job whose ending is a failure\'s', ended('cancelled', 'user_cancelled', 'lease_expired')],
    ['a running attempt that has not started', detailFields({state: 'running', stage: 'search', reason: null, attempts: [attemptView({state: 'running', stage: 'search', reason: null})]})],
    ['a finished attempt with no end', detailFields({state: 'completed', stage: 'search', reason: null, can_cancel: false, attempts: [attemptView({state: 'completed', stage: 'search', reason: null, started_at: at})]})],
    ['a cost whose chargeable count is not the attempts\' sum', detailFields({cost: {held: 1, settled: 0, released: 0, chargeable_operations: 4}})],
    ['a cost with a fraction', detailFields({cost: {held: 1.5, settled: 0, released: 0, chargeable_operations: 0}})],
    ['a negative cost', detailFields({cost: {held: 0, settled: -1, released: 0, chargeable_operations: 0}})],
    ['progress with more steps begun than steps', detailFields({progress: {steps: 1, steps_begun: 2, operations_planned: 0, operations_completed: 0}})],
    ['progress with more operations completed than planned', detailFields({progress: {steps: 1, steps_begun: 1, operations_planned: 1, operations_completed: 2}})],
    ['no progress', detailFields({progress: null})],
    ['no cost', detailFields({cost: null})],
    ['no Project title', detailFields({project_title: null})],
    ['a kind that is not a word', detailFields({kind: 'Not A Kind'})],
  ])('throws an unexpected-shape error for %s, rather than show a state the records do not hold', async (_label, answer) => {
    await noSense((options) => readJobDetail(operation, input, options), answer);
  });
});

// Register a worker -------------------------------------------------------------------------------------------------------------------------------

describe('registerWorker', () => {
  const input = {issuer: 'cad-worker' as const, workerKind: 'cad_generator', version: 2, imageDigest: DIGEST, kinds: ['test_workload']};
  const registration = (patch: Record<string, unknown> = {}) => ({outcome: 'registered', worker_id: WORKER, version: 2, retired: 1, ...patch});

  it('sends the issuer, the worker kind, the version, the image digest and the kinds, and takes no Account', async () => {
    const {sent, options} = fake(registration());
    expect(await registerWorker(input, options)).toEqual({outcome: 'registered', workerId: WORKER, version: 2, retired: 1});
    expect(sent[0]).toMatchObject({
      name: 'register_worker',
      body: {p_issuer: 'cad-worker', p_worker_kind: 'cad_generator', p_version: 2, p_image_digest: DIGEST, p_kinds: ['test_workload']},
    });
    expect(Object.keys(sent[0].body).sort()).toEqual(['p_image_digest', 'p_issuer', 'p_kinds', 'p_version', 'p_worker_kind']);
  });

  it('reads a replay and a supersession, which retire nothing', async () => {
    expect(await registerWorker(input, fake(registration({outcome: 'replayed', retired: 0})).options)).toEqual({outcome: 'replayed', workerId: WORKER, version: 2, retired: 0});
    expect(await registerWorker(input, fake(registration({outcome: 'superseded', version: 5, retired: 0})).options)).toEqual({outcome: 'superseded', workerId: WORKER, version: 5, retired: 0});
  });

  it.each([
    ['an issuer that is not a worker', {issuer: 'gateway' as never}],
    ['a worker kind with a capital', {workerKind: 'Cad'}],
    ['a version of 0', {version: 0}],
    ['a fractional version', {version: 1.5}],
    ['a version above 2^31 - 1', {version: 2_147_483_648}],
    ['a short digest', {imageDigest: 'abc'}],
    ['no kinds', {kinds: []}],
    ['nine kinds', {kinds: Array.from({length: 9}, (_, index) => `kind_${index}`)}],
    ['a repeated kind', {kinds: ['a_kind', 'a_kind']}],
    ['a kind with a capital', {kinds: ['Kind']}],
    ['kinds that are not a list', {kinds: 'test_workload' as never}],
  ])('refuses %s before asking', async (_label, patch) => {
    await refusedBeforeAsking((options) => registerWorker({...input, ...patch}, options));
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['an outcome it does not know', registration({outcome: 'maybe'})],
    ['a registration with no worker', registration({worker_id: null})],
    ['no version', registration({version: null})],
    ['a replay that retired something', registration({outcome: 'replayed', retired: 1})],
    ['a supersession that retired something', registration({outcome: 'superseded', retired: 2})],
    ['a negative count retired', registration({retired: -1})],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await noSense((options) => registerWorker(input, options), answer);
  });
});

// Claim ---------------------------------------------------------------------------------------------------------------------------------------------

const claimFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'claimed',
  attempt_id: ATTEMPT,
  job_id: JOB,
  kind: 'test_workload',
  fence: FENCE,
  expires_at: later,
  plan: {outcome: 'complete', operations: [wired()]},
  input_digest: DIGEST,
  project_revision: 7,
  account_epoch: 3,
  worker_version: 1,
  state: 'running',
  ...patch,
});

describe('claimAttempt', () => {
  it('sends the attempt and no worker (the built-in step), takes no Account or epoch, and reads the fence, the expiry and what the attempt is pinned to', async () => {
    const {sent, options} = fake(claimFields());
    expect(await claimAttempt({attemptId: ATTEMPT}, options)).toEqual({
      outcome: 'claimed',
      claim: {
        attemptId: ATTEMPT,
        jobId: JOB,
        kind: 'test_workload',
        fence: FENCE,
        expiresAt: later,
        plan: {outcome: 'complete', operations: [planned()]},
        inputDigest: DIGEST,
        projectRevision: 7,
        accountEpoch: 3,
        workerVersion: 1,
      },
    });
    expect(sent[0]).toMatchObject({name: 'claim_attempt', body: {p_attempt_id: ATTEMPT, p_worker_id: null, p_issuer: null}});
    expect(Object.keys(sent[0].body).sort()).toEqual(['p_attempt_id', 'p_issuer', 'p_worker_id']);
  });

  it('sends the issuer of the token that signed the claim with the worker, so the database can bind the worker to it', async () => {
    const {sent, options} = fake(claimFields());
    await claimAttempt({attemptId: ATTEMPT, workerId: WORKER, issuer: 'engine-worker'}, options);
    expect(sent[0].body).toEqual({p_attempt_id: ATTEMPT, p_worker_id: WORKER, p_issuer: 'engine-worker'});
    const second = fake(claimFields());
    await claimAttempt({attemptId: ATTEMPT, workerId: WORKER, issuer: 'cad-worker'}, second.options);
    expect(second.sent[0].body.p_issuer).toBe('cad-worker');
  });

  it('refuses an issuer that is not a worker issuer before asking', async () => {
    await refusedBeforeAsking((options) => claimAttempt({attemptId: ATTEMPT, workerId: WORKER, issuer: 'gateway' as never}, options));
  });

  it('sends the registered worker, and reads a replay of its claim with its fence', async () => {
    const {sent, options} = fake(claimFields({outcome: 'replayed'}));
    expect(await claimAttempt({attemptId: ATTEMPT, workerId: WORKER}, options)).toMatchObject({outcome: 'replayed', claim: {fence: FENCE}});
    expect(sent[0].body.p_worker_id).toBe(WORKER);
  });

  it('reads an empty plan', async () => {
    expect(await claimAttempt({attemptId: ATTEMPT}, fake(claimFields({plan: {}})).options)).toMatchObject({claim: {plan: {}}});
  });

  it.each(['already_claimed', 'blocked', 'waiting_for_worker', 'incompatible', 'revoked', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await claimAttempt({attemptId: ATTEMPT}, fake({outcome, attempt_id: ATTEMPT, fence: null, state: 'cancelled'}).options)).toEqual({outcome});
  });

  it.each(['running', 'completed', 'failed', 'cancelled'])('reads not_waiting carrying the state %s', async (state) => {
    expect(await claimAttempt({attemptId: ATTEMPT}, fake({outcome: 'not_waiting', state}).options)).toEqual({outcome: 'not_waiting', state});
  });

  it('refuses an attempt or a worker that is not an ID before asking', async () => {
    await refusedBeforeAsking((options) => claimAttempt({attemptId: 'nope'}, options));
    await refusedBeforeAsking((options) => claimAttempt({attemptId: ATTEMPT, workerId: 'nope'}, options));
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['an outcome it does not know', claimFields({outcome: 'maybe'})],
    ['not_waiting for a waiting attempt', {outcome: 'not_waiting', state: 'waiting'}],
    ['a replay answered to the built-in step', claimFields({outcome: 'replayed'})],
    ['another attempt than the one asked about', claimFields({attempt_id: STEP})],
    ['a claim that is not running', claimFields({state: 'waiting'})],
    ['no fence', claimFields({fence: null})],
    ['a fence that is not an ID', claimFields({fence: 'nope'})],
    ['no expiry', claimFields({expires_at: null})],
    ['a kind that is not a word', claimFields({kind: 'Not A Kind'})],
    ['an input digest that is not a digest', claimFields({input_digest: 'abc'})],
    ['a plan that is not an object', claimFields({plan: 'x'})],
    ['a plan with a member it does not know', claimFields({plan: {colour: 'red'}})],
    ['a revision of 0', claimFields({project_revision: 0})],
    ['no epoch', claimFields({account_epoch: null})],
    ['a worker version of 0', claimFields({worker_version: 0})],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await noSense((options) => claimAttempt({attemptId: ATTEMPT}, options), answer);
  });

  it('reads a replay for a registered worker even when the others would not', async () => {
    await expect(claimAttempt({attemptId: ATTEMPT, workerId: WORKER}, fake(claimFields({outcome: 'replayed', state: 'completed'})).options)).resolves.toMatchObject({outcome: 'replayed'});
  });
});

// The fenced commands -------------------------------------------------------------------------------------------------------------------------------

type FencePatch = {attemptId?: string; fence?: string};
describe.each([
  ['renewLease', (patch: FencePatch, options: Options) => renewLease({attemptId: ATTEMPT, fence: FENCE, ...patch}, options)],
  ['runStep', (patch: FencePatch, options: Options) => runStep({attemptId: ATTEMPT, fence: FENCE, stepKey: 'search', ordinal: 1, ...patch}, options)],
  [
    'finishOperation',
    (patch: FencePatch, options: Options) => finishOperation({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'completed', usage: {inputTokens: 1, outputTokens: 1, returnedModel: 'm'}, ...patch}, options),
  ],
  [
    'finishOperation (ambiguous, Story 2.8)',
    (patch: FencePatch, options: Options) => finishOperation({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'ambiguous', requestId: 'req_1', ...patch}, options),
  ],
  ['finishAttempt', (patch: FencePatch, options: Options) => finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'failed', ...patch}, options)],
])('%s refuses as every fenced command does', (_name, run) => {
  it.each(fenceRefusals)('answers %s with nothing else', async (outcome) => {
    expect(await run({}, fake({outcome, attempt_id: ATTEMPT, expires_at: null}).options)).toEqual({outcome});
  });

  it('sends the attempt and the fence, and no Account and no epoch', async () => {
    const {sent, options} = fake({outcome: 'fence_mismatch'});
    await run({}, options);
    expect(sent[0].body).toMatchObject({p_attempt_id: ATTEMPT, p_fence: FENCE});
    expect(sent[0].body).not.toHaveProperty('p_account_id');
    expect(sent[0].body).not.toHaveProperty('p_epoch');
  });

  it.each([
    ['an attempt that is not an ID', {attemptId: 'nope'}],
    ['a fence that is not an ID', {fence: 'nope'}],
  ])('refuses %s before asking', async (_label, patch) => {
    await refusedBeforeAsking((options) => run(patch, options));
  });

  it('throws when the database is unreachable', async () => {
    await expect(run({}, down)).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
  });
});

describe('renewLease', () => {
  it('reads the new expiry', async () => {
    const {sent, options} = fake({outcome: 'renewed', attempt_id: ATTEMPT, expires_at: later, state: 'running'});
    expect(await renewLease({attemptId: ATTEMPT, fence: FENCE}, options)).toEqual({outcome: 'renewed', expiresAt: later});
    expect(sent[0]).toMatchObject({name: 'renew_lease', body: {p_attempt_id: ATTEMPT, p_fence: FENCE}});
  });

  it.each([
    ['an outcome it does not know', {outcome: 'maybe'}],
    ['a renewal with no expiry', {outcome: 'renewed', expires_at: null}],
    ['a renewal with an expiry that is not a time', {outcome: 'renewed', expires_at: 'soon'}],
    ['a body that is not an object', 'x'],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await noSense((options) => renewLease({attemptId: ATTEMPT, fence: FENCE}, options), answer);
  });
});

describe('runStep', () => {
  const stepFields = (patch: Record<string, unknown> = {}) => ({outcome: 'stepped', step_id: STEP, operation_id: OPERATION, operation_state: 'dispatched', attempt_state: 'running', ...patch});

  it('sends the step key and the ordinal, and reads the step, the operation and its state', async () => {
    const {sent, options} = fake(stepFields());
    expect(await runStep({attemptId: ATTEMPT, fence: FENCE, stepKey: 'search', ordinal: 1}, options)).toEqual({outcome: 'stepped', stepId: STEP, operationId: OPERATION, operationState: 'dispatched'});
    expect(sent[0]).toMatchObject({name: 'run_step', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_step_key: 'search', p_ordinal: 1}});
  });

  it('sends no ordinal as null, and reads a step with no operation', async () => {
    const {sent, options} = fake(stepFields({operation_id: null, operation_state: null}));
    expect(await runStep({attemptId: ATTEMPT, fence: FENCE, stepKey: 'work'}, options)).toEqual({outcome: 'stepped', stepId: STEP, operationId: null, operationState: null});
    expect(sent[0].body.p_ordinal).toBeNull();
    const second = fake(stepFields({outcome: 'replayed', operation_id: null, operation_state: null}));
    expect(await runStep({attemptId: ATTEMPT, fence: FENCE, stepKey: 'work', ordinal: null}, second.options)).toMatchObject({outcome: 'replayed', operationId: null});
    expect(second.sent[0].body.p_ordinal).toBeNull();
  });

  it('reads a replay with the operation in whatever state it has moved on to', async () => {
    for (const state of ['dispatched', 'completed', 'noncharge']) {
      expect(await runStep({attemptId: ATTEMPT, fence: FENCE, stepKey: 'search', ordinal: 1}, fake(stepFields({outcome: 'replayed', operation_state: state})).options)).toMatchObject({outcome: 'replayed', operationState: state});
    }
  });

  it('reads not_planned: an ordinal that names no planned, reserved operation, and nothing was made', async () => {
    expect(await runStep({attemptId: ATTEMPT, fence: FENCE, stepKey: 'search', ordinal: 9}, fake({outcome: 'not_planned', step_id: null, operation_id: null}).options)).toEqual({outcome: 'not_planned'});
  });

  it.each([
    ['a key with a capital', {stepKey: 'Search'}],
    ['an empty key', {stepKey: ''}],
    ['a key of 41 characters', {stepKey: 'x'.repeat(41)}],
    ['ordinal 0', {ordinal: 0}],
    ['ordinal 101', {ordinal: 101}],
    ['a fractional ordinal', {ordinal: 1.5}],
  ])('refuses %s before asking', async (_label, patch) => {
    await refusedBeforeAsking((options) => runStep({attemptId: ATTEMPT, fence: FENCE, stepKey: 'search', ordinal: 1, ...patch}, options));
  });

  it.each([
    ['an outcome it does not know', stepFields({outcome: 'maybe'})],
    ['no step', stepFields({step_id: null})],
    ['an operation when no ordinal was asked for', stepFields({operation_id: OPERATION}), {ordinal: null}],
    ['no operation when an ordinal was asked for', stepFields({operation_id: null, operation_state: null})],
    ['an operation with no state', stepFields({operation_state: null})],
    ['a state with no operation', stepFields({operation_id: null, operation_state: 'dispatched'}), {ordinal: null}],
  ] as [string, unknown, {ordinal: number | null}?][])('throws an unexpected-shape error for %s', async (_label, answer, patch) => {
    await noSense((options) => runStep({attemptId: ATTEMPT, fence: FENCE, stepKey: 'search', ordinal: patch ? patch.ordinal : 1}, options), answer);
  });
});

describe('finishOperation', () => {
  const finishedFields = (patch: Record<string, unknown> = {}) => ({
    outcome: 'finished',
    operation_id: OPERATION,
    state: 'completed',
    settled_microdollars: 2,
    released_microdollars: 3400,
    over_microdollars: 0,
    ...patch,
  });
  const completed = {attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'completed' as const, usage: {inputTokens: 1, outputTokens: 1, returnedModel: 'fixture-model'}};

  it('sends a completion with the usage and no request ID, and reads the settlement', async () => {
    const {sent, options} = fake(finishedFields());
    expect(await finishOperation(completed, options)).toEqual({
      outcome: 'finished',
      operationId: OPERATION,
      state: 'completed',
      settlement: {settledMicrodollars: 2, releasedMicrodollars: 3400, overMicrodollars: 0},
    });
    expect(sent[0]).toMatchObject({
      name: 'finish_operation',
      body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_operation_id: OPERATION, p_outcome: 'completed', p_input_tokens: 1, p_output_tokens: 1, p_returned_model: 'fixture-model', p_request_id: null},
    });
  });

  it('sends a noncharge with the provider\'s request ID and no usage', async () => {
    const {sent, options} = fake(finishedFields({state: 'noncharge', settled_microdollars: 0, released_microdollars: 3400}));
    expect(await finishOperation({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'noncharge', requestId: 'req_1'}, options)).toMatchObject({
      outcome: 'finished',
      state: 'noncharge',
      settlement: {settledMicrodollars: 0, releasedMicrodollars: 3400},
    });
    expect(sent[0].body).toMatchObject({p_outcome: 'noncharge', p_input_tokens: null, p_output_tokens: null, p_returned_model: null, p_request_id: 'req_1'});
  });

  it('reads an operation that holds no reservation as finished with no settlement', async () => {
    expect(await finishOperation(completed, fake(finishedFields({settled_microdollars: null, released_microdollars: null, over_microdollars: null})).options)).toEqual({
      outcome: 'finished',
      operationId: OPERATION,
      state: 'completed',
      settlement: null,
    });
  });

  it('reads an overrun as the amount over', async () => {
    expect(await finishOperation(completed, fake(finishedFields({settled_microdollars: 3500, released_microdollars: 3400, over_microdollars: 100})).options)).toMatchObject({
      settlement: {settledMicrodollars: 3500, releasedMicrodollars: 3400, overMicrodollars: 100},
    });
  });

  it.each(['not_found', 'not_dispatched', 'invalid_transition', 'already_settled', 'invalid_evidence', 'overflow'])('answers %s with nothing else', async (outcome) => {
    expect(await finishOperation(completed, fake({outcome, operation_id: OPERATION, state: 'planned'}).options)).toEqual({outcome});
  });

  describe('every word api.finish_operation can answer is read as a word, never as an answer that makes no sense', () => {
    // The words are the ones the function's own comment lists in the newest migration that re-creates it (Story 2.8): a word the database can answer and this module does not know
    // would make a refused report throw `unexpected()` instead of reaching the caller, which must report the operation `ambiguous`.
    const migration = readFileSync(new URL('../../supabase/migrations/20261101120000_reconcile_ambiguous_charges.sql', import.meta.url), 'utf8');
    const listed = /comment on function api\.finish_operation[^;]*?\. (finished(?: \| [a-z_]+)+)\.';/.exec(migration)?.[1].split(' | ') ?? [];
    const refusals = listed.filter((word) => word !== 'finished');

    it('reads the list from the migration, and it holds the fence refusals, `unavailable`, `revoked`, `invalid_transition`, `invalid_evidence`, `overflow` and `already_settled`', () => {
      expect(listed[0]).toBe('finished');
      for (const word of [...fenceRefusals, 'not_found', 'not_dispatched', 'invalid_transition', 'already_settled', 'invalid_evidence', 'overflow', 'unavailable', 'revoked']) expect(refusals).toContain(word);
    });

    const outcomes = [
      ['completed', completed],
      ['noncharge', {attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'noncharge' as const, requestId: 'req_1'}],
      ['ambiguous', {attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'ambiguous' as const, requestId: null}],
    ] as const;
    for (const [name, input] of outcomes) {
      it(`reads every refusal for a ${name} report with nothing else`, async () => {
        expect(refusals.length).toBeGreaterThan(8);
        for (const outcome of refusals) {
          expect(await finishOperation(input, fake({outcome, operation_id: OPERATION, state: 'dispatched'}).options), outcome).toEqual({outcome});
        }
      });
    }

    it('still refuses a word the database does not have', async () => {
      await noSense((options) => finishOperation(completed, options), {outcome: 'refunded', operation_id: OPERATION, state: 'dispatched'});
    });
  });

  it.each(['already_settled', 'invalid_evidence', 'overflow', 'invalid_transition'])('answers a refused settlement of a noncharge (%s) as a word, never an error', async (outcome) => {
    expect(await finishOperation({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'noncharge', requestId: 'req_1'}, fake({outcome, operation_id: OPERATION, state: 'dispatched'}).options)).toEqual({outcome});
  });

  it.each([
    ['usage with no returned model', {usage: {inputTokens: 1, outputTokens: 1, returnedModel: ''}}],
    ['a returned model with a space', {usage: {inputTokens: 1, outputTokens: 1, returnedModel: 'a b'}}],
    ['negative input tokens', {usage: {inputTokens: -1, outputTokens: 1, returnedModel: 'm'}}],
    ['fractional output tokens', {usage: {inputTokens: 1, outputTokens: 0.5, returnedModel: 'm'}}],
    ['no usage', {usage: undefined as never}],
    ['an operation that is not an ID', {operationId: 'nope'}],
  ])('refuses a completion with %s before asking', async (_label, patch) => {
    await refusedBeforeAsking((options) => finishOperation({...completed, ...patch}, options));
  });

  it.each([
    ['a request ID with a space', 'req 1'],
    ['an empty request ID', ''],
    ['a request ID of 201 characters', 'r'.repeat(201)],
  ])('refuses a noncharge with %s before asking', async (_label, requestId) => {
    await refusedBeforeAsking((options) => finishOperation({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'noncharge', requestId}, options));
  });

  it.each(['settled', 'abandoned', 'planned', 'dispatched', 'deadline', '', undefined])('refuses an outcome that is none of completed, noncharge or ambiguous (%j) before asking', async (outcome) => {
    await refusedBeforeAsking((options) => finishOperation({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome} as never, options));
  });

  describe('an ambiguous outcome (Story 2.8)', () => {
    const ambiguous = {attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'ambiguous' as const};
    const ambiguousFields = (patch: Record<string, unknown> = {}) => ({outcome: 'finished', operation_id: OPERATION, state: 'ambiguous', settled_microdollars: null, released_microdollars: null, over_microdollars: null, ...patch});

    it('sends the fence and the outcome with no usage and no request ID, and reads an operation that settled nothing', async () => {
      const {sent, options} = fake(ambiguousFields());
      expect(await finishOperation(ambiguous, options)).toEqual({outcome: 'finished', operationId: OPERATION, state: 'ambiguous', settlement: null});
      expect(sent).toEqual([expect.objectContaining({name: 'finish_operation'})]);
      expect(sent[0].body).toEqual({
        p_attempt_id: ATTEMPT,
        p_fence: FENCE,
        p_operation_id: OPERATION,
        p_outcome: 'ambiguous',
        p_input_tokens: null,
        p_output_tokens: null,
        p_returned_model: null,
        p_request_id: null,
      });
      expect(sent[0].body).not.toHaveProperty('p_account_id');
      expect(sent[0].body).not.toHaveProperty('p_epoch');
    });

    it('sends the provider\'s request ID when there is one (it is optional)', async () => {
      const {sent, options} = fake(ambiguousFields());
      await finishOperation({...ambiguous, requestId: 'req_503'}, options);
      expect(sent[0].body).toMatchObject({p_outcome: 'ambiguous', p_request_id: 'req_503', p_input_tokens: null, p_output_tokens: null, p_returned_model: null});
    });

    it('sends a null request ID for an undefined or null one', async () => {
      for (const requestId of [undefined, null]) {
        const {sent, options} = fake(ambiguousFields());
        await finishOperation({...ambiguous, requestId}, options);
        expect(sent[0].body.p_request_id).toBeNull();
      }
    });

    it('accepts a request ID of 1 and of 200 characters', async () => {
      for (const requestId of ['r', 'r'.repeat(200)]) {
        const {sent, options} = fake(ambiguousFields());
        await finishOperation({...ambiguous, requestId}, options);
        expect(sent[0].body.p_request_id).toBe(requestId);
      }
    });

    it.each([
      ['a request ID with a space', 'req 1'],
      ['an empty request ID', ''],
      ['a request ID of 201 characters', 'r'.repeat(201)],
      ['a request ID with a newline', 'req\n1'],
      ['a request ID that is not ASCII', 'req\u00e9'],
      ['a request ID that is a number', 7 as never],
    ])('refuses an ambiguous report with %s before asking', async (_label, requestId) => {
      await refusedBeforeAsking((options) => finishOperation({...ambiguous, requestId}, options));
    });

    it('refuses an operation that is not an ID before asking', async () => {
      await refusedBeforeAsking((options) => finishOperation({...ambiguous, operationId: 'nope'}, options));
    });

    it('reads the operation in whatever state a repeat finds it (a report sent again after a reconciliation finds it settled)', async () => {
      for (const state of ['ambiguous', 'settled', 'noncharge', 'completed']) {
        expect(await finishOperation(ambiguous, fake(ambiguousFields({state})).options)).toMatchObject({outcome: 'finished', state});
      }
    });

    it('does not read a settlement it was not told of, but reads one the database did report', async () => {
      expect(await finishOperation(ambiguous, fake(ambiguousFields({state: 'settled', settled_microdollars: 3400, released_microdollars: 3400, over_microdollars: 0})).options)).toMatchObject({
        state: 'settled',
        settlement: {settledMicrodollars: 3400, releasedMicrodollars: 3400, overMicrodollars: 0},
      });
    });

    it.each(['not_found', 'not_dispatched', 'invalid_transition', 'already_settled', 'invalid_evidence', 'overflow', ...fenceRefusals])('answers %s with nothing else', async (outcome) => {
      expect(await finishOperation(ambiguous, fake({outcome, operation_id: OPERATION, state: 'dispatched'}).options)).toEqual({outcome});
    });

    it.each([
      ['a state that is not an operation state', ambiguousFields({state: 'bogus'})],
      ['no state', ambiguousFields({state: null})],
      ['another operation than the one asked about', ambiguousFields({operation_id: STEP})],
      ['a settlement with only some of its amounts', ambiguousFields({settled_microdollars: 5})],
      ['a negative amount', ambiguousFields({settled_microdollars: -1, released_microdollars: 0, over_microdollars: 0})],
      ['an outcome it does not know', ambiguousFields({outcome: 'maybe'})],
      ['a body that is not an object', 'x'],
    ])('throws an unexpected-shape error for %s', async (_label, answer) => {
      await noSense((options) => finishOperation(ambiguous, options), answer);
    });

    it('throws when the database is unreachable', async () => {
      await expect(finishOperation(ambiguous, down)).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    });
  });

  it('still requires the state of a completed or noncharge report to be the one reported (a state of settled is unexpected for them)', async () => {
    await noSense((options) => finishOperation(completed, options), finishedFields({state: 'settled'}));
    await noSense((options) => finishOperation({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'noncharge', requestId: 'req_1'}, options), finishedFields({state: 'ambiguous'}));
  });

  it.each([
    ['an outcome it does not know', finishedFields({outcome: 'maybe'})],
    ['another operation than the one asked about', finishedFields({operation_id: STEP})],
    ['a state that is not the outcome asked for', finishedFields({state: 'noncharge'})],
    ['a settlement with only some of its amounts', finishedFields({released_microdollars: null})],
    ['amounts with no settled amount', finishedFields({settled_microdollars: null})],
    ['a negative amount', finishedFields({settled_microdollars: -1})],
    ['a fractional amount', finishedFields({settled_microdollars: 1.5})],
    ['a body that is not an object', 'x'],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await noSense((options) => finishOperation(completed, options), answer);
  });
});

describe('finishAttempt', () => {
  const finishFields = (patch: Record<string, unknown> = {}) => ({outcome: 'finished', attempt_id: ATTEMPT, state: 'completed', stage: 'search', reason: null, detail: null, ...patch});

  it('sends a completion with its result digest, and reads the attempt', async () => {
    const {sent, options} = fake(finishFields());
    expect(await finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT}, options)).toEqual({
      outcome: 'finished',
      attempt: {state: 'completed', stage: 'search', reason: null},
      detail: null,
    });
    expect(sent[0]).toMatchObject({name: 'finish_attempt', body: {p_attempt_id: ATTEMPT, p_fence: FENCE, p_to: 'completed', p_result_digest: RESULT, p_revision: null}});
  });

  it('sends the revision the result was computed from when a worker names one, and none when the built-in step names none', async () => {
    const named = fake(finishFields());
    await finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT, revision: 7}, named.options);
    expect(named.sent[0].body).toEqual({p_attempt_id: ATTEMPT, p_fence: FENCE, p_to: 'completed', p_result_digest: RESULT, p_revision: 7});
    const none = fake(finishFields());
    await finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT}, none.options);
    expect(none.sent[0].body.p_revision).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses the revision %s before asking', async (revision) => {
    await refusedBeforeAsking((options) => finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT, revision}, options));
  });

  it('sends a failure with no digest, and reads failed/step_failed with the cause step_failed', async () => {
    const {sent, options} = fake(finishFields({state: 'failed', reason: 'step_failed', detail: 'step_failed'}));
    expect(await finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'failed'}, options)).toEqual({
      outcome: 'finished',
      attempt: {state: 'failed', stage: 'search', reason: 'step_failed'},
      detail: 'step_failed',
    });
    expect(sent[0].body).toMatchObject({p_to: 'failed', p_result_digest: null});
  });

  it('reads a replay of the same finish', async () => {
    expect(await finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT}, fake(finishFields({outcome: 'replayed'})).options)).toMatchObject({outcome: 'replayed'});
  });

  it('reads rejected: the result was refused because the Project\'s revision moved, and the attempt failed step_failed with the cause stale_revision', async () => {
    expect(await finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT}, fake(finishFields({outcome: 'rejected', state: 'failed', reason: 'step_failed', detail: 'stale_revision'})).options)).toEqual({
      outcome: 'rejected',
      attempt: {state: 'failed', stage: 'search', reason: 'step_failed'},
      detail: 'stale_revision',
    });
  });

  it('reads open_operations: an operation is still planned, dispatched or ambiguous', async () => {
    expect(await finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT}, fake({outcome: 'open_operations', attempt_id: ATTEMPT, state: 'running', stage: 'search'}).options)).toEqual({outcome: 'open_operations'});
  });

  it.each([
    ['a state it does not know', 'paused'],
    ['an outcome', 'maybe'],
  ])('throws an unexpected-shape error for %s', async (_label, value) => {
    await noSense((options) => finishAttempt({attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT}, options), finishFields(_label === 'an outcome' ? {outcome: value} : {state: value}));
  });

  it.each([
    ['a completion with no digest', {to: 'completed' as const}],
    ['a completion with a short digest', {to: 'completed' as const, resultDigest: 'abc'}],
    ['a failure with a digest', {to: 'failed' as const, resultDigest: RESULT}],
    ['a state other than completed or failed', {to: 'cancelled' as never}],
  ])('refuses %s before asking', async (_label, patch) => {
    await refusedBeforeAsking((options) => finishAttempt({attemptId: ATTEMPT, fence: FENCE, ...patch}, options));
  });

  it.each([
    ['a finish that lands in another state than asked', finishFields({state: 'failed', reason: 'step_failed', detail: 'step_failed'})],
    ['a failure without the cause step_failed', finishFields({state: 'failed', reason: 'step_failed', detail: 'lease_expired'}), 'failed'],
    ['a rejection that is not a failed attempt', finishFields({outcome: 'rejected', state: 'completed'})],
    ['a rejection with another cause', finishFields({outcome: 'rejected', state: 'failed', reason: 'step_failed', detail: 'step_failed'})],
    ['a rejection of a failure', finishFields({outcome: 'rejected', state: 'failed', reason: 'step_failed', detail: 'stale_revision'}), 'failed'],
    ['a cause it does not know', finishFields({detail: 'because'})],
    ['a failed attempt with a waiting reason', finishFields({state: 'failed', reason: 'awaiting_dispatch', detail: 'step_failed'}), 'failed'],
  ] as [string, unknown, ('completed' | 'failed')?][])('throws an unexpected-shape error for %s', async (_label, answer, to) => {
    await noSense(
      (options) => finishAttempt(to === 'failed' ? {attemptId: ATTEMPT, fence: FENCE, to} : {attemptId: ATTEMPT, fence: FENCE, to: 'completed', resultDigest: RESULT}, options),
      answer,
    );
  });
});

// The signed callbacks ---------------------------------------------------------------------------------------------------------------------------

describe('recordCallback', () => {
  const input = {jti: JTI, issuer: 'cad-worker' as const, kid: 'cad-worker-1', typ: 'worker-command', command: 'claim', attemptId: ATTEMPT, digest: DIGEST};

  it('sends the token\'s jti, issuer, key ID and type, the command, the attempt and the digest of the body, and takes no Account', async () => {
    const {sent, options} = fake({outcome: 'recorded'});
    expect(await recordCallback(input, options)).toEqual({outcome: 'recorded'});
    expect(sent[0]).toMatchObject({
      name: 'record_callback',
      body: {p_jti: JTI, p_issuer: 'cad-worker', p_kid: 'cad-worker-1', p_typ: 'worker-command', p_command: 'claim', p_attempt_id: ATTEMPT, p_digest: DIGEST},
    });
    expect(sent[0].body).not.toHaveProperty('p_account_id');
  });

  it('sends no attempt for a registration', async () => {
    const {sent, options} = fake({outcome: 'recorded'});
    await recordCallback({...input, command: 'register', attemptId: null}, options);
    expect(sent[0].body.p_attempt_id).toBeNull();
  });

  it.each(['recorded', 'duplicate', 'revoked'])('reads %s', async (outcome) => {
    expect(await recordCallback(input, fake({outcome}).options)).toEqual({outcome});
  });

  it.each([
    ['a jti of the wrong length', {jti: 'short'}],
    ['a jti with a character base64url has not', {jti: 'AAAAAAAAAAAAAAAAAAAA+/'}],
    ['an issuer that is not a worker', {issuer: 'application' as never}],
    ['a key ID that starts with a dot', {kid: '.bad'}],
    ['a type with a capital', {typ: 'Worker'}],
    ['a command that is not a worker command', {command: 'delete'}],
    ['a short digest', {digest: 'abc'}],
    ['an attempt that is not an ID', {attemptId: 'nope'}],
  ])('refuses %s before asking', async (_label, patch) => {
    await refusedBeforeAsking((options) => recordCallback({...input, ...patch}, options));
  });

  it('throws an unexpected-shape error for an outcome it does not know', async () => {
    await noSense((options) => recordCallback(input, options), {outcome: 'maybe'});
  });
});

// The outbox ---------------------------------------------------------------------------------------------------------------------------------------

describe('claimOutbox', () => {
  const item = (patch: Record<string, unknown> = {}) => ({id: OUTBOX, attempt_id: ATTEMPT, job_id: JOB, kind: 'test_workload', created_at: at, ...patch});

  it('asks for 20 by default and reads the rows leased to the caller', async () => {
    const {sent, options} = fake({claimed: 1, items: [item()]});
    expect(await claimOutbox({}, options)).toEqual([{id: OUTBOX, attemptId: ATTEMPT, jobId: JOB, kind: 'test_workload', createdAt: at}]);
    expect(sent[0]).toMatchObject({name: 'claim_outbox', body: {p_limit: 20, p_outbox_id: null}});
    expect(await claimOutbox(undefined, fake({claimed: 0, items: []}).options)).toEqual([]);
  });

  it('asks for the one named row at any age', async () => {
    const {sent, options} = fake({claimed: 1, items: [item()]});
    expect(await claimOutbox({limit: 1, outboxId: OUTBOX}, options)).toHaveLength(1);
    expect(sent[0].body).toEqual({p_limit: 1, p_outbox_id: OUTBOX});
  });

  it.each([0, 101, 1.5, -1])('refuses a limit of %s before asking', async (limit) => {
    await refusedBeforeAsking((options) => claimOutbox({limit}, options));
  });

  it('accepts a limit of 1 and of 100, and refuses an outbox ID that is not an ID', async () => {
    for (const limit of [1, 100]) {
      const {sent, options} = fake({claimed: 0, items: []});
      await claimOutbox({limit}, options);
      expect(sent[0].body.p_limit).toBe(limit);
    }
    await refusedBeforeAsking((options) => claimOutbox({outboxId: 'nope'}, options));
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['rows that are not a list', {claimed: 0, items: {}}],
    ['a count that is not the rows\'', {claimed: 2, items: [item()]}],
    ['more rows than the limit', {claimed: 2, items: [item(), item({id: STEP})]}, {limit: 1}],
    ['more than one row for a named row', {claimed: 2, items: [item(), item({id: STEP})]}, {limit: 5, outboxId: OUTBOX}],
    ['another row than the one named', {claimed: 1, items: [item({id: STEP})]}, {limit: 1, outboxId: OUTBOX}],
    ['a row with a kind that is not a word', {claimed: 1, items: [item({kind: 'Bad'})]}],
    ['a row with no attempt', {claimed: 1, items: [item({attempt_id: null})]}],
    ['a row with a time that is not one', {claimed: 1, items: [item({created_at: 'then'})]}],
  ] as [string, unknown, {limit?: number; outboxId?: string}?][])('throws an unexpected-shape error for %s', async (_label, answer, patch) => {
    await noSense((options) => claimOutbox(patch ?? {}, options), answer);
  });
});

describe('markPublished', () => {
  it('sends the row and the message ID, and reads marked', async () => {
    const {sent, options} = fake({outcome: 'marked', message_id: 'msg_1'});
    expect(await markPublished({outboxId: OUTBOX, messageId: 'msg_1'}, options)).toEqual({outcome: 'marked', messageId: 'msg_1'});
    expect(sent[0]).toMatchObject({name: 'mark_published', body: {p_outbox_id: OUTBOX, p_message_id: 'msg_1'}});
  });

  it('reads replayed (the same message ID again) and conflict (the row holds another, which it returns)', async () => {
    expect(await markPublished({outboxId: OUTBOX, messageId: 'msg_1'}, fake({outcome: 'replayed', message_id: 'msg_1'}).options)).toEqual({outcome: 'replayed', messageId: 'msg_1'});
    expect(await markPublished({outboxId: OUTBOX, messageId: 'msg_2'}, fake({outcome: 'conflict', message_id: 'msg_1'}).options)).toEqual({outcome: 'conflict', messageId: 'msg_1'});
  });

  it.each([
    ['a message ID with a space', 'msg 1'],
    ['an empty message ID', ''],
    ['a message ID of 201 characters', 'm'.repeat(201)],
    ['a message ID with a non-ASCII character', 'msg_é'],
  ])('refuses %s before asking', async (_label, messageId) => {
    await refusedBeforeAsking((options) => markPublished({outboxId: OUTBOX, messageId}, options));
  });

  it('refuses a row that is not an ID before asking', async () => {
    await refusedBeforeAsking((options) => markPublished({outboxId: 'nope', messageId: 'msg_1'}, options));
  });

  it.each([
    ['an outcome it does not know', {outcome: 'maybe', message_id: 'msg_1'}],
    ['no message ID', {outcome: 'marked', message_id: null}],
    ['a marked row with another message ID than the one given', {outcome: 'marked', message_id: 'msg_9'}],
    ['a replay with another message ID than the one given', {outcome: 'replayed', message_id: 'msg_9'}],
    ['a conflict with the very message ID given', {outcome: 'conflict', message_id: 'msg_1'}],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await noSense((options) => markPublished({outboxId: OUTBOX, messageId: 'msg_1'}, options), answer);
  });
});

// The sweep and the cancellation on disable ------------------------------------------------------------------------------------------------------------

describe('sweepAttempts', () => {
  const swept = (patch: Record<string, unknown> = {}) => ({expired: 2, cancelled: 1, settled: 3, marked: 4, reconciled: 5, failed: 6, ...patch});

  it('asks for nothing and reads what it did: the three counts of Story 2.7 and the three of Story 2.8', async () => {
    const {sent, options} = fake(swept());
    expect(await sweepAttempts(options)).toEqual({expired: 2, cancelled: 1, settled: 3, marked: 4, reconciled: 5, failed: 6});
    expect(sent).toEqual([expect.objectContaining({name: 'sweep_attempts', body: {}})]);
  });

  it('reads zero counts, and returns exactly the six keys (an extra member of the answer is not carried)', async () => {
    const result = await sweepAttempts(fake(swept({expired: 0, cancelled: 0, settled: 0, marked: 0, reconciled: 0, failed: 0, extra: 9})).options);
    expect(result).toEqual({expired: 0, cancelled: 0, settled: 0, marked: 0, reconciled: 0, failed: 0});
    expect(Object.keys(result).sort()).toEqual(['cancelled', 'expired', 'failed', 'marked', 'reconciled', 'settled']);
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['a negative count', swept({expired: -1})],
    ['a fractional count', swept({cancelled: 0.5})],
    ['no count', {expired: 0, cancelled: 0}],
    ['a count that is text', swept({settled: 'two'})],
    ['no marked count', (({marked: _marked, ...rest}) => rest)(swept())],
    ['no reconciled count', (({reconciled: _reconciled, ...rest}) => rest)(swept())],
    ['no failed count', (({failed: _failed, ...rest}) => rest)(swept())],
    ['a negative marked count', swept({marked: -1})],
    ['a fractional reconciled count', swept({reconciled: 1.5})],
    ['a failed count that is text', swept({failed: '1'})],
    ['a null failed count', swept({failed: null})],
    ['the three counts of Story 2.7 only', {expired: 2, cancelled: 1, settled: 3}],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await noSense((options) => sweepAttempts(options), answer);
  });

  it('throws when the database is unreachable', async () => {
    await expect(sweepAttempts(down)).rejects.toMatchObject({retryable: true});
  });
});

// Reconciling an operation whose outcome was unknown (Story 2.8) -----------------------------------------------------------------------------------

describe('reconcileOperation', () => {
  const SETTLEMENT = 'c1c27b6a-5f4e-4d3c-8b2a-1f0e9d8c7b64';
  const CORRECTION = 'c2c27b6a-5f4e-4d3c-8b2a-1f0e9d8c7b65';
  const INCIDENT = 'c3c27b6a-5f4e-4d3c-8b2a-1f0e9d8c7b66';
  const evidence = {operationId: OPERATION, outcome: 'evidence' as const, usage: {inputTokens: 1200, outputTokens: 300, returnedModel: 'fixture-model'}};
  const noncharge = {operationId: OPERATION, outcome: 'noncharge' as const, requestId: 'req_422'};

  // A settlement (the first booking of an ambiguous operation), and the booking of a correction (late evidence after a deadline booking: the settlement fields are the deadline
  // settlement, unchanged, and the correction is the signed delta from it).
  const reconciledFields = (patch: Record<string, unknown> = {}) => ({
    outcome: 'reconciled',
    operation_id: OPERATION,
    state: 'settled',
    reason: null,
    settlement_id: SETTLEMENT,
    correction_id: null,
    incident_id: null,
    classification: 'evidence',
    settled_microdollars: 2,
    released_microdollars: 3400,
    over_microdollars: 0,
    delta_microdollars: null,
    ...patch,
  });
  const correctedFields = (patch: Record<string, unknown> = {}) => ({
    outcome: 'corrected',
    operation_id: OPERATION,
    state: 'settled',
    reason: null,
    settlement_id: SETTLEMENT,
    correction_id: CORRECTION,
    incident_id: null,
    classification: 'deadline',
    settled_microdollars: 3400,
    released_microdollars: 3400,
    over_microdollars: 0,
    delta_microdollars: -3398,
    ...patch,
  });

  it('pins the words a refused settlement answers', () => {
    expect([...reconcileRefusals]).toEqual(['already_settled', 'invalid_evidence', 'overflow', 'not_reserved', 'not_settleable', 'not_due', 'reused']);
  });

  describe('what it sends', () => {
    it('sends evidence with the usage and no request ID, and no Account and no epoch (it is authority-free)', async () => {
      const {sent, options} = fake(reconciledFields());
      await reconcileOperation(evidence, options);
      expect(sent).toEqual([expect.objectContaining({name: 'reconcile_operation'})]);
      expect(sent[0].body).toEqual({
        p_operation_id: OPERATION,
        p_outcome: 'evidence',
        p_input_tokens: 1200,
        p_output_tokens: 300,
        p_returned_model: 'fixture-model',
        p_request_id: null,
      });
      expect(sent[0].body).not.toHaveProperty('p_account_id');
      expect(sent[0].body).not.toHaveProperty('p_epoch');
    });

    it('sends the provider\'s request ID with evidence when there is one (it is optional)', async () => {
      const {sent, options} = fake(reconciledFields());
      await reconcileOperation({...evidence, requestId: 'req_late'}, options);
      expect(sent[0].body).toMatchObject({p_outcome: 'evidence', p_request_id: 'req_late'});
      const second = fake(reconciledFields());
      await reconcileOperation({...evidence, requestId: null}, second.options);
      expect(second.sent[0].body.p_request_id).toBeNull();
    });

    it('sends a noncharge with the request ID and no usage', async () => {
      const {sent, options} = fake(reconciledFields({state: 'noncharge', classification: 'noncharge', settled_microdollars: 0, released_microdollars: 3400}));
      await reconcileOperation(noncharge, options);
      expect(sent[0].body).toEqual({
        p_operation_id: OPERATION,
        p_outcome: 'noncharge',
        p_input_tokens: null,
        p_output_tokens: null,
        p_returned_model: null,
        p_request_id: 'req_422',
      });
    });

    it('lower-cases the operation it sends', async () => {
      const {sent, options} = fake(reconciledFields());
      await reconcileOperation({...evidence, operationId: OPERATION.toUpperCase()}, options);
      expect(sent[0].body.p_operation_id).toBe(OPERATION);
    });

    it('sends zero tokens as zero (not null)', async () => {
      const {sent, options} = fake(reconciledFields({settled_microdollars: 0, released_microdollars: 3400}));
      await reconcileOperation({...evidence, usage: {inputTokens: 0, outputTokens: 0, returnedModel: 'fixture-model'}}, options);
      expect(sent[0].body).toMatchObject({p_input_tokens: 0, p_output_tokens: 0});
    });
  });

  describe('what it refuses before asking', () => {
    it.each([
      ['an operation that is not an ID', {operationId: 'nope'}],
      ['an empty operation', {operationId: ''}],
      ['a returned model that is empty', {usage: {inputTokens: 1, outputTokens: 1, returnedModel: ''}}],
      ['a returned model with a space', {usage: {inputTokens: 1, outputTokens: 1, returnedModel: 'a b'}}],
      ['a returned model of 201 characters', {usage: {inputTokens: 1, outputTokens: 1, returnedModel: 'm'.repeat(201)}}],
      ['negative input tokens', {usage: {inputTokens: -1, outputTokens: 1, returnedModel: 'm'}}],
      ['fractional output tokens', {usage: {inputTokens: 1, outputTokens: 0.5, returnedModel: 'm'}}],
      ['tokens that are text', {usage: {inputTokens: '1', outputTokens: 1, returnedModel: 'm'}}],
      ['no usage', {usage: undefined}],
      ['a request ID with a space', {requestId: 'req 1'}],
      ['an empty request ID', {requestId: ''}],
      ['a request ID of 201 characters', {requestId: 'r'.repeat(201)}],
      ['a request ID that is not ASCII', {requestId: 'req\u00e9'}],
    ])('refuses evidence with %s', async (_label, patch) => {
      await refusedBeforeAsking((options) => reconcileOperation({...evidence, ...patch} as never, options));
    });

    it.each([
      ['no request ID (a noncharge is proven only by the provider\'s)', {requestId: undefined}],
      ['a null request ID', {requestId: null}],
      ['a request ID with a space', {requestId: 'req 1'}],
      ['an empty request ID', {requestId: ''}],
      ['a request ID of 201 characters', {requestId: 'r'.repeat(201)}],
      ['an operation that is not an ID', {operationId: 'nope'}],
    ])('refuses a noncharge with %s', async (_label, patch) => {
      await refusedBeforeAsking((options) => reconcileOperation({...noncharge, ...patch} as never, options));
    });

    it.each(['completed', 'ambiguous', 'deadline', 'settled', '', undefined, 'EVIDENCE'])('refuses an outcome that is neither evidence nor noncharge (%j)', async (outcome) => {
      await refusedBeforeAsking((options) => reconcileOperation({operationId: OPERATION, outcome, requestId: 'req_1'} as never, options));
    });
  });

  describe('what it reads', () => {
    it('reads an ambiguous operation reconciled by evidence: settled at the evidence, the remainder released', async () => {
      expect(await reconcileOperation(evidence, fake(reconciledFields()).options)).toEqual({
        outcome: 'reconciled',
        operationId: OPERATION,
        state: 'settled',
        settlementId: SETTLEMENT,
        classification: 'evidence',
        settledMicrodollars: 2,
        releasedMicrodollars: 3400,
        overMicrodollars: 0,
        incidentId: null,
        correctionId: null,
        deltaMicrodollars: null,
      });
    });

    it('reads evidence above the reservation: settled at the evidence, the excess over, an incident opened', async () => {
      expect(await reconcileOperation(evidence, fake(reconciledFields({settled_microdollars: 3500, released_microdollars: 3400, over_microdollars: 100, incident_id: INCIDENT})).options)).toMatchObject({
        outcome: 'reconciled',
        settledMicrodollars: 3500,
        releasedMicrodollars: 3400,
        overMicrodollars: 100,
        incidentId: INCIDENT,
        correctionId: null,
        deltaMicrodollars: null,
      });
    });

    it('reads a proven noncharge: the operation noncharge, settled 0, the whole reservation released', async () => {
      expect(await reconcileOperation(noncharge, fake(reconciledFields({state: 'noncharge', classification: 'noncharge', settled_microdollars: 0, released_microdollars: 3400})).options)).toMatchObject({
        outcome: 'reconciled',
        state: 'noncharge',
        classification: 'noncharge',
        settledMicrodollars: 0,
        releasedMicrodollars: 3400,
        overMicrodollars: 0,
        incidentId: null,
        correctionId: null,
      });
    });

    it('reads late evidence BELOW the deadline booking: one correction with a negative delta, the booking unchanged, no incident', async () => {
      expect(await reconcileOperation(evidence, fake(correctedFields()).options)).toEqual({
        outcome: 'corrected',
        operationId: OPERATION,
        state: 'settled',
        settlementId: SETTLEMENT,
        classification: 'deadline',
        settledMicrodollars: 3400,
        releasedMicrodollars: 3400,
        overMicrodollars: 0,
        incidentId: null,
        correctionId: CORRECTION,
        deltaMicrodollars: -3398,
      });
    });

    it('reads late evidence ABOVE the deadline booking: a positive delta, over the same amount, an incident on the original settlement', async () => {
      expect(await reconcileOperation(evidence, fake(correctedFields({delta_microdollars: 100, over_microdollars: 100, incident_id: INCIDENT})).options)).toMatchObject({
        outcome: 'corrected',
        classification: 'deadline',
        settledMicrodollars: 3400,
        releasedMicrodollars: 3400,
        overMicrodollars: 100,
        incidentId: INCIDENT,
        correctionId: CORRECTION,
        deltaMicrodollars: 100,
      });
    });

    it('reads late evidence equal to the deadline booking: a correction of exactly 0 (the signed delta is not an amount)', async () => {
      expect(await reconcileOperation(evidence, fake(correctedFields({delta_microdollars: 0})).options)).toMatchObject({outcome: 'corrected', deltaMicrodollars: 0, overMicrodollars: 0, incidentId: null});
    });

    it('reads the signed delta as a signed whole number (a large negative one too)', async () => {
      const big = -1_000_000_000_000_000;
      expect(await reconcileOperation(evidence, fake(correctedFields({settled_microdollars: 1e15, released_microdollars: 1e15, delta_microdollars: big})).options)).toMatchObject({deltaMicrodollars: big});
    });

    it('reads the same report again as replayed, with the settlement shape (a first booking replayed)', async () => {
      expect(await reconcileOperation(evidence, fake(reconciledFields({outcome: 'replayed'})).options)).toMatchObject({
        outcome: 'replayed',
        settledMicrodollars: 2,
        correctionId: null,
        deltaMicrodollars: null,
      });
    });

    it('reads the same late evidence again as replayed, with the correction shape', async () => {
      expect(await reconcileOperation(evidence, fake(correctedFields({outcome: 'replayed'})).options)).toMatchObject({
        outcome: 'replayed',
        classification: 'deadline',
        correctionId: CORRECTION,
        deltaMicrodollars: -3398,
      });
      expect(await reconcileOperation(evidence, fake(correctedFields({outcome: 'replayed', delta_microdollars: 100, over_microdollars: 100, incident_id: INCIDENT})).options)).toMatchObject({
        outcome: 'replayed',
        incidentId: INCIDENT,
        deltaMicrodollars: 100,
      });
    });

    it('reads a repeated noncharge as replayed', async () => {
      expect(await reconcileOperation(noncharge, fake(reconciledFields({outcome: 'replayed', state: 'noncharge', classification: 'noncharge', settled_microdollars: 0, released_microdollars: 3400})).options)).toMatchObject({
        outcome: 'replayed',
        state: 'noncharge',
        settledMicrodollars: 0,
      });
    });

    it.each(['planned', 'dispatched', 'abandoned', 'settled', 'noncharge', 'completed', 'ambiguous'])('reads not_reconcilable with the state %s that refused, and nothing else', async (state) => {
      expect(await reconcileOperation(evidence, fake({outcome: 'not_reconcilable', operation_id: OPERATION, state}).options)).toEqual({outcome: 'not_reconcilable', operationId: OPERATION, state});
    });

    it('reads unavailable (no such operation) with nothing else, whatever else the answer carries', async () => {
      expect(await reconcileOperation(evidence, fake({outcome: 'unavailable', operation_id: null, state: null}).options)).toEqual({outcome: 'unavailable'});
      expect(await reconcileOperation(evidence, fake({outcome: 'unavailable'}).options)).toEqual({outcome: 'unavailable'});
    });

    it.each(reconcileRefusals)('reads the refusal %s of the settlement with the operation, its state and the database\'s reason (the operation stays as it was)', async (outcome) => {
      expect(await reconcileOperation(evidence, fake({outcome, operation_id: OPERATION, state: 'ambiguous', reason: outcome === 'invalid_evidence' ? 'model_mismatch' : null}).options)).toEqual({
        outcome,
        operationId: OPERATION,
        state: 'ambiguous',
        reason: outcome === 'invalid_evidence' ? 'model_mismatch' : null,
      });
    });

    it.each(reconcileReasons)('carries the reason %s of an invalid_evidence through to the caller, and a missing reason as null', async (reason) => {
      expect(await reconcileOperation(evidence, fake({outcome: 'invalid_evidence', operation_id: OPERATION, state: 'settled', reason}).options)).toEqual({
        outcome: 'invalid_evidence',
        operationId: OPERATION,
        state: 'settled',
        reason,
      });
      expect(await reconcileOperation(evidence, fake({outcome: 'invalid_evidence', operation_id: OPERATION, state: 'settled', reason: null}).options)).toMatchObject({outcome: 'invalid_evidence', reason: null});
      expect(await reconcileOperation(evidence, fake({outcome: 'invalid_evidence', operation_id: OPERATION, state: 'settled'}).options)).toMatchObject({outcome: 'invalid_evidence', reason: null});
    });

    it.each([
      ['a reason the database does not have', {outcome: 'invalid_evidence', reason: 'because'}],
      ['a reason that is not text', {outcome: 'invalid_evidence', reason: 7}],
      ['a reason on a word that has none', {outcome: 'already_settled', reason: 'overflow'}],
      ['a reason on a reconciliation', {outcome: 'reconciled', reason: 'overflow'}],
    ])('is no answer: %s', async (_label, patch) => {
      const answer = patch.outcome === 'reconciled' ? reconciledFields(patch) : {operation_id: OPERATION, state: 'ambiguous', ...patch};
      await noSense((options) => reconcileOperation(evidence, options), answer);
    });
  });

  describe('what makes no sense', () => {
    it.each([
      ['an outcome it does not know', reconciledFields({outcome: 'maybe'})],
      ['no outcome', reconciledFields({outcome: null})],
      ['another operation than the one asked about', reconciledFields({operation_id: STEP})],
      ['no operation', reconciledFields({operation_id: null})],
      ['a state that is not an operation state', reconciledFields({state: 'bogus'})],
      ['no state', reconciledFields({state: null})],
      ['a not_reconcilable with no state', {outcome: 'not_reconcilable', operation_id: OPERATION, state: null}],
      ['a refusal with a state that is not a state', {outcome: 'overflow', operation_id: OPERATION, state: 'bogus'}],
      ['a refusal with no operation', {outcome: 'invalid_evidence', operation_id: null, state: 'ambiguous'}],
      ['a classification it does not know', reconciledFields({classification: 'guess'})],
      ['no classification', reconciledFields({classification: null})],
      ['no settled amount', reconciledFields({settled_microdollars: null})],
      ['no released amount', reconciledFields({released_microdollars: null})],
      ['no over amount', reconciledFields({over_microdollars: null})],
      ['a negative amount', reconciledFields({settled_microdollars: -1})],
      ['a fractional amount', reconciledFields({released_microdollars: 1.5})],
      ['an amount that is text', reconciledFields({over_microdollars: '0'})],
      ['no settlement', reconciledFields({settlement_id: null})],
      ['a settlement that is not an ID', reconciledFields({settlement_id: 'nope'})],
      ['an incident that is not an ID', reconciledFields({incident_id: 'nope', over_microdollars: 100, settled_microdollars: 3500, released_microdollars: 3400})],
      ['a correction that is not an ID', correctedFields({correction_id: 'nope'})],
      ['an over amount that is not what the settlement is above its reservation', reconciledFields({settled_microdollars: 3500, released_microdollars: 3400, over_microdollars: 50, incident_id: INCIDENT})],
      ['an over amount on a settlement below its reservation', reconciledFields({over_microdollars: 1})],
      ['an overrun with no incident', reconciledFields({settled_microdollars: 3500, released_microdollars: 3400, over_microdollars: 100})],
      ['an incident with no overrun', reconciledFields({incident_id: INCIDENT})],
      ['a correction with no delta', correctedFields({delta_microdollars: null})],
      ['a delta with no correction', reconciledFields({delta_microdollars: -5})],
      ['a delta that is fractional', correctedFields({delta_microdollars: -1.5})],
      ['a delta that is text', correctedFields({delta_microdollars: '-5'})],
      ['a correction of a booking that is not a deadline booking', correctedFields({classification: 'evidence'})],
      ['a correction whose booking was released other than whole', correctedFields({released_microdollars: 3000})],
      ['a correction whose over is not the positive part of the delta', correctedFields({delta_microdollars: 100, over_microdollars: 0})],
      ['a correction with an over amount and a negative delta', correctedFields({delta_microdollars: -100, over_microdollars: 100, incident_id: INCIDENT})],
      ['a positive delta with no incident', correctedFields({delta_microdollars: 100, over_microdollars: 100, incident_id: null})],
      ['an incident on a correction below the booking', correctedFields({incident_id: INCIDENT})],
      ['corrected without a correction', reconciledFields({outcome: 'corrected'})],
      ['reconciled with a correction', correctedFields({outcome: 'reconciled'})],
      ['a body that is not an object', 'x'],
      ['a body that is an array', []],
    ])('throws an unexpected-shape error for %s', async (_label, answer) => {
      await noSense((options) => reconcileOperation(evidence, options), answer);
    });

    it('throws an unexpected-shape error for a repeat of a noncharge in the same ways', async () => {
      await noSense((options) => reconcileOperation(noncharge, options), reconciledFields({classification: 'guess'}));
    });

    it('throws when the database is unreachable (the outcome is unknown: send the same report again)', async () => {
      await expect(reconcileOperation(evidence, down)).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    });

    it('throws when the database refuses the call', async () => {
      await expect(reconcileOperation(evidence, fake({code: '22023', message: 'invalid argument'}, 400).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
    });
  });
});

describe('cancelAccountJobs', () => {
  it('sends only the Account (no epoch: the authority is already gone) and reads the counts', async () => {
    const {sent, options} = fake({cancelled: 2, settled: 1});
    expect(await cancelAccountJobs({accountId: ACCOUNT}, options)).toEqual({cancelled: 2, settled: 1});
    expect(sent[0]).toMatchObject({name: 'cancel_account_jobs', body: {p_account_id: ACCOUNT}});
    expect(Object.keys(sent[0].body)).toEqual(['p_account_id']);
  });

  it('reads zero when nothing was open: a second call cancels nothing', async () => {
    expect(await cancelAccountJobs({accountId: ACCOUNT}, fake({cancelled: 0, settled: 0}).options)).toEqual({cancelled: 0, settled: 0});
  });

  it('refuses an Account that is not an ID before asking', async () => {
    await refusedBeforeAsking((options) => cancelAccountJobs({accountId: 'nope'}, options));
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['a negative count', {cancelled: -1, settled: 0}],
    ['no count', {cancelled: 1}],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await noSense((options) => cancelAccountJobs({accountId: ACCOUNT}, options), answer);
  });

  it('lower-cases the Account it sends', async () => {
    const {sent, options} = fake({cancelled: 0, settled: 0});
    await cancelAccountJobs({accountId: ACCOUNT.toUpperCase()}, options);
    expect(sent[0].body.p_account_id).toBe(ACCOUNT);
  });
});
