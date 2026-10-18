import {ListObjectsV2Command, S3Client} from '@aws-sdk/client-s3';
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash, randomBytes, randomUUID, sign} from 'node:crypto';
import http from 'node:http';
import {createServer as createNetServer} from 'node:net';
import {resolve} from 'node:path';
import {Readable} from 'node:stream';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {disableAccount, raiseAuthorizationEpoch, revokeSessionGrant} from '../../lib/accounts';
import {canonicalize} from '../../lib/canonical-json';
import {createGatewayClient, GatewayError, GatewayUnavailableError} from '../../lib/gateway-client';
import {runTask} from '../../lib/job-tasks';
import {listExpiredStaging, recordTombstone, revokeServiceKey} from '../../lib/lifecycle';
import {loadSigner, newJti, parseKeySet, signToken, tokenLabel, type Signer} from '../../lib/service-signing';
import {createPostgresDatabase, type GatewayDatabase} from '../../workers/files/src/database';
import {start, StartupError} from '../../workers/files/src/main';
import {bucketName, MissingObject} from '../../workers/files/src/storage';
import {createHarness} from '../support/accounts-db';
import {appOrigin, createMember, epochOf, MiB, jpegBytes, pngBytes, roleUrl, sha256, startGateway, uploadClaims, uploadHeaders, webpBytes, type Gateway, type GatewayOptions, type Member, type TicketInput} from '../support/gateway-world';
import {testKeyPair, testSigner} from '../support/service-keys';
import {localStack, s3Of, stackEnvironment} from '../support/stack';

// Story 1.12: the file gateway, end to end. The gateway runs IN-PROCESS on a loopback port (workers/files/src/main.ts `start`) against the REAL local
// database as its OWN role (nova3d_gateway: the privileges of 20261015120000_file_gateway.sql and nothing else) and the REAL local Storage (the private
// bucket, over the S3 protocol, with the stack's key pair), with REAL Accounts that hold a live session grant. Tickets and commands are signed with test
// keys (tests/support/service-keys.ts), exactly as the application signs them (lib/service-signing.ts). Every byte is a real byte: what is uploaded is
// read back out of Storage, and what is not supposed to be there is shown not to be.
//
// What it shares with the other suites: one database, and append-only tables (leases, redemptions, handles and revocations stay). So every assertion is
// about this file's own IDs and Accounts; a key that is REVOKED here is a key made for the purpose (a revocation cannot be undone, and the default test
// key serves every other suite); and the staging cleanup task is driven through a client that forwards commands for this file's own Accounts only.
//
// The fixtures change the world BETWEEN two chunks through `hooks.beforeChunk` (awaited before the authorization of each chunk): a download of n chunks
// whose hook disables the Account at chunk k is sent exactly k MiB and then closed, which is what "access stops mid-transfer, bytes delivered stand" means.

const {db, committed, addUser, addSession} = createHarness();
const repo = resolve(import.meta.dirname, '../..');
const actor = 'seed:local:gateway';

let env: Record<string, string>;
let instanceId: string;

// The probe in front of the real database: it records what the gateway asks and can make the database "not answer", and nothing else.
const probe = {
  events: [] as string[],
  authorizeCalls: 0,
  failAuthorizeFrom: Infinity,
  failQuery: false,
  failAuthority: false,
  onChunk: null as null | ((chunk: {direction: string; index: number}) => void | Promise<void>),
  reset() {
    this.events = [];
    this.authorizeCalls = 0;
    this.failAuthorizeFrom = Infinity;
    this.failQuery = false;
    this.failAuthority = false;
    this.onChunk = null;
  },
};
let clockOffsetMs = 0;
const logged: string[] = [];
const issued: string[] = [];
const handlesSeen: string[] = [];

let realDatabase: GatewayDatabase;
let gateway: Gateway;
let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeAll(async () => {
  env = await stackEnvironment(db);
  instanceId = env.INSTANCE_ID;
  for (const method of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    consoleSpies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))));
  }
  realDatabase = createPostgresDatabase({connectionString: roleUrl()});
  const database: GatewayDatabase = {
    ...realDatabase,
    async authorizeHandle(hash, now) {
      probe.authorizeCalls += 1;
      probe.events.push('authorize');
      if (probe.authorizeCalls >= probe.failAuthorizeFrom) throw new Error('the database did not answer');
      return realDatabase.authorizeHandle(hash, now);
    },
    async query(sql, params) {
      probe.events.push(sql.includes('staging_leases') ? 'resolve' : 'query');
      if (probe.failQuery) throw new Error('the database did not answer');
      return realDatabase.query(sql, params);
    },
    async authority(sessionId) {
      if (probe.failAuthority) throw new Error('the database did not answer');
      return realDatabase.authority(sessionId);
    },
  };
  // The main gateway has a signing key of its own. A redemption and a revocation take the same advisory lock, keyed by the key's ID, and other suites
  // revoke (and hold open, in a transaction they roll back) the default test key: a key shared with them would make this file wait for them.
  gateway = await startGateway(instanceId, {
    keys: {active: uniqueLabel('main')},
    database,
    clock: () => new Date(Date.now() + clockOffsetMs),
    log: (message, detail) => void logged.push(`${message} ${detail}`),
    hooks: {
      beforeChunk: async (chunk) => {
        probe.events.push(`chunk:${chunk.direction}:${chunk.index}`);
        await probe.onChunk?.(chunk);
      },
    },
  });
});

// Whatever one test makes the database do (not answer, change the world between two chunks), the next starts without.
beforeEach(() => probe.reset());
afterEach(() => {
  probe.reset();
  clockOffsetMs = 0;
});

afterAll(async () => {
  await gateway?.close();
  await realDatabase?.close();
  for (const spy of consoleSpies) spy.mockRestore();
});

// Helpers -----------------------------------------------------------------------------------------------------------------------------------------

const member = () => createMember(db, env, {addUser, addSession, committedUsers: committed.users, committedInvitations: committed.invitationIds});
const staging = (accountId: string, id: string) => `staging/${accountId}/${id}`;
const objectKey = (accountId: string, root: string) => `objects/${accountId}/${root}`;
const errorBody = (error: string) => ({error});

type TicketOptions = Parameters<Gateway['ticket']>[2];

/** A ticket for the member, under the epoch the database has for the Account now (unless the test says otherwise), kept for the log check. */
async function ticketFor(g: Gateway, who: Member, claims: TicketInput, options: TicketOptions = {}) {
  const epoch = options?.epoch ?? (await epochOf(db, who.accountId));
  const token = g.ticket(who, claims, {...options, epoch});
  issued.push(token);
  return token;
}

const commandFor = (g: Gateway, claims: Parameters<Gateway['command']>[0], options: Parameters<Gateway['command']>[1] = {}) => {
  const token = g.command(claims, options);
  issued.push(token);
  return token;
};

type Upload = {id: string; bytes: Buffer; response: Response; ticket: string};

/** An upload with a valid ticket for these bytes. `headerType` and `headerSha` are what the request says, which may differ from what the ticket says. */
async function upload(who: Member, bytes: Buffer, options: {g?: Gateway; id?: string; cls?: 'picture' | 'file'; ct?: string; sha?: string; headerType?: string; headerSha?: string; ticket?: TicketOptions} = {}): Promise<Upload> {
  const g = options.g ?? gateway;
  const id = options.id ?? randomUUID();
  const claims = uploadClaims(id, bytes, {cls: options.cls, ct: options.ct, sha: options.sha});
  const ticket = await ticketFor(g, who, claims, options.ticket);
  const response = await fetch(`${g.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes, options.headerType ?? claims.ct, options.headerSha ?? claims.sha), body: asBody(bytes)});
  return {id, bytes, response, ticket};
}

async function uploaded(who: Member, bytes: Buffer, options: Parameters<typeof upload>[2] = {}) {
  const result = await upload(who, bytes, options);
  expect(result.response.status, await result.response.clone().text()).toBe(201);
  return result;
}

async function downloadTicket(who: Member, id: string, options: {g?: Gateway; tk?: string; ticket?: TicketOptions} = {}) {
  return ticketFor(options.g ?? gateway, who, {dir: 'download', tid: id, tk: options.tk}, options.ticket);
}

async function download(who: Member, id: string, headers: Record<string, string> = {}, options: {g?: Gateway} = {}) {
  const g = options.g ?? gateway;
  const ticket = await downloadTicket(who, id, {g});
  return fetch(`${g.url}/v1/files/staging/${id}`, {headers: {authorization: `Ticket ${ticket}`, ...headers}});
}

type RawResult = {status: number; headers: http.IncomingHttpHeaders; body: string; error?: string};

/**
 * A request made with node:http, for what fetch refuses to send (a Content-Length that does not match, no Content-Length, an Origin) and for a client that
 * goes away half way. `body` is sent as given, in pieces; `abortAfterBytes` destroys the connection once that many bytes have gone, with the body unfinished.
 */
function raw(url: string, options: {method?: string; headers?: Record<string, string>; body?: Buffer | AsyncIterable<Buffer>; abortAfterBytes?: number} = {}): Promise<RawResult> {
  return new Promise((done) => {
    let settled = false;
    let source: Readable | undefined;
    const finish = (result: RawResult) => {
      if (settled) return;
      settled = true;
      done(result);
    };
    const request = http.request(url, {method: options.method ?? 'GET', headers: options.headers, agent: false}, (response) => {
      const parts: Buffer[] = [];
      response.on('data', (part: Buffer) => parts.push(part));
      response.on('end', () => {
        finish({status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(parts).toString('utf8')});
        source?.destroy();
        request.destroy();
      });
      response.on('error', (error) => finish({status: response.statusCode ?? 0, headers: response.headers, body: '', error: (error as NodeJS.ErrnoException).code ?? error.message}));
    });
    request.on('error', (error) => finish({status: 0, headers: {}, body: '', error: (error as NodeJS.ErrnoException).code ?? error.message}));
    const body = options.body;
    if (body === undefined) {
      request.end();
    } else if (Buffer.isBuffer(body) && options.abortAfterBytes === undefined) {
      request.end(body);
    } else {
      const pieces: AsyncIterable<Buffer> = Buffer.isBuffer(body)
        ? (async function* () {
            for (let at = 0; at < body.length; at += 256 * 1024) yield body.subarray(at, at + 256 * 1024);
          })()
        : body;
      source = Readable.from(
        (async function* () {
          let sent = 0;
          for await (const part of pieces) {
            yield part;
            sent += part.length;
            if (options.abortAfterBytes !== undefined && sent >= options.abortAfterBytes) {
              // The client goes away: the connection is destroyed with the body unfinished.
              setTimeout(() => request.destroy(), 20);
              await new Promise(() => undefined);
            }
          }
        })(),
      );
      source.on('error', () => undefined);
      source.pipe(request);
    }
  });
}

/** Reads a streamed response to its end or its failure: what arrived, and why it stopped. */
async function readAll(response: Response) {
  const reader = response.body!.getReader();
  const parts: Buffer[] = [];
  let error: unknown = null;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value));
    }
  } catch (caught) {
    error = caught;
  }
  const data = Buffer.concat(parts);
  return {data, bytes: data.length, error};
}

async function objectOf(key: string): Promise<Buffer | null> {
  try {
    const stored = await gateway.storage.get(key, null);
    const parts: Buffer[] = [];
    for await (const part of stored.body) parts.push(Buffer.from(part));
    return Buffer.concat(parts);
  } catch (error) {
    if (error instanceof MissingObject) return null;
    throw error;
  }
}

/** The keys the bucket holds under a prefix, listed by the test's own client (not the gateway's): what is really in Storage, not what a call reported. */
async function keysUnder(prefix: string): Promise<string[]> {
  const s3 = s3Of(localStack());
  const client = new S3Client({endpoint: s3.endpoint, region: s3.region, credentials: {accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey}, forcePathStyle: true});
  try {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({Bucket: bucketName, Prefix: prefix, ContinuationToken: token}));
      for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
      token = page.NextContinuationToken;
    } while (token);
    return keys.sort();
  } finally {
    client.destroy();
  }
}
const objectsOf = (accountId: string) => keysUnder(`objects/${accountId}/`);

/** The SHA-256 and length of an object read in a stream (a 100 MiB object is not held in memory). */
async function objectDigest(key: string): Promise<{sha: string; length: number} | null> {
  try {
    const stored = await gateway.storage.get(key, null);
    const hash = createHash('sha256');
    let length = 0;
    for await (const part of stored.body) {
      hash.update(part);
      length += part.length;
    }
    return {sha: hash.digest('hex'), length};
  } catch (error) {
    if (error instanceof MissingObject) return null;
    throw error;
  }
}

const leaseOf = async (id: string) => (await db.query('select * from artifacts.staging_leases where id = $1', [id])).rows[0] as Record<string, any> | undefined;
const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);
const redemptionsOf = (accountId: string) => count('select count(*) as n from artifacts.ticket_redemptions where account_id = $1', [accountId]);
const handlesOf = (accountId: string) => count('select count(*) as n from artifacts.transfer_handles where account_id = $1', [accountId]);
const leasesOf = (accountId: string) => count('select count(*) as n from artifacts.staging_leases where account_id = $1', [accountId]);
const rowsOf = async (...accountIds: string[]) => Promise.all(accountIds.map(async (id) => [await redemptionsOf(id), await handlesOf(id), await leasesOf(id)]));
const payloadOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, any>;
const waitFor = async <T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** A lease the test makes as the database's owner: an Account's staging that counts against its quota without a byte behind it. */
async function prefill(accountId: string, length: number, state: 'receiving' | 'complete' | 'attached' | 'released' = 'complete') {
  const id = randomUUID();
  await db.query(
    `insert into artifacts.staging_leases (id, account_id, kid, kind, length, sha256, content_type, received_length, state, expires_at)
     values ($1, $2, 'test-prefill', 'file', $3, repeat('0', 64), 'application/octet-stream', $4, $5, now() + interval '1 day')`,
    [id, accountId, length, state === 'receiving' ? 0 : length, state],
  );
  return id;
}

/** A token with a valid signature and any claims: what a holder of the application's key could make, or a forger's best attempt at it. */
function forge(signer: Signer, payload: Record<string, unknown>, options: {header?: Record<string, unknown>; flipSignature?: boolean} = {}) {
  const header = Buffer.from(JSON.stringify(options.header ?? {v: 1, alg: 'EdDSA', kid: signer.kid})).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(null, Buffer.from(`${tokenLabel}${header}.${body}`, 'utf8'), signer.privateKey);
  if (options.flipSignature) signature[0] ^= 0xff;
  return `${header}.${body}.${signature.toString('base64url')}`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
/** Bytes as a request body (the DOM's types want a view on an ArrayBuffer, which a Buffer is at runtime). */
const asBody = (bytes: Buffer) => bytes as unknown as Uint8Array<ArrayBuffer>;

/** The payload of a valid upload ticket, to be bent one claim at a time. */
function ticketPayload(who: Member, id: string, bytes: Buffer, epoch: number, over: Record<string, unknown> = {}) {
  const iat = nowSeconds();
  const payload: Record<string, unknown> = {
    iss: 'application',
    aud: 'gateway',
    env: instanceId,
    jti: newJti(),
    iat,
    exp: iat + 300,
    typ: 'ticket',
    acct: who.accountId,
    sid: who.sessionId,
    epoch,
    dir: 'upload',
    tk: 'staging',
    tid: id,
    cls: 'picture',
    len: bytes.length,
    sha: sha256(bytes),
    ct: 'image/png',
    ...over,
  };
  for (const [name, value] of Object.entries(payload)) if (value === undefined) delete payload[name];
  return payload;
}

/** A gateway of its own, for what needs other keys or another configuration; closed afterwards. */
async function withGateway<T>(options: GatewayOptions, work: (g: Gateway) => Promise<T>) {
  const g = await startGateway(instanceId, {log: (message, detail) => void logged.push(`${message} ${detail}`), ...options});
  try {
    return await work(g);
  } finally {
    await g.close();
  }
}

const uniqueLabel = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

/** A signer for a key that exists for one test (so that revoking it cannot touch any other suite). */
const throwawaySigner = () => {
  const label = uniqueLabel('throwaway');
  return {label, ...testSigner({active: label})};
};

// =====================================================================================================================================================
describe('the gateway answers like a gateway', () => {
  it('has a health check that answers 200, sets no cookie and is no-store', async () => {
    const response = await fetch(`${gateway.url}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status: 'ok'});
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect((await fetch(`${gateway.url}/healthz`, {method: 'POST'})).status).toBe(405);
  });

  it('refuses a route it does not have, and a method a route does not take, with the same security headers', async () => {
    const id = randomUUID();
    for (const [method, path, status] of [
      ['GET', '/', 404],
      ['GET', '/v1/uploads', 404],
      ['GET', `/v1/uploads/${id}`, 405],
      ['POST', `/v1/uploads/${id}`, 405],
      ['PUT', `/v1/files/staging/${id}`, 405],
      ['GET', '/v1/commands', 405],
      ['PUT', '/v1/commands', 405],
      ['POST', `/d/${'a'.repeat(30)}`, 405],
      ['GET', '/v1/uploads/not-a-uuid', 404],
      ['GET', '/v1/uploads/%2e%2e%2f%2e%2e', 404],
    ] as [string, string, number][]) {
      const response = await fetch(`${gateway.url}${path}`, {method});
      expect(response.status, `${method} ${path}`).toBe(status);
      expect(response.headers.get('cache-control'), path).toBe('no-store');
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(response.headers.get('set-cookie'), path).toBeNull();
      expect(response.headers.get('vary'), path).toContain('Origin');
    }
  });
});

