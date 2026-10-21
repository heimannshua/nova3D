// Story 2.5 provider adapters. Callers must pass a live permission snapshot and
// a successful Story 2.6 reservation receipt. No retry is performed here.
import {providerEnablement, matchProviderPermission, type PermissionMatch, type PermissionSnapshot} from './policy';
import {assertPayloadPermission, type SearchPayload, type SynthesisPayload} from './payload';

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
};

export type AdapterResult<T> =
  | {outcome: 'completed'; value: T; requestId: string | null; returnedModel: string | null; inputTokens: number | null; outputTokens: number | null}
  | {outcome: 'disabled'; reason: string}
  | {outcome: 'ambiguous'; reason: 'transport' | 'timeout' | 'provider_error'}
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
  try {
    const response = await (config.fetch ?? fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: 'claude-sonnet-5-5', max_tokens: 16000, messages: [{role: 'user', content}]}),
      signal: timeout.signal,
    });
    const requestId = response.headers.get('request-id');
    if (!response.ok) return {outcome: 'ambiguous', reason: 'provider_error'};
    const result = await response.json() as Record<string, unknown>;
    const usage = result.usage && typeof result.usage === 'object' ? result.usage as Record<string, unknown> : {};
    return {
      outcome: 'completed', value: result, requestId,
      returnedModel: typeof result.model === 'string' ? result.model : null,
      inputTokens: Number.isSafeInteger(usage.input_tokens) ? usage.input_tokens as number : null,
      outputTokens: Number.isSafeInteger(usage.output_tokens) ? usage.output_tokens as number : null,
    };
  } catch (error) {
    return {outcome: 'ambiguous', reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'transport'};
  } finally {
    timeout.clear();
  }
}

/** Brave Web Search v1 adapter. Results are returned transiently and are never persisted here. */
export async function dispatchBraveSearch(payload: SearchPayload, config: AdapterConfig): Promise<AdapterResult<unknown>> {
  const denied = ready('brave', 'research_search', config);
  if (denied) return denied;
  try { assertPayloadPermission({category: config.match.category, purpose: config.match.purpose, allowedData: config.match.outboundData, payload}); }
  catch { return {outcome: 'rejected', reason: 'not_admitted'}; }
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) return {outcome: 'disabled', reason: 'credential_missing'};
  const reservation = config.reservation!;
  if (!(await config.markDispatched({provider: 'brave', operationId: reservation.operationId, reservationId: reservation.reservationId}))) {
    return {outcome: 'rejected', reason: 'not_dispatched'};
  }
  const timeout = timeoutSignal(config.timeoutMs ?? 270_000);
  try {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', payload.query);
    const response = await (config.fetch ?? fetch)(url, {headers: {'x-subscription-token': apiKey, accept: 'application/json'}, signal: timeout.signal});
    const requestId = response.headers.get('x-request-id');
    if (!response.ok) return {outcome: 'ambiguous', reason: 'provider_error'};
    return {outcome: 'completed', value: await response.json(), requestId, returnedModel: null, inputTokens: null, outputTokens: null};
  } catch (error) {
    return {outcome: 'ambiguous', reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'transport'};
  } finally {
    timeout.clear();
  }
}
