'use client';

import {useId} from 'react';
import type {Confirmation} from '@/lib/administration';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {LinkButton} from '../ui/button';
import {Notice} from '../ui/states';

type Area = {href: string; title: MessageKey; help: MessageKey; open: MessageKey};

/** The Administrator's pages, in the order they were built. Each is its own page that checks the role and the fresh sign-in itself. */
const areas: Area[] = [
  {href: '/admin/invitations', title: 'admin.invitations.title', help: 'admin.invitations.help', open: 'admin.invitations.open'},
  {href: '/admin/accounts', title: 'admin.accounts.title', help: 'admin.accounts.help', open: 'admin.accounts.open'},
];

/**
 * The Administration index (Story 1.5): the way to Invitation codes and Accounts. It is where the `administration` step-up
 * returns, so when the person has just confirmed it is them it says so, and for how long. It says nothing when they have not:
 * the pages that change something offer the step-up themselves, at the moment it is needed.
 */
export function AdminContent({confirmation}: {confirmation: Confirmation}) {
  const {t} = useI18n();
  return (
    <div className="page page-narrow">
      <p className="eyebrow">{t('admin.eyebrow')}</p>
      <h1>{t('admin.title')}</h1>
      <p className="lede">{t('admin.lede')}</p>
      {confirmation === 'confirmed' ? <div className="invite-notice"><Notice tone="success">{t('admin.confirm.ok')}</Notice></div> : null}
      <div className="settings-form">
        {areas.map((area) => <AreaSection key={area.href} area={area}/>)}
      </div>
    </div>
  );
}

function AreaSection({area}: {area: Area}) {
  const {t} = useI18n();
  const headingId = useId();
  return (
    <section className="settings-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t(area.title)}</h2>
      <p className="settings-help">{t(area.help)}</p>
      <div className="sessions-action">
        <LinkButton href={area.href} variant="secondary" iconAfter="arrow" prefetch={false}>{t(area.open)}</LinkButton>
      </div>
    </section>
  );
}
