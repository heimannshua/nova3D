import {requireApiAccess, requireMutationAccess} from '@/lib/auth';
import {isSyntheticDataEnabled} from '@/lib/public-paths';

// Synthetic only (Story 1.4c). The tests need a real route mutation, not a Server Action, with state they can
// observe: a counter per Account that a GET reports and a POST bumps. It has no other behavior. Like /kit it
// answers 404 unless synthetic data is on, and production cannot turn that on (check-env). The counter lives
// in this server's memory, which is all a test needs and means nothing here is ever stored.
//
// The synthetic check comes FIRST, before any access, token or database call, so a deployment that has no such
// route (production) spends nothing on one and tells a caller nothing but that it is not there. It is the one
// line allowed ahead of the guard (tests/unit/gate-structure.test.ts reads it, and only here).
export const dynamic = 'force-dynamic';

const counters = new Map<string, number>();
const headers = {'cache-control': 'no-store'};
const notFound = () => Response.json({error: 'not_found'}, {status: 404, headers});

export async function GET() {
  if (!isSyntheticDataEnabled(process.env)) return notFound();
  const guard = await requireApiAccess();
  if (guard.denied) return guard.denied;
  return Response.json({count: counters.get(guard.access.account.accountId) ?? 0}, {headers});
}

export async function POST(request: Request) {
  if (!isSyntheticDataEnabled(process.env)) return notFound();
  const guard = await requireMutationAccess(request);
  if (guard.denied) return guard.denied;
  const count = (counters.get(guard.access.account.accountId) ?? 0) + 1;
  counters.set(guard.access.account.accountId, count);
  return Response.json({count}, {headers});
}
