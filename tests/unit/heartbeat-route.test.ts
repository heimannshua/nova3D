import {randomUUID} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {handleHeartbeatRequest, heartbeatScheme, isHeartbeatConfigured, maxHeartbeatBodyBytes, type HeartbeatRequestOptions} from '@/lib/heartbeat';
import {signHeartbeat, signToken, type Signer} from '@/lib/service-signing';
import {calm, env as databaseEnv, fakeDatabase, json, sender, type Database} from '../support/alarm-fakes';
import {signRaw, testSigner} from '../support/service-keys';

// The heartbeat route (Story 1.13, lib/heartbeat.ts): every status, the order of the checks, and that a refused call records and evaluates nothing. The tokens are
// real (signed with the tests' own heartbeat key, tests/support/service-keys.ts) and verified by the real `verifyToken`; the database is the stand-in of
// tests/support/alarm-fakes.ts. The wiring over HTTP is tests/e2e/heartbeat.spec.ts and the real functions are tests/integration/alarms.test.ts.
const INSTANCE = '3f1c8a5e-7b2d-4c6a-9e0f-1a2b3c4d5e6f';
const NOW = 1_800_000_000;
const heartbeat = testSigner({issuer: 'heartbeat', active: 'heartbeat-1'});
const stranger = testSigner({issuer: 'heartbeat', active: 'heartbeat-stranger'});
const applicationKey = testSigner({issuer: 'application'});

const env = {...databaseEnv, INSTANCE_ID: INSTANCE, SERVICE_KEYS_HEARTBEAT: heartbeat.json, APP_ENV: 'local'};

const token = (options: {signer?: Signer; now?: number; lifetimeSeconds?: number; jti?: string; environment?: string} = {}) =>
  signHeartbeat(options.signer ?? heartbeat.signer, options.environment ?? INSTANCE, {now: options.now ?? NOW, ...(options.lifetimeSeconds === undefined ? {} : {lifetimeSeconds: options.lifetimeSeconds}), ...(options.jti ? {jti: options.jti} : {})});

type Call = {method?: string; headers?: Record<string, string | null>; body?: string | Uint8Array | null; token?: string | null};
function request({method = 'POST', headers = {}, body = null, token: tokenText = token()}: Call = {}) {
  const sent = new Headers();
  if (tokenText !== null) sent.set('authorization', `${heartbeatScheme} ${tokenText}`);
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) sent.delete(name);
    else sent.set(name, value);
  }
  return new Request('http://127.0.0.1:4173/api/heartbeat', {method, headers: sent, ...(body === null ? {} : {body: body as BodyInit})});
}

function world(change: Partial<HeartbeatRequestOptions> = {}, database: Database = fakeDatabase(), mail = sender()) {
  const options: HeartbeatRequestOptions = {env, accounts: {fetch: database.fetch as never}, now: () => NOW, alarms: {send: mail.send}, ...change};
  const call = (input?: Call) => handleHeartbeatRequest(request(input), options);
  return {database, mail, call, options};
}

afterEach(() => vi.restoreAllMocks());

describe('a heartbeat that is accepted', () => {
  it('answers 200 `recorded` with the age of the latest receipt, records one heartbeat for the key and the token, and is never cached', async () => {
    const {call, database} = world();
    const jti = 'AAAAAAAAAAAAAAAAAAAAAA';
    const response = await call({token: token({jti})});
    expect([response.status, await response.json()]).toEqual([200, {state: 'recorded', receipt_age_seconds: 60}]);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(database.heartbeats).toEqual([{jti, kid: 'test-heartbeat-1'}]);
  });

  it('answers null when no scheduler task has left a receipt yet', async () => {
    const database = fakeDatabase();
    database.observed.value = {...calm(), first_receipt_age: null, latest_receipt_age: null, tasks: []};
    const response = await world({}, database).call();
    expect([response.status, await response.json()]).toEqual([200, {state: 'recorded', receipt_age_seconds: null}]);
  });

  it('accepts a body of up to 16 bytes and ignores it', async () => {
    for (const body of [new Uint8Array(0), new Uint8Array(16).fill(0xff), '{"a":"bcdefghijkl"}'.slice(0, 16)]) {
      const response = await world().call({body, headers: {'content-type': 'application/octet-stream'}});
      expect(response.status).toBe(200);
    }
    expect(maxHeartbeatBodyBytes).toBe(16);
  });

  it('accepts a token that is still valid but was issued a minute ahead of this clock (the contract\'s skew), and one at the end of its five minutes', async () => {
    expect((await world().call({token: token({now: NOW + 60})})).status).toBe(200);
    expect((await world().call({token: token({now: NOW - 300})})).status).toBe(200);
  });
});

