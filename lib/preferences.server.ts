import {cookies, headers} from 'next/headers';
import {getAccess} from '@/lib/auth';
import {negotiateLocale, type Locale} from './i18n';
import {hasLocaleOverride, preferencesFromRecord, readPreferences, type Preferences} from './preferences';
import {isAuthSessionCookieName} from './supabase/sign-out';

export type RequestPreferences = {
  preferences: Preferences;
  /** The language the device asks for (Accept-Language), before any override. */
  deviceLocale: Locale;
  /** True when a language is chosen (a valid language cookie, or an Account record whose language is not null) and so overrides the device language. */
  localeOverridden: boolean;
  /** True when the page is rendered for an active Account: a change is saved to its record (a Server Action), not only to this device's cookies. */
  accountBacked: boolean;
};

/**
 * What the request renders with (Stories 1.2 and 1.4d). The Account's stored record wins whenever the request
 * belongs to an active Account that has one: the same preferences follow the Account to every device, and a change
 * made on another device shows on the next navigation with no cookie plumbing. Everything else is served by the
 * four device cookies plus Accept-Language: the sign-in page, the design kit while signed out, an Account with no
 * record yet (its first navigation adopts the cookies, in the proxy), and any request whose Account could not be
 * read or is not active, which falls back to the cookies. Of those, only the Account that could not be READ (an
 * outage) is still `accountBacked`: it may have a record, so its changes must be saved to it or fail visibly.
 *
 * The Account is asked only when the request carries an Auth session cookie, so the sign-in page and the kit cost
 * nothing signed out. `getAccess` is memoized for a render, so the layout, the metadata and the page share one
 * answer: for a private page this adds no call. Reading the request makes every page dynamic, which is intended.
 */
export async function getRequestPreferences(): Promise<RequestPreferences> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const read = (name: string) => cookieStore.get(name)?.value;
  const acceptLanguage = headerStore.get('accept-language');
  const deviceLocale = negotiateLocale(acceptLanguage);
  const fromCookies: RequestPreferences = {
    preferences: readPreferences(read, acceptLanguage),
    deviceLocale,
    localeOverridden: hasLocaleOverride(read),
    accountBacked: false,
  };

  if (!cookieStore.getAll().some(({name}) => isAuthSessionCookieName(name))) return fromCookies;
  const access = await getAccess().catch(() => null);
  // The Account could not be read (Auth or the database did not answer): the person may well have a record, so a
  // change goes through the Server Action, which fails visibly and is undone, instead of being written to the
  // cookie alone and silently overridden by the record later. The page itself renders from the cookies.
  if (access === null || access.state === 'unavailable') return {...fromCookies, accountBacked: true};
  // Every other answer is a settled one: signed out, a session that ended, no Account, a disabled Account, a changed
  // Google identity. None of them has a record to save to, so a choice stays on this device.
  if (access.state !== 'active') return fromCookies;

  const record = access.account.preferences;
  if (!record) return {...fromCookies, accountBacked: true};
  return {preferences: preferencesFromRecord(record, acceptLanguage), deviceLocale, localeOverridden: record.locale !== null, accountBacked: true};
}
