'use client';

import {useId} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {incompleteSentences, labelKeys, problemWords} from '@/lib/picture-review';
import {assess, blurText, percentOf} from '@/lib/picture-quality';
import {formatBytes, shortSha, typeLabel} from '@/lib/picture-set';
import {formatUpdated, picturesPath, reviewPath, updatedIso, type KeptPicture, type ProjectRequestRow} from '@/lib/project-view';
import {LinkButton} from '../ui/button';
import {Notice} from '../ui/states';
import {LtrToken} from '../ui/text-span';
import {PersonalizationSummary} from './personalization-summary';

const modeKeys = {
  evidence_text: 'request.mode.evidence_text',
  evidence_images: 'request.mode.evidence_images',
  image_direct: 'request.mode.image_direct',
} as const satisfies Record<ProjectRequestRow['mode'], MessageKey>;

/**
 * What the Project page knows about its request: the latest revision (with the subject's display name), none, or that it could not be read. For a request made of
 * pictures, `kept` says which of them the revision pins as retained pictures (Story 2.12; absent or empty when none is).
 */
export type RequestSectionData =
  | {state: 'found'; request: ProjectRequestRow; subjectName: string | null; kept?: readonly KeptPicture[]}
  | {state: 'none'}
  | {state: 'unreadable'};

