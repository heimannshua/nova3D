import type {Metadata} from 'next';
import {InvitationsContent} from '@/components/admin/invitations-content';
import {checkMarker, listInvitations} from '@/lib/accounts';
import {gatingTimeoutMs} from '@/lib/access';
import {getAccess, requireAdministrator} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import type {Confirmation, InvitationRow} from '@/lib/invitations';

// Next evaluates the page's metadata before the page runs its own check, and a page's title wins over the 404 page's. So
// the title asks the same question the page does: for anyone but an active Administrator the page answers 404, and its
// title must be the one a page that does not exist has, not a name for this page. (`getAccess` is memoized for the render:
// this and the page's `requireAdministrator` share one authorization.)
export async function generateMetadata(): Promise<Metadata> {
  const [access, {t}] = await Promise.all([getAccess().catch(() => null), getI18n()]);
  const administrator = access?.state === 'active' && access.account.role === 'administrator';
  return {title: t(administrator ? 'meta.invitations' : 'meta.notFound')};
}

// What went wrong as a name and a message, never a request, a code or a cookie.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

async function readList(): Promise<InvitationRow[] | null> {
  try {
    // Invitation ID, kind, label, state and creation time. The database never returns a code or a hash.
    return await listInvitations({timeoutMs: gatingTimeoutMs});
  } catch (error) {
    console.error('The invitation list could not be read.', describe(error));
    return null;
  }
}

/**
 * Whether the Administrator has a valid `administration` marker right now. This only decides whether "Confirm it is
 * you" is offered before a change is tried: the Server Action checks the marker itself, every time, and is the
 * authority. A check that cannot be made says nothing (`unknown`) and the actions decide.
 */
async function readConfirmation(user: {id: string; sessionId: string}): Promise<Confirmation> {
  try {
    const outcome = await checkMarker({userId: user.id, sessionId: user.sessionId, actionClass: 'administration'}, {timeoutMs: gatingTimeoutMs});
    return outcome === 'allowed' ? 'confirmed' : 'needed';
  } catch (error) {
    console.error('The fresh sign-in could not be checked for the invitation page.', describe(error));
    return 'unknown';
  }
}

// The Administrator's invitation page (AD-01, Story 1.11). Only an active Administrator sees it; any other Account
// gets the 404 page, as for a page that does not exist. The page is a Server Component that reads the list and
// whether the Administrator has just confirmed it is them; the forms are client components that call the three
// Server Actions beside it, and the actions check the role and the marker themselves.
export default async function InvitationsPage() {
  const access = await requireAdministrator();
  const [invitations, confirmation] = await Promise.all([readList(), readConfirmation(access.user)]);
  return <InvitationsContent invitations={invitations} confirmation={confirmation}/>;
}
