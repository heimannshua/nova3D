'use client';

import {FormEvent, useState} from 'react';
import {useRouter} from 'next/navigation';
import {createBrowserClient} from '@supabase/ssr';

const errorMessages: Record<string, string> = {
  auth_unavailable: 'Google sign-in is not configured yet. Use the interim password below.',
  auth_failed: 'Google sign-in could not be completed. Try again.',
  not_allowed: 'That Google account is not on the nova3D access list.',
  interim_required: 'Enter the temporary preview password to continue.',
};

function getBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createBrowserClient(url, key) : null;
}

export function LoginForm({initialError}: {initialError?: string}) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError ? errorMessages[initialError] || 'Sign-in could not be completed.' : '');
  const [busy, setBusy] = useState(false);
  const [googleAvailable] = useState(() => Boolean(getBrowserClient()));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const response = await fetch('/api/auth/interim', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({password})});
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as {error?: string} | null;
      setError(payload?.error || 'The interim password was rejected.');
      setBusy(false);
      return;
    }
    router.push('/');
  }

  async function signInWithGoogle() {
    const client = getBrowserClient();
    if (!client) {
      setError('Google sign-in is not configured yet. Use the interim password below.');
      return;
    }
    setBusy(true);
    const {error: signInError} = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {redirectTo: `${window.location.origin}/auth/callback`},
    });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>nova<span className="brand-accent">3D</span></span></div>
        <p className="eyebrow">Private preview</p>
        <h1 id="login-title">Sign in to nova3D</h1>
        <p className="auth-lede">The workspace is private while Google authentication is being connected.</p>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="button button-primary auth-google" type="button" onClick={signInWithGoogle} disabled={busy || !googleAvailable}>
          Continue with Google
        </button>
        {!googleAvailable ? <p className="auth-hint">Google sign-in will appear after the Supabase project is resumed and configured.</p> : null}
        <div className="auth-divider"><span>temporary access</span></div>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="interim-password">Interim password</label>
          <input id="interim-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button className="button auth-submit" type="submit" disabled={busy || !password}>{busy ? 'Checking…' : 'Enter preview'}</button>
        </form>
        <p className="auth-footnote">Access is limited to the invited Google accounts once provider setup is complete.</p>
      </section>
    </main>
  );
}
