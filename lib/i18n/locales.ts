// The supported interface languages. Adding a third language is an "ask first" decision (Story 1.2),
// so this list is deliberately closed: every consumer derives from it.

export const locales = ['en', 'he'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export type Direction = 'ltr' | 'rtl';

// nativeName is the language's own name, shown the same way in every interface language so a reader
// can always find theirs. It is rendered inside a span carrying that language's own lang and dir.
export const localeInfo: Record<Locale, {nativeName: string; dir: Direction}> = {
  en: {nativeName: 'English', dir: 'ltr'},
  he: {nativeName: 'עברית', dir: 'rtl'},
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): Direction {
  return localeInfo[locale].dir;
}
