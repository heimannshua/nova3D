import type {Metadata} from 'next';
import {AdminContent} from '@/components/admin/admin-content';
import {readConfirmation} from '@/lib/administered';
import {getAccess, requireAdministrator} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

// The same rule as the pages beneath it: the title of a page that does not exist for anyone but an active Administrator.
export async function generateMetadata(): Promise<Metadata> {
  const [access, {t}] = await Promise.all([getAccess().catch(() => null), getI18n()]);
  const administrator = access?.state === 'active' && access.account.role === 'administrator';
  return {title: t(administrator ? 'meta.admin' : 'meta.notFound')};
}

// The Administration index (Story 1.5): the way to the Administrator's pages, Invitation codes and Accounts. It is also where
// the `administration` step-up returns (lib/step-up.ts), because the return path comes from the class alone and one class
// serves both pages; so it says whether the person has just confirmed it is them. Only an active Administrator sees it; any
// other Account gets the 404 page.
export default async function AdminPage() {
  const access = await requireAdministrator();
  const confirmation = await readConfirmation(access.user);
  return <AdminContent confirmation={confirmation}/>;
}
