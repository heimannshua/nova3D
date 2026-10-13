import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {NovaDashboard} from '@/components/nova-dashboard';
import {homePath} from '@/lib/access';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {loadProjectList} from '@/lib/project-pages';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.projects')};
}

// My Projects (H-02): the Account's Projects, newest update first, with search by title and a filter by stage. A list that cannot be
// read is an error with a way to try again, never an empty list.
export default async function ProjectsPage() {
  const access = await requireActiveAccount();
  const listing = await loadProjectList(access);
  if (listing.state === 'denied') return redirect(homePath);
  return <NovaDashboard view="projects" listing={listing}/>;
}
