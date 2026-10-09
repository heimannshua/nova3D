import {createTranslator, directionOf, type Locale} from '@/lib/i18n';
import type {Theme} from '@/lib/preferences';
import {Button} from './ui/button';
import {ErrorState} from './ui/states';
import {mainContentId} from './ui/skip-link';

/**
 * The page shown when the root layout itself fails (reading cookies or headers, a provider throwing).
 * It replaces the whole document, so it carries its own <html> and <body> and uses nothing that could be
 * what failed: no preference provider, no shell, no announcer. Words come straight from the catalog.
 */
export function GlobalErrorView({locale, theme, retry}: {locale: Locale; theme: Theme; retry: () => void}) {
  const t = createTranslator(locale);
  return (
    <html lang={locale} dir={directionOf(locale)} data-theme={theme}>
      <body>
        <title>{`${t('state.errorTitle')} · nova3D`}</title>
        <main id={mainContentId} tabIndex={-1} className="page page-narrow">
          <ErrorState live headingLevel={1} title={t('state.errorTitle')} action={<Button variant="primary" onClick={retry}>{t('state.retry')}</Button>}>
            {t('state.errorBody')}
          </ErrorState>
        </main>
      </body>
    </html>
  );
}