// =====================================================================================================================================================
describe('uploads: what is accepted, byte for byte', () => {
  it('takes a 5 MiB PNG: 201, the lease complete, and the very bytes in the private bucket under staging/<account>/<upload>', async () => {
    const who = await member();
    const bytes = pngBytes(5 * MiB);
    const result = await uploaded(who, bytes);
    expect(result.response.headers.get('cache-control')).toBe('no-store');
    expect(await result.response.json()).toEqual({id: result.id, length: bytes.length, sha256: sha256(bytes)});
    expect(await leaseOf(result.id)).toMatchObject({account_id: who.accountId, kind: 'picture', length: String(bytes.length), sha256: sha256(bytes), content_type: 'image/png', received_length: String(bytes.length), state: 'complete'});
    const stored = await objectOf(staging(who.accountId, result.id));
    expect(stored && sha256(stored)).toBe(sha256(bytes));
    expect(stored!.length).toBe(bytes.length);
  });

  it('takes a JPEG and a WebP, each by what its first bytes say it is', async () => {
    const who = await member();
    const jpeg = jpegBytes(3 * MiB + 17);
    const webp = webpBytes(2 * MiB + 5);
    const one = await uploaded(who, jpeg, {ct: 'image/jpeg'});
    const two = await uploaded(who, webp, {ct: 'image/webp'});
    expect(sha256((await objectOf(staging(who.accountId, one.id)))!)).toBe(sha256(jpeg));
    expect(sha256((await objectOf(staging(who.accountId, two.id)))!)).toBe(sha256(webp));
    expect(await leaseOf(one.id)).toMatchObject({content_type: 'image/jpeg', state: 'complete'});
    expect(await leaseOf(two.id)).toMatchObject({content_type: 'image/webp', state: 'complete'});
  });

  it('takes a 20 MiB file of any bytes as application/octet-stream (multipart, cut into chunks of at most 1 MiB)', async () => {
    const who = await member();
    const bytes = randomBytes(20 * MiB + 3);
    probe.reset();
    const result = await uploaded(who, bytes, {cls: 'file'});
    expect(sha256((await objectOf(staging(who.accountId, result.id)))!)).toBe(sha256(bytes));
    expect(await leaseOf(result.id)).toMatchObject({kind: 'file', content_type: 'application/octet-stream', state: 'complete'});
    // 21 chunks (20 of 1 MiB and one of 3 bytes), and each was authorized before it was taken: a hook, then a live read of the session and the lease.
    const chunks = probe.events.filter((event) => event.startsWith('chunk:upload:'));
    expect(chunks).toHaveLength(21);
    expect(probe.authorizeCalls).toBe(21);
    expect(probe.events).toEqual(Array.from({length: 21}, (_unused, index) => [`chunk:upload:${index}`, 'authorize', 'resolve']).flat());
  });

  it('takes a picture of exactly 12 MiB and a file of exactly 100 MiB, the limits themselves', async () => {
    const who = await member();
    const picture = pngBytes(12 * MiB);
    const result = await uploaded(who, picture);
    expect(sha256((await objectOf(staging(who.accountId, result.id)))!)).toBe(sha256(picture));
    const big = randomBytes(100 * MiB);
    const file = await uploaded(who, big, {cls: 'file'});
    expect(await objectDigest(staging(who.accountId, file.id))).toEqual({sha: sha256(big), length: 100 * MiB});
    expect(await leaseOf(file.id)).toMatchObject({length: String(100 * MiB), state: 'complete'});
  }, 60_000);

  it('renews the lease as bytes arrive: it lasts 24 hours from the last chunk', async () => {
    const who = await member();
    const result = await uploaded(who, pngBytes(2 * MiB));
    const lease = await leaseOf(result.id);
    const hours = (lease!.expires_at.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24.01);
  });

  it('holds no secret of the upload in the response: no credential, no storage URL', async () => {
    const who = await member();
    const result = await uploaded(who, pngBytes(MiB));
    const text = JSON.stringify([...result.response.headers.entries()]) + (await result.response.text());
    const s3 = s3Of(localStack());
    for (const forbidden of ['X-Amz', 'x-amz', 'storage/v1', s3.accessKeyId, s3.secretAccessKey, new URL(s3.endpoint).host, 'private-files', 'signature']) expect(text, forbidden).not.toContain(forbidden);
  });
});

// =====================================================================================================================================================
describe('uploads: what is refused, and what it leaves behind', () => {
  it('refuses a body whose SHA-256 is not the ticket\'s: 400, no object, and the lease released', async () => {
    const who = await member();
    const claimed = pngBytes(2 * MiB);
    const sent = pngBytes(2 * MiB);
    // The ticket and the header both name `claimed`'s digest; the bytes that arrive are `sent`'s.
    const result = await upload(who, sent, {sha: sha256(claimed), headerSha: sha256(claimed)});
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual(errorBody('checksum_mismatch'));
    expect(await objectOf(staging(who.accountId, result.id))).toBeNull();
    expect(await leaseOf(result.id)).toMatchObject({state: 'released'});
  });

  it('refuses leading bytes that are not what the content type says (a PNG that is not, a JPEG that is a PNG): 400, no object, lease released', async () => {
    const who = await member();
    for (const [ct, bytes] of [
      ['image/png', randomBytes(1000)],
      ['image/jpeg', pngBytes(5000)],
      ['image/webp', jpegBytes(5000)],
      ['image/png', Buffer.concat([pngBytes(8).subarray(0, 7), Buffer.from([0x00]), randomBytes(500)])],
    ] as [string, Buffer][]) {
      const result = await upload(who, bytes, {ct});
      expect(result.response.status, ct).toBe(400);
      expect(await result.response.json(), ct).toEqual(errorBody('content_mismatch'));
      expect(await objectOf(staging(who.accountId, result.id)), ct).toBeNull();
      expect(await leaseOf(result.id), ct).toMatchObject({state: 'released'});
    }
  });

  it('refuses a picture over 12 MiB and a file over 100 MiB with 413 and leaves nothing: no lease, no object', async () => {
    const who = await member();
    const picture = pngBytes(12 * MiB + 1);
    const tooBig = await upload(who, picture);
    expect(tooBig.response.status).toBe(413);
    expect(await tooBig.response.json()).toEqual(errorBody('payload_too_large'));
    expect(await leaseOf(tooBig.id)).toBeUndefined();
    expect(await objectOf(staging(who.accountId, tooBig.id))).toBeNull();

    // A file one byte over 100 MiB: the client declares it and starts to send; the answer arrives before the bytes do.
    const id = randomUUID();
    const length = 100 * MiB + 1;
    const ticket = await ticketFor(gateway, who, {dir: 'upload', tid: id, cls: 'file', len: length, sha: '0'.repeat(64), ct: 'application/octet-stream'});
    const result = await raw(`${gateway.url}/v1/uploads/${id}`, {
      method: 'PUT',
      headers: {authorization: `Ticket ${ticket}`, 'content-type': 'application/octet-stream', 'content-length': String(length), 'x-content-sha256': '0'.repeat(64)},
      // Sent lazily, a megabyte at a time: the answer arrives long before the last of them is wanted.
      body: (async function* () {
        const block = Buffer.alloc(MiB);
        for (let sent = 0; sent < length; sent += MiB) yield sent + MiB <= length ? block : block.subarray(0, length - sent);
      })(),
    });
    expect(result.status).toBe(413);
    expect(JSON.parse(result.body)).toEqual(errorBody('payload_too_large'));
    expect(await leaseOf(id)).toBeUndefined();
  });

  it('refuses a content type that is not one of the allowed (a GIF picture, an octet-stream picture, a PNG file), 400, nothing written', async () => {
    const who = await member();
    const bytes = pngBytes(1000);
    for (const [cls, ct] of [
      ['picture', 'image/gif'],
      ['picture', 'application/octet-stream'],
      ['file', 'image/png'],
    ] as ['picture' | 'file', string][]) {
      const result = await upload(who, bytes, {cls, ct});
      expect(result.response.status, `${cls} ${ct}`).toBe(400);
      expect(await result.response.json()).toEqual(errorBody('invalid_upload'));
      expect(await leaseOf(result.id)).toBeUndefined();
    }
  });

  it('refuses an upload with no Content-Length (chunked): 411, and the ticket is not spent', async () => {
    const who = await member();
    const bytes = pngBytes(5000);
    const id = randomUUID();
    const jti = newJti();
    const ticket = await ticketFor(gateway, who, uploadClaims(id, bytes), {jti});
    const result = await raw(`${gateway.url}/v1/uploads/${id}`, {
      method: 'PUT',
      headers: {authorization: `Ticket ${ticket}`, 'content-type': 'image/png', 'x-content-sha256': sha256(bytes), 'transfer-encoding': 'chunked'},
      body: (async function* () {
        yield bytes;
      })(),
    });
    expect(result.status).toBe(411);
    expect(JSON.parse(result.body)).toEqual(errorBody('length_required'));
    expect(await leaseOf(id)).toBeUndefined();
    expect(await count('select count(*) as n from artifacts.ticket_redemptions where jti = $1', [jti])).toBe(0);
  });

  it('refuses a request that does not say what the ticket says (length, content type, checksum header, none): 400, nothing written, ticket not spent', async () => {
    const who = await member();
    const bytes = pngBytes(5000);
    const cases: [string, Record<string, string>, string][] = [
      ['another length', {'content-length': String(bytes.length + 1)}, 'length_mismatch'],
      ['another content type', {'content-type': 'image/jpeg'}, 'content_type_mismatch'],
      ['another checksum', {'x-content-sha256': sha256('other')}, 'checksum_mismatch'],
      ['no checksum', {'x-content-sha256': ''}, 'checksum_mismatch'],
    ];
    for (const [label, change, error] of cases) {
      const id = randomUUID();
      const jti = newJti();
      const ticket = await ticketFor(gateway, who, uploadClaims(id, bytes), {jti});
      const headers: Record<string, string> = {...uploadHeaders(ticket, bytes), ...change};
      if (headers['x-content-sha256'] === '') delete headers['x-content-sha256'];
      // A body at least as long as it declares, so that the client sends everything the header promises.
      const body = change['content-length'] ? Buffer.concat([bytes, Buffer.from('x')]) : bytes;
      const result = await raw(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers, body});
      expect(result.status, label).toBe(400);
      expect(JSON.parse(result.body), label).toEqual(errorBody(error));
      expect(await leaseOf(id), label).toBeUndefined();
      expect(await count('select count(*) as n from artifacts.ticket_redemptions where jti = $1', [jti]), label).toBe(0);
    }
  });

  it('accepts the checksum header in capitals (a digest is the same digest)', async () => {
    const who = await member();
    const bytes = pngBytes(5000);
    const result = await upload(who, bytes, {headerSha: sha256(bytes).toUpperCase()});
    expect(result.response.status).toBe(201);
  });
});

