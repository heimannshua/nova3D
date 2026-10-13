import type {ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The Project pages (Story 1.7): Home, My Projects, a Project's overview and its Sources page, and the unavailable page, rendered to
// markup in both languages, and the page functions themselves with the Account and the database faked. What needs a browser (the
// dialog, focus, the live regions, the Server Action, the real 404 status) is in tests/e2e/projects.spec.ts.
const request = vi.hoisted(() => ({cookies: {} as Record<string, string>, acceptLanguage: null as string | null}));
const mocks = vi.hoisted(() => ({
  access: null as unknown,
  listProjects: vi.fn(),
  readProject: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in request.cookies ? {name, value: request.cookies[name]} : undefined),
    getAll: () => Object.entries(request.cookies).map(([name, value]) => ({name, value})),
  }),
  headers: async () => ({get: (name: string) => (name.toLowerCase() === 'accept-language' ? request.acceptLanguage : null)}),
}));
// The retry button asks the router to refresh; there is no app router to mount here.
vi.mock('next/navigation', async (importOriginal) => ({...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({refresh: () => undefined})}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccess: async () => mocks.access,
  requireActiveAccount: async () => {
    if ((mocks.access as {state: string}).state !== 'active') throw new Error('not active');
    return mocks.access;
  },
}));
vi.mock('@/lib/projects', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/projects')>()), listProjects: mocks.listProjects, readProject: mocks.readProject}));

import HomePage from '@/app/page';
import ProjectsPage from '@/app/projects/page';
import ProjectPage, {generateMetadata as projectMetadata} from '@/app/projects/[projectId]/page';
import ProjectNotFound from '@/app/projects/[projectId]/not-found';
import SourcesPage, {generateMetadata as sourcesMetadata} from '@/app/projects/[projectId]/sources/page';
import {NovaDashboard} from '@/components/nova-dashboard';
import {ProjectsList} from '@/components/projects/projects-list';
import {ProjectOverview} from '@/components/projects/project-overview';
import {SourcesPlaceholder} from '@/components/projects/sources-placeholder';
import {ProjectUnavailable} from '@/components/projects/unavailable';
import {Shell} from '@/components/shell/shell';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {AccountsUnavailableError} from '@/lib/accounts';
import {catalogs, locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {fixtureRows} from '@/lib/project-fixtures';
import {projectStages, stageDefinition} from '@/lib/project-stage';

const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const rows = fixtureRows();
const [first, second, , hebrew] = rows;
const active = {state: 'active', user: {id: 'u', email: 'person@example.com', sessionId: 's'}, account: {accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 4, preferences: null}};
const toRow = (row: (typeof rows)[number]) => ({id: row.id, title: row.title, stage: row.stage, current_version: row.currentVersion, revision: row.revision, created_at: row.createdAt, updated_at: row.updatedAt});

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
const render = (locale: Locale, element: ReactElement) => renderToStaticMarkup(<I18nProvider locale={locale}><AnnouncerProvider>{element}</AnnouncerProvider></I18nProvider>);
const isNotFound = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return (error as {digest?: string}).digest === 'NEXT_HTTP_ERROR_FALLBACK;404';
  }
  return false;
};
const redirectedTo = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    const digest = (error as {digest?: string}).digest ?? '';
    return digest.startsWith('NEXT_REDIRECT') ? digest.split(';')[2] : null;
  }
  return null;
};

