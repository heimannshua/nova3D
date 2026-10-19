// Story 2.2. The browser's half of staging a picture privately: hash the file, fetch a single-use ticket from the application, and send the file to
// the file gateway (Story 1.12, workers/files) with it. The picture's bytes never pass through the application's server (a Vercel function caps a body at
// 4.5 MB) and the application never fetches, stores, renders or links a download of a staged picture: all it learns of an upload is the answer here.
//
// The steps of one picture, in order:
//   1. SHA-256 of the whole file (`crypto.subtle.digest`, which exists only in a secure context: `canHash` says whether it does, and the screen says so
//      when it does not);
//   2. an upload ID from `crypto.randomUUID()`, NEW FOR EVERY ATTEMPT (the gateway never accepts an upload ID twice, so a retry is a different upload);
//   3. the ticket, fetched IMMEDIATELY before the upload with the existing `csrfFetch` (a ticket is valid for five minutes and for one use), with the
//      exact body {direction:'upload', kind:'staging', id, class:'picture', length, sha256, contentType};
//   4. `PUT <gateway>/v1/uploads/<id>` by XMLHttpRequest (so progress can be shown) with `Authorization: Ticket …`, the file's content type,
//      `x-content-sha256` and the file as the body. The gateway's address is the one in the ticket answer and NOWHERE ELSE: the browser reads no environment.
//
// Every answer becomes a named problem (lib/picture-set.ts `UploadProblem`); nothing here throws for a gateway that refuses, is down, or cuts the connection
// before its answer is read (it does that to a refused upload on purpose: the refusal arrives as a broken connection, which is the retryable `network`).
// Uploads run one at a time (`createUploadQueue`). Every dependency is injectable, so the tests give it fakes and run it in Node.
//
// BROWSER-SAFE: no Node module, no server-only module. It touches `crypto`, `fetch` and `XMLHttpRequest` only inside a function.
import {csrfFetch} from './csrf-client';
import type {PictureType, UploadProblem} from './picture-set';

/** How long the whole PUT of one picture may take before it is given up (the gateway's own limit is longer). */
export const uploadTimeoutMs = 15 * 60_000;

/** The part of an `XMLHttpRequest` an upload uses, so a test can hand it a fake. */
export type UploadRequest = {
  open(method: 'PUT', url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  abort(): void;
  addEventListener(type: 'load' | 'error' | 'abort' | 'timeout', listener: () => void): void;
  upload: {addEventListener(type: 'progress', listener: (event: {loaded: number; total: number}) => void): void};
  readonly status: number;
  readonly responseText: string;
  timeout: number;
};

export type UploadDeps = {
  /** SHA-256 of some bytes (`crypto.subtle.digest('SHA-256', …)`). */
  digest?: (data: ArrayBuffer) => Promise<ArrayBuffer>;
  /** A new upload ID. */
  randomUUID?: () => string;
  /** The application's own `fetch` for a mutation: attaches the CSRF token, same origin only. */
  ticketFetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** A new request for the PUT. */
  createRequest?: () => UploadRequest;
};

const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : undefined);

/**
 * Whether this page can hash a file at all: `crypto.subtle` exists only in a secure context (https, or localhost). The upload ID is also made with
 * `crypto.randomUUID`, which needs the same. A page that cannot says so, instead of failing on the first file.
 */
export function canHash(deps: UploadDeps = {}): boolean {
  if (deps.digest && deps.randomUUID) return true;
  return subtle() !== undefined && typeof crypto.randomUUID === 'function';
}

/** SHA-256 of the whole file, in lower-case hex. Rejects when the file cannot be read or the page cannot hash. */
export async function sha256Hex(file: Blob, deps: UploadDeps = {}): Promise<string> {
  const digest = deps.digest ?? ((data: ArrayBuffer) => {
    const engine = subtle();
    if (!engine) throw new TypeError('This page cannot hash a file (it is not a secure context).');
    return engine.digest('SHA-256', data);
  });
  const bytes = new Uint8Array(await digest(await file.arrayBuffer()));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// What the answers mean -------------------------------------------------------------------------------------------------------

/** What a ticket request answers: the ticket and the gateway's address, or why not. */
export type TicketOutcome = {ok: true; ticket: string; gateway: string} | {ok: false; problem: UploadProblem};
/** What the upload answers. */
export type PutOutcome = {ok: true} | {ok: false; problem: UploadProblem};
/** What one picture's whole upload answers: its upload ID, or why not. */
export type UploadOutcome = {ok: true; uploadId: string} | {ok: false; problem: UploadProblem};

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The problem a status the application's ticket route answered means. */
export function ticketProblem(status: number): UploadProblem {
  if (status === 401 || status === 403) return 'reload';
  if (status === 503 || status >= 500) return 'unavailable';
  return 'rejected';
}

/**
 * Asks the application for a ticket for ONE upload: the exact body {direction:'upload', kind:'staging', id, class:'picture', length, sha256, contentType},
 * through `csrfFetch` (same origin, the CSRF token echoed). 401 and 403 mean the session or the page's token is no longer good (a missing token is a 403
 * until the page is loaded again); 503 and a connection that fails are worth trying again.
 */
export async function fetchTicket(input: {id: string; length: number; sha256: string; contentType: PictureType}, deps: UploadDeps = {}): Promise<TicketOutcome> {
  const send = deps.ticketFetch ?? ((url: string, init: RequestInit) => csrfFetch(url, init));
  let response: Response;
  try {
    response = await send('/api/transfers/tickets', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({direction: 'upload', kind: 'staging', id: input.id, class: 'picture', length: input.length, sha256: input.sha256, contentType: input.contentType}),
      cache: 'no-store',
    });
  } catch {
    return {ok: false, problem: 'network'};
  }
  if (response.status !== 200) return {ok: false, problem: ticketProblem(response.status)};
  const body = await jsonOf(response);
  if (typeof body.ticket !== 'string' || typeof body.gateway !== 'string' || !body.ticket || !body.gateway) return {ok: false, problem: 'rejected'};
  return {ok: true, ticket: body.ticket, gateway: body.gateway};
}

