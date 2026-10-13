'use client';

import {useI18n} from '@/lib/i18n/react';
import {projectPath, type ProjectRow} from '@/lib/project-view';
import {LinkButton} from '../ui/button';
import {EmptyState} from '../ui/states';

/**
 * The Sources page of a Project (Story 1.7): an honest placeholder. Sources are Epic 3's; until they exist the page says so, names the
 * Project it belongs to, and offers the way back. It stores and shows nothing.
 */
export function SourcesPlaceholder({project}: {project: Pick<ProjectRow, 'id' | 'title'>}) {
  const {t} = useI18n();
  return (
    <div className="page page-narrow">
      <p className="eyebrow"><bdi className="project-title">{project.title}</bdi></p>
      <h1>{t('sources.title')}</h1>
      <p className="lede">{t('sources.lede')}</p>
      <div className="section">
        <EmptyState
          icon="doc"
          title={t('sources.emptyTitle')}
          action={<LinkButton variant="secondary" href={projectPath(project.id)} icon="back">{t('sources.back')}</LinkButton>}
        >
          {t('sources.emptyBody', {title: project.title})}
        </EmptyState>
      </div>
    </div>
  );
}
