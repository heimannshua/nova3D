import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';

vi.mock('next/navigation', () => ({useRouter: () => ({refresh: vi.fn()}), usePathname: () => '/'}));
vi.mock('@/app/account/preference-actions', () => ({savePreference: vi.fn()}));

import {LoginForm} from '@/components/login-form';
import {LoginPreferences} from '@/components/login-preferences';
import {PreferencesContext, fallbackPreferences, type PreferencesContextValue} from '@/components/preferences-provider';
import {SettingsContent} from '@/components/settings/settings-content';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {Shell} from '@/components/shell/shell';
import {PreferenceSaveNotice, dismissSaveNotice, failureToAnnounce} from '@/components/ui/preference-notice';
import {locales, translate, type Locale} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import type {Preferences} from '@/lib/preferences';

// The sign-in page's language and appearance choice, the failed-save notice, and the Settings wording (Story 1.4d).

function context(preferences: Partial<Preferences>, extra: Partial<PreferencesContextValue> = {}): PreferencesContextValue {
  const merged = {...fallbackPreferences, ...preferences};
  return {preferences: merged, deviceLocale: merged.locale, localeOverridden: false, setPreference: () => true, setLocale: (choice) => (choice === 'device' ? merged.locale : choice), saveFailure: 0, dismissSaveFailure: () => undefined, ...extra};
}
const render = (locale: Locale, node: React.ReactNode, preferences: Partial<Preferences> = {locale}, extra: Partial<PreferencesContextValue> = {}) =>
  renderToStaticMarkup(
    <PreferencesContext value={context({locale, ...preferences}, extra)}>
      <I18nProvider locale={locale}>
        <AnnouncerProvider>{node}</AnnouncerProvider>
      </I18nProvider>
    </PreferencesContext>,
  );

describe.each(locales)('the sign-in page offers English or Hebrew and light or dark (%s)', (locale) => {
  const markup = render(locale, <LoginForm/>);

  it('has two named radio groups, language and appearance, inside one named group', () => {
    expect(markup).toContain(`role="group" aria-label="${translate(locale, 'login.prefs.title')}"`);
    expect(markup).toContain(`role="radiogroup" aria-label="${translate(locale, 'settings.language.title')}"`);
    expect(markup).toContain(`role="radiogroup" aria-label="${translate(locale, 'settings.theme.title')}"`);
  });

  it('offers each language by its own name, in its own language and direction, and each appearance', () => {
    expect(markup).toContain('English');
    expect(markup).toMatch(/<span lang="he" dir="rtl"[^>]*>עברית<\/span>/);
    expect(markup).toContain(translate(locale, 'settings.theme.light'));
    expect(markup).toContain(translate(locale, 'settings.theme.dark'));
    expect(markup.match(/type="radio"/g)).toHaveLength(4);
  });

  it('marks the language and appearance in effect, and nothing else', () => {
    const inEffect = render(locale, <LoginPreferences/>, {locale: 'he', theme: 'dark'});
    const radios = [...inEffect.matchAll(/<input type="radio" name="([^"]+)"([^>]*?)\/>/g)].map((match) => ({name: match[1], value: /value="([^"]+)"/.exec(match[2])![1], checked: match[2].includes('checked=""')}));
    expect(radios).toEqual([
      {name: 'login-language', value: 'en', checked: false},
      {name: 'login-language', value: 'he', checked: true},
      {name: 'login-theme', value: 'light', checked: false},
      {name: 'login-theme', value: 'dark', checked: true},
    ]);
  });

  it('still has exactly one button: Continue with Google (radios are not buttons)', () => {
    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain(translate(locale, 'login.google'));
  });

  it('offers no "match my device" choice, no detail and no guidance: only the two choices the sign-in page is for', () => {
    expect(markup).not.toContain(translate(locale, 'settings.language.device'));
    expect(markup).not.toContain(translate(locale, 'settings.detail.title'));
    expect(markup).not.toContain(translate(locale, 'settings.guidance.title'));
  });
});

