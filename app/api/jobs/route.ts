import {handleJobRequest} from '@/lib/jobs';

// Story 1.9. The scheduled-job route: a schedule calls it with a signed body {"task", "instance"} and nothing else authenticates the call.
// It is a machine path (lib/public-paths.ts): no session, no browser Origin and no CSRF cookie exist for the scheduler, so the proxy
// skips its origin check for this one path and keeps every other rule. Everything it does, in the order it does it, is lib/jobs.ts: the
// scheduler's provider and its signature check live there and nowhere under app/.
//
//   * POST only (Next.js answers any other method with 405), never cached, never static.
//   * 200 {outcome: ran | idle | no_store | duplicate}; 400 bad body, unknown task or no schedule ID; 401 no valid signature; 403 another
//     environment; 405; 409 running; 500 the task failed; 503 not configured or the database did not answer. QStash retries every answer
//     outside 200 to 299, a 4xx included (only a 489 with `Upstash-NonRetryable-Error: true` stops it, which this route does not send): a
//     refused call is refused again on each retry, and writes nothing each time. A body over 1 KB is a 400 even when unsigned or wrongly
//     signed (it is read before the signature can be checked); a call with no signature at all is a 401 without its body being read.
//   * A foreign or invalid call runs nothing and writes no receipt. Nothing from the request is logged and nothing of it is reflected.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleJobRequest(request);
}
