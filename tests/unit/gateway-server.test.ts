import {createPrivateKey, randomBytes, randomUUID, sign} from 'node:crypto';
import http, {type IncomingHttpHeaders} from 'node:http';
import type {AddressInfo} from 'node:net';
import net from 'node:net';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {canonicalize} from '../../lib/canonical-json';
import {newJti, signCommand, signTicket, tokenLabel, type CommandClaims, type Signer, type TicketClaims} from '../../lib/service-signing';
import {createResolvers, type Resolvers} from '../../workers/files/src/resolvers';
import {PartialDeleteError} from '../../workers/files/src/storage';
import {createGatewayServer} from '../../workers/files/src/server';
import {createFixtureResolver, fixtureKind} from '../support/fixture-resolver';
import {DatabaseUnavailable, fakeClock, fakeDatabase, fakeStorage, jpegBytes, MiB, pngBytes, sha256, webpBytes, type FakeMember} from '../support/gateway-fakes';
import {testKeyPair, testSigner, type TestKeySetOptions} from '../support/service-keys';

// Story 1.12: the file gateway's HTTP server (workers/files/src/server.ts), over real HTTP on a loopback port, with in-memory stand-ins for its
// database and its Storage (tests/support/gateway-fakes.ts), an injected clock, the test signing keys and a hook between chunks. This is every row of
// the story's I/O matrix that is decided in the handlers; the real database role and the real Storage are tests/integration/file-gateway.test.ts.
//
// Every response of every test is checked, afterwards, for what must hold of ALL of them (no-store, nosniff, Vary: Origin, no cookie, no wildcard and
// no credentials), and nothing may have been logged but an error's class name, or printed to the console, or have put a ticket, a handle, a key, a
// driver's message or the bytes of a body into a response or a log.

const APP_ORIGIN = 'http://127.0.0.1:4173';
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const OTHER_INSTANCE = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const T0 = Date.parse('2026-10-15T12:00:00.000Z');
const MINUTE = 60_000;
const invalidTicket = {error: 'invalid_ticket'};

type Reply = {status: number; headers: IncomingHttpHeaders; body: Buffer; text: string; json: <T = Record<string, unknown>>() => T};
type Streamed = {status: number; headers: IncomingHttpHeaders; received: Buffer; outcome: 'ended' | 'aborted'};
type Init = {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: Buffer;
  /** The Content-Length to declare: the body's own by default, none (chunked) for null. A length beyond the body leaves the request unfinished. */
  contentLength?: number | null;
};

const agent = new http.Agent({keepAlive: false});

function options(base: string, path: string, init: Init) {
  const url = new URL(path, base);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(init.headers ?? {})) if (value !== undefined) headers[name.toLowerCase()] = value;
  const body = init.body;
  if (body !== undefined) {
    if (init.contentLength === null) headers['transfer-encoding'] = 'chunked';
    else if (headers['content-length'] === undefined) headers['content-length'] = String(init.contentLength ?? body.length);
  }
  return {url, headers, body, request: {host: url.hostname, port: url.port, path: url.pathname + url.search, method: init.method ?? 'GET', headers, agent}};
}

/** Sends a request and reads the whole answer. A body is sent whole unless a longer Content-Length is declared, which leaves it unfinished. */
function send(base: string, path: string, init: Init = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const {body, request: settings} = options(base, path, init);
    const unfinished = body !== undefined && init.contentLength !== undefined && init.contentLength !== null && init.contentLength > body.length;
    let responded = false;
    const req = http.request(settings, (res) => {
      responded = true;
      const parts: Buffer[] = [];
      res.on('data', (part: Buffer) => parts.push(part));
      res.on('error', reject);
      res.on('end', () => {
        const buffer = Buffer.concat(parts);
        resolve({status: res.statusCode ?? 0, headers: res.headers, body: buffer, text: buffer.toString('utf8'), json: <T>() => JSON.parse(buffer.toString('utf8')) as T});
        if (unfinished) req.destroy();
      });
    });
    // The server may answer before the body has all been sent and cut the connection: that is not a failure of a request that was answered.
    req.on('error', (error) => {
      if (!responded) reject(error);
    });
    if (body === undefined) req.end();
    else if (unfinished) req.write(body);
    else if (init.contentLength === null) {
      req.write(body);
      req.end();
    } else req.end(body);
  });
}

