import type {ComponentProps, ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The review of the pictures (Story 2.3: C-04, C-05 and the picture variant of C-06), its page, and the review on the Project page, rendered to markup in both
// languages. What needs a browser (measuring, the picture screen's Files, the download ticket, the steps and focus, the live region, the Server Action) is in
// tests/e2e/picture-review.spec.ts. A state the browser would reach is given to the screen as its initial state (as the other screens' is only for tests), which is how
// every state of the three screens is seen here.
const request = vi.hoisted(() => ({cookies: {} as Record<string, string>}));
const mocks = vi.hoisted(() => ({access: null as unknown, readProject: vi.fn(), readProjectRequest: vi.fn()}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in request.cookies ? {name, value: request.cookies[name]} : undefined),
    getAll: () => Object.entries(request.cookies).map(([name, value]) => ({name, value})),
  }),
  headers: async () => ({get: () => null}),
}));
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

import ProjectPictureReviewPage, {generateMetadata as reviewMetadata} from '@/app/projects/[projectId]/pictures/review/page';
import {PictureReview, type InitialReview} from '@/components/projects/picture-review';
import {PicturesLocked} from '@/components/projects/pictures-locked';
import {RequestSection} from '@/components/projects/request-section';
import {Unreadable} from '@/components/projects/unreadable';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {viewLabels, type Measurements, type ViewLabel} from '@/lib/picture-quality';
import {badgeKeys, incompleteSentences, labelKeys, problemWords, reviewItems, type ReviewItem} from '@/lib/picture-review';
import {fixtureRows} from '@/lib/project-fixtures';
import type {ProjectRequestRow, RequestPicture} from '@/lib/project-view';
import {createTranslator} from '@/lib/i18n';

const PROJECT = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const REQUEST = '0a0b0c0d-1e1f-4a2a-8b3b-4c4c5d5d6e6e';
const upload = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (character: string) => character.repeat(64);
const active = {state: 'active', user: {id: 'u', email: 'person@example.com', sessionId: 's'}, account: {accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 4, preferences: null}};
const good: Measurements = {shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213};

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);
/** The words of some markup without the invisible isolates the catalog puts around a name (for a check against English prose). */
const plain = (markup: string) => text(markup).replace(/[\u2066-\u2069]/g, '');
const render = (locale: Locale, element: ReactElement) => renderToStaticMarkup(<I18nProvider locale={locale}><AnnouncerProvider>{element}</AnnouncerProvider></I18nProvider>);
const project = {id: PROJECT, title: 'Picture request 2026-10-20'};

const picture = (position: number, patch: Partial<RequestPicture> = {}): RequestPicture => ({
  position,
  uploadId: upload(position),
  sha256: sha(String.fromCharCode(96 + position)),
  length: 482113 * position,
  contentType: 'image/jpeg',
  expiresAt: '2026-10-21T12:34:56.789Z',
  available: true,
  label: null,
  shortEdgePx: null,
  blurVariance: null,
  clippedFraction: null,
  ...patch,
});
const savedRequest = (patch: Partial<ProjectRequestRow> = {}): ProjectRequestRow => ({
  id: REQUEST,
  projectId: PROJECT,
  seq: 2,
  mode: 'evidence_images',
  confirmed: false,
  subjectId: null,
  scope: null,
  outcome: null,
  description: null,
  personalization: {wording: null, text: null, style: null, applied: false, reason: null},
  confirmedAt: null,
  images: [picture(1), picture(2), picture(3)],
  obstructionConfirmed: false,
  obstructionConfirmedAt: null,
  acknowledged: false,
  acknowledgedAt: null,
  ...patch,
});

/** A measured, labelled picture of the review. */
const item = (position: number, label: ViewLabel | null, measurements: Measurements | null = good, patch: Partial<ReviewItem> = {}): ReviewItem => ({
  ...reviewItems([{position, uploadId: upload(position), sha256: sha(String.fromCharCode(96 + position)), length: 482113 * position, contentType: 'image/jpeg', available: true, label}])[0],
  state: measurements ? 'measured' : 'measuring',
  measurements,
  thumbnailUrl: measurements ? `blob:thumb-${position}` : null,
  ...patch,
});
const threeGood = [item(1, 'front'), item(2, 'left'), item(3, 'top')];
const reviewRequest = {seq: 2, mode: 'evidence_images' as const, confirmed: false, scope: null, outcome: null, images: [picture(1), picture(2), picture(3)]};
const screen = (locale: Locale, initial: InitialReview = {}, props: Partial<ComponentProps<typeof PictureReview>> = {}) =>
  render(locale, <PictureReview project={project} request={reviewRequest} initial={{measure: false, secure: true, ...initial}} {...props}/>);
const tags = (markup: string, name: string) => markup.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? [];

