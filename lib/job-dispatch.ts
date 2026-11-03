// Story 2.7. Dispatch: how an accepted Job's attempt reaches the step that runs it, and the step itself.
//
//   The numbers       `dispatchConstants` mirrors the recorded constants of the database (the `jobs.*` constant functions); a test holds the two equal.
//   Publishing        every attempt has an OUTBOX row that committed with it. The request that accepted the Job publishes it at once (`publishSubmitted`, best effort: a failure leaves
//                     the row for the sweep), and the minute sweep publishes the rows older than 15 seconds that are still unpublished (`runOutboxSweep`). A message is
//                     `{attempt, instance}` to `<APP_ORIGIN>/api/dispatch`, published with `retries: 0` (a failed attempt is never retried by the queue) and the OUTBOX ID as its
//                     deduplication ID, and then the row records the message ID once (`markPublished`). So the request and the sweep can race: the queue deduplicates by the ID and the
//                     row takes one message ID, never two. The queue carries nothing but an opaque reference; it authorizes nothing.
//   The route         `POST /api/dispatch` (app/api/dispatch/route.ts is a one-line caller of `handleDispatchRequest`) is a MACHINE path like /api/jobs: no cookie, no CSRF token and no
//                     browser Origin; the queue's signature, checked over the raw body, is the only authentication. It claims the attempt as the BUILT-IN step and runs the deterministic
//                     test workload. A duplicate delivery gets `already_claimed` and does nothing; a finished attempt is never reclaimed.
//   The workload      for each planned operation, in order: begin its own step and dispatch its operation (`runStep`), then record its completion with 1 input and 1 output token and
//                     the requested model (`finishOperation`: the reservation is settled as evidence and its unused remainder released). With no operation it begins the one step `work`.
//                     Then it finishes the attempt `completed` with `sha256('nova3d-test-workload:v1:' + the input digest)`, or `failed` when the plan says `fail`, after dispatching its
//                     first operation (which stays chargeable). Every call after the claim presents the fence; if one is refused (the user cancelled, the lease ran out, the Account was
//                     disabled, the Project changed) the workload stops and nothing more is started.
//
// The order of the route's checks is part of the contract, and each one stops everything after it, so a foreign or invalid call claims nothing:
//   1. method       not POST                                                          405
//   2. keys         the current or the next signing key is not set                    503
//   3. signature    no `Upstash-Signature` header (or an absurdly long one)           401   (the body is not read)
//   4. raw body     over 1 KB, a content-length that is not a number or is over       400
//                   the cap, not UTF-8, or a stream that fails
//   5. signature    the header does not verify the raw body with the current key     401
//                   and then the next
//   6. body         not JSON of exactly {attempt, instance}, or an attempt that is   400
//                   not an ID
//   7. environment  the body's instance is not this environment's INSTANCE_ID, or    403 wrong_environment (a database that does not answer is 503)
//                   checkInstanceIdentity fails
//   8. claim, run   200 {outcome: ran | duplicate | not_waiting | waiting_for_worker | blocked | incompatible | revoked | unavailable, ...}; the database not answering is 503
// Every answer is `no-store`. Nothing from the request is logged or reflected, and neither a signature nor a key is ever put in an answer.
//
// The signature is checked with `Receiver` from the provider's SDK and `devMode: false`: the SDK otherwise switches to signing keys that are published in its own source when
// QSTASH_DEV is set, which would let anyone sign a call. (The destination the signature names is not bound to this route: deferred-work.md.)
//
// SERVER-ONLY. Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import {createHash} from 'node:crypto';
import {Client, Receiver} from '@upstash/qstash';
import type {AccountsOptions} from './accounts.ts';
import {appOriginProblem, checkInstanceIdentity, isPlaceholder, type Env} from './environment.ts';
import {
  claimAttempt,
  claimOutbox,
  finishAttempt,
  finishOperation,
  markPublished,
  runStep,
  submitJob,
  sweepAttempts,
  type AttemptSweep,
  type ClaimedAttempt,
  type JobSubmission,
  type OutboxRow,
} from './job-commands.ts';
import type {Operation} from './authority.ts';

