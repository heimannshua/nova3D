// Story 1.12. Issuing a transfer ticket: what `POST /api/transfers/tickets` does once the route's guard has let a signed-in Account through.
//
// A ticket is the application's signed permission to OPEN one transfer at the file gateway (workers/files): `{ticket, gateway}` is the answer, and the
// browser then talks to the gateway directly (the file never passes through a Vercel function, which caps a body at 4.5 MB). It is valid for five minutes
// (the default and the most), single use, and bound to the verified Account, the session grant and the Account's authorization epoch (all the
// database's, from the verified access, never from the request), to one direction, one kind of target and one target ID, and for an upload to the class,
// length, SHA-256 and content type the gateway then holds the bytes to. It holds no storage credential, no URL and nothing reusable.
//
// The request is one JSON object of at most 4 KiB:
//   {"direction": "upload", "kind": "staging", "id": "<UUID the caller chooses>", "class": "picture" | "file", "length": <bytes>, "sha256": "<hex>", "contentType": "<type>"}
//   {"direction": "download", "kind": "staging", "id": "<UUID>"}
// and nothing else (an unknown member is a bad request). A kind with no resolver at the gateway (lib/service-signing.ts `transferTargetKinds`) is refused
// here, 400, and again by the gateway.
//
// This module reads no environment variable: the route passes `process.env` in. Without the application's keys or the gateway's address the answer is 503
// (fail closed), and nothing is signed. Erasable TypeScript syntax and relative `.ts` imports. It logs nothing.
import type {ActiveAccess} from './access.ts';
import type {Env} from './environment.ts';
import {signingConfigOf} from './gateway-client.ts';
import {isSha256Hex, isTransferTargetKind, isUuid, signTicket, transferLimits, uploadProblem, type TicketClaims} from './service-signing.ts';

/** The most of a request body that is read. */
export const maxTicketBodyBytes = 4096;

const headers = {'cache-control': 'no-store'};
const answer = (status: number, body: Record<string, unknown>) => Response.json(body, {status, headers});

type RawBody = {text: string} | {problem: 'too_large' | 'unreadable'};

/** The body as text, reading at most the cap and one chunk more. Anything longer, or not UTF-8, or a stream that fails, is a problem and not a body. */
async function readRawBody(request: Request): Promise<RawBody> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxTicketBodyBytes)) return {problem: 'too_large'};
  if (!request.body) return {text: ''};
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxTicketBodyBytes) {
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

export type TicketRequest =
  | {direction: 'download'; kind: string; id: string}
  | {direction: 'upload'; kind: string; id: string; class: 'picture' | 'file'; length: number; sha256: string; contentType: string};

export type TicketRequestResult = {ok: true; request: TicketRequest} | {ok: false; status: 400; error: 'invalid_request' | 'unknown_target'; field?: string};

const bad = (field?: string): TicketRequestResult => ({ok: false, status: 400, error: 'invalid_request', ...(field ? {field} : {})});

/** Reads the one JSON object a ticket request is, strictly: exactly the members of its direction, each of the right shape. */
export function parseTicketRequest(text: string): TicketRequestResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return bad();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return bad();
  const body = parsed as Record<string, unknown>;
  const names = Object.keys(body).sort().join();
  const {direction, kind, id} = body;
  if (direction !== 'upload' && direction !== 'download') return bad('direction');
  if (typeof kind !== 'string') return bad('kind');
  if (!isUuid(id)) return bad('id');
  if (direction === 'download') {
    if (names !== ['direction', 'id', 'kind'].join()) return bad();
    return isTransferTargetKind(kind) ? {ok: true, request: {direction, kind, id}} : {ok: false, status: 400, error: 'unknown_target'};
  }
  if (names !== ['class', 'contentType', 'direction', 'id', 'kind', 'length', 'sha256'].join()) return bad();
  if (!isSha256Hex(body.sha256)) return bad('sha256');
  // The limits are the gateway's, written once (lib/service-signing.ts `uploadProblem`) and checked here so that a ticket it would refuse is never made.
  const problem = uploadProblem({cls: body.class, len: body.length, ct: body.contentType});
  if (problem !== null) return bad(problem === 'class' ? 'class' : problem === 'content_type' ? 'contentType' : 'length');
  if (!isTransferTargetKind(kind)) return {ok: false, status: 400, error: 'unknown_target'};
  return {
    ok: true,
    request: {direction, kind, id, class: body.class as 'picture' | 'file', length: body.length as number, sha256: body.sha256, contentType: body.contentType as string},
  };
}

export type IssueOptions = {
  /** Seconds since the epoch; now by default. The tests pin it. */
  now?: number;
};

/**
 * Issues a ticket for the signed-in Account, or answers why not: 503 when the application's keys or the gateway's address are not configured, 413 when
 * the body is over 4 KiB, 400 when it is not a ticket request or names a kind with no resolver. The Account, the session grant and the epoch come from
 * `access` (the verified, live authorization of this very request); nothing about them is read from the request.
 */
export async function issueTransferTicket(request: Request, access: ActiveAccess, env: Env, options: IssueOptions = {}): Promise<Response> {
  const config = signingConfigOf(env);
  if (!config) return answer(503, {error: 'unavailable'});

  const raw = await readRawBody(request);
  if ('problem' in raw) return answer(raw.problem === 'too_large' ? 413 : 400, {error: raw.problem === 'too_large' ? 'payload_too_large' : 'invalid_request'});
  const parsed = parseTicketRequest(raw.text);
  if (!parsed.ok) return answer(parsed.status, {error: parsed.error, ...(parsed.field ? {field: parsed.field} : {})});

  const {request: wanted} = parsed;
  const who = {acct: access.account.accountId, sid: access.user.sessionId, epoch: access.account.epoch, tk: wanted.kind, tid: wanted.id};
  const claims: TicketClaims =
    wanted.direction === 'upload'
      ? {...who, dir: 'upload', cls: wanted.class, len: wanted.length, sha: wanted.sha256, ct: wanted.contentType}
      : {...who, dir: 'download'};
  const ticket = signTicket(config.signer, config.instanceId, claims, {lifetimeSeconds: transferLimits.ticketSeconds, ...(options.now === undefined ? {} : {now: options.now})});
  return answer(200, {ticket, gateway: config.gateway});
}
