import {directionOf, type Direction, type Locale} from './locales';

/**
 * The attributes a span needs so text in another language keeps its own direction. Hebrew and English
 * spans never inherit each other's lang or dir, and the CSS isolates them (unicode-bidi: isolate) so a
 * Hebrew citation inside an English sentence cannot reorder the words around it.
 */
export function spanAttributes(locale: Locale): {lang: Locale; dir: Direction} {
  return {lang: locale, dir: directionOf(locale)};
}

/**
 * IDs, units, file extensions and the like read left to right even inside right-to-left text. Rendered
 * in a <bdi dir="ltr"> they cannot be reordered by the neighbouring words.
 */
export const neutralTokenAttributes = {dir: 'ltr'} as const;

/**
 * For text that is joined into a sentence (a catalog placeholder), where no element can wrap it:
 * left-to-right isolate (U+2066) and pop (U+2069) keep an ID, unit or file name in reading order.
 */
export function isolateLtr(text: string): string {
  return `\u2066${text}\u2069`;
}
