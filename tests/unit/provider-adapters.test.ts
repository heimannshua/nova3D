import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {dispatchAnthropicMessages, dispatchBraveSearch, type AdapterConfig} from '@/lib/providers/adapters';
import {buildSearchPayload, buildSynthesisPayload} from '@/lib/providers/payload';
import type {PermissionSnapshot} from '@/lib/providers/policy';

// Enablement is derived from the provisioning ledger (rates and terms attested), which this repository does not have yet. The Story 2.8 request tests need a provider that is
// enabled, so the module's own function is wrapped: it answers the real result unless a test turns it on.
const switchboard = vi.hoisted(() => ({enabled: false}));
vi.mock('@/lib/providers/policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providers/policy')>();
  return {...actual, providerEnablement: (...args: Parameters<typeof actual.providerEnablement>) => (switchboard.enabled ? {enabled: true, reason: null} : actual.providerEnablement(...args))};
});

const permission: PermissionSnapshot = {
  accountId: 'account-1', projectId: 'project-1', jobId: 'job-1', category: 'research_search', provider: 'brave',
  purpose: 'discover public sources', outboundData: ['normalized_public_subject'], disclosedMaximumMicrodollars: 100_000,
  grantedAt: '2026-10-21T12:00:00.000Z', expiresAt: '2026-10-28T12:00:00.000Z', revokedAt: null, jobTerminal: false,
};
const base = (): AdapterConfig => ({
  freeOnly: false,
  permission,
  match: {
    accountId: 'account-1', projectId: 'project-1', jobId: 'job-1', category: 'research_search', provider: 'brave',
    purpose: permission.purpose, outboundData: permission.outboundData, calculatedMaximumMicrodollars: 100_000, now: '2026-10-21T12:01:00.000Z',
  },
  operation: {id: '22222222-2222-4222-8222-222222222222', accountId: 'account-1', projectId: 'project-1', jobId: 'job-1'},
  reservation: {outcome: 'reserved', reservationId: '11111111-1111-4111-8111-111111111111', operationId: '22222222-2222-4222-8222-222222222222', accountId: 'account-1', jobId: 'job-1', reservedMicrodollars: 100_000},
  markDispatched: vi.fn(async () => true),
  fetch: vi.fn(async () => Response.json({web: {results: []}}, {status: 200})),
});

describe('provider adapters', () => {
  it('never calls a provider in free-only mode or without verified enablement', async () => {
    const config = base();
    config.freeOnly = true;
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'disabled', reason: 'free_only'});
    expect(config.fetch).not.toHaveBeenCalled();
    config.freeOnly = false;
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toMatchObject({outcome: 'disabled', reason: 'rates_unverified'});
    expect(config.fetch).not.toHaveBeenCalled();
  });

  it('keeps dispatch disabled until provisioning evidence is recorded', async () => {
    const config = base();
    const anthropicPermission: PermissionSnapshot = {
      ...permission, category: 'synthesis_vision', provider: 'anthropic', purpose: 'identify subject',
      outboundData: ['confirmed_project_scope'],
    };
    config.permission = anthropicPermission;
    config.match = {
      ...config.match, category: 'synthesis_vision', provider: 'anthropic', purpose: anthropicPermission.purpose,
      outboundData: anthropicPermission.outboundData,
    };
    config.fetch = vi.fn(async () => new Response('error', {status: 503}));
    config.markDispatched = vi.fn(async () => false);
    const payload = buildSynthesisPayload({purpose: 'identify subject', confirmedScope: 'altar', approvedEvidence: [], derivatives: [], allowedData: ['confirmed_project_scope']});
    expect(await dispatchAnthropicMessages(payload, config)).toEqual({outcome: 'disabled', reason: 'rates_unverified'});
    expect(config.fetch).not.toHaveBeenCalled();
    expect(config.markDispatched).not.toHaveBeenCalled();
  });

  it('does not admit a permission for another provider or category to Anthropic', async () => {
    const config = base();
    const synthesis = buildSynthesisPayload({purpose: 'identify subject', confirmedScope: 'altar', approvedEvidence: [], derivatives: [], allowedData: ['confirmed_project_scope']});
    expect(await dispatchAnthropicMessages(synthesis, config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
    expect(config.fetch).not.toHaveBeenCalled();
  });

  it('rejects a reservation bound to a different Account or Job before marking dispatch', async () => {
    const config = base();
    config.reservation = {...config.reservation!, accountId: 'other-account'};
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
    expect(config.markDispatched).not.toHaveBeenCalled();
    config.reservation = {...config.reservation!, accountId: 'account-1', jobId: 'other-job'};
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
    expect(config.fetch).not.toHaveBeenCalled();
    config.reservation = {...config.reservation!, jobId: 'job-1'};
    config.reservation = {...config.reservation!, operationId: '33333333-3333-4333-8333-333333333333'};
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
  });

  it('rejects malformed reservation identifiers before dispatch', async () => {
    const config = base();
    config.reservation = {...config.reservation!, reservationId: 'bad'};
    expect(await dispatchBraveSearch(buildSearchPayload({confirmedPublicSubject: 'altar'}), config)).toEqual({outcome: 'rejected', reason: 'not_admitted'});
    expect(config.markDispatched).not.toHaveBeenCalled();
  });
});

