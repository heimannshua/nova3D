// Story 1.9. The scheduled-job route's one definition: `POST /api/jobs` (app/api/jobs/route.ts is a one-line caller of `handleJobRequest`).
//
// A QStash schedule fires a task by calling this route with the body {"task": <registered id>, "instance": <INSTANCE_ID>} and a signature
// header. The signature is the ONLY authentication: the route is a machine path (lib/public-paths.ts), so the proxy lets it through with no
// session and no browser Origin, and no CSRF cookie exists for it. ALL provider code lives in this file (the structural test bans the
// provider's name and Redis under app/): the header names, the signature check, nothing else anywhere.
//
// The order of the checks is part of the contract, and each one stops everything after it, so a foreign or invalid call runs nothing and
// writes no receipt. The raw body is read (to its 1 KB cap) BEFORE the signature is verified, because the signature is over those bytes, so a
// body the route cannot read to its end within the cap is a 400 even though no signature was checked; a call with no signature header at all
// never has its body read, and a well-formed call that does not verify is a 401:
//
//   1. method          not POST                                                          405
//   2. keys            the current or the next signing key is not set                    503
//   3. signature       no `Upstash-Signature` header (or an absurdly long one)           401   (the body is not read)
//   4. raw body        over 1 KB, a content-length that is not a number or is over       400   (even when unsigned or wrongly signed:
//                      the cap, not UTF-8, or a stream that fails                                the signature was never checked)
//   5. signature       the header does not verify the raw body with the current key     401
//                      and then the next
//   6. body, headers   not JSON of exactly {task, instance}, an unknown task, or no      400
//                      message ID or no schedule ID (a message that is not from a
//                      schedule is refused)
//   7. environment     the body's instance is not this environment's INSTANCE_ID, or     403 wrong_environment
//                      checkInstanceIdentity fails (a database that does not answer
//                      is 503, not 403)
//   8. claim           api.claim_job_run: duplicate 200, running 409, no answer 503
//   9. run             the task: 200 {outcome: ran | idle | no_store}; it threw: 500, and
//                      503 when the receipt cannot be finished (a retry is right)
//
// The statuses are the story's and are not chosen for what the scheduler does with them: QStash retries ANY answer outside 200 to 299 (the
// SDK's own documentation says so), a 4xx included, until its retry count is spent; the provider's way to say "do not retry" is a 489 with
// `Upstash-NonRetryable-Error: true`, which this route does not use. So a refused call is retried too, and each retry is refused the same way
// and writes nothing.
//
// The idempotency key is the (schedule ID, message ID) pair: QStash documents no scheduled-time header and a retry of a delivery keeps its
// message ID. Two messages for one slot are covered by each task being idempotent. Every run that is claimed writes a receipt, finished
// once (lifecycle.job_receipts), holding counts and class names only.
//
// The signature is checked over the RAW body (at most 1 KB is read), with `Receiver` from the provider's SDK and `devMode: false`: the SDK
// otherwise switches to signing keys that are published in its own source when QSTASH_DEV is set, which would let anyone sign a call.
// Nothing from the request is logged, and neither a signature nor a key is ever reflected in an answer.
//
// SERVER-ONLY. Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import {Receiver} from '@upstash/qstash';
import type {AccountsOptions} from './accounts.ts';
import {checkInstanceIdentity, isPlaceholder, type Env} from './environment.ts';
import {runTask, type TaskContext} from './job-tasks.ts';
import {claimJobRun, finishJobRun, isJobResult, type JobClaim} from './lifecycle.ts';
import {isScheduledTask, type ScheduledTask} from './schedules.ts';

/** The most of a body that is read: a call carries {"task","instance"}, far less than this. */
export const maxJobBodyBytes = 1024;

const signatureHeader = 'Upstash-Signature';
const messageIdHeader = 'Upstash-Message-Id';
const scheduleIdHeader = 'Upstash-Schedule-Id';
const maxSignatureLength = 4096;
const idPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
const classNamePattern = /^[A-Z][A-Za-z]{0,47}$/;
/** How many seconds of difference between QStash's clock and this one the signature's own times may show. */
const clockToleranceSeconds = 5;

const headers = {'cache-control': 'no-store'};
const answer = (status: number, body: Record<string, string>, extra: Record<string, string> = {}) => Response.json(body, {status, headers: {...headers, ...extra}});

export type JobRequestOptions = {
  /** The environment; the process's by default. */
  env?: Env;
  /** The database calls' options (a fetch, a deadline). `env` above is the environment the calls use. */
  accounts?: Omit<AccountsOptions, 'env'>;
  /** Runs the task; the tasks of lib/job-tasks.ts by default. The tests pass their own to make one fail. */
  run?: typeof runTask;
  /** What the task needs besides the environment (the ledger store); the configured one by default. */
  task?: Pick<TaskContext, 'ledgerStore'>;
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
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxJobBodyBytes)) return {problem: 'too_large'};
  if (!request.body) return {text: ''};
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxJobBodyBytes) {
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

/**
 * Whether the provider signed exactly this body with the current key or the next. The keys are known to be set (step 2), so whatever the
 * check throws (a signature that does not verify, a token with no body claim) is a verdict on the call: never access.
 */
async function isSigned(signature: string, body: string, keys: {current: string; next: string}): Promise<boolean> {
  const receiver = new Receiver({currentSigningKey: keys.current, nextSigningKey: keys.next, devMode: false});
  try {
    return await receiver.verify({signature, body, clockTolerance: clockToleranceSeconds});
  } catch {
    return false;
  }
}

/** The task and instance of a body that is exactly {"task", "instance"}, both strings, or null. */
function parseBody(text: string): {task: string; instance: string} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed).sort();
  const {task, instance} = parsed as Record<string, unknown>;
  if (keys.length !== 2 || keys[0] !== 'instance' || keys[1] !== 'task' || typeof task !== 'string' || typeof instance !== 'string' || instance.length > 64) return null;
  return {task, instance};
}

