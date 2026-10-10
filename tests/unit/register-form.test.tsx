import {redirect} from 'next/navigation';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {RegisterForm, attemptRegistration, attemptSwitch} from '@/components/register-form';
import {Shell} from '@/components/shell/shell';
import {locales, translate, type Locale} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import type {RegisterState} from '@/lib/register';

const COMMAND = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const register = vi.fn(async (): Promise<RegisterState> => ({commandId: COMMAND, error: null}));
const switchAccount = vi.fn(async () => undefined);

const render = (locale: Locale, email: string | null = 'person@example.com') =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <RegisterForm email={email} initialCommandId={COMMAND} register={register} switchAccount={switchAccount}/>
    </I18nProvider>,
  );
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe.each(locales)('the registration screen in %s', (locale) => {
  const markup = render(locale);

  it('states that the instance operator administers the hosting accounts that hold the user data', () => {
    expect(text(markup)).toContain(translate(locale, 'register.operator'));
  });

  it('has one level-one heading, a labelled code field and a submit button', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toContain(translate(locale, 'register.title'));
    expect(markup).toMatch(/<label[^>]*for="register-code"[^>]*>/);
    expect(markup).toContain(translate(locale, 'register.code.label'));
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*?<span>/);
    expect(text(markup)).toContain(translate(locale, 'register.submit'));
  });

  it('shows who is signed in, isolated from the sentence around it', () => {
    expect(text(markup)).toContain(translate(locale, 'register.lede', {email: 'person@example.com'}).replace(/&/g, '&amp;'));
    expect(markup).toContain('⁨person@example.com⁩');
  });

  it('reads the code left to right, whatever the interface language', () => {
    expect(markup).toMatch(/<input[^>]*id="register-code"[^>]*dir="ltr"/);
  });

  it('is described by its hint, and shows no error before an attempt', () => {
    expect(markup).toMatch(/<input[^>]*aria-describedby="register-code-hint"/);
    expect(markup).toContain('id="register-code-hint"');
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('aria-invalid');
  });

  it('checks the field itself: no native required bubble, our own localized message instead', () => {
    expect(markup).toMatch(/<form[^>]*noValidate/);
    expect(markup).not.toMatch(/<input[^>]*\srequired(?:[\s=/>])/);
    expect(markup).toMatch(/<input[^>]*id="register-code"[^>]*aria-required="true"/);
    expect(translate(locale, 'register.error.empty').length).toBeGreaterThan(0);
  });

  it('tells people without a code to ask whoever invited them', () => {
    expect(text(markup)).toContain(translate(locale, 'register.noCode'));
  });

  it('has a submit button that is enabled until an attempt is under way (while busy it uses aria-disabled, checked in the browser tests)', () => {
    const button = /<button[^>]*class="btn btn-primary auth-submit"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(button).toContain('type="submit"');
    expect(button).not.toMatch(/\sdisabled|aria-disabled/);
  });

  it('carries the command ID the page minted in a hidden field, and nothing about the user', () => {
    expect(markup).toContain(`<input type="hidden" name="commandId" value="${COMMAND}"/>`);
    expect(markup.match(/type="hidden"/g)).toHaveLength(1);
    expect(markup).not.toMatch(/name="(?:userId|user|role|status|email)"/);
  });

  it('offers a different Google account in a form of its own', () => {
    expect(text(markup)).toContain(translate(locale, 'register.switch'));
    expect(markup.match(/<form\b/g)).toHaveLength(2);
    expect(markup).not.toMatch(/<form[^>]*>(?:(?!<\/form>)[\s\S])*<form/);
  });

  it('is the sign-in surface, without the navigation shell', () => {
    expect(markup).not.toContain('<nav');
    expect(markup).not.toContain('class="app-shell"');
  });
});

describe('the registration screen without an email', () => {
  it('still reads sensibly', () => {
    for (const locale of locales) {
      const markup = render(locale, null);
      expect(text(markup)).toContain(translate(locale, 'register.ledeNoEmail'));
      expect(markup).not.toContain('{email}');
    }
  });
});

describe('the shell', () => {
  it('does not wrap /register', () => {
    const wrapped = renderToStaticMarkup(
      <I18nProvider locale="en">
        <Shell pathname="/register"><p>form</p></Shell>
      </I18nProvider>,
    );
    expect(wrapped).toBe('<p>form</p>');
  });
});

