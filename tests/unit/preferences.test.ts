import {describe, expect, it} from 'vitest';
import {
  adoptServerRender,
  applyChange,
  clearPreference,
  defaultPreferences,
  hasLocaleOverride,
  isAllowedValue,
  isPreferenceName,
  parseCookieHeader,
  parsePreference,
  parsePreferenceChange,
  parsePreferenceRecord,
  preferenceCookieNames,
  preferenceNames,
  preferencesFromRecord,
  readPreferences,
  recordFromCookies,
  sameState,
  serializePreference,
  undoChange,
  type PreferenceChange,
  type PreferenceState,
} from '@/lib/preferences';

const reader = (cookies: Record<string, string>) => (name: string) => cookies[name];

describe('preference cookies (AC-1, AC-2)', () => {
  it('names the four first-party cookies', () => {
    expect(preferenceCookieNames).toEqual({
      locale: 'nova3d-locale',
      theme: 'nova3d-theme',
      detail: 'nova3d-detail',
      guidance: 'nova3d-guidance',
    });
  });

  it('defaults to light, simple and guidance shown, and follows the device language', () => {
    expect(defaultPreferences).toEqual({theme: 'light', detail: 'simple', guidance: 'shown'});
    expect(readPreferences(reader({}), 'he-IL')).toEqual({locale: 'he', theme: 'light', detail: 'simple', guidance: 'shown'});
    expect(readPreferences(reader({}), 'fr-FR').locale).toBe('en');
  });

  it('never follows the operating system colour scheme: no cookie means light', () => {
    expect(readPreferences(reader({}), 'en-US').theme).toBe('light');
  });

  it('reads valid cookies, and the language cookie wins over the device', () => {
    const preferences = readPreferences(reader({'nova3d-locale': 'en', 'nova3d-theme': 'dark', 'nova3d-detail': 'technical', 'nova3d-guidance': 'dismissed'}), 'he-IL');
    expect(preferences).toEqual({locale: 'en', theme: 'dark', detail: 'technical', guidance: 'dismissed'});
    expect(hasLocaleOverride(reader({'nova3d-locale': 'en'}))).toBe(true);
  });

  it('ignores tampered values and uses the defaults without an error', () => {
    const tampered = {'nova3d-locale': 'fr', 'nova3d-theme': 'system', 'nova3d-detail': 'expert', 'nova3d-guidance': '<script>'};
    expect(readPreferences(reader(tampered), 'he-IL')).toEqual({locale: 'he', theme: 'light', detail: 'simple', guidance: 'shown'});
    expect(hasLocaleOverride(reader(tampered))).toBe(false);
    for (const value of ['', ' dark', 'DARK', 'dark;', '../dark', 'light,dark']) expect(parsePreference('theme', value), value).toBeUndefined();
    expect(parsePreference('theme', undefined)).toBeUndefined();
    expect(parsePreference('theme', null)).toBeUndefined();
  });

  it('knows the allowed set of each preference', () => {
    expect(isAllowedValue('locale', 'he')).toBe(true);
    expect(isAllowedValue('locale', 'fr')).toBe(false);
    expect(isAllowedValue('theme', 'dark')).toBe(true);
    expect(isAllowedValue('theme', 'auto')).toBe(false);
    expect(isAllowedValue('detail', 'technical')).toBe(true);
    expect(isAllowedValue('guidance', 'shown')).toBe(true);
    expect(isAllowedValue('guidance', 'hidden')).toBe(false);
  });

  it('serializes a first-party, lax, year-long cookie, and Secure only on https', () => {
    expect(serializePreference('theme', 'dark')).toBe('nova3d-theme=dark; Path=/; Max-Age=31536000; SameSite=Lax');
    expect(serializePreference('locale', 'he', {secure: true})).toBe('nova3d-locale=he; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
  });

  it('refuses to serialize a value outside the allowed set', () => {
    // @ts-expect-error the type already forbids it; the runtime check covers callers that bypass types
    expect(() => serializePreference('theme', 'system')).toThrow();
    // @ts-expect-error see above
    expect(() => serializePreference('locale', 'fr')).toThrow();
  });

  it('clears a cookie so the default applies again', () => {
    expect(clearPreference('locale')).toBe('nova3d-locale=; Path=/; Max-Age=0; SameSite=Lax');
  });

  it('parses a Cookie header, taking the first of a repeated name', () => {
    const cookies = parseCookieHeader('a=1; nova3d-theme=dark; nova3d-theme=light; broken; =x; b=2=3');
    expect(cookies.get('nova3d-theme')).toBe('dark');
    expect(cookies.get('a')).toBe('1');
    expect(cookies.get('b')).toBe('2=3');
    expect(cookies.has('broken')).toBe(false);
    expect(parseCookieHeader(undefined).size).toBe(0);
  });
});

describe('the Account-owned record (Story 1.4d)', () => {
  it('knows the four preference names, in the order the record lists them', () => {
    expect(preferenceNames).toEqual(['locale', 'theme', 'detail', 'guidance']);
    expect(isPreferenceName('theme')).toBe(true);
    for (const value of ['font', 'Theme', '', null, undefined, 7, {}, ['theme']]) expect(isPreferenceName(value), String(value)).toBe(false);
  });

  describe('parsePreferenceRecord reads what the database returns inside an authorization', () => {
    const record = {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'};

    it('reads a full record, with a language or with none', () => {
      expect(parsePreferenceRecord(record)).toEqual(record);
      expect(parsePreferenceRecord({...record, locale: null})).toEqual({...record, locale: null});
    });

    it('reads nothing as no record: null, undefined, anything that is not an object', () => {
      for (const value of [null, undefined, 'dark', 7, true, [], [record]]) expect(parsePreferenceRecord(value), String(value)).toBeNull();
    });

    it('treats a record with any value outside the allowed sets, or missing, as no record at all (the gate is not affected; the cookies serve the page)', () => {
      for (const bad of [
        {...record, locale: 'fr'},
        {...record, locale: undefined},
        {...record, locale: ''},
        {...record, theme: 'neon'},
        {...record, theme: null},
        {...record, detail: 'expert'},
        {...record, guidance: 'hidden'},
        {theme: 'dark', detail: 'simple', guidance: 'shown'},
        {locale: null, theme: 'dark', detail: 'simple'},
      ]) {
        expect(parsePreferenceRecord(bad), JSON.stringify(bad)).toBeNull();
      }
    });

    it('drops any extra field instead of passing it on', () => {
      expect(parsePreferenceRecord({...record, account_id: 'x', created_at: 'y'})).toEqual(record);
    });
  });

  describe('parsePreferenceChange checks what a client asked to save', () => {
    it('accepts each name with a value from its set, and a null language only', () => {
      expect(parsePreferenceChange('locale', 'he')).toEqual({name: 'locale', value: 'he'});
      expect(parsePreferenceChange('locale', null)).toEqual({name: 'locale', value: null});
      expect(parsePreferenceChange('theme', 'dark')).toEqual({name: 'theme', value: 'dark'});
      expect(parsePreferenceChange('detail', 'technical')).toEqual({name: 'detail', value: 'technical'});
      expect(parsePreferenceChange('guidance', 'dismissed')).toEqual({name: 'guidance', value: 'dismissed'});
    });

    it('refuses an unknown name, a value outside the set, a value for another name, and a null for anything but the language', () => {
      for (const [name, value] of [
        ['font', 'big'], ['Theme', 'dark'], [undefined, 'dark'], [null, 'dark'], [{}, 'dark'], ['', ''],
        ['locale', 'fr'], ['locale', ''], ['locale', undefined], ['locale', 'HE'],
        ['theme', 'neon'], ['theme', null], ['theme', undefined], ['theme', 'technical'],
        ['detail', null], ['detail', 'expert'], ['guidance', null], ['guidance', 'hidden'], ['guidance', {}],
      ] as [unknown, unknown][]) {
        expect(parsePreferenceChange(name, value), `${String(name)} = ${String(value)}`).toBeNull();
      }
    });
  });

  describe('what a page renders from a record', () => {
    it('is the record\'s values, with the language it chose', () => {
      expect(preferencesFromRecord({locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'}, 'en-US')).toEqual({locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'});
    });

    it('follows the device\'s language while the record has none: "match my device"', () => {
      const record = {locale: null, theme: 'light', detail: 'simple', guidance: 'shown'} as const;
      expect(preferencesFromRecord(record, 'he-IL,he;q=0.9').locale).toBe('he');
      expect(preferencesFromRecord(record, 'fr-FR').locale).toBe('en');
      expect(preferencesFromRecord(record, null).locale).toBe('en');
    });

    it('does not look at the cookies at all: a new device\'s own cookies do not change it', () => {
      const record = {locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown'} as const;
      expect(preferencesFromRecord(record, 'he-IL')).toEqual({locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown'});
    });
  });

  describe('what a first sign-in adopts from the device\'s cookies', () => {
    it('adopts every valid cookie', () => {
      expect(recordFromCookies(reader({'nova3d-locale': 'he', 'nova3d-theme': 'dark', 'nova3d-detail': 'technical', 'nova3d-guidance': 'dismissed'}))).toEqual({locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'});
    });

    it('adopts the defaults, with no language chosen, from a device with no cookies', () => {
      expect(recordFromCookies(reader({}))).toEqual({locale: null, theme: 'light', detail: 'simple', guidance: 'shown'});
    });

    it('treats a tampered cookie as absent: the default, and no language chosen', () => {
      expect(recordFromCookies(reader({'nova3d-locale': 'fr', 'nova3d-theme': 'system', 'nova3d-detail': 'expert', 'nova3d-guidance': '<script>'}))).toEqual({locale: null, theme: 'light', detail: 'simple', guidance: 'shown'});
      // One bad cookie does not spoil the good ones.
      expect(recordFromCookies(reader({'nova3d-locale': 'he', 'nova3d-theme': 'neon', 'nova3d-detail': 'technical'}))).toEqual({locale: 'he', theme: 'light', detail: 'technical', guidance: 'shown'});
    });
  });

  describe('a change while it is being saved, and its undo', () => {
    const state = (overrides: Partial<PreferenceState['preferences']> = {}, localeOverridden = false): PreferenceState => ({
      preferences: {locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown', ...overrides},
      localeOverridden,
    });
    const change = (name: PreferenceChange['name'], value: PreferenceChange['value']) => ({name, value}) as PreferenceChange;

    it('applies one preference and leaves the others', () => {
      expect(applyChange(state(), change('theme', 'dark'), 'en')).toEqual(state({theme: 'dark'}));
      expect(applyChange(state(), change('detail', 'technical'), 'en')).toEqual(state({detail: 'technical'}));
      expect(applyChange(state(), change('guidance', 'dismissed'), 'en')).toEqual(state({guidance: 'dismissed'}));
    });

    it('applies a language as chosen, and "match my device" as the device\'s language, not chosen', () => {
      expect(applyChange(state(), change('locale', 'he'), 'en')).toEqual(state({locale: 'he'}, true));
      expect(applyChange(state({locale: 'he'}, true), change('locale', null), 'en')).toEqual(state({locale: 'en'}, false));
      expect(applyChange(state({locale: 'he'}, true), change('locale', null), 'he')).toEqual(state({locale: 'he'}, false));
    });

    it('does not change the state it is given', () => {
      const before = state();
      applyChange(before, change('theme', 'dark'), 'en');
      expect(before).toEqual(state());
    });

    it('undoes the one preference to what it was', () => {
      const previous = state({detail: 'technical'});
      const next = applyChange(previous, change('theme', 'dark'), 'en');
      expect(undoChange(next, change('theme', 'dark'), previous, 'en')).toEqual(previous);
    });

    it('undoes a language to its earlier choice, or to following the device', () => {
      const chosen = state({locale: 'he'}, true);
      const matched = applyChange(chosen, change('locale', null), 'en');
      expect(undoChange(matched, change('locale', null), chosen, 'en')).toEqual(chosen);
      const following = state({locale: 'en'}, false);
      const switched = applyChange(following, change('locale', 'he'), 'en');
      expect(undoChange(switched, change('locale', 'he'), following, 'en')).toEqual(following);
    });

    it('leaves a preference alone if a later change to it has moved it on, and says nothing was undone', () => {
      const previous = state();
      const first = applyChange(previous, change('theme', 'dark'), 'en');
      const second = applyChange(first, change('theme', 'light'), 'en');
      // The first save fails while the second is on screen: nothing to undo, the same object comes back.
      expect(undoChange(second, change('theme', 'dark'), previous, 'en')).toBe(second);
      // A language moved on by a later choice is left too.
      const he = applyChange(previous, change('locale', 'he'), 'en');
      const device = applyChange(he, change('locale', null), 'en');
      expect(undoChange(device, change('locale', 'he'), previous, 'en')).toBe(device);
    });

    it('undoes only its own preference when others changed meanwhile', () => {
      const previous = state();
      const dark = applyChange(previous, change('theme', 'dark'), 'en');
      const both = applyChange(dark, change('detail', 'technical'), 'en');
      expect(undoChange(both, change('theme', 'dark'), previous, 'en')).toEqual(state({detail: 'technical'}));
    });
  });
});

describe('what a page does with a render from the server while saves are on their way (Story 1.4d review)', () => {
  const light: PreferenceState = {preferences: {locale: 'en', theme: 'light', detail: 'simple', guidance: 'shown'}, localeOverridden: false};
  const dark: PreferenceState = {preferences: {...light.preferences, theme: 'dark'}, localeOverridden: false};
  const onScreen: PreferenceState = {preferences: {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'shown'}, localeOverridden: true};

  it('compares what two states show', () => {
    expect(sameState(light, {...light, preferences: {...light.preferences}})).toBe(true);
    expect(sameState(light, dark)).toBe(false);
    expect(sameState(light, {...light, localeOverridden: true})).toBe(false);
  });

  it('adopts a new render when nothing is being saved: it is the truth', () => {
    expect(adoptServerRender({state: light, seen: light, fromServer: dark, saving: 0})).toEqual({state: dark, seen: dark});
  });

  it('notes a new render but keeps what is on screen while any save is on its way: the render was made before the server had those choices', () => {
    for (const saving of [1, 2, 5]) {
      const adopted = adoptServerRender({state: onScreen, seen: light, fromServer: dark, saving});
      expect(adopted.state, `${saving} saves`).toBe(onScreen);
      expect(adopted.seen, `${saving} saves`).toBe(dark);
    }
  });

  it('adopts the render that comes after the last save, even though an older one was noted and not adopted', () => {
    const noted = adoptServerRender({state: onScreen, seen: light, fromServer: dark, saving: 1});
    expect(noted.state).toBe(onScreen);
    const final = adoptServerRender({state: noted.state, seen: noted.seen, fromServer: onScreen, saving: 0});
    expect(final.state).toBe(onScreen);
    expect(final.seen).toBe(onScreen);
  });

  it('changes nothing for a render equal to the last one seen, whether or not saves are on their way', () => {
    for (const saving of [0, 3]) {
      const adopted = adoptServerRender({state: onScreen, seen: dark, fromServer: {preferences: {...dark.preferences}, localeOverridden: false}, saving});
      expect(adopted.state).toBe(onScreen);
      expect(adopted.seen).toBe(dark);
    }
  });

  it('never goes back to an older choice over a sequence of renders and saves', () => {
    // Three choices are on screen; two renders made before the server had them all arrive while saves are on their way.
    let current = {state: onScreen, seen: light};
    const shown: PreferenceState[] = [current.state];
    for (const [fromServer, saving] of [[dark, 3], [{preferences: {...dark.preferences, locale: 'he'}, localeOverridden: true} as PreferenceState, 1]] as const) {
      current = adoptServerRender({...current, fromServer, saving});
      shown.push(current.state);
    }
    expect(shown.every((state) => state === onScreen)).toBe(true);
  });
});
