import {handleHeartbeatRequest} from '@/lib/heartbeat';

// Story 1.13. The heartbeat route: the Railway cron task (workers/heartbeat) posts a signed heartbeat here every 30 minutes, and the application answers the age of
// the latest scheduler receipt. It is a machine path (lib/public-paths.ts): no session, no browser Origin and no CSRF cookie exist for the worker, so the proxy skips
// its origin check for this one path and keeps every other rule. Everything it does, in the order it does it, is lib/heartbeat.ts.
//
//   * POST only: Next.js itself answers `OPTIONS` (204, `Allow: OPTIONS, POST`) and every other method (its own 405, with no `Allow` and no no-store) before this runs;
//     the route's own 405 in lib/heartbeat.ts answers only a direct call of the handler. Never cached, never static.
//   * `Authorization: Heartbeat <token>`; a body of at most 16 bytes, ignored.
//   * 200 {state: "recorded", receipt_age_seconds}; 401 {error: "invalid_token"} (one body for every token failure); 403 an Origin header was present; 400 a bad body;
//     405; 409 {state: "duplicate"}; 503 not configured, or the database did not answer (never a 200 that skipped the evaluation; a mail that is refused or whose notice cannot be recorded is counted and retried).
//   * Every answer is no-store. Nothing from the request is logged and nothing of it is reflected.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleHeartbeatRequest(request);
}
