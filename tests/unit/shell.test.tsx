import type {ReactElement, ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The root layout reads the request, so the request is faked here: cookies and Accept-Language.
const request = vi.hoisted(() => ({cookies: {} as Record<string, string>, acceptLanguage: null as string | null}));
vi.mock('next/headers', () => ({
  cookies: async () => ({get: (name: string) => (name in request.cookies ? {name, value: request.cookies[name]} : undefined)}),
  headers: async () => ({get: (name: string) => (name.toLowerCase() === 'accept-language' ? request.acceptLanguage : null)}),
}));

import RootLayout, {generateMetadata, viewport} from '@/app/layout';
import KitPage from '@/app/kit/page';
import RouteError from '@/app/error';
import NotFound from '@/app/not-found';
import {PreferencesContext, fallbackPreferences, type PreferencesContextValue} from '@/components/preferences-provider';
import {NovaDashboard, Progress, type DashboardView} from '@/components/nova-dashboard';
import {SettingsContent} from '@/components/settings/settings-content';
import {KitContent} from '@/components/kit/kit-content';
import {PreferencesForm} from '@/components/settings/preferences-form';
import {Shell} from '@/components/shell/shell';
import {isChromeless, isCurrent, parentRoute} from '@/components/shell/routes';
import {ConfirmDialog} from '@/components/ui/dialog';
import {GuidanceCard, dismissGuidance} from '@/components/ui/guidance-card';
import {EmptyState, ErrorState} from '@/components/ui/states';
import {StatusBadge, toneShapes, type StatusTone} from '@/components/ui/status-badge';
import {SkipLink} from '@/components/ui/skip-link';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {catalogs, createTranslator, locales, type Locale} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {mockProjects} from '@/lib/mock-data';
import type {Preferences} from '@/lib/preferences';

function withPreferences(preferences: Partial<Preferences>, node: ReactNode, extra: Partial<PreferencesContextValue> = {}) {
  const merged = {...fallbackPreferences, ...preferences};
  return (
    <PreferencesContext value={{preferences: merged, deviceLocale: merged.locale, localeOverridden: false, setPreference: () => true, setLocale: () => merged.locale, ...extra}}>
      <I18nProvider locale={merged.locale}>{node}</I18nProvider>
    </PreferencesContext>
  );
}

function page(pathname: string, view: DashboardView, preferences: Partial<Preferences> = {}, shell: {initialCreateOpen?: boolean; initialNoticeOpen?: boolean} = {}) {
  return renderToStaticMarkup(withPreferences(preferences, (
    <AnnouncerProvider>
      <SkipLink/>
      <Shell pathname={pathname} {...shell}><NovaDashboard view={view}/></Shell>
    </AnnouncerProvider>
  )));
}

const visibleText = (markup: string) => [...markup.matchAll(/>([^<>]+)</g)].map((match) => match[1]).join(' ');
const labels = (markup: string) => [...markup.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/g)].map((match) => match[1]).join(' ');

beforeEach(() => {
  request.cookies = {};
  request.acceptLanguage = null;
});

