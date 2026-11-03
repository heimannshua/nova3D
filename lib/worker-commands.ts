// Story 2.7. The signed worker endpoint's one definition: `POST /api/workers` (app/api/workers/route.ts is a one-line caller of `handleWorkerRequest`).
//
// A worker (the CAD worker, the engine worker, and the test worker that stands in for them) never touches the database and holds no service key. It asks the application, with a
// SIGNED command, to register itself, to claim an attempt, to renew its lease, to begin a step, to report an operation's outcome and to finish the attempt. Nothing is pushed to
// a worker: workers claim. The route is a MACHINE path like /api/jobs (lib/public-paths.ts): no cookie, no CSRF token, no browser Origin; the signed token is the only authentication.
//
//   POST /api/workers     Authorization: Bearer <token>     one JSON command, at most 8 KB
//
// The token is a service token (lib/service-signing.ts) with `typ: "worker-command"`, issued by `cad-worker` or `engine-worker` to `application`, and signed with that issuer's own
// key, verified against `SERVICE_KEYS_<ISSUER>` (the issuer's PUBLIC key set: not secret, optional in the application) and this environment's INSTANCE_ID. It carries `cmd`
// (`register`, `claim`, `renew`, `step`, `operation` or `finish`), `dig` (the SHA-256 of the raw body, so the token vouches for exactly those bytes), and the claims its command
// needs: `att` (the attempt), `wid` (the registered worker that claims), `fence` (the fencing token the claim handed out) and `rev` (the Project revision a result was computed
// from). The VERIFIED issuer goes to the database with a claim, so a worker ID of another issuer is `incompatible`, and `rev` goes with a completion, so a result computed from a
// revision other than the one the attempt is bound to is `rejected` (409). It lives at most 300 seconds and its `iat` may be at most 60 seconds ahead. The body carries the rest of the command; the claims are never repeated in it.
//
// The order of the checks is part of the contract; each one stops everything after it, and a refused call writes nothing and says nothing about why:
//   1. method        not POST (over HTTP Next.js answers these itself)                      405
//   2. origin        an `Origin` header at all (a browser sent it)                          403
//   3. configuration INSTANCE_ID is unset                                                   503
//   4. size          a token or a body over its cap, or a stream that fails                 401 {error: "invalid_token"}: ONE answer for every verification failure
//   5. token         no `Authorization: Bearer <token>`, or one that does not verify        401
//                    (shape, issuer, audience, environment, the issuer's active key or its
//                    retiring key before its `until`, signature, lifetime, skew, expiry)
//                    or whose claims are not exactly a worker command's
//   6. digest        `dig` is not the SHA-256 of the raw body                               401
//   7. record        api.record_callback(jti, issuer, kid, ...): a replayed `jti`, or a     401
//                    revoked key (refused under the shared key lock, as a heartbeat is)
//                    the database did not answer                                            503
//   8. body          not exactly the JSON the command takes                                 400
//   9. run           the command: 200 {state: <outcome>, ...}; a command the database       409 {state: <outcome>}
//                    refuses (a wrong fence, a lease that ended or ran out, a revoked
//                    epoch, a Project that is gone) answers with the outcome's word
//                    the database did not answer                                            503
// Every answer is `no-store`. Nothing from the request is logged or reflected.
//
// The command is then the database's to judge: it checks the lease by fence, that it has not ended or expired, that the attempt is running, that the Account's authority holds with
// the epoch the attempt is bound to, and that the Project is live, before anything lands (docs/authority-contract.md, "Dispatch and leases").
//
// SERVER-ONLY. Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import type {AccountsOptions} from './accounts.ts';
import {isPlaceholder, type Env} from './environment.ts';
import {
  claimAttempt,
  finishAttempt,
  finishOperation,
  planToWire,
  recordCallback,
  registerWorker,
  renewLease,
  runStep,
  type OperationUsage,
} from './job-commands.ts';
import {
  bodyDigest,
  isWorkerIssuer,
  keySetVariable,
  maxTokenLength,
  parseKeySet,
  verifyToken,
  workerCommandClaimsOf,
  type ParsedKeySet,
  type WorkerCommandClaims,
  type WorkerIssuer,
} from './service-signing.ts';

/** The most of a body that is read. A command is a few hundred bytes. */
export const maxWorkerBodyBytes = 8192;

