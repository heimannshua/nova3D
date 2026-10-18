'use client';

import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {maxPersonalizationText, type StoredPersonalization} from '@/lib/request-intake';

const reasonKeys = {
  no_quoted_text: 'request.personalization.reason.no_quoted_text',
  several_texts: 'request.personalization.reason.several_texts',
  text_too_long: 'request.personalization.reason.text_too_long',
  text_invalid: 'request.personalization.reason.text_invalid',
  conflicting_styles: 'request.personalization.reason.conflicting_styles',
  image_direct_has_no_surfaces: 'request.personalization.reason.image_direct_has_no_surfaces',
} as const satisfies Record<NonNullable<StoredPersonalization['reason']>, MessageKey>;

/**
 * A personalization wish in words, as the screens that show it agree on it (C-06 before Confirm, the Project page after):
 *  - none: nothing was asked;
 *  - applied: the text to add, its style (raised or recessed), and that it will be marked user-added;
 *  - not applied: the reason, in plain words, and what the person wrote. A wish that is not applied can still be confirmed, and is
 *    recorded as not applied with that reason.
 * The text and the wording are the person's own, so each sits in a <bdi>: its direction cannot reorder the words around it.
 */
export function PersonalizationSummary({wish}: {wish: StoredPersonalization}) {
  const {t} = useI18n();
  if (wish.applied && wish.text && wish.style) {
    return (
      <div className="wish">
        <p>
          {t('request.personalization.appliedLead')} <bdi className="wish-text">{wish.text}</bdi>
          {' · '}
          {t('request.personalization.styleLead')} {t(wish.style === 'recessed' ? 'request.personalization.style.recessed' : 'request.personalization.style.raised')}
        </p>
        <p className="project-muted">{t('request.personalization.userAdded')}</p>
        <p className="project-muted">{t('request.personalization.unusedNote')}</p>
      </div>
    );
  }
  if (wish.wording && wish.reason) {
    return (
      <div className="wish">
        <p>{t('request.personalization.notApplied', {reason: t(reasonKeys[wish.reason], {max: maxPersonalizationText}, {isolate: false})}, {isolate: false})}</p>
        <p className="project-muted">{t('request.personalization.youWrote')} <bdi>{wish.wording}</bdi></p>
        <p className="project-muted">{t('request.personalization.declinedNote')}</p>
      </div>
    );
  }
  return <p>{t('request.personalization.none')}</p>;
}
