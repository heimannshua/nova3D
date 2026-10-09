import {isLocale, resolveLocale, type Locale} from './i18n';

// Device-stored preferences (Story 1.2). They live in first-party cookies so the server can render the
// right lang, dir and theme on the first paint. Story 1.4 adds the Account-owned record; until then the
// cookies are the whole store. Nothing here touches evidence, decisions or the database.

export const preferenceCookieNames = {
  locale: 'nova3d-locale',
  theme: 'nova3d-theme',
  detail: 'nova3d-detail',
  guidance: 'nova3d-guidance',
} as const;

export const themes = ['light', 'dark'] as const;
export const details = ['simple', 'technical'] as const;
export const guidanceStates = ['shown', 'dismissed'] as const;

export type Theme = (typeof themes)[number];
export type Detail = (typeof details)[number];
export type GuidanceState = (typeof guidanceStates)[number];

export type Preferences = {locale: Locale; theme: Theme; detail: Detail; guidance: GuidanceState};
export type PreferenceName = keyof Preferences;

// Light is the default and dark is chosen only explicitly, never from the OS colour scheme.
export const defaultPreferences: Omit<Preferences, 'locale'> = {theme: 'light', detail: 'simple', guidance: 'shown'};

export const cookieMaxAgeSeconds = 60 * 60 * 24 * 365;

const allowed: Record<PreferenceName, (value: unknown) => boolean> = {
  locale: isLocale,
  theme: (value) => (themes as readonly unknown[]).includes(value),
  detail: (value) => (details as readonly unknown[]).includes(value),
  guidance: (value) => (guidanceStates as readonly unknown[]).includes(value),
};

/** True when the value is in the allowed set for that preference. A tampered cookie is never allowed. */
export function isAllowedValue(name: PreferenceName, value: unknown): boolean {
  return allowed[name](value);
}

/** The cookie value for a preference when it is valid; undefined for anything else (tampered, empty, absent). */
export function parsePreference<N extends PreferenceName>(name: N, raw: string | null | undefined): Preferences[N] | undefined {
  return typeof raw === 'string' && allowed[name](raw) ? (raw as Preferences[N]) : undefined;
}

/** Parses a Cookie request header or document.cookie. The first cookie of a name wins, like the browser's own reads. */
export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name && !cookies.has(name)) cookies.set(name, part.slice(index + 1).trim());
  }
  return cookies;
}

export type CookieSource = (name: string) => string | undefined;

/** Turns a cookie reader and the device's Accept-Language into valid preferences. Invalid values fall back to the defaults. */
export function readPreferences(read: CookieSource, acceptLanguage: string | null | undefined): Preferences {
  return {
    locale: resolveLocale(parsePreference('locale', read(preferenceCookieNames.locale)), acceptLanguage),
    theme: parsePreference('theme', read(preferenceCookieNames.theme)) ?? defaultPreferences.theme,
    detail: parsePreference('detail', read(preferenceCookieNames.detail)) ?? defaultPreferences.detail,
    guidance: parsePreference('guidance', read(preferenceCookieNames.guidance)) ?? defaultPreferences.guidance,
  };
}

/** True when a valid language cookie overrides the device language. */
export function hasLocaleOverride(read: CookieSource): boolean {
  return parsePreference('locale', read(preferenceCookieNames.locale)) !== undefined;
}

/** The Set-Cookie / document.cookie string for a preference. Throws for a value outside the allowed set. */
export function serializePreference<N extends PreferenceName>(name: N, value: Preferences[N], options: {secure?: boolean} = {}): string {
  if (!allowed[name](value)) throw new Error(`Not an allowed ${name} preference`);
  return `${preferenceCookieNames[name]}=${value}; Path=/; Max-Age=${cookieMaxAgeSeconds}; SameSite=Lax${options.secure ? '; Secure' : ''}`;
}

/** The string that removes a preference cookie, so the default (or the device language) applies again. */
export function clearPreference(name: PreferenceName, options: {secure?: boolean} = {}): string {
  return `${preferenceCookieNames[name]}=; Path=/; Max-Age=0; SameSite=Lax${options.secure ? '; Secure' : ''}`;
}

// ---- Client reader and writer -------------------------------------------------------------------
// These touch document and run in the browser only. The server reader is in preferences.server.ts.

/** Where cookies live. In the browser it is document.cookie; tests pass a fake one. */
export type CookieJar = {read: () => string; write: (cookie: string) => void};

const documentJar: CookieJar = {
  read: () => (typeof document === 'undefined' ? '' : document.cookie),
  write: (cookie) => {
    document.cookie = cookie;
  },
};

const isSecureContext = () => typeof location !== 'undefined' && location.protocol === 'https:';

/** The raw, unvalidated value of one cookie, or undefined when it is not there. */
export function readRawCookie(name: string, jar: CookieJar = documentJar): string | undefined {
  return parseCookieHeader(jar.read()).get(name);
}

/** The languages the device asks for, most preferred first. An empty navigator.languages falls back to navigator.language. */
export function deviceLanguages(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.languages?.length ? navigator.languages.join(',') : navigator.language;
}

/** Reads the preferences from document.cookie. The device language comes from navigator. */
export function readClientPreferences(jar: CookieJar = documentJar): Preferences {
  const cookies = parseCookieHeader(jar.read());
  return readPreferences((name) => cookies.get(name), deviceLanguages());
}

/**
 * Stores a preference, then checks the cookie really is there with exactly that value. The raw value is
 * compared, not a parsed one that falls back to a default, so a browser that refuses the cookie is caught
 * even when the value chosen is the default or the device language.
 */
export function storePreference<N extends PreferenceName>(name: N, value: Preferences[N], jar: CookieJar = documentJar): boolean {
  jar.write(serializePreference(name, value, {secure: isSecureContext()}));
  return readRawCookie(preferenceCookieNames[name], jar) === value;
}

/** Removes a preference cookie (so the default, or the device language, applies) and checks it is really gone. */
export function removePreference(name: PreferenceName, jar: CookieJar = documentJar): boolean {
  jar.write(clearPreference(name, {secure: isSecureContext()}));
  return readRawCookie(preferenceCookieNames[name], jar) === undefined;
}
