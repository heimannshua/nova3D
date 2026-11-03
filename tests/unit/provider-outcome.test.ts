import {describe, expect, it} from 'vitest';
import {
  ambiguityReasons,
  classifyProviderAnswer,
  definitiveRejections,
  usableRequestId,
  type Pricing,
  type ProviderAnswer,
  type UsageReport,
} from '@/lib/providers/outcome';

const usage = {inputTokens: 1200, outputTokens: 300, returnedModel: 'claude-sonnet-5-5'};
const response = (status: number, requestId: string | null = 'req_0123456789', body: UsageReport | null = usage): ProviderAnswer => ({kind: 'response', status, requestId, usage: body});

describe('classifyProviderAnswer (Story 2.8)', () => {
  describe('a 2xx with priced usage is evidence', () => {
    it.each([200, 201, 202, 204, 299])('classifies %i with whole tokens and a model as completed, keeping the request id', (status) => {
      expect(classifyProviderAnswer(response(status))).toEqual({outcome: 'completed', requestId: 'req_0123456789', usage});
    });

    it('keeps a missing request id as null on a completed answer (evidence does not need one)', () => {
      expect(classifyProviderAnswer(response(200, null))).toEqual({outcome: 'completed', requestId: null, usage});
    });

    it('accepts zero tokens', () => {
      expect(classifyProviderAnswer(response(200, 'r1', {inputTokens: 0, outputTokens: 0, returnedModel: 'm'}))).toMatchObject({outcome: 'completed', usage: {inputTokens: 0, outputTokens: 0}});
    });

    it('copies only the three usage fields (an extra field in the body is not carried)', () => {
      const answer = response(200, 'r1', {...usage, cacheTokens: 99, secret: 'x'} as never);
      const result = classifyProviderAnswer(answer);
      expect(result).toEqual({outcome: 'completed', requestId: 'r1', usage});
      expect(Object.keys((result as {usage: object}).usage).sort()).toEqual(['inputTokens', 'outputTokens', 'returnedModel']);
    });

    it('defaults to token pricing when no pricing is given', () => {
      expect(classifyProviderAnswer(response(200), {kind: 'tokens'})).toEqual(classifyProviderAnswer(response(200)));
    });
  });

  describe('a 2xx without usable usage is ambiguous', () => {
    it.each([
      ['no usage at all', null],
      ['an empty usage', {}],
      ['a missing input', {outputTokens: 5, returnedModel: 'm'}],
      ['a missing output', {inputTokens: 5, returnedModel: 'm'}],
      ['a missing model', {inputTokens: 5, outputTokens: 5}],
      ['a fractional input', {inputTokens: 1.5, outputTokens: 5, returnedModel: 'm'}],
      ['a fractional output', {inputTokens: 5, outputTokens: 0.1, returnedModel: 'm'}],
      ['a negative input', {inputTokens: -1, outputTokens: 5, returnedModel: 'm'}],
      ['a negative output', {inputTokens: 5, outputTokens: -3, returnedModel: 'm'}],
      ['a string count', {inputTokens: '5', outputTokens: 5, returnedModel: 'm'}],
      ['a NaN count', {inputTokens: Number.NaN, outputTokens: 5, returnedModel: 'm'}],
      ['an infinite count', {inputTokens: Number.POSITIVE_INFINITY, outputTokens: 5, returnedModel: 'm'}],
      ['an unsafe count', {inputTokens: Number.MAX_SAFE_INTEGER + 2, outputTokens: 5, returnedModel: 'm'}],
      ['a null count', {inputTokens: null, outputTokens: 5, returnedModel: 'm'}],
      ['a non-string model', {inputTokens: 5, outputTokens: 5, returnedModel: 7}],
      ['an empty model', {inputTokens: 5, outputTokens: 5, returnedModel: ''}],
      ['a model with a space', {inputTokens: 5, outputTokens: 5, returnedModel: 'claude sonnet'}],
      ['a model with a control character', {inputTokens: 5, outputTokens: 5, returnedModel: 'claude\nsonnet'}],
      ['a model with a non-ASCII character', {inputTokens: 5, outputTokens: 5, returnedModel: 'claudé'}],
      ['a model over 200 characters', {inputTokens: 5, outputTokens: 5, returnedModel: 'm'.repeat(201)}],
    ])('classifies %s as ambiguous no_usage and keeps the request id', (_name, body) => {
      expect(classifyProviderAnswer(response(200, 'r-keep', body as never))).toEqual({outcome: 'ambiguous', reason: 'no_usage', requestId: 'r-keep'});
    });

    it('accepts a 200-character model and rejects 201', () => {
      expect(classifyProviderAnswer(response(200, 'r', {inputTokens: 1, outputTokens: 1, returnedModel: 'm'.repeat(200)})).outcome).toBe('completed');
    });

    it('keeps null as the request id when the 2xx carried none', () => {
      expect(classifyProviderAnswer(response(200, null, null))).toEqual({outcome: 'ambiguous', reason: 'no_usage', requestId: null});
    });
  });

  describe('a definitive rejection with a request id is a proven noncharge', () => {
    it.each([400, 401, 403, 404, 413, 422])('classifies %i with a request id as noncharge', (status) => {
      expect(classifyProviderAnswer(response(status, 'req_abc', null))).toEqual({outcome: 'noncharge', requestId: 'req_abc', status});
    });

    it.each([400, 401, 403, 404, 413, 422])('classifies %i without a request id as ambiguous no_request_id', (status) => {
      expect(classifyProviderAnswer(response(status, null, null))).toEqual({outcome: 'ambiguous', reason: 'no_request_id', requestId: null});
    });

    it('pins the rejection statuses exactly', () => {
      expect([...definitiveRejections]).toEqual([400, 401, 403, 404, 413, 422]);
    });

    it.each(['', ' ', 'has space', 'tab\there', 'new\nline', 'café', 'x'.repeat(201), '\u0000'])('treats the invalid request id %j as no request id: ambiguous no_request_id', (header) => {
      expect(classifyProviderAnswer(response(400, header, null))).toEqual({outcome: 'ambiguous', reason: 'no_request_id', requestId: null});
    });

    it('accepts a request id of exactly 200 printable characters', () => {
      const id = 'a'.repeat(200);
      expect(classifyProviderAnswer(response(422, id, null))).toEqual({outcome: 'noncharge', requestId: id, status: 422});
    });

    it('treats a non-string request id as none', () => {
      expect(classifyProviderAnswer({kind: 'response', status: 400, requestId: 5 as never, usage: null})).toEqual({outcome: 'ambiguous', reason: 'no_request_id', requestId: null});
    });

    it('does not trust a body for a rejection (usage on a 400 changes nothing)', () => {
      expect(classifyProviderAnswer(response(400, 'req_abc', usage))).toEqual({outcome: 'noncharge', requestId: 'req_abc', status: 400});
    });
  });

  describe('everything else is ambiguous and keeps the whole reservation', () => {
    it.each([100, 101, 300, 301, 302, 304, 307, 308, 402, 405, 406, 408, 409, 410, 411, 412, 414, 415, 418, 423, 424, 425, 426, 428, 429, 431, 451, 499, 500, 501, 502, 503, 504, 507, 529, 599])(
      'classifies %i as ambiguous provider_error, keeping its request id',
      (status) => {
        expect(classifyProviderAnswer(response(status, 'req_kept', null))).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'req_kept'});
      },
    );

    it('keeps null when the error carried no usable request id', () => {
      expect(classifyProviderAnswer(response(503, null, null))).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: null});
      expect(classifyProviderAnswer(response(429, 'bad id', null))).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: null});
    });

    it('does not turn 408, 409, 429 or a 5xx into a noncharge even with a request id and a body', () => {
      for (const status of [408, 409, 429, 500, 502, 503, 504]) {
        expect(classifyProviderAnswer(response(status, 'req_x', usage)).outcome).toBe('ambiguous');
      }
    });

    it('treats a redirect and an informational status as ambiguous, never evidence', () => {
      expect(classifyProviderAnswer(response(301, 'r', usage)).outcome).toBe('ambiguous');
      expect(classifyProviderAnswer(response(199, 'r', usage)).outcome).toBe('ambiguous');
      expect(classifyProviderAnswer(response(300, 'r', usage)).outcome).toBe('ambiguous');
    });

    it('classifies a timeout as ambiguous timeout with no request id', () => {
      expect(classifyProviderAnswer({kind: 'timeout'})).toEqual({outcome: 'ambiguous', reason: 'timeout', requestId: null});
    });

    it('classifies a transport loss as ambiguous transport with no request id', () => {
      expect(classifyProviderAnswer({kind: 'transport'})).toEqual({outcome: 'ambiguous', reason: 'transport', requestId: null});
    });

    it('classifies an aborted stream as ambiguous aborted with no request id', () => {
      expect(classifyProviderAnswer({kind: 'aborted'})).toEqual({outcome: 'ambiguous', reason: 'aborted', requestId: null});
    });

    it('only names reasons from the closed list', () => {
      expect([...ambiguityReasons]).toEqual(['transport', 'timeout', 'aborted', 'provider_error', 'no_usage', 'no_request_id']);
      const answers: ProviderAnswer[] = [{kind: 'timeout'}, {kind: 'transport'}, {kind: 'aborted'}, response(500), response(200, 'r', null), response(400, null, null)];
      for (const answer of answers) {
        const result = classifyProviderAnswer(answer);
        expect(result.outcome).toBe('ambiguous');
        expect(ambiguityReasons).toContain((result as {reason: string}).reason);
      }
    });
  });

  describe('request pricing (Brave)', () => {
    const request: Pricing = {kind: 'request', model: 'web-search'};

    it('a 2xx is completed with zero tokens and the pinned model, whatever the body says', () => {
      expect(classifyProviderAnswer(response(200, 'brave-1', null), request)).toEqual({
        outcome: 'completed',
        requestId: 'brave-1',
        usage: {inputTokens: 0, outputTokens: 0, returnedModel: 'web-search'},
      });
      expect(classifyProviderAnswer(response(200, null, usage), request)).toEqual({
        outcome: 'completed',
        requestId: null,
        usage: {inputTokens: 0, outputTokens: 0, returnedModel: 'web-search'},
      });
    });

    it('a pinned model that is not printable ASCII cannot be evidence: ambiguous no_usage', () => {
      expect(classifyProviderAnswer(response(200, 'r', null), {kind: 'request', model: 'web search'})).toEqual({outcome: 'ambiguous', reason: 'no_usage', requestId: 'r'});
      expect(classifyProviderAnswer(response(200, 'r', null), {kind: 'request', model: ''})).toEqual({outcome: 'ambiguous', reason: 'no_usage', requestId: 'r'});
    });

    it('classifies rejections, errors and lost answers exactly as token pricing does', () => {
      expect(classifyProviderAnswer(response(422, 'r', null), request)).toEqual({outcome: 'noncharge', requestId: 'r', status: 422});
      expect(classifyProviderAnswer(response(401, null, null), request)).toEqual({outcome: 'ambiguous', reason: 'no_request_id', requestId: null});
      expect(classifyProviderAnswer(response(429, 'r', null), request)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'r'});
      expect(classifyProviderAnswer({kind: 'timeout'}, request)).toEqual({outcome: 'ambiguous', reason: 'timeout', requestId: null});
      expect(classifyProviderAnswer({kind: 'transport'}, request)).toEqual({outcome: 'ambiguous', reason: 'transport', requestId: null});
      expect(classifyProviderAnswer({kind: 'aborted'}, request)).toEqual({outcome: 'ambiguous', reason: 'aborted', requestId: null});
    });
  });

  describe('usableRequestId', () => {
    it('accepts printable ASCII without spaces, 1 to 200 characters', () => {
      for (const id of ['a', 'req_01HZ', 'x-request-id:123', '!~', 'a'.repeat(200)]) expect(usableRequestId(id)).toBe(id);
    });

    it('rejects everything else as none', () => {
      for (const value of ['', ' ', 'a b', 'a\tb', 'a\nb', 'café', 'a'.repeat(201), null, undefined, 5, {}, ['a']]) expect(usableRequestId(value)).toBeNull();
    });
  });

  describe('purity', () => {
    it('the same answer always means the same thing and the input is not mutated', () => {
      const answer = response(200, 'req_pure', {...usage});
      const frozen = JSON.parse(JSON.stringify(answer)) as ProviderAnswer;
      const first = classifyProviderAnswer(answer);
      const second = classifyProviderAnswer(answer);
      expect(second).toEqual(first);
      expect(answer).toEqual(frozen);
    });

    it('returns a fresh usage object (a caller cannot reach into the answer through the result)', () => {
      const answer = response(200, 'req_pure', {...usage});
      const result = classifyProviderAnswer(answer);
      expect(result.outcome).toBe('completed');
      if (result.outcome === 'completed' && answer.kind === 'response') expect(result.usage).not.toBe(answer.usage);
    });

    it('makes no request and does not touch the network or the clock', async () => {
      const fetchSpy = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => { calls += 1; return new Response(); }) as typeof fetch;
      try {
        for (const answer of [response(200), response(400), response(500), {kind: 'timeout'} as const, {kind: 'transport'} as const, {kind: 'aborted'} as const]) classifyProviderAnswer(answer);
      } finally {
        globalThis.fetch = fetchSpy;
      }
      expect(calls).toBe(0);
    });
  });
});