describe('first paint: lang, dir and theme come from the server (AC-1, I/O matrix)', () => {
  const html = async () => {
    const tree = (await RootLayout({children: null})) as ReactElement<{lang: string; dir: string; 'data-theme': string}>;
    return {lang: tree.props.lang, dir: tree.props.dir, theme: tree.props['data-theme']};
  };

  it('uses a Hebrew device with no cookie: he, rtl, light', async () => {
    request.acceptLanguage = 'he-IL';
    expect(await html()).toEqual({lang: 'he', dir: 'rtl', theme: 'light'});
  });

  it('uses English for an unsupported device language', async () => {
    request.acceptLanguage = 'fr-FR';
    expect(await html()).toEqual({lang: 'en', dir: 'ltr', theme: 'light'});
  });

  it('lets the cookie win over the device', async () => {
    request.acceptLanguage = 'he-IL';
    request.cookies = {'nova3d-locale': 'en'};
    expect(await html()).toEqual({lang: 'en', dir: 'ltr', theme: 'light'});
  });

  it('ignores a tampered cookie without an error', async () => {
    request.acceptLanguage = 'he-IL';
    request.cookies = {'nova3d-locale': 'fr', 'nova3d-theme': 'neon'};
    expect(await html()).toEqual({lang: 'he', dir: 'rtl', theme: 'light'});
  });

  it('puts data-theme="dark" in the first HTML when dark was chosen', async () => {
    request.cookies = {'nova3d-theme': 'dark'};
    expect((await html()).theme).toBe('dark');
  });

  it('keeps light when the device asks for nothing, whatever the operating system prefers', async () => {
    // There is no colour-scheme signal on the server at all: only the cookie can ask for dark.
    request.acceptLanguage = 'en-US';
    expect((await html()).theme).toBe('light');
  });

  it('titles the document in the interface language', async () => {
    request.acceptLanguage = 'he-IL';
    const metadata = await generateMetadata();
    expect(JSON.stringify(metadata)).toContain('יוצרים עם ראיות');
  });
});

describe('global shell (G-01, UX-DR24)', () => {
  const home = page('/', 'home');

  it('puts the skip link first and gives it a target', () => {
    expect(home.indexOf('class="skip-link"')).toBeGreaterThanOrEqual(0);
    expect(home.indexOf('class="skip-link"')).toBeLessThan(home.indexOf('class="app-shell"'));
    expect(home).toContain('href="#main-content"');
    expect(home).toContain('<main id="main-content" tabindex="-1">');
  });

  it('has a single named navigation landmark with Home, My Projects, Create and In Progress', () => {
    expect(home.match(/<nav /g)).toHaveLength(1);
    const nav = /<nav[^>]*aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/.exec(home)?.[1] ?? '';
    for (const label of ['Home', 'My Projects', 'Create', 'In Progress']) expect(nav).toContain(`<span>${label}</span>`);
    expect(nav).toContain('<button type="button" class="nav-item nav-create"');
  });

  it('offers Notifications, Settings and Account in the top bar, each with a name', () => {
    expect(home).toMatch(/aria-label="Notifications, 1 unread"/);
    expect(home).toMatch(/<a class="icon-btn" aria-label="Settings" href="\/settings"/);
    expect(home).toMatch(/aria-label="Account"/);
  });

  it('marks the current page, and only that page', () => {
    for (const [pathname, label] of [['/', 'Home'], ['/projects', 'My Projects'], ['/progress', 'In Progress']] as const) {
      const markup = page(pathname, pathname === '/' ? 'home' : pathname === '/projects' ? 'projects' : 'progress');
      expect(markup.match(/aria-current="page"/g), pathname).toHaveLength(1);
      expect(markup).toMatch(new RegExp(`aria-current="page"[^>]*><svg[\\s\\S]*?</svg><span>${label}</span>`));
    }
  });

  it('shows contextual Back everywhere except Home, and names Home only when it goes to Home', () => {
    expect(home).not.toContain('class="back-link"');
    const projects = page('/projects', 'projects');
    expect(projects).toContain('class="back-link"');
    expect(projects).toContain('aria-label="Back to Home"');
    expect(projects).toMatch(/<a class="back-link"[^>]*href="\/"/);
    // A page two levels down goes back to its parent, which is not Home, so the name must not say Home.
    const deeper = page('/projects/42', 'projects');
    expect(deeper).toMatch(/<a class="back-link" aria-label="Back" href="\/projects"/);
    expect(deeper).not.toContain('aria-label="Back to Home"');
    const hebrew = page('/projects/42', 'projects', {locale: 'he'});
    expect(hebrew).toMatch(/<a class="back-link" aria-label="חזרה" href="\/projects"/);
  });

  it('points the Help link at an id that Settings really has', () => {
    const fragment = /<a class="help-link" href="\/settings#([^"]+)"/.exec(home)?.[1];
    expect(fragment).toBe('guidance');
    const settings = renderToStaticMarkup(withPreferences({}, <AnnouncerProvider><SettingsContent/></AnnouncerProvider>));
    expect(settings.match(new RegExp(`id="${fragment}"`, 'g'))).toHaveLength(1);
  });

  it('renders the sign-in page without the shell', () => {
    const markup = renderToStaticMarkup(withPreferences({}, <Shell pathname="/login"><p>sign in</p></Shell>));
    expect(markup).toBe('<p>sign in</p>');
    expect(isChromeless('/login')).toBe(true);
    expect(isChromeless('/auth/callback')).toBe(true);
    expect(isChromeless('/settings')).toBe(false);
    expect(isChromeless('/loginx')).toBe(false);
  });

  it('knows its routes', () => {
    expect(isCurrent('/projects', '/projects')).toBe(true);
    expect(isCurrent('/projects/42', '/projects')).toBe(true);
    expect(isCurrent('/projectsx', '/projects')).toBe(false);
    expect(isCurrent('/settings', '/')).toBe(false);
    expect(parentRoute('/')).toBeNull();
    expect(parentRoute('/settings')).toBe('/');
    expect(parentRoute('/projects/42')).toBe('/projects');
  });

  it('has a polite live region from the first render', () => {
    expect(home).toContain('role="status" aria-live="polite" aria-atomic="true"');
  });
});

