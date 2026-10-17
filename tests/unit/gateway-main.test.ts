import {randomBytes, randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {signTicket, type TicketClaims} from '../../lib/service-signing';
import {exitOnSignals, shutdownGraceMs, start, type Started} from '../../workers/files/src/main';
import {fakeClock, fakeDatabase, fakeStorage, sha256} from '../support/gateway-fakes';
import {testSigner} from '../support/service-keys';

// The gateway's start-up and shutdown (workers/files/src/main.ts), with the fakes. Start-up is covered with the real stack in
// tests/integration/file-gateway.test.ts (a wrong instance, a missing variable, a database that cannot be asked). Story 1.12 review (P12): the finding was
// real. `close()` cut every connection at once, so the ten seconds the old code meant to give never applied, and every deploy cut every transfer in flight.

const INSTANCE = '3f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const keys = testSigner();
const T0 = Date.parse('2026-10-15T12:00:00.000Z');

const environment = () => ({
  APP_ENV: 'local',
  INSTANCE_ID: INSTANCE,
  APP_ORIGIN: 'http://127.0.0.1:4173',
  SERVICE_KEYS_APPLICATION: keys.json,
  GATEWAY_DATABASE_URL: 'postgresql://nova3d_gateway@127.0.0.1:5432/postgres',
  GATEWAY_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:1/s3',
  GATEWAY_STORAGE_S3_REGION: 'local',
  GATEWAY_STORAGE_S3_ACCESS_KEY_ID: 'id',
  GATEWAY_STORAGE_S3_SECRET_ACCESS_KEY: 'a-secret-that-must-never-be-printed',
});

const running: Started[] = [];
afterEach(async () => {
  while (running.length) await running.pop()!.close().catch(() => undefined);
});

async function gateway() {
  const clock = fakeClock(T0);
  const database = fakeDatabase({clock, instanceId: INSTANCE});
  const storage = fakeStorage();
  const started = await start(environment(), {database, storage, port: 0, host: '127.0.0.1', clock: clock.now});
  running.push(started);
  const member = database.addMember();
  const stage = (size: number) => {
    const bytes = randomBytes(size);
    const id = randomUUID();
    database.seedLease({id, accountId: member.accountId, kind: 'file', length: size, sha256: sha256(bytes), contentType: 'application/octet-stream', state: 'complete', receivedLength: size});
    storage.objects.set(`staging/${member.accountId}/${id}`, {bytes, contentType: 'application/octet-stream'});
    return {id, bytes};
  };
  const ticket = (id: string) =>
    signTicket(keys.signer, INSTANCE, {acct: member.accountId, sid: member.sessionId, epoch: member.epoch, tk: 'staging', tid: id, dir: 'download'} as unknown as TicketClaims, {now: clock.seconds()});
  const url = `http://127.0.0.1:${started.port}`;
  /** A download that reads to its end (or to the cut), and when it did. */
  const download = (id: string) =>
    new Promise<{status: number; body: Buffer; complete: boolean; at: number}>((resolve) => {
      const req = http.get(`${url}/v1/files/staging/${id}`, {headers: {authorization: `Ticket ${ticket(id)}`}, agent: false}, (res) => {
        const parts: Buffer[] = [];
        res.on('data', (part: Buffer) => parts.push(part));
        res.on('error', () => undefined);
        res.on('close', () => resolve({status: res.statusCode ?? 0, body: Buffer.concat(parts), complete: res.complete, at: Date.now()}));
      });
      // A request that is cut before its headers are out never gets an answer: it fails, which is a transfer that did not complete.
      req.on('error', () => resolve({status: 0, body: Buffer.alloc(0), complete: false, at: Date.now()}));
    });
  return {started, storage, stage, download, url};
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const refused = (url: string) =>
  new Promise<boolean>((resolve) => {
    const req = http.get(`${url}/healthz`, {agent: false}, (res) => {
      res.resume();
      resolve(false);
    });
    req.on('error', () => resolve(true));
  });

describe('a graceful shutdown', () => {
  it('lets a request that is in flight finish, refuses new connections from then on, and resolves only when the request is done', async () => {
    const world = await gateway();
    const {id, bytes} = world.stage(2 * 1024 * 1024);
    // Each piece of the object takes a moment to read, so the download is well under way when the shutdown starts.
    world.storage.beforeRead = () => wait(15);
    const request = world.download(id);
    await wait(150);
    const began = Date.now();
    const shutdown = world.started.shutdown(8000).then(() => Date.now());
    await wait(50);
    expect(await refused(world.url), 'a new connection during the shutdown').toBe(true);
    const done = await request;
    const finished = await shutdown;
    expect([done.status, done.complete, done.body.equals(bytes)]).toEqual([200, true, true]);
    // The shutdown waited for the transfer, and then did not wait for the grace.
    expect(finished).toBeGreaterThanOrEqual(done.at - 20);
    expect(finished - began).toBeLessThan(6000);
  });

  it('cuts what is still running when the grace is over, and resolves then', async () => {
    const world = await gateway();
    const {id, bytes} = world.stage(2 * 1024 * 1024);
    world.storage.beforeRead = () => wait(100);
    const request = world.download(id);
    await wait(300);
    const began = Date.now();
    await world.started.shutdown(400);
    const elapsed = Date.now() - began;
    const done = await request;
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(3000);
    expect(done.complete).toBe(false);
    expect(done.body.length).toBeLessThan(bytes.length);
  });

  it('closes a connection that is idle at once, and does not wait for its keep-alive timeout', async () => {
    const world = await gateway();
    const agent = new http.Agent({keepAlive: true, maxSockets: 1});
    await new Promise<void>((resolve, reject) => {
      http.get(`${world.url}/healthz`, {agent}, (res) => {
        res.resume();
        res.on('end', resolve);
      }).on('error', reject);
    });
    const began = Date.now();
    await world.started.shutdown(8000);
    expect(Date.now() - began).toBeLessThan(1500);
    agent.destroy();
  });

  it('is an immediate stop for `close`, which the tests use: every connection is cut', async () => {
    const world = await gateway();
    const {id} = world.stage(2 * 1024 * 1024);
    world.storage.beforeRead = () => wait(100);
    const request = world.download(id);
    await wait(250);
    const began = Date.now();
    await world.started.close();
    expect(Date.now() - began).toBeLessThan(1500);
    expect((await request).complete).toBe(false);
  });

  it('gives ten seconds by default', () => {
    expect(shutdownGraceMs).toBe(10_000);
  });
});

describe('the process stops on SIGTERM and SIGINT', () => {
  const signalsOf = () => new EventEmitter() as EventEmitter & Pick<NodeJS.Process, 'on'>;

  it('shuts down gracefully on SIGTERM: a request in flight finishes, and then the process exits 0 (once)', async () => {
    const world = await gateway();
    const {id, bytes} = world.stage(2 * 1024 * 1024);
    world.storage.beforeRead = () => wait(15);
    const signals = signalsOf();
    const exit = vi.fn();
    exitOnSignals(world.started, {signals, exit, graceMs: 8000});
    const request = world.download(id);
    await wait(150);
    signals.emit('SIGTERM');
    const done = await request;
    expect([done.status, done.complete, done.body.equals(bytes)]).toEqual([200, true, true]);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1), {timeout: 5000});
    expect(exit).toHaveBeenCalledWith(0);
    expect(exit.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  it('stops at once on a second signal while it waits: what is in flight is cut', async () => {
    const world = await gateway();
    const {id} = world.stage(2 * 1024 * 1024);
    world.storage.beforeRead = () => wait(100);
    const signals = signalsOf();
    const exit = vi.fn();
    exitOnSignals(world.started, {signals, exit, graceMs: 20_000});
    const request = world.download(id);
    await wait(250);
    signals.emit('SIGINT');
    await wait(50);
    expect(exit).not.toHaveBeenCalled();
    signals.emit('SIGINT');
    expect((await request).complete).toBe(false);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), {timeout: 5000});
  });

  it('exits 1 when the shutdown fails, and still exits', async () => {
    const exit = vi.fn();
    const signals = signalsOf();
    exitOnSignals({server: {closeAllConnections: vi.fn()} as unknown as Started['server'], shutdown: async () => Promise.reject(new Error('could not close'))}, {signals, exit, graceMs: 100});
    signals.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), {timeout: 2000});
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('has a backstop for a shutdown that never returns: it exits 1 five seconds after the grace', async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const signals = signalsOf();
      exitOnSignals({server: {closeAllConnections: vi.fn()} as unknown as Started['server'], shutdown: () => new Promise<void>(() => undefined)}, {signals, exit, graceMs: 1000});
      signals.emit('SIGTERM');
      await vi.advanceTimersByTimeAsync(5900);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('listens for both signals the platform sends, and nothing else', () => {
    const signals = signalsOf();
    exitOnSignals({server: {closeAllConnections: vi.fn()} as unknown as Started['server'], shutdown: async () => undefined}, {signals, exit: vi.fn()});
    expect(signals.eventNames().sort()).toEqual(['SIGINT', 'SIGTERM']);
  });
});
