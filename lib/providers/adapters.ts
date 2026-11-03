// Story 2.5 provider adapters. Callers must pass a live permission snapshot and
// a successful Story 2.6 reservation receipt. No retry is performed here.
//
// Story 2.8: an adapter makes EXACTLY ONE request after the operation's identity is committed (`markDispatched`), never retries and never makes a replacement request, whatever
// comes back; it keeps the provider's request ID; and what came back is classified by the pure `classifyProviderAnswer` (lib/providers/outcome.ts): a priced answer is `completed`,
// a definitive pre-processing rejection with a request ID is `noncharge`, and anything else (a timeout, a lost connection, an aborted body, a 408, 409, 429 or 5xx, a 2xx without
// usable usage) is `ambiguous`, which keeps the whole reservation until usage evidence, a proven noncharge or the 24-hour deadline. Nothing here logs the request ID, the usage or a key.
// A redirect is never followed (`redirect: 'manual'`): the one request is the only request, so a 3xx is classified like any other unlisted status (ambiguous). The body of a response
// that is not a success is cancelled unread, so the connection is released. Brave reports no model, so its caller names the one the reservation pinned (`config.model`); without
// one nothing is dispatched or sent (`rejected` / `not_dispatched`), because a priced answer could not be reported against a model that was never named.
import {providerEnablement, matchProviderPermission, type PermissionMatch, type PermissionSnapshot} from './policy';
import {assertPayloadPermission, type SearchPayload, type SynthesisPayload} from './payload';
import {classifyProviderAnswer, usableRequestId, type AmbiguityReason, type Pricing, type ProviderAnswer, type UsageReport} from './outcome';

if (typeof window !== 'undefined') throw new Error('Provider adapters are server-only.');

export type ProviderReservation = {
  outcome: 'reserved' | 'replayed';
  reservationId: string;
  operationId: string;
  accountId: string;
  jobId: string;
  reservedMicrodollars: number;
};

export type AdapterConfig = {
  freeOnly: boolean;
  permission: PermissionSnapshot | null;
  match: PermissionMatch;
  operation: {id: string; accountId: string; projectId: string; jobId: string};
  reservation: ProviderReservation | null;
  /** Must persist the operation's dispatched identity before any HTTP request. */
  markDispatched: (identity: {provider: 'anthropic' | 'brave'; operationId: string; reservationId: string}) => Promise<boolean>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /**
   * The model the reservation pinned (printable ASCII without spaces, 1 to 200). Required by a per-request provider (Brave), which reports no model: its priced answer names this
   * one, and without it the adapter dispatches and sends nothing (`rejected` / `not_dispatched`). The model provider (Anthropic) reports its own and ignores it.
   */
  model?: string;
};

export type AdapterResult<T> =
  | {outcome: 'completed'; value: T; requestId: string | null; returnedModel: string; inputTokens: number; outputTokens: number}
  /** The provider refused the request before processing it and said which request it was (400, 401, 403, 404, 413, 422 with a request ID): documented noncharge. */
  | {outcome: 'noncharge'; requestId: string; status: number}
  /** The request went out and its outcome is unknown. The request ID is the provider's, when it sent one. */
  | {outcome: 'ambiguous'; reason: AmbiguityReason; requestId: string | null}
  | {outcome: 'disabled'; reason: string}
  | {outcome: 'rejected'; reason: 'not_admitted' | 'not_dispatched'};

function ready(provider: 'anthropic' | 'brave', category: 'research_search' | 'synthesis_vision', config: AdapterConfig): AdapterResult<never> | null {
  if (config.freeOnly) return {outcome: 'disabled', reason: 'free_only'};
  if (!config.reservation || !['reserved', 'replayed'].includes(config.reservation.outcome) ||
      !uuidPattern.test(config.reservation.reservationId) || !uuidPattern.test(config.reservation.operationId) ||
      config.reservation.operationId !== config.operation.id || config.reservation.accountId !== config.operation.accountId ||
      config.reservation.accountId !== config.match.accountId || config.operation.accountId !== config.match.accountId ||
      config.operation.projectId !== config.match.projectId || config.reservation.jobId !== config.operation.jobId ||
      config.reservation.jobId !== config.match.jobId || config.operation.jobId !== config.match.jobId ||
      !Number.isSafeInteger(config.reservation.reservedMicrodollars) || config.reservation.reservedMicrodollars < 1 ||
      config.match.calculatedMaximumMicrodollars > config.reservation.reservedMicrodollars) {
    return {outcome: 'rejected', reason: 'not_admitted'};
  }
  const permission = matchProviderPermission(config.permission, config.match);
  if (!permission.allowed || permission.snapshot.provider !== provider || config.match.provider !== provider || config.match.category !== category) {
    return {outcome: 'rejected', reason: 'not_admitted'};
  }
  const enabled = providerEnablement(provider);
  if (!enabled.enabled) return {outcome: 'disabled', reason: enabled.reason ?? 'provider_disabled'};
  return null;
}

const modelPattern = /^[!-~]{1,200}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {signal: controller.signal, clear: () => clearTimeout(timer)};
}

