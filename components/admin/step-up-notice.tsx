'use client';

import {useI18n} from '@/lib/i18n/react';
import {stepUpUrl} from '@/lib/step-up';
import {LinkButton} from '../ui/button';
import {Notice} from '../ui/states';

/**
 * The way to a fresh sign-in (Story 1.11): a link to the step-up for administration, which returns here once the person
 * has signed in again. The server derives the return path from the class; nothing in this link says where to come back
 * to. Two uses. Beforehand, when the page saw no valid marker: "changing codes needs a fresh sign-in", as a note. After
 * a change was refused for want of one: "your fresh sign-in is missing or has run out, so nothing was changed", as an
 * alert, because it answers something the person did.
 */
export function StepUpNotice({refused = true}: {refused?: boolean}) {
  const {t} = useI18n();
  return (
    <div className="invite-notice">
      <Notice
        tone="warning"
        role={refused ? 'alert' : undefined}
        action={<LinkButton href={stepUpUrl('administration')} variant="secondary" prefetch={false}>{t('invitations.confirm.action')}</LinkButton>}
      >
        {t(refused ? 'invitations.error.needsConfirm' : 'invitations.confirm.needed')}
      </Notice>
    </div>
  );
}
