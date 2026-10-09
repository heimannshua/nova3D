import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {NovaDashboard} from '@/components/nova-dashboard';
import {getAccess} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.projects')};
}

export default async function ProjectsPage() {
  const access = await getAccess();
  if (access.kind === 'none') redirect('/login');
  return <NovaDashboard view="projects" />;
}
