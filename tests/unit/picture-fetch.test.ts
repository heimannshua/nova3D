import {createHash} from 'node:crypto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  downloadUrl,
  fetchDownloadTicket,
  fetchProblems,
  fetchRetryable,
  fetchStagedPicture,
  fetchTimeoutMs,
  getProblem,
  heldFile,
  heldForMs,
  holdFiles,
  loadPicture,
  releaseFiles,
  releaseUnlessSaved,
  type FetchDeps,
} from '@/lib/picture-fetch';
import {maxPictureBytes} from '@/lib/picture-set';

// Reading a saved picture back (Story 2.3, lib/picture-fetch.ts) with fakes: one download ticket for each picture, by the application's own fetch, exactly the three
// members the ticket route takes; the GET goes to the gateway the ticket names, with the ticket in a header and nothing else; the bytes must have the saved SHA-256
// and length or they are not used (the body is read through a reader that stops at the saved length); every answer is a named problem and nothing throws; each request
// has 30 seconds; the Files of the picture screen are held for the last Save only, for 15 minutes at most, and a held File is used only if it is the saved one.
const ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const bytes = new TextEncoder().encode('the bytes of a picture');
const SHA = createHash('sha256').update(bytes).digest('hex');
const GATEWAY = 'http://127.0.0.1:4175';
const picture = {uploadId: ID, sha256: SHA, length: bytes.length};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
afterEach(() => releaseFiles());

type Calls = {tickets: [string, RequestInit][]; gets: [string, RequestInit][]};
function world(options: {ticket?: Response | (() => Response | Promise<Response>); get?: Response | (() => Response | Promise<Response>)} = {}) {
  const calls: Calls = {tickets: [], gets: []};
  const resolve = async (value: Response | (() => Response | Promise<Response>) | undefined, fallback: () => Response) => (typeof value === 'function' ? value() : value ?? fallback());
  const deps: FetchDeps = {
    ticketFetch: async (url, init) => {
      calls.tickets.push([url, init]);
      return resolve(options.ticket, () => json(200, {ticket: 'TICKET.VALUE', gateway: GATEWAY}));
    },
    gatewayFetch: async (url, init) => {
      calls.gets.push([url, init]);
      return resolve(options.get, () => new Response(bytes, {status: 200}));
    },
  };
  return {deps, calls};
}

