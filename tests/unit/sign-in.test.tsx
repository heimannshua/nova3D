import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {LoginForm} from '@/components/login-form';
import {locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {signedOutPath, signInErrorCodes, signInErrorKey, signInErrorPath, signInNoticeCodes, signInNoticeKey, startGoogleSignIn, type OAuthClient} from '@/lib/sign-in';

const render = (locale: Locale, initialError?: string, initialNotice?: string) => renderToStaticMarkup(<I18nProvider locale={locale}><LoginForm initialError={initialError} initialNotice={initialNotice}/></I18nProvider>);
const alertText = (markup: string) => /<div class="notice notice-danger" role="alert">[\s\S]*?<p class="notice-text">([^<]*)<\/p>/.exec(markup)?.[1];

const expectedKey: Record<string, MessageKey> = {
  auth_unavailable: 'login.error.auth_unavailable',
  auth_failed: 'login.error.auth_failed',
  not_allowed: 'login.error.not_allowed',
  auth_not_configured: 'login.error.auth_not_configured',
  not_signed_in: 'login.error.not_signed_in',
  session_ended: 'login.error.session_ended',
  account_disabled: 'login.error.account_disabled',
};

// Names an attacker could put in ?error= to reach Object.prototype instead of a message.
const prototypeNames = ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf'];

describe('sign-in error codes (the ?error= query string)', () => {
  it('knows exactly the seven codes the sign-in routes, the proxy and the pages send back', () => {
    expect([...signInErrorCodes].sort()).toEqual(Object.keys(expectedKey).sort());
  });

  describe.each(locales)('in %s', (locale) => {
    it.each(Object.entries(expectedKey))('shows the localized message for %s', (code, key) => {
      const markup = render(locale, code);
      expect(alertText(markup)).toBe(translate(locale, key));
      expect(markup).toContain('role="alert"');
    });

    it.each(['bogus', '', ' ', 'AUTH_FAILED', 'auth_failed ', ...prototypeNames])('shows the unknown-error message for the code %j without throwing', (code) => {
      const markup = render(locale, code);
      if (code === '') {
        // No code at all means no error to show.
        expect(markup).not.toContain('role="alert"');
      } else {
        expect(alertText(markup)).toBe(translate(locale, 'login.error.unknown'));
      }
    });

    it('shows no error when there is no code', () => {
      expect(render(locale)).not.toContain('role="alert"');
    });
  });

  describe.each(locales)('the retry link in %s', (locale) => {
    const retry = (markup: string) => /<a [^>]*href="\/"[^>]*>[\s\S]*?<\/a>/.exec(markup)?.[0];

    it('is offered when the check could not be made: the session was kept, so asking Home again is the retry', () => {
      const link = retry(render(locale, 'auth_unavailable'));
      expect(link).toContain(translate(locale, 'login.retry'));
      expect(link).not.toContain('<a href="/login');
    });

    it.each(['auth_failed', 'not_allowed', 'auth_not_configured', 'not_signed_in', 'account_disabled', 'bogus'])('is not offered for %s, which asking again cannot fix', (code) => {
      expect(retry(render(locale, code))).toBeUndefined();
    });

    it('is not offered when there is no error', () => {
      expect(retry(render(locale))).toBeUndefined();
    });
  });

  describe.each(locales)('the signed-out notice in %s', (locale) => {
    const noticeText = (markup: string) => /<div class="notice notice-info" role="status">[\s\S]*?<p class="notice-text">([^<]*)<\/p>/.exec(markup)?.[1];

    it('says the person has been signed out, as a notice and not as an alert', () => {
      const markup = render(locale, undefined, 'signed_out');
      expect(noticeText(markup)).toBe(translate(locale, 'login.notice.signed_out'));
      expect(markup).not.toContain('role="alert"');
    });

    it.each(['bogus', '', 'SIGNED_OUT', 'constructor', '__proto__'])('shows nothing for the unknown notice %j', (code) => {
      expect(noticeText(render(locale, undefined, code))).toBeUndefined();
      expect(render(locale, undefined, code)).not.toContain('role="status"');
    });

    it('gives way to an error: a failure is never shown beside a "signed out" that did not happen', () => {
      const markup = render(locale, 'auth_failed', 'signed_out');
      expect(noticeText(markup)).toBeUndefined();
      expect(alertText(markup)).toBe(translate(locale, 'login.error.auth_failed'));
    });
  });

  it('knows its notices by own property only, and builds the path of a deliberate sign-out in one place', () => {
    expect(signInNoticeCodes).toEqual(['signed_out']);
    expect(signInNoticeKey('signed_out')).toBe('login.notice.signed_out');
    for (const code of [undefined, '', 'nope', ...prototypeNames]) expect(signInNoticeKey(code)).toBeNull();
    expect(signedOutPath).toBe('/login?notice=signed_out');
  });

  it('builds the path every redirect uses from the code, so no caller spells the query string itself', () => {
    for (const code of signInErrorCodes) expect(signInErrorPath(code as never)).toBe(`/login?error=${code}`);
  });

  it('tells a person who is turned away, or whose Account is disabled, to contact the instance operator', () => {
    for (const key of ['login.error.account_disabled', 'login.error.not_allowed'] as const) {
      expect(translate('en', key), key).toMatch(/operator of this nova3D instance/);
      expect(translate('he', key), key).toMatch(/מפעיל המופע של nova3D/);
    }
  });

  it('maps every own code, falls back for anything else, and never reads the prototype', () => {
    for (const [code, key] of Object.entries(expectedKey)) expect(signInErrorKey(code)).toBe(key);
    for (const code of ['nope', ...prototypeNames]) expect(signInErrorKey(code)).toBe('login.error.unknown');
    expect(signInErrorKey(undefined)).toBeNull();
    expect(signInErrorKey('')).toBeNull();
  });
});

describe('starting Google sign-in', () => {
  const origin = 'http://127.0.0.1:4173';
  const client = (signInWithOAuth: OAuthClient['auth']['signInWithOAuth']): OAuthClient => ({auth: {signInWithOAuth}});

  it('asks for Google with the callback on this origin, and shows nothing when it is under way', async () => {
    const signIn = vi.fn(async () => ({error: null}));
    expect(await startGoogleSignIn(client(signIn), origin)).toBeNull();
    expect(signIn).toHaveBeenCalledWith({provider: 'google', options: {redirectTo: `${origin}/auth/callback`}});
  });

  it('reports that sign-in is not configured when there is no client', async () => {
    expect(await startGoogleSignIn(null, origin)).toBe('login.error.auth_unavailable');
  });

  it.each(locales)('shows only the localized message, and logs the provider error, when the provider refuses (%s)', async (locale) => {
    const log = vi.fn();
    const providerError = {message: 'Provider said: raw English detail'};
    const key = await startGoogleSignIn(client(async () => ({error: providerError})), origin, log);
    expect(key).toBe('login.error.startFailed');
    expect(log).toHaveBeenCalledWith(expect.any(String), providerError);
    expect(translate(locale, key!)).not.toContain('raw English detail');
  });

  it('shows the same message, and logs, when the call throws', async () => {
    const log = vi.fn();
    const thrown = new Error('network down');
    expect(await startGoogleSignIn(client(async () => { throw thrown; }), origin, log)).toBe('login.error.startFailed');
    expect(log).toHaveBeenCalledWith(expect.any(String), thrown);
  });

  it('logs to console.error by default', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await startGoogleSignIn(client(async () => ({error: {message: 'x'}})), origin);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
