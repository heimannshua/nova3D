import type {Metadata} from 'next';
import {NovaDashboard} from '@/components/nova-dashboard';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.progress')};
}

// In Progress (H-05): there are no Jobs yet, and the page says so.
export default async function ProgressPage() {
  await requireActiveAccount();
  return <NovaDashboard view="progress"/>;
}
