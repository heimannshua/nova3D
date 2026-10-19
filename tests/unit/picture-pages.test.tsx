import type {ComponentProps, ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The picture screen (Story 2.2: C-03), the Pictures part of the Project page and the stage `request_draft`, rendered to markup in both languages. What needs a
// browser (the file chooser, hashing, uploading, the camera, focus, the live region, the Server Actions) is in tests/e2e/pictures.spec.ts. A state the browser would
// reach is given to the screen as its initial state (as the text flow's is only for tests), which is how every state of C-03 is seen here.
const request = vi.hoisted(() => ({cookies: {} as Record<string, string>}));
const mocks = vi.hoisted(() => ({access: null as unknown, readProject: vi.fn(), readProjectRequest: vi.fn()}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in request.cookies ? {name, value: request.cookies[name]} : undefined),
    getAll: () => Object.entries(request.cookies).map(([name, value]) => ({name, value})),
  }),
  headers: async () => ({get: () => null}),
}));
// The retry button of an unreadable page asks the router to refresh; there is no app router to mount here.
vi.mock('next/navigation', async (importOriginal) => ({...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({refresh: () => undefined})}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccess: async () => mocks.access,
  requireActiveAccount: async () => {
    if ((mocks.access as {state: string}).state !== 'active') throw new Error('not active');
    return mocks.access;
  },
}));
vi.mock('@/lib/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects')>()),
  readProject: mocks.readProject,
  readProjectRequest: mocks.readProjectRequest,
}));

