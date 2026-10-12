'use client';

import {useI18n} from '@/lib/i18n/react';
import {failureKey, type InvitationActionState} from '@/lib/invitations';
import {Notice} from '../ui/states';
import {StepUpNotice} from './step-up-notice';

/**
 * What an answer that changed nothing says (Story 1.11), or nothing for any other answer: no valid fresh sign-in (with
 * the way to get one when there is none or it ran out), an Account that is not the Administrator, or a service that did
 * not answer (and, when the change may have been made anyway, to check the list before trying again). Shown as an
 * alert, because it appears in answer to something the person did.
 */
export function FailureNotice({state}: {state: InvitationActionState}) {
  const {t} = useI18n();
  if (state.outcome === 'refused' && state.stepUp) return <StepUpNotice/>;
  if (state.outcome === 'refused' || state.outcome === 'unavailable') {
    return <div className="invite-notice"><Notice tone="danger" role="alert">{t(failureKey(state))}</Notice></div>;
  }
  if (state.outcome === 'denied') return <div className="invite-notice"><Notice tone="danger" role="alert">{t('invitations.error.denied')}</Notice></div>;
  return null;
}
