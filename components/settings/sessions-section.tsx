'use client';

import {useEffect, useId} from 'react';
import {signOutOtherSessions} from '@/app/account/actions';
import {useI18n} from '@/lib/i18n/react';
import {useAnnounce} from '../ui/announcer';
import {Button} from '../ui/button';
import {Notice} from '../ui/states';
import {useSessionAction} from '../use-session-action';

/**
 * "Sign out my other sessions" (S-01): every other browser and device that is signed in to this Account is
 * signed out at once, and this one carries on. It says how many were signed out ("No other sessions were
 * signed in" for none). The action revokes the other sessions' grants; if that cannot be recorded nothing is
 * changed and the person is told, so they can try again. The pending state and the result are announced
 * through the page's one live region; a double press sends one request.
 */
export function SessionsSection() {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const headingId = useId();
  const {state, formAction, pending, onSubmit} = useSessionAction(signOutOtherSessions);
  const result =
    state.outcome === 'done' ? (state.count > 0 ? t('settings.sessions.done', {count: state.count}) : t('settings.sessions.none')) : state.outcome === 'unavailable' ? t('settings.sessions.failed') : null;

  useEffect(() => {
    if (pending) announce(t('settings.sessions.pending'), locale);
  }, [pending, announce, t, locale]);
  useEffect(() => {
    if (result) announce(result, locale);
  }, [state, result, announce, locale]);

  return (
    <div className="settings-form">
      <section className="settings-section" id="sessions" aria-labelledby={headingId}>
        <h2 id={headingId}>{t('settings.sessions.title')}</h2>
        <p className="settings-help">{t('settings.sessions.help')}</p>
        <form action={formAction} onSubmit={onSubmit} className="sessions-action">
          <Button variant="secondary" type="submit" aria-disabled={pending ? true : undefined}>
            {pending ? t('settings.sessions.pending') : t('settings.sessions.signOutOthers')}
          </Button>
          {!pending && result ? <Notice tone={state.outcome === 'done' ? 'success' : 'danger'}>{result}</Notice> : null}
        </form>
      </section>
    </div>
  );
}
