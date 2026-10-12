'use client';

import {useI18n} from '@/lib/i18n/react';
import {AdministrationSection} from './administration-section';
import {PreferencesForm} from './preferences-form';
import {SessionsSection} from './sessions-section';

/**
 * The Settings page body (S-01). It is a client component so its words change the moment the language does.
 * `isAdministrator` comes from the page, which read it from the live authorization; it only decides whether the link to the
 * Administrator's pages is shown (those pages check the role themselves).
 */
export function SettingsContent({isAdministrator = false}: {isAdministrator?: boolean}) {
  const {t} = useI18n();
  return (
    <div className="page page-narrow">
      <p className="eyebrow">{t('settings.eyebrow')}</p>
      <h1>{t('settings.title')}</h1>
      <p className="lede">{t('settings.lede')}</p>
      <PreferencesForm/>
      <SessionsSection/>
      {isAdministrator ? <AdministrationSection/> : null}
    </div>
  );
}