describe.each(locales)('the failed-save notice (%s)', (locale) => {
  it('renders nothing while every save has worked', () => {
    expect(render(locale, <PreferenceSaveNotice/>, {locale}, {saveFailure: 0})).not.toContain('preference-notice');
  });

  it('says in words that the choice was not saved and was undone, with a way to put the message away, and no role of its own (the live region announces it once)', () => {
    const markup = render(locale, <PreferenceSaveNotice/>, {locale}, {saveFailure: 1});
    expect(markup).toContain('data-preference-notice=""');
    expect(markup).toContain(translate(locale, 'settings.announce.saveFailed'));
    expect(markup).toContain('notice-danger');
    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain(translate(locale, 'notice.dismiss'));
    expect(markup.match(/<button/g)).toHaveLength(1);
  });

  it('is a region of its own, named in the interface language, so it is a landmark wherever it sits', () => {
    const markup = render(locale, <PreferenceSaveNotice/>, {locale}, {saveFailure: 2});
    expect(markup).toMatch(new RegExp(`<section class="preference-notice" data-preference-notice="" aria-label="${translate(locale, 'settings.saveFailed.title')}"`));
  });
});

describe('the failed-save notice on every kind of page (Story 1.4d review)', () => {
  const page = (pathname: string, saveFailure: number) => render('en', <Shell pathname={pathname}><p id="page-body">the page</p></Shell>, {locale: 'en'}, {saveFailure});

  it.each(['/', '/projects', '/progress', '/settings', '/no-such-page'])('is inside the page content of the shell on %s', (pathname) => {
    const markup = page(pathname, 1);
    const main = /<main[^>]*>([\s\S]*)<\/main>/.exec(markup)?.[1] ?? '';
    expect(main).toContain('data-preference-notice');
    expect(main.indexOf('data-preference-notice')).toBeLessThan(main.indexOf('id="page-body"'));
  });

  it.each(['/login', '/register', '/step-up'])('is shown on %s too, which has no shell: a failed save on the sign-in page of a signed-in visitor is not undone silently', (pathname) => {
    const markup = page(pathname, 1);
    expect(markup).toContain('data-preference-notice');
    expect(markup).toContain(translate('en', 'settings.announce.saveFailed'));
    // Beside the page, before it, and with no second main landmark of the shell's.
    expect(markup.indexOf('data-preference-notice')).toBeLessThan(markup.indexOf('id="page-body"'));
    expect(markup).not.toContain('<main');
    expect(markup).not.toContain('class="app-shell"');
  });

  it.each(['/', '/login', '/step-up'])('shows nothing on %s while every save has worked', (pathname) => {
    expect(page(pathname, 0)).not.toContain('data-preference-notice');
  });
});

describe('dismissing the failed-save notice', () => {
  it('puts the message away and moves focus to the page content when the notice had it, so keyboard focus is not stranded', () => {
    const order: string[] = [];
    dismissSaveNotice({dismiss: () => order.push('dismiss'), noticeHadFocus: true, focusMain: () => order.push('focusMain')});
    expect(order).toEqual(['dismiss', 'focusMain']);
  });

  it('leaves focus alone when the notice did not have it', () => {
    const order: string[] = [];
    dismissSaveNotice({dismiss: () => order.push('dismiss'), noticeHadFocus: false, focusMain: () => order.push('focusMain')});
    expect(order).toEqual(['dismiss']);
  });
});

describe('announcing a failure', () => {
  it('announces each failure once: a new failure, yes; the same one again because the language or the announcer changed, no; none, no', () => {
    expect(failureToAnnounce(1, 0)).toBe(true);
    expect(failureToAnnounce(1, 1)).toBe(false);
    expect(failureToAnnounce(2, 1)).toBe(true);
    expect(failureToAnnounce(0, 1)).toBe(false);
    expect(failureToAnnounce(0, 0)).toBe(false);
  });
});

describe.each(locales)('Settings says the choices belong to the account (%s)', (locale) => {
  it('no longer says they are kept on this device', () => {
    const markup = render(locale, <SettingsContent/>);
    expect(markup).toContain(translate(locale, 'settings.lede'));
    expect(translate('en', 'settings.lede')).not.toMatch(/this device|until your account/i);
    expect(translate('en', 'settings.lede')).toMatch(/account/i);
    expect(translate('he', 'settings.lede')).toContain('חשבון');
    expect(translate('he', 'settings.lede')).not.toContain('במכשיר הזה');
  });
});
