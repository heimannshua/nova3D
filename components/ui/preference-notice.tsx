'use client';

import {useEffect, useRef} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {usePreferences} from '../preferences-provider';
import {useAnnounce} from './announcer';
import {Button} from './button';
import {mainContentId} from './skip-link';
import {Notice} from './states';

type DismissInput = {
  dismiss: () => void;
  /** True when keyboard focus is inside the notice, so removing it would strand it. */
  noticeHadFocus: boolean;
  focusMain: () => void;
};

/**
 * Puts the failed-save message away. The button that was pressed goes with it, and focus on an element that is
 * removed falls to the top of the document, so when the notice had focus it moves to the page content, like
 * dismissing the first-use introduction does (components/ui/guidance-card.tsx).
 */
export function dismissSaveNotice({dismiss, noticeHadFocus, focusMain}: DismissInput) {
  dismiss();
  if (noticeHadFocus) focusMain();
}

/** Whether a failure still has to be announced: it is a failure (not 0), and not the one that already was. */
export function failureToAnnounce(saveFailure: number, announced: number) {
  return saveFailure > 0 && saveFailure !== announced;
}

/**
 * Says so when a change could not be saved to the Account's record and was undone (Story 1.4d): in the page's one
 * live region, once for each failure, and in words on the screen until the next change is saved or the person puts
 * it away. The words have no role of their own, so a screen reader hears them once. Nothing renders while every
 * save has worked. It sits in a region of its own (named by the message), so it is a landmark wherever it is: inside
 * the page content of the shell, or beside the page of a sign-in, registration or step-up screen, which have no shell.
 */
export function PreferenceSaveNotice() {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const {saveFailure, dismissSaveFailure} = usePreferences();
  const region = useRef<HTMLElement>(null);
  // The failure that has been announced. Announcing again whenever the language, the translator or the announcer
  // changes would repeat an old failure over the announcement of the language change that caused it.
  const announced = useRef(0);

  useEffect(() => {
    if (failureToAnnounce(saveFailure, announced.current)) {
      announced.current = saveFailure;
      announce(t('settings.announce.saveFailed'), locale);
    }
  }, [saveFailure, announce, t, locale]);

  if (saveFailure === 0) return null;
  return (
    <section ref={region} className="preference-notice" data-preference-notice="" aria-label={t('settings.saveFailed.title')}>
      <Notice
        tone="danger"
        action={
          <Button
            variant="quiet"
            icon="close"
            onClick={() =>
              dismissSaveNotice({
                dismiss: dismissSaveFailure,
                noticeHadFocus: Boolean(region.current?.contains(document.activeElement)),
                focusMain: () => document.getElementById(mainContentId)?.focus(),
              })
            }
          >
            {t('notice.dismiss')}
          </Button>
        }
      >
        {t('settings.announce.saveFailed')}
      </Notice>
    </section>
  );
}
