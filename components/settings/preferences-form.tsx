'use client';

import {useId, type ReactNode} from 'react';
import {localeInfo, locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {useI18n} from '@/lib/i18n/react';
import {details, themes, type Detail, type Theme} from '@/lib/preferences';
import {usePreferences} from '../preferences-provider';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {Explanation} from '../ui/explain';
import {TextSpan} from '../ui/text-span';

function Section({id, title, help, children}: {id: string; title: string; help: string; children: ReactNode}) {
  const headingId = useId();
  return (
    <section className="settings-section" id={id} aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <p className="settings-help">{help}</p>
      {children}
    </section>
  );
}

function Choice({name, value, checked, onChange, children}: {name: string; value: string; checked: boolean; onChange: () => void; children: ReactNode}) {
  return (
    <label className="choice">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange}/>
      <span className="choice-text">{children}</span>
    </label>
  );
}

const themeLabels = {light: 'settings.theme.light', dark: 'settings.theme.dark'} as const satisfies Record<Theme, MessageKey>;
const detailLabels = {simple: 'settings.detail.simple', technical: 'settings.detail.technical'} as const satisfies Record<Detail, MessageKey>;

/**
 * Language, light or dark, how much explanation, and the introduction. Each choice takes effect at once,
 * is kept on this device, and is announced. None of them touches evidence or decisions.
 */
export function PreferencesForm() {
  const {t, locale} = useI18n();
  const {preferences, deviceLocale, localeOverridden, setPreference, setLocale} = usePreferences();
  const announce = useAnnounce();
  const refused = () => announce(t('settings.announce.failed'), locale);

  function chooseLanguage(choice: Locale | 'device') {
    const next = setLocale(choice);
    if (!next) return refused();
    // Announce in the language that is now showing, with that language's own name for itself.
    const key = choice === 'device' ? 'settings.announce.languageDevice' : 'settings.announce.language';
    announce(translate(next, key, {language: localeInfo[next].nativeName}), next);
  }

  function chooseTheme(theme: Theme) {
    if (!setPreference('theme', theme)) return refused();
    announce(t(theme === 'dark' ? 'settings.announce.themeDark' : 'settings.announce.themeLight'), locale);
  }

  function chooseDetail(detail: Detail) {
    if (!setPreference('detail', detail)) return refused();
    announce(t(detail === 'technical' ? 'settings.announce.detailTechnical' : 'settings.announce.detailSimple'), locale);
  }

  function replayGuidance() {
    if (!setPreference('guidance', 'shown')) return refused();
    announce(t('settings.announce.guidance'), locale);
  }

  const selectedLanguage = localeOverridden ? preferences.locale : 'device';

  return (
    <div className="settings-form">
      <Section id="language" title={t('settings.language.title')} help={t('settings.language.help')}>
        <div className="choice-group" role="radiogroup" aria-label={t('settings.language.title')}>
          <Choice name="language" value="device" checked={selectedLanguage === 'device'} onChange={() => chooseLanguage('device')}>
            <strong>{t('settings.language.device')}</strong>
            <small>{t('settings.language.deviceNow', {language: localeInfo[deviceLocale].nativeName})}</small>
          </Choice>
          {locales.map((code) => (
            <Choice key={code} name="language" value={code} checked={selectedLanguage === code} onChange={() => chooseLanguage(code)}>
              <strong><TextSpan lang={code}>{localeInfo[code].nativeName}</TextSpan></strong>
            </Choice>
          ))}
        </div>
        <div className="language-preview">
          <p className="eyebrow">{t('settings.language.previewTitle')}</p>
          {locales.map((code) => (
            <TextSpan key={code} as="p" lang={code} className="preview-line">{translate(code, 'settings.language.previewSample')}</TextSpan>
          ))}
        </div>
      </Section>

      <Section id="appearance" title={t('settings.theme.title')} help={t('settings.theme.help')}>
        <div className="choice-group" role="radiogroup" aria-label={t('settings.theme.title')}>
          {themes.map((theme) => (
            <Choice key={theme} name="theme" value={theme} checked={preferences.theme === theme} onChange={() => chooseTheme(theme)}>
              <strong>{t(themeLabels[theme])}</strong>
            </Choice>
          ))}
        </div>
      </Section>

      <Section id="detail" title={t('settings.detail.title')} help={t('settings.detail.help')}>
        <div className="choice-group" role="radiogroup" aria-label={t('settings.detail.title')}>
          {details.map((detail) => (
            <Choice key={detail} name="detail" value={detail} checked={preferences.detail === detail} onChange={() => chooseDetail(detail)}>
              <strong>{t(detailLabels[detail])}</strong>
            </Choice>
          ))}
        </div>
        <div className="detail-example">
          <p className="eyebrow">{t('settings.detail.exampleTitle')}</p>
          <p><Explanation simple="settings.detail.exampleSimple" technical="settings.detail.exampleTechnical"/></p>
        </div>
      </Section>

      <Section id="guidance" title={t('settings.guidance.title')} help={t('settings.guidance.help')}>
        <div className="guidance-replay">
          <Button variant="secondary" icon="spark" onClick={replayGuidance}>{t('settings.guidance.replay')}</Button>
          <p className="settings-state">{t(preferences.guidance === 'shown' ? 'settings.guidance.stateShown' : 'settings.guidance.stateDismissed')}</p>
        </div>
      </Section>
    </div>
  );
}
