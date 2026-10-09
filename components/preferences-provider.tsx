'use client';

import {useRouter} from 'next/navigation';
import {createContext, useCallback, useContext, useMemo, useState, type ReactNode} from 'react';
import {defaultLocale, directionOf, type Locale} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {defaultPreferences, removePreference, storePreference, type Preferences} from '@/lib/preferences';

type NonLocaleName = 'theme' | 'detail' | 'guidance';

export type PreferencesContextValue = {
  preferences: Preferences;
  /** The language the device asks for, used while no language is chosen. */
  deviceLocale: Locale;
  localeOverridden: boolean;
  /** Stores a preference on this device. Returns false when the browser refused the cookie. */
  setPreference: <N extends NonLocaleName>(name: N, value: Preferences[N]) => boolean;
  /** Chooses a language, or hands the choice back to the device. Returns the language now in effect, or null if refused. */
  setLocale: (choice: Locale | 'device') => Locale | null;
};

export const fallbackPreferences: Preferences = {locale: defaultLocale, ...defaultPreferences};

// Without a provider (a unit test) the controls render with the defaults and change nothing.
export const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: fallbackPreferences,
  deviceLocale: defaultLocale,
  localeOverridden: false,
  setPreference: () => false,
  setLocale: () => null,
});

export function usePreferences(): PreferencesContextValue {
  return useContext(PreferencesContext);
}

type State = {preferences: Preferences; localeOverridden: boolean};

function sameState(a: State, b: State) {
  return a.localeOverridden === b.localeOverridden && (Object.keys(a.preferences) as (keyof Preferences)[]).every((key) => a.preferences[key] === b.preferences[key]);
}

// Mirrors the choice onto <html> straight away, so the page does not wait for the server round trip.
function applyToDocument(preferences: Preferences) {
  const root = document.documentElement;
  root.lang = preferences.locale;
  root.dir = directionOf(preferences.locale);
  root.dataset.theme = preferences.theme;
}

export function PreferencesProvider({
  initial,
  deviceLocale,
  localeOverridden,
  children,
}: {
  initial: Preferences;
  deviceLocale: Locale;
  localeOverridden: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const fromServer: State = {preferences: initial, localeOverridden};
  const [state, setState] = useState<State>(fromServer);
  const [seen, setSeen] = useState<State>(fromServer);
  // The server render is the truth. When a new one arrives (after router.refresh(), or another navigation), adopt it.
  if (!sameState(seen, fromServer)) {
    setSeen(fromServer);
    setState(fromServer);
  }

  const commit = useCallback(
    (next: State) => {
      setState(next);
      applyToDocument(next.preferences);
      router.refresh();
    },
    [router],
  );

  const setPreference = useCallback<PreferencesContextValue['setPreference']>(
    (name, value) => {
      // storePreference reads the cookie back: if the browser refused it, the page must not pretend it stuck.
      if (!storePreference(name, value)) return false;
      commit({...state, preferences: {...state.preferences, [name]: value}});
      return true;
    },
    [commit, state],
  );

  const setLocale = useCallback<PreferencesContextValue['setLocale']>(
    (choice) => {
      if (choice === 'device') {
        if (!removePreference('locale')) return null;
        commit({preferences: {...state.preferences, locale: deviceLocale}, localeOverridden: false});
        return deviceLocale;
      }
      if (!storePreference('locale', choice)) return null;
      commit({preferences: {...state.preferences, locale: choice}, localeOverridden: true});
      return choice;
    },
    [commit, deviceLocale, state],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({preferences: state.preferences, deviceLocale, localeOverridden: state.localeOverridden, setPreference, setLocale}),
    [state, deviceLocale, setPreference, setLocale],
  );

  return (
    <PreferencesContext value={value}>
      <I18nProvider locale={state.preferences.locale}>{children}</I18nProvider>
    </PreferencesContext>
  );
}