beforeEach(() => {
  request.cookies = {};
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  mocks.access = active;
  mocks.readProject.mockReset();
  mocks.readProjectRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// The page --------------------------------------------------------------------------------------------------------------------

describe('the review page', () => {
  const row = {...fixtureRows()[0], id: PROJECT, stage: 'request_draft' as const};
  const params = Promise.resolve({projectId: PROJECT});
  const found = (value: ProjectRequestRow | null) => {
    mocks.readProject.mockResolvedValue({outcome: 'found', project: row});
    mocks.readProjectRequest.mockResolvedValue(value ? {outcome: 'found', request: value} : {outcome: 'none'});
  };
  const digest = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      return (error as {digest?: string}).digest ?? 'error';
    }
    return null;
  };

  it('is titled Review pictures, and Project not available for a Project that is not there', async () => {
    found(savedRequest());
    expect((await reviewMetadata({params})).title).toBe('Review pictures');
    mocks.readProject.mockResolvedValue({outcome: 'unavailable'});
    expect((await reviewMetadata({params})).title).toBe(translate('en', 'meta.projectUnavailable'));
    request.cookies = {'nova3d-locale': 'he'};
    found(savedRequest());
    expect((await reviewMetadata({params})).title).toBe(translate('he', 'meta.pictureReview'));
  });

  it('shows the review of the saved pictures of a Project, with the revision they are (restarting the screen when it changes), for an unconfirmed request of either picture mode', async () => {
    for (const mode of ['evidence_images', 'image_direct'] as const) {
      found(savedRequest({mode}));
      const element = await ProjectPictureReviewPage({params});
      expect(element.type, mode).toBe(PictureReview);
      expect(element.key).toBe('2');
      expect(element.props).toEqual({
        project: {id: PROJECT, title: row.title},
        request: {seq: 2, mode, confirmed: false, scope: null, outcome: null, images: savedRequest().images},
      });
    }
    expect(mocks.readProject).toHaveBeenCalledWith({accountId: ACCOUNT, epoch: 4}, PROJECT, expect.anything());
  });

  it('shows the review again of a confirmed direct request, with its scope and outcome for the screen to start from', async () => {
    const confirmed = savedRequest({mode: 'image_direct', confirmed: true, scope: 'The subject', outcome: 'A model', confirmedAt: '2026-10-20T08:00:00+00:00', obstructionConfirmed: true, obstructionConfirmedAt: '2026-10-20T08:00:00+00:00', seq: 3});
    found(confirmed);
    const element = await ProjectPictureReviewPage({params});
    expect(element.type).toBe(PictureReview);
    expect(element.key).toBe('3');
    expect(element.props.request).toEqual({seq: 3, mode: 'image_direct', confirmed: true, scope: 'The subject', outcome: 'A model', images: confirmed.images});
  });

  it.each([
    ['a text request', savedRequest({mode: 'evidence_text', confirmed: true, subjectId: 'middot-altar-ramp', scope: 's', outcome: 'o', description: 'd', confirmedAt: '2026-10-18T19:12:12+00:00', images: []})],
    ['a request with no pictures', savedRequest({images: []})],
    ['no request at all', null],
  ])('says there are no pictures to review for %s, and offers the way back', async (_name, value) => {
    found(value);
    const element = await ProjectPictureReviewPage({params});
    expect(element.type).toBe(PicturesLocked);
    expect(element.props).toEqual({project: row, kind: 'review'});
  });

  it('is the one unavailable page for a Project that is another Account\'s, deleted, unknown or not an ID, whatever the request says', async () => {
    mocks.readProject.mockResolvedValue({outcome: 'unavailable'});
    expect(await digest(ProjectPictureReviewPage({params}))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    found(null);
    mocks.readProjectRequest.mockResolvedValue({outcome: 'unavailable'});
    expect(await digest(ProjectPictureReviewPage({params}))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(await digest(ProjectPictureReviewPage({params: Promise.resolve({projectId: 'not-an-id'})}))).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('sends the person Home when the Account has no authority for the read, and refuses an Account that is not active', async () => {
    mocks.readProject.mockResolvedValue({outcome: 'denied'});
    expect(await digest(ProjectPictureReviewPage({params}))).toMatch(/^NEXT_REDIRECT;replace;\/;/);
    found(null);
    mocks.readProjectRequest.mockResolvedValue({outcome: 'denied'});
    expect(await digest(ProjectPictureReviewPage({params}))).toMatch(/^NEXT_REDIRECT;replace;\/;/);
    mocks.access = {state: 'disabled'};
    await expect(ProjectPictureReviewPage({params})).rejects.toThrow('not active');
  });

  it('says to try again, and not that the Project is not the person\'s, when the database cannot be read', async () => {
    mocks.readProject.mockRejectedValue(new Error('down'));
    expect(JSON.stringify(await ProjectPictureReviewPage({params}))).toContain('project.error.title');
    found(savedRequest());
    mocks.readProjectRequest.mockRejectedValue(new Error('down'));
    const requestDown = await ProjectPictureReviewPage({params});
    expect(JSON.stringify(requestDown)).toContain('project.error.title');
    expect(JSON.stringify(requestDown)).not.toContain(PROJECT);
    expect(text(render('en', <Unreadable title="project.error.title" body="project.error.body" headingLevel={1}/>))).toContain(translate('en', 'project.error.title'));
  });
});

describe.each(locales)('the page that says there are no pictures to review, in %s', (locale) => {
  const markup = render(locale, <PicturesLocked project={{id: PROJECT, title: 'My <i>Project</i>'}} kind="review"/>);

  it('names the Project in an isolated run, says why, and offers the way back', () => {
    expect(markup).toContain('<bdi class="project-title">My &lt;i&gt;Project&lt;/i&gt;</bdi>');
    expect(text(markup)).toContain(t(locale, 'review.locked.title'));
    expect(text(markup)).toContain(t(locale, 'review.locked.body'));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(new RegExp(`<a class="btn btn-secondary" href="/projects/${PROJECT}">(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'review.locked.back')}</span></a>`));
  });
});

// The first step: C-04 -----------------------------------------------------------------------------------------------------------

describe.each(locales)('C-04, quality and coverage, in %s', (locale) => {
  it('names the step in a heading that is the page\'s one h1, and says nothing is sent anywhere to be checked', () => {
    const markup = screen(locale, {items: threeGood});
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(markup).toMatch(/<h1\b[^>]*tabindex="-1"/);
    expect(text(markup)).toContain(t(locale, 'review.title.check'));
    expect(text(markup)).toContain(t(locale, 'review.step', {step: 1, count: 3}));
    expect(text(markup)).toContain(t(locale, 'review.privacy'));
    expect(text(markup)).toContain('Picture request 2026-10-20');
  });

  it('shows each picture in order with its place, its thumbnail, a labelled chooser of the seven views with none chosen, and its three measurements', () => {
    const markup = screen(locale, {items: threeGood});
    const rows = markup.split('<li class="picture-item review-item"').slice(1);
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      const position = index + 1;
      expect(text(row)).toContain(t(locale, 'review.picture.title', {position, count: 3}));
      expect(row).toContain(`<img src="blob:thumb-${position}" alt="${t(locale, 'review.picture.preview', {position})}" decoding="async"/>`);
      const select = /<select\b[^>]*>/.exec(row)?.[0] ?? '';
      const id = /id="([^"]+)"/.exec(select)?.[1];
      expect(id).toBeTruthy();
      expect(row).toMatch(new RegExp(`<label for="${id}" class="auth-label">${t(locale, 'review.picture.label', {position}).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</label>`));
      expect(select).toContain('aria-required="true"');
      expect([...row.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1])).toEqual(['', ...viewLabels]);
      for (const label of viewLabels) expect(row).toContain(`>${t(locale, labelKeys[label])}</option>`);
      for (const key of ['review.measure.resolution', 'review.measure.blur', 'review.measure.exposure'] as const) expect(row).toContain(`<dt>${t(locale, key)}</dt>`);
    });
  });

  it('preselects the view a picture was given in an earlier review, and nothing else', () => {
    const markup = screen(locale, {items: [item(1, 'left'), item(2, null), item(3, 'detail')]});
    const rows = markup.split('<li class="picture-item review-item"').slice(1);
    expect(rows[0]).toMatch(/<option value="left" selected="">/);
    // No view is chosen for a picture that was not labelled: the placeholder is what is selected.
    expect([...rows[1].matchAll(/<option value="([^"]*)" selected=""/g)].map((match) => match[1])).toEqual(['']);
    expect(rows[2]).toMatch(/<option value="detail" selected="">/);
  });

  it('says a good picture is ok in every measure, with the numbers and no remedy', () => {
    const row = screen(locale, {items: [item(1, 'front')]}).split('<li class="picture-item review-item"').slice(1)[0];
    expect(row.match(/data-result="ok"/g)).toHaveLength(3);
    expect(text(row)).toContain(t(locale, 'review.detail.resolution', {size: '1200 px', min: '800 px'}));
    expect(text(row)).toContain(t(locale, 'review.detail.blur', {value: '412.3', min: 100}));
    expect(text(row)).toContain(t(locale, 'review.detail.exposure', {percent: '2.13', max: '35'}));
    expect(text(row)).toContain(t(locale, 'review.badge.ok'));
    expect(text(row)).not.toContain(t(locale, 'review.remedy.title'));
  });

  it.each([
    ['a small picture', {shortEdgePx: 700}, 'resolution', 'review.badge.resolution', 'review.remedy.resolution', 'review.detail.resolution', {size: '700 px', min: '800 px'}],
    ['a blurry picture', {blurVariance: 41}, 'blur', 'review.badge.blur', 'review.remedy.blur', 'review.detail.blur', {value: '41', min: 100}],
    ['a flat picture', {blurVariance: 0}, 'blur', 'review.badge.blur', 'review.remedy.blur', 'review.detail.blur', {value: '0', min: 100}],
    ['an over-exposed picture', {clippedFraction: 0.4}, 'exposure', 'review.badge.exposure', 'review.remedy.exposure', 'review.detail.exposure', {percent: '40', max: '35'}],
  ] as const)('names the problem, the measured value and the remedy for %s', (_name, change, kind, badge, remedy, detail, params) => {
    const row = screen(locale, {items: [item(1, 'front', {...good, ...change})]}).split('<li class="picture-item review-item"').slice(1)[0];
    expect(row).toContain(`data-result="${kind}"`);
    expect(row.match(/data-result="ok"/g)).toHaveLength(2);
    expect(text(row)).toContain(t(locale, badge));
    expect(text(row)).toContain(t(locale, remedy));
    expect(text(row)).toContain(t(locale, detail, params as Record<string, string | number>));
    expect(row).toContain('tone-warning');
  });

  it('is ok exactly on each threshold (800 px, 100, 35%) and a problem one step beyond', () => {
    const edge = screen(locale, {items: [item(1, 'front', {shortEdgePx: 800, blurVariance: 100, clippedFraction: 0.35})]});
    expect(edge.match(/data-result="ok"/g)).toHaveLength(3);
    const beyond = screen(locale, {items: [item(1, 'front', {shortEdgePx: 799, blurVariance: 99.9, clippedFraction: 0.3501})]});
    expect(beyond.match(/data-result="(?:resolution|blur|exposure)"/g)).toHaveLength(3);
    // A value just under the threshold never reads as the threshold.
    expect(text(beyond)).toContain(t(locale, 'review.detail.blur', {value: '99.9', min: 100}));
    expect(text(beyond)).toContain(t(locale, 'review.detail.exposure', {percent: '35.01', max: '35'}));
  });

  it('shows a picture that is being measured with words, and no numbers', () => {
    const row = screen(locale, {items: [item(1, null, null)]}).split('<li class="picture-item review-item"').slice(1)[0];
    expect(text(row)).toContain(t(locale, 'review.picture.measuring'));
    expect(row).not.toContain('review-results');
    expect(row).not.toContain('<img');
    expect(text(screen(locale, {items: [item(1, null, null), item(2, 'front')]}))).toContain(t(locale, 'review.measured', {measured: 1, count: 2}));
  });

  it.each([
    ['lapsed', 'review.unusable.lapsed', 'review.unusable.fix'],
    ['changed', 'review.unusable.changed', 'review.unusable.fix'],
    ['reload', 'review.unusable.reload', null],
    ['refused', 'review.unusable.refused', 'review.unusable.fix'],
    ['unavailable', 'review.unusable.unavailable', null],
    ['network', 'review.unusable.network', null],
    ['undecodable', 'review.unusable.undecodable', 'review.unusable.fixSmaller'],
    ['too_large_pixels', 'review.unusable.too_large_pixels', 'review.unusable.fixSmaller'],
    ['busy', 'review.unusable.busy', null],
  ] as const)('shows a picture that is %s with a plain reason, its remedy, that it cannot be acknowledged, and a link back to the picture screen', (reason, key, remedy) => {
    const row = screen(locale, {items: [item(1, 'front', null, {state: 'unusable', reason})]}).split('<li class="picture-item review-item"').slice(1)[0];
    expect(text(row)).toContain(t(locale, 'review.unusable.title', {position: 1}));
    expect(text(row)).toContain(t(locale, key));
    expect(text(row)).toContain(t(locale, 'review.unusable.cannotAcknowledge'));
    // The remedy: another copy on the picture screen, a smaller picture, or (a download or a decode that did not finish) trying again.
    for (const candidate of ['review.unusable.fix', 'review.unusable.fixSmaller'] as const) expect(text(row).includes(t(locale, candidate)), `${reason} ${candidate}`).toBe(candidate === remedy);
    expect(row).toContain('role="alert"');
    expect(row).toMatch(new RegExp(`<a class="btn btn-secondary"[^>]*href="/projects/${PROJECT}/pictures"[^>]*>(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'review.unusable.go')}</span></a>`));
    expect(row).not.toContain('review-results');
    // A download that did not answer or took too long, and a decode that did not finish, can be tried again: every one of them offers it, and nothing else does.
    expect(row.includes(`<span>${t(locale, 'review.unusable.retry')}</span>`)).toBe(reason === 'unavailable' || reason === 'network' || reason === 'busy');
  });

  it('says the truth about a picture that cannot be used in a CONFIRMED request: its pictures cannot be changed here yet, the review cannot be repeated, and the picture screen is not offered', () => {
    const confirmedRequest = {...reviewRequest, mode: 'image_direct' as const, confirmed: true, scope: 'S', outcome: 'O'};
    for (const reason of ['lapsed', 'changed', 'refused', 'undecodable', 'too_large_pixels'] as const) {
      const markup = screen(locale, {items: [item(1, 'front', null, {state: 'unusable', reason}), item(2, 'left'), item(3, 'top')], tried: true, obstruction: true}, {request: confirmedRequest});
      const row = markup.split('<li class="picture-item review-item"').slice(1)[0];
      expect(text(row), reason).toContain(t(locale, 'review.unusable.confirmed'));
      expect(text(row), reason).not.toContain(t(locale, 'review.unusable.cannotAcknowledge'));
      expect(text(row), reason).not.toContain(t(locale, 'review.unusable.fix'));
      expect(text(row), reason).not.toContain(t(locale, 'review.unusable.fixSmaller'));
      // No way to the locked picture screen, from the picture or from anywhere on the step.
      expect(markup, reason).not.toContain(`href="/projects/${PROJECT}/pictures"`);
      expect(text(markup), reason).toContain(t(locale, 'review.issue.unusableConfirmed'));
      expect(text(markup), reason).not.toContain(t(locale, 'review.issue.unusable'));
    }
    // What trying again can mend is still offered (and the way to the picture screen is still not).
    const network = screen(locale, {items: [item(1, 'front', null, {state: 'unusable', reason: 'network'})]}, {request: confirmedRequest});
    expect(network).toContain(`<span>${t(locale, 'review.unusable.retry')}</span>`);
    expect(network).not.toContain(`href="/projects/${PROJECT}/pictures"`);
    // An unconfirmed request still sends the person to fix it there.
    const unconfirmed = screen(locale, {items: [item(1, 'front', null, {state: 'unusable', reason: 'lapsed'})], tried: true, obstruction: true});
    expect(unconfirmed).toContain(`href="/projects/${PROJECT}/pictures"`);
    expect(text(unconfirmed)).toContain(t(locale, 'review.issue.unusable'));
    expect(text(unconfirmed)).not.toContain(t(locale, 'review.unusable.confirmed'));
    if (locale === 'en') {
      expect(plain(screen(locale, {items: [item(1, 'front', null, {state: 'unusable', reason: 'lapsed'})]}, {request: confirmedRequest}))).toMatch(
        /This request is already confirmed, so its pictures cannot be changed here yet\. Until pictures are retained \(a later step\), a picture whose private copy has lapsed cannot be brought back, and this request cannot be reviewed again\./,
      );
    }
  });

  it('draws the coverage line as sufficient when three different views are labelled', () => {
    const markup = screen(locale, {items: threeGood});
    expect(markup).toContain('data-coverage="sufficient"');
    expect(markup).not.toContain('data-state="additional-view-requested"');
    expect(text(markup)).toContain(t(locale, 'review.coverage.badge.sufficient'));
    expect(text(markup)).toContain(t(locale, 'review.coverage.count', {count: 3, needed: 3}));
    expect(text(markup)).toContain(t(locale, 'review.coverage.sufficientNote'));
    expect(markup).toContain('tone-success');
  });

  it('draws it as insufficient for front, front, detail: one view, back and left to add, with a button to the picture screen', () => {
    const markup = screen(locale, {items: [item(1, 'front'), item(2, 'front'), item(3, 'detail')]});
    const listed = createTranslator(locale);
    expect(markup).toContain('data-coverage="insufficient"');
    expect(markup).toContain('data-state="additional-view-requested"');
    expect(text(markup)).toContain(t(locale, 'review.coverage.badge.insufficient'));
    expect(text(markup)).toContain(t(locale, 'review.coverage.count', {count: 1, needed: 3}));
    expect(text(markup)).toContain(t(locale, 'review.coverage.shown', {views: listed(labelKeys.front)}));
    expect(text(markup)).toContain(t(locale, 'review.coverage.add', {views: t(locale, 'review.list.two', {first: t(locale, labelKeys.back), second: t(locale, labelKeys.left)})}));
    expect(text(markup)).toContain(t(locale, 'review.coverage.detailNote'));
    expect(text(markup)).toContain(t(locale, 'review.coverage.directNeeds'));
    expect(text(markup)).toContain(t(locale, 'review.coverage.researchNote'));
    expect(markup).toMatch(new RegExp(`<a class="btn btn-secondary" href="/projects/${PROJECT}/pictures">(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'review.coverage.addButton')}</span></a>`));
  });

  it('does not offer to add pictures to a request that is confirmed: they are locked, and the way to unlock them is said', () => {
    const markup = screen(locale, {items: [item(1, 'front')]}, {request: {...reviewRequest, mode: 'image_direct', confirmed: true, scope: 'S', outcome: 'O'}});
    expect(text(markup)).toContain(t(locale, 'review.coverage.addLocked'));
    // (The unusable-picture link back to the picture screen is a different link, shown only for a picture that cannot be used.)
    expect(markup).not.toContain(`<span>${t(locale, 'review.coverage.addButton')}</span>`);
  });

  it('says nothing is labelled yet before the person chooses a view', () => {
    const markup = screen(locale, {items: [item(1, null), item(2, null)]});
    expect(text(markup)).toContain(t(locale, 'review.coverage.shownNone'));
    expect(text(markup)).toContain(t(locale, 'review.coverage.count', {count: 0, needed: 3}));
    expect(text(markup)).toContain(t(locale, 'review.coverage.add', {views: t(locale, 'review.list.many', {list: `${t(locale, labelKeys.front)}${t(locale, 'review.list.comma')}${t(locale, labelKeys.back)}`, last: t(locale, labelKeys.left)})}));
  });

  it('asks for the obstruction confirmation as a labelled checkbox, with its remedy as help, and unchecked until the person checks it', () => {
    const markup = screen(locale, {items: threeGood});
    const box = /<input\b[^>]*type="checkbox"[^>]*>/.exec(markup)?.[0] ?? '';
    const id = /id="([^"]+)"/.exec(box)?.[1];
    expect(box).not.toContain('checked');
    expect(markup).toMatch(new RegExp(`<label class="review-checkbox" for="${id}">`));
    expect(text(markup)).toContain(t(locale, 'review.obstruction.label'));
    expect(text(markup)).toContain(t(locale, 'review.obstruction.help'));
    expect(box).toMatch(/aria-describedby="[^"]+"/);
    expect(text(screen(locale, {items: threeGood, obstruction: true}))).toContain(t(locale, 'review.obstruction.label'));
    expect(/<input\b[^>]*type="checkbox"[^>]*>/.exec(screen(locale, {items: threeGood, obstruction: true}))?.[0]).toContain('checked');
  });

  it.each([
    ['unconfirmed obstruction', {items: threeGood}, 'review.obstruction.remedy'],
    ['a picture with no label', {items: [item(1, 'front'), item(2, null), item(3, 'top')], obstruction: true}, 'review.issue.labels'],
    ['a picture that cannot be used', {items: [item(1, 'front'), item(2, 'left', null, {state: 'unusable', reason: 'lapsed'}), item(3, 'top')], obstruction: true}, 'review.issue.unusable'],
    ['a picture still being measured', {items: [item(1, 'front'), item(2, null, null), item(3, 'top')], obstruction: true}, 'review.issue.busy'],
  ] as [string, InitialReview, MessageKey][])('tells what stops Next for %s once Next was pressed, and focuses the message (no override)', (_name, initial, key) => {
    const markup = screen(locale, {...initial, tried: true});
    expect(text(markup)).toContain(t(locale, key));
    expect(markup).toMatch(/<div class="invite-notice" tabindex="-1" id="[^"]+"><div class="notice notice-danger" role="alert">/);
    // Before Next is pressed the screen does not scold.
    const shown = screen(locale, {...initial});
    expect(shown).not.toMatch(/<div class="invite-notice" tabindex="-1" id="[^"]+"><div class="notice notice-danger" role="alert">/);
  });

  it('marks the obstruction checkbox invalid and described by the message when it is the matter', () => {
    const markup = screen(locale, {items: threeGood, tried: true});
    const box = /<input\b[^>]*type="checkbox"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(box).toContain('aria-invalid="true"');
    const id = /id="([^"]+)" tabindex="-1"><div class="notice notice-danger"/.exec(markup)?.[1] ?? /tabindex="-1" id="([^"]+)"/.exec(markup)?.[1];
    expect(box).toContain(id as string);
  });

  it('marks a chooser with no view invalid after Next was pressed', () => {
    const markup = screen(locale, {items: [item(1, null), item(2, 'left')], tried: true, obstruction: true});
    const selects = tags(markup, 'select');
    expect(selects[0]).toContain('aria-invalid="true"');
    expect(selects[1]).not.toContain('aria-invalid');
  });

  it('has Next and a way back to the project, and no Back button on the first step', () => {
    const markup = screen(locale, {items: threeGood});
    expect(text(markup)).toContain(t(locale, 'review.next'));
    expect(markup).toMatch(new RegExp(`<a class="btn btn-quiet" href="/projects/${PROJECT}">(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'review.back.project')}</span></a>`));
    expect(markup).not.toContain(`<span>${t(locale, 'review.back')}</span>`);
  });

  it('says so, and only so, when the page cannot hash a picture (no secure context): nothing is measured, there are no pictures to go through and Next is not offered', () => {
    const markup = screen(locale, {items: threeGood, secure: false});
    expect(text(markup)).toContain(t(locale, 'picture.secure.title'));
    expect(text(markup)).toContain(t(locale, 'picture.secure.body', {scheme: 'https'}));
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    // Not a list of pictures reported one by one as refused, not a measuring state, not a form of labels, and no Next.
    expect(markup).not.toMatch(/review-item|<select|<img|type="checkbox"|review-list/);
    expect(text(markup)).not.toContain(t(locale, 'review.next'));
    expect(text(markup)).not.toContain(t(locale, 'review.picture.measuring'));
    expect(text(markup)).not.toContain(t(locale, 'review.unusable.title', {position: 1}));
    // The way back to the Project is there.
    expect(markup).toMatch(new RegExp(`<a class="btn btn-quiet" href="/projects/${PROJECT}">(?:<svg[\\s\\S]*?</svg>)?<span>${t(locale, 'review.back.project')}</span></a>`));
    // Where it can hash, the warning is not shown.
    expect(text(screen(locale, {items: threeGood}))).not.toContain(t(locale, 'picture.secure.title'));
  });

  it('explains the views in one line of help: front is the main face, left and right are its sides as seen from the front, top and bottom likewise, detail is no viewing angle', () => {
    const markup = screen(locale, {items: threeGood});
    expect(text(markup)).toContain(t(locale, 'review.label.help'));
    // The help comes before the pictures it explains.
    expect(text(markup).indexOf(t(locale, 'review.label.help'))).toBeLessThan(text(markup).indexOf(t(locale, 'review.picture.title', {position: 1, count: 3})));
    if (locale === 'en') {
      expect(plain(markup)).toContain('Front is the main face of the subject. Left and right are its sides as you see them when you look at the front; top and bottom likewise. Detail is a close-up: it is not a viewing angle and does not count toward the three views.');
    }
  });

  it('says that the check is made on this device and what is saved when the person confirms, and that a reload downloads the pictures again from private staging', () => {
    const markup = screen(locale, {items: threeGood});
    expect(text(markup)).toContain(t(locale, 'review.privacy'));
    if (locale === 'en') {
      expect(plain(markup)).toMatch(/Nothing is sent anywhere to be checked\. The measurements are made on this device, and the pictures stay in private staging\./);
      expect(plain(markup)).toMatch(/Your labels, the measurements and your choice are saved with the request when you confirm\./);
      expect(plain(markup)).toMatch(/If you reload this page, the pictures are downloaded again from private staging to be measured again\./);
    }
  });

  it('shows no video, canvas, download link or address of a picture: only the small JPEG the browser drew', () => {
    const markup = screen(locale, {items: threeGood});
    expect(markup).not.toMatch(/<video|<canvas|\bdownload=|https?:|\/v1\/files/);
    expect(markup.match(/<img\b/g)).toHaveLength(3);
    for (const source of markup.matchAll(/<img src="([^"]*)"/g)) expect(source[1]).toMatch(/^blob:/);
  });
});

