'use client';

import {unstable_rethrow} from 'next/navigation';
import {useActionState, useEffect, useRef, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {
  recoverPath,
  recoveryLandingPath,
  recoveryRedeemIdle,
  recoveryRedeemKeys,
  tokenFromFragment,
  type RecoveryRedeemAction,
  type RecoveryRedeemState,
} from '@/lib/recovery-state';
import {BrandMark} from './shell/brand';
import {Button, LinkButton} from './ui/button';
import {Notice} from './ui/states';
import {mainContentId} from './ui/skip-link';

/**
 * Calls the redeem action and reads what comes back. A recovery that happened never answers: it redirects, which
 * travels as a thrown error and is rethrown for Next.js to follow. Any other failure, a dropped connection or a server
 * error, comes after the form was sent, so the recovery may have been made: the person is told to open Administration
 * (`unknown`) rather than to press the button again.
 */
export async function attemptRecoveryRedeem(action: RecoveryRedeemAction, previous: RecoveryRedeemState, formData: FormData): Promise<RecoveryRedeemState> {
  try {
    return await action(previous, formData);
  } catch (error) {
    unstable_rethrow(error);
    return {outcome: 'unknown'};
  }
}

/**
 * The confirmation page (Story 1.6, A-03). The mailed link is `/recover/confirm#<token>`: the token is in the fragment, so
 * it never reached the server that rendered this page, which is why opening the link (a mail scanner's GET, say) changes
 * nothing and sees nothing. THIS component reads the fragment in the browser, takes it out of the address bar (the
 * address is replaced without it, so it is not in the history or a copied link) and holds it in memory, in a hidden field
 * of the form whose one button POSTs it. It is never stored, logged or put in a cookie.
 *
 * What the person sees: the link is being read (before the browser has run this, and for good where there is no script,
 * which a `<noscript>` notice says), a link that cannot be used (no fragment, or one that is not a token, or one the server then
 * refused: one message for all of them, which also tells a person who reloaded the page that the emailed link, not a new one, is
 * what to open again), the form, and the two answers that leave the link usable or unknown (`unavailable`, `unknown`).
 *
 * The page is not kept as it was left: a restored page (`pageshow` with `persisted`, Back from Administration) starts
 * afresh, and the fragment is gone by then.
 */
export function RecoverConfirmForm({redeem}: {redeem: RecoveryRedeemAction}) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setGeneration((current) => current + 1);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  return <ConfirmPanel key={generation} redeem={redeem}/>;
}

function ConfirmPanel({redeem}: {redeem: RecoveryRedeemAction}) {
  const {t} = useI18n();
  // undefined: the browser has not read the address yet (and the server cannot know it). null: there is no usable token.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  // Read once: React runs an effect twice in development (Strict Mode), and the second run must not find the address
  // already cleared of the token the first run took.
  const read = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (read.current === undefined) {
      read.current = tokenFromFragment(window.location.hash);
      if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
    setToken(read.current);
  }, []);

  const running = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: RecoveryRedeemState, formData: FormData) => {
    try {
      return await attemptRecoveryRedeem(redeem, previous, formData);
    } finally {
      running.current = false;
    }
  }, recoveryRedeemIdle);
  const onSubmit = (event: {preventDefault(): void}) => {
    if (running.current || pending) {
      event.preventDefault();
      return;
    }
    running.current = true;
  };
  // The previous answer is not shown while a new attempt is under way.
  const answer = pending || state.outcome === 'idle' ? null : state;
  const unusable = token === null || answer?.outcome === 'invalid';
  const unknown = answer?.outcome === 'unknown';

  return (
    <main id={mainContentId} tabIndex={-1} className="auth-shell">
      <section className="auth-card" aria-labelledby="recover-confirm-title">
        <BrandMark/>
        <p className="eyebrow">{t('recoverConfirm.eyebrow')}</p>
        <h1 id="recover-confirm-title">{t('recoverConfirm.title')}</h1>
        {unusable ? (
          <>
            <Notice tone="danger" role={answer ? 'alert' : undefined}>
              <strong>{t('recoverConfirm.invalid.title')}</strong> {t(recoveryRedeemKeys.invalid)}
            </Notice>
            <div className="auth-switch">
              <LinkButton href={recoverPath} variant="primary" prefetch={false}>{t('recoverConfirm.newLink')}</LinkButton>
            </div>
          </>
        ) : unknown ? (
          <>
            <Notice tone="warning" role="alert">{t(recoveryRedeemKeys.unknown)}</Notice>
            <div className="auth-switch">
              <LinkButton href={recoveryLandingPath} variant="primary" prefetch={false}>{t('recoverConfirm.openAdmin')}</LinkButton>
            </div>
          </>
        ) : (
          <>
            <p className="auth-lede">{t('recoverConfirm.lede')}</p>
            {answer?.outcome === 'unavailable' ? <Notice tone="danger" role="alert">{t(recoveryRedeemKeys.unavailable)}</Notice> : null}
            {/* The button waits for script to read the link, so without script it would say "Reading the link…" for ever. */}
            <noscript><Notice tone="warning">{t('recoverConfirm.noscript')}</Notice></noscript>
            <form action={formAction} onSubmit={onSubmit} className="auth-form">
              {typeof token === 'string' ? <input type="hidden" name="token" value={token}/> : null}
              <Button variant="primary" type="submit" className="auth-submit" disabled={typeof token !== 'string'} aria-disabled={pending ? true : undefined}>
                {t('recoverConfirm.confirm')}
              </Button>
              <p className="auth-hint auth-status" role="status">{pending ? t('recoverConfirm.pending') : typeof token !== 'string' ? t('recoverConfirm.checking') : null}</p>
            </form>
            <p className="auth-footnote">{t('recoverConfirm.footnote')}</p>
          </>
        )}
      </section>
    </main>
  );
}
