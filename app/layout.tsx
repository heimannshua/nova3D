import type {Metadata, Viewport} from 'next';
import type {ReactNode} from 'react';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {Shell} from '@/components/shell/shell';
import {SkipLink} from '@/components/ui/skip-link';
import {PreferencesProvider} from '@/components/preferences-provider';
import {createTranslator, directionOf} from '@/lib/i18n';
import {getRequestPreferences} from '@/lib/preferences.server';
import './globals.css';

// Lets the page use the whole screen on a phone with a notch or a home indicator; the shell pads for the
// safe areas itself (env(safe-area-inset-*)). Zoom is left alone: no maximum-scale, no user-scalable.
export const viewport: Viewport = {viewportFit: 'cover'};

export async function generateMetadata(): Promise<Metadata> {
  const {preferences} = await getRequestPreferences();
  const t = createTranslator(preferences.locale);
  return {
    title: {default: t('meta.title'), template: '%s · nova3D'},
    description: t('meta.description'),
  };
}

// The language, direction and theme are decided on the server from the device preference cookies
// (and Accept-Language), so the first HTML is already right and nothing flashes. Reading the request
// makes every page dynamic, which is acceptable for a private app. Light is the default; dark is only ever chosen.
export default async function RootLayout({children}: Readonly<{children: ReactNode}>) {
  const {preferences, deviceLocale, localeOverridden} = await getRequestPreferences();
  return (
    <html lang={preferences.locale} dir={directionOf(preferences.locale)} data-theme={preferences.theme}>
      <body>
        <PreferencesProvider initial={preferences} deviceLocale={deviceLocale} localeOverridden={localeOverridden}>
          <AnnouncerProvider>
            <SkipLink/>
            <Shell>{children}</Shell>
          </AnnouncerProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
