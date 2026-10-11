'use client';

import {unstable_rethrow} from 'next/navigation';
import {useActionState, useEffect, useRef, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {unexpectedResponseMessage} from '@/lib/session-actions';
import {stepUpErrorKeys, stepUpIdle, type StepUpState} from '@/lib/step-up';
import {BrandMark} from './shell/brand';
import {Button, LinkButton} from './ui/button';
import {Notice} from './ui/states';
import {mainContentId} from './ui/skip-link';

export type StepUpAction = (previous: StepUpState) => Promise<StepUpState>;

/** Loads this page again, which asks the proxy afresh: it sends the person wherever they now belong. */
const reloadHere = () => window.location.assign(window.location.href);

/**
 * Calls the step-up action and reads what comes back.
 *
 *  - Going to Google (the action redirects) travels as a thrown error and is rethrown for Next.js to follow.
 *  - The one answer that is not the action's own is "an unexpected response": what a redirect by the proxy looks
 *    like to a Server Action, because this session no longer has access. Loading the page again lets the proxy
 *    say so. It happens at most once for each attempt, so it can never become a reload loop.
 *  - Anything else, a dropped connection or a real server error, is a failure to start: nothing is known to
 *    have changed, the person is told, and may try again.
 */
export async function attemptStepUp(action: StepUpAction, previous: StepUpState, navigate: () => void = reloadHere): Promise<StepUpState> {
  try {
    return await action(previous);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof Error && error.message === unexpectedResponseMessage) {
      navigate();
      return previous;
    }
    return {outcome: 'unavailable'};
  }
}

/**
 * The step-up page (Story 1.4b): a sensitive action needs the person to sign in with Google again, with the
 * same account. `start` is a Server Action with the action class already bound when the page rendered, so the
 * form has no field and nothing the person types says what it is for. The button goes to Google's account
 * chooser; "Not now" goes to the class's own return path (`cancelHref`, Settings for now). A second press while
 * one is running is ignored (a flag taken in the submit event itself, before React has re-rendered).
 *
 * The person may press Back from Google. A browser can then bring this page back exactly as it was left, with the
 * button still busy and its press flag still set, and nothing would ever finish them. A restored page
 * (`pageshow` with `persisted`) starts the form afresh.
 */
export function StepUpForm({start, cancelHref}: {start: StepUpAction; cancelHref: string}) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setGeneration((current) => current + 1);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  return <StepUpPanel key={generation} start={start} cancelHref={cancelHref}/>;
}

function StepUpPanel({start, cancelHref}: {start: StepUpAction; cancelHref: string}) {
  const {t} = useI18n();
  const running = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: StepUpState) => {
    try {
      return await attemptStepUp(start, previous);
    } finally {
      running.current = false;
    }
  }, stepUpIdle);
  const onSubmit = (event: {preventDefault(): void}) => {
    if (running.current || pending) {
      event.preventDefault();
      return;
    }
    running.current = true;
  };
  // The previous answer is not shown while a new attempt is under way.
  const error = !pending && state.outcome !== 'idle' ? stepUpErrorKeys[state.outcome] : null;

  return (
    <main id={mainContentId} tabIndex={-1} className="auth-shell">
      <section className="auth-card" aria-labelledby="step-up-title">
        <BrandMark/>
        <p className="eyebrow">{t('stepUp.eyebrow')}</p>
        <h1 id="step-up-title">{t('stepUp.title')}</h1>
        <p className="auth-lede">{t('stepUp.lede')}</p>
        {error ? <Notice tone="danger" role="alert">{t(error)}</Notice> : null}
        <form action={formAction} onSubmit={onSubmit} className="auth-form">
          <Button variant="primary" type="submit" className="auth-submit" aria-disabled={pending ? true : undefined}>{t('stepUp.continue')}</Button>
          <p className="auth-hint auth-status" role="status">{pending ? t('stepUp.pending') : null}</p>
        </form>
        <p className="auth-footnote">{t('stepUp.footnote')}</p>
        <div className="auth-switch">
          <LinkButton href={cancelHref} variant="quiet" prefetch={false}>{t('stepUp.cancel')}</LinkButton>
        </div>
      </section>
    </main>
  );
}