import NewPicturesPage, {generateMetadata as newMetadata} from '@/app/projects/new/pictures/page';
import ProjectPicturesPage, {generateMetadata as projectMetadata} from '@/app/projects/[projectId]/pictures/page';
import {PictureIntake} from '@/components/projects/picture-intake';
import {PicturesLocked} from '@/components/projects/pictures-locked';
import {ProjectOverview} from '@/components/projects/project-overview';
import {RequestSection, type RequestSectionData} from '@/components/projects/request-section';
import {Unreadable} from '@/components/projects/unreadable';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {Icon} from '@/components/ui/icon';
import {locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {fileProblems, formatParams, maxPictureBytes, maxPictures, maxSetBytes, pictureTypes, savedSet, uploadProblems, type PictureItem, type PictureSet, type SavedPicture} from '@/lib/picture-set';
import {fileProblemKeys, setProblemKeys, uploadProblemKeys, type SaveState} from '@/lib/picture-view';
import {fixtureRows} from '@/lib/project-fixtures';
import {stageDefinition} from '@/lib/project-stage';
import type {ProjectRequestRow} from '@/lib/project-view';
import {formatBytes} from '@/lib/picture-set';

type Props = ComponentProps<typeof PictureIntake>;

const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const REQUEST = '0a0b0c0d-1e1f-4a2a-8b3b-4c4c5d5d6e6e';
const upload = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (character: string) => character.repeat(64);
const active = {state: 'active', user: {id: 'u', email: 'person@example.com', sessionId: 's'}, account: {accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 4, preferences: null}};

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** The catalog's message as the screen writes it: string values are isolated (FSI and PDI) like they are in the markup. */
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
const render = (locale: Locale, element: ReactElement) => renderToStaticMarkup(<I18nProvider locale={locale}><AnnouncerProvider>{element}</AnnouncerProvider></I18nProvider>);
const screen = (locale: Locale, props: Props = {}) => render(locale, <PictureIntake {...props}/>);
const rows = (markup: string) => markup.split('<li class="picture-item"').slice(1).map((row) => row.split('</li>')[0]);
/** The whole opening tag of the button with this action in a row. */
const button = (row: string, action: string) => new RegExp(`<button\\b[^>]*data-action="${action}"[^>]*>`).exec(row)?.[0] ?? '';
const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
/** The file input that takes many files, as a tag. */
const chooser = (markup: string) => /<input\b[^>]*type="file"[^>]*multiple[^>]*>/.exec(markup)?.[0] ?? '';

const file = (name = 'photo.jpg') => new File([new Uint8Array(4)], name, {type: 'image/jpeg'});
const made = (patch: Partial<PictureItem> = {}): PictureItem => ({
  key: 'k',
  state: 'ready',
  progress: 1,
  sha256: sha('a'),
  length: 482113,
  contentType: 'image/jpeg',
  uploadId: upload(1),
  previewUrl: null,
  file: null,
  saved: false,
  expiresAt: null,
  available: true,
  problem: null,
  ...patch,
});
/** A set whose items are given by their patches, with keys and upload IDs that follow their position. */
const setOf = (...patches: Partial<PictureItem>[]): PictureSet => patches.map((patch, index) => made({key: `k${index + 1}`, uploadId: upload(index + 1), sha256: sha(String.fromCharCode(97 + index)), ...patch}));

const savedPicture = (position: number, patch: Partial<SavedPicture> = {}): SavedPicture => ({
  position,
  uploadId: upload(position),
  sha256: sha(String.fromCharCode(96 + position)),
  length: 482113 * position,
  contentType: 'image/jpeg',
  expiresAt: '2026-10-19T12:34:56.789Z',
  available: true,
  ...patch,
});

beforeEach(() => {
  request.cookies = {};
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  mocks.access = active;
  mocks.readProject.mockReset();
  mocks.readProjectRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// The pages -----------------------------------------------------------------------------------------------------------------------

describe('the picture pages', () => {
  const row = {...fixtureRows()[0], id: PROJECT, stage: 'request_draft' as const};
  const unconfirmed: ProjectRequestRow = {
    id: REQUEST,
    projectId: PROJECT,
    seq: 3,
    mode: 'evidence_images',
    confirmed: false,
    subjectId: null,
    scope: null,
    outcome: null,
    description: null,
    personalization: {wording: null, text: null, style: null, applied: false, reason: null},
    confirmedAt: null,
    images: [savedPicture(1), savedPicture(2)],
  };
  const params = Promise.resolve({projectId: PROJECT});
  const found = (request: ProjectRequestRow | null) => {
    mocks.readProject.mockResolvedValue({outcome: 'found', project: row});
    mocks.readProjectRequest.mockResolvedValue(request ? {outcome: 'found', request} : {outcome: 'none'});
  };
  const digest = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      return (error as {digest?: string}).digest ?? 'error';
    }
    return null;
  };

  it('is titled Pictures for a new set, and renders the screen of a new set for an active Account only', async () => {
    expect((await newMetadata()).title).toBe('Pictures');
    const element = await NewPicturesPage();
    expect(element.type).toBe(PictureIntake);
    expect(element.props).toEqual({});
    mocks.access = {state: 'disabled'};
    await expect(NewPicturesPage()).rejects.toThrow('not active');
  });

  it('is titled in Hebrew when the request is', async () => {
    request.cookies = {'nova3d-locale': 'he'};
    expect((await newMetadata()).title).toBe(translate('he', 'meta.pictures'));
  });

  it('shows the saved set of a Project whose latest request is an unconfirmed picture request, with its revision number and its pictures in order', async () => {
    found(unconfirmed);
    const element = await ProjectPicturesPage({params});
    expect(element.type).toBe(PictureIntake);
    expect(element.props).toEqual({projectId: PROJECT, title: row.title, revision: 3, saved: unconfirmed.images});
    expect(mocks.readProject).toHaveBeenCalledWith({accountId: ACCOUNT, epoch: 4}, PROJECT, expect.anything());
  });

  it.each([
    ['a text request', {...unconfirmed, mode: 'evidence_text' as const, confirmed: true, subjectId: 'middot-altar-ramp', scope: 's', outcome: 'o', description: 'd', confirmedAt: '2026-10-18T19:12:12+00:00', images: []}],
    ['a confirmed picture request', {...unconfirmed, confirmed: true, scope: 's', outcome: 'o', description: 'd', confirmedAt: '2026-10-18T19:12:12+00:00'}],
    ['an unconfirmed request of another mode', {...unconfirmed, mode: 'image_direct' as const}],
    ['no request at all', null],
  ])('says the pictures cannot be changed here for %s, and offers the way back', async (_name, request) => {
    found(request);
    const element = await ProjectPicturesPage({params});
    expect(element.type).toBe(PicturesLocked);
    expect(element.props.project).toEqual(row);
  });

  it('is the one unavailable page for a Project that is another Account\'s, deleted, unknown or not an ID, whatever the request says', async () => {
    mocks.readProject.mockResolvedValue({outcome: 'unavailable'});
    expect(await digest(ProjectPicturesPage({params}))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    found(null);
    mocks.readProjectRequest.mockResolvedValue({outcome: 'unavailable'});
    expect(await digest(ProjectPicturesPage({params}))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(ProjectPicturesPage({params: Promise.resolve({projectId: 'not-an-id'})}))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('sends the person Home when the Account has no authority for the read', async () => {
    mocks.readProject.mockResolvedValue({outcome: 'denied'});
    expect(await digest(ProjectPicturesPage({params}))).toMatch(/^NEXT_REDIRECT;replace;\/;/);
    found(null);
    mocks.readProjectRequest.mockResolvedValue({outcome: 'denied'});
    expect(await digest(ProjectPicturesPage({params}))).toMatch(/^NEXT_REDIRECT;replace;\/;/);
  });

  it('says to try again, and not that the Project is not the person\'s, when the database cannot be read', async () => {
    mocks.readProject.mockRejectedValue(new Error('down'));
    const project = await ProjectPicturesPage({params});
    expect(JSON.stringify(project)).toContain('project.error.title');
    found(unconfirmed);
    mocks.readProjectRequest.mockRejectedValue(new Error('down'));
    const requestDown = await ProjectPicturesPage({params});
    expect(JSON.stringify(requestDown)).toContain('project.error.title');
    expect(JSON.stringify(requestDown)).not.toContain(PROJECT);
    const markup = render('en', <Unreadable title="project.error.title" body="project.error.body" headingLevel={1}/>);
    expect(text(markup)).toContain(translate('en', 'project.error.title'));
  });

  it('titles the page Pictures when the Project is there or cannot be read, and Project not available otherwise', async () => {
    found(unconfirmed);
    expect((await projectMetadata({params})).title).toBe('Pictures');
    mocks.readProject.mockResolvedValue({outcome: 'unavailable'});
    expect((await projectMetadata({params})).title).toBe(translate('en', 'meta.projectUnavailable'));
    mocks.readProject.mockRejectedValue(new Error('down'));
    expect((await projectMetadata({params})).title).toBe('Pictures');
    mocks.access = {state: 'disabled'};
    expect((await projectMetadata({params})).title).toBe(translate('en', 'meta.projectUnavailable'));
  });
});

// C-03 -----------------------------------------------------------------------------------------------------------------------------

describe.each(locales)('C-03, the picture screen, empty, in %s', (locale) => {
  const markup = screen(locale);
  const words = text(markup);

  it('has one level-one heading that can take focus after a step, an eyebrow, a lede and the limits through placeholders', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1 tabindex="-1" class="request-title">/);
    expect(words).toContain(t(locale, 'picture.title.new'));
    expect(words).toContain(t(locale, 'picture.eyebrow.new'));
    expect(words).toContain(t(locale, 'picture.lede'));
    expect(words).toContain(t(locale, 'picture.limits', {count: maxPictures, ...formatParams, size: '12 MiB', total: '60 MiB'}));
  });

  it('says there are no pictures yet and how to add some, and shows no list, no totals and no error', () => {
    expect(words).toContain(t(locale, 'picture.empty.title'));
    expect(words).toContain(t(locale, 'picture.empty.body', {count: maxPictures}));
    expect(markup).toContain('state-empty');
    expect(markup).not.toContain('<ol');
    expect(markup).not.toContain('picture-totals');
    expect(markup).not.toContain('notice-danger');
    expect(markup).not.toContain('aria-invalid');
  });

  it('has a labelled file chooser for many files that accepts exactly JPEG, PNG and WebP, and is not disabled', () => {
    const tag = chooser(markup);
    expect(tag).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(attribute(tag, 'accept')?.split(',')).toEqual([...pictureTypes]);
    expect(tag).toMatch(/\bmultiple=""/);
    expect(tag).not.toMatch(/\bdisabled\b/);
    expect(tag).toContain('class="visually-hidden"');
    expect(markup).toMatch(new RegExp(`<label class="btn btn-secondary picture-choose"><svg[\\s\\S]*?</svg><span>${t(locale, 'picture.choose')}</span><input`));
  });

  it('keeps the other file input (the one Replace opens) out of sight, for one file', () => {
    const tag = /<input\b(?![^>]*\bmultiple\b)[^>]*type="file"[^>]*\bhidden=""[^>]*>/.exec(markup)?.[0] ?? '';
    expect(tag).toBeTruthy();
    expect(tag).not.toMatch(/\bmultiple\b/);
    expect(tag).toContain('accept="image/jpeg,image/png,image/webp"');
  });

  it('offers no Take photo before the page is hydrated, and asks for no camera', () => {
    expect(words).not.toContain(t(locale, 'picture.camera.take'));
    expect(markup).not.toContain('<video');
    expect(markup).not.toContain('picture-camera');
  });

  it('has a Save pictures button that submits the form, a note that saving confirms nothing, and a status region', () => {
    expect(markup).toMatch(new RegExp(`<button type="submit" class="btn btn-primary"[^>]*><span>${t(locale, 'picture.save')}</span>`));
    expect(markup).toMatch(/<form[^>]*noValidate/);
    expect(words).toContain(t(locale, 'picture.save.note'));
    expect(markup).toContain('role="status"');
  });

  it('carries the command, a Project field that is empty for a new set, and no upload', () => {
    expect(markup).toMatch(/<input type="hidden" name="commandId" value=""\/>/);
    expect(markup).toMatch(/<input type="hidden" name="projectId" value=""\/>/);
    expect(markup).not.toContain('name="uploadId"');
  });

  it('links nowhere: no way back for a set that has no Project yet, and no link of any kind in the screen', () => {
    expect(markup).not.toMatch(/<a\b/);
    expect(markup).not.toMatch(/\bdownload=/);
    expect(markup).not.toMatch(/<img\b/);
  });
});

describe.each(locales)('C-03, the picture screen of a Project, in %s', (locale) => {
  const saved = [savedPicture(1), savedPicture(2), savedPicture(3, {contentType: 'image/webp', length: 2048})];
  const markup = screen(locale, {projectId: PROJECT, title: 'Statue <b>photos</b>', revision: 2, saved});
  const words = text(markup);

  it('says it is changing the pictures, names the Project in an isolated run, and sends the way back to the Project', () => {
    expect(words).toContain(t(locale, 'picture.title.change'));
    expect(words).toContain(t(locale, 'picture.eyebrow.change'));
    expect(markup).toContain('<bdi>Statue &lt;b&gt;photos&lt;/b&gt;</bdi>');
    expect(markup).toMatch(new RegExp(`<a class="btn btn-quiet" href="/projects/${PROJECT}">(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'picture.back')}</span></a>`));
    expect([...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1])).toEqual([`/projects/${PROJECT}`]);
  });

  it('starts from the saved pictures in their order, ready, with no preview and no image', () => {
    const list = rows(markup);
    expect(list).toHaveLength(3);
    expect(list.map((row) => /<h3[^>]*>([^<]*)<\/h3>/.exec(row)?.[1])).toEqual([1, 2, 3].map((position) => t(locale, 'picture.item.title', {position, count: 3})));
    expect(markup).not.toMatch(/<img\b/);
    expect(markup).not.toContain('blob:');
    for (const row of list) expect(row).toContain(t(locale, 'picture.item.noPreview'));
  });

  it('writes each picture\'s kind and size as isolated tokens, and when its private copy lapses (UTC)', () => {
    const list = rows(markup);
    expect(text(list[0])).toContain(t(locale, 'picture.item.details', {type: 'JPEG', size: formatBytes(482113)}));
    expect(text(list[2])).toContain(t(locale, 'picture.item.details', {type: 'WebP', size: '2 KiB'}));
    for (const row of list) expect(text(row)).toContain(t(locale, 'picture.item.saved', {time: '2026-10-19 12:34 UTC'}));
  });

  it('carries the Project and the saved uploads, in order, in the form', () => {
    expect(markup).toContain(`<input type="hidden" name="projectId" value="${PROJECT}"/>`);
    expect([...markup.matchAll(/name="uploadId" value="([^"]*)"/g)].map((match) => match[1])).toEqual(saved.map((picture) => picture.uploadId));
  });

  it('shows no problem for a set that is all there', () => {
    expect(markup).not.toContain('notice-danger');
    expect(markup).not.toContain('notice-warning');
  });
});

describe.each(locales)('C-03, the pictures of the set, in %s (UX-DR33)', (locale) => {
  it('numbers the pictures by position and count, and totals them', () => {
    const markup = screen(locale, {initial: {set: setOf({}, {}, {})}});
    expect(rows(markup).map((row) => /<h3[^>]*>([^<]*)<\/h3>/.exec(row)?.[1])).toEqual([1, 2, 3].map((position) => t(locale, 'picture.item.title', {position, count: 3})));
    expect(text(markup)).toContain(t(locale, 'picture.totals', {count: 3, max: 12, size: formatBytes(3 * 482113), total: '60 MiB'}));
    expect(text(markup)).toContain(t(locale, 'picture.list.title'));
    expect(text(markup)).toContain(t(locale, 'picture.list.help'));
  });

  it('gives every picture real buttons for Move earlier, Move later, Replace and Remove, each named with its picture for a screen reader, and no drag and drop', () => {
    const markup = screen(locale, {initial: {set: setOf({}, {}, {})}});
    for (const [index, row] of rows(markup).entries()) {
      for (const [action, key] of [['replace', 'picture.item.replace'], ['remove', 'picture.item.remove']] as const) {
        const tag = button(row, action);
        expect(tag, `${action} of ${index + 1}`).toMatch(/^<button type="button"/);
        expect(attribute(tag, 'data-key')).toBe(`k${index + 1}`);
        expect(row).toContain(`<span>${t(locale, key)}<span class="visually-hidden"> ${t(locale, 'picture.item.picture', {position: index + 1})}</span></span>`);
      }
      // On purpose changed (review patch C5): a move is written for a screen reader as one phrase of the language's own order ("Move picture 2 earlier"), and the
      // visible words ("Move earlier") are hidden from the accessibility tree, so the picture's number is never read after them.
      for (const [action, key, spoken] of [['earlier', 'picture.item.earlier', 'picture.item.earlierNamed'], ['later', 'picture.item.later', 'picture.item.laterNamed']] as const) {
        const tag = button(row, action);
        expect(tag, `${action} of ${index + 1}`).toMatch(/^<button type="button"/);
        expect(attribute(tag, 'data-key')).toBe(`k${index + 1}`);
        expect(row).toContain(`<span><span aria-hidden="true">${t(locale, key)}</span><span class="visually-hidden">${t(locale, spoken, {position: index + 1})}</span></span>`);
      }
    }
    expect(markup).not.toMatch(/draggable|\bondrag|\bondrop|aria-grabbed|aria-dropeffect/i);
  });

  it('cannot move the first picture earlier or the last later, and nothing else is disabled', () => {
    const list = rows(screen(locale, {initial: {set: setOf({}, {}, {})}}));
    expect(button(list[0], 'earlier')).toMatch(/\bdisabled=""/);
    expect(button(list[0], 'later')).not.toMatch(/\bdisabled\b/);
    expect(button(list[1], 'earlier')).not.toMatch(/\bdisabled\b/);
    expect(button(list[1], 'later')).not.toMatch(/\bdisabled\b/);
    expect(button(list[2], 'earlier')).not.toMatch(/\bdisabled\b/);
    expect(button(list[2], 'later')).toMatch(/\bdisabled=""/);
    for (const row of list) {
      expect(button(row, 'replace')).not.toMatch(/\bdisabled\b/);
      expect(button(row, 'remove')).not.toMatch(/\bdisabled\b/);
    }
    // One picture can move nowhere.
    const [only] = rows(screen(locale, {initial: {set: setOf({})}}));
    expect(button(only, 'earlier')).toMatch(/\bdisabled=""/);
    expect(button(only, 'later')).toMatch(/\bdisabled=""/);
  });

  it('shows a local preview of a chosen file with a text alternative, and only a blob: address', () => {
    const markup = screen(locale, {initial: {set: setOf({previewUrl: 'blob:http://127.0.0.1:4173/abc'}, {previewUrl: 'blob:http://127.0.0.1:4173/def'}, {})}});
    const sources = [...markup.matchAll(/<img\b[^>]*src="([^"]*)"/g)].map((match) => match[1]);
    expect(sources).toEqual(['blob:http://127.0.0.1:4173/abc', 'blob:http://127.0.0.1:4173/def']);
    expect(markup).toContain(`alt="${t(locale, 'picture.item.preview', {position: 1})}"`);
    expect(markup).toContain(`alt="${t(locale, 'picture.item.preview', {position: 2})}"`);
    expect(rows(markup)[2]).not.toContain('<img');
    expect(markup).not.toMatch(/\bdownload=|<a\b/);
  });

  it('says a picture is being checked, then how far its upload has gone, then that it is kept privately', () => {
    const markup = screen(locale, {initial: {set: setOf({state: 'checking', progress: 0, uploadId: null, sha256: null}, {state: 'uploading', progress: 0.456, uploadId: null}, {state: 'ready'})}});
    const [checking, uploading, ready] = rows(markup);
    expect(text(checking)).toContain(t(locale, 'picture.item.checking'));
    expect(checking).not.toContain('<progress');
    expect(uploading).toMatch(/<progress value="46" max="100" aria-label="[^"]+"/);
    expect(uploading).toContain(`aria-label="${t(locale, 'picture.item.progress', {position: 2})}"`);
    expect(text(uploading)).toContain(t(locale, 'picture.item.uploading', {percent: 46}));
    expect(text(ready)).toContain(t(locale, 'picture.item.ready'));
    expect(ready).not.toContain('<progress');
  });

  it('carries only the pictures that are ready, in order, in the form', () => {
    const markup = screen(locale, {projectId: null, initial: {set: setOf({}, {state: 'uploading', progress: 0.1, uploadId: null}, {state: 'failed', problem: 'network', file: file(), uploadId: null}, {})}});
    expect([...markup.matchAll(/name="uploadId" value="([^"]*)"/g)].map((match) => match[1])).toEqual([upload(1), upload(4)]);
  });

  it('writes the total of the pictures with their sizes as isolated tokens', () => {
    const markup = screen(locale, {initial: {set: setOf({length: 12 * 1024 * 1024}, {length: 1536 * 1024})}});
    expect(text(markup)).toContain(t(locale, 'picture.totals', {count: 2, max: 12, size: '13.5 MiB', total: '60 MiB'}));
  });
});

describe.each(locales)('C-03, an upload that did not finish, in %s', (locale) => {
  const failed = (problem: (typeof uploadProblems)[number], withFile = true) => {
    const markup = screen(locale, {initial: {set: setOf({state: 'failed', progress: 0, problem, uploadId: null, file: withFile ? file() : null})}});
    return {markup, row: rows(markup)[0]};
  };

  it.each(uploadProblems)('says what %s means in plain words, in an alert, and describes its buttons with it', (problem) => {
    const {row} = failed(problem);
    expect(text(row)).toContain(t(locale, uploadProblemKeys[problem], {...formatParams, size: '12 MiB'}));
    expect(row).toMatch(/<div class="notice notice-danger" role="alert">/);
    const id = /<p class="notice-text" id="([^"]+)"/.exec(row)?.[1];
    expect(id).toBeTruthy();
    expect(attribute(button(row, 'replace'), 'aria-describedby')).toBe(id);
    expect(text(row)).not.toContain(t(locale, 'picture.item.ready'));
  });

  it.each([
    ['changed', true],
    ['quota', true],
    ['conflict', true],
    ['unavailable', true],
    ['network', true],
    ['rejected', true],
    ['reload', false],
    ['content', false],
    ['type', false],
    ['too_large', false],
    ['duplicate', false],
  ] as const)('offers Try again for %s only when trying the same file again can help: %s', (problem, retry) => {
    const {row} = failed(problem);
    expect(button(row, 'retry') !== '').toBe(retry);
    if (retry) expect(attribute(button(row, 'retry'), 'aria-describedby')).toBe(/<p class="notice-text" id="([^"]+)"/.exec(row)?.[1]);
  });

  it('offers no Try again for a picture whose file is not here any more, only Replace and Remove', () => {
    const {row} = failed('network', false);
    expect(button(row, 'retry')).toBe('');
    expect(button(row, 'replace')).not.toBe('');
    expect(button(row, 'remove')).not.toBe('');
  });

  it('leaves the other pictures as they are', () => {
    const markup = screen(locale, {initial: {set: setOf({}, {state: 'failed', problem: 'content', uploadId: null, file: file()}, {})}});
    const [first, , third] = rows(markup);
    expect(first).not.toContain('notice-danger');
    expect(third).not.toContain('notice-danger');
    expect(text(first)).toContain(t(locale, 'picture.item.ready'));
  });
});

describe.each(locales)('C-03, a saved picture whose private copy has lapsed, in %s', (locale) => {
  it('warns on that picture alone, with Replace described by the warning, and says the set cannot be saved as it stands once Save has been tried', () => {
    const set = savedSet([savedPicture(1), savedPicture(2, {available: false, expiresAt: null}), savedPicture(3)], (picture) => `saved-${picture.position}`);
    const markup = screen(locale, {projectId: PROJECT, revision: 1, initial: {set, tried: true}});
    const [first, second, third] = rows(markup);
    expect(second).toContain('notice-warning');
    expect(text(second)).toContain(t(locale, 'picture.item.expired'));
    expect(first).not.toContain('notice-warning');
    expect(third).not.toContain('notice-warning');
    expect(text(second)).not.toContain(t(locale, 'picture.item.ready'));
    const id = /<p class="notice-text" id="([^"]+)"/.exec(second)?.[1];
    expect(attribute(button(second, 'replace'), 'aria-describedby')).toBe(id);
    expect(button(second, 'retry')).toBe('');
    expect(text(markup)).toContain(t(locale, setProblemKeys.expired));
  });
});

