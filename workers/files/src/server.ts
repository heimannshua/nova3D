// The file gateway's HTTP server (plain node:http). `createGatewayServer(deps)` is the whole of it, so a test starts it in-process on a loopback
// port with a real database role and real Storage, or with fakes.
//
//   GET  /healthz                         liveness (no database read: the start-up check is what proved the environment)
//   PUT  /v1/uploads/<id>                 an upload, authorized by `Authorization: Ticket <token>`
//   GET  /v1/files/<kind>/<id>            a download or ONE range, authorized by `Authorization: Ticket <token>`
//   GET  /d/<ticket>                      a browser-native download: 303 to /h/<handle>/<id>
//   GET  /h/<handle>/<id>                 the handle's own target, ranges and the browser's own resume, for at most 30 minutes
//   POST /v1/commands                     an application-signed command (`Authorization: Command <token>`): attach, delete-staging, delete-root
//
// THE RULES (docs/authority-contract.md, "The file gateway"):
//   * A ticket authorizes OPENING one transfer. Redeeming it inserts its `jti` (a replay fails) and a transfer handle bound to the session grant,
//     the Account, the epoch, the target, the direction and the signing key. Resuming, or reading another range, needs a new ticket.
//   * BEFORE EVERY CHUNK of at most 1 MiB, in both directions, the gateway reads `artifacts.session_authority` (through the handle) and the target's
//     state through its resolver, in Postgres, and never caches the answer. Anything but `allowed` stops the transfer: 503 before bytes when the
//     database does not answer, a closed stream after. Bytes already delivered are not recalled.
//   * No cookie is held or set. Every response is `Cache-Control: no-store` with `X-Content-Type-Options: nosniff`. Cross-origin calls are answered
//     only for APP_ORIGIN (one allowed origin, `Vary: Origin`, no wildcard, no credentials) and any other `Origin` is 403. A command with ANY
//     `Origin` is refused: the application sends it from its server, never from a browser.
//   * Nothing is logged but an error's class name: no ticket, handle, URL, key or body.
import {createHash, randomBytes} from 'node:crypto';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {canonicalize} from '../../../lib/canonical-json.ts';
import {
  commandClaimsOf,
  isUploadTicket,
  maxTokenLength,
  ticketClaimsOf,
  transferLimits,
  uploadProblem,
  verifyToken,
  type CommandClaims,
  type ParsedKeySet,
  type TicketClaims,
} from '../../../lib/service-signing.ts';
import type {AttachmentReceipt, GatewayDatabase} from './database.ts';
import {createResolvers, type Direction, type ResolvedTarget, type Resolvers} from './resolvers.ts';
import {MissingObject, type GatewayStorage, type StoredBody} from './storage.ts';
import {blocks, handleHashOf, leadingBytesMatch, newHandle, parseRange} from './transfer.ts';

export type GatewayDeps = {
  /** The environment's INSTANCE_ID: the `env` every token must carry. */
  instanceId: string;
  /** The one origin a browser may call from. */
  appOrigin: string;
  /** The application issuer's public keys. */
  keySet: ParsedKeySet;
  database: GatewayDatabase;
  storage: GatewayStorage;
  /** The registry of target kinds; the default holds `staging`. The tests add a fixture. */
  resolvers?: Resolvers;
  /** The time; injectable so a test can show a handle at 29 and 31 minutes. */
  clock?: () => Date;
  random?: (size: number) => Buffer;
  /** Where an error's class name is printed (never a request). */
  log?: (message: string, detail: string) => void;
  hooks?: {
    /** Called before the authorization of each chunk (the first is `index` 0). Used by the tests to change the world between two chunks. */
    beforeChunk?: (chunk: {direction: Direction; index: number}) => void | Promise<void>;
  };
};

const headerTimeoutMs = 15_000;
const idleSocketMs = 120_000;
const requestTimeoutMs = 30 * 60_000;
/** How much of a request that was refused before its ticket was believed is read before the connection is cut. */
const smallBody = 64 * 1024;
const maxCommandBody = 1024;

const uuidText = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const routes = {
  health: /^\/healthz$/,
  upload: new RegExp(`^/v1/uploads/(${uuidText})$`),
  file: new RegExp(`^/v1/files/([a-z][a-z0-9-]{0,31})/(${uuidText})$`),
  browser: /^\/d\/([A-Za-z0-9_.-]{1,4096})$/,
  handle: new RegExp(`^/h/([A-Za-z0-9_-]{43})/(${uuidText})$`),
  commands: /^\/v1\/commands$/,
};

