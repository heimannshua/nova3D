import type {Metadata} from 'next';
import {notFound, redirect} from 'next/navigation';
import {PictureIntake} from '@/components/projects/picture-intake';
import {PicturesLocked} from '@/components/projects/pictures-locked';
import {Unreadable} from '@/components/projects/unreadable';
import {homePath} from '@/lib/access';
import {getAccess, requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {loadProject, loadProjectRequest} from '@/lib/project-pages';

// As the overview's title: the same read, and a Project that is not available has the title of the page that says so.
export async function generateMetadata({params}: {params: Promise<{projectId: string}>}): Promise<Metadata> {
  const [access, {t}, {projectId}] = await Promise.all([getAccess().catch(() => null), getI18n(), params]);
  if (access?.state !== 'active') return {title: t('meta.projectUnavailable')};
  const loaded = await loadProject(access.account.accountId, access.account.epoch, projectId);
  if (loaded.state === 'found' || loaded.state === 'unreadable') return {title: t('meta.pictures')};
  return {title: t('meta.projectUnavailable')};
}

// The pictures of a Project whose latest request is an unconfirmed set of pictures (Story 2.2: C-03), to change: add, replace, reorder, remove, and save a
// successor. It checks the Project exactly as the overview does, so a link to the pictures of a Project that is not available is the same unavailable page.
// A Project whose request is anything else (a confirmed request, a text request, no request) is told that its pictures cannot be changed here.
export default async function ProjectPicturesPage({params}: {params: Promise<{projectId: string}>}) {
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
  const request = await loadProjectRequest(access.account.accountId, access.account.epoch, projectId);
  if (request.state === 'denied') return redirect(homePath);
  if (request.state === 'unavailable') return notFound();
  if (request.state === 'unreadable') {
    return (
      <div className="page page-narrow">
        <Unreadable title="project.error.title" body="project.error.body" headingLevel={1}/>
      </div>
    );
  }
  if (request.state !== 'found' || request.request.mode !== 'evidence_images' || request.request.confirmed) return <PicturesLocked project={loaded.project}/>;
  return <PictureIntake projectId={loaded.project.id} title={loaded.project.title} revision={request.request.seq} saved={request.request.images}/>;
}
