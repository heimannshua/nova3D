import type {Metadata} from 'next';
import type {Locale} from './i18n/locales';

export const pwaColors = {
  themeColor: '#4f46e5',
  backgroundColor: '#f6f7fb',
} as const;

export function pwaMetadata(locale: Locale): Pick<Metadata, 'manifest' | 'icons'> {
  return {
    manifest: `/manifest.${locale}.webmanifest`,
    icons: {
      apple: [{url: '/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png'}],
    },
  };
}
