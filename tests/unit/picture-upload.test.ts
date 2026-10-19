import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  canHash,
  createUploadQueue,
  fetchTicket,
  putPicture,
  putProblem,
  sha256Hex,
  ticketProblem,
  uploadPicture,
  uploadTimeoutMs,
  uploadUrl,
  type UploadDeps,
  type UploadRequest,
} from '@/lib/picture-upload';
import type { UploadProblem } from '@/lib/picture-set';

// The browser's half of staging a picture (Story 2.2, lib/picture-upload.ts), with every dependency injected: the hash, the upload ID, the ticket request and the
// XMLHttpRequest. What is pinned: the exact ticket request, that the gateway used is the one in the ticket and no other, the headers of the PUT, and that every
// answer of the gateway (and every way the connection can break) becomes a named problem and never a thrown error.
const ID = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const SHA = 'a'.repeat(64);
const GATEWAY = 'http://127.0.0.1:4175';
const TICKET = 'header.payload.signature';

/** A picture whose bytes are known: a File of these bytes. */
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const photo = () => new File([bytes], 'photo.jpg', {type: 'image/jpeg'});

/** A fake XMLHttpRequest that records what it was told and lets a test play the browser's events. */
class FakeRequest implements UploadRequest {
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sent: Blob[] = [];
  aborted = 0;
  timeout = 0;
  status = 0;
  responseText = '';
  openError: Error | null = null;
  sendError: Error | null = null;
  private listeners = new Map<string, (() => void)[]>();
  private progressListeners: ((event: {loaded: number; total: number}) => void)[] = [];
  upload = {addEventListener: (_type: 'progress', listener: (event: {loaded: number; total: number}) => void) => void this.progressListeners.push(listener)};
  open(method: 'PUT', url: string) {
    if (this.openError) throw this.openError;
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  send(body: Blob) {
    if (this.sendError) throw this.sendError;
    this.sent.push(body);
  }
  abort() {
    this.aborted += 1;
    this.fire('abort');
  }
  addEventListener(type: 'load' | 'error' | 'abort' | 'timeout', listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: 'load' | 'error' | 'abort' | 'timeout') {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  progress(loaded: number, total: number) {
    for (const listener of this.progressListeners) listener({loaded, total});
  }
  answer(status: number, body: unknown = {}) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.fire('load');
  }
}

/** Deps that make a request the test can reach, and count how many were made. */
function requests() {
  const made: FakeRequest[] = [];
  const deps: UploadDeps = {
    createRequest: () => {
      const request = new FakeRequest();
      made.push(request);
      return request;
    },
  };
  return {made, deps};
}
const answerWith = (status: number, body: unknown = {}) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
const input = (extra: Record<string, unknown> = {}) => ({id: ID, length: 8, sha256: SHA, contentType: 'image/jpeg' as const, ...extra});
const putInput = (extra: Record<string, unknown> = {}) => ({gateway: GATEWAY, ticket: TICKET, id: ID, file: photo(), sha256: SHA, contentType: 'image/jpeg' as const, ...extra});
const tick = () => new Promise((done) => setTimeout(done, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hashing', () => {
  it('is the SHA-256 of the whole file, in lower-case hex, as node:crypto makes it', async () => {
    const expected = createHash('sha256').update(bytes).digest('hex');
    expect(await sha256Hex(photo())).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    // The empty input too.
    expect(await sha256Hex(new Blob([]))).toBe(createHash('sha256').update('').digest('hex'));
  });

  it('hashes with the digest it is given, over the file\'s bytes', async () => {
    const seen: ArrayBuffer[] = [];
    const digest = async (data: ArrayBuffer) => {
      seen.push(data);
      return new Uint8Array([0, 1, 15, 255]).buffer;
    };
    expect(await sha256Hex(photo(), {digest})).toBe('00010fff');
    expect([...new Uint8Array(seen[0])]).toEqual([...bytes]);
  });

  it('rejects when the file cannot be read, and when the page cannot hash', async () => {
    const unreadable = {arrayBuffer: async () => { throw new DOMException('gone', 'NotFoundError'); }} as unknown as Blob;
    await expect(sha256Hex(unreadable)).rejects.toThrow();
    vi.stubGlobal('crypto', {});
    await expect(sha256Hex(photo())).rejects.toBeInstanceOf(TypeError);
  });

  it('can hash where there is a secure context, and says it cannot where there is not', () => {
    expect(canHash()).toBe(true);
    expect(canHash({digest: async () => new ArrayBuffer(0), randomUUID: () => ID})).toBe(true);
    vi.stubGlobal('crypto', {});
    expect(canHash()).toBe(false);
    vi.stubGlobal('crypto', {subtle: {}});
    expect(canHash()).toBe(false);
    vi.stubGlobal('crypto', {randomUUID: () => ID});
    expect(canHash()).toBe(false);
    vi.stubGlobal('crypto', {subtle: {}, randomUUID: () => ID});
    expect(canHash()).toBe(true);
    vi.stubGlobal('crypto', undefined);
    expect(canHash()).toBe(false);
  });
});

describe('the ticket', () => {
  it('is asked for with the exact body, in the order the contract gives it, as a POST to the application\'s own ticket route', async () => {
    const calls: {url: string; init: RequestInit}[] = [];
    const ticketFetch = async (url: string, init: RequestInit) => {
      calls.push({url, init});
      return answerWith(200, {ticket: TICKET, gateway: GATEWAY})();
    };
    expect(await fetchTicket(input(), {ticketFetch})).toEqual({ok: true, ticket: TICKET, gateway: GATEWAY});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/transfers/tickets');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.cache).toBe('no-store');
    expect(calls[0].init.body).toBe(`{"direction":"upload","kind":"staging","id":"${ID}","class":"picture","length":8,"sha256":"${SHA}","contentType":"image/jpeg"}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({direction: 'upload', kind: 'staging', id: ID, class: 'picture', length: 8, sha256: SHA, contentType: 'image/jpeg'});
  });

  it('asks for the type, length and digest it was given, not others', async () => {
    let body: Record<string, unknown> = {};
    const ticketFetch = async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return answerWith(200, {ticket: TICKET, gateway: GATEWAY})();
    };
    await fetchTicket(input({length: 482113, contentType: 'image/webp', sha256: 'b'.repeat(64)}), {ticketFetch});
    expect(body).toMatchObject({length: 482113, contentType: 'image/webp', sha256: 'b'.repeat(64)});
  });

  it.each<[number, UploadProblem]>([
    [401, 'reload'],
    [403, 'reload'],
    [400, 'rejected'],
    [413, 'rejected'],
    [404, 'rejected'],
    [503, 'unavailable'],
    [500, 'unavailable'],
    [502, 'unavailable'],
  ])('reads the status %i as %s', async (status, problem) => {
    expect(await fetchTicket(input(), {ticketFetch: answerWith(status, {error: 'x'})})).toEqual({ok: false, problem});
    expect(ticketProblem(status)).toBe(problem);
  });

  it('reads a connection that fails as network, and never throws', async () => {
    expect(await fetchTicket(input(), {ticketFetch: async () => { throw new TypeError('Failed to fetch'); }})).toEqual({ok: false, problem: 'network'});
    expect(await fetchTicket(input(), {ticketFetch: async () => { throw new Error('anything'); }})).toEqual({ok: false, problem: 'network'});
  });

  it.each([
    ['an answer that is not JSON', 'not json'],
    ['an answer that is a list', []],
    ['no ticket', {gateway: GATEWAY}],
    ['no gateway', {ticket: TICKET}],
    ['an empty ticket', {ticket: '', gateway: GATEWAY}],
    ['an empty gateway', {ticket: TICKET, gateway: ''}],
    ['a ticket that is not text', {ticket: 5, gateway: GATEWAY}],
  ])('reads %s as rejected', async (_name, body) => {
    expect(await fetchTicket(input(), {ticketFetch: answerWith(200, body)})).toEqual({ok: false, problem: 'rejected'});
  });
});

describe('where an upload goes', () => {
  it('is the ticket\'s gateway, at /v1/uploads/<id>', () => {
    expect(uploadUrl('http://127.0.0.1:4175', ID)).toBe(`http://127.0.0.1:4175/v1/uploads/${ID}`);
    expect(uploadUrl('https://files.example.com', ID)).toBe(`https://files.example.com/v1/uploads/${ID}`);
    expect(uploadUrl('https://files.example.com/', ID)).toBe(`https://files.example.com/v1/uploads/${ID}`);
  });

  it('keeps a path the gateway lives under, and drops a query and a fragment', () => {
    expect(uploadUrl('https://example.com/gateway', ID)).toBe(`https://example.com/gateway/v1/uploads/${ID}`);
    expect(uploadUrl('https://example.com/gateway/', ID)).toBe(`https://example.com/gateway/v1/uploads/${ID}`);
    expect(uploadUrl('https://example.com/gateway?x=1#frag', ID)).toBe(`https://example.com/gateway/v1/uploads/${ID}`);
  });

  it('is no address at all unless it is http or https without a name and a password', () => {
    for (const gateway of ['javascript:alert(1)', 'ftp://example.com', 'file:///etc/passwd', 'data:text/plain,hi', 'https://user:pass@example.com', 'https://user@example.com', 'nope', '', '//example.com']) {
      expect(uploadUrl(gateway, ID), gateway).toBeNull();
    }
  });
});

describe('the upload to the gateway', () => {
  it('is a PUT to the ticket\'s gateway with the ticket, the file\'s own type, its digest and the file as the body, and nothing else', async () => {
    const {made, deps} = requests();
    const file = photo();
    const result = putPicture(putInput({file}), {}, deps);
    expect(made).toHaveLength(1);
    const [request] = made;
    expect(request.method).toBe('PUT');
    expect(request.url).toBe(`${GATEWAY}/v1/uploads/${ID}`);
    expect(request.headers).toEqual({authorization: `Ticket ${TICKET}`, 'content-type': 'image/jpeg', 'x-content-sha256': SHA});
    expect(request.sent).toEqual([file]);
    expect(request.sent[0]).toBe(file);
    expect(request.timeout).toBe(uploadTimeoutMs);
    request.answer(201, {id: ID, length: 8, sha256: SHA});
    expect(await result).toEqual({ok: true});
  });

  it('sends the content type it is given, whatever the file says', async () => {
    const {made, deps} = requests();
    const result = putPicture(putInput({contentType: 'image/png'}), {}, deps);
    expect(made[0].headers['content-type']).toBe('image/png');
    made[0].answer(201);
    await result;
  });

  it('uses the gateway of the ticket and no other: a gateway that is not a web address is never contacted', async () => {
    const {made, deps} = requests();
    expect(await putPicture(putInput({gateway: 'javascript:alert(1)'}), {}, deps)).toEqual({ok: false, problem: 'rejected'});
    expect(await putPicture(putInput({gateway: 'https://u:p@example.com'}), {}, deps)).toEqual({ok: false, problem: 'rejected'});
    expect(made).toHaveLength(0);
  });

  it('tells how much has gone as a fraction from 0 to 1, ignores an event of unknown length, and is told 1 at the end', async () => {
    const {made, deps} = requests();
    const seen: number[] = [];
    const result = putPicture(putInput(), {onProgress: (fraction) => seen.push(fraction)}, deps);
    made[0].progress(0, 100);
    made[0].progress(25, 100);
    made[0].progress(5, 0);
    made[0].progress(150, 100);
    made[0].progress(-5, 100);
    made[0].answer(201);
    expect(await result).toEqual({ok: true});
    expect(seen).toEqual([0, 0.25, 1, 0, 1]);
  });

  it.each<[number, unknown, UploadProblem]>([
    [400, {error: 'content_mismatch'}, 'content'],
    [400, {error: 'checksum_mismatch'}, 'changed'],
    [400, {error: 'length_mismatch'}, 'changed'],
    [400, {error: 'invalid_upload'}, 'type'],
    [400, {error: 'content_type_mismatch'}, 'rejected'],
    [400, {error: 'unknown_target'}, 'rejected'],
    [400, {}, 'rejected'],
    [411, {error: 'length_required'}, 'rejected'],
    [413, {error: 'payload_too_large'}, 'too_large'],
    [413, {error: 'quota_exceeded'}, 'quota'],
    [413, {}, 'too_large'],
    [401, {error: 'invalid_ticket'}, 'reload'],
    [403, {error: 'forbidden'}, 'reload'],
    [403, {error: 'forbidden_origin'}, 'reload'],
    [404, {error: 'not_found'}, 'rejected'],
    [409, {error: 'upload_exists'}, 'conflict'],
    [409, {error: 'upload_ended'}, 'conflict'],
    [500, {}, 'unavailable'],
    [502, 'bad gateway', 'unavailable'],
    [503, {error: 'unavailable'}, 'unavailable'],
    [418, {}, 'rejected'],
  ])('reads %i %j as %s', async (status, body, problem) => {
    const {made, deps} = requests();
    const result = putPicture(putInput(), {}, deps);
    made[0].answer(status, body);
    expect(await result).toEqual({ok: false, problem});
    expect(putProblem(status, typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {})).toBe(problem);
  });

  it('reads an answer that is not JSON by its status alone', async () => {
    const {made, deps} = requests();
    const result = putPicture(putInput(), {}, deps);
    made[0].answer(409, '<html>conflict</html>');
    expect(await result).toEqual({ok: false, problem: 'conflict'});
  });

  it('reads status 0 as a broken connection', () => {
    expect(putProblem(0, {})).toBe('network');
  });

  it.each(['error', 'timeout', 'abort'] as const)('reads a %s event, such as a refused upload cut before its answer is read, as network and never throws', async (event) => {
    const {made, deps} = requests();
    const result = putPicture(putInput(), {}, deps);
    made[0].fire(event);
    expect(await result).toEqual({ok: false, problem: 'network'});
    // Late events change nothing: the first outcome stands.
    made[0].answer(201);
    expect(await result).toEqual({ok: false, problem: 'network'});
  });

  it('reads a request that cannot be made or sent as network', async () => {
    const opening = requests();
    const failing = new FakeRequest();
    failing.openError = new Error('InvalidStateError');
    expect(await putPicture(putInput(), {}, {createRequest: () => failing})).toEqual({ok: false, problem: 'network'});
    expect(await putPicture(putInput(), {}, {createRequest: () => { throw new Error('no XHR'); }})).toEqual({ok: false, problem: 'network'});
    const refusing = new FakeRequest();
    refusing.sendError = new Error('NetworkError');
    expect(await putPicture(putInput(), {}, {createRequest: () => refusing})).toEqual({ok: false, problem: 'network'});
    expect(opening.made).toHaveLength(0);
  });

  it('gives the upload up when the signal aborts: the request is aborted and the outcome is network', async () => {
    const {made, deps} = requests();
    const controller = new AbortController();
    const result = putPicture(putInput(), {signal: controller.signal}, deps);
    controller.abort();
    expect(await result).toEqual({ok: false, problem: 'network'});
    expect(made[0].aborted).toBe(1);
    // It stops listening to the signal once it is settled.
    made[0].answer(201);
    expect(made[0].aborted).toBe(1);
  });

  it('sends nothing at all when the signal is already aborted', async () => {
    const {made, deps} = requests();
    const controller = new AbortController();
    controller.abort();
    expect(await putPicture(putInput(), {signal: controller.signal}, deps)).toEqual({ok: false, problem: 'network'});
    expect(made[0]?.sent ?? []).toEqual([]);
  });
});

describe('one picture\'s whole upload', () => {
  /** The ticket answer a gateway-bound test wants, and a log of the order things happened in. */
  function world(options: {ticket?: () => Promise<Response>; ids?: string[]} = {}) {
    const log: string[] = [];
    const ids = [...(options.ids ?? [ID])];
    const {made, deps: put} = requests();
    const deps: UploadDeps = {
      randomUUID: () => {
        const id = ids.shift() ?? ID;
        log.push(`id:${id}`);
        return id;
      },
      ticketFetch: async (url, init) => {
        log.push(`ticket:${(JSON.parse(String(init.body)) as {id: string}).id}`);
        return options.ticket ? options.ticket() : answerWith(200, {ticket: TICKET, gateway: GATEWAY})();
      },
      createRequest: () => {
        log.push('put');
        return put.createRequest!();
      },
    };
    return {log, made, deps};
  }

  it('makes an upload ID, tells it first, fetches the ticket for that ID and only then puts the file there', async () => {
    const {log, made, deps} = world();
    const started: string[] = [];
    const file = photo();
    const result = uploadPicture(file, {sha256: SHA, contentType: 'image/jpeg'}, {onStart: (id) => { started.push(id); log.push('start'); }}, deps);
    await tick();
    expect(log).toEqual([`id:${ID}`, 'start', `ticket:${ID}`, 'put']);
    expect(started).toEqual([ID]);
    expect(made[0].url).toBe(`${GATEWAY}/v1/uploads/${ID}`);
    expect(made[0].sent[0]).toBe(file);
    made[0].answer(201, {id: ID});
    expect(await result).toEqual({ok: true, uploadId: ID});
  });

  it('asks for the ticket with the file\'s own length, and the digest and type it was told', async () => {
    let body: Record<string, unknown> = {};
    const {made, deps} = world();
    const base = deps.ticketFetch!;
    deps.ticketFetch = async (url, init) => {
      body = JSON.parse(String(init.body));
      return base(url, init);
    };
    const result = uploadPicture(photo(), {sha256: SHA, contentType: 'image/jpeg'}, {}, deps);
    await tick();
    expect(body).toEqual({direction: 'upload', kind: 'staging', id: ID, class: 'picture', length: bytes.length, sha256: SHA, contentType: 'image/jpeg'});
    made[0].answer(201);
    await result;
  });

  it('makes a NEW upload ID for every attempt, even for the same file', async () => {
    const other = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
    const {made, deps, log} = world({ids: [ID, other]});
    const first = uploadPicture(photo(), {sha256: SHA, contentType: 'image/jpeg'}, {}, deps);
    await tick();
    made[0].answer(409, {error: 'upload_exists'});
    expect(await first).toEqual({ok: false, problem: 'conflict'});
    const second = uploadPicture(photo(), {sha256: SHA, contentType: 'image/jpeg'}, {}, deps);
    await tick();
    expect(made[1].url).toBe(`${GATEWAY}/v1/uploads/${other}`);
    made[1].answer(201);
    expect(await second).toEqual({ok: true, uploadId: other});
    expect(log.filter((line) => line.startsWith('id:'))).toEqual([`id:${ID}`, `id:${other}`]);
  });

  it('uses the real random source and a real UUID when none is injected', async () => {
    const seen: string[] = [];
    const {made, deps} = requests();
    const result = uploadPicture(photo(), {sha256: SHA, contentType: 'image/jpeg'}, {onStart: (id) => seen.push(id)}, {
      ...deps,
      ticketFetch: answerWith(200, {ticket: TICKET, gateway: GATEWAY}),
    });
    await tick();
    expect(seen[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(made[0].url).toBe(`${GATEWAY}/v1/uploads/${seen[0]}`);
    made[0].answer(201);
    await result;
  });

  it.each<[number, UploadProblem]>([
    [401, 'reload'],
    [403, 'reload'],
    [503, 'unavailable'],
    [400, 'rejected'],
  ])('never reaches the gateway when the ticket is refused with %i: the problem is %s and no request is made', async (status, problem) => {
    const {made, log, deps} = world({ticket: answerWith(status, {error: 'x'})});
    expect(await uploadPicture(photo(), {sha256: SHA, contentType: 'image/jpeg'}, {}, deps)).toEqual({ok: false, problem});
    expect(made).toHaveLength(0);
    expect(log).not.toContain('put');
  });

  it('never reaches the gateway when the ticket request fails: network', async () => {
    const {made, deps} = world({ticket: async () => { throw new TypeError('Failed to fetch'); }});
    expect(await uploadPicture(photo(), {sha256: SHA, contentType: 'image/jpeg'}, {}, deps)).toEqual({ok: false, problem: 'network'});
    expect(made).toHaveLength(0);
  });

  it('passes the gateway\'s problem through, with no upload ID', async () => {
    const {made, deps} = world();
    const result = uploadPicture(photo(), {sha256: SHA, contentType: 'image/jpeg'}, {}, deps);
    await tick();
    made[0].answer(413, {error: 'quota_exceeded'});
    expect(await result).toEqual({ok: false, problem: 'quota'});
  });

  it('passes progress and the signal on to the upload', async () => {
    const {made, deps} = world();
    const seen: number[] = [];
    const controller = new AbortController();
    const result = uploadPicture(photo(), {sha256: SHA, contentType: 'image/jpeg'}, {onProgress: (fraction) => seen.push(fraction), signal: controller.signal}, deps);
    await tick();
    made[0].progress(1, 2);
    controller.abort();
    expect(await result).toEqual({ok: false, problem: 'network'});
    expect(seen).toEqual([0.5]);
    expect(made[0].aborted).toBe(1);
  });
});

describe('the upload queue', () => {
  it('runs tasks one at a time, in the order they were given', async () => {
    const queue = createUploadQueue();
    const log: string[] = [];
    let running = 0;
    let most = 0;
    const task = (name: string, wait: number) => async () => {
      running += 1;
      most = Math.max(most, running);
      log.push(`start ${name}`);
      await new Promise((done) => setTimeout(done, wait));
      log.push(`end ${name}`);
      running -= 1;
      return name;
    };
    const results = await Promise.all([queue.run(task('a', 15)), queue.run(task('b', 1)), queue.run(task('c', 5))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(most).toBe(1);
  });

  it('does not stop the tasks behind one that fails, and hands the failure to the one that asked', async () => {
    const queue = createUploadQueue();
    const ran: string[] = [];
    const failing = queue.run(async () => {
      ran.push('failing');
      throw new Error('boom');
    });
    const after = queue.run(async () => {
      ran.push('after');
      return 'ok';
    });
    await expect(failing).rejects.toThrow('boom');
    expect(await after).toBe('ok');
    expect(ran).toEqual(['failing', 'after']);
    // And a queue that has emptied runs the next task at once.
    expect(await queue.run(async () => 'later')).toBe('later');
  });

  it('keeps separate queues apart', async () => {
    const one = createUploadQueue();
    const two = createUploadQueue();
    const log: string[] = [];
    const slow = one.run(async () => {
      await new Promise((done) => setTimeout(done, 20));
      log.push('slow');
    });
    await two.run(async () => {
      log.push('quick');
    });
    await slow;
    expect(log).toEqual(['quick', 'slow']);
  });
});

describe('what this module may touch', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../lib/picture-upload.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('imports only the browser-safe CSRF helper and types, and reads no environment', () => {
    const imports = [...source.matchAll(/^\s*import\b.*$/gm)].map((match) => match[0].trim());
    expect(imports).toEqual(["import {csrfFetch} from './csrf-client';", "import type {PictureType, UploadProblem} from './picture-set';"]);
    expect(source).not.toMatch(/process\.env|\bprocess\b|FILE_GATEWAY_URL|SERVICE_KEYS_|SERVICE_SIGNING_KEY|node:|x-csrf-token|nova3d-csrf/);
  });

  it('never reads a download: the only network calls are the ticket and the PUT', () => {
    expect(source).not.toMatch(/method: 'GET'|\.get\(|createObjectURL|download|\/v1\/files|\/d\//);
    expect([...source.matchAll(/\bfetch\(/g)]).toHaveLength(0);
    expect([...source.matchAll(/new XMLHttpRequest\(/g)]).toHaveLength(1);
  });
});
