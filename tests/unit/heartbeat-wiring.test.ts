import {describe, expect, it} from 'vitest';
import {handleHeartbeatRequest} from '@/lib/heartbeat';
import {run} from '../../workers/heartbeat/src/main';
import {env as databaseEnv, fakeDatabase, json, sender} from '../support/alarm-fakes';
import {testKeys} from '../support/service-keys';

// The heartbeat task (workers/heartbeat) and the route it posts to (lib/heartbeat.ts) agree, with no network between them: the task's `fetch` is the route's
// handler, the database behind the route is the stand-in of tests/support/alarm-fakes.ts. What each does alone is tests/unit/heartbeat-worker.test.ts and
// tests/unit/heartbeat-route.test.ts; this is the pair, the way Railway and the application meet, and tests/e2e/heartbeat.spec.ts is the pair over HTTP.
const INSTANCE = '3f1c8a5e-7b2d-4c6a-9e0f-1a2b3c4d5e6f';
const ORIGIN = 'https://nova3d-staging.example.test';
const keys = testKeys({issuer: 'heartbeat', active: 'heartbeat-1'});

const workerEnv = {
  APP_ENV: 'staging',
  INSTANCE_ID: INSTANCE,
  APP_ORIGIN: ORIGIN,
  SERVICE_KEYS_HEARTBEAT: keys.json,
  SERVICE_SIGNING_KEY_HEARTBEAT: keys.privateKey,
};
const applicationEnv = {...databaseEnv, INSTANCE_ID: INSTANCE, APP_ENV: 'staging', SERVICE_KEYS_HEARTBEAT: keys.json};

function meeting(appEnv: Record<string, string | undefined> = applicationEnv) {
  const database = fakeDatabase();
  const mail = sender();
  const requests: {url: string; method: string | undefined; hasBody: boolean; authorization: string | null}[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({url, method: init?.method, hasBody: init?.body !== undefined && init.body !== null, authorization: headers.get('authorization')?.split(' ')[0] ?? null});
    // The task posts to `<APP_ORIGIN>/api/heartbeat`; the application's route answers for it.
    return handleHeartbeatRequest(new Request(url, init), { env: appEnv, accounts: {fetch: database.fetch as never}, alarms: {send: mail.send} });
  };
  const lines: string[] = [];
  const errors: string[] = [];
  const task = (env: Record<string, string | undefined> = workerEnv) => run(env, {fetch, log: (line) => lines.push(line), error: (line) => errors.push(line)});
  return {database, mail, requests, task, lines, errors};
}

describe('the heartbeat task and the route it posts to', () => {
  it('meet: the task signs a token the route accepts, exits 0, prints one fixed line, and the application records one heartbeat for its key', async () => {
    const {database, task, requests, lines, errors} = meeting();
    expect(await task()).toBe(0);
    expect(lines).toEqual(['The heartbeat was recorded.']);
    expect(errors).toEqual([]);
    expect(requests).toEqual([{ url: `${ORIGIN}/api/heartbeat`, method: 'POST', hasBody: false, authorization: 'Heartbeat' }]);
    expect(database.heartbeats).toEqual([{ jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), kid: 'test-heartbeat-1' }]);
  });

  it('signs a new token every run, so a second run is accepted too and a replay of the first is the only thing refused', async () => {
    const {database, task} = meeting();
    expect(await task()).toBe(0);
    expect(await task()).toBe(0);
    expect(new Set(database.heartbeats.map((heartbeat) => heartbeat.jti)).size).toBe(2);
  });

  it('exits 1, prints a fixed line and records nothing when the application refuses it: another environment (401), a revoked key (401), no key set in the application (503)', async () => {
    const other = meeting();
    expect(await other.task({...workerEnv, INSTANCE_ID: '4f1c8a5e-7b2d-4c6a-9e0f-1a2b3c4d5e6f'})).toBe(1);
    expect(other.errors).toEqual(['The heartbeat was not accepted.']);
    expect(other.database.heartbeats).toEqual([]);

    const revoked = meeting();
    revoked.database.revokedKeys.add('test-heartbeat-1');
    expect(await revoked.task()).toBe(1);
    expect(revoked.errors).toEqual(['The heartbeat was not accepted.']);

    const unconfigured = meeting({...applicationEnv, SERVICE_KEYS_HEARTBEAT: undefined});
    expect(await unconfigured.task()).toBe(1);
    expect(unconfigured.errors).toEqual(['The heartbeat was not accepted.']);
    expect(unconfigured.database.heartbeats).toEqual([]);
  });

  it('exits 1 when the application cannot answer (the database is down): the run is marked failed on Railway, and no heartbeat is recorded', async () => {
    const {database, task, errors} = meeting();
    database.fail.record_heartbeat = () => json({message: 'down'}, 503);
    expect(await task()).toBe(1);
    expect(errors).toEqual(['The heartbeat was not accepted.']);
    expect(database.heartbeats).toEqual([]);
  });

  it('is what raises `qstash-stale`: a heartbeat finds the latest scheduler receipt over two hours old, the application raises the alarm and emails it, and the next heartbeat with a fresh receipt resolves it', async () => {
    const {database, mail, task} = meeting();
    database.observed.value.latest_receipt_age = 7300;
    expect(await task()).toBe(0);
    expect(database.alarms).toEqual([expect.objectContaining({condition: 'qstash-stale', resolvedAt: null})]);
    expect(mail.mails).toHaveLength(1);
    database.advance(30 * 60_000);
    database.observed.value.latest_receipt_age = 12;
    expect(await task()).toBe(0);
    expect(database.alarms[0].resolvedAt).not.toBeNull();
    expect(mail.mails).toHaveLength(1);
  });
});