// The second step: C-05 -----------------------------------------------------------------------------------------------------------

describe.each(locales)('C-05, the choice of path, in %s', (locale) => {
  const second = (initial: InitialReview = {}) => screen(locale, {step: 2, items: threeGood, obstruction: true, ...initial});

  it('offers exactly two choices in a radio group with a legend, neither chosen: there is no default', () => {
    const markup = second();
    expect(markup).toMatch(/<fieldset class="choice-group review-paths"/);
    expect(markup).toContain(`<legend class="review-legend">${t(locale, 'review.choose.legend')}</legend>`);
    const radios = tags(markup, 'input').filter((tag) => tag.includes('type="radio"'));
    expect(radios).toHaveLength(2);
    expect(radios.map((tag) => /value="([^"]+)"/.exec(tag)?.[1])).toEqual(['image_direct', 'evidence_images']);
    for (const radio of radios) {
      expect(radio).not.toContain('checked');
      expect(radio).toContain('name="path"');
    }
    expect(text(markup)).toContain(t(locale, 'review.step', {step: 2, count: 3}));
    expect(text(markup)).toContain(t(locale, 'review.title.choose'));
  });

  it('describes direct image-derived conversion: a model from the pictures alone, labelled image-derived, not historically verified, geometry may be invented, no Research Plan, offline later', () => {
    const words = text(second());
    for (const key of ['review.path.direct.title', 'review.path.direct.body', 'review.path.direct.accuracy', 'review.path.direct.plan', 'review.path.direct.offline'] as const) expect(words).toContain(t(locale, key));
    if (locale === 'en') {
      expect(words).toMatch(/image-derived and is not historically verified/);
      expect(words).toMatch(/geometry may be invented or inaccurate/);
      expect(words).toMatch(/There is no Research Plan/);
      expect(words).toMatch(/without a connection on a device prepared while online/);
    }
  });

  it('describes research-assisted reconstruction: identifies the subject, researches public sources online, a complete Research Plan to approve before any model, needs a connection', () => {
    const words = text(second());
    for (const key of ['review.path.research.title', 'review.path.research.body', 'review.path.research.accuracy', 'review.path.research.plan', 'review.path.research.offline'] as const) expect(words).toContain(t(locale, key));
    if (locale === 'en') {
      expect(words).toMatch(/identifies the subject, researches public sources online, and builds a complete Research Plan/);
      expect(words).toMatch(/approve the whole Research Plan before any model is made/);
      expect(words).toMatch(/Needs a connection/);
    }
  });

  it('marks the one that was chosen, and says a choice is needed after Next was pressed with none', () => {
    const direct = second({choice: 'image_direct'});
    expect(tags(direct, 'input').filter((tag) => tag.includes('type="radio"')).map((tag) => tag.includes('checked'))).toEqual([true, false]);
    const research = second({choice: 'evidence_images'});
    expect(tags(research, 'input').filter((tag) => tag.includes('type="radio"')).map((tag) => tag.includes('checked'))).toEqual([false, true]);
    const none = second({chose: true});
    expect(text(none)).toContain(t(locale, 'review.choose.error'));
    expect(none).toContain('role="alert"');
    expect(/<fieldset\b[^>]*>/.exec(none)?.[0]).toMatch(/aria-describedby="[^"]+"/);
    expect(text(direct)).not.toContain(t(locale, 'review.choose.error'));
  });

  it('has Next and Back, and says a mode change is a new version of the request', () => {
    const markup = second();
    expect(text(markup)).toContain(t(locale, 'review.next'));
    expect(markup).toContain(`<span>${t(locale, 'review.back')}</span>`);
    expect(text(markup)).toContain(t(locale, 'review.choose.note'));
    expect(text(markup)).toContain(t(locale, 'review.choose.lede'));
  });
});