beforeEach(() => {
  request.cookies = {};
  request.acceptLanguage = null;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  mocks.access = active;
  mocks.listProjects.mockReset().mockResolvedValue({outcome: 'listed', projects: rows, total: rows.length});
  mocks.readProject.mockReset().mockImplementation(async (_operation, id: string) => {
    const found = rows.find((row) => row.id === id);
    return found ? {outcome: 'found', project: found} : {outcome: 'unavailable'};
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe.each(locales)('Home for a new Account in %s (AC-1)', (locale) => {
  const markup = render(locale, <NovaDashboard view="home" listing={{state: 'listed', projects: [], total: 0}}/>);
  const words = text(markup);

  it('shows the three primary actions with real counts: no projects and no active jobs', () => {
    expect(words).toContain(t(locale, 'nav.projects'));
    expect(words).toContain(t(locale, 'nav.create'));
    expect(words).toContain(t(locale, 'nav.progress'));
    expect(words).toContain(t(locale, 'home.projectsDetail', {count: 0}));
    expect(words).toContain(t(locale, 'home.progressNone'));
    if (locale === 'en') expect(words).toContain('0 projects');
    if (locale === 'en') expect(words).toContain('No active jobs');
  });

  it('links My Projects and In Progress, and makes Create a button', () => {
    expect(markup).toMatch(/<a class="action-card action-violet" href="\/projects"/);
    expect(markup).toMatch(/<a class="action-card action-amber" href="\/progress"/);
    expect(markup).toMatch(/<button type="button" class="action-card action-blue"/);
  });

  it('has an honest empty state with Create, and no sample content', () => {
    expect(words).toContain(t(locale, 'projects.noneTitle'));
    expect(markup).toContain('state-empty');
    expect(markup).toMatch(new RegExp(`<button[^>]*class="btn btn-primary"[^>]*>(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'projects.new')}</span>`));
    expect(markup).not.toContain('project-card');
    expect(markup).not.toContain('activity');
    expect(markup).not.toMatch(/Josh|Good morning|Sample|synthetic/i);
  });

  it('does not name anyone, and has one level-one heading', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(words).toContain(t(locale, 'home.title'));
  });
});

describe.each(locales)('Home with Projects in %s', (locale) => {
  it('counts them all, lists the ones it was given as cards that open their overview, and offers View all', () => {
    const markup = render(locale, <NovaDashboard view="home" listing={{state: 'listed', projects: [first, second], total: 9}}/>);
    expect(text(markup)).toContain(t(locale, 'home.projectsDetail', {count: 9}));
    expect(markup.match(/<article class="project-card"/g)).toHaveLength(2);
    expect(markup).toContain(`href="/projects/${first.id}"`);
    expect(markup).toContain(`href="/projects/${second.id}"`);
    expect(markup).toMatch(/<a class="text-link" href="\/projects"/);
    expect(markup).not.toContain('state-empty');
  });

  it('says it could not read the list, with a way to try again, and does not claim there are none', () => {
    const markup = render(locale, <NovaDashboard view="home" listing={{state: 'unreadable'}}/>);
    expect(text(markup)).toContain(t(locale, 'projects.error.title'));
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain(t(locale, 'state.retry'));
    expect(text(markup)).not.toContain(t(locale, 'projects.noneTitle'));
    expect(markup).not.toContain('project-card');
    // The count is unknown, so it is not printed as "0".
    expect(text(markup)).not.toContain(t(locale, 'home.projectsDetail', {count: 0}));
  });
});

describe.each(locales)('My Projects in %s', (locale) => {
  it('is an empty state with Create, and no search, for an Account with no Projects (distinct from "no match")', () => {
    const markup = render(locale, <NovaDashboard view="projects" listing={{state: 'listed', projects: [], total: 0}}/>);
    expect(text(markup)).toContain(t(locale, 'projects.noneTitle'));
    expect(text(markup)).not.toContain(t(locale, 'projects.emptyTitle'));
    expect(markup).not.toContain('role="search"');
    expect(markup).not.toContain('type="search"');
  });

  it('lists the Projects in the order given with a card each: Version, title, next action, stage as a word and a shape, and the time', () => {
    const markup = render(locale, <ProjectsList projects={rows} total={rows.length}/>);
    const cards = [...markup.matchAll(/<article class="project-card"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => match[1]);
    expect(cards).toHaveLength(rows.length);
    cards.forEach((card, index) => {
      const row = rows[index];
      expect(card).toContain(`<bdi>${row.title}</bdi>`);
      expect(text(card)).toContain(t(locale, stageDefinition(row.stage).label));
      expect(text(card)).toContain(t(locale, stageDefinition(row.stage).nextAction));
      expect(text(card)).toContain(row.currentVersion > 0 ? t(locale, 'project.version', {version: row.currentVersion}) : t(locale, 'project.versionNone'));
      expect(card).toContain(`href="/projects/${row.id}"`);
      expect(card).toMatch(/<span class="status-badge tone-[a-z-]+"><svg/);
      expect(card).toContain('<time dateTime="');
      expect(card).not.toContain('>SAMPLE<');
    });
  });

  it('has a search by title and a filter by stage with every stage, each with a name', () => {
    const markup = render(locale, <ProjectsList projects={rows} total={rows.length}/>);
    expect(markup).toContain('role="search"');
    expect(markup).toMatch(new RegExp(`<input type="search"[^>]*aria-label="${t(locale, 'projects.search')}"`));
    const select = /<select[^>]*>([\s\S]*?)<\/select>/.exec(markup)?.[1] ?? '';
    const options = [...select.matchAll(/<option value="([a-z_]+)"[^>]*>(.*?)<\/option>/g)].map((match) => [match[1], match[2]]);
    expect(options).toEqual([['all', t(locale, 'projects.filterAllStages')], ...rows.map((row) => [row.stage, t(locale, stageDefinition(row.stage).label)])]);
    expect(markup).toContain(`<span class="visually-hidden">${t(locale, 'projects.filterLabel')}</span>`);
    expect(text(markup)).toContain(t(locale, 'projects.resultCount', {count: rows.length}));
  });

  it('says only that it shows the most recent ones when the Account has more Projects than the page holds', () => {
    const capped = render(locale, <ProjectsList projects={rows} total={rows.length + 40}/>);
    expect(text(capped)).toContain(t(locale, 'projects.capped', {count: rows.length, total: rows.length + 40}));
    expect(text(render(locale, <ProjectsList projects={rows} total={rows.length}/>))).not.toContain(t(locale, 'projects.capped', {count: rows.length, total: rows.length}));
  });

  it('is an error state with a way to try again, and nothing else of the Projects, when the list could not be read', () => {
    const markup = render(locale, <NovaDashboard view="projects" listing={{state: 'unreadable'}}/>);
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain(t(locale, 'projects.error.title'));
    expect(text(markup)).toContain(t(locale, 'state.retry'));
    expect(markup).not.toContain('project-card');
    expect(markup).not.toContain('role="search"');
    expect(text(markup)).not.toContain(t(locale, 'projects.noneTitle'));
  });
});

describe('In Progress', () => {
  it.each(locales)('says there are no active jobs and keeps "Prints in Progress" as coming later, in %s', (locale) => {
    const markup = render(locale, <NovaDashboard view="progress"/>);
    expect(text(markup)).toContain(t(locale, 'progress.noneTitle'));
    expect(text(markup)).toContain(t(locale, 'progress.printsTitle'));
    expect(text(markup)).toContain(t(locale, 'progress.comingLater'));
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toMatch(/Courtyard|Outer Altar|Garden arch/);
  });
});

describe.each(locales)('the unavailable page in %s (AC-3)', (locale) => {
  it('is one page with a level-one heading and a link to My Projects, and shows nothing of any Project', async () => {
    request.cookies = {'nova3d-locale': locale};
    const markup = renderToStaticMarkup(<I18nProvider locale={locale}>{await ProjectUnavailable()}</I18nProvider>);
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(text(markup)).toContain(t(locale, 'project.unavailable.title'));
    expect(markup).toMatch(/<a class="btn btn-primary" href="\/projects"/);
    expect(text(markup)).toContain(t(locale, 'project.unavailable.action'));
    expect(markup).not.toMatch(/<bdi>|project-card|time dateTime|uuid/i);
  });

  it('is what the Project routes render for notFound()', () => {
    expect((ProjectNotFound() as ReactElement).type).toBe(ProjectUnavailable);
  });
});

describe.each(locales)('the Sources page in %s', (locale) => {
  const markup = render(locale, <SourcesPlaceholder project={hebrew}/>);

  it('is an honest placeholder: it names the Project, says sources are not available, and links back', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(text(markup)).toContain(t(locale, 'sources.title'));
    expect(text(markup)).toContain(t(locale, 'sources.emptyTitle'));
    expect(markup).toContain(`<bdi class="project-title">${hebrew.title}</bdi>`);
    expect(markup).toMatch(new RegExp(`<a class="btn btn-secondary" href="/projects/${hebrew.id}"`));
  });
});

describe('the page functions', () => {
  it('Home asks for the three most recent Projects, for the Account and epoch of the verified access', async () => {
    mocks.listProjects.mockResolvedValue({outcome: 'listed', projects: [first, second], total: 5});
    const element = (await HomePage()) as ReactElement<{view: string; listing: {state: string; total: number}}>;
    expect(element.props).toMatchObject({view: 'home', listing: {state: 'listed', total: 5}});
    expect(mocks.listProjects).toHaveBeenCalledWith({accountId: ACCOUNT, epoch: 4}, {limit: 3}, expect.anything());
  });

  it('Home shows a list the database would not give (unreachable, or no authority) as unreadable, never as empty', async () => {
    mocks.listProjects.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect(((await HomePage()) as ReactElement<{listing: unknown}>).props.listing).toEqual({state: 'unreadable'});
    mocks.listProjects.mockResolvedValue({outcome: 'denied'});
    expect(((await HomePage()) as ReactElement<{listing: unknown}>).props.listing).toEqual({state: 'unreadable'});
  });

  it('My Projects asks for the whole list, and sends a request the database refuses Home', async () => {
    const element = (await ProjectsPage()) as ReactElement<{view: string; listing: {total: number}}>;
    expect(element.props).toMatchObject({view: 'projects', listing: {state: 'listed', total: rows.length}});
    expect(mocks.listProjects).toHaveBeenCalledWith({accountId: ACCOUNT, epoch: 4}, {limit: undefined}, expect.anything());
    mocks.listProjects.mockResolvedValue({outcome: 'denied'});
    expect(await redirectedTo(ProjectsPage())).toBe('/');
    mocks.listProjects.mockRejectedValue(new Error('down'));
    expect(((await ProjectsPage()) as ReactElement<{listing: unknown}>).props.listing).toEqual({state: 'unreadable'});
  });

  describe.each([
    ['the overview', (id: string) => ProjectPage({params: Promise.resolve({projectId: id})}), projectMetadata],
    ['Sources', (id: string) => SourcesPage({params: Promise.resolve({projectId: id})}), sourcesMetadata],
  ])('%s', (_name, page, metadata) => {
    it('renders an owned Project, read for the Account and epoch of the verified access', async () => {
      const element = (await page(first.id)) as ReactElement<{project: {id: string}}>;
      expect(element.props.project).toMatchObject({id: first.id, title: first.title});
      expect(mocks.readProject).toHaveBeenCalledWith({accountId: ACCOUNT, epoch: 4}, first.id, expect.anything());
    });

    it('is the one 404 for another Account\'s Project, a deleted one, an unknown one and an ID that is no ID (AC-3)', async () => {
      mocks.readProject.mockResolvedValue({outcome: 'unavailable'});
      for (const id of [first.id, '11111111-1111-4111-8111-111111111111', 'not-an-id', '../../etc/passwd', '']) expect(await isNotFound(page(id)), id).toBe(true);
    });

    it('is a retryable error, and never the unavailable page, when the database cannot answer', async () => {
      mocks.readProject.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
      const element = (await page(first.id)) as ReactElement<{children: ReactElement<{title: string}>}>;
      expect(element.props.children.props.title).toBe('project.error.title');
    });

    it('sends a request the database refuses Home', async () => {
      mocks.readProject.mockResolvedValue({outcome: 'denied'});
      expect(await redirectedTo(page(first.id))).toBe('/');
    });

    it('titles the page with the same question as the page: unavailable for all four reasons, the same title', async () => {
      const unavailable = t('en', 'meta.projectUnavailable');
      mocks.readProject.mockResolvedValue({outcome: 'unavailable'});
      for (const id of [first.id, 'not-an-id']) expect((await metadata({params: Promise.resolve({projectId: id})})).title, id).toBe(unavailable);
      mocks.access = {state: 'signed-out'};
      expect((await metadata({params: Promise.resolve({projectId: first.id})})).title).toBe(unavailable);
    });
  });

  it('titles the overview with the Project\'s own name, and Sources with the word for Sources', async () => {
    expect((await projectMetadata({params: Promise.resolve({projectId: hebrew.id})})).title).toBe(hebrew.title);
    expect((await sourcesMetadata({params: Promise.resolve({projectId: hebrew.id})})).title).toBe(t('en', 'meta.sources'));
    mocks.readProject.mockRejectedValue(new Error('down'));
    expect((await projectMetadata({params: Promise.resolve({projectId: hebrew.id})})).title).toBe(t('en', 'meta.project'));
  });

  it('never prints a title or an ID when a read fails', async () => {
    mocks.readProject.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await ProjectPage({params: Promise.resolve({projectId: first.id})});
    mocks.listProjects.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    await ProjectsPage();
    const lines = vi.mocked(console.error).mock.calls.flat().map(String);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(first.id);
      expect(line).not.toContain(first.title);
      expect(line).not.toContain(ACCOUNT);
    }
  });
});

describe('the shell around them', () => {
  it('marks My Projects as current for a Project\'s overview and offers Back to the list', () => {
    const markup = render('en', <Shell pathname={`/projects/${first.id}`}><ProjectOverview project={first}/></Shell>);
    expect(markup).toMatch(/<a class="nav-item active" aria-current="page" href="\/projects">/);
    expect(markup).toMatch(/<a class="back-link" aria-label="Back" href="\/projects">/);
    const sources = render('en', <Shell pathname={`/projects/${first.id}/sources`}><SourcesPlaceholder project={first}/></Shell>);
    expect(sources).toMatch(new RegExp(`<a class="back-link" aria-label="Back" href="/projects/${first.id}">`));
  });

  it('has a word and a next-action sentence for each of the six stages in both languages, each different from the other five', () => {
    expect(projectStages).toHaveLength(6);
    for (const locale of locales) {
      const words = projectStages.map((stage) => translate(locale, stageDefinition(stage).label));
      const sentences = projectStages.map((stage) => translate(locale, stageDefinition(stage).nextAction));
      for (const stage of projectStages) {
        expect(catalogs[locale][stageDefinition(stage).label], `${locale}:${stage}`).toBeTruthy();
        expect(catalogs[locale][stageDefinition(stage).nextAction], `${locale}:${stage}`).toBeTruthy();
      }
      expect(new Set(words).size, locale).toBe(6);
      expect(new Set(sentences).size, locale).toBe(6);
    }
  });
});
