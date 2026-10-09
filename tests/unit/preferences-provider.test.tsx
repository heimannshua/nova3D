import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const router = vi.hoisted(() => ({refresh: vi.fn()}));
vi.mock('next/navigation', () => ({useRouter: () => router, usePathname: () => '/'}));

import {PreferencesProvider, usePreferences, type PreferencesContextValue} from '@/components/preferences-provider';
import type {Locale} from '@/lib/i18n';
import {defaultPreferences, readRawCookie, type CookieJar, type Preferences} from '@/lib/preferences';

// A stand-in for the browser: document.cookie that can accept, refuse or half-accept writes, plus the
// <html> element the provider mirrors the choice onto.
type Behaviour = {writes: boolean; deletes: boolean};

function installBrowser(initial: Record<string, string>, behaviour: Behaviour, protocol = 'http:') {
  const jar = new Map(Object.entries(initial));
  const writes: string[] = [];
  const root = {lang: 'en', dir: 'ltr', dataset: {} as Record<string, string>};
  const document = {documentElement: root};
  Object.defineProperty(document, 'cookie', {
    get: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
    set: (cookie: string) => {
      writes.push(cookie);
      const [pair, ...attributes] = cookie.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1);
      const expiring = value === '' || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
      if (expiring) {
        if (behaviour.deletes) jar.delete(name);
      } else if (behaviour.writes) {
        jar.set(name, value);
      }
    },
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('location', {protocol});
  return {jar, root, writes};
}

function mount(preferences: Partial<Preferences>, options: {deviceLocale?: Locale; localeOverridden?: boolean} = {}) {
  let context!: PreferencesContextValue;
  function Capture() {
    context = usePreferences();
    return null;
  }
  const initial = {locale: 'en' as Locale, ...defaultPreferences, ...preferences};
  renderToStaticMarkup(
    <PreferencesProvider initial={initial} deviceLocale={options.deviceLocale ?? 'en'} localeOverridden={options.localeOverridden ?? false}>
      <Capture/>
    </PreferencesProvider>,
  );
  return context;
}

beforeEach(() => router.refresh.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('preference provider: the cookie is read back raw (Story 1.2 review)', () => {
  it('stores an accepted choice, mirrors it onto <html> and refreshes the server render', () => {
    const {jar, root} = installBrowser({}, {writes: true, deletes: true});
    const context = mount({});
    expect(context.setPreference('theme', 'dark')).toBe(true);
    expect(jar.get('nova3d-theme')).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('adds Secure on https only', () => {
    const https = installBrowser({}, {writes: true, deletes: true}, 'https:');
    mount({}).setPreference('detail', 'technical');
    expect(https.writes[0]).toBe('nova3d-detail=technical; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
    const http = installBrowser({}, {writes: true, deletes: true}, 'http:');
    mount({}).setPreference('detail', 'technical');
    expect(http.writes[0]).not.toContain('Secure');
  });

  it('reports a refused cookie and changes nothing', () => {
    const {root} = installBrowser({}, {writes: false, deletes: true});
    const context = mount({});
    expect(context.setPreference('theme', 'dark')).toBe(false);
    expect(root.dataset.theme).toBeUndefined();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('catches a refused cookie even when the value chosen is the default', () => {
    // A parsed read-back would fall back to "light" and wrongly report success.
    const {root} = installBrowser({}, {writes: false, deletes: true});
    const context = mount({});
    expect(context.setPreference('theme', 'light')).toBe(false);
    expect(context.setPreference('detail', 'simple')).toBe(false);
    expect(context.setPreference('guidance', 'shown')).toBe(false);
    expect(root.dataset.theme).toBeUndefined();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('accepts a default-equal value when the browser really stored it', () => {
    const {jar} = installBrowser({}, {writes: true, deletes: true});
    expect(mount({}).setPreference('theme', 'light')).toBe(true);
    expect(jar.get('nova3d-theme')).toBe('light');
  });

  it('catches a refused language cookie even when it equals the device language', () => {
    const {root} = installBrowser({}, {writes: false, deletes: true});
    const context = mount({locale: 'en'}, {deviceLocale: 'en'});
    expect(context.setLocale('en')).toBeNull();
    expect(root.lang).toBe('en');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('stores an accepted language and mirrors lang and dir', () => {
    const {jar, root} = installBrowser({}, {writes: true, deletes: true});
    expect(mount({}).setLocale('he')).toBe('he');
    expect(jar.get('nova3d-locale')).toBe('he');
    expect(root.lang).toBe('he');
    expect(root.dir).toBe('rtl');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('hands the language back to the device only when the override cookie is really gone', () => {
    const {jar, root} = installBrowser({'nova3d-locale': 'he'}, {writes: true, deletes: true});
    root.lang = 'he';
    root.dir = 'rtl';
    const context = mount({locale: 'he'}, {deviceLocale: 'en', localeOverridden: true});
    expect(context.setLocale('device')).toBe('en');
    expect(jar.has('nova3d-locale')).toBe(false);
    expect(root.lang).toBe('en');
    expect(root.dir).toBe('ltr');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('reports failure and applies nothing when the override cookie cannot be removed', () => {
    const {jar, root} = installBrowser({'nova3d-locale': 'he'}, {writes: true, deletes: false});
    root.lang = 'he';
    root.dir = 'rtl';
    const context = mount({locale: 'he'}, {deviceLocale: 'en', localeOverridden: true});
    expect(context.setLocale('device')).toBeNull();
    expect(jar.get('nova3d-locale')).toBe('he');
    expect(root.lang).toBe('he');
    expect(root.dir).toBe('rtl');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('reading cookies through a jar', () => {
  const jarOf = (cookie: string): CookieJar => ({read: () => cookie, write: () => undefined});

  it('returns the raw value, not a validated one', () => {
    expect(readRawCookie('nova3d-theme', jarOf('nova3d-theme=neon; other=1'))).toBe('neon');
    expect(readRawCookie('nova3d-theme', jarOf('other=1'))).toBeUndefined();
    expect(readRawCookie('nova3d-theme', jarOf(''))).toBeUndefined();
  });
});