const headers = {'cache-control': 'no-store'};
const answer = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) => Response.json(body, {status, headers: {...headers, ...extra}});
const invalidToken = () => answer(401, {error: 'invalid_token'});
const unavailable = () => answer(503, {error: 'unavailable'});
const invalidRequest = () => answer(400, {error: 'invalid_request'});
/** A command the database refused: the word of its outcome, and nothing else but what the worker needs to act on it. */
const refused = (state: string, extra: Record<string, unknown> = {}) => answer(409, {state, ...extra});

export type WorkerRequestOptions = {
  /** The environment; the process's by default. */
  env?: Env;
  /** The database calls' options (a fetch, a deadline). `env` above is the environment the calls use. */
  accounts?: Omit<AccountsOptions, 'env'>;
  /** Seconds since the epoch; now by default. The tests pin it. */
  now?: () => number;
};

/** The public key set of an issuer, parsed and checked, or null when it is unset, a placeholder or unusable. */
function keySetOf(env: Env, issuer: WorkerIssuer): ParsedKeySet | null {
  const text = env[keySetVariable(issuer)]?.trim();
  if (!text || isPlaceholder(text)) return null;
  const parsed = parseKeySet(text, issuer);
  return parsed.ok ? parsed.keySet : null;
}

type RawBody = {bytes: Uint8Array} | {problem: 'too_large' | 'unreadable'};

/** The body's bytes, reading at most the cap and one chunk more. */
async function readBody(request: Request): Promise<RawBody> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxWorkerBodyBytes)) return {problem: 'too_large'};
  if (!request.body) return {bytes: new Uint8Array(0)};
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxWorkerBodyBytes) {
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
    return {bytes};
  } catch {
    return {problem: 'unreadable'};
  }
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
function tokenOf(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null || header.length > maxTokenLength + 10) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match ? match[1] : null;
}

/**
 * The issuer a token names, read WITHOUT trusting it: only to choose which public key set to verify with. `verifyToken` then insists that the issuer is the one it was given, so a
 * token that names an issuer it was not signed by is refused there.
 */
function claimedIssuer(token: string): WorkerIssuer | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const issuer = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>).iss : undefined;
    return isWorkerIssuer(issuer) ? issuer : null;
  } catch {
    return null;
  }
}

// The commands' bodies ----------------------------------------------------------------------------------------------------------------------

type Body = Record<string, unknown>;

function parseJson(bytes: Uint8Array): Body | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Body) : null;
}

const hasOnly = (body: Body, required: readonly string[], optional: readonly string[] = []) => {
  const keys = Object.keys(body);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
};

/** What a worker command asks of the database, once its token and its body agree. Anything the types cannot hold is `null`: a bad request. */
type Command =
  | {cmd: 'register'; worker: {workerKind: string; version: number; imageDigest: string; kinds: string[]}}
  | {cmd: 'claim'; attemptId: string; workerId: string}
  | {cmd: 'renew'; attemptId: string; fence: string}
  | {cmd: 'step'; attemptId: string; fence: string; stepKey: string; ordinal: number | null}
  | {cmd: 'operation'; attemptId: string; fence: string; operationId: string; outcome: 'completed'; usage: OperationUsage}
  | {cmd: 'operation'; attemptId: string; fence: string; operationId: string; outcome: 'noncharge'; requestId: string}
  | {cmd: 'operation'; attemptId: string; fence: string; operationId: string; outcome: 'ambiguous'; requestId: string | null}
  | {cmd: 'finish'; attemptId: string; fence: string; revision: number; to: 'completed' | 'failed'; resultDigest: string | null};

