'use client';

import Link from 'next/link';
import {useEffect, useId, useRef, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {
  changeSignature,
  explain,
  formatTime,
  isOpenState,
  kindWords,
  needsExplaining,
  nextActionKey,
  reasonWords,
  stageWords,
  timeIso,
  variantBadges,
  variantOf,
  variantWordKeys,
  type AttemptView,
  type JobDetail,
} from '@/lib/job-view';
import {projectPath} from '@/lib/project-view';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {Notice} from '../ui/states';
import {StatusBadge} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';
import {JobCancelDialog} from './job-cancel';
import {JobCostSection} from './job-cost';
import {JobProgressSection} from './job-progress';
import {JobRefresh, useJobRefresh} from './job-refresh';

/** A UTC time as the pages write it, as a left-to-right token, or a dash when it cannot be read; `empty` stands in for no time at all. */
function When({value, empty}: {value: string | null; empty: string}) {
  if (value === null) return <>{empty}</>;
  const shown = formatTime(value);
  return shown ? <LtrToken><time dateTime={timeIso(value)}>{shown}</time></LtrToken> : <>-</>;
}

/** Why a Job ended or waits, and how far it got, in one list: an attempt of the Job, with the word of its state and the reason behind it. */
function AttemptRow({attempt}: {attempt: AttemptView}) {
  const {t} = useI18n();
  const badge = variantBadges[attempt.state];
  const reason = reasonWords(t, attempt.reason);
  return (
    <li className="job-attempt">
      <div className="job-heading">
        <h3>{t('job.card.attempt', {number: attempt.number})}</h3>
        <StatusBadge tone={badge.tone} icon={badge.icon}>{t(variantWordKeys[attempt.state])}</StatusBadge>
      </div>
      {reason ? <p className="job-body">{reason}</p> : null}
      <p className="job-meta">
        <span>{t('job.detail.accepted')}{' '}<When value={attempt.createdAt} empty="-"/></span>
        <span>{t('job.detail.started')}{' '}<When value={attempt.startedAt} empty={t('job.detail.notYet')}/></span>
        {attempt.endedAt ? <span>{t('job.detail.finished')}{' '}<When value={attempt.endedAt} empty="-"/></span> : null}
      </p>
    </li>
  );
}

/**
 * A Job in full (J-02): what it is and the Project it is for, its state as a word with a shape of its own and the reason behind it, the stage it is at, how far it has come, what
 * it costs, and, when it failed or was stopped, what happened in the five things UX-DR19 asks for (the stage it stopped at, the known cause, what was kept, what it cost when
 * known, and what to do next). The six variants are waiting, running, completed, failed, cancelled and a result that was rejected because the Project changed. Nothing here
 * implies a retry: a failed Job stays failed, and the page says so.
 *
 * While the Job is open the page asks for itself again every 10 seconds (not while the tab is hidden), says so, and has a button for it; a change in its state, stage or reason is
 * announced politely. Cancel (while the Job is open) opens a confirmation first.
 */
export function JobDetailView({job}: {job: JobDetail}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const active = isOpenState(job.state);
  const {pending, refresh} = useJobRefresh(active);
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const nextId = useId();
  const outcomeId = useId();
  const attemptsId = useId();
  const variant = variantOf(job);
  const badge = variantBadges[variant];
  const reason = reasonWords(t, job.reason);
  const highest = job.attempts[job.attempts.length - 1];
  const explanation = needsExplaining(job) ? explain(t, job) : null;

  // A Job that changes under a person's eyes is said politely: the first reading is the page itself, not a change.
  const signature = `${changeSignature(job)}|${job.ending ?? ''}`;
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (seen.current !== null && seen.current !== signature) {
      announce(t('job.announce.changed', {state: t(variantWordKeys[variant]), stage: stageWords(t, job.stage)}), locale);
    }
    seen.current = signature;
  }, [signature, announce, t, locale, variant, job.stage]);

  return (
    <div className="page">
      <p className="eyebrow">{t('job.eyebrow')}</p>
      <div className="page-title-row">
        <div className="project-heading">
          <h1>{kindWords(t, job.kind)}</h1>
          <p className="project-stage"><StatusBadge tone={badge.tone} icon={badge.icon}>{t(variantWordKeys[variant])}</StatusBadge></p>
          {reason ? <p className="job-reason">{reason}</p> : null}
        </div>
        <div className="job-actions">
          <JobRefresh active={active} pending={pending} onRefresh={refresh}/>
          {job.canCancel ? <Button variant="danger" icon="close" onClick={() => setCancelling(true)}>{t('job.cancel.button')}</Button> : null}
        </div>
      </div>
      {cancelled ? <div className="invite-notice"><Notice tone="success" role="status">{t('job.cancel.done')}</Notice></div> : null}

      <dl className="project-facts job-facts">
        <div>
          <dt>{t('job.detail.project')}</dt>
          <dd><Link className="text-link" href={projectPath(job.projectId)}><bdi>{job.projectTitle}</bdi></Link></dd>
        </div>
        <div>
          <dt>{active ? t('job.detail.stage') : t('job.detail.lastStage')}</dt>
          <dd>{stageWords(t, job.stage)}</dd>
        </div>
        <div>
          <dt>{t('job.detail.attempt')}</dt>
          <dd>{t('job.detail.attemptOf', {number: highest.number, total: job.attempts.length})}</dd>
        </div>
        <div>
          <dt>{t('job.detail.accepted')}</dt>
          <dd><When value={job.createdAt} empty="-"/></dd>
        </div>
        <div>
          <dt>{t('job.detail.started')}</dt>
          <dd><When value={highest.startedAt} empty={t('job.detail.notYet')}/></dd>
        </div>
        {highest.endedAt ? (
          <div>
            <dt>{t('job.detail.finished')}</dt>
            <dd><When value={highest.endedAt} empty="-"/></dd>
          </div>
        ) : null}
      </dl>

      <JobProgressSection progress={job.progress} state={job.state}/>

      {explanation ? (
        <section className="section job-section job-outcome" aria-labelledby={outcomeId} data-section="outcome" data-variant={variant}>
          <h2 id={outcomeId}>{t('job.what.title')}</h2>
          <dl className="job-explained">
            <div>
              <dt>{t('job.what.stage')}</dt>
              <dd>{explanation.stage}</dd>
            </div>
            <div>
              <dt>{t('job.what.cause')}</dt>
              <dd>{explanation.cause}</dd>
            </div>
            <div>
              <dt>{t('job.what.kept')}</dt>
              <dd>{explanation.kept}</dd>
            </div>
            <div>
              <dt>{t('job.what.cost')}</dt>
              <dd>
                <ul className="job-impact">
                  {explanation.cost.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </dd>
            </div>
            <div>
              <dt>{t('job.what.next')}</dt>
              <dd>{explanation.next}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <section className="section next-action job-section" aria-labelledby={nextId} data-section="outcome" data-variant={variant}>
          <h2 id={nextId}>{t('job.what.nextTitle')}</h2>
          <p>{t(nextActionKey(job))}</p>
        </section>
      )}

      <JobCostSection cost={job.cost}/>

      {job.attempts.length > 1 ? (
        <section className="section job-section" aria-labelledby={attemptsId} data-section="attempts">
          <h2 id={attemptsId}>{t('job.attempts.title')}</h2>
          <ul className="job-list">
            {[...job.attempts].reverse().map((attempt) => <AttemptRow key={attempt.id} attempt={attempt}/>)}
          </ul>
        </section>
      ) : null}

      {cancelling ? (
        <JobCancelDialog
          jobId={job.jobId}
          onClose={() => setCancelling(false)}
          onCancelled={() => {
            setCancelled(true);
            announce(t('job.cancel.done'), locale);
          }}
        />
      ) : null}
    </div>
  );
}
