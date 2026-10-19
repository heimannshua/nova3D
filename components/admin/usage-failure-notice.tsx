'use client';

import {useI18n} from '@/lib/i18n/react';
import {usageFailureKey, type UsageActionState} from '@/lib/usage-view';
import {Notice} from '../ui/states';
import {StepUpNotice} from './step-up-notice';

/**
 * What an answer that changed nothing says (Story 2.4), or nothing for any other answer: no valid fresh sign-in (with the way to get one when
 * there is none or it ran out), an Account that is not the Administrator, or a service that did not answer (and, when the change may have been
 * made anyway, to check the list before trying again). Shown as an alert, because it appears in answer to something the person did.
 */
export function UsageFailureNotice({state}: {state: UsageActionState}) {
  const {t} = useI18n();
  if (state.outcome === 'refused' && state.stepUp) return <StepUpNotice neededKey="usage.confirm.needed" refusedKey="usage.error.needsConfirm"/>;
  if (state.outcome === 'refused' || state.outcome === 'unavailable') {
    return <div className="invite-notice"><Notice tone="danger" role="alert">{t(usageFailureKey(state))}</Notice></div>;
  }
  if (state.outcome === 'denied') return <div className="invite-notice"><Notice tone="danger" role="alert">{t('usage.error.denied')}</Notice></div>;
  return null;
}
