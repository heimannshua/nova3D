import {cookies, headers} from 'next/headers';
import {negotiateLocale, type Locale} from './i18n';
import {hasLocaleOverride, readPreferences, type Preferences} from './preferences';

export type RequestPreferences = {
  preferences: Preferences;
  /** The language the device asks for (Accept-Language), before any override. */
  deviceLocale: Locale;
  /** True when a valid language cookie overrides the device language. */
  localeOverridden: boolean;
};

/** Server reader: the four preference cookies plus Accept-Language. Reading them makes a page dynamic, which is intended. */
export async function getRequestPreferences(): Promise<RequestPreferences> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const read = (name: string) => cookieStore.get(name)?.value;
  const acceptLanguage = headerStore.get('accept-language');
  return {
    preferences: readPreferences(read, acceptLanguage),
    deviceLocale: negotiateLocale(acceptLanguage),
    localeOverridden: hasLocaleOverride(read),
  };
}
