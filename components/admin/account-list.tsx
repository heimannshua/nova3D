'use client';

import {useId, useRef, useState} from 'react';
import {disableMemberAccount, enableMemberAccount} from '@/app/admin/accounts/actions';
import {accountLabelOf, accountMessageKeys, accountStatusKeys, type AccountActionState, type AccountRow} from '@/lib/account-admin';
import {formatCreatedAt, isoOf} from '@/lib/administration';
import {useI18n} from '@/lib/i18n/react';
import type {Translator} from '@/lib/i18n';
import {useAccountAction} from '../use-account-action';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {ConfirmDialog} from '../ui/dialog';
import {EmptyState, ErrorState, Notice, type NoticeTone} from '../ui/states';
import {StatusBadge} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';
import {AccountFailureNotice} from './account-failure-notice';

export type AccountMessage = {tone: NoticeTone; text: string};

/**
 * What an answer that changed (or turned out not to need changing) says above the list, or null for an answer that is not about
 * the list: a refusal, a service that did not answer. A disable says how many sessions ended and how many Jobs were cancelled
 * (and, when a canceller did not finish, that those Jobs cannot publish anyway); the words are the catalog's.
 */
export function messageFor(state: AccountActionState, name: string, t: Translator): AccountMessage | null {
  switch (state.outcome) {
    case 'disabled': {
      const parts = [
        t('accounts.disable.done', {name}),
        t('accounts.disable.sessions', {count: state.sessionsEnded}),
        t('accounts.disable.jobs', {count: state.jobsCancelled}),
      ];
      if (state.cancellationsFailed > 0) parts.push(t('accounts.disable.cancelFailed'));
      return {tone: 'success', text: parts.join(' ')};
    }
    case 'enabled':
      return {tone: 'success', text: t(accountMessageKeys.enabled, {name})};
    case 'already_disabled':
    case 'already_enabled':
      return {tone: 'info', text: t(accountMessageKeys[state.outcome], {name})};
    case 'administrator':
    case 'not_found':
      return {tone: 'warning', text: t(accountMessageKeys[state.outcome], {name})};
    default:
      return null;
  }
}

/**
 * Every Account, newest first (AD-02): its Google address, role, the invitation that made it, its status and when it was made.
 * Nothing about the Workspace is in this list, and nothing about it is anywhere the page can read. A member has Disable or
 * Re-enable, each of which asks first in a dialog that starts on Cancel; the Administrator's Account has neither.
 *
 * `accounts` is null when the list could not be read: the page says so and nothing else about the Accounts.
 */
export function AccountList({accounts, message, onMessage}: {accounts: AccountRow[] | null; message: AccountMessage | null; onMessage: (message: AccountMessage) => void}) {
  const {t} = useI18n();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} ref={title} tabIndex={-1}>{t('accounts.list.title')}</h2>
      <p className="settings-help">{t('accounts.list.help')}</p>
      {message ? <div className="invite-notice"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      {accounts === null ? (
        <div className="invite-state-block">
          <ErrorState title={t('accounts.list.error.title')} headingLevel={3} live>{t('accounts.list.error.body')}</ErrorState>
        </div>
      ) : accounts.length === 0 ? (
        <div className="invite-state-block">
          <EmptyState title={t('accounts.list.empty.title')} headingLevel={3}>{t('accounts.list.empty.body')}</EmptyState>
        </div>
      ) : (
        <ul className="invite-list">
          {accounts.map((account) => (
            <AccountItem key={account.accountId} account={account} onMessage={onMessage} onDone={() => title.current?.focus()}/>
          ))}
        </ul>
      )}
    </section>
  );
}

