// Story 2.3. Getting a saved picture's pixels back into the browser, for the quality review (C-04) after a reload, when the `File`s of the picture screen are
// no longer here. This is the FIRST and only place the application reads a staged picture back, and it does it in the browser, one picture at a time:
//
//   1. a single-use DOWNLOAD ticket from the application (`POST /api/transfers/tickets` with {direction:'download', kind:'staging', id} by `csrfFetch`):
//      the same private route as an upload ticket, bound to the Account, the session grant and the epoch, valid for five minutes and for one use;
//   2. `GET <gateway origin>/v1/files/staging/<id>` with `Authorization: Ticket …` at the gateway the ticket named (and nowhere else), whole body, no range;
//   3. the body is read through a reader that stops at the saved length (more than that is `changed`), and its SHA-256 must equal the SHA-256 the saved revision
//      records. A picture whose bytes differ is `changed` and is NOT used.
//
// Story 2.12: a picture the revision PINS is read from its retained copy and never from staging (its staged copy is expiring or gone): the same three steps with
// the kind `retained` (the ticket's target is the picture's upload ID, equal to its manifest ID) and the SHA-256 and length of the RETAINED copy, which the revision
// records beside the staged ones. A retained root or object key is in no request here: the gateway resolves the upload ID to its object itself.
//
// The bytes live in memory only: never in a URL that is shown or stored, in storage, or in a log. There is no download link, no `<a download>`, no reusable
// URL: the ticket is in a header, spent by the one request, and gone. The caller decodes the picture and lets go of it before it asks for the next.
//
// Each of the two requests has 30 seconds (the ticket, and the download with its body); a request that is not finished by then is the retryable `network`.
//
// The Files of the screen the pictures were chosen on are handed over in memory too (`holdFiles`, `heldFile`): the review right after saving uses them and asks
// the gateway for nothing. They are kept for the last Save only, at most 12, for at most 15 minutes, and let go when the review is left or the Save fails.
//
// BROWSER-SAFE; every dependency is injectable so the tests run it in Node. It touches `fetch` and `crypto` only inside a function and reads no environment:
// the gateway is the one the ticket names.
import {csrfFetch} from './csrf-client.ts';
import {maxPictureBytes, maxPictures} from './picture-set.ts';
import {sha256Hex, type UploadDeps} from './picture-upload.ts';

/** How long each request (the ticket; the download with its body) may take before it is given up as `network`. */
export const fetchTimeoutMs = 30_000;
/** How long the Files handed over by the picture screen are held if the review is never opened. */
export const heldForMs = 15 * 60_000;

/**
 * Why a saved picture could not be read back:
 *  - `lapsed`: its private copy has expired or was released (the gateway no longer has it for this Account);
 *  - `changed`: the bytes that came back are not the bytes that were saved (their SHA-256 or length differs): they are not used;
 *  - `reload`: the session or the page's token is no longer good: reload the page;
 *  - `refused`: the ticket or the download was refused for a reason the person cannot fix;
 *  - `unavailable`: the application did not answer: try again;
 *  - `network`: the connection broke, the gateway was busy or failed, or a request took more than 30 seconds: try again.
 */
export const fetchProblems = ['lapsed', 'changed', 'reload', 'refused', 'unavailable', 'network'] as const;
export type FetchProblem = (typeof fetchProblems)[number];

/** Whether trying again can help (a new ticket is made for every attempt). It cannot for a copy that has lapsed or changed, nor for a refusal. */
export function fetchRetryable(problem: FetchProblem): boolean {
  return problem === 'unavailable' || problem === 'network';
}

export type FetchDeps = UploadDeps & {
  /** The `fetch` of the download itself (cross-origin, to the gateway). */
  gatewayFetch?: (input: string, init: RequestInit) => Promise<Response>;
  /** How long each request may take, in milliseconds (30 seconds by default). */
  timeoutMs?: number;
};

export type FetchedPicture = {ok: true; blob: Blob} | {ok: false; problem: FetchProblem};

