import {expect, test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';
import {signHeartbeat, signToken} from '../../lib/service-signing';
import {signRaw, testSigner} from '../support/service-keys';

// Story 1.13: the heartbeat route over real HTTP, against the production build and the local Supabase stack. The Railway cron task's call is made the way the
// worker makes it (workers/heartbeat): a POST with `Authorization: Heartbeat <token>`, no body, no cookie and no browser Origin. The web server is started
// with the public key set of the tests' own heartbeat key (playwright.config.ts: SERVICE_KEYS_HEARTBEAT), and this file signs with the private half
// (tests/support/service-keys.ts, derived from a label: no key file). The route's every status without a database is tests/unit/heartbeat-route.test.ts, its
// functions and the alarm path against the real database are tests/integration/alarms.test.ts, and the revocation of a key (which is permanent for a key ID)
// is tested there, with a key of its own: this file revokes nothing.
//
// NO MAIL: the recovery specs assert that the Mailpit mailbox holds exactly 0 or 1 messages, so nothing here may make the application send an alarm. The
// route evaluates `qstash-stale` and emails what is due, so a fresh receipt is written first (the latest receipt of any scheduler task is then seconds old, and
// the condition does not hold), and the alarms other specs open are never due (each has its `sent` notice at once and is resolved afterwards).
// Heartbeats are append-only: every case asserts on its own token.

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const instance = () => world.env.INSTANCE_ID as string;
const heartbeat = testSigner({issuer: 'heartbeat', active: 'heartbeat-1'});
/** The jti of a token this file signed, or null for one that is not a token at all (garbage that can have recorded nothing). */
const jtiOf = (token: string): string | null => {
  try {
    return (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as {jti: string}).jti ?? null;
  } catch {
    return null;
  }
};
const recorded = async (token: string) => {
  const jti = jtiOf(token);
  return jti === null ? [] : ((await world.db.query('select kid from lifecycle.heartbeats where jti = $1', [jti])).rows as {kid: string}[]);
};
const endpoint = (baseURL: string) => new URL('/api/heartbeat', baseURL).href;

/** A scheduler task just ran: the latest receipt of any task is fresh, so the heartbeat does not find QStash stopped and sends no mail. */
async function freshReceipt() {
  await world.db.query(`insert into lifecycle.job_receipts (task, schedule_id, message_id, attempt, finished_at, outcome, result) values ('ledger-relay', $1, $2, 1, now(), 'idle', '{"pending": 0}')`, [`scd_hb_${randomUUID()}`, `msg_hb_${randomUUID()}`]);
}

test.describe('a signed heartbeat', () => {
  test('is recorded: 200 with the age of the latest receipt, one heartbeat row for its key and its jti, and nothing cached', async ({request, baseURL}) => {
    await freshReceipt();
    const token = signHeartbeat(heartbeat.signer, instance());
    const response = await request.post(endpoint(baseURL!), {headers: {authorization: `Heartbeat ${token}`}, maxRedirects: 0});
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = (await response.json()) as {state: string; receipt_age_seconds: number | null};
    expect(body.state).toBe('recorded');
    expect(Number.isInteger(body.receipt_age_seconds)).toBe(true);
    expect(body.receipt_age_seconds as number).toBeGreaterThanOrEqual(0);
    expect(body.receipt_age_seconds as number).toBeLessThan(7200);
    expect(await recorded(token)).toEqual([{kid: 'test-heartbeat-1'}]);
  });

  test('is a replay when the same token comes again: 409 `duplicate`, and nothing more is recorded', async ({request, baseURL}) => {
    await freshReceipt();
    const token = signHeartbeat(heartbeat.signer, instance());
    const headers = {authorization: `Heartbeat ${token}`};
    expect((await request.post(endpoint(baseURL!), {headers, maxRedirects: 0})).status()).toBe(200);
    const again = await request.post(endpoint(baseURL!), {headers, maxRedirects: 0});
    expect([again.status(), await again.json()]).toEqual([409, {state: 'duplicate'}]);
    expect(again.headers()['cache-control']).toBe('no-store');
    expect(await recorded(token)).toHaveLength(1);
  });

  test('is not refused for having no Origin or a foreign Sec-Fetch-Site: the signed token is the only authentication, and the proxy checks no Origin for this path', async ({request, baseURL}) => {
    await freshReceipt();
    for (const extra of [{}, {'sec-fetch-site': 'cross-site'}, {'sec-fetch-site': 'none'}] as Record<string, string>[]) {
      const token = signHeartbeat(heartbeat.signer, instance());
      const response = await request.post(endpoint(baseURL!), {headers: {authorization: `Heartbeat ${token}`, ...extra}, maxRedirects: 0});
      expect(response.status(), JSON.stringify(extra)).toBe(200);
      expect(await recorded(token)).toHaveLength(1);
    }
    // The route next door keeps its rule: the same foreign POST to /api/status is refused by the proxy.
    const status = await request.post(new URL('/api/status', baseURL!).href, {data: JSON.stringify({handle: '0'.repeat(32)}), headers: {'content-type': 'application/json', origin: 'https://evil.example'}});
    expect(status.status()).toBe(403);
  });

  test('has no session to give: no cookie is set, nothing redirects, and no CSRF token is asked for', async ({request, baseURL}) => {
    await freshReceipt();
    const response = await request.post(endpoint(baseURL!), {headers: {authorization: `Heartbeat ${signHeartbeat(heartbeat.signer, instance())}`}, maxRedirects: 0});
    expect(response.status()).toBe(200);
    expect(response.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie')).toEqual([]);
    expect(response.headers().location).toBeUndefined();
  });

  test('accepts a body of up to 16 bytes and ignores it', async ({request, baseURL}) => {
    await freshReceipt();
    const token = signHeartbeat(heartbeat.signer, instance());
    const response = await request.post(endpoint(baseURL!), {headers: {authorization: `Heartbeat ${token}`, 'content-type': 'application/octet-stream'}, data: Buffer.alloc(16, 7), maxRedirects: 0});
    expect(response.status()).toBe(200);
  });
});

test.describe('a heartbeat that is refused', () => {
  const invalid = {error: 'invalid_token'};

  test('answers 401 with ONE body for every way the token can be wrong, and records nothing', async ({request, baseURL}) => {
    const now = Math.floor(Date.now() / 1000);
    const good = signHeartbeat(heartbeat.signer, instance());
    const parts = good.split('.');
    const tampered = (() => {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      payload.env = randomUUID();
      return [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.');
    })();
    const foreignKey = testSigner({issuer: 'heartbeat', active: 'heartbeat-stranger'});
    const cases: [string, string | null, string | null][] = [
      ['no Authorization header', null, null],
      ['another scheme', null, `Bearer ${good}`],
      ['not a token', 'not.a.token', null],
      ['an expired token', signHeartbeat(heartbeat.signer, instance(), {now: now - 400}), null],
      ['a token issued too far ahead', signHeartbeat(heartbeat.signer, instance(), {now: now + 120}), null],
      ['a token for another environment', signHeartbeat(heartbeat.signer, randomUUID()), null],
      ['a token for the gateway', signToken(heartbeat.signer, {audience: 'gateway', environment: instance(), type: 'heartbeat', claims: {}}), null],
      ['a token of another type', signToken(heartbeat.signer, {audience: 'application', environment: instance(), type: 'ticket', claims: {}}), null],
      ['a token with a claim beyond the standard ones', signToken(heartbeat.signer, {audience: 'application', environment: instance(), type: 'heartbeat', claims: {acct: randomUUID()}}), null],
      ['a token signed by a key the set does not name', signHeartbeat(foreignKey.signer, instance()), null],
      ['a tampered payload', tampered, null],
    ];
    for (const [name, token, header] of cases) {
      const headers: Record<string, string> = header ? {authorization: header} : token ? {authorization: `Heartbeat ${token}`} : {};
      const response = await request.post(endpoint(baseURL!), {headers, maxRedirects: 0});
      expect([response.status(), await response.json()], name).toEqual([401, invalid]);
      expect(response.headers()['cache-control'], name).toBe('no-store');
      if (token) expect(await recorded(token), name).toEqual([]);
    }
  });

  test('answers 403 when an Origin header is present, whatever the token, and records nothing', async ({request, baseURL}) => {
    const token = signHeartbeat(heartbeat.signer, instance());
    for (const origin of [baseURL!, 'https://evil.example', 'null']) {
      const response = await request.post(endpoint(baseURL!), {headers: {authorization: `Heartbeat ${token}`, origin}, maxRedirects: 0});
      expect([response.status(), await response.json()], origin).toEqual([403, {error: 'forbidden_origin'}]);
    }
    expect(await recorded(token)).toEqual([]);
  });

  test('answers 400 for a body over 16 bytes, and records nothing', async ({request, baseURL}) => {
    const token = signHeartbeat(heartbeat.signer, instance());
    const response = await request.post(endpoint(baseURL!), {headers: {authorization: `Heartbeat ${token}`, 'content-type': 'application/octet-stream'}, data: Buffer.alloc(17, 7), maxRedirects: 0});
    expect([response.status(), await response.json()]).toEqual([400, {error: 'invalid_request'}]);
    expect(await recorded(token)).toEqual([]);
  });

  // Review patch P3: a validly signed token whose jti the database would refuse is a 401 like any other bad token, not a 503; nothing is recorded.
  test('answers 401, not 503, for a validly signed token with a jti of the wrong shape', async ({request, baseURL}) => {
    const now = Math.floor(Date.now() / 1000);
    for (const jti of ['A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}=`, `${'A'.repeat(22)}\n`]) {
      const token = signRaw(heartbeat.signer, {iss: 'heartbeat', aud: 'application', env: instance(), jti, iat: now, exp: now + 300, typ: 'heartbeat'});
      const response = await request.post(endpoint(baseURL!), {headers: {authorization: `Heartbeat ${token}`}, maxRedirects: 0});
      expect([response.status(), await response.json()], JSON.stringify(jti)).toEqual([401, invalid]);
      expect(response.headers()['cache-control']).toBe('no-store');
    }
  });

  // Next.js answers OPTIONS and every method the route file does not export itself, before the route runs: OPTIONS is a 204 with `Allow: OPTIONS, POST`, the others
  // a 405 of its own (no body, no `Allow`, no no-store). The route's own 405 (`Allow: POST`, no-store) is for a direct call of the handler, which tests/unit pins.
  test('is answered by Next.js itself for OPTIONS (204, Allow: OPTIONS, POST)', async ({request, baseURL}) => {
    const response = await request.fetch(endpoint(baseURL!), {method: 'OPTIONS', maxRedirects: 0});
    expect(response.status()).toBe(204);
    expect(response.headers().allow).toBe('OPTIONS, POST');
    expect(await response.text()).toBe('');
  });

  test('is a POST route: any other method is 405', async ({request, baseURL}) => {
    const url = endpoint(baseURL!);
    for (const method of ['get', 'put', 'patch', 'delete'] as const) {
      const response = await request[method](url, {headers: {authorization: `Heartbeat ${signHeartbeat(heartbeat.signer, instance())}`}, maxRedirects: 0});
      expect(response.status(), method).toBe(405);
    }
  });
});
