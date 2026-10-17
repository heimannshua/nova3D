import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect, test, type BrowserContext, type Page} from '@playwright/test';
import {csrfHeaderName} from '../../lib/request-integrity';
import {readCsrfToken} from '../../lib/csrf-client';
import {createS3Storage} from '../../workers/files/src/storage';
import {signIn} from '../support/e2e-helpers';
import {accountsWorld, type AccountsWorld} from '../support/forged-session';
import {s3Of} from '../support/stack';

// Story 1.12: a private file moves through the file gateway, in a real browser, against the production build, the local Supabase stack and the REAL gateway
// (the third web server of playwright.config.ts, workers/files, on its own port: another origin than the application's). The browser asks the application for a ticket
// (POST /api/transfers/tickets, with the CSRF token), then takes the ticket to the gateway across origins from the application's origin: no file body ever goes
// through the application's server (a Vercel function caps a body at 4.5 MB). The gateway's every rule is covered at length in tests/unit/gateway-server.test.ts and
// tests/integration/file-gateway.test.ts; this is the wiring, once, for real: CORS (the preflight a browser sends), the ticket route's guard, a whole upload and a
// download by range, a browser-native download that opens with a ticket in its URL and continues on a handle URL, and an Account disabled while a large file is
// streaming. Every flow runs on `desktop` and `phone`.

let world: AccountsWorld;
const uploaded: {accountId: string; id: string}[] = [];

test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  try {
    // The objects the specs staged are taken out of Storage with the stack's own key (the hourly cleanup is not running here).
    const storage = createS3Storage(s3Of(world.stack));
    for (const {accountId, id} of uploaded) await storage.deletePrefix(`staging/${accountId}/${id}`).catch(() => 0);
  } finally {
    await world.close();
  }
});

const MiB = 1024 * 1024;
const gatewayOrigin = () => new URL(process.env.FILE_GATEWAY_URL ?? 'http://127.0.0.1:4175').origin;

/** A signed-in member's page, loaded, so the proxy has handed the browser its CSRF token. */
async function memberPage(page: Page, context: BrowserContext, baseURL: string) {
  const user = await world.signedInUser();
  await world.activate(user);
  await signIn(context, baseURL, user);
  await page.goto('/');
  const token = readCsrfToken(await page.evaluate(() => document.cookie));
  expect(token, 'the first page request must hand the browser a token').not.toBeNull();
  return {user, token: token!, accountId: (await world.accountOf(user)).id as string};
}

type TicketAnswer = {status: number; body: Record<string, unknown>; cacheControl: string | null};

/** What the page's own script does: a same-origin POST to the ticket route with the CSRF token. */
const requestTicket = (page: Page, token: string | null, body: unknown, options: {raw?: string} = {}) =>
  page.evaluate(
    async ({token, body, raw, header}): Promise<TicketAnswer> => {
      const response = await fetch('/api/transfers/tickets', {method: 'POST', headers: token === null ? {} : {[header]: token}, body: raw ?? JSON.stringify(body), credentials: 'same-origin'});
      return {status: response.status, body: await response.json().catch(() => ({})), cacheControl: response.headers.get('cache-control')};
    },
    {token, body, raw: options.raw, header: csrfHeaderName},
  );

/**
 * Makes `size` bytes in the page (a PNG signature and then a repeating pattern, or opaque bytes for a file), asks for an upload ticket for them, and PUTs them to the
 * gateway across origins. Nothing of the bytes crosses to the test: only the digest and the answers do.
 */
function uploadFromPage(page: Page, token: string, input: {id: string; size: number; cls: 'picture' | 'file'; contentType: string}) {
  return page.evaluate(
    async ({token, header, gateway, id, size, cls, contentType}) => {
      const bytes = new Uint8Array(size);
      for (let offset = 0; offset < size; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, size)));
      if (cls === 'picture') bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const ticketResponse = await fetch('/api/transfers/tickets', {
        method: 'POST',
        headers: {[header]: token},
        body: JSON.stringify({direction: 'upload', kind: 'staging', id, class: cls, length: size, sha256: digest, contentType}),
        credentials: 'same-origin',
      });
      const ticket = (await ticketResponse.json()) as {ticket: string; gateway: string};
      // Cross-origin, with an Authorization header and a body: the browser sends a preflight first, which the gateway answers for the application's origin only.
      const response = await fetch(`${ticket.gateway}/v1/uploads/${id}`, {
        method: 'PUT',
        headers: {authorization: `Ticket ${ticket.ticket}`, 'content-type': contentType, 'x-content-sha256': digest},
        body: bytes,
      });
      return {ticketStatus: ticketResponse.status, gateway: ticket.gateway, status: response.status, body: await response.json(), digest, cacheControl: response.headers.get('cache-control')};
    },
    {token, header: csrfHeaderName, gateway: gatewayOrigin(), ...input},
  );
}

