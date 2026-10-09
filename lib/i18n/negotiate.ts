import {defaultLocale, isLocale, type Locale} from './locales';

// Legacy and regional tags that mean one of the supported languages. "iw" is the old code for Hebrew.
const aliases: Record<string, Locale> = {iw: 'he'};

function languageOf(tag: string): Locale | undefined {
  const primary = tag.trim().toLowerCase().split('-')[0];
  const mapped = aliases[primary] ?? primary;
  return isLocale(mapped) ? mapped : undefined;
}

/**
 * Picks a supported language from an Accept-Language header. The highest q-value wins and ties go to
 * the earlier tag. Unsupported languages, malformed entries, q=0 and "*" are ignored, so anything
 * unsupported (fr-FR, say) falls back to the default.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  let best: {locale: Locale; q: number} | undefined;
  for (const entry of acceptLanguage.split(',')) {
    const [tag, ...params] = entry.split(';');
    const locale = languageOf(tag);
    if (!locale) continue;
    let q = 1;
    for (const param of params) {
      // A q-value that is present but unparsable means "no preference": it counts as 0, never as the top priority.
      const match = /^\s*q\s*=\s*(.*?)\s*$/i.exec(param);
      if (match) q = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1]) ? Number(match[1]) : 0;
    }
    if (!Number.isFinite(q) || q <= 0 || q > 1) continue;
    if (!best || q > best.q) best = {locale, q};
  }
  return best?.locale ?? defaultLocale;
}

/** The stored choice wins when it is a supported language; anything else is ignored and the device decides. */
export function resolveLocale(stored: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  return isLocale(stored) ? stored : negotiateLocale(acceptLanguage);
}