type Reason = 'forbidden' | 'unavailable' | 'ended' | 'content' | 'checksum' | 'short' | 'too_long';

/** Why an upload stopped, thrown out of the body's stream so the object is never completed. */
class Halt extends Error {
  readonly reason: Reason;
  constructor(reason: Reason) {
    super('the transfer stopped');
    this.name = 'Halt';
    this.reason = reason;
  }
}

/** A stored object ended before the length the response promised. Thrown inside the download so it is logged by name and the response is cut. */
class ShortRead extends Error {
  constructor() {
    super('the stored object ended before the length that was promised');
    this.name = 'ShortRead';
  }
}

type Transfer = {hash: Buffer; accountId: string; targetKind: string; targetId: string; direction: Direction};
type Target = Extract<ResolvedTarget, {outcome: 'allowed'}>;
type Decision = {outcome: 'allowed'; target: Target} | {outcome: 'denied' | 'unavailable' | 'unreachable'};
type Refusal = {status: number; error: string};
type Admission = {kid: string; jti: string; exp: number; claims: TicketClaims};
type Opened = {ok: true; transfer: Transfer; handle: string} | ({ok: false} & Refusal);

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Reads a request body to its end, discarding it, and cuts the connection if it is longer than `limit`. */
function drain(req: IncomingMessage, limit: number) {
  let seen = 0;
  req.on('error', () => undefined);
  req.on('data', (piece: Buffer) => {
    seen += piece.length;
    if (seen > limit) req.destroy();
  });
  req.resume();
}

/** Writes a chunk, and resolves true once the socket has taken it (waiting for it to drain), false when the client is gone. */
function write(res: ServerResponse, chunk: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    if (res.destroyed || res.writableEnded) return resolve(false);
    if (res.write(chunk)) return resolve(true);
    const finish = (value: boolean) => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      resolve(value);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    res.once('drain', onDrain);
    res.once('close', onClose);
  });
}

const contentLengthOf = (req: IncomingMessage): number | null => {
  const header = req.headers['content-length'];
  if (typeof header !== 'string' || !/^\d{1,12}$/.test(header)) return null;
  return Number(header);
};

