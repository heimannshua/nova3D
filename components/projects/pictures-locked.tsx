'use client';

import {useI18n} from '@/lib/i18n/react';
import {projectPath, type ProjectRow} from '@/lib/project-view';
import {LinkButton} from '../ui/button';
import {EmptyState} from '../ui/states';

/**
 * What the picture screen of a Project says when the Project's request is not an unconfirmed picture request of either mode (a text request, a confirmed request, or
 * none): its pictures cannot be changed here (`kind` `change`, the default). What the review screen says when the Project's request has no pictures to review (a text
 * request, or none): `kind` `review`. It names the Project and offers the way back, and stores and shows nothing else.
 */
export function PicturesLocked({project, kind = 'change'}: {project: Pick<ProjectRow, 'id' | 'title'>; kind?: 'change' | 'review'}) {
  const {t} = useI18n();
  const review = kind === 'review';
  return (
    <div className="page page-narrow">
      <p className="eyebrow"><bdi className="project-title">{project.title}</bdi></p>
      <h1>{review ? t('meta.pictureReview') : t('meta.pictures')}</h1>
      <div className="section">
        <EmptyState
          icon="image"
          title={review ? t('review.locked.title') : t('picture.locked.title')}
          action={<LinkButton variant="secondary" href={projectPath(project.id)} icon="back">{review ? t('review.locked.back') : t('picture.locked.back')}</LinkButton>}
        >
          {review ? t('review.locked.body') : t('picture.locked.body')}
        </EmptyState>
      </div>
    </div>
  );
}