/** The recorded constants of the database (the `jobs.*` constant functions), mirrored; a test holds the two equal. Seconds, Jobs, versions. */
export const dispatchConstants = {
  /** How long a lease lasts from its claim or latest renewal. */
  leaseSeconds: 120,
  /** How often a worker renews its lease (the worker's duty; nothing here enforces it). */
  renewalSeconds: 30,
  /** How old an unpublished outbox row is before the sweep publishes it. */
  publishGraceSeconds: 15,
  /** How long a publisher holds an outbox row it claimed. */
  publishLeaseSeconds: 60,
  /** How many Jobs with an open attempt an Account may have. */
  openJobLimit: 3,
  /** The age of an unpublished outbox row above which the `outbox-age` alarm is raised. */
  outboxAlarmSeconds: 120,
  /** How long a live lease has been expired before the `lease-expired-unclaimed` alarm is raised. */
  leaseAlarmSeconds: 300,
  /** The version of the built-in step, the application step that runs the test workload. */
  builtinVersion: 1,
  /** The one kind of Job that is accepted and that the built-in step runs. */
  builtinKind: 'test_workload',
} as const;

/** The one path a dispatch message calls. lib/public-paths.ts names it as a machine path. */
export const dispatchPath = '/api/dispatch';

/** The most outbox rows one sweep publishes. */
export const sweepPublishLimit = 20;

/** The message a dispatch carries: an opaque reference to the attempt and the environment it is for. */
export type DispatchMessage = {attempt: string; instance: string};

// Publishing ------------------------------------------------------------------------------------------------------------------------------------

/** What the queue answers to a publication: the message ID it holds the message under. */
export type PublishReceipt = {messageId: string};

/** Publishes one dispatch message. The real one is the queue's client; the tests pass their own, which records and can fail. */
export type Publisher = (message: {url: string; body: DispatchMessage; deduplicationId: string}) => Promise<PublishReceipt>;

/** The publisher and the address it publishes to, or null when any of the queue's token, the queue's region endpoint, the application's origin or its instance is unset. */
export type PublishingConfig = {publish: Publisher; url: string; instanceId: string};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configured publishing, or null. It never throws and never says which part is missing. */
export function configuredPublishing(env: Env = process.env): PublishingConfig | null {
  const token = env.QSTASH_TOKEN?.trim();
  const baseUrl = env.QSTASH_URL?.trim();
  const origin = env.APP_ORIGIN?.trim();
  const instanceId = env.INSTANCE_ID?.trim().toLowerCase();
  if (!token || !baseUrl || !origin || !instanceId) return null;
  if (isPlaceholder(token) || isPlaceholder(baseUrl) || isPlaceholder(origin) || isPlaceholder(instanceId)) return null;
  if (!uuidPattern.test(instanceId) || appOriginProblem(origin, env.APP_ENV) !== null) return null;
  const client = new Client({token, baseUrl, devMode: false});
  const publish: Publisher = async ({url, body, deduplicationId}) => {
    // retries: 0, the outbox ID as the deduplication ID: a failed dispatch is never retried by the queue, and a message published twice is held once.
    const response = await client.publishJSON({url, body, retries: 0, deduplicationId});
    return {messageId: response.messageId};
  };
  return {publish, url: `${origin}${dispatchPath}`, instanceId};
}

/** How a publication went: the rows published now, and those the queue refused (their lease runs out and the next sweep publishes them). */
export type PublishReport = {published: number; failed: number};

async function publishRow(row: OutboxRow, config: PublishingConfig, accounts: AccountsOptions): Promise<boolean> {
  try {
    const receipt = await config.publish({url: config.url, body: {attempt: row.attemptId, instance: config.instanceId}, deduplicationId: row.id});
    // A row that already holds another message ID was published by someone else first (the queue deduplicated this one): either way it is published, once.
    await markPublished({outboxId: row.id, messageId: receipt.messageId}, accounts);
    return true;
  } catch {
    return false;
  }
}

/** Publishes the rows a claim returned, each on its own: one the queue refuses is counted and the rest go on. Nothing here throws. */
export async function publishRows(rows: readonly OutboxRow[], config: PublishingConfig, accounts: AccountsOptions = {}): Promise<PublishReport> {
  let published = 0;
  let failed = 0;
  for (const row of rows) {
    if (await publishRow(row, config, accounts)) published += 1;
    else failed += 1;
  }
  return {published, failed};
}

