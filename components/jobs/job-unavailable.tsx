import {getI18n} from '@/lib/i18n/server';
import {progressPath} from '@/lib/job-view';
import {LinkButton} from '../ui/button';
import {EmptyState} from '../ui/states';

/**
 * The one page for a Job that is not available: another Account's, deleted, unknown, one of a deleted or removed Project, or an ID that is not one. It says the same thing for
 * each and shows nothing of any Job, so it cannot be used to find out whether one exists. The route answers it with HTTP 404 (app/progress/[jobId]/not-found.tsx).
 */
export async function JobUnavailable() {
  const {t} = await getI18n();
  return (
    <div className="page page-narrow">
      <EmptyState
        headingLevel={1}
        icon="help"
        title={t('job.unavailable.title')}
        action={<LinkButton variant="primary" href={progressPath} icon="back">{t('job.unavailable.action')}</LinkButton>}
      >
        {t('job.unavailable.body')}
      </EmptyState>
    </div>
  );
}
