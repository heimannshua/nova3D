import {randomBytes} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {hashClientAddress} from '@/lib/accounts';
import * as route from '@/app/api/status/route';

// The status route (Story 1.8, app/api/status/route.ts) without a database: the handler is called with a Request, the database is a stand-in
// for api.lookup_status, and what the route does with a body, an answer and a failure is read off the Response. The proxy's origin check and
// the real database are covered where they run (tests/unit/proxy-gating.test.ts, tests/integration/tombstones.test.ts, tests/e2e/status.spec.ts).
const HANDLE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const rateKey = randomBytes(32);

type Call = {name: string; body: Record<string, unknown>};
let calls: Call[];
let answer: () => Response | Promise<Response>;
const database = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

beforeEach(() => {
  calls = [];
  answer = database({outcome: 'unknown', revision: null, retry_after: null});
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-for-tests-only');
  vi.stubEnv('RATE_LIMIT_HASH_KEY', rateKey.toString('base64'));
  vi.stubEnv('VERCEL', '');
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    calls.push({name: String(input).split('/rpc/')[1], body: JSON.parse(String(init?.body))});
    return answer();
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const post = (body: BodyInit | null, headers: Record<string, string> = {}, url = 'http://127.0.0.1:4173/api/status') =>
  route.POST(new Request(url, {method: 'POST', body, headers: {'content-type': 'application/json', origin: 'http://127.0.0.1:4173', ...headers}}));
const lookup = (handle: unknown = HANDLE, headers: Record<string, string> = {}) => post(JSON.stringify({handle}), headers);

describe('the route is one POST', () => {
  it('exports a POST handler and no other method, so Next.js answers 405 for the rest, and a handle can never be in a URL', () => {
    expect(Object.keys(route).sort()).toEqual(['POST', 'dynamic']);
    expect(route.dynamic).toBe('force-dynamic');
  });
});

describe('an answer', () => {
  it.each([
    ['active', 1],
    ['disabled', 4],
    ['deleted', 7],
  ] as const)('says %s with its revision, as JSON that is never cached', async (state, revision) => {
    answer = database({outcome: state, revision, retry_after: null});
    const response = await lookup();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({state, revision});
  });

  it('says unknown for a handle no row holds, with a 200 and no revision', async () => {
    const response = await lookup();
    expect([response.status, await response.json()]).toEqual([200, {state: 'unknown'}]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('asks the database once, for this handle, as a keyed hash of the origin and not an address', async () => {
    await lookup(HANDLE, {'x-forwarded-for': '198.51.100.7'});
    expect(calls).toEqual([{name: 'lookup_status', body: {p_handle: HANDLE, p_origin_hash: hashClientAddress(null, rateKey)}}]);
    expect(JSON.stringify(calls)).not.toContain('198.51.100.7');
  });

  it('believes the platform\'s client address only on Vercel, and then counts that origin', async () => {
    vi.stubEnv('VERCEL', '1');
    await lookup(HANDLE, {'x-forwarded-for': '198.51.100.7'});
    expect(calls[0].body.p_origin_hash).toBe(hashClientAddress('198.51.100.7', rateKey));
    expect(calls[0].body.p_origin_hash).not.toBe(hashClientAddress(null, rateKey));
  });

  it('answers 429 with the seconds to wait when the database says the budget is spent, and says nothing else', async () => {
    answer = database({outcome: 'limited', revision: null, retry_after: 37});
    const response = await lookup();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('37');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({error: 'rate_limited'});
  });
});

describe('a database that does not answer is never "unknown"', () => {
  const unavailable = async (response: Response) => {
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('30');
    expect(await response.json()).toEqual({error: 'unavailable'});
  };

  it('answers 503 when the connection fails, the database errors, or it refuses the call', async () => {
    answer = () => { throw new TypeError('fetch failed'); };
    await unavailable(await lookup());
    answer = database({message: 'down'}, 503);
    await unavailable(await lookup());
    answer = database({code: '42501'}, 401);
    await unavailable(await lookup());
  });

  it('answers 503 when the answer is not an answer: an outcome it does not know, no revision, text', async () => {
    for (const body of [{outcome: 'maybe'}, {outcome: 'active', revision: null}, {outcome: 'limited', retry_after: null}, 'unknown', [], null]) {
      answer = database(body);
      await unavailable(await lookup());
    }
  });

  it('answers 503, and asks nothing, when this server is not configured to ask', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    await unavailable(await lookup());
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-for-tests-only');
    vi.stubEnv('RATE_LIMIT_HASH_KEY', '');
    await unavailable(await lookup());
    expect(calls).toEqual([]);
  });
});

describe('a body that is not exactly {"handle": 32 lower-case hexadecimal characters}', () => {
  const refused = async (response: Response) => {
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({error: 'invalid_request'});
    expect(calls).toEqual([]);
  };

  it.each([
    ['no body', null],
    ['an empty body', ''],
    ['text', 'hello'],
    ['JSON that is not an object', '"a1b2c3d4e5f60718293a4b5c6d7e8f90"'],
    ['an array', `[{"handle":"${HANDLE}"}]`],
    ['null', 'null'],
    ['an empty object', '{}'],
    ['a handle in capitals', `{"handle":"${HANDLE.toUpperCase()}"}`],
    ['a handle that is too short', `{"handle":"${HANDLE.slice(1)}"}`],
    ['a handle that is too long', `{"handle":"${HANDLE}0"}`],
    ['a handle with a character that is not hexadecimal', `{"handle":"${HANDLE.slice(1)}g"}`],
    ['a handle with white space around it', `{"handle":" ${HANDLE}"}`],
    ['a handle that is a number', '{"handle":12345678901234567890123456789012}'],
    ['a handle that is null', '{"handle":null}'],
    ['a handle that is a list', `{"handle":["${HANDLE}"]}`],
    ['another key beside the handle', `{"handle":"${HANDLE}","x":1}`],
    ['another key instead of the handle', `{"Handle":"${HANDLE}"}`],
    ['broken JSON', `{"handle":"${HANDLE}"`],
  ])('answers 400 for %s, and asks the database nothing', async (_name, body) => {
    await refused(await post(body));
  });

  it('answers 400 for a body of more than 256 bytes, however it is sent, and stops reading at the cap', async () => {
    const padded = `{"handle":"${HANDLE}","pad":"${'x'.repeat(300)}"}`;
    await refused(await post(padded));
    await refused(await post(padded, {'content-length': '5'}));
    // A body that declares nothing and just keeps coming: it is cancelled, not read to the end.
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(100));
        if (pulled > 1000) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    await refused(await route.POST(new Request('http://127.0.0.1:4173/api/status', {method: 'POST', body: stream, headers: {origin: 'http://127.0.0.1:4173'}, duplex: 'half'} as RequestInit)));
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
  });

  it('answers 400 for a Content-Length over the cap without reading the body, and for one that is not a number', async () => {
    await refused(await post(JSON.stringify({handle: HANDLE}), {'content-length': '257'}));
    await refused(await post(JSON.stringify({handle: HANDLE}), {'content-length': 'many'}));
  });

  it('accepts a body of exactly the handle\'s shape however it is spaced, and ignores the query string: the handle is read from the body alone', async () => {
    answer = database({outcome: 'active', revision: 1, retry_after: null});
    expect((await post(`  { "handle" :\n "${HANDLE}" }  `)).status).toBe(200);
    expect(calls).toHaveLength(1);
    calls.length = 0;
    // A handle in the URL is no handle at all.
    await refused(await post(null, {}, `http://127.0.0.1:4173/api/status?handle=${HANDLE}`));
    await refused(await post('{}', {}, `http://127.0.0.1:4173/api/status?handle=${HANDLE}`));
  });

  it('answers 400, never cached and in the same shape, when the body stream errors or is aborted while it is read: no unhandled rejection, no bare 500', async () => {
    const failing = (fail: (controller: ReadableStreamDefaultController<Uint8Array>) => void) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"handle":"'));
        },
        pull(controller) {
          fail(controller);
        },
      });
    const send = (stream: ReadableStream<Uint8Array>) =>
      route.POST(new Request('http://127.0.0.1:4173/api/status', {method: 'POST', body: stream, headers: {origin: 'http://127.0.0.1:4173'}, duplex: 'half'} as RequestInit));
    // The stream is errored by its source part way through.
    await refused(await send(failing((controller) => controller.error(new Error('connection reset')))));
    // ... and by an abort of the whole request, which rejects the read with an AbortError.
    await refused(await send(failing((controller) => controller.error(new DOMException('The operation was aborted.', 'AbortError')))));
    // ... and by a request whose body cannot be opened at all.
    const unreadable = {
      headers: new Headers({origin: 'http://127.0.0.1:4173'}),
      get body(): ReadableStream<Uint8Array> {
        throw new TypeError('body cannot be read');
      },
    } as unknown as Request;
    await refused(await route.POST(unreadable));
    // Nothing was looked up, and the handle that arrived before the error was not used.
    expect(calls).toEqual([]);
  });

  it('answers 400 for a body that is not UTF-8', async () => {
    await refused(await post(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])));
  });
});

describe('nothing is logged', () => {
  it('prints nothing in any case: the request holds a handle', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    answer = database({outcome: 'active', revision: 1, retry_after: null});
    await lookup();
    answer = database({outcome: 'limited', retry_after: 3});
    await lookup();
    answer = () => { throw new TypeError('fetch failed'); };
    await lookup();
    await post('nonsense');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('puts the handle in no response it sends except by the state it names: no echo', async () => {
    answer = database({outcome: 'deleted', revision: 3, retry_after: null});
    const text = await (await lookup()).text();
    expect(text).not.toContain(HANDLE);
    answer = () => { throw new TypeError('fetch failed'); };
    expect(await (await lookup()).text()).not.toContain(HANDLE);
    expect(await (await post('{}')).text()).not.toContain(HANDLE);
  });
});