/**
 * Publishes the outbox row of a Job the request has just accepted, at once. Best effort, and it never throws: with no queue configured, a row another publisher holds, or a queue
 * that refuses, it answers a word and the row waits for the minute sweep (which publishes what is older than 15 seconds). `published`, `skipped` (nothing to publish: another
 * publisher holds the row or it is already published) or `failed`.
 */
export async function publishSubmitted(
  outboxId: string,
  options: {config?: PublishingConfig | null; accounts?: AccountsOptions; env?: Env} = {},
): Promise<'published' | 'skipped' | 'failed'> {
  try {
    const config = options.config === undefined ? configuredPublishing(options.env) : options.config;
    if (config === null) return 'failed';
    const rows = await claimOutbox({limit: 1, outboxId}, options.accounts ?? {});
    if (rows.length === 0) return 'skipped';
    const report = await publishRows(rows, config, options.accounts ?? {});
    return report.published === 1 ? 'published' : 'failed';
  } catch {
    return 'failed';
  }
}

/** What accepting a Job and publishing it answered: the submission, and how the publication went (`null` when nothing was accepted, so there is nothing to publish). */
export type SubmittedAndPublished = {submission: JobSubmission; publication: 'published' | 'skipped' | 'failed' | null};

/**
 * Accepts a Job (api.submit_job: the Job, its planned operations and reservations and its outbox row, all in one commit) and publishes its dispatch AT ONCE, as the request
 * that accepted it does. The publication is best effort and never throws: a queue that is not configured or refuses leaves the committed row for the minute sweep, which
 * publishes every row older than 15 seconds. A replayed submission publishes too (the row may never have been published; a published row is `skipped`).
 */
export async function submitAndPublish(
  operation: Operation,
  input: Parameters<typeof submitJob>[1],
  options: {config?: PublishingConfig | null; accounts?: AccountsOptions; env?: Env} = {},
): Promise<SubmittedAndPublished> {
  const submission = await submitJob(operation, input, options.accounts ?? {});
  if (submission.outcome !== 'accepted' && submission.outcome !== 'replayed') return {submission, publication: null};
  return {submission, publication: await publishSubmitted(submission.outboxId, options)};
}

/** What one run of the minute sweep did. */
export type OutboxSweepReport = {
  expired: number;
  cancelled: number;
  settled: number;
  /** Dispatched operations of ended attempts the sweep marked `ambiguous` (the 24-hour clock started). */
  marked: number;
  /** Ambiguous operations the sweep settled at their 24-hour deadline. */
  reconciled: number;
  /** Operations the sweep could not move or settle and skipped (each runs in its own sub-block). */
  failed: number;
  claimed: number;
  published: number;
  publishFailed: number;
  configured: boolean;
};

/**
 * The minute task `outbox-sweep`: the database's sweep (leases past their expiry end and their attempts fail as `lease_lost`; the attempts of a disabled Account or a moved epoch are
 * cancelled; what never went out is released; a dispatched operation of an ended attempt becomes ambiguous; an ambiguous one past 24 hours is settled at its reservation), then the publication of the unpublished rows older than 15 seconds. With no queue configured the rows are left alone (claiming them
 * would only hold them for a minute). A publication the queue refuses is counted and the row is claimed again after its 60-second lease. A database sweep that fails does not stop
 * the publication; it is thrown after it.
 */
export async function runOutboxSweep(options: {config?: PublishingConfig | null; accounts?: AccountsOptions; env?: Env} = {}): Promise<OutboxSweepReport> {
  const accounts = options.accounts ?? {};
  // The two halves are independent: a dispatch must not wait for a lease to be cleaned up. If the database's sweep fails, the rows are still claimed and published, and the run
  // fails at the end (the error is thrown as it was, so the receipt records its class), so the task is visibly failed and the scheduler retries it.
  let sweepFailure: { error: unknown } | null = null;
  let swept: AttemptSweep = {expired: 0, cancelled: 0, settled: 0, marked: 0, reconciled: 0, failed: 0};
  try {
    swept = await sweepAttempts(accounts);
  } catch (error) {
    sweepFailure = {error};
  }
  const config = options.config === undefined ? configuredPublishing(options.env) : options.config;
  let report: OutboxSweepReport = {...swept, claimed: 0, published: 0, publishFailed: 0, configured: false};
  if (config !== null) {
    const rows = await claimOutbox({limit: sweepPublishLimit}, accounts);
    const published = await publishRows(rows, config, accounts);
    report = {...swept, claimed: rows.length, published: published.published, publishFailed: published.failed, configured: true};
  }
  if (sweepFailure !== null) throw sweepFailure.error;
  return report;
}

