import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Env} from '@/lib/environment';
import {configuredGatewayClient, createGatewayClient, GatewayError, GatewayUnavailableError, signingConfigOf, type SigningConfig} from '@/lib/gateway-client';
import {commandClaimsOf, verifyToken} from '@/lib/service-signing';
import {testKeyPair, testKeys} from '../support/service-keys';

// The application's side of the file gateway (Story 1.12, lib/gateway-client.ts): the configuration that signs (and is null, never an error, when
// any part is missing or wrong, so a deployment with no gateway fails closed), and the signed OUTBOUND commands the application sends the gateway
// to delete or attach. A command is a POST with the token in `Authorization: Command ...` and nothing else: no Origin (this is a server), no cookie,
// no body, no redirect, no cache, a timeout. The gateway's side of it is tests/unit/gateway-server.test.ts.
const NOW = 1_800_000_000;
const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const UPLOAD = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const ROOT = 'cd'.repeat(32);
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
const configured = () => {
  const config = signingConfigOf(env());
  if (!config) throw new Error('the test configuration is not one');
  return config;
};

type Call = {url: string; init: RequestInit};
function gateway(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const call = {url: String(url), init: init ?? {}};
    calls.push(call);
    return answer(call);
  });
  return {fetch, calls};
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const tokenOf = (call: Call) => {
  const header = (call.init.headers as Record<string, string>).authorization;
  expect(header).toMatch(/^Command [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  return header.slice('Command '.length);
};
const verifyCommand = (token: string, now = NOW) => verifyToken(token, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now, type: 'command'});

afterEach(() => vi.restoreAllMocks());

describe('signingConfigOf', () => {
  it('reads the gateway\'s address, the instance, the key set and the signer, which is the active key of the application', () => {
    const config = signingConfigOf(env());
    expect(config).not.toBeNull();
    expect(config).toMatchObject({gateway: GATEWAY, instanceId: INSTANCE});
    expect(config!.signer).toMatchObject({issuer: 'application', kid: keys.active.kid});
    expect(config!.keySet.active).toBe(keys.active.kid);
  });

  it('lower-cases the instance, and trims what an environment file leaves around a value', () => {
    expect(signingConfigOf(env({INSTANCE_ID: INSTANCE.toUpperCase()}))?.instanceId).toBe(INSTANCE);
    expect(signingConfigOf(env({FILE_GATEWAY_URL: ` ${GATEWAY}\n`, SERVICE_SIGNING_KEY_APPLICATION: ` ${keys.privateKey} `, SERVICE_KEYS_APPLICATION: `\n${keys.json}\n`}))).not.toBeNull();
  });

  it.each(['SERVICE_SIGNING_KEY_APPLICATION', 'SERVICE_KEYS_APPLICATION', 'FILE_GATEWAY_URL', 'INSTANCE_ID'])('is null, and does not throw, when %s is unset, empty, blank or a placeholder', (name) => {
    for (const value of [undefined, '', '   ', 'replace-with-the-value', '<the value>', 'changeme', 'TODO']) {
      expect(signingConfigOf(env({[name]: value})), `${name}=${String(value)}`).toBeNull();
    }
  });

  it('is null for an environment that holds nothing', () => {
    expect(signingConfigOf({})).toBeNull();
  });

  it('is null for a key set that is not one, is another issuer\'s, or does not match the private key, and never throws', () => {
    for (const set of ['{}', '{not json', 'null', '[]', '"x"', testKeys({issuer: 'gateway', active: 'gateway-1'}).json, JSON.stringify({issuer: 'application', active: 'a', retiring: null, keys: {a: 'AAAA'}})]) {
      expect(signingConfigOf(env({SERVICE_KEYS_APPLICATION: set})), set).toBeNull();
    }
    for (const key of [testKeyPair('someone-else').privateKey, testKeyPair('application-0').privateKey, 'not base64!', keys.active.publicKey, '%%%', 'AAAA']) {
      expect(signingConfigOf(env({SERVICE_SIGNING_KEY_APPLICATION: key})), key).toBeNull();
    }
  });

  it('is null for a key set whose retiring key stays valid for more than ten minutes after it is read (a rotation needs six), and not for one that is within the window or already over', () => {
    const rotation = (until: Date) => {
      // The helper reads the set at a time of its own, so that a set the application would refuse can be built to be refused.
      const set = testKeys({retiring: {label: 'application-retiring', until}, readAt: new Date(until.getTime() - 60_000)});
      return env({SERVICE_KEYS_APPLICATION: set.json, SERVICE_SIGNING_KEY_APPLICATION: set.privateKey});
    };
    const now = Date.now();
    expect(signingConfigOf(rotation(new Date(now + 6 * 60_000)))).not.toBeNull();
    expect(signingConfigOf(rotation(new Date(now + 9 * 60_000)))).not.toBeNull();
    expect(signingConfigOf(rotation(new Date(now - 60 * 60_000)))).not.toBeNull();
    expect(signingConfigOf(rotation(new Date(now + 11 * 60_000)))).toBeNull();
    expect(signingConfigOf(rotation(new Date(now + 30 * 24 * 3600_000)))).toBeNull();
  });

  it('is null for a gateway address that is not an origin, or is http in staging or production', () => {
    for (const url of ['http://127.0.0.1:4175/', 'http://127.0.0.1:4175/v1', 'files.example.test', 'not a url', 'https://user:pass@files.example.test', 'https://files.example.test#x']) {
      expect(signingConfigOf(env({FILE_GATEWAY_URL: url})), url).toBeNull();
    }
    expect(signingConfigOf(env({APP_ENV: 'staging', FILE_GATEWAY_URL: 'http://files.example.test'}))).toBeNull();
    expect(signingConfigOf(env({APP_ENV: 'production', FILE_GATEWAY_URL: 'http://files.example.test'}))).toBeNull();
    expect(signingConfigOf(env({APP_ENV: 'staging', FILE_GATEWAY_URL: 'https://files.example.test'}))?.gateway).toBe('https://files.example.test');
  });

  it('is null for an instance that is not a UUID', () => {
    expect(signingConfigOf(env({INSTANCE_ID: 'not-a-uuid'}))).toBeNull();
  });
});

describe('the commands the application sends', () => {
  it('POSTs to <gateway>/v1/commands with the token in `Authorization: Command` and nothing else: no Origin, no cookie, no body', async () => {
    const {fetch, calls} = gateway(() => json({outcome: 'deleted'}));
    await createGatewayClient(configured(), {fetch, now: () => NOW}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${GATEWAY}/v1/commands`);
    expect(calls[0].init.method).toBe('POST');
    expect(Object.keys(calls[0].init.headers as object)).toEqual(['authorization']);
    expect(calls[0].init.body).toBeUndefined();
    const headers = Object.keys(calls[0].init.headers as object).map((name) => name.toLowerCase());
    for (const forbidden of ['origin', 'cookie', 'referer', 'content-type', 'x-csrf-token']) expect(headers).not.toContain(forbidden);
  });

  it('refuses a redirect, never caches, and sets a timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const {fetch, calls} = gateway(() => json({outcome: 'kept'}));
    await createGatewayClient(configured(), {fetch}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    expect(calls[0].init.redirect).toBe('error');
    expect(calls[0].init.cache).toBe('no-store');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].init.signal?.aborted).toBe(false);
    expect(timeout).toHaveBeenCalledWith(10_000);
    await createGatewayClient(configured(), {fetch, timeoutMs: 1234}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    expect(timeout).toHaveBeenLastCalledWith(1234);
  });

  it('signs each command as the gateway verifies it: the application\'s, to the gateway, for this instance, of type command, for 300 seconds, with the command\'s claims exactly', async () => {
    const {fetch, calls} = gateway((call) => (call.url.endsWith('/v1/commands') ? json({outcome: 'deleted'}) : json({})));
    const client = createGatewayClient(configured(), {fetch, now: () => NOW});
    await client.deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    await client.deleteRoot({accountId: ACCOUNT, root: ROOT});
    const gatewayAnswer = json({outcome: 'published', manifest: {id: UPLOAD, root: ROOT, digest: ROOT, length: 5, kind: 'file'}});
    const attaching = gateway(() => gatewayAnswer);
    await createGatewayClient(configured(), {fetch: attaching.fetch, now: () => NOW}).attach({accountId: ACCOUNT, epoch: 3, uploadId: UPLOAD, transform: 'none'});
    const verified = await Promise.all([...calls, ...attaching.calls].map((call) => verifyCommand(tokenOf(call))));
    expect(verified.map((result) => result.ok)).toEqual([true, true, true]);
    expect(verified.map((result) => (result.ok ? commandClaimsOf(result.payload) : null))).toEqual([
      {cmd: 'delete-staging', acct: ACCOUNT, uid: UPLOAD},
      {cmd: 'delete-root', acct: ACCOUNT, root: ROOT},
      {cmd: 'attach', acct: ACCOUNT, epoch: 3, uid: UPLOAD, tr: 'none'},
    ]);
    for (const result of verified) {
      expect(result.ok && result.payload).toMatchObject({iss: 'application', aud: 'gateway', env: INSTANCE, typ: 'command', iat: NOW});
      expect(result.ok && result.payload.exp - result.payload.iat).toBe(300);
    }
  });

  it('is not a ticket: a verifier that asks for tickets refuses it, and each command has its own jti', async () => {
    const {fetch, calls} = gateway(() => json({outcome: 'kept'}));
    const client = createGatewayClient(configured(), {fetch, now: () => NOW});
    await client.deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    await client.deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    const [first, second] = calls.map(tokenOf);
    expect((await verifyToken(first, {issuer: 'application', audience: 'gateway', environment: INSTANCE, keySet: keys.keySet, now: NOW, type: 'ticket'})).ok).toBe(false);
    const jtis = await Promise.all([first, second].map(async (token) => ((await verifyCommand(token)) as {payload: {jti: string}}).payload.jti));
    expect(jtis[0]).not.toBe(jtis[1]);
  });

  it('uses the clock when it is not given one', async () => {
    const {fetch, calls} = gateway(() => json({outcome: 'kept'}));
    const before = Math.floor(Date.now() / 1000);
    await createGatewayClient(configured(), {fetch}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    const result = await verifyCommand(tokenOf(calls[0]), before);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.iat).toBeGreaterThanOrEqual(before);
  });

  it('refuses claims the gateway would refuse, before anything is sent: a path-like ID is never signed', async () => {
    const {fetch} = gateway(() => json({outcome: 'deleted'}));
    const client = createGatewayClient(configured(), {fetch});
    await expect(client.deleteStaging({accountId: ACCOUNT, uploadId: '../../x'})).rejects.toBeInstanceOf(TypeError);
    await expect(client.deleteStaging({accountId: ACCOUNT.toUpperCase(), uploadId: UPLOAD})).rejects.toBeInstanceOf(TypeError);
    await expect(client.deleteRoot({accountId: ACCOUNT, root: 'objects/../x'})).rejects.toBeInstanceOf(TypeError);
    await expect(client.deleteRoot({accountId: ACCOUNT, root: ROOT.toUpperCase()})).rejects.toBeInstanceOf(TypeError);
    await expect(client.attach({accountId: ACCOUNT, epoch: 0, uploadId: UPLOAD, transform: 'none'})).rejects.toBeInstanceOf(TypeError);
    await expect(client.attach({accountId: ACCOUNT, epoch: 1, uploadId: UPLOAD, transform: '../none'})).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('what each command answers', () => {
  it('deleteStaging says deleted or kept', async () => {
    for (const outcome of ['deleted', 'kept'] as const) {
      const {fetch} = gateway(() => json({outcome}));
      expect(await createGatewayClient(configured(), {fetch}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD})).toEqual({outcome});
    }
  });

  it('deleteRoot says deleted', async () => {
    const {fetch} = gateway(() => json({outcome: 'deleted'}));
    expect(await createGatewayClient(configured(), {fetch}).deleteRoot({accountId: ACCOUNT, root: ROOT})).toEqual({outcome: 'deleted'});
  });

  it('attach returns the manifest, published or already there', async () => {
    for (const outcome of ['published', 'exists'] as const) {
      const manifest = {id: UPLOAD, root: ROOT, digest: 'ef'.repeat(32), length: 2048, kind: 'picture'};
      const {fetch} = gateway(() => json({outcome, manifest}));
      expect(await createGatewayClient(configured(), {fetch}).attach({accountId: ACCOUNT, epoch: 2, uploadId: UPLOAD, transform: 'none'})).toEqual({outcome, manifest});
    }
  });

  it.each([
    ['deleteStaging', {outcome: 'purged'}],
    ['deleteStaging', {outcome: 'published'}],
    ['deleteStaging', {}],
    ['deleteStaging', [{outcome: 'deleted'}]],
    ['deleteStaging', 'deleted'],
    ['deleteStaging', null],
    ['deleteRoot', {outcome: 'kept'}],
    ['deleteRoot', {}],
    ['attach', {outcome: 'deleted', manifest: {}}],
    ['attach', {outcome: 'published'}],
    ['attach', {outcome: 'published', manifest: null}],
    ['attach', {outcome: 'published', manifest: {id: UPLOAD, root: ROOT, digest: ROOT, length: '5', kind: 'file'}}],
    ['attach', {outcome: 'published', manifest: {id: UPLOAD, root: ROOT, digest: ROOT, length: 5}}],
    ['attach', {outcome: 'exists', manifest: {id: 5, root: ROOT, digest: ROOT, length: 5, kind: 'file'}}],
  ] as const)('%s treats a 200 that says %j as a refusal, not as success', async (method, body) => {
    const {fetch} = gateway(() => json(body));
    const client = createGatewayClient(configured(), {fetch});
    const call = {
      deleteStaging: () => client.deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD}),
      deleteRoot: () => client.deleteRoot({accountId: ACCOUNT, root: ROOT}),
      attach: () => client.attach({accountId: ACCOUNT, epoch: 1, uploadId: UPLOAD, transform: 'none'}),
    }[method];
    await expect(call()).rejects.toMatchObject({name: 'GatewayError', status: 200});
  });

  it('treats a 200 whose body is not JSON as a refusal too', async () => {
    const {fetch} = gateway(() => new Response('<html>ok</html>', {status: 200}));
    await expect(createGatewayClient(configured(), {fetch}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD})).rejects.toBeInstanceOf(GatewayError);
  });
});

describe('when the gateway does not do it', () => {
  it.each([400, 401, 403, 404, 409, 413, 500, 503])('throws a GatewayError carrying the status for a %s, and only the status', async (status) => {
    const {fetch, calls} = gateway(() => json({error: 'something the gateway said'}, status));
    const attempt = createGatewayClient(configured(), {fetch}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    await expect(attempt).rejects.toBeInstanceOf(GatewayError);
    const error = (await attempt.then(
      () => null,
      (caught: unknown) => caught,
    )) as GatewayError;
    expect(error.status).toBe(status);
    expect(error.name).toBe('GatewayError');
    // The error says nothing of the token, the address or what the gateway answered: it is recorded by class name, and printed nowhere.
    expect(error.message).not.toContain(tokenOf(calls[0]));
    expect(error.message).not.toContain(GATEWAY);
    expect(error.message).not.toContain('something the gateway said');
  });

  it('throws a GatewayError for a non-2xx answer that is not JSON either', async () => {
    const {fetch} = gateway(() => new Response('Bad Gateway', {status: 502}));
    await expect(createGatewayClient(configured(), {fetch}).deleteRoot({accountId: ACCOUNT, root: ROOT})).rejects.toMatchObject({name: 'GatewayError', status: 502});
  });

  it('throws a GatewayUnavailableError when the gateway cannot be reached, with nothing of the call in it', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${GATEWAY} with Command secret-token`);
    });
    const attempt = createGatewayClient(configured(), {fetch: failing as never}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD});
    await expect(attempt).rejects.toBeInstanceOf(GatewayUnavailableError);
    const error = (await attempt.then(
      () => null,
      (caught: unknown) => caught,
    )) as Error;
    expect(error.name).toBe('GatewayUnavailableError');
    expect(error.message).not.toContain(GATEWAY);
    expect(error.message).not.toContain('secret-token');
  });

  it('throws a GatewayUnavailableError when the gateway does not answer in time: the timeout is the call\'s own', async () => {
    const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))));
    await expect(createGatewayClient(configured(), {fetch: hanging as never, timeoutMs: 25}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD})).rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it('throws a GatewayUnavailableError for a redirect, which the call refuses to follow (the token never leaves for another address)', async () => {
    const redirecting = vi.fn(async () => {
      throw new TypeError('fetch failed', {cause: new Error('unexpected redirect')});
    });
    await expect(createGatewayClient(configured(), {fetch: redirecting as never}).deleteStaging({accountId: ACCOUNT, uploadId: UPLOAD})).rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it('names its errors so a receipt can record the class: a capital letter and letters only', () => {
    for (const error of [new GatewayError(500), new GatewayUnavailableError()]) expect(error.name).toMatch(/^[A-Z][A-Za-z]{0,47}$/);
    expect(new GatewayError(409).status).toBe(409);
  });
});

