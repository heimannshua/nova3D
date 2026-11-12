import {beforeEach, describe, expect, it, vi} from 'vitest';

// Story 2.8: the two halves of an external operation around the one provider request. lib/job-commands.ts is faked (the database is not here); what is pinned is which database call
// each adapter answer makes, with what, and what the helper reports back.
const mocks = vi.hoisted(() => ({runStep: vi.fn(), finishOperation: vi.fn()}));
vi.mock('@/lib/job-commands', () => ({runStep: mocks.runStep, finishOperation: mocks.finishOperation}));

import {markDispatchedFor, reportOutcome} from '@/lib/operation-outcome';
import type {AdapterResult} from '@/lib/providers/adapters';
import {AccountsUnavailableError} from '@/lib/accounts';

const ATTEMPT = '6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const FENCE = 'fence-token-0123456789';
const OPERATION = '22222222-2222-4222-8222-222222222222';
const RESERVATION = '11111111-1111-4111-8111-111111111111';
const site = {attemptId: ATTEMPT, fence: FENCE, stepKey: 'research', ordinal: 2};
const reportSite = {attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION};
const identity = {provider: 'brave' as const, operationId: OPERATION, reservationId: RESERVATION};
const finished = (state: string, settlement: unknown = {settledMicrodollars: 300, releasedMicrodollars: 700, overMicrodollars: 0}) => ({outcome: 'finished', operationId: OPERATION, state, settlement});

beforeEach(() => {
  mocks.runStep.mockReset();
  mocks.finishOperation.mockReset();
});

describe('markDispatchedFor (the adapters\' markDispatched)', () => {
  it('is true only for a newly stepped operation with a matching identity, and calls run_step under the attempt, fence, step and ordinal', async () => {
    const accounts = {fetch: vi.fn() as unknown as typeof fetch};
    for (const outcome of ['stepped', 'replayed']) {
      mocks.runStep.mockReset();
      mocks.runStep.mockResolvedValue({outcome, stepId: 's', operationId: OPERATION, operationState: 'dispatched'});
      expect(await markDispatchedFor(site, accounts)(identity)).toBe(outcome === 'stepped');
      expect(mocks.runStep).toHaveBeenCalledTimes(1);
      expect(mocks.runStep).toHaveBeenCalledWith({attemptId: ATTEMPT, fence: FENCE, stepKey: 'research', ordinal: 2}, accounts);
    }
  });

  it('is true only when the database answered about the operation the adapter named', async () => {
    const OTHER = '33333333-3333-4333-8333-333333333333';
    mocks.runStep.mockResolvedValue({outcome: 'stepped', stepId: 's', operationId: OTHER, operationState: 'dispatched'});
    // The site's step and ordinal lead to ANOTHER operation: this one has no committed identity, so nothing may be sent.
    expect(await markDispatchedFor(site)(identity)).toBe(false);
    expect(await markDispatchedFor(site)({...identity, operationId: OTHER})).toBe(true);
    mocks.runStep.mockResolvedValue({outcome: 'stepped', stepId: 's', operationId: OPERATION, operationState: 'dispatched'});
    expect(await markDispatchedFor(site)(identity)).toBe(true);
    expect(await markDispatchedFor(site)({...identity, operationId: OTHER})).toBe(false);
    // A step with no operation (no ordinal named an operation) commits no operation's identity either.
    mocks.runStep.mockResolvedValue({outcome: 'stepped', stepId: 's', operationId: null, operationState: null});
    expect(await markDispatchedFor(site)(identity)).toBe(false);
    mocks.runStep.mockResolvedValue({outcome: 'replayed', stepId: 's', operationId: OTHER, operationState: 'dispatched'});
    expect(await markDispatchedFor(site)(identity)).toBe(false);
  });

  it.each(['not_planned', 'fence_mismatch', 'cancelled', 'expired', 'revoked', 'not_running', 'unavailable'])('is false for %s', async (outcome) => {
    mocks.runStep.mockResolvedValue({outcome});
    expect(await markDispatchedFor(site)(identity)).toBe(false);
    expect(mocks.runStep).toHaveBeenCalledTimes(1);
  });

  it('is false (never a throw) when the database call throws: not knowing is not committed', async () => {
    mocks.runStep.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(await markDispatchedFor(site)(identity)).toBe(false);
    mocks.runStep.mockRejectedValue(new TypeError('ordinal must be a whole number from 1 to 100'));
    expect(await markDispatchedFor({...site, ordinal: 0})(identity)).toBe(false);
    mocks.runStep.mockRejectedValue('not even an error');
    expect(await markDispatchedFor(site)(identity)).toBe(false);
  });

  it('calls nothing until the adapter asks, and asks the database once per call', async () => {
    mocks.runStep.mockResolvedValue({outcome: 'stepped', stepId: 's', operationId: OPERATION, operationState: 'dispatched'});
    const mark = markDispatchedFor(site);
    expect(mocks.runStep).not.toHaveBeenCalled();
    await mark(identity);
    expect(mocks.runStep).toHaveBeenCalledTimes(1);
  });

  it('never reports anything and never finishes the operation', async () => {
    mocks.runStep.mockResolvedValue({outcome: 'stepped', stepId: 's', operationId: OPERATION, operationState: 'dispatched'});
    await markDispatchedFor(site)(identity);
    expect(mocks.finishOperation).not.toHaveBeenCalled();
  });
});

