import {handleDispatchRequest} from '@/lib/job-dispatch';

// Story 2.7. The dispatch route: the queue calls it with a signed body {"attempt", "instance"} when an accepted Job's outbox row is published, and nothing else authenticates
// the call. It is a machine path (lib/public-paths.ts): no session, no browser Origin and no CSRF cookie exist for the queue, so the proxy skips its origin check for this one
// path and keeps every other rule. Everything it does, in the order it does it, is lib/job-dispatch.ts: the queue's provider and its signature check live there and nowhere
// under app/. It claims the attempt as the built-in step and runs the deterministic test workload.
//
//   * POST only (Next.js answers any other method with 405), never cached, never static.
//   * 200 {outcome: ran | duplicate | not_waiting | waiting_for_worker | blocked | incompatible | revoked | unavailable}; 400 bad body; 401 no valid signature; 403 another
//     environment; 405; 503 not configured or the database did not answer. The queue is told to retry nothing (the message is published with retries 0): a refused call is refused
//     and writes nothing.
//   * A foreign or invalid call claims nothing. Nothing from the request is logged and nothing of it is reflected.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleDispatchRequest(request);
}
