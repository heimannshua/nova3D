import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {ActiveAccess} from '@/lib/access';
import type {Env} from '@/lib/environment';
import {isUuid, ticketClaimsOf, transferLimits, verifyToken} from '@/lib/service-signing';
import {issueTransferTicket, maxTicketBodyBytes, parseTicketRequest} from '@/lib/transfer-tickets';
import {testKeyPair, testKeys} from '../support/service-keys';

// Issuing a transfer ticket (Story 1.12, lib/transfer-tickets.ts): what `POST /api/transfers/tickets` answers once the route's guard has let a
// signed-in Account through. The ticket is the application's signed permission to OPEN one transfer at the gateway: five minutes, single use, bound
// to the verified Account, session grant and epoch (the database's, from the access, never from the request), one direction and one target, with
// no credential and no URL in it. The route's own guard is tests/unit/transfer-route.test.ts; the gateway that redeems the ticket is
// tests/unit/gateway-server.test.ts and tests/integration/file-gateway.test.ts.
const NOW = 1_800_000_000;
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const SESSION = '11111111-2222-4333-8444-555555555555';
const TARGET = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const SHA = 'ab'.repeat(32);
const GATEWAY = 'http://127.0.0.1:4175';

const keys = testKeys();
const env = (extra: Env = {}): Env => ({
  APP_ENV: 'local',
  INSTANCE_ID: INSTANCE,
  FILE_GATEWAY_URL: GATEWAY,
  SERVICE_KEYS_APPLICATION: keys.json,
  SERVICE_SIGNING_KEY_APPLICATION: keys.privateKey,
  ...extra,
});
const access = (over: {accountId?: string; epoch?: number; sessionId?: string} = {}): ActiveAccess => ({
  state: 'active',
  user: {id: '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a', email: 'person@example.test', sessionId: over.sessionId ?? SESSION},
  account: {accountId: over.accountId ?? ACCOUNT, workspaceId: null, role: 'member', epoch: over.epoch ?? 4, preferences: null},
});

const upload = (over: Record<string, unknown> = {}) => ({direction: 'upload', kind: 'staging', id: TARGET, class: 'picture', length: 1048576, sha256: SHA, contentType: 'image/png', ...over});
const download = (over: Record<string, unknown> = {}) => ({direction: 'download', kind: 'staging', id: TARGET, ...over});
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.example/api/transfers/tickets', {method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: {'content-type': 'application/json', ...headers}});

const logs = ['log', 'info', 'warn', 'error', 'debug'].map((name) => vi.spyOn(console, name as 'log').mockImplementation(() => undefined));
beforeEach(() => logs.forEach((spy) => spy.mockClear()));
afterEach(() => expect(logs.map((spy) => spy.mock.calls.length), 'nothing is printed').toEqual([0, 0, 0, 0, 0]));

async function issue(body: unknown, options: {env?: Env; access?: ActiveAccess; headers?: Record<string, string>} = {}) {
  const response = await issueTransferTicket(post(body, options.headers), options.access ?? access(), options.env ?? env(), {now: NOW});
  return {response, body: (await response.json()) as Record<string, unknown>};
}