/** Sends a request and reads the answer as it comes, saying whether it ended or was cut. */
function stream(base: string, path: string, init: Init = {}): Promise<Streamed> {
  return new Promise((resolve, reject) => {
    const {request: settings} = options(base, path, init);
    const req = http.request(settings, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (part: Buffer) => parts.push(part));
      res.on('error', () => undefined);
      res.on('close', () => resolve({status: res.statusCode ?? 0, headers: res.headers, received: Buffer.concat(parts), outcome: res.complete ? 'ended' : 'aborted'}));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * The outcome of an upload that the gateway refuses part way: the answer, or the code of the error the sender met. The gateway answers a refused
 * upload and then cuts its connection after a little (smallBody), so a sender still writing a large body sometimes finds the cut before it can read the
 * answer. It deleted the object and released the lease BEFORE it answered, so what the tests assert about the gateway holds either way.
 */
function uploadOutcome(upload: Promise<Reply>): Promise<Reply | string> {
  return upload.catch((error: NodeJS.ErrnoException) => error.code ?? 'unknown');
}

/** The refusal was read, or the connection was cut first (never anything else). */
function expectRefused(outcome: Reply | string, status: number, body: unknown, label?: string) {
  if (typeof outcome === 'string') expect(['ECONNRESET', 'EPIPE'], label).toContain(outcome);
  else expect([outcome.status, outcome.json()], label).toEqual([status, body]);
}

// The world ---------------------------------------------------------------------------------------------------------------------

type StartOptions = {keys?: TestKeySetOptions; resolvers?: Resolvers};
type TicketInput = {dir: 'upload' | 'download'; tid: string; tk?: string; acct?: string; sid?: string; epoch?: number; cls?: string; len?: number; sha?: string; ct?: string};
type SignOptions = {now?: number; env?: string; signer?: Signer; lifetimeSeconds?: number; jti?: string};
type Seen = {status: number; headers: IncomingHttpHeaders; text: string | null};

async function start(settings: StartOptions = {}) {
  const clock = fakeClock(T0);
  const db = fakeDatabase({clock, instanceId: INSTANCE});
  const storage = fakeStorage();
  const keys = testSigner(settings.keys);
  const logs: [string, string][] = [];
  const handles: string[] = [];
  const chunks: {direction: string; index: number}[] = [];
  const tokens: string[] = [];
  const seen: Seen[] = [];
  const hooks = {onChunk: null as null | ((chunk: {direction: string; index: number}) => void | Promise<void>)};

  const server = createGatewayServer({
    instanceId: INSTANCE,
    appOrigin: APP_ORIGIN,
    keySet: keys.keySet,
    database: db,
    storage,
    resolvers: settings.resolvers,
    clock: clock.now,
    // The handle of every transfer the gateway opens, so a test can hold the one that only the gateway would know.
    random: (size) => {
      const bytes = randomBytes(size);
      handles.push(bytes.toString('base64url'));
      return bytes;
    },
    log: (message, detail) => logs.push([message, detail]),
    hooks: {
      beforeChunk: async (chunk) => {
        chunks.push(chunk);
        await hooks.onChunk?.(chunk);
      },
    },
  });
  // Every connection the server accepts, so a test can say how much of a request it read and whether it cut the connection.
  const sockets: net.Socket[] = [];
  server.on('connection', (socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const record = (reply: {status: number; headers: IncomingHttpHeaders; body?: Buffer}) =>
    seen.push({status: reply.status, headers: reply.headers, text: reply.body && reply.body.length < 4096 ? reply.body.toString('utf8') : null});

  const world = {
    url,
    clock,
    db,
    storage,
    logs,
    handles,
    chunks,
    tokens,
    seen,
    hooks,
    keys,
    server,
    sockets,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },

    async send(path: string, init: Init = {}) {
      const reply = await send(url, path, init);
      record(reply);
      return reply;
    },
    async stream(path: string, init: Init = {}) {
      const reply = await stream(url, path, init);
      record({status: reply.status, headers: reply.headers});
      return reply;
    },

    member: (settings: Parameters<typeof db.addMember>[0] = {}): FakeMember => db.addMember(settings),

    /** A signed ticket for a member: their Account, session and epoch, `staging` unless the claims say otherwise. */
    ticket(member: FakeMember, input: TicketInput, signing: SignOptions = {}) {
      const claims = {acct: member.accountId, sid: member.sessionId, epoch: member.epoch, tk: 'staging', ...input};
      const token = signTicket(signing.signer ?? keys.signer, signing.env ?? INSTANCE, claims as unknown as TicketClaims, {now: signing.now ?? clock.seconds(), lifetimeSeconds: signing.lifetimeSeconds, jti: signing.jti});
      tokens.push(token);
      return token;
    },
    command(claims: CommandClaims, signing: SignOptions = {}) {
      const token = signCommand(signing.signer ?? keys.signer, signing.env ?? INSTANCE, claims, {now: signing.now ?? clock.seconds(), lifetimeSeconds: signing.lifetimeSeconds, jti: signing.jti});
      tokens.push(token);
      return token;
    },
    /** A token signed with the active key whose parts are exactly what the test says, for what `signTicket` and `signCommand` would refuse to make. */
    forge(payload: Record<string, unknown>, header: Record<string, unknown> = {v: 1, alg: 'EdDSA', kid: keys.signer.kid}, signer: Signer = keys.signer) {
      const head = Buffer.from(JSON.stringify(header)).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = sign(null, Buffer.from(`${tokenLabel}${head}.${body}`, 'utf8'), signer.privateKey).toString('base64url');
      const token = `${head}.${body}.${signature}`;
      tokens.push(token);
      return token;
    },
    /** The payload of a ticket that is valid for this member as signTicket would make it, with the given members replaced. */
    payload(member: FakeMember, input: TicketInput, changes: Record<string, unknown> = {}) {
      const iat = clock.seconds();
      return {iss: 'application', aud: 'gateway', env: INSTANCE, jti: newJti(), iat, exp: iat + 300, typ: 'ticket', acct: member.accountId, sid: member.sessionId, epoch: member.epoch, tk: 'staging', ...input, ...changes};
    },

    /** Puts an upload where the gateway holds one: a lease and its object. */
    stage(member: FakeMember, bytes: Buffer, settings: {id?: string; kind?: 'picture' | 'file'; state?: 'receiving' | 'complete' | 'attached' | 'released'; object?: boolean; expiresAt?: Date} = {}) {
      const id = settings.id ?? randomUUID();
      const kind = settings.kind ?? 'file';
      const contentType = kind === 'picture' ? 'image/png' : 'application/octet-stream';
      const lease = db.seedLease({
        id,
        accountId: member.accountId,
        kind,
        length: bytes.length,
        sha256: sha256(bytes),
        contentType,
        state: settings.state ?? 'complete',
        receivedLength: settings.state === 'receiving' ? 0 : bytes.length,
        ...(settings.expiresAt ? {expiresAt: settings.expiresAt} : {}),
      });
      if (settings.object !== false) storage.objects.set(`staging/${member.accountId}/${id}`, {bytes: Buffer.from(bytes), contentType});
      return {id, lease, key: `staging/${member.accountId}/${id}`, sha: lease.sha256};
    },

    upload(member: FakeMember, id: string, bytes: Buffer, o: {cls?: 'picture' | 'file'; ct?: string; sha?: string; claims?: Partial<TicketInput>; headers?: Record<string, string | undefined>; token?: string; signing?: SignOptions; contentLength?: number | null} = {}) {
      const cls = o.cls ?? 'picture';
      const claims = {dir: 'upload' as const, tid: id, cls, len: bytes.length, sha: o.sha ?? sha256(bytes), ct: o.ct ?? (cls === 'picture' ? 'image/png' : 'application/octet-stream'), ...o.claims};
      const token = o.token ?? world.ticket(member, claims, o.signing);
      return world.send(`/v1/uploads/${id}`, {
        method: 'PUT',
        headers: {authorization: `Ticket ${token}`, 'content-type': claims.ct, 'x-content-sha256': claims.sha, ...o.headers},
        body: bytes,
        contentLength: o.contentLength,
      });
    },

    download(member: FakeMember, id: string, o: {kind?: string; headers?: Record<string, string>; token?: string; signing?: SignOptions; epoch?: number} = {}) {
      const token = o.token ?? world.ticket(member, {dir: 'download', tid: id, tk: o.kind ?? 'staging', ...(o.epoch ? {epoch: o.epoch} : {})}, o.signing);
      return world.send(`/v1/files/${o.kind ?? 'staging'}/${id}`, {headers: {authorization: `Ticket ${token}`, ...o.headers}});
    },

    post(token: string | null, init: Init = {}) {
      return world.send('/v1/commands', {method: 'POST', ...init, headers: {...(token === null ? {} : {authorization: `Command ${token}`}), ...init.headers}});
    },
  };
  return world;
}

type World = Awaited<ReturnType<typeof start>>;

const payloadOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
const prefix = (bytes: Buffer, length: number) => bytes.subarray(0, length);

let world: World;
const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));

beforeEach(async () => {
  for (const spy of consoleSpies) spy.mockClear();
  world = await start();
});

afterEach(async () => {
  const {seen, logs, tokens, handles} = world;
  await world.close();

  // What must hold of EVERY response the gateway made.
  for (const {status, headers} of seen) {
    expect(headers['cache-control'], `${status} cache-control`).toBe('no-store');
    expect(headers['x-content-type-options'], `${status} nosniff`).toBe('nosniff');
    expect(String(headers.vary).split(',').map((value) => value.trim()), `${status} vary`).toContain('Origin');
    expect(headers['set-cookie'], `${status} set-cookie`).toBeUndefined();
    expect(headers['access-control-allow-credentials'], `${status} credentials`).toBeUndefined();
    expect(headers['access-control-allow-origin'] ?? APP_ORIGIN, `${status} allow-origin`).toBe(APP_ORIGIN);
    // No storage URL, signed or not, and no credential, in any header.
    for (const [name, value] of Object.entries(headers)) expect(String(value), `${status} ${name}`).not.toMatch(/amz|s3\.|signature=|private-files|https?:\/\/(?!127\.0\.0\.1:4173)/i);
  }

  // Nothing is printed, and what is logged is the class name of an error and nothing else.
  for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  for (const [message, detail] of logs) {
    expect(message).toMatch(/^The gateway (?:could not authorize a chunk|failed an upload|could not open an object|failed a download|failed a command|could not take back a copy|failed a request)\.$/);
    expect(detail).toMatch(/^(?:[A-Z][A-Za-z]*|unknown failure)$/);
  }

  // No ticket, no handle, no driver message and no key in a log, and no ticket or driver message in a response (a handle is in the one Location header
  // that hands it out, and nowhere else).
  const everything = [...logs.flat(), ...seen.flatMap((entry) => [entry.text ?? '', ...Object.entries(entry.headers).filter(([name]) => name !== 'location').map(([, value]) => String(value))])].join('\n');
  for (const token of tokens) expect(everything).not.toContain(token);
  for (const handle of handles) expect(everything).not.toContain(handle);
  expect(everything).not.toMatch(/db\.internal\.example|password authentication|BEGIN PRIVATE|AKIA|secret-key/);
  const secret = testKeyPair('application-1');
  expect(everything).not.toContain(secret.privateKey);
});

// ---------------------------------------------------------------------------------------------------
describe('routes, methods and what every response carries', () => {
  it('answers /healthz with {status: ok}, asks the database nothing and takes no query into account', async () => {
    for (const path of ['/healthz', '/healthz?x=1']) {
      const reply = await world.send(path);
      expect([reply.status, reply.json()]).toEqual([200, {status: 'ok'}]);
      expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
    }
    expect(world.db.calls).toEqual([]);
  });

  it.each([
    '/',
    '/nope',
    '/v1',
    '/v1/uploads',
    '/v1/uploads/',
    `/v1/uploads/${randomUUID()}/extra`,
    '/v1/uploads/not-a-uuid',
    `/v1/uploads/${randomUUID().toUpperCase()}`,
    `/v1/files/staging`,
    `/v1/files/Staging/${randomUUID()}`,
    `/v1/files/staging/${randomUUID()}/extra`,
    `/h/short/${randomUUID()}`,
    `/h/${'A'.repeat(44)}/${randomUUID()}`,
    '/d/',
    '/d/has space',
    '/v1/commands/x',
    '/healthz/',
  ])('answers 404 {error: not_found} for %s, touching nothing', async (path) => {
    const reply = await world.send(path);
    expect([reply.status, reply.json()]).toEqual([404, {error: 'not_found'}]);
    expect(world.db.calls).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  const id = randomUUID();
  it.each([
    ['POST', '/healthz', 'GET'],
    ['PUT', '/healthz', 'GET'],
    ['DELETE', '/healthz', 'GET'],
    ['GET', `/v1/uploads/${id}`, 'PUT'],
    ['POST', `/v1/uploads/${id}`, 'PUT'],
    ['DELETE', `/v1/uploads/${id}`, 'PUT'],
    ['PUT', `/v1/files/staging/${id}`, 'GET'],
    ['POST', `/v1/files/staging/${id}`, 'GET'],
    ['POST', '/d/abc', 'GET'],
    ['PUT', `/h/${'A'.repeat(43)}/${id}`, 'GET'],
    ['GET', '/v1/commands', 'POST'],
    ['PUT', '/v1/commands', 'POST'],
    ['DELETE', '/v1/commands', 'POST'],
  ])('answers %s %s with 405 and Allow: %s', async (method, path, allow) => {
    const reply = await world.send(path, {method});
    expect([reply.status, reply.json()]).toEqual([405, {error: 'method_not_allowed'}]);
    expect(reply.headers.allow).toBe(allow);
    expect(world.db.calls).toEqual([]);
  });

  it('refuses HEAD on every route that has a GET, with Allow naming the method it does take', async () => {
    for (const [path, allow] of [
      ['/healthz', 'GET'],
      [`/v1/files/staging/${id}`, 'GET'],
      ['/d/abc', 'GET'],
      [`/h/${'A'.repeat(43)}/${id}`, 'GET'],
      [`/v1/uploads/${id}`, 'PUT'],
      ['/v1/commands', 'POST'],
    ]) {
      const reply = await world.send(path, {method: 'HEAD'});
      expect(reply.status, path).toBe(405);
      expect(reply.headers.allow, path).toBe(allow);
      expect(reply.body.length, path).toBe(0);
    }
    expect(world.db.calls).toEqual([]);
  });

  it('refuses an OPTIONS that carries no Origin: a preflight is a browser\'s, and it always has one', async () => {
    const reply = await world.send(`/v1/uploads/${id}`, {method: 'OPTIONS'});
    expect([reply.status, reply.json(), reply.headers.allow]).toEqual([405, {error: 'method_not_allowed'}, 'GET, PUT, POST']);
  });

  it('answers a request that is not HTTP with 400, no-store, and closes the connection', async () => {
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(Number(new URL(world.url).port), '127.0.0.1');
      let text = '';
      socket.on('data', (part) => (text += part.toString('latin1')));
      socket.on('close', () => resolve(text));
      socket.on('error', reject);
      socket.write('THIS IS NOT HTTP\r\n\r\n');
    });
    expect(answer).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/);
    expect(answer.toLowerCase()).toContain('cache-control: no-store');
    expect(answer.toLowerCase()).toContain('connection: close');
  });
});

// ---------------------------------------------------------------------------------------------------
describe('cross-origin calls: allowed for the application\'s origin only', () => {
  const id = randomUUID();
  const headers = {origin: APP_ORIGIN, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization, content-type, x-content-sha256'};

  it('answers a preflight from APP_ORIGIN, exactly: that origin, the methods and headers the gateway takes, no credentials, no wildcard', async () => {
    for (const path of [`/v1/uploads/${id}`, `/v1/files/staging/${id}`]) {
      const reply = await world.send(path, {method: 'OPTIONS', headers});
      expect(reply.status, path).toBe(204);
      expect(reply.body.length).toBe(0);
      expect(reply.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
      expect(reply.headers['access-control-allow-methods']).toBe('GET, PUT, OPTIONS');
      expect(reply.headers['access-control-allow-headers']).toBe('authorization, content-type, x-content-sha256, range, if-range');
      expect(reply.headers['access-control-max-age']).toBe('600');
      expect(reply.headers['access-control-allow-credentials']).toBeUndefined();
      expect(reply.headers.vary).toBe('Origin');
    }
    expect(world.db.calls).toEqual([]);
  });

  it('refuses the preflight of a route that is not for browsers (the commands, the browser links, the health check) from APP_ORIGIN too', async () => {
    for (const path of ['/v1/commands', '/d/abc', `/h/${'A'.repeat(43)}/${id}`, '/healthz', '/nope']) {
      const reply = await world.send(path, {method: 'OPTIONS', headers});
      expect([reply.status, reply.json()], path).toEqual([403, {error: 'forbidden_origin'}]);
      // (Not a 2xx: a browser takes the preflight as failed, whatever headers come with it.)
      expect(reply.headers['access-control-allow-methods'], path).toBeUndefined();
    }
  });

  it('adds the allowed origin, and the headers a page may read, to the answers for it, and nothing to a request that has no Origin', async () => {
    const own = await world.send('/healthz', {headers: {origin: APP_ORIGIN}});
    expect(own.status).toBe(200);
    expect(own.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(own.headers['access-control-expose-headers']).toBe('content-range, content-length, accept-ranges, etag');
    expect(own.headers['access-control-allow-credentials']).toBeUndefined();
    const none = await world.send('/healthz');
    expect(none.status).toBe(200);
    expect(none.headers['access-control-allow-origin']).toBeUndefined();
    expect(none.headers['access-control-expose-headers']).toBeUndefined();
  });

  it.each([
    'https://evil.example',
    'null',
    '',
    'http://127.0.0.1:4174',
    'https://127.0.0.1:4173',
    'http://localhost:4173',
    `${APP_ORIGIN}/`,
    `${APP_ORIGIN}.evil.example`,
    APP_ORIGIN.toUpperCase(),
    '*',
  ])('answers 403 {error: forbidden_origin} to Origin %j on every route, and reads nothing', async (origin) => {
    const member = world.member();
    const ticket = world.ticket(member, {dir: 'download', tid: id});
    const requests: [string, string, Record<string, string>][] = [
      ['GET', '/healthz', {}],
      ['OPTIONS', `/v1/uploads/${id}`, {'access-control-request-method': 'PUT'}],
      ['PUT', `/v1/uploads/${id}`, {authorization: `Ticket ${ticket}`}],
      ['GET', `/v1/files/staging/${id}`, {authorization: `Ticket ${ticket}`}],
      ['GET', `/d/${ticket}`, {}],
      ['GET', `/h/${'A'.repeat(43)}/${id}`, {}],
      ['POST', '/v1/commands', {authorization: `Command ${ticket}`}],
      ['GET', '/nope', {}],
      ['DELETE', '/healthz', {}],
    ];
    for (const [method, path, extra] of requests) {
      const reply = await world.send(path, {method, headers: {origin, ...extra}});
      expect([reply.status, reply.json()], `${method} ${path}`).toEqual([403, {error: 'forbidden_origin'}]);
      expect(reply.headers['access-control-allow-origin'], `${method} ${path}`).toBeUndefined();
    }
    expect(world.db.calls).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  it('serves an upload and a download for APP_ORIGIN with the CORS headers, and refuses the same calls from another origin before reading the ticket', async () => {
    const member = world.member();
    const bytes = pngBytes(2000);
    const up = randomUUID();
    const ok = await world.upload(member, up, bytes, {headers: {origin: APP_ORIGIN}});
    expect([ok.status, ok.headers['access-control-allow-origin']]).toEqual([201, APP_ORIGIN]);
    const file = await world.download(member, up, {headers: {origin: APP_ORIGIN}});
    expect([file.status, file.headers['access-control-allow-origin']]).toEqual([200, APP_ORIGIN]);
    const calls = world.db.calls.length;
    const refused = await world.upload(member, randomUUID(), bytes, {headers: {origin: 'https://evil.example'}});
    expect(refused.status).toBe(403);
    expect(world.db.calls.length).toBe(calls);
  });

  it('refuses a command that carries an Origin, the application\'s own included, and redeems nothing', async () => {
    const member = world.member();
    const token = world.command({cmd: 'delete-root', acct: member.accountId, root: sha256('x')});
    for (const origin of [APP_ORIGIN, 'https://evil.example', 'null']) {
      const reply = await world.post(token, {headers: {origin}});
      expect([reply.status, reply.json()], origin).toEqual([403, {error: 'forbidden_origin'}]);
    }
    expect(world.db.calls).toEqual([]);
    expect(world.db.redemptions.size).toBe(0);
    // Without the Origin the very same command is carried out.
    expect((await world.post(token)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a ticket that is not good is refused with one answer, before the database is asked anything', () => {
  const id = randomUUID();
  const bytes = pngBytes(3000);
  const png = {cls: 'picture', len: bytes.length, sha: sha256(bytes), ct: 'image/png'};

  type Bad = {name: string; token?: (w: World, m: FakeMember) => string; header?: string | null; onDownload?: boolean; viaUrl?: boolean};
  const bad: Bad[] = [
    {name: 'an expired ticket', token: (w, m) => w.ticket(m, {dir: 'upload', tid: id, ...png}, {now: w.clock.seconds() - 400})},
    {name: 'a ticket that expires this second plus one', token: (w, m) => w.ticket(m, {dir: 'upload', tid: id, ...png}, {now: w.clock.seconds() - 301})},
    {name: 'a ticket issued 61 seconds from now', token: (w, m) => w.ticket(m, {dir: 'upload', tid: id, ...png}, {now: w.clock.seconds() + 61})},
    {name: 'a ticket whose lifetime is 301 seconds', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {exp: w.clock.seconds() + 301}))},
    {name: 'a ticket that expires before it was issued', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {exp: w.clock.seconds() - 10}))},
    {name: 'a ticket for another audience', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {aud: 'cad-worker'}))},
    {name: 'a ticket from another issuer', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {iss: 'heartbeat'}))},
    {name: 'a ticket for another environment', token: (w, m) => w.ticket(m, {dir: 'upload', tid: id, ...png}, {env: OTHER_INSTANCE})},
    {name: 'a ticket signed by a key the set does not name', token: (w, m) => w.ticket(m, {dir: 'upload', tid: id, ...png}, {signer: {issuer: 'application', kid: 'test-stranger', privateKey: createPrivateKey({key: Buffer.from(testKeyPair('stranger').privateKey, 'base64'), format: 'der', type: 'pkcs8'})}})},
    {name: 'a ticket that names a key it was not signed with', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}), {v: 1, alg: 'EdDSA', kid: 'test-application-1'}, {issuer: 'application', kid: 'x', privateKey: createPrivateKey({key: Buffer.from(testKeyPair('stranger').privateKey, 'base64'), format: 'der', type: 'pkcs8'})})},
    {name: 'a ticket whose payload was altered', token: (w, m) => {
      const [head, body, signature] = w.ticket(m, {dir: 'upload', tid: id, ...png}).split('.');
      return `${head}.${Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body, 'base64url').toString()), len: 1})).toString('base64url')}.${signature}`;
    }},
    {name: 'a ticket whose signature was altered', token: (w, m) => {
      const [head, body, signature] = w.ticket(m, {dir: 'upload', tid: id, ...png}).split('.');
      return `${head}.${body}.${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;
    }},
    {name: 'a ticket with no signature', token: (w, m) => `${w.ticket(m, {dir: 'upload', tid: id, ...png}).split('.').slice(0, 2).join('.')}.`},
    {name: 'a ticket with an algorithm of none', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}), {v: 1, alg: 'none', kid: 'test-application-1'})},
    {name: 'a ticket whose header says another version', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}), {v: 2, alg: 'EdDSA', kid: 'test-application-1'})},
    {name: 'a ticket whose header has another member', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}), {v: 1, alg: 'EdDSA', kid: 'test-application-1', jku: 'https://evil.example/keys'})},
    {name: 'a ticket that is not three parts', token: () => 'not.a.ticket.at.all'},
    {name: 'a ticket that is words', token: () => 'garbage'},
    // (Built here: a literal JWT in a source file is what the repository's secret scan looks for.)
    {name: 'a ticket that is a token of some other kind (HS256)', token: () => [{alg: 'HS256'}, {sub: '1'}, 'signature'].map((part) => Buffer.from(typeof part === 'string' ? part : JSON.stringify(part)).toString('base64url')).join('.')},
    {name: 'a command presented as a ticket', token: (w, m) => w.command({cmd: 'delete-root', acct: m.accountId, root: sha256('x')})},
    {name: 'a ticket carrying a URL (nothing reusable may be in one)', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {url: 'https://storage.example/object?X-Amz-Signature=abc'}))},
    {name: 'a ticket carrying a storage credential', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {key: 'AKIA-secret-key'}))},
    {name: 'a ticket with a claim missing', token: (w, m) => w.forge((({sid: _sid, ...rest}) => rest)(w.payload(m, {dir: 'upload', tid: id, ...png})))},
    {name: 'a ticket whose Account is not an ID', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {acct: '../../etc'}))},
    {name: 'a ticket whose epoch is not a whole number', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {epoch: 1.5}))},
    {name: 'a ticket whose jti is not 128 bits', token: (w, m) => w.forge(w.payload(m, {dir: 'upload', tid: id, ...png}, {jti: 'short'}))},
    {name: 'a ticket of 5000 characters', token: (w, m) => `${w.ticket(m, {dir: 'upload', tid: id, ...png})}${'A'.repeat(5000)}`, viaUrl: false},
    {name: 'no Authorization header at all', header: null},
    {name: 'an Authorization header with no scheme', header: ''},
    {name: 'the Bearer scheme', token: (w, m) => `${w.ticket(m, {dir: 'upload', tid: id, ...png})}`, header: 'Bearer '},
    {name: 'the scheme spelled in lower case', token: (w, m) => `${w.ticket(m, {dir: 'upload', tid: id, ...png})}`, header: 'ticket '},
    {name: 'a Ticket with nothing after it', header: 'Ticket '},
    {name: 'a Ticket with two tokens', token: (w, m) => `${w.ticket(m, {dir: 'upload', tid: id, ...png})} ${w.ticket(m, {dir: 'upload', tid: id, ...png})}`, header: 'Ticket '},
  ];

  const headerOf = (entry: Bad, token: string | undefined) => (entry.header === undefined ? `Ticket ${token}` : entry.header === null ? undefined : `${entry.header}${token ?? ''}`);

  it.each(bad.map((entry) => [entry.name, entry] as const))('refuses %s on an upload: 401 invalid_ticket, and nothing is read, written or stored', async (_name, entry) => {
    const member = world.member();
    const token = entry.token?.(world, member);
    const reply = await world.send(`/v1/uploads/${id}`, {
      method: 'PUT',
      headers: {authorization: headerOf(entry, token), 'content-type': 'image/png', 'x-content-sha256': sha256(bytes)},
      body: bytes,
    });
    expect([reply.status, reply.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    expect(world.db.calls).toEqual([]);
    expect(world.storage.calls).toEqual([]);
    expect(world.db.redemptions.size + world.db.leases.size + world.db.handles.size).toBe(0);
  });

  it.each(bad.map((entry) => [entry.name, entry] as const))('refuses %s for a download: the same 401 and the same body, and nothing is read', async (_name, entry) => {
    const member = world.member();
    const token = entry.token?.(world, member);
    const reply = await world.send(`/v1/files/staging/${id}`, {headers: {authorization: headerOf(entry, token)}});
    expect([reply.status, reply.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    expect(world.db.calls).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  it.each(bad.filter((entry) => entry.token !== undefined && entry.header === undefined && entry.viaUrl !== false).map((entry) => [entry.name, entry] as const))('refuses %s in a browser link: the same 401 and the same body, and no redirect', async (_name, entry) => {
    const member = world.member();
    const token = entry.token!(world, member);
    const reply = await world.send(`/d/${token}`);
    // (A token that is not in the characters a link can hold is no route at all.)
    if (/^[A-Za-z0-9_.-]{1,4096}$/.test(token)) expect([reply.status, reply.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    else expect(reply.status).toBe(404);
    expect(reply.headers.location).toBeUndefined();
    expect(world.db.calls).toEqual([]);
  });

  it('refuses a ticket whose claims are good but are not this route\'s: another target, another direction, another kind, with no database read', async () => {
    const member = world.member();
    const other = randomUUID();
    const cases: [string, () => Promise<{status: number; text: string}>][] = [
      ['another target ID', () => world.upload(member, id, bytes, {claims: {tid: other}})],
      ['a download ticket on an upload', () => world.upload(member, id, bytes, {token: world.ticket(member, {dir: 'download', tid: id})})],
      ['an upload ticket on a download', () => world.download(member, id, {token: world.ticket(member, {dir: 'upload', tid: id, ...png})})],
      ['another target on a download', () => world.download(member, id, {token: world.ticket(member, {dir: 'download', tid: other})})],
      ['another kind on a download', () => world.download(member, id, {token: world.ticket(member, {dir: 'download', tid: id, tk: 'fixture'})})],
      ['an upload ticket in a browser link', () => world.send(`/d/${world.ticket(member, {dir: 'upload', tid: id, ...png})}`)],
    ];
    for (const [name, run] of cases) {
      const reply = await run();
      expect([reply.status, reply.text], name).toEqual([401, JSON.stringify(invalidTicket)]);
    }
    expect(world.db.calls).toEqual([]);
    expect(world.db.redemptions.size).toBe(0);
  });

  it('refuses a ticket for the session of another Account, and one for a session nobody has, having read only the session', async () => {
    const member = world.member();
    const stranger = world.member();
    const foreign = await world.upload(member, id, bytes, {claims: {sid: stranger.sessionId}});
    expect([foreign.status, foreign.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    const unknown = await world.upload(member, randomUUID(), bytes, {claims: {sid: randomUUID()}});
    expect([unknown.status, unknown.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    expect(world.db.calls).toEqual(['authority', 'authority']);
    expect(world.db.redemptions.size + world.db.leases.size).toBe(0);
    expect(world.storage.calls).toEqual([]);
  });

  it('refuses a ticket that is used a second time, on any route, and the second use opens nothing', async () => {
    const member = world.member();
    const first = randomUUID();
    const token = world.ticket(member, {dir: 'upload', tid: first, ...png});
    expect((await world.upload(member, first, bytes, {token})).status).toBe(201);
    const leases = world.db.leases.size;
    const again = await world.upload(member, first, bytes, {token});
    expect([again.status, again.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    expect(world.db.leases.size).toBe(leases);
    expect(world.db.handles.size).toBe(1);
    // A download ticket: once on the file route, then on the file route again and in a browser link.
    const download = world.ticket(member, {dir: 'download', tid: first});
    expect((await world.download(member, first, {token: download})).status).toBe(200);
    for (const reply of [await world.download(member, first, {token: download}), await world.send(`/d/${download}`)]) {
      expect([reply.status, reply.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    }
  });

  it('refuses the tickets of a key that is revoked, on every route, and opens nothing', async () => {
    const member = world.member();
    world.db.revokedKeys.add(world.keys.signer.kid);
    const up = await world.upload(member, id, bytes);
    const file = await world.download(member, id);
    const link = await world.send(`/d/${world.ticket(member, {dir: 'download', tid: id})}`);
    for (const reply of [up, file, link]) expect([reply.status, reply.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    expect(world.db.handles.size + world.db.leases.size).toBe(0);
    expect(world.storage.calls).toEqual([]);
  });

  it('cuts the connection of an upload whose ticket is not believed after a little, instead of reading all that is sent', async () => {
    const member = world.member();
    const body = randomBytes(2 * MiB);
    const outcome = await world
      .send(`/v1/uploads/${id}`, {method: 'PUT', headers: {authorization: 'Ticket garbage', 'content-type': 'image/png', 'x-content-sha256': sha256(body)}, body})
      .then((reply) => reply.status)
      .catch((error: NodeJS.ErrnoException) => error.code);
    // Either the answer arrived before the connection was cut, or the cut reached the sender first: never anything else, and nothing was done.
    expect([401, 'ECONNRESET', 'EPIPE']).toContain(outcome);
    expect(world.db.calls).toEqual([]);
    expect(member.accountId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('key rotation: one active key and one retiring key', () => {
  const id = () => randomUUID();
  const oldKey = (): Signer => ({issuer: 'application', kid: 'test-application-1', privateKey: createPrivateKey({key: Buffer.from(testKeyPair('application-1').privateKey, 'base64'), format: 'der', type: 'pkcs8'})});
  const bytes = pngBytes(5000);

  beforeEach(async () => {
    await world.close();
    world = await start({keys: {active: 'application-2', retiring: {label: 'application-1', until: new Date(T0 + 2 * MINUTE)}}});
  });

  it('accepts a ticket of the active key and of the retiring key before its until, and refuses the retiring key from its until on', async () => {
    const member = world.member();
    const fresh = await world.upload(member, id(), bytes);
    expect(fresh.status).toBe(201);
    const retiring = await world.upload(member, id(), bytes, {signing: {signer: oldKey()}});
    expect(retiring.status).toBe(201);
    // A ticket the retiring key made while it was allowed is refused once its until has come, though it has minutes to live.
    const outstanding = world.ticket(member, {dir: 'upload', tid: id(), cls: 'picture', len: bytes.length, sha: sha256(bytes), ct: 'image/png'}, {signer: oldKey()});
    world.clock.set(T0 + 2 * MINUTE - 1000);
    expect((await world.send('/healthz')).status).toBe(200);
    world.clock.set(T0 + 2 * MINUTE);
    const late = payloadOf(outstanding);
    const lateId = String(late.tid);
    const refused = await world.upload(member, lateId, bytes, {token: outstanding});
    expect([refused.status, refused.text]).toEqual([401, JSON.stringify(invalidTicket)]);
    // A new ticket signed by the retiring key now is refused as well, and the active key's still is not.
    const after = await world.upload(member, id(), bytes, {signing: {signer: oldKey()}});
    expect(after.status).toBe(401);
    expect((await world.upload(member, id(), bytes)).status).toBe(201);
  });

  it('refuses the retiring key for a download and a browser link after its until, and accepts it before', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(2000));
    const early = await world.download(member, staged.id, {signing: {signer: oldKey()}});
    expect(early.status).toBe(200);
    const linkToken = world.ticket(member, {dir: 'download', tid: staged.id}, {signer: oldKey()});
    world.clock.advance(3 * MINUTE);
    expect((await world.send(`/d/${linkToken}`)).status).toBe(401);
    expect((await world.download(member, staged.id, {signing: {signer: oldKey()}})).status).toBe(401);
    expect((await world.download(member, staged.id)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('an upload', () => {
  it('stores a picture: 201, the lease complete, the object under staging/<account>/<upload> with its content type, and one handle and one redemption', async () => {
    const member = world.member();
    const id = randomUUID();
    const bytes = pngBytes(300 * 1024);
    const token = world.ticket(member, {dir: 'upload', tid: id, cls: 'picture', len: bytes.length, sha: sha256(bytes), ct: 'image/png'});
    const reply = await world.upload(member, id, bytes, {token});
    expect([reply.status, reply.json()]).toEqual([201, {id, length: bytes.length, sha256: sha256(bytes)}]);

    const key = `staging/${member.accountId}/${id}`;
    expect(world.storage.keys()).toEqual([key]);
    expect(world.storage.objects.get(key)!.contentType).toBe('image/png');
    expect(world.storage.objects.get(key)!.bytes.equals(bytes)).toBe(true);
    expect(world.db.leases.get(id)).toMatchObject({accountId: member.accountId, kid: world.keys.signer.kid, kind: 'picture', length: bytes.length, sha256: sha256(bytes), contentType: 'image/png', receivedLength: bytes.length, state: 'complete'});
    // The lease lasts 24 hours from the activity.
    expect(world.db.leases.get(id)!.expiresAt.getTime()).toBe(T0 + 24 * 60 * MINUTE);

    const redemption = world.db.redemptions.get(String(payloadOf(token).jti))!;
    expect(redemption).toMatchObject({typ: 'ticket', kid: world.keys.signer.kid, accountId: member.accountId, sessionId: member.sessionId, direction: 'upload', targetKind: 'staging', targetId: id});
    expect(redemption.expiresAt.getTime()).toBe(Number(payloadOf(token).exp) * 1000);
    const [handle] = [...world.db.handles.values()];
    expect(world.db.handles.size).toBe(1);
    expect(handle).toMatchObject({jti: redemption.jti, accountId: member.accountId, sessionId: member.sessionId, epoch: member.epoch, direction: 'upload', targetKind: 'staging', targetId: id, kid: world.keys.signer.kid, endedAt: null});
    // A handle lives 30 minutes, and only its hash is kept.
    expect(handle.expiresAt.getTime() - handle.createdAt.getTime()).toBe(30 * MINUTE);
    expect(handle.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(handle.hash).not.toContain(world.handles[0]);
  });

  it.each([
    ['a JPEG', 'image/jpeg', jpegBytes],
    ['a WebP', 'image/webp', webpBytes],
    ['a PNG', 'image/png', pngBytes],
  ])('stores %s as a picture, by its leading bytes', async (_name, contentType, make) => {
    const member = world.member();
    const id = randomUUID();
    const bytes = make(5000);
    const reply = await world.upload(member, id, bytes, {ct: contentType});
    expect(reply.status).toBe(201);
    expect(world.storage.objects.get(`staging/${member.accountId}/${id}`)!.contentType).toBe(contentType);
  });

  it('stores any other file as application/octet-stream, whatever it holds, with no signature to check', async () => {
    const member = world.member();
    const id = randomUUID();
    const bytes = randomBytes(40_000);
    const reply = await world.upload(member, id, bytes, {cls: 'file'});
    expect(reply.status).toBe(201);
    expect(world.db.leases.get(id)).toMatchObject({kind: 'file', contentType: 'application/octet-stream', state: 'complete'});
    // The bytes of a PNG are only bytes, as a file.
    const second = randomUUID();
    expect((await world.upload(member, second, pngBytes(1000), {cls: 'file'})).status).toBe(201);
  });

  it('accepts the checksum header in capital letters, which is the same hexadecimal', async () => {
    const member = world.member();
    const bytes = pngBytes(2000);
    const reply = await world.upload(member, randomUUID(), bytes, {headers: {'x-content-sha256': sha256(bytes).toUpperCase()}});
    expect(reply.status).toBe(201);
  });

  it('hands Storage chunks of at most 1 MiB, however many bytes arrive at a time, and authorizes before each: an authorization read, the resolver and the progress, three times for 2.5 MiB', async () => {
    const member = world.member();
    const id = randomUUID();
    const bytes = pngBytes(2.5 * MiB);
    const reply = await world.upload(member, id, bytes);
    expect(reply.status).toBe(201);
    expect(world.storage.putPieces.get(`staging/${member.accountId}/${id}`)).toEqual([MiB, MiB, 0.5 * MiB]);
    expect(world.chunks).toEqual([0, 1, 2].map((index) => ({direction: 'upload', index})));
    expect(world.db.calls).toEqual(['authority', 'openTransfer', 'createLease', ...Array(3).fill(['authorizeHandle', 'query', 'progress']).flat(), 'complete']);
    expect(world.db.count('authorizeHandle')).toBe(3);
  });

  it('takes a picture of exactly 12 MiB and a file of exactly 100 MiB, in chunks of 1 MiB', async () => {
    const member = world.member();
    const picture = randomUUID();
    const big = pngBytes(12 * MiB);
    expect((await world.upload(member, picture, big)).status).toBe(201);
    expect(world.storage.putPieces.get(`staging/${member.accountId}/${picture}`)).toEqual(Array(12).fill(MiB));
    world.db.leases.get(picture)!.state = 'attached';
    const file = randomUUID();
    const huge = Buffer.alloc(100 * MiB, 7);
    expect((await world.upload(member, file, huge, {cls: 'file'})).status).toBe(201);
    expect(world.storage.putPieces.get(`staging/${member.accountId}/${file}`)).toHaveLength(100);
    expect(world.db.leases.get(file)).toMatchObject({length: 100 * MiB, state: 'complete'});
  }, 60_000);

  it('refuses an upload with a Content-Length of nothing (chunked), 411, before reading anything', async () => {
    const member = world.member();
    const id = randomUUID();
    const bytes = pngBytes(2000);
    const reply = await world.upload(member, id, bytes, {contentLength: null});
    expect([reply.status, reply.json()]).toEqual([411, {error: 'length_required'}]);
    expect(world.db.calls).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  it('refuses a picture over 12 MiB and a file over 100 MiB, 413, as soon as the headers are read: the body is not taken', async () => {
    const member = world.member();
    const cases: [string, 'picture' | 'file', number][] = [
      ['a picture one byte over 12 MiB', 'picture', 12 * MiB + 1],
      ['a picture of 13 MiB', 'picture', 13 * MiB],
      ['a file one byte over 100 MiB', 'file', 100 * MiB + 1],
      ['a file of 2 GiB', 'file', 2 * 1024 * MiB],
    ];
    for (const [name, cls, length] of cases) {
      const id = randomUUID();
      const sha = sha256(name);
      const ct = cls === 'picture' ? 'image/png' : 'application/octet-stream';
      // A ticket signed directly: the route that issues them would not make one. The body is declared and not sent: the answer comes first.
      const token = world.ticket(member, {dir: 'upload', tid: id, cls, len: length, sha, ct});
      const reply = await world.send(`/v1/uploads/${id}`, {
        method: 'PUT',
        headers: {authorization: `Ticket ${token}`, 'content-type': ct, 'x-content-sha256': sha},
        body: pngBytes(1000),
        contentLength: length,
      });
      expect([reply.status, reply.json()], name).toEqual([413, {error: 'payload_too_large'}]);
    }
    expect(world.db.calls).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  it('refuses a declared type the class does not allow, and a length the ticket does not name, 400, before the database is asked anything', async () => {
    const member = world.member();
    const bytes = pngBytes(3000);
    const id = randomUUID();
    const cases: [string, Promise<{status: number; json: () => Record<string, unknown>}>, number, string][] = [
      ['a picture declared octet-stream', world.upload(member, id, bytes, {ct: 'application/octet-stream'}), 400, 'invalid_upload'],
      ['a picture declared a GIF', world.upload(member, id, bytes, {ct: 'image/gif'}), 400, 'invalid_upload'],
      ['a file declared a PNG', world.upload(member, id, bytes, {cls: 'file', ct: 'image/png'}), 400, 'invalid_upload'],
      ['a body longer than the ticket says', world.upload(member, id, Buffer.concat([bytes, Buffer.from('x')]), {claims: {len: bytes.length}, sha: sha256(bytes)}), 400, 'length_mismatch'],
      ['a body shorter than the ticket says', world.upload(member, id, bytes.subarray(0, 100), {claims: {len: bytes.length}, sha: sha256(bytes)}), 400, 'length_mismatch'],
      ['a Content-Type that is not the ticket\'s', world.upload(member, id, bytes, {headers: {'content-type': 'image/jpeg'}}), 400, 'content_type_mismatch'],
      ['no Content-Type', world.upload(member, id, bytes, {headers: {'content-type': undefined}}), 400, 'content_type_mismatch'],
      ['a Content-Type with a parameter', world.upload(member, id, bytes, {headers: {'content-type': 'image/png; charset=binary'}}), 400, 'content_type_mismatch'],
      ['a checksum header that is not the ticket\'s', world.upload(member, id, bytes, {headers: {'x-content-sha256': sha256('other')}}), 400, 'checksum_mismatch'],
      ['no checksum header', world.upload(member, id, bytes, {headers: {'x-content-sha256': undefined}}), 400, 'checksum_mismatch'],
    ];
    for (const [name, pending, status, error] of cases) {
      const reply = await pending;
      expect([reply.status, reply.json()], name).toEqual([status, {error}]);
    }
    expect(world.db.calls).toEqual([]);
    expect(world.storage.calls).toEqual([]);
  });

  it('refuses a kind with no resolver, and any kind but staging, for an upload: 400 unknown_target, at the gateway, before the database', async () => {
    const bytes = pngBytes(2000);
    const member = world.member();
    for (const tk of ['nope', 'fixture', 'project']) {
      const reply = await world.upload(member, randomUUID(), bytes, {claims: {tk}});
      expect([reply.status, reply.json()], tk).toEqual([400, {error: 'unknown_target'}]);
    }
    expect(world.db.calls).toEqual([]);
  });

  it('refuses a download of a kind with no resolver, 400 unknown_target, after verifying the ticket and before the database', async () => {
    const member = world.member();
    const id = randomUUID();
    const reply = await world.download(member, id, {kind: 'nope'});
    expect([reply.status, reply.json()]).toEqual([400, {error: 'unknown_target'}]);
    const link = await world.send(`/d/${world.ticket(member, {dir: 'download', tid: id, tk: 'nope'})}`);
    expect([link.status, link.json()]).toEqual([400, {error: 'unknown_target'}]);
    expect(world.db.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('an upload that fails leaves no object and releases its lease', () => {
  const settled = async (check: () => boolean) => {
    for (let waited = 0; waited < 3000 && !check(); waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    return check();
  };

  it.each([
    ['a JPEG that is a PNG', 'image/jpeg', () => pngBytes(4000)],
    ['a PNG that is a JPEG', 'image/png', () => jpegBytes(4000)],
    ['a WebP that is a PNG', 'image/webp', () => pngBytes(4000)],
    ['a WebP that is RIFF and no WEBP', 'image/webp', () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(8), randomBytes(100)])],
    ['a PNG that is shorter than its signature', 'image/png', () => Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['a PNG that is not one', 'image/png', () => randomBytes(5000).fill(0x41, 0, 8)],
  ])('refuses %s: 400 content_mismatch, the partial object deleted, the lease released, and nothing attached', async (_name, ct, make) => {
    const member = world.member();
    const id = randomUUID();
    const bytes = make();
    const reply = await world.upload(member, id, bytes, {ct});
    expect([reply.status, reply.json()]).toEqual([400, {error: 'content_mismatch'}]);
    expect(world.storage.keys()).toEqual([]);
    expect(world.storage.abortedPuts).toBe(1);
    expect(world.storage.calls).toContain(`delete:staging/${member.accountId}/${id}`);
    expect(world.db.leases.get(id)!.state).toBe('released');
    expect(world.db.manifests.size).toBe(0);
  });

  it('refuses a large body at its first chunk and reads no more of it than a little: the sender reads the answer or finds the connection cut', async () => {
    const member = world.member();
    const id = randomUUID();
    const outcome = await world
      .upload(member, id, pngBytes(3 * MiB), {ct: 'image/jpeg'})
      .then((reply) => [reply.status, reply.json()])
      .catch((error: NodeJS.ErrnoException) => error.code);
    // 3 MiB is far past what a refused upload is read for (smallBody, 64 KiB), so either the answer arrived before the connection was cut or the cut
    // reached the sender first, as for an unbelieved ticket above: never anything else.
    expect([[400, {error: 'content_mismatch'}], 'ECONNRESET', 'EPIPE']).toContainEqual(outcome);
    // The chunk that was refused was the first: no later one was authorized, hashed or stored.
    expect(world.chunks).toEqual([{direction: 'upload', index: 0}]);
    expect(world.db.count('progress')).toBe(0);
  });

  it('refuses a body whose SHA-256 is not the ticket\'s, 400 checksum_mismatch, after the last byte: nothing is kept, the lease is released', async () => {
    const member = world.member();
    const id = randomUUID();
    const bytes = pngBytes(1.5 * MiB);
    const claimed = sha256('some other file');
    const reply = await world.upload(member, id, bytes, {sha: claimed});
    expect([reply.status, reply.json()]).toEqual([400, {error: 'checksum_mismatch'}]);
    expect(world.storage.keys()).toEqual([]);
    expect(world.storage.abortedPuts).toBe(1);
    expect(world.db.leases.get(id)).toMatchObject({state: 'released', sha256: claimed});
    // Every chunk was authorized before the checksum could be known.
    expect(world.db.count('authorizeHandle')).toBe(2);
    expect(world.db.count('complete')).toBe(0);
  });

  it('refuses an upload that would put the Account over 250 MiB of open staging, 413 quota_exceeded, and leaves no lease for it', async () => {
    const member = world.member();
    // 250 MiB less 1000 bytes are open already (leases that are receiving or complete and not expired).
    for (const length of [100 * MiB, 100 * MiB, 50 * MiB - 1000]) world.db.seedLease({id: randomUUID(), accountId: member.accountId, kind: 'file', length, state: 'complete', receivedLength: length});
    expect(world.db.openBytes(member.accountId)).toBe(250 * MiB - 1000);
    const before = world.db.leases.size;

    const over = randomUUID();
    const refused = await world.upload(member, over, randomBytes(1001), {cls: 'file'});
    expect([refused.status, refused.json()]).toEqual([413, {error: 'quota_exceeded'}]);
    expect(world.db.leases.has(over)).toBe(false);
    expect(world.db.leases.size).toBe(before);
    expect(world.storage.calls).toEqual([]);

    // Exactly the quota is within it, and the next byte is not.
    const exact = randomUUID();
    expect((await world.upload(member, exact, randomBytes(1000), {cls: 'file'})).status).toBe(201);
    expect(world.db.openBytes(member.accountId)).toBe(250 * MiB);
    const next = await world.upload(member, randomUUID(), randomBytes(1), {cls: 'file'});
    expect([next.status, next.json()]).toEqual([413, {error: 'quota_exceeded'}]);
    // Another Account has a quota of its own, and what has expired or been released no longer counts.
    const other = world.member();
    expect((await world.upload(other, randomUUID(), randomBytes(5000), {cls: 'file'})).status).toBe(201);
    for (const lease of world.db.leases.values()) if (lease.accountId === member.accountId) lease.state = 'released';
    expect((await world.upload(member, randomUUID(), randomBytes(5000), {cls: 'file'})).status).toBe(201);
  });

  it('refuses an upload ID that another Account holds, and one the same Account used already, 409 upload_exists, and leaves the other lease and its object as they were', async () => {
    const owner = world.member();
    const stranger = world.member();
    const id = randomUUID();
    const bytes = pngBytes(5000);
    expect((await world.upload(owner, id, bytes)).status).toBe(201);
    const lease = {...world.db.leases.get(id)!};
    const stored = Buffer.from(world.storage.objects.get(`staging/${owner.accountId}/${id}`)!.bytes);
    const putsBefore = world.storage.calls.length;

    const foreign = await world.upload(stranger, id, pngBytes(7000));
    expect([foreign.status, foreign.json()]).toEqual([409, {error: 'upload_exists'}]);
    const repeated = await world.upload(owner, id, bytes);
    expect([repeated.status, repeated.json()]).toEqual([409, {error: 'upload_exists'}]);

    expect(world.db.leases.get(id)).toEqual(lease);
    expect(world.storage.calls.length).toBe(putsBefore);
    expect(world.storage.objects.get(`staging/${owner.accountId}/${id}`)!.bytes.equals(stored)).toBe(true);
    expect(world.storage.keys()).toEqual([`staging/${owner.accountId}/${id}`]);
    // The lease the second Account never had is not released for it either.
    expect(world.db.count('release')).toBe(0);
  });

  it('stops at the first chunk whose authorization is refused, and answers 403: the upload is aborted, the lease released, nothing stored', async () => {
    const reasons: [string, (m: FakeMember) => void][] = [
      ['a session grant that is revoked', (m) => world.db.revokeSession(m.sessionId)],
      ['an Account that is disabled', (m) => world.db.disableAccount(m.accountId)],
      ['an Account that is deleted (a tombstone)', (m) => world.db.tombstoneAccount(m.accountId)],
      ['an epoch that was raised', (m) => world.db.raiseEpoch(m.accountId)],
    ];
    for (const [name, act] of reasons) {
      const member = world.member();
      const id = randomUUID();
      world.hooks.onChunk = ({index}) => {
        if (index === 2) act(member);
      };
      expectRefused(await uploadOutcome(world.upload(member, id, pngBytes(4 * MiB))), 403, {error: 'forbidden'}, name);
      expect(world.storage.keys(), name).toEqual([]);
      expect(world.db.leases.get(id)!.state, name).toBe('released');
      // Chunks 0 and 1 were authorized and counted; chunk 2 was asked about and never counted; chunk 3 was never read.
      expect(world.chunks.filter((chunk) => chunk.direction === 'upload').map((chunk) => chunk.index), name).toEqual([0, 1, 2]);
      expect(world.db.leases.get(id)!.receivedLength, name).toBe(2 * MiB);
      world.chunks.length = 0;
      world.storage.calls.length = 0;
    }
  });

  it('stops when the key that opened the transfer is revoked between two chunks (its handle ends, its lease is released) and answers 403', async () => {
    const member = world.member();
    const id = randomUUID();
    world.hooks.onChunk = ({index}) => {
      if (index === 1) expect(world.db.revokeKey(world.keys.signer.kid)).toEqual({leases: 1, transfers: 1});
    };
    expectRefused(await uploadOutcome(world.upload(member, id, pngBytes(3 * MiB))), 403, {error: 'forbidden'});
    expect(world.storage.keys()).toEqual([]);
    expect(world.db.leases.get(id)!.state).toBe('released');
  });

  it('stops when the lease itself ends under an upload (the target is gone: the resolver says so), 409 upload_ended, nothing stored', async () => {
    const member = world.member();
    const id = randomUUID();
    world.hooks.onChunk = ({index}) => {
      if (index === 1) world.db.leases.get(id)!.state = 'released';
    };
    expectRefused(await uploadOutcome(world.upload(member, id, pngBytes(3 * MiB))), 409, {error: 'upload_ended'});
    expect(world.storage.keys()).toEqual([]);
  });

  it('stops when the database stops answering between two chunks: 503, never a stored object, and the lease is left for the cleanup if even its release cannot be written', async () => {
    const member = world.member();
    const id = randomUUID();
    world.hooks.onChunk = ({index}) => {
      if (index === 1) world.db.down = true;
    };
    const reply = await uploadOutcome(world.upload(member, id, pngBytes(3 * MiB)));
    expectRefused(reply, 503, {error: 'unavailable'});
    if (typeof reply !== 'string') expect(reply.headers['retry-after']).toBe('5');
    expect(world.storage.keys()).toEqual([]);
    expect(world.storage.abortedPuts).toBe(1);
    expect(world.db.leases.get(id)!.state).toBe('receiving');
    // The reason was logged as the class of the error that was met, and no more.
    expect(world.logs).toContainEqual(['The gateway could not authorize a chunk.', 'DatabaseUnavailable']);
  });

  it('answers 503 for a database that cannot answer the authorization alone, and the resolver alone, while chunks are being read', async () => {
    for (const method of ['authorizeHandle', 'query']) {
      const member = world.member();
      const id = randomUUID();
      world.db.failing.add(method);
      const reply = await world.upload(member, id, pngBytes(2000));
      expect([reply.status, reply.json()], method).toEqual([503, {error: 'unavailable'}]);
      expect(world.storage.keys(), method).toEqual([]);
      expect(world.db.leases.get(id)!.state, method).toBe('released');
      world.db.failing.clear();
    }
  });

  it('does not keep an object whose lease cannot be completed: the object is deleted and the answer is 503', async () => {
    const member = world.member();
    const id = randomUUID();
    world.db.failing.add('complete');
    const reply = await world.upload(member, id, pngBytes(5000));
    expect([reply.status, reply.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(world.storage.keys()).toEqual([]);
    expect(world.storage.calls).toContain(`delete:staging/${member.accountId}/${id}`);
    expect(world.db.leases.get(id)!.state).toBe('released');
  });

  it('does not keep an object whose lease ended while the last chunk landed: 409, the object deleted', async () => {
    const member = world.member();
    const id = randomUUID();
    // The last chunk is authorized and counted; then the lease is released before `complete` can mark it.
    const releaseAfterLast = world.db.complete.bind(world.db);
    world.db.complete = async (...args) => {
      world.db.leases.get(id)!.state = 'released';
      return releaseAfterLast(...args);
    };
    const reply = await world.upload(member, id, pngBytes(5000));
    expect([reply.status, reply.json()]).toEqual([409, {error: 'upload_ended'}]);
    expect(world.storage.keys()).toEqual([]);
  });

  it('answers 503 and logs the class of the error when Storage fails, and the message of that error reaches no one', async () => {
    const member = world.member();
    const id = randomUUID();
    world.storage.failure = Object.assign(new Error('S3 said: access key AKIA0000 is not allowed (secret-key)'), {name: 'StorageUnavailable'});
    const reply = await world.upload(member, id, pngBytes(300 * 1024));
    expect([reply.status, reply.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(world.logs).toContainEqual(['The gateway failed an upload.', 'StorageUnavailable']);
    expect(world.db.leases.get(id)!.state).toBe('released');
  });

  it('puts none of the bytes of a body in an answer or a log, whatever went wrong with it', async () => {
    const marker = Buffer.from('THE-PRIVATE-CONTENTS-OF-A-FILE-9f3c1e');
    const member = world.member();
    const body = Buffer.concat([marker, randomBytes(2000)]);
    const bad = await world.upload(member, randomUUID(), body, {cls: 'file', sha: sha256('not this')});
    world.storage.failure = Object.assign(new Error(`the store refused ${marker.toString()}`), {name: 'StorageUnavailable'});
    const down = await world.upload(member, randomUUID(), body, {cls: 'file'});
    expect([bad.status, down.status]).toEqual([400, 503]);
    const printed = [...world.logs.flat(), ...world.seen.flatMap((entry) => [entry.text ?? '', JSON.stringify(entry.headers)])].join('\n');
    expect(printed).not.toContain(marker.toString());
  });

  it('leaves no object and a lease the cleanup will find when the client goes away in the middle of the body', async () => {
    const member = world.member();
    const id = randomUUID();
    const bytes = pngBytes(4 * MiB);
    const token = world.ticket(member, {dir: 'upload', tid: id, cls: 'picture', len: bytes.length, sha: sha256(bytes), ct: 'image/png'});
    await new Promise<void>((resolve) => {
      const req = http.request(
        {host: '127.0.0.1', port: new URL(world.url).port, path: `/v1/uploads/${id}`, method: 'PUT', agent, headers: {authorization: `Ticket ${token}`, 'content-type': 'image/png', 'content-length': String(bytes.length), 'x-content-sha256': sha256(bytes)}},
        () => undefined,
      );
      req.on('error', () => resolve());
      req.on('close', () => resolve());
      // 1.5 MiB of it, then the connection is cut.
      req.write(bytes.subarray(0, 1.5 * MiB), () => setTimeout(() => req.destroy(), 100));
    });
    expect(await settled(() => world.db.leases.get(id)?.state === 'released')).toBe(true);
    expect(world.storage.keys()).toEqual([]);
    expect(world.storage.abortedPuts).toBe(1);
    expect(world.db.leases.get(id)!.receivedLength).toBeLessThan(bytes.length);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a ticket is redeemed against the live session before a byte moves', () => {
  const bytes = pngBytes(4000);

  it.each(['revoked', 'disabled', 'expired', 'idle', 'stale_epoch', 'subject_mismatch', 'no_session', 'tombstoned'])('refuses a ticket whose session grant is %s: 403 forbidden, one read, nothing opened', async (state) => {
    const member = world.member({state});
    const reply = await world.upload(member, randomUUID(), bytes);
    expect([reply.status, reply.json()]).toEqual([403, {error: 'forbidden'}]);
    const download = await world.download(member, randomUUID());
    expect([download.status, download.json()]).toEqual([403, {error: 'forbidden'}]);
    expect(world.db.calls).toEqual(['authority', 'authority']);
    expect(world.db.redemptions.size + world.db.leases.size + world.db.handles.size).toBe(0);
    expect(world.storage.calls).toEqual([]);
  });

  it('refuses a ticket issued under an epoch the Account has since left, even when the session still looks live', async () => {
    const member = world.member();
    world.db.accounts.get(member.accountId)!.epoch = 2;
    const reply = await world.upload(member, randomUUID(), bytes);
    expect([reply.status, reply.json()]).toEqual([403, {error: 'forbidden'}]);
    expect(world.db.redemptions.size).toBe(0);
  });

  it('answers 503 before any byte when the database cannot be asked, at each of the three steps of opening a transfer', async () => {
    for (const method of ['authority', 'openTransfer', 'createLease']) {
      const member = world.member();
      world.db.failing.add(method);
      const reply = await world.upload(member, randomUUID(), bytes);
      expect([reply.status, reply.json()], method).toEqual([503, {error: 'unavailable'}]);
      expect(reply.headers['retry-after'], method).toBe('5');
      expect(world.storage.calls, method).toEqual([]);
      world.db.failing.clear();
    }
    // The first two leave no redemption behind to be mistaken for a use of the ticket.
    expect(world.db.leases.size).toBe(0);
    world.db.down = true;
    const download = await world.download(world.member(), randomUUID());
    expect([download.status, download.json()]).toEqual([503, {error: 'unavailable'}]);
    const link = await world.send(`/d/${world.ticket(world.member(), {dir: 'download', tid: randomUUID()})}`);
    expect([link.status, link.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(world.storage.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
describe('a download', () => {
  it('serves the whole object: 200, its type and length, Accept-Ranges, a strong ETag of its digest, an attachment, no range', async () => {
    const member = world.member();
    const bytes = randomBytes(70_000);
    const staged = world.stage(member, bytes);
    const reply = await world.download(member, staged.id);
    expect(reply.status).toBe(200);
    expect(reply.body.equals(bytes)).toBe(true);
    expect(reply.headers['content-type']).toBe('application/octet-stream');
    expect(reply.headers['content-length']).toBe(String(bytes.length));
    expect(reply.headers['accept-ranges']).toBe('bytes');
    expect(reply.headers.etag).toBe(`"${sha256(bytes)}"`);
    expect(reply.headers['content-disposition']).toBe('attachment');
    expect(reply.headers['content-range']).toBeUndefined();
    expect(world.storage.calls).toEqual([`get:staging/${member.accountId}/${staged.id}`]);
  });

  it('serves a picture with the type it was stored with, and an object that was attached too', async () => {
    const member = world.member();
    const bytes = pngBytes(5000);
    const picture = world.stage(member, bytes, {kind: 'picture'});
    expect((await world.download(member, picture.id)).headers['content-type']).toBe('image/png');
    const attached = world.stage(member, bytes, {state: 'attached'});
    expect((await world.download(member, attached.id)).status).toBe(200);
  });

  const bytes = randomBytes(5000);
  const length = bytes.length;
  it.each([
    ['bytes=10-99', 10, 99],
    ['bytes=0-0', 0, 0],
    ['bytes=4999-4999', 4999, 4999],
    ['bytes=100-', 100, length - 1],
    ['bytes=0-', 0, length - 1],
    ['bytes=-50', length - 50, length - 1],
    ['bytes=-5000', 0, length - 1],
    ['bytes=-999999', 0, length - 1],
    ['bytes=10-999999999', 10, length - 1],
  ])('serves one range %s: 206 with Content-Range, exactly those bytes', async (range, start, end) => {
    const member = world.member();
    const staged = world.stage(member, bytes);
    const reply = await world.download(member, staged.id, {headers: {range}});
    expect(reply.status).toBe(206);
    expect(reply.headers['content-range']).toBe(`bytes ${start}-${end}/${length}`);
    expect(reply.headers['content-length']).toBe(String(end - start + 1));
    expect(reply.body.equals(bytes.subarray(start, end + 1))).toBe(true);
    expect(reply.headers['accept-ranges']).toBe('bytes');
    // Only that range was read from Storage.
    expect(world.storage.calls).toEqual([`get:staging/${member.accountId}/${staged.id}`]);
  });

  it.each(['bytes=5000-', 'bytes=5000-5001', 'bytes=99999-', 'bytes=5-2', 'bytes=0-1,5-9', 'bytes=0-1, 3-4', 'items=0-5', 'bytes=-0', 'bytes=-', 'bytes=', 'bytes=a-b', 'bytes=0-1-2', 'garbage', ''])(
    'refuses the range %j with 416, Content-Range: bytes */length and no body of the object',
    async (range) => {
      const member = world.member();
      const staged = world.stage(member, bytes);
      const reply = await world.download(member, staged.id, {headers: {range}});
      expect([reply.status, reply.json()]).toEqual([416, {error: 'range_not_satisfiable'}]);
      expect(reply.headers['content-range']).toBe(`bytes */${length}`);
      expect(world.storage.calls).toEqual([]);
    },
  );

  it('serves the whole object to a resume whose If-Range names another version, and the range to one that names this one', async () => {
    const member = world.member();
    const staged = world.stage(member, bytes);
    const same = await world.download(member, staged.id, {headers: {range: 'bytes=100-199', 'if-range': `"${sha256(bytes)}"`}});
    expect([same.status, same.headers['content-range']]).toEqual([206, `bytes 100-199/${length}`]);
    const other = await world.download(member, staged.id, {headers: {range: 'bytes=100-199', 'if-range': '"someotherversion"'}});
    expect([other.status, other.body.equals(bytes), other.headers['content-range']]).toEqual([200, true, undefined]);
    const weak = await world.download(member, staged.id, {headers: {range: 'bytes=100-199', 'if-range': `W/"${sha256(bytes)}"`}});
    expect(weak.status).toBe(200);
    // An If-Range with no Range is only the whole object.
    expect((await world.download(member, staged.id, {headers: {'if-range': `"${sha256(bytes)}"`}})).status).toBe(200);
  });

  it('cuts the object into chunks of at most 1 MiB and asks before EACH: an authorization read and the resolver ahead of the headers and ahead of every chunk', async () => {
    const member = world.member();
    const big = randomBytes(3.5 * MiB);
    const staged = world.stage(member, big);
    const reply = await world.download(member, staged.id);
    expect(reply.status).toBe(200);
    expect(reply.body.equals(big)).toBe(true);
    // The chunks the hook saw are four, 1 MiB, 1 MiB, 1 MiB and half a MiB: none bigger than 1 MiB.
    expect(world.chunks).toEqual([0, 1, 2, 3].map((index) => ({direction: 'download', index})));
    // The ticket opens the transfer (a session read, the redemption); the transfer is authorized once before the headers and once before each of the four chunks.
    expect(world.db.calls).toEqual(['authority', 'openTransfer', ...Array(5).fill(['authorizeHandle', 'query']).flat()]);
    expect(world.storage.calls).toEqual([`get:staging/${member.accountId}/${staged.id}`]);
  });

  it('chunks a range the same way, and asks before each of its chunks', async () => {
    const member = world.member();
    const big = randomBytes(3 * MiB);
    const staged = world.stage(member, big);
    const reply = await world.download(member, staged.id, {headers: {range: `bytes=100-${3 * MiB - 1}`}});
    expect(reply.status).toBe(206);
    expect(reply.body.equals(big.subarray(100))).toBe(true);
    // 3 MiB - 100 bytes is three chunks.
    expect(world.chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
    expect(world.db.count('authorizeHandle')).toBe(1 + 3);
  });

  it('hands out no storage URL, key or credential: the headers and the body of the answer name none, and the redemption holds none', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(3000));
    const reply = await world.download(member, staged.id);
    const all = JSON.stringify(reply.headers);
    expect(all).not.toMatch(/https?:|amz|signature|s3|storage\/|private-files|staging|objects\//i);
    expect(all).not.toContain(member.accountId);
    expect(JSON.stringify([...world.db.redemptions.values()])).not.toMatch(/https?:|amz|AKIA|secret/i);
  });

  it('refuses another Account\'s file as it refuses one that is not there: 404 not_found, and reads nothing from Storage', async () => {
    const owner = world.member();
    const stranger = world.member();
    const staged = world.stage(owner, randomBytes(2000));
    const foreign = await world.download(stranger, staged.id);
    const none = await world.download(stranger, randomUUID());
    expect([foreign.status, foreign.text]).toEqual([404, JSON.stringify({error: 'not_found'})]);
    expect([none.status, none.text]).toEqual([404, JSON.stringify({error: 'not_found'})]);
    expect(world.storage.calls).toEqual([]);
  });

  it.each([
    ['still being received', {state: 'receiving' as const}],
    ['released', {state: 'released' as const}],
    ['expired', {expiresAt: new Date(T0 - 1000)}],
    ['expiring this very moment', {expiresAt: new Date(T0)}],
  ])('refuses a file whose lease is %s: 404, nothing read from Storage', async (_name, settings) => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(2000), settings);
    const reply = await world.download(member, staged.id);
    expect([reply.status, reply.json()]).toEqual([404, {error: 'not_found'}]);
    expect(world.storage.calls).toEqual([]);
  });

  it('answers 404 when the lease is there and the object is not, and 503 when Storage cannot be opened', async () => {
    const member = world.member();
    const missing = world.stage(member, randomBytes(2000), {object: false});
    const reply = await world.download(member, missing.id);
    expect([reply.status, reply.json()]).toEqual([404, {error: 'not_found'}]);
    const present = world.stage(member, randomBytes(2000));
    world.storage.failure = Object.assign(new Error('the store is on fire at s3.internal.example'), {name: 'StorageUnavailable'});
    const down = await world.download(member, present.id);
    expect([down.status, down.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(world.logs).toContainEqual(['The gateway could not open an object.', 'StorageUnavailable']);
  });

  it('answers 503, and cancels the read, when the object is not the length its lease says', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(2000));
    world.storage.objects.get(staged.key)!.bytes = randomBytes(1500);
    const reply = await world.download(member, staged.id);
    expect([reply.status, reply.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(world.storage.cancels).toBe(1);
  });

  it('answers 503 before any byte when the database cannot answer the authorization, or the resolver, and reads nothing from Storage', async () => {
    for (const method of ['authorizeHandle', 'query']) {
      const member = world.member();
      const staged = world.stage(member, randomBytes(2000));
      world.db.failing.add(method);
      const reply = await world.download(member, staged.id);
      expect([reply.status, reply.json()], method).toEqual([503, {error: 'unavailable'}]);
      expect(world.storage.calls, method).toEqual([]);
      world.db.failing.clear();
    }
    expect(world.logs.every(([message]) => message === 'The gateway could not authorize a chunk.')).toBe(true);
  });

  const MID = 2;
  const ending: [string, (m: FakeMember, id: string) => void][] = [
    ['a session grant is revoked', (m) => world.db.revokeSession(m.sessionId)],
    ['the Account is disabled', (m) => world.db.disableAccount(m.accountId)],
    ['the Account is deleted', (m) => world.db.tombstoneAccount(m.accountId)],
    ['the epoch is raised', (m) => world.db.raiseEpoch(m.accountId)],
    ['the signing key is revoked', () => world.db.revokeKey(world.keys.signer.kid)],
    ['the lease is released', (_m, id) => (world.db.leases.get(id)!.state = 'released')],
    ['the database stops answering', () => (world.db.down = true)],
    ['the authorization read fails alone', () => world.db.failing.add('authorizeHandle')],
  ];

  it.each(ending)('stops after chunk 2 when %s: exactly 2 MiB reach the client, which sees the stream cut, and the read is cancelled', async (_name, act) => {
    const member = world.member();
    const big = randomBytes(4.5 * MiB);
    const staged = world.stage(member, big);
    world.hooks.onChunk = ({direction, index}) => {
      if (direction === 'download' && index === MID) act(member, staged.id);
    };
    const token = world.ticket(member, {dir: 'download', tid: staged.id});
    const reply = await world.stream(`/v1/files/staging/${staged.id}`, {headers: {authorization: `Ticket ${token}`}});
    // The headers were sent (200, a length that promised more), what was delivered is the first two chunks, byte for byte, and nothing after.
    expect(reply.status).toBe(200);
    expect(reply.headers['content-length']).toBe(String(big.length));
    expect(reply.outcome).toBe('aborted');
    expect(reply.received.length).toBe(MID * MiB);
    expect(reply.received.equals(prefix(big, MID * MiB))).toBe(true);
    expect(world.storage.cancels).toBe(1);
    expect(world.chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
  });

  it('asks about the FIRST chunk before the headers go out: access that ends before it is a 403 and not one byte of the body, and the read of the object is cancelled', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(2 * MiB));
    world.hooks.onChunk = ({direction, index}) => {
      if (direction === 'download' && index === 0) world.db.revokeSession(member.sessionId);
    };
    const token = world.ticket(member, {dir: 'download', tid: staged.id});
    const reply = await world.stream(`/v1/files/staging/${staged.id}`, {headers: {authorization: `Ticket ${token}`}});
    expect([reply.status, reply.outcome, JSON.parse(reply.received.toString('utf8'))]).toEqual([403, 'ended', {error: 'forbidden'}]);
    expect(reply.headers['content-range']).toBeUndefined();
    expect(reply.headers['content-disposition']).toBeUndefined();
    expect(world.storage.cancels).toBe(1);
  });

  it('answers 503, a status, when the database stops answering between resolving the target and the first chunk', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(2 * MiB));
    world.hooks.onChunk = ({direction, index}) => {
      if (direction === 'download' && index === 0) world.db.down = true;
    };
    const token = world.ticket(member, {dir: 'download', tid: staged.id});
    const reply = await world.stream(`/v1/files/staging/${staged.id}`, {headers: {authorization: `Ticket ${token}`}});
    expect([reply.status, reply.outcome]).toEqual([503, 'ended']);
    expect(reply.received.length).toBeLessThan(200);
    expect(world.storage.cancels).toBe(1);
  });

  it('stops a download whose target kind is registered by a fixture resolver when that target\'s state changes between two chunks', async () => {
    const bytes = randomBytes(3 * MiB);
    const fixture = createFixtureResolver();
    await world.close();
    world = await start({resolvers: createResolvers({[fixtureKind]: fixture.resolver})});
    const member = world.member();
    const id = randomUUID();
    const key = `staging/${member.accountId}/${id}`;
    world.storage.objects.set(key, {bytes, contentType: 'application/octet-stream'});
    fixture.add(member.accountId, id, {key, length: bytes.length, contentType: 'application/octet-stream', etag: sha256(bytes)});
    world.hooks.onChunk = ({direction, index}) => {
      if (direction === 'download' && index === 1) fixture.setAvailable(member.accountId, id, false);
    };
    const reply = await world.stream(`/v1/files/${fixtureKind}/${id}`, {headers: {authorization: `Ticket ${world.ticket(member, {dir: 'download', tid: id, tk: fixtureKind})}`}});
    expect(reply.outcome).toBe('aborted');
    expect(reply.received.equals(prefix(bytes, MiB))).toBe(true);
    // The registry asked the fixture before the headers and before every chunk it was given.
    expect(fixture.asked.length).toBeGreaterThanOrEqual(3);
    // Whole, while it is there, and the staging kind is still there beside it.
    fixture.setAvailable(member.accountId, id, true);
    world.hooks.onChunk = null;
    const whole = await world.download(member, id, {kind: fixtureKind});
    expect([whole.status, whole.body.equals(bytes)]).toEqual([200, true]);
    // A fixture kind is no upload target, and a kind nobody registered is refused.
    expect((await world.upload(member, randomUUID(), pngBytes(2000), {claims: {tk: fixtureKind}})).status).toBe(400);
    expect((await world.download(member, id, {kind: 'unregistered'})).status).toBe(400);
  });

  it('leaves the database alone when a client that has gone away is still being sent chunks: the read is cancelled, nothing is served on', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(8 * MiB));
    // Each piece of the object takes a moment to read, so the client has left while most of it is still to come.
    world.storage.beforeRead = () => new Promise((resolve) => setTimeout(resolve, 2));
    const token = world.ticket(member, {dir: 'download', tid: staged.id});
    await new Promise<void>((resolve) => {
      const req = http.request({host: '127.0.0.1', port: new URL(world.url).port, path: `/v1/files/staging/${staged.id}`, agent, headers: {authorization: `Ticket ${token}`}}, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
        res.on('error', () => undefined);
      });
      req.on('error', () => undefined);
      req.end();
    });
    const waited = Date.now();
    while (world.storage.cancels === 0 && Date.now() - waited < 3000) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(world.storage.cancels).toBe(1);
    // It stopped asking too: fewer chunks were authorized than the eight there were.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(world.chunks.length).toBeLessThan(8);
  }, 20_000);
});

// ---------------------------------------------------------------------------------------------------
describe('a browser-native download: a link with a ticket, then a handle', () => {
  const handleOf = (location: string | undefined) => /^\/h\/([A-Za-z0-9_-]{43})\/([0-9a-f-]{36})$/.exec(location ?? '');

  it('redirects with 303 to /h/<handle>/<target>, without referrer, never cached, holding no ticket and no storage address', async () => {
    const member = world.member();
    const bytes = randomBytes(5000);
    const staged = world.stage(member, bytes);
    const ticket = world.ticket(member, {dir: 'download', tid: staged.id});
    const reply = await world.send(`/d/${ticket}`);
    expect(reply.status).toBe(303);
    expect(reply.headers['referrer-policy']).toBe('no-referrer');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.body.length).toBe(0);
    const match = handleOf(reply.headers.location);
    expect(match).not.toBeNull();
    expect(match![2]).toBe(staged.id);
    expect(match![1]).toBe(world.handles[0]);
    expect(reply.headers.location).not.toContain(ticket);
    expect(reply.headers.location).not.toMatch(/https?:|amz|staging\/|signature/i);
    // The ticket opened a transfer and nothing else: one redemption, one handle, no byte read.
    expect([world.db.redemptions.size, world.db.handles.size]).toEqual([1, 1]);
    expect(world.storage.calls).toEqual([]);
    expect([...world.db.handles.values()][0]).toMatchObject({direction: 'download', targetId: staged.id});
  });

  it('serves the target at the handle URL: the whole, a range, and a resume with If-Range, for as long as the handle lives, with no referrer and never cached', async () => {
    const member = world.member();
    const bytes = randomBytes(9000);
    const staged = world.stage(member, bytes);
    const redirect = await world.send(`/d/${world.ticket(member, {dir: 'download', tid: staged.id})}`);
    const location = redirect.headers.location!;

    const whole = await world.send(location);
    expect([whole.status, whole.body.equals(bytes), whole.headers['referrer-policy'], whole.headers['cache-control']]).toEqual([200, true, 'no-referrer', 'no-store']);
    const range = await world.send(location, {headers: {range: 'bytes=1000-1999'}});
    expect([range.status, range.headers['content-range'], range.body.equals(bytes.subarray(1000, 2000))]).toEqual([206, 'bytes 1000-1999/9000', true]);
    // A browser's own resume: where it stopped, and the ETag it was given.
    const resume = await world.send(location, {headers: {range: 'bytes=4000-', 'if-range': whole.headers.etag!}});
    expect([resume.status, resume.headers['content-range'], resume.body.equals(bytes.subarray(4000))]).toEqual([206, 'bytes 4000-8999/9000', true]);
    const changed = await world.send(location, {headers: {range: 'bytes=4000-', 'if-range': '"another"'}});
    expect([changed.status, changed.body.equals(bytes)]).toEqual([200, true]);
    const bad = await world.send(location, {headers: {range: 'bytes=0-1,5-6'}});
    expect([bad.status, bad.headers['content-range']]).toEqual([416, 'bytes */9000']);
    // Each of them was authorized on its own, by the handle, with no new ticket.
    expect(world.db.redemptions.size).toBe(1);
    expect(world.db.count('authorizeHandle')).toBeGreaterThanOrEqual(1 + 5 * 2);
  });

  it('serves a handle for 29 minutes, and refuses it from its 30th minute on: 403', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(3000));
    const location = (await world.send(`/d/${world.ticket(member, {dir: 'download', tid: staged.id})}`)).headers.location!;
    world.clock.set(T0 + 29 * MINUTE);
    expect((await world.send(location)).status).toBe(200);
    world.clock.set(T0 + 30 * MINUTE - 1);
    expect((await world.send(location)).status).toBe(200);
    for (const at of [30 * MINUTE, 31 * MINUTE, 24 * 60 * MINUTE]) {
      world.clock.set(T0 + at);
      const reply = await world.send(location);
      expect([reply.status, reply.json()], String(at)).toEqual([403, {error: 'forbidden'}]);
    }
    // The lease would have outlived it: the handle is what ended.
    world.db.leases.get(staged.id)!.expiresAt = new Date(T0 + 48 * 60 * MINUTE);
    expect((await world.send(location)).status).toBe(403);
  });

  it.each([
    ['the session grant is revoked', (m: FakeMember) => world.db.revokeSession(m.sessionId)],
    ['the Account is disabled', (m: FakeMember) => world.db.disableAccount(m.accountId)],
    ['the Account is deleted', (m: FakeMember) => world.db.tombstoneAccount(m.accountId)],
    ['the epoch is raised', (m: FakeMember) => world.db.raiseEpoch(m.accountId)],
    ['the signing key is revoked', () => world.db.revokeKey(world.keys.signer.kid)],
  ])('refuses the handle URL once %s: 403 forbidden', async (_name, act) => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(3000));
    const location = (await world.send(`/d/${world.ticket(member, {dir: 'download', tid: staged.id})}`)).headers.location!;
    expect((await world.send(location)).status).toBe(200);
    act(member);
    const reply = await world.send(location);
    expect([reply.status, reply.json()]).toEqual([403, {error: 'forbidden'}]);
  });

  it('refuses the handle for another target, 403, and serves it for its own', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(3000));
    const other = world.stage(member, randomBytes(3000));
    const location = (await world.send(`/d/${world.ticket(member, {dir: 'download', tid: staged.id})}`)).headers.location!;
    const handle = handleOf(location)![1];
    for (const target of [other.id, randomUUID()]) {
      const reply = await world.send(`/h/${handle}/${target}`);
      expect([reply.status, reply.json()], target).toEqual([403, {error: 'forbidden'}]);
    }
    expect((await world.send(`/h/${handle}/${staged.id}`)).status).toBe(200);
  });

  it('refuses the handle that opened an UPLOAD for a download, 403, and a handle the gateway never made', async () => {
    const member = world.member();
    const id = randomUUID();
    expect((await world.upload(member, id, pngBytes(3000))).status).toBe(201);
    const uploadHandle = world.handles.at(-1)!;
    const reply = await world.send(`/h/${uploadHandle}/${id}`);
    expect([reply.status, reply.json()]).toEqual([403, {error: 'forbidden'}]);
    expect(world.storage.calls.filter((call) => call.startsWith('get:'))).toEqual([]);
    const unknown = await world.send(`/h/${'A'.repeat(43)}/${id}`);
    expect([unknown.status, unknown.json()]).toEqual([403, {error: 'forbidden'}]);
    const guess = await world.send(`/h/${randomBytes(32).toString('base64url')}/${id}`);
    expect(guess.status).toBe(403);
  });

  it('refuses a handle that is not 32 bytes in base64url without asking the database, and one that is not spelled the one way', async () => {
    const id = randomUUID();
    const calls = world.db.calls.length;
    // 43 characters whose last one has bits that 32 bytes cannot hold: a handle nobody was given.
    const reply = await world.send(`/h/${'A'.repeat(42)}B/${id}`);
    expect([reply.status, reply.json()]).toEqual([403, {error: 'forbidden'}]);
    expect(world.db.calls.length).toBe(calls);
    // Any other length is no URL of the gateway's.
    for (const handle of ['A'.repeat(42), 'A'.repeat(44), '-'.repeat(10)]) expect((await world.send(`/h/${handle}/${id}`)).status).toBe(404);
  });

  it('answers 503 at a handle URL when the database cannot be asked, and 404 when the lease is gone or has expired', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(3000));
    const location = (await world.send(`/d/${world.ticket(member, {dir: 'download', tid: staged.id})}`)).headers.location!;
    world.db.down = true;
    const down = await world.send(location);
    expect([down.status, down.json()]).toEqual([503, {error: 'unavailable'}]);
    world.db.down = false;
    world.db.leases.get(staged.id)!.expiresAt = new Date(T0 - 1);
    const gone = await world.send(location);
    expect([gone.status, gone.json()]).toEqual([404, {error: 'not_found'}]);
  });

  it('refuses a link for an upload ticket and for a kind with no resolver, and a second use of the link, with no redirect', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(3000));
    const upload = await world.send(`/d/${world.ticket(member, {dir: 'upload', tid: staged.id, cls: 'file', len: 5, sha: sha256('x'), ct: 'application/octet-stream'})}`);
    expect([upload.status, upload.json()]).toEqual([401, invalidTicket]);
    const unknown = await world.send(`/d/${world.ticket(member, {dir: 'download', tid: staged.id, tk: 'nope'})}`);
    expect([unknown.status, unknown.json()]).toEqual([400, {error: 'unknown_target'}]);
    const link = world.ticket(member, {dir: 'download', tid: staged.id});
    expect((await world.send(`/d/${link}`)).status).toBe(303);
    const replay = await world.send(`/d/${link}`);
    expect([replay.status, replay.json(), replay.headers.location]).toEqual([401, invalidTicket, undefined]);
  });

  it('does not redirect to a target that is not there or is not the Account\'s: 404, and the ticket is spent', async () => {
    const owner = world.member();
    const stranger = world.member();
    const staged = world.stage(owner, randomBytes(3000));
    const foreign = await world.send(`/d/${world.ticket(stranger, {dir: 'download', tid: staged.id})}`);
    const none = await world.send(`/d/${world.ticket(owner, {dir: 'download', tid: randomUUID()})}`);
    for (const reply of [foreign, none]) expect([reply.status, reply.json(), reply.headers.location]).toEqual([404, {error: 'not_found'}, undefined]);
    expect(world.storage.calls).toEqual([]);
    // Both tickets were redeemed: a link that leads nowhere has still spent its ticket.
    expect(world.db.redemptions.size).toBe(2);
  });

  it('keeps the referrer policy on every answer of the link and of the handle URL, refusals included', async () => {
    const member = world.member();
    const refusals = [await world.send('/d/garbage'), await world.send(`/h/${'A'.repeat(43)}/${randomUUID()}`), await world.send(`/h/${'A'.repeat(42)}B/${randomUUID()}`)];
    for (const reply of refusals) expect(reply.headers['referrer-policy']).toBe('no-referrer');
    expect(member.accountId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------
describe('commands, signed by the application and carried out with the gateway\'s own key', () => {
  const stagedFile = (member: FakeMember, size = 5000) => world.stage(member, randomBytes(size));

  // Story 1.12 review (P1, an amended spec): the object of an attach is stored under the manifest's ROOT, `objects/<account>/<root>`, which is what `delete-root`
  // names. The root is the SHA-256 of the canonical body, and the body holds the upload's own ID, so every attach has a key of its own; a refused attach takes
  // its own copy back. Before, the key was the file's digest: two attaches of the same bytes shared one object, `delete-root` with a real root deleted a key
  // that never existed, and a refused attach left a copy that no manifest owned.
  describe('attach', () => {
    const bodyOf = (staged: {id: string; sha: string}, member: FakeMember, size = 5000, transform = 'none') =>
      canonicalize({id: staged.id, scope: member.accountId, activity: `upload:${transform}`, kind: 'file', digest: staged.sha, length: size, serialization: 1, children: []});
    const objectsHeld = () => world.storage.keys().filter((key) => key.startsWith('objects/'));

    it('copies the verified object to objects/<account>/<root>, publishes the manifest whose root is the SHA-256 of its canonical JSON body, and marks the lease attached', async () => {
      const member = world.member();
      const staged = stagedFile(member);
      const token = world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'});
      const reply = await world.post(token);

      const body = bodyOf(staged, member);
      const root = sha256(body);
      expect([reply.status, reply.json()]).toEqual([200, {outcome: 'published', manifest: {id: staged.id, root, digest: staged.sha, length: 5000, kind: 'file'}}]);
      expect(world.db.manifestOf(staged.id)).toMatchObject({root, id: staged.id, accountId: member.accountId, kind: 'file', digest: staged.sha, length: 5000, activity: 'upload:none', body});
      // The body is what RFC 8785 writes: members sorted, no whitespace.
      expect(body).toBe(`{"activity":"upload:none","children":[],"digest":"${staged.sha}","id":"${staged.id}","kind":"file","length":5000,"scope":"${member.accountId}","serialization":1}`);
      // The object is under the ROOT, not under the file's digest.
      expect(world.storage.calls).toEqual([`copy:${staged.key}>objects/${member.accountId}/${root}`]);
      expect(objectsHeld()).toEqual([`objects/${member.accountId}/${root}`]);
      expect(root).not.toBe(staged.sha);
      expect(world.storage.objects.get(`objects/${member.accountId}/${root}`)!.bytes.equals(world.storage.objects.get(staged.key)!.bytes)).toBe(true);
      expect(world.db.leases.get(staged.id)!.state).toBe('attached');
      expect(world.db.redemptions.get(String(payloadOf(token).jti))).toMatchObject({typ: 'command', accountId: member.accountId, sessionId: null, direction: null, targetKind: 'attach', targetId: staged.id});
    });

    it('answers a repeat with the same manifest, copies nothing and deletes nothing: the object is left alone', async () => {
      const member = world.member();
      const staged = stagedFile(member);
      const claims: CommandClaims = {cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'};
      const first = (await world.post(world.command(claims))).json<{manifest: {root: string}}>();
      const held = objectsHeld();
      const again = await world.post(world.command(claims));
      expect([again.status, again.json()]).toEqual([200, {outcome: 'exists', manifest: {id: staged.id, root: first.manifest.root, digest: staged.sha, length: 5000, kind: 'file'}}]);
      expect(world.storage.calls).toEqual([`copy:${staged.key}>objects/${member.accountId}/${first.manifest.root}`]);
      expect(objectsHeld()).toEqual(held);
      expect(world.db.manifests.size).toBe(1);
    });

    it('does not touch the object when a repeat is refused (another transform names another root): no copy, no delete, the first object stays', async () => {
      const member = world.member();
      const staged = stagedFile(member);
      const first = (await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}))).json<{manifest: {root: string}}>();
      world.db.transforms.add('strip-metadata');
      const calls = world.storage.calls.length;
      const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'strip-metadata'}));
      expect([reply.status, reply.json()]).toEqual([409, {error: 'manifest_conflict'}]);
      expect(world.storage.calls.slice(calls)).toEqual([]);
      expect(objectsHeld()).toEqual([`objects/${member.accountId}/${first.manifest.root}`]);
    });

    it('gives two uploads of identical bytes two objects, and deleting one root leaves the other readable', async () => {
      const member = world.member();
      const bytes = randomBytes(4000);
      const one = world.stage(member, bytes);
      const two = world.stage(member, bytes);
      expect(one.sha).toBe(two.sha);
      const roots: string[] = [];
      for (const staged of [one, two]) {
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
        roots.push(reply.json<{manifest: {root: string}}>().manifest.root);
      }
      expect(new Set(roots).size).toBe(2);
      expect(objectsHeld()).toEqual(roots.map((root) => `objects/${member.accountId}/${root}`).sort());
      // Deleting the first manifest's root takes its object and no other.
      expect((await world.post(world.command({cmd: 'delete-root', acct: member.accountId, root: roots[0]}))).json()).toEqual({outcome: 'deleted'});
      expect(objectsHeld()).toEqual([`objects/${member.accountId}/${roots[1]}`]);
      expect(world.storage.objects.get(`objects/${member.accountId}/${roots[1]}`)!.bytes.equals(bytes)).toBe(true);
    });

    it('attaches and then deletes by the root it returned: delete-root takes exactly that object, and a second delete-root is harmless', async () => {
      const member = world.member();
      const staged = stagedFile(member);
      const { manifest } = (await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}))).json<{manifest: {root: string}}>();
      expect(objectsHeld()).toEqual([`objects/${member.accountId}/${manifest.root}`]);
      const first = await world.post(world.command({cmd: 'delete-root', acct: member.accountId, root: manifest.root}));
      expect([first.status, first.json()]).toEqual([200, {outcome: 'deleted'}]);
      expect(objectsHeld()).toEqual([]);
      const second = await world.post(world.command({cmd: 'delete-root', acct: member.accountId, root: manifest.root}));
      expect([second.status, second.json()]).toEqual([200, {outcome: 'deleted'}]);
      // The staged copy is the lease's, and goes with its staging, not with a root.
      expect(world.storage.keys()).toEqual([staged.key]);
    });

    it('publishes a picture\'s manifest with the picture kind', async () => {
      const member = world.member();
      const staged = world.stage(member, pngBytes(3000), {kind: 'picture'});
      const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
      expect(reply.json<{manifest: {kind: string}}>().manifest.kind).toBe('picture');
    });

    describe('a refused attach takes its own copy back and leaves nothing under objects/', () => {
      it('an unregistered transform: 400, the copy made for it deleted, no manifest, the lease still complete', async () => {
        const member = world.member();
        const staged = stagedFile(member);
        const root = sha256(bodyOf(staged, member, 5000, 'strip-metadata'));
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'strip-metadata'}));
        expect([reply.status, reply.json()]).toEqual([400, {error: 'unknown_transform'}]);
        expect(world.storage.calls).toEqual([`copy:${staged.key}>objects/${member.accountId}/${root}`, `delete:objects/${member.accountId}/${root}`]);
        expect(objectsHeld()).toEqual([]);
        expect(world.storage.keys()).toEqual([staged.key]);
        expect(world.db.manifests.size).toBe(0);
        expect(world.db.leases.get(staged.id)!.state).toBe('complete');
      });

      it.each([
        ['an Account that is disabled', (m: FakeMember) => world.db.disableAccount(m.accountId)],
        ['an Account that is deleted', (m: FakeMember) => world.db.tombstoneAccount(m.accountId)],
        ['an epoch that is not the Account\'s', (m: FakeMember) => (world.db.accounts.get(m.accountId)!.epoch = 3)],
      ])('%s: 403, no manifest, nothing left under objects/', async (_name, act) => {
        const member = world.member();
        const staged = stagedFile(member);
        const root = sha256(bodyOf(staged, member));
        act(member);
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: 1, uid: staged.id, tr: 'none'}));
        expect([reply.status, reply.json()]).toEqual([403, {error: 'forbidden'}]);
        expect(world.storage.calls).toEqual([`copy:${staged.key}>objects/${member.accountId}/${root}`, `delete:objects/${member.accountId}/${root}`]);
        expect(objectsHeld()).toEqual([]);
        expect(world.db.manifests.size).toBe(0);
        expect(world.db.leases.get(staged.id)!.state).toBe('complete');
      });

      // The finding was real (P11): a lease whose time has passed could be attached while the cleanup was deleting its staging object.
      it('a lease whose time has passed: 409 lease_expired, no manifest, nothing left under objects/', async () => {
        const member = world.member();
        const staged = world.stage(member, randomBytes(3000), {expiresAt: new Date(T0 - 1000)});
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
        expect([reply.status, reply.json()]).toEqual([409, {error: 'lease_expired'}]);
        expect(objectsHeld()).toEqual([]);
        expect(world.storage.calls.at(-1)).toMatch(/^delete:objects\//);
        expect(world.db.manifests.size).toBe(0);
        expect(world.db.leases.get(staged.id)!.state).toBe('complete');
      });

      it('a lease that the cleanup released between the gateway\'s read and the database\'s check: 409 not_complete, nothing left under objects/', async () => {
        const member = world.member();
        const staged = stagedFile(member);
        // The lease is `complete` when the gateway reads it and `released` when the manifest is to be written.
        const original = world.db.publishAttachment;
        world.db.publishAttachment = async (input) => {
          world.db.leases.get(staged.id)!.state = 'released';
          return original(input);
        };
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
        expect([reply.status, reply.json()]).toEqual([409, {error: 'not_complete'}]);
        expect(objectsHeld()).toEqual([]);
      });

      it('a root the database does not accept (it answers root_mismatch): 409 manifest_conflict, nothing left under objects/', async () => {
        const member = world.member();
        const staged = stagedFile(member);
        const original = world.db.publishAttachment;
        world.db.publishAttachment = async (input) => original({...input, root: sha256('not the body')});
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
        expect([reply.status, reply.json()]).toEqual([409, {error: 'manifest_conflict'}]);
        expect(objectsHeld()).toEqual([]);
        expect(world.db.manifests.size).toBe(0);
      });

      // Not in the amended sentence, a consequence of it: the key is the same for every attach of one upload, so the copy of a refused call can be the
      // object of a manifest that a concurrent call published. The call looks at the lease before it deletes.
      it('leaves the copy alone when another attach of the same upload published meanwhile: the key is that manifest\'s object', async () => {
        const member = world.member();
        const staged = stagedFile(member);
        const root = sha256(bodyOf(staged, member));
        const original = world.db.publishAttachment;
        world.db.publishAttachment = async (input) => {
          // The other attach publishes first; this one is then refused (the Account was disabled in between).
          await original(input);
          return {outcome: 'denied', root: null, manifestId: null};
        };
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
        expect([reply.status, reply.json()]).toEqual([403, {error: 'forbidden'}]);
        expect(world.db.leases.get(staged.id)!.state).toBe('attached');
        expect(world.storage.calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(objectsHeld()).toEqual([`objects/${member.accountId}/${root}`]);
      });

      it('leaves the copy alone, and logs a class, when the lease cannot be read to tell whether the copy is still this call\'s', async () => {
        const member = world.member();
        const staged = stagedFile(member);
        const original = world.db.lease;
        let reads = 0;
        world.db.lease = async (id, accountId) => {
          reads += 1;
          if (reads > 1) throw Object.assign(new Error('the database did not answer'), {name: 'DatabaseUnavailable'});
          return original(id, accountId);
        };
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'strip-metadata'}));
        expect([reply.status, reply.json()]).toEqual([400, {error: 'unknown_transform'}]);
        expect(world.storage.calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(world.logs).toContainEqual(['The gateway could not take back a copy.', 'DatabaseUnavailable']);
      });

      it('still answers the refusal, and logs a class, when the copy could not be taken back', async () => {
        const member = world.member();
        const staged = stagedFile(member);
        world.storage.delete = async () => {
          throw Object.assign(new Error('the store said no'), {name: 'StorageUnavailable'});
        };
        const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'strip-metadata'}));
        expect([reply.status, reply.json()]).toEqual([400, {error: 'unknown_transform'}]);
        expect(world.logs).toContainEqual(['The gateway could not take back a copy.', 'StorageUnavailable']);
      });
    });

    it('does NOT delete the copy when the database does not answer: the manifest may have been written, and then the copy is its object', async () => {
      const member = world.member();
      const staged = stagedFile(member);
      world.db.failing.add('publishAttachment');
      const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
      expect([reply.status, reply.json()]).toEqual([503, {error: 'unavailable'}]);
      expect(world.storage.calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
      expect(objectsHeld()).toHaveLength(1);
      // A retry copies the same bytes to the same key and makes the manifest.
      world.db.failing.delete('publishAttachment');
      const retry = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
      expect(retry.json<{outcome: string}>().outcome).toBe('published');
      expect(objectsHeld()).toHaveLength(1);
    });

    it.each(['receiving', 'released'] as const)('refuses an upload that is %s: 409 not_complete, nothing copied or written', async (state) => {
      const member = world.member();
      const staged = world.stage(member, randomBytes(3000), {state});
      const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
      expect([reply.status, reply.json()]).toEqual([409, {error: 'not_complete'}]);
      expect(world.storage.calls).toEqual([]);
      expect(world.db.manifests.size).toBe(0);
    });

    it('refuses an upload that is another Account\'s or that does not exist, 404, nothing copied or written', async () => {
      const owner = world.member();
      const stranger = world.member();
      const staged = stagedFile(owner);
      for (const uid of [staged.id, randomUUID()]) {
        const reply = await world.post(world.command({cmd: 'attach', acct: stranger.accountId, epoch: stranger.epoch, uid, tr: 'none'}));
        expect([reply.status, reply.json()], uid).toEqual([404, {error: 'not_found'}]);
      }
      expect(world.storage.calls).toEqual([]);
      expect(world.db.manifests.size).toBe(0);
      expect(world.db.leases.get(staged.id)!.state).toBe('complete');
    });

    it('answers 503 and logs only a class when the copy fails, and there is nothing to take back', async () => {
      const member = world.member();
      const staged = world.stage(member, randomBytes(3000), {object: false});
      const reply = await world.post(world.command({cmd: 'attach', acct: member.accountId, epoch: member.epoch, uid: staged.id, tr: 'none'}));
      expect([reply.status, reply.json()]).toEqual([503, {error: 'unavailable'}]);
      expect(world.logs).toContainEqual(['The gateway failed a command.', 'MissingObject']);
      expect(world.storage.calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
      expect(world.db.manifests.size).toBe(0);
    });
  });

  describe('delete-staging', () => {
    it('deletes the exact prefix of an upload whose lease is expired, and marks the lease deleted', async () => {
      const member = world.member();
      const staged = world.stage(member, randomBytes(3000), {expiresAt: new Date(T0 - 1000)});
      const neighbour = world.stage(member, randomBytes(3000));
      const stranger = world.member();
      const foreign = world.stage(stranger, randomBytes(3000));
      const reply = await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: staged.id}));
      expect([reply.status, reply.json()]).toEqual([200, {outcome: 'deleted'}]);
      expect(world.storage.keys()).toEqual([neighbour.key, foreign.key].sort());
      expect(world.storage.calls).toEqual([`deletePrefix:${staged.key}`]);
      expect(world.db.leases.get(staged.id)!.state).toBe('deleted');
      expect(world.db.leases.get(neighbour.id)!.state).toBe('complete');
    });

    it('deletes the staging of a lease that is released, whatever its time, and is idempotent in effect', async () => {
      const member = world.member();
      const staged = world.stage(member, randomBytes(3000), {state: 'released'});
      expect((await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: staged.id}))).json()).toEqual({outcome: 'deleted'});
      expect(world.storage.keys()).toEqual([]);
      // The lease is deleted for good: a second command finds nothing to do and touches no object.
      const again = await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: staged.id}));
      expect([again.status, again.json()]).toEqual([200, {outcome: 'kept'}]);
    });

    it('keeps the staging of a lease that is neither expired nor released, which is what a lease renewed since the listing is: nothing deleted', async () => {
      const member = world.member();
      const staged = world.stage(member, randomBytes(3000));
      const renewed = world.stage(member, randomBytes(3000), {expiresAt: new Date(T0 + 1000)});
      for (const target of [staged, renewed]) {
        const reply = await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: target.id}));
        expect([reply.status, reply.json()]).toEqual([200, {outcome: 'kept'}]);
      }
      expect(world.storage.keys()).toHaveLength(2);
      expect(world.storage.calls).toEqual([]);
      expect(world.db.leases.get(staged.id)!.state).toBe('complete');
      // It was kept at that moment and goes when it has expired.
      world.clock.advance(5000);
      expect((await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: renewed.id}))).json()).toEqual({outcome: 'deleted'});
    });

    it('touches nothing of another Account\'s, nor of an upload that is not there', async () => {
      const owner = world.member();
      const stranger = world.member();
      const staged = world.stage(owner, randomBytes(3000), {state: 'released'});
      for (const uid of [staged.id, randomUUID()]) {
        const reply = await world.post(world.command({cmd: 'delete-staging', acct: stranger.accountId, uid}));
        expect([reply.status, reply.json()], uid).toEqual([200, {outcome: 'kept'}]);
      }
      expect(world.storage.keys()).toEqual([staged.key]);
      expect(world.db.leases.get(staged.id)!.state).toBe('released');
    });

    it('leaves a lease released, not deleted, when the objects could not be removed, so that the next cleanup tries again', async () => {
      const member = world.member();
      const staged = world.stage(member, randomBytes(3000), {state: 'released'});
      world.storage.failure = Object.assign(new Error('the store did not answer'), {name: 'StorageUnavailable'});
      const reply = await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: staged.id}));
      expect([reply.status, reply.json()]).toEqual([503, {error: 'unavailable'}]);
      expect(world.db.leases.get(staged.id)!.state).toBe('released');
      world.storage.failure = null;
      expect((await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: staged.id}))).json()).toEqual({outcome: 'deleted'});
      expect(world.db.leases.get(staged.id)!.state).toBe('deleted');
    });
  });

  describe('delete-root', () => {
    it('deletes objects/<account>/<root> and nothing else: not another root, not another Account\'s object of the same name, not staging', async () => {
      const member = world.member();
      const stranger = world.member();
      const root = sha256('root one');
      const other = sha256('root two');
      const staged = stagedFile(member);
      for (const [account, name] of [[member, root], [member, other], [stranger, root]] as const) world.storage.objects.set(`objects/${account.accountId}/${name}`, {bytes: Buffer.from('x'), contentType: 'application/octet-stream'});
      const reply = await world.post(world.command({cmd: 'delete-root', acct: member.accountId, root}));
      expect([reply.status, reply.json()]).toEqual([200, {outcome: 'deleted'}]);
      expect(world.storage.calls).toEqual([`delete:objects/${member.accountId}/${root}`]);
      expect(world.storage.keys()).toEqual([staged.key, `objects/${member.accountId}/${other}`, `objects/${stranger.accountId}/${root}`].sort());
      // The same command again finds nothing and is not an error.
      expect((await world.post(world.command({cmd: 'delete-root', acct: member.accountId, root}))).status).toBe(200);
    });
  });

  describe('only the application\'s own signed command does anything', () => {
    const victim = () => {
      const member = world.member();
      const root = sha256('victim');
      world.storage.objects.set(`objects/${member.accountId}/${root}`, {bytes: Buffer.from('x'), contentType: 'application/octet-stream'});
      return {member, root, claims: {cmd: 'delete-root', acct: member.accountId, root} as CommandClaims, key: `objects/${member.accountId}/${root}`};
    };

    it.each([
      ['a command signed by another key', (w: World, claims: CommandClaims) => w.command(claims, {signer: {issuer: 'application', kid: 'test-stranger', privateKey: createPrivateKey({key: Buffer.from(testKeyPair('stranger').privateKey, 'base64'), format: 'der', type: 'pkcs8'})}})],
      ['a command of another environment', (w: World, claims: CommandClaims) => w.command(claims, {env: OTHER_INSTANCE})],
      ['a command that has expired', (w: World, claims: CommandClaims) => w.command(claims, {now: w.clock.seconds() - 400})],
      ['a command from another issuer', (w: World, claims: CommandClaims) => w.forge({iss: 'gateway', aud: 'gateway', env: INSTANCE, jti: newJti(), iat: w.clock.seconds(), exp: w.clock.seconds() + 300, typ: 'command', ...claims})],
      ['a command for another audience', (w: World, claims: CommandClaims) => w.forge({iss: 'application', aud: 'cad-worker', env: INSTANCE, jti: newJti(), iat: w.clock.seconds(), exp: w.clock.seconds() + 300, typ: 'command', ...claims})],
      ['a command that lives 301 seconds', (w: World, claims: CommandClaims) => w.forge({iss: 'application', aud: 'gateway', env: INSTANCE, jti: newJti(), iat: w.clock.seconds(), exp: w.clock.seconds() + 301, typ: 'command', ...claims})],
      ['a ticket in the place of a command', (w: World, claims: CommandClaims) => w.ticket(w.member(), {dir: 'download', tid: randomUUID()}, {})],
      ['a command whose payload was altered', (w: World, claims: CommandClaims) => {
        const [head, body, signature] = w.command(claims).split('.');
        return `${head}.${Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(body, 'base64url').toString()), root: sha256('other')})).toString('base64url')}.${signature}`;
      }],
      ['a command that is garbage', () => 'garbage.garbage.garbage'],
    ])('deletes nothing for %s: 401 invalid_command, and nothing is redeemed', async (_name, make) => {
      const target = victim();
      const reply = await world.post(make(world, target.claims));
      expect([reply.status, reply.json()]).toEqual([401, {error: 'invalid_command'}]);
      expect(world.storage.objects.has(target.key)).toBe(true);
      expect(world.storage.calls).toEqual([]);
      expect(world.db.redemptions.size).toBe(0);
    });

    it('deletes nothing for a command with no signature header, with the wrong scheme or with two tokens', async () => {
      const target = victim();
      const token = world.command(target.claims);
      for (const headers of [{}, {authorization: `Ticket ${token}`}, {authorization: `Bearer ${token}`}, {authorization: `command ${token}`}, {authorization: `Command ${token} ${token}`}, {authorization: 'Command '}]) {
        const reply = await world.send('/v1/commands', {method: 'POST', headers});
        expect([reply.status, reply.json()], JSON.stringify(headers)).toEqual([401, {error: 'invalid_command'}]);
      }
      expect(world.storage.objects.has(target.key)).toBe(true);
      expect(world.db.calls).toEqual([]);
    });

    it('does not use a command twice: the second send is refused and deletes nothing more', async () => {
      const target = victim();
      const token = world.command(target.claims);
      expect((await world.post(token)).status).toBe(200);
      expect(world.storage.objects.has(target.key)).toBe(false);
      world.storage.objects.set(target.key, {bytes: Buffer.from('again'), contentType: 'application/octet-stream'});
      const replay = await world.post(token);
      expect([replay.status, replay.json()]).toEqual([401, {error: 'invalid_command'}]);
      expect(world.storage.objects.has(target.key)).toBe(true);
    });

    it('refuses a command signed by a revoked key, and one that a ticket\'s jti was already used for', async () => {
      const target = victim();
      world.db.revokedKeys.add(world.keys.signer.kid);
      const reply = await world.post(world.command(target.claims));
      expect([reply.status, reply.json()]).toEqual([401, {error: 'invalid_command'}]);
      expect(world.storage.objects.has(target.key)).toBe(true);
      world.db.revokedKeys.clear();
      const jti = newJti();
      const member = world.member();
      expect((await world.download(member, randomUUID(), {signing: {jti}})).status).toBe(404);
      const same = await world.post(world.command(target.claims, {jti}));
      expect(same.status).toBe(401);
      expect(world.storage.objects.has(target.key)).toBe(true);
    });

    it.each([
      ['a root that climbs out of its folder', {cmd: 'delete-root', acct: randomUUID(), root: '../../staging'}],
      ['a root that is a path', {cmd: 'delete-root', acct: randomUUID(), root: `${'a'.repeat(30)}/${'b'.repeat(33)}`}],
      ['a root in capital letters', {cmd: 'delete-root', acct: randomUUID(), root: 'A'.repeat(64)}],
      ['a root of 63 characters', {cmd: 'delete-root', acct: randomUUID(), root: 'a'.repeat(63)}],
      ['a root of 65 characters', {cmd: 'delete-root', acct: randomUUID(), root: 'a'.repeat(65)}],
      ['an Account that is a path', {cmd: 'delete-root', acct: '../x', root: 'a'.repeat(64)}],
      ['an upload that is a path', {cmd: 'delete-staging', acct: randomUUID(), uid: '../../x'}],
      ['an upload in capital letters', {cmd: 'delete-staging', acct: randomUUID(), uid: randomUUID().toUpperCase()}],
      ['an upload that is a prefix of one', {cmd: 'delete-staging', acct: randomUUID(), uid: randomUUID().slice(0, 30)}],
      ['a transform that is a path', {cmd: 'attach', acct: randomUUID(), epoch: 1, uid: randomUUID(), tr: '../none'}],
      ['a transform in capital letters', {cmd: 'attach', acct: randomUUID(), epoch: 1, uid: randomUUID(), tr: 'None'}],
      ['an epoch that is not one', {cmd: 'attach', acct: randomUUID(), epoch: 0, uid: randomUUID(), tr: 'none'}],
      ['a command that does not exist', {cmd: 'delete-everything', acct: randomUUID()}],
      ['a delete with a claim too many', {cmd: 'delete-root', acct: randomUUID(), root: 'a'.repeat(64), prefix: 'staging/'}],
      ['an attach with a claim missing', {cmd: 'attach', acct: randomUUID(), epoch: 1, uid: randomUUID()}],
    ])('refuses %s, signed with the right key, as 401: the claims are IDs and digests or they are nothing, and nothing is redeemed or deleted', async (_name, claims) => {
      const reply = await world.post(world.forge({iss: 'application', aud: 'gateway', env: INSTANCE, jti: newJti(), iat: world.clock.seconds(), exp: world.clock.seconds() + 300, typ: 'command', ...claims}));
      expect([reply.status, reply.json()]).toEqual([401, {error: 'invalid_command'}]);
      expect(world.db.calls).toEqual([]);
      expect(world.storage.calls).toEqual([]);
    });

    it('refuses a body of more than 1 KiB, 413, and a command of the right size with a body is not read as one', async () => {
      const target = victim();
      const token = world.command(target.claims);
      const large = await world.post(token, {body: Buffer.alloc(200), contentLength: 2000});
      expect([large.status, large.json()]).toEqual([413, {error: 'payload_too_large'}]);
      expect(world.db.calls).toEqual([]);
      const small = await world.post(token, {body: Buffer.from('{}'), headers: {'content-type': 'application/json'}});
      expect(small.status).toBe(200);
      expect(world.storage.objects.has(target.key)).toBe(false);
    });

    it('answers 503 and spends the command when the database cannot be asked, and carries nothing out', async () => {
      const target = victim();
      world.db.failing.add('redeemCommand');
      const reply = await world.post(world.command(target.claims));
      expect([reply.status, reply.json()]).toEqual([503, {error: 'unavailable'}]);
      expect(world.storage.objects.has(target.key)).toBe(true);
    });
  });
});

// Story 1.12 review. Each finding below was real; the tests say what it was.
// ---------------------------------------------------------------------------------------------------

/** What a raw client got out of one request: the answer (if it arrived), how much of the body it managed to send, and whether the server cut the connection. */
type Raw = {response: string; written: number; closed: boolean};

/** Sends the headers it is given and then body pieces for as long as the server takes them (up to `total` bytes), the way a client with a large file does. */
function rawPut(url: string, path: string, headers: Record<string, string | number>, total: number): Promise<Raw> {
  return new Promise((resolve) => {
    const {port} = new URL(url);
    const socket = net.connect({host: '127.0.0.1', port: Number(port)});
    const raw: Raw = {response: '', written: 0, closed: false};
    const piece = Buffer.alloc(64 * 1024, 0x61);
    const timer = setTimeout(() => socket.destroy(), 8000);
    socket.on('data', (data) => (raw.response += data.toString('latin1')));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(timer);
      raw.closed = true;
      resolve(raw);
    });
    const head = [`PUT ${path} HTTP/1.1`, `host: 127.0.0.1:${port}`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), '', ''].join('\r\n');
    socket.write(head);
    const send = () => {
      while (raw.written < total && socket.writable) {
        const size = Math.min(piece.length, total - raw.written);
        const room = socket.write(size === piece.length ? piece : piece.subarray(0, size));
        raw.written += size;
        if (!room) {
          socket.once('drain', send);
          return;
        }
      }
    };
    send();
  });
}

describe('a refused upload is never read to its end (P5)', () => {
  const MAX_READ = 256 * 1024;
  const cutWithin = async (socket: net.Socket) => {
    const deadline = Date.now() + 3000;
    while (!socket.destroyed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    return socket.destroyed;
  };

  it('reads no more than a small cap of a 20 MiB body it refuses, and then cuts the connection: a ticket that was believed gets no more of the client\'s bytes than one that was not', async () => {
    const member = world.member();
    const id = randomUUID();
    const total = 20 * MiB;
    const bytes = randomBytes(total);
    // A believed ticket, and a header that does not match it: refused (400) after the ticket verified, with the declared 20 MiB still to come.
    const token = world.ticket(member, {dir: 'upload', tid: id, cls: 'file', len: total, sha: sha256(bytes), ct: 'application/octet-stream'});
    const raw = await rawPut(world.url, `/v1/uploads/${id}`, {authorization: `Ticket ${token}`, 'content-type': 'application/octet-stream', 'content-length': total, 'x-content-sha256': sha256('not these bytes')}, total);
    const socket = world.sockets.at(-1)!;
    expect(await cutWithin(socket)).toBe(true);
    expect(socket.bytesRead, 'bytes the server read of the request').toBeLessThan(MAX_READ);
    expect(raw.written, 'the client was not allowed to send it all').toBeLessThan(total);
    // Whatever of the answer reached the client is the refusal, never a success.
    expect(raw.response).toMatch(/^$|^HTTP\/1\.1 400 /);
    expect(world.storage.keys()).toEqual([]);
    expect(world.db.leases.has(id)).toBe(false);
  });

  it('does the same for an upload that is refused after the database was asked (the staging quota)', async () => {
    const member = world.member();
    world.stage(member, randomBytes(2), {kind: 'file'});
    const first = randomUUID();
    const total = 20 * MiB;
    const bytes = randomBytes(total);
    const token = world.ticket(member, {dir: 'upload', tid: first, cls: 'file', len: total, sha: sha256(bytes), ct: 'application/octet-stream'});
    world.db.leases.forEach((lease) => (lease.length = 245 * MiB));
    const quota = await rawPut(world.url, `/v1/uploads/${first}`, {authorization: `Ticket ${token}`, 'content-type': 'application/octet-stream', 'content-length': total, 'x-content-sha256': sha256(bytes)}, total);
    const socket = world.sockets.at(-1)!;
    expect(await cutWithin(socket)).toBe(true);
    expect(socket.bytesRead).toBeLessThan(MAX_READ);
    expect(quota.response).toMatch(/^$|^HTTP\/1\.1 413 /);
  });

  it('halts an upload whose access ends on the way the same way: it does not read to the end, answers 403, deletes what it had and releases the lease', async () => {
    const member = world.member();
    const id = randomUUID();
    const total = 20 * MiB;
    const bytes = pngBytes(total);
    const token = world.ticket(member, {dir: 'upload', tid: id, cls: 'file', len: total, sha: sha256(bytes), ct: 'application/octet-stream'});
    world.hooks.onChunk = ({direction, index}) => {
      if (direction === 'upload' && index === 2) world.db.revokeSession(member.sessionId);
    };
    const raw = await rawPut(world.url, `/v1/uploads/${id}`, {authorization: `Ticket ${token}`, 'content-type': 'application/octet-stream', 'content-length': total, 'x-content-sha256': sha256(bytes)}, total);
    const socket = world.sockets.at(-1)!;
    expect(await cutWithin(socket)).toBe(true);
    // Three chunks were let through the reader; after the refusal only the cap more was read: far from the 20 MiB the client declared.
    expect(socket.bytesRead, 'bytes the server read of the request').toBeLessThan(3 * MiB + MAX_READ);
    expect(raw.response).toMatch(/^$|^HTTP\/1\.1 403 /);
    expect(world.storage.keys()).toEqual([]);
    expect(world.db.leases.get(id)!.state).toBe('released');
  });

  it('halts an upload whose lease ended on the way (409 upload_ended) without reading to the end', async () => {
    const member = world.member();
    const id = randomUUID();
    const total = 20 * MiB;
    const bytes = pngBytes(total);
    const token = world.ticket(member, {dir: 'upload', tid: id, cls: 'file', len: total, sha: sha256(bytes), ct: 'application/octet-stream'});
    world.hooks.onChunk = ({direction, index}) => {
      if (direction === 'upload' && index === 1) world.db.leases.get(id)!.state = 'released';
    };
    const raw = await rawPut(world.url, `/v1/uploads/${id}`, {authorization: `Ticket ${token}`, 'content-type': 'application/octet-stream', 'content-length': total, 'x-content-sha256': sha256(bytes)}, total);
    const socket = world.sockets.at(-1)!;
    expect(await cutWithin(socket)).toBe(true);
    expect(socket.bytesRead).toBeLessThan(2 * MiB + MAX_READ);
    expect(raw.response).toMatch(/^$|^HTTP\/1\.1 409 /);
    expect(world.storage.keys()).toEqual([]);
  });

  it('lets a client that sent a small body read the refusal: a body inside the cap is read whole and the answer arrives', async () => {
    const member = world.member();
    const id = randomUUID();
    const bytes = randomBytes(10_000);
    const token = world.ticket(member, {dir: 'upload', tid: id, cls: 'file', len: bytes.length, sha: sha256(bytes), ct: 'application/octet-stream'});
    const reply = await world.send(`/v1/uploads/${id}`, {method: 'PUT', headers: {authorization: `Ticket ${token}`, 'content-type': 'application/octet-stream', 'x-content-sha256': sha256('other')}, body: bytes});
    expect([reply.status, reply.json()]).toEqual([400, {error: 'checksum_mismatch'}]);
  });
});

describe('a download that ends short is a failed transfer, not a finished one (P4)', () => {
  it('cuts the response when the stored object ends before the length that was promised, so the client sees a failure and not a short file', async () => {
    const member = world.member();
    const bytes = randomBytes(3 * MiB);
    const staged = world.stage(member, bytes);
    world.storage.truncateBy = 100;
    const token = world.ticket(member, {dir: 'download', tid: staged.id});
    const reply = await world.stream(`/v1/files/staging/${staged.id}`, {headers: {authorization: `Ticket ${token}`}});
    // The headers promised 3 MiB; the client got fewer bytes and the connection was cut, which is what `complete: false` is.
    expect(Number(reply.headers['content-length'])).toBe(3 * MiB);
    expect(reply.outcome).toBe('aborted');
    expect(reply.received.length).toBeLessThan(3 * MiB);
    expect(reply.received.equals(bytes.subarray(0, reply.received.length))).toBe(true);
    expect(world.logs).toContainEqual(['The gateway failed a download.', 'ShortRead']);
    expect(world.storage.cancels).toBe(1);
  });

  it('does the same for a range that comes up short, and still ends a whole object normally', async () => {
    const member = world.member();
    const bytes = randomBytes(2 * MiB);
    const staged = world.stage(member, bytes);
    world.storage.truncateBy = 1;
    // A range of a thousand bytes is one chunk: what is cut may be cut before its headers are out (a hang-up) or after (an aborted 206). Never a finished one.
    const ranged = await world.stream(`/v1/files/staging/${staged.id}`, {headers: {authorization: `Ticket ${world.ticket(member, {dir: 'download', tid: staged.id})}`, range: 'bytes=100-1099'}}).catch((error: Error) => error);
    if (ranged instanceof Error) expect(ranged.message).toMatch(/socket hang up|ECONNRESET/);
    else expect([ranged.status, ranged.outcome]).toEqual([206, 'aborted']);
    world.storage.truncateBy = 0;
    const whole = await world.stream(`/v1/files/staging/${staged.id}`, {headers: {authorization: `Ticket ${world.ticket(member, {dir: 'download', tid: staged.id})}`}});
    expect([whole.status, whole.outcome, whole.received.equals(bytes)]).toEqual([200, 'ended', true]);
  });
});

describe('a prefix is called deleted only after a clean delete (P3)', () => {
  it('leaves the lease released, and answers 503 naming a class and no key, when the store could not delete some of the objects; the next cleanup finishes it', async () => {
    const member = world.member();
    const staged = world.stage(member, randomBytes(3000), {state: 'released'});
    const original = world.storage.deletePrefix;
    world.storage.deletePrefix = async () => {
      throw new PartialDeleteError(1);
    };
    const reply = await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: staged.id}));
    expect([reply.status, reply.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(world.db.leases.get(staged.id)!.state).toBe('released');
    expect(world.logs).toContainEqual(['The gateway failed a command.', 'PartialDeleteError']);
    world.storage.deletePrefix = original;
    expect((await world.post(world.command({cmd: 'delete-staging', acct: member.accountId, uid: staged.id}))).json()).toEqual({outcome: 'deleted'});
    expect(world.db.leases.get(staged.id)!.state).toBe('deleted');
    expect(world.storage.keys()).toEqual([]);
  });
});
