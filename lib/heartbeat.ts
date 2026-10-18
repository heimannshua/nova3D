// Story 1.13. The heartbeat route's one definition: `POST /api/heartbeat` (app/api/heartbeat/route.ts is a one-line caller of `handleHeartbeatRequest`).
//
// Each scheduler watches the other. The monitor runs on QStash, so it cannot see QStash stop; the application therefore evaluates `qstash-stale` when the
// Railway cron task (workers/heartbeat) posts its signed heartbeat, every 30 minutes, and the monitor evaluates `heartbeat-stale`. This one signed call is both
// the heartbeat and the "ask for the latest receipt" of the story: it answers how old the latest scheduler receipt is, and a worker that is refused exits
// non-zero, so Railway marks the run failed as well.
//
// The route is a MACHINE path like /api/jobs (lib/public-paths.ts): no cookie, no CSRF token, no browser Origin; the signed token is the only authentication.
//   POST /api/heartbeat     Authorization: Heartbeat <token>     a body of at most 16 bytes, ignored
// The token is a service token (lib/service-signing.ts) with `typ: "heartbeat"`, `iss: "heartbeat"`, `aud: "application"` and no claim beyond the standard
// ones, verified with `verifyToken` against `SERVICE_KEYS_HEARTBEAT` (the heartbeat issuer's PUBLIC key set: not secret, optional in the application) and
// this environment's INSTANCE_ID. The order of the checks is part of the contract; each one stops everything after it, so a refused call records nothing:
//
//   1. method          not POST (over HTTP Next.js answers these itself, see the route)    405
//   2. origin          an `Origin` header at all (a browser sent it)                   403
//   3. configuration   the key set or INSTANCE_ID is unset or unusable                 503
//   4. token           no `Authorization: Heartbeat <token>`, or one that does not     401 {error: "invalid_token"}: ONE body for every token failure
//                      verify (size, shape, issuer, audience, environment, key,
//                      signature, lifetime, expiry) or carries a claim beyond the
//                      standard ones, or a `jti` or key ID the database would refuse
//   5. body            over 16 bytes, a content-length that is not a number or is      400
//                      over the cap, or a stream that fails
//   6. record          api.record_heartbeat(kid, jti): a revoked key                   401 {error: "invalid_token"}
//                      a repeated jti                                                  409 {state: "duplicate"}
//                      the database did not answer                                     503
//   7. evaluate        `qstash-stale` is evaluated, raised or resolved, the email that    200 {state: "recorded", receipt_age_seconds: n | null}
//                      is due is sent; the database failing to observe, to raise or      503 (never a 200 that skipped the evaluation)
//                      resolve, or to list what is due (a mail that is refused, or
//                      whose notice cannot be recorded, is counted and is retried at
//                      the next evaluation: the evaluation itself ran, so it is a 200)
//
// Every answer is `no-store`. Nothing from the request is logged or reflected, and nothing is logged but fixed words.
//
// SERVER-ONLY. Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import type {AccountsOptions} from './accounts.ts';
import {runHeartbeatEvaluation, type MonitorDeps} from './alarms.ts';
import {isPlaceholder, type Env} from './environment.ts';
import {recordHeartbeat} from './lifecycle.ts';
import {heartbeatClaimsOf, keySetVariable, parseKeySet, verifyToken, type ParsedKeySet} from './service-signing.ts';

/** The most of a body that is read: the call has none that means anything, so this is a sanity cap. */
export const maxHeartbeatBodyBytes = 16;

/**
 * The shapes `api.record_heartbeat` accepts for the token's `jti` and the key ID (the same patterns as the function and the table's checks). A token whose
 * signature verifies but whose `jti` or key ID the database would refuse (a 22023, which would otherwise surface as a 503 for a call that is not the
 * application's fault) is an invalid token: the same 401, and the database is not asked.
 */
const recordableJti = /^[A-Za-z0-9_-]{22}$/;
const recordableKid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The scheme of the `Authorization` header: `Heartbeat <token>`. */
export const heartbeatScheme = 'Heartbeat';

const headers = {'cache-control': 'no-store'};
const answer = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) => Response.json(body, {status, headers: {...headers, ...extra}});
const invalidToken = () => answer(401, {error: 'invalid_token'});

/** The heartbeat issuer's public key set text, or null when `SERVICE_KEYS_HEARTBEAT` is unset, blank or a placeholder. */
function keySetText(env: Env): string | null {
  const text = env[keySetVariable('heartbeat')]?.trim();
  return text && !isPlaceholder(text) ? text : null;
}

/**
 * Whether the Railway heartbeat is configured for this deployment: `SERVICE_KEYS_HEARTBEAT` is set. The monitor evaluates `heartbeat-stale` only then (without
 * a heartbeat configured there is none to be late), and the route answers 503 without it.
 */
