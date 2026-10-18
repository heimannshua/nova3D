'use client';

import {useId} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {formatUpdated, updatedIso, type ProjectRequestRow} from '@/lib/project-view';
import {Notice} from '../ui/states';
import {LtrToken} from '../ui/text-span';
import {PersonalizationSummary} from './personalization-summary';

const modeKeys = {
  evidence_text: 'request.mode.evidence_text',
  evidence_images: 'request.mode.evidence_images',
  image_direct: 'request.mode.image_direct',
} as const satisfies Record<ProjectRequestRow['mode'], MessageKey>;

/** What the Project page knows about its request: the latest revision (with the subject's display name), none, or that it could not be read. */
export type RequestSectionData =
  | {state: 'found'; request: ProjectRequestRow; subjectName: string | null}
  | {state: 'none'}
  | {state: 'unreadable'};

/**
 * The Request section of a Project's page (Story 2.1): what the person confirmed, exactly as it was recorded: the subject, the scope,
 * the intended outcome, how it was described, the personalization as applied or not applied (with the reason) and when it was
 * confirmed (UTC, in the format of the page's other times). A confirmed request carries no approval, permission or payment, and the
 * page says nothing was started. A Project without a request (a sample, or one made before requests were recorded) has no section.
 */
export function RequestSection({data}: {data: RequestSectionData}) {
  const {t} = useI18n();
  const headingId = useId();
  if (data.state === 'none') return null;
  if (data.state === 'unreadable') {
    return (
      <section className="section request-section" aria-labelledby={headingId}>
        <h2 id={headingId}>{t('request.section.title')}</h2>
        <div className="invite-notice"><Notice tone="warning">{t('request.section.unreadable')}</Notice></div>
      </section>
    );
  }
  const {request, subjectName} = data;
  const confirmed = formatUpdated(request.confirmedAt);
  return (
    <section className="section request-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('request.section.title')}</h2>
      <dl className="project-facts request-facts">
        <div>
          <dt>{t('request.review.subject')}</dt>
          <dd>{subjectName ? <bdi>{subjectName}</bdi> : request.subjectId ? <LtrToken>{request.subjectId}</LtrToken> : '-'}</dd>
        </div>
        <div>
          <dt>{t('request.review.scope')}</dt>
          <dd><bdi>{request.scope}</bdi></dd>
        </div>
        <div>
          <dt>{t('request.review.outcome')}</dt>
          <dd><bdi>{request.outcome}</bdi></dd>
        </div>
        <div>
          <dt>{t('request.review.mode')}</dt>
          <dd>{t(modeKeys[request.mode])}</dd>
        </div>
        <div>
          <dt>{t('request.review.personalization')}</dt>
          <dd className="request-wish"><PersonalizationSummary wish={request.personalization}/></dd>
        </div>
        <div>
          <dt>{t('request.section.confirmed')}</dt>
          <dd>{confirmed ? <LtrToken><time dateTime={updatedIso(request.confirmedAt)}>{confirmed}</time></LtrToken> : '-'}</dd>
        </div>
      </dl>
      <p className="project-muted request-note">{t('request.section.nothingStarted')}</p>
    </section>
  );
}
