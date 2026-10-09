'use client';

import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {usePreferences} from '../preferences-provider';

/**
 * Plain-language text, plus more technical explanation when the person chose technical detail.
 * It changes how much is explained and nothing else: the facts, evidence and decisions on the page
 * come from elsewhere and are the same in both modes.
 */
export function Explanation({simple, technical}: {simple: MessageKey; technical: MessageKey}) {
  const {t} = useI18n();
  const {preferences} = usePreferences();
  return (
    <>
      <span>{t(simple)}</span>
      {preferences.detail === 'technical' ? <span className="explanation-extra" data-detail="technical"> {t(technical)}</span> : null}
    </>
  );
}