/** Anthropic Messages API adapter for schema-neutral synthesis/vision payloads. */
export async function dispatchAnthropicMessages(
  payload: SynthesisPayload,
  config: AdapterConfig,
): Promise<AdapterResult<unknown>> {
  const denied = ready('anthropic', 'synthesis_vision', config);
  if (denied) return denied;
  try { assertPayloadPermission({category: config.match.category, purpose: config.match.purpose, allowedData: config.match.outboundData, payload}); }
  catch { return {outcome: 'rejected', reason: 'not_admitted'}; }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return {outcome: 'disabled', reason: 'credential_missing'};
  const reservation = config.reservation!;
  if (!(await config.markDispatched({provider: 'anthropic', operationId: reservation.operationId, reservationId: reservation.reservationId}))) {
    return {outcome: 'rejected', reason: 'not_dispatched'};
  }
  const content: Record<string, unknown>[] = [{type: 'text', text: `${payload.purpose}\n${payload.confirmedScope}\n${payload.approvedEvidence.map((entry) => `${entry.label}: ${entry.text}`).join('\n')}`}];
  for (const image of payload.images) content.push({type: 'image', source: {type: 'base64', media_type: image.mediaType, data: image.bytes.toString('base64')}});
  const timeout = timeoutSignal(config.timeoutMs ?? 270_000);
  // EXACTLY ONE request: nothing below sends another, whatever the answer is.
  const sent = await sendOnce(
    () => (config.fetch ?? fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: 'claude-sonnet-5-5', max_tokens: 16000, messages: [{role: 'user', content}]}),
      redirect: 'manual',
      signal: timeout.signal,
    }),
    'request-id',
    (body) => {
      const usage = body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {};
      return {inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, returnedModel: body.model};
    },
    timeout,
  );
  return resultOf(sent, {kind: 'tokens'});
}

/** Brave Web Search v1 adapter. Results are returned transiently and are never persisted here. */
export async function dispatchBraveSearch(payload: SearchPayload, config: AdapterConfig): Promise<AdapterResult<unknown>> {
  const denied = ready('brave', 'research_search', config);
  if (denied) return denied;
  try { assertPayloadPermission({category: config.match.category, purpose: config.match.purpose, allowedData: config.match.outboundData, payload}); }
  catch { return {outcome: 'rejected', reason: 'not_admitted'}; }
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) return {outcome: 'disabled', reason: 'credential_missing'};
  // Nothing is dispatched or sent without the model the reservation pinned: the priced answer is reported against it, and a guessed name would settle against the wrong one.
  const model = config.model;
  if (typeof model !== 'string' || !modelPattern.test(model)) return {outcome: 'rejected', reason: 'not_dispatched'};
  const reservation = config.reservation!;
  if (!(await config.markDispatched({provider: 'brave', operationId: reservation.operationId, reservationId: reservation.reservationId}))) {
    return {outcome: 'rejected', reason: 'not_dispatched'};
  }
  const timeout = timeoutSignal(config.timeoutMs ?? 270_000);
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', payload.query);
  // EXACTLY ONE request: nothing below sends another, whatever the answer is. Brave prices the request itself and reports no tokens.
  const sent = await sendOnce(
    () => (config.fetch ?? fetch)(url, {headers: {'x-subscription-token': apiKey, accept: 'application/json'}, redirect: 'manual', signal: timeout.signal}),
    'x-request-id',
    () => null,
    timeout,
  );
  return resultOf(sent, {kind: 'request', model});
}

/** What one request came to: the classified-to-be answer, the body when it could be read, and the provider's request ID. */
type Sent = {answer: ProviderAnswer; body: Record<string, unknown> | null; value: unknown};

/**
 * Sends the ONE request and reads what came back. A response keeps its status and its request ID; a body that cannot be read after the headers arrived is an aborted stream (the
 * request may have been processed), one that reads but is not JSON simply carries no usage. A timeout of its own, a lost connection and a read that fails are all ambiguous,
 * and none of them sends anything again.
 */
async function sendOnce(
  send: () => Promise<Response>,
  requestIdHeader: string,
  usageOf: (body: Record<string, unknown>) => UsageReport | null,
  timeout: {clear: () => void; signal: AbortSignal},
): Promise<Sent> {
  try {
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      // Our own timer fired (the abort), or the connection was lost: either way the request may have been processed.
      return {answer: {kind: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'transport'}, body: null, value: null};
    }
    const requestId = usableRequestId(response.headers.get(requestIdHeader));
    if (response.status < 200 || response.status > 299) {
      // The body of a response that is not a success is never read: it is cancelled, so the connection is released.
      await response.body?.cancel().catch(() => {});
      return {answer: {kind: 'response', status: response.status, requestId, usage: null}, body: null, value: null};
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      // Headers arrived and the body did not: an aborted stream (or a timeout while reading). A body that arrived whole but is not JSON carries no usable usage.
      if (error instanceof SyntaxError) return {answer: {kind: 'response', status: response.status, requestId, usage: null}, body: null, value: null};
      return {answer: {kind: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'aborted'}, body: null, value: null};
    }
    const body = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
    return {answer: {kind: 'response', status: response.status, requestId, usage: body ? usageOf(body) : null}, body, value};
  } finally {
    timeout.clear();
  }
}

function resultOf(sent: Sent, pricing: Pricing): AdapterResult<unknown> {
  const classified = classifyProviderAnswer(sent.answer, pricing);
  switch (classified.outcome) {
    case 'completed':
      return {
        outcome: 'completed', value: sent.value, requestId: classified.requestId,
        returnedModel: classified.usage.returnedModel, inputTokens: classified.usage.inputTokens, outputTokens: classified.usage.outputTokens,
      };
    case 'noncharge':
      return {outcome: 'noncharge', requestId: classified.requestId, status: classified.status};
    case 'ambiguous':
      return {outcome: 'ambiguous', reason: classified.reason, requestId: classified.requestId};
  }
}
