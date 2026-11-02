'use client';

import {useRouter} from 'next/navigation';
import {useEffect, useRef, useTransition} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {jobRefreshMs, jobRefreshSeconds} from '@/lib/job-view';
import {Button} from '../ui/button';

/**
 * Asks the page for itself again (the server reads the Jobs afresh) while the work it shows is open: every 10 seconds, never while the tab is hidden, and once at the moment a
 * hidden tab is shown again. A request that is still out is never joined by another. `refresh` is the same thing on demand, for the button; `pending` says one is out.
 *
 * Nothing is kept in the browser but the timer: what the page shows is always what the database said at the last read.
 */
export function useJobRefresh(active: boolean) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  useEffect(() => {
    busy.current = pending;
  }, [pending]);

  const refresh = () => {
    if (busy.current) return;
    busy.current = true;
    startTransition(() => router.refresh());
  };

  // The latest refresh function, read when the timer fires and not when it was made, so one timer serves every render.
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  useEffect(() => {
    if (!active) return;
    // A timer that sets the next one (not an interval); a read that is still out is never joined by another (the busy flag).
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!document.hidden) latest.current();
        schedule();
      }, jobRefreshMs);
    };
    const shown = () => {
      if (!document.hidden) latest.current();
    };
    schedule();
    document.addEventListener('visibilitychange', shown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [active]);

  return {pending, refresh};
}

/**
 * "Refresh now", a button with the automatic refresh behind it. While the work is open it says that the page updates by itself every 10 seconds; the button works either way
 * (a finished Job can be read again too). A press while a read is out does nothing, says so (aria-disabled, "Refreshing…") and is announced politely.
 */
export function JobRefresh({active, pending, onRefresh}: {active: boolean; pending: boolean; onRefresh: () => void}) {
  const {t} = useI18n();
  return (
    <div className="job-refresh">
      <Button variant="secondary" icon="activity" aria-disabled={pending ? true : undefined} onClick={() => !pending && onRefresh()}>
        {pending ? t('job.refreshing') : t('job.refresh')}
      </Button>
      <p className="auth-hint job-refresh-hint">{active ? t('job.list.updates', {seconds: jobRefreshSeconds}) : null}</p>
      <p className="auth-hint auth-status" role="status">{pending ? t('job.refreshing') : null}</p>
    </div>
  );
}