/** Asks for a download ticket the way the page does, and returns it with the gateway's address. */
async function downloadTicket(page: Page, token: string, id: string) {
  const answer = await requestTicket(page, token, {direction: 'download', kind: 'staging', id});
  expect(answer.status).toBe(200);
  return answer.body as {ticket: string; gateway: string};
}

/** Reads a file from the gateway in the page and reports its size, digest and the headers a browser may read across origins. */
function readFromPage(page: Page, input: {gateway: string; id: string; ticket: string; range?: string}) {
  return page.evaluate(async ({gateway, id, ticket, range}) => {
    const response = await fetch(`${gateway}/v1/files/staging/${id}`, {headers: {authorization: `Ticket ${ticket}`, ...(range ? {range} : {})}});
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      status: response.status,
      length: bytes.length,
      digest,
      contentRange: response.headers.get('content-range'),
      acceptRanges: response.headers.get('accept-ranges'),
      cacheControl: response.headers.get('cache-control'),
      first: [...bytes.subarray(0, 4)],
    };
  }, input);
}

// ---------------------------------------------------------------------------------------------------
test.describe('a member moves a file through the gateway, across origins', () => {
  test('uploads a 5 MiB PNG, reads it back whole and by range, and every answer is no-store', async ({page, context, baseURL}) => {
    const {token, accountId} = await memberPage(page, context, baseURL!);
    const id = randomUUID();
    uploaded.push({accountId, id});
    const size = 5 * MiB;

    const upload = await uploadFromPage(page, token, {id, size, cls: 'picture', contentType: 'image/png'});
    expect(upload).toMatchObject({ticketStatus: 200, status: 201, body: {id, length: size, sha256: upload.digest}, cacheControl: 'no-store'});
    // The gateway is not the application: another origin, as the browser sees it.
    expect(new URL(upload.gateway).origin).not.toBe(new URL(baseURL!).origin);

    // The database holds a complete lease, and Storage holds the object, whose digest is the one the browser computed.
    const lease = await world.db.query('select state, received_length::int as received, sha256 from artifacts.staging_leases where id = $1', [id]);
    expect(lease.rows).toEqual([{state: 'complete', received: size, sha256: upload.digest}]);

    const whole = await readFromPage(page, {gateway: upload.gateway, id, ticket: (await downloadTicket(page, token, id)).ticket});
    expect(whole).toMatchObject({status: 200, length: size, digest: upload.digest, acceptRanges: 'bytes', cacheControl: 'no-store', first: [0x89, 0x50, 0x4e, 0x47]});

    // One range per ticket: the next range needs a new ticket.
    const range = await readFromPage(page, {gateway: upload.gateway, id, ticket: (await downloadTicket(page, token, id)).ticket, range: 'bytes=10-1033'});
    expect(range).toMatchObject({status: 206, length: 1024, contentRange: `bytes 10-1033/${size}`, cacheControl: 'no-store'});
    const suffix = await readFromPage(page, {gateway: upload.gateway, id, ticket: (await downloadTicket(page, token, id)).ticket, range: 'bytes=-100'});
    expect(suffix).toMatchObject({status: 206, length: 100, contentRange: `bytes ${size - 100}-${size - 1}/${size}`});
  });

  test('a ticket is single use: the same ticket again is refused, and so is a ticket for another upload', async ({page, context, baseURL}) => {
    const {token, accountId} = await memberPage(page, context, baseURL!);
    const id = randomUUID();
    uploaded.push({accountId, id});
    const upload = await uploadFromPage(page, token, {id, size: MiB, cls: 'file', contentType: 'application/octet-stream'});
    expect(upload.status).toBe(201);

    const ticket = await downloadTicket(page, token, id);
    const first = await readFromPage(page, {gateway: ticket.gateway, id, ticket: ticket.ticket});
    expect(first.status).toBe(200);
    const replay = await readFromPage(page, {gateway: ticket.gateway, id, ticket: ticket.ticket});
    expect(replay.status).toBe(401);
    // The same ticket names one upload: another ID is a ticket for a different target.
    const other = await downloadTicket(page, token, id);
    const wrong = await readFromPage(page, {gateway: other.gateway, id: randomUUID(), ticket: other.ticket});
    expect(wrong.status).toBe(401);
  });

  test('refuses a call from any other origin: the preflight is not answered, and a request that names another Origin is a 403', async ({page, context, baseURL, request}) => {
    const {token} = await memberPage(page, context, baseURL!);
    const ticket = await downloadTicket(page, token, randomUUID());
    // The same machine under another host name is another origin: the browser asks, and the gateway does not say yes.
    const elsewhere = new URL(baseURL!);
    elsewhere.hostname = 'localhost';
    await page.goto(new URL('/login', elsewhere).href);
    const outcome = await page.evaluate(async ({gateway, ticket}) => {
      try {
        const response = await fetch(`${gateway}/v1/files/staging/00000000-0000-4000-8000-000000000000`, {headers: {authorization: `Ticket ${ticket}`}});
        return `answered ${response.status}`;
      } catch (error) {
        return error instanceof TypeError ? 'blocked' : 'other';
      }
    }, {gateway: ticket.gateway, ticket: ticket.ticket});
    expect(outcome).toBe('blocked');

    for (const origin of ['https://evil.example', 'null', elsewhere.origin]) {
      const refused = await request.get(`${ticket.gateway}/healthz`, {headers: {origin}});
      expect([refused.status(), (await refused.json()).error], origin).toEqual([403, 'forbidden_origin']);
      expect(refused.headers()['access-control-allow-origin'], origin).toBeUndefined();
    }
    // The application's own origin is answered, with exactly that origin and no credentials.
    const allowed = await request.fetch(`${ticket.gateway}/v1/uploads/${randomUUID()}`, {method: 'OPTIONS', headers: {origin: new URL(baseURL!).origin, 'access-control-request-method': 'PUT'}});
    expect(allowed.status()).toBe(204);
    expect(allowed.headers()['access-control-allow-origin']).toBe(new URL(baseURL!).origin);
    expect(allowed.headers()['access-control-allow-credentials']).toBeUndefined();
    expect(allowed.headers().vary).toContain('Origin');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the ticket route, which no file ever passes through', () => {
  test('is guarded like every mutation: a request with no CSRF token is refused and nothing is signed', async ({page, context, baseURL}) => {
    await memberPage(page, context, baseURL!);
    const body = {direction: 'download', kind: 'staging', id: randomUUID()};
    const refused = await requestTicket(page, null, body);
    expect(refused.status).toBe(403);
    expect(refused.body).not.toHaveProperty('ticket');
    // Without a session at all it is the same 401 as any private route.
    const anonymous = await page.context().browser()!.newContext({baseURL});
    try {
      const response = await anonymous.request.post('/api/transfers/tickets', {data: body, headers: {origin: new URL(baseURL!).origin}});
      expect([401, 403]).toContain(response.status());
      expect(await response.text()).not.toContain('ticket');
    } finally {
      await anonymous.close();
    }
  });

  test('takes no file: a 5 MiB body is refused with a 413 before it is read, and a body that is not a ticket request is a 400', async ({page, context, baseURL}) => {
    const {token} = await memberPage(page, context, baseURL!);
    const big = await requestTicket(page, token, null, {raw: 'x'.repeat(5 * MiB)});
    expect(big.status).toBe(413);
    expect(big.body).toEqual({error: 'payload_too_large'});
    const unknown = await requestTicket(page, token, {direction: 'download', kind: 'project', id: randomUUID()});
    expect([unknown.status, unknown.body]).toEqual([400, {error: 'unknown_target'}]);
    const extra = await requestTicket(page, token, {direction: 'download', kind: 'staging', id: randomUUID(), url: 'https://elsewhere.example'});
    expect(extra.status).toBe(400);
    const notJson = await requestTicket(page, token, null, {raw: 'not json'});
    expect(notJson.status).toBe(400);
    for (const answer of [big, unknown, extra, notJson]) expect(answer.cacheControl).toBe('no-store');
  });

  test('answers a ticket that holds no credential and no URL, for five minutes, for this Account and this session', async ({page, context, baseURL}) => {
    const {user, token, accountId} = await memberPage(page, context, baseURL!);
    const answer = await requestTicket(page, token, {direction: 'download', kind: 'staging', id: randomUUID()});
    expect(answer.status).toBe(200);
    expect(Object.keys(answer.body).sort()).toEqual(['gateway', 'ticket']);
    expect(answer.cacheControl).toBe('no-store');
    const payload = JSON.parse(Buffer.from(String(answer.body.ticket).split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(payload).toMatchObject({iss: 'application', aud: 'gateway', typ: 'ticket', acct: accountId, sid: user.sessionId, dir: 'download', tk: 'staging'});
    expect((payload.exp as number) - (payload.iat as number)).toBe(300);
    expect(JSON.stringify(payload)).not.toMatch(/https?:|secret|key|password|credential/i);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a browser-native download', () => {
  test('opens with the ticket in its URL, redirects to a handle URL that holds no ticket, and resumes by range there', async ({page, context, baseURL, request}) => {
    const {token, accountId} = await memberPage(page, context, baseURL!);
    const id = randomUUID();
    uploaded.push({accountId, id});
    const size = 3 * MiB;
    const upload = await uploadFromPage(page, token, {id, size, cls: 'file', contentType: 'application/octet-stream'});
    expect(upload.status).toBe(201);

    const ticket = await downloadTicket(page, token, id);
    const [download] = await Promise.all([page.waitForEvent('download'), page.goto(`${ticket.gateway}/d/${ticket.ticket}`).catch(() => undefined)]);
    // The address the browser ended on is a handle URL for this target: the ticket is gone from it.
    const handleUrl = download.url();
    expect(handleUrl).toMatch(new RegExp(`^${ticket.gateway.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/h/[A-Za-z0-9_-]{43}/${id}$`));
    expect(handleUrl).not.toContain(ticket.ticket);
    const path = await download.path();
    expect(path).toBeTruthy();
    const bytes = readFileSync(path!);
    expect(bytes.length).toBe(size);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(upload.digest);

    // The handle URL serves ranges and the browser's own resume (If-Range with the ETag) for its own target, and sends no referrer.
    const full = await request.get(handleUrl);
    expect(full.status()).toBe(200);
    expect(full.headers()['referrer-policy']).toBe('no-referrer');
    expect(full.headers()['cache-control']).toBe('no-store');
    const etag = full.headers().etag;
    const resumed = await request.get(handleUrl, {headers: {range: `bytes=${size - 1000}-`, 'if-range': etag}});
    expect(resumed.status()).toBe(206);
    expect((await resumed.body()).equals(bytes.subarray(size - 1000))).toBe(true);
    // ... but not for another target, and not as anything but itself: the same handle with another ID is refused.
    const another = await request.get(handleUrl.replace(id, randomUUID()));
    expect(another.status()).toBe(403);
    // The ticket was single use: the link that opened the download does not open it twice.
    const again = await request.get(`${ticket.gateway}/d/${ticket.ticket}`, {maxRedirects: 0});
    expect(again.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('access that ends while a transfer runs', () => {
  test('disabling the Account while a 40 MiB download streams stops the stream: what was delivered stands, and no more is sent', async ({page, context, baseURL}) => {
    test.setTimeout(120_000);
    const {user, token, accountId} = await memberPage(page, context, baseURL!);
    const id = randomUUID();
    uploaded.push({accountId, id});
    const size = 40 * MiB;
    const upload = await uploadFromPage(page, token, {id, size, cls: 'file', contentType: 'application/octet-stream'});
    expect(upload.status).toBe(201);

    const ticket = await downloadTicket(page, token, id);
    // The page reads the first megabyte and then WAITS: the gateway, which sends a chunk only after it has asked the database again, fills the connection and waits too.
    await page.evaluate(
      ({gateway, id, ticket}) => {
        const state = {received: 0, done: false, error: null as string | null, release: () => undefined as void};
        (window as unknown as {__download: typeof state}).__download = state;
        const gate = new Promise<void>((resolve) => {
          state.release = () => resolve();
        });
        void fetch(`${gateway}/v1/files/staging/${id}`, {headers: {authorization: `Ticket ${ticket}`}})
          .then(async (response) => {
            const reader = response.body!.getReader();
            let gated = false;
            for (;;) {
              const {done, value} = await reader.read();
              if (done) break;
              state.received += value.length;
              if (state.received >= 1024 * 1024 && !gated) {
                gated = true;
                await gate;
              }
            }
            state.done = true;
          })
          .catch((error: unknown) => {
            state.error = error instanceof Error ? error.name : 'error';
            state.done = true;
          });
      },
      {gateway: ticket.gateway, id, ticket: ticket.ticket},
    );
    await expect.poll(() => page.evaluate(() => (window as unknown as {__download: {received: number}}).__download.received), {timeout: 20_000}).toBeGreaterThanOrEqual(1024 * 1024);

    // The Account is disabled (its authorization epoch rises, which ends every grant): the very next chunk is refused by the database's answer, never by a cache.
    await world.setStatus(user, 'disabled');
    await page.evaluate(() => (window as unknown as {__download: {release: () => void}}).__download.release());
    await page.waitForFunction(() => (window as unknown as {__download: {done: boolean}}).__download.done, undefined, {timeout: 30_000});
    const result = await page.evaluate(() => (window as unknown as {__download: {received: number; error: string | null}}).__download);
    expect(result.error, 'the stream was cut, not finished').not.toBeNull();
    expect(result.received).toBeGreaterThanOrEqual(1024 * 1024);
    expect(result.received, 'a disabled Account is sent no more than was already on its way').toBeLessThan(size);

    // And a new ticket is no way back in: the Account is disabled, so the application refuses to sign one.
    const refused = await requestTicket(page, token, {direction: 'download', kind: 'staging', id});
    expect([401, 403]).toContain(refused.status);
    expect(refused.body).not.toHaveProperty('ticket');
  });
});

