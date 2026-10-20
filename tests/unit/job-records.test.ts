import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {
  acceptJob,
  advanceOperation,
  beginStep,
  cancellationReasons,
  chargeableOperationStates,
  failureReasons,
  finishedJobStates,
  fixedStages,
  isChargeable,
  jobReasons,
  jobStates,
  moveAttempt,
  operationMoves,
  operationStates,
  readJob,
  requestRetry,
  storedReasons,
  waitingReasons,
  type OperationState,
} from '@/lib/job-records';

// The typed calls of the Job functions (lib/job-records.ts), against a fake fetch: what each sends (the Account and epoch from the operation, nothing a request
// chose), what each accepts as an answer, and that an answer that cannot be got, or makes no sense, is an error: no state is invented.
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const JOB = 'aa8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6b';
const ATTEMPT = 'bb8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6c';
const ATTEMPT_TWO = 'cc8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6d';
const STEP = 'dd8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6e';
const OPERATION = 'ee8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6f';
const COMMAND = '11111111-2222-4333-8444-555555555555';
const DIGEST = 'a'.repeat(64);
const env = {NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-only'};
const operation = {accountId: ACCOUNT, epoch: 3};
const at = '2026-10-23T12:00:00.123456+00:00';

type Sent = {name: string; body: Record<string, unknown>; headers: Record<string, string>};
function fake(answer: unknown, status = 200) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    sent.push({name: input.split('/rpc/')[1], body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string>});
    return new Response(JSON.stringify(answer), {status, headers: {'content-type': 'application/json'}});
  });
  return {fetch, sent, options: {env, fetch}};
}

/** What the database answers for an attempt command (the composite types of the migration). */
const attemptFields = (patch: Record<string, unknown> = {}) => ({
  job_id: JOB,
  attempt_id: ATTEMPT,
  attempt_number: 1,
  state: 'waiting',
  stage: 'accepted',
  reason: 'awaiting_dispatch',
  ...patch,
});

describe('the vocabularies', () => {
  it('names the five states of an attempt (the public states of a Job), the six reasons it can show, the stored four, and the three stages the records set', () => {
    expect(jobStates).toEqual(['waiting', 'running', 'completed', 'failed', 'cancelled']);
    expect(finishedJobStates).toEqual(['completed', 'failed', 'cancelled']);
    expect(storedReasons).toEqual(['step_failed', 'lease_lost', 'user_cancelled', 'account_disabled']);
    expect(waitingReasons).toEqual(['awaiting_dispatch', 'awaiting_reconciliation']);
    expect(jobReasons).toEqual(['awaiting_dispatch', 'awaiting_reconciliation', 'step_failed', 'lease_lost', 'user_cancelled', 'account_disabled']);
    expect(failureReasons).toEqual(['step_failed', 'lease_lost']);
    expect(cancellationReasons).toEqual(['user_cancelled', 'account_disabled']);
    expect(fixedStages).toEqual(['accepted', 'retry', 'started']);
  });

  it('names the seven states of an operation, and the guarded moves between them', () => {
    expect(operationStates).toEqual(['planned', 'dispatched', 'completed', 'ambiguous', 'noncharge', 'settled', 'abandoned']);
    expect(operationMoves).toEqual({
      planned: ['dispatched', 'abandoned'],
      dispatched: ['completed', 'ambiguous', 'noncharge'],
      ambiguous: ['settled', 'noncharge'],
      completed: [],
      noncharge: [],
      settled: [],
      abandoned: [],
    });
    // Every move lands in a state of the vocabulary, and nothing moves back to planned.
    for (const targets of Object.values(operationMoves)) for (const to of targets) expect(operationStates).toContain(to);
    for (const targets of Object.values(operationMoves)) expect(targets).not.toContain('planned');
  });
});