// =====================================================================================================================================================
describe('the quota: an Account\'s open staging is at most 250 MiB', () => {
  it('takes exactly 250 MiB of open staging and refuses one byte more with 413 quota_exceeded, leaving no lease, no object and no trace in the quota', async () => {
    const who = await member();
    await prefill(who.accountId, 100 * MiB);
    await prefill(who.accountId, 100 * MiB, 'receiving');
    // 200 MiB are open (a complete lease and a receiving one), so 50 MiB fit and 50 MiB + 1 byte do not.
    const fits = await uploaded(who, randomBytes(50 * MiB), {cls: 'file'});
    expect(await leaseOf(fits.id)).toMatchObject({state: 'complete'});
    const over = await upload(who, randomBytes(1), {cls: 'file'});
    expect(over.response.status).toBe(413);
    expect(await over.response.json()).toEqual(errorBody('quota_exceeded'));
    expect(await leaseOf(over.id)).toBeUndefined();
    expect(await objectOf(staging(who.accountId, over.id))).toBeNull();
    expect(await count(`select coalesce(sum(length), 0) as n from artifacts.staging_leases where account_id = $1 and state in ('receiving', 'complete')`, [who.accountId])).toBe(250 * MiB);
  }, 60_000);

  it('counts a lease only while it has time left: two complete 100 MiB leases whose time has run out leave the whole 250 MiB free, and with time left they take 200 MiB of it', async () => {
    const lapsed = await member();
    const open = await member();
    for (const who of [lapsed, open]) {
      const ids = [await prefill(who.accountId, 100 * MiB), await prefill(who.accountId, 100 * MiB)];
      // A past expiry is the only difference between the two Accounts: the lapsed leases wait for the hourly cleanup and hold no room meanwhile.
      if (who === lapsed) await db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = any($1)`, [ids]);
    }
    // 50 MiB + 1 byte is one byte more than 200 MiB of open leases leave, and fits in the 250 MiB that two lapsed leases leave.
    const fits = await uploaded(lapsed, randomBytes(50 * MiB + 1), {cls: 'file'});
    expect(await leaseOf(fits.id)).toMatchObject({state: 'complete'});
    const refused = await upload(open, randomBytes(50 * MiB + 1), {cls: 'file'});
    expect(refused.response.status).toBe(413);
    expect(await refused.response.json()).toEqual(errorBody('quota_exceeded'));
    expect(await leaseOf(refused.id)).toBeUndefined();
    // And exactly 50 MiB is what the open leases leave.
    expect((await upload(open, randomBytes(50 * MiB), {cls: 'file'})).response.status).toBe(201);
  }, 60_000);

  it('is the Account\'s own: another Account at its limit does not make this one\'s upload refuse', async () => {
    const full = await member();
    const other = await member();
    await prefill(full.accountId, 100 * MiB);
    await prefill(full.accountId, 100 * MiB);
    await prefill(full.accountId, 50 * MiB);
    expect((await upload(full, randomBytes(1), {cls: 'file'})).response.status).toBe(413);
    expect((await upload(other, pngBytes(MiB))).response.status).toBe(201);
  });

  it('holds when uploads race: four 20 MiB uploads at once against 50 MiB of room let exactly two in, and the open staging never passes 250 MiB', async () => {
    const who = await member();
    await prefill(who.accountId, 100 * MiB);
    await prefill(who.accountId, 100 * MiB);
    const results = await Promise.all(Array.from({length: 4}, () => upload(who, randomBytes(20 * MiB), {cls: 'file'})));
    const statuses = results.map((result) => result.response.status).sort();
    expect(statuses).toEqual([201, 201, 413, 413]);
    for (const result of results.filter((entry) => entry.response.status === 413)) expect(await result.response.json()).toEqual(errorBody('quota_exceeded'));
    expect(await count(`select coalesce(sum(length), 0) as n from artifacts.staging_leases where account_id = $1 and state in ('receiving', 'complete')`, [who.accountId])).toBe(240 * MiB);
  }, 60_000);

  it('gives the room back when a lease is released or attached, and not before', async () => {
    const who = await member();
    const first = await prefill(who.accountId, 100 * MiB);
    const second = await prefill(who.accountId, 100 * MiB);
    await prefill(who.accountId, 50 * MiB);
    expect((await upload(who, randomBytes(MiB), {cls: 'file'})).response.status).toBe(413);
    await db.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [first]);
    const afterRelease = await uploaded(who, randomBytes(MiB), {cls: 'file'});
    expect(afterRelease.response.status).toBe(201);
    // 150 MiB + 1 MiB are open: 99 MiB fit and 99 MiB + 1 byte do not.
    expect((await upload(who, randomBytes(99 * MiB + 1), {cls: 'file'})).response.status).toBe(413);
    await db.query(`update artifacts.staging_leases set state = 'attached' where id = $1`, [second]);
    expect((await upload(who, randomBytes(99 * MiB + 1), {cls: 'file'})).response.status).toBe(201);
  }, 60_000);

  it('gives the room back when an upload fails (a lease that was released stops counting)', async () => {
    const who = await member();
    await prefill(who.accountId, 100 * MiB);
    await prefill(who.accountId, 100 * MiB);
    const bytes = randomBytes(40 * MiB);
    const bad = await upload(who, bytes, {cls: 'file', sha: sha256('not these bytes')});
    expect(bad.response.status).toBe(400);
    expect(await leaseOf(bad.id)).toMatchObject({state: 'released'});
    expect((await upload(who, randomBytes(50 * MiB), {cls: 'file'})).response.status).toBe(201);
  }, 60_000);
});

// =====================================================================================================================================================
describe('ownership: a foreign or repeated upload ID, and another Account\'s file', () => {
  it('refuses a second upload to an ID that has a lease (409), another Account\'s or its own, and touches neither the lease nor the object', async () => {
    const owner = await member();
    const intruder = await member();
    const bytes = pngBytes(3 * MiB);
    const first = await uploaded(owner, bytes);
    const before = JSON.stringify(await leaseOf(first.id));
    const objectBefore = sha256((await objectOf(staging(owner.accountId, first.id)))!);

    const foreign = await upload(intruder, pngBytes(MiB), {id: first.id});
    expect(foreign.response.status).toBe(409);
    expect(await foreign.response.json()).toEqual(errorBody('upload_exists'));
    const repeated = await upload(owner, pngBytes(MiB), {id: first.id});
    expect(repeated.response.status).toBe(409);

    expect(JSON.stringify(await leaseOf(first.id))).toBe(before);
    expect(sha256((await objectOf(staging(owner.accountId, first.id)))!)).toBe(objectBefore);
    expect(await objectOf(staging(intruder.accountId, first.id))).toBeNull();
    // The refused tickets were redeemed (they were genuine), and no lease row of the intruder's exists.
    expect(await count('select count(*) as n from artifacts.staging_leases where account_id = $1', [intruder.accountId])).toBe(0);
  });

  it('keeps an ID taken after the upload failed: the ID of a released lease is never reused', async () => {
    const who = await member();
    const bad = await upload(who, pngBytes(1000), {ct: 'image/png', sha: sha256('x')});
    expect(bad.response.status).toBe(400);
    const again = await upload(who, pngBytes(1000), {id: bad.id});
    expect(again.response.status).toBe(409);
    expect(await leaseOf(bad.id)).toMatchObject({state: 'released'});
  });

  it('does not let another Account read a staged file: its ticket for that ID is answered 404, whole or by range, and no byte is sent', async () => {
    const owner = await member();
    const other = await member();
    const stored = await uploaded(owner, pngBytes(2 * MiB));
    for (const headers of [{}, {range: 'bytes=0-9'}] as Record<string, string>[]) {
      const response = await download(other, stored.id, headers);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(errorBody('not_found'));
    }
    expect((await download(owner, stored.id)).status).toBe(200);
  });

  it('refuses a ticket that names one Account and another\'s session (either way round): 401, nothing read or written about either', async () => {
    const a = await member();
    const b = await member();
    const bytes = pngBytes(5000);
    const before = await rowsOf(a.accountId, b.accountId);
    for (const [label, claims] of [
      ['B\'s Account, A\'s session', {acct: b.accountId, sid: a.sessionId}],
      ['A\'s Account, B\'s session', {acct: a.accountId, sid: b.sessionId}],
    ] as [string, Partial<TicketInput>][]) {
      const id = randomUUID();
      const ticket = await ticketFor(gateway, a, {...uploadClaims(id, bytes), ...claims} as TicketInput);
      const response = await fetch(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes), body: asBody(bytes)});
      expect(response.status, label).toBe(401);
      expect(await response.json(), label).toEqual(errorBody('invalid_ticket'));
      expect(await leaseOf(id), label).toBeUndefined();
    }
    expect(await rowsOf(a.accountId, b.accountId)).toEqual(before);
  });
});

// =====================================================================================================================================================
describe('a ticket that is not good, and only then is it refused: one body, nothing read or written', () => {
  it('is refused 401 invalid_ticket with the same body for every way it can be wrong, and writes no row of any kind', async () => {
    const a = await member();
    const b = await member();
    const bytes = pngBytes(20_000);
    const epoch = await epochOf(db, a.accountId);
    const stranger = testSigner({active: uniqueLabel('stranger')}).signer;
    const forgerPair = testKeyPair(uniqueLabel('forger'), gateway.signer.kid);
    const forgerKeys = parseKeySet(JSON.stringify({issuer: 'application', active: forgerPair.kid, retiring: null, keys: {[forgerPair.kid]: forgerPair.publicKey}}), 'application');
    if (!forgerKeys.ok) throw new Error(forgerKeys.problem);
    const forger = loadSigner(forgerPair.privateKey, forgerKeys.keySet);
    if (!forger.ok) throw new Error(forger.problem);
    const signer = gateway.signer;
    const id = () => randomUUID();
    const valid = (over: Record<string, unknown> = {}, tid = id()) => ({tid, token: forge(signer, ticketPayload(a, tid, bytes, epoch, {tid, ...over}))});
    const now = nowSeconds();

    // [label, the path's upload ID, the ticket, the scheme]
    const variants: [string, string, string, string?][] = [];
    const add = (label: string, make: () => {tid: string; token: string}, scheme = 'Ticket') => {
      const {tid, token} = make();
      variants.push([label, tid, token, scheme]);
    };
    add('expired', () => valid({iat: now - 700, exp: now - 400}));
    add('another session of the same Account (no such grant)', () => valid({sid: randomUUID()}));
    add('another Account than the session\'s', () => valid({acct: b.accountId}));
    add('another target than the path\'s', () => {
      const made = valid();
      return {tid: randomUUID(), token: made.token};
    });
    add('another direction (a download ticket)', () => valid({dir: 'download', cls: undefined, len: undefined, sha: undefined, ct: undefined}));
    add('a key the gateway has never heard of', () => {
      const tid = id();
      return {tid, token: forge(stranger, ticketPayload(a, tid, bytes, epoch))};
    });
    add('the right key ID, a different key', () => {
      const tid = id();
      return {tid, token: forge(forger.ok ? forger.signer : stranger, ticketPayload(a, tid, bytes, epoch))};
    });
    add('another audience', () => valid({aud: 'cad-worker'}));
    add('another issuer', () => valid({iss: 'gateway'}));
    add('another environment', () => valid({env: randomUUID()}));
    add('a lifetime of 301 seconds', () => valid({iat: now, exp: now + 301}));
    add('issued 90 seconds in the future', () => valid({iat: now + 90, exp: now + 300}));
    add('a lifetime of zero', () => valid({iat: now, exp: now}));
    add('a command, not a ticket', () => valid({typ: 'command'}));
    add('an unknown claim (a URL)', () => valid({url: 'https://storage.example/object?signature=abc'}));
    add('an unknown claim (a storage credential)', () => valid({secret: 'AKIA'}));
    add('a missing claim', () => valid({sha: undefined}));
    add('a session that is not a UUID', () => valid({sid: 'not-a-uuid'}));
    add('a header that is not the contract\'s', () => {
      const tid = id();
      return {tid, token: forge(signer, ticketPayload(a, tid, bytes, epoch), {header: {v: 2, alg: 'EdDSA', kid: signer.kid}})};
    });
    add('an algorithm other than EdDSA', () => {
      const tid = id();
      return {tid, token: forge(signer, ticketPayload(a, tid, bytes, epoch), {header: {v: 1, alg: 'none', kid: signer.kid}})};
    });
    add('a tampered signature', () => {
      const tid = id();
      return {tid, token: forge(signer, ticketPayload(a, tid, bytes, epoch), {flipSignature: true})};
    });
    add('a tampered payload (the length changed after signing)', () => {
      const tid = id();
      const token = forge(signer, ticketPayload(a, tid, bytes, epoch));
      const [header, , signature] = token.split('.');
      const edited = Buffer.from(JSON.stringify({...ticketPayload(a, tid, bytes, epoch), len: bytes.length + 1})).toString('base64url');
      return {tid, token: `${header}.${edited}.${signature}`};
    });
    add('garbage', () => ({tid: id(), token: 'not-a-token'}));
    add('a token far too long', () => ({tid: id(), token: `${'a'.repeat(5000)}.b.c`}));
    add('the wrong scheme (Bearer)', () => valid(), 'Bearer');

    const noToken = id();
    const before = await rowsOf(a.accountId, b.accountId);
    const bodies = new Set<string>();
    for (const [label, tid, token, scheme] of variants) {
      const response = await fetch(`${gateway.url}/v1/uploads/${tid}`, {
        method: 'PUT',
        headers: {...uploadHeaders(token, bytes), authorization: `${scheme} ${token}`},
        body: bytes,
      });
      const text = await response.text();
      expect(response.status, label).toBe(401);
      expect(response.headers.get('cache-control'), label).toBe('no-store');
      bodies.add(text);
      expect(await leaseOf(tid), label).toBeUndefined();
      expect(await objectOf(staging(a.accountId, tid)), label).toBeNull();
    }
    // ... no ticket at all, an empty one, the scheme alone, and a ticket with something after it.
    for (const authorization of [undefined, '', 'Ticket ', `Ticket ${'x'.repeat(40)} extra`]) {
      const headers: Record<string, string> = {...uploadHeaders('x', bytes)};
      if (authorization === undefined) delete headers.authorization;
      else headers.authorization = authorization;
      const response = await fetch(`${gateway.url}/v1/uploads/${noToken}`, {method: 'PUT', headers, body: asBody(bytes)});
      expect(response.status, JSON.stringify(authorization)).toBe(401);
      bodies.add(await response.text());
    }
    expect([...bodies]).toEqual([JSON.stringify(errorBody('invalid_ticket'))]);
    // Nothing was redeemed, no handle opened, no lease made, for either Account.
    expect(await rowsOf(a.accountId, b.accountId)).toEqual(before);
  });

  it('names no reason: the same status and body for a ticket that expired and for one that was forged', async () => {
    const who = await member();
    const bytes = pngBytes(2000);
    const answers = new Set<string>();
    for (const token of [forge(gateway.signer, ticketPayload(who, randomUUID(), bytes, 1, {iat: nowSeconds() - 900, exp: nowSeconds() - 600})), forge(testSigner({active: uniqueLabel('x')}).signer, ticketPayload(who, randomUUID(), bytes, 1))]) {
      const id = randomUUID();
      const response = await fetch(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(token, bytes), body: asBody(bytes)});
      answers.add(`${response.status} ${[...response.headers.keys()].sort().join(',')} ${await response.text()}`);
    }
    expect(answers.size).toBe(1);
  });

  it('is refused once: a ticket that was used is a replay, the real redemption is the one row, and the replay changes nothing', async () => {
    const who = await member();
    const bytes = pngBytes(3 * MiB);
    const id = randomUUID();
    const jti = newJti();
    const ticket = await ticketFor(gateway, who, uploadClaims(id, bytes), {jti});
    const send = () => fetch(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes), body: asBody(bytes)});
    expect((await send()).status).toBe(201);
    const leaseBefore = JSON.stringify(await leaseOf(id));
    const replay = await send();
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual(errorBody('invalid_ticket'));
    expect(await count('select count(*) as n from artifacts.ticket_redemptions where jti = $1', [jti])).toBe(1);
    expect(await count('select count(*) as n from artifacts.transfer_handles where jti = $1', [jti])).toBe(1);
    expect(JSON.stringify(await leaseOf(id))).toBe(leaseBefore);
    // The same for a download ticket.
    const read = await downloadTicket(who, id);
    const get = () => fetch(`${gateway.url}/v1/files/staging/${id}`, {headers: {authorization: `Ticket ${read}`}});
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(401);
  });

  it('runs two requests with one ticket at once: exactly one redeems it', async () => {
    const who = await member();
    const stored = await uploaded(who, pngBytes(MiB));
    const ticket = await downloadTicket(who, stored.id);
    const statuses = await Promise.all(Array.from({length: 5}, async () => (await fetch(`${gateway.url}/v1/files/staging/${stored.id}`, {headers: {authorization: `Ticket ${ticket}`}})).status));
    expect(statuses.sort()).toEqual([200, 401, 401, 401, 401]);
  });

  it('refuses a ticket for the Account\'s earlier epoch with 403, not 401: the ticket is genuine and the Account has moved on, and nothing is redeemed', async () => {
    const who = await member();
    const bytes = pngBytes(5000);
    const jti = newJti();
    const id = randomUUID();
    const ticket = await ticketFor(gateway, who, uploadClaims(id, bytes), {jti, epoch: 99});
    const response = await fetch(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes), body: asBody(bytes)});
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(errorBody('forbidden'));
    expect(await count('select count(*) as n from artifacts.ticket_redemptions where jti = $1', [jti])).toBe(0);
    expect(await leaseOf(id)).toBeUndefined();
  });

  it('accepts a ticket whose clock is a little ahead of the gateway\'s (30 seconds, inside the skew) and refuses one whose lifetime ran out', async () => {
    const who = await member();
    const bytes = pngBytes(5000);
    const ahead = await upload(who, bytes, {ticket: {now: nowSeconds() + 30}});
    expect(ahead.response.status).toBe(201);
    const stale = await upload(who, bytes, {ticket: {now: nowSeconds() - 301}});
    expect(stale.response.status).toBe(401);
  });

  it('refuses a ticket for a kind of target with no resolver, 400 unknown_target, and a download ticket for a kind that is not the path\'s, 401', async () => {
    const who = await member();
    const bytes = pngBytes(5000);
    const id = randomUUID();
    const ticket = await ticketFor(gateway, who, {...uploadClaims(id, bytes), tk: 'project'});
    const put = await fetch(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes), body: asBody(bytes)});
    expect(put.status).toBe(400);
    expect(await put.json()).toEqual(errorBody('unknown_target'));
    expect(await leaseOf(id)).toBeUndefined();

    const stored = await uploaded(who, bytes);
    const read = await ticketFor(gateway, who, {dir: 'download', tid: stored.id, tk: 'project'});
    const get = await fetch(`${gateway.url}/v1/files/project/${stored.id}`, {headers: {authorization: `Ticket ${read}`}});
    expect(get.status).toBe(400);
    expect(await get.json()).toEqual(errorBody('unknown_target'));
    const wrongKind = await ticketFor(gateway, who, {dir: 'download', tid: stored.id});
    const mismatch = await fetch(`${gateway.url}/v1/files/project/${stored.id}`, {headers: {authorization: `Ticket ${wrongKind}`}});
    expect(mismatch.status).toBe(401);
  });
});

// =====================================================================================================================================================
describe('key rotation and compromise', () => {
  it('accepts a ticket under the retiring key while its `until` is ahead, and refuses it once it is past, while the active key keeps working', async () => {
    const stamp = uniqueLabel('rot');
    const oldKey = testSigner({active: `${stamp}-a`});
    const who = await member();
    await withGateway({keys: {active: `${stamp}-b`, retiring: {label: `${stamp}-a`, until: new Date(Date.now() + 10 * 60_000)}}}, async (g) => {
      const bytes = pngBytes(5000);
      const viaRetiring = await upload(who, bytes, {g, ticket: {signer: oldKey.signer}});
      expect(viaRetiring.response.status).toBe(201);
      expect((await upload(who, bytes, {g})).response.status).toBe(201);
    });
    await withGateway({keys: {active: `${stamp}-b`, retiring: {label: `${stamp}-a`, until: new Date(Date.now() - 60_000)}}}, async (g) => {
      const bytes = pngBytes(5000);
      const refused = await upload(who, bytes, {g, ticket: {signer: oldKey.signer}});
      expect(refused.response.status).toBe(401);
      expect(await refused.response.json()).toEqual(errorBody('invalid_ticket'));
      expect(await leaseOf(refused.id)).toBeUndefined();
      expect((await upload(who, bytes, {g})).response.status).toBe(201);
    });
  });

  it('moves the retiring key\'s deadline with the gateway\'s clock: accepted at 9 minutes, refused at 11, the active key accepted at both', async () => {
    const stamp = uniqueLabel('clock');
    const oldKey = testSigner({active: `${stamp}-a`});
    const who = await member();
    let offset = 0;
    await withGateway({keys: {active: `${stamp}-b`, retiring: {label: `${stamp}-a`, until: new Date(Date.now() + 10 * 60_000)}}, clock: () => new Date(Date.now() + offset)}, async (g) => {
      const bytes = pngBytes(3000);
      for (const [minutes, retiringStatus] of [[9, 201], [11, 401]] as [number, number][]) {
        offset = minutes * 60_000;
        const now = Math.floor((Date.now() + offset) / 1000);
        const viaRetiring = await upload(who, bytes, {g, ticket: {signer: oldKey.signer, now}});
        expect(viaRetiring.response.status, `retiring key at ${minutes} minutes`).toBe(retiringStatus);
        const viaActive = await upload(who, bytes, {g, ticket: {now}});
        expect(viaActive.response.status, `active key at ${minutes} minutes`).toBe(201);
      }
    });
  });

  it('refuses at once a ticket under a key that is revoked, whatever its lifetime, and writes nothing', async () => {
    const key = throwawaySigner();
    const who = await member();
    await withGateway({keys: {active: key.label}}, async (g) => {
      const bytes = pngBytes(5000);
      const id = randomUUID();
      const ticket = await ticketFor(g, who, uploadClaims(id, bytes));
      const read = await ticketFor(g, who, {dir: 'download', tid: id});
      // Before the revocation the key works (one ticket used, one kept).
      expect((await upload(who, bytes, {g})).response.status).toBe(201);
      const revoked = await revokeServiceKey({issuer: 'application', kid: key.signer.kid, reason: 'compromise'}, {env});
      expect(revoked.outcome).toBe('revoked');
      const before = await rowsOf(who.accountId);
      const response = await fetch(`${g.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes), body: asBody(bytes)});
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(errorBody('invalid_ticket'));
      const get = await fetch(`${g.url}/v1/files/staging/${id}`, {headers: {authorization: `Ticket ${read}`}});
      expect(get.status).toBe(401);
      const fresh = await upload(who, bytes, {g});
      expect(fresh.response.status).toBe(401);
      expect(await leaseOf(id)).toBeUndefined();
      expect(await rowsOf(who.accountId)).toEqual(before);
      // A second revocation is idempotent.
      expect((await revokeServiceKey({issuer: 'application', kid: key.signer.kid, reason: 'compromise'}, {env})).outcome).toBe('exists');
    });
  });

  it('ends a transfer in flight when its key is revoked: the download stops at the chunk where the revocation lands, and the key\'s handles and leases are ended', async () => {
    const key = throwawaySigner();
    const who = await member();
    let revoke: (() => Promise<unknown>) | null = null;
    let revocation: Awaited<ReturnType<typeof revokeServiceKey>> | null = null;
    await withGateway(
      {
        keys: {active: key.label},
        hooks: {
          beforeChunk: async (chunk) => {
            if (revoke && chunk.direction === 'download' && chunk.index === 2) {
              const action = revoke;
              revoke = null;
              await action();
            }
          },
        },
      },
      async (g) => {
        const bytes = randomBytes(6 * MiB);
        const stored = await uploaded(who, bytes, {g, cls: 'file'});
        // A second upload under the key is complete, so it still counts as open staging when the key is revoked.
        const second = await uploaded(who, pngBytes(MiB), {g});
        expect(await count(`select count(*) as n from artifacts.transfer_handles where account_id = $1 and ended_at is null`, [who.accountId])).toBe(2);
        revoke = async () => {
          revocation = await revokeServiceKey({issuer: 'application', kid: key.signer.kid, reason: 'compromise'}, {env});
        };
        const result = await readAll(await download(who, stored.id, {}, {g}));
        expect(result.error).not.toBeNull();
        expect(result.bytes).toBe(2 * MiB);
        expect(result.data.equals(bytes.subarray(0, 2 * MiB))).toBe(true);
        expect(revocation).toMatchObject({outcome: 'revoked', transfers: 3, leases: 2});
        expect(await leaseOf(stored.id)).toMatchObject({state: 'released'});
        expect(await leaseOf(second.id)).toMatchObject({state: 'released'});
        expect(await count(`select count(*) as n from artifacts.transfer_handles where account_id = $1 and ended_at is null`, [who.accountId])).toBe(0);
        expect(await count(`select count(*) as n from artifacts.transfer_handles where account_id = $1 and ended_at is not null`, [who.accountId])).toBe(3);
      },
    );
  });

  it('refuses an upload in flight when its key is revoked: 403, the object removed, the lease released', async () => {
    const key = throwawaySigner();
    const who = await member();
    await withGateway(
      {
        keys: {active: key.label},
        hooks: {
          beforeChunk: async (chunk) => {
            if (chunk.direction === 'upload' && chunk.index === 2) await revokeServiceKey({issuer: 'application', kid: key.signer.kid, reason: 'compromise'}, {env});
          },
        },
      },
      async (g) => {
        const result = await upload(who, pngBytes(6 * MiB), {g});
        expect(result.response.status).toBe(403);
        expect(await objectOf(staging(who.accountId, result.id))).toBeNull();
        expect(await leaseOf(result.id)).toMatchObject({state: 'released'});
      },
    );
  });
});

