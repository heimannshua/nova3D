import {redirect} from 'next/navigation';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import {StepUpForm, attemptStepUp} from '@/components/step-up-form';
import {locales, translate, type Locale} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {unexpectedResponseMessage} from '@/lib/session-actions';
import {stepUpClasses, stepUpIdle, stepUpReasonKeys, type StepUpClass} from '@/lib/step-up';

const start = vi.fn(async () => stepUpIdle);
const render = (locale: Locale, cancelHref = '/settings', actionClass: StepUpClass = 'administration', email: string | null = 'person@example.com') =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <StepUpForm start={start} cancelHref={cancelHref} actionClass={actionClass} email={email}/>
    </I18nProvider>,
  );
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe.each(locales)('the step-up page in %s', (locale) => {
  const markup = render(locale);

  it('has one level-one heading that names the step, and explains that it is the same Google account', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<section[^>]*aria-labelledby="step-up-title"/);
    expect(markup).toMatch(/<h1 id="step-up-title">/);
    expect(text(markup)).toContain(translate(locale, 'stepUp.title'));
    expect(text(markup)).toContain(translate(locale, 'stepUp.lede'));
  });

  it('says what is being confirmed, and which Google address is signed in', () => {
    expect(text(markup)).toContain(translate(locale, 'stepUp.reason.administration'));
    expect(text(markup)).toContain(translate(locale, 'stepUp.signedInAs', {email: 'person@example.com'}));
    // The address is isolated from the sentence around it, so it cannot reorder the words.
    expect(markup).toContain('⁨person@example.com⁩');
    expect(text(markup)).toContain(translate(locale, 'stepUp.lede'));
  });

  it.each(stepUpClasses)('says the words of the class it was bound to: %s', (actionClass) => {
    const markupForClass = render(locale, '/settings', actionClass);
    expect(text(markupForClass)).toContain(translate(locale, stepUpReasonKeys[actionClass]));
    for (const other of stepUpClasses.filter((candidate) => candidate !== actionClass)) {
      expect(text(markupForClass)).not.toContain(translate(locale, stepUpReasonKeys[other]));
    }
  });

  it('leaves the address line out, and keeps everything else, when no address is known', () => {
    const anonymous = render(locale, '/settings', 'administration', null);
    expect(anonymous).not.toContain('person@example.com');
    expect(anonymous).not.toContain('⁨');
    expect(text(anonymous)).toContain(translate(locale, 'stepUp.reason.administration'));
    expect(anonymous.match(/<button\b/g)).toHaveLength(1);
  });

  it('has one primary action, a submit button, and a way back that is a link', () => {
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*>[\s\S]*?<span>/);
    expect(text(markup)).toContain(translate(locale, 'stepUp.continue'));
    expect(markup).toMatch(/<a [^>]*href="\/settings"[^>]*>[\s\S]*?<span>/);
    expect(text(markup)).toContain(translate(locale, 'stepUp.cancel'));
  });

  it('goes back where the SERVER said, whatever the caller passes', () => {
    expect(render(locale, '/projects')).toMatch(/href="\/projects"/);
  });

  it('shows no error before an attempt, and announces progress through a status region', () => {
    expect(markup).not.toContain('role="alert"');
    expect(markup).toMatch(/<p class="auth-hint auth-status" role="status"><\/p>/);
  });

  it('sends nothing the person could change: no field, no class, no Account, no return path', () => {
    expect(markup).not.toMatch(/<input\b(?![^>]*type="hidden")/);
    expect(markup).not.toMatch(/name="(?:class|actionClass|for|accountId|userId|sessionId|returnTo|redirect|next)"/);
  });
});

describe('attemptStepUp', () => {
  it('passes the action\'s own answer through', async () => {
    const limited = {outcome: 'limited'} as const;
    expect(await attemptStepUp(async () => limited, stepUpIdle, vi.fn())).toBe(limited);
  });

  it('rethrows the redirect to Google for Next.js to follow', async () => {
    const navigate = vi.fn();
    let thrown: unknown;
    try {
      redirect('https://accounts.example/chooser');
    } catch (error) {
      thrown = error;
    }
    await expect(attemptStepUp(async () => { throw thrown; }, stepUpIdle, navigate)).rejects.toBe(thrown);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reloads the page, once, when the answer is the proxy\'s redirect (the session no longer has access), and keeps the state', async () => {
    const navigate = vi.fn();
    const state = await attemptStepUp(async () => { throw new Error(unexpectedResponseMessage); }, stepUpIdle, navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(state).toBe(stepUpIdle);
  });

  it('says it could not start, and reloads nothing, when the connection drops or the server fails', async () => {
    const navigate = vi.fn();
    expect(await attemptStepUp(async () => { throw new TypeError('Failed to fetch'); }, stepUpIdle, navigate)).toEqual({outcome: 'unavailable'});
    expect(await attemptStepUp(async () => { throw new Error('Internal Server Error'); }, stepUpIdle, navigate)).toEqual({outcome: 'unavailable'});
    expect(navigate).not.toHaveBeenCalled();
  });
});
