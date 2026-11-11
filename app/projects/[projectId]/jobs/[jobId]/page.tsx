import {notFound, redirect} from 'next/navigation';
import {Unreadable} from '@/components/projects/unreadable';
import {homePath, gatingTimeoutMs} from '@/lib/access';
import {requireActiveAccount} from '@/lib/auth';
import {operationOf} from '@/lib/authority';
import {getI18n} from '@/lib/i18n/server';
import {readJob, type JobRead} from '@/lib/job-records';
import {jobIdOf, reasonWords, stageWords} from '@/lib/job-view';
import {projectIdOf} from '@/lib/project-view';
import type {MessageKey} from '@/lib/i18n';

type ProjectJobPageProps = {
  params: Promise<{projectId: string; jobId: string}>;
};

export default async function ProjectJobPage({params}: ProjectJobPageProps) {
  const access = await requireActiveAccount();
  const [{projectId: rawProjectId, jobId: rawJobId}, {t}] = await Promise.all([params, getI18n()]);
  const projectId = projectIdOf(rawProjectId);
  const jobId = jobIdOf(rawJobId);
  if (projectId === null || jobId === null) notFound();
  const validatedProjectId = projectId as string;
  const validatedJobId = jobId as string;

  let result: JobRead;
  try {
    result = await readJob(operationOf(access.account), {jobId: validatedJobId}, {timeoutMs: gatingTimeoutMs});
  } catch {
    return (
      <div className="page page-narrow">
        <Unreadable title="job.detail.error.title" body="job.detail.error.body" headingLevel={1}/>
      </div>
    );
  }

  if (result.outcome === 'denied') return redirect(homePath);
  if (result.outcome === 'unavailable') notFound();

  const {job} = result;
  if (job.projectId !== validatedProjectId) notFound();

  const stageLabel = job.state === 'waiting' || job.state === 'running' ? 'job.detail.stage' : 'job.detail.lastStage';

  return (
    <div className="page">
      <p className="eyebrow">{t('job.eyebrow')}</p>
      <div className="page-title-row">
        <div className="project-heading">
          <h1>Job details</h1>
          <p className="project-stage">{t(`job.state.${job.state}` as MessageKey)}</p>
          {reasonWords(t, job.reason) ? <p className="job-reason">{reasonWords(t, job.reason)}</p> : null}
        </div>
      </div>

      <dl className="project-facts job-facts">
        <div>
          <dt>{t(stageLabel)}</dt>
          <dd>{stageWords(t, job.stage)}</dd>
        </div>
        <div>
          <dt>{t('job.detail.accepted')}</dt>
          <dd><time dateTime={job.createdAt}>{job.createdAt}</time></dd>
        </div>
      </dl>

      <section className="section job-section" aria-labelledby="project-job-attempts">
        <h2 id="project-job-attempts">{t('job.attempts.title')}</h2>
        <ol>
          {job.attempts.map((attempt) => {
            const reason = reasonWords(t, attempt.reason);
            return (
              <li key={attempt.id}>
                <h3>{t('job.detail.attemptOf', {number: attempt.number, total: job.attempts.length})}</h3>
                <dl className="project-facts job-facts">
                  <div>
                    <dt>State</dt>
                    <dd>{t(`job.state.${attempt.state}` as MessageKey)}</dd>
                  </div>
                  <div>
                    <dt>Stage</dt>
                    <dd>{stageWords(t, attempt.stage)}</dd>
                  </div>
                  {reason ? (
                    <div>
                      <dt>Reason</dt>
                      <dd>{reason}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{t('job.detail.accepted')}</dt>
                    <dd><time dateTime={attempt.createdAt}>{attempt.createdAt}</time></dd>
                  </div>
                  <div>
                    <dt>{t('job.detail.started')}</dt>
                    <dd>{attempt.startedAt ? <time dateTime={attempt.startedAt}>{attempt.startedAt}</time> : t('job.detail.notYet')}</dd>
                  </div>
                  <div>
                    <dt>{t('job.detail.finished')}</dt>
                    <dd>{attempt.endedAt ? <time dateTime={attempt.endedAt}>{attempt.endedAt}</time> : t('job.detail.notYet')}</dd>
                  </div>
                  <div>
                    <dt>Potentially chargeable operations</dt>
                    <dd>{attempt.chargeableOperations}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