// =====================================================================================================================================================
describe('downloads: whole, by range, in chunks of at most 1 MiB, each checked live', () => {
  it('serves a file whole with the headers of a private download: no-store, nosniff, attachment, an ETag that is its digest, ranges accepted, no storage URL', async () => {
    const who = await member();
    const bytes = randomBytes(3 * MiB + 321);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    const response = await download(who, stored.id);
    expect(response.status).toBe(200);
    const headers = Object.fromEntries(response.headers.entries());
    expect(headers).toMatchObject({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
      'content-length': String(bytes.length),
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment',
      etag: `"${sha256(bytes)}"`,
    });
    expect(headers.location).toBeUndefined();
    expect(headers['set-cookie']).toBeUndefined();
    const s3 = s3Of(localStack());
    const text = JSON.stringify(headers);
    for (const forbidden of ['X-Amz', 'x-amz', 'storage/v1', s3.accessKeyId, s3.secretAccessKey, new URL(s3.endpoint).host, 'private-files']) expect(text, forbidden).not.toContain(forbidden);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(bytes)).toBe(true);
  });

  it('serves a picture with its own content type', async () => {
    const who = await member();
    const bytes = jpegBytes(70_000);
    const stored = await uploaded(who, bytes, {ct: 'image/jpeg'});
    const response = await download(who, stored.id);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('serves one range of every shape, 206 with Content-Range, the bytes of exactly that slice (across chunk boundaries too)', async () => {
    const who = await member();
    const bytes = randomBytes(3 * MiB + 321);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    const total = bytes.length;
    for (const [range, start, end] of [
      ['bytes=10-99', 10, 99],
      ['bytes=0-0', 0, 0],
      ['bytes=100-', 100, total - 1],
      ['bytes=-100', total - 100, total - 1],
      [`bytes=-${total + 5000}`, 0, total - 1],
      ['bytes=0-999999999999', 0, total - 1],
      [`bytes=${MiB - 10}-${MiB + 10}`, MiB - 10, MiB + 10],
      [`bytes=${MiB}-${2 * MiB - 1}`, MiB, 2 * MiB - 1],
      [`bytes=${total - 1}-${total - 1}`, total - 1, total - 1],
    ] as [string, number, number][]) {
      const response = await download(who, stored.id, {range});
      expect(response.status, range).toBe(206);
      expect(response.headers.get('content-range'), range).toBe(`bytes ${start}-${end}/${total}`);
      expect(response.headers.get('content-length'), range).toBe(String(end - start + 1));
      expect(response.headers.get('cache-control'), range).toBe('no-store');
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.equals(bytes.subarray(start, end + 1)), range).toBe(true);
    }
  });

  it('answers 416 with the object\'s size for several ranges, a range that cannot be read and one past the end, and sends no byte', async () => {
    const who = await member();
    const bytes = randomBytes(2 * MiB);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    for (const range of ['bytes=0-1,5-6', 'bytes=abc', 'bytes=-', 'bytes=5-1', 'bytes=-0', `bytes=${bytes.length}-`, 'bytes=99999999999-', 'items=0-1', 'bytes=0-1, 4-5', 'bytes=1-2-3']) {
      const response = await download(who, stored.id, {range});
      expect(response.status, range).toBe(416);
      expect(response.headers.get('content-range'), range).toBe(`bytes */${bytes.length}`);
      expect(await response.json(), range).toEqual(errorBody('range_not_satisfiable'));
    }
  });

  it('cuts a download into chunks of at most 1 MiB and reads the session and the target live before EACH: the same number of reads as chunks, in order', async () => {
    const who = await member();
    const bytes = randomBytes(5 * MiB);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    probe.reset();
    const response = await download(who, stored.id);
    const result = await readAll(response);
    expect(result.error).toBeNull();
    expect(result.data.equals(bytes)).toBe(true);
    // One read before the headers (does this Account still own a lease it may read?), then for each of the five chunks: the hook, a read of the
    // session grant through the handle, a read of the lease. Nothing is remembered between two of them.
    expect(probe.events).toEqual(['authorize', 'resolve', ...Array.from({length: 5}, (_unused, index) => [`chunk:download:${index}`, 'authorize', 'resolve']).flat()]);
    expect(probe.authorizeCalls).toBe(6);
  });

  it('is the same for a range: a range of 2.5 MiB is three chunks, each checked', async () => {
    const who = await member();
    const bytes = randomBytes(6 * MiB);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    probe.reset();
    const response = await download(who, stored.id, {range: `bytes=${MiB / 2}-${3 * MiB - 1}`});
    expect(response.status).toBe(206);
    const result = await readAll(response);
    expect(result.data.equals(bytes.subarray(MiB / 2, 3 * MiB))).toBe(true);
    expect(probe.events.filter((event) => event.startsWith('chunk:download:'))).toEqual(['chunk:download:0', 'chunk:download:1', 'chunk:download:2']);
    expect(probe.authorizeCalls).toBe(4);
  });

  it('serves a 100 MiB file whole, chunk by chunk, with every byte right', async () => {
    const who = await member();
    const bytes = randomBytes(100 * MiB);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    probe.reset();
    const response = await download(who, stored.id);
    const hash = createHash('sha256');
    let received = 0;
    for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(part);
      received += part.length;
    }
    expect(received).toBe(100 * MiB);
    expect(hash.digest('hex')).toBe(sha256(bytes));
    expect(probe.events.filter((event) => event.startsWith('chunk:download:'))).toHaveLength(100);
    expect(probe.authorizeCalls).toBe(101);
  }, 60_000);

  it('does not serve a file that is not complete (an upload still receiving) or whose lease expired', async () => {
    const who = await member();
    const stored = await uploaded(who, pngBytes(MiB));
    await db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [stored.id]);
    const expired = await download(who, stored.id);
    expect(expired.status).toBe(404);
    await db.query(`update artifacts.staging_leases set expires_at = now() + interval '1 day' where id = $1`, [stored.id]);
    expect((await download(who, stored.id)).status).toBe(200);
    const receiving = await prefill(who.accountId, MiB, 'receiving');
    expect((await download(who, receiving)).status).toBe(404);
    const released = await prefill(who.accountId, MiB, 'released');
    expect((await download(who, released)).status).toBe(404);
  });

  it('answers 404 for a file that is not in the bucket although its lease says it is', async () => {
    const who = await member();
    const lease = await prefill(who.accountId, MiB, 'complete');
    const response = await download(who, lease);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(errorBody('not_found'));
  });
});

// =====================================================================================================================================================
describe('access that ends in the middle of a transfer: the next chunk is not sent, what was sent stands', () => {
  type Revocation = [string, (who: Member) => Promise<unknown>];
  const revocations: Revocation[] = [
    ['the Account is disabled', (who) => disableAccount({accountId: who.accountId, actor}, {env})],
    ['the Account is deleted (a tombstone)', (who) => recordTombstone({kind: 'account', id: who.accountId}, {env})],
    ['the session grant is revoked', (who) => revokeSessionGrant({sessionId: who.sessionId, userId: who.userId, actor, reason: 'sign_out'}, {env})],
    ['the authorization epoch is raised', (who) => raiseAuthorizationEpoch({accountId: who.accountId, actor}, {env})],
    ['the Auth session is gone', async (who) => void (await db.query('delete from auth.sessions where id = $1', [who.sessionId]))],
  ];

  it.each(revocations)('a download: when %s before the fourth chunk, exactly 3 MiB arrive and then the stream is closed', async (_label, revoke) => {
    const who = await member();
    const bytes = randomBytes(8 * MiB);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    probe.reset();
    probe.onChunk = async (chunk) => {
      if (chunk.direction === 'download' && chunk.index === 3) await revoke(who);
    };
    const response = await download(who, stored.id);
    expect(response.status).toBe(200);
    const result = await readAll(response);
    expect(result.error, 'the stream ends with an error, not as a whole').not.toBeNull();
    expect(result.bytes).toBe(3 * MiB);
    expect(result.data.equals(bytes.subarray(0, 3 * MiB))).toBe(true);
    // The fourth chunk was asked about, refused, and nothing was asked after that.
    expect(probe.events.filter((event) => event.startsWith('chunk:download:'))).toEqual(['chunk:download:0', 'chunk:download:1', 'chunk:download:2', 'chunk:download:3']);
  });

  it.each(revocations)('an upload: when %s before the third chunk, it is refused 403 and its object is removed and its lease released', async (_label, revoke) => {
    const who = await member();
    probe.reset();
    probe.onChunk = async (chunk) => {
      if (chunk.direction === 'upload' && chunk.index === 2) await revoke(who);
    };
    const result = await upload(who, pngBytes(6 * MiB));
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual(errorBody('forbidden'));
    expect(await objectOf(staging(who.accountId, result.id))).toBeNull();
    expect(await leaseOf(result.id)).toMatchObject({state: 'released'});
    expect(probe.events.filter((event) => event.startsWith('chunk:upload:'))).toEqual(['chunk:upload:0', 'chunk:upload:1', 'chunk:upload:2']);
  });

  it('a download of a deleted target: when the lease is released between two chunks the stream closes', async () => {
    const who = await member();
    const bytes = randomBytes(6 * MiB);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    probe.reset();
    probe.onChunk = async (chunk) => {
      if (chunk.direction === 'download' && chunk.index === 2) await db.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [stored.id]);
    };
    const result = await readAll(await download(who, stored.id));
    expect(result.error).not.toBeNull();
    expect(result.bytes).toBe(2 * MiB);
  });

  it('a download whose lease runs out between two chunks closes too (the resolver reads the expiry)', async () => {
    const who = await member();
    const stored = await uploaded(who, randomBytes(5 * MiB), {cls: 'file'});
    probe.reset();
    probe.onChunk = async (chunk) => {
      if (chunk.direction === 'download' && chunk.index === 4) await db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 second' where id = $1`, [stored.id]);
    };
    const result = await readAll(await download(who, stored.id));
    expect(result.error).not.toBeNull();
    expect(result.bytes).toBe(4 * MiB);
  });

  it('a client that goes away mid-download: the gateway stops reading and sending, and serves the next client', async () => {
    const who = await member();
    const stored = await uploaded(who, randomBytes(40 * MiB), {cls: 'file'});
    probe.reset();
    const controller = new AbortController();
    const ticket = await downloadTicket(who, stored.id);
    const response = await fetch(`${gateway.url}/v1/files/staging/${stored.id}`, {headers: {authorization: `Ticket ${ticket}`}, signal: controller.signal});
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.read().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const asked = probe.events.filter((event) => event.startsWith('chunk:download:')).length;
    // Not all forty: the stream stopped when the socket closed (what the kernel had taken is a few MiB at most).
    expect(asked).toBeLessThan(40);
    const settled = probe.events.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(probe.events.length, 'nothing more is read after the client is gone').toBe(settled);
    expect((await download(who, stored.id, {range: 'bytes=0-9'})).status).toBe(206);
  });

  it('an upload whose client goes away mid-body: the object is aborted and the lease released', async () => {
    const who = await member();
    const bytes = pngBytes(10 * MiB);
    const id = randomUUID();
    const ticket = await ticketFor(gateway, who, uploadClaims(id, bytes));
    const body = (async function* () {
      for (let at = 0; at < bytes.length; at += 512 * 1024) yield bytes.subarray(at, at + 512 * 1024);
    })();
    const result = await raw(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes), body, abortAfterBytes: 3 * MiB});
    expect(result.status).toBe(0);
    const lease = await waitFor(() => leaseOf(id), (row) => row?.state === 'released');
    expect(lease).toMatchObject({state: 'released'});
    expect(await objectOf(staging(who.accountId, id))).toBeNull();
  });
});

