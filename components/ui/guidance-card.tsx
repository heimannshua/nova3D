'use client';

import {useRef} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {Locale, MessageKey, Translator} from '@/lib/i18n';
import {usePreferences, type PreferencesContextValue} from '../preferences-provider';
import {Button} from './button';
import {Explanation} from './explain';
import {Icon} from './icon';
import {useAnnounce} from './announcer';
import {mainContentId} from './skip-link';

const steps = [
  {title: 'guidance.step1.title', body: 'guidance.step1.body', technical: 'guidance.step1.technical'},
  {title: 'guidance.step2.title', body: 'guidance.step2.body', technical: 'guidance.step2.technical'},
  {title: 'guidance.step3.title', body: 'guidance.step3.body', technical: 'guidance.step3.technical'},
  {title: 'guidance.step4.title', body: 'guidance.step4.body', technical: 'guidance.step4.technical'},
  {title: 'guidance.step5.title', body: 'guidance.step5.body', technical: 'guidance.step5.technical'},
] as const satisfies readonly {title: MessageKey; body: MessageKey; technical: MessageKey}[];

type DismissInput = {
  setPreference: PreferencesContextValue['setPreference'];
  announce: (message: string, lang?: Locale) => void;
  t: Translator;
  locale: Locale;
  /** True when keyboard focus is inside the card, so removing the card would strand it. */
  cardHadFocus: boolean;
  focusMain: () => void;
};

/**
 * Dismisses the guidance and says so. If the browser refuses the cookie nothing changes: the card stays,
 * focus stays put, and the failure is announced like any other refused preference. After a successful
 * dismissal focus moves to the page content only when the card had it.
 */
export function dismissGuidance({setPreference, announce, t, locale, cardHadFocus, focusMain}: DismissInput): boolean {
  if (!setPreference('guidance', 'dismissed')) {
    announce(t('settings.announce.failed'), locale);
    return false;
  }
  announce(t('guidance.dismissed'), locale);
  if (cardHadFocus) focusMain();
  return true;
}

/**
 * First-use guidance in ordinary language, one step per workflow stage. It is dismissible, and
 * Settings can bring it back. Dismissal is a device preference, so it stays dismissed after a reload.
 */
export function GuidanceCard() {
  const {t, locale} = useI18n();
  const {preferences, setPreference} = usePreferences();
  const announce = useAnnounce();
  const card = useRef<HTMLElement>(null);

  if (preferences.guidance !== 'shown') return null;

  function dismiss() {
    dismissGuidance({
      setPreference,
      announce,
      t,
      locale,
      cardHadFocus: Boolean(card.current?.contains(document.activeElement)),
      focusMain: () => document.getElementById(mainContentId)?.focus(),
    });
  }

  return (
    <section ref={card} className="guidance-card" aria-labelledby="guidance-title" data-guidance="">
      <div className="guidance-header">
        <span className="guidance-spark"><Icon name="spark" size={18}/></span>
        <div>
          <p className="eyebrow">{t('guidance.eyebrow')}</p>
          <h2 id="guidance-title" className="guidance-title">{t('guidance.title')}</h2>
          <p className="guidance-intro">{t('guidance.intro')}</p>
        </div>
        <Button variant="quiet" icon="close" onClick={dismiss}>{t('guidance.dismiss')}</Button>
      </div>
      <ol className="guidance-steps">
        {steps.map((step) => (
          <li key={step.title} className="guidance-step">
            <h3 className="guidance-step-title">{t(step.title)}</h3>
            <p className="guidance-step-body"><Explanation simple={step.body} technical={step.technical}/></p>
          </li>
        ))}
      </ol>
    </section>
  );
}