function commandOf(claims: WorkerCommandClaims, body: Body): Command | null {
  switch (claims.cmd) {
    case 'register': {
      if (!hasOnly(body, ['worker_kind', 'version', 'image_digest', 'kinds'])) return null;
      const {worker_kind: workerKind, version, image_digest: imageDigest, kinds} = body;
      if (typeof workerKind !== 'string' || typeof version !== 'number' || typeof imageDigest !== 'string' || !Array.isArray(kinds) || kinds.some((kind) => typeof kind !== 'string')) return null;
      return {cmd: 'register', worker: {workerKind, version, imageDigest, kinds: kinds as string[]}};
    }
    case 'claim':
      return hasOnly(body, []) ? {cmd: 'claim', attemptId: claims.att, workerId: claims.wid} : null;
    case 'renew':
      return hasOnly(body, []) ? {cmd: 'renew', attemptId: claims.att, fence: claims.fence} : null;
    case 'step': {
      if (!hasOnly(body, ['step_key'], ['ordinal'])) return null;
      const {step_key: stepKey, ordinal} = body;
      if (typeof stepKey !== 'string' || (ordinal !== undefined && ordinal !== null && typeof ordinal !== 'number')) return null;
      return {cmd: 'step', attemptId: claims.att, fence: claims.fence, stepKey, ordinal: typeof ordinal === 'number' ? ordinal : null};
    }
    case 'operation': {
      const {operation, outcome} = body;
      if (typeof operation !== 'string') return null;
      if (outcome === 'completed') {
        if (!hasOnly(body, ['operation', 'outcome', 'input_tokens', 'output_tokens', 'returned_model'])) return null;
        const {input_tokens: inputTokens, output_tokens: outputTokens, returned_model: returnedModel} = body;
        if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number' || typeof returnedModel !== 'string') return null;
        return {cmd: 'operation', attemptId: claims.att, fence: claims.fence, operationId: operation, outcome, usage: {inputTokens, outputTokens, returnedModel}};
      }
      if (outcome === 'noncharge') {
        if (!hasOnly(body, ['operation', 'outcome', 'request_id'])) return null;
        const {request_id: requestId} = body;
        return typeof requestId === 'string' ? {cmd: 'operation', attemptId: claims.att, fence: claims.fence, operationId: operation, outcome, requestId} : null;
      }
      if (outcome === 'ambiguous') {
        // The outcome of a request that went out and whose answer is unknown (a timeout, a 5xx, a lost connection): the request ID is whatever the provider returned, if anything.
        if (!hasOnly(body, ['operation', 'outcome'], ['request_id'])) return null;
        const {request_id: requestId} = body;
        if (requestId !== undefined && requestId !== null && typeof requestId !== 'string') return null;
        return {cmd: 'operation', attemptId: claims.att, fence: claims.fence, operationId: operation, outcome, requestId: typeof requestId === 'string' ? requestId : null};
      }
      return null;
    }
    case 'finish': {
      if (!hasOnly(body, ['to'], ['result_digest'])) return null;
      const {to, result_digest: resultDigest} = body;
      if ((to !== 'completed' && to !== 'failed') || (resultDigest !== undefined && resultDigest !== null && typeof resultDigest !== 'string')) return null;
      return {cmd: 'finish', attemptId: claims.att, fence: claims.fence, revision: claims.rev, to, resultDigest: typeof resultDigest === 'string' ? resultDigest : null};
    }
  }
}

/** Runs a command and answers it. A TypeError (a value the typed call refuses) is a bad request; anything else is the database not answering. */
async function run(command: Command, accounts: AccountsOptions, issuer: WorkerIssuer): Promise<Response> {
  switch (command.cmd) {
    case 'register': {
      const registration = await registerWorker({issuer, ...command.worker}, accounts);
      if (registration.outcome === 'superseded') return refused('superseded', {version: registration.version});
      return answer(200, {state: registration.outcome, worker: registration.workerId, version: registration.version, retired: registration.retired});
    }
    case 'claim': {
      const claimed = await claimAttempt({attemptId: command.attemptId, workerId: command.workerId, issuer}, accounts);
      if (claimed.outcome === 'claimed' || claimed.outcome === 'replayed') {
        const claim = claimed.claim;
        return answer(200, {
          state: claimed.outcome,
          attempt: claim.attemptId,
          job: claim.jobId,
          kind: claim.kind,
          fence: claim.fence,
          expires_at: claim.expiresAt,
          plan: planToWire(claim.plan),
          input_digest: claim.inputDigest,
          revision: claim.projectRevision,
          epoch: claim.accountEpoch,
          worker_version: claim.workerVersion,
        });
      }
      return refused(claimed.outcome, claimed.outcome === 'not_waiting' ? {attempt_state: claimed.state} : {});
    }
    case 'renew': {
      const renewed = await renewLease({attemptId: command.attemptId, fence: command.fence}, accounts);
      return renewed.outcome === 'renewed' ? answer(200, {state: 'renewed', expires_at: renewed.expiresAt}) : refused(renewed.outcome);
    }
    case 'step': {
      const stepped = await runStep({attemptId: command.attemptId, fence: command.fence, stepKey: command.stepKey, ordinal: command.ordinal}, accounts);
      if (stepped.outcome === 'stepped' || stepped.outcome === 'replayed') {
        return answer(200, {state: stepped.outcome, step: stepped.stepId, operation: stepped.operationId, operation_state: stepped.operationState});
      }
      return refused(stepped.outcome);
    }
    case 'operation': {
      const base = {attemptId: command.attemptId, fence: command.fence, operationId: command.operationId};
      const finished = await finishOperation(
        command.outcome === 'completed'
          ? {...base, outcome: 'completed', usage: command.usage}
          : command.outcome === 'noncharge'
            ? {...base, outcome: 'noncharge', requestId: command.requestId}
            : {...base, outcome: 'ambiguous', requestId: command.requestId},
        accounts,
      );
      if (finished.outcome !== 'finished') return refused(finished.outcome);
      return answer(200, {
        state: 'finished',
        operation: finished.operationId,
        operation_state: finished.state,
        settled_microdollars: finished.settlement?.settledMicrodollars ?? null,
        released_microdollars: finished.settlement?.releasedMicrodollars ?? null,
      });
    }
    case 'finish': {
      const finished = await finishAttempt({attemptId: command.attemptId, fence: command.fence, to: command.to, resultDigest: command.resultDigest, revision: command.revision}, accounts);
      if (finished.outcome === 'finished' || finished.outcome === 'replayed') return answer(200, {state: finished.outcome, attempt_state: finished.attempt.state});
      return refused(finished.outcome);
    }
  }
}

