import {isLocale, resolveLocale, type Locale} from './i18n';

// Preferences (Stories 1.2 and 1.4d). Four first-party cookies serve pages with no Account (the sign-in page, the
// design kit) and are the copy a change writes, so the server can render the right lang, dir and theme on the
// first paint. For an active Account the Account-owned record (identity.account_preferences, returned by the live
// authorization on every request) wins whenever the Account has one; a person's first sign-in adopts the device's
// valid cookies into it. This module is the single definition of the allowed values: a test keeps the database's
// CHECK constraints in step with it. Nothing here touches evidence, decisions or the database.

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

/** The four preference names, in the order the record and the cookies list them. */
export const preferenceNames = Object.keys(preferenceCookieNames) as PreferenceName[];

export function isPreferenceName(value: unknown): value is PreferenceName {
  return typeof value === 'string' && (preferenceNames as readonly string[]).includes(value);
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

// ---- The Account-owned record (Story 1.4d) -----------------------------------------------------

/** The Account's stored preferences (identity.account_preferences). A null language follows the device (Accept-Language). */
export type PreferenceRecord = {locale: Locale | null; theme: Theme; detail: Detail; guidance: GuidanceState};

/** One change to the record. The language is the only preference that may be null: "match my device". */
export type PreferenceChange =
  | {name: 'locale'; value: Locale | null}
  | {name: 'theme'; value: Theme}
  | {name: 'detail'; value: Detail}
  | {name: 'guidance'; value: GuidanceState};

/**
 * The record the database returns inside an active authorization, or null for no record or anything that is not
 * one (a record is all four values, each allowed; a language of null is allowed). A record that cannot be read is
 * treated as no record, so the device's cookies serve the page and the gate is not affected.
 */
export function parsePreferenceRecord(value: unknown): PreferenceRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.locale !== null && !isLocale(raw.locale)) return null;
  if (!allowed.theme(raw.theme) || !allowed.detail(raw.detail) || !allowed.guidance(raw.guidance)) return null;
  return {locale: raw.locale, theme: raw.theme as Theme, detail: raw.detail as Detail, guidance: raw.guidance as GuidanceState};
}

/** A change a client asked for, checked against the allowed values; null for anything else (an unknown name, a value outside the set, a null for anything but the language). */
export function parsePreferenceChange(name: unknown, value: unknown): PreferenceChange | null {
  if (!isPreferenceName(name)) return null;
  if (name === 'locale') return value === null || isLocale(value) ? {name, value} : null;
  return allowed[name](value) ? ({name, value} as PreferenceChange) : null;
}

/** What to render for an Account that has a record: its values, with the device's language when the record's is null. */
export function preferencesFromRecord(record: PreferenceRecord, acceptLanguage: string | null | undefined): Preferences {
  return {locale: resolveLocale(record.locale, acceptLanguage), theme: record.theme, detail: record.detail, guidance: record.guidance};
}

/**
 * What a device's cookies become when a person's first sign-in adopts them. An absent or tampered cookie is the
 * default, and a language no valid cookie chose is null (follow the device), so an Account that arrives with no
 * cookies at all gets: no language choice, light, simple, shown.
 */
export function recordFromCookies(read: CookieSource): PreferenceRecord {
  return {
    locale: parsePreference('locale', read(preferenceCookieNames.locale)) ?? null,
    theme: parsePreference('theme', read(preferenceCookieNames.theme)) ?? defaultPreferences.theme,
    detail: parsePreference('detail', read(preferenceCookieNames.detail)) ?? defaultPreferences.detail,
    guidance: parsePreference('guidance', read(preferenceCookieNames.guidance)) ?? defaultPreferences.guidance,
  };
}

// ---- What a page knows while a change is saved (Story 1.4d) --------------------------------------

/** The preferences in effect on a page, and whether a language is chosen (as against following the device's). */
export type PreferenceState = {preferences: Preferences; localeOverridden: boolean};

/** The state after a change: a language of null hands the choice back to the device, whose language is `deviceLocale`. */
export function applyChange(state: PreferenceState, change: PreferenceChange, deviceLocale: Locale): PreferenceState {
  if (change.name === 'locale') return {preferences: {...state.preferences, locale: change.value ?? deviceLocale}, localeOverridden: change.value !== null};
  return {...state, preferences: {...state.preferences, [change.name]: change.value}};
}

/**
 * The state after a change that could not be saved is undone: the one preference goes back to what it was in
 * `previous`. If it has moved on since (a later change to the same preference was made while this one was being
 * saved) it is left as it is, and `current` itself is returned, so the caller can tell nothing was undone.
 */
export function undoChange(current: PreferenceState, change: PreferenceChange, previous: PreferenceState, deviceLocale: Locale): PreferenceState {
  const optimistic = applyChange(previous, change, deviceLocale);
  if (change.name === 'locale') {
    if (current.preferences.locale !== optimistic.preferences.locale || current.localeOverridden !== optimistic.localeOverridden) return current;
    return {preferences: {...current.preferences, locale: previous.preferences.locale}, localeOverridden: previous.localeOverridden};
  }
  if (current.preferences[change.name] !== optimistic.preferences[change.name]) return current;
  return {...current, preferences: {...current.preferences, [change.name]: previous.preferences[change.name]}};
}

/** Whether two states show the same thing. */
export function sameState(a: PreferenceState, b: PreferenceState): boolean {
  return a.localeOverridden === b.localeOverridden && (Object.keys(a.preferences) as (keyof Preferences)[]).every((key) => a.preferences[key] === b.preferences[key]);
}

/**
 * What a page does with the render the server has just sent it (the preferences the layout rendered). The server
 * render is the truth, so a new one is adopted: `seen` always becomes it, and so does what is on screen, unless
 * `saving` saves are still on their way, in which case the choices on screen are NEWER than that render (it was made
 * before the server had them), and it is noted and not adopted; the last save asks for a render that holds them all.
 * A render equal to the last one seen changes nothing. Pure, so the rule is tested without a browser. (Next.js also
 * drops a refresh that a later Server Action supersedes, so in practice this is the second line of defence.)
 */
export function adoptServerRender(input: {state: PreferenceState; seen: PreferenceState; fromServer: PreferenceState; saving: number}): {state: PreferenceState; seen: PreferenceState} {
  const {state, seen, fromServer, saving} = input;
  if (sameState(seen, fromServer)) return {state, seen};
  return {state: saving === 0 ? fromServer : state, seen: fromServer};
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
