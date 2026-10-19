'use client';

import type {Confirmation} from '@/lib/administration';
import {useI18n} from '@/lib/i18n/react';
import type {UsageRow} from '@/lib/usage-view';
import {Notice} from '../ui/states';
import {StepUpNotice} from './step-up-notice';
import {UsageList} from './usage-list';

/**
 * The Administrator's Usage and limits page (AD-03, Story 2.4). It is a client component so its words change the moment the language does; the
 * server page passes it each Account's current period and whether the Administrator has just confirmed it is them. The list holds the month, the
 * limit and the settled and reserved amounts, and nothing about any Project or file.
 */
export function UsageContent({rows, confirmation}: {rows: UsageRow[] | null; confirmation: Confirmation}) {
  const {t} = useI18n();
  return (
    <div className="page page-narrow">
      <p className="eyebrow">{t('usage.eyebrow')}</p>
      <h1>{t('usage.title')}</h1>
      <p className="lede">{t('usage.lede')}</p>
      {confirmation === 'needed' ? <StepUpNotice refused={false} neededKey="usage.confirm.needed"/> : null}
      {confirmation === 'confirmed' ? <div className="invite-notice"><Notice tone="success">{t('usage.confirm.ok')}</Notice></div> : null}
      <div className="settings-form">
        <UsageList rows={rows}/>
      </div>
    </div>
  );
}
