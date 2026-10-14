import {expect, test, type APIResponse} from '@playwright/test';
import {disableAccount, enableAccount, hashClientAddress, hashKey} from '../../lib/accounts';
import {recordTombstone} from '../../lib/lifecycle';
import {endGlobalOutage, flakyBaseUrl, startGlobalOutage} from '../support/fake-network';
import {label, signIn} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';

// Story 1.8: the status route over real HTTP, against the production build and the local Supabase stack: POST /api/status answers what became
// of a status handle, with no sign-in, never cached, and refuses what is not exactly that. The proxy's origin check, the route's body rules,
// the database's rate limit and the "database down is never unknown" rule all run for real. The tests that need a handle make an Account the way
// the registration screen does and read its handle from the database as the owner (no page and no function returns one, by design).
//
// Every test here holds a database lock for its whole run, because they share one thing the route counts: a test browser sends no platform address
// header, so every request in the run comes from the same origin, and the limit test fills that origin's minute. They run one at a time, across the
// desktop and phone projects too. The "database is down" cases use the second application server, the one with the fake network (playwright.config.ts).

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});
const lock = "select pg_advisory_lock(hashtextextended('nova3d-e2e:status-route', 0))";
const unlock = "select pg_advisory_unlock(hashtextextended('nova3d-e2e:status-route', 0))";
test.beforeEach(async () => {
  await world.db.query(lock);
});
test.afterEach(async () => {
  await clearShared();
  await world.db.query(unlock);
});

const unknownHandle = '0'.repeat(32);
const evil = 'https://evil.example';

/** The origin every request of the run is counted under: a test browser sends no platform address header. */
const sharedOrigin = () => hashClientAddress(null, hashKey(world.env, 'RATE_LIMIT_HASH_KEY'));
const clearShared = () => world.db.query('delete from lifecycle.status_requests where key_hash = $1', [sharedOrigin()]);

const asked = (request: import('@playwright/test').APIRequestContext, baseURL: string, body: unknown, headers: Record<string, string> = {}, path = '/api/status') =>
  request.post(new URL(path, baseURL).href, {
    data: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {'content-type': 'application/json', origin: new URL(baseURL).origin, ...headers},
    maxRedirects: 0,
  });
const noStore = (response: APIResponse) => expect(response.headers()['cache-control']).toBe('no-store');
const handleOf = async (kind: 'account' | 'project', id: string) =>
  (await world.db.query(`select encode(status_handle, 'hex') as handle from ${kind === 'account' ? 'identity.accounts' : 'projects.projects'} where id = $1`, [id])).rows[0].handle as string;
async function member() {
  const user = await world.signedInUser();
  const receipt = await world.activate(user);
  return {user, accountId: receipt.accountId as string};
}