describe.each(locales)('C-03, files that were not added, in %s', (locale) => {
  const names = ['IMG_0001.HEIC', 'notes.txt', 'empty.png', 'big.jpg', 'thirteenth.jpg', 'sixth.jpg', 'copy.jpg', '<script>alert(1)</script>.jpg'];
  const problems = [
    {name: names[0], problem: 'type' as const},
    {name: names[1], problem: 'type' as const},
    {name: names[2], problem: 'empty' as const},
    {name: names[3], problem: 'too_large' as const},
    {name: names[4], problem: 'too_many' as const},
    {name: names[5], problem: 'set_too_large' as const},
    {name: names[6], problem: 'duplicate' as const},
    {name: names[7], problem: 'unreadable' as const},
  ];
  const markup = screen(locale, {initial: {problems}});

  it('names every file with its own problem in plain words, in an alert, in one list', () => {
    expect(markup).toMatch(/<div class="notice notice-danger" role="alert">/);
    expect(text(markup)).toContain(t(locale, 'picture.problems.title'));
    expect(markup.match(/<li>/g)).toHaveLength(problems.length);
    const words = text(markup);
    for (const {name, problem} of problems) {
      const expected = t(locale, fileProblemKeys[problem], {name: name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), ...formatParams, size: formatBytes(problem === 'set_too_large' ? maxSetBytes : maxPictureBytes), count: maxPictures});
      expect(words, problem).toContain(text(expected));
    }
  });

  it('knows a message for every file problem', () => {
    expect(Object.keys(fileProblemKeys)).toEqual([...fileProblems]);
    for (const problem of fileProblems) expect(t(locale, fileProblemKeys[problem], {name: 'x', ...formatParams, size: '12 MiB', count: 12}).length).toBeGreaterThan(10);
  });

  it('isolates the file\'s name so its own direction cannot reorder the sentence, and writes it as text (never as markup)', () => {
    expect(markup).toContain('⁨IMG_0001.HEIC⁩');
    expect(markup).toContain('⁨&lt;script&gt;alert(1)&lt;/script&gt;.jpg⁩');
    expect(markup).not.toContain('<script>alert');
  });

  it('names the three accepted formats for a HEIC file through three placeholders, as a list in the language\'s own words, so the Hebrew catalog holds no Latin word (review patch C4)', () => {
    // The formats are read as a list: English "JPEG, PNG or WebP", Hebrew with its own "או"; each name is an isolated token.
    const list = {en: '⁨JPEG⁩, ⁨PNG⁩ or ⁨WebP⁩', he: '⁨JPEG⁩, ב-⁨PNG⁩ או ב-⁨WebP⁩'}[locale];
    expect(markup).toContain(list);
    expect(markup).not.toContain('JPEG, PNG, WebP');
    for (const key of ['picture.problem.type', 'picture.upload.type', 'picture.limits'] as const) {
      const message = translate(locale, key, {name: '{n}', count: 1, size: '{s}', total: '{t}', jpeg: '{a}', png: '{b}', webp: '{c}'}, {isolate: false});
      expect(message, `${locale}:${key}`).toContain('{a}');
      expect(message, `${locale}:${key}`).toContain('{b}');
      expect(message, `${locale}:${key}`).toContain('{c}');
      if (locale === 'he') expect(message.replace(/\{\w+\}/g, ''), key).not.toMatch(/[A-Za-z]{2,}/);
    }
    expect(translate('en', 'picture.problem.type', {name: 'x', ...formatParams}, {isolate: false})).toContain('JPEG, PNG or WebP');
    expect(translate('he', 'picture.problem.type', {name: 'x', ...formatParams}, {isolate: false})).toContain('או');
  });

  it('marks the file chooser as having a problem and describes it with the list', () => {
    const tag = chooser(markup);
    expect(tag).toContain('aria-invalid="true"');
    const ids = (attribute(tag, 'aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    const list = /<div class="invite-notice" tabindex="-1" id="([^"]+)">\s*<div class="notice notice-danger" role="alert">/.exec(markup)?.[1];
    expect(ids).toContain(list);
    for (const id of ids) expect(markup).toContain(`id="${id}"`);
  });

  it('adds no pictures to the list for files that were not added', () => {
    expect(markup).not.toContain('<ol');
    expect(markup).toContain('state-empty');
  });
});

describe.each(locales)('C-03, the camera, in %s (UX-DR9)', (locale) => {
  it('offers Take photo as a button where the browser can, and only then', () => {
    const markup = screen(locale, {initial: {supported: true}});
    expect(markup).toMatch(new RegExp(`<button type="button" class="btn btn-secondary"[^>]*><svg[\\s\\S]*?</svg><span>${t(locale, 'picture.camera.take')}</span>`));
    expect(markup).not.toContain('<video');
    expect(text(screen(locale, {initial: {supported: false}}))).not.toContain(t(locale, 'picture.camera.take'));
  });

  it('shows the permission prompt as words while the browser asks, with Cancel and no preview, and Take photo cannot be pressed twice', () => {
    const markup = screen(locale, {initial: {supported: true, camera: 'asking'}});
    expect(text(markup)).toContain(t(locale, 'picture.camera.asking'));
    expect(markup).toMatch(/<div class="notice notice-info" role="status">/);
    expect(markup).not.toContain('<video');
    expect(text(markup)).toContain(t(locale, 'picture.camera.cancel'));
    expect(markup).not.toContain(`<span>${t(locale, 'picture.camera.capture')}</span>`);
    expect(/<button\b[^>]*disabled[^>]*><svg[\s\S]*?<span>[^<]*<\/span>/.exec(markup)?.[0]).toContain(t(locale, 'picture.camera.take'));
  });

  it('shows a live preview with Capture and Cancel when the camera is on, named for a screen reader and playing inline without sound', () => {
    const markup = screen(locale, {initial: {supported: true, camera: 'live'}});
    expect(text(markup)).toContain(t(locale, 'picture.camera.live'));
    expect(markup).toMatch(/<video\b[^>]*aria-label="[^"]+"/);
    expect(markup).toContain(`aria-label="${t(locale, 'picture.camera.preview')}"`);
    expect(markup).toMatch(/<video\b[^>]*playsInline/i);
    expect(markup).toMatch(/<video\b[^>]*muted/);
    expect(markup).toContain(`<span>${t(locale, 'picture.camera.capture')}</span>`);
    expect(markup).toContain(`<span>${t(locale, 'picture.camera.cancel')}</span>`);
    expect(markup).not.toContain('src=');
  });

  it('says in words that the camera cannot be used when it was refused or there is none, and that choosing files still works', () => {
    const markup = screen(locale, {initial: {supported: true, cameraNotice: 'denied'}});
    expect(text(markup)).toContain(t(locale, 'picture.camera.deniedTitle'));
    expect(text(markup)).toContain(t(locale, 'picture.camera.denied'));
    expect(markup).toMatch(/<div class="notice notice-warning" role="status">/);
    expect(chooser(markup)).not.toMatch(/\bdisabled\b/);
    expect(markup).not.toContain('<video');
  });

  it('says in an alert that the camera gave no picture when it did not', () => {
    const markup = screen(locale, {initial: {supported: true, camera: 'live', cameraNotice: 'failed'}});
    expect(text(markup)).toContain(t(locale, 'picture.camera.failed'));
    expect(markup).toMatch(/<div class="notice notice-danger" role="alert">/);
  });

  it('records nothing about the camera on the screen: no storage, no cookie, no permission name', () => {
    const markup = screen(locale, {initial: {supported: true, camera: 'live'}});
    expect(markup).not.toMatch(/localStorage|cookie|permission=|geolocation/i);
  });
});

describe.each(locales)('C-03, a page that cannot hash, in %s', (locale) => {
  const markup = screen(locale, {initial: {secure: false, supported: true}});

  it('says so, and why, instead of failing on the first file', () => {
    expect(text(markup)).toContain(t(locale, 'picture.secure.title'));
    expect(text(markup)).toContain(t(locale, 'picture.secure.body', {scheme: 'https'}));
    expect(markup).toMatch(/<div class="notice notice-warning" role="note">/);
  });

  it('turns the file chooser and Take photo off', () => {
    expect(chooser(markup)).toMatch(/\bdisabled=""/);
    expect(markup).toContain('picture-choose-disabled');
    expect(/<button\b[^>]*disabled=""[^>]*><svg[\s\S]*?<span>([^<]*)<\/span>/.exec(markup)?.[1]).toBe(t(locale, 'picture.camera.take'));
  });

  it('says nothing about it where the page can hash', () => {
    expect(text(screen(locale, {initial: {secure: true}}))).not.toContain(t(locale, 'picture.secure.title'));
  });
});

describe.each(locales)('C-03, saving, in %s', (locale) => {
  const ready = setOf({}, {}, {});
  const withIssue = (set: PictureSet, extra: Props['initial'] = {}) => screen(locale, {initial: {set, tried: true, ...extra}});

  it.each([
    ['empty', [] as Partial<PictureItem>[]],
    ['busy', [{}, {state: 'uploading' as const, progress: 0.2, uploadId: null}]],
    ['failed', [{}, {state: 'failed' as const, problem: 'network' as const, uploadId: null, file: file()}]],
    ['expired', [{saved: true, available: false}]],
  ] as const)('says why the set cannot be saved as it stands (%s), in an alert that the Save button is described by', (problem, patches) => {
    const markup = withIssue(setOf(...patches));
    const words = text(markup);
    expect(words).toContain(t(locale, setProblemKeys[problem]));
    const id = /<div class="invite-notice" tabindex="-1" id="([^"]+)"><div class="notice notice-danger" role="alert">/.exec(markup)?.[1];
    expect(id).toBeTruthy();
    expect(attribute(/<button type="submit"[^>]*>/.exec(markup)?.[0] ?? '', 'aria-describedby')?.split(' ')).toContain(id);
  });

  it('says nothing before Save is pressed, and nothing for a set that can be saved', () => {
    expect(screen(locale, {initial: {set: []}})).not.toContain(t(locale, setProblemKeys.empty));
    expect(withIssue(ready)).not.toContain('notice-danger');
    expect(attribute(/<button type="submit"[^>]*>/.exec(withIssue(ready))?.[0] ?? '', 'aria-describedby')?.split(' ')).toHaveLength(1);
  });

  const states: [string, SaveState, MessageKey, Record<string, string | number>][] = [
    ['an invalid form', {outcome: 'invalid'}, 'picture.save.invalid', {}],
    ['an upload that is not the Account\'s', {outcome: 'unknown_upload', position: 2}, 'picture.save.unknownUpload', {position: 2}],
    ['an upload that has not finished', {outcome: 'not_ready', position: 3}, 'picture.save.notReady', {position: 3}],
    ['an upload that has expired', {outcome: 'expired_upload', position: 1}, 'picture.save.expiredUpload', {position: 1}],
    ['a picture that is the same as an earlier one, as the database read it from the leases', {outcome: 'duplicate_image', position: 2}, 'picture.save.duplicateImage', {position: 2}],
    ['pictures that are together too large', {outcome: 'too_large'}, 'picture.save.tooLarge', {size: '60 MiB'}],
    ['a command that was used for something else', {outcome: 'reused'}, 'picture.save.reused', {}],
    ['a Project that is gone', {outcome: 'gone'}, 'picture.save.gone', {}],
    ['a request that can no longer be changed', {outcome: 'not_editable'}, 'picture.save.notEditable', {}],
    ['a service that did not answer, and nothing saved', {outcome: 'unavailable', unknown: false}, 'picture.save.unavailable', {}],
    ['a service that did not answer, and the pictures possibly saved', {outcome: 'unavailable', unknown: true}, 'picture.save.unknown', {}],
  ];
  it.each(states)('says %s in its own words, in an alert, and nothing else', (_name, save, key, params) => {
    const markup = screen(locale, {initial: {set: ready, save}});
    expect(text(markup)).toContain(t(locale, key, params));
    expect(markup).toMatch(/<div class="notice notice-danger" role="alert">/);
    const alerts = [...markup.matchAll(/class="notice notice-danger" role="alert"/g)];
    expect(alerts).toHaveLength(1);
  });

  it('says nothing for a Save that has not been answered', () => {
    expect(screen(locale, {initial: {set: ready, save: {outcome: 'idle'}}})).not.toContain('notice-danger');
  });

  it('tells the person to look in My Projects when the pictures were possibly saved, and that saving again is safe', () => {
    const words = text(screen(locale, {initial: {set: ready, save: {outcome: 'unavailable', unknown: true}}}));
    expect(words).toContain(t(locale, 'picture.save.unknown'));
  });
});

