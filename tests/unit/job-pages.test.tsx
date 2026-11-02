import type {ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// The Job pages (Story 2.7): In Progress (J-01) and a Job's detail (J-02), rendered to markup in both languages for every variant, and the page functions themselves with the Account and the
// database faked. What needs a browser (the dialog, focus, the refresh timer, the live regions, the real 404 status) is in tests/e2e/jobs-progress.spec.ts.
const request = vi.hoisted(() => ({cookies: {} as Record<string, string>, acceptLanguage: null as string | null}));
const mocks = vi.hoisted(() => ({
  access: null as unknown,
  listJobs: vi.fn(),
  readJobDetail: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in request.cookies ? {name, value: request.cookies[name]} : undefined),
    getAll: () => Object.entries(request.cookies).map(([name, value]) => ({name, value})),
  }),
  headers: async () => ({get: (name: string) => (name.toLowerCase() === 'accept-language' ? request.acceptLanguage : null)}),
}));
// The retry and refresh buttons ask the router to refresh; there is no app router to mount here.
vi.mock('next/navigation', async (importOriginal) => ({...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({refresh: mocks.refresh})}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  getAccess: async () => mocks.access,
  requireActiveAccount: async () => {
    if ((mocks.access as {state: string}).state !== 'active') throw new Error('not active');
    return mocks.access;
  },
}));
vi.mock('@/lib/job-commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/job-commands')>()),
  listJobs: mocks.listJobs,
  readJobDetail: mocks.readJobDetail,
}));
// The Server Action behind the dialog is a module of its own; the dialog is rendered, not submitted, here.
vi.mock('@/app/progress/actions', () => ({cancelJobAction: vi.fn()}));