describe('Create dialog is a native modal with a radio group', () => {
  const markup = page('/', 'home', {}, {initialCreateOpen: true});

  it('is a dialog named and described by its content', () => {
    expect(markup).toMatch(/<dialog[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);
    expect(markup).toContain('What would you like to make?');
  });

  it('offers the choices as radios inside a labelled fieldset, and a close button', () => {
    expect(markup).toContain('<fieldset class="choice-group"><legend class="visually-hidden">How would you like to start?</legend>');
    expect(markup.match(/type="radio" name="intake"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Close create project"');
  });

  it('confirms with Cancel focused first when the action is destructive', () => {
    const confirm = renderToStaticMarkup(withPreferences({}, <ConfirmDialog tone="danger" title="T" description="D" confirmLabel="Remove" onConfirm={() => undefined} onCancel={() => undefined}/>));
    expect(confirm).toMatch(/<button[^>]*data-autofocus=""[^>]*><span>Cancel<\/span>/);
    expect(confirm).toMatch(/btn-danger/);
  });
});

describe('Hebrew shell (AC-3, UX-DR5)', () => {
  const cases = [
    ['home', page('/', 'home', {locale: 'he'})],
    ['projects', page('/projects', 'projects', {locale: 'he'})],
    ['progress', page('/progress', 'progress', {locale: 'he'})],
    ['create dialog', page('/', 'home', {locale: 'he'}, {initialCreateOpen: true})],
    ['notifications', page('/', 'home', {locale: 'he'}, {initialNoticeOpen: true})],
  ] as const;
  const allowedLatin = new Set(['nova', 'Josh', 'D']);

  it.each(cases)('has no English copy on the %s page', (_name, markup) => {
    const words = `${visibleText(markup)} ${labels(markup)}`.match(/[A-Za-z]{2,}/g) ?? [];
    expect(words.filter((word) => !allowedLatin.has(word))).toEqual([]);
  });

  it('reads in Hebrew', () => {
    expect(cases[0][1]).toContain('הפרויקטים שלי');
    expect(cases[0][1]).toContain('דלגו לתוכן הראשי');
    expect(cases[4][1]).toContain('הסקירה מוכנה');
  });

  it('keeps ids and percentages left to right inside Hebrew text', () => {
    expect(cases[1][1]).toContain('<bdi dir="ltr" class="ltr-token">78%</bdi>');
  });

  it('shows the Hebrew sample project names and statuses', () => {
    expect(cases[1][1]).toContain('המזבח החיצון והכבש');
    expect(cases[1][1]).toContain('טיוטת דוגמה');
  });
});

describe('guidance (UX-DR26, AC-1, AC-2)', () => {
  const guidance = (preferences: Partial<Preferences>) => renderToStaticMarkup(withPreferences(preferences, <AnnouncerProvider><GuidanceCard/></AnnouncerProvider>));

  it('shows first-use guidance, one step per workflow stage, with a dismiss button', () => {
    const markup = guidance({});
    expect(markup).toContain('data-guidance=""');
    expect(markup.match(/class="guidance-step"/g)).toHaveLength(5);
    expect(markup).toContain('Dismiss guidance');
  });

  it('stays hidden once dismissed', () => {
    const markup = guidance({guidance: 'dismissed'});
    expect(markup).not.toContain('data-guidance');
    expect(markup).not.toContain('guidance-step');
  });

  it('adds explanation, not facts, in technical detail', () => {
    const simple = guidance({detail: 'simple'});
    const technical = guidance({detail: 'technical'});
    expect(simple).not.toContain('data-detail="technical"');
    expect(technical.match(/data-detail="technical"/g)).toHaveLength(5);
    expect(technical).toContain('A passed check is not a certificate of printability or safety.');
    // Everything the simple version says is still there, word for word.
    for (const sentence of ['Describe it', 'Review what we found', 'Approve the plan', 'Inspect the model', 'Check and download']) expect(technical).toContain(sentence);
    expect(technical).toContain('Start with words or a few pictures of an object.');
  });
});

describe('technical detail changes depth only (AC-2)', () => {
  const facts = (markup: string) => ({
    titles: mockProjects.map((project) => markup.includes(catalogs.en[project.title] as string)),
    statuses: markup.match(/class="status-badge tone-[\w-]+"/g),
    progress: markup.match(/aria-valuenow="\d+"/g),
    percentages: markup.match(/\d+%/g),
  });

  it.each([['/', 'home'], ['/projects', 'projects'], ['/progress', 'progress']] as const)('keeps every project, status and number the same on %s', (pathname, view) => {
    const simple = page(pathname, view, {detail: 'simple'});
    const technical = page(pathname, view, {detail: 'technical'});
    expect(facts(technical)).toEqual(facts(simple));
    expect(facts(simple).titles.some(Boolean)).toBe(true);
  });
});

describe('Settings (UX-DR64, AC-2)', () => {
  const radio = (markup: string, name: string, value: string) => new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"[^>]*>`).exec(markup)?.[0] ?? '';
  const form = (preferences: Partial<Preferences>, extra: Partial<PreferencesContextValue> = {}) => renderToStaticMarkup(withPreferences(preferences, <AnnouncerProvider><PreferencesForm/></AnnouncerProvider>, extra));

  it('offers language, appearance, explanation detail and the introduction replay', () => {
    const markup = form({});
    for (const heading of ['Language', 'Appearance', 'Explanation detail', 'Introduction']) expect(markup).toContain(`>${heading}</h2>`);
    expect(markup).toContain('Replay introduction');
    expect(markup.match(/role="radiogroup"/g)).toHaveLength(3);
  });

  it('shows the device-language default, with the language it resolves to', () => {
    const markup = form({locale: 'he'}, {deviceLocale: 'he', localeOverridden: false});
    expect(radio(markup, 'language', 'device')).toContain('checked=""');
    expect(radio(markup, 'language', 'he')).not.toContain('checked');
    expect(markup).toContain('כרגע: \u2068עברית\u2069');
  });

  it('shows a manual override as the selected language', () => {
    const markup = form({locale: 'en'}, {deviceLocale: 'he', localeOverridden: true});
    expect(radio(markup, 'language', 'en')).toContain('checked=""');
    expect(radio(markup, 'language', 'device')).not.toContain('checked');
  });

  it('shows light as the default and dark when selected', () => {
    expect(radio(form({}), 'theme', 'light')).toContain('checked=""');
    expect(radio(form({}), 'theme', 'dark')).not.toContain('checked');
    expect(radio(form({theme: 'dark'}), 'theme', 'dark')).toContain('checked=""');
    expect(radio(form({detail: 'technical'}), 'detail', 'technical')).toContain('checked=""');
  });

  it('previews both languages, each in its own lang and dir (RTL preview)', () => {
    const markup = form({});
    expect(markup).toMatch(/<p lang="en" dir="ltr" class="text-span preview-line">This is how a sentence reads in English\.<\/p>/);
    expect(markup).toMatch(/<p lang="he" dir="rtl" class="text-span preview-line">כך נראה משפט בעברית\.<\/p>/);
    expect(markup).toMatch(/<span lang="he" dir="rtl" class="text-span">עברית<\/span>/);
  });

  it('says the introduction is hidden once dismissed, and showing otherwise', () => {
    expect(form({guidance: 'dismissed'})).toContain('The introduction is hidden.');
    expect(form({guidance: 'shown'})).toContain('The introduction is showing on Home.');
  });

  it('says dark is never taken from the device', () => {
    expect(form({})).toContain('it does not follow your device');
  });
});

describe('design kit (AC-3)', () => {
  const kit = (locale: Locale) => renderToStaticMarkup(withPreferences({locale}, <AnnouncerProvider><KitContent/></AnnouncerProvider>));

  it('is a 404 unless SYNTHETIC_DATA_ENABLED is true', () => {
    for (const value of [undefined, 'false', 'TRUE', '1', '']) {
      vi.stubEnv('SYNTHETIC_DATA_ENABLED', value as string);
      if (value === undefined) delete process.env.SYNTHETIC_DATA_ENABLED;
      expect(() => KitPage(), String(value)).toThrow(expect.objectContaining({digest: 'NEXT_HTTP_ERROR_FALLBACK;404'}));
    }
    vi.unstubAllEnvs();
  });

  it('renders when synthetic data is on', () => {
    vi.stubEnv('SYNTHETIC_DATA_ENABLED', 'true');
    expect(() => KitPage()).not.toThrow();
    vi.unstubAllEnvs();
  });

  it('shows every status and evidence tone with its own shape and a word', () => {
    const markup = kit('en');
    const tones = Object.keys(toneShapes) as StatusTone[];
    for (const tone of tones) expect(markup).toContain(`status-badge tone-${tone}`);
    for (const word of ['Done', 'Needs attention', 'Failed', 'Sourced', 'Inferred', 'Disputed', 'Unknown', 'User-added']) expect(markup).toContain(`<span>${word}</span>`);
    expect(new Set(Object.values(toneShapes)).size).toBe(tones.length);
  });

  it.each(locales)('keeps Hebrew and English spans distinct, with their own lang and dir, in %s', (locale) => {
    const markup = kit(locale);
    expect(markup).toMatch(/<p lang="he" dir="rtl" class="text-span">תוכן לדוגמה, לא ראיות אמיתיות<\/p>/);
    expect(markup).toMatch(/<p lang="en" dir="ltr" class="text-span">Sample content, not real evidence<\/p>/);
  });

  it('isolates identifiers and file names so right-to-left text cannot reorder them', () => {
    const markup = kit('he');
    expect(markup).toContain('⁦SAMPLE-001⁩');
    expect(markup).toContain('⁦model-sample.stl⁩');
  });

  it('labels the sample as not real evidence, in both languages', () => {
    expect(kit('en')).toContain('Sample content, not real evidence');
    expect(kit('he')).toContain('תוכן לדוגמה, לא ראיות אמיתיות');
  });
});

describe('status and state patterns (UX-DR4)', () => {
  it('pairs every badge with a shape and the word it was given', () => {
    const markup = renderToStaticMarkup(<StatusBadge tone="danger">Failed</StatusBadge>);
    expect(markup).toContain('<svg');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<span>Failed</span>');
  });

  it('announces an error state only when asked to', () => {
    expect(renderToStaticMarkup(<ErrorState title="T">B</ErrorState>)).not.toContain('role="alert"');
    expect(renderToStaticMarkup(<ErrorState live title="T">B</ErrorState>)).toContain('role="alert"');
  });

  it('gives an empty state a heading and a way forward', () => {
    const markup = renderToStaticMarkup(<EmptyState title="Nothing" action={<button type="button">Go</button>}>Body</EmptyState>);
    expect(markup).toContain('<h2 class="state-title">Nothing</h2>');
    expect(markup).toContain('<button type="button">Go</button>');
  });
});

describe('error and not-found pages use the shared patterns, in the interface language', () => {
  it('announces a route error and offers a retry', () => {
    const retry = vi.fn();
    const markup = renderToStaticMarkup(withPreferences({}, <RouteError error={new Error('boom')} retry={retry}/>));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('<h1 class="state-title">Something went wrong</h1>');
    expect(markup).toContain('<span>Try again</span>');
    expect(markup).not.toContain('boom');
  });

  it('gives the 404 page a level-one heading and a way home, in Hebrew when the request is Hebrew', async () => {
    request.acceptLanguage = 'he-IL';
    const markup = renderToStaticMarkup(await NotFound());
    expect(markup).toContain('<h1 class="state-title">הדף לא נמצא</h1>');
    expect(markup).toContain('href="/"');
    expect(markup).toContain('מעבר לדף הבית');
  });
});

describe('viewport', () => {
  it('lets the page use the whole screen and leaves zoom alone', () => {
    expect(viewport).toEqual({viewportFit: 'cover'});
    expect(viewport).not.toHaveProperty('maximumScale');
    expect(viewport).not.toHaveProperty('userScalable');
  });
});

describe('progress bars', () => {
  const bar = (value: number) => renderToStaticMarkup(<Progress value={value} label="Research"/>);

  it('reports the value as the bar draws it', () => {
    expect(bar(34)).toContain('aria-valuenow="34"');
    expect(bar(34)).toContain('style="width:34%"');
  });

  it('holds out-of-range values to 0 to 100, and NaN to 0, for both the name and the width', () => {
    for (const [value, shown] of [[-20, 0], [140, 100], [Number.NaN, 0], [Number.POSITIVE_INFINITY, 0]] as const) {
      expect(bar(value), String(value)).toContain(`aria-valuenow="${shown}"`);
      expect(bar(value), String(value)).toContain(`style="width:${shown}%"`);
    }
  });
});

describe('dismissing guidance', () => {
  const setup = (stored: boolean, cardHadFocus: boolean) => {
    const calls: string[] = [];
    const t = createTranslator('en');
    const result = dismissGuidance({
      setPreference: () => stored,
      announce: (message) => calls.push(`announce:${message}`),
      t,
      locale: 'en',
      cardHadFocus,
      focusMain: () => calls.push('focus'),
    });
    return {result, calls};
  };

  it('announces the dismissal, then moves focus to the page only if the card had it', () => {
    expect(setup(true, true)).toEqual({result: true, calls: ['announce:Guidance dismissed. You can bring it back from Settings.', 'focus']});
    expect(setup(true, false)).toEqual({result: true, calls: ['announce:Guidance dismissed. You can bring it back from Settings.']});
  });

  it('keeps the card, announces the failure and leaves focus alone when the browser refuses the cookie', () => {
    expect(setup(false, true)).toEqual({result: false, calls: ['announce:That choice could not be kept. Check that cookies are allowed for this site.']});
    expect(setup(false, false).calls).not.toContain('focus');
  });
});
