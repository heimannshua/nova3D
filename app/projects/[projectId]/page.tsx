import type {Metadata} from 'next';
import {notFound, redirect} from 'next/navigation';
import {Unreadable} from '@/components/projects/unreadable';
import {ProjectOverview} from '@/components/projects/project-overview';
import type {RequestSectionData} from '@/components/projects/request-section';
import {homePath} from '@/lib/access';
import {getAccess, requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {loadProject, loadProjectRequest, loadRetainedPictures} from '@/lib/project-pages';
import type {KeptPicture} from '@/lib/project-view';

// Next evaluates the page's metadata before the page runs its own check, and a page's title wins over the 404 page's. So the title
// asks the same question the page does, of the same read (`loadProject` is memoized for the render: this and the page share one
// answer): a Project that is not available has the title of the page that says so, whatever the reason, and never a name.
export async function generateMetadata({params}: {params: Promise<{projectId: string}>}): Promise<Metadata> {
  const [access, {t}, {projectId}] = await Promise.all([getAccess().catch(() => null), getI18n(), params]);
  if (access?.state !== 'active') return {title: t('meta.projectUnavailable')};
  const loaded = await loadProject(access.account.accountId, access.account.epoch, projectId);
  if (loaded.state === 'found') return {title: loaded.project.title};
  return {title: loaded.state === 'unreadable' ? t('meta.project') : t('meta.projectUnavailable')};
}

// A Project's overview (H-03): its stage, its Version, the next thing to do, and its Model and Sources entries, with Rename. A Project
// that is another Account's, deleted, unknown or not an ID at all is ONE answer: the page that says it is not available, with a 404
// status, which `notFound()` renders from not-found.tsx beside this file. A database that cannot answer is not that answer.
export default async function ProjectPage({params}: {params: Promise<{projectId: string}>}) {
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
  // The request the Project was confirmed from, read the way the Project was: no authority sends the person Home, and a Project that has
  // since become unavailable is the one unavailable page. Only a read that failed (or answered nonsense) leaves the Project open with its
  // Request section saying it could not be loaded; a Project without a request has no section.
  const request = await loadProjectRequest(access.account.accountId, access.account.epoch, projectId);
  if (request.state === 'denied') return redirect(homePath);
  if (request.state === 'unavailable') return notFound();
  // A request made of pictures (Story 2.12) also asks which of them are kept as retained pictures, to say so instead of when their staged copy lapses. A read that
  // cannot be made leaves the pictures shown as the request itself records them (not an error: the request is still there).
  let kept: KeptPicture[] | undefined;
  if (request.state === 'found' && request.request.images.length > 0) {
    const retained = await loadRetainedPictures(access.account.accountId, access.account.epoch, projectId);
    if (retained.state === 'denied') return redirect(homePath);
    if (retained.state === 'unavailable') return notFound();
    kept = retained.state === 'found' ? retained.pictures : [];
  }
  const data: RequestSectionData =
    request.state === 'found'
      ? {state: 'found', request: request.request, subjectName: request.subjectName, ...(kept ? {kept} : {})}
      : request.state === 'none'
        ? {state: 'none'}
        : {state: 'unreadable'};
  return <ProjectOverview project={loaded.project} request={data}/>;
}
