import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {NovaDashboard} from '@/components/nova-dashboard';
import {homePath} from '@/lib/access';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {loadJobList} from '@/lib/job-pages';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.progress')};
}

// In Progress (J-01): the Account's Jobs, the ones that are running or waiting first, read from the database for the verified Account and epoch. A list that cannot be read is
// said so ("try again"); it is never shown as an empty one. An Account without authority for the read is sent Home, where the gate decides.
export default async function ProgressPage() {
  const access = await requireActiveAccount();
  const listing = await loadJobList(access);
  if (listing.state === 'denied') return redirect(homePath);
  return <NovaDashboard view="progress" jobs={listing.state === 'listed' ? {state: 'listed', jobs: listing.jobs} : {state: 'unreadable'}}/>;
}
