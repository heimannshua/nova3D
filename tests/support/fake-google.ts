import type {Page} from '@playwright/test';

// The test side of tests/support/fake-google.mjs (Story 1.4b): is the fake Google running behind the stack's Auth
// container, register the Google accounts a test signs in with, read what the application asked Google for, and
// click through its account chooser. It is started and wired in by `npm run fake-google:up`
// (scripts/fake-google-stack.mjs), which swaps ONLY the stack's Auth container; without that the specs that
// need it are skipped locally, and fail in CI, where a missing swap must not pass for a green run.

export const fakeGoogleBase = 'http://127.0.0.1:9099';

export type FakeRequest = {state: string | null; prompt: string | null; loginHint: string | null; picked: string | null; chooser: boolean};

/**
 * Whether the step-up flows can run: the fake answers AND the stack's Auth is really swapped to use it. Both are
 * proved: Auth must answer an authorize request for Google with a redirect to the fake's chooser. A stack that was
 * restarted after `npm run fake-google:up` still has a fake running but a plain Auth, and the specs then skip
 * cleanly instead of failing in ways that look like bugs.
 */
export async function fakeGoogleActive(apiUrl: string, base: string = fakeGoogleBase): Promise<boolean> {
  try {
    const health = await fetch(`${base}/__control/health`, {signal: AbortSignal.timeout(2000)});
    if (!health.ok || (await health.json()).ok !== true) return false;
    const url = new URL('/auth/v1/authorize', apiUrl);
    url.searchParams.set('provider', 'google');
    url.searchParams.set('redirect_to', 'http://127.0.0.1:4173/auth/callback');
    url.searchParams.set('code_challenge', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    url.searchParams.set('code_challenge_method', 's256');
    const authorize = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(5000)});
    return authorize.status === 302 && (authorize.headers.get('location') ?? '').startsWith(`${base}/o/oauth2/v2/auth`);
  } catch {
    return false;
  }
}

/** Makes the Google account known to the fake, so it appears in the chooser. */
export async function addFakeAccount(account: {email: string; sub: string; name?: string}) {
  const response = await fetch(`${fakeGoogleBase}/__control/accounts`, {method: 'POST', body: JSON.stringify(account), signal: AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error(`The fake Google refused the account (HTTP ${response.status}).`);
}

/** What Google was asked for, by the sign-ins that ended with this account chosen. */
export async function requestsFor(email: string): Promise<FakeRequest[]> {
  const response = await fetch(`${fakeGoogleBase}/__control/requests`, {signal: AbortSignal.timeout(5000)});
  return ((await response.json()) as FakeRequest[]).filter((request) => request.picked === email);
}

/** The chooser page is on screen. */
export const chooserUrl = new RegExp(`^${fakeGoogleBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/o/oauth2/v2/auth\\?`);

/** The link for one account in the chooser. */
export const chooserAccount = (page: Page, email: string) => page.locator(`a[data-account="${email}"]`);