describe('parseTicketRequest', () => {
  it('reads an upload request and a download request, with exactly their members', () => {
    expect(parseTicketRequest(JSON.stringify(upload()))).toEqual({ok: true, request: {direction: 'upload', kind: 'staging', id: TARGET, class: 'picture', length: 1048576, sha256: SHA, contentType: 'image/png'}});
    expect(parseTicketRequest(JSON.stringify(download()))).toEqual({ok: true, request: {direction: 'download', kind: 'staging', id: TARGET}});
  });

  it('refuses what is not one JSON object, without naming a member', () => {
    for (const text of ['', '{', 'nope', '[]', '[{}]', 'null', '5', '"x"', 'true', JSON.stringify([upload()])]) {
      expect(parseTicketRequest(text), text).toEqual({ok: false, status: 400, error: 'invalid_request'});
    }
  });

  it('names the member that is wrong, and only the member', () => {
    expect(parseTicketRequest(JSON.stringify(download({direction: 'sideways'})))).toEqual({ok: false, status: 400, error: 'invalid_request', field: 'direction'});
    expect(parseTicketRequest(JSON.stringify(download({direction: undefined})))).toEqual({ok: false, status: 400, error: 'invalid_request', field: 'direction'});
    expect(parseTicketRequest(JSON.stringify(download({kind: 5})))).toEqual({ok: false, status: 400, error: 'invalid_request', field: 'kind'});
    for (const id of [TARGET.toUpperCase(), 'nope', '', 5, null, `${TARGET} `]) {
      expect(parseTicketRequest(JSON.stringify(download({id}))), String(id)).toEqual({ok: false, status: 400, error: 'invalid_request', field: 'id'});
    }
  });

  it('refuses a member that does not belong to the direction, an unknown member and a missing one', () => {
    for (const body of [
      download({class: 'picture'}),
      download({length: 1, sha256: SHA, contentType: 'image/png', class: 'picture'}),
      download({extra: 1}),
      download({epoch: 9}),
      download({acct: ACCOUNT}),
      upload({extra: 1}),
      upload({acct: ACCOUNT, sid: SESSION, epoch: 1}),
      upload({url: 'https://storage.example/object'}),
    ]) {
      expect(parseTicketRequest(JSON.stringify(body)), JSON.stringify(Object.keys(body))).toEqual({ok: false, status: 400, error: 'invalid_request'});
    }
    for (const name of ['class', 'length', 'sha256', 'contentType']) {
      const body = upload() as Record<string, unknown>;
      delete body[name];
      expect(parseTicketRequest(JSON.stringify(body)), name).toEqual({ok: false, status: 400, error: 'invalid_request'});
    }
    const bare = download() as Record<string, unknown>;
    delete bare.kind;
    expect(parseTicketRequest(JSON.stringify(bare))).toEqual({ok: false, status: 400, error: 'invalid_request', field: 'kind'});
  });

  it('holds an upload to the gateway\'s own limits (lib/service-signing.ts uploadProblem), naming the member', () => {
    expect(parseTicketRequest(JSON.stringify(upload({sha256: SHA.toUpperCase()})))).toMatchObject({ok: false, field: 'sha256'});
    expect(parseTicketRequest(JSON.stringify(upload({sha256: 'ab'})))).toMatchObject({ok: false, field: 'sha256'});
    expect(parseTicketRequest(JSON.stringify(upload({class: 'document'})))).toMatchObject({ok: false, field: 'class'});
    // A picture has three types; a file has one; neither takes the other's.
    expect(parseTicketRequest(JSON.stringify(upload({contentType: 'application/octet-stream'})))).toMatchObject({ok: false, field: 'contentType'});
    expect(parseTicketRequest(JSON.stringify(upload({contentType: 'image/gif'})))).toMatchObject({ok: false, field: 'contentType'});
    expect(parseTicketRequest(JSON.stringify(upload({class: 'file', contentType: 'image/png'})))).toMatchObject({ok: false, field: 'contentType'});
    for (const length of [0, -5, 1.5, '5', null, Number.MAX_SAFE_INTEGER + 2]) expect(parseTicketRequest(JSON.stringify(upload({length}))), String(length)).toMatchObject({ok: false, field: 'length'});
    expect(parseTicketRequest(JSON.stringify(upload({length: transferLimits.pictureBytes + 1})))).toMatchObject({ok: false, field: 'length'});
    expect(parseTicketRequest(JSON.stringify(upload({class: 'file', contentType: 'application/octet-stream', length: transferLimits.fileBytes + 1})))).toMatchObject({ok: false, field: 'length'});
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) expect(parseTicketRequest(JSON.stringify(upload({contentType, length: transferLimits.pictureBytes}))).ok, contentType).toBe(true);
    expect(parseTicketRequest(JSON.stringify(upload({class: 'file', contentType: 'application/octet-stream', length: transferLimits.fileBytes}))).ok).toBe(true);
  });

  it('refuses a kind with no resolver, for either direction, with its own answer', () => {
    for (const kind of ['project', 'manifest', 'export', 'Staging', 'Retained', 'staging ', 'retained ', '']) {
      expect(parseTicketRequest(JSON.stringify(download({kind}))), kind).toEqual({ok: false, status: 400, error: 'unknown_target'});
      expect(parseTicketRequest(JSON.stringify(upload({kind}))), kind).toEqual({ok: false, status: 400, error: 'unknown_target'});
    }
  });

  it('takes a download of a retained picture (Story 2.12) and refuses an upload to the kind `retained`: a retained picture is only ever read', () => {
    expect(parseTicketRequest(JSON.stringify(download({kind: 'retained'})))).toEqual({ok: true, request: {direction: 'download', kind: 'retained', id: TARGET}});
    expect(parseTicketRequest(JSON.stringify(upload({kind: 'retained'})))).toEqual({ok: false, status: 400, error: 'unknown_target'});
  });
});