describe('attemptSwitch', () => {
  it('does nothing more when the switch works', async () => {
    const navigate = vi.fn();
    await attemptSwitch(async () => undefined, navigate);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still ends at sign-in when the proxy refused the switch (the session is already gone) or the network failed', async () => {
    for (const failure of [new Error('An unexpected response was received from the server.'), new TypeError('Failed to fetch')]) {
      const navigate = vi.fn();
      await attemptSwitch(async () => { throw failure; }, navigate);
      expect(navigate).toHaveBeenCalledExactlyOnceWith('/login');
    }
  });

  it('lets a redirect through for Next.js to follow', async () => {
    let redirectError: unknown;
    try {
      redirect('/login');
    } catch (error) {
      redirectError = error;
    }
    const navigate = vi.fn();
    await expect(attemptSwitch(async () => { throw redirectError; }, navigate)).rejects.toBe(redirectError);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('attemptRegistration', () => {
  const previous: RegisterState = {commandId: COMMAND, error: null};
  const data = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    return form;
  };

  it('returns what the action returned', async () => {
    const answer: RegisterState = {commandId: 'a1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f', error: 'refused'};
    expect(await attemptRegistration(async () => answer, previous, data({commandId: COMMAND, code: 'x'}))).toBe(answer);
  });

  it('answers a blank field itself, in the person’s language, without a request or a new command ID', async () => {
    const action = vi.fn(async (): Promise<RegisterState> => ({commandId: COMMAND, error: null}));
    for (const code of ['', '   ', '\n\t']) {
      expect(await attemptRegistration(action, previous, data({commandId: COMMAND, code}))).toEqual({commandId: COMMAND, error: 'empty'});
    }
    expect(await attemptRegistration(action, previous, data({commandId: COMMAND}))).toEqual({commandId: COMMAND, error: 'empty'});
    expect(action).not.toHaveBeenCalled();
  });

  it('keeps the submitted command ID and asks for a retry when the connection fails, because the outcome is unknown', async () => {
    const sent = '0a1b2c3d-4e5f-4a6b-8c7d-9a1b2c3d4e5f';
    const dropped = async (): Promise<RegisterState> => {
      throw new TypeError('Failed to fetch');
    };
    const navigate = vi.fn();
    expect(await attemptRegistration(dropped, previous, data({commandId: sent, code: 'x'}), {navigate})).toEqual({commandId: sent, error: 'unavailable'});
    expect(await attemptRegistration(dropped, previous, data({code: 'x'}), {navigate})).toEqual({commandId: COMMAND, error: 'unavailable'});
    expect(await attemptRegistration(dropped, previous, data({commandId: 'not-a-uuid', code: 'x'}), {navigate})).toEqual({commandId: COMMAND, error: 'unavailable'});
    expect(navigate).not.toHaveBeenCalled();
  });

  it('treats an answer that is not the action’s (the proxy redirected: signed out, disabled, already registered) as a stale form, and goes to /register', async () => {
    const unexpected = async (): Promise<RegisterState> => {
      throw new Error('An unexpected response was received from the server.');
    };
    const navigate = vi.fn();
    expect(await attemptRegistration(unexpected, previous, data({commandId: COMMAND, code: 'x'}), {navigate})).toEqual({commandId: COMMAND, error: null});
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/register');
  });

  it('also goes to /register when the deployment moved on under the form (the action no longer exists)', async () => {
    const gone = async (): Promise<RegisterState> => {
      throw new Error('Server Action "abc" was not found on the server.');
    };
    const navigate = vi.fn();
    await attemptRegistration(gone, previous, data({commandId: COMMAND, code: 'x'}), {navigate});
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/register');
  });

  describe('a command ID belongs to the code it was first sent with', () => {
    const answer = vi.fn(async (_previous: RegisterState, _form: FormData): Promise<RegisterState> => ({commandId: COMMAND, error: null}));

    it('keeps the ID when the same code is sent again after an attempt of unknown outcome', async () => {
      answer.mockClear();
      await attemptRegistration(answer, previous, data({commandId: COMMAND, code: 'SAME-CODE'}), {pendingCode: 'SAME-CODE'});
      expect(answer.mock.calls[0][1].get('commandId')).toBe(COMMAND);
    });

    it('mints a new ID when the code was edited, so the database never sees one command with two codes', async () => {
      answer.mockClear();
      const form = data({commandId: COMMAND, code: 'EDITED-CODE'});
      await attemptRegistration(answer, previous, form, {pendingCode: 'SAME-CODE'});
      const sent = answer.mock.calls[0][1].get('commandId');
      expect(sent).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(sent).not.toBe(COMMAND);
    });

    it('does nothing special when no attempt is pending', async () => {
      answer.mockClear();
      await attemptRegistration(answer, previous, data({commandId: COMMAND, code: 'ANY'}), {});
      expect(answer.mock.calls[0][1].get('commandId')).toBe(COMMAND);
    });

    it('returns the new ID when that attempt also fails to connect', async () => {
      const dropped = async (): Promise<RegisterState> => {
        throw new TypeError('Failed to fetch');
      };
      const state = await attemptRegistration(dropped, previous, data({commandId: COMMAND, code: 'EDITED'}), {pendingCode: 'OLD'});
      expect(state.error).toBe('unavailable');
      expect(state.commandId).not.toBe(COMMAND);
    });
  });

  it('lets a redirect through for Next.js to follow, instead of calling it a failure', async () => {
    let redirectError: unknown;
    try {
      redirect('/');
    } catch (error) {
      redirectError = error;
    }
    expect(redirectError).toBeDefined();
    const redirecting = async (): Promise<RegisterState> => {
      throw redirectError;
    };
    await expect(attemptRegistration(redirecting, previous, data({commandId: COMMAND, code: 'x'}))).rejects.toBe(redirectError);
  });
});
