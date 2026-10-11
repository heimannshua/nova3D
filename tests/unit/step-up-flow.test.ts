import {createServerClient} from '@supabase/ssr';
import {describe, expect, it} from 'vitest';
import {requestGoogleSignIn} from '@/lib/sign-in';
import {
  challengeOfAuthorizeUrl,
  challengeOfVerifier,
  hashStepUpSecret,
  isStepUpSecret,
  newStepUpSecret,
  stepUpCookieMaxAge,
  stepUpCookieName,
  verifierOfCookie,
} from '@/lib/step-up-flow';
import {authCookieBase} from '@/lib/supabase/sign-out';

// The secrets and hashes of a step-up (Story 1.4b), and, against the REAL @supabase/ssr and auth-js that are
// installed, the one thing the verifier binding depends on: that the PKCE verifier a sign-in leaves in the
// browser can be read back, and hashes to the challenge in the URL the browser was sent to.

describe('the step-up secret', () => {
  it('is 256 random bits as 43 URL-safe characters, different every time', () => {
    const secrets = new Set(Array.from({length: 200}, () => newStepUpSecret()));
    expect(secrets.size).toBe(200);
    for (const secret of secrets) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isStepUpSecret(secret)).toBe(true);
    }
  });

  it('is recognised by shape only, and anything else is not a secret this module issued', () => {
    for (const value of [undefined, null, 42, '', 'short', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)}=`, `${'x'.repeat(42)} `, `${'x'.repeat(42)}/`]) {
      expect(isStepUpSecret(value), String(value)).toBe(false);
    }
  });

  it('is stored as a hex SHA-256 under a domain label, so the stored value is not the cookie and not a bare hash of it', () => {
    const secret = newStepUpSecret();
    const hash = hashStepUpSecret(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashStepUpSecret(secret));
    expect(hash).not.toBe(hashStepUpSecret(newStepUpSecret()));
    expect(hash).not.toContain(secret);
  });

  it('lives in an httpOnly-style cookie for the nonce\'s own 10 minutes', () => {
    expect(stepUpCookieName).toBe('nova3d-step-up');
    expect(stepUpCookieMaxAge).toBe(600);
  });
});

describe('the PKCE binding', () => {
  // RFC 7636, appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('computes the S256 challenge of a verifier (the RFC 7636 test vector)', () => {
    expect(challengeOfVerifier(verifier)).toBe(challenge);
  });

  it('reads the challenge out of an authorize URL, only if it is S256 and the right shape', () => {
    const url = (params: Record<string, string>) => `http://127.0.0.1:54321/auth/v1/authorize?${new URLSearchParams(params)}`;
    expect(challengeOfAuthorizeUrl(url({provider: 'google', code_challenge: challenge, code_challenge_method: 's256'}))).toBe(challenge);
    expect(challengeOfAuthorizeUrl(url({code_challenge: challenge, code_challenge_method: 'S256'}))).toBe(challenge);
    // `plain` would make the challenge the verifier itself; nothing is bound to it.
    expect(challengeOfAuthorizeUrl(url({code_challenge: challenge, code_challenge_method: 'plain'}))).toBeNull();
    expect(challengeOfAuthorizeUrl(url({code_challenge: verifier + verifier, code_challenge_method: 's256'}))).toBeNull();
    expect(challengeOfAuthorizeUrl(url({code_challenge: 'short', code_challenge_method: 's256'}))).toBeNull();
    expect(challengeOfAuthorizeUrl(url({code_challenge_method: 's256'}))).toBeNull();
    expect(challengeOfAuthorizeUrl(url({code_challenge: challenge}))).toBeNull();
    expect(challengeOfAuthorizeUrl('not a url')).toBeNull();
    expect(challengeOfAuthorizeUrl('')).toBeNull();
  });
});

describe('reading the PKCE verifier cookie', () => {
  const verifier = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const encoded = (text: string) => `base64-${Buffer.from(text).toString('base64url')}`;

  it('reads the JSON text Auth\'s storage writes, bare or in the base64- encoding the cookie adapter uses', () => {
    expect(verifierOfCookie(JSON.stringify(verifier))).toBe(verifier);
    expect(verifierOfCookie(encoded(JSON.stringify(verifier)))).toBe(verifier);
  });

  it('drops a /recovery suffix, which is not part of the verifier', () => {
    expect(verifierOfCookie(JSON.stringify(`${verifier}/recovery`))).toBe(verifier);
  });

  it.each([undefined, '', 'base64-', 'base64-!!!', 'not json', '{"a":1}', '42', 'null', JSON.stringify(''), JSON.stringify(['x']), encoded('not json'), encoded('{"a":1}')])(
    'reads nothing from %j',
    (raw) => {
      expect(verifierOfCookie(raw)).toBeNull();
    },
  );
});

describe('against the real @supabase/ssr and auth-js', () => {
  const SUPABASE = 'http://127.0.0.1:54321';

  async function startFlow() {
    const jar = new Map<string, string>();
    const client = createServerClient(SUPABASE, 'anon-key', {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({name, value})),
        setAll: (cookies) => {
          for (const {name, value} of cookies) {
            if (value === '') jar.delete(name);
            else jar.set(name, value);
          }
        },
      },
    });
    const result = await requestGoogleSignIn(client, 'http://127.0.0.1:4173', {chooser: true});
    return {jar, result};
  }

  it('leaves a verifier in the cookie that hashes to the challenge in the URL (so the binding can be checked at the callback)', async () => {
    const {jar, result} = await startFlow();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cookie = jar.get(`${authCookieBase(SUPABASE)}-code-verifier`);
    expect(cookie, 'the fixed code-verifier cookie').toBeDefined();
    const verifier = verifierOfCookie(cookie);
    expect(verifier).toMatch(/^[0-9a-f]{112}$/);
    const challenge = challengeOfAuthorizeUrl(result.url);
    expect(challenge).not.toBeNull();
    expect(challengeOfVerifier(verifier!)).toBe(challenge);
  });

  it('builds the authorize URL the step-up needs: Google, the chooser, the callback exactly, an S256 challenge, no login_hint', async () => {
    const {result} = await startFlow();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.url);
    expect(url.origin + url.pathname).toBe(`${SUPABASE}/auth/v1/authorize`);
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.has('login_hint')).toBe(false);
    expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:4173/auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
  });

  it('starts a different flow, with a different verifier and challenge, every time', async () => {
    const first = await startFlow();
    const second = await startFlow();
    if (!first.result.ok || !second.result.ok) throw new Error('could not start');
    expect(challengeOfAuthorizeUrl(first.result.url)).not.toBe(challengeOfAuthorizeUrl(second.result.url));
  });
});
