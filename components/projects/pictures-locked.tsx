'use client';

import {useI18n} from '@/lib/i18n/react';
import {projectPath, type ProjectRow} from '@/lib/project-view';
import {LinkButton} from '../ui/button';
import {EmptyState} from '../ui/states';

/**
 * What the picture screen of a Project says when the Project's request is not an unconfirmed set of pictures (a text request, a confirmed request, or none):
 * its pictures cannot be changed here. It names the Project and offers the way back, and stores and shows nothing else.
 */
export function PicturesLocked({project}: {project: Pick<ProjectRow, 'id' | 'title'>}) {
  const {t} = useI18n();
  return (
    <div className="page page-narrow">
      <p className="eyebrow"><bdi className="project-title">{project.title}</bdi></p>
      <h1>{t('meta.pictures')}</h1>
      <div className="section">
        <EmptyState
          icon="image"
          title={t('picture.locked.title')}
          action={<LinkButton variant="secondary" href={projectPath(project.id)} icon="back">{t('picture.locked.back')}</LinkButton>}
        >
          {t('picture.locked.body')}
        </EmptyState>
      </div>
    </div>
  );
}