import JobPage, {generateMetadata as jobMetadata} from '@/app/progress/[jobId]/page';
import JobNotFound from '@/app/progress/[jobId]/not-found';
import ProgressPage from '@/app/progress/page';
import {JobCancelDialog} from '@/components/jobs/job-cancel';
import {JobCard} from '@/components/jobs/job-card';
import {JobDetailView} from '@/components/jobs/job-detail';
import {JobUnavailable} from '@/components/jobs/job-unavailable';
import {NovaDashboard} from '@/components/nova-dashboard';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {AccountsUnavailableError} from '@/lib/accounts';
import {catalogs, locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import type {JobDetail, JobListItem} from '@/lib/job-view';

const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const PROJECT = '823ce223-e130-45c0-a61e-8a79f67b8008';
const JOB = '3b71d3c8-f723-44a3-b9f6-0229053dd41b';
const active = {state: 'active', user: {id: 'u', email: 'person@example.com', sessionId: 's'}, account: {accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 4, preferences: null}};

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ');
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

// Fixtures ---------------------------------------------------------------------------------------------------------------------------------

const item = (over: Partial<JobListItem> = {}): JobListItem => ({
  jobId: JOB,
  projectId: PROJECT,
  projectTitle: 'Courtyard bench',
  kind: 'test_workload',
  createdAt: '2026-10-29T02:28:49.950178+00:00',
  attemptNumber: 1,
  state: 'waiting',
  stage: 'accepted',
  reason: 'awaiting_dispatch',
  startedAt: null,
  endedAt: null,
  ...over,
});
const items = {
  waiting: item(),
  awaitingWorker: item({jobId: '4b71d3c8-f723-44a3-b9f6-0229053dd41b', projectTitle: 'Garden arch', reason: 'awaiting_worker'}),
  running: item({jobId: '5b71d3c8-f723-44a3-b9f6-0229053dd41b', state: 'running', stage: 'search', reason: null, startedAt: '2026-10-29T02:28:50+00:00'}),
  completed: item({jobId: '6b71d3c8-f723-44a3-b9f6-0229053dd41b', state: 'completed', stage: 'search', reason: null, startedAt: '2026-10-29T02:28:50+00:00', endedAt: '2026-10-29T02:29:10+00:00'}),
  failed: item({jobId: '7b71d3c8-f723-44a3-b9f6-0229053dd41b', state: 'failed', stage: 'search', reason: 'step_failed', startedAt: '2026-10-29T02:28:50+00:00', endedAt: '2026-10-29T02:29:10+00:00'}),
  cancelled: item({jobId: '8b71d3c8-f723-44a3-b9f6-0229053dd41b', projectTitle: 'המזבח החיצון והכבש', state: 'cancelled', reason: 'user_cancelled', endedAt: '2026-10-29T02:29:10+00:00'}),
};

const attempt = (over: Record<string, unknown> = {}) => ({
  id: '6a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
  number: 1,
  state: 'running',
  stage: 'search',
  reason: null,
  createdAt: '2026-10-29T02:28:49.950178+00:00',
  startedAt: '2026-10-29T02:28:50+00:00',
  endedAt: null,
  chargeableOperations: 0,
  ...over,
});
const detail = (over: Partial<JobDetail> = {}): JobDetail => ({
  jobId: JOB,
  projectId: PROJECT,
  projectTitle: 'Courtyard bench',
  kind: 'test_workload',
  createdAt: '2026-10-29T02:28:49.950178+00:00',
  state: 'running',
  stage: 'search',
  reason: null,
  canCancel: true,
  canRetry: false,
  attempts: [attempt() as JobDetail['attempts'][number]],
  progress: {steps: 1, stepsBegun: 1, operationsPlanned: 1, operationsCompleted: 0},
  cost: {held: 3400, settled: 0, released: 0, chargeableOperations: 1},
  ending: null,
  ...over,
});
const variants: Record<string, JobDetail> = {
  waiting: detail({state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch', attempts: [attempt({state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch', startedAt: null}) as never], progress: {steps: 1, stepsBegun: 0, operationsPlanned: 1, operationsCompleted: 0}, cost: {held: 3400, settled: 0, released: 0, chargeableOperations: 0}}),
  awaitingWorker: detail({state: 'waiting', stage: 'accepted', reason: 'awaiting_worker', attempts: [attempt({state: 'waiting', stage: 'accepted', reason: 'awaiting_worker', startedAt: null}) as never], progress: {steps: 0, stepsBegun: 0, operationsPlanned: 0, operationsCompleted: 0}, cost: {held: 0, settled: 0, released: 0, chargeableOperations: 0}}),
  running: detail(),
  completed: detail({
    state: 'completed',
    canCancel: false,
    attempts: [attempt({state: 'completed', endedAt: '2026-10-29T02:29:10+00:00'}) as never],
    progress: {steps: 1, stepsBegun: 1, operationsPlanned: 1, operationsCompleted: 1},
    cost: {held: 0, settled: 2, released: 3398, chargeableOperations: 0},
  }),
  failed: detail({
    state: 'failed',
    reason: 'step_failed',
    canCancel: false,
    canRetry: true,
    ending: 'step_failed',
    attempts: [attempt({state: 'failed', reason: 'step_failed', endedAt: '2026-10-29T02:29:10+00:00', chargeableOperations: 1}) as never],
  }),
  rejected: detail({
    state: 'failed',
    reason: 'step_failed',
    canCancel: false,
    canRetry: true,
    ending: 'stale_revision',
    attempts: [attempt({state: 'failed', reason: 'step_failed', endedAt: '2026-10-29T02:29:10+00:00'}) as never],
    cost: {held: 0, settled: 2, released: 3398, chargeableOperations: 0},
  }),
  cancelled: detail({
    state: 'cancelled',
    stage: 'accepted',
    reason: 'user_cancelled',
    canCancel: false,
    ending: null,
    attempts: [attempt({state: 'cancelled', stage: 'accepted', reason: 'user_cancelled', startedAt: null, endedAt: '2026-10-29T02:29:10+00:00'}) as never],
    progress: {steps: 1, stepsBegun: 0, operationsPlanned: 1, operationsCompleted: 0},
    cost: {held: 0, settled: 0, released: 3400, chargeableOperations: 0},
  }),
};