/** The error's class name when it is one a receipt may hold, and `Error` otherwise. Never its message. */
function classOf(error: unknown): string {
  return error instanceof Error && classNamePattern.test(error.name) ? error.name : 'Error';
}

/**
 * Answers one call of the scheduled-job route. It never throws: a call it cannot answer is a 503 or a 500, which QStash retries.
 */
export async function handleJobRequest(request: Request, options: JobRequestOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  const accounts: AccountsOptions = {...options.accounts, env};
  const run = options.run ?? runTask;
  try {
    // 1. Method.
    if (request.method !== 'POST') return answer(405, {error: 'method_not_allowed'}, {allow: 'POST'});

    // 2. Keys. Without both, nothing can be verified, and the answer is never a success.
    const keys = signingKeys(env);
    if (!keys) return answer(503, {error: 'unavailable'});

    // 3. Signature, over the raw body. A call with no signature is refused before its body is read. A body that cannot be read to its end
    //    within the cap has no signature that can be checked: it is a bad body (400, even if the signature is wrong), as is one that is not UTF-8.
    const signature = request.headers.get(signatureHeader);
    if (!signature || signature.length > maxSignatureLength) return answer(401, {error: 'unauthorized'});
    const raw = await readRawBody(request);
    if ('problem' in raw) return answer(400, {error: 'invalid_request'});
    if (!(await isSigned(signature, raw.text, keys))) return answer(401, {error: 'unauthorized'});

    // 4. Body and headers. The call is authentic from here on; it is still held to what it must say.
    const body = parseBody(raw.text);
    const messageId = request.headers.get(messageIdHeader);
    const scheduleId = request.headers.get(scheduleIdHeader);
    if (body === null || !isScheduledTask(body.task) || !messageId || !idPattern.test(messageId) || !scheduleId || !idPattern.test(scheduleId)) {
      return answer(400, {error: 'invalid_request'});
    }
    const task: ScheduledTask = body.task;

    // 5. Environment: this call is for this instance, and the database's instance identity row says so too.
    const instanceId = env.INSTANCE_ID?.trim().toLowerCase();
    if (!instanceId || body.instance.trim().toLowerCase() !== instanceId) return answer(403, {error: 'wrong_environment'});
    const identity = await checkInstanceIdentity(env, accounts.fetch, {hashKeys: [], mail: false});
    if (identity.errors.length) return identity.retryable ? answer(503, {error: 'unavailable'}) : answer(403, {error: 'wrong_environment'});

    // 6. The claim. Nothing has run and nothing is written until it is made.
    let claim: JobClaim;
    try {
      claim = await claimJobRun({task, scheduleId, messageId}, accounts);
    } catch {
      return answer(503, {error: 'unavailable'});
    }
    if (claim.outcome === 'duplicate') return answer(200, {outcome: 'duplicate'});
    if (claim.outcome === 'running') return answer(409, {outcome: 'running'});

    // 7. The run, then the receipt's one finish.
    let ran: Awaited<ReturnType<typeof runTask>> | null = null;
    let failure = 'Error';
    try {
      ran = await run(task, {instanceId, accounts, ...options.task});
      // A receipt holds counts and words only: a result that is anything else is a failed run, not a receipt that cannot be finished.
      if (!isJobResult(ran.result)) throw new TypeError('a task answered a result a receipt cannot hold');
    } catch (error) {
      ran = null;
      failure = classOf(error);
    }
    try {
      const finished = await finishJobRun({receiptId: claim.receiptId, outcome: ran ? ran.outcome : 'failed', result: ran ? ran.result : {error_class: failure}}, accounts);
      // `already_finished` is harmless: the receipt of this run holds an outcome (an earlier delivery of a slow run finished it first). But
      // `not_found` means no finished receipt exists for this run at all, and a success would be a run with nothing to show for it.
      if (finished.outcome === 'not_found') throw new Error('the receipt of this run does not exist');
    } catch {
      // The receipt could not be finished (the database did not answer, or it holds no such receipt): a retry is right. It finds the unfinished
      // receipt, which the lease replaces, and the task is idempotent.
      return answer(ran ? 503 : 500, ran ? {error: 'unavailable'} : {outcome: 'failed'});
    }
    if (!ran) {
      // The class of the failure is a name, never a message; the task is one of the registered ones.
      console.error('A scheduled task failed.', task, failure);
      return answer(500, {outcome: 'failed'});
    }
    return answer(200, {outcome: ran.outcome});
  } catch {
    // Nothing above throws on purpose; this is the answer to what none of it foresaw, and it holds nothing of the request.
    return answer(503, {error: 'unavailable'});
  }
}
