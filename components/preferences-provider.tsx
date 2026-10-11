'use client';

import {useRouter} from 'next/navigation';
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {savePreference} from '@/app/account/preference-actions';
import {defaultLocale, directionOf, type Locale} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {attemptPreferenceSave, createPreferenceSaveQueue} from '@/lib/preference-actions';
import {
  adoptServerRender,
  applyChange,
  defaultPreferences,
  removePreference,
  storePreference,
  undoChange,
  type PreferenceChange,
  type PreferenceState,
  type Preferences,
} from '@/lib/preferences';

type NonLocaleName = 'theme' | 'detail' | 'guidance';

export type PreferencesContextValue = {
  preferences: Preferences;
  /** The language the device asks for, used while no language is chosen. */
  deviceLocale: Locale;
  localeOverridden: boolean;
  /**
   * Changes a preference. Signed out (or on a page with no Account) it is stored on this device and returns false
   * when the browser refused the cookie. For an active Account it is applied at once and returns true: the Account's
   * record is saved in the background, and if that fails the change is undone and `saveFailure` says so.
   */
  setPreference: <N extends NonLocaleName>(name: N, value: Preferences[N]) => boolean;
  /** Chooses a language, or hands the choice back to the device. Returns the language now in effect, or null if refused. */
  setLocale: (choice: Locale | 'device') => Locale | null;
  /** Counts the saves that failed and were undone; 0 until one does. It changes with every failure, so a second one is noticed. */
  saveFailure: number;
  /** Puts the failed-save message away. */
  dismissSaveFailure: () => void;
};

export const fallbackPreferences: Preferences = {locale: defaultLocale, ...defaultPreferences};

// Without a provider (a unit test) the controls render with the defaults and change nothing.
export const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: fallbackPreferences,
  deviceLocale: defaultLocale,
  localeOverridden: false,
  setPreference: () => false,
  setLocale: () => null,
  saveFailure: 0,
  dismissSaveFailure: () => undefined,
});

export function usePreferences(): PreferencesContextValue {
  return useContext(PreferencesContext);
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
  accountBacked = false,
  children,
}: {
  initial: Preferences;
  deviceLocale: Locale;
  localeOverridden: boolean;
  /** True when the page is rendered for an active Account: a change is saved to its record, not only to this device. */
  accountBacked?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const fromServer: PreferenceState = {preferences: initial, localeOverridden};
  const [state, setState] = useState<PreferenceState>(fromServer);
  const [seen, setSeen] = useState<PreferenceState>(fromServer);
  const [saveFailure, setSaveFailure] = useState(0);
  // How many saves are still on their way. While any is, a render from the server may predate a choice already on
  // screen, so it is noted but not adopted; the last save asks for a render that does include them all.
  const [saving, setSaving] = useState(0);
  // The latest state: a choice is built on the one before it even if the page has not rendered in between, and a
  // save that finishes after the render that started it undoes against what is on screen now.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  // Saves run one after another, in the order the choices were made, and the page asks the server for its own
  // render again only when the last of them is done, so a render that raced an earlier choice cannot undo a later one.
  // The queue cannot be broken by a save that throws or hangs (lib/preference-actions.ts).
  const [queue] = useState(() => createPreferenceSaveQueue((name, value) => attemptPreferenceSave(savePreference, name, value)));
  const failures = useRef(0);

  // The server render is the truth. When a new one arrives (after router.refresh(), or another navigation), adopt it,
  // unless a save is still on its way: then the choices on screen are newer than that render (adoptServerRender).
  const adopted = adoptServerRender({state, seen, fromServer, saving});
  if (adopted.seen !== seen) setSeen(adopted.seen);
  if (adopted.state !== state) setState(adopted.state);

  const commit = useCallback(
    (next: PreferenceState) => {
      latest.current = next;
      setState(next);
      applyToDocument(next.preferences);
      router.refresh();
    },
    [router],
  );

  // Applies the change at once, saves it to the Account's record in the background, and undoes it, saying so, if
  // the record could not hold it. The cookie copy is the server's to write once the record is saved.
  const saveToAccount = useCallback(
    (change: PreferenceChange) => {
      // From the latest state, not the render's: two choices made in quick succession both stand.
      const previous = latest.current;
      const next = applyChange(previous, change, deviceLocale);
      setState(next);
      latest.current = next;
      applyToDocument(next.preferences);
      queue.enqueue(change, {
        queued: () => setSaving((count) => count + 1),
        settled: (result, remaining) => {
          setSaving((count) => count - 1);
          // The session no longer has access (or Next is following a redirect): the page is on its way to sign-in.
          if (result === 'ended') return;
          if (result === 'saved') {
            setSaveFailure(0);
            if (remaining === 0) router.refresh();
            return;
          }
          const reverted = undoChange(latest.current, change, previous, deviceLocale);
          if (reverted !== latest.current) {
            latest.current = reverted;
            setState(reverted);
            applyToDocument(reverted.preferences);
          }
          failures.current += 1;
          setSaveFailure(failures.current);
        },
      });
    },
    [deviceLocale, queue, router],
  );

  const setPreference = useCallback<PreferencesContextValue['setPreference']>(
    (name, value) => {
      if (accountBacked) {
        saveToAccount({name, value} as PreferenceChange);
        return true;
      }
      // storePreference reads the cookie back: if the browser refused it, the page must not pretend it stuck.
      if (!storePreference(name, value)) return false;
      commit(applyChange(latest.current, {name, value} as PreferenceChange, deviceLocale));
      return true;
    },
    [accountBacked, commit, deviceLocale, saveToAccount],
  );

  const setLocale = useCallback<PreferencesContextValue['setLocale']>(
    (choice) => {
      if (accountBacked) {
        saveToAccount({name: 'locale', value: choice === 'device' ? null : choice});
        return choice === 'device' ? deviceLocale : choice;
      }
      if (choice === 'device') {
        if (!removePreference('locale')) return null;
        commit(applyChange(latest.current, {name: 'locale', value: null}, deviceLocale));
        return deviceLocale;
      }
      if (!storePreference('locale', choice)) return null;
      commit(applyChange(latest.current, {name: 'locale', value: choice}, deviceLocale));
      return choice;
    },
    [accountBacked, commit, deviceLocale, saveToAccount],
  );

  const dismissSaveFailure = useCallback(() => setSaveFailure(0), []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      preferences: state.preferences,
      deviceLocale,
      localeOverridden: state.localeOverridden,
      setPreference,
      setLocale,
      saveFailure,
      dismissSaveFailure,
    }),
    [state, deviceLocale, setPreference, setLocale, saveFailure, dismissSaveFailure],
  );

  return (
    <PreferencesContext value={value}>
      <I18nProvider locale={state.preferences.locale}>{children}</I18nProvider>
    </PreferencesContext>
  );
}