beforeEach(() => {
  request.cookies = {};
  request.acceptLanguage = null;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  mocks.access = active;
  mocks.listJobs.mockReset().mockResolvedValue({outcome: 'found', jobs: Object.values(items)});
  mocks.readJobDetail.mockReset().mockImplementation(async (_operation, input: {jobId: string}) => (input.jobId === JOB ? {outcome: 'found', job: variants.running} : {outcome: 'unavailable'}));
  mocks.refresh.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// J-01 --------------------------------------------------------------------------------------------------------------------------------------

describe('In Progress (J-01)', () => {
  it.each(locales)('says there are no jobs, with a way to the Projects, and keeps "Prints in Progress" as coming later, in %s', (locale) => {
    const markup = render(locale, <NovaDashboard view="progress" jobs={{state: 'listed', jobs: []}}/>);
    expect(text(markup)).toContain(t(locale, 'progress.noneTitle'));
    expect(text(markup)).toContain(t(locale, 'progress.seeProjects'));
    expect(text(markup)).toContain(t(locale, 'progress.printsTitle'));
    expect(text(markup)).toContain(t(locale, 'progress.comingLater'));
    expect(markup).not.toContain('job-card');
    expect(markup).not.toContain('role="progressbar"');
    // Nothing is open, so nothing says it updates by itself.
    expect(text(markup)).not.toContain(t(locale, 'job.list.updates', {seconds: 10}));
  });

  it('is the empty state when no jobs are given at all, as the shell and the other pages render it', () => {
    expect(text(render('en', <NovaDashboard view="progress"/>))).toContain(t('en', 'progress.noneTitle'));
  });

  it.each(locales)('lists the open jobs first and the finished ones after, each with its state as a word, in %s', (locale) => {
    const markup = render(locale, <NovaDashboard view="progress" jobs={{state: 'listed', jobs: Object.values(items)}}/>);
    const body = text(markup);
    expect(body).toContain(t(locale, 'job.list.activeTitle'));
    expect(body).toContain(t(locale, 'job.list.recentTitle'));
    expect(body.indexOf(t(locale, 'job.list.activeTitle'))).toBeLessThan(body.indexOf(t(locale, 'job.list.recentTitle')));
    expect(markup.match(/<article class="job-card"/g)).toHaveLength(6);
    for (const key of ['job.state.waiting', 'job.state.running', 'job.state.completed', 'job.state.failed', 'job.state.cancelled'] as const) expect(body, key).toContain(t(locale, key));
    // Why a job waits, and why one that stopped did.
    expect(body).toContain(t(locale, 'job.reason.awaiting_dispatch'));
    expect(body).toContain(t(locale, 'job.reason.awaiting_worker'));
    expect(body).toContain(t(locale, 'job.reason.step_failed'));
    expect(body).toContain(t(locale, 'job.reason.user_cancelled'));
    // The person's own titles are shown as written.
    expect(body).toContain('המזבח החיצון והכבש');
    // Open work says it updates by itself; the placeholder is still there.
    expect(body).toContain(t(locale, 'job.list.updates', {seconds: 10}));
    expect(body).toContain(t(locale, 'progress.printsTitle'));
    expect(markup).toContain(`<button type="button" class="btn btn-secondary"`);
  });

  it('puts the open jobs in one list and the finished in another', () => {
    const markup = render('en', <NovaDashboard view="progress" jobs={{state: 'listed', jobs: Object.values(items)}}/>);
    const open = markup.slice(markup.indexOf('jobs-open-title'), markup.indexOf('jobs-finished-title'));
    expect(open.match(/<article class="job-card"/g)).toHaveLength(3);
    const finished = markup.slice(markup.indexOf('jobs-finished-title'), markup.indexOf('coming-card'));
    expect(finished.match(/<article class="job-card"/g)).toHaveLength(3);
  });

  it('says nothing is running when every job has finished, and offers no refresh timer message', () => {
    const markup = render('en', <NovaDashboard view="progress" jobs={{state: 'listed', jobs: [items.completed, items.failed]}}/>);
    expect(text(markup)).toContain(t('en', 'job.list.activeNone'));
    expect(text(markup)).not.toContain(t('en', 'job.list.updates', {seconds: 10}));
  });

  it.each(locales)('says the list could not be read, and never shows it as an empty one, in %s', (locale) => {
    const markup = render(locale, <NovaDashboard view="progress" jobs={{state: 'unreadable'}}/>);
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain(t(locale, 'job.error.title'));
    expect(text(markup)).toContain(t(locale, 'state.retry'));
    expect(text(markup)).not.toContain(t(locale, 'progress.noneTitle'));
    expect(markup).not.toContain('job-card');
    // The placeholder is the page's own and stays.
    expect(text(markup)).toContain(t(locale, 'progress.printsTitle'));
  });

  it('links each card to its job, by the id the list gave, and says the project and the kind in the link', () => {
    const markup = render('en', <JobCard job={items.running}/>);
    expect(markup).toContain(`href="/progress/${items.running.jobId}"`);
    expect(text(markup)).toContain('Test workload for Courtyard bench');
    // A running job says where it is; a completed one needs no stage; a waiting one says why.
    expect(text(markup)).toContain('Step: search');
    expect(text(render('en', <JobCard job={items.completed}/>))).not.toContain('Step: search');
    expect(text(render('en', <JobCard job={items.waiting}/>))).toContain('Waiting to be started');
  });

  it.each(locales)('isolates the Project\'s title in an element of its own, whatever script it is in, and keeps the sentence around it in the language\'s order, in %s', (locale) => {
    for (const title of ['Courtyard bench', 'המזבח החיצון והכבש']) {
      const markup = render(locale, <JobCard job={item({projectTitle: title})}/>);
      // The title, and only the title, is inside the isolating element; the card's link holds the sentence.
      expect(markup).toContain(`<bdi>${title}</bdi>`);
      const link = markup.slice(markup.indexOf('<a '), markup.indexOf('</a>'));
      expect(link).toContain(`<bdi>${title}</bdi>`);
      const [before, after] = t(locale, 'job.card.title', {kind: 'KIND', project: 'PROJECT'}).replace(/[⁦-⁩]/g, '').split('PROJECT');
      expect(text(link).trim()).toBe(`${t(locale, 'job.kind.test_workload')}${before.slice('KIND'.length)}${title}${after}`.trim().replace(/\s+/g, ' '));
    }
  });

  it('shows when it was accepted, started or finished, as the time the other pages write, and the attempt when it is not the first', () => {
    expect(text(render('en', <JobCard job={items.waiting}/>))).toContain('Accepted 2026-10-29 02:28 UTC');
    expect(text(render('en', <JobCard job={items.running}/>))).toContain('Started 2026-10-29 02:28 UTC');
    expect(text(render('en', <JobCard job={items.completed}/>))).toContain('Finished 2026-10-29 02:29 UTC');
    expect(text(render('en', <JobCard job={item({attemptNumber: 2})}/>))).toContain('Attempt 2');
    expect(text(render('en', <JobCard job={item({attemptNumber: 1})}/>))).not.toContain('Attempt 1');
  });
});

describe('the In Progress page', () => {
  it('reads the Jobs for the verified Account and epoch, and nothing else decides whose they are', async () => {
    const markup = render('en', (await ProgressPage()) as ReactElement);
    expect(mocks.listJobs).toHaveBeenCalledTimes(1);
    const [operation, input] = mocks.listJobs.mock.calls[0];
    expect(operation).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(input).toEqual({limit: 50});
    expect(markup.match(/<article class="job-card"/g)).toHaveLength(6);
  });

  it('sends the person Home when the database no longer gives the Account authority', async () => {
    mocks.listJobs.mockResolvedValue({outcome: 'denied'});
    expect(await redirectedTo(ProgressPage())).toBe('/');
  });

  it('shows the list as unreadable when the database does not answer, and logs a name and a message only', async () => {
    mocks.listJobs.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    const markup = render('en', (await ProgressPage()) as ReactElement);
    expect(text(markup)).toContain(t('en', 'job.error.title'));
    expect(markup).not.toContain('job-card');
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('AccountsUnavailableError: The accounts database did not answer.');
    expect(logged).not.toContain(ACCOUNT);
  });
});

// J-02 --------------------------------------------------------------------------------------------------------------------------------------

describe('a Job (J-02)', () => {
  const stateWords = {waiting: 'job.state.waiting', awaitingWorker: 'job.state.waiting', running: 'job.state.running', completed: 'job.state.completed', failed: 'job.state.failed', rejected: 'job.state.rejected', cancelled: 'job.state.cancelled'} as const;

  describe.each(locales)('in %s', (locale) => {
    it.each(Object.keys(variants))('shows the %s variant: its state in words, its stage, its progress, its cost and what to do next', (name) => {
      const job = variants[name];
      const markup = render(locale, <JobDetailView job={job}/>);
      const body = text(markup);
      expect(body).toContain(t(locale, stateWords[name as keyof typeof stateWords]));
      expect(body).toContain(t(locale, 'job.progress.title'));
      expect(body).toContain(t(locale, 'job.cost.title'));
      expect(body).toContain(t(locale, 'job.kind.test_workload'));
      expect(body).toContain('Courtyard bench');
      // The Project is a link to the Project.
      expect(markup).toContain(`href="/projects/${PROJECT}"`);
      // There is exactly one place that says what to do next, whichever variant it is.
      expect(markup.match(/data-section="outcome"/g)).toHaveLength(1);
      // Nothing offers a retry, and nothing implies one.
      expect(markup).not.toMatch(/retry/i);
      expect(body).not.toMatch(/\b(retry|try again)\b/i);
      expect(markup.match(/<button/g)?.length ?? 0).toBeLessThanOrEqual(2);
    });

    it('explains a failure in the five things UX-DR19 asks for', () => {
      const body = text(render(locale, <JobDetailView job={variants.failed}/>));
      for (const key of ['job.what.title', 'job.what.stage', 'job.what.cause', 'job.what.kept', 'job.what.cost', 'job.what.next'] as const) expect(body, key).toContain(t(locale, key));
      expect(body).toContain(t(locale, 'job.cause.step_failed'));
      expect(body).toContain(t(locale, 'job.kept.body'));
      expect(body).toContain(t(locale, 'job.next.failed'));
      expect(body).toContain(t(locale, 'job.impact.held', {count: 1, amount: '$0.0034'}).replace(/[⁦-⁩]/g, ''));
    });

    it('explains a rejected result as a project that changed while the work ran', () => {
      const body = text(render(locale, <JobDetailView job={variants.rejected}/>));
      expect(body).toContain(t(locale, 'job.cause.stale_revision'));
      expect(body).toContain(t(locale, 'job.next.rejected'));
      expect(body).toContain(t(locale, 'job.kept.body'));
    });

    it('explains a cancellation, and what became of the money', () => {
      const body = text(render(locale, <JobDetailView job={variants.cancelled}/>));
      expect(body).toContain(t(locale, 'job.cause.user_cancelled'));
      expect(body).toContain(t(locale, 'job.next.cancelled'));
      expect(body).toContain(t(locale, 'job.impact.released', {amount: '$0.0034'}).replace(/[⁦-⁩]/g, ''));
    });

    it('says how a waiting job waits, and that a worker is awaited', () => {
      expect(text(render(locale, <JobDetailView job={variants.awaitingWorker}/>))).toContain(t(locale, 'job.reason.awaiting_worker'));
      expect(text(render(locale, <JobDetailView job={variants.awaitingWorker}/>))).toContain(t(locale, 'job.next.worker'));
      expect(text(render(locale, <JobDetailView job={variants.waiting}/>))).toContain(t(locale, 'job.next.dispatch'));
    });
  });

  it('shows real progress as a bar with its words, and says so in words when nothing has started', () => {
    const running = render('en', <JobDetailView job={variants.running}/>);
    expect(running).toContain('role="progressbar"');
    expect(running).toContain('aria-valuemax="1"');
    expect(running).toContain('aria-valuenow="0"');
    expect(running).toContain('aria-valuetext="Requests completed: 0 of 1"');
    const done = render('en', <JobDetailView job={variants.completed}/>);
    expect(done).toContain('aria-valuenow="1"');
    expect(done).toContain('inline-size:100%');
    const nothing = render('en', <JobDetailView job={variants.awaitingWorker}/>);
    expect(nothing).not.toContain('role="progressbar"');
    expect(text(nothing)).toContain(t('en', 'job.progress.nothing'));
  });

  it.each(locales)('shows NO bar for a running Job that planned no request, even with a step begun (it would always read full), and says why in words, in %s', (locale) => {
    const unmeasured = detail({progress: {steps: 1, stepsBegun: 1, operationsPlanned: 0, operationsCompleted: 0}, cost: {held: 0, settled: 0, released: 0, chargeableOperations: 0}, stage: 'work'});
    const markup = render(locale, <JobDetailView job={unmeasured}/>);
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain('progress-fill');
    expect(markup).not.toContain('100%');
    expect(text(markup)).toContain(t(locale, 'job.progress.unmeasured'));
    expect(text(markup)).not.toContain(t(locale, 'job.progress.nothing'));
    // A completed Job of the same shape is whole, in steps.
    const done = render(locale, <JobDetailView job={detail({state: 'completed', canCancel: false, progress: {steps: 1, stepsBegun: 1, operationsPlanned: 0, operationsCompleted: 0}, attempts: [attempt({state: 'completed', endedAt: '2026-10-29T02:29:10+00:00'}) as never]})}/>);
    expect(done).toContain('role="progressbar"');
    expect(done).toContain('inline-size:100%');
  });

  it.each(locales)('says that the permission changed, not that the Account was switched off, when the Account\'s epoch moved or it was removed, in %s', (locale) => {
    for (const ending of ['revoked_epoch', 'tombstoned'] as const) {
      const job = detail({state: 'cancelled', reason: 'account_disabled', canCancel: false, ending, attempts: [attempt({state: 'cancelled', reason: 'account_disabled', endedAt: '2026-10-29T02:29:10+00:00'}) as never]});
      const body = text(render(locale, <JobDetailView job={job}/>));
      expect(body, ending).toContain(t(locale, 'job.cause.authority_changed'));
      expect(body, ending).not.toContain(t(locale, 'job.cause.account_disabled'));
    }
    const disabled = detail({state: 'cancelled', reason: 'account_disabled', canCancel: false, ending: 'account_disabled', attempts: [attempt({state: 'cancelled', reason: 'account_disabled', endedAt: '2026-10-29T02:29:10+00:00'}) as never]});
    expect(text(render(locale, <JobDetailView job={disabled}/>))).toContain(t(locale, 'job.cause.account_disabled'));
  });

  it('writes every amount exactly, as a token that reads left to right, and never $0.00 for money that exists', () => {
    const markup = render('en', <JobDetailView job={variants.completed}/>);
    const cost = markup.slice(markup.indexOf('data-section="cost"'));
    expect(cost).toContain('<bdi dir="ltr" class="ltr-token">$0.000002</bdi>');
    expect(cost).toContain('<bdi dir="ltr" class="ltr-token">$0.003398</bdi>');
    expect(cost).toContain('<bdi dir="ltr" class="ltr-token">$0.00</bdi>');
    // The held amount of a running job is shown, not rounded away.
    expect(text(render('en', <JobDetailView job={variants.running}/>))).toContain('$0.0034');
    expect(text(render('en', <JobDetailView job={variants.awaitingWorker}/>))).toContain(t('en', 'job.cost.none'));
  });

  it('offers Cancel exactly while the job is open', () => {
    const cancel = t('en', 'job.cancel.button');
    for (const name of ['waiting', 'awaitingWorker', 'running']) expect(render('en', <JobDetailView job={variants[name]}/>), name).toContain(cancel);
    for (const name of ['completed', 'failed', 'rejected', 'cancelled']) expect(render('en', <JobDetailView job={variants[name]}/>), name).not.toContain(cancel);
  });

  it('says that an open job updates by itself, and has a refresh button either way', () => {
    expect(text(render('en', <JobDetailView job={variants.running}/>))).toContain(t('en', 'job.list.updates', {seconds: 10}));
    expect(text(render('en', <JobDetailView job={variants.failed}/>))).not.toContain(t('en', 'job.list.updates', {seconds: 10}));
    for (const name of ['running', 'failed']) expect(text(render('en', <JobDetailView job={variants[name]}/>)), name).toContain(t('en', 'job.refresh'));
  });

  it('lists the attempts only when there is more than one, newest first', () => {
    expect(render('en', <JobDetailView job={variants.failed}/>)).not.toContain('data-section="attempts"');
    const two = detail({
      state: 'running',
      attempts: [attempt({state: 'failed', reason: 'lease_lost', endedAt: '2026-10-29T02:29:10+00:00'}) as never, attempt({id: '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d', number: 2, stage: 'started'}) as never],
    });
    const markup = render('en', <JobDetailView job={two}/>);
    expect(markup).toContain('data-section="attempts"');
    expect(text(markup).indexOf('Attempt 2')).toBeLessThan(text(markup).lastIndexOf('Attempt 1'));
    expect(text(markup)).toContain('2 of 2');
  });

  it('shows a title of any script as written, isolated', () => {
    const markup = render('he', <JobDetailView job={detail({projectTitle: 'המזבח החיצון והכבש'})}/>);
    expect(markup).toContain('<bdi>המזבח החיצון והכבש</bdi>');
  });

  it('puts no Account, epoch, fence or digest on the page', () => {
    const markup = render('en', <JobDetailView job={variants.failed}/>);
    expect(markup).not.toContain(ACCOUNT);
    expect(markup).not.toMatch(/fence|epoch|digest|input_digest/i);
  });
});

describe('the cancel confirmation', () => {
  it.each(locales)('asks first, says what cancelling does, and starts on keeping the job, in %s', (locale) => {
    const markup = render(locale, <JobCancelDialog jobId={JOB} onClose={() => undefined} onCancelled={() => undefined}/>);
    const body = text(markup);
    expect(body).toContain(t(locale, 'job.cancel.title'));
    expect(body).toContain(t(locale, 'job.cancel.body'));
    expect(body).toContain(t(locale, 'job.cancel.cost'));
    expect(body).toContain(t(locale, 'job.cancel.keep'));
    expect(body).toContain(t(locale, 'job.cancel.confirm'));
    // Focus starts on the safe choice, not on the destructive one.
    expect(markup).toMatch(/data-autofocus=""[^>]*>\s*<span>[^<]*<\/span>/);
    const keep = markup.indexOf(`>${catalogs[locale]['job.cancel.keep']}<`);
    expect(markup.lastIndexOf('data-autofocus', keep)).toBeGreaterThan(markup.lastIndexOf('<button', keep) - 400);
    expect(markup.match(/data-autofocus/g)).toHaveLength(1);
  });

  it('carries the job and a command ID and nothing about the Account', () => {
    const markup = render('en', <JobCancelDialog jobId={JOB} onClose={() => undefined} onCancelled={() => undefined}/>);
    expect(markup).toContain(`name="jobId" value="${JOB}"`);
    expect(markup).toMatch(/name="commandId" value="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/);
    expect(markup).not.toMatch(/name="(account|epoch)/i);
    expect(markup).toContain('type="submit"');
  });
});

describe('the Job page', () => {
  it('reads the Job for the verified Account and epoch, and shows it', async () => {
    const markup = render('en', (await JobPage({params: Promise.resolve({jobId: JOB})})) as ReactElement);
    expect(mocks.readJobDetail).toHaveBeenCalledTimes(1);
    const [operation, input] = mocks.readJobDetail.mock.calls[0];
    expect(operation).toEqual({accountId: ACCOUNT, epoch: 4});
    expect(input).toEqual({jobId: JOB});
    expect(text(markup)).toContain(t('en', 'job.state.running'));
  });

  it('is one answer for a Job that is not available: the 404 page', async () => {
    expect(await isNotFound(JobPage({params: Promise.resolve({jobId: '99999999-9999-4999-8999-999999999999'})}))).toBe(true);
  });

  it('answers a malformed ID as not available without asking the database', async () => {
    for (const jobId of ['not-an-id', ' ' + JOB, JOB + '\n', '123']) {
      expect(await isNotFound(JobPage({params: Promise.resolve({jobId})})), jobId).toBe(true);
    }
    expect(mocks.readJobDetail).not.toHaveBeenCalled();
  });

  it('sends the person Home when the Account has no authority', async () => {
    mocks.readJobDetail.mockResolvedValue({outcome: 'denied'});
    expect(await redirectedTo(JobPage({params: Promise.resolve({jobId: JOB})}))).toBe('/');
  });

  it('says "try again", and not "not available", when the database does not answer', async () => {
    mocks.readJobDetail.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    const markup = render('en', (await JobPage({params: Promise.resolve({jobId: JOB})})) as ReactElement);
    expect(text(markup)).toContain(t('en', 'job.detail.error.title'));
    expect(text(markup)).not.toContain(t('en', 'job.unavailable.title'));
    expect(markup).not.toContain('job-detail');
  });

  it.each(locales)('is titled by the kind, or by the one title of an unavailable page whatever the reason, in %s', async (locale) => {
    request.cookies = {'nova3d-locale': locale};
    expect((await jobMetadata({params: Promise.resolve({jobId: JOB})})).title).toBe(t(locale, 'job.kind.test_workload'));
    expect((await jobMetadata({params: Promise.resolve({jobId: '99999999-9999-4999-8999-999999999999'})})).title).toBe(t(locale, 'meta.jobUnavailable'));
    expect((await jobMetadata({params: Promise.resolve({jobId: 'not-an-id'})})).title).toBe(t(locale, 'meta.jobUnavailable'));
    mocks.access = {state: 'unregistered'};
    expect((await jobMetadata({params: Promise.resolve({jobId: JOB})})).title).toBe(t(locale, 'meta.jobUnavailable'));
    mocks.access = active;
    mocks.readJobDetail.mockRejectedValue(new AccountsUnavailableError('The accounts database did not answer.', {retryable: true}));
    expect((await jobMetadata({params: Promise.resolve({jobId: JOB})})).title).toBe(t(locale, 'meta.job'));
  });

  it.each(locales)('has one unavailable page that says nothing of any Job, in %s', async (locale) => {
    request.cookies = {'nova3d-locale': locale};
    const markup = renderToStaticMarkup(<I18nProvider locale={locale}>{await JobUnavailable()}</I18nProvider>);
    const body = text(markup);
    expect(body).toContain(t(locale, 'job.unavailable.title'));
    expect(body).toContain(t(locale, 'job.unavailable.body'));
    expect(markup).toContain('href="/progress"');
    expect(markup).not.toContain(JOB);
    // The route's not-found file renders exactly this page.
    expect((JobNotFound() as ReactElement).type).toBe(JobUnavailable);
  });
});
