import type {Metadata} from 'next';
import {OperationsContent} from '@/components/admin/operations-content';
import {gatingTimeoutMs} from '@/lib/access';
import {getAccess, requireAdministrator} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {listAlarms, type AlarmRecord} from '@/lib/lifecycle';

// Next evaluates the page's metadata before the page runs its own check, and a page's title wins over the 404 page's. So
// the title asks the same question the page does: for anyone but an active Administrator the page answers 404, and its
// title must be the one a page that does not exist has, not a name for this page. (`getAccess` is memoized for the render:
// this and the page's `requireAdministrator` share one authorization.)
export async function generateMetadata(): Promise<Metadata> {
  const [access, {t}] = await Promise.all([getAccess().catch(() => null), getI18n()]);
  const administrator = access?.state === 'active' && access.account.role === 'administrator';
  return {title: t(administrator ? 'meta.operations' : 'meta.notFound')};
}

// What went wrong as a name and a message, never a request, an address or a cookie.
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

async function readAlarms(): Promise<AlarmRecord[] | null> {
  try {
    // The open alarms, newest first, and the ten most recently resolved: a condition, a subject, times, a small detail and the state of
    // the email. The database never returns a project, a file, an address or a code.
    return await listAlarms({includeResolved: true, limit: 10}, {timeoutMs: gatingTimeoutMs});
  } catch (error) {
    console.error('The alarms could not be read.', describe(error));
    return null;
  }
}

// The Administrator's Operations page (Story 1.13). Only an active Administrator sees it; any other Account gets the 404
// page, as for a page that does not exist. It only reads: there is nothing to acknowledge, snooze or delete, so it has no
// Server Action and needs no fresh sign-in.
export default async function OperationsPage() {
  await requireAdministrator();
  return <OperationsContent alarms={await readAlarms()}/>;
}
