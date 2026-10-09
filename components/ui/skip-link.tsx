'use client';

import {useI18n} from '@/lib/i18n/react';

export const mainContentId = 'main-content';

/** The first thing a keyboard user can reach. It jumps over the navigation to the page content. */
export function SkipLink() {
  const {t} = useI18n();
  return <a className="skip-link" href={`#${mainContentId}`}>{t('a11y.skipToContent')}</a>;
}
