'use client';

import {useState} from 'react';
import type {AccountRow} from '@/lib/account-admin';
import type {Confirmation} from '@/lib/administration';
import {useI18n} from '@/lib/i18n/react';
import {Notice} from '../ui/states';
import {AccountList, type AccountMessage} from './account-list';
import {StepUpNotice} from './step-up-notice';

/**
 * The Administrator's Accounts page (AD-02, Story 1.5). It is a client component so its words change the moment the language
 * does; the server page passes it the list and whether the Administrator has just confirmed it is them. The list holds no
 * Workspace content, no project name and no usage, and nothing on the page can reach them.
 */
export function AccountsContent({accounts, confirmation}: {accounts: AccountRow[] | null; confirmation: Confirmation}) {
  const {t} = useI18n();
  const [message, setMessage] = useState<AccountMessage | null>(null);
  return (
    <div className="page page-narrow">
      <p className="eyebrow">{t('accounts.eyebrow')}</p>
      <h1>{t('accounts.title')}</h1>
      <p className="lede">{t('accounts.lede')}</p>
      {confirmation === 'needed' ? <StepUpNotice refused={false} neededKey="accounts.confirm.needed"/> : null}
      {confirmation === 'confirmed' ? <div className="invite-notice"><Notice tone="success">{t('accounts.confirm.ok')}</Notice></div> : null}
      <div className="settings-form">
        <AccountList accounts={accounts} message={message} onMessage={setMessage}/>
      </div>
    </div>
  );
}