const savedRequest: ProjectRequestRow = {
  id: REQUEST,
  projectId: PROJECT,
  seq: 1,
  mode: 'evidence_images',
  confirmed: false,
  subjectId: null,
  scope: null,
  outcome: null,
  description: null,
  personalization: {wording: null, text: null, style: null, applied: false, reason: null},
  confirmedAt: null,
  images: [savedPicture(1)],
};

describe.each(locales)('C-03, the words of the screen about privacy and how long pictures stay, in %s (review patches C1, C2)', (locale) => {
  const words = text(screen(locale));

  it('says before Save that pictures stay in private staging for 24 hours after the last save, renewed by each save, and never more than 7 days after they were uploaded', () => {
    const note = translate(locale, 'picture.save.note');
    expect(words).toContain(t(locale, 'picture.save.note'));
    expect(note).toMatch(/\b24\b/);
    expect(note).toMatch(/\b7\b/);
    // The note is above the Save button it is about, in the form.
    const markup = screen(locale);
    expect(markup.indexOf('picture-save')).toBeLessThan(markup.indexOf(t(locale, 'picture.save.note')));
    expect(markup.indexOf(t(locale, 'picture.save.note'))).toBeLessThan(markup.indexOf('type="submit"'));
    const english = translate('en', 'picture.save.note');
    expect(english).toMatch(/private staging/);
    expect(english).toMatch(/for 24 hours after your last save \(each save renews that\)/);
    expect(english).toMatch(/never longer than 7 days after they were uploaded/);
    expect(english).toMatch(/Project page shows when they lapse, in UTC/);
    expect(english).toMatch(/does not confirm your request, start research or charge anything/);
  });

  it('does not call the pictures "saved" without that: the lede says they go to staging when chosen, and the stage sentence says how long', () => {
    expect(translate('en', 'picture.lede')).toMatch(/private staging as soon as you choose it/);
    expect(translate('en', 'picture.lede')).not.toMatch(/saved/);
    for (const key of ['stage.request_draft.next', 'picture.save.note'] as const) {
      expect(translate(locale, key), `${locale}:${key}`).toMatch(/\b24\b/);
      expect(translate(locale, key), `${locale}:${key}`).toMatch(/\b7\b/);
    }
  });

  it('says honestly, in one sentence on the screen, that a staged picture keeps the location data it carries and is private to the Account', () => {
    expect(words).toContain(t(locale, 'picture.privacy'));
    expect(translate('en', 'picture.privacy')).toMatch(/exactly as you chose them, including any location data they carry/);
    expect(translate('en', 'picture.privacy')).toMatch(/private to your account/);
    expect(translate('he', 'picture.privacy')).toMatch(/נתוני מיקום/);
    // It promises nothing about removing location data (Story 2.12).
    expect(translate('en', 'picture.privacy')).not.toMatch(/remov|strip|delet/i);
    expect(translate('he', 'picture.privacy')).not.toMatch(/הסר|יוסר|תימחק|מחיקה/);
    expect(text(screen(locale, {projectId: PROJECT, revision: 1, saved: [savedPicture(1)]}))).toContain(t(locale, 'picture.privacy'));
  });

  it('says in the Pictures part of the Project page that the pictures are in private staging, and that nothing started or was charged', () => {
    expect(translate('en', 'picture.section.note')).toMatch(/private staging/);
    expect(translate('en', 'picture.section.note')).toMatch(/Nothing has started and nothing was charged/);
    expect(text(render(locale, <RequestSection data={{state: 'found', request: {...savedRequest}, subjectName: null}}/>))).toContain(t(locale, 'picture.section.note'));
  });
});

