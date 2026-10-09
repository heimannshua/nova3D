'use client';

import {useEffect} from 'react';
import {Button} from '@/components/ui/button';
import {ErrorState} from '@/components/ui/states';
import {useI18n} from '@/lib/i18n/react';

// The route-level error boundary. Next.js 16 hands it `retry` (earlier versions called it `reset`).
export default function RouteError({error, retry}: {error: Error & {digest?: string}; retry: () => void}) {
  const {t} = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="page page-narrow">
      <ErrorState live headingLevel={1} title={t('state.errorTitle')} action={<Button variant="primary" onClick={retry}>{t('state.retry')}</Button>}>
        {t('state.errorBody')}
      </ErrorState>
    </div>
  );
}
