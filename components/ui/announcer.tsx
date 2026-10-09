'use client';

import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {useI18n} from '@/lib/i18n/react';
import type {Locale} from '@/lib/i18n/locales';

type Announce = (message: string, lang?: Locale) => void;

const AnnouncerContext = createContext<Announce>(() => undefined);

/** Say something to screen readers politely, without moving focus. The optional lang is the language of the message. */
export function useAnnounce(): Announce {
  return useContext(AnnouncerContext);
}

/**
 * One polite live region for the whole app. It is mounted from the first render, because a region
 * added at the same moment as its text is often not announced. Clearing it first lets the same
 * message be announced twice in a row.
 */
export function AnnouncerProvider({children}: {children: ReactNode}) {
  const {locale} = useI18n();
  const [announcement, setAnnouncement] = useState<{text: string; lang: Locale}>({text: '', lang: locale});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const announce = useCallback<Announce>(
    (message, lang) => {
      clearTimeout(timer.current);
      setAnnouncement({text: '', lang: lang ?? locale});
      timer.current = setTimeout(() => setAnnouncement({text: message, lang: lang ?? locale}), 60);
    },
    [locale],
  );

  return (
    <AnnouncerContext value={announce}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true" lang={announcement.lang} data-announcer="">
        {announcement.text}
      </div>
    </AnnouncerContext>
  );
}
