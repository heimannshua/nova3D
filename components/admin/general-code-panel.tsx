'use client';

import {useId} from 'react';
import {mintGeneralInvitation} from '@/app/admin/invitations/actions';
import {useI18n} from '@/lib/i18n/react';
import type {IssuedCode} from '@/lib/invitations';
import {useInvitationAction} from '../use-invitation-action';
import {Button} from '../ui/button';
import {Notice} from '../ui/states';
import {StatusBadge} from '../ui/status-badge';
import {FailureNotice} from './failure-notice';

/**
 * "General code" (AD-01): the one code the Administrator can share with anyone. It is single-use: when a
 * registration uses it, it stops working and nothing replaces it until the Administrator makes the next one here
 * (Story 1.11). While an unused general code exists there is no revoke or replace control. After it is redeemed,
 * the Administrator can make the next one.
 *
 * `waiting` is what the list says now. It can be out of date (another window made one a moment ago); the server then
 * answers `exists` or `protected`, the page is refreshed, and the current code remains in place. It is `null` when the list could not be
 * read: the panel then says nothing about whether one is waiting, and offers to make one, which is safe because without
 * `replace` a server that already holds an unused general code answers `exists` and changes nothing.
 */
export function GeneralCodePanel({waiting, onIssued}: {waiting: boolean | null; onIssued: (code: IssuedCode) => void}) {
  const {t} = useI18n();
  const titleId = useId();
  const {state, formAction, pending, onSubmit} = useInvitationAction(mintGeneralInvitation, (next) => {
    if (next.outcome !== 'issued') return next;
    onIssued({invitationId: next.invitationId, kind: next.kind, label: next.label, code: next.code, replacedInvitationId: next.replacedInvitationId});
    return {outcome: 'created'};
  });

  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId}>{t('invitations.general.title')}</h2>
      <p className="settings-help">{t('invitations.general.help')}</p>
      {waiting === null ? null : (
        <p className="invite-state">
          {waiting ? <StatusBadge tone="success">{t('invitations.status.unused')}</StatusBadge> : <StatusBadge tone="neutral">{t('invitations.general.noneBadge')}</StatusBadge>}
          <span>{waiting ? t('invitations.general.waiting') : t('invitations.general.none')}</span>
        </p>
      )}
      <form action={formAction} onSubmit={onSubmit} className="invite-form">
        {waiting === true ? null : (
          <Button variant="primary" type="submit" aria-disabled={pending ? true : undefined}>{t('invitations.general.mint')}</Button>
        )}
        <p className="auth-hint auth-status" role="status">{pending ? t('invitations.general.pending') : null}</p>
      </form>
      {!pending && state.outcome === 'exists' ? <div className="invite-notice"><Notice tone="info" role="alert">{t('invitations.general.exists')}</Notice></div> : null}
      {!pending && state.outcome === 'protected' ? <div className="invite-notice"><Notice tone="info" role="alert">{t('invitations.general.protected')}</Notice></div> : null}
      {pending ? null : <FailureNotice state={state}/>}
    </section>
  );
}