describe('issueTransferTicket: a ticket', () => {
  it('answers 200 with the ticket and the gateway\'s address, and nothing else, uncached', async () => {
    const {response, body} = await issue(upload());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(Object.keys(body).sort()).toEqual(['gateway', 'ticket']);
    expect(body.gateway).toBe(GATEWAY);
    expect(typeof body.ticket).toBe('string');
  });

  it('is a token the gateway verifies: from the application, to the gateway, for this environment, valid for exactly five minutes, with a 128-bit jti', async () => {
    const {body} = await issue(upload());
    const verified = await verifyToken(body.ticket, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: NOW, type: 'ticket'});
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.kid).toBe(keys.active.kid);
    expect(verified.payload).toMatchObject({iss: 'application', aud: 'gateway', env: INSTANCE, typ: 'ticket', iat: NOW, exp: NOW + 300});
    expect(verified.payload.exp - verified.payload.iat).toBe(transferLimits.ticketSeconds);
    expect(verified.payload.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // It is not valid a second after its five minutes, nor under another environment's ID, nor for another audience.
    expect((await verifyToken(body.ticket, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: NOW + 301})).ok).toBe(false);
    expect((await verifyToken(body.ticket, {issuer: 'application', audience: 'gateway', environment: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', keySet: keys.keySet, now: NOW})).ok).toBe(false);
  });

  it('holds the upload\'s claims for the gateway to hold the bytes to, and the Account, the session and the epoch of the verified access', async () => {
    const {body} = await issue(upload({class: 'file', contentType: 'application/octet-stream', length: 5_000_000}), {access: access({epoch: 7})});
    const verified = await verifyToken(body.ticket, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: NOW});
    expect(verified.ok && ticketClaimsOf(verified.payload)).toEqual({acct: ACCOUNT, sid: SESSION, epoch: 7, dir: 'upload', tk: 'staging', tid: TARGET, cls: 'file', len: 5_000_000, sha: SHA, ct: 'application/octet-stream'});
  });

  it('holds the download\'s claims and no upload claim', async () => {
    const {body} = await issue(download());
    const verified = await verifyToken(body.ticket, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: NOW});
    expect(verified.ok && ticketClaimsOf(verified.payload)).toEqual({acct: ACCOUNT, sid: SESSION, epoch: 4, dir: 'download', tk: 'staging', tid: TARGET});
  });

  it('takes the Account, the session and the epoch from the access and from nowhere else: a request cannot carry them, and another access gives other claims', async () => {
    for (const member of ['acct', 'sid', 'epoch', 'account', 'accountId', 'sessionId']) {
      const {response} = await issue(download({[member]: 'x'}));
      expect(response.status, member).toBe(400);
    }
    const other = access({accountId: '8b2c3d4e-5f6a-4b7c-9d8e-1f2a3b4c5d6e', sessionId: '22222222-3333-4444-8555-666666666666', epoch: 11});
    const {body} = await issue(download(), {access: other});
    const verified = await verifyToken(body.ticket, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: NOW});
    expect(verified.ok && ticketClaimsOf(verified.payload)).toMatchObject({acct: '8b2c3d4e-5f6a-4b7c-9d8e-1f2a3b4c5d6e', sid: '22222222-3333-4444-8555-666666666666', epoch: 11});
  });

  it('carries no credential, no URL and nothing but the standard claims and the ticket\'s own', async () => {
    const {body, response} = await issue(upload());
    const payload = JSON.parse(Buffer.from((body.ticket as string).split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['acct', 'aud', 'cls', 'ct', 'dir', 'env', 'epoch', 'exp', 'iat', 'iss', 'jti', 'len', 'sha', 'sid', 'tid', 'tk', 'typ']);
    const everything = JSON.stringify(payload) + JSON.stringify(body).replace(body.ticket as string, '') + [...response.headers.entries()].join('\n');
    expect(everything).not.toMatch(/https?:\/\/(?!127\.0\.0\.1:4175)|secret|credential|password|signature|access_key|amz/i);
    // The only address in the answer is the gateway's own.
    expect(JSON.stringify(body).match(/https?:\/\/[^"]+/g)).toEqual([GATEWAY]);
    expect(JSON.stringify(payload)).not.toContain(keys.privateKey);
  });

  it('is a different ticket every time: a new jti, so one ticket is one transfer', async () => {
    const tickets = new Set<unknown>();
    for (let index = 0; index < 5; index += 1) tickets.add((await issue(download())).body.ticket);
    expect(tickets.size).toBe(5);
  });

  it('uses the clock when it is not given one, and still lives exactly five minutes', async () => {
    const before = Math.floor(Date.now() / 1000);
    const response = await issueTransferTicket(post(download()), access(), env());
    const verified = await verifyToken(((await response.json()) as {ticket: string}).ticket, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: before});
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.iat).toBeGreaterThanOrEqual(before);
      expect(verified.payload.iat).toBeLessThanOrEqual(before + 5);
      expect(verified.payload.exp - verified.payload.iat).toBe(300);
    }
  });

  it('says the target\'s ID is a UUID the caller chose, and signs it as given', async () => {
    const id = '0f5c0b86-2c1b-4d3f-9a58-6c7d8e9f0a1b';
    const {body} = await issue(download({id}));
    const verified = await verifyToken(body.ticket, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: NOW});
    expect(verified.ok && isUuid(verified.payload.tid) && verified.payload.tid).toBe(id);
  });
});

