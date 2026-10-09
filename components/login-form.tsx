'use client';

import {useState} from 'react';
import {createBrowserClient} from '@supabase/ssr';
import {useI18n} from '@/lib/i18n/react';
import {signInErrorKey, startGoogleSignIn} from '@/lib/sign-in';
import type {MessageKey} from '@/lib/i18n';
import {BrandMark} from './shell/brand';
import {Button} from './ui/button';
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

export function LoginForm({initialError}: {initialError?: string}) {
  const {t} = useI18n();
  // The error is kept as a catalog key, not as text, so it follows the language if that changes.
  const [error, setError] = useState<MessageKey | null>(() => signInErrorKey(initialError));
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
        {error ? <Notice tone="danger" role="alert">{t(error)}</Notice> : null}
        <Button variant="primary" className="auth-google" onClick={signInWithGoogle} disabled={busy || !googleAvailable}>
          {t('login.google')}
        </Button>
        {!googleAvailable ? <p className="auth-hint">{t('login.notConfigured')}</p> : null}
        <p className="auth-footnote">{t('login.footnote')}</p>
      </section>
    </main>
  );
}
