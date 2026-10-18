'use client';

import {useI18n} from '@/lib/i18n/react';
import type {AlarmView} from '@/lib/operations';
import {OpenAlarms, ResolvedAlarms} from './alarm-list';

/**
 * The Administrator's Operations page (Story 1.13): what has stopped, what is stuck and what is piling up, and what has been emailed. It is a client component
 * so its words change the moment the language does; the server page passes it the alarms: the open ones, newest first, and the most recently resolved. It is
 * read only (nothing here acknowledges, snoozes or deletes an alarm: one closes by itself when its condition clears), and an alarm holds no project, no file
 * and no address, so nothing on the page can show one. `alarms` is null when they could not be read.
 */
export function OperationsContent({alarms}: {alarms: AlarmView[] | null}) {
  const {t} = useI18n();
  const open = alarms === null ? null : alarms.filter((alarm) => alarm.resolvedAt === null);
  const resolved = alarms === null ? null : alarms.filter((alarm) => alarm.resolvedAt !== null);
  return (
    <div className="page page-narrow">
      <p className="eyebrow">{t('operations.eyebrow')}</p>
      <h1>{t('operations.title')}</h1>
      <p className="lede">{t('operations.lede')}</p>
      <div className="settings-form">
        <OpenAlarms alarms={open}/>
        {resolved === null ? null : <ResolvedAlarms alarms={resolved}/>}
      </div>
    </div>
  );
}
