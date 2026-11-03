'use client';

import {useI18n} from '@/lib/i18n/react';
import {incidentFailureKey, usageFailureKey, type UsageActionState} from '@/lib/usage-view';
import {Notice} from '../ui/states';
import {StepUpNotice} from './step-up-notice';

/**
 * What an answer that changed nothing says (Story 2.4), or nothing for any other answer: no valid fresh sign-in (with the way to get one when
 * there is none or it ran out), an Account that is not the Administrator, or a service that did not answer (and, when the change may have been
 * made anyway, to check the list before trying again). Shown as an alert, because it appears in answer to something the person did.
 * `about="incident"` (Story 2.8) says the same about the clearing of an overrun incident, in the words of an incident.
 */
export function UsageFailureNotice({state, about = 'limit'}: {state: UsageActionState; about?: 'limit' | 'incident'}) {
  const {t} = useI18n();
  if (state.outcome === 'refused' && state.stepUp) return <StepUpNotice neededKey="usage.confirm.needed" refusedKey="usage.error.needsConfirm"/>;
  if (state.outcome === 'refused' || state.outcome === 'unavailable') {
    return <div className="invite-notice"><Notice tone="danger" role="alert">{t(about === 'incident' ? incidentFailureKey(state) : usageFailureKey(state))}</Notice></div>;
  }
  if (state.outcome === 'denied') return <div className="invite-notice"><Notice tone="danger" role="alert">{t(about === 'incident' ? 'usage.incident.error.denied' : 'usage.error.denied')}</Notice></div>;
  return null;
}
