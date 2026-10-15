import {expect, test, type APIRequestContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';
import {signedCall, testSigningKeys} from '../support/qstash-signature';

// Story 1.9: the scheduled-job route over real HTTP, against the production build and the local Supabase stack. A signed call is made the way
// QStash makes one (tests/support/qstash-signature.ts; the web server is started with the matching test keys, playwright.config.ts), with no
// browser Origin and no cookie. The proxy lets this one path through without an Origin check; the route verifies the signature over the raw
// body, the instance and the schedule and message IDs, claims the run, runs the task and writes an immutable receipt. The database half (the
// claim races, the purge against a registration) is tests/integration/scheduled-jobs.test.ts, and the route's every status without a database is
// tests/unit/jobs-route.test.ts: this is the wiring, once, for real.
//
// The relay's outcome depends on what the shared local database holds (events pending from other specs), so it is `idle` or `no_store`: the
// build configures no ledger store until Story 8.9, which is the point. Receipts stay (they are append-only); every case asserts on its own IDs.

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const instance = () => world.env.INSTANCE_ID as string;
const receipts = async (schedule: string, message: string) =>
  (await world.db.query('select task, attempt, outcome, result, finished_at from lifecycle.job_receipts where schedule_id = $1 and message_id = $2 order by attempt', [schedule, message])).rows as {
    task: string;
    attempt: number;
    outcome: string | null;
    result: Record<string, unknown> | null;
    finished_at: Date | null;
  }[];
const ids = () => ({scheduleId: `scd_${randomUUID()}`, messageId: `msg_${randomUUID()}`});

async function fire(
  request: APIRequestContext,
  baseURL: string,
  content: {task: string; instance: string} | string,
  options: Parameters<typeof signedCall>[1] = {},
  headers: Record<string, string> = {},
) {
  const call = signedCall(content, options);
  return request.post(new URL('/api/jobs', baseURL).href, {data: call.body, headers: {...call.headers, ...headers}, maxRedirects: 0});
}
const dropHeader = (headers: Record<string, string>, name: string) => Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));

test.describe('a signed call', () => {
  test('runs the task once, writes one finished receipt, and a second delivery of the message answers duplicate and writes nothing', async ({request, baseURL}) => {
    const key = ids();
    const first = await fire(request, baseURL!, {task: 'ledger-relay', instance: instance()}, key);
    expect(first.status()).toBe(200);
    expect(first.headers()['cache-control']).toBe('no-store');
    const outcome = ((await first.json()) as {outcome: string}).outcome;
    // No ledger store is configured until Story 8.9: nothing pending is idle, and anything pending waits (`no_store`).
    expect(['idle', 'no_store']).toContain(outcome);

    const [receipt, ...more] = await receipts(key.scheduleId, key.messageId);
    expect(more).toEqual([]);
    expect(receipt).toMatchObject({task: 'ledger-relay', attempt: 1, outcome});
    expect(receipt.finished_at).toBeInstanceOf(Date);
    expect(Object.keys(receipt.result ?? {})).toEqual(['pending']);

    const again = await fire(request, baseURL!, {task: 'ledger-relay', instance: instance()}, key);
    expect([again.status(), await again.json()]).toEqual([200, {outcome: 'duplicate'}]);
    expect(await receipts(key.scheduleId, key.messageId)).toHaveLength(1);
  });

  test('is not refused for having no Origin, or a foreign one: the signature is the only authentication, and the proxy checks no Origin for this path', async ({request, baseURL}) => {
    for (const headers of [{}, {origin: 'https://evil.example'}, {origin: 'null'}, {'sec-fetch-site': 'cross-site'}] as Record<string, string>[]) {
      const response = await fire(request, baseURL!, {task: 'ledger-relay', instance: instance()}, ids(), headers);
      expect(response.status(), JSON.stringify(headers)).toBe(200);
    }
    // The route next door keeps its rule: the same foreign POST to /api/status is refused by the proxy.
    const status = await request.post(new URL('/api/status', baseURL!).href, {data: JSON.stringify({handle: '0'.repeat(32)}), headers: {'content-type': 'application/json', origin: 'https://evil.example'}});
    expect(status.status()).toBe(403);
  });

  // The purge is global to the database, and the desktop and phone projects run at the same time, so another project's purge may delete this
  // test's back-dated identity before this call does (and this call then reports deleted: 0). So this asserts facts that do not depend on who
  // got there first: the identity is gone, the Account's identity is not, and the receipt of THIS call holds counts only, under the four keys.
  test('runs the dormant-identity purge: an identity with no Account idle for 30 days is gone, an Account\'s is not, and the receipt holds counts only', async ({request, baseURL}) => {
    const stranger = await world.signedInUser();
    const member = await world.signedInUser();
    try {
      await world.activate(member);
      for (const user of [stranger, member]) await world.db.query(`update auth.users set created_at = now() - interval '400 days', last_sign_in_at = null where id = $1`, [user.id]);
      const key = ids();
      const response = await fire(request, baseURL!, {task: 'dormant-identity-purge', instance: instance()}, key);
      expect([response.status(), await response.json()]).toEqual([200, {outcome: 'ran'}]);

      expect((await world.db.query('select 1 from auth.users where id = $1', [stranger.id])).rowCount).toBe(0);
      expect((await world.db.query('select 1 from auth.users where id = $1', [member.id])).rowCount).toBe(1);
      expect((await world.db.query('select 1 from identity.accounts where user_id = $1', [member.id])).rowCount).toBe(1);
      const [receipt, ...more] = await receipts(key.scheduleId, key.messageId);
      expect(more).toEqual([]);
      expect(receipt).toMatchObject({task: 'dormant-identity-purge', outcome: 'ran'});
      expect(receipt.finished_at).toBeInstanceOf(Date);
      expect(Object.keys(receipt.result ?? {}).sort()).toEqual(['deleted', 'kept', 'locked', 'remaining']);
      for (const value of Object.values(receipt.result ?? {})) expect(Number.isInteger(value) && (value as number) >= 0).toBe(true);
    } finally {
      // Whatever the assertions found, leave neither user behind (the Account's rows go first: they hold the identity with a RESTRICT key).
      await world.eraseAccount(member);
      await world.db.query('delete from auth.users where id = any($1)', [[stranger.id, member.id]]);
    }
  });
});

