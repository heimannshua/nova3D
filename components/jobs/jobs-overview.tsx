'use client';

import {useEffect, useRef} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {changeSignature, isOpenListItem, type JobsListing} from '@/lib/job-view';
import {projectsPath} from '@/lib/project-view';
import {Unreadable} from '../projects/unreadable';
import {useAnnounce} from '../ui/announcer';
import {LinkButton} from '../ui/button';
import {Icon} from '../ui/icon';
import {EmptyState} from '../ui/states';
import {StatusBadge} from '../ui/status-badge';
import {JobCard} from './job-card';
import {JobRefresh, useJobRefresh} from './job-refresh';

/**
 * In Progress (J-01): the Account's Jobs, the ones that are running or waiting first and then the ones that have finished, each a card that opens the Job; the
 * refresh button, with the page updating itself every 10 seconds while anything is open; and, always, "Prints in Progress" as the future capability it is. Four variants: no
 * Jobs (an honest empty state that says what will appear and where to start), several Jobs, Jobs in mixed states, and the list that could not be read (never shown as an
 * empty one: "you have none" and "we could not look" are different things).
 */
export function JobsOverview({listing}: {listing: JobsListing}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const jobs = listing.state === 'listed' ? listing.jobs : [];
  const open = jobs.filter(isOpenListItem);
  const finished = jobs.filter((job) => !isOpenListItem(job));
  const active = open.length > 0;
  const {pending, refresh} = useJobRefresh(active);

  // A list that changes under a person's eyes is said politely: the first reading is the page itself, not a change.
  const signature = jobs.map((job) => `${job.jobId}:${changeSignature(job)}`).join(',');
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (seen.current !== null && seen.current !== signature) announce(t('job.announce.list'), locale);
    seen.current = signature;
  }, [signature, announce, t, locale]);

  return (
    <>
      <div className="page-title-row">
        <div>
          <p className="eyebrow">{t('nav.workspace')}</p>
          <h1>{t('nav.progress')}</h1>
          <p className="lede">{t('progress.lede')}</p>
        </div>
        {listing.state === 'listed' ? <JobRefresh active={active} pending={pending} onRefresh={refresh}/> : null}
      </div>
      {listing.state === 'unreadable' ? (
        <div className="section"><Unreadable title="job.error.title" body="job.error.body" headingLevel={2}/></div>
      ) : jobs.length === 0 ? (
        <div className="section">
          <EmptyState
            icon="activity"
            title={t('progress.noneTitle')}
            action={<LinkButton variant="secondary" href={projectsPath} iconAfter="arrow">{t('progress.seeProjects')}</LinkButton>}
          >
            {t('progress.noneBody')}
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="section" aria-labelledby="jobs-open-title">
            <h2 id="jobs-open-title">{t('job.list.activeTitle')}</h2>
            {open.length > 0 ? (
              <ul className="job-list">{open.map((job) => <li key={job.jobId}><JobCard job={job}/></li>)}</ul>
            ) : (
              <p className="project-muted">{t('job.list.activeNone')}</p>
            )}
          </section>
          {finished.length > 0 ? (
            <section className="section" aria-labelledby="jobs-finished-title">
              <h2 id="jobs-finished-title">{t('job.list.recentTitle')}</h2>
              <ul className="job-list">{finished.map((job) => <li key={job.jobId}><JobCard job={job}/></li>)}</ul>
            </section>
          ) : null}
        </>
      )}
      <ul className="job-list">
        <li className="coming-card">
          <span className="job-icon"><Icon name="spark"/></span>
          <div className="coming-main">
            <p className="eyebrow">{t('progress.futureKind')}</p>
            <h2>{t('progress.printsTitle')}</h2>
            <p>{t('progress.printsBody')}</p>
          </div>
          <StatusBadge tone="neutral">{t('progress.comingLater')}</StatusBadge>
        </li>
      </ul>
    </>
  );
}

