import {describe, expect, it} from 'vitest';
import {
  catalogs,
  createTranslator,
  directionOf,
  isolateLtr,
  localeInfo,
  locales,
  negotiateLocale,
  placeholdersOf,
  resolveLocale,
  spanAttributes,
  translate,
  type MessageKey,
} from '@/lib/i18n';
import {en} from '@/lib/i18n/en';
import {he} from '@/lib/i18n/he';

const keys = Object.keys(en) as MessageKey[];

describe('catalog parity (AR-28)', () => {
  it('has every English key in Hebrew and no extras', () => {
    expect(Object.keys(he).sort()).toEqual([...keys].sort());
  });

  it('fails when a key exists in English only (the matrix row: missing catalog key)', () => {
    const missing = keys.filter((key) => !(key in he));
    expect(missing).toEqual([]);
  });

  it('uses the same {placeholders} in both languages', () => {
    for (const key of keys) expect(placeholdersOf(he[key]), key).toEqual(placeholdersOf(en[key]));
  });

  it('has no empty messages', () => {
    for (const locale of locales) {
      for (const key of keys) {
        const message = catalogs[locale][key];
        const texts = typeof message === 'string' ? [message] : Object.values(message);
        for (const text of texts) expect(text.trim().length, `${locale}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('gives plural messages the forms their language needs', () => {
    for (const locale of locales) {
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      for (const key of keys) {
        const message = catalogs[locale][key];
        if (typeof message === 'string') continue;
        expect(message.other, `${locale}:${key}`).toBeTruthy();
        for (const category of Object.keys(message)) expect(categories, `${locale}:${key}:${category}`).toContain(category);
      }
    }
  });

  it('does not leave English words in the Hebrew catalog, apart from product names', () => {
    const allowed = /nova3D|Google/g;
    for (const key of keys) {
      const message = he[key];
      const texts = typeof message === 'string' ? [message] : Object.values(message);
      for (const text of texts) {
        const rest = text.replace(allowed, '').replace(/\{\w+\}/g, '');
        expect(rest, `he:${key}`).not.toMatch(/[A-Za-z]{2,}/);
      }
    }
  });
});

describe('locale negotiation (I/O matrix)', () => {
  it('uses the device language when it is supported', () => {
    expect(negotiateLocale('he-IL')).toBe('he');
    expect(negotiateLocale('he')).toBe('he');
    expect(negotiateLocale('en-GB,en;q=0.9')).toBe('en');
  });

  it('falls back to English for an unsupported language', () => {
    expect(negotiateLocale('fr-FR')).toBe('en');
    expect(negotiateLocale('fr-FR,de;q=0.8')).toBe('en');
    expect(negotiateLocale('')).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale(undefined)).toBe('en');
    expect(negotiateLocale('*')).toBe('en');
  });

  it('honours the order and q-values of the header', () => {
    expect(negotiateLocale('fr-FR,he;q=0.8,en;q=0.5')).toBe('he');
    expect(negotiateLocale('en;q=0.4,he;q=0.9')).toBe('he');
    expect(negotiateLocale('he;q=0.3,en;q=0.7')).toBe('en');
    expect(negotiateLocale('he,en')).toBe('he');
    expect(negotiateLocale('en,he')).toBe('en');
  });

  it('ignores q=0, malformed entries and garbage', () => {
    expect(negotiateLocale('he;q=0,en;q=0.5')).toBe('en');
    expect(negotiateLocale('he;q=banana')).toBe('en');
    expect(negotiateLocale(';;;,,,')).toBe('en');
    expect(negotiateLocale('he;q=2')).toBe('en');
  });

  it('treats an unparsable q-value as q=0, never as the top priority', () => {
    expect(negotiateLocale('he;q=banana,en;q=0.1')).toBe('en');
    expect(negotiateLocale('en;q=0.2,he;q=')).toBe('en');
    expect(negotiateLocale('he;q=1.5,en;q=0.2')).toBe('en');
    expect(negotiateLocale('he;q=-1')).toBe('en');
    expect(negotiateLocale('he;q=0.8')).toBe('he');
    expect(negotiateLocale('he;q=1.000')).toBe('he');
    expect(negotiateLocale('he; Q = 0.5')).toBe('he');
  });

  it('reads the legacy Hebrew code', () => {
    expect(negotiateLocale('iw-IL')).toBe('he');
  });

  it('lets a stored choice win over the device, and ignores a tampered one', () => {
    expect(resolveLocale('en', 'he-IL')).toBe('en');
    expect(resolveLocale('he', 'en-US')).toBe('he');
    expect(resolveLocale('fr', 'he-IL')).toBe('he');
    expect(resolveLocale('', 'he-IL')).toBe('he');
    expect(resolveLocale(undefined, undefined)).toBe('en');
  });
});

describe('translate', () => {
  it('fills placeholders, isolating each string value so its direction cannot reorder the sentence', () => {
    expect(translate('en', 'home.greeting', {name: 'Josh'})).toBe('Good morning, \u2068Josh\u2069');
    expect(translate('he', 'home.greeting', {name: 'Josh'})).toBe('בוקר טוב, \u2068Josh\u2069');
    // The reverse: a Hebrew name inside an English sentence.
    expect(translate('en', 'home.greeting', {name: 'יוסי'})).toBe('Good morning, \u2068יוסי\u2069');
  });

  it('leaves numbers as they are and lets a caller ask for plain text', () => {
    expect(translate('en', 'home.projectsDetail', {count: 3})).toBe('3 projects');
    expect(translate('en', 'home.greeting', {name: 'Josh'}, {isolate: false})).toBe('Good morning, Josh');
    expect(createTranslator('he')('home.greeting', {name: 'Josh'}, {isolate: false})).toBe('בוקר טוב, Josh');
  });

  it('only fills the placeholders the message has, and never reads inherited properties', () => {
    expect(translate('en', 'home.greeting', {other: 'x'})).toBe('Good morning, {name}');
    expect(translate('en', 'home.greeting', {})).toBe('Good morning, {name}');
    expect(translate('en', 'home.greeting', {name: 'a', constructor: 'b'} as never)).toBe('Good morning, \u2068a\u2069');
  });

  it('never throws for a missing key: default language first, then the key itself', () => {
    const missing = 'no.such.key' as MessageKey;
    expect(translate('en', missing)).toBe('no.such.key');
    expect(translate('he', missing, {name: 'x'})).toBe('no.such.key');
    // A key that only English has (a gap in a catalog) reads in English rather than breaking the page.
    const gap = 'meta.title' as MessageKey;
    const original = catalogs.he[gap];
    delete (catalogs.he as Partial<Record<MessageKey, unknown>>)[gap];
    try {
      expect(translate('he', gap)).toBe(translate('en', gap));
    } finally {
      catalogs.he[gap] = original;
    }
    // A count that is not a number still picks a form ("other") instead of throwing.
    expect(translate('he', 'home.projectsDetail', {count: Number.NaN})).toBe('NaN פרויקטים');
  });

  it('chooses English plural forms', () => {
    expect(translate('en', 'home.projectsDetail', {count: 1})).toBe('1 project');
    expect(translate('en', 'home.projectsDetail', {count: 3})).toBe('3 projects');
    expect(translate('en', 'home.projectsDetail', {count: 0})).toBe('0 projects');
  });

  it('chooses Hebrew plural forms, including the dual', () => {
    expect(translate('he', 'home.projectsDetail', {count: 1})).toBe('פרויקט אחד');
    expect(translate('he', 'home.projectsDetail', {count: 2})).toBe('שני פרויקטים');
    expect(translate('he', 'home.projectsDetail', {count: 3})).toBe('3 פרויקטים');
    expect(translate('he', 'home.projectsDetail', {count: 11})).toBe('11 פרויקטים');
  });

  it('leaves an unfilled placeholder visible instead of hiding the bug', () => {
    expect(translate('en', 'home.greeting')).toBe('Good morning, {name}');
  });
});

describe('locales and bidi helpers', () => {
  it('knows Hebrew is right to left and English left to right', () => {
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(localeInfo.he.nativeName).toBe('עברית');
  });

  it('gives each language span its own lang and dir', () => {
    expect(spanAttributes('he')).toEqual({lang: 'he', dir: 'rtl'});
    expect(spanAttributes('en')).toEqual({lang: 'en', dir: 'ltr'});
  });

  it('isolates a left-to-right token inside running text', () => {
    expect(isolateLtr('SAMPLE-001')).toBe('⁦SAMPLE-001⁩');
  });
});
