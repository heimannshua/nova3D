// Story 2.8: what a provider's answer means for the money. A PURE classifier: it reads what came back (or that nothing did) and says whether the operation `completed` (a priced
// answer, which is evidence), is a proven `noncharge` (the provider refused the request before it processed anything, and said which request it was), or is `ambiguous` (anything
// else: the request may or may not have been charged). It is conservative by construction: only a clearly priced answer or a clear pre-processing rejection with a request ID is
// anything but ambiguous, and an ambiguous operation keeps its whole reservation until usage evidence, a proven noncharge or the 24-hour deadline settles it, which is the most the
// Account was already shown. It makes no request, retries nothing and logs nothing; the request ID, the tokens and the key never leave through here.
//
// The rules (AD-11, R-6):
//   - a 2xx whose body carries usable usage (whole input and output tokens and the model that served it; a per-request provider needs none) is `completed`;
//   - 400, 401, 403, 404, 413 and 422 WITH a request ID are `noncharge`; without one they are `ambiguous` (nothing proves the provider did not process it);
//   - a 2xx without usable usage, every other status (408, 409, 429, 5xx, redirects, ...), a timeout, a lost connection and an aborted stream are `ambiguous`.

/** What came back. A response carries its status, the provider's request ID (null when it sent none) and the body's usage when the body could be read. */
export type ProviderAnswer =
  | {kind: 'response'; status: number; requestId: string | null; usage: UsageReport | null}
  | {kind: 'timeout'}
  | {kind: 'transport'}
  | {kind: 'aborted'};

/** The usage a body reported, as the provider wrote it: nothing here is trusted until the classifier has read it. */
export type UsageReport = {inputTokens?: unknown; outputTokens?: unknown; returnedModel?: unknown};

/** How the answer is priced: by the tokens it reports (a model provider), or by the request alone (a search provider, which reports no tokens). */
export type Pricing = {kind: 'tokens'} | {kind: 'request'; model: string};

export type Usage = {inputTokens: number; outputTokens: number; returnedModel: string};

/** Why an operation is ambiguous. */
export const ambiguityReasons = ['transport', 'timeout', 'aborted', 'provider_error', 'no_usage', 'no_request_id'] as const;
export type AmbiguityReason = (typeof ambiguityReasons)[number];

export type ClassifiedOutcome =
  | {outcome: 'completed'; requestId: string | null; usage: Usage}
  | {outcome: 'noncharge'; requestId: string; status: number}
  | {outcome: 'ambiguous'; reason: AmbiguityReason; requestId: string | null};

/** The statuses by which a provider refuses a request before it processes anything. */
export const definitiveRejections: readonly number[] = [400, 401, 403, 404, 413, 422];

const requestIdPattern = /^[!-~]{1,200}$/;
const modelPattern = /^[!-~]{1,200}$/;

const wholeTokens = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** The request ID the database would accept (printable ASCII without spaces, 1 to 200), or null: a header that is not one is as good as none. */
export function usableRequestId(value: unknown): string | null {
  return typeof value === 'string' && requestIdPattern.test(value) ? value : null;
}

/** Classifies what a provider answered (or that it did not). Pure: the same answer always means the same thing. */
export function classifyProviderAnswer(answer: ProviderAnswer, pricing: Pricing = {kind: 'tokens'}): ClassifiedOutcome {
  switch (answer.kind) {
    case 'timeout':
      return {outcome: 'ambiguous', reason: 'timeout', requestId: null};
    case 'transport':
      return {outcome: 'ambiguous', reason: 'transport', requestId: null};
    case 'aborted':
      return {outcome: 'ambiguous', reason: 'aborted', requestId: null};
    case 'response': {
      const requestId = usableRequestId(answer.requestId);
      const {status} = answer;
      if (status >= 200 && status <= 299) {
        if (pricing.kind === 'request') {
          // A per-request provider reports no tokens: the request itself is the priced unit, and the model is the one the reservation pinned.
          return modelPattern.test(pricing.model)
            ? {outcome: 'completed', requestId, usage: {inputTokens: 0, outputTokens: 0, returnedModel: pricing.model}}
            : {outcome: 'ambiguous', reason: 'no_usage', requestId};
        }
        const usage = answer.usage;
        if (usage && wholeTokens(usage.inputTokens) && wholeTokens(usage.outputTokens) && typeof usage.returnedModel === 'string' && modelPattern.test(usage.returnedModel)) {
          return {outcome: 'completed', requestId, usage: {inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, returnedModel: usage.returnedModel}};
        }
        return {outcome: 'ambiguous', reason: 'no_usage', requestId};
      }
      if (definitiveRejections.includes(status)) {
        // Proven only by the provider's own request ID: without one nothing says the request was refused before it was processed.
        return requestId !== null ? {outcome: 'noncharge', requestId, status} : {outcome: 'ambiguous', reason: 'no_request_id', requestId: null};
      }
      return {outcome: 'ambiguous', reason: 'provider_error', requestId};
    }
  }
}