describe.each(locales)('C-03, the messages for a picture that is not ready, expired or released, in %s (review patch C3)', (locale) => {
  it('never say the upload was "interrupted", on the item or in the message after Save', () => {
    const item = screen(locale, {initial: {set: setOf({state: 'failed', progress: 0, problem: 'conflict', uploadId: null, file: file()})}});
    expect(text(item)).toContain(t(locale, uploadProblemKeys.conflict));
    expect(text(item)).not.toMatch(/interrupt|הופסק/i);
    for (const save of [{outcome: 'not_ready', position: 1}, {outcome: 'expired_upload', position: 1}] as const) {
      const markup = screen(locale, {initial: {set: setOf({}), save}});
      expect(text(markup), save.outcome).not.toMatch(/interrupt|הופסק/i);
    }
    expect(translate('en', 'picture.save.notReady', {position: 3})).toBe('Picture 3 is not ready to be saved: it did not finish uploading, or it was released in another window. Add it again.');
    expect(translate('en', 'picture.upload.conflict')).toMatch(/not ready/);
  });

  it('say a picture that is the same as an earlier one cannot be saved twice, and to remove it', () => {
    const item = screen(locale, {initial: {set: setOf({}, {state: 'failed', progress: 0, problem: 'duplicate', file: file()})}});
    const [, second] = rows(item);
    expect(text(second)).toContain(t(locale, uploadProblemKeys.duplicate));
    expect(button(second, 'retry')).toBe('');
    expect(button(second, 'remove')).not.toBe('');
    expect(translate('en', 'picture.upload.duplicate')).toMatch(/same picture as an earlier one/);
    expect(translate('en', 'picture.save.duplicateImage', {position: 2})).toMatch(/^Picture 2 is the same picture as an earlier one/);
  });
});

