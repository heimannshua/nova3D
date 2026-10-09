'use client';

import {useI18n} from '@/lib/i18n/react';
import {PreferencesForm} from './preferences-form';

/** The Settings page body (S-01). It is a client component so its words change the moment the language does. */
export function SettingsContent() {
  const {t} = useI18n();
  return (
    <div className="page page-narrow">
      <p className="eyebrow">{t('settings.eyebrow')}</p>
      <h1>{t('settings.title')}</h1>
      <p className="lede">{t('settings.lede')}</p>
      <PreferencesForm/>
    </div>
  );
}