test.describe('an answer', () => {
  test('is `unknown`, with a 200, for a handle no row holds: public, no sign-in, no cookie, no redirect, never cached', async ({request, baseURL}) => {
    const response = await asked(request, baseURL!, {handle: unknownHandle});
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({state: 'unknown'});
    noStore(response);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie')).toEqual([]);
  });

  test('says active, then disabled, then deleted for an Account, with its revision at each step; deleted needs no sign-in and outlives the Auth user', async ({request, baseURL}) => {
    const {user, accountId} = await member();
    const handle = await handleOf('account', accountId);

    const active = await asked(request, baseURL!, {handle});
    expect([active.status(), await active.json()]).toEqual([200, {state: 'active', revision: 1}]);
    noStore(active);

    expect((await disableAccount({accountId, actor: 'seed:local:e2e'}, {env: world.env})).outcome).toBe('disabled');
    const disabled = await asked(request, baseURL!, {handle});
    expect([disabled.status(), await disabled.json()]).toEqual([200, {state: 'disabled', revision: 2}]);

    expect(await recordTombstone({kind: 'account', id: accountId}, {env: world.env})).toMatchObject({outcome: 'recorded', revision: 3});
    const deleted = await asked(request, baseURL!, {handle});
    expect([deleted.status(), await deleted.json()]).toEqual([200, {state: 'deleted', revision: 3}]);
    noStore(deleted);

    // The Account's rows and its Auth identity are gone; the tombstone is not.
    await world.eraseAccount(user);
    await world.db.query('delete from auth.users where id = $1', [user.id]);
    expect((await world.db.query('select 1 from auth.users where id = $1', [user.id])).rowCount).toBe(0);
    const afterwards = await asked(request, baseURL!, {handle});
    expect([afterwards.status(), await afterwards.json()]).toEqual([200, {state: 'deleted', revision: 3}]);
  });

  // A Project's revision in a reply is its own plus its Account's authorization epoch: both only rise, so a re-enable lifts what a disable locked.
  test('says active, disabled (with its Account) and active again, with a revision that rises each time, for a Project', async ({request, baseURL}) => {
    const {user, accountId} = await member();
    const projectId = await world.addProject(user, {title: 'Status probe'});
    const handle = await handleOf('project', projectId);
    const reply = async () => {
      const response = await asked(request, baseURL!, {handle});
      expect(response.status()).toBe(200);
      return (await response.json()) as {state: string; revision: number};
    };

    expect(await reply()).toEqual({state: 'active', revision: 2});
    await disableAccount({accountId, actor: 'seed:local:e2e'}, {env: world.env});
    expect(await reply()).toEqual({state: 'disabled', revision: 3});
    expect((await enableAccount({accountId, actor: 'seed:local:e2e'}, {env: world.env})).outcome).toBe('enabled');
    // Higher than the disabled reply's number, so a device that merges the replies in order sees the Project active again.
    expect(await reply()).toEqual({state: 'active', revision: 4});
  });

  test('says deleted for a Project once it is tombstoned, with no sign-in, while its owner gets the one unavailable page where the Project was', async ({page, context, request, baseURL}) => {
    const {user} = await member();
    const projectId = await world.addProject(user, {title: 'Status probe'});
    const handle = await handleOf('project', projectId);
    await signIn(context, baseURL!, user, {locale: 'en'});

    // Before: the owner opens the Project, and the handle says active.
    const before = await page.goto(`/projects/${projectId}`);
    expect(before?.status()).toBe(200);
    await expect(page.getByRole('heading', {level: 1, name: 'Status probe'})).toBeVisible();
    expect(await (await asked(request, baseURL!, {handle})).json()).toEqual({state: 'active', revision: 2});

    expect(await recordTombstone({kind: 'project', id: projectId}, {env: world.env})).toMatchObject({outcome: 'recorded', revision: 2});

    // After: the handle says deleted (from the tombstone, to a caller with no session), and the owner's request for the Project is the unavailable page.
    const deleted = await asked(request, baseURL!, {handle});
    expect([deleted.status(), await deleted.json()]).toEqual([200, {state: 'deleted', revision: 2}]);
    noStore(deleted);
    const after = await page.goto(`/projects/${projectId}`);
    expect(after?.status()).toBe(404);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(label('en', 'project.unavailable.title'));
    await expect(page.getByRole('heading', {level: 1, name: 'Status probe'})).toHaveCount(0);
    expect(await page.content()).not.toContain('Status probe');
  });

  test('puts nothing of the target in the answer but the state and the revision, and never the handle', async ({request, baseURL}) => {
    const {user, accountId} = await member();
    const projectId = await world.addProject(user, {title: 'Private plans for the status probe'});
    const handle = await handleOf('project', projectId);
    const response = await asked(request, baseURL!, {handle});
    const text = await response.text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['revision', 'state']);
    for (const secret of [handle, accountId, projectId, user.email, 'Private plans']) expect(text).not.toContain(secret);
    expect(JSON.stringify(response.headersArray())).not.toContain(handle);
  });
});

