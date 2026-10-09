import {describe, expect, it} from 'vitest';
import {
  clearPreference,
  defaultPreferences,
  hasLocaleOverride,
  isAllowedValue,
  parseCookieHeader,
  parsePreference,
  preferenceCookieNames,
  readPreferences,
  serializePreference,
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
