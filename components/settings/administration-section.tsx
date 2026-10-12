'use client';

import {useId} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {LinkButton} from '../ui/button';

/**
 * The way into the Administrator's pages (Stories 1.11 and 1.5), shown to the Administrator only: one link, to the
 * Administration index, which links to Invitation codes and Accounts. The pages answer 404 to any other Account, so hiding
 * this link from them is courtesy and not the protection.
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
          <LinkButton href="/admin" variant="secondary" iconAfter="arrow" prefetch={false}>{t('settings.admin.open')}</LinkButton>
        </div>
      </section>
    </div>
  );
}