test.describe('a request that is not exactly {"handle": 32 lower-case hexadecimal characters}', () => {
  const bodies: [string, string][] = [
    ['an empty body', ''],
    ['text', 'hello'],
    ['an empty object', '{}'],
    ['a handle in capitals', JSON.stringify({handle: unknownHandle.replace(/0/g, 'A')})],
    ['a handle that is too short', JSON.stringify({handle: '0'.repeat(31)})],
    ['a handle that is too long', JSON.stringify({handle: '0'.repeat(33)})],
    ['another key beside the handle', JSON.stringify({handle: unknownHandle, extra: 1})],
    ['a body of more than 256 bytes', JSON.stringify({handle: unknownHandle, pad: 'x'.repeat(300)})],
  ];

  for (const [name, body] of bodies) {
    test(`is a 400 for ${name}, never cached, and does not count as a lookup`, async ({request, baseURL}) => {
      const before = await world.db.query('select coalesce(sum(requests), 0)::int as n from lifecycle.status_requests where key_hash = $1', [sharedOrigin()]);
      const response = await asked(request, baseURL!, body);
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({error: 'invalid_request'});
      noStore(response);
      const after = await world.db.query('select coalesce(sum(requests), 0)::int as n from lifecycle.status_requests where key_hash = $1', [sharedOrigin()]);
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  }

  test('is a 405 for any other method, with the handle in the query string or without: the route is one POST, so a handle can never be in a URL', async ({request, baseURL}) => {
    const url = new URL(`/api/status?handle=${unknownHandle}`, baseURL!).href;
    for (const method of ['get', 'put', 'patch', 'delete'] as const) {
      const response = await request[method](url, {headers: {origin: new URL(baseURL!).origin}, maxRedirects: 0});
      expect(response.status(), method).toBe(405);
      expect(await response.text(), method).not.toContain('"state"');
    }
    expect((await request.get(new URL('/api/status', baseURL!).href, {maxRedirects: 0})).status()).toBe(405);
    // A POST with the handle only in the URL is a body that is not there.
    const response = await request.post(url, {headers: {origin: new URL(baseURL!).origin}, maxRedirects: 0});
    expect(response.status()).toBe(400);
  });
});

test.describe('where a request comes from', () => {
  test('is a 403 from another site: a foreign Origin, a missing Origin, and a cross-site fetch; nothing is looked up or counted', async ({request, baseURL}) => {
    const before = await world.db.query('select coalesce(sum(requests), 0)::int as n from lifecycle.status_requests where key_hash = $1', [sharedOrigin()]);
    const body = {handle: unknownHandle};
    for (const headers of [{origin: evil}, {origin: 'null'}, {origin: new URL(baseURL!).origin, 'sec-fetch-site': 'cross-site'}] as Record<string, string>[]) {
      const response = await asked(request, baseURL!, body, headers);
      expect(response.status(), JSON.stringify(headers)).toBe(403);
      expect(await response.json(), JSON.stringify(headers)).toMatchObject({error: 'origin_not_allowed'});
    }
    const withoutOrigin = await request.post(new URL('/api/status', baseURL!).href, {data: JSON.stringify(body), headers: {'content-type': 'application/json'}, maxRedirects: 0});
    expect(withoutOrigin.status()).toBe(403);
    const after = await world.db.query('select coalesce(sum(requests), 0)::int as n from lifecycle.status_requests where key_hash = $1', [sharedOrigin()]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

test.describe('the rate limit', () => {
  test('is a 429 with Retry-After once the origin has used its 120 requests for the minute, and the answer holds nothing of the target', async ({request, baseURL}) => {
    const {accountId} = await member();
    const handle = await handleOf('account', accountId);
    const origin = sharedOrigin();
    let limited: APIResponse | null = null;
    // The count is per minute: if the minute turns over between filling it and asking, fill it again.
    for (let tries = 0; tries < 3 && limited === null; tries += 1) {
      await world.db.query(
        `insert into lifecycle.status_requests (scope, key_hash, window_id, requests, expires_at)
         values ('origin', $1, floor(extract(epoch from clock_timestamp()) / 60)::bigint, 120, clock_timestamp() + interval '3 minutes')
         on conflict (scope, key_hash, window_id) do update set requests = 120`,
        [origin],
      );
      const response = await asked(request, baseURL!, {handle});
      if (response.status() === 429) limited = response;
    }
    expect(limited, 'a 429').not.toBeNull();
    expect(await limited!.json()).toEqual({error: 'rate_limited'});
    noStore(limited!);
    const wait = Number(limited!.headers()['retry-after']);
    expect(Number.isInteger(wait) && wait >= 1 && wait <= 60, `Retry-After ${limited!.headers()['retry-after']}`).toBe(true);
    // Still limited, and still saying nothing about the handle, however often it is asked.
    const again = await asked(request, baseURL!, {handle});
    expect(again.status()).toBe(429);
    expect(await again.text()).not.toContain('active');
    // Every request was counted, the limited ones too.
    const counted = await world.db.query('select coalesce(sum(requests), 0)::int as n from lifecycle.status_requests where key_hash = $1', [origin]);
    expect(counted.rows[0].n).toBeGreaterThanOrEqual(122);
  });
});

test.describe('a database that does not answer', () => {
  const flaky = (baseURL: string) => flakyBaseUrl(baseURL);

  test('is a 503, never `unknown`, whether the connection fails or the database answers 503; and the route works again when it is back', async ({request, baseURL}) => {
    const url = flaky(baseURL!);
    try {
      for (const mode of ['down', 'error'] as const) {
        startGlobalOutage('lookup_status', mode);
        const response = await asked(request, url, {handle: unknownHandle});
        expect(response.status(), mode).toBe(503);
        expect(await response.json(), mode).toEqual({error: 'unavailable'});
        noStore(response);
        expect(response.headers()['retry-after'], mode).toBe('30');
      }
    } finally {
      endGlobalOutage('lookup_status');
    }
    const back = await asked(request, url, {handle: unknownHandle});
    expect([back.status(), await back.json()]).toEqual([200, {state: 'unknown'}]);
  });

  test('is a 503 for a handle that IS known too: an outage does not turn a deleted target into an unknown one', async ({request, baseURL}) => {
    const {accountId} = await member();
    await recordTombstone({kind: 'account', id: accountId}, {env: world.env});
    const handle = await handleOf('account', accountId);
    const url = flaky(baseURL!);
    try {
      startGlobalOutage('lookup_status', 'down');
      const down = await asked(request, url, {handle});
      expect(down.status()).toBe(503);
      expect(await down.text()).not.toContain('unknown');
    } finally {
      endGlobalOutage('lookup_status');
    }
    expect(await (await asked(request, url, {handle})).json()).toEqual({state: 'deleted', revision: 2});
  });
});
