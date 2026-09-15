'use client';

import {useState} from 'react';
import {createBrowserClient} from '@supabase/ssr';

const errorMessages: Record<string, string> = {
  auth_unavailable: 'Google sign-in is not configured for this environment yet.',
  auth_failed: 'Google sign-in could not be completed. Try again.',
  not_allowed: 'That Google account is not on the nova3D access list.',
  auth_not_configured: 'Google sign-in is not configured for this environment yet.',
  not_signed_in: 'Sign in with an invited Google account to continue.',
};

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
  const [error, setError] = useState(initialError ? errorMessages[initialError] || 'Sign-in could not be completed.' : '');
  const [busy, setBusy] = useState(false);
  const [googleAvailable] = useState(() => Boolean(getBrowserClient()));

  async function signInWithGoogle() {
    const client = getBrowserClient();
    if (!client) {
      setError('Google sign-in is not configured for this environment yet.');
      return;
    }
    setBusy(true);
    try {
      const {error: signInError} = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {redirectTo: `${window.location.origin}/auth/callback`},
      });
      if (signInError) {
        setError(signInError.message);
        setBusy(false);
      }
    } catch {
      setError('Google sign-in could not be started. Try again.');
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>nova<span className="brand-accent">3D</span></span></div>
        <p className="eyebrow">Private preview</p>
        <h1 id="login-title">Sign in to nova3D</h1>
        <p className="auth-lede">Sign in with your invited Google account to access the private workspace.</p>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="button button-primary auth-google" type="button" onClick={signInWithGoogle} disabled={busy || !googleAvailable}>
          Continue with Google
        </button>
        {!googleAvailable ? <p className="auth-hint">Google sign-in is not configured for this environment.</p> : null}
        <p className="auth-footnote">Access is limited to invited Google accounts.</p>
      </section>
    </main>
  );
}