/**
 * The Request section of a Project's page (Story 2.1, Story 2.2, Story 2.3): what the person confirmed, exactly as it was recorded: the subject, the scope,
 * the intended outcome, how it was described, the personalization as applied or not applied (with the reason) and when it was
 * confirmed (UTC, in the format of the page's other times). A confirmed request carries no approval, permission or payment, and the
 * page says nothing was started. A Project without a request (a sample, or one made before requests were recorded) has no section.
 *
 * A request made of pictures (Story 2.2, Story 2.3) shows its Pictures part instead: how many, and for each its place, kind, size, a short SHA-256 and when its private
 * copy lapses (with a warning for one that has), and, once the pictures were reviewed, the mode that was chosen, the label and the result of each picture as the
 * browser measured it, that the person confirmed nothing blocks the subject and, for direct conversion with incomplete inputs, what they acknowledged and when (UTC).
 * It says whether the request is confirmed (a direct request is; a research-assisted one is not, until the subject is identified), offers Review pictures (again),
 * and, while the pictures can still be changed (the request is not confirmed), Change pictures. Nothing here fetches or links a picture: only what the request records
 * is shown.
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
  if (request.images.length > 0 || !request.confirmed) return <PicturesPart request={request} kept={data.kept ?? []} headingId={headingId}/>;
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

/** The Request section of a request made of pictures: its status, what was reviewed and chosen, and its pictures in the person's order. */
function PicturesPart({request, kept, headingId}: {request: ProjectRequestRow; kept: readonly KeptPicture[]; headingId: string}) {
  const {t, locale} = useI18n();
  // The pictures are changed on their own screen while the request is not confirmed (the database refuses a change once it is).
  const editable = !request.confirmed;
  // A revision that was reviewed records that the person confirmed nothing blocks the subject; the provisional mode of a set that was only saved is not a choice,
  // so a set that was not reviewed shows no mode at all.
  const reviewed = request.obstructionConfirmed;
  const direct = request.mode === 'image_direct';
  const confirmedAt = request.confirmedAt ? formatUpdated(request.confirmedAt) : '';
  const obstructionAt = request.obstructionConfirmedAt ? formatUpdated(request.obstructionConfirmedAt) : '';
  const acknowledgedAt = request.acknowledgedAt ? formatUpdated(request.acknowledgedAt) : '';
  // A picture the revision pins is kept privately with the request (Story 2.12): its staged copy lapsing is of no consequence, and is not said.
  const keptIds = new Set(kept.map((picture) => picture.uploadId));
  const allKept = request.images.length > 0 && request.images.every((image) => keptIds.has(image.uploadId));
  return (
    <section className="section request-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('request.section.title')}</h2>
      <dl className="project-facts request-facts">
        {reviewed ? (
          <div>
            <dt>{t('request.review.mode')}</dt>
            <dd>{t(modeKeys[request.mode])}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t('picture.section.status')}</dt>
          <dd>
            {request.confirmed
              ? confirmedAt
                ? <>{t('request.section.confirmed')} <LtrToken><time dateTime={request.confirmedAt ? updatedIso(request.confirmedAt) : undefined}>{confirmedAt}</time></LtrToken></>
                : t('request.section.confirmed')
              : reviewed
                ? t('review.section.researchRecorded')
                : t('picture.section.notConfirmed')}
          </dd>
        </div>
        {request.confirmed ? (
          <>
            <div>
              <dt>{t('request.review.scope')}</dt>
              <dd><bdi>{request.scope ?? ''}</bdi></dd>
            </div>
            <div>
              <dt>{t('request.review.outcome')}</dt>
              <dd><bdi>{request.outcome ?? ''}</bdi></dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>{t('picture.section.count')}</dt>
          <dd>{request.images.length}</dd>
        </div>
        {reviewed ? (
          <div data-review="obstruction">
            <dt>{t('review.section.obstruction')}</dt>
            <dd>{obstructionAt ? <>{t('review.section.obstructionYes')} <LtrToken><time dateTime={request.obstructionConfirmedAt ? updatedIso(request.obstructionConfirmedAt) : undefined}>{obstructionAt}</time></LtrToken></> : t('review.section.obstructionYes')}</dd>
          </div>
        ) : null}
        {reviewed && direct ? (
          <div data-review="acknowledgment">
            <dt>{t('review.section.acknowledgment')}</dt>
            <dd>
              {request.acknowledged ? (
                <>
                  <span>
                    {t('review.section.acknowledged')}{' '}
                    {acknowledgedAt ? <LtrToken><time dateTime={request.acknowledgedAt ? updatedIso(request.acknowledgedAt) : undefined}>{acknowledgedAt}</time></LtrToken> : null}
                  </span>
                  <ul className="review-ack-facts">
                    {incompleteSentences(t, request.images.map((image) => ({
                      label: image.label,
                      measurements: image.shortEdgePx !== null && image.blurVariance !== null && image.clippedFraction !== null
                        ? {shortEdgePx: image.shortEdgePx, blurVariance: image.blurVariance, clippedFraction: image.clippedFraction}
                        : null,
                    })), locale).map((sentence, index) => <li key={index}>{sentence}</li>)}
                  </ul>
                  <span>{t('review.ack.warning')}</span>
                </>
              ) : (
                t('review.section.noAcknowledgment')
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      {reviewed ? null : <p className="project-muted request-note">{t('review.section.notReviewed')}</p>}
      <h3 className="picture-section-title">{t('picture.section.title')}</h3>
      <ol className="picture-saved">
        {request.images.map((image) => {
          const lapses = image.expiresAt ? formatUpdated(image.expiresAt) : '';
          const measured = image.shortEdgePx !== null && image.blurVariance !== null && image.clippedFraction !== null
            ? {shortEdgePx: image.shortEdgePx, blurVariance: image.blurVariance, clippedFraction: image.clippedFraction}
            : null;
          const problems = measured ? assess(measured).problems : [];
          return (
            <li key={image.uploadId} className="picture-saved-item">
              <p>
                <strong>{t('picture.section.position', {position: image.position})}</strong>
                {image.label ? <> {' · '} <span data-view={image.label}>{t(labelKeys[image.label])}</span></> : null}
                {' · '}
                <LtrToken>{typeLabel(image.contentType)}</LtrToken>
                {' · '}
                <LtrToken>{formatBytes(image.length)}</LtrToken>
              </p>
              {measured ? (
                <p className="project-muted" data-result={problems.length ? 'problems' : 'ok'}>
                  {t('review.section.measured', {size: `${measured.shortEdgePx} px`, value: blurText(measured.blurVariance), percent: percentOf(measured.clippedFraction)})}{' '}
                  <strong>{problems.length ? t('review.section.problems', {problems: problemWords(t, problems, locale)}) : t('review.section.noProblems')}</strong>
                </p>
              ) : null}
              <p className="project-muted">
                {t('picture.section.fingerprint', {algorithm: 'SHA-256'})}: <LtrToken>{shortSha(image.sha256)}</LtrToken>
              </p>
              {keptIds.has(image.uploadId) ? (
                <p className="project-muted" data-kept="true">{t('picture.section.kept')}</p>
              ) : image.available ? (
                lapses ? <p className="project-muted">{t('picture.section.lapses', {time: lapses})}</p> : null
              ) : (
                <div className="picture-note"><Notice tone="warning">{t('picture.section.unavailable')}</Notice></div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="project-muted request-note">{request.confirmed ? t('review.section.directNothingStarted') : allKept ? t('picture.section.noteKept') : t('picture.section.note')}</p>
      <div className="request-actions picture-section-actions">
        <LinkButton variant="primary" icon="image" href={reviewPath(request.projectId)}>{reviewed ? t('review.section.reviewAgain') : t('review.section.review')}</LinkButton>
        {editable ? <LinkButton variant="secondary" icon="image" href={picturesPath(request.projectId)}>{t('picture.section.change')}</LinkButton> : null}
      </div>
    </section>
  );
}