/** What the download ticket route answers: the ticket and the gateway's address, or why not. */
export type DownloadTicket = {ok: true; ticket: string; gateway: string} | {ok: false; problem: FetchProblem};

/** The two kinds of target a picture is read from: its staged copy (`staging`) or, once the revision pins it, its retained copy (`retained`). */
export type PictureSource = 'staging' | 'retained';

// A request with a time limit ---------------------------------------------------------------------------------------------

const expired = Symbol('expired');

/**
 * A time limit for one request: a signal that ends when `parent` does or when `ms` have passed, and a race that answers `expired` if the work is not done by then
 * (a request that ignores its signal is still given up). `stop` clears the timer.
 */
function limit(ms: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const onParent = () => controller.abort();
  if (parent?.aborted) controller.abort();
  parent?.addEventListener('abort', onParent);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof expired>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(expired);
    }, ms);
  });
  return {
    signal: controller.signal,
    race: <T>(work: Promise<T>): Promise<T | typeof expired> => Promise.race([work, late]),
    stop: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParent);
    },
  };
}

function problemOfTicketStatus(status: number): FetchProblem {
  if (status === 401 || status === 403) return 'reload';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'unavailable';
  return 'refused';
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Asks the application for a single-use ticket to download ONE picture: exactly {direction:'download', kind, id}, through `csrfFetch`, for its staged upload
 * (`staging`, the default) or its retained copy (`retained`). 401 and 403 mean the session or the page's token is no longer good; a status the application cannot
 * serve now (408, 425, 429, 5xx) and a request that takes more than 30 seconds are worth trying again.
 */
export async function fetchDownloadTicket(id: string, deps: FetchDeps = {}, signal?: AbortSignal, kind: PictureSource = 'staging'): Promise<DownloadTicket> {
  const send = deps.ticketFetch ?? ((url: string, init: RequestInit) => csrfFetch(url, init));
  const clock = limit(deps.timeoutMs ?? fetchTimeoutMs, signal);
  try {
    const answered = await clock.race(
      (async (): Promise<DownloadTicket> => {
        let response: Response;
        try {
          response = await send('/api/transfers/tickets', {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({direction: 'download', kind, id}),
            cache: 'no-store',
            signal: clock.signal,
          });
        } catch {
          return {ok: false, problem: 'network'};
        }
        if (response.status !== 200) return {ok: false, problem: problemOfTicketStatus(response.status)};
        const body = await jsonOf(response);
        if (typeof body.ticket !== 'string' || typeof body.gateway !== 'string' || !body.ticket || !body.gateway) return {ok: false, problem: 'refused'};
        return {ok: true, ticket: body.ticket, gateway: body.gateway};
      })(),
    );
    return answered === expired ? {ok: false, problem: 'network'} : answered;
  } finally {
    clock.stop();
  }
}

/**
 * The address of a picture at the gateway the ticket named: its origin and `/v1/files/<kind>/<id>` (staging unless the kind is `retained`), nothing else of the ticket's
 * address. Null when the gateway is no web address (or holds a name and a password).
 */
export function downloadUrl(gateway: string, id: string, kind: PictureSource = 'staging'): string | null {
  try {
    const base = new URL(gateway);
    if ((base.protocol !== 'http:' && base.protocol !== 'https:') || base.username || base.password) return null;
    return `${base.origin}/v1/files/${kind}/${id}`;
  } catch {
    return null;
  }
}

/**
 * The problem a status the gateway answered to a download means. 404 and 410: the private copy is gone. 401 and 403: the session needs refreshing. A request the
 * gateway cannot serve now (408, 425, 429, 5xx) is worth trying again. Anything else is a refusal.
 */
export function getProblem(status: number): FetchProblem {
  if (status === 404 || status === 410) return 'lapsed';
  if (status === 401 || status === 403) return 'reload';
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'network';
  return 'refused';
}

/** Reads a body whole, but stops (and says so) as soon as more than `length` bytes have arrived. Null when the body ends short, long, or breaks. */
async function readCapped(response: Response, length: number): Promise<{blob: Blob} | {problem: 'changed' | 'network'}> {
  const declared = response.headers.get('content-length');
  // A length the gateway announces that is not the saved one is not this picture: nothing is read.
  if (declared !== null && Number(declared) !== length) {
    try {
      await response.body?.cancel();
    } catch {
      // Nothing to release.
    }
    return {problem: 'changed'};
  }
  const reader = response.body?.getReader();
  if (!reader) return {problem: 'changed'};
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > length) {
        await reader.cancel().catch(() => undefined);
        return {problem: 'changed'};
      }
      chunks.push(value);
    }
  } catch {
    return {problem: 'network'};
  }
  return total === length ? {blob: new Blob(chunks as BlobPart[])} : {problem: 'changed'};
}