describe('reportOutcome', () => {
  describe('completed', () => {
    const completed: AdapterResult<unknown> = {outcome: 'completed', value: {big: 'body'}, requestId: 'req_1', returnedModel: 'claude-sonnet-5-5', inputTokens: 1200, outputTokens: 300};

    it('reports completed with the usage (and not the body or the request id) and returns the database answer', async () => {
      const answer = finished('completed');
      mocks.finishOperation.mockResolvedValue(answer);
      expect(await reportOutcome(reportSite, completed)).toEqual({reported: 'completed', finish: answer, downgraded: false});
      expect(mocks.finishOperation).toHaveBeenCalledTimes(1);
      expect(mocks.finishOperation).toHaveBeenCalledWith(
        {attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'completed', usage: {inputTokens: 1200, outputTokens: 300, returnedModel: 'claude-sonnet-5-5'}},
        {},
      );
    });

    it('passes the accounts options through', async () => {
      const accounts = {fetch: vi.fn() as unknown as typeof fetch};
      mocks.finishOperation.mockResolvedValue(finished('completed'));
      await reportOutcome(reportSite, completed, accounts);
      expect(mocks.finishOperation.mock.calls[0][1]).toBe(accounts);
    });

    it.each(['invalid_evidence', 'overflow', 'already_settled'])('downgrades a completed report the database refused with %s to ambiguous, keeping the request id', async (refusal) => {
      const second = finished('ambiguous', null);
      mocks.finishOperation.mockResolvedValueOnce({outcome: refusal}).mockResolvedValueOnce(second);
      expect(await reportOutcome(reportSite, completed)).toEqual({reported: 'ambiguous', finish: second, downgraded: true});
      expect(mocks.finishOperation).toHaveBeenCalledTimes(2);
      expect(mocks.finishOperation.mock.calls[0][0]).toMatchObject({outcome: 'completed'});
      expect(mocks.finishOperation.mock.calls[1][0]).toEqual({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'ambiguous', requestId: 'req_1'});
    });

    it('downgrades with a null request id when the provider sent none', async () => {
      mocks.finishOperation.mockResolvedValueOnce({outcome: 'invalid_evidence'}).mockResolvedValueOnce(finished('ambiguous', null));
      await reportOutcome(reportSite, {...completed, requestId: null});
      expect(mocks.finishOperation.mock.calls[1][0]).toMatchObject({outcome: 'ambiguous', requestId: null});
    });

    it.each(['fence_mismatch', 'cancelled', 'expired', 'revoked', 'not_running', 'unavailable', 'not_found', 'not_dispatched', 'invalid_transition'])(
      'does not downgrade a %s: it stands as the database answered it (one call)',
      async (refusal) => {
        mocks.finishOperation.mockResolvedValue({outcome: refusal});
        expect(await reportOutcome(reportSite, completed)).toEqual({reported: 'completed', finish: {outcome: refusal}, downgraded: false});
        expect(mocks.finishOperation).toHaveBeenCalledTimes(1);
      },
    );

    it('lets a throw of the database layer through, after the first call only (the caller sends the same report again)', async () => {
      const error = new AccountsUnavailableError('The accounts database answered with an unexpected shape.', {status: 200, retryable: false, outcomeUnknown: true});
      mocks.finishOperation.mockRejectedValue(error);
      await expect(reportOutcome(reportSite, completed)).rejects.toBe(error);
      expect(mocks.finishOperation).toHaveBeenCalledTimes(1);
    });

    it('lets a throw of the downgrading call through', async () => {
      const error = new AccountsUnavailableError('The accounts database did not answer.', {retryable: true});
      mocks.finishOperation.mockResolvedValueOnce({outcome: 'overflow'}).mockRejectedValueOnce(error);
      await expect(reportOutcome(reportSite, completed)).rejects.toBe(error);
    });
  });

  describe('noncharge', () => {
    const noncharge: AdapterResult<unknown> = {outcome: 'noncharge', requestId: 'req_422', status: 422};

    it('reports noncharge with the provider\'s request id (and not the status)', async () => {
      const answer = finished('noncharge', {settledMicrodollars: 0, releasedMicrodollars: 1000, overMicrodollars: 0});
      mocks.finishOperation.mockResolvedValue(answer);
      expect(await reportOutcome(reportSite, noncharge)).toEqual({reported: 'noncharge', finish: answer, downgraded: false});
      expect(mocks.finishOperation).toHaveBeenCalledTimes(1);
      expect(mocks.finishOperation).toHaveBeenCalledWith({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'noncharge', requestId: 'req_422'}, {});
    });

    it.each(['invalid_evidence', 'overflow', 'already_settled'])('downgrades a noncharge report the database refused with %s to ambiguous, keeping the request id', async (refusal) => {
      const second = finished('ambiguous', null);
      mocks.finishOperation.mockResolvedValueOnce({outcome: refusal}).mockResolvedValueOnce(second);
      expect(await reportOutcome(reportSite, noncharge)).toEqual({reported: 'ambiguous', finish: second, downgraded: true});
      expect(mocks.finishOperation.mock.calls[1][0]).toEqual({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'ambiguous', requestId: 'req_422'});
    });

    it.each(['fence_mismatch', 'cancelled', 'not_running', 'invalid_transition'])('does not downgrade a %s', async (refusal) => {
      mocks.finishOperation.mockResolvedValue({outcome: refusal});
      expect(await reportOutcome(reportSite, noncharge)).toEqual({reported: 'noncharge', finish: {outcome: refusal}, downgraded: false});
      expect(mocks.finishOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe('ambiguous', () => {
    it('reports ambiguous with the provider\'s request id and never downgrades or repeats', async () => {
      const answer = finished('ambiguous', null);
      mocks.finishOperation.mockResolvedValue(answer);
      expect(await reportOutcome(reportSite, {outcome: 'ambiguous', reason: 'provider_error', requestId: 'req_503'})).toEqual({reported: 'ambiguous', finish: answer, downgraded: false});
      expect(mocks.finishOperation).toHaveBeenCalledTimes(1);
      expect(mocks.finishOperation).toHaveBeenCalledWith({attemptId: ATTEMPT, fence: FENCE, operationId: OPERATION, outcome: 'ambiguous', requestId: 'req_503'}, {});
    });

    it.each(['transport', 'timeout', 'aborted', 'no_usage', 'no_request_id'] as const)('reports an ambiguous %s without a request id as null', async (reason) => {
      mocks.finishOperation.mockResolvedValue(finished('ambiguous', null));
      await reportOutcome(reportSite, {outcome: 'ambiguous', reason, requestId: null});
      expect(mocks.finishOperation.mock.calls[0][0]).toMatchObject({outcome: 'ambiguous', requestId: null});
    });

    it.each(['invalid_evidence', 'overflow', 'already_settled', 'fence_mismatch', 'not_dispatched', 'invalid_transition'])(
      'returns a refused ambiguous report (%s) as the database answered it, with one call and no downgrade',
      async (refusal) => {
        mocks.finishOperation.mockResolvedValue({outcome: refusal});
        expect(await reportOutcome(reportSite, {outcome: 'ambiguous', reason: 'timeout', requestId: null})).toEqual({reported: 'ambiguous', finish: {outcome: refusal}, downgraded: false});
        expect(mocks.finishOperation).toHaveBeenCalledTimes(1);
      },
    );

    it('lets a throw of the database layer through', async () => {
      const error = new AccountsUnavailableError('The accounts database did not answer.', {retryable: true});
      mocks.finishOperation.mockRejectedValue(error);
      await expect(reportOutcome(reportSite, {outcome: 'ambiguous', reason: 'transport', requestId: null})).rejects.toBe(error);
    });
  });

  describe('nothing went out', () => {
    it.each<AdapterResult<unknown>>([
      {outcome: 'disabled', reason: 'free_only'},
      {outcome: 'disabled', reason: 'credential_missing'},
      {outcome: 'rejected', reason: 'not_admitted'},
      {outcome: 'rejected', reason: 'not_dispatched'},
    ])('reports none for %j and calls nothing', async (result) => {
      expect(await reportOutcome(reportSite, result)).toEqual({reported: 'none'});
      expect(mocks.finishOperation).not.toHaveBeenCalled();
      expect(mocks.runStep).not.toHaveBeenCalled();
    });
  });

  it('makes no request of any kind to a provider', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mocks.finishOperation.mockResolvedValueOnce({outcome: 'invalid_evidence'}).mockResolvedValueOnce(finished('ambiguous', null));
    await reportOutcome(reportSite, {outcome: 'completed', value: null, requestId: 'r', returnedModel: 'other-model', inputTokens: 1, outputTokens: 1});
    mocks.runStep.mockResolvedValue({outcome: 'stepped', stepId: 's', operationId: OPERATION, operationState: 'dispatched'});
    await markDispatchedFor(site)(identity);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
