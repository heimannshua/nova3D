import {getRequestPreferences} from '../preferences.server';
import {createTranslator, directionOf, type Direction, type Locale, type Translator} from './index';

/** Server-side counterpart of useI18n: the request's language, direction and translator. */
export async function getI18n(): Promise<{locale: Locale; dir: Direction; t: Translator}> {
  const {preferences} = await getRequestPreferences();
  return {locale: preferences.locale, dir: directionOf(preferences.locale), t: createTranslator(preferences.locale)};
}
