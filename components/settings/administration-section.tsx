'use client';

import {useId} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {LinkButton} from '../ui/button';

/**
 * The way into the Administrator's pages (Story 1.11), shown to the Administrator only. The page it opens answers 404
 * to any other Account, so hiding this link from them is courtesy and not the protection.
 */
export function AdministrationSection() {
  const {t} = useI18n();
  const headingId = useId();
  return (
    <div className="settings-form">
      <section className="settings-section" id="administration" aria-labelledby={headingId}>
        <h2 id={headingId}>{t('settings.admin.title')}</h2>
        <p className="settings-help">{t('settings.admin.help')}</p>
        <div className="sessions-action">
          <LinkButton href="/admin/invitations" variant="secondary" iconAfter="arrow" prefetch={false}>{t('settings.admin.invitations')}</LinkButton>
        </div>
      </section>
    </div>
  );
}
