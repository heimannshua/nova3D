'use client';

import {useState} from 'react';
import {createBrowserClient} from '@supabase/ssr';
import {useI18n} from '@/lib/i18n/react';
import {recoverPath} from '@/lib/recovery-state';
import {signInErrorKey, signInNoticeKey, startGoogleSignIn} from '@/lib/sign-in';
import type {MessageKey} from '@/lib/i18n';
import {LoginPreferences} from './login-preferences';
import {BrandMark} from './shell/brand';
import {Button, LinkButton} from './ui/button';
import {Notice} from './ui/states';
import {mainContentId} from './ui/skip-link';

function getBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    return createBrowserClient(url, key);
  } catch {
    return null;
  }
}

export function LoginForm({initialError, initialNotice}: {initialError?: string; initialNotice?: string}) {
  const {t} = useI18n();
  // The error is kept as a catalog key, not as text, so it follows the language if that changes.
  const [error, setError] = useState<MessageKey | null>(() => signInErrorKey(initialError));
  // A notice reports something that worked (a deliberate sign-out), so it is not an error and never an alert.
  const notice = signInNoticeKey(initialNotice);
  const [busy, setBusy] = useState(false);
  const [googleAvailable] = useState(() => Boolean(getBrowserClient()));

  async function signInWithGoogle() {
    setBusy(true);
    const failure = await startGoogleSignIn(getBrowserClient(), window.location.origin);
    if (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <main id={mainContentId} tabIndex={-1} className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <BrandMark/>
        <p className="eyebrow">{t('login.eyebrow')}</p>
        <h1 id="login-title">{t('login.title')}</h1>
        <p className="auth-lede">{t('login.lede')}</p>
        {notice && !error ? <Notice tone="info" role="status">{t(notice)}</Notice> : null}
        {error ? (
          <Notice
            tone="danger"
            role="alert"
            // A check that could not be made keeps the session, so asking again at Home is the retry.
            action={error === 'login.error.auth_unavailable' ? <LinkButton href="/" variant="secondary" prefetch={false}>{t('login.retry')}</LinkButton> : undefined}
          >
            {t(error)}
          </Notice>
        ) : null}
        <Button variant="primary" className="auth-google" onClick={signInWithGoogle} disabled={busy || !googleAvailable}>
          {t('login.google')}
        </Button>
        {!googleAvailable ? <p className="auth-hint">{t('login.notConfigured')}</p> : null}
        <p className="auth-footnote">{t('login.footnote')}</p>
        {/* The one way back in without Google, for the Administrator alone (Story 1.6): quiet, because it is almost never needed. */}
        <div className="auth-switch">
          <LinkButton href={recoverPath} variant="quiet" prefetch={false}>{t('login.recover')}</LinkButton>
        </div>
        <LoginPreferences/>
      </section>
    </main>
  );
}