/** Answers one call of the worker route. It never throws: a call it cannot answer is a 503, which a worker may send again with a new token. */
export async function handleWorkerRequest(request: Request, options: WorkerRequestOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  const accounts: AccountsOptions = {...options.accounts, env};
  try {
    // 1. Method.
    if (request.method !== 'POST') return answer(405, {error: 'method_not_allowed'}, {allow: 'POST'});

    // 2. Origin: a browser, which has no business here, names one. A worker does not.
    if (request.headers.get('origin') !== null) return answer(403, {error: 'forbidden_origin'});

    // 3. Configuration. Without the instance nothing can be verified, and the answer is never a success.
    const instanceId = env.INSTANCE_ID?.trim().toLowerCase();
    if (!instanceId || isPlaceholder(instanceId)) return unavailable();

    // 4. Size.
    const raw = await readBody(request);
    if ('problem' in raw) return invalidToken();

    // 5. The token: one answer for every way it can fail.
    const token = tokenOf(request);
    if (token === null) return invalidToken();
    const issuer = claimedIssuer(token);
    if (issuer === null) return invalidToken();
    const keySet = keySetOf(env, issuer);
    if (keySet === null) return invalidToken();
    const verified = await verifyToken(token, {
      issuer,
      audience: 'application',
      environment: instanceId,
      keySet,
      now: (options.now ?? (() => Date.now() / 1000))(),
      type: 'worker-command',
    });
    if (!verified.ok) return invalidToken();
    const claims = workerCommandClaimsOf(verified.payload);
    if (claims === null) return invalidToken();

    // 6. The digest: the token vouches for exactly these bytes.
    const digest = bodyDigest(raw.bytes);
    if (claims.dig !== digest) return invalidToken();

    // 7. The record: the database refuses a revoked key and a jti it has seen, and nothing else is written before it.
    let recorded;
    try {
      recorded = await recordCallback(
        {jti: verified.payload.jti, issuer, kid: verified.kid, typ: 'worker-command', command: claims.cmd, attemptId: 'att' in claims ? claims.att : null, digest},
        accounts,
      );
    } catch (error) {
      if (error instanceof TypeError) return invalidToken();
      console.error('A worker command could not be recorded.');
      return unavailable();
    }
    if (recorded.outcome !== 'recorded') return invalidToken();

    // 8. The body.
    const body = parseJson(raw.bytes);
    const command = body === null ? null : commandOf(claims, body);
    if (command === null) return invalidRequest();

    // 9. The command.
    try {
      return await run(command, accounts, issuer);
    } catch (error) {
      if (error instanceof TypeError) return invalidRequest();
      console.error('A worker command could not be run.');
      return unavailable();
    }
  } catch {
    // Nothing above throws on purpose; this is the answer to what none of it foresaw, and it holds nothing of the request.
    return unavailable();
  }
}
