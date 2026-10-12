'use client';

import {useId, useRef, useState} from 'react';
import {revokeInvitationCode} from '@/app/admin/invitations/actions';
import {useI18n} from '@/lib/i18n/react';
import {formatCreatedAt, invitationMessageKeys, isoOf, statusKeys, type InvitationRow, type InvitationStatus} from '@/lib/invitations';
import type {MessageKey} from '@/lib/i18n';
import {useInvitationAction} from '../use-invitation-action';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {ConfirmDialog} from '../ui/dialog';
import {EmptyState, ErrorState, Notice, type NoticeTone} from '../ui/states';
import {StatusBadge, type StatusTone} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';
import {FailureNotice} from './failure-notice';

/** Unused, Used and Revoked, each as a word and a shape (the badge pairs its colour with both). */
const statusTones: Record<InvitationStatus, StatusTone> = {unused: 'success', redeemed: 'neutral', revoked: 'danger'};

export type ListMessage = {tone: NoticeTone; text: string};

/**
 * Every code, newest first (AD-01): its name, kind, status, identifier and creation time. A code's value is not in
 * this list, and is not anywhere the page can read: the database keeps only a hash of it. An unused code has a
 * Revoke button, which asks first in a dialog that starts on Cancel.
 *
 * `invitations` is null when the list could not be read: the page says so and nothing else about the codes.
 */
export function InvitationList({invitations, message, onMessage}: {invitations: InvitationRow[] | null; message: ListMessage | null; onMessage: (message: ListMessage) => void}) {
  const {t} = useI18n();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} ref={title} tabIndex={-1}>{t('invitations.list.title')}</h2>
      <p className="settings-help">{t('invitations.list.help')}</p>
      {message ? <div className="invite-notice"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      {invitations === null ? (
        <div className="invite-state-block">
          <ErrorState title={t('invitations.list.error.title')} headingLevel={3} live>{t('invitations.list.error.body')}</ErrorState>
        </div>
      ) : invitations.length === 0 ? (
        <div className="invite-state-block">
          <EmptyState title={t('invitations.list.empty.title')} headingLevel={3}>{t('invitations.list.empty.body')}</EmptyState>
        </div>
      ) : (
        <ul className="invite-list">
          {invitations.map((invitation) => (
            <InvitationItem key={invitation.invitationId} invitation={invitation} onMessage={onMessage} onDone={() => title.current?.focus()}/>
          ))}
        </ul>
      )}
    </section>
  );
}

function InvitationItem({invitation, onMessage, onDone}: {invitation: InvitationRow; onMessage: (message: ListMessage) => void; onDone: () => void}) {
  const {t} = useI18n();
  const name = invitation.kind === 'general' ? t('invitations.row.general') : (invitation.label ?? '');
  const created = formatCreatedAt(invitation.createdAt);
  return (
    <li className="invite-item">
      <div className="invite-item-head">
        <h3 className="invite-name"><bdi>{name}</bdi></h3>
        <StatusBadge tone={statusTones[invitation.state]}>{t(statusKeys[invitation.state])}</StatusBadge>
      </div>
      <dl className="invite-meta">
        <div>
          <dt>{t('invitations.row.kind')}</dt>
          <dd>{invitation.kind === 'general' ? t('invitations.row.kind.general') : t('invitations.row.kind.named')}</dd>
        </div>
        <div>
          <dt>{t('invitations.row.id')}</dt>
          <dd><LtrToken><code className="invite-id">{invitation.invitationId}</code></LtrToken></dd>
        </div>
        <div>
          <dt>{t('invitations.row.created')}</dt>
          <dd>{created ? <LtrToken><time dateTime={isoOf(invitation.createdAt)}>{created}</time></LtrToken> : '-'}</dd>
        </div>
      </dl>
      {invitation.state === 'unused' ? <RevokeControl invitation={invitation} name={name} onMessage={onMessage} onDone={onDone}/> : null}
    </li>
  );
}

/**
 * "Revoke" for an unused code. Pressing it asks first; the dialog starts on Cancel, so Enter does not revoke by
 * accident. A revoke that changes the list (done, already revoked, already used, no longer there) is announced,
 * shown above the list, and focus moves to the list's heading, because this button is gone once the row is no
 * longer unused. Every other answer (no fresh sign-in, a service that did not answer) stays beside the button.
 */
function RevokeControl({invitation, name, onMessage, onDone}: {invitation: InvitationRow; name: string; onMessage: (message: ListMessage) => void; onDone: () => void}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const form = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  const {state, formAction, pending, onSubmit} = useInvitationAction(revokeInvitationCode, (next) => {
    // These four answers all refresh the list, and the row (and so this button, and anything it said) may be gone
    // from it: a revoked code, a code already revoked or already used, or one that no longer exists.
    if (next.outcome === 'revoked' || next.outcome === 'already_revoked' || next.outcome === 'redeemed' || next.outcome === 'not_found') {
      const key: MessageKey = invitationMessageKeys[next.outcome];
      const text = t(key, {name});
      onMessage({tone: next.outcome === 'revoked' ? 'success' : next.outcome === 'not_found' ? 'warning' : 'info', text});
      announce(text, locale);
      onDone();
    }
    return next;
  });

  return (
    <div className="invite-actions">
      <form ref={form} action={formAction} onSubmit={onSubmit}>
        <input type="hidden" name="invitationId" value={invitation.invitationId}/>
        <Button
          variant="secondary"
          aria-label={t('invitations.row.revokeLabel', {name})}
          aria-disabled={pending ? true : undefined}
          onClick={() => !pending && setConfirming(true)}
        >
          {pending ? t('invitations.revoke.pending') : t('invitations.row.revoke')}
        </Button>
      </form>
      {pending ? null : <FailureNotice state={state}/>}
      {confirming ? (
        <ConfirmDialog
          title={t('invitations.revoke.title')}
          description={t('invitations.revoke.body', {name})}
          confirmLabel={t('invitations.revoke.confirm')}
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