// =====================================================================================================================================================
describe('a database that does not answer stops a transfer, and is never read as "allowed"', () => {
  it('before the first byte: 503 with a Retry-After, no byte sent, and the next request asks again', async () => {
    const who = await member();
    const stored = await uploaded(who, randomBytes(3 * MiB), {cls: 'file'});
    probe.reset();
    probe.failAuthorizeFrom = 1;
    const down = await download(who, stored.id);
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('5');
    expect(await down.json()).toEqual(errorBody('unavailable'));
    expect(probe.authorizeCalls).toBe(1);
    probe.reset();
    const again = await download(who, stored.id);
    expect(again.status).toBe(200);
    expect(probe.authorizeCalls).toBeGreaterThan(1);
  });

  it('after n chunks: the stream is closed, the chunk that could not be authorized is not sent, and nothing is cached: every chunk before it asked', async () => {
    const who = await member();
    const bytes = randomBytes(6 * MiB);
    const stored = await uploaded(who, bytes, {cls: 'file'});
    probe.reset();
    // 1 (before the headers) + 3 (chunks 0, 1, 2) answered; the 5th read, the one for chunk 3, does not.
    probe.failAuthorizeFrom = 5;
    const result = await readAll(await download(who, stored.id));
    expect(result.error).not.toBeNull();
    expect(result.bytes).toBe(3 * MiB);
    expect(result.data.equals(bytes.subarray(0, 3 * MiB))).toBe(true);
    expect(probe.authorizeCalls).toBe(5);
    expect(probe.events.filter((event) => event.startsWith('authorize'))).toHaveLength(5);
  });

  it('is the same when the lease cannot be read (the resolver\'s query fails): 503 before bytes, a closed stream after', async () => {
    const who = await member();
    const stored = await uploaded(who, randomBytes(3 * MiB), {cls: 'file'});
    probe.reset();
    probe.failQuery = true;
    expect((await download(who, stored.id)).status).toBe(503);
    probe.reset();
    let queries = 0;
    probe.onChunk = (chunk) => {
      if (chunk.index === 1) probe.failQuery = true;
      queries += 1;
    };
    const result = await readAll(await download(who, stored.id));
    expect(result.error).not.toBeNull();
    expect(result.bytes).toBe(MiB);
    expect(queries).toBe(2);
  });

  it('is the same for an upload: refused 503, no object, the lease released', async () => {
    const who = await member();
    probe.reset();
    probe.failAuthorizeFrom = 3;
    const result = await upload(who, pngBytes(5 * MiB));
    expect(result.response.status).toBe(503);
    expect(await objectOf(staging(who.accountId, result.id))).toBeNull();
    expect(await leaseOf(result.id)).toMatchObject({state: 'released'});
  });

  it('refuses a ticket 503 when the session\'s authority cannot be read (not 401: the ticket may be fine) and spends nothing', async () => {
    const who = await member();
    const bytes = pngBytes(5000);
    probe.reset();
    probe.failAuthority = true;
    const jti = newJti();
    const id = randomUUID();
    const ticket = await ticketFor(gateway, who, uploadClaims(id, bytes), {jti});
    const response = await fetch(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes), body: asBody(bytes)});
    expect(response.status).toBe(503);
    expect(await count('select count(*) as n from artifacts.ticket_redemptions where jti = $1', [jti])).toBe(0);
    probe.reset();
    expect((await fetch(`${gateway.url}/v1/uploads/${id}`, {method: 'PUT', headers: uploadHeaders(ticket, bytes), body: asBody(bytes)})).status).toBe(201);
  });
});