describe.each(locales)('C-03, while a Save is out, in %s (review patch B2)', (locale) => {
  const set = () => setOf({}, {state: 'failed', progress: 0, problem: 'network', file: file(), uploadId: null}, {});
  const locked = screen(locale, {initial: {set: set(), supported: true, locked: true}});
  const unlocked = screen(locale, {initial: {set: set(), supported: true}});

  it('turns off Choose files, Take photo and every Move, Replace, Remove and Try again, so the set cannot change under the Save that was sent', () => {
    expect(chooser(locked)).toMatch(/\bdisabled=""/);
    expect(/<button\b[^>]*disabled=""[^>]*><svg[\s\S]*?<span>([^<]*)<\/span>/.exec(locked)?.[1]).toBe(t(locale, 'picture.camera.take'));
    for (const row of rows(locked)) {
      for (const action of ['earlier', 'later', 'replace', 'remove']) expect(button(row, action), action).toMatch(/\bdisabled=""/);
    }
    expect(button(rows(locked)[1], 'retry')).toMatch(/\bdisabled=""/);
  });

  it('leaves them on when no Save is out', () => {
    expect(chooser(unlocked)).not.toMatch(/\bdisabled\b/);
    expect(button(rows(unlocked)[1], 'replace')).not.toMatch(/\bdisabled\b/);
    expect(button(rows(unlocked)[1], 'remove')).not.toMatch(/\bdisabled\b/);
    expect(button(rows(unlocked)[1], 'retry')).not.toMatch(/\bdisabled\b/);
    expect(button(rows(unlocked)[1], 'earlier')).not.toMatch(/\bdisabled\b/);
  });

  it('keeps the pictures and the form as they are', () => {
    expect(rows(locked)).toHaveLength(3);
    expect([...locked.matchAll(/name="uploadId" value="([^"]*)"/g)].map((match) => match[1])).toEqual([upload(1), upload(3)]);
    expect(locked).toMatch(/<button type="submit"/);
  });
});

describe.each(locales)('C-03, the preview of a picture, in %s (review patch B10)', (locale) => {
  it('is loaded without blocking and when it is near: decoding async, loading lazy', () => {
    const markup = screen(locale, {initial: {set: setOf({previewUrl: 'blob:http://127.0.0.1:4173/abc'})}});
    const tag = /<img\b[^>]*>/.exec(markup)?.[0] ?? '';
    expect(tag).toMatch(/decoding="async"/);
    expect(tag).toMatch(/loading="lazy"/);
    expect(tag).toMatch(/src="blob:/);
  });

  it('is in a media block with the thumbnail frame, and says nothing about a missing preview when there is one', () => {
    const row = rows(screen(locale, {initial: {set: setOf({previewUrl: 'blob:http://127.0.0.1:4173/abc'})}}))[0];
    expect(row).toMatch(/<div class="picture-media"><div class="picture-thumb"><img\b/);
    expect(row).not.toContain('picture-nopreview');
    expect(row).not.toContain('picture-thumb-empty');
  });

  it('explains a picture with no preview in visible text under its empty thumbnail, not in a title attribute only', () => {
    const [row] = rows(screen(locale, {projectId: PROJECT, revision: 1, saved: [savedPicture(1)]}));
    expect(row).toMatch(/<div class="picture-media"><div class="picture-thumb"><span class="picture-thumb-empty">[\s\S]*?<\/span><\/div><p class="picture-nopreview project-muted">/);
    expect(text(row)).toContain(t(locale, 'picture.item.noPreview'));
    expect(row).not.toMatch(/\btitle=/);
    expect(row.indexOf('picture-thumb-empty')).toBeLessThan(row.indexOf('picture-nopreview'));
    expect(row).not.toContain('<img');
  });
});

// A paragraph holds phrasing content only: a list or a block inside one is closed by the browser's parser where React's does not close it, so the server's markup
// and the client's tree differ and hydration fails. (A Notice writes its content inside a <p>.)
const blockInParagraph = (markup: string) => {
  for (const match of markup.matchAll(/<p\b[^>]*>((?:(?!<\/p>)[\s\S])*)<\/p>/g)) {
    const inner = /<(?:ul|ol|dl|div|p|section|form|table|h[1-6]|li|video)\b/.exec(match[1]);
    if (inner) return `${inner[0]} inside ${match[0].slice(0, 80)}`;
  }
  return null;
};

describe.each(locales)('the screen\'s markup is valid HTML for hydration, in %s', (locale) => {
  const manyProblems = fileProblems.map((problem) => ({name: `${problem}.jpg`, problem}));
  const states: [string, string][] = [
    ['empty', screen(locale)],
    ['a set in every state', screen(locale, {initial: {set: setOf({}, {state: 'checking', uploadId: null}, {state: 'uploading', progress: 0.3, uploadId: null}, {state: 'failed', problem: 'network', file: file(), uploadId: null}, {saved: true, available: false})}})],
    ['files that were not added', screen(locale, {initial: {problems: manyProblems}})],
    ['the camera on, with a notice', screen(locale, {initial: {supported: true, camera: 'live', cameraNotice: 'failed'}})],
    ['the camera refused', screen(locale, {initial: {supported: true, cameraNotice: 'denied'}})],
    ['a page that cannot hash', screen(locale, {initial: {secure: false}})],
    ['a set problem and a save failure', screen(locale, {initial: {set: [], tried: true, save: {outcome: 'unknown_upload', position: 1}}})],
    ['a Project\'s saved set', screen(locale, {projectId: PROJECT, revision: 1, saved: [savedPicture(1), savedPicture(2, {available: false})]})],
  ];
  it.each(states)('has no list, block or paragraph inside a paragraph: %s', (_name, markup) => {
    expect(blockInParagraph(markup)).toBeNull();
  });
});

describe('the catalog of the screen', () => {
  it('has a message for every problem and every state it can show, in both languages', () => {
    for (const locale of locales) {
      for (const problem of uploadProblems) expect(t(locale, uploadProblemKeys[problem], {...formatParams, size: 'S'}), `${locale}:${problem}`).not.toBe(uploadProblemKeys[problem]);
      for (const key of Object.values(setProblemKeys)) expect(t(locale, key), `${locale}:${key}`).not.toBe(key);
    }
  });
});

// The Project page -----------------------------------------------------------------------------------------------------------------

describe.each(locales)('the Pictures part of the Request section, in %s', (locale) => {
  const request = (patch: Partial<ProjectRequestRow> = {}): ProjectRequestRow => ({
    id: REQUEST,
    projectId: PROJECT,
    seq: 1,
    mode: 'evidence_images',
    confirmed: false,
    subjectId: null,
    scope: null,
    outcome: null,
    description: null,
    personalization: {wording: null, text: null, style: null, applied: false, reason: null},
    confirmedAt: null,
    images: [savedPicture(1), savedPicture(2, {contentType: 'image/png', length: 5 * 1024 * 1024}), savedPicture(3, {contentType: 'image/webp', available: false, expiresAt: null})],
    ...patch,
  });
  const section = (data: RequestSectionData) => render(locale, <RequestSection data={data}/>);
  const markup = section({state: 'found', request: request(), subjectName: null});
  const words = text(markup);

  it('says the request is not confirmed yet, and how many pictures are saved', () => {
    expect(words).toContain(t(locale, 'request.section.title'));
    expect(words).toContain(t(locale, 'picture.section.status'));
    expect(words).toContain(t(locale, 'picture.section.notConfirmed'));
    expect(words).toContain(t(locale, 'picture.section.count'));
    expect(markup).toMatch(/<dt>[^<]*<\/dt><dd>3<\/dd>/);
  });

  it('lists the pictures in order, with position, kind, size and a short SHA-256, as isolated tokens', () => {
    const items = markup.split('<li class="picture-saved-item">').slice(1);
    expect(items).toHaveLength(3);
    expect(text(items[0])).toContain(t(locale, 'picture.section.position', {position: 1}));
    expect(text(items[1])).toContain(t(locale, 'picture.section.position', {position: 2}));
    expect(items[0]).toContain('<bdi dir="ltr" class="ltr-token">JPEG</bdi>');
    expect(items[1]).toContain('<bdi dir="ltr" class="ltr-token">PNG</bdi>');
    expect(items[1]).toContain('<bdi dir="ltr" class="ltr-token">5 MiB</bdi>');
    expect(items[2]).toContain('<bdi dir="ltr" class="ltr-token">WebP</bdi>');
    expect(items[0]).toContain(`<bdi dir="ltr" class="ltr-token">${sha('a').slice(0, 12)}</bdi>`);
    expect(items[1]).toContain(`<bdi dir="ltr" class="ltr-token">${sha('b').slice(0, 12)}</bdi>`);
    expect(markup).not.toContain(sha('a'));
    expect(text(items[0])).toContain(t(locale, 'picture.section.fingerprint', {algorithm: 'SHA-256'}));
  });

  it('says when each private copy lapses (UTC), and warns of one that has gone', () => {
    const items = markup.split('<li class="picture-saved-item">').slice(1);
    expect(text(items[0])).toContain(t(locale, 'picture.section.lapses', {time: '2026-10-19 12:34 UTC'}));
    expect(items[0]).not.toContain('notice-warning');
    expect(items[2]).toMatch(/<div class="picture-note"><div class="notice notice-warning">/);
    expect(text(items[2])).toContain(t(locale, 'picture.section.unavailable'));
    expect(text(items[2])).not.toContain(t(locale, 'picture.section.lapses', {time: ''}).trim());
  });

  it('offers Change pictures, a link to the Project\'s picture screen, while the request is an unconfirmed set of pictures', () => {
    expect(markup).toMatch(new RegExp(`<a class="btn btn-secondary" href="/projects/${PROJECT}/pictures">(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'picture.section.change')}</span></a>`));
    expect([...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1])).toEqual([`/projects/${PROJECT}/pictures`]);
  });

  it('offers no Change pictures for an unconfirmed request of another mode', () => {
    const other = section({state: 'found', request: request({mode: 'image_direct'}), subjectName: null});
    expect(other).not.toMatch(/<a\b/);
    expect(text(other)).toContain(t(locale, 'picture.section.notConfirmed'));
  });

  it('says what is saved and that nothing has started or was charged, and claims nothing that was not confirmed', () => {
    expect(words).toContain(t(locale, 'picture.section.note'));
    // (The labels are checked as labels: "not confirmed yet" holds the word "confirmed" in Hebrew.)
    for (const key of ['request.review.subject', 'request.review.scope', 'request.review.outcome', 'request.review.mode', 'request.review.personalization', 'request.section.confirmed'] as const) {
      expect(markup, key).not.toContain(`<dt>${t(locale, key)}</dt>`);
    }
    expect(words).not.toContain(t(locale, 'request.section.nothingStarted'));
  });

  it('shows no picture and links no download: only what the request records', () => {
    expect(markup).not.toMatch(/<img\b|<video|<canvas|\bdownload=|\bsrc=|blob:|https?:/);
  });

  it('shows a request that is confirmed as it always did, with no pictures part', () => {
    const confirmed = section({
      state: 'found',
      request: request({mode: 'evidence_text', confirmed: true, subjectId: 'middot-altar-ramp', scope: 'The outer altar', outcome: 'A model', description: 'The altar', confirmedAt: '2026-10-18T19:12:12.844515+00:00', images: []}),
      subjectName: 'The outer altar and ramp (Middot 3)',
    });
    expect(text(confirmed)).toContain(t(locale, 'request.section.confirmed'));
    expect(confirmed).not.toContain('picture-saved');
    expect(text(confirmed)).not.toContain(t(locale, 'picture.section.notConfirmed'));
  });

  it('lists no pictures for a revision that has none, and still says it is not confirmed', () => {
    const empty = section({state: 'found', request: request({images: []}), subjectName: null});
    expect(empty).not.toContain('picture-saved-item');
    expect(text(empty)).toContain(t(locale, 'picture.section.notConfirmed'));
  });
});

describe.each(locales)('the stage request_draft on the Project page, in %s', (locale) => {
  const row = {...fixtureRows()[0], stage: 'request_draft' as const};
  const unconfirmed: ProjectRequestRow = {
    id: REQUEST,
    projectId: row.id,
    seq: 1,
    mode: 'evidence_images',
    confirmed: false,
    subjectId: null,
    scope: null,
    outcome: null,
    description: null,
    personalization: {wording: null, text: null, style: null, applied: false, reason: null},
    confirmedAt: null,
    images: [savedPicture(1)],
  };
  const markup = render(locale, <ProjectOverview project={row} request={{state: 'found', request: unconfirmed, subjectName: null}}/>);

  it('is named in words with an icon no other stage uses, and its next action says the pictures are saved privately and nothing has started or was charged', () => {
    const definition = stageDefinition('request_draft');
    expect(text(markup)).toContain(t(locale, definition.label));
    expect(text(markup)).toContain(t(locale, 'stage.request_draft.next'));
    expect(markup).toContain(`<span class="status-badge tone-${definition.tone}">`);
    expect(markup).toContain(`tone-${definition.tone}"><svg`);
    expect(definition.icon).toBe('image');
    expect(markup).toContain(renderToStaticMarkup(<Icon name="image" size={14}/>));
    expect(definition.destination).toBeNull();
    // The label is its own, and different from the confirmed stage's.
    expect(t(locale, definition.label)).not.toBe(t(locale, stageDefinition('request_confirmed').label));
  });

  it('says it in English in the words the story gives', () => {
    expect(translate('en', 'stage.request_draft.label')).toBe('Request in progress');
    // On purpose changed (review patch C1): the sentence no longer says the pictures are "saved privately" with no more; it says they are in private staging, for
    // how long (24 hours after the last save, each save renewing that, and never more than 7 days after they were uploaded) and where the lapse is shown.
    const next = translate('en', 'stage.request_draft.next');
    expect(next).toMatch(/private staging/);
    expect(next).toMatch(/24 hours after your last save/);
    expect(next).toMatch(/each save renews that/);
    expect(next).toMatch(/never longer than 7 days after they were uploaded/);
    expect(next).toMatch(/Project page shows when they lapse, in UTC/);
    expect(next).toMatch(/later release/);
    expect(next).toMatch(/Nothing has started and nothing was charged/);
    expect(next).not.toMatch(/saved privately/);
  });

  it('has no destination for the next action: words, never a link to a page that does not exist', () => {
    expect(markup).not.toContain(t(locale, 'project.nextLink'));
    expect(text(markup)).toContain(t(locale, 'project.nextNoPage'));
  });

  it('puts the Request section between the facts and the next action, and links only Sources and Change pictures', () => {
    expect(markup.indexOf('project-facts')).toBeLessThan(markup.indexOf('request-section'));
    expect(markup.indexOf('request-section')).toBeLessThan(markup.indexOf('next-action'));
    expect([...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1]).sort()).toEqual([`/projects/${row.id}/pictures`, `/projects/${row.id}/sources`].sort());
  });
});

describe.each(locales)('PicturesLocked, in %s', (locale) => {
  const markup = render(locale, <PicturesLocked project={{id: PROJECT, title: 'My <i>Project</i>'}}/>);

  it('names the Project in an isolated run, says the pictures cannot be changed here and why, and offers the way back', () => {
    expect(markup).toContain('<bdi class="project-title">My &lt;i&gt;Project&lt;/i&gt;</bdi>');
    expect(text(markup)).toContain(t(locale, 'picture.locked.title'));
    expect(text(markup)).toContain(t(locale, 'picture.locked.body'));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(new RegExp(`<a class="btn btn-secondary" href="/projects/${PROJECT}">(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'picture.locked.back')}</span></a>`));
  });

  it('has no form, no file chooser and no save', () => {
    expect(markup).not.toMatch(/<form|<input|type="submit"/);
  });
});
