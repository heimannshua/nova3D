import {clientAddressFromHeaders} from '@/lib/accounts';
import {isStatusHandle, lookupStatus} from '@/lib/lifecycle';

// Story 1.8. The status route: a device that holds a status handle asks what became of its target, without signing in (the Account,
// or its Auth identity, may be gone). It is public on purpose (lib/public-paths.ts), and so it is built to be asked by anyone:
//
//   * POST only, with a JSON body {"handle": "<32 lower-case hexadecimal characters>"} of at most 256 bytes. The handle is in the
//     body and never in a URL, so it never reaches an access log, a referrer or a browser history; and nothing here is logged.
//   * The proxy has already refused a request from another site (a POST needs this application's own Origin).
//   * Rate limited by network origin and in all, by the database, which counts every request FIRST, answered or not: guessing
//     handles (128 bits) is infeasible and, from one origin, slow.
//   * Answers {"state": "active" | "disabled" | "deleted", "revision": n} for a handle it knows (a deleted one from its tombstone,
//     after the Auth user is gone), {"state": "unknown"} for one it does not (200), 400 for a body that is not exactly that (or that
//     cannot be read to its end), 429 with
//     Retry-After over the budget, and 503 when the database cannot be reached or does not answer in a way that is an answer: never
//     `unknown` for that. Any other method is 405 (Next.js).
//   * Never cached.
export const dynamic = 'force-dynamic';

const maxBodyBytes = 256;
const headers = {'cache-control': 'no-store'};

const invalid = () => Response.json({error: 'invalid_request'}, {status: 400, headers});

/** The body as text, or null if it is longer than the cap (however it says so), not UTF-8, or absent. At most the cap and one chunk is read. */
async function readBody(request: Request): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBodyBytes)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return null;
  }
}

/** The handle in a body that is exactly {"handle": "<32 hex>"}, or null. */
function handleOf(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  const {handle} = parsed as Record<string, unknown>;
  return keys.length === 1 && keys[0] === 'handle' && isStatusHandle(handle) ? handle : null;
}

export async function POST(request: Request) {
  // A body stream that errors or is aborted part way through is a body that is not a request: the same 400, never an unhandled 500.
  const body = await readBody(request).catch(() => null);
  const handle = body === null ? null : handleOf(body);
  if (handle === null) return invalid();
  try {
    const answer = await lookupStatus({handle, clientAddress: clientAddressFromHeaders(request.headers)});
    if (answer.outcome === 'found') return Response.json({state: answer.state, revision: answer.revision}, {headers});
    if (answer.outcome === 'unknown') return Response.json({state: 'unknown'}, {headers});
    return Response.json({error: 'rate_limited'}, {status: 429, headers: {...headers, 'retry-after': String(answer.retryAfter)}});
  } catch {
    // The database did not answer, or answered something that is not an answer, or this server is not configured to ask: "try again",
    // never "unknown". Nothing is logged here: the request holds a handle.
    return Response.json({error: 'unavailable'}, {status: 503, headers: {...headers, 'retry-after': '30'}});
  }
}
