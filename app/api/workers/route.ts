import {handleWorkerRequest} from '@/lib/worker-commands';

// Story 2.7. The worker route: a worker (or the test worker that stands in for one) posts ONE signed command here, with an `Authorization: Bearer <token>` header, to register
// itself, claim an attempt, renew its lease, begin a step, report an operation's outcome and finish the attempt. It is a machine path (lib/public-paths.ts): no session, no
// browser Origin and no CSRF cookie exist for a worker, so the proxy skips its origin check for this one path and keeps every other rule. Everything it does, in the order it
// does it, is lib/worker-commands.ts.
//
//   * POST only (Next.js answers any other method with 405), never cached, never static.
//   * 200 {state: ...} the command ran; 409 {state: <outcome>} the database refused it (a wrong fence, an ended or expired lease, a revoked epoch, a Project that is gone, ...);
//     400 the body is not the command's; 401 {error: "invalid_token"} ONE answer for every verification failure, and nothing is written; 403 an Origin header was present;
//     405; 503 not configured, or the database did not answer.
//   * Nothing from the request is logged and nothing of it is reflected.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleWorkerRequest(request);
}
