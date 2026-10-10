import type {Metadata} from 'next';
import {NovaDashboard} from '@/components/nova-dashboard';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.projects')};
}

export default async function ProjectsPage() {
  await requireActiveAccount();
  return <NovaDashboard view="projects" />;
}
