import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {createTranslator} from '../../lib/i18n';
import {pwaMetadata} from '../../lib/pwa-metadata';

const locales = ['en', 'he'] as const;

function readManifest(locale: (typeof locales)[number]) {
  return JSON.parse(readFileSync(join(process.cwd(), `public/manifest.${locale}.webmanifest`), 'utf8')) as {
    name: string;
    short_name: string;
    description: string;
    lang: string;
    dir: string;
    display: string;
    start_url: string;
    scope: string;
    theme_color: string;
    background_color: string;
    icons: Array<{src: string; sizes: string; type: string}>;
  };
}

function readPngDimensions(path: string) {
  const png = readFileSync(join(process.cwd(), path));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return {width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

describe('PWA metadata', () => {
  it.each(locales)('selects the static %s manifest and Apple touch icon', (locale) => {
    expect(pwaMetadata(locale)).toEqual({
      manifest: `/manifest.${locale}.webmanifest`,
      icons: {
        apple: [{url: '/pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png'}],
      },
    });
  });

  it.each([
    ['en', 'ltr'],
    ['he', 'rtl'],
  ] as const)('serves a same-origin standalone %s manifest with localized direction', (locale, direction) => {
    const manifest = readManifest(locale);
    const t = createTranslator(locale);

    expect(manifest.name).toBe(t('meta.pwa.name'));
    expect(manifest.short_name).toBe(t('meta.pwa.shortName'));
    expect(manifest.description).toBe(t('meta.pwa.description'));
    expect(manifest.lang).toBe(locale);
    expect(manifest.dir).toBe(direction);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.icons).toEqual([
      {src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png'},
      {src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png'},
    ]);
  });

  it('provides the declared icon dimensions and does not add offline behavior', () => {
    expect(readPngDimensions('public/pwa/icon-192.png')).toEqual({width: 192, height: 192});
    expect(readPngDimensions('public/pwa/icon-512.png')).toEqual({width: 512, height: 512});
    expect(readPngDimensions('public/pwa/apple-touch-icon.png')).toEqual({width: 180, height: 180});
  });
});
