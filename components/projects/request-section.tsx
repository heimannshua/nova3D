'use client';

import {useId} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {formatBytes, shortSha, typeLabel} from '@/lib/picture-set';
import {formatUpdated, picturesPath, updatedIso, type ProjectRequestRow} from '@/lib/project-view';
import {LinkButton} from '../ui/button';
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
 * The Request section of a Project's page (Story 2.1, Story 2.2): what the person confirmed, exactly as it was recorded: the subject, the scope,
 * the intended outcome, how it was described, the personalization as applied or not applied (with the reason) and when it was
 * confirmed (UTC, in the format of the page's other times). A confirmed request carries no approval, permission or payment, and the
 * page says nothing was started. A Project without a request (a sample, or one made before requests were recorded) has no section.
 *
 * A picture request saved on the picture screen (Story 2.2) is not confirmed: it shows its Pictures part instead (how many, and for each its place, kind,
 * size, a short SHA-256, and when its private copy lapses, with a warning for one that has), says it is not confirmed yet, and, while it can still be
 * changed, offers Change pictures. Nothing here fetches or links a picture: only what the request records is shown.
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
  if (!request.confirmed) return <PicturesPart request={request} headingId={headingId}/>;
  const confirmed = request.confirmedAt ? formatUpdated(request.confirmedAt) : '';
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
          <dd><bdi>{request.scope ?? ''}</bdi></dd>
        </div>
        <div>
          <dt>{t('request.review.outcome')}</dt>
          <dd><bdi>{request.outcome ?? ''}</bdi></dd>
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
          <dd>{confirmed ? <LtrToken><time dateTime={request.confirmedAt ? updatedIso(request.confirmedAt) : undefined}>{confirmed}</time></LtrToken> : '-'}</dd>
        </div>
      </dl>
      <p className="project-muted request-note">{t('request.section.nothingStarted')}</p>
    </section>
  );
}

/** The Request section of a picture request that is not confirmed yet: its status and its pictures in the person's order. */
function PicturesPart({request, headingId}: {request: ProjectRequestRow; headingId: string}) {
  const {t} = useI18n();
  // The pictures are changed on their own screen while the request is an unconfirmed set of pictures (the database refuses a change once it is not).
  const editable = request.mode === 'evidence_images';
  return (
    <section className="section request-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('request.section.title')}</h2>
      <dl className="project-facts request-facts">
        <div>
          <dt>{t('picture.section.status')}</dt>
          <dd>{t('picture.section.notConfirmed')}</dd>
        </div>
        <div>
          <dt>{t('picture.section.count')}</dt>
          <dd>{request.images.length}</dd>
        </div>
      </dl>
      <h3 className="picture-section-title">{t('picture.section.title')}</h3>
      <ol className="picture-saved">
        {request.images.map((image) => {
          const lapses = image.expiresAt ? formatUpdated(image.expiresAt) : '';
          return (
            <li key={image.uploadId} className="picture-saved-item">
              <p>
                <strong>{t('picture.section.position', {position: image.position})}</strong>
                {' · '}
                <LtrToken>{typeLabel(image.contentType)}</LtrToken>
                {' · '}
                <LtrToken>{formatBytes(image.length)}</LtrToken>
              </p>
              <p className="project-muted">
                {t('picture.section.fingerprint', {algorithm: 'SHA-256'})}: <LtrToken>{shortSha(image.sha256)}</LtrToken>
              </p>
              {image.available ? (
                lapses ? <p className="project-muted">{t('picture.section.lapses', {time: lapses})}</p> : null
              ) : (
                <div className="picture-note"><Notice tone="warning">{t('picture.section.unavailable')}</Notice></div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="project-muted request-note">{t('picture.section.note')}</p>
      {editable ? (
        <div className="request-actions picture-section-actions">
          <LinkButton variant="secondary" icon="image" href={picturesPath(request.projectId)}>{t('picture.section.change')}</LinkButton>
        </div>
      ) : null}
    </section>
  );
}
