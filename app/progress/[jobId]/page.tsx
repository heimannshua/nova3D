import type {Metadata} from 'next';
import {notFound, redirect} from 'next/navigation';
import {JobDetailView} from '@/components/jobs/job-detail';
import {Unreadable} from '@/components/projects/unreadable';
import {homePath} from '@/lib/access';
import {getAccess, requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {loadJob} from '@/lib/job-pages';
import {kindWords} from '@/lib/job-view';

// Next evaluates the page's metadata before the page runs its own check, and a page's title wins over the 404 page's. So the title asks the same question the page does, of the same
// read (`loadJob` is memoized for the render: this and the page share one answer): a Job that is not available has the title of the page that says so, whatever the reason, and
// never a name.
export async function generateMetadata({params}: {params: Promise<{jobId: string}>}): Promise<Metadata> {
  const [access, {t}, {jobId}] = await Promise.all([getAccess().catch(() => null), getI18n(), params]);
  if (access?.state !== 'active') return {title: t('meta.jobUnavailable')};
  const loaded = await loadJob(access.account.accountId, access.account.epoch, jobId);
  if (loaded.state === 'found') return {title: kindWords(t, loaded.job.kind)};
  return {title: loaded.state === 'unreadable' ? t('meta.job') : t('meta.jobUnavailable')};
}

// A Job's detail (J-02): its state, stage and reason, how far it has come, what it costs, what happened if it failed or was stopped, and Cancel while it is open. A Job that is
// another Account's, deleted, unknown, of a deleted Project or not an ID at all is ONE answer: the page that says it is not available, with a 404 status, which `notFound()`
// renders from not-found.tsx beside this file. A database that cannot answer is not that answer.
export default async function JobPage({params}: {params: Promise<{jobId: string}>}) {
  const access = await requireActiveAccount();
  const {jobId} = await params;
  const loaded = await loadJob(access.account.accountId, access.account.epoch, jobId);
  if (loaded.state === 'denied') return redirect(homePath);
  if (loaded.state === 'unavailable') return notFound();
  if (loaded.state === 'unreadable') {
    return (
      <div className="page page-narrow">
        <Unreadable title="job.detail.error.title" body="job.detail.error.body" headingLevel={1}/>
      </div>
    );
  }
  return <JobDetailView job={loaded.job}/>;
}