describe('what raises the alarm (QStash stopped)', () => {
  it('evaluates qstash-stale when the heartbeat arrives: an alarm and an email when the latest receipt is over two hours old, resolved by a later heartbeat with a fresh receipt', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.observed.value.latest_receipt_age = 7201;
    const first = await world({}, database, mail).call();
    expect([first.status, await first.json()]).toEqual([200, {state: 'recorded', receipt_age_seconds: 7201}]);
    expect(database.alarms).toEqual([expect.objectContaining({condition: 'qstash-stale', subject: null, resolvedAt: null})]);
    expect(mail.mails).toEqual([expect.objectContaining({condition: 'qstash-stale', subject: null})]);

    database.advance(30 * 60_000);
    database.observed.value.latest_receipt_age = 20;
    const second = await world({}, database, mail).call();
    expect([second.status, await second.json()]).toEqual([200, {state: 'recorded', receipt_age_seconds: 20}]);
    expect(database.alarms).toHaveLength(1);
    expect(database.alarms[0].resolvedAt).not.toBeNull();
    expect(mail.mails).toHaveLength(1);
  });

  it('does not touch the monitor\'s conditions', async () => {
    const database = fakeDatabase();
    database.observed.value.unaccounted = 90;
    expect((await world({}, database).call()).status).toBe(200);
    expect(database.alarms).toEqual([]);
  });

  it('is still a 200 when the mailer fails: the alarm is recorded and the email is retried by the next evaluation', async () => {
    const database = fakeDatabase();
    const mail = sender([{outcome: 'refused', reason: 'provider_refused'}]);
    database.observed.value.latest_receipt_age = 9000;
    expect((await world({}, database, mail).call()).status).toBe(200);
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['failed']);
    expect(database.openAlarms()).toHaveLength(1);
  });
});