function AccountItem({account, onMessage, onDone}: {account: AccountRow; onMessage: (message: AccountMessage) => void; onDone: () => void}) {
  const {t} = useI18n();
  const name = accountLabelOf(account, t('accounts.row.noAddress'));
  const created = formatCreatedAt(account.createdAt);
  const invitation =
    account.invitationKind === 'general'
      ? t('accounts.row.invitation.general')
      : account.invitationKind === 'named'
        ? (account.invitationLabel ?? t('accounts.row.invitation.none'))
        : t('accounts.row.invitation.none');
  return (
    <li className="invite-item account-item">
      <div className="invite-item-head">
        <h3 className="invite-name">{account.email ? <LtrToken>{account.email}</LtrToken> : name}</h3>
        <StatusBadge tone={account.status === 'active' ? 'success' : 'warning'}>{t(accountStatusKeys[account.status])}</StatusBadge>
      </div>
      <dl className="invite-meta account-meta">
        <div>
          <dt>{t('accounts.row.role')}</dt>
          <dd>{account.role === 'administrator' ? t('accounts.row.role.administrator') : t('accounts.row.role.member')}</dd>
        </div>
        <div>
          <dt>{t('accounts.row.invitation')}</dt>
          <dd><bdi>{invitation}</bdi></dd>
        </div>
        <div>
          <dt>{t('accounts.row.created')}</dt>
          <dd>{created ? <LtrToken><time dateTime={isoOf(account.createdAt)}>{created}</time></LtrToken> : '-'}</dd>
        </div>
      </dl>
      {account.role === 'administrator' ? (
        <p className="settings-help">{t('accounts.row.administratorNote')}</p>
      ) : account.status === 'active' ? (
        <DisableControl account={account} name={name} onMessage={onMessage} onDone={onDone}/>
      ) : (
        <EnableControl account={account} name={name} onMessage={onMessage} onDone={onDone}/>
      )}
    </li>
  );
}

type ControlProps = {account: AccountRow; name: string; onMessage: (message: AccountMessage) => void; onDone: () => void};

/**
 * "Disable" for an enabled member. Pressing it asks first; the dialog starts on Cancel, so Enter does not disable by accident.
 * An answer that changes the list (disabled, already disabled, no longer there) is announced, shown above the list, and focus
 * moves to the list's heading, because this button is gone once the row is no longer enabled. Every other answer (no fresh
 * sign-in, a service that did not answer) stays beside the button.
 */
function DisableControl({account, name, onMessage, onDone}: ControlProps) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const form = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  const {state, formAction, pending, onSubmit} = useAccountAction(disableMemberAccount, (next) => {
    const said = messageFor(next, name, t);
    if (said) {
      onMessage(said);
      announce(said.text, locale);
      onDone();
    }
    return next;
  });

  return (
    <div className="invite-actions">
      <form ref={form} action={formAction} onSubmit={onSubmit} className="invite-form">
        <input type="hidden" name="accountId" value={account.accountId}/>
        <Button
          variant="secondary"
          aria-label={t('accounts.row.disableLabel', {name})}
          aria-disabled={pending ? true : undefined}
          onClick={() => !pending && setConfirming(true)}
        >
          {pending ? t('accounts.disable.pending') : t('accounts.row.disable')}
        </Button>
        <p className="auth-hint auth-status" role="status">{pending ? t('accounts.disable.pendingStatus') : null}</p>
      </form>
      {pending ? null : <AccountFailureNotice state={state}/>}
      {confirming ? (
        <ConfirmDialog
          title={t('accounts.disable.title')}
          description={t('accounts.disable.body', {name})}
          confirmLabel={t('accounts.disable.confirm')}
          tone="danger"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            form.current?.requestSubmit();
          }}
        />
      ) : null}
    </div>
  );
}

/** "Re-enable" for a disabled member: the same shape as Disable, and its dialog starts on Cancel too. */
function EnableControl({account, name, onMessage, onDone}: ControlProps) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const form = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  const {state, formAction, pending, onSubmit} = useAccountAction(enableMemberAccount, (next) => {
    const said = messageFor(next, name, t);
    if (said) {
      onMessage(said);
      announce(said.text, locale);
      onDone();
    }
    return next;
  });

  return (
    <div className="invite-actions">
      <form ref={form} action={formAction} onSubmit={onSubmit} className="invite-form">
        <input type="hidden" name="accountId" value={account.accountId}/>
        <Button
          variant="secondary"
          aria-label={t('accounts.row.enableLabel', {name})}
          aria-disabled={pending ? true : undefined}
          onClick={() => !pending && setConfirming(true)}
        >
          {pending ? t('accounts.enable.pending') : t('accounts.row.enable')}
        </Button>
        <p className="auth-hint auth-status" role="status">{pending ? t('accounts.enable.pendingStatus') : null}</p>
      </form>
      {pending ? null : <AccountFailureNotice state={state}/>}
      {confirming ? (
        <ConfirmDialog
          title={t('accounts.enable.title')}
          description={t('accounts.enable.body', {name})}
          confirmLabel={t('accounts.enable.confirm')}
          tone="primary"
          startOn="cancel"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            form.current?.requestSubmit();
          }}
        />
      ) : null}
    </div>
  );
}