/**
 * Reads ONE picture back from the gateway, from the target of `source`, and checks it is the one that was recorded: a download ticket, the whole body read through a
 * reader capped at the recorded length, and its SHA-256 compared with the recorded one. Resolves with a problem and never rejects. The picture is a `Blob` in memory only.
 */
async function fetchPicture(
  source: PictureSource,
  picture: {uploadId: string; sha256: string; length: number},
  hooks: {signal?: AbortSignal},
  deps: FetchDeps,
): Promise<FetchedPicture> {
  if (hooks.signal?.aborted) return {ok: false, problem: 'network'};
  const ticket = await fetchDownloadTicket(picture.uploadId, deps, hooks.signal, source);
  if (!ticket.ok) return ticket;
  const url = downloadUrl(ticket.gateway, picture.uploadId, source);
  if (!url) return {ok: false, problem: 'refused'};
  const get = deps.gatewayFetch ?? ((address: string, init: RequestInit) => fetch(address, init));
  const clock = limit(deps.timeoutMs ?? fetchTimeoutMs, hooks.signal);
  try {
    const answered = await clock.race(
      (async (): Promise<FetchedPicture> => {
        let response: Response;
        try {
          // The ticket is in a header, never in the address, and nothing else is sent: no cookie, no referrer.
          response = await get(url, {
            method: 'GET',
            headers: {authorization: `Ticket ${ticket.ticket}`},
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            signal: clock.signal,
          });
        } catch {
          return {ok: false, problem: 'network'};
        }
        if (response.status !== 200) {
          try {
            await response.body?.cancel();
          } catch {
            // Nothing to release.
          }
          return {ok: false, problem: getProblem(response.status)};
        }
        const read = await readCapped(response, picture.length);
        if ('problem' in read) return {ok: false, problem: read.problem};
        if (read.blob.size > maxPictureBytes) return {ok: false, problem: 'changed'};
        let sha256: string;
        try {
          sha256 = await sha256Hex(read.blob, deps);
        } catch {
          return {ok: false, problem: 'refused'};
        }
        return sha256 === picture.sha256 ? {ok: true, blob: read.blob} : {ok: false, problem: 'changed'};
      })(),
    );
    return answered === expired ? {ok: false, problem: 'network'} : answered;
  } finally {
    clock.stop();
  }
}

/** Reads ONE saved picture back from private staging and checks it is the one that was saved (its staged SHA-256 and length). Resolves with a problem and never rejects. */
export function fetchStagedPicture(picture: {uploadId: string; sha256: string; length: number}, hooks: {signal?: AbortSignal} = {}, deps: FetchDeps = {}): Promise<FetchedPicture> {
  return fetchPicture('staging', picture, hooks, deps);
}

/**
 * Reads ONE retained picture back (Story 2.12): from the target of kind `retained` (its upload ID, resolved to its object by the gateway), checked against the SHA-256
 * and length of the RETAINED copy. Resolves with a problem and never rejects. Never reads staging.
 */