/** The address of an upload at the gateway the ticket named, or null when that is no web address (or holds a name and a password). */
export function uploadUrl(gateway: string, id: string): string | null {
  try {
    const base = new URL(gateway);
    if ((base.protocol !== 'http:' && base.protocol !== 'https:') || base.username || base.password) return null;
    base.search = '';
    base.hash = '';
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    return new URL(`v1/uploads/${id}`, base).href;
  } catch {
    return null;
  }
}

/** The problem the gateway's answer to an upload means. 201 is the only success; every other status, and a connection that broke, is a problem. */
export function putProblem(status: number, body: Record<string, unknown>): UploadProblem {
  const error = typeof body.error === 'string' ? body.error : '';
  if (status === 400) {
    if (error === 'content_mismatch') return 'content';
    if (error === 'checksum_mismatch' || error === 'length_mismatch') return 'changed';
    if (error === 'invalid_upload') return 'type';
    return 'rejected';
  }
  if (status === 413) return error === 'quota_exceeded' ? 'quota' : 'too_large';
  if (status === 401 || status === 403) return 'reload';
  if (status === 409) return 'conflict';
  if (status === 0 || status === 503 || status >= 500) return status === 0 ? 'network' : 'unavailable';
  return 'rejected';
}

/**
 * Sends the file to the gateway named by the ticket. `onProgress` is told how much has gone (0 to 1). Resolves with a problem, never rejects: a refused
 * upload may be cut before its answer is read, and that is a `network` outcome like any broken connection. An aborted `signal` ends the request.
 */
export function putPicture(
  input: {gateway: string; ticket: string; id: string; file: Blob; sha256: string; contentType: PictureType},
  hooks: {onProgress?: (fraction: number) => void; signal?: AbortSignal} = {},
  deps: UploadDeps = {},
): Promise<PutOutcome> {
  const url = uploadUrl(input.gateway, input.id);
  if (!url) return Promise.resolve({ok: false, problem: 'rejected'});
  return new Promise<PutOutcome>((resolve) => {
    let request: UploadRequest;
    try {
      request = deps.createRequest ? deps.createRequest() : (new XMLHttpRequest() as unknown as UploadRequest);
      request.open('PUT', url);
    } catch {
      resolve({ok: false, problem: 'network'});
      return;
    }
    let settled = false;
    const finish = (outcome: PutOutcome) => {
      if (settled) return;
      settled = true;
      hooks.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = () => {
      try {
        request.abort();
      } catch {
        // Already finished.
      }
      finish({ok: false, problem: 'network'});
    };
    if (hooks.signal?.aborted) return finish({ok: false, problem: 'network'});
    hooks.signal?.addEventListener('abort', onAbort);

    request.timeout = uploadTimeoutMs;
    request.upload.addEventListener('progress', (event) => {
      if (event.total > 0) hooks.onProgress?.(Math.min(1, Math.max(0, event.loaded / event.total)));
    });
    request.addEventListener('load', () => {
      if (request.status === 201) {
        hooks.onProgress?.(1);
        return finish({ok: true});
      }
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(request.responseText);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      } catch {
        // An answer that is not JSON is read by its status alone.
      }
      finish({ok: false, problem: putProblem(request.status, body)});
    });
    for (const type of ['error', 'abort', 'timeout'] as const) request.addEventListener(type, () => finish({ok: false, problem: 'network'}));
    try {
      request.setRequestHeader('authorization', `Ticket ${input.ticket}`);
      request.setRequestHeader('content-type', input.contentType);
      request.setRequestHeader('x-content-sha256', input.sha256);
      request.send(input.file);
    } catch {
      finish({ok: false, problem: 'network'});
    }
  });
}

/**
 * One picture's upload, from a new upload ID to the gateway's answer: the ticket is fetched immediately before the PUT. The upload ID is new for every
 * attempt (`onStart` is told it before anything is sent). `sha256`, `length` and `contentType` are the ones the browser computed from the file; the gateway holds the bytes to them.
 */
export async function uploadPicture(
  file: Blob,
  meta: {sha256: string; contentType: PictureType},
  hooks: {onProgress?: (fraction: number) => void; signal?: AbortSignal; onStart?: (uploadId: string) => void} = {},
  deps: UploadDeps = {},
): Promise<UploadOutcome> {
  const id = (deps.randomUUID ?? (() => crypto.randomUUID()))();
  // The ID is told at once, so a screen that gives the upload up while it is on its way knows which lease to release.
  hooks.onStart?.(id);
  const ticket = await fetchTicket({id, length: file.size, sha256: meta.sha256, contentType: meta.contentType}, deps);
  if (!ticket.ok) return ticket;
  const sent = await putPicture({gateway: ticket.gateway, ticket: ticket.ticket, id, file, sha256: meta.sha256, contentType: meta.contentType}, hooks, deps);
  return sent.ok ? {ok: true, uploadId: id} : sent;
}

/** Runs tasks one at a time, in the order they were given. A task that fails does not stop the ones behind it. */
export function createUploadQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
