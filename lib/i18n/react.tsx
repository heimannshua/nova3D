'use client';

import {createContext, useContext, useMemo, type ReactNode} from 'react';
import {createTranslator, defaultLocale, directionOf, type Direction, type Locale, type Translator} from './index';

export type I18n = {locale: Locale; dir: Direction; t: Translator};

function build(locale: Locale): I18n {
  return {locale, dir: directionOf(locale), t: createTranslator(locale)};
}

// The default is English so a component rendered without a provider (a unit test, a fallback) still reads sensibly.
const I18nContext = createContext<I18n>(build(defaultLocale));

export function I18nProvider({locale, children}: {locale: Locale; children: ReactNode}) {
  const value = useMemo(() => build(locale), [locale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
