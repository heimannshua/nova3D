import {defaultLocale, type Locale} from './locales';
import {en, type MessageKey} from './en';
import {he} from './he';
import type {Message, Params} from './types';

export {locales, defaultLocale, localeInfo, isLocale, directionOf, type Locale, type Direction} from './locales';
export {negotiateLocale, resolveLocale} from './negotiate';
export {spanAttributes, neutralTokenAttributes, isolateLtr} from './bidi';
export type {MessageKey} from './en';
export type {Message, Params, PluralForms} from './types';

// English defines the keys; Hebrew is typed against them, so a missing Hebrew key fails the type
// check as well as the parity test.
export const catalogs: Record<Locale, Record<MessageKey, Message>> = {en, he};

const pluralRules = new Map<Locale, Intl.PluralRules>();

function pick(locale: Locale, message: Message, params?: Params): string {
  if (typeof message === 'string') return message;
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  const count = Number(params?.count ?? 0);
  return message[rules.select(Number.isFinite(count) ? count : 0)] ?? message.other ?? '';
}

// First strong isolate and pop directional isolate. A name or title put into a sentence is wrapped in
// them so its own direction cannot reorder the words around it (a Latin name inside Hebrew, or the reverse).
const FSI = '\u2068';
const PDI = '\u2069';

export type TranslateOptions = {
  /** Wrap string parameters in FSI and PDI (the default). Numbers are never wrapped. Pass false for plain text. */
  isolate?: boolean;
};

/**
 * Looks a message up for a language and fills its {placeholders}. It never throws: a key missing from
 * this language falls back to the default language's message, and a key missing from both comes back as
 * the key itself, so a gap in a catalog shows up on screen instead of breaking the page.
 */
export function translate(locale: Locale, key: MessageKey, params?: Params, options: TranslateOptions = {}): string {
  const message = catalogs[locale]?.[key] ?? catalogs[defaultLocale][key];
  if (message === undefined) return key;
  const text = pick(locale, message, params);
  if (!params) return text;
  const isolate = options.isolate !== false;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    if (!Object.hasOwn(params, name)) return placeholder;
    const value = params[name];
    return typeof value === 'string' && isolate ? `${FSI}${value}${PDI}` : String(value);
  });
}

export type Translator = (key: MessageKey, params?: Params, options?: TranslateOptions) => string;

export function createTranslator(locale: Locale): Translator {
  return (key, params, options) => translate(locale, key, params, options);
}

/** The {placeholder} names a message uses, across all of its plural forms. */
export function placeholdersOf(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  const names = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(/\{(\w+)\}/g)) names.add(match[1]);
  return [...names].sort();
}