describe('configuredGatewayClient', () => {
  it('is null when the deployment is not configured for a gateway, so the cleanup records no_store', () => {
    expect(configuredGatewayClient({})).toBeNull();
    for (const name of ['SERVICE_SIGNING_KEY_APPLICATION', 'SERVICE_KEYS_APPLICATION', 'FILE_GATEWAY_URL', 'INSTANCE_ID']) expect(configuredGatewayClient(env({[name]: undefined})), name).toBeNull();
  });

  it('is a client with the three commands when it is', async () => {
    const {fetch, calls} = gateway(() => json({outcome: 'deleted'}));
    const client = configuredGatewayClient(env(), {fetch});
    expect(client).not.toBeNull();
    expect(Object.keys(client!).sort()).toEqual(['attach', 'deleteRoot', 'deleteStaging']);
    await client!.deleteRoot({accountId: ACCOUNT, root: ROOT});
    expect(calls[0].url).toBe(`${GATEWAY}/v1/commands`);
  });

  it('reads the process environment when it is given none', () => {
    vi.stubEnv('FILE_GATEWAY_URL', '');
    expect(configuredGatewayClient()).toBeNull();
    vi.unstubAllEnvs();
  });

  it('holds the config it was built from as a plain value', () => {
    const config: SigningConfig = configured();
    expect(Object.keys(config).sort()).toEqual(['gateway', 'instanceId', 'keySet', 'signer']);
  });
});
