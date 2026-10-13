import type {Metadata} from 'next';
import {notFound, redirect} from 'next/navigation';
import {Unreadable} from '@/components/projects/unreadable';
import {SourcesPlaceholder} from '@/components/projects/sources-placeholder';
import {homePath} from '@/lib/access';
import {getAccess, requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {loadProject} from '@/lib/project-pages';

// As the overview's title: the same read, and a Project that is not available has the title of the page that says so.
export async function generateMetadata({params}: {params: Promise<{projectId: string}>}): Promise<Metadata> {
  const [access, {t}, {projectId}] = await Promise.all([getAccess().catch(() => null), getI18n(), params]);
  if (access?.state !== 'active') return {title: t('meta.projectUnavailable')};
  const loaded = await loadProject(access.account.accountId, access.account.epoch, projectId);
  if (loaded.state === 'found' || loaded.state === 'unreadable') return {title: t('meta.sources')};
  return {title: t('meta.projectUnavailable')};
}

// A Project's Sources page: an honest placeholder until Sources exist. It checks the Project exactly as the overview does, so a link
// to the Sources of a Project that is not available is the same unavailable page.
export default async function SourcesPage({params}: {params: Promise<{projectId: string}>}) {
  const access = await requireActiveAccount();
  const {projectId} = await params;
  const loaded = await loadProject(access.account.accountId, access.account.epoch, projectId);
  if (loaded.state === 'denied') return redirect(homePath);
  if (loaded.state === 'unavailable') return notFound();
  if (loaded.state === 'unreadable') {
    return (
      <div className="page page-narrow">
        <Unreadable title="project.error.title" body="project.error.body" headingLevel={1}/>
      </div>
    );
  }
  return <SourcesPlaceholder project={loaded.project}/>;
}