export function createGatewayServer(deps: GatewayDeps): Server {
  const {database, storage, instanceId, appOrigin, keySet} = deps;
  const clock = deps.clock ?? (() => new Date());
  const random = deps.random ?? ((size: number) => randomBytes(size));
  const resolvers = deps.resolvers ?? createResolvers();
  const log = deps.log ?? ((message: string, detail: string) => console.error(message, detail));
  const chunkBytes = transferLimits.chunkBytes;
  const afterNow = (seconds: number) => new Date(clock().getTime() + seconds * 1000);

  // Responses -----------------------------------------------------------------------------------------------------------------

  function json(res: ServerResponse, status: number, body: Record<string, unknown>, headers: Record<string, string | number> = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...headers});
    res.end(text);
  }
  const fail = (res: ServerResponse, status: number, error: string, headers: Record<string, string | number> = {}) =>
    json(res, status, {error}, status === 503 ? {'retry-after': 5, ...headers} : headers);

  /**
   * An upload that is refused (before its first byte, or halted on the way: access ended, a revoked key, a lease that went) is answered at once. What the
   * client is still sending is read and thrown away for a little (at most `smallBody` bytes, whatever length it declared: a client that has sent a small
   * body gets to read the answer), and then the connection is cut, whether the ticket was believed or not. A refused upload is never read to its end.
   */
  function refuseUpload(req: IncomingMessage, res: ServerResponse, refusal: Refusal) {
    res.setHeader('connection', 'close');
    fail(res, refusal.status, refusal.error);
    drain(req, smallBody);
    // Once the answer is out, the request's connection is destroyed: nothing more of this upload is read.
    res.once('finish', () => setImmediate(() => req.socket?.destroy()));
  }

  // Tokens --------------------------------------------------------------------------------------------------------------------

  function bearer(req: IncomingMessage, scheme: 'Ticket' | 'Command'): string | null {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const match = new RegExp(`^${scheme} (\\S{1,${maxTokenLength}})$`).exec(header);
    return match ? match[1] : null;
  }

  /**
   * Verifies a token (lib/service-signing.ts `verifyToken`: its order, one refusal). The gateway role may not read the revocations, so a revoked
   * key is refused where the token is REDEEMED (artifacts.guard_redemption), which every transfer and command passes before anything moves.
   */
  async function verified(token: string | null, type: 'ticket' | 'command') {
    if (token === null) return null;
    const result = await verifyToken(token, {issuer: 'application', audience: 'gateway', environment: instanceId, keySet, now: clock().getTime() / 1000, type});
    return result.ok ? result : null;
  }

  /** A verified ticket with exactly the claims of a ticket, or null: the one `invalid_ticket` for everything wrong with it. */
  async function admission(token: string | null): Promise<Admission | null> {
    const result = await verified(token, 'ticket');
    const claims = result ? ticketClaimsOf(result.payload) : null;
    return result && claims ? {kid: result.kid, jti: result.payload.jti, exp: result.payload.exp, claims} : null;
  }

  // Authorization ------------------------------------------------------------------------------------------------------------

  /**
   * The question asked before EVERY chunk, never remembered: is the handle live and its session grant, Account and epoch still allowed
   * (`artifacts.session_authority`), and is the target still there for this direction (its resolver)? A database that does not answer is
   * `unreachable`, which stops the transfer exactly as a denial does.
   */
  async function authorize(transfer: Transfer): Promise<Decision> {
    try {
      const now = clock();
      const handle = await database.authorizeHandle(transfer.hash, now);
      if (handle.outcome !== 'allowed') return {outcome: 'denied'};
      if (handle.accountId !== transfer.accountId || handle.targetKind !== transfer.targetKind || handle.targetId !== transfer.targetId || handle.direction !== transfer.direction) {
        return {outcome: 'denied'};
      }
      const resolver = resolvers.resolver(handle.targetKind);
      if (!resolver) return {outcome: 'unavailable'};
      const target = await resolver(database.query, {accountId: handle.accountId, targetId: handle.targetId, direction: handle.direction, now});
      return target.outcome === 'allowed' ? {outcome: 'allowed', target} : {outcome: 'unavailable'};
    } catch (error) {
      log('The gateway could not authorize a chunk.', error instanceof Error ? error.name : 'unknown failure');
      return {outcome: 'unreachable'};
    }
  }

  const refusalOf = (outcome: 'denied' | 'unavailable' | 'unreachable'): Refusal =>
    outcome === 'denied' ? {status: 403, error: 'forbidden'} : outcome === 'unavailable' ? {status: 404, error: 'not_found'} : {status: 503, error: 'unavailable'};

  /**
   * Redeems a verified ticket and opens its transfer handle, after the checks that need the database: the session grant is live, is the Account's
   * and epoch's the ticket names, and the ticket's `jti` is not taken (a replay, or a revoked key, is refused by the one insert that redeems it).
   * Answers with the status the contract gives each failure.
   */
  async function redeem(ticket: Admission): Promise<Opened> {
    const {claims} = ticket;
    let authority;
    try {
      authority = await database.authority(claims.sid);
    } catch {
      return {ok: false, status: 503, error: 'unavailable'};
    }
    // A session that is not the Account's the ticket names makes a ticket that is not what it claims to be.
    if (!authority || authority.accountId !== claims.acct) return {ok: false, status: 401, error: 'invalid_ticket'};
    if (authority.state !== 'active' || authority.epoch !== claims.epoch) return {ok: false, status: 403, error: 'forbidden'};
    const {handle, hash} = newHandle(random);
    let opened: 'opened' | 'refused';
    try {
      opened = await database.openTransfer({
        jti: ticket.jti,
        kid: ticket.kid,
        accountId: claims.acct,
        sessionId: claims.sid,
        epoch: claims.epoch,
        direction: claims.dir,
        targetKind: claims.tk,
        targetId: claims.tid,
        expiresAt: new Date(ticket.exp * 1000),
        handleHash: hash,
        handleExpiresAt: afterNow(transferLimits.handleSeconds),
        now: clock(),
      });
    } catch {
      return {ok: false, status: 503, error: 'unavailable'};
    }
    if (opened === 'refused') return {ok: false, status: 401, error: 'invalid_ticket'};
    return {ok: true, handle, transfer: {hash, accountId: claims.acct, targetKind: claims.tk, targetId: claims.tid, direction: claims.dir}};
  }

  // Uploads ---------------------------------------------------------------------------------------------------------------------

  async function upload(req: IncomingMessage, res: ServerResponse, id: string) {
    const ticket = await admission(bearer(req, 'Ticket'));
    // A ticket that is not believed has its connection cut after a little: nobody has shown the right to send more.
    if (!ticket || !isUploadTicket(ticket.claims) || ticket.claims.tid !== id) return refuseUpload(req, res, {status: 401, error: 'invalid_ticket'});
    const claims = ticket.claims;
    // An upload goes to staging; a kind with no resolver, or any other kind, is refused here as the route that issued the ticket refuses it.
    if (claims.tk !== 'staging' || !resolvers.resolver(claims.tk)) return refuseUpload(req, res, {status: 400, error: 'unknown_target'});

    const length = contentLengthOf(req);
    if (length === null) return refuseUpload(req, res, {status: 411, error: 'length_required'});
    const problem = uploadProblem(claims);
    if (problem === 'too_large') return refuseUpload(req, res, {status: 413, error: 'payload_too_large'});
    if (problem !== null) return refuseUpload(req, res, {status: 400, error: 'invalid_upload'});
    if (length !== claims.len) return refuseUpload(req, res, {status: 400, error: 'length_mismatch'});
    if (req.headers['content-type'] !== claims.ct) return refuseUpload(req, res, {status: 400, error: 'content_type_mismatch'});
    const declared = req.headers['x-content-sha256'];
    if (typeof declared !== 'string' || declared.toLowerCase() !== claims.sha) return refuseUpload(req, res, {status: 400, error: 'checksum_mismatch'});

    const opened = await redeem(ticket);
    if (!opened.ok) return refuseUpload(req, res, opened);
    const {transfer} = opened;

    let created: 'created' | 'exists' | 'quota_exceeded';
    try {
      created = await database.createLease({
        id,
        accountId: claims.acct,
        kid: ticket.kid,
        kind: claims.cls,
        length: claims.len,
        sha256: claims.sha,
        contentType: claims.ct,
        now: clock(),
        expiresAt: afterNow(transferLimits.leaseSeconds),
        quotaBytes: transferLimits.stagingQuotaBytes,
      });
    } catch {
      return refuseUpload(req, res, {status: 503, error: 'unavailable'});
    }
    if (created === 'exists') return refuseUpload(req, res, {status: 409, error: 'upload_exists'});
    if (created === 'quota_exceeded') return refuseUpload(req, res, {status: 413, error: 'quota_exceeded'});

    const key = `staging/${claims.acct}/${id}`;
    const hasher = createHash('sha256');
    let received = 0;
    let index = 0;
    const stopped: {by: Halt | null} = {by: null};
    const halt = (reason: Reason) => (stopped.by = new Halt(reason));

    // The body, cut into chunks of at most 1 MiB. Each is authorized BEFORE it is counted, hashed or handed to Storage; anything but `allowed`
    // throws, which aborts the multipart upload, so an object that was not authorized to its last byte is never completed.
    async function* chunks() {
      let first = true;
      for await (const block of blocks(req.iterator({destroyOnReturn: false}), chunkBytes)) {
        await deps.hooks?.beforeChunk?.({direction: 'upload', index});
        const decision = await authorize(transfer);
        if (decision.outcome !== 'allowed') throw halt(decision.outcome === 'denied' ? 'forbidden' : decision.outcome === 'unreachable' ? 'unavailable' : 'ended');
        if (first) {
          if (!leadingBytesMatch(claims.ct, block)) throw halt('content');
          first = false;
        }
        received += block.length;
        if (received > claims.len) throw halt('too_long');
        hasher.update(block);
        if (!(await database.progress(id, claims.acct, received, afterNow(transferLimits.leaseSeconds)))) throw halt('ended');
        index += 1;
        yield block;
      }
      if (received !== claims.len) throw halt('short');
      if (hasher.digest('hex') !== claims.sha) throw halt('checksum');
    }

    try {
      await storage.put(key, chunks(), {contentType: claims.ct});
      if (!(await database.complete(id, claims.acct, received, afterNow(transferLimits.leaseSeconds)))) {
        // The lease ended while the last bytes were landing (it was released, or its key revoked): the object is not kept.
        throw halt('ended');
      }
      return json(res, 201, {id, length: received, sha256: claims.sha});
    } catch (error) {
      // A failed upload deletes its partial object and releases its lease. Either may itself fail (the database that stopped it may still be
      // down): the lease then simply expires and the cleanup finds it.
      await storage.delete(key).catch(() => undefined);
      await database.release(id, claims.acct).catch(() => undefined);
      const reason = stopped.by?.reason ?? (error instanceof Halt ? error.reason : 'unavailable');
      if (reason === 'unavailable' && !(error instanceof Halt)) log('The gateway failed an upload.', error instanceof Error ? error.name : 'unknown failure');
      // A client that is gone cannot be answered: its connection is closed, which is what `res.destroyed` says. (Not `req.destroyed`: Node destroys the
      // request as soon as its body has been read to the end, and a body that was read whole is exactly when a checksum or a lease fails.)
      if (res.destroyed) return;
      const refusal: Refusal =
        reason === 'forbidden'
          ? {status: 403, error: 'forbidden'}
          : reason === 'ended'
            ? {status: 409, error: 'upload_ended'}
            : reason === 'content'
              ? {status: 400, error: 'content_mismatch'}
              : reason === 'checksum'
                ? {status: 400, error: 'checksum_mismatch'}
                : reason === 'short' || reason === 'too_long'
                  ? {status: 400, error: 'length_mismatch'}
                  : {status: 503, error: 'unavailable'};
      return refuseUpload(req, res, refusal);
    }
  }

  // Downloads -------------------------------------------------------------------------------------------------------------------

  /**
   * Serves a target the transfer's handle is allowed to read: the whole object or ONE range, in chunks of at most 1 MiB. The transfer is authorized to
   * resolve the target, and again before EACH chunk, the first included: a refusal before the first byte is a status, and a refusal after it closes the
   * stream (what was sent stands).
   */
  async function serve(req: IncomingMessage, res: ServerResponse, transfer: Transfer) {
    const first = await authorize(transfer);
    if (first.outcome !== 'allowed') {
      const refusal = refusalOf(first.outcome);
      return fail(res, refusal.status, refusal.error);
    }
    const {target} = first;
    const etag = `"${target.etag}"`;
    const rangeHeader = req.headers.range;
    // A resume that names a version of the object this is not is served whole, as a browser expects of If-Range.
    const ifRange = req.headers['if-range'];
    const requested = typeof rangeHeader === 'string' && typeof ifRange === 'string' && ifRange !== etag ? undefined : rangeHeader;
    if (requested !== undefined && typeof requested !== 'string') return fail(res, 416, 'range_not_satisfiable', {'content-range': `bytes */${target.length}`});
    const range = parseRange(requested, target.length);
    if (range.kind === 'unsatisfiable') return fail(res, 416, 'range_not_satisfiable', {'content-range': `bytes */${target.length}`});
    const start = range.kind === 'partial' ? range.start : 0;
    const end = range.kind === 'partial' ? range.end : target.length - 1;

    let stored: StoredBody;
    try {
      stored = await storage.get(target.key, range.kind === 'partial' ? {start, end} : null);
    } catch (error) {
      if (error instanceof MissingObject) return fail(res, 404, 'not_found');
      log('The gateway could not open an object.', error instanceof Error ? error.name : 'unknown failure');
      return fail(res, 503, 'unavailable');
    }
    if (stored.length !== end - start + 1) {
      stored.cancel();
      return fail(res, 503, 'unavailable');
    }

    res.on('close', () => {
      if (!res.writableEnded) stored.cancel();
    });
    try {
      const chunks = blocks(stored.body, chunkBytes);
      // The first chunk is read, and asked about, BEFORE the headers go out: access that ends between the question above and this one is still a status
      // (a refusal answers 403, 404 or 503 and nothing was sent), and only what follows the first byte is a closed stream.
      let step = await chunks.next();
      if (step.done) {
        stored.cancel();
        return fail(res, 503, 'unavailable');
      }
      let index = 0;
      await deps.hooks?.beforeChunk?.({direction: 'download', index});
      const opening = await authorize(transfer);
      if (opening.outcome !== 'allowed') {
        stored.cancel();
        const refusal = refusalOf(opening.outcome);
        return fail(res, refusal.status, refusal.error);
      }
      res.writeHead(range.kind === 'partial' ? 206 : 200, {
        'content-type': target.contentType,
        'content-length': end - start + 1,
        'accept-ranges': 'bytes',
        etag,
        'content-disposition': 'attachment',
        ...(range.kind === 'partial' ? {'content-range': `bytes ${start}-${end}/${target.length}`} : {}),
      });
      let sent = 0;
      for (;;) {
        if (!(await write(res, step.value))) {
          stored.cancel();
          return;
        }
        sent += step.value.length;
        index += 1;
        step = await chunks.next();
        if (step.done) break;
        await deps.hooks?.beforeChunk?.({direction: 'download', index});
        const decision = await authorize(transfer);
        if (decision.outcome !== 'allowed') {
          // Access ended between two chunks: the stream is closed. What was delivered stands; nothing more is sent.
          stored.cancel();
          res.destroy();
          return;
        }
      }
      // A stream that ended before the length that was promised is a failed transfer, not a finished one: ending the response here would hand a client a
      // file that looks whole to anything that does not compare the length. The connection is cut, so the client sees an error.
      if (sent !== end - start + 1) throw new ShortRead();
      res.end();
    } catch (error) {
      log('The gateway failed a download.', error instanceof Error ? error.name : 'unknown failure');
      stored.cancel();
      if (res.headersSent) res.destroy();
      else fail(res, 503, 'unavailable');
    }
  }

  async function file(req: IncomingMessage, res: ServerResponse, kind: string, id: string) {
    const ticket = await admission(bearer(req, 'Ticket'));
    if (!ticket || ticket.claims.dir !== 'download' || ticket.claims.tk !== kind || ticket.claims.tid !== id) return fail(res, 401, 'invalid_ticket');
    if (!resolvers.resolver(kind)) return fail(res, 400, 'unknown_target');
    const opened = await redeem(ticket);
    if (!opened.ok) return fail(res, opened.status, opened.error);
    return serve(req, res, opened.transfer);
  }

  /** A link the browser opens: the ticket is in the URL, and what comes back is a redirect to a URL that holds a handle and no ticket. */
  async function browser(res: ServerResponse, token: string) {
    res.setHeader('referrer-policy', 'no-referrer');
    const ticket = await admission(token);
    if (!ticket || ticket.claims.dir !== 'download') return fail(res, 401, 'invalid_ticket');
    if (!resolvers.resolver(ticket.claims.tk)) return fail(res, 400, 'unknown_target');
    const opened = await redeem(ticket);
    if (!opened.ok) return fail(res, opened.status, opened.error);
    // The redirect is not a promise: the target is asked about now, so a link to nothing is a refusal here and not a dead end one step later.
    const decision = await authorize(opened.transfer);
    if (decision.outcome !== 'allowed') {
      const refusal = refusalOf(decision.outcome);
      return fail(res, refusal.status, refusal.error);
    }
    res.writeHead(303, {location: `/h/${opened.handle}/${ticket.claims.tid}`, 'content-length': 0});
    res.end();
  }

  /** A handle's own URL: a bearer capability tied to the session grant, for at most 30 minutes, for ITS target and its direction only. */
  async function handleUrl(req: IncomingMessage, res: ServerResponse, handle: string, id: string) {
    res.setHeader('referrer-policy', 'no-referrer');
    const hash = handleHashOf(handle);
    if (!hash) return fail(res, 403, 'forbidden');
    let bound;
    try {
      bound = await database.authorizeHandle(hash, clock());
    } catch {
      return fail(res, 503, 'unavailable');
    }
    // A handle that is not live, whose session is no longer allowed, that was opened to upload, or that is for another target: refused alike.
    if (bound.outcome !== 'allowed' || bound.direction !== 'download' || bound.targetId !== id) return fail(res, 403, 'forbidden');
    return serve(req, res, {hash, accountId: bound.accountId, targetKind: bound.targetKind, targetId: bound.targetId, direction: 'download'});
  }

  // Commands --------------------------------------------------------------------------------------------------------------------

  const manifestOf = (receipt: AttachmentReceipt, body: {digest: string; length: number; kind: string}) => ({id: receipt.manifestId, root: receipt.root, digest: body.digest, length: body.length, kind: body.kind});

  /**
   * Attaches a complete upload. The manifest body is built first and serialized with RFC 8785, its SHA-256 is the ROOT, and the verified object is
   * copied to `objects/<account>/<root>`: the body holds the upload's own ID, so every attach has a key of its own (two uploads of the same bytes are
   * two objects), and `delete-root` with a manifest's root names the very key that holds its object. Then `artifacts.publish_attachment` decides. When it
   * answers anything but published or exists (denied, not complete, expired, an unknown transform, a root that does not match) the copy this call made is
   * deleted: it belongs to no manifest and no other upload can name its key (unless another attach of this very upload published meanwhile: its manifest has
   * the same root and so the same key, and the lease, read again, says `attached`). A repeat of an attach finds the lease `attached`, copies nothing, and
   * returns the same manifest with its object left alone.
   */
  async function attach(res: ServerResponse, claims: Extract<CommandClaims, {cmd: 'attach'}>) {
    const lease = await database.lease(claims.uid, claims.acct);
    if (!lease) return fail(res, 404, 'not_found');
    if (lease.state !== 'complete' && lease.state !== 'attached') return fail(res, 409, 'not_complete');
    // The manifest body, serialized with RFC 8785; its SHA-256 is the root. The upload's own ID is the manifest's, so the same upload attached again
    // builds the same bytes and finds the same manifest.
    const body = {id: claims.uid, scope: claims.acct, activity: `upload:${claims.tr}`, kind: lease.kind, digest: lease.sha256, length: lease.length, serialization: 1, children: [] as never[]};
    const text = canonicalize(body);
    const root = sha256Hex(text);
    const key = `objects/${claims.acct}/${root}`;
    // Only a lease that is still `complete` has a copy to make; an `attached` one made its copy when it was attached.
    const copied = lease.state === 'complete';
    if (copied) await storage.copy(`staging/${claims.acct}/${claims.uid}`, key);
    // If the database does not answer, this throws and the copy is NOT deleted: the answer is unknown, the manifest may have been written, and then the
    // copy is its object. A retry copies the same bytes to the same key and finds the manifest or makes it.
    const receipt: AttachmentReceipt = await database.publishAttachment({accountId: claims.acct, epoch: claims.epoch, uploadId: claims.uid, transform: claims.tr, root, body: text});
    if (receipt.outcome === 'published' || receipt.outcome === 'exists') return json(res, 200, {outcome: receipt.outcome, manifest: manifestOf(receipt, body)});
    // Refused: nothing was written, and the copy this call made is taken out again. (A refusal of a repeat made no copy, and touches nothing.) One case is
    // not this call's to undo: another attach of the same upload published while this one waited (the key is the same, because the body is), and then the
    // copy is that manifest's object. The lease says so, and a lease that cannot be read leaves the copy where it is: an unreferenced object is the lesser harm.
    if (copied) {
      try {
        const now = await database.lease(claims.uid, claims.acct);
        if (now !== null && now.state !== 'attached') await storage.delete(key);
      } catch (error) {
        // The refusal is still the answer; a copy that could not be taken back is an unreferenced object under a key of its own.
        log('The gateway could not take back a copy.', error instanceof Error ? error.name : 'unknown failure');
      }
    }
    switch (receipt.outcome) {
      case 'denied':
        return fail(res, 403, 'forbidden');
      case 'not_found':
        return fail(res, 404, 'not_found');
      case 'not_complete':
        return fail(res, 409, 'not_complete');
      case 'expired':
        return fail(res, 409, 'lease_expired');
      case 'transform_unknown':
        return fail(res, 400, 'unknown_transform');
      default:
        return fail(res, 409, 'manifest_conflict');
    }
  }

  async function command(req: IncomingMessage, res: ServerResponse) {
    // A command is the application's server speaking, never a browser: any Origin at all, the application's own included, is refused.
    if (req.headers.origin !== undefined) return fail(res, 403, 'forbidden_origin');
    const declared = contentLengthOf(req);
    if (req.headers['content-length'] !== undefined && (declared === null || declared > maxCommandBody)) return fail(res, 413, 'payload_too_large');
    drain(req, maxCommandBody);
    const result = await verified(bearer(req, 'Command'), 'command');
    const claims = result ? commandClaimsOf(result.payload) : null;
    if (!result || !claims) return fail(res, 401, 'invalid_command');
    let redeemed: 'redeemed' | 'refused';
    try {
      redeemed = await database.redeemCommand({
        jti: result.payload.jti,
        kid: result.kid,
        accountId: claims.acct,
        name: claims.cmd,
        targetId: claims.cmd === 'delete-root' ? claims.root : claims.uid,
        expiresAt: new Date(result.payload.exp * 1000),
        now: clock(),
      });
    } catch {
      return fail(res, 503, 'unavailable');
    }
    if (redeemed === 'refused') return fail(res, 401, 'invalid_command');
    try {
      switch (claims.cmd) {
        case 'attach':
          return await attach(res, claims);
        case 'delete-staging': {
          // One statement decides whether the lease may go: it is expired or released at this moment. A lease renewed meanwhile is kept.
          if (!(await database.claimDeletion(claims.uid, claims.acct, clock()))) return json(res, 200, {outcome: 'kept'});
          await storage.deletePrefix(`staging/${claims.acct}/${claims.uid}`);
          await database.markDeleted(claims.uid, claims.acct);
          return json(res, 200, {outcome: 'deleted'});
        }
        case 'delete-root':
          await storage.delete(`objects/${claims.acct}/${claims.root}`);
          return json(res, 200, {outcome: 'deleted'});
      }
    } catch (error) {
      log('The gateway failed a command.', error instanceof Error ? error.name : 'unknown failure');
      return fail(res, 503, 'unavailable');
    }
  }

  // Routing ---------------------------------------------------------------------------------------------------------------------

  const preflight = (res: ServerResponse) => {
    res.writeHead(204, {
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, x-content-sha256, range, if-range',
      'access-control-max-age': '600',
      'content-length': 0,
    });
    res.end();
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Every response: nothing is stored, nothing is sniffed, and the answer depends on the Origin.
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('vary', 'Origin');
    const origin = req.headers.origin;
    if (origin !== undefined) {
      // One allowed origin, named exactly: no wildcard, no credentials. Any other Origin, `null` included, is refused for every route.
      if (origin !== appOrigin) return fail(res, 403, 'forbidden_origin');
      res.setHeader('access-control-allow-origin', appOrigin);
      res.setHeader('access-control-expose-headers', 'content-range, content-length, accept-ranges, etag');
    }

    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://gateway.invalid').pathname;
    } catch {
      return fail(res, 400, 'bad_request');
    }
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      if (origin !== undefined && (routes.upload.test(path) || routes.file.test(path))) return preflight(res);
      return fail(res, origin !== undefined ? 403 : 405, origin !== undefined ? 'forbidden_origin' : 'method_not_allowed', {allow: 'GET, PUT, POST'});
    }

    let match: RegExpExecArray | null;
    if (routes.health.test(path)) {
      if (method !== 'GET') return fail(res, 405, 'method_not_allowed', {allow: 'GET'});
      return json(res, 200, {status: 'ok'});
    }
    if ((match = routes.upload.exec(path))) {
      if (method !== 'PUT') return fail(res, 405, 'method_not_allowed', {allow: 'PUT'});
      return upload(req, res, match[1]);
    }
    if ((match = routes.file.exec(path))) {
      if (method !== 'GET') return fail(res, 405, 'method_not_allowed', {allow: 'GET'});
      return file(req, res, match[1], match[2]);
    }
    if ((match = routes.browser.exec(path))) {
      if (method !== 'GET') return fail(res, 405, 'method_not_allowed', {allow: 'GET'});
      return browser(res, match[1]);
    }
    if ((match = routes.handle.exec(path))) {
      if (method !== 'GET') return fail(res, 405, 'method_not_allowed', {allow: 'GET'});
      return handleUrl(req, res, match[1], match[2]);
    }
    if (routes.commands.test(path)) {
      if (method !== 'POST') return fail(res, 405, 'method_not_allowed', {allow: 'POST'});
      return command(req, res);
    }
    return fail(res, 404, 'not_found');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      // Nothing above throws on purpose; this is the answer to what none of it foresaw, and it holds nothing of the request.
      log('The gateway failed a request.', error instanceof Error ? error.name : 'unknown failure');
      if (res.headersSent) res.destroy();
      else fail(res, 503, 'unavailable', {connection: 'close'});
    });
  });
  server.headersTimeout = headerTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  server.keepAliveTimeout = 5_000;
  server.setTimeout(idleSocketMs);
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
  });
  return server;
}