describe('issueTransferTicket: 503, fail closed, nothing signed and nothing read', () => {
  const unconfigured = async (extra: Env, reason: string) => {
    const request = post(download());
    const response = await issueTransferTicket(request, access(), env(extra), {now: NOW});
    expect(response.status, reason).toBe(503);
    expect(await response.json(), reason).toEqual({error: 'unavailable'});
    expect(response.headers.get('cache-control'), reason).toBe('no-store');
    // The answer is made before the body is looked at.
    expect(request.bodyUsed, reason).toBe(false);
  };

  it.each(['SERVICE_SIGNING_KEY_APPLICATION', 'SERVICE_KEYS_APPLICATION', 'FILE_GATEWAY_URL', 'INSTANCE_ID'])('is 503 when %s is unset, empty, blank or a placeholder', async (name) => {
    for (const value of [undefined, '', '   ', 'replace-with-the-value', '<the value>', 'changeme']) await unconfigured({[name]: value}, `${name}=${String(value)}`);
  });

  it('is 503 with no environment at all', async () => {
    await unconfigured({APP_ENV: undefined, INSTANCE_ID: undefined, FILE_GATEWAY_URL: undefined, SERVICE_KEYS_APPLICATION: undefined, SERVICE_SIGNING_KEY_APPLICATION: undefined}, 'nothing set');
  });

  it('is 503 for a key set that is not one, and for one that is another issuer\'s', async () => {
    await unconfigured({SERVICE_KEYS_APPLICATION: '{}'}, 'empty set');
    await unconfigured({SERVICE_KEYS_APPLICATION: '{not json'}, 'not json');
    await unconfigured({SERVICE_KEYS_APPLICATION: testKeys({issuer: 'gateway', active: 'gateway-1'}).json}, 'another issuer');
  });

  it('is 503 for a private key that is not the private half of the active key, or is not a key at all', async () => {
    await unconfigured({SERVICE_SIGNING_KEY_APPLICATION: testKeyPair('someone-else').privateKey}, 'another key');
    await unconfigured({SERVICE_SIGNING_KEY_APPLICATION: testKeyPair('application-0').privateKey}, 'a retired key');
    await unconfigured({SERVICE_SIGNING_KEY_APPLICATION: 'not base64!'}, 'not base64');
    await unconfigured({SERVICE_SIGNING_KEY_APPLICATION: keys.active.publicKey}, 'the public key');
  });

  it('is 503 for a gateway address that is not an origin, and for http outside local', async () => {
    for (const url of ['http://127.0.0.1:4175/', 'http://127.0.0.1:4175/path', 'gateway.example.test', 'not a url', 'https://user:pass@files.example.test', 'https://files.example.test?x=1']) await unconfigured({FILE_GATEWAY_URL: url}, url);
    await unconfigured({APP_ENV: 'staging', FILE_GATEWAY_URL: 'http://files.example.test'}, 'http in staging');
    await unconfigured({APP_ENV: 'production', FILE_GATEWAY_URL: 'http://files.example.test'}, 'http in production');
    await unconfigured({INSTANCE_ID: 'not-a-uuid'}, 'instance that is not a UUID');
  });

  it('is configured for https in staging and production, and for http locally', async () => {
    for (const environment of ['staging', 'production']) {
      const {response, body} = await issue(download(), {env: env({APP_ENV: environment, FILE_GATEWAY_URL: 'https://files.example.test'})});
      expect(response.status, environment).toBe(200);
      expect(body.gateway).toBe('https://files.example.test');
    }
    expect((await issue(download())).response.status).toBe(200);
  });
});

