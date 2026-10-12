import {redirect} from 'next/navigation';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {attemptRecoveryRedeem, RecoverConfirmForm} from '@/components/recover-confirm-form';
import {attemptRecoveryRequest, RecoverForm} from '@/components/recover-form';
import {locales, translate, type Locale} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {recoveryRedeemIdle, recoveryRequestIdle, type RecoveryRedeemAction, type RecoveryRequestAction} from '@/lib/recovery-state';

// The two recovery pages' forms (Story 1.6) rendered to markup, which is what the server sends before the browser has run
// anything, and the two functions that read what an action answers. What needs a browser (the token read from the address and
// taken out of it, the focus, the live regions, the real actions) is in tests/e2e/recovery.spec.ts and recovery-pages.spec.ts.
const request: RecoveryRequestAction = async () => ({outcome: 'sent'});
const redeem: RecoveryRedeemAction = async () => ({outcome: 'invalid'});
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const renderRequest = (locale: Locale) => renderToStaticMarkup(<I18nProvider locale={locale}><RecoverForm request={request}/></I18nProvider>);
const renderConfirm = (locale: Locale) => renderToStaticMarkup(<I18nProvider locale={locale}><RecoverConfirmForm redeem={redeem}/></I18nProvider>);

describe.each(locales)('the Recover page in %s', (locale) => {
  const markup = renderRequest(locale);

  it('has one level-one heading that names the page, in a section it labels', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<section[^>]*aria-labelledby="recover-title"/);
    expect(markup).toMatch(/<h1 id="recover-title">/);
    expect(text(markup)).toContain(translate(locale, 'recover.title'));
    expect(text(markup)).toContain(translate(locale, 'recover.lede'));
    expect(text(markup)).toContain(translate(locale, 'recover.footnote'));
  });

  it('has one button and no input: nothing a visitor types is an address, a recipient or an Account', () => {
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<button[^>]*type="submit"/);
    expect(text(markup)).toContain(translate(locale, 'recover.send'));
    expect(markup).not.toMatch(/<input\b|<textarea\b|<select\b/);
  });

  it('has a way back to sign-in that is a link', () => {
    expect(markup).toMatch(/<a [^>]*href="\/login"[^>]*>/);
    expect(text(markup)).toContain(translate(locale, 'recover.back'));
  });

  it('shows no answer before there is one, and announces progress through a status region', () => {
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('notice');
    expect(markup).toMatch(/<p class="auth-hint auth-status" role="status"><\/p>/);
  });

  it('says nothing of an address, a name or a Workspace', () => {
    expect(text(markup)).not.toMatch(/@/);
  });
});

describe.each(locales)('the confirmation page in %s, as the server sends it (before the browser has read the link)', (locale) => {
  const markup = renderConfirm(locale);

  it('has one level-one heading that names the page, and says what confirming does', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<section[^>]*aria-labelledby="recover-confirm-title"/);
    expect(text(markup)).toContain(translate(locale, 'recoverConfirm.title'));
    expect(text(markup)).toContain(translate(locale, 'recoverConfirm.lede'));
    expect(text(markup)).toContain(translate(locale, 'recoverConfirm.footnote'));
  });

  it('knows no token, because a fragment never reaches the server: no field holds one, and the button waits for the browser', () => {
    expect(markup).not.toMatch(/<input\b/);
    expect(markup).not.toContain('name="token"');
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(text(markup)).toContain(translate(locale, 'recoverConfirm.checking'));
    expect(text(markup)).toContain(translate(locale, 'recoverConfirm.confirm'));
  });

  it('says in a noscript notice that confirming needs script, which only a browser without script ever shows', () => {
    const notice = /<noscript>([\s\S]*?)<\/noscript>/.exec(markup)?.[1];
    expect(notice).toBeDefined();
    expect(notice).toContain('notice-warning');
    expect(text(notice!)).toContain(translate(locale, 'recoverConfirm.noscript'));
    // It is the form's only notice, and it sits beside the button it explains.
    expect(markup.match(/class="notice /g)).toHaveLength(1);
    expect(markup.indexOf('<noscript>')).toBeLessThan(markup.indexOf('<form'));
    expect(text(markup.replace(/<noscript>[\s\S]*?<\/noscript>/, ''))).not.toContain(translate(locale, 'recoverConfirm.noscript'));
  });

  it('shows no answer, no error and no link that cannot be used before there is anything to say', () => {
    expect(markup).not.toContain('role="alert"');
    expect(markup.replace(/<noscript>[\s\S]*?<\/noscript>/, '')).not.toContain('notice');
    expect(text(markup)).not.toContain(translate(locale, 'recoverConfirm.invalid.title'));
  });

  it('is the same markup whatever the address held, so the browser\'s first render matches: it is a pure function of the language', () => {
    expect(renderConfirm(locale)).toBe(markup);
  });
});

describe('attemptRecoveryRequest', () => {
  it('passes the action\'s own answer through', async () => {
    const limited = {outcome: 'limited'} as const;
    expect(await attemptRecoveryRequest(async () => limited, recoveryRequestIdle)).toBe(limited);
  });

  it('says unavailable, and nothing else, when the connection drops or the server fails', async () => {
    expect(await attemptRecoveryRequest(async () => { throw new TypeError('Failed to fetch'); }, recoveryRequestIdle)).toEqual({outcome: 'unavailable'});
    expect(await attemptRecoveryRequest(async () => { throw new Error('Internal Server Error'); }, recoveryRequestIdle)).toEqual({outcome: 'unavailable'});
  });

  it('rethrows a redirect for Next.js to follow', async () => {
    let thrown: unknown;
    try {
      redirect('/somewhere');
    } catch (error) {
      thrown = error;
    }
    await expect(attemptRecoveryRequest(async () => { throw thrown; }, recoveryRequestIdle)).rejects.toBe(thrown);
  });
});

describe('attemptRecoveryRedeem', () => {
  const form = () => new FormData();

  it('passes the action\'s own answer through, and the form on to it', async () => {
    const action = vi.fn(async () => ({outcome: 'unavailable'}) as const);
    const data = form();
    expect(await attemptRecoveryRedeem(action, recoveryRedeemIdle, data)).toEqual({outcome: 'unavailable'});
    expect(action).toHaveBeenCalledWith(recoveryRedeemIdle, data);
  });

  it('rethrows the redirect that is a recovery, for Next.js to follow', async () => {
    let thrown: unknown;
    try {
      redirect('/admin?recovered=2');
    } catch (error) {
      thrown = error;
    }
    await expect(attemptRecoveryRedeem(async () => { throw thrown; }, recoveryRedeemIdle, form())).rejects.toBe(thrown);
  });

  it('says it cannot tell whether it worked, rather than inviting a second press, when the connection drops or the server fails after the form was sent', async () => {
    expect(await attemptRecoveryRedeem(async () => { throw new TypeError('Failed to fetch'); }, recoveryRedeemIdle, form())).toEqual({outcome: 'unknown'});
    expect(await attemptRecoveryRedeem(async () => { throw new Error('Internal Server Error'); }, recoveryRedeemIdle, form())).toEqual({outcome: 'unknown'});
  });
});
