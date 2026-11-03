// Story 2.8: the two halves of an external operation that sit around the one provider request. SERVER-ONLY (it calls lib/job-commands.ts, which holds the service role).
//
//   BEFORE the request: `markDispatched` is what the adapters call (lib/providers/adapters.ts) before they send anything. It commits the operation's identity under the attempt's
//   fence (`run_step`, which dispatches only an operation that is planned AND reserved) and answers true only for `stepped` or `replayed`. Anything else, a refusal of the fence
//   included, is false, and then nothing is sent: a request never goes out before its identity is committed.
//
//   AFTER the request: `reportOutcome` records what the adapter's classified answer means through `finish_operation`, under the same fence:
//     completed  -> `completed`: the operation moves and settles as evidence, the unused remainder released. A report the database REFUSES (the returned model is not the pinned one,
//                   the evidence cannot be priced, the period's total would pass its bound, or a settlement already exists) is reported `ambiguous` instead: the whole reservation
//                   stays held and the 24-hour deadline, or later evidence, settles it. The request is never repeated.
//     noncharge  -> `noncharge` with the provider's request ID (settled 0, the whole reservation released); a refused report is `ambiguous` too.
//     ambiguous  -> `ambiguous`, with the provider's request ID when it sent one: settles nothing and keeps the reservation.
//     disabled / rejected -> nothing went out, so nothing is reported.
//
// Nothing here makes a request to a provider, retries one, or logs anything: the request ID, the tokens and the key stay where they were put. If a call to the database throws an
// AccountsUnavailableError with `outcomeUnknown`, the report may or may not have landed: send the SAME report again, which is safe (the command IDs are derived from the operation
// and the outcome, so a duplicate finds its receipt) and still sends nothing to the provider.
import {finishOperation, runStep, type OperationFinish} from '@/lib/job-commands';
import type {AdapterConfig, AdapterResult} from '@/lib/providers/adapters';
import type {AccountsOptions} from '@/lib/accounts';

/** Where the operation lives: its attempt and fence (the claim's), and the step and ordinal the plan named for it. */
export type OperationSite = {attemptId: string; fence: string; stepKey: string; ordinal: number};

/**
 * The adapters' `markDispatched`: commits the dispatched identity of the operation BEFORE any request is made. True only when the database answered `stepped` (the step began and the
 * operation is dispatched) or `replayed` (it already was, under this fence) AND the operation it answered about is the one the adapter named (`identity.operationId`): a site
 * whose step and ordinal lead to another operation commits that other operation's identity, and this one has none, so the answer is false. False too for everything else (a refused
 * fence, an operation that is not planned or not reserved, a database that did not answer), and an adapter that gets false sends nothing.
 */
export function markDispatchedFor(site: OperationSite, accounts: AccountsOptions = {}): AdapterConfig['markDispatched'] {
  return async (identity) => {
    try {
      const stepped = await runStep({attemptId: site.attemptId, fence: site.fence, stepKey: site.stepKey, ordinal: site.ordinal}, accounts);
      return (stepped.outcome === 'stepped' || stepped.outcome === 'replayed') && stepped.operationId === identity.operationId;
    } catch {
      // Not knowing is not committed: nothing is sent.
      return false;
    }
  };
}

/** What was reported: the outcome that reached the database, and its answer. `none` when nothing went out, so there is nothing to report. */
export type ReportedOutcome =
  | {reported: 'none'}
  | {reported: 'completed' | 'noncharge' | 'ambiguous'; finish: OperationFinish; /** A `completed` or `noncharge` report the database refused and that was reported `ambiguous` instead. */ downgraded: boolean};

/**
 * Reports a classified adapter answer for the operation under the attempt's fence. A `completed` or `noncharge` report that the database refuses is reported `ambiguous`; an
 * `ambiguous` report is never downgraded or repeated beyond the one retry-safe call. Throws only what the database layer throws (the caller may send the same report again).
 */
export async function reportOutcome(
  site: Pick<OperationSite, 'attemptId' | 'fence'> & {operationId: string},
  result: AdapterResult<unknown>,
  accounts: AccountsOptions = {},
): Promise<ReportedOutcome> {
  const base = {attemptId: site.attemptId, fence: site.fence, operationId: site.operationId};
  if (result.outcome === 'disabled' || result.outcome === 'rejected') return {reported: 'none'};
  if (result.outcome === 'ambiguous') {
    return {reported: 'ambiguous', finish: await finishOperation({...base, outcome: 'ambiguous', requestId: result.requestId}, accounts), downgraded: false};
  }
  const finish =
    result.outcome === 'completed'
      ? await finishOperation({...base, outcome: 'completed', usage: {inputTokens: result.inputTokens, outputTokens: result.outputTokens, returnedModel: result.returnedModel}}, accounts)
      : await finishOperation({...base, outcome: 'noncharge', requestId: result.requestId}, accounts);
  if (finish.outcome === 'finished') return {reported: result.outcome, finish, downgraded: false};
  // The database refused to settle it (the model is not the pinned one, the evidence cannot be priced, the period's total would overflow, or a settlement exists): the
  // charge is unknown, so it is reported ambiguous and holds its whole reservation. The request is NOT made again.
  if (finish.outcome === 'invalid_evidence' || finish.outcome === 'overflow' || finish.outcome === 'already_settled') {
    return {reported: 'ambiguous', finish: await finishOperation({...base, outcome: 'ambiguous', requestId: result.requestId}, accounts), downgraded: true};
  }
  // A fence refusal or a state that cannot take the report: it stands as the database answered it.
  return {reported: result.outcome, finish, downgraded: false};
}
