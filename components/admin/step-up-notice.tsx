'use client';

import type {MessageKey} from '@/lib/i18n';
import {useI18n} from '@/lib/i18n/react';
import {stepUpUrl} from '@/lib/step-up';
import {LinkButton} from '../ui/button';
import {Notice} from '../ui/states';

/**
 * The way to a fresh sign-in (Stories 1.11 and 1.5): a link to the step-up for administration, which returns to the
 * Administration index once the person has signed in again. The server derives the return path from the class; nothing in
 * this link says where to come back to. Two uses. Beforehand, when the page saw no valid marker: "changing codes needs a
 * fresh sign-in", as a note. After a change was refused for want of one: "your fresh sign-in is missing or has run out, so
 * nothing was changed", as an alert, because it answers something the person did. The words default to the invitation
 * page's; the Accounts page passes its own.
 */
export function StepUpNotice({
  refused = true,
  neededKey = 'invitations.confirm.needed',
  refusedKey = 'invitations.error.needsConfirm',
}: {
  refused?: boolean;
  neededKey?: MessageKey;
  refusedKey?: MessageKey;
}) {
  const {t} = useI18n();
  return (
    <div className="invite-notice">
      <Notice
        tone="warning"
        role={refused ? 'alert' : undefined}
        action={<LinkButton href={stepUpUrl('administration')} variant="secondary" prefetch={false}>{t('invitations.confirm.action')}</LinkButton>}
      >
        {t(refused ? refusedKey : neededKey)}
      </Notice>
    </div>
  );
}
