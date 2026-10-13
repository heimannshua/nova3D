'use client';

import {useRouter} from 'next/navigation';
import {useTransition} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {Button} from '../ui/button';
import {ErrorState} from '../ui/states';

/**
 * What a page shows when the database did not answer: an error state with a way to ask again, and nothing else about the Projects.
 * It is never the "unavailable" page: a Project that cannot be read because the service is down is not a Project that is not yours.
 *
 * Asking again is one request at a time: while it is out the button says so, is aria-disabled (a second press does nothing), and a
 * polite status says "Trying again…". When the page answers, the error state is replaced by the page, or, if the service is still
 * down, by this state again with the button back.
 */
export function Unreadable({title, body, headingLevel}: {title: MessageKey; body: MessageKey; headingLevel: 1 | 2}) {
  const {t} = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <ErrorState
      live
      headingLevel={headingLevel}
      title={t(title)}
      action={
        <>
          <Button variant="primary" aria-disabled={pending ? true : undefined} onClick={() => !pending && startTransition(() => router.refresh())}>
            {pending ? t('state.retrying') : t('state.retry')}
          </Button>
          <p className="auth-hint auth-status" role="status">{pending ? t('state.retrying') : null}</p>
        </>
      }
    >
      {t(body)}
    </ErrorState>
  );
}
