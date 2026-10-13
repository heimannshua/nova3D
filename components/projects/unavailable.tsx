import {LinkButton} from '../ui/button';
import {EmptyState} from '../ui/states';
import {getI18n} from '@/lib/i18n/server';
import {projectsPath} from '@/lib/project-view';

/**
 * The one page for a Project that is not available: another Account's, deleted, unknown, or an ID that is not one. It says the same
 * thing for each and shows nothing of any Project, so it cannot be used to find out whether one exists. The route answers it with
 * HTTP 404 (app/projects/[projectId]/not-found.tsx).
 */
export async function ProjectUnavailable() {
  const {t} = await getI18n();
  return (
    <div className="page page-narrow">
      <EmptyState
        headingLevel={1}
        icon="help"
        title={t('project.unavailable.title')}
        action={<LinkButton variant="primary" href={projectsPath} icon="back">{t('project.unavailable.action')}</LinkButton>}
      >
        {t('project.unavailable.body')}
      </EmptyState>
    </div>
  );
}
