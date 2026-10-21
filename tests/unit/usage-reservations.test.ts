import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {operationStates as jobOperationStates} from '@/lib/job-records';
import {
  apiVersionPattern,
  costRefusals,
  maxAmountMicrodollars,
  maxOptionDetail,
  operationStates,
  quoteCost,
  reserveCost,
  returnedModelPattern,
  settleableStates,
  settleCost,
  settlementClassifications,
  unavailableBoundReasons,
  usageConstants,
  wordPattern,
  type OperationState,
  type SettlementClassification,
} from '@/lib/usage-reservations';

// The typed calls of the cost functions (lib/usage-reservations.ts), against a fake fetch: what each sends (the Account and epoch from the operation, nothing a request
// chose; settling the Account alone), what each accepts as an answer, and that an answer that cannot be got, or makes no sense, is an error: no outcome, no amount and
// no cost block is invented. The calculator is in SQL and is tested there (tests/integration/usage-reservations.test.ts); nothing here does price arithmetic.
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const JOB = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const OPERATION = 'ee8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6f';
const OTHER_OPERATION = 'ff8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b60';
const SCHEDULE = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const PERIOD = '5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f';
const RESERVATION = '6e7f8091-a2b3-4c4d-8e5f-6a7b8c9d0e1f';
const SETTLEMENT = '7f8091a2-b3c4-4d5e-8f6a-7b8c9d0e1f2a';
const INCIDENT = '8091a2b3-c4d5-4e6f-8a7b-8c9d0e1f2a3b';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only'};
const operation = {accountId: ACCOUNT, epoch: 3};
const dueAt = '2026-10-21T12:00:00.123456+00:00';

type Sent = {name: string; body: Record<string, unknown>; headers: Record<string, string>};
function fake(answer: unknown, status = 200) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    sent.push({name: input.split('/rpc/')[1], body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string>});
    return new Response(JSON.stringify(answer), {status, headers: {'content-type': 'application/json'}});
  });
  return {fetch, sent, options: {env, fetch}};
}

/** An answer that is not an answer: the call rejects with the unexpected-shape error, which says the outcome may be unknown and is not worth retrying. */
async function expectUnexpected(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AccountsUnavailableError);
  expect(error).toMatchObject({outcomeUnknown: true, retryable: false});
}

const calculation = {
  rateScheduleId: SCHEDULE,
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  apiVersion: '2023-06-01',
  requestBytes: 10_000,
  imageCount: 2,
  outputLimit: 4_000,
};

/** The arguments of the calculator as the database receives them. */
const calculationBody = {
  p_rate_schedule_id: SCHEDULE,
  p_provider: 'anthropic',
  p_model: 'claude-sonnet-5-5',
  p_api_version: '2023-06-01',
  p_request_bytes: 10_000,
  p_image_count: 2,
  p_output_limit: 4_000,
};

/** What the database answers for a quote (the composite type of the migration). */
const quoteFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'quoted',
  reason: null,
  detail: null,
  input_bound: 24_200,
  input_units: 24_200,
  output_units: 4_000,
  microdollars: 132_600,
  ...patch,
});

/** What the database answers for a reservation: every field of the composite type, the cost block empty. */
const reservationFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'reserved',
  reservation_id: RESERVATION,
  operation_id: OPERATION,
  job_id: JOB,
  period_id: PERIOD,
  rate_schedule_id: SCHEDULE,
  input_bound: 24_200,
  reserved_microdollars: 132_600,
  state: null,
  reason: null,
  detail: null,
  requested_microdollars: null,
  limit_microdollars: null,
  used_microdollars: null,
  available_microdollars: null,
  ...patch,
});

/** A refusal's answer: no reservation, and the cost block. */
const refusalFields = (outcome: string, block: {requested: number | null; limit: number; used: number; available: number}, patch: Record<string, unknown> = {}) => ({
  outcome,
  reservation_id: null,
  operation_id: null,
  job_id: null,
  period_id: null,
  rate_schedule_id: null,
  input_bound: null,
  reserved_microdollars: null,
  state: null,
  reason: null,
  detail: null,
  requested_microdollars: block.requested,
  limit_microdollars: block.limit,
  used_microdollars: block.used,
  available_microdollars: block.available,
  ...patch,
});

/** What the database answers for a settlement. */
const settlementFields = (patch: Record<string, unknown> = {}) => ({
  outcome: 'settled',
  settlement_id: SETTLEMENT,
  reservation_id: RESERVATION,
  operation_id: OPERATION,
  period_id: PERIOD,
  classification: 'evidence',
  settled_microdollars: 150_000,
  released_microdollars: 200_000,
  over_microdollars: 0,
  incident_id: null,
  state: null,
  due_at: null,
  reason: null,
  ...patch,
});

const evidence = {inputTokens: 21_000, outputTokens: 3_500, returnedModel: 'claude-sonnet-5-5-20261001'};

describe('the recorded constants and the vocabularies', () => {
  it('mirrors the recorded constants exactly (a test of the integration suite holds them equal to the SQL functions)', () => {
    expect(usageConstants).toEqual({
      overheadTokens: 2000,
      imageTokens: 5000,
      marginPercent: 10,
      inputCeiling: 200_000,
      outputCeiling: 16_000,
      requestCeiling: 20,
      operationCap: 1_000_000,
      jobCap: 5_000_000,
      ambiguityDeadlineHours: 24,
    });
    expect(maxAmountMicrodollars).toBe(1e15);
  });

  it('names the nine reasons a bound is unavailable in the order the calculator checks them, and the five refusals that carry the cost block', () => {
    expect(unavailableBoundReasons).toEqual([
      'unknown_rate',
      'foreign_rate',
      'foreign_currency',
      'unsupported_option',
      'over_input_ceiling',
      'over_output_ceiling',
      'over_request_ceiling',
      'overflow',
      'unpriced',
    ]);
    expect(costRefusals).toEqual(['unavailable_bound', 'provider_blocked', 'over_operation_cap', 'over_job_cap', 'insufficient_allowance']);
    expect(settlementClassifications).toEqual(['evidence', 'deadline', 'noncharge', 'unused']);
  });

  it('holds the operation states equal to the Jobs module\'s, which this module may not import', () => {
    expect([...operationStates]).toEqual([...jobOperationStates]);
  });

  it('settles evidence for a completed, ambiguous or settled operation, a deadline for an ambiguous or settled one, a noncharge and an unused one only for theirs', () => {
    expect(settleableStates).toEqual({
      evidence: ['completed', 'ambiguous', 'settled'],
      deadline: ['ambiguous', 'settled'],
      noncharge: ['noncharge'],
      unused: ['abandoned'],
    });
    for (const states of Object.values(settleableStates)) for (const state of states) expect(operationStates).toContain(state);
    // A planned or dispatched operation, whose charge is not known yet, is settleable as nothing.
    for (const state of ['planned', 'dispatched'] as const) for (const states of Object.values(settleableStates)) expect(states).not.toContain(state);
  });

  it('describes the words the database accepts: a lower-case name, an API version and a returned model without spaces', () => {
    for (const good of ['anthropic', 'claude-sonnet-5-5', 'brave', 'a', 'x.y_z-1', 'a'.repeat(80)]) expect(wordPattern.test(good), good).toBe(true);
    for (const bad of ['', 'Anthropic', '1model', 'has space', 'a'.repeat(81), '-x', 'rèq']) expect(wordPattern.test(bad), bad).toBe(false);
    for (const good of ['2023-06-01', 'v1', '~', 'x'.repeat(100)]) expect(apiVersionPattern.test(good), good).toBe(true);
    for (const bad of ['', 'two words', 'x'.repeat(101), 'tab\there', 'rèq']) expect(apiVersionPattern.test(bad), bad).toBe(false);
    for (const good of ['claude-sonnet-5-5-20261001', 'm', 'M'.repeat(200)]) expect(returnedModelPattern.test(good), good).toBe(true);
    for (const bad of ['', 'two words', 'M'.repeat(201), 'rèq']) expect(returnedModelPattern.test(bad), bad).toBe(false);
    expect(maxOptionDetail).toBe(100);
  });
});

