import type {Metadata} from 'next';
import {notFound, redirect} from 'next/navigation';
import {PictureIntake} from '@/components/projects/picture-intake';
import {PicturesLocked} from '@/components/projects/pictures-locked';
import {Unreadable} from '@/components/projects/unreadable';
import {homePath} from '@/lib/access';
import {getAccess, requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {loadProject, loadProjectRequest, loadRetainedPictures} from '@/lib/project-pages';

// As the overview's title: the same read, and a Project that is not available has the title of the page that says so.
export async function generateMetadata({params}: {params: Promise<{projectId: string}>}): Promise<Metadata> {
  const [access, {t}, {projectId}] = await Promise.all([getAccess().catch(() => null), getI18n(), params]);
  if (access?.state !== 'active') return {title: t('meta.projectUnavailable')};
  const loaded = await loadProject(access.account.accountId, access.account.epoch, projectId);
  if (loaded.state === 'found' || loaded.state === 'unreadable') return {title: t('meta.pictures')};
  return {title: t('meta.projectUnavailable')};
}

// The pictures of a Project whose latest request is an unconfirmed picture request (Story 2.2: C-03), to change: add, replace, reorder, remove, and save a successor
// (an unreviewed one: a revision that was reviewed is superseded, its labels and measurements are not carried over, and the screen says so). The only unconfirmed
// picture request is a research-assisted one (`evidence_images`): a review that chooses direct conversion records a CONFIRMED `image_direct` revision, and an
// unconfirmed `image_direct` revision cannot exist. It checks the Project exactly as the overview does, so a link to the pictures of a Project that is not available
// is the same unavailable page. A Project whose request is anything else (a confirmed request, a text request, no request) is told that its pictures cannot be
// changed here.
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
  if (request.state !== 'found' || request.request.mode === 'evidence_text' || request.request.confirmed) return <PicturesLocked project={loaded.project}/>;
  // A revision whose pictures carry labels was reviewed; saving a successor starts the review again.
  const reviewed = request.request.images.some((image) => image.label !== null);
  // A picture the revision pins is kept privately with the request (Story 2.12): the screen says so instead of when its staged copy lapses. A read that cannot be made
  // leaves each picture as the request records it.
  const retained = await loadRetainedPictures(access.account.accountId, access.account.epoch, projectId);
  if (retained.state === 'denied') return redirect(homePath);
  if (retained.state === 'unavailable') return notFound();
  const keptIds = new Set(retained.state === 'found' ? retained.pictures.map((picture) => picture.uploadId) : []);
  const saved = keptIds.size === 0 ? request.request.images : request.request.images.map((image) => (keptIds.has(image.uploadId) ? {...image, kept: true} : image));
  return <PictureIntake projectId={loaded.project.id} title={loaded.project.title} revision={request.request.seq} saved={saved} reviewed={reviewed}/>;
}