// The workload ---------------------------------------------------------------------------------------------------------------------------------

/** The digest a completed test workload publishes: `sha256('nova3d-test-workload:v1:' + the input digest)`, in hex. */
export function workloadResultDigest(inputDigest: string): string {
  return createHash('sha256').update(`nova3d-test-workload:v1:${inputDigest}`, 'utf8').digest('hex');
}

/** How the test workload ended: `completed`, `failed` (the plan said so), `rejected` (the result's inputs were stale), or `stopped` (a fenced command was refused: nothing more ran). */
export type WorkloadEnd = {end: 'completed' | 'failed' | 'rejected' | 'stopped'; refusal: string | null};

/**
 * Runs the deterministic test workload for a claimed attempt, under its fence. Nothing here retries: a refusal stops the workload where it is.
 */
export async function runTestWorkload(claim: ClaimedAttempt, accounts: AccountsOptions = {}): Promise<WorkloadEnd> {
  const operations = claim.plan.operations ?? [];
  const fails = claim.plan.outcome === 'fail';
  const fenced = {attemptId: claim.attemptId, fence: claim.fence};
  const stopped = (refusal: string): WorkloadEnd => ({end: 'stopped', refusal});

  if (operations.length === 0) {
    const step = await runStep({...fenced, stepKey: 'work'}, accounts);
    if (step.outcome !== 'stepped' && step.outcome !== 'replayed') return stopped(step.outcome);
  }
  for (const operation of operations) {
    const step = await runStep({...fenced, stepKey: operation.stepKey, ordinal: operation.ordinal}, accounts);
    if (step.outcome !== 'stepped' && step.outcome !== 'replayed') return stopped(step.outcome);
    // The plan says fail: the first operation is dispatched, and the attempt fails there. The dispatched operation stays chargeable.
    if (fails) break;
    if (step.operationId === null) return stopped('not_planned');
    const done = await finishOperation(
      {...fenced, operationId: step.operationId, outcome: 'completed', usage: {inputTokens: 1, outputTokens: 1, returnedModel: operation.model}},
      accounts,
    );
    if (done.outcome !== 'finished') return stopped(done.outcome);
  }

  if (fails) {
    const failed = await finishAttempt({...fenced, to: 'failed'}, accounts);
    return failed.outcome === 'finished' || failed.outcome === 'replayed' ? {end: 'failed', refusal: null} : stopped(failed.outcome);
  }
  const finished = await finishAttempt({...fenced, to: 'completed', resultDigest: workloadResultDigest(claim.inputDigest)}, accounts);
  if (finished.outcome === 'finished' || finished.outcome === 'replayed') return {end: 'completed', refusal: null};
  if (finished.outcome === 'rejected') return {end: 'rejected', refusal: null};
  return stopped(finished.outcome);
}

// The route -------------------------------------------------------------------------------------------------------------------------------------

/** The most of a body that is read: a call carries {"attempt","instance"}, far less than this. */
export const maxDispatchBodyBytes = 1024;

const signatureHeader = 'Upstash-Signature';
const maxSignatureLength = 4096;
/** How many seconds of difference between the queue's clock and this one the signature's own times may show. */
const clockToleranceSeconds = 5;

const headers = {'cache-control': 'no-store'};
const answer = (status: number, body: Record<string, string>, extra: Record<string, string> = {}) => Response.json(body, {status, headers: {...headers, ...extra}});

export type DispatchRequestOptions = {
  /** The environment; the process's by default. */
  env?: Env;
  /** The database calls' options (a fetch, a deadline). `env` above is the environment the calls use. */
  accounts?: Omit<AccountsOptions, 'env'>;
};

/** The signing keys, or null when either is not set (a placeholder is not a key). */
function signingKeys(env: Env): {current: string; next: string} | null {
  const current = env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const next = env.QSTASH_NEXT_SIGNING_KEY?.trim();
  if (!current || !next || isPlaceholder(current) || isPlaceholder(next)) return null;
  return {current, next};
}

type RawBody = {text: string} | {problem: 'too_large' | 'unreadable'};

