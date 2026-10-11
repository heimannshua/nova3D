'use client';

import {localeInfo, locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {useI18n} from '@/lib/i18n/react';
import {themes, type Theme} from '@/lib/preferences';
import {usePreferences} from './preferences-provider';
import {useAnnounce} from './ui/announcer';
import {Choice} from './ui/choice';
import {TextSpan} from './ui/text-span';

const themeLabels = {light: 'settings.theme.light', dark: 'settings.theme.dark'} as const satisfies Record<Theme, MessageKey>;

/**
 * English or Hebrew, and light or dark, on the sign-in page (Story 1.4d). Each choice applies at once and is
 * announced like the same choice in Settings. What it is saved to depends on who is looking, and the provider decides
 * (components/preferences-provider.tsx), not this component:
 *
 *   - A visitor with no session, the usual one: the device's cookies and nothing else. They are adopted into the
 *     Account's record at a person's first sign-in, and ignored once the Account has one, which then wins.
 *   - A visitor who holds an active session and opens this page (it is a public path): the page is rendered for
 *     their Account, so the choice is saved to the Account like one made in Settings, undone and said so if it cannot
 *     be (the failed-save notice is shown on this page too).
 *
 * The controls are radio groups, so the page still has exactly one button: Continue with Google.
 */
export function LoginPreferences() {
  const {t, locale} = useI18n();
  const {preferences, setPreference, setLocale} = usePreferences();
  const announce = useAnnounce();
  const refused = () => announce(t('settings.announce.failed'), locale);

  function chooseLanguage(code: Locale) {
    const next = setLocale(code);
    if (!next) return refused();
    // Announce in the language that is now showing, with that language's own name for itself.
    announce(translate(next, 'settings.announce.language', {language: localeInfo[next].nativeName}), next);
  }

  function chooseTheme(theme: Theme) {
    if (!setPreference('theme', theme)) return refused();
    announce(t(theme === 'dark' ? 'settings.announce.themeDark' : 'settings.announce.themeLight'), locale);
  }

  return (
    <div className="auth-preferences" role="group" aria-label={t('login.prefs.title')}>
      <div className="choice-group choice-group-pair" role="radiogroup" aria-label={t('settings.language.title')}>
        {locales.map((code) => (
          <Choice key={code} name="login-language" value={code} checked={preferences.locale === code} onChange={() => chooseLanguage(code)}>
            <strong><TextSpan lang={code}>{localeInfo[code].nativeName}</TextSpan></strong>
          </Choice>
        ))}
      </div>
      <div className="choice-group choice-group-pair" role="radiogroup" aria-label={t('settings.theme.title')}>
        {themes.map((theme) => (
          <Choice key={theme} name="login-theme" value={theme} checked={preferences.theme === theme} onChange={() => chooseTheme(theme)}>
            <strong>{t(themeLabels[theme])}</strong>
          </Choice>
        ))}
      </div>
    </div>
  );
}
