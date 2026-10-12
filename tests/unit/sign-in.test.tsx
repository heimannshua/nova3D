import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {LoginForm} from '@/components/login-form';
import {locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {accountChooserParams, requestGoogleSignIn, signedOutPath, signInErrorCodes, signInErrorKey, signInErrorPath, signInNoticeCodes, signInNoticeKey, startGoogleSignIn, type OAuthClient} from '@/lib/sign-in';

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
  step_up_failed: 'login.error.step_up_failed',
};

// Names an attacker could put in ?error= to reach Object.prototype instead of a message.
const prototypeNames = ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf'];

describe('sign-in error codes (the ?error= query string)', () => {
  it('knows exactly the eight codes the sign-in routes, the proxy and the pages send back', () => {
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

    it.each(['auth_failed', 'not_allowed', 'auth_not_configured', 'not_signed_in', 'account_disabled', 'step_up_failed', 'bogus'])('is not offered for %s, which asking again cannot fix', (code) => {
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

  it('says in both languages that a step-up sign-in was not used, without saying why (it never tells a stranger which check failed)', () => {
    for (const locale of locales) {
      const text = translate(locale, 'login.error.step_up_failed');
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/mismatch|expired|replaced|nonce|session id|amr/i);
    }
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

describe.each(locales)('the way to Administrator recovery on the sign-in page in %s (Story 1.6)', (locale) => {
  const markup = render(locale);
  const link = /<a [^>]*href="\/recover"[^>]*>[\s\S]*?<\/a>/.exec(markup)?.[0];

  it('is a quiet link to /recover with words of its own, and not a second button', () => {
    expect(link).toBeDefined();
    expect(link).toContain(translate(locale, 'login.recover'));
    expect(link).toMatch(/class="[^"]*\bbtn-quiet\b[^"]*"/);
    expect(link).not.toMatch(/btn-primary|btn-secondary/);
    // Google stays the one button of the page.
    expect(markup.match(/<button\b/g)).toHaveLength(1);
  });

  it('comes after the Google button and the footnote, so it is the last thing a person reaches for', () => {
    expect(markup.indexOf(link!)).toBeGreaterThan(markup.indexOf(translate(locale, 'login.google')));
    expect(markup.indexOf(link!)).toBeGreaterThan(markup.indexOf(translate(locale, 'login.footnote')));
  });

  it('is shown with an error, with a notice and with neither', () => {
    for (const html of [render(locale, 'auth_failed'), render(locale, undefined, 'signed_out'), markup]) expect(html).toContain('href="/recover"');
  });

  it('promises nothing about what recovery does: the wording names no address and no Account', () => {
    expect(translate(locale, 'login.recover')).not.toMatch(/@|\{/);
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

describe('starting Google sign-in on the server (the step-up and "use a different Google account")', () => {
  const origin = 'http://127.0.0.1:4173';
  const client = (signInWithOAuth: OAuthClient['auth']['signInWithOAuth']): OAuthClient => ({auth: {signInWithOAuth}});
  const authorizeUrl = 'http://127.0.0.1:54321/auth/v1/authorize?provider=google&prompt=select_account';

  it('asks Google for its account chooser: prompt=select_account, and no login_hint', async () => {
    const signIn = vi.fn(async () => ({data: {url: authorizeUrl}, error: null}));
    expect(await requestGoogleSignIn(client(signIn), origin, {chooser: true})).toEqual({ok: true, url: authorizeUrl});
    expect(signIn).toHaveBeenCalledTimes(1);
    const [credentials] = signIn.mock.calls[0] as unknown as [{provider: string; options: {redirectTo: string; queryParams?: Record<string, string>}}];
    expect(credentials.provider).toBe('google');
    // The callback is exactly /auth/callback: a query string fails Auth's allow-list.
    expect(credentials.options.redirectTo).toBe('http://127.0.0.1:4173/auth/callback');
    expect(credentials.options.queryParams).toEqual({prompt: 'select_account'});
    expect(credentials.options.queryParams).not.toHaveProperty('login_hint');
    expect(accountChooserParams).toEqual({prompt: 'select_account'});
  });

  it('asks for no queryParams at all when the chooser is not wanted, the way the sign-in page does', async () => {
    const signIn = vi.fn(async () => ({data: {url: authorizeUrl}, error: null}));
    await requestGoogleSignIn(client(signIn), origin);
    expect(signIn).toHaveBeenCalledWith({provider: 'google', options: {redirectTo: `${origin}/auth/callback`}});
  });

  it('exports the chooser parameters frozen, so no caller can change what every later sign-in asks Google for', () => {
    expect(Object.isFrozen(accountChooserParams)).toBe(true);
    expect(() => {
      (accountChooserParams as {prompt: string}).prompt = 'none';
    }).toThrow(TypeError);
    expect(() => {
      (accountChooserParams as Record<string, string>).login_hint = 'x@example.com';
    }).toThrow(TypeError);
    expect(accountChooserParams).toEqual({prompt: 'select_account'});
  });

  it('keeps the shared parameter object from being changed by a caller', async () => {
    const signIn = vi.fn(async (_credentials: unknown) => ({data: {url: authorizeUrl}, error: null}));
    await requestGoogleSignIn(client(signIn), origin, {chooser: true});
    const sent = (signIn.mock.calls[0][0] as {options: {queryParams: Record<string, string>}}).options.queryParams;
    expect(sent).not.toBe(accountChooserParams);
  });

  it('fails with a catalog message, logging the provider error only, when there is no client, no URL, an error or an exception', async () => {
    const log = vi.fn();
    expect(await requestGoogleSignIn(null, origin, {chooser: true}, log)).toEqual({ok: false, error: 'login.error.auth_unavailable'});
    expect(await requestGoogleSignIn(client(async () => ({data: {url: null}, error: null})), origin, {chooser: true}, log)).toEqual({ok: false, error: 'login.error.startFailed'});
    expect(await requestGoogleSignIn(client(async () => ({data: null, error: {message: 'raw provider detail'}})), origin, {chooser: true}, log)).toEqual({ok: false, error: 'login.error.startFailed'});
    expect(await requestGoogleSignIn(client(async () => { throw new Error('network down'); }), origin, {chooser: true}, log)).toEqual({ok: false, error: 'login.error.startFailed'});
    expect(log).toHaveBeenCalledTimes(3);
  });
});