export function isHeartbeatConfigured(env: Env): boolean {
  return keySetText(env) !== null;
}

/** The heartbeat key set, parsed and checked, or null when it is unset or unusable. */
function keySetOf(env: Env): ParsedKeySet | null {
  const text = keySetText(env);
  if (text === null) return null;
  const parsed = parseKeySet(text, 'heartbeat');
  return parsed.ok ? parsed.keySet : null;
}

type RawBody = {bytes: number} | {problem: 'too_large' | 'unreadable'};

/** How long the body is, reading at most the cap and one chunk more. Its content is never looked at. */
async function readBody(request: Request): Promise<RawBody> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxHeartbeatBodyBytes)) return {problem: 'too_large'};
  if (!request.body) return {bytes: 0};
  try {
    const reader = request.body.getReader();
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxHeartbeatBodyBytes) {
        await reader.cancel().catch(() => undefined);
        return {problem: 'too_large'};
      }
    }
    return {bytes: total};
  } catch {
    return {problem: 'unreadable'};
  }
}

/** The token of an `Authorization: Heartbeat <token>` header, or null. */
function tokenOf(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null || header.length > 4200) return null;
  const match = /^Heartbeat ([^\s]+)$/.exec(header);
  return match ? match[1] : null;
}

export type HeartbeatRequestOptions = {
  /** The environment; the process's by default. */
  env?: Env;
  /** The database calls' options (a fetch, a deadline). `env` above is the environment the calls use. */
  accounts?: Omit<AccountsOptions, 'env'>;
  /** Seconds since the epoch; now by default. The tests pin it. */
  now?: () => number;
  /** The alarm path's injections (the sender, the registry of conditions); the real ones by default. */
  alarms?: Omit<MonitorDeps, 'accounts'>;
};

/**
 * Answers one call of the heartbeat route. It never throws: a call it cannot answer is a 503, which the Railway task reports as a failed run.
 */
export async function handleHeartbeatRequest(request: Request, options: HeartbeatRequestOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  const accounts: AccountsOptions = {...options.accounts, env};
  try {
    // 1. Method.
    if (request.method !== 'POST') return answer(405, {error: 'method_not_allowed'}, {allow: 'POST'});

    // 2. Origin: a browser, which has no business here, names one. A worker does not.
    if (request.headers.get('origin') !== null) return answer(403, {error: 'forbidden_origin'});

    // 3. Configuration. Without the key set or the instance nothing can be verified, and the answer is never a success.
    const keySet = keySetOf(env);
    const instanceId = env.INSTANCE_ID?.trim().toLowerCase();
    if (!keySet || !instanceId || isPlaceholder(instanceId)) return answer(503, {error: 'unavailable'});

    // 4. The token: one answer for every way it can fail.
    const token = tokenOf(request);
    if (token === null) return invalidToken();
    const verified = await verifyToken(token, {
      issuer: 'heartbeat',
      audience: 'application',
      environment: instanceId,
      keySet,
      now: (options.now ?? (() => Date.now() / 1000))(),
      type: 'heartbeat',
    });
    if (!verified.ok || heartbeatClaimsOf(verified.payload) === null) return invalidToken();
    if (typeof verified.payload.jti !== 'string' || !recordableJti.test(verified.payload.jti) || !recordableKid.test(verified.kid)) return invalidToken();

    // 5. The body, which means nothing and is held to its cap.
    if ('problem' in (await readBody(request))) return answer(400, {error: 'invalid_request'});

    // 6. The record: the database refuses a revoked key and a jti it has seen.
    let recorded;
    try {
      recorded = await recordHeartbeat({kid: verified.kid, jti: verified.payload.jti}, accounts);
    } catch {
      console.error('A heartbeat could not be recorded.');
      return answer(503, {error: 'unavailable'});
    }
    if (recorded.outcome === 'revoked') return invalidToken();
    if (recorded.outcome === 'duplicate') return answer(409, {state: 'duplicate'});

    // 7. The evaluation of what this heartbeat is for, then the email that is due.
    try {
      const report = await runHeartbeatEvaluation({heartbeatConfigured: true, ...options.alarms, accounts, mail: {env, ...options.alarms?.mail}});
      return answer(200, {state: 'recorded', receipt_age_seconds: report.receiptAge});
    } catch {
      console.error('A heartbeat could not be evaluated.');
      return answer(503, {error: 'unavailable'});
    }
  } catch {
    // Nothing above throws on purpose; this is the answer to what none of it foresaw, and it holds nothing of the request.
    return answer(503, {error: 'unavailable'});
  }
}
