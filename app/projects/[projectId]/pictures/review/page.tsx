import type {Metadata} from 'next';
import {notFound, redirect} from 'next/navigation';
import {PictureReview} from '@/components/projects/picture-review';
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
  if (loaded.state === 'found' || loaded.state === 'unreadable') return {title: t('meta.pictureReview')};
  return {title: t('meta.projectUnavailable')};
}

// The review of a Project's pictures (Story 2.3: C-04, C-05 and the picture variant of C-06): their quality and coverage, how they are used, and the confirmation. It
// checks the Project exactly as the overview does, so a link to the review of a Project that is not available is the same unavailable page. A Project whose request
// is not made of pictures (a text request, or none) is told that it has no pictures to review. Nothing is measured on the server: the page hands the screen the
// saved request (its pictures, their SHA-256 and their labels, if they were reviewed before), and the browser measures them.
export default async function ProjectPictureReviewPage({params}: {params: Promise<{projectId: string}>}) {
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
  const loadedRequest = await loadProjectRequest(access.account.accountId, access.account.epoch, projectId);
  if (loadedRequest.state === 'denied') return redirect(homePath);
  if (loadedRequest.state === 'unavailable') return notFound();
  if (loadedRequest.state === 'unreadable') {
    return (
      <div className="page page-narrow">
        <Unreadable title="project.error.title" body="project.error.body" headingLevel={1}/>
      </div>
    );
  }
  if (loadedRequest.state !== 'found' || loadedRequest.request.mode === 'evidence_text' || loadedRequest.request.images.length === 0) {
    return <PicturesLocked project={loaded.project} kind="review"/>;
  }
  const {request} = loadedRequest;
  // The key restarts the screen when the Project's pictures or review change (a newer revision), so it never holds the measurements of an older one.
  return (
    <PictureReview
      key={request.seq}
      project={{id: loaded.project.id, title: loaded.project.title}}
      request={{seq: request.seq, mode: request.mode, confirmed: request.confirmed, scope: request.scope, outcome: request.outcome, images: request.images}}
    />
  );
}