describe('the download ticket', () => {
  it('is asked of the application\'s own ticket route with exactly the direction, the kind and the upload ID', async () => {
    const {deps, calls} = world();
    expect(await fetchDownloadTicket(ID, deps)).toEqual({ok: true, ticket: 'TICKET.VALUE', gateway: GATEWAY});
    expect(calls.tickets).toHaveLength(1);
    const [url, init] = calls.tickets[0];
    expect(url).toBe('/api/transfers/tickets');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({direction: 'download', kind: 'staging', id: ID});
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(['direction', 'id', 'kind']);
    expect(init.cache).toBe('no-store');
  });

  it.each([
    [401, 'reload'],
    [403, 'reload'],
    [400, 'refused'],
    [404, 'refused'],
    [413, 'refused'],
    [408, 'unavailable'],
    [425, 'unavailable'],
    [429, 'unavailable'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('answers a status of %s as %s', async (status, problem) => {
    expect(await fetchDownloadTicket(ID, world({ticket: json(status, {})}).deps)).toEqual({ok: false, problem});
  });

  it('is a network problem when the application cannot be reached, and a refusal when the answer is not a ticket', async () => {
    const down = world({ticket: () => { throw new TypeError('fetch failed'); }});
    expect(await fetchDownloadTicket(ID, down.deps)).toEqual({ok: false, problem: 'network'});
    for (const body of [{}, {ticket: 'x'}, {gateway: GATEWAY}, {ticket: '', gateway: GATEWAY}, {ticket: 5, gateway: GATEWAY}, [], 'text']) {
      expect(await fetchDownloadTicket(ID, world({ticket: json(200, body)}).deps), JSON.stringify(body)).toEqual({ok: false, problem: 'refused'});
    }
    expect(await fetchDownloadTicket(ID, world({ticket: new Response('not json', {status: 200})}).deps)).toEqual({ok: false, problem: 'refused'});
  });
});

describe('the address of the download', () => {
  it('is the staged upload at the ORIGIN of the gateway the ticket names (its scheme, host and port), and nowhere else', () => {
    expect(downloadUrl(GATEWAY, ID)).toBe(`${GATEWAY}/v1/files/staging/${ID}`);
    expect(downloadUrl(`${GATEWAY}/`, ID)).toBe(`${GATEWAY}/v1/files/staging/${ID}`);
    // Nothing of the ticket's own address but its origin is used: not a path, not a query, not a fragment.
    expect(downloadUrl('https://gateway.example/base', ID)).toBe(`https://gateway.example/v1/files/staging/${ID}`);
    expect(downloadUrl('https://gateway.example/?x=1#frag', ID)).toBe(`https://gateway.example/v1/files/staging/${ID}`);
    expect(downloadUrl('https://gateway.example:8443/anything/at/all', ID)).toBe(`https://gateway.example:8443/v1/files/staging/${ID}`);
    expect(downloadUrl('HTTPS://Gateway.Example', ID)).toBe(`https://gateway.example/v1/files/staging/${ID}`);
  });

  it('is null for anything that is not a web address, or that holds a name and a password', () => {
    for (const gateway of ['', 'not a url', 'ftp://gateway.example', 'javascript:alert(1)', 'https://user:secret@gateway.example', 'https://user@gateway.example']) expect(downloadUrl(gateway, ID), gateway).toBeNull();
  });
});

describe('reading a saved picture back', () => {
  it('asks for a ticket, then GETs the gateway the ticket names with the ticket in a header and nothing else, and returns the bytes when they are the saved ones', async () => {
    const {deps, calls} = world();
    const result = await fetchStagedPicture(picture, {}, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blob.size).toBe(bytes.length);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    expect(calls.tickets).toHaveLength(1);
    expect(calls.gets).toHaveLength(1);
    const [url, init] = calls.gets[0];
    expect(url).toBe(`${GATEWAY}/v1/files/staging/${ID}`);
    expect(url).not.toContain('TICKET');
    expect(init).toMatchObject({method: 'GET', headers: {authorization: 'Ticket TICKET.VALUE'}, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'});
    expect(Object.keys(init.headers as object)).toEqual(['authorization']);
  });

  it('uses the gateway of the ticket and no other: a ticket that names another gateway is followed to it, and the application\'s origin is never asked for the bytes', async () => {
    const {deps, calls} = world({ticket: json(200, {ticket: 'T', gateway: 'https://gateway.example'})});
    await fetchStagedPicture(picture, {}, deps);
    expect(calls.gets[0][0]).toBe(`https://gateway.example/v1/files/staging/${ID}`);
  });

  it('does not use bytes whose SHA-256 is not the saved one: the picture is changed', async () => {
    const other = new TextEncoder().encode('the bytes of a picture!');
    expect(await fetchStagedPicture({...picture, length: other.length}, {}, world({get: new Response(other, {status: 200})}).deps)).toEqual({ok: false, problem: 'changed'});
    // Same length, different bytes.
    const same = new TextEncoder().encode('the bytes of a pictur3');
    expect(await fetchStagedPicture(picture, {}, world({get: new Response(same, {status: 200})}).deps)).toEqual({ok: false, problem: 'changed'});
  });

  it('does not use bytes whose length is not the saved one, however they hash, nor more than a picture can be', async () => {
    expect(await fetchStagedPicture({...picture, length: bytes.length + 1}, {}, world().deps)).toEqual({ok: false, problem: 'changed'});
    const big = new Uint8Array(maxPictureBytes + 1);
    const huge = {uploadId: ID, sha256: createHash('sha256').update(big).digest('hex'), length: big.length};
    expect(await fetchStagedPicture(huge, {}, world({get: new Response(big, {status: 200})}).deps)).toEqual({ok: false, problem: 'changed'});
  });

  it.each([
    [404, 'lapsed'],
    [410, 'lapsed'],
    [401, 'reload'],
    [403, 'reload'],
    [400, 'refused'],
    [413, 'refused'],
    [416, 'refused'],
    [408, 'network'],
    [425, 'network'],
    [429, 'network'],
    [500, 'network'],
    [502, 'network'],
    [503, 'network'],
    [504, 'network'],
  ] as const)('answers a gateway status of %s as %s', async (status, problem) => {
    expect(await fetchStagedPicture(picture, {}, world({get: json(status, {error: 'x'})}).deps)).toEqual({ok: false, problem});
    expect(getProblem(status)).toBe(problem);
  });

  it('does not accept a partial answer: 206 is not the whole picture', async () => {
    expect(await fetchStagedPicture(picture, {}, world({get: new Response(bytes, {status: 206})}).deps)).toEqual({ok: false, problem: 'refused'});
  });

  it('is a network problem when the gateway cannot be reached or the body is cut, and never a throw', async () => {
    const gone = world({get: () => { throw new TypeError('fetch failed'); }});
    expect(await fetchStagedPicture(picture, {}, gone.deps)).toEqual({ok: false, problem: 'network'});
    const cut = new Response(new ReadableStream({start: (controller) => controller.error(new TypeError('terminated'))}), {status: 200});
    expect(await fetchStagedPicture(picture, {}, world({get: cut}).deps)).toEqual({ok: false, problem: 'network'});
  });

  it('stops at the ticket when it is refused, and asks the gateway for nothing', async () => {
    const refused = world({ticket: json(503, {})});
    expect(await fetchStagedPicture(picture, {}, refused.deps)).toEqual({ok: false, problem: 'unavailable'});
    expect(refused.calls.gets).toEqual([]);
    const reload = world({ticket: json(403, {})});
    expect(await fetchStagedPicture(picture, {}, reload.deps)).toEqual({ok: false, problem: 'reload'});
    expect(reload.calls.gets).toEqual([]);
  });

  it('refuses to GET a gateway address that is not a web address, with nothing sent', async () => {
    const odd = world({ticket: json(200, {ticket: 'T', gateway: 'ftp://gateway.example'})});
    expect(await fetchStagedPicture(picture, {}, odd.deps)).toEqual({ok: false, problem: 'refused'});
    expect(odd.calls.gets).toEqual([]);
  });

  it('asks for nothing at all once it is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const {deps, calls} = world();
    expect(await fetchStagedPicture(picture, {signal: controller.signal}, deps)).toEqual({ok: false, problem: 'network'});
    expect(calls.tickets).toEqual([]);
    expect(calls.gets).toEqual([]);
  });

  it('gives the download a signal that ends when the caller\'s does (it is also the request\'s own time limit), and asks for a new ticket each time', async () => {
    const controller = new AbortController();
    const {deps, calls} = world();
    let seen: [boolean, boolean] | undefined;
    const base = deps.gatewayFetch!;
    deps.gatewayFetch = async (url, init) => {
      const given = init.signal as AbortSignal;
      const before = given.aborted;
      controller.abort();
      seen = [before, given.aborted];
      return base(url, init);
    };
    await fetchStagedPicture(picture, {signal: controller.signal}, deps);
    expect(calls.gets[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(seen).toEqual([false, true]);
    deps.gatewayFetch = base;
    await fetchStagedPicture(picture, {}, deps);
    expect(calls.tickets).toHaveLength(2);
    expect(calls.gets).toHaveLength(2);
  });

  it('does not read a body whose announced length is not the saved one: the body is given up unread', async () => {
    let cancelled = 0;
    const announced = (length: number) =>
      new Response(new ReadableStream({pull: (controller) => { controller.enqueue(bytes); controller.close(); }, cancel: () => { cancelled += 1; }}), {status: 200, headers: {'content-length': String(length)}});
    expect(await fetchStagedPicture(picture, {}, world({get: announced(bytes.length + 1)}).deps)).toEqual({ok: false, problem: 'changed'});
    expect(await fetchStagedPicture(picture, {}, world({get: announced(bytes.length - 1)}).deps)).toEqual({ok: false, problem: 'changed'});
    expect(cancelled).toBe(2);
    // An announced length that is the saved one is read (and still checked).
    const right = await fetchStagedPicture(picture, {}, world({get: new Response(bytes, {status: 200, headers: {'content-length': String(bytes.length)}})}).deps);
    expect(right.ok).toBe(true);
  });

  it('stops reading as soon as more than the saved length has arrived: a body that never ends is `changed` and is cancelled', async () => {
    let pulls = 0;
    let cancelled = false;
    const endless = new Response(
      new ReadableStream({
        pull: (controller) => {
          pulls += 1;
          controller.enqueue(new Uint8Array(10));
        },
        cancel: () => { cancelled = true; },
      }),
      {status: 200},
    );
    expect(await fetchStagedPicture({uploadId: ID, sha256: SHA, length: 22}, {}, world({get: endless}).deps)).toEqual({ok: false, problem: 'changed'});
    expect(cancelled).toBe(true);
    // Three chunks pass the saved length of 22 bytes; a few more may have been prepared by the stream, but never a runaway.
    expect(pulls).toBeLessThanOrEqual(6);
  });

  it('is `changed` when the body ends before the saved length, however the announced length reads', async () => {
    const short = bytes.slice(0, bytes.length - 3);
    expect(await fetchStagedPicture(picture, {}, world({get: new Response(short, {status: 200})}).deps)).toEqual({ok: false, problem: 'changed'});
    expect(await fetchStagedPicture(picture, {}, world({get: new Response(null, {status: 200})}).deps)).toEqual({ok: false, problem: 'changed'});
  });

  it('is a refusal, not a throw, when the page cannot hash (no secure context)', async () => {
    const insecure = world();
    const failing: FetchDeps = {...insecure.deps, digest: async () => { throw new TypeError('This page cannot hash a file'); }};
    expect(await fetchStagedPicture(picture, {}, failing)).toEqual({ok: false, problem: 'refused'});
  });

  it('stores, shows and logs nothing: no log line, no storage and no object URL is made', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const create = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, {createObjectURL: create}));
    try {
      await fetchStagedPicture(picture, {}, world().deps);
      await fetchStagedPicture(picture, {}, world({get: json(404, {})}).deps);
      expect(create).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
    }
  });
});

describe('the problems', () => {
  it('are six, and only a download that did not answer is worth trying again', () => {
    expect([...fetchProblems]).toEqual(['lapsed', 'changed', 'reload', 'refused', 'unavailable', 'network']);
    expect(fetchProblems.filter(fetchRetryable)).toEqual(['unavailable', 'network']);
  });
});

describe('the Files of the picture screen', () => {
  const file = (name: string) => new File([new Uint8Array(4)], name, {type: 'image/png'});
  const upload = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('are held by upload ID for the last Save only, and let go of on request', () => {
    expect(heldFile(upload(1))).toBeNull();
    holdFiles([{uploadId: upload(1), file: file('a.png')}, {uploadId: upload(2), file: file('b.png')}]);
    expect(heldFile(upload(1))?.name).toBe('a.png');
    expect(heldFile(upload(2))?.name).toBe('b.png');
    holdFiles([{uploadId: upload(3), file: file('c.png')}]);
    expect(heldFile(upload(1))).toBeNull();
    expect(heldFile(upload(3))?.name).toBe('c.png');
    releaseFiles();
    expect(heldFile(upload(3))).toBeNull();
  });

  it('are let go of by themselves after 15 minutes, counted from the last Save, and never kept by a timer that outlives them', () => {
    vi.useFakeTimers();
    try {
      holdFiles([{uploadId: upload(1), file: file('a.png')}]);
      vi.advanceTimersByTime(heldForMs - 1);
      expect(heldFile(upload(1))?.name).toBe('a.png');
      vi.advanceTimersByTime(1);
      expect(heldFile(upload(1))).toBeNull();
      expect(heldForMs).toBe(15 * 60_000);
      expect(vi.getTimerCount()).toBe(0);
      // A later Save starts the 15 minutes again; the earlier timer does not release the newer Files.
      holdFiles([{uploadId: upload(2), file: file('b.png')}]);
      vi.advanceTimersByTime(10 * 60_000);
      holdFiles([{uploadId: upload(3), file: file('c.png')}]);
      vi.advanceTimersByTime(10 * 60_000);
      expect(heldFile(upload(3))?.name).toBe('c.png');
      vi.advanceTimersByTime(5 * 60_000);
      expect(heldFile(upload(3))).toBeNull();
      // Letting go clears the timer, and holding nothing sets none.
      holdFiles([{uploadId: upload(4), file: file('d.png')}]);
      releaseFiles();
      expect(vi.getTimerCount()).toBe(0);
      holdFiles([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('are let go of when the answer to a Save says the pictures were not saved, and kept when it says they were', () => {
    for (const outcome of ['created', 'revised', 'replayed', 'unchanged']) {
      holdFiles([{uploadId: upload(1), file: file('a.png')}]);
      releaseUnlessSaved(outcome);
      expect(heldFile(upload(1)), outcome).not.toBeNull();
    }
    for (const outcome of ['idle', 'invalid', 'unknown_upload', 'not_ready', 'expired_upload', 'duplicate_image', 'too_large', 'reused', 'gone', 'not_editable', 'unavailable', 'anything else']) {
      holdFiles([{uploadId: upload(1), file: file('a.png')}]);
      releaseUnlessSaved(outcome);
      expect(heldFile(upload(1)), outcome).toBeNull();
    }
  });

  it('are at most twelve', () => {
    holdFiles(Array.from({length: 15}, (_, index) => ({uploadId: upload(index + 1), file: file(`f${index + 1}.png`)})));
    expect(heldFile(upload(12))).not.toBeNull();
    expect(heldFile(upload(13))).toBeNull();
  });
});

describe('the time each request has', () => {
  const hang = () => new Promise<Response>(() => undefined);

  it('is 30 seconds for the ticket: a ticket request that is not answered by then is the retryable network problem, and the request is aborted', async () => {
    vi.useFakeTimers();
    try {
      let given: AbortSignal | undefined;
      const deps: FetchDeps = { ticketFetch: (_url, init) => { given = init.signal as AbortSignal; return hang(); } };
      let answer: unknown;
      void fetchDownloadTicket(ID, deps).then((result) => { answer = result; });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(answer).toBeUndefined();
      expect(given?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toEqual({ok: false, problem: 'network'});
      expect(given?.aborted).toBe(true);
      expect(fetchTimeoutMs).toBe(30_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is 30 seconds for the download, from its start to the last byte: a gateway that does not answer, or a body that stalls, is the retryable network problem', async () => {
    vi.useFakeTimers();
    try {
      for (const stalled of [hang, () => Promise.resolve(new Response(new ReadableStream({pull: () => new Promise(() => undefined)}), {status: 200}))]) {
        const deps = world({get: stalled}).deps;
        let answer: unknown;
        void fetchStagedPicture(picture, {}, deps).then((result) => { answer = result; });
        await vi.advanceTimersByTimeAsync(29_999);
        expect(answer).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(answer).toEqual({ok: false, problem: 'network'});
        expect(vi.getTimerCount()).toBe(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('has a limit that can be given, and leaves no timer behind when the answer comes in time', async () => {
    vi.useFakeTimers();
    try {
      const deps = {...world({get: hang}).deps, timeoutMs: 2000};
      const pending = fetchStagedPicture(picture, {}, deps);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toEqual({ok: false, problem: 'network'});
      expect((await fetchStagedPicture(picture, {}, world().deps)).ok).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not waited for once the caller has gone: the caller\'s abort ends the request at once', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let given: AbortSignal | undefined;
      const deps: FetchDeps = { ticketFetch: (_url, init) => { given = init.signal as AbortSignal; return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); } };
      const pending = fetchDownloadTicket(ID, deps, controller.signal);
      controller.abort();
      expect(await pending).toEqual({ok: false, problem: 'network'});
      expect(given?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('one picture, from wherever it is', () => {
  const file = (content: Uint8Array<ArrayBuffer>, name = 'held.png') => new File([content], name, {type: 'image/png'});

  it('is the File the picture screen handed over when it is the saved one: nothing is asked of the gateway', async () => {
    holdFiles([{uploadId: ID, file: file(bytes)}]);
    const {deps, calls} = world();
    const loaded = await loadPicture(picture, {}, deps);
    expect(loaded.ok && loaded.from).toBe('held');
    expect(calls.tickets).toEqual([]);
    expect(calls.gets).toEqual([]);
  });

  it('is NOT a held File whose SHA-256 is not the saved one: it is not used and the picture is read back by a ticket', async () => {
    // Same length, different bytes: the File has changed since it was uploaded (or is not the picture that was saved).
    holdFiles([{uploadId: ID, file: file(new TextEncoder().encode('the bytes of a pictur3'))}]);
    const {deps, calls} = world();
    const loaded = await loadPicture(picture, {}, deps);
    expect(loaded.ok && loaded.from).toBe('gateway');
    expect(calls.tickets).toHaveLength(1);
    expect(calls.gets).toHaveLength(1);
    if (loaded.ok) expect(new Uint8Array(await loaded.blob.arrayBuffer())).toEqual(bytes);
  });

  it('is shown as changed or lapsed, never measured, when the held File is not the saved one and the gateway cannot give the saved bytes', async () => {
    holdFiles([{uploadId: ID, file: file(new TextEncoder().encode('the bytes of a pictur3'))}]);
    const gone = await loadPicture(picture, {}, world({get: json(404, {})}).deps);
    expect(gone).toEqual({ok: false, problem: 'lapsed'});
    const altered = await loadPicture(picture, {}, world({get: new Response(new TextEncoder().encode('the bytes of a pictur3'), {status: 200})}).deps);
    expect(altered).toEqual({ok: false, problem: 'changed'});
  });

  it('is read back when no File is held for the picture, or only another picture\'s', async () => {
    const {deps, calls} = world();
    expect((await loadPicture(picture, {}, deps)).ok).toBe(true);
    holdFiles([{uploadId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', file: file(bytes)}]);
    expect((await loadPicture(picture, {}, deps)).ok).toBe(true);
    expect(calls.tickets).toHaveLength(2);
  });

  it('falls back to the gateway when this page cannot hash a held File, which cannot be checked either', async () => {
    holdFiles([{uploadId: ID, file: file(bytes)}]);
    const insecure = world();
    const loaded = await loadPicture(picture, {}, {...insecure.deps, digest: async () => { throw new TypeError('This page cannot hash a file'); }});
    expect(loaded).toEqual({ok: false, problem: 'refused'});
    expect(insecure.calls.tickets).toHaveLength(1);
  });
});