test.describe('a call that is not for this application', () => {
  test('is refused without a receipt: a missing, wrong-key or tampered signature is 401', async ({request, baseURL}) => {
    const key = ids();
    const content = {task: 'ledger-relay', instance: instance()};
    const signed = signedCall(content, key);
    const url = new URL('/api/jobs', baseURL!).href;
    const post = (data: string, headers: Record<string, string>) => request.post(url, {data, headers, maxRedirects: 0});

    for (const response of [
      await post(signed.body, dropHeader(signed.headers, 'upstash-signature')),
      await post(signed.body, {...signed.headers, 'upstash-signature': 'not-a-token'}),
      await fire(request, baseURL!, content, {...key, key: 'another-queues-signing-key-0000000000000'}),
      await post(`${signed.body} `, signed.headers),
    ]) {
      expect(response.status()).toBe(401);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await response.json()).toEqual({error: 'unauthorized'});
    }
    expect(await receipts(key.scheduleId, key.messageId)).toEqual([]);
  });

  test('is refused for another instance with 403, for a body or headers that are not right with 400, and writes no receipt', async ({request, baseURL}) => {
    const key = ids();
    const foreign = await fire(request, baseURL!, {task: 'ledger-relay', instance: randomUUID()}, key);
    expect([foreign.status(), await foreign.json()]).toEqual([403, {error: 'wrong_environment'}]);

    const unknown = await fire(request, baseURL!, {task: 'session-cleanup', instance: instance()}, key);
    expect(unknown.status()).toBe(400);
    const extra = await fire(request, baseURL!, JSON.stringify({task: 'ledger-relay', instance: instance(), extra: true}), key);
    expect(extra.status()).toBe(400);
    // (As text: Playwright would otherwise wrap a string that is not JSON in quotes before sending it, and the signature would no longer match.)
    const notJson = await fire(request, baseURL!, 'not json', key, {'content-type': 'text/plain'});
    expect(notJson.status()).toBe(400);
    const big = await fire(request, baseURL!, JSON.stringify({task: 'ledger-relay', instance: instance(), padding: 'x'.repeat(2000)}), key);
    expect(big.status()).toBe(400);
    // A message that is not from a schedule is refused.
    const unscheduled = await fire(request, baseURL!, {task: 'ledger-relay', instance: instance()}, {messageId: key.messageId, scheduleId: null});
    expect(unscheduled.status()).toBe(400);
    expect(await unscheduled.json()).toEqual({error: 'invalid_request'});
    expect(await receipts(key.scheduleId, key.messageId)).toEqual([]);
    expect((await world.db.query('select 1 from lifecycle.job_receipts where message_id = $1', [key.messageId])).rowCount).toBe(0);
  });

  test('is a POST route: any other method is 405, and a call that is only unsigned is 401 whatever it says', async ({request, baseURL}) => {
    const url = new URL('/api/jobs', baseURL!).href;
    for (const method of ['get', 'put', 'patch', 'delete'] as const) {
      const response = await request[method](url, {maxRedirects: 0});
      expect(response.status(), method).toBe(405);
    }
    const unsigned = await request.post(url, {data: JSON.stringify({task: 'ledger-relay', instance: instance()}), headers: {'content-type': 'application/json'}, maxRedirects: 0});
    expect(unsigned.status()).toBe(401);
    const empty = await request.post(url, {maxRedirects: 0});
    expect(empty.status()).toBe(401);
  });

  test('is told 409 for a message that is being run, and nothing runs', async ({request, baseURL}) => {
    const key = ids();
    await world.db.query('select * from api.claim_job_run($1, $2, $3, 300)', ['ledger-relay', key.scheduleId, key.messageId]);
    const response = await fire(request, baseURL!, {task: 'ledger-relay', instance: instance()}, key);
    expect([response.status(), await response.json()]).toEqual([409, {outcome: 'running'}]);
    expect(await receipts(key.scheduleId, key.messageId)).toHaveLength(1);
  });

  test('has no session to give: the response sets no cookie and redirects nowhere', async ({request, baseURL}) => {
    const response = await fire(request, baseURL!, {task: 'ledger-relay', instance: instance()}, ids());
    expect(response.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie')).toEqual([]);
    expect(response.headers().location).toBeUndefined();
    expect(testSigningKeys.current).not.toBe(testSigningKeys.next);
  });
});
