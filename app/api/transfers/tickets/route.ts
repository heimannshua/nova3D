import {requireMutationAccess} from '@/lib/auth';
import {issueTransferTicket} from '@/lib/transfer-tickets';

// Story 1.12. The one route that gives a browser the right to move a private file: it answers `{ticket, gateway}`, a signed, single-use,
// five-minute ticket for ONE transfer at the file gateway (workers/files), bound to this Account, this session grant and this epoch. The file itself
// never passes through here (a Vercel function caps a body at 4.5 MB): the browser takes the ticket to the gateway, which checks the Account again,
// live, before every chunk. Private like every route under /api that changes something: the guard is the first statement, and it checks the origin,
// the signed-in Account and the CSRF token before the body is read. Without the application's signing keys or the gateway's address it answers 503.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guard = await requireMutationAccess(request);
  if (guard.denied) return guard.denied;
  return issueTransferTicket(request, guard.access, process.env);
}