// Story 2.8: exactly one request after the identity is committed, no retry, the request ID kept, and what came back classified ---------------------------------------------

type Fetch = typeof fetch;
const anthropicConfig = (fetchImpl: Fetch, extra: Partial<AdapterConfig> = {}): AdapterConfig => {
  const config = base();
  const anthropicPermission: PermissionSnapshot = {...permission, category: 'synthesis_vision', provider: 'anthropic', purpose: 'identify subject', outboundData: ['confirmed_project_scope']};
  config.permission = anthropicPermission;
  config.match = {...config.match, category: 'synthesis_vision', provider: 'anthropic', purpose: anthropicPermission.purpose, outboundData: anthropicPermission.outboundData};
  config.fetch = vi.fn(fetchImpl) as unknown as Fetch;
  return {...config, ...extra};
};
// Brave reports no model, so the caller names the one the reservation pinned: every Brave config here does, unless a test takes it away.
const pinnedBraveModel = 'brave-web-search-v1';
const braveConfig = (fetchImpl: Fetch, extra: Partial<AdapterConfig> = {}): AdapterConfig => ({...base(), model: pinnedBraveModel, fetch: vi.fn(fetchImpl) as unknown as Fetch, ...extra});
const synthesis = () => buildSynthesisPayload({purpose: 'identify subject', confirmedScope: 'altar', approvedEvidence: [], derivatives: [], allowedData: ['confirmed_project_scope']});
const search = () => buildSearchPayload({confirmedPublicSubject: 'altar'});
const calls = (config: AdapterConfig) => (config.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;

const messageBody = {model: 'claude-sonnet-5-5', usage: {input_tokens: 1200, output_tokens: 300}, content: [{type: 'text', text: 'ok'}]};
const anthropicOk = (headers: Record<string, string> = {'request-id': 'req_anthropic_1'}) => async () => Response.json(messageBody, {status: 200, headers});

/** A fetch that stays pending until the request's own signal aborts, then rejects the way fetch does. */
const hangsUntilAborted = (): Fetch => ((_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    const onAbort = () => reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, {once: true});
  })) as unknown as Fetch;

