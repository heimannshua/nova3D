import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {UsageContent} from '@/components/admin/usage-content';
import {gatingTimeoutMs} from '@/lib/access';
import {readConfirmation} from '@/lib/administered';
import {getAccess, requireAdministrator} from '@/lib/auth';
import {operationOf} from '@/lib/authority';
import {getI18n} from '@/lib/i18n/server';
import {listUsage, type UsageList} from '@/lib/usage';

// Next evaluates the page's metadata before the page runs its own check, and a page's title wins over the 404 page's. So the title asks the same
// question the page does: for anyone but an active Administrator the page answers 404, and its title must be the one a page that does not exist has,
// not a name for this page. (`getAccess` is memoized for the render: this and the page's `requireAdministrator` share one authorization.)
export async function generateMetadata(): Promise<Metadata> {
  const [access, {t}] = await Promise.all([getAccess().catch(() => null), getI18n()]);
  const administrator = access?.state === 'active' && access.account.role === 'administrator';
  return {title: t(administrator ? 'meta.usage' : 'meta.notFound')};
}

// What went wrong as a name and a message, never a request, an address or a cookie.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/** The Accounts' current periods, or null when they could not be read: the page says so, and invents no number. */
async function readUsage(access: Awaited<ReturnType<typeof requireAdministrator>>): Promise<UsageList | null> {
  try {
    return await listUsage(operationOf(access.account), {timeoutMs: gatingTimeoutMs});
  } catch (error) {
    console.error('The usage of the Accounts could not be read.', describe(error));
    return null;
  }
}

// The Administrator's Usage and limits page (AD-03, Story 2.4). Only an active Administrator sees it; any other Account gets the 404 page, as for a
// page that does not exist. The page is a Server Component that reads each Account's current period and whether the Administrator has just
// confirmed it is them; the controls are client components that call the two Server Actions beside it, and the actions check the role and the
// marker themselves. The step-up returns to /admin, as for the other Administration pages.
export default async function UsagePage() {
  const access = await requireAdministrator();
  const [list, confirmation] = await Promise.all([readUsage(access), readConfirmation(access.user)]);
  // The database no longer takes this person for an active Administrator (the authority changed since the gate): the page does not exist for them.
  if (list?.outcome === 'denied') return notFound();
  return <UsageContent rows={list ? list.rows : null} confirmation={confirmation}/>;
}