describe('a heartbeat that is refused', () => {
  const refusedWith = async (call: Promise<Response>, status: number, body: unknown) => {
    const response = await call;
    expect([response.status, await response.json()]).toEqual([status, body]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  };

  it('answers 409 `duplicate` for a token that was accepted already, and evaluates and mails nothing the second time', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.observed.value.latest_receipt_age = 9000;
    const same = token();
    await refusedWith(world({}, database, mail).call({token: same}), 200, { state: 'recorded', receipt_age_seconds: 9000 });
    const calls = database.calls.length;
    await refusedWith(world({}, database, mail).call({token: same}), 409, {state: 'duplicate'});
    expect(database.heartbeats).toHaveLength(1);
    // Only the record was asked: no observation, no alarm, no mail.
    expect(database.calls.slice(calls)).toEqual(['record_heartbeat']);
    expect(mail.mails).toHaveLength(1);
  });

  it('answers 401 with ONE body for a revoked key, and records nothing', async () => {
    const database = fakeDatabase();
    database.revokedKeys.add('test-heartbeat-1');
    await refusedWith(world({}, database).call(), 401, {error: 'invalid_token'});
    expect(database.heartbeats).toEqual([]);
    expect(database.calls).toEqual(['record_heartbeat']);
  });

  const forgeries: [string, () => string | null][] = [
    ['no Authorization header', () => null],
    ['not a token', () => 'not.a.token'],
    ['an empty token', () => ''],
    ['a token for another issuer (the application\'s key)', () => signToken(applicationKey.signer, {audience: 'application', environment: INSTANCE, type: 'heartbeat', claims: {}, now: NOW})],
    ['a token claiming the heartbeat issuer, signed by a key the set does not name', () => signHeartbeat(stranger.signer, INSTANCE, {now: NOW})],
    ['a token for another audience', () => signToken(heartbeat.signer, {audience: 'gateway', environment: INSTANCE, type: 'heartbeat', claims: {}, now: NOW})],
    ['a token for another environment', () => token({environment: randomUUID()})],
    ['a token of another type', () => signToken(heartbeat.signer, {audience: 'application', environment: INSTANCE, type: 'ticket', claims: {}, now: NOW})],
    ['a token with a claim beyond the standard ones', () => signToken(heartbeat.signer, {audience: 'application', environment: INSTANCE, type: 'heartbeat', claims: {acct: randomUUID()}, now: NOW})],
    ['an expired token', () => token({now: NOW - 301})],
    ['a token issued more than a minute ahead', () => token({now: NOW + 61})],
    ['a tampered payload', () => {
      const parts = token().split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      payload.env = payload.env.replace(/^./, 'a');
      return [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.');
    }],
    ['a tampered signature', () => {
      const parts = token().split('.');
      return [parts[0], parts[1], Buffer.alloc(64, 1).toString('base64url')].join('.');
    }],
    ['a token that is far too long', () => 'a'.repeat(5000)],
  ];
  it.each(forgeries)('answers 401 with the one body for %s, and records and evaluates nothing', async (_name, make) => {
    const database = fakeDatabase();
    const mail = sender();
    const forged = make();
    await refusedWith(world({}, database, mail).call({token: forged}), 401, {error: 'invalid_token'});
    expect(database.calls).toEqual([]);
    expect(mail.mails).toEqual([]);
  });

  // Review patch P3. The signature is valid; the `jti` is not one `api.record_heartbeat` accepts (it takes exactly 22 characters of A-Z a-z 0-9 _ -). The answer is the
  // one 401 `invalid_token`, never a 503 for a call that is not the application's fault, and the database is not asked. (`verifyToken` holds the same shape, so it refuses
  // most of these first; the route holds the database's own pattern too, and this is the case for both.)
  it.each([
    ['one character short', 'A'.repeat(21)],
    ['one character long', 'A'.repeat(23)],
    ['padded like base64', `${'A'.repeat(21)}=`],
    ['with a dot', `${'A'.repeat(10)}.${'A'.repeat(11)}`],
    ['with a plus', `${'A'.repeat(21)}+`],
    ['with a slash', `${'A'.repeat(21)}/`],
    ['22 characters and a line break after', `${'A'.repeat(22)}\n`],
    ['22 characters with a line break in them', `${'A'.repeat(10)}\n${'A'.repeat(11)}`],
    ['not ASCII', `${'A'.repeat(21)}\u00e9`],
    ['a space', `${'A'.repeat(21)} `],
    ['empty', ''],
    ['a number', 12345678901234567890123 as never],
  ])('answers 401 with the one body for a validly signed token whose jti is %s, and asks the database nothing', async (_name, jti) => {
    const database = fakeDatabase();
    const mail = sender();
    const forged = signRaw(heartbeat.signer, {iss: 'heartbeat', aud: 'application', env: INSTANCE, jti, iat: NOW, exp: NOW + 300, typ: 'heartbeat'});
    await refusedWith(world({}, database, mail).call({token: forged}), 401, {error: 'invalid_token'});
    expect(database.calls).toEqual([]);
    expect(database.heartbeats).toEqual([]);
    expect(mail.mails).toEqual([]);
  });

  it('records the same token with a jti of exactly the database\'s shape: 22 characters of A-Z a-z 0-9 _ - (the control for the cases above)', async () => {
    const database = fakeDatabase();
    const good = signRaw(heartbeat.signer, {iss: 'heartbeat', aud: 'application', env: INSTANCE, jti: 'Az09_-Az09_-Az09_-Az09', iat: NOW, exp: NOW + 300, typ: 'heartbeat'});
    await refusedWith(world({}, database).call({token: good}), 200, {state: 'recorded', receipt_age_seconds: 60});
    expect(database.heartbeats).toEqual([{jti: 'Az09_-Az09_-Az09_-Az09', kid: 'test-heartbeat-1'}]);
  });

  it('answers 401 for a header that is not `Heartbeat <token>`: another scheme, no space, two tokens, a bearer', async () => {
    const good = token();
    for (const header of [`Bearer ${good}`, `Heartbeat${good}`, `Heartbeat ${good} ${good}`, `heartbeat ${good}`, `Heartbeat  ${good}`, `Ticket ${good}`, good]) {
      await refusedWith(world().call({token: null, headers: {authorization: header}}), 401, {error: 'invalid_token'});
    }
  });

  it('answers 403 when an Origin header is present, whatever the token, and records and evaluates nothing', async () => {
    const database = fakeDatabase();
    for (const origin of ['http://127.0.0.1:4173', 'https://evil.example', 'null', '']) {
      await refusedWith(world({}, database).call({headers: {origin}}), 403, {error: 'forbidden_origin'});
    }
    await refusedWith(world({}, database).call({headers: {origin: 'https://evil.example'}, token: 'garbage'}), 403, {error: 'forbidden_origin'});
    expect(database.calls).toEqual([]);
  });

  it('answers 400 for a body over 16 bytes, a content-length that is not a number or is over the cap, and records nothing', async () => {
    const database = fakeDatabase();
    await refusedWith(world({}, database).call({body: new Uint8Array(17)}), 400, {error: 'invalid_request'});
    await refusedWith(world({}, database).call({body: 'x'.repeat(5000)}), 400, {error: 'invalid_request'});
    await refusedWith(world({}, database).call({headers: {'content-length': 'abc'}}), 400, {error: 'invalid_request'});
    await refusedWith(world({}, database).call({headers: {'content-length': '17'}}), 400, {error: 'invalid_request'});
    expect(database.calls).toEqual([]);
    expect(database.heartbeats).toEqual([]);
  });

  it('answers 405 to every other method, with Allow: POST', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
      const response = await world().call({method});
      expect(response.status, method).toBe(405);
      expect(response.headers.get('allow'), method).toBe('POST');
      expect(response.headers.get('cache-control'), method).toBe('no-store');
    }
  });

  it('checks in the order the contract says: the method, then the Origin, then the configuration, then the token, then the body, then the record', async () => {
    const database = fakeDatabase();
    const unset = {...env, SERVICE_KEYS_HEARTBEAT: undefined};
    const calls = (input: Call, options: Partial<HeartbeatRequestOptions> = {}) => handleHeartbeatRequest(request(input), {...world({}, database).options, ...options});
    // GET with an Origin and no token: the method first.
    expect((await calls({method: 'GET', headers: {origin: 'https://evil.example'}, token: null})).status).toBe(405);
    // An Origin with the configuration missing: the Origin first.
    expect((await calls({headers: {origin: 'https://evil.example'}}, {env: unset})).status).toBe(403);
    // The configuration missing with a bad token: the configuration first.
    expect((await calls({token: 'garbage'}, {env: unset})).status).toBe(503);
    // A bad token with a bad body: the token first.
    expect((await calls({token: 'garbage', body: new Uint8Array(40)})).status).toBe(401);
    // A good token with a bad body: the body before anything is recorded.
    expect((await calls({body: new Uint8Array(40)})).status).toBe(400);
    expect(database.calls).toEqual([]);
  });
});

