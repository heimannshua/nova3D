'use client';

import {useCallback, useRef, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {Confirmation, InvitationRow, IssuedCode} from '@/lib/invitations';
import {Notice} from '../ui/states';
import {CodeReveal} from './code-reveal';
import {GeneralCodePanel} from './general-code-panel';
import {InvitationList, type ListMessage} from './invitation-list';
import {NamedCodeForm} from './named-code-form';
import {StepUpNotice} from './step-up-notice';

/**
 * The Administrator's invitation page (AD-01, Story 1.11). It is a client component so its words change the moment
 * the language does; the server page passes it the list and whether the Administrator has just confirmed it is them.
 *
 * The codes that were just made are kept here, in memory, newest first, and nowhere else: a second code made before
 * the first was hidden does not take the first one's place. Leaving the page loses them, which is what "shown once"
 * means. The list below them never holds a code.
 */
export function InvitationsContent({invitations, confirmation}: {invitations: InvitationRow[] | null; confirmation: Confirmation}) {
  const {t} = useI18n();
  const title = useRef<HTMLHeadingElement>(null);
  const [made, setMade] = useState<IssuedCode[]>([]);
  const [message, setMessage] = useState<ListMessage | null>(null);

  const reveal = useCallback((code: IssuedCode) => {
    setMade((list) => (list.some((item) => item.invitationId === code.invitationId) ? list : [code, ...list]));
  }, []);
  const hide = (invitationId: string) => {
    setMade((list) => list.filter((item) => item.invitationId !== invitationId));
    // The panel that had focus is gone: the page's own heading is the nearest stable place.
    title.current?.focus();
  };

  // Whether a general code is waiting, or null when the list could not be read: then nothing is claimed either way.
  const waiting = invitations === null ? null : invitations.some((invitation) => invitation.kind === 'general' && invitation.state === 'unused');

  return (
    <div className="page page-narrow">
      <p className="eyebrow">{t('invitations.eyebrow')}</p>
      <h1 ref={title} tabIndex={-1}>{t('invitations.title')}</h1>
      <p className="lede">{t('invitations.lede')}</p>
      {confirmation === 'needed' ? <StepUpNotice refused={false}/> : null}
      {confirmation === 'confirmed' ? <div className="invite-notice"><Notice tone="success">{t('invitations.confirm.ok')}</Notice></div> : null}
      {made.length > 0 ? (
        <div className="settings-form">
          {made.map((item) => <CodeReveal key={item.invitationId} item={item} onHide={() => hide(item.invitationId)}/>)}
        </div>
      ) : null}
      <div className="settings-form">
        <NamedCodeForm onIssued={reveal}/>
        <GeneralCodePanel waiting={waiting} onIssued={reveal}/>
        <InvitationList invitations={invitations} message={message} onMessage={setMessage}/>
      </div>
    </div>
  );
}
