import type {Metadata} from 'next';
import {LinkButton} from '@/components/ui/button';
import {EmptyState} from '@/components/ui/states';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.notFound')};
}

export default async function NotFound() {
  const {t} = await getI18n();
  return (
    <div className="page page-narrow">
      <EmptyState headingLevel={1} icon="help" title={t('notFound.title')} action={<LinkButton variant="primary" href="/" icon="back">{t('notFound.home')}</LinkButton>}>
        {t('notFound.body')}
      </EmptyState>
    </div>
  );
}
