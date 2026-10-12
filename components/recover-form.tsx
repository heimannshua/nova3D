'use client';

import {unstable_rethrow} from 'next/navigation';
import {useActionState, useEffect, useRef, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {recoveryRequestIdle, recoveryRequestKeys, type RecoveryRequestAction, type RecoveryRequestState} from '@/lib/recovery-state';
import {BrandMark} from './shell/brand';
import {Button, LinkButton} from './ui/button';
import {Notice} from './ui/states';
import {mainContentId} from './ui/skip-link';

/**
 * Calls the request action and reads what comes back. A control-flow throw (a redirect) is rethrown for Next.js to
 * follow. Anything else, a dropped connection or a server error, is a failure to ask: nothing is known to have been
 * issued, the person is told, and may try again.
 */
export async function attemptRecoveryRequest(action: RecoveryRequestAction, previous: RecoveryRequestState): Promise<RecoveryRequestState> {
  try {
    return await action(previous);
  } catch (error) {
    unstable_rethrow(error);
    return {outcome: 'unavailable'};
  }
}

/**
 * The Recover page (Story 1.6, A-03): one button and no input. It asks the server to email a one-time link to the
 * Administrator's own address, and says only `sent`, `limited` or `unavailable`: never an address, a name or anything of
 * anyone's projects. A second press while one is running is ignored (a flag taken in the submit event itself, before React
 * has re-rendered). Once a link is sent the button is gone: the page says so and offers the way back; another request is
 * a reload away, and the limits decide.
 *
 * A browser can bring the page back exactly as it was left (Back from the mail provider, say) with the button still busy.
 * A restored page (`pageshow` with `persisted`) starts the form afresh.
 */
export function RecoverForm({request}: {request: RecoveryRequestAction}) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setGeneration((current) => current + 1);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  return <RecoverPanel key={generation} request={request}/>;
}

function RecoverPanel({request}: {request: RecoveryRequestAction}) {
  const {t} = useI18n();
  const running = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: RecoveryRequestState) => {
    try {
      return await attemptRecoveryRequest(request, previous);
    } finally {
      running.current = false;
    }
  }, recoveryRequestIdle);
  const onSubmit = (event: {preventDefault(): void}) => {
    if (running.current || pending) {
      event.preventDefault();
      return;
    }
    running.current = true;
  };
  // The previous answer is not shown while a new attempt is under way.
  const shown = pending || state.outcome === 'idle' ? null : state;
  const sent = shown?.outcome === 'sent';

  return (
    <main id={mainContentId} tabIndex={-1} className="auth-shell">
      <section className="auth-card" aria-labelledby="recover-title">
        <BrandMark/>
        <p className="eyebrow">{t('recover.eyebrow')}</p>
        <h1 id="recover-title">{t('recover.title')}</h1>
        <p className="auth-lede">{t('recover.lede')}</p>
        {shown?.outcome === 'sent' ? <Notice tone="success" role="status">{t(recoveryRequestKeys.sent)}</Notice> : null}
        {shown && shown.outcome !== 'sent' ? <Notice tone="danger" role="alert">{t(recoveryRequestKeys[shown.outcome])}</Notice> : null}
        {sent ? null : (
          <form action={formAction} onSubmit={onSubmit} className="auth-form">
            <Button variant="primary" type="submit" className="auth-submit" aria-disabled={pending ? true : undefined}>{t('recover.send')}</Button>
            <p className="auth-hint auth-status" role="status">{pending ? t('recover.pending') : null}</p>
          </form>
        )}
        <p className="auth-footnote">{t('recover.footnote')}</p>
        <div className="auth-switch">
          <LinkButton href="/login" variant="quiet" prefetch={false}>{t('recover.back')}</LinkButton>
        </div>
      </section>
    </main>
  );
}