describe('quoteCost', () => {
  it('sends the Account and epoch of the operation and the calculator\'s arguments, one request and no options by default, as the service role', async () => {
    const {sent, options} = fake(quoteFields());
    expect(await quoteCost(operation, calculation, options)).toEqual({outcome: 'quoted', inputBound: 24_200, inputUnits: 24_200, outputUnits: 4_000, microdollars: 132_600});
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('quote_cost');
    expect(sent[0].body).toEqual({p_account_id: ACCOUNT, p_epoch: 3, ...calculationBody, p_request_count: 1, p_options: {}});
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('sends the request count and the options it was given, and leaves refusing an option to the calculator', async () => {
    const {sent, options} = fake(quoteFields());
    await quoteCost(operation, {...calculation, requestCount: 20, options: {cache: true}}, options);
    expect(sent[0].body).toMatchObject({p_request_count: 20, p_options: {cache: true}});
  });

  it('reads billed units above the bound when the schedule has an increment, and the largest bound and amount', async () => {
    expect(await quoteCost(operation, calculation, fake(quoteFields({input_bound: 24_200, input_units: 25_000, output_units: 4_096})).options)).toMatchObject({
      outcome: 'quoted',
      inputUnits: 25_000,
      outputUnits: 4_096,
    });
    expect(await quoteCost(operation, calculation, fake(quoteFields({input_bound: 200_000, input_units: 200_000, microdollars: 1e15})).options)).toMatchObject({
      outcome: 'quoted',
      inputBound: 200_000,
      microdollars: 1e15,
    });
    expect(await quoteCost(operation, calculation, fake(quoteFields({output_units: 0, microdollars: 1})).options)).toMatchObject({outputUnits: 0, microdollars: 1});
  });

  it.each(unavailableBoundReasons.filter((reason) => reason !== 'unsupported_option'))('reads unavailable_bound with the reason %s and no option key', async (reason) => {
    expect(await quoteCost(operation, calculation, fake(quoteFields({outcome: 'unavailable_bound', reason, input_bound: null, input_units: null, output_units: null, microdollars: null})).options)).toEqual({
      outcome: 'unavailable_bound',
      reason,
      detail: null,
    });
  });

  it('reads an unsupported option with the key it names, up to 100 characters', async () => {
    const refused = (detail: unknown) => fake(quoteFields({outcome: 'unavailable_bound', reason: 'unsupported_option', detail, input_bound: null, input_units: null, output_units: null, microdollars: null})).options;
    expect(await quoteCost(operation, calculation, refused('cache'))).toEqual({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: 'cache'});
    // JSON allows an empty key, and the calculator names it all the same.
    expect(await quoteCost(operation, calculation, refused(''))).toEqual({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: ''});
    expect(await quoteCost(operation, calculation, refused('k'.repeat(100)))).toMatchObject({detail: 'k'.repeat(100)});
  });

  it('answers denied with nothing else', async () => {
    expect(await quoteCost(operation, calculation, fake(quoteFields({outcome: 'denied', input_bound: null, input_units: null, output_units: null, microdollars: null})).options)).toEqual({outcome: 'denied'});
  });

  it('lower-cases the IDs it sends', async () => {
    const {sent, options} = fake(quoteFields());
    await quoteCost({accountId: ACCOUNT.toUpperCase(), epoch: 3}, {...calculation, rateScheduleId: SCHEDULE.toUpperCase()}, options);
    expect(sent[0].body).toMatchObject({p_account_id: ACCOUNT, p_rate_schedule_id: SCHEDULE});
  });

  it.each([
    ['a schedule that is not an ID', {rateScheduleId: 'nope'}],
    ['an upper-case provider', {provider: 'Anthropic'}],
    ['an empty provider', {provider: ''}],
    ['a provider that starts with a digit', {provider: '1anthropic'}],
    ['a provider of 81 characters', {provider: 'a'.repeat(81)}],
    ['a model with a space', {model: 'claude sonnet'}],
    ['an empty model', {model: ''}],
    ['a model that is not text', {model: 5}],
    ['an API version with a space', {apiVersion: '2023 06'}],
    ['an empty API version', {apiVersion: ''}],
    ['an API version of 101 characters', {apiVersion: 'v'.repeat(101)}],
    ['a non-ASCII API version', {apiVersion: 'vé'}],
    ['a negative request size', {requestBytes: -1}],
    ['a fractional request size', {requestBytes: 1.5}],
    ['a request size that is not a number', {requestBytes: Number.NaN}],
    ['an infinite request size', {requestBytes: Number.POSITIVE_INFINITY}],
    ['a request size beyond a safe integer', {requestBytes: Number.MAX_SAFE_INTEGER + 1}],
    ['a request size as text', {requestBytes: '10000'}],
    ['a negative image count', {imageCount: -1}],
    ['a fractional image count', {imageCount: 0.5}],
    ['an image count beyond a 32-bit integer', {imageCount: 2_147_483_648}],
    ['a negative output limit', {outputLimit: -1}],
    ['a fractional output limit', {outputLimit: 1.5}],
    ['an output limit beyond a 32-bit integer', {outputLimit: 2_147_483_648}],
    ['a request count of 0', {requestCount: 0}],
    ['a negative request count', {requestCount: -1}],
    ['a fractional request count', {requestCount: 1.5}],
    ['a request count that is not a number', {requestCount: Number.NaN}],
    ['a request count beyond a 32-bit integer', {requestCount: 2_147_483_648}],
    ['options that are an array', {options: []}],
    ['options that are null', {options: null}],
    ['options that are text', {options: 'cache'}],
    ['options that are a number', {options: 5}],
  ] as [string, Record<string, unknown>][])('refuses %s before asking', async (_label, patch) => {
    const {fetch, options} = fake({});
    await expect(quoteCost(operation, {...calculation, ...patch} as typeof calculation, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an operation that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(quoteCost({accountId: 'not-an-id', epoch: 1}, calculation, options)).rejects.toBeInstanceOf(TypeError);
    await expect(quoteCost({accountId: ACCOUNT, epoch: 0}, calculation, options)).rejects.toBeInstanceOf(TypeError);
    await expect(quoteCost({accountId: ACCOUNT, epoch: 1.5}, calculation, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts the smallest and the largest sizes the database holds', async () => {
    const {sent, options} = fake(quoteFields());
    await quoteCost(operation, {...calculation, requestBytes: 0, imageCount: 0, outputLimit: 0}, options);
    await quoteCost(operation, {...calculation, requestBytes: Number.MAX_SAFE_INTEGER, imageCount: 2_147_483_647, outputLimit: 2_147_483_647, requestCount: 2_147_483_647}, options);
    expect(sent[0].body).toMatchObject({p_request_bytes: 0, p_image_count: 0, p_output_limit: 0});
    expect(sent[1].body).toMatchObject({p_request_bytes: Number.MAX_SAFE_INTEGER, p_image_count: 2_147_483_647, p_output_limit: 2_147_483_647, p_request_count: 2_147_483_647});
  });

  it.each([
    ['a body that is not an object', []],
    ['a body that is text', 'quoted'],
    ['an outcome it does not know', quoteFields({outcome: 'maybe'})],
    ['an outcome of the reservation', quoteFields({outcome: 'reserved'})],
    ['a bound of 0', quoteFields({input_bound: 0})],
    ['a bound above the admission ceiling', quoteFields({input_bound: 200_001, input_units: 200_001})],
    ['no bound', quoteFields({input_bound: null})],
    ['a bound that is not whole', quoteFields({input_bound: 24_200.5})],
    ['billed input units below the bound', quoteFields({input_units: 24_199})],
    ['no billed input units', quoteFields({input_units: null})],
    ['no billed output units', quoteFields({output_units: null})],
    ['negative billed output units', quoteFields({output_units: -1})],
    ['billed output units that are not whole', quoteFields({output_units: 1.5})],
    ['an amount of 0', quoteFields({microdollars: 0})],
    ['a negative amount', quoteFields({microdollars: -5})],
    ['an amount that is not whole', quoteFields({microdollars: 12.5})],
    ['an amount above the largest', quoteFields({microdollars: 1e15 + 2})],
    ['no amount', quoteFields({microdollars: null})],
    ['an amount as text', quoteFields({microdollars: '132600'})],
    ['a reason it does not know', quoteFields({outcome: 'unavailable_bound', reason: 'too_expensive'})],
    ['no reason', quoteFields({outcome: 'unavailable_bound', reason: null})],
    ['an unsupported option with no key', quoteFields({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: null})],
    ['an unsupported option with a key that is not text', quoteFields({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: 5})],
    ['an unsupported option with a key of 101 characters', quoteFields({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: 'k'.repeat(101)})],
    ['another reason that names a key', quoteFields({outcome: 'unavailable_bound', reason: 'overflow', detail: 'cache'})],
  ])('throws an unexpected-shape error for %s, and invents nothing', async (_label, answer) => {
    await expectUnexpected(quoteCost(operation, calculation, fake(answer).options));
  });

  it('says an outcome that may be unknown for a server error, retryable when nothing answered, and never turns a failure into an outcome', async () => {
    const down = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await expect(quoteCost(operation, calculation, {env, fetch: down as unknown as typeof fetch})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    await expect(quoteCost(operation, calculation, fake({code: 'XX000'}, 500).options)).rejects.toMatchObject({status: 500, outcomeUnknown: true});
    await expect(quoteCost(operation, calculation, fake({code: '22023'}, 400).options)).rejects.toMatchObject({status: 400, outcomeUnknown: false});
  });
});

describe('reserveCost', () => {
  const input = {...calculation, commandId: COMMAND, operationId: OPERATION};
  const reserve = (answer: unknown, patch: Record<string, unknown> = {}) => reserveCost(operation, {...input, ...patch} as typeof input, fake(answer).options);
  const reservation = {
    id: RESERVATION,
    operationId: OPERATION,
    jobId: JOB,
    periodId: PERIOD,
    rateScheduleId: SCHEDULE,
    inputBound: 24_200,
    reservedMicrodollars: 132_600,
  };

  it('sends the Account and epoch of the operation, the command, the operation and the calculator\'s arguments, with no options by default, and reads the reservation', async () => {
    const {sent, options} = fake(reservationFields());
    expect(await reserveCost(operation, input, options)).toEqual({outcome: 'reserved', reservation});
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('reserve_cost');
    expect(sent[0].body).toEqual({
      p_account_id: ACCOUNT,
      p_epoch: 3,
      p_command_id: COMMAND,
      p_operation_id: OPERATION,
      ...calculationBody,
      p_options: {},
    });
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('sends the options it was given, and sends no request count (an operation is exactly one provider request)', async () => {
    const {sent, options} = fake(reservationFields());
    await reserveCost(operation, {...input, options: {speed: 'fast'}}, options);
    expect(sent[0].body.p_options).toEqual({speed: 'fast'});
    expect(sent[0].body).not.toHaveProperty('p_request_count');
  });

  it('lower-cases the IDs it sends and reads', async () => {
    const {sent, options} = fake(
      reservationFields({reservation_id: RESERVATION.toUpperCase(), operation_id: OPERATION.toUpperCase(), job_id: JOB.toUpperCase(), period_id: PERIOD.toUpperCase(), rate_schedule_id: SCHEDULE.toUpperCase()}),
    );
    const answer = await reserveCost(
      {accountId: ACCOUNT.toUpperCase(), epoch: 3},
      {...input, commandId: COMMAND.toUpperCase(), operationId: OPERATION.toUpperCase(), rateScheduleId: SCHEDULE.toUpperCase()},
      options,
    );
    expect(sent[0].body).toMatchObject({p_account_id: ACCOUNT, p_command_id: COMMAND, p_operation_id: OPERATION, p_rate_schedule_id: SCHEDULE});
    expect(answer).toEqual({outcome: 'reserved', reservation});
  });

  it('reads a reservation at the operation cap and the input ceiling, and the smallest amount', async () => {
    expect(await reserve(reservationFields({reserved_microdollars: 1_000_000, input_bound: 200_000}))).toMatchObject({outcome: 'reserved', reservation: {reservedMicrodollars: 1_000_000, inputBound: 200_000}});
    expect(await reserve(reservationFields({reserved_microdollars: 1, input_bound: 1}))).toMatchObject({outcome: 'reserved', reservation: {reservedMicrodollars: 1, inputBound: 1}});
  });

  it.each(['replayed', 'already_reserved'])('reads %s as the reservation the operation holds, whatever the constants were when it was made', async (outcome) => {
    expect(await reserve(reservationFields({outcome}))).toEqual({outcome, reservation});
    // A reservation returned again is as it was made: its amount and bound may be above today's cap and ceiling.
    expect(await reserve(reservationFields({outcome, reserved_microdollars: 2_000_000, input_bound: 250_000, rate_schedule_id: OTHER_OPERATION}))).toMatchObject({
      outcome,
      reservation: {reservedMicrodollars: 2_000_000, inputBound: 250_000, rateScheduleId: OTHER_OPERATION},
    });
  });

  it.each(['reused', 'denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await reserve(reservationFields({outcome, reservation_id: null, operation_id: null, job_id: null, period_id: null, rate_schedule_id: null, input_bound: null, reserved_microdollars: null}))).toEqual({
      outcome,
    });
    // Whatever else the answer holds is not read.
    expect(await reserve(reservationFields({outcome}))).toEqual({outcome});
  });

  it.each(operationStates.filter((state) => state !== 'planned'))('reads not_reservable carrying the operation\'s state %s', async (state) => {
    expect(await reserve(reservationFields({outcome: 'not_reservable', state, reservation_id: null}))).toEqual({outcome: 'not_reservable', state});
  });

  describe('the money refusals, each with the exact cost block', () => {
    const allowance = {limit: 25_000_000, used: 5_000_000, available: 20_000_000};

    it.each(unavailableBoundReasons.filter((reason) => reason !== 'unsupported_option'))('reads unavailable_bound for %s, with no requested amount and the Account\'s allowance', async (reason) => {
      const answer = refusalFields('unavailable_bound', {requested: null, ...allowance}, {reason});
      expect(await reserve(answer)).toEqual({outcome: 'unavailable_bound', reason, detail: null, cost: {requested: null, limit: 25_000_000, used: 5_000_000, available: 20_000_000}});
    });

    it('reads unavailable_bound for an unsupported option with the key it names', async () => {
      const answer = refusalFields('unavailable_bound', {requested: null, ...allowance}, {reason: 'unsupported_option', detail: 'batch'});
      expect(await reserve(answer)).toEqual({
        outcome: 'unavailable_bound',
        reason: 'unsupported_option',
        detail: 'batch',
        cost: {requested: null, limit: 25_000_000, used: 5_000_000, available: 20_000_000},
      });
    });

    it('reads provider_blocked with the amount that was asked and the Account\'s allowance', async () => {
      expect(await reserve(refusalFields('provider_blocked', {requested: 132_600, ...allowance}))).toEqual({
        outcome: 'provider_blocked',
        cost: {requested: 132_600, limit: 25_000_000, used: 5_000_000, available: 20_000_000},
      });
    });

    it('reads over_operation_cap against the $1 cap, with nothing used and all of it available', async () => {
      expect(await reserve(refusalFields('over_operation_cap', {requested: 1_200_000, limit: 1_000_000, used: 0, available: 1_000_000}))).toEqual({
        outcome: 'over_operation_cap',
        cost: {requested: 1_200_000, limit: 1_000_000, used: 0, available: 1_000_000},
      });
      expect(await reserve(refusalFields('over_operation_cap', {requested: 1_000_001, limit: 1_000_000, used: 0, available: 1_000_000}))).toMatchObject({outcome: 'over_operation_cap'});
    });

    it('reads over_job_cap against the $5 cap with what the Job already holds, and with a Job over its cap', async () => {
      expect(await reserve(refusalFields('over_job_cap', {requested: 600_000, limit: 5_000_000, used: 4_500_000, available: 500_000}))).toEqual({
        outcome: 'over_job_cap',
        cost: {requested: 600_000, limit: 5_000_000, used: 4_500_000, available: 500_000},
      });
      // Evidence above a reservation can leave a Job over its cap: nothing is available, and any amount is refused.
      expect(await reserve(refusalFields('over_job_cap', {requested: 1, limit: 5_000_000, used: 5_400_000, available: 0}))).toMatchObject({outcome: 'over_job_cap', cost: {used: 5_400_000, available: 0}});
    });

    it('reads insufficient_allowance with the Account\'s limit, what is used and what is left, and an Account over its limit', async () => {
      expect(await reserve(refusalFields('insufficient_allowance', {requested: 600_000, limit: 25_000_000, used: 24_500_000, available: 500_000}))).toEqual({
        outcome: 'insufficient_allowance',
        cost: {requested: 600_000, limit: 25_000_000, used: 24_500_000, available: 500_000},
      });
      expect(await reserve(refusalFields('insufficient_allowance', {requested: 1, limit: 25_000_000, used: 26_000_000, available: 0}))).toMatchObject({
        outcome: 'insufficient_allowance',
        cost: {used: 26_000_000, available: 0},
      });
      // A limit of 0 refuses everything.
      expect(await reserve(refusalFields('insufficient_allowance', {requested: 100, limit: 0, used: 0, available: 0}))).toMatchObject({outcome: 'insufficient_allowance'});
    });

    it('is the same five refusals as the vocabulary names', () => {
      expect(costRefusals).toHaveLength(5);
    });
  });

  it.each([
    ['a body that is not an object', null],
    ['a body that is a list', []],
    ['a body that is text', 'reserved'],
    ['an outcome it does not know', reservationFields({outcome: 'maybe'})],
    ['an outcome of the quote', reservationFields({outcome: 'quoted'})],
    ['an outcome of the settlement', reservationFields({outcome: 'settled'})],
    ['no outcome', {...reservationFields(), outcome: undefined}],
    ['a reservation with no ID', reservationFields({reservation_id: null})],
    ['a reservation whose ID is not an ID', reservationFields({reservation_id: 'nope'})],
    ['a Job that is not an ID', reservationFields({job_id: 'nope'})],
    ['no Job', reservationFields({job_id: null})],
    ['a period that is not an ID', reservationFields({period_id: 7})],
    ['a schedule that is not an ID', reservationFields({rate_schedule_id: 'nope'})],
    ['a reservation for another operation', reservationFields({operation_id: OTHER_OPERATION})],
    ['a replay for another operation', reservationFields({outcome: 'replayed', operation_id: OTHER_OPERATION})],
    ['an earlier reservation for another operation', reservationFields({outcome: 'already_reserved', operation_id: OTHER_OPERATION})],
    ['an input bound of 0', reservationFields({input_bound: 0})],
    ['an input bound that is not whole', reservationFields({input_bound: 100.5})],
    ['no input bound', reservationFields({input_bound: null})],
    ['a reserved amount of 0', reservationFields({reserved_microdollars: 0})],
    ['a negative reserved amount', reservationFields({reserved_microdollars: -1})],
    ['a reserved amount that is not whole', reservationFields({reserved_microdollars: 100.5})],
    ['a reserved amount above the largest', reservationFields({reserved_microdollars: 1e15 + 2})],
    ['no reserved amount', reservationFields({reserved_microdollars: null})],
    ['a reserved amount as text', reservationFields({reserved_microdollars: '132600'})],
    ['a reservation above the operation cap', reservationFields({reserved_microdollars: 1_000_001})],
    ['a reservation above the input ceiling', reservationFields({input_bound: 200_001})],
    ['a reservation that holds a requested amount', reservationFields({requested_microdollars: 132_600})],
    ['a reservation that holds a limit', reservationFields({limit_microdollars: 25_000_000})],
    ['a reservation that holds an amount used', reservationFields({used_microdollars: 0})],
    ['a reservation that holds an amount available', reservationFields({available_microdollars: 0})],
    ['a replay that holds a cost block', reservationFields({outcome: 'replayed', limit_microdollars: 25_000_000})],
    ['an earlier reservation that holds a cost block', reservationFields({outcome: 'already_reserved', available_microdollars: 1})],
    ['not_reservable for a planned operation', reservationFields({outcome: 'not_reservable', state: 'planned'})],
    ['not_reservable with a state it does not know', reservationFields({outcome: 'not_reservable', state: 'charged'})],
    ['not_reservable with no state', reservationFields({outcome: 'not_reservable', state: null})],
  ])('throws an unexpected-shape error for %s, and invents nothing', async (_label, answer) => {
    await expectUnexpected(reserve(answer));
  });

  describe('a cost block that does not agree with its refusal is no answer', () => {
    const allowance = {limit: 25_000_000, used: 5_000_000, available: 20_000_000};
    it.each([
      ['unavailable_bound with a requested amount', refusalFields('unavailable_bound', {requested: 100, ...allowance}, {reason: 'overflow'})],
      ['unavailable_bound with no reason', refusalFields('unavailable_bound', {requested: null, ...allowance})],
      ['unavailable_bound with a reason it does not know', refusalFields('unavailable_bound', {requested: null, ...allowance}, {reason: 'too_expensive'})],
      ['unavailable_bound for an unsupported option with no key', refusalFields('unavailable_bound', {requested: null, ...allowance}, {reason: 'unsupported_option'})],
      ['unavailable_bound for another reason that names a key', refusalFields('unavailable_bound', {requested: null, ...allowance}, {reason: 'unknown_rate', detail: 'cache'})],
      ['unavailable_bound whose available is not what is left of the limit', refusalFields('unavailable_bound', {requested: null, limit: 25_000_000, used: 5_000_000, available: 19_000_000}, {reason: 'overflow'})],
      ['provider_blocked with no requested amount', refusalFields('provider_blocked', {requested: null, ...allowance})],
      ['provider_blocked whose available is not what is left of the limit', refusalFields('provider_blocked', {requested: 100, limit: 25_000_000, used: 5_000_000, available: 1})],
      ['over_operation_cap with another cap', refusalFields('over_operation_cap', {requested: 3_000_000, limit: 2_000_000, used: 0, available: 2_000_000})],
      ['over_operation_cap with something used', refusalFields('over_operation_cap', {requested: 1_200_000, limit: 1_000_000, used: 1, available: 1_000_000})],
      ['over_operation_cap whose available is not the cap', refusalFields('over_operation_cap', {requested: 1_200_000, limit: 1_000_000, used: 0, available: 900_000})],
      ['over_operation_cap for an amount at the cap', refusalFields('over_operation_cap', {requested: 1_000_000, limit: 1_000_000, used: 0, available: 1_000_000})],
      ['over_operation_cap for an amount under the cap', refusalFields('over_operation_cap', {requested: 999_999, limit: 1_000_000, used: 0, available: 1_000_000})],
      ['over_operation_cap with no requested amount', refusalFields('over_operation_cap', {requested: null, limit: 1_000_000, used: 0, available: 1_000_000})],
      ['over_job_cap with another cap', refusalFields('over_job_cap', {requested: 600_000, limit: 6_000_000, used: 5_500_000, available: 500_000})],
      ['over_job_cap whose available is not what is left of the cap', refusalFields('over_job_cap', {requested: 600_000, limit: 5_000_000, used: 4_500_000, available: 400_000})],
      ['over_job_cap for an amount that fits', refusalFields('over_job_cap', {requested: 500_000, limit: 5_000_000, used: 4_500_000, available: 500_000})],
      ['over_job_cap with no requested amount', refusalFields('over_job_cap', {requested: null, limit: 5_000_000, used: 4_500_000, available: 500_000})],
      ['insufficient_allowance for an amount that is available', refusalFields('insufficient_allowance', {requested: 500_000, limit: 25_000_000, used: 24_500_000, available: 500_000})],
      ['insufficient_allowance for an amount under what is available', refusalFields('insufficient_allowance', {requested: 400_000, limit: 25_000_000, used: 24_500_000, available: 500_000})],
      ['insufficient_allowance whose available is not what is left of the limit', refusalFields('insufficient_allowance', {requested: 600_000, limit: 25_000_000, used: 24_500_000, available: 100_000})],
      ['insufficient_allowance with no requested amount', refusalFields('insufficient_allowance', {requested: null, limit: 25_000_000, used: 24_500_000, available: 500_000})],
      ['a refusal with a requested amount of 0', refusalFields('provider_blocked', {requested: 0, ...allowance})],
      ['a refusal with a negative requested amount', refusalFields('provider_blocked', {requested: -1, ...allowance})],
      ['a refusal with a limit that is not whole', refusalFields('provider_blocked', {requested: 100, limit: 25_000_000.5, used: 5_000_000, available: 20_000_000})],
      ['a refusal with no limit', refusalFields('provider_blocked', {requested: 100, limit: null as unknown as number, used: 5_000_000, available: 20_000_000})],
      ['a refusal with an amount used that is negative', refusalFields('provider_blocked', {requested: 100, limit: 25_000_000, used: -1, available: 25_000_000})],
      ['a refusal with an amount used above the largest', refusalFields('provider_blocked', {requested: 100, limit: 25_000_000, used: 1e15 + 2, available: 0})],
      ['a refusal with no amount available', refusalFields('provider_blocked', {requested: 100, limit: 25_000_000, used: 5_000_000, available: undefined as unknown as number})],
    ] as [string, unknown][])('throws an unexpected-shape error for %s', async (_label, answer) => {
      await expectUnexpected(reserve(answer));
    });
  });

  it.each([
    ['a commandId that is not an ID', {commandId: 'nope'}],
    ['an operationId that is not an ID', {operationId: 'nope'}],
    ['a rateScheduleId that is not an ID', {rateScheduleId: ''}],
    ['a provider with a capital', {provider: 'Anthropic'}],
    ['an empty provider', {provider: ''}],
    ['a model with a space', {model: 'claude sonnet'}],
    ['a model of 81 characters', {model: 'm'.repeat(81)}],
    ['an API version with a space', {apiVersion: 'a b'}],
    ['an empty API version', {apiVersion: ''}],
    ['a negative request size', {requestBytes: -1}],
    ['a fractional request size', {requestBytes: 99.5}],
    ['a request size that is not a number', {requestBytes: Number.NaN}],
    ['a request size beyond a safe integer', {requestBytes: 2 ** 53}],
    ['a negative image count', {imageCount: -2}],
    ['a fractional image count', {imageCount: 1.25}],
    ['an image count beyond a 32-bit integer', {imageCount: 2 ** 31}],
    ['a negative output limit', {outputLimit: -1}],
    ['a fractional output limit', {outputLimit: 0.1}],
    ['an output limit beyond a 32-bit integer', {outputLimit: 2 ** 31}],
    ['an output limit as text', {outputLimit: '4000'}],
    ['options that are an array', {options: ['cache']}],
    ['options that are null', {options: null}],
    ['options that are text', {options: '{}'}],
  ] as [string, Record<string, unknown>][])('refuses %s before asking', async (_label, patch) => {
    const {fetch, options} = fake({});
    await expect(reserveCost(operation, {...input, ...patch} as typeof input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an operation that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(reserveCost({accountId: 'not-an-id', epoch: 1}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(reserveCost({accountId: ACCOUNT, epoch: 0}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(reserveCost({accountId: ACCOUNT, epoch: -3}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(reserveCost({accountId: ACCOUNT, epoch: 1.5}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(reserveCost({accountId: ACCOUNT, epoch: Number.MAX_SAFE_INTEGER + 1}, input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says an outcome that may be unknown for a server error, retryable when nothing answered, and never turns a failure into an outcome', async () => {
    const down = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await expect(reserveCost(operation, input, {env, fetch: down as unknown as typeof fetch})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    await expect(reserveCost(operation, input, fake({code: 'XX000'}, 500).options)).rejects.toMatchObject({status: 500, outcomeUnknown: true});
    await expect(reserveCost(operation, input, fake({code: '22023'}, 400).options)).rejects.toMatchObject({status: 400, outcomeUnknown: false});
    await expect(reserveCost(operation, input, fake({code: 'PGRST202'}, 404).options)).rejects.toMatchObject({status: 404, outcomeUnknown: false});
  });
});

describe('settleCost', () => {
  const input = {commandId: COMMAND, operationId: OPERATION, classification: 'evidence' as SettlementClassification, evidence};
  const settle = (answer: unknown, patch: Record<string, unknown> = {}) => settleCost({accountId: ACCOUNT}, {...input, ...patch} as typeof input, fake(answer).options);
  const settlement = {
    id: SETTLEMENT,
    reservationId: RESERVATION,
    operationId: OPERATION,
    periodId: PERIOD,
    classification: 'evidence',
    settledMicrodollars: 150_000,
    releasedMicrodollars: 200_000,
    overMicrodollars: 0,
    incidentId: null,
  };

  it('sends the Account alone, with no epoch, the command, the operation, the class and the evidence, and reads the settlement', async () => {
    const {sent, options} = fake(settlementFields());
    expect(await settleCost({accountId: ACCOUNT}, input, options)).toEqual({outcome: 'settled', settlement});
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('settle_cost');
    expect(sent[0].body).toEqual({
      p_account_id: ACCOUNT,
      p_command_id: COMMAND,
      p_operation_id: OPERATION,
      p_classification: 'evidence',
      p_input_tokens: 21_000,
      p_output_tokens: 3_500,
      p_returned_model: 'claude-sonnet-5-5-20261001',
    });
    expect(sent[0].body).not.toHaveProperty('p_epoch');
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('sends no epoch even when it is given the whole operation, whose epoch it must not use', async () => {
    const {sent, options} = fake(settlementFields());
    await settleCost(operation, input, options);
    expect(sent[0].body).not.toHaveProperty('p_epoch');
    expect(sent[0].body.p_account_id).toBe(ACCOUNT);
  });

  it.each(['deadline', 'noncharge', 'unused'] as const)('sends the class %s with the evidence fields null', async (classification) => {
    const settled = classification === 'deadline' ? 200_000 : 0;
    const {sent, options} = fake(settlementFields({classification, settled_microdollars: settled}));
    expect(await settleCost({accountId: ACCOUNT}, {commandId: COMMAND, operationId: OPERATION, classification}, options)).toMatchObject({outcome: 'settled', settlement: {classification}});
    expect(sent[0].body).toEqual({
      p_account_id: ACCOUNT,
      p_command_id: COMMAND,
      p_operation_id: OPERATION,
      p_classification: classification,
      p_input_tokens: null,
      p_output_tokens: null,
      p_returned_model: null,
    });
    // An explicit null or undefined for the evidence is no evidence.
    const withNull = fake(settlementFields({classification, settled_microdollars: settled}));
    await settleCost({accountId: ACCOUNT}, {commandId: COMMAND, operationId: OPERATION, classification, evidence: null}, withNull.options);
    expect(withNull.sent[0].body.p_input_tokens).toBeNull();
  });

  it('lower-cases the IDs it sends and reads', async () => {
    const {sent, options} = fake(
      settlementFields({settlement_id: SETTLEMENT.toUpperCase(), reservation_id: RESERVATION.toUpperCase(), operation_id: OPERATION.toUpperCase(), period_id: PERIOD.toUpperCase()}),
    );
    const answer = await settleCost({accountId: ACCOUNT.toUpperCase()}, {...input, commandId: COMMAND.toUpperCase(), operationId: OPERATION.toUpperCase()}, options);
    expect(sent[0].body).toMatchObject({p_account_id: ACCOUNT, p_command_id: COMMAND, p_operation_id: OPERATION});
    expect(answer).toEqual({outcome: 'settled', settlement});
  });

  it('reads evidence below the reservation: the unused part is released and nothing is over', async () => {
    expect(await settle(settlementFields({settled_microdollars: 150_000, released_microdollars: 200_000, over_microdollars: 0}))).toEqual({outcome: 'settled', settlement});
  });

  it('reads evidence equal to the reservation: nothing released and nothing over', async () => {
    expect(await settle(settlementFields({settled_microdollars: 200_000, released_microdollars: 200_000, over_microdollars: 0}))).toEqual({
      outcome: 'settled',
      settlement: {...settlement, settledMicrodollars: 200_000, overMicrodollars: 0, incidentId: null},
    });
  });

  it('reads evidence above the reservation: it settles at the evidence, by how much it is over, with the incident it made', async () => {
    expect(await settle(settlementFields({settled_microdollars: 260_000, released_microdollars: 200_000, over_microdollars: 60_000, incident_id: INCIDENT}))).toEqual({
      outcome: 'settled',
      settlement: {...settlement, settledMicrodollars: 260_000, releasedMicrodollars: 200_000, overMicrodollars: 60_000, incidentId: INCIDENT},
    });
  });

  it('reads evidence that costs nothing (a settlement of 0 is a settlement)', async () => {
    expect(await settle(settlementFields({settled_microdollars: 0, released_microdollars: 200_000, over_microdollars: 0}))).toMatchObject({outcome: 'settled', settlement: {settledMicrodollars: 0}});
  });

  it('reads a deadline settlement at exactly the reservation', async () => {
    expect(
      await settle(settlementFields({classification: 'deadline', settled_microdollars: 200_000, released_microdollars: 200_000, over_microdollars: 0}), {classification: 'deadline', evidence: null}),
    ).toEqual({outcome: 'settled', settlement: {...settlement, classification: 'deadline', settledMicrodollars: 200_000}});
  });

  it.each(['noncharge', 'unused'] as const)('reads a %s settlement at 0 with the whole reservation released', async (classification) => {
    expect(await settle(settlementFields({classification, settled_microdollars: 0, released_microdollars: 200_000}), {classification, evidence: null})).toEqual({
      outcome: 'settled',
      settlement: {...settlement, classification, settledMicrodollars: 0, releasedMicrodollars: 200_000},
    });
  });

  it('reads a replay of the same class as the settlement that exists, with its incident', async () => {
    expect(await settle(settlementFields({outcome: 'replayed'}))).toEqual({outcome: 'replayed', settlement});
    expect(await settle(settlementFields({outcome: 'replayed', settled_microdollars: 260_000, over_microdollars: 60_000, incident_id: INCIDENT}))).toMatchObject({
      outcome: 'replayed',
      settlement: {overMicrodollars: 60_000, incidentId: INCIDENT},
    });
  });

  it('reads already_settled as the settlement that exists, which may be of another class than the one asked', async () => {
    expect(await settle(settlementFields({outcome: 'already_settled', classification: 'deadline', settled_microdollars: 200_000}))).toEqual({
      outcome: 'already_settled',
      settlement: {...settlement, classification: 'deadline', settledMicrodollars: 200_000},
    });
    expect(await settle(settlementFields({outcome: 'already_settled', settled_microdollars: 260_000, over_microdollars: 60_000, incident_id: INCIDENT}))).toMatchObject({
      outcome: 'already_settled',
      settlement: {incidentId: INCIDENT},
    });
  });

  it.each(['reused', 'unavailable', 'not_reserved'])('answers %s with nothing else', async (outcome) => {
    expect(await settle(settlementFields({outcome, settlement_id: null, reservation_id: null, operation_id: null, period_id: null, classification: null, settled_microdollars: null}))).toEqual({outcome});
    expect(await settle(settlementFields({outcome}))).toEqual({outcome});
  });

  describe('not_settleable carries the operation\'s state when it does not fit the class', () => {
    for (const classification of settlementClassifications) {
      const unfitting = operationStates.filter((state) => !(settleableStates[classification] as readonly OperationState[]).includes(state));
      it.each(unfitting)(`reads not_settleable for ${classification} when the operation is %s`, async (state) => {
        const asked = classification === 'evidence' ? {classification} : {classification, evidence: null};
        expect(await settle(settlementFields({outcome: 'not_settleable', state}), asked)).toEqual({outcome: 'not_settleable', state});
      });
      it.each([...settleableStates[classification]])(`throws for not_settleable for ${classification} when the operation is %s, which fits`, async (state) => {
        const asked = classification === 'evidence' ? {classification} : {classification, evidence: null};
        await expectUnexpected(settle(settlementFields({outcome: 'not_settleable', state}), asked));
      });
    }
  });

  it('reads not_due for a deadline settlement with the time it is due', async () => {
    expect(await settle(settlementFields({outcome: 'not_due', due_at: dueAt}), {classification: 'deadline', evidence: null})).toEqual({outcome: 'not_due', dueAt});
    expect(await settle(settlementFields({outcome: 'not_due', due_at: '2026-10-21T12:00:00Z'}), {classification: 'deadline', evidence: null})).toEqual({
      outcome: 'not_due',
      dueAt: '2026-10-21T12:00:00Z',
    });
  });

  it('reads invalid_evidence for evidence that prices above the largest amount, naming the overflow', async () => {
    expect(await settle(settlementFields({outcome: 'invalid_evidence', reason: 'overflow'}))).toEqual({outcome: 'invalid_evidence', reason: 'overflow'});
  });

  it.each([
    ['a body that is not an object', null],
    ['a body that is a list', []],
    ['an outcome it does not know', settlementFields({outcome: 'maybe'})],
    ['an outcome of the reservation', settlementFields({outcome: 'reserved'})],
    ['an outcome that is denied (settling has no authority check to refuse)', settlementFields({outcome: 'denied'})],
    ['a settlement with no ID', settlementFields({settlement_id: null})],
    ['a settlement whose ID is not an ID', settlementFields({settlement_id: 'nope'})],
    ['a reservation that is not an ID', settlementFields({reservation_id: 'nope'})],
    ['a period that is not an ID', settlementFields({period_id: null})],
    ['a settlement for another operation', settlementFields({operation_id: OTHER_OPERATION})],
    ['a replay for another operation', settlementFields({outcome: 'replayed', operation_id: OTHER_OPERATION})],
    ['a class it does not know', settlementFields({classification: 'refund'})],
    ['no class', settlementFields({classification: null})],
    ['a settled amount that is not whole', settlementFields({settled_microdollars: 150_000.5, over_microdollars: 0})],
    ['a negative settled amount', settlementFields({settled_microdollars: -1})],
    ['a settled amount above the largest', settlementFields({settled_microdollars: 1e15 + 2, over_microdollars: 1e15 + 2 - 200_000, incident_id: INCIDENT})],
    ['no settled amount', settlementFields({settled_microdollars: null})],
    ['a released amount of 0', settlementFields({released_microdollars: 0, settled_microdollars: 0})],
    ['a released amount that is not whole', settlementFields({released_microdollars: 200_000.25})],
    ['no released amount', settlementFields({released_microdollars: null})],
    ['an over amount that is not what the settlement is above the reservation', settlementFields({settled_microdollars: 150_000, released_microdollars: 200_000, over_microdollars: 10})],
    ['an over amount that is less than what the settlement is above the reservation', settlementFields({settled_microdollars: 260_000, over_microdollars: 50_000, incident_id: INCIDENT})],
    ['an over amount that is negative', settlementFields({over_microdollars: -1})],
    ['no over amount', settlementFields({over_microdollars: null})],
    ['an overrun with no incident', settlementFields({settled_microdollars: 260_000, over_microdollars: 60_000, incident_id: null})],
    ['an incident with no overrun', settlementFields({incident_id: INCIDENT})],
    ['an incident that is not an ID', settlementFields({settled_microdollars: 260_000, over_microdollars: 60_000, incident_id: 'nope'})],
    ['a deadline settled below the reservation', settlementFields({classification: 'deadline', settled_microdollars: 100_000, released_microdollars: 200_000}), {classification: 'deadline', evidence: null}],
    ['a deadline settled above the reservation', settlementFields({classification: 'deadline', settled_microdollars: 300_000, released_microdollars: 200_000, over_microdollars: 100_000, incident_id: INCIDENT}), {classification: 'deadline', evidence: null}],
    ['a noncharge that settled something', settlementFields({classification: 'noncharge', settled_microdollars: 5, released_microdollars: 200_000}), {classification: 'noncharge', evidence: null}],
    ['an unused operation that settled something', settlementFields({classification: 'unused', settled_microdollars: 5, released_microdollars: 200_000}), {classification: 'unused', evidence: null}],
    ['a settlement of another class than the one asked', settlementFields({classification: 'deadline', settled_microdollars: 200_000}), {classification: 'evidence'}],
    ['a replay of another class than the one asked', settlementFields({outcome: 'replayed', classification: 'deadline', settled_microdollars: 200_000})],
    ['not_due for evidence', settlementFields({outcome: 'not_due', due_at: dueAt})],
    ['not_due for a noncharge', settlementFields({outcome: 'not_due', due_at: dueAt}), {classification: 'noncharge', evidence: null}],
    ['not_due with no time', settlementFields({outcome: 'not_due', due_at: null}), {classification: 'deadline', evidence: null}],
    ['not_due with a time that is not one', settlementFields({outcome: 'not_due', due_at: 'tomorrow'}), {classification: 'deadline', evidence: null}],
    ['not_due with a date and no time', settlementFields({outcome: 'not_due', due_at: '2026-10-21'}), {classification: 'deadline', evidence: null}],
    ['not_due with a time of no zone', settlementFields({outcome: 'not_due', due_at: '2026-10-21T12:00:00'}), {classification: 'deadline', evidence: null}],
    ['not_settleable with no state', settlementFields({outcome: 'not_settleable', state: null})],
    ['not_settleable with a state it does not know', settlementFields({outcome: 'not_settleable', state: 'charged'})],
    ['invalid_evidence for a deadline', settlementFields({outcome: 'invalid_evidence', reason: 'overflow'}), {classification: 'deadline', evidence: null}],
    ['invalid_evidence for a noncharge', settlementFields({outcome: 'invalid_evidence', reason: 'overflow'}), {classification: 'noncharge', evidence: null}],
    ['invalid_evidence for another reason', settlementFields({outcome: 'invalid_evidence', reason: 'unpriced'})],
    ['invalid_evidence with no reason', settlementFields({outcome: 'invalid_evidence', reason: null})],
  ] as [string, unknown, Record<string, unknown>?][])('throws an unexpected-shape error for %s, and invents nothing', async (_label, answer, patch = {}) => {
    await expectUnexpected(settle(answer, patch));
  });

  it.each([
    ['a class it does not know', {classification: 'refund'}],
    ['no class', {classification: undefined}],
    ['evidence with no evidence', {evidence: null}],
    ['evidence with the evidence left out', {evidence: undefined}],
    ['evidence given for a deadline', {classification: 'deadline'}],
    ['evidence given for a noncharge', {classification: 'noncharge'}],
    ['evidence given for an unused operation', {classification: 'unused'}],
    ['a negative input token count', {evidence: {...evidence, inputTokens: -1}}],
    ['a fractional input token count', {evidence: {...evidence, inputTokens: 1.5}}],
    ['an input token count that is not a number', {evidence: {...evidence, inputTokens: Number.NaN}}],
    ['an input token count beyond a safe integer', {evidence: {...evidence, inputTokens: Number.MAX_SAFE_INTEGER + 1}}],
    ['an input token count as text', {evidence: {...evidence, inputTokens: '21000'}}],
    ['a negative output token count', {evidence: {...evidence, outputTokens: -1}}],
    ['a fractional output token count', {evidence: {...evidence, outputTokens: 0.5}}],
    ['an infinite output token count', {evidence: {...evidence, outputTokens: Number.POSITIVE_INFINITY}}],
    ['a missing output token count', {evidence: {inputTokens: 1, returnedModel: 'm'}}],
    ['an empty returned model', {evidence: {...evidence, returnedModel: ''}}],
    ['a returned model with a space', {evidence: {...evidence, returnedModel: 'claude sonnet'}}],
    ['a returned model of 201 characters', {evidence: {...evidence, returnedModel: 'm'.repeat(201)}}],
    ['a non-ASCII returned model', {evidence: {...evidence, returnedModel: 'clàude'}}],
    ['a returned model that is not text', {evidence: {...evidence, returnedModel: 5}}],
    ['a command that is not an ID', {commandId: 'nope'}],
    ['an operation that is not an ID', {operationId: 'nope'}],
  ] as [string, Record<string, unknown>][])('refuses %s before asking', async (_label, patch) => {
    const {fetch, options} = fake({});
    await expect(settleCost({accountId: ACCOUNT}, {...input, ...patch} as typeof input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an Account that is not an ID, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(settleCost({accountId: 'not-an-id'}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(settleCost({accountId: ''}, input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts evidence of 0 tokens, the largest safe count and a returned model of 1 and 200 characters', async () => {
    const zero = fake(settlementFields());
    await settleCost({accountId: ACCOUNT}, {...input, evidence: {inputTokens: 0, outputTokens: 0, returnedModel: 'm'}}, zero.options);
    expect(zero.sent[0].body).toMatchObject({p_input_tokens: 0, p_output_tokens: 0, p_returned_model: 'm'});
    const large = fake(settlementFields());
    await settleCost({accountId: ACCOUNT}, {...input, evidence: {inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER, returnedModel: 'M'.repeat(200)}}, large.options);
    expect(large.sent[0].body).toMatchObject({p_input_tokens: Number.MAX_SAFE_INTEGER, p_output_tokens: Number.MAX_SAFE_INTEGER, p_returned_model: 'M'.repeat(200)});
  });

  it('says an outcome that may be unknown for a server error, retryable when nothing answered, and never turns a failure into an outcome', async () => {
    const down = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await expect(settleCost({accountId: ACCOUNT}, input, {env, fetch: down as unknown as typeof fetch})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    await expect(settleCost({accountId: ACCOUNT}, input, fake({code: 'XX000'}, 500).options)).rejects.toMatchObject({status: 500, outcomeUnknown: true});
    await expect(settleCost({accountId: ACCOUNT}, input, fake({code: '22023'}, 400).options)).rejects.toMatchObject({status: 400, outcomeUnknown: false});
  });
});

// What is sent is exactly what was given -----------------------------------------------------------------------------------------------------------

describe('the options and the sizes are checked before anything is asked', () => {
  class Holder {
    cache = true;
  }
  const getter = Object.defineProperty({}, 'cache', {enumerable: true, get: () => true});
  const hidden = Object.defineProperty({}, 'cache', {enumerable: false, value: true});
  const cycle: Record<string, unknown> = {};
  cycle.again = cycle;
  const sparse = new Array(2);
  sparse[0] = 1;
  const symbolKeyed = {[Symbol('cache')]: true};
  const notCarried: [string, unknown][] = [
    ['a Map', new Map([['cache', true]])],
    ['a Set', new Set(['cache'])],
    ['a class instance', new Holder()],
    ['a Date', new Date(0)],
    ['an array', []],
    ['an array with entries', [1]],
    ['null', null],
    ['text', 'cache'],
    ['a number', 5],
    ['a boolean', true],
    ['a function', () => ({})],
    ['an object with the prototype of a class instance', Object.create(new Holder())],
    ['a key whose value is undefined', {cache: undefined}],
    ['a nested value that is undefined', {outer: {inner: undefined}}],
    ['an array entry that is undefined', {list: [1, undefined]}],
    ['a sparse array', {list: sparse}],
    ['a function value', {cache: () => true}],
    ['a symbol value', {cache: Symbol('x')}],
    ['a bigint value', {cache: BigInt(1)}],
    ['a nested bigint', {outer: [{inner: BigInt(1)}]}],
    ['NaN', {cache: Number.NaN}],
    ['Infinity', {cache: Number.POSITIVE_INFINITY}],
    ['negative Infinity', {outer: {cache: Number.NEGATIVE_INFINITY}}],
    ['a symbol key', symbolKeyed],
    ['a getter', getter],
    ['a key that is not enumerable', hidden],
    ['a Map as a value', {cache: new Map()}],
    ['a class instance as a value', {cache: new Holder()}],
    ['a Date as a value', {cache: new Date(0)}],
    ['a cycle', cycle],
  ];

  it.each(notCarried)('refuses options that are %s, before asking, for a quote and for a reservation', async (_label, value) => {
    const quoting = fake({});
    await expect(quoteCost(operation, {...calculation, options: value as Record<string, unknown>}, quoting.options)).rejects.toBeInstanceOf(TypeError);
    expect(quoting.fetch).not.toHaveBeenCalled();
    const reserving = fake({});
    await expect(reserveCost(operation, {...calculation, commandId: COMMAND, operationId: OPERATION, options: value as Record<string, unknown>}, reserving.options)).rejects.toBeInstanceOf(TypeError);
    expect(reserving.fetch).not.toHaveBeenCalled();
  });

  it('says why: an option JSON would drop is not sent as no option at all', async () => {
    const {fetch, options} = fake({});
    await expect(quoteCost(operation, {...calculation, options: {cache: undefined}}, options)).rejects.toThrow(/JSON carries/);
    await expect(quoteCost(operation, {...calculation, options: new Map() as unknown as Record<string, unknown>}, options)).rejects.toThrow(/plain object/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['no options', undefined, {}],
    ['an empty object', {}, {}],
    ['an option of each kind JSON carries', {a: 'text', b: 1.5, c: false, d: null, e: [1, 'two', null, {three: 3}], f: {g: {h: []}}}, {a: 'text', b: 1.5, c: false, d: null, e: [1, 'two', null, {three: 3}], f: {g: {h: []}}}],
    ['an object with no prototype', Object.assign(Object.create(null), {cache: true}), {cache: true}],
    ['an empty key', {'': 1}, {'': 1}],
  ] as [string, Record<string, unknown> | undefined, Record<string, unknown>][])('sends %s exactly as it was given, and leaves refusing an option to the calculator', async (_label, value, sent) => {
    const quoting = fake({});
    await quoteCost(operation, {...calculation, options: value}, quoting.options).catch(() => undefined);
    expect(quoting.sent[0].body.p_options).toEqual(sent);
    const reserving = fake({});
    await reserveCost(operation, {...calculation, commandId: COMMAND, operationId: OPERATION, options: value}, reserving.options).catch(() => undefined);
    expect(reserving.sent[0].body.p_options).toEqual(sent);
  });

  it('names the limit when a size is above it, and says "at least 0" only for a size that is below it or not a whole number', async () => {
    const attempt = (patch: Record<string, unknown>) => quoteCost(operation, {...calculation, ...patch} as typeof calculation, fake({}).options);
    await expect(attempt({imageCount: 2_147_483_648})).rejects.toThrow('imageCount must be at most 2147483647');
    await expect(attempt({outputLimit: 2_147_483_648})).rejects.toThrow('outputLimit must be at most 2147483647');
    await expect(attempt({imageCount: -1})).rejects.toThrow('imageCount must be a whole number of at least 0');
    await expect(attempt({outputLimit: 1.5})).rejects.toThrow('outputLimit must be a whole number of at least 0');
    await expect(attempt({requestBytes: Number.MAX_SAFE_INTEGER + 1})).rejects.toThrow('requestBytes must be a whole number of at least 0');
    await expect(attempt({requestBytes: Number.NaN})).rejects.toThrow('requestBytes must be a whole number of at least 0');
    // The same for the evidence of a settlement (its counts have no limit but the largest safe integer).
    const input = {commandId: COMMAND, operationId: OPERATION, classification: 'evidence' as const};
    await expect(settleCost({accountId: ACCOUNT}, {...input, evidence: {inputTokens: -1, outputTokens: 0, returnedModel: 'm'}}, fake({}).options)).rejects.toThrow('inputTokens must be a whole number of at least 0');
  });
});

describe('the option key a refusal names is counted in characters, as the database counts them', () => {
  const refusal = (detail: unknown) =>
    fake({
      outcome: 'unavailable_bound', reason: 'unsupported_option', detail, input_bound: null, input_units: null, output_units: null, microdollars: null,
    }).options;

  it.each([1, 50, 51, 99, 100])('accepts a key of %s astral characters (each two UTF-16 units)', async (characters) => {
    const key = '\u{1F600}'.repeat(characters);
    expect(key.length).toBe(characters * 2);
    expect(await quoteCost(operation, calculation, refusal(key))).toEqual({outcome: 'unavailable_bound', reason: 'unsupported_option', detail: key});
  });

  it('refuses a key of 101 characters, astral or not', async () => {
    await expectUnexpected(quoteCost(operation, calculation, refusal('\u{1F600}'.repeat(101))));
    await expectUnexpected(quoteCost(operation, calculation, refusal('k'.repeat(101))));
    expect(maxOptionDetail).toBe(100);
  });

  it('reads the same detail in the cost block of a refused reservation', async () => {
    const key = '\u{1F600}'.repeat(60);
    const answer = {
      outcome: 'unavailable_bound', reason: 'unsupported_option', detail: key, reservation_id: null, operation_id: null, job_id: null, period_id: null, rate_schedule_id: null, input_bound: null,
      reserved: null, reserved_microdollars: null, state: null, requested_microdollars: null, limit_microdollars: 25_000_000, used_microdollars: 0, available_microdollars: 25_000_000,
    };
    expect(await reserveCost(operation, {...calculation, commandId: COMMAND, operationId: OPERATION}, fake(answer).options)).toEqual({
      outcome: 'unavailable_bound', reason: 'unsupported_option', detail: key, cost: {requested: null, limit: 25_000_000, used: 0, available: 25_000_000},
    });
  });
});