// =====================================================================================================================================================
describe('a browser-native download: a ticket in a URL, then a handle in another', () => {
  async function opened(who: Member, bytes: Buffer, options: {g?: Gateway} = {}) {
    const g = options.g ?? gateway;
    const stored = await uploaded(who, bytes, {g, cls: 'file'});
    const ticket = await downloadTicket(who, stored.id, {g});
    const response = await fetch(`${g.url}/d/${ticket}`, {redirect: 'manual'});
    return {g, stored, ticket, response};
  }
  const handleOf = (location: string) => {
    const match = /^\/h\/([A-Za-z0-9_-]{43})\/([0-9a-f-]{36})$/.exec(location);
    expect(match, location).not.toBeNull();
    handlesSeen.push(match![1]);
    return {handle: match![1], id: match![2]};
  };

  it('answers 303 to /h/<handle>/<target id>, no-referrer and no-store, with no ticket and no storage URL in the redirect', async () => {
    const who = await member();
    const bytes = randomBytes(2 * MiB);
    const {stored, ticket, response} = await opened(who, bytes);
    expect(response.status).toBe(303);
    const location = response.headers.get('location')!;
    const {handle, id} = handleOf(location);
    expect(id).toBe(stored.id);
    expect(location).not.toContain(ticket);
    expect(location).not.toContain(who.accountId);
    expect(location).not.toContain('X-Amz');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(handle).toHaveLength(43);

    const followed = await fetch(`${gateway.url}${location}`);
    expect(followed.status).toBe(200);
    expect(followed.headers.get('referrer-policy')).toBe('no-referrer');
    expect(followed.headers.get('cache-control')).toBe('no-store');
    expect(followed.headers.get('content-disposition')).toBe('attachment');
    expect(Buffer.from(await followed.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('serves ranges and the browser\'s own resume (Range with If-Range) for its own target, again and again within its lifetime', async () => {
    const who = await member();
    const bytes = randomBytes(3 * MiB);
    const {stored, response} = await opened(who, bytes);
    const location = response.headers.get('location')!;
    const etag = `"${sha256(bytes)}"`;
    for (const [range, start, end] of [['bytes=0-99', 0, 99], [`bytes=${MiB - 5}-${MiB + 5}`, MiB - 5, MiB + 5], ['bytes=-1000', bytes.length - 1000, bytes.length - 1]] as [string, number, number][]) {
      const part = await fetch(`${gateway.url}${location}`, {headers: {range}});
      expect(part.status, range).toBe(206);
      expect(Buffer.from(await part.arrayBuffer()).equals(bytes.subarray(start, end + 1)), range).toBe(true);
    }
    // A resume after 1,000,000 bytes arrived: the same version of the file, so the rest is served as a range.
    const resume = await fetch(`${gateway.url}${location}`, {headers: {range: 'bytes=1000000-', 'if-range': etag}});
    expect(resume.status).toBe(206);
    expect(resume.headers.get('content-range')).toBe(`bytes 1000000-${bytes.length - 1}/${bytes.length}`);
    expect(Buffer.from(await resume.arrayBuffer()).equals(bytes.subarray(1_000_000))).toBe(true);
    // ... and a file that is not the one the browser started with is sent whole.
    const changed = await fetch(`${gateway.url}${location}`, {headers: {range: 'bytes=1000000-', 'if-range': '"another-version"'}});
    expect(changed.status).toBe(200);
    expect(Buffer.from(await changed.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await fetch(`${gateway.url}${location}`, {headers: {range: 'bytes=0-1,3-4'}})).status).toBe(416);
    expect(handleOf(location).id).toBe(stored.id);
  });

  it('checks the session and the lease before every chunk of a handle\'s download too', async () => {
    const who = await member();
    const bytes = randomBytes(4 * MiB);
    const {response} = await opened(who, bytes);
    const location = response.headers.get('location')!;
    probe.reset();
    const followed = await fetch(`${gateway.url}${location}`);
    expect((await readAll(followed)).bytes).toBe(4 * MiB);
    // The handle itself is read (to learn what it is for), then the same read as every other download: before the headers and before each chunk.
    expect(probe.authorizeCalls).toBe(1 + 1 + 4);
    expect(probe.events.filter((event) => event.startsWith('chunk:'))).toHaveLength(4);
  });

  it('is single-use at its door: the ticket in the URL is refused the second time (401), and the handle URL keeps working', async () => {
    const who = await member();
    const {g, ticket, response} = await opened(who, randomBytes(MiB));
    const replay = await fetch(`${g.url}/d/${ticket}`, {redirect: 'manual'});
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual(errorBody('invalid_ticket'));
    expect((await fetch(`${g.url}${response.headers.get('location')}`)).status).toBe(200);
  });

  it('is refused for a ticket that is for an upload, a file that is not there, a foreign file, and a key with no resolver', async () => {
    const who = await member();
    const other = await member();
    const stored = await uploaded(who, pngBytes(MiB));
    const upload = await ticketFor(gateway, who, uploadClaims(randomUUID(), pngBytes(10)));
    expect((await fetch(`${gateway.url}/d/${upload}`, {redirect: 'manual'})).status).toBe(401);
    const missing = await ticketFor(gateway, who, {dir: 'download', tid: randomUUID()});
    expect((await fetch(`${gateway.url}/d/${missing}`, {redirect: 'manual'})).status).toBe(404);
    const foreign = await ticketFor(gateway, other, {dir: 'download', tid: stored.id});
    expect((await fetch(`${gateway.url}/d/${foreign}`, {redirect: 'manual'})).status).toBe(404);
    const unknown = await ticketFor(gateway, who, {dir: 'download', tid: stored.id, tk: 'project'});
    expect((await fetch(`${gateway.url}/d/${unknown}`, {redirect: 'manual'})).status).toBe(400);
  });

  it('is refused for another target than the handle\'s, for a malformed handle, and for a handle nobody was given', async () => {
    const who = await member();
    const {stored, response} = await opened(who, randomBytes(MiB));
    const {handle} = handleOf(response.headers.get('location')!);
    // (The tampered handle changes the last character, to a letter it is not already: the last character of a 43-character base64url handle is one of 16 letters, and 'A' is one of them,
    // so tampering with an 'A' → 'A' made the REAL handle one time in sixteen, and this case failed with a 200 that was no fault of the gateway's.)
    for (const path of [`/h/${handle}/${randomUUID()}`, `/h/${handle.slice(0, 42)}${handle.endsWith('A') ? 'E' : 'A'}/${stored.id}`, `/h/${randomBytes(32).toString('base64url')}/${stored.id}`, `/h/${handle.slice(1)}/${stored.id}`]) {
      const refused = await fetch(`${gateway.url}${path}`);
      expect([403, 404], path).toContain(refused.status);
      if (refused.status === 403) expect(await refused.json()).toEqual(errorBody('forbidden'));
    }
    expect((await fetch(`${gateway.url}/h/${handle}/${stored.id}`)).status).toBe(200);
  });

  it('is refused for a handle that was opened to UPLOAD (the direction is part of what a handle is for)', async () => {
    const who = await member();
    const stored = await uploaded(who, pngBytes(MiB));
    const epoch = await epochOf(db, who.accountId);
    const make = async (direction: 'upload' | 'download') => {
      const bytes = randomBytes(32);
      const jti = newJti();
      await db.query(
        `insert into artifacts.ticket_redemptions (jti, typ, issuer, kid, account_id, session_id, direction, target_kind, target_id, expires_at)
         values ($1, 'ticket', 'application', 'test-owner', $2, $3, $4, 'staging', $5, now() + interval '5 minutes')`,
        [jti, who.accountId, who.sessionId, direction, stored.id],
      );
      await db.query(
        `insert into artifacts.transfer_handles (hash, jti, session_id, account_id, epoch, direction, target_kind, target_id, kid, expires_at)
         values ($1, $2, $3, $4, $5, $6, 'staging', $7, 'test-owner', now() + interval '10 minutes')`,
        [createHash('sha256').update(bytes).digest(), jti, who.sessionId, who.accountId, epoch, direction, stored.id],
      );
      handlesSeen.push(bytes.toString('base64url'));
      return bytes.toString('base64url');
    };
    const uploadHandle = await make('upload');
    const refused = await fetch(`${gateway.url}/h/${uploadHandle}/${stored.id}`);
    expect(refused.status).toBe(403);
    // The control: the same row for a download is served, so the refusal is the direction and nothing else.
    const downloadHandle = await make('download');
    expect((await fetch(`${gateway.url}/h/${downloadHandle}/${stored.id}`)).status).toBe(200);
  });

  it('is refused once its session grant is revoked, and once its Account is disabled', async () => {
    for (const revoke of [
      (who: Member) => revokeSessionGrant({sessionId: who.sessionId, userId: who.userId, actor, reason: 'sign_out'}, {env}),
      (who: Member) => disableAccount({accountId: who.accountId, actor}, {env}),
    ]) {
      const who = await member();
      const {response} = await opened(who, randomBytes(MiB));
      const location = response.headers.get('location')!;
      expect((await fetch(`${gateway.url}${location}`)).status).toBe(200);
      await revoke(who);
      const after = await fetch(`${gateway.url}${location}`);
      expect(after.status).toBe(403);
      expect(await after.json()).toEqual(errorBody('forbidden'));
      expect((await fetch(`${gateway.url}${location}`, {headers: {range: 'bytes=0-9'}})).status).toBe(403);
    }
  });

  it('lasts 30 minutes and not a minute more (the gateway\'s clock is moved: 29 minutes serves, 31 refuses), and the row says so', async () => {
    const who = await member();
    const {stored, response} = await opened(who, randomBytes(MiB));
    const location = response.headers.get('location')!;
    const {handle} = handleOf(location);
    const row = (await db.query('select * from artifacts.transfer_handles where account_id = $1 and target_id = $2 order by created_at desc limit 1', [who.accountId, stored.id])).rows[0];
    expect((row.expires_at.getTime() - row.created_at.getTime()) / 60_000).toBeLessThanOrEqual(30);
    expect((row.expires_at.getTime() - row.created_at.getTime()) / 60_000).toBeGreaterThan(29.9);
    try {
      clockOffsetMs = 29 * 60_000;
      expect((await fetch(`${gateway.url}${location}`, {headers: {range: 'bytes=0-9'}})).status).toBe(206);
      clockOffsetMs = 31 * 60_000;
      const late = await fetch(`${gateway.url}${location}`, {headers: {range: 'bytes=0-9'}});
      expect(late.status).toBe(403);
      expect((await fetch(`${gateway.url}${location}`)).status).toBe(403);
    } finally {
      clockOffsetMs = 0;
    }
    expect((await fetch(`${gateway.url}/h/${handle}/${stored.id}`)).status).toBe(200);
  });

  it('holds only a hash: the handle itself is in no column of the database, and the hash is the SHA-256 of its 32 bytes', async () => {
    const who = await member();
    const {stored, response} = await opened(who, randomBytes(MiB));
    const {handle} = handleOf(response.headers.get('location')!);
    const rows = (await db.query('select * from artifacts.transfer_handles where account_id = $1', [who.accountId])).rows;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const bytes = Buffer.from(handle, 'base64url');
    expect(bytes).toHaveLength(32);
    const text = JSON.stringify(rows.map((row) => ({...row, hash: row.hash.toString('hex')})));
    for (const secret of [handle, bytes.toString('hex'), bytes.toString('base64')]) expect(text).not.toContain(secret);
    const mine = rows.find((row) => row.target_id === stored.id && Buffer.compare(row.hash, createHash('sha256').update(bytes).digest()) === 0);
    expect(mine, 'a row whose hash is the SHA-256 of the handle').toBeDefined();
    expect(mine).toMatchObject({direction: 'download', target_kind: 'staging', account_id: who.accountId, session_id: who.sessionId, ended_at: null});
    // Every handle ever opened here is at most 30 minutes (the database refuses more), and every redemption row carries the key and the expiry.
    const wide = await count(`select count(*) as n from artifacts.transfer_handles where account_id = $1 and expires_at > created_at + interval '30 minutes'`, [who.accountId]);
    expect(wide).toBe(0);
    const redemptions = (await db.query('select * from artifacts.ticket_redemptions where account_id = $1', [who.accountId])).rows;
    for (const row of redemptions) expect(row).toMatchObject({typ: 'ticket', issuer: 'application', kid: gateway.signer.kid, session_id: who.sessionId});
  });
});

// =====================================================================================================================================================
describe('cross-origin calls: the application\'s origin and nobody else\'s', () => {
  const id = randomUUID();
  const preflight = (origin: string | undefined, path = `/v1/uploads/${id}`) =>
    raw(`${gateway.url}${path}`, {method: 'OPTIONS', headers: {...(origin === undefined ? {} : {origin}), 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type,x-content-sha256'}});

  it('answers a preflight from APP_ORIGIN with that origin, Vary: Origin, the methods and headers an upload and a download use, no wildcard and no credentials', async () => {
    for (const path of [`/v1/uploads/${id}`, `/v1/files/staging/${id}`]) {
      const result = await preflight(appOrigin, path);
      expect(result.status, path).toBe(204);
      expect(result.headers['access-control-allow-origin']).toBe(appOrigin);
      expect(result.headers['vary']).toContain('Origin');
      expect(result.headers['access-control-allow-methods']).toBe('GET, PUT, OPTIONS');
      for (const header of ['authorization', 'content-type', 'x-content-sha256', 'range', 'if-range']) expect(result.headers['access-control-allow-headers']).toContain(header);
      expect(result.headers['access-control-allow-credentials']).toBeUndefined();
      expect(JSON.stringify(result.headers)).not.toContain('"*"');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['set-cookie']).toBeUndefined();
    }
  });

  it('refuses any other Origin with 403 on every route, a look-alike, another port, a trailing slash and `null` included', async () => {
    const other = ['https://evil.example', 'null', 'http://127.0.0.1:4174', 'http://localhost:4173', `${appOrigin}/`, `${appOrigin}.evil.example`, 'https://127.0.0.1:4173', '*'];
    for (const origin of other) {
      for (const [method, path] of [['OPTIONS', `/v1/uploads/${id}`], ['GET', '/healthz'], ['PUT', `/v1/uploads/${id}`], ['GET', `/v1/files/staging/${id}`], ['POST', '/v1/commands']] as [string, string][]) {
        const result = await raw(`${gateway.url}${path}`, {method, headers: {origin}});
        expect(result.status, `${method} ${path} from ${origin}`).toBe(403);
        expect(JSON.parse(result.body)).toEqual(errorBody('forbidden_origin'));
        expect(result.headers['access-control-allow-origin'], `${method} ${path} from ${origin}`).toBeUndefined();
      }
    }
    // A preflight with no Origin is not a preflight.
    expect((await preflight(undefined)).status).toBe(405);
  });

  it('carries the allowed origin on a real upload and download from the application\'s origin, and sends no cookie either way', async () => {
    const who = await member();
    const bytes = pngBytes(100_000);
    const stored = id2();
    const ticket = await ticketFor(gateway, who, uploadClaims(stored, bytes));
    const put = await raw(`${gateway.url}/v1/uploads/${stored}`, {method: 'PUT', headers: {...uploadHeaders(ticket, bytes), origin: appOrigin}, body: bytes});
    expect(put.status).toBe(201);
    expect(put.headers['access-control-allow-origin']).toBe(appOrigin);
    expect(put.headers['vary']).toContain('Origin');
    expect(put.headers['access-control-expose-headers']).toContain('content-range');
    expect(put.headers['access-control-allow-credentials']).toBeUndefined();
    expect(put.headers['set-cookie']).toBeUndefined();
    const read = await downloadTicket(who, stored);
    const get = await raw(`${gateway.url}/v1/files/staging/${stored}`, {headers: {authorization: `Ticket ${read}`, origin: appOrigin, range: 'bytes=0-9'}});
    expect(get.status).toBe(206);
    expect(get.headers['access-control-allow-origin']).toBe(appOrigin);
    expect(get.headers['access-control-expose-headers']).toContain('etag');
    // Without an Origin there is no allow-origin header at all, and the response still varies on it.
    const plain = await raw(`${gateway.url}/healthz`);
    expect(plain.headers['access-control-allow-origin']).toBeUndefined();
    expect(plain.headers['vary']).toContain('Origin');
  });

  it('refuses a command that carries ANY Origin, the application\'s included, and does nothing', async () => {
    const who = await member();
    const stored = await uploaded(who, pngBytes(MiB));
    await db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 hour' where id = $1`, [stored.id]);
    const token = commandFor(gateway, {cmd: 'delete-staging', acct: who.accountId, uid: stored.id});
    for (const origin of [appOrigin, 'https://evil.example', 'null']) {
      const result = await raw(`${gateway.url}/v1/commands`, {method: 'POST', headers: {authorization: `Command ${token}`, origin}});
      expect(result.status, origin).toBe(403);
      expect(JSON.parse(result.body), origin).toEqual(errorBody('forbidden_origin'));
    }
    expect(await objectOf(staging(who.accountId, stored.id))).not.toBeNull();
    expect(await leaseOf(stored.id)).toMatchObject({state: 'complete'});
    // The command was not even redeemed: sent from a server it still works, once.
    const sent = await raw(`${gateway.url}/v1/commands`, {method: 'POST', headers: {authorization: `Command ${token}`}});
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toEqual({outcome: 'deleted'});
  });
});
const id2 = () => randomUUID();

// =====================================================================================================================================================
describe('commands: only the application signs them, and each runs once', () => {
  const post = (token: string | null, scheme = 'Command', headers: Record<string, string> = {}) =>
    raw(`${gateway.url}/v1/commands`, {method: 'POST', headers: {...(token === null ? {} : {authorization: `${scheme} ${token}`}), ...headers}});

  async function attachable(who: Member, bytes: Buffer = pngBytes(2 * MiB)) {
    const stored = await uploaded(who, bytes);
    return {...stored, epoch: await epochOf(db, who.accountId)};
  }

  const manifestOf = async (id: string) => (await db.query('select * from artifacts.manifests where upload_id = $1', [id])).rows;

  describe('attach', () => {
    it('copies the verified object to objects/<account>/<root>, writes the manifest with its canonical body and SHA-256 root, and marks the lease attached', async () => {
      const who = await member();
      const bytes = pngBytes(3 * MiB + 5);
      const stored = await attachable(who, bytes);
      const result = await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch: stored.epoch, uid: stored.id, tr: 'none'}));
      expect(result.status, result.body).toBe(200);
      const answer = JSON.parse(result.body);
      const body = {id: stored.id, scope: who.accountId, activity: 'upload:none', kind: 'picture', digest: sha256(bytes), length: bytes.length, serialization: 1, children: []};
      const text = canonicalize(body);
      expect(answer).toEqual({outcome: 'published', manifest: {id: stored.id, root: sha256(text), digest: sha256(bytes), length: bytes.length, kind: 'picture'}});
      // The object is stored under the manifest's ROOT (the spec's amendment), not under its content digest: the one key is this manifest's own.
      const root = sha256(text);
      expect(root).not.toBe(sha256(bytes));
      expect(sha256((await objectOf(objectKey(who.accountId, root)))!)).toBe(sha256(bytes));
      expect(await objectOf(objectKey(who.accountId, sha256(bytes)))).toBeNull();
      expect(await objectsOf(who.accountId)).toEqual([objectKey(who.accountId, root)]);

      const [row, ...more] = await manifestOf(stored.id);
      expect(more).toEqual([]);
      expect(row).toMatchObject({root: sha256(text), id: stored.id, account_id: who.accountId, upload_id: stored.id, kind: 'picture', digest: sha256(bytes), length: String(bytes.length), serialization: 1, activity: 'upload:none'});
      expect(row.body).toBe(text);
      expect(sha256(Buffer.from(row.body, 'utf8'))).toBe(row.root);
      expect(JSON.parse(row.body)).toEqual(body);
      expect(await leaseOf(stored.id)).toMatchObject({state: 'attached'});
      // The staged copy stays until the cleanup removes it (and can still be read until then).
      expect((await download(who, stored.id)).status).toBe(200);
    });

    it('returns the same manifest for a repeat and writes nothing new', async () => {
      const who = await member();
      const stored = await attachable(who);
      const claims = {cmd: 'attach' as const, acct: who.accountId, epoch: stored.epoch, uid: stored.id, tr: 'none'};
      const first = JSON.parse((await post(commandFor(gateway, claims))).body);
      const again = await post(commandFor(gateway, claims));
      expect(again.status).toBe(200);
      const repeated = JSON.parse(again.body);
      expect(repeated).toEqual({...first, outcome: 'exists'});
      expect(await manifestOf(stored.id)).toHaveLength(1);
      expect(await count('select count(*) as n from artifacts.manifests where account_id = $1', [who.accountId])).toBe(1);
      // The repeat leaves the object alone: the one key is still there, and it still holds the bytes.
      expect(await objectsOf(who.accountId)).toEqual([objectKey(who.accountId, first.manifest.root)]);
      expect(sha256((await objectOf(objectKey(who.accountId, first.manifest.root)))!)).toBe((await leaseOf(stored.id))!.sha256);
    });

    it('attach then delete-root with the returned root deletes that object, and a second delete-root is harmless', async () => {
      const who = await member();
      const bytes = pngBytes(MiB + 3);
      const stored = await attachable(who, bytes);
      const attached = JSON.parse((await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch: stored.epoch, uid: stored.id, tr: 'none'}))).body);
      const root: string = attached.manifest.root;
      expect(await objectsOf(who.accountId)).toEqual([objectKey(who.accountId, root)]);
      const first = await post(commandFor(gateway, {cmd: 'delete-root', acct: who.accountId, root}));
      expect([first.status, JSON.parse(first.body)]).toEqual([200, {outcome: 'deleted'}]);
      expect(await objectsOf(who.accountId)).toEqual([]);
      const second = await post(commandFor(gateway, {cmd: 'delete-root', acct: who.accountId, root}));
      expect([second.status, JSON.parse(second.body)]).toEqual([200, {outcome: 'deleted'}]);
      expect(await objectsOf(who.accountId)).toEqual([]);
      // The manifest is immutable and stays (purging the tables is an Epic 8 step); the staged copy stays until the cleanup.
      expect(await manifestOf(stored.id)).toHaveLength(1);
      expect(await objectOf(staging(who.accountId, stored.id))).not.toBeNull();
    });

    it('gives two uploads of identical bytes two keys: deleting one root leaves the other upload\'s object readable', async () => {
      const who = await member();
      const bytes = pngBytes(MiB + 11);
      const one = await attachable(who, bytes);
      const two = await attachable(who, bytes);
      const first = JSON.parse((await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch: one.epoch, uid: one.id, tr: 'none'}))).body);
      const second = JSON.parse((await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch: two.epoch, uid: two.id, tr: 'none'}))).body);
      expect(first.manifest.digest).toBe(second.manifest.digest);
      expect(first.manifest.root).not.toBe(second.manifest.root);
      expect(await objectsOf(who.accountId)).toEqual([objectKey(who.accountId, first.manifest.root), objectKey(who.accountId, second.manifest.root)].sort());
      expect((await post(commandFor(gateway, {cmd: 'delete-root', acct: who.accountId, root: first.manifest.root}))).status).toBe(200);
      expect(await objectOf(objectKey(who.accountId, first.manifest.root))).toBeNull();
      expect(sha256((await objectOf(objectKey(who.accountId, second.manifest.root)))!)).toBe(sha256(bytes));
      expect(await objectsOf(who.accountId)).toEqual([objectKey(who.accountId, second.manifest.root)]);
    });

    it('refuses a transform that is not registered, an upload that is not complete or not there, and another Account\'s upload: nothing is written', async () => {
      const who = await member();
      const other = await member();
      const stored = await attachable(who);
      const epoch = stored.epoch;
      const unregistered = await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch, uid: stored.id, tr: 'strip-metadata'}));
      expect(unregistered.status).toBe(400);
      expect(JSON.parse(unregistered.body)).toEqual(errorBody('unknown_transform'));
      expect(await manifestOf(stored.id)).toEqual([]);
      expect(await leaseOf(stored.id)).toMatchObject({state: 'complete'});

      const receiving = await prefill(who.accountId, MiB, 'receiving');
      const incomplete = await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch, uid: receiving, tr: 'none'}));
      expect(incomplete.status).toBe(409);
      expect(JSON.parse(incomplete.body)).toEqual(errorBody('not_complete'));
      const released = await prefill(who.accountId, MiB, 'released');
      expect((await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch, uid: released, tr: 'none'}))).status).toBe(409);

      const missing = await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch, uid: randomUUID(), tr: 'none'}));
      expect(missing.status).toBe(404);
      const foreign = await post(commandFor(gateway, {cmd: 'attach', acct: other.accountId, epoch: await epochOf(db, other.accountId), uid: stored.id, tr: 'none'}));
      expect(foreign.status).toBe(404);
      for (const id of [stored.id, receiving, released]) expect(await manifestOf(id)).toEqual([]);
      expect(await count('select count(*) as n from artifacts.manifests where account_id = any($1)', [[who.accountId, other.accountId]])).toBe(0);
      expect(await objectOf(objectKey(other.accountId, (await leaseOf(stored.id))!.sha256))).toBeNull();
      expect(await leaseOf(stored.id)).toMatchObject({state: 'complete'});
      // Nothing is left under objects/ by any of the refusals (the copy is taken back, or was never made).
      expect(await objectsOf(who.accountId)).toEqual([]);
      expect(await objectsOf(other.accountId)).toEqual([]);
    });

    it('refuses for a disabled Account, and for an epoch the Account has moved past: 403, no manifest, the lease stays complete', async () => {
      const who = await member();
      const stale = await member();
      const stored = await attachable(who);
      const staleStored = await attachable(stale);
      await raiseAuthorizationEpoch({accountId: stale.accountId, actor}, {env});
      const old = await post(commandFor(gateway, {cmd: 'attach', acct: stale.accountId, epoch: staleStored.epoch, uid: staleStored.id, tr: 'none'}));
      expect(old.status).toBe(403);
      expect(JSON.parse(old.body)).toEqual(errorBody('forbidden'));
      await disableAccount({accountId: who.accountId, actor}, {env});
      const result = await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch: stored.epoch + 1, uid: stored.id, tr: 'none'}));
      expect(result.status).toBe(403);
      for (const id of [stored.id, staleStored.id]) {
        expect(await manifestOf(id)).toEqual([]);
        expect(await leaseOf(id)).toMatchObject({state: 'complete'});
      }
      expect(await objectsOf(who.accountId)).toEqual([]);
      expect(await objectsOf(stale.accountId)).toEqual([]);
    });

    it('is the application\'s client end to end: attach, delete the root and delete the staging through lib/gateway-client against this gateway', async () => {
      const who = await member();
      const bytes = pngBytes(MiB + 9);
      const stored = await attachable(who, bytes);
      const client = createGatewayClient({gateway: gateway.url, instanceId, signer: gateway.signer, keySet: gateway.keySet});
      const attached = await client.attach({accountId: who.accountId, epoch: stored.epoch, uploadId: stored.id, transform: 'none'});
      expect(attached.outcome).toBe('published');
      expect(attached.manifest).toMatchObject({id: stored.id, digest: sha256(bytes), length: bytes.length, kind: 'picture'});
      const root = attached.manifest!.root;
      expect(await objectOf(objectKey(who.accountId, root))).not.toBeNull();
      expect(await client.deleteRoot({accountId: who.accountId, root})).toEqual({outcome: 'deleted'});
      expect(await objectOf(objectKey(who.accountId, root))).toBeNull();
      // A lease that is not expired is kept.
      expect(await client.deleteStaging({accountId: who.accountId, uploadId: stored.id})).toEqual({outcome: 'kept'});
      await db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [stored.id]);
      expect(await client.deleteStaging({accountId: who.accountId, uploadId: stored.id})).toEqual({outcome: 'deleted'});
      expect(await objectOf(staging(who.accountId, stored.id))).toBeNull();
      expect(await leaseOf(stored.id)).toMatchObject({state: 'deleted'});
      // The gateway refuses what the client sends under keys it does not hold, and the client says so by class.
      const stranger = testSigner({active: uniqueLabel('stranger')});
      const foreign = createGatewayClient({gateway: gateway.url, instanceId, signer: stranger.signer, keySet: stranger.keySet});
      await expect(foreign.deleteRoot({accountId: who.accountId, root})).rejects.toBeInstanceOf(GatewayError);
      await expect(createGatewayClient({gateway: 'http://127.0.0.1:1', instanceId, signer: gateway.signer, keySet: gateway.keySet}).deleteRoot({accountId: who.accountId, root})).rejects.toBeInstanceOf(GatewayUnavailableError);
    });
  });

  describe('delete-staging and delete-root', () => {
    it('delete only the exact prefix, only when the lease is expired or released, and leave a sibling upload alone', async () => {
      const who = await member();
      const one = await uploaded(who, pngBytes(MiB));
      const two = await uploaded(who, pngBytes(MiB));
      const three = await uploaded(who, pngBytes(MiB));
      const sibling = sha256((await objectOf(staging(who.accountId, two.id)))!);
      // Not expired and not released: kept, object and all.
      const kept = await post(commandFor(gateway, {cmd: 'delete-staging', acct: who.accountId, uid: one.id}));
      expect([kept.status, JSON.parse(kept.body)]).toEqual([200, {outcome: 'kept'}]);
      expect(await objectOf(staging(who.accountId, one.id))).not.toBeNull();
      expect(await leaseOf(one.id)).toMatchObject({state: 'complete'});
      // Expired: deleted, and only that upload's object.
      await db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 minute' where id = $1`, [one.id]);
      const deleted = await post(commandFor(gateway, {cmd: 'delete-staging', acct: who.accountId, uid: one.id}));
      expect([deleted.status, JSON.parse(deleted.body)]).toEqual([200, {outcome: 'deleted'}]);
      expect(await objectOf(staging(who.accountId, one.id))).toBeNull();
      expect(await leaseOf(one.id)).toMatchObject({state: 'deleted'});
      expect(sha256((await objectOf(staging(who.accountId, two.id)))!)).toBe(sibling);
      expect(await leaseOf(two.id)).toMatchObject({state: 'complete'});
      // Released: deleted at once, however long it has left.
      await db.query(`update artifacts.staging_leases set state = 'released' where id = $1`, [three.id]);
      expect((await post(commandFor(gateway, {cmd: 'delete-staging', acct: who.accountId, uid: three.id}))).status).toBe(200);
      expect(await objectOf(staging(who.accountId, three.id))).toBeNull();
      // Again: nothing left to do, and nothing breaks (a deleted lease is not touched).
      const again = await post(commandFor(gateway, {cmd: 'delete-staging', acct: who.accountId, uid: three.id}));
      expect([again.status, JSON.parse(again.body)]).toEqual([200, {outcome: 'kept'}]);
      expect(sha256((await objectOf(staging(who.accountId, two.id)))!)).toBe(sibling);
    });

    it('delete-staging is the Account\'s own: another Account\'s upload ID with the wrong Account deletes nothing, and an unknown lease deletes nothing', async () => {
      const who = await member();
      const other = await member();
      const stored = await uploaded(who, pngBytes(MiB));
      await db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 hour' where id = $1`, [stored.id]);
      const wrong = await post(commandFor(gateway, {cmd: 'delete-staging', acct: other.accountId, uid: stored.id}));
      expect(JSON.parse(wrong.body)).toEqual({outcome: 'kept'});
      expect(await objectOf(staging(who.accountId, stored.id))).not.toBeNull();
      expect(JSON.parse((await post(commandFor(gateway, {cmd: 'delete-staging', acct: who.accountId, uid: randomUUID()}))).body)).toEqual({outcome: 'kept'});
      expect(await objectOf(staging(who.accountId, stored.id))).not.toBeNull();
    });

    it('delete-root removes objects/<account>/<root> and nothing else: not another Account\'s object of the same name, not the staged copy', async () => {
      const who = await member();
      const other = await member();
      const bytes = pngBytes(MiB);
      const stored = await attachable(who, bytes);
      const attached = JSON.parse((await post(commandFor(gateway, {cmd: 'attach', acct: who.accountId, epoch: stored.epoch, uid: stored.id, tr: 'none'}))).body);
      const root: string = attached.manifest.root;
      expect(await objectOf(objectKey(who.accountId, root))).not.toBeNull();
      // The other Account has an object of the very same name.
      await gateway.storage.put(objectKey(other.accountId, root), (async function* () {
        yield bytes;
      })(), {contentType: 'image/png'});
      const result = await post(commandFor(gateway, {cmd: 'delete-root', acct: who.accountId, root}));
      expect([result.status, JSON.parse(result.body)]).toEqual([200, {outcome: 'deleted'}]);
      expect(await objectOf(objectKey(who.accountId, root))).toBeNull();
      expect(await objectOf(objectKey(other.accountId, root))).not.toBeNull();
      expect(await objectOf(staging(who.accountId, stored.id))).not.toBeNull();
      // Deleting what is not there is not an error.
      expect((await post(commandFor(gateway, {cmd: 'delete-root', acct: who.accountId, root}))).status).toBe(200);
    });

    it('refuses, and deletes nothing, a command that is signed by another key or issuer, is a ticket, is unsigned, is for another environment, has expired, or is replayed', async () => {
      const who = await member();
      const stored = await uploaded(who, pngBytes(MiB));
      await db.query(`update artifacts.staging_leases set expires_at = now() - interval '1 hour' where id = $1`, [stored.id]);
      const claims = {cmd: 'delete-staging' as const, acct: who.accountId, uid: stored.id};
      const stranger = testSigner({active: uniqueLabel('stranger')}).signer;
      const standard = {iss: 'application', aud: 'gateway', env: instanceId, jti: newJti(), iat: nowSeconds(), exp: nowSeconds() + 300, typ: 'command', ...claims};
      const refused: [string, string | null, string?][] = [
        ['a stranger\'s key', commandFor(gateway, claims, {signer: stranger})],
        ['another environment', commandFor(gateway, claims, {environment: randomUUID()})],
        ['expired', commandFor(gateway, claims, {now: nowSeconds() - 900})],
        ['a ticket as a command', await ticketFor(gateway, who, {dir: 'download', tid: stored.id})],
        ['a command under the ticket scheme', commandFor(gateway, claims), 'Ticket'],
        ['unsigned', null],
        ['garbage', 'not.a.token'],
        ['another issuer', forge(gateway.signer, {...standard, iss: 'gateway', jti: newJti()})],
        ['another audience', forge(gateway.signer, {...standard, aud: 'cad-worker', jti: newJti()})],
        ['a ticket-typed token with command claims', forge(gateway.signer, {...standard, typ: 'ticket', jti: newJti()})],
        ['path-like parts', forge(gateway.signer, {...standard, uid: `${stored.id}/../${randomUUID()}`, jti: newJti()})],
        ['a path in the Account', forge(gateway.signer, {...standard, acct: `${who.accountId}/../x`, jti: newJti()})],
        ['an unknown command', forge(gateway.signer, {...standard, cmd: 'delete-everything', jti: newJti()})],
        ['an unknown field', forge(gateway.signer, {...standard, prefix: 'staging/', jti: newJti()})],
        ['a root that is not a digest', forge(gateway.signer, {...standard, cmd: 'delete-root', root: '../../objects', uid: undefined, jti: newJti()})],
        ['a tampered signature', forge(gateway.signer, {...standard, jti: newJti()}, {flipSignature: true})],
      ];
      const before = await redemptionsOf(who.accountId);
      const bodies = new Set<string>();
      for (const [label, token, scheme] of refused) {
        const result = await post(token, scheme ?? 'Command');
        expect(result.status, label).toBe(401);
        bodies.add(result.body);
        expect(await objectOf(staging(who.accountId, stored.id)), label).not.toBeNull();
        expect(await leaseOf(stored.id), label).toMatchObject({state: 'complete'});
      }
      expect([...bodies]).toEqual([JSON.stringify(errorBody('invalid_command'))]);
      expect(await redemptionsOf(who.accountId)).toBe(before);

      // Signed by the application, it deletes: once.
      const token = commandFor(gateway, claims);
      expect((await post(token)).status).toBe(200);
      expect(await objectOf(staging(who.accountId, stored.id))).toBeNull();
      // A replay of the same command is refused (and a second object that appears is not deleted by it).
      await gateway.storage.put(staging(who.accountId, stored.id), (async function* () {
        yield Buffer.from('put back');
      })(), {contentType: 'application/octet-stream'});
      const replay = await post(token);
      expect(replay.status).toBe(401);
      expect(replay.body).toBe(JSON.stringify(errorBody('invalid_command')));
      expect(await objectOf(staging(who.accountId, stored.id))).not.toBeNull();
      expect(await count('select count(*) as n from artifacts.ticket_redemptions where jti = $1', [payloadOf(token).jti])).toBe(1);
      await gateway.storage.deletePrefix(staging(who.accountId, stored.id));
    });

    it('records each command as a redemption of its own kind, with the Account, no session and no direction', async () => {
      const who = await member();
      const stored = await uploaded(who, pngBytes(MiB));
      const token = commandFor(gateway, {cmd: 'delete-staging', acct: who.accountId, uid: stored.id});
      await post(token);
      const row = (await db.query('select * from artifacts.ticket_redemptions where jti = $1', [payloadOf(token).jti])).rows[0];
      expect(row).toMatchObject({typ: 'command', issuer: 'application', kid: gateway.signer.kid, account_id: who.accountId, session_id: null, direction: null, target_kind: 'delete-staging', target_id: stored.id});
    });

    it('refuses a command whose body is large, and answers a command that is not a POST with 405', async () => {
      const result = await raw(`${gateway.url}/v1/commands`, {method: 'POST', headers: {authorization: 'Command x', 'content-length': '5000'}, body: Buffer.alloc(5000)});
      expect(result.status).toBe(413);
      expect((await raw(`${gateway.url}/v1/commands`, {method: 'GET'})).status).toBe(405);
    });
  });

  describe('the hourly cleanup', () => {
    // The task is driven through a client that forwards commands for THIS FILE's Accounts and answers `kept` for anyone else's lease, because the list the
    // database gives the task is global (the oldest 50 across every suite's leases) and no suite deletes another's staging.
    const mine = new Set<string>();
    const sent: string[] = [];
    const client = () => {
      const real = createGatewayClient({gateway: gateway.url, instanceId, signer: gateway.signer, keySet: gateway.keySet});
      return {
        ...real,
        async deleteStaging(input: {accountId: string; uploadId: string}) {
          if (!mine.has(input.accountId)) return {outcome: 'kept' as const};
          sent.push(input.uploadId);
          return real.deleteStaging(input);
        },
      };
    };
    const longAgo = (seconds: number) => `1990-01-01T00:00:${String(seconds).padStart(2, '0')}Z`;
    // The leases of this describe are dated 1990 so that they come first in the database's list of expired leases whatever else it holds; those a
    // failed earlier run left behind are retired here, so that fifty of them can never push this run's out of the first fifty.
    beforeAll(async () => {
      await db.query(`update artifacts.staging_leases set state = 'released' where expires_at < '2000-01-01' and state not in ('released', 'deleted')`);
      await db.query(`update artifacts.staging_leases set state = 'deleted' where expires_at < '2000-01-01' and state = 'released'`);
    });

    it('lists expired and released leases, sends one signed delete-staging each, keeps a lease that was renewed meanwhile, and records counts only', async () => {
      const who = await member();
      mine.add(who.accountId);
      sent.length = 0;
      const [expired, renewed, released, active] = [await uploaded(who, pngBytes(MiB)), await uploaded(who, pngBytes(MiB)), await uploaded(who, pngBytes(MiB)), await uploaded(who, pngBytes(MiB))];
      // The first three sort before everything else the database holds; the last is a lease that is nowhere near its end.
      await db.query(`update artifacts.staging_leases set expires_at = $2 where id = $1`, [expired.id, longAgo(1)]);
      await db.query(`update artifacts.staging_leases set expires_at = $2 where id = $1`, [renewed.id, longAgo(2)]);
      await db.query(`update artifacts.staging_leases set state = 'released', expires_at = $2 where id = $1`, [released.id, longAgo(3)]);
      const listed = (await listExpiredStaging({}, {env})).map((lease) => lease.uploadId);
      expect(listed.filter((id) => [expired.id, renewed.id, released.id, active.id].includes(id)).sort()).toEqual([expired.id, renewed.id, released.id].sort());
      expect(listed).not.toContain(active.id);

      // Between the list and the command, the second lease is renewed by activity.
      const gatewayClient = client();
      const racing = {
        ...gatewayClient,
        async deleteStaging(input: {accountId: string; uploadId: string}) {
          if (input.uploadId === renewed.id) await db.query(`update artifacts.staging_leases set expires_at = now() + interval '1 day' where id = $1`, [renewed.id]);
          return gatewayClient.deleteStaging(input);
        },
      };
      const outcome = await runTask('staging-cleanup', {instanceId, accounts: {env}, gateway: racing});
      expect(outcome.outcome).toBe('ran');
      expect(Object.keys(outcome.result).sort()).toEqual(['deleted', 'expired', 'kept']);
      expect(outcome.result.expired).toBeGreaterThanOrEqual(3);
      // One command for each of this file's leases that was listed, and none for the active one.
      expect(sent.sort()).toEqual([expired.id, renewed.id, released.id].sort());
      expect(await objectOf(staging(who.accountId, expired.id))).toBeNull();
      expect(await objectOf(staging(who.accountId, released.id))).toBeNull();
      expect(await leaseOf(expired.id)).toMatchObject({state: 'deleted'});
      expect(await leaseOf(released.id)).toMatchObject({state: 'deleted'});
      // The renewed lease is kept, with its object.
      expect(await leaseOf(renewed.id)).toMatchObject({state: 'complete'});
      expect(await objectOf(staging(who.accountId, renewed.id))).not.toBeNull();
      expect(await objectOf(staging(who.accountId, active.id))).not.toBeNull();
      expect(await leaseOf(active.id)).toMatchObject({state: 'complete'});

      // It lets its lease run out again, and the next run removes it.
      await db.query(`update artifacts.staging_leases set expires_at = $2 where id = $1`, [renewed.id, longAgo(4)]);
      sent.length = 0;
      await runTask('staging-cleanup', {instanceId, accounts: {env}, gateway: client()});
      expect(sent).toEqual([renewed.id]);
      expect(await objectOf(staging(who.accountId, renewed.id))).toBeNull();
      expect(await leaseOf(renewed.id)).toMatchObject({state: 'deleted'});
      // A deleted lease is listed no more.
      expect((await listExpiredStaging({}, {env})).map((lease) => lease.uploadId)).not.toContain(renewed.id);
    });

    it('is `no_store` with no gateway, and a FAILED run (the class of the error) when the gateway is down or refuses every command, so the scheduler retries', async () => {
      const who = await member();
      mine.add(who.accountId);
      const stored = await uploaded(who, pngBytes(MiB));
      await db.query(`update artifacts.staging_leases set expires_at = $2 where id = $1`, [stored.id, longAgo(5)]);
      expect(await runTask('staging-cleanup', {instanceId, accounts: {env}, gateway: null})).toEqual({outcome: 'no_store', result: {configured: false}});
      const down = createGatewayClient({gateway: 'http://127.0.0.1:1', instanceId, signer: gateway.signer, keySet: gateway.keySet});
      await expect(runTask('staging-cleanup', {instanceId, accounts: {env}, gateway: down})).rejects.toMatchObject({name: 'GatewayUnavailableError'});
      const stranger = testSigner({active: uniqueLabel('stranger')});
      const refused = createGatewayClient({gateway: gateway.url, instanceId, signer: stranger.signer, keySet: stranger.keySet});
      // A refusal of a command is a refusal of THAT lease (Review P10): the run goes on, counts it, and fails at the end with its own error, by class only.
      const incomplete = await runTask('staging-cleanup', {instanceId, accounts: {env}, gateway: refused}).catch((error: unknown) => error);
      expect(incomplete).toMatchObject({name: 'StagingCleanupIncompleteError'});
      expect(String((incomplete as Error).message)).not.toContain(who.accountId);
      // Nothing was deleted by either, and the next run (a working gateway) does it.
      expect(await objectOf(staging(who.accountId, stored.id))).not.toBeNull();
      expect(await leaseOf(stored.id)).toMatchObject({state: 'complete'});
      sent.length = 0;
      await runTask('staging-cleanup', {instanceId, accounts: {env}, gateway: client()});
      expect(sent).toContain(stored.id);
      expect(await objectOf(staging(who.accountId, stored.id))).toBeNull();
    });

    it('goes on after a lease the gateway refuses: the leases after it are cleaned, and the run still fails at the end (by class), so the scheduler retries the poison one', async () => {
      const who = await member();
      mine.add(who.accountId);
      const [poison, later] = [await uploaded(who, pngBytes(MiB)), await uploaded(who, pngBytes(MiB))];
      // The poison lease sorts first: a loop that stopped at its first refusal would never reach the next.
      await db.query(`update artifacts.staging_leases set expires_at = $2 where id = $1`, [poison.id, longAgo(6)]);
      await db.query(`update artifacts.staging_leases set expires_at = $2 where id = $1`, [later.id, longAgo(7)]);
      const stranger = testSigner({active: uniqueLabel('stranger')});
      const refusing = createGatewayClient({gateway: gateway.url, instanceId, signer: stranger.signer, keySet: stranger.keySet});
      const real = client();
      const picky = {
        ...real,
        async deleteStaging(input: {accountId: string; uploadId: string}) {
          return input.uploadId === poison.id ? refusing.deleteStaging(input) : real.deleteStaging(input);
        },
      };
      sent.length = 0;
      await expect(runTask('staging-cleanup', {instanceId, accounts: {env}, gateway: picky})).rejects.toMatchObject({name: 'StagingCleanupIncompleteError'});
      expect(sent).toContain(later.id);
      expect(sent).not.toContain(poison.id);
      expect(await objectOf(staging(who.accountId, later.id))).toBeNull();
      expect(await leaseOf(later.id)).toMatchObject({state: 'deleted'});
      expect(await objectOf(staging(who.accountId, poison.id))).not.toBeNull();
      expect(await leaseOf(poison.id)).toMatchObject({state: 'complete'});
      // The poison lease is listed again, and a working gateway cleans it.
      await runTask('staging-cleanup', {instanceId, accounts: {env}, gateway: client()});
      expect(await leaseOf(poison.id)).toMatchObject({state: 'deleted'});
    });
  });
});

