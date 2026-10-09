import type {ElementType, ReactNode} from 'react';
import {neutralTokenAttributes, spanAttributes} from '@/lib/i18n/bidi';
import type {Locale} from '@/lib/i18n/locales';

/**
 * Text in a known language, with its own lang and dir, isolated from the text around it.
 * Hebrew and English spans stay distinct: a Hebrew citation in an English sentence (or the reverse)
 * keeps its own direction and cannot reorder its neighbours.
 */
export function TextSpan({lang, as: Tag = 'span', className, children}: {lang: Locale; as?: ElementType; className?: string; children: ReactNode}) {
  const attributes = spanAttributes(lang);
  return <Tag lang={attributes.lang} dir={attributes.dir} className={['text-span', className].filter(Boolean).join(' ')}>{children}</Tag>;
}

/** An ID, unit or file extension. It always reads left to right, even inside right-to-left text. */
export function LtrToken({children}: {children: ReactNode}) {
  return <bdi {...neutralTokenAttributes} className="ltr-token">{children}</bdi>;
}
