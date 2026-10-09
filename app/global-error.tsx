'use client'; // Error boundaries must be Client Components

import {useEffect, useSyncExternalStore} from 'react';
import {GlobalErrorView} from '@/components/global-error-view';
import {defaultLocale} from '@/lib/i18n';
import {readClientPreferences} from '@/lib/preferences';
import './globals.css';

const subscribe = () => () => undefined;

// Replaces the root layout when it fails, so it cannot use the preference provider or the request. The
// language and theme come from the device preference cookies, validated against their allowed sets, and
// fall back to the device language and then English. The server render (and the first client render, which
// must match it) is English and light; useSyncExternalStore then switches to the stored choice.
export default function GlobalError({error, retry}: {error: Error & {digest?: string}; retry: () => void}) {
  const locale = useSyncExternalStore(subscribe, () => readClientPreferences().locale, () => defaultLocale);
  const theme = useSyncExternalStore(subscribe, () => readClientPreferences().theme, () => 'light' as const);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <GlobalErrorView locale={locale} theme={theme} retry={retry}/>;
}