describe('issueTransferTicket: a body that is too large, unreadable or wrong', () => {
  const padded = (length: number) => {
    const text = JSON.stringify(download());
    return text + ' '.repeat(length - Buffer.byteLength(text));
  };

  it('is 413 over 4 KiB, whether it is declared or only streamed, and signs nothing', async () => {
    expect(maxTicketBodyBytes).toBe(4096);
    const declared = await issue(padded(4097));
    expect(declared.response.status).toBe(413);
    expect(declared.body).toEqual({error: 'payload_too_large'});
    // A body that says nothing of its length is read only up to the cap and one chunk more.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(' '.repeat(1024)));
      },
    });
    const streamed = await issueTransferTicket(new Request('https://app.example/api/transfers/tickets', {method: 'POST', body: stream, duplex: 'half'} as RequestInit), access(), env(), {now: NOW});
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toEqual({error: 'payload_too_large'});
    for (const answer of [declared.body, await issue(padded(10_000)).then((result) => result.body)]) expect(answer).not.toHaveProperty('ticket');
  });

  it('is 413 for a content-length over the cap, and for one that is not a number, before the body is read', async () => {
    for (const length of ['4097', '99999999999', 'abc', '-1', '1.5', '']) {
      const request = post(download(), {'content-length': length});
      const response = await issueTransferTicket(request, access(), env(), {now: NOW});
      expect(response.status, length).toBe(413);
      expect(request.bodyUsed, length).toBe(false);
    }
  });

  it('reads a body of exactly 4 KiB', async () => {
    expect((await issue(padded(4096))).response.status).toBe(200);
  });

  it('is 400 for a body that is not UTF-8, and for no body at all', async () => {
    const bytes = new Request('https://app.example/api/transfers/tickets', {method: 'POST', body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])});
    const garbled = await issueTransferTicket(bytes, access(), env(), {now: NOW});
    expect(garbled.status).toBe(400);
    expect(await garbled.json()).toEqual({error: 'invalid_request'});
    const empty = await issueTransferTicket(new Request('https://app.example/api/transfers/tickets', {method: 'POST'}), access(), env(), {now: NOW});
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({error: 'invalid_request'});
  });

  it('is 400 for every body that is not a ticket request, naming no value the caller sent', async () => {
    const secret = 'caller-value-that-must-never-be-echoed';
    for (const body of ['{', '[]', 'null', JSON.stringify({...download(), extra: secret}), JSON.stringify(download({id: secret})), JSON.stringify(download({direction: secret})), JSON.stringify(upload({contentType: secret})), JSON.stringify(upload({sha256: secret}))]) {
      const {response, body: answer} = await issue(body);
      expect(response.status, body).toBe(400);
      expect(JSON.stringify(answer)).not.toContain(secret);
      expect(answer).not.toHaveProperty('ticket');
    }
    const {response, body} = await issue(upload({contentType: 'application/octet-stream'}));
    expect([response.status, body]).toEqual([400, {error: 'invalid_request', field: 'contentType'}]);
  });

  it('is 400 unknown_target for a kind with no resolver, and signs nothing', async () => {
    const {response, body} = await issue(download({kind: 'project'}));
    expect([response.status, body]).toEqual([400, {error: 'unknown_target'}]);
    const up = await issue(upload({kind: 'manifest'}));
    expect([up.response.status, up.body]).toEqual([400, {error: 'unknown_target'}]);
  });

  it('signs a download ticket for a retained picture, bound to the Account, the session and the epoch, and signs nothing for an upload to one (Story 2.12)', async () => {
    const down = await issue(download({kind: 'retained'}));
    expect(down.response.status).toBe(200);
    const verified = await verifyToken(down.body.ticket as string, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: NOW});
    expect(verified.ok && ticketClaimsOf(verified.payload)).toEqual({acct: ACCOUNT, sid: SESSION, epoch: 4, dir: 'download', tk: 'retained', tid: TARGET});
    const up = await issue(upload({kind: 'retained'}));
    expect([up.response.status, up.body]).toEqual([400, {error: 'unknown_target'}]);
    expect(up.body).not.toHaveProperty('ticket');
  });

  it('is 400 for upload members on a download and a download\'s bareness on an upload', async () => {
    expect((await issue(download({class: 'picture', length: 1, sha256: SHA, contentType: 'image/png'}))).response.status).toBe(400);
    expect((await issue(upload({direction: 'download'}))).response.status).toBe(400);
    const bare = {direction: 'upload', kind: 'staging', id: TARGET};
    expect((await issue(bare)).response.status).toBe(400);
  });

  it('puts no-store on every answer, refusals included', async () => {
    for (const body of [download(), '{', download({kind: 'project'}), padded(5000)]) {
      const {response} = await issue(body);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
});