/** A body whose stream errors after the headers were delivered. */
const brokenBody = (error: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(new ReadableStream({start(controller) { controller.error(error); }}), {status, headers});

describe('provider adapters: one request, no retry, request id kept (Story 2.8)', () => {
  beforeEach(() => {
    switchboard.enabled = true;
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-key');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-test-key');
  });
  afterEach(() => {
    switchboard.enabled = false;
    vi.unstubAllEnvs();
  });

  describe('markDispatched comes first and gates the request', () => {
    it('commits the identity before the single request and passes the provider, operation and reservation', async () => {
      const order: string[] = [];
      const config = braveConfig(async () => { order.push('fetch'); return Response.json({web: {results: []}}, {headers: {'x-request-id': 'b1'}}); }, {
        markDispatched: vi.fn(async () => { order.push('markDispatched'); return true; }),
      });
      await dispatchBraveSearch(search(), config);
      expect(order).toEqual(['markDispatched', 'fetch']);
      expect(config.markDispatched).toHaveBeenCalledTimes(1);
      expect(config.markDispatched).toHaveBeenCalledWith({provider: 'brave', operationId: config.reservation!.operationId, reservationId: config.reservation!.reservationId});
    });

    it('sends NOTHING when markDispatched answers false (Brave and Anthropic): rejected not_dispatched, no fetch', async () => {
      const brave = braveConfig(async () => Response.json({}), {markDispatched: vi.fn(async () => false)});
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'rejected', reason: 'not_dispatched'});
      expect(brave.fetch).not.toHaveBeenCalled();
      expect(brave.markDispatched).toHaveBeenCalledTimes(1);

      const anthropic = anthropicConfig(anthropicOk(), {markDispatched: vi.fn(async () => false)});
      expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'rejected', reason: 'not_dispatched'});
      expect(anthropic.fetch).not.toHaveBeenCalled();
      expect(anthropic.markDispatched).toHaveBeenCalledTimes(1);
    });

    it('does not mark or send when the provider is not enabled or its credential is missing', async () => {
      const brave = braveConfig(async () => Response.json({}));
      vi.stubEnv('BRAVE_SEARCH_API_KEY', '   ');
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'disabled', reason: 'credential_missing'});
      expect(brave.markDispatched).not.toHaveBeenCalled();
      expect(brave.fetch).not.toHaveBeenCalled();
      const anthropic = anthropicConfig(anthropicOk());
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'disabled', reason: 'credential_missing'});
      expect(anthropic.markDispatched).not.toHaveBeenCalled();
      expect(anthropic.fetch).not.toHaveBeenCalled();
    });
  });

  describe('a priced answer is completed and keeps the request id', () => {
    it('Anthropic: tokens and model from the body, the request-id header, one request', async () => {
      const config = anthropicConfig(anthropicOk());
      const result = await dispatchAnthropicMessages(synthesis(), config);
      expect(result).toEqual({outcome: 'completed', value: messageBody, requestId: 'req_anthropic_1', returnedModel: 'claude-sonnet-5-5', inputTokens: 1200, outputTokens: 300});
      expect(calls(config)).toHaveLength(1);
      const [url, init] = calls(config)[0] as [string, RequestInit];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test-key');
    });

    it('Anthropic: a completed answer without a request id header still completes, with a null request id', async () => {
      const result = await dispatchAnthropicMessages(synthesis(), anthropicConfig(anthropicOk({})));
      expect(result).toMatchObject({outcome: 'completed', requestId: null, returnedModel: 'claude-sonnet-5-5', inputTokens: 1200, outputTokens: 300});
    });

    it('Brave: priced by the request, zero tokens, the pinned model name the config gives, x-request-id kept', async () => {
      const config = braveConfig(async () => Response.json({web: {results: []}}, {headers: {'x-request-id': 'brave_req_1'}}));
      const result = await dispatchBraveSearch(search(), config);
      expect(result).toEqual({outcome: 'completed', value: {web: {results: []}}, requestId: 'brave_req_1', returnedModel: pinnedBraveModel, inputTokens: 0, outputTokens: 0});
      expect(calls(config)).toHaveLength(1);
      const [url, init] = calls(config)[0] as [URL, RequestInit];
      expect(String(url)).toBe('https://api.search.brave.com/res/v1/web/search?q=altar');
      expect((init.headers as Record<string, string>)['x-subscription-token']).toBe('brave-test-key');
    });

    it('Brave: names the model the reservation pinned, whatever it is', async () => {
      const config = braveConfig(async () => Response.json({}, {headers: {'x-request-id': 'b'}}), {model: 'brave-web-search-v2'});
      expect(await dispatchBraveSearch(search(), config)).toMatchObject({outcome: 'completed', returnedModel: 'brave-web-search-v2', inputTokens: 0, outputTokens: 0});
    });

    it.each([undefined, '', 'has a space', 'x'.repeat(201), 7 as unknown as string])('Brave: with no usable pinned model (%j) nothing is dispatched or sent: rejected not_dispatched BEFORE markDispatched', async (model) => {
      const config = braveConfig(async () => Response.json({}, {headers: {'x-request-id': 'b'}}), {model});
      expect(await dispatchBraveSearch(search(), config)).toEqual({outcome: 'rejected', reason: 'not_dispatched'});
      expect(config.markDispatched).not.toHaveBeenCalled();
      expect(config.fetch).not.toHaveBeenCalled();
    });

    it('Brave: a missing credential still comes first (disabled), and a missing model never defaults to a guessed name', async () => {
      vi.stubEnv('BRAVE_SEARCH_API_KEY', '   ');
      const config = braveConfig(async () => Response.json({}), {model: undefined});
      expect(await dispatchBraveSearch(search(), config)).toEqual({outcome: 'disabled', reason: 'credential_missing'});
      expect(config.markDispatched).not.toHaveBeenCalled();
    });

    it('Brave: a 2xx whose body is not JSON is still the priced request (the request is the unit)', async () => {
      const config = braveConfig(async () => new Response('not json', {status: 200, headers: {'x-request-id': 'b'}}));
      expect(await dispatchBraveSearch(search(), config)).toMatchObject({outcome: 'completed', requestId: 'b', inputTokens: 0, outputTokens: 0});
    });
  });

  describe('exactly one fetch, whatever comes back (no retry, no replacement request)', () => {
    it.each([500, 502, 503, 504, 529])('a %i is ambiguous provider_error with the request id kept, after ONE fetch (Anthropic)', async (status) => {
      const config = anthropicConfig(async () => new Response('upstream', {status, headers: {'request-id': `req_${status}`}}));
      expect(await dispatchAnthropicMessages(synthesis(), config)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: `req_${status}`});
      expect(calls(config)).toHaveLength(1);
    });

    it.each([500, 503])('a %i is ambiguous provider_error after ONE fetch (Brave)', async (status) => {
      const config = braveConfig(async () => new Response('upstream', {status, headers: {'x-request-id': 'b_err'}}));
      expect(await dispatchBraveSearch(search(), config)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'b_err'});
      expect(calls(config)).toHaveLength(1);
    });

    it.each([408, 409, 429])('a %i is ambiguous provider_error (never a noncharge) after ONE fetch, even with a retry-after', async (status) => {
      const anthropic = anthropicConfig(async () => new Response('slow down', {status, headers: {'request-id': 'req_throttle', 'retry-after': '1'}}));
      expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'req_throttle'});
      expect(calls(anthropic)).toHaveLength(1);
      const brave = braveConfig(async () => new Response('slow down', {status, headers: {'x-request-id': 'b_throttle', 'retry-after': '1'}}));
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'b_throttle'});
      expect(calls(brave)).toHaveLength(1);
    });

    it('a redirect is ambiguous and is not followed by a second request of the adapter', async () => {
      const config = braveConfig(async () => new Response(null, {status: 302, headers: {location: 'https://elsewhere.example', 'x-request-id': 'b_redirect'}}));
      expect(await dispatchBraveSearch(search(), config)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'b_redirect'});
      expect(calls(config)).toHaveLength(1);
    });

    it('both fetches carry redirect: manual, so a 3xx is never followed, and a 302 is ambiguous with ONE fetch (Anthropic and Brave)', async () => {
      const anthropic = anthropicConfig(async () => new Response(null, {status: 302, headers: {location: 'https://elsewhere.example', 'request-id': 'req_redirect'}}));
      expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'req_redirect'});
      expect(calls(anthropic)).toHaveLength(1);
      expect((calls(anthropic)[0] as [unknown, RequestInit])[1].redirect).toBe('manual');

      const brave = braveConfig(async () => new Response(null, {status: 302, headers: {location: 'https://elsewhere.example', 'x-request-id': 'b_redirect'}}));
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'b_redirect'});
      expect(calls(brave)).toHaveLength(1);
      expect((calls(brave)[0] as [unknown, RequestInit])[1].redirect).toBe('manual');
    });

    it('a response that is not a success has its body cancelled unread (and a body that cannot be cancelled changes nothing)', async () => {
      const cancelled = vi.fn();
      const withBody = (status: number, headers: Record<string, string>, onCancel: () => void | Promise<void>) =>
        new Response(new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode('upstream error text')); }, cancel: onCancel}), {status, headers});
      const anthropic = anthropicConfig(async () => withBody(503, {'request-id': 'req_503'}, cancelled));
      expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'req_503'});
      expect(cancelled).toHaveBeenCalledTimes(1);

      const refusing = vi.fn(async () => { throw new Error('cancel failed'); });
      const brave = braveConfig(async () => withBody(400, {'x-request-id': 'b_400'}, refusing));
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'noncharge', requestId: 'b_400', status: 400});
      expect(refusing).toHaveBeenCalledTimes(1);
      expect(calls(brave)).toHaveLength(1);

      // No body at all (a redirect or a 204-like answer) is fine too.
      const bodyless = braveConfig(async () => new Response(null, {status: 500, headers: {'x-request-id': 'b_500'}}));
      expect(await dispatchBraveSearch(search(), bodyless)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'b_500'});
    });

    it('does not retry when a later call would have succeeded: the first failure stands', async () => {
      const fetchImpl = vi.fn<Fetch>()
        .mockResolvedValueOnce(new Response('upstream', {status: 503, headers: {'request-id': 'req_first'}}))
        .mockResolvedValue(Response.json(messageBody, {headers: {'request-id': 'req_second'}}));
      const config = anthropicConfig(fetchImpl as unknown as Fetch);
      expect(await dispatchAnthropicMessages(synthesis(), config)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: 'req_first'});
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('a transport loss (the connection fails) is ambiguous transport with no request id, after ONE fetch', async () => {
      const failing = (): Fetch => (async () => { throw new TypeError('fetch failed'); }) as unknown as Fetch;
      const anthropic = anthropicConfig(failing());
      expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'ambiguous', reason: 'transport', requestId: null});
      expect(calls(anthropic)).toHaveLength(1);
      const brave = braveConfig(failing());
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'ambiguous', reason: 'transport', requestId: null});
      expect(calls(brave)).toHaveLength(1);
    });

    it('a non-Error rejection is a transport loss too, after ONE fetch', async () => {
      const config = braveConfig((async () => { throw 'boom'; }) as unknown as Fetch);
      expect(await dispatchBraveSearch(search(), config)).toEqual({outcome: 'ambiguous', reason: 'transport', requestId: null});
      expect(calls(config)).toHaveLength(1);
    });

    it('a timeout (a short timeoutMs and a fetch that honors the abort signal) is ambiguous timeout after ONE fetch, and the signal was ours', async () => {
      const brave = braveConfig(hangsUntilAborted(), {timeoutMs: 25});
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'ambiguous', reason: 'timeout', requestId: null});
      expect(calls(brave)).toHaveLength(1);
      const [, init] = calls(brave)[0] as [URL, RequestInit];
      expect(init.signal?.aborted).toBe(true);
      const anthropic = anthropicConfig(hangsUntilAborted(), {timeoutMs: 25});
      expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'ambiguous', reason: 'timeout', requestId: null});
      expect(calls(anthropic)).toHaveLength(1);
    });

    it('an abort of the request (the fetch rejects with AbortError) is ambiguous, after ONE fetch', async () => {
      const config = anthropicConfig((async () => { throw new DOMException('This operation was aborted', 'AbortError'); }) as unknown as Fetch);
      expect(await dispatchAnthropicMessages(synthesis(), config)).toEqual({outcome: 'ambiguous', reason: 'timeout', requestId: null});
      expect(calls(config)).toHaveLength(1);
    });

    it('a body read failure after the headers arrived is an aborted stream: ambiguous aborted with NO retry', async () => {
      const anthropic = anthropicConfig(async () => brokenBody(new TypeError('terminated'), 200, {'request-id': 'req_broken'}));
      const result = await dispatchAnthropicMessages(synthesis(), anthropic);
      expect(result).toMatchObject({outcome: 'ambiguous', reason: 'aborted'});
      expect(calls(anthropic)).toHaveLength(1);
      const brave = braveConfig(async () => brokenBody(new Error('socket hang up'), 200, {'x-request-id': 'b_broken'}));
      expect(await dispatchBraveSearch(search(), brave)).toMatchObject({outcome: 'ambiguous', reason: 'aborted'});
      expect(calls(brave)).toHaveLength(1);
    });

    it('an abort while the body is read (our timer fired after the headers) is ambiguous timeout, after ONE fetch', async () => {
      const config = anthropicConfig(async () => brokenBody(new DOMException('This operation was aborted', 'AbortError'), 200, {'request-id': 'req_slow_body'}));
      expect(await dispatchAnthropicMessages(synthesis(), config)).toMatchObject({outcome: 'ambiguous', reason: 'timeout'});
      expect(calls(config)).toHaveLength(1);
    });

    it('never leaks the api key into a result', async () => {
      const results = [
        await dispatchAnthropicMessages(synthesis(), anthropicConfig(async () => new Response('x', {status: 503, headers: {'request-id': 'r'}}))),
        await dispatchAnthropicMessages(synthesis(), anthropicConfig(anthropicOk())),
        await dispatchBraveSearch(search(), braveConfig(async () => { throw new TypeError('fetch failed'); })),
      ];
      for (const result of results) {
        expect(JSON.stringify(result)).not.toContain('sk-ant-test-key');
        expect(JSON.stringify(result)).not.toContain('brave-test-key');
      }
    });
  });

  describe('the request id is kept on every result that has a response', () => {
    it('on a definitive rejection with a request id: noncharge carries the id and the status (400, 401, 403, 404, 413, 422)', async () => {
      for (const status of [400, 401, 403, 404, 413, 422]) {
        const anthropic = anthropicConfig(async () => new Response('{"error":"bad"}', {status, headers: {'request-id': `req_${status}`}}));
        expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'noncharge', requestId: `req_${status}`, status});
        expect(calls(anthropic)).toHaveLength(1);
        const brave = braveConfig(async () => new Response('bad', {status, headers: {'x-request-id': `b_${status}`}}));
        expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'noncharge', requestId: `b_${status}`, status});
        expect(calls(brave)).toHaveLength(1);
      }
    });

    it('on a definitive rejection WITHOUT a request id the answer is ambiguous no_request_id (Brave and Anthropic)', async () => {
      const anthropic = anthropicConfig(async () => new Response('bad', {status: 400}));
      expect(await dispatchAnthropicMessages(synthesis(), anthropic)).toEqual({outcome: 'ambiguous', reason: 'no_request_id', requestId: null});
      const brave = braveConfig(async () => new Response('bad', {status: 422}));
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'ambiguous', reason: 'no_request_id', requestId: null});
    });

    it('a request id header that is not printable ASCII without spaces is as good as none', async () => {
      const brave = braveConfig(async () => new Response('bad', {status: 400, headers: {'x-request-id': 'has a space'}}));
      expect(await dispatchBraveSearch(search(), brave)).toEqual({outcome: 'ambiguous', reason: 'no_request_id', requestId: null});
      const tooLong = anthropicConfig(async () => new Response('bad', {status: 400, headers: {'request-id': 'x'.repeat(201)}}));
      expect(await dispatchAnthropicMessages(synthesis(), tooLong)).toEqual({outcome: 'ambiguous', reason: 'no_request_id', requestId: null});
      const error = anthropicConfig(async () => new Response('bad', {status: 503, headers: {'request-id': 'two words'}}));
      expect(await dispatchAnthropicMessages(synthesis(), error)).toEqual({outcome: 'ambiguous', reason: 'provider_error', requestId: null});
    });

    it('a 2xx without usable usage is ambiguous no_usage and keeps the request id (no tokens, a fractional count, a body that is not JSON, a body that is not an object)', async () => {
      const bodies: [string, string][] = [
        ['{}', 'no usage'],
        ['{"model":"claude-sonnet-5-5","usage":{"input_tokens":1.5,"output_tokens":3}}', 'fractional'],
        ['{"model":"claude-sonnet-5-5","usage":{"input_tokens":3}}', 'missing output'],
        ['{"usage":{"input_tokens":3,"output_tokens":3}}', 'missing model'],
        ['{"model":7,"usage":{"input_tokens":3,"output_tokens":3}}', 'numeric model'],
        ['not json at all', 'not json'],
        ['[1,2,3]', 'array'],
        ['null', 'null'],
      ];
      for (const [body, name] of bodies) {
        const config = anthropicConfig(async () => new Response(body, {status: 200, headers: {'request-id': 'req_no_usage'}}));
        expect(await dispatchAnthropicMessages(synthesis(), config), name).toEqual({outcome: 'ambiguous', reason: 'no_usage', requestId: 'req_no_usage'});
        expect(calls(config), name).toHaveLength(1);
      }
    });

    it('a timeout, a transport loss and an aborted stream have no response, so no request id', async () => {
      const results = [
        await dispatchBraveSearch(search(), braveConfig(hangsUntilAborted(), {timeoutMs: 10})),
        await dispatchBraveSearch(search(), braveConfig((async () => { throw new TypeError('fetch failed'); }) as unknown as Fetch)),
      ];
      for (const result of results) expect(result).toMatchObject({outcome: 'ambiguous', requestId: null});
    });
  });
});