/** The body as text, reading at most the cap and one chunk more. Anything longer, or not UTF-8, or a stream that fails, is a problem and not a body. */
async function readRawBody(request: Request): Promise<RawBody> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxDispatchBodyBytes)) return {problem: 'too_large'};
  if (!request.body) return {text: ''};
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxDispatchBodyBytes) {
        await reader.cancel().catch(() => undefined);
        return {problem: 'too_large'};
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {text: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
  } catch {
    return {problem: 'unreadable'};
  }
}

/** Whether the queue signed exactly this body with the current key or the next. The keys are known to be set, so whatever the check throws is a verdict on the call: never access. */
async function isSigned(signature: string, body: string, keys: {current: string; next: string}): Promise<boolean> {
  const receiver = new Receiver({currentSigningKey: keys.current, nextSigningKey: keys.next, devMode: false});
  try {
    return await receiver.verify({signature, body, clockTolerance: clockToleranceSeconds});
  } catch {
    return false;
  }
}

/** The attempt and instance of a body that is exactly {"attempt", "instance"}, both strings and the attempt an ID, or null. */
function parseBody(text: string): DispatchMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed).sort();
  const {attempt, instance} = parsed as Record<string, unknown>;
  if (keys.length !== 2 || keys[0] !== 'attempt' || keys[1] !== 'instance' || typeof attempt !== 'string' || typeof instance !== 'string' || instance.length > 64) return null;
  if (!uuidPattern.test(attempt)) return null;
  return {attempt: attempt.toLowerCase(), instance};
}

/**
 * Answers one call of the dispatch route. It never throws: a call it cannot answer is a 503, and the outbox row it came from is already marked published, so the failure
 * is visible and nothing is lost silently (a published dispatch that could not be claimed is not redelivered: deferred-work.md).
 */
export async function handleDispatchRequest(request: Request, options: DispatchRequestOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  const accounts: AccountsOptions = {...options.accounts, env};
  try {
    // 1. Method.
    if (request.method !== 'POST') return answer(405, {error: 'method_not_allowed'}, {allow: 'POST'});

    // 2. Keys. Without both, nothing can be verified, and the answer is never a success.
    const keys = signingKeys(env);
    if (!keys) return answer(503, {error: 'unavailable'});

    // 3. Signature, over the raw body. A call with no signature is refused before its body is read.
    const signature = request.headers.get(signatureHeader);
    if (!signature || signature.length > maxSignatureLength) return answer(401, {error: 'unauthorized'});
    const raw = await readRawBody(request);
    if ('problem' in raw) return answer(400, {error: 'invalid_request'});
    if (!(await isSigned(signature, raw.text, keys))) return answer(401, {error: 'unauthorized'});

    // 4. The body. The call is authentic from here on; it is still held to what it must say.
    const body = parseBody(raw.text);
    if (body === null) return answer(400, {error: 'invalid_request'});

    // 5. Environment: this call is for this instance, and the database's instance identity row says so too.
    const instanceId = env.INSTANCE_ID?.trim().toLowerCase();
    if (!instanceId || body.instance.trim().toLowerCase() !== instanceId) return answer(403, {error: 'wrong_environment'});
    const identity = await checkInstanceIdentity(env, accounts.fetch, {hashKeys: [], mail: false});
    if (identity.errors.length) return identity.retryable ? answer(503, {error: 'unavailable'}) : answer(403, {error: 'wrong_environment'});

    // 6. The claim, as the built-in step, and the run.
    let claimed;
    try {
      claimed = await claimAttempt({attemptId: body.attempt}, accounts);
    } catch {
      return answer(503, {error: 'unavailable'});
    }
    if (claimed.outcome === 'already_claimed') return answer(200, {outcome: 'duplicate'});
    if (claimed.outcome === 'not_waiting') return answer(200, {outcome: 'not_waiting'});
    if (claimed.outcome !== 'claimed') return answer(200, {outcome: claimed.outcome});
    try {
      const end = await runTestWorkload(claimed.claim, accounts);
      return answer(200, {outcome: 'ran', end: end.end});
    } catch {
      // The workload could not finish (the database did not answer): the lease will run out and the sweep fails the attempt. Nothing retries by itself.
      console.error('A dispatched test workload could not be finished.');
      return answer(503, {error: 'unavailable'});
    }
  } catch {
    // Nothing above throws on purpose; this is the answer to what none of it foresaw, and it holds nothing of the request.
    return answer(503, {error: 'unavailable'});
  }
}
