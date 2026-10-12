import type {Metadata} from 'next';
import {AdminContent} from '@/components/admin/admin-content';
import {readConfirmation} from '@/lib/administered';
import {getAccess, requireAdministrator} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {recoveredCountOf} from '@/lib/recovery-state';

// The same rule as the pages beneath it: the title of a page that does not exist for anyone but an active Administrator.
export async function generateMetadata(): Promise<Metadata> {
  const [access, {t}] = await Promise.all([getAccess().catch(() => null), getI18n()]);
  const administrator = access?.state === 'active' && access.account.role === 'administrator';
  return {title: t(administrator ? 'meta.admin' : 'meta.notFound')};
}

// The Administration index (Story 1.5): the way to the Administrator's pages, Invitation codes and Accounts. It is also where
// the `administration` step-up returns (lib/step-up.ts), because the return path comes from the class alone and one class
// serves both pages; so it says whether the person has just confirmed it is them. It is also where a recovery of the sole
// Administrator ends (Story 1.6), because the recovered session holds the same fresh `administration` marker: a recovery
// arrives with `?recovered=<number of other sessions that were signed out>`, which is for the words only and grants nothing.
// Only an active Administrator sees it; any other Account gets the 404 page.
export default async function AdminPage({searchParams}: {searchParams: Promise<{recovered?: string | string[]}>}) {
  const access = await requireAdministrator();
  const [confirmation, params] = await Promise.all([readConfirmation(access.user), searchParams]);
  return <AdminContent confirmation={confirmation} recovered={recoveredCountOf(params.recovered)}/>;
}