// =====================================================================================================================================================
describe('start-up: the gateway never listens in the wrong environment or without its configuration', () => {
  const s3 = () => s3Of(localStack());
  const baseEnv = (): Record<string, string> => ({
    APP_ENV: 'local',
    INSTANCE_ID: instanceId,
    APP_ORIGIN: appOrigin,
    SERVICE_KEYS_APPLICATION: gateway.keySetJson,
    GATEWAY_DATABASE_URL: roleUrl(),
    GATEWAY_STORAGE_S3_ENDPOINT: s3().endpoint,
    GATEWAY_STORAGE_S3_REGION: s3().region,
    GATEWAY_STORAGE_S3_ACCESS_KEY_ID: s3().accessKeyId,
    GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY: s3().secretAccessKey,
  });
  // A hosted environment as the configuration wants it: https origins and a database URL that asks for TLS (the database object is the test's own, so it is not used).
  const hostedEnv = (): Record<string, string> => ({
    ...baseEnv(),
    APP_ENV: 'staging',
    APP_ORIGIN: 'https://app.example.test',
    GATEWAY_STORAGE_S3_ENDPOINT: 'https://storage.example.test/storage/v1/s3',
    GATEWAY_DATABASE_URL: `${roleUrl()}?sslmode=require`,
  });
  const freePort = () =>
    new Promise<number>((done) => {
      const server = createNetServer();
      server.listen(0, '127.0.0.1', () => {
        const {port} = server.address() as {port: number};
        server.close(() => done(port));
      });
    });
  const listening = (port: number) =>
    new Promise<boolean>((done) => {
      const request = http.get(`http://127.0.0.1:${port}/healthz`, {agent: false}, (response) => {
        response.resume();
        done(true);
      });
      request.on('error', () => done(false));
    });
  const secrets = () => [roleUrl(), 'nova3d-gateway-local', s3().secretAccessKey, s3().accessKeyId, gateway.keySetJson, instanceId];

  /** Runs `node workers/files/src/main.ts` with only these variables, and says how it ended and what it printed. */
  function run(env: Record<string, string | undefined>, options: {waitForListening?: number} = {}) {
    return new Promise<{code: number | null; stdout: string; stderr: string; child: ChildProcess}>((done) => {
      const clean = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string>;
      const child = spawn(process.execPath, ['workers/files/src/main.ts'], {cwd: repo, env: clean as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe']});
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (part) => (stdout += part));
      child.stderr.on('data', (part) => (stderr += part));
      child.on('close', (code) => done({code, stdout, stderr, child}));
      if (options.waitForListening) {
        const timer = setInterval(() => {
          if (stdout.includes('listening')) {
            clearInterval(timer);
            done({code: null, stdout, stderr, child});
          }
        }, 50);
        setTimeout(() => clearInterval(timer), options.waitForListening).unref();
      }
    });
  }

  it('starts, listens on PORT and answers /healthz, then ends cleanly on SIGTERM', async () => {
    const port = await freePort();
    const result = await run({...baseEnv(), PORT: String(port)}, {waitForListening: 15_000});
    try {
      expect(result.code).toBeNull();
      expect(result.stdout).toContain('The file gateway is listening (local).');
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({status: 'ok'});
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally {
      const closed = new Promise<number | null>((done) => result.child.on('close', done));
      result.child.kill('SIGTERM');
      expect(await closed).toBe(0);
    }
    for (const secret of secrets()) expect(result.stdout + result.stderr).not.toContain(secret);
  }, 30_000);

  const mismatches: [string, Record<string, string>, string][] = [
    ['an INSTANCE_ID that is not this database\'s', {INSTANCE_ID: randomUUID()}, 'INSTANCE_ID differs'],
    // Story 1.12 review (P7): a staging or production gateway is told to encrypt its connection to the database. The local database speaks no TLS, so a
    // process that is told it is staging and pointed at it cannot ask the database anything and does not start; that the environment is NOT this database's
    // is shown with the real database object in `start()` below (the 'APP_ENV differs' message), and a URL with no sslmode is refused by the configuration.
    ['an APP_ENV that is not this database\'s, with the TLS a hosted URL carries (which the local database cannot speak)', {APP_ENV: 'staging', APP_ORIGIN: 'https://app.example.test', GATEWAY_STORAGE_S3_ENDPOINT: 'https://storage.example.test/storage/v1/s3', GATEWAY_DATABASE_URL: `${roleUrl()}?sslmode=require`}, 'artifacts.instance'],
    ['an APP_ENV of staging and a database URL that does not ask for TLS', {APP_ENV: 'staging', APP_ORIGIN: 'https://app.example.test', GATEWAY_STORAGE_S3_ENDPOINT: 'https://storage.example.test/storage/v1/s3'}, 'GATEWAY_DATABASE_URL must carry sslmode'],
  ];
  it.each(mismatches)('exits non-zero before listening with %s, and prints no secret', async (_label, change, message) => {
    const port = await freePort();
    const result = await run({...baseEnv(), ...change, PORT: String(port)});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(message);
    expect(await listening(port)).toBe(false);
    for (const secret of [...secrets(), change.INSTANCE_ID].filter((value): value is string => Boolean(value) && value !== instanceId)) expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout + result.stderr).not.toContain(instanceId);
  }, 30_000);

  it.each(['APP_ENV', 'INSTANCE_ID', 'APP_ORIGIN', 'SERVICE_KEYS_APPLICATION', 'GATEWAY_DATABASE_URL', 'GATEWAY_STORAGE_S3_ENDPOINT', 'GATEWAY_STORAGE_S3_REGION', 'GATEWAY_STORAGE_S3_ACCESS_KEY_ID', 'GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY'])(
    'exits non-zero before listening when %s is missing, naming the variable and nothing of the others',
    async (name) => {
      const port = await freePort();
      const result = await run({...baseEnv(), [name]: undefined, PORT: String(port)});
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`${name} is not set`);
      expect(await listening(port)).toBe(false);
      for (const secret of secrets()) expect(result.stdout + result.stderr).not.toContain(secret);
    },
    30_000,
  );

  it('exits non-zero before listening for a configuration that is wrong (a placeholder, a bad key set, a bad origin, a bad port)', async () => {
    const port = await freePort();
    for (const change of [
      {SERVICE_KEYS_APPLICATION: 'replace-with-the-key-set'},
      {SERVICE_KEYS_APPLICATION: '{"issuer":"application"}'},
      {APP_ORIGIN: `${appOrigin}/path`},
      {APP_ORIGIN: 'https://user:pass@app.example.test'},
      {INSTANCE_ID: 'not-a-uuid'},
      {APP_ENV: 'moon'},
      {GATEWAY_DATABASE_URL: 'mysql://x'},
      {PORT: 'eighty'},
    ]) {
      const result = await run({...baseEnv(), PORT: String(port), ...change});
      expect(result.code, JSON.stringify(Object.keys(change))).toBe(1);
      expect(await listening(port)).toBe(false);
      for (const secret of secrets()) expect(result.stdout + result.stderr).not.toContain(secret);
    }
  }, 60_000);

  it('exits non-zero before listening when the database cannot be reached or the role\'s password is wrong, without printing the password', async () => {
    const port = await freePort();
    const down = new URL(roleUrl());
    down.port = String(await freePort());
    const unreachable = await run({...baseEnv(), PORT: String(port), GATEWAY_DATABASE_URL: down.href});
    expect(unreachable.code).toBe(1);
    expect(unreachable.stderr).toContain('artifacts.instance');
    const wrong = new URL(roleUrl());
    wrong.password = 'not-the-password-of-the-role';
    const denied = await run({...baseEnv(), PORT: String(port), GATEWAY_DATABASE_URL: wrong.href});
    expect(denied.code).toBe(1);
    expect(denied.stderr).toContain('artifacts.instance');
    expect(await listening(port)).toBe(false);
    for (const result of [unreachable, denied]) for (const secret of [...secrets(), 'not-the-password-of-the-role']) expect(result.stdout + result.stderr).not.toContain(secret);
  }, 60_000);

  it('start() refuses the same mismatches with a StartupError that names what differs, never a value, and never listens', async () => {
    const real = createPostgresDatabase({connectionString: roleUrl()});
    try {
      const other = randomUUID();
      await expect(start({...baseEnv(), INSTANCE_ID: other}, {database: real, port: 0, host: '127.0.0.1'})).rejects.toSatisfy((error: unknown) => {
        return error instanceof StartupError && error.problems.join(' ').includes('INSTANCE_ID differs') && !error.message.includes(other) && !error.message.includes(instanceId);
      });
      await expect(
        start({...hostedEnv(), APP_ENV: 'production'}, {database: real, port: 0, host: '127.0.0.1'}),
      ).rejects.toSatisfy((error: unknown) => error instanceof StartupError && error.problems.join(' ').includes('APP_ENV differs'));
      await expect(start({...baseEnv(), INSTANCE_ID: undefined}, {database: real, port: 0, host: '127.0.0.1'})).rejects.toBeInstanceOf(StartupError);
      // Both wrong at once: both are named.
      await expect(
        start({...hostedEnv(), INSTANCE_ID: other, APP_ENV: 'production'}, {database: real, port: 0, host: '127.0.0.1'}),
      ).rejects.toSatisfy((error: unknown) => error instanceof StartupError && error.problems.length === 2);
      // And a database that cannot answer.
      const broken: GatewayDatabase = {...real, instance: async () => Promise.reject(new Error('down'))};
      await expect(start(baseEnv(), {database: broken, port: 0, host: '127.0.0.1'})).rejects.toSatisfy((error: unknown) => error instanceof StartupError && error.problems.join(' ').includes('artifacts.instance'));
    } finally {
      await real.close();
    }
  });
});

// =====================================================================================================================================================
describe('the gateway prints nothing of what it is given', () => {
  it('has logged no ticket, command, handle, key, URL, upload ID, Account ID or body in anything it printed through this whole file', async () => {
    const text = logged.join('\n');
    expect(issued.length).toBeGreaterThan(50);
    for (const token of issued) {
      expect(text.includes(token)).toBe(false);
      for (const part of token.split('.')) expect(text.includes(part)).toBe(false);
    }
    for (const handle of handlesSeen) expect(text.includes(handle)).toBe(false);
    const s3 = s3Of(localStack());
    for (const forbidden of [gateway.keySetJson, testKeyPair('application-1').privateKey, roleUrl(), 'nova3d-gateway-local', s3.secretAccessKey, '/v1/uploads/', '/v1/files/', '/v1/commands', '/h/', '/d/', 'Ticket ', 'Command ', 'authorization']) {
      expect(text.includes(forbidden), forbidden).toBe(false);
    }
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    // What it does print, it prints as a name: the class of an error, from a fixed sentence.
    for (const line of logged) expect(line, line).toMatch(/^(?:The gateway [a-z ]+\.|The file gateway [a-z ]+\.)? ?[A-Za-z ]*$/);
  });
});
