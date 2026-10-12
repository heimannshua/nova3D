import type {Metadata} from 'next';
import {AccountsContent} from '@/components/admin/accounts-content';
import {gatingTimeoutMs} from '@/lib/access';
import type {AccountRow} from '@/lib/account-admin';
import {listAccounts} from '@/lib/accounts';
import {readConfirmation} from '@/lib/administered';
import {getAccess, requireAdministrator} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

// Next evaluates the page's metadata before the page runs its own check, and a page's title wins over the 404 page's. So
// the title asks the same question the page does: for anyone but an active Administrator the page answers 404, and its
// title must be the one a page that does not exist has, not a name for this page. (`getAccess` is memoized for the render:
// this and the page's `requireAdministrator` share one authorization.)
export async function generateMetadata(): Promise<Metadata> {
  const [access, {t}] = await Promise.all([getAccess().catch(() => null), getI18n()]);
  const administrator = access?.state === 'active' && access.account.role === 'administrator';
  return {title: t(administrator ? 'meta.accounts' : 'meta.notFound')};
}

// What went wrong as a name and a message, never a request, an address or a cookie.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

async function readList(): Promise<AccountRow[] | null> {
  try {
    // Account ID, verified Google address, the invitation that made it, role, status and creation time. The database never
    // returns Workspace content, a project name or usage.
    return await listAccounts({timeoutMs: gatingTimeoutMs});
  } catch (error) {
    console.error('The Account list could not be read.', describe(error));
    return null;
  }
}

// The Administrator's Accounts page (AD-02, Story 1.5). Only an active Administrator sees it; any other Account gets the 404
// page, as for a page that does not exist. The page is a Server Component that reads the list and whether the Administrator
// has just confirmed it is them; the controls are client components that call the two Server Actions beside it, and the
// actions check the role and the marker themselves.
export default async function AccountsPage() {
  const access = await requireAdministrator();
  const [accounts, confirmation] = await Promise.all([readList(), readConfirmation(access.user)]);
  return <AccountsContent accounts={accounts} confirmation={confirmation}/>;
}