export function fetchRetainedPicture(picture: {uploadId: string; sha256: string; length: number}, hooks: {signal?: AbortSignal} = {}, deps: FetchDeps = {}): Promise<FetchedPicture> {
  return fetchPicture('retained', picture, hooks, deps);
}

// The Files of the picture screen ------------------------------------------------------------------------------------------

const held = new Map<string, File>();
let heldTimer: ReturnType<typeof setTimeout> | undefined;

/** Lets go of every File held, and of the timer that would have. */
export function releaseFiles(): void {
  held.clear();
  clearTimeout(heldTimer);
  heldTimer = undefined;
}

/**
 * Keeps the Files of the pictures that were just saved, by upload ID, in this page's memory only, so the review that follows can measure them without asking
 * the gateway. It replaces whatever was held (the last Save only), keeps at most 12, and lets them go by itself after 15 minutes if the review is never opened.
 */
export function holdFiles(files: readonly {uploadId: string; file: File}[]): void {
  releaseFiles();
  for (const entry of files.slice(0, maxPictures)) held.set(entry.uploadId, entry.file);
  if (held.size === 0) return;
  heldTimer = setTimeout(releaseFiles, heldForMs);
  (heldTimer as {unref?: () => void}).unref?.();
}

/** The answers to a Save that go on to the review (the action sends the person to the Project): the pictures were saved, or this very Save was saved before. */
const savedOutcomes = new Set(['created', 'revised', 'replayed', 'unchanged']);

/**
 * Lets go of the held Files unless the answer to a Save says the pictures were saved. A Save that succeeds leaves the screen (it goes to the Project) and its
 * Files are kept for the review; an answer that comes back to the picture screen (a problem with the set, a Project that cannot be changed, a request that did not
 * answer) is not a save, so what was held for it is let go of at once.
 */
export function releaseUnlessSaved(outcome: string): void {
  if (!savedOutcomes.has(outcome)) releaseFiles();
}

/** The File held for an upload, if the picture screen handed it over. */
export function heldFile(uploadId: string): File | null {
  return held.get(uploadId) ?? null;
}

// One picture, from wherever it is -----------------------------------------------------------------------------------------

/** Where a picture's bytes came from: `held` (the File of the picture screen, checked against the saved SHA-256), `gateway` (read back from staging by a ticket and checked) or `retained` (read back from its retained copy and checked). */
export type LoadedPicture = {ok: true; blob: Blob; from: 'held' | 'gateway' | 'retained'} | {ok: false; problem: FetchProblem};

/**
 * The bytes of ONE saved picture. A picture the revision PINS (`retained`: the SHA-256 and length of its retained copy, Story 2.12) is read from its retained copy and
 * checked against those, and never from staging or from a File this page holds: its staged copy is expiring or gone. Any other picture: the File the picture screen
 * handed over when there is one AND its SHA-256 is the saved one (a File that has changed since it was uploaded is not what was saved, and is not measured), and
 * otherwise the picture read back from private staging by a single-use ticket.
 */
export async function loadPicture(
  picture: {uploadId: string; sha256: string; length: number; retained?: {sha256: string; length: number} | null},
  hooks: {signal?: AbortSignal} = {},
  deps: FetchDeps = {},
): Promise<LoadedPicture> {
  if (picture.retained) {
    const kept = await fetchRetainedPicture({uploadId: picture.uploadId, sha256: picture.retained.sha256, length: picture.retained.length}, hooks, deps);
    return kept.ok ? {ok: true, blob: kept.blob, from: 'retained'} : kept;
  }
  const file = heldFile(picture.uploadId);
  if (file) {
    try {
      if ((await sha256Hex(file, deps)) === picture.sha256) return {ok: true, blob: file, from: 'held'};
    } catch {
      // This page cannot hash it: the gateway's copy is read back instead (and cannot be checked either, which it says).
    }
  }
  const fetched = await fetchStagedPicture(picture, hooks, deps);
  return fetched.ok ? {ok: true, blob: fetched.blob, from: 'gateway'} : fetched;
}