// The third step: the picture variant of C-06 -------------------------------------------------------------------------------------

describe.each(locales)('C-06, the confirmation for pictures, in %s', (locale) => {
  const third = (initial: InitialReview = {}, props: Partial<ComponentProps<typeof PictureReview>> = {}) => screen(locale, {step: 3, items: threeGood, obstruction: true, ...initial}, props);
  const hidden = (markup: string, name: string) => [...markup.matchAll(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`, 'g'))].map((match) => match[1]);

  it('for direct conversion with complete inputs: the mode in words, the pictures, editable scope and outcome prefilled with localized sentences, and Confirm', () => {
    const markup = third({choice: 'image_direct'});
    expect(text(markup)).toContain(t(locale, 'review.title.confirmDirect'));
    expect(text(markup)).toContain(t(locale, 'review.step', {step: 3, count: 3}));
    expect(text(markup)).toContain(t(locale, 'request.mode.image_direct'));
    expect(text(markup)).toContain(t(locale, 'review.confirm.directLede'));
    const scope = /<input\b[^>]*name="scope"[^>]*>/.exec(markup)?.[0] ?? '';
    const outcome = /<input\b[^>]*name="outcome"[^>]*>/.exec(markup)?.[0] ?? '';
    expect(scope).toContain(`value="${t(locale, 'review.scopeDefault')}"`);
    expect(outcome).toContain(`value="${t(locale, 'review.outcomeDefault')}"`);
    for (const field of [scope, outcome]) {
      expect(field).toContain('dir="auto"');
      expect(field).toContain('aria-required="true"');
      expect(field).toMatch(/aria-describedby="[^"]+"/);
    }
    expect(markup).toMatch(/<label for="[^"]+" class="auth-label">/);
    expect(text(markup)).toContain(t(locale, 'review.confirm.directNote'));
    expect(markup).toContain(`<span>${t(locale, 'review.confirm.button')}</span>`);
    // Complete inputs need no acknowledgment: no warning and no checkbox.
    expect(markup).not.toContain('review-ack');
    expect(tags(markup, 'input').filter((tag) => tag.includes('type="checkbox"'))).toHaveLength(0);
    expect(hidden(markup, 'acknowledge')).toEqual([]);
  });

  it('starts the scope and outcome from the request\'s own when a confirmed request is reviewed again', () => {
    const markup = third({choice: 'image_direct'}, {request: {...reviewRequest, mode: 'image_direct', confirmed: true, scope: 'The altar & ramp', outcome: 'A print <b>model</b>'}});
    expect(/<input\b[^>]*name="scope"[^>]*>/.exec(markup)?.[0]).toContain('value="The altar &amp; ramp"');
    expect(/<input\b[^>]*name="outcome"[^>]*>/.exec(markup)?.[0]).toContain('value="A print &lt;b&gt;model&lt;/b&gt;"');
  });

  it('carries, in hidden fields, the command, the Project, the revision reviewed, the mode, the obstruction confirmation and each picture\'s upload, label and measurements, in order', () => {
    const markup = third({choice: 'image_direct', items: [item(1, 'front'), item(2, 'left', {shortEdgePx: 900, blurVariance: 99.5, clippedFraction: 0.4}), item(3, 'detail')]});
    expect(hidden(markup, 'projectId')).toEqual([PROJECT]);
    expect(hidden(markup, 'expectedSeq')).toEqual(['2']);
    expect(hidden(markup, 'mode')).toEqual(['image_direct']);
    expect(hidden(markup, 'obstruction')).toEqual(['on']);
    expect(markup).toMatch(/<input type="hidden" name="commandId"/);
    expect(hidden(markup, 'uploadId')).toEqual([upload(1), upload(2), upload(3)]);
    expect(hidden(markup, 'label')).toEqual(['front', 'left', 'detail']);
    expect(hidden(markup, 'shortEdge')).toEqual(['1200', '900', '1200']);
    expect(hidden(markup, 'blur')).toEqual(['412.375', '99.5', '412.375']);
    expect(hidden(markup, 'clipped')).toEqual(['0.0213', '0.4', '0.0213']);
    // No verdict, stage, digest or approval is a field of the form.
    expect([...markup.matchAll(/name="([^"]+)"/g)].map((match) => match[1]).filter((name) => /ok|pass|fail|verdict|incomplete|stage|digest|approv|permission|payment|cost/i.test(name))).toEqual([]);
  });

  it('for direct conversion with incomplete inputs: the Generate anyway warning names the missing views and the problems and says the geometry may be invented, with an unchecked required acknowledgment', () => {
    const items = [item(1, 'front'), item(2, 'left', {...good, blurVariance: 41}), item(3, 'detail', {...good, shortEdgePx: 700})];
    const markup = third({choice: 'image_direct', items});
    expect(markup).toContain('review-ack');
    expect(text(markup)).toContain(t(locale, 'review.ack.title'));
    expect(text(markup)).toContain(t(locale, 'review.ack.intro'));
    for (const sentence of incompleteSentences(createTranslator(locale), items, locale)) expect(text(markup)).toContain(sentence);
    expect(text(markup)).toContain(t(locale, 'review.ack.warning'));
    expect(text(markup)).toContain(t(locale, 'review.ack.label'));
    const box = tags(markup, 'input').find((tag) => tag.includes('type="checkbox"')) ?? '';
    expect(box).toContain('aria-required="true"');
    expect(box).not.toContain('checked');
    expect(hidden(markup, 'acknowledge')).toEqual([]);
    if (locale === 'en') {
      // On purpose changed (review patch C4): no bare plural, no lower-casing by the machine's locale, and no nested parentheses for a detail close-up.
      expect(plain(markup)).toMatch(/Different views: 2 \(direct conversion needs at least 3\)\. Missing: back\./);
      expect(plain(markup)).toMatch(/Picture 2, left: too blurry/);
      expect(plain(markup)).toMatch(/Picture 3, detail close-up: too small/);
      expect(plain(markup)).toMatch(/invented or inaccurate/);
      expect(plain(markup)).toMatch(/not historically verified/);
    }
  });

  it('tells a direct request, before Confirm, that until pictures are retained their private copies lapse 24 hours after the last save and never later than 7 days after upload, and what to do then', () => {
    const markup = third({choice: 'image_direct'});
    expect(text(markup)).toContain(t(locale, 'review.confirm.lapseNote'));
    // It comes before the button it is a warning for.
    expect(markup.indexOf(t(locale, 'review.confirm.lapseNote'))).toBeGreaterThan(0);
    expect(markup.indexOf(t(locale, 'review.confirm.lapseNote'))).toBeLessThan(markup.indexOf(`<span>${t(locale, 'review.confirm.button')}</span>`));
    if (locale === 'en') {
      expect(plain(markup)).toContain('Pictures are not retained yet. Until they are (a later step), their private copies lapse 24 hours after your last save, and never later than 7 days after they were uploaded. After that this request cannot be reviewed again here, so keep your original pictures.');
    }
    // A research-assisted choice confirms nothing that depends on the copies: the note is for the direct request only.
    expect(text(third({choice: 'evidence_images'}))).not.toContain(t(locale, 'review.confirm.lapseNote'));
  });

  it('sends the acknowledgment when it is checked, and asks for it with a message when Confirm was tried without it', () => {
    const items = [item(1, 'front'), item(2, 'left')];
    const checked = third({choice: 'image_direct', items, acknowledged: true});
    expect(hidden(checked, 'acknowledge')).toEqual(['on']);
    expect(tags(checked, 'input').find((tag) => tag.includes('type="checkbox"'))).toContain('checked');
    const missing = third({choice: 'image_direct', items, confirmTried: true});
    expect(text(missing)).toContain(t(locale, 'review.ack.required'));
    expect(tags(missing, 'input').find((tag) => tag.includes('type="checkbox"'))).toContain('aria-invalid="true');
  });

  it('shows the warning for direct conversion only: research-assisted needs no Generate anyway, however incomplete the inputs', () => {
    const items = [item(1, 'front'), item(2, 'front', {...good, blurVariance: 3})];
    const markup = third({choice: 'evidence_images', items});
    expect(markup).not.toContain('review-ack');
    expect(tags(markup, 'input').filter((tag) => tag.includes('type="checkbox"'))).toHaveLength(0);
  });

  it('for research-assisted reconstruction: the choice and labels are recorded, the subject is identified and the scope confirmed in a later step, nothing started, and no scope or outcome field', () => {
    const markup = third({choice: 'evidence_images'});
    expect(text(markup)).toContain(t(locale, 'review.title.confirmResearch'));
    expect(text(markup)).toContain(t(locale, 'request.mode.evidence_images'));
    expect(text(markup)).toContain(t(locale, 'review.confirm.researchLede'));
    expect(text(markup)).toContain(t(locale, 'review.confirm.researchNote'));
    expect(markup).not.toMatch(/name="scope"|name="outcome"/);
    expect(hidden(markup, 'mode')).toEqual(['evidence_images']);
    expect(markup).toContain(`<span>${t(locale, 'review.confirm.save')}</span>`);
    expect(markup).not.toContain(`<span>${t(locale, 'review.confirm.button')}</span>`);
    if (locale === 'en') {
      expect(plain(markup)).toMatch(/subject is identified and the scope is confirmed in a later step, and nothing has started/);
      expect(plain(markup)).toMatch(/starts no research, approves no plan and authorizes no cost/);
    }
  });

  it('says confirming starts no conversion, approves no plan and authorizes no cost, on the direct screen', () => {
    if (locale !== 'en') return;
    expect(plain(third({choice: 'image_direct'}))).toMatch(/starts no conversion, approves no plan and authorizes no cost/);
  });

  it('has Confirm as the form\'s submit and Back to the choice', () => {
    const markup = third({choice: 'image_direct'});
    expect(markup).toMatch(/<form[^>]*noValidate/);
    expect(markup).toMatch(/<button type="submit" class="btn btn-primary"/);
    expect(markup).toContain(`<span>${t(locale, 'review.back')}</span>`);
  });

  it.each([
    [{outcome: 'invalid', problems: []}, 'review.confirm.invalid'],
    [{outcome: 'stale'}, 'review.confirm.stale'],
    [{outcome: 'unknown_upload', position: 2}, 'review.confirm.unknownUpload'],
    [{outcome: 'not_ready', position: 2}, 'review.confirm.notReady'],
    [{outcome: 'expired_upload', position: 2}, 'review.confirm.expiredUpload'],
    [{outcome: 'obstruction_not_confirmed'}, 'review.confirm.obstruction'],
    [{outcome: 'acknowledgment_required'}, 'review.confirm.acknowledgment'],
    [{outcome: 'reused'}, 'review.confirm.reused'],
    [{outcome: 'gone'}, 'review.confirm.gone'],
    [{outcome: 'not_editable'}, 'review.confirm.notEditable'],
    [{outcome: 'unavailable', unknown: false}, 'review.confirm.unavailable'],
    [{outcome: 'unavailable', unknown: true}, 'review.confirm.unknown'],
  ] as const)('says what happened for the answer %j, in an alert that is focusable, and records nothing', (state, key) => {
    const markup = third({choice: 'image_direct', state: state as never});
    expect(text(markup)).toContain(t(locale, key, {position: 2}));
    expect(markup).toMatch(/<div class="invite-notice" tabindex="-1"><div class="notice notice-danger" role="alert">/);
  });

  it('names the field problem the server found in the scope or the outcome, next to the field', () => {
    const markup = third({choice: 'image_direct', scope: '', state: {outcome: 'invalid', problems: [{field: 'scope', problem: 'empty'}]}});
    expect(/<input\b[^>]*name="scope"[^>]*>/.exec(markup)?.[0]).not.toContain('aria-invalid');
    // (The screen shows a field problem once the action's callback has set it; the server's own answer carries no message of its own beyond the field's.)
    expect(markup).not.toMatch(/<div class="invite-notice" tabindex="-1"><div class="notice notice-danger" role="alert">/);
  });
});

// Both languages ------------------------------------------------------------------------------------------------------------------

describe('the review in Hebrew', () => {
  it('has no English word in any step or state', () => {
    const states: InitialReview[] = [
      {items: threeGood},
      {items: [item(1, 'front'), item(2, 'front', {...good, blurVariance: 3, shortEdgePx: 100, clippedFraction: 0.9}), item(3, 'detail')], tried: true},
      {items: [item(1, 'front', null, {state: 'unusable', reason: 'undecodable'})], tried: true},
      ...(['too_large_pixels', 'busy', 'lapsed', 'changed', 'network'] as const).map((reason) => ({items: [item(1, 'front', null, {state: 'unusable', reason})], tried: true})),
      {items: [item(1, 'front', null, {state: 'unusable', reason: 'lapsed'})], tried: true, secure: true},
      {items: threeGood, secure: false},
      {step: 2, items: threeGood, obstruction: true, chose: true},
      {step: 3, items: [item(1, 'front'), item(2, 'left', {...good, blurVariance: 3}), item(3, 'detail')], obstruction: true, choice: 'image_direct', confirmTried: true, state: {outcome: 'acknowledgment_required'}},
      {step: 3, items: threeGood, obstruction: true, choice: 'evidence_images'},
    ];
    for (const initial of states) {
      // (React puts the script that replays a form submitted before hydration into the markup of a form: it is not text.)
      const markup = screen('he', initial).replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<bdi dir="ltr" class="ltr-token">.*?<\/bdi>/g, '');
      const words = plain(markup).replace(/nova3D/g, '');
      // The Latin that is left is a token a message puts in through a placeholder (a size in px, the project title, the scheme https): none is a word of the catalog.
      const prose = words.replace(/Picture request 2026-10-20/g, '').replace(/\b\d+(?:\.\d+)? px\b/g, '').replace(/\bhttps\b/g, '');
      expect(prose, JSON.stringify(initial).slice(0, 80)).not.toMatch(/[A-Za-z]{2,}/);
    }
  });

  it('is right-to-left in its own words: nothing sets a physical side', () => {
    expect(screen('he', {items: threeGood})).not.toMatch(/margin-left|margin-right|text-align:\s*(?:left|right)/);
  });
});

// The Project page -----------------------------------------------------------------------------------------------------------------

describe.each(locales)('the review on the Project page, in %s', (locale) => {
  const section = (value: ProjectRequestRow) => render(locale, <RequestSection data={{state: 'found', request: value, subjectName: null}}/>);
  const links = (markup: string) => [...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1]);
  const reviewed = (patch: Partial<ProjectRequestRow> = {}, images: RequestPicture[] = []) =>
    savedRequest({
      obstructionConfirmed: true,
      obstructionConfirmedAt: '2026-10-20T08:00:00.5+00:00',
      images: images.length ? images : [picture(1, {label: 'front', shortEdgePx: 1200, blurVariance: 412.375, clippedFraction: 0.0213}), picture(2, {label: 'left', shortEdgePx: 700, blurVariance: 41, clippedFraction: 0.5})],
      ...patch,
    });

  it('shows a set that was saved and never reviewed as not reviewed, with no mode and no labels, and Review pictures', () => {
    const markup = section(savedRequest());
    expect(text(markup)).toContain(t(locale, 'review.section.notReviewed'));
    expect(markup).not.toContain(`<dt>${t(locale, 'request.review.mode')}</dt>`);
    expect(markup).not.toContain('data-view=');
    expect(markup).not.toContain('data-review=');
    expect(links(markup)).toEqual([`/projects/${PROJECT}/pictures/review`, `/projects/${PROJECT}/pictures`]);
    expect(text(markup)).toContain(t(locale, 'review.section.review'));
  });

  it('shows a research-assisted choice: the mode, that the choice is recorded and the subject and scope come later, the obstruction confirmation (UTC), each picture\'s label and result', () => {
    const markup = section(reviewed());
    expect(text(markup)).toContain(t(locale, 'request.mode.evidence_images'));
    expect(text(markup)).toContain(t(locale, 'review.section.researchRecorded'));
    expect(text(markup)).toContain(t(locale, 'review.section.obstruction'));
    expect(text(markup)).toContain(t(locale, 'review.section.obstructionYes'));
    expect(markup).toContain('2026-10-20 08:00 UTC');
    const items = markup.split('<li class="picture-saved-item">').slice(1);
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('data-view="front"');
    expect(text(items[0])).toContain(t(locale, labelKeys.front));
    expect(text(items[0])).toContain(t(locale, 'review.section.noProblems'));
    if (locale === 'en') expect(plain(items[0])).toContain('No problems were reported by the check in your browser.');
    expect(items[0]).toContain('data-result="ok"');
    expect(items[1]).toContain('data-view="left"');
    expect(items[1]).toContain('data-result="problems"');
    expect(text(items[1])).toContain(t(locale, 'review.section.measured', {size: '700 px', value: '41', percent: '50'}));
    // The WHOLE sentence of the picture's three problems (a short edge of 700 px, a blur of 41 and half of it clipped), in the words the UI's language gives them.
    const everyProblem = problemWords(createTranslator(locale), ['resolution', 'blur', 'exposure'], locale);
    for (const problem of ['resolution', 'blur', 'exposure'] as const) expect(everyProblem).toContain(t(locale, badgeKeys[problem]).toLocaleLowerCase(locale));
    expect(text(items[1])).toContain(t(locale, 'review.section.problems', {problems: everyProblem}));
    // No acknowledgment for a research-assisted choice.
    expect(markup).not.toContain('data-review="acknowledgment"');
    expect(links(markup)).toEqual([`/projects/${PROJECT}/pictures/review`, `/projects/${PROJECT}/pictures`]);
    expect(text(markup)).toContain(t(locale, 'review.section.reviewAgain'));
  });

  it('shows a confirmed direct request: scope, outcome and the time it was confirmed (UTC), no subject, and that nothing was started', () => {
    const markup = section(
      reviewed({
        mode: 'image_direct',
        confirmed: true,
        scope: 'The subject <i>shown</i>',
        outcome: 'A model',
        confirmedAt: '2026-10-20T08:00:00.5+00:00',
        images: [picture(1, {label: 'front', shortEdgePx: 1200, blurVariance: 412, clippedFraction: 0.01}), picture(2, {label: 'left', shortEdgePx: 1200, blurVariance: 412, clippedFraction: 0.01}), picture(3, {label: 'top', shortEdgePx: 1200, blurVariance: 412, clippedFraction: 0.01})],
      }),
    );
    expect(text(markup)).toContain(t(locale, 'request.mode.image_direct'));
    expect(markup).toContain('<bdi>The subject &lt;i&gt;shown&lt;/i&gt;</bdi>');
    expect(text(markup)).toContain(t(locale, 'request.section.confirmed'));
    expect(markup).toContain('2026-10-20 08:00 UTC');
    expect(markup).not.toContain(`<dt>${t(locale, 'request.review.subject')}</dt>`);
    expect(text(markup)).toContain(t(locale, 'review.section.directNothingStarted'));
    expect(text(markup)).toContain(t(locale, 'review.section.noAcknowledgment'));
    if (locale === 'en') expect(plain(markup)).toContain('Not needed: the check in your browser found the inputs complete.');
    // Only Review pictures again: a confirmed request's pictures are not changed there.
    expect(links(markup)).toEqual([`/projects/${PROJECT}/pictures/review`]);
  });

  it('shows what was acknowledged and when (UTC): the missing views, the pictures with problems, and that the geometry may be invented and is not historically verified', () => {
    const images = [picture(1, {label: 'front', shortEdgePx: 1200, blurVariance: 412, clippedFraction: 0.01}), picture(2, {label: 'left', shortEdgePx: 1200, blurVariance: 41, clippedFraction: 0.01})];
    const markup = section(reviewed({mode: 'image_direct', confirmed: true, scope: 'S', outcome: 'O', confirmedAt: '2026-10-20T08:00:00+00:00', acknowledged: true, acknowledgedAt: '2026-10-20T08:00:01+00:00'}, images));
    const block = markup.slice(markup.indexOf('data-review="acknowledgment"'));
    expect(text(block)).toContain(t(locale, 'review.section.acknowledgment'));
    expect(text(block)).toContain(t(locale, 'review.section.acknowledged'));
    expect(block).toContain('2026-10-20 08:00 UTC');
    for (const sentence of incompleteSentences(createTranslator(locale), images.map((image) => ({label: image.label, measurements: {shortEdgePx: image.shortEdgePx!, blurVariance: image.blurVariance!, clippedFraction: image.clippedFraction!}})), locale)) {
      expect(text(block)).toContain(sentence);
    }
    expect(text(block)).toContain(t(locale, 'review.ack.warning'));
    expect(block).not.toContain(t(locale, 'review.section.noAcknowledgment'));
  });

  it('shows no picture and links no download: only what the request records', () => {
    expect(section(reviewed())).not.toMatch(/<img\b|<video|<canvas|\bdownload=|\bsrc=|blob:|https?:/);
  });
});

describe.each(locales)('the catalog of the review, in %s', (locale) => {
  it('names the seven labels', () => {
    expect(new Set(viewLabels.map((label) => t(locale, labelKeys[label]))).size).toBe(7);
  });
});
