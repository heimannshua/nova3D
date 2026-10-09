'use client';

import Link from 'next/link';
import {useI18n} from '@/lib/i18n/react';

function Wordmark() {
  // The product name is the same in every language, so it is not catalog text.
  return (
    <>
      <span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>
      <span>nova<span className="brand-accent">3D</span></span>
    </>
  );
}

/** The wordmark as a link home, for the shell. */
export function Brand({className}: {className?: string}) {
  const {t} = useI18n();
  return <Link href="/" className={['brand', className].filter(Boolean).join(' ')} aria-label={t('brand.home')}><Wordmark/></Link>;
}

/** The wordmark as plain decoration, for the sign-in card where there is nowhere to go yet. */
export function BrandMark({className}: {className?: string}) {
  return <div className={['brand', className].filter(Boolean).join(' ')}><Wordmark/></div>;
}
