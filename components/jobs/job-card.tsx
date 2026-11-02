'use client';

import Link from 'next/link';
import {useI18n} from '@/lib/i18n/react';
import {jobPath, kindWords, reasonWords, stageWords, formatTime, timeIso, variantBadges, variantWordKeys, type JobListItem} from '@/lib/job-view';
import {Icon} from '../ui/icon';
import {StatusBadge} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';

/**
 * One Job in the list of In progress (J-01): what it is for (its kind and its Project, the person's own words, isolated), its state as a word with a shape of its own, the
 * stage or the reason that matters (why it waits, where it is, why it stopped), and when. The whole card is the target of its link to the Job (the card-link pattern of the Project
 * cards), so a tap anywhere on it opens the Job. A finished Job says how it ended and not how far it got: a completed one needs no stage.
 */
export function JobCard({job}: {job: JobListItem}) {
  const {t} = useI18n();
  const badge = variantBadges[job.state];
  const headingId = `job-${job.jobId}-title`;
  // What a person wants to read under the title: why a waiting Job waits, where a running one is, why a failed or stopped one ended.
  const line = job.state === 'running' ? stageWords(t, job.stage) : job.state === 'completed' ? null : reasonWords(t, job.reason);
  const [timeLabel, time] =
    job.endedAt !== null ? ([t('job.card.finished'), job.endedAt] as const) : job.startedAt !== null ? ([t('job.card.started'), job.startedAt] as const) : ([t('job.card.accepted'), job.createdAt] as const);
  const shown = formatTime(time);
  // The Project's title is the person's own words, in any script: it is isolated in its own element (as the detail page does), so its direction cannot reorder the words around it.
  const [titleBefore, titleAfter] = t('job.card.title', {kind: kindWords(t, job.kind), project: '{project}'}, {isolate: false}).split('{project}');
  return (
    <article className="job-card" aria-labelledby={headingId} data-state={job.state}>
      <span className="job-icon"><Icon name={badge.icon} size={22}/></span>
      <div className="job-main">
        <div className="job-heading">
          <h3 id={headingId} className="project-title">
            <Link className="card-link" href={jobPath(job.jobId)}>
              {titleBefore}<bdi>{job.projectTitle}</bdi>{titleAfter}
            </Link>
          </h3>
          <StatusBadge tone={badge.tone} icon={badge.icon}>{t(variantWordKeys[job.state])}</StatusBadge>
        </div>
        {line ? <p className="job-body">{line}</p> : null}
        <p className="job-meta">
          <span>{timeLabel}{' '}{shown ? <LtrToken><time dateTime={timeIso(time)}>{shown}</time></LtrToken> : '-'}</span>
          {job.attemptNumber > 1 ? <span>{t('job.card.attempt', {number: job.attemptNumber})}</span> : null}
        </p>
      </div>
    </article>
  );
}