describe('a heartbeat the application cannot answer (never a 200 that skipped the evaluation)', () => {
  const unavailable = async (call: Promise<Response>) => {
    const response = await call;
    expect([response.status, await response.json()]).toEqual([503, {error: 'unavailable'}]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  };

  it('answers 503 when SERVICE_KEYS_HEARTBEAT is unset, blank, a placeholder or not a key set', async () => {
    for (const value of [undefined, '', '   ', 'replace-with-the-heartbeat-key-set', 'not json', '{"issuer":"application","active":"a","retiring":null,"keys":{}}', stranger.json.replace('heartbeat-stranger', 'x').replace('"issuer":"heartbeat"', '"issuer":"gateway"')]) {
      const database = fakeDatabase();
      await unavailable(world({env: {...env, SERVICE_KEYS_HEARTBEAT: value}}, database).call());
      expect(database.calls, String(value)).toEqual([]);
    }
  });

  it('answers 503 when INSTANCE_ID is unset', async () => {
    await unavailable(world({env: {...env, INSTANCE_ID: undefined}}).call());
    await unavailable(world({env: {...env, INSTANCE_ID: ' '}}).call());
  });

  it('answers 503 when the database does not answer the record, and records nothing', async () => {
    const database = fakeDatabase();
    database.fail.record_heartbeat = () => json({message: 'down'}, 503);
    await unavailable(world({}, database).call());
    expect(database.heartbeats).toEqual([]);
    const gone = fakeDatabase();
    await unavailable(world({accounts: {fetch: (async () => { throw new TypeError('fetch failed'); }) as never}}, gone).call());
  });

  // CHANGED (review patch P2): `record_alarm_notice` used to be in this list. A notice that cannot be recorded after the mail was sent no longer fails the
  // evaluation (it is counted as a failed mail, the alarms behind it are still mailed, and the alarm is mailed again next time); the evaluation itself, the
  // part the 503 stands for, has run. The case is the next test.
  it.each(['alarm_observations', 'list_alarms', 'alarms_due_mail', 'raise_alarm'])('answers 503 when the evaluation fails at %s', async (name) => {
    const database = fakeDatabase();
    database.observed.value.latest_receipt_age = 9000;
    database.fail[name] = () => json({message: 'down'}, 503);
    await unavailable(world({}, database).call());
  });

  it('answers 200 when the notice of a mail cannot be recorded: the heartbeat was recorded and the conditions were evaluated, and the alarm stays due for the next evaluation', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.observed.value.latest_receipt_age = 9000;
    database.fail.record_alarm_notice = () => json({message: 'down'}, 503);
    const response = await world({}, database, mail).call();
    expect([response.status, await response.json()]).toEqual([200, {state: 'recorded', receipt_age_seconds: 9000}]);
    expect(database.heartbeats).toHaveLength(1);
    expect(database.alarms).toEqual([expect.objectContaining({condition: 'qstash-stale', resolvedAt: null})]);
    expect(database.notices).toEqual([]);
  });

  it('answers a mailer that throws with a 200 and a failed notice, not a 503: only the plumbing fails the call', async () => {
    const database = fakeDatabase();
    database.observed.value.latest_receipt_age = 9000;
    expect((await world({}, database, sender(['throw'])).call()).status).toBe(200);
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['failed']);
  });
});

