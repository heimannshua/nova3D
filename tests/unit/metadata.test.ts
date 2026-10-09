import {beforeEach, describe, expect, it, vi} from 'vitest';

const request = vi.hoisted(() => ({cookies: {} as Record<string, string>, acceptLanguage: null as string | null}));
vi.mock('next/headers', () => ({
  cookies: async () => ({get: (name: string) => (name in request.cookies ? {name, value: request.cookies[name]} : undefined)}),
  headers: async () => ({get: (name: string) => (name.toLowerCase() === 'accept-language' ? request.acceptLanguage : null)}),
}));

import {generateMetadata as kitMetadata} from '@/app/kit/page';
import {generateMetadata as layoutMetadata} from '@/app/layout';
import {generateMetadata as loginMetadata} from '@/app/login/page';
import {generateMetadata as notFoundMetadata} from '@/app/not-found';
import {generateMetadata as progressMetadata} from '@/app/progress/page';
import {generateMetadata as projectsMetadata} from '@/app/projects/page';
import {generateMetadata as settingsMetadata} from '@/app/settings/page';
import {translate, type Locale, type MessageKey} from '@/lib/i18n';

beforeEach(() => {
  request.cookies = {};
  request.acceptLanguage = null;
  vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'true');
});

// Each page names itself in the interface language. The route titles differ, so one page cannot pass for another.
const pages: [string, () => Promise<{title?: unknown}>, MessageKey][] = [
  ['projects', projectsMetadata, 'meta.projects'],
  ['progress', progressMetadata, 'meta.progress'],
  ['settings', settingsMetadata, 'meta.settings'],
  ['login', loginMetadata, 'meta.login'],
  ['kit', kitMetadata, 'meta.kit'],
  ['not found', notFoundMetadata, 'meta.notFound'],
];

describe.each(['en', 'he'] as Locale[])('page titles in %s', (locale) => {
  beforeEach(() => {
    request.cookies = {'nova3d-locale': locale};
  });

  it.each(pages)('%s has its own title', async (_name, generate, key) => {
    expect((await generate()).title).toBe(translate(locale, key));
  });

  it('gives the layout a default title and a template that names the product', async () => {
    const metadata = await layoutMetadata();
    expect(metadata.title).toEqual({default: translate(locale, 'meta.title'), template: '%s · nova3D'});
    expect(metadata.description).toBe(translate(locale, 'meta.description'));
  });
});

describe('page titles differ by page and by language', () => {
  it('uses a different title for each of Projects, In Progress and Settings', async () => {
    const titles = await Promise.all([projectsMetadata(), progressMetadata(), settingsMetadata()]).then((all) => all.map((metadata) => metadata.title));
    expect(new Set(titles).size).toBe(3);
  });

  it('changes language with the cookie', async () => {
    request.cookies = {'nova3d-locale': 'he'};
    const hebrew = (await settingsMetadata()).title;
    request.cookies = {'nova3d-locale': 'en'};
    expect((await settingsMetadata()).title).not.toBe(hebrew);
  });

  it('titles the kit as not found when synthetic data is off', async () => {
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'false');
    expect((await kitMetadata()).title).toBe(translate('en', 'meta.notFound'));
  });
});