describe('isChargeable', () => {
  it.each([
    ['planned', false],
    ['dispatched', true],
    ['completed', false],
    ['ambiguous', true],
    ['noncharge', false],
    ['settled', false],
    ['abandoned', false],
  ] as [OperationState, boolean][])('says %s is chargeable: %s', (state, expected) => {
    expect(isChargeable(state)).toBe(expected);
  });

  it('is exactly dispatched and ambiguous, for every state of the vocabulary', () => {
    expect(chargeableOperationStates).toEqual(['dispatched', 'ambiguous']);
    expect(operationStates.filter(isChargeable)).toEqual(['dispatched', 'ambiguous']);
  });

  it('is pure: it reads nothing and calls nothing', () => {
    const { fetch } = fake({});
    expect(isChargeable('dispatched')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('acceptJob', () => {
  const input = {commandId: COMMAND, projectId: PROJECT, kind: 'deep_research', inputDigest: DIGEST};

  it('sends the Account and epoch of the operation and the payload, as the service role, and reads the Job and its first attempt', async () => {
    const {sent, options} = fake({outcome: 'created', ...attemptFields()});
    expect(await acceptJob(operation, input, options)).toEqual({
      outcome: 'created',
      jobId: JOB,
      attempt: {id: ATTEMPT, number: 1, state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch'},
    });
    expect(sent).toEqual([
      expect.objectContaining({
        name: 'accept_job',
        body: {p_account_id: ACCOUNT, p_epoch: 3, p_command_id: COMMAND, p_project_id: PROJECT, p_kind: 'deep_research', p_input_digest: DIGEST},
      }),
    ]);
    expect(sent[0].headers).toMatchObject({authorization: 'Bearer service-key-for-tests-only', 'content-profile': 'api'});
  });

  it('reads a replay as the same Job with attempt 1 as it is now', async () => {
    const replay = await acceptJob(operation, input, fake({outcome: 'replayed', ...attemptFields({state: 'running', stage: 'started', reason: null})}).options);
    expect(replay).toEqual({outcome: 'replayed', jobId: JOB, attempt: {id: ATTEMPT, number: 1, state: 'running', stage: 'started', reason: null}});
  });

  it.each(['reused', 'denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await acceptJob(operation, input, fake({outcome, job_id: null, attempt_id: null}).options)).toEqual({outcome});
  });

  it('lower-cases the IDs it sends and reads', async () => {
    const {sent, options} = fake({outcome: 'created', ...attemptFields({job_id: JOB.toUpperCase(), attempt_id: ATTEMPT.toUpperCase()})});
    const answer = await acceptJob({accountId: ACCOUNT.toUpperCase(), epoch: 3}, {...input, projectId: PROJECT.toUpperCase(), commandId: COMMAND.toUpperCase()}, options);
    expect(sent[0].body).toMatchObject({p_account_id: ACCOUNT, p_project_id: PROJECT, p_command_id: COMMAND});
    expect(answer).toMatchObject({jobId: JOB, attempt: {id: ATTEMPT}});
  });

  it.each([
    ['a kind with a capital', {kind: 'Research'}],
    ['an empty kind', {kind: ''}],
    ['a kind of 41 characters', {kind: 'x'.repeat(41)}],
    ['a kind that starts with a digit', {kind: '1research'}],
    ['a short digest', {inputDigest: 'abc'}],
    ['an upper-case digest', {inputDigest: DIGEST.toUpperCase()}],
    ['a command that is not an ID', {commandId: 'nope'}],
    ['a Project that is not an ID', {projectId: 'nope'}],
  ])('refuses %s before asking', async (_label, patch) => {
    const {fetch, options} = fake({});
    await expect(acceptJob(operation, {...input, ...patch}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses an operation that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(acceptJob({accountId: 'not-an-id', epoch: 1}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(acceptJob({accountId: ACCOUNT, epoch: 0}, input, options)).rejects.toBeInstanceOf(TypeError);
    await expect(acceptJob({accountId: ACCOUNT, epoch: 1.5}, input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not an object', []],
    ['an outcome it does not know', {outcome: 'maybe', ...attemptFields()}],
    ['a Job with no ID', attemptFields({job_id: null, outcome: 'created'})],
    ['an attempt with no ID', attemptFields({attempt_id: 'nope', outcome: 'created'})],
    ['an attempt that is not number 1', attemptFields({attempt_number: 2, outcome: 'created'})],
    ['a number that is not whole', attemptFields({attempt_number: 1.5, outcome: 'created'})],
    ['a created attempt that is not waiting', attemptFields({state: 'running', stage: 'started', reason: null, outcome: 'created'})],
    ['a created attempt at another stage', attemptFields({stage: 'retry', outcome: 'created'})],
    ['a created attempt with another reason', attemptFields({reason: 'awaiting_reconciliation', outcome: 'created'})],
    ['a state it does not know', attemptFields({state: 'paused', outcome: 'created'})],
    ['a stage that is not a word', attemptFields({stage: 'Not A Stage', outcome: 'created'})],
    ['a waiting attempt with a stored reason', attemptFields({reason: 'step_failed', outcome: 'created'})],
    ['a failed attempt with a waiting reason', attemptFields({state: 'failed', reason: 'awaiting_dispatch', outcome: 'replayed'})],
    ['a running attempt with a reason', attemptFields({state: 'running', stage: 'started', reason: 'step_failed', outcome: 'replayed'})],
  ])('throws an unexpected-shape error for %s, and invents nothing', async (_label, answer) => {
    await expect(acceptJob(operation, input, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('throws when the database is unreachable, and says the outcome may be unknown for a server error', async () => {
    const down = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    await expect(acceptJob(operation, input, {env, fetch: down as unknown as typeof fetch})).rejects.toMatchObject({retryable: true, outcomeUnknown: true});
    await expect(acceptJob(operation, input, fake({code: 'XX000'}, 500).options)).rejects.toMatchObject({status: 500, outcomeUnknown: true});
    await expect(acceptJob(operation, input, fake({code: '22023'}, 400).options)).rejects.toMatchObject({status: 400, outcomeUnknown: false});
  });
});

describe('beginStep', () => {
  const input = {commandId: COMMAND, attemptId: ATTEMPT, stepKey: 'search', ordinal: 1};

  it('sends the attempt, the key and the ordinal, and reads the step and its operation', async () => {
    const {sent, options} = fake({outcome: 'created', step_id: STEP, operation_id: OPERATION, attempt_state: 'running'});
    expect(await beginStep(operation, input, options)).toEqual({outcome: 'created', stepId: STEP, operationId: OPERATION, attemptState: 'running'});
    expect(sent[0]).toMatchObject({name: 'begin_step', body: {p_account_id: ACCOUNT, p_epoch: 3, p_command_id: COMMAND, p_attempt_id: ATTEMPT, p_step_key: 'search', p_ordinal: 1}});
  });

  it('sends no ordinal as null and reads a step with no operation', async () => {
    const {sent, options} = fake({outcome: 'replayed', step_id: STEP, operation_id: null, attempt_state: 'failed'});
    expect(await beginStep(operation, {commandId: COMMAND, attemptId: ATTEMPT, stepKey: 'search'}, options)).toEqual({outcome: 'replayed', stepId: STEP, operationId: null, attemptState: 'failed'});
    expect(sent[0].body.p_ordinal).toBeNull();
    const second = fake({outcome: 'replayed', step_id: STEP, operation_id: null, attempt_state: 'running'});
    await beginStep(operation, {commandId: COMMAND, attemptId: ATTEMPT, stepKey: 'search', ordinal: null}, second.options);
    expect(second.sent[0].body.p_ordinal).toBeNull();
  });

  it('reads a replay of what exists whatever the attempt\'s state is', async () => {
    for (const attemptState of jobStates) {
      const answer = await beginStep(operation, input, fake({outcome: 'replayed', step_id: STEP, operation_id: OPERATION, attempt_state: attemptState}).options);
      expect(answer).toEqual({outcome: 'replayed', stepId: STEP, operationId: OPERATION, attemptState});
    }
  });

  it.each(['waiting', 'completed', 'failed', 'cancelled'])('reads not_running carrying the attempt\'s state %s', async (attemptState) => {
    expect(await beginStep(operation, input, fake({outcome: 'not_running', step_id: null, operation_id: null, attempt_state: attemptState}).options)).toEqual({outcome: 'not_running', attemptState});
  });

  it.each(['reused', 'denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await beginStep(operation, input, fake({outcome, step_id: null}).options)).toEqual({outcome});
  });

  it.each([
    ['a key with a capital', {stepKey: 'Search'}],
    ['an empty key', {stepKey: ''}],
    ['a key of 41 characters', {stepKey: 'x'.repeat(41)}],
    ['ordinal 0', {ordinal: 0}],
    ['ordinal 101', {ordinal: 101}],
    ['a fractional ordinal', {ordinal: 1.5}],
    ['a negative ordinal', {ordinal: -1}],
    ['an attempt that is not an ID', {attemptId: 'nope'}],
  ])('refuses %s before asking', async (_label, patch) => {
    const {fetch, options} = fake({});
    await expect(beginStep(operation, {...input, ...patch}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts the ordinals 1 and 100', async () => {
    for (const ordinal of [1, 100]) {
      const {sent, options} = fake({outcome: 'created', step_id: STEP, operation_id: OPERATION, attempt_state: 'running'});
      await beginStep(operation, {...input, ordinal}, options);
      expect(sent[0].body.p_ordinal).toBe(ordinal);
    }
  });

  it.each([
    ['a body that is not an object', 'nope'],
    ['an outcome it does not know', {outcome: 'maybe', step_id: STEP, operation_id: null, attempt_state: 'running'}],
    ['a step with no ID', {outcome: 'created', step_id: null, operation_id: OPERATION, attempt_state: 'running'}],
    ['an operation that was not asked for', {outcome: 'created', step_id: STEP, operation_id: OPERATION, attempt_state: 'running'}, {ordinal: null}],
    ['no operation for an ordinal', {outcome: 'created', step_id: STEP, operation_id: null, attempt_state: 'running'}],
    ['a step created in an attempt that is not running', {outcome: 'created', step_id: STEP, operation_id: OPERATION, attempt_state: 'failed'}],
    ['an attempt state it does not know', {outcome: 'replayed', step_id: STEP, operation_id: OPERATION, attempt_state: 'paused'}],
    ['no attempt state', {outcome: 'replayed', step_id: STEP, operation_id: OPERATION}],
    ['not_running for a running attempt', {outcome: 'not_running', step_id: null, operation_id: null, attempt_state: 'running'}],
  ] as [string, unknown, Record<string, unknown>?][])('throws an unexpected-shape error for %s', async (_label, answer, patch = {}) => {
    await expect(beginStep(operation, {...input, ...patch} as typeof input, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('advanceOperation', () => {
  const input = {commandId: COMMAND, operationId: OPERATION, to: 'dispatched' as OperationState};
  const moved = (patch: Record<string, unknown> = {}) => ({outcome: 'advanced', operation_id: OPERATION, state: 'dispatched', request_id: null, attempt_state: 'running', ...patch});

  it('sends the operation, the state asked for and the request ID, and reads the state it is in', async () => {
    const {sent, options} = fake(moved({state: 'noncharge', request_id: 'req_1'}));
    expect(await advanceOperation(operation, {...input, to: 'noncharge', requestId: 'req_1'}, options)).toEqual({outcome: 'advanced', operationId: OPERATION, state: 'noncharge', requestId: 'req_1'});
    expect(sent[0]).toMatchObject({name: 'advance_operation', body: {p_account_id: ACCOUNT, p_epoch: 3, p_command_id: COMMAND, p_operation_id: OPERATION, p_to: 'noncharge', p_request_id: 'req_1'}});
  });

  it('sends no request ID as null', async () => {
    const {sent, options} = fake(moved());
    expect(await advanceOperation(operation, input, options)).toEqual({outcome: 'advanced', operationId: OPERATION, state: 'dispatched', requestId: null});
    expect(sent[0].body.p_request_id).toBeNull();
  });

  it('reads a replay in the state asked for', async () => {
    expect(await advanceOperation(operation, {...input, to: 'ambiguous'}, fake(moved({outcome: 'replayed', state: 'ambiguous', request_id: 'req_2'})).options)).toEqual({
      outcome: 'replayed',
      operationId: OPERATION,
      state: 'ambiguous',
      requestId: 'req_2',
    });
  });

  it.each([
    ['dispatched', 'ambiguous', null],
    ['dispatched', 'completed', 'req_done'],
    ['dispatched', 'noncharge', 'req_rejected'],
    ['ambiguous', 'settled', null],
    ['ambiguous', 'noncharge', 'req_rejected'],
    ['planned', 'abandoned', null],
  ] as [OperationState, OperationState, string | null][])('reads the replay of a command that moved the operation to %s as the operation is now, %s', async (to, now, requestId) => {
    const {options} = fake(moved({outcome: 'replayed', state: now, request_id: requestId}));
    expect(await advanceOperation(operation, {...input, to}, options)).toEqual({outcome: 'replayed', operationId: OPERATION, state: now, requestId});
  });

  it('still requires a move that was made now to be in the state asked for', async () => {
    await expect(advanceOperation(operation, {...input, to: 'dispatched'}, fake(moved({outcome: 'advanced', state: 'ambiguous'})).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('reads invalid_transition carrying the operation\'s state, and not_running carrying the attempt\'s', async () => {
    for (const state of operationStates) {
      expect(await advanceOperation(operation, {...input, to: 'settled'}, fake(moved({outcome: 'invalid_transition', state})).options)).toEqual({outcome: 'invalid_transition', state});
    }
    for (const attemptState of ['waiting', 'completed', 'failed', 'cancelled']) {
      expect(await advanceOperation(operation, input, fake(moved({outcome: 'not_running', attempt_state: attemptState})).options)).toEqual({outcome: 'not_running', attemptState});
    }
  });

  it.each(['reused', 'denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await advanceOperation(operation, input, fake({outcome, operation_id: null, state: null}).options)).toEqual({outcome});
  });

  it.each([
    ['a state it does not know', {to: 'charged'}],
    ['an empty request ID', {requestId: ''}],
    ['a request ID with a space', {requestId: 'req 1'}],
    ['a request ID with a control character', {requestId: 'req\u0001'}],
    ['a request ID with a non-ASCII character', {requestId: 'rèq'}],
    ['a request ID of 201 characters', {requestId: 'r'.repeat(201)}],
    ['an operation that is not an ID', {operationId: 'nope'}],
  ])('refuses %s before asking', async (_label, patch) => {
    const {fetch, options} = fake({});
    await expect(advanceOperation(operation, {...input, ...patch} as typeof input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a request ID of 1 and of 200 printable characters', async () => {
    for (const requestId of ['r', 'r'.repeat(199) + '~', '!"#$%&\'()*+,-./09:;<=>?@AZ[\\]^_`az{|}~']) {
      const {options} = fake(moved({request_id: requestId}));
      expect(await advanceOperation(operation, {...input, requestId}, options)).toMatchObject({requestId});
    }
  });

  it.each([
    ['a body that is not an object', null],
    ['an outcome it does not know', moved({outcome: 'maybe'})],
    ['a state it does not know', moved({state: 'charged'})],
    ['a move that did not land in the state asked for', moved({state: 'completed'})],
    ['a replay that moved on to a noncharge with no request ID', moved({outcome: 'replayed', state: 'noncharge', request_id: null})],
    ['a replay with a request ID that is not the one given', moved({outcome: 'replayed', state: 'settled', request_id: 'req_other'}), {requestId: 'req_1'}],
    ['a replay in a state it does not know', moved({outcome: 'replayed', state: 'charged'})],
    ['a noncharge with no request ID', moved({state: 'noncharge', request_id: null}), {to: 'noncharge', requestId: 'req_1'}],
    ['a request ID that is not the one given', moved({request_id: 'req_other'}), {requestId: 'req_1'}],
    ['a stored request ID that is not printable', moved({request_id: 'has space'})],
    ['an operation with no ID', moved({operation_id: null})],
    ['not_running for a running attempt', moved({outcome: 'not_running', attempt_state: 'running'})],
    ['not_running for a move that is not a dispatch', moved({outcome: 'not_running', attempt_state: 'failed'}), {to: 'completed'}],
    ['invalid_transition with no state', moved({outcome: 'invalid_transition', state: null})],
  ] as [string, unknown, Record<string, unknown>?][])('throws an unexpected-shape error for %s', async (_label, answer, patch = {}) => {
    await expect(advanceOperation(operation, {...input, ...patch} as typeof input, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('moveAttempt', () => {
  const input = {commandId: COMMAND, attemptId: ATTEMPT, to: 'running' as const};
  const attemptAnswer = (patch: Record<string, unknown> = {}) => ({outcome: 'moved', attempt_id: ATTEMPT, attempt_number: 1, state: 'running', stage: 'started', reason: null, ...patch});

  it('sends the attempt, the state asked for and the reason, and reads the attempt', async () => {
    const {sent, options} = fake(attemptAnswer());
    expect(await moveAttempt(operation, input, options)).toEqual({outcome: 'moved', attempt: {id: ATTEMPT, number: 1, state: 'running', stage: 'started', reason: null}});
    expect(sent[0]).toMatchObject({name: 'move_attempt', body: {p_account_id: ACCOUNT, p_epoch: 3, p_command_id: COMMAND, p_attempt_id: ATTEMPT, p_to: 'running', p_reason: null}});
  });

  it.each([
    ['failed', 'step_failed'],
    ['failed', 'lease_lost'],
    ['cancelled', 'user_cancelled'],
    ['cancelled', 'account_disabled'],
  ] as const)('sends and reads a move to %s with the reason %s', async (to, reason) => {
    const {sent, options} = fake(attemptAnswer({state: to, reason, stage: 'search'}));
    expect(await moveAttempt(operation, {...input, to, reason}, options)).toEqual({outcome: 'moved', attempt: {id: ATTEMPT, number: 1, state: to, stage: 'search', reason}});
    expect(sent[0].body).toMatchObject({p_to: to, p_reason: reason});
  });

  it('reads a completion with no reason', async () => {
    expect(await moveAttempt(operation, {...input, to: 'completed'}, fake(attemptAnswer({state: 'completed', stage: 'synthesis'})).options)).toMatchObject({outcome: 'moved', attempt: {state: 'completed', stage: 'synthesis'}});
  });

  it('reads a replay as the attempt is now, which may have moved on', async () => {
    expect(await moveAttempt(operation, input, fake(attemptAnswer({outcome: 'replayed', state: 'failed', reason: 'lease_lost', stage: 'search'})).options)).toEqual({
      outcome: 'replayed',
      attempt: {id: ATTEMPT, number: 1, state: 'failed', stage: 'search', reason: 'lease_lost'},
    });
  });

  it('reads blocked as waiting for reconciliation, open_operations, and invalid_transition carrying the state', async () => {
    expect(await moveAttempt(operation, input, fake(attemptAnswer({outcome: 'blocked', state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation'})).options)).toEqual({
      outcome: 'blocked',
      reason: 'awaiting_reconciliation',
    });
    expect(await moveAttempt(operation, {...input, to: 'completed'}, fake(attemptAnswer({outcome: 'open_operations'})).options)).toEqual({outcome: 'open_operations'});
    for (const state of jobStates) {
      expect(await moveAttempt(operation, input, fake(attemptAnswer({outcome: 'invalid_transition', state})).options)).toEqual({outcome: 'invalid_transition', state});
    }
  });

  it.each(['reused', 'denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await moveAttempt(operation, input, fake({outcome, attempt_id: null}).options)).toEqual({outcome});
  });

  it.each([
    ['a state it does not know', {to: 'paused'}],
    ['a failure with no reason', {to: 'failed'}],
    ['a failure with a cancellation reason', {to: 'failed', reason: 'user_cancelled'}],
    ['a cancellation with no reason', {to: 'cancelled'}],
    ['a cancellation with a failure reason', {to: 'cancelled', reason: 'step_failed'}],
    ['a start with a reason', {to: 'running', reason: 'step_failed'}],
    ['a completion with a reason', {to: 'completed', reason: 'step_failed'}],
    ['a derived reason as a stored one', {to: 'failed', reason: 'awaiting_reconciliation'}],
    ['an attempt that is not an ID', {attemptId: 'nope'}],
  ])('refuses %s before asking', async (_label, patch) => {
    const {fetch, options} = fake({});
    await expect(moveAttempt(operation, {...input, ...patch} as typeof input, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not an object', 7],
    ['an outcome it does not know', attemptAnswer({outcome: 'maybe'})],
    ['a move that landed in another state than asked', attemptAnswer({state: 'completed'})],
    ['a failure that landed with another reason', attemptAnswer({state: 'failed', reason: 'lease_lost'}), {to: 'failed', reason: 'step_failed'}],
    ['a moved attempt with no number', attemptAnswer({attempt_number: null})],
    ['an attempt with no ID', attemptAnswer({attempt_id: 'nope'})],
    ['a failed attempt with no reason', attemptAnswer({state: 'failed', reason: null}), {to: 'failed', reason: 'step_failed'}],
    ['a running attempt with a reason', attemptAnswer({reason: 'awaiting_dispatch'})],
    ['open_operations for a move that is not a completion', attemptAnswer({outcome: 'open_operations'}), {to: 'failed', reason: 'step_failed'}],
    ['open_operations for a start', attemptAnswer({outcome: 'open_operations'})],
    ['blocked for a move that is not a start', attemptAnswer({outcome: 'blocked', state: 'waiting', reason: 'awaiting_reconciliation'}), {to: 'cancelled', reason: 'user_cancelled'}],
    ['blocked with another reason', attemptAnswer({outcome: 'blocked', state: 'waiting', reason: 'awaiting_dispatch'})],
    ['blocked for an attempt that is not waiting', attemptAnswer({outcome: 'blocked', state: 'running', reason: 'awaiting_reconciliation'})],
    ['invalid_transition with a state it does not know', attemptAnswer({outcome: 'invalid_transition', state: 'paused'})],
  ] as [string, unknown, Record<string, unknown>?][])('throws an unexpected-shape error for %s', async (_label, answer, patch = {}) => {
    await expect(moveAttempt(operation, {...input, ...patch} as typeof input, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('requestRetry', () => {
  const input = {commandId: COMMAND, jobId: JOB, expectedNumber: 1, inputDigest: DIGEST};
  const retried = (patch: Record<string, unknown> = {}) =>
    attemptFields({outcome: 'created', attempt_id: ATTEMPT_TWO, attempt_number: 2, state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation', ...patch});

  it('sends the Job, the number the person saw and the digest, and reads the new attempt with its derived reason', async () => {
    const {sent, options} = fake(retried());
    expect(await requestRetry(operation, input, options)).toEqual({
      outcome: 'created',
      jobId: JOB,
      attempt: {id: ATTEMPT_TWO, number: 2, state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation'},
    });
    expect(sent[0]).toMatchObject({name: 'request_retry', body: {p_account_id: ACCOUNT, p_epoch: 3, p_command_id: COMMAND, p_job_id: JOB, p_expected_number: 1, p_input_digest: DIGEST}});
  });

  it('reads a retry whose earlier charge is reconciled as awaiting_dispatch', async () => {
    expect(await requestRetry(operation, input, fake(retried({reason: 'awaiting_dispatch'})).options)).toMatchObject({attempt: {reason: 'awaiting_dispatch'}});
  });

  it('reads a replay as the new attempt as it is now', async () => {
    expect(await requestRetry(operation, input, fake(retried({outcome: 'replayed', state: 'running', stage: 'started', reason: null})).options)).toEqual({
      outcome: 'replayed',
      jobId: JOB,
      attempt: {id: ATTEMPT_TWO, number: 2, state: 'running', stage: 'started', reason: null},
    });
  });

  it('reads stale carrying the highest number, and not_retryable carrying its state', async () => {
    expect(await requestRetry(operation, input, fake(attemptFields({outcome: 'stale', attempt_number: 3, state: 'failed', reason: 'step_failed', stage: 'search'})).options)).toEqual({outcome: 'stale', number: 3});
    for (const state of ['waiting', 'running', 'completed', 'cancelled']) {
      const reason = state === 'waiting' ? 'awaiting_dispatch' : state === 'cancelled' ? 'user_cancelled' : null;
      expect(await requestRetry(operation, input, fake(attemptFields({outcome: 'not_retryable', attempt_number: 1, state, reason})).options)).toEqual({outcome: 'not_retryable', state});
    }
  });

  it.each(['reused', 'denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await requestRetry(operation, input, fake({outcome, attempt_id: null}).options)).toEqual({outcome});
  });

  it.each([
    ['a number that is not whole', {expectedNumber: 1.5}],
    ['number 0', {expectedNumber: 0}],
    ['a negative number', {expectedNumber: -2}],
    ['a short digest', {inputDigest: 'abc'}],
    ['an upper-case digest', {inputDigest: DIGEST.toUpperCase()}],
    ['a Job that is not an ID', {jobId: 'nope'}],
  ])('refuses %s before asking', async (_label, patch) => {
    const {fetch, options} = fake({});
    await expect(requestRetry(operation, {...input, ...patch}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not an object', 'x'],
    ['an outcome it does not know', retried({outcome: 'maybe'})],
    ['an attempt that does not follow the one the person saw', retried({attempt_number: 3})],
    ['a created attempt that is not waiting', retried({state: 'running', stage: 'started', reason: null})],
    ['a created attempt at another stage', retried({stage: 'accepted'})],
    ['a created attempt with no reason', retried({reason: null})],
    ['a created attempt with a stored reason', retried({reason: 'step_failed'})],
    ['stale for the number the person saw', attemptFields({outcome: 'stale', attempt_number: 1})],
    ['stale with no number', attemptFields({outcome: 'stale', attempt_number: null})],
    ['not_retryable for a failed attempt', attemptFields({outcome: 'not_retryable', attempt_number: 1, state: 'failed', reason: 'step_failed'})],
    ['not_retryable for an attempt the person did not see', attemptFields({outcome: 'not_retryable', attempt_number: 4})],
    ['a Job with no ID', retried({job_id: null})],
  ])('throws an unexpected-shape error for %s', async (_label, answer) => {
    await expect(requestRetry(operation, input, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});

describe('readJob', () => {
  const attemptRecord = (patch: Record<string, unknown> = {}) => ({
    id: ATTEMPT,
    number: 1,
    state: 'failed',
    stage: 'search',
    reason: 'step_failed',
    created_at: at,
    started_at: at,
    ended_at: at,
    chargeable_operations: 1,
    ...patch,
  });
  const second = (patch: Record<string, unknown> = {}) =>
    attemptRecord({id: ATTEMPT_TWO, number: 2, state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation', started_at: null, ended_at: null, chargeable_operations: 0, ...patch});
  const job = (patch: Record<string, unknown> = {}) => ({
    outcome: 'found',
    job_id: JOB,
    project_id: PROJECT,
    kind: 'research',
    created_at: at,
    state: 'waiting',
    stage: 'retry',
    reason: 'awaiting_reconciliation',
    can_retry: false,
    attempts: [attemptRecord(), second()],
    ...patch,
  });

  it('sends the Account, epoch and Job and no command ID, and reads the Job, its public state and its attempts in order', async () => {
    const {sent, options} = fake(job());
    const read = await readJob(operation, {jobId: JOB}, options);
    expect(read).toEqual({
      outcome: 'found',
      job: {
        id: JOB,
        projectId: PROJECT,
        kind: 'research',
        createdAt: at,
        state: 'waiting',
        stage: 'retry',
        reason: 'awaiting_reconciliation',
        canRetry: false,
        attempts: [
          {id: ATTEMPT, number: 1, state: 'failed', stage: 'search', reason: 'step_failed', createdAt: at, startedAt: at, endedAt: at, chargeableOperations: 1},
          {id: ATTEMPT_TWO, number: 2, state: 'waiting', stage: 'retry', reason: 'awaiting_reconciliation', createdAt: at, startedAt: null, endedAt: null, chargeableOperations: 0},
        ],
      },
    });
    expect(sent).toEqual([expect.objectContaining({name: 'read_job', body: {p_account_id: ACCOUNT, p_epoch: 3, p_job_id: JOB}})]);
  });

  it('reads a failed Job as one that can be retried, and a cancelled one before it started', async () => {
    const failed = await readJob(operation, {jobId: JOB}, fake(job({state: 'failed', stage: 'search', reason: 'step_failed', can_retry: true, attempts: [attemptRecord()]})).options);
    expect(failed).toMatchObject({job: {state: 'failed', canRetry: true}});
    const cancelled = await readJob(
      operation,
      {jobId: JOB},
      fake(job({state: 'cancelled', stage: 'accepted', reason: 'user_cancelled', attempts: [attemptRecord({state: 'cancelled', stage: 'accepted', reason: 'user_cancelled', started_at: null, chargeable_operations: 0})]})).options,
    );
    expect(cancelled).toMatchObject({job: {state: 'cancelled', attempts: [{startedAt: null, endedAt: at}]}});
  });

  it.each(['denied', 'unavailable'])('answers %s with nothing else', async (outcome) => {
    expect(await readJob(operation, {jobId: JOB}, fake({outcome, job_id: null, attempts: null}).options)).toEqual({outcome});
  });

  it('refuses a Job that is not an ID, and an operation that is not shaped like one, before asking', async () => {
    const {fetch, options} = fake({});
    await expect(readJob(operation, {jobId: 'nope'}, options)).rejects.toBeInstanceOf(TypeError);
    await expect(readJob({accountId: ACCOUNT, epoch: 0}, {jobId: JOB}, options)).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a body that is not an object', []],
    ['an outcome it does not know', job({outcome: 'maybe'})],
    ['no attempts', job({attempts: []})],
    ['attempts that are not a list', job({attempts: {}})],
    ['an attempt that is not an object', job({attempts: [attemptRecord(), 'x']})],
    ['attempts out of order', job({attempts: [second(), attemptRecord()]})],
    ['attempts that do not start from 1', job({attempts: [second()]})],
    ['an open attempt before the last', job({attempts: [attemptRecord({state: 'running', stage: 'started', reason: null, ended_at: null}), second()]})],
    ['a state of the Job that is not its highest attempt\'s', job({state: 'failed', stage: 'retry', reason: 'step_failed'})],
    ['a stage of the Job that is not its highest attempt\'s', job({stage: 'search'})],
    ['a reason of the Job that is not its highest attempt\'s', job({reason: 'awaiting_dispatch'})],
    ['can_retry on a Job that has not failed', job({can_retry: true})],
    ['no can_retry on a Job that has failed', job({state: 'failed', stage: 'search', reason: 'step_failed', can_retry: false, attempts: [attemptRecord()]})],
    ['can_retry as text', job({can_retry: 'false'})],
    ['a waiting attempt with a stored reason', job({reason: 'step_failed', attempts: [attemptRecord(), second({reason: 'step_failed'})]})],
    ['a Job with no ID', job({job_id: null})],
    ['a Job of a Project with no ID', job({project_id: 'nope'})],
    ['a kind that is not a word', job({kind: 'Not A Kind'})],
    ['a time that is not a time', job({created_at: 'yesterday'})],
    ['an attempt with a time that is not a time', job({attempts: [attemptRecord({created_at: 'later'}), second()]})],
    ['a finished attempt with no end', job({attempts: [attemptRecord({ended_at: null}), second()]})],
    ['a waiting attempt with a start', job({attempts: [attemptRecord(), second({started_at: at})]})],
    ['a running attempt with no start', job({state: 'running', stage: 'started', reason: null, attempts: [attemptRecord({state: 'running', stage: 'started', reason: null, started_at: null, ended_at: null})]})],
    ['a count of chargeable operations that is negative', job({attempts: [attemptRecord({chargeable_operations: -1}), second()]})],
    ['a count of chargeable operations that is not whole', job({attempts: [attemptRecord({chargeable_operations: 1.5}), second()]})],
    ['no count of chargeable operations', job({attempts: [attemptRecord({chargeable_operations: undefined}), second()]})],
  ])('throws an unexpected-shape error for %s, and shows no state the records do not hold', async (_label, answer) => {
    await expect(readJob(operation, {jobId: JOB}, fake(answer).options)).rejects.toBeInstanceOf(AccountsUnavailableError);
  });
});