describe('what it prints', () => {
  it('nothing on a success or a refusal, and fixed sentences on a failure: never the token, the key set, an address or an ID', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const good = token();
    await world().call({token: good});
    await world().call({token: good});
    await world().call({token: 'garbage'});
    await world().call({headers: {origin: 'https://evil.example'}});
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    const database = fakeDatabase();
    database.fail.record_heartbeat = () => json({message: `down ${good}`}, 503);
    await world({}, database).call({token: token({jti: 'BBBBBBBBBBBBBBBBBBBBBB'})});
    const lines = spies.flatMap((spy) => spy.mock.calls.map((callArgs) => callArgs.join(' ')));
    expect(lines).toEqual(['A heartbeat could not be recorded.']);
    for (const line of lines) {
      expect(line).not.toContain(good);
      expect(line).not.toContain(INSTANCE);
      expect(line).not.toContain(heartbeat.json);
    }
  });

  it('reflects nothing of the request in any answer', async () => {
    const good = token();
    const answers = [
      await world().call({token: good}),
      await world().call({token: good}),
      await world().call({token: 'x'.repeat(40)}),
      await world().call({headers: {origin: 'https://evil.example'}}),
      await world().call({method: 'GET'}),
    ];
    const text = (await Promise.all(answers.map((answer) => answer.text()))).join('\n');
    expect(text).not.toContain(good);
    expect(text).not.toContain('evil.example');
    expect(text).not.toContain(INSTANCE);
  });
});

describe('isHeartbeatConfigured', () => {
  it('is true when SERVICE_KEYS_HEARTBEAT is set, and false when it is unset, blank or a placeholder', () => {
    expect(isHeartbeatConfigured(env)).toBe(true);
    for (const value of [undefined, '', '  ', 'replace-with-the-heartbeat-key-set', '<the key set>']) expect(isHeartbeatConfigured({SERVICE_KEYS_HEARTBEAT: value}), String(value)).toBe(false);
    expect(isHeartbeatConfigured({})).toBe(false);
  });

  it('reads the heartbeat issuer\'s name and no other: the application\'s key set is not the heartbeat\'s', () => {
    expect(isHeartbeatConfigured({SERVICE_KEYS_APPLICATION: applicationKey.json})).toBe(false);
  });
});
