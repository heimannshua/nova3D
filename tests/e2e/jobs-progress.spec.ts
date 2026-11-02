import {randomUUID} from 'node:crypto';
import {expect, test, type BrowserContext, type Locator, type Page} from '@playwright/test';
import type {Locale, MessageKey} from '../../lib/i18n';
import {announcer, hydrated, label, overflowReport, setFontSize, signIn, variants, violations, watchForProblems} from '../support/e2e-helpers';
import {endOutage, flakyBaseUrl, startOutage} from '../support/fake-network';
import {accountsWorld, type AccountsWorld, type ForgedUser} from '../support/forged-session';
import {fixtureSchedule, jobCommands, planOperation, seedJob, workerCommands, type SeededJob, type SeededState} from '../support/job-world';

// Story 2.7: In progress (J-01) and a Job's detail (J-02), in a real browser against the production build and the local Supabase stack. Each test forges a member's session, gives the
// Account a Project, and walks Jobs into the states a screen shows by the REAL commands (tests/support/job-world.ts: api.submit_job, api.claim_attempt, api.run_step, api.finish_attempt,
// the sweep, api.cancel_job ...), so the page reads exactly what the database holds. The cancellation, the refresh and the variants are checked as a person meets them. Every flow runs on
// `desktop` and `phone`.
//
// A Job screen starts nothing: no screen accepts a Job yet, so the Jobs here are made by the commands themselves.

test.describe.configure({timeout: 120_000});

let world: AccountsWorld;
test.beforeAll(async () => {
  world = accountsWorld();
  await world.connect();
});
test.afterAll(async () => {
  await world.close();
});

const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => label(locale, key, params);
const crossing = {timeout: 20_000};
/** The text with the direction isolates the catalogs put around a filled-in value taken out, as a person reads it. */
const plain = (value: string) => value.replace(/[⁦-⁩]/g, '');
const say = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => plain(t(locale, key, params));

const dollars = (microdollars: number) => {
  const whole = Math.floor(microdollars / 1_000_000);
  const fraction = microdollars % 1_000_000;
  const decimals = fraction % 10_000 === 0 ? String(fraction).padStart(6, '0').slice(0, 2) : String(fraction).padStart(6, '0').replace(/0+$/, '');
  return `$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimals}`;
};

// The world ---------------------------------------------------------------------------------------------------------------------------------

type Options = {locale?: Locale; theme?: 'light' | 'dark'};
type Member = {user: ForgedUser; accountId: string; epoch: number};

/** A member with an Account, signed in with a language and theme. */
async function member(context: BrowserContext, baseURL: string, options: Options = {}): Promise<Member> {
  const user = await world.signedInUser();
  await world.activate(user);
  await signIn(context, baseURL, user, {locale: options.locale ?? 'en', theme: options.theme ?? 'light'});
  const account = await world.accountOf(user);
  return {user, accountId: account.id as string, epoch: account.epoch as number};
}

const who = (person: Member) => ({accountId: person.accountId, epoch: person.epoch});

/** A Project of the member's Account and one Job of it in the given state (a fixture rate schedule prices its one planned request). */
async function jobIn(person: Member, state: SeededState, options: {title?: string; projectId?: string} = {}): Promise<SeededJob & {title: string}> {
  const title = options.title ?? 'Courtyard bench';
  const projectId = options.projectId ?? (await world.addProject(person.user, {title}));
  const schedule = await fixtureSchedule(world.db);
  return {...(await seedJob(world.db, who(person), projectId, state, {schedule})), title};
}

async function open(page: Page, url: string, status = 200) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(status);
  await expect(page.getByRole('heading', {level: 1}), url).toBeVisible();
  return response!;
}
async function openJob(page: Page, jobId: string, status = 200) {
  await open(page, `/progress/${jobId}`, status);
  if (status === 200) await hydrated(page, 'main button');
}
const mainText = async (page: Page) => plain(await page.getByRole('main').innerText());
/** The text of an element as written in the markup (innerText would apply the uppercase the labels are drawn in). */
const textOf = async (locator: Locator) => plain((await locator.textContent()) ?? '');

const cards = (page: Page) => page.locator('article.job-card');
const cancelButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: t(locale, 'job.cancel.button'), exact: true});
const refreshButton = (page: Page, locale: Locale = 'en') => page.getByRole('button', {name: new RegExp(`^(${t(locale, 'job.refresh')}|${t(locale, 'job.refreshing')})$`)});
const confirmDialog = (page: Page, locale: Locale = 'en') => page.getByRole('dialog', {name: t(locale, 'job.cancel.title')});
const badge = (page: Page) => page.locator('main .project-stage .status-badge');
/** What the page's polite live region says now, as a person would hear it. */
const announced = async (page: Page) => plain((await announcer(page).textContent()) ?? '');
const outcome = (page: Page) => page.locator('[data-section="outcome"]');

/** What the database holds of a Job, to read it against the page. */
async function recordOf(jobId: string) {
  const attempts = (
    await world.db.query(
      `select a.id, a.number, a.state, a.stage, a.reason, l.end_reason, l.detail as lease_detail, l.ended_at is not null as lease_ended
         from jobs.attempts a left join jobs.leases l on l.attempt_id = a.id where a.job_id = $1 order by a.number`,
      [jobId],
    )
  ).rows as {id: string; number: number; state: string; stage: string; reason: string | null; end_reason: string | null; lease_detail: string | null; lease_ended: boolean | null}[];
  const operations = (
    await world.db.query(
      `select o.state, rv.reserved_microdollars::float8 as reserved, s.classification, s.settled_microdollars::float8 as settled
         from jobs.operations o join jobs.steps st on st.id = o.step_id join jobs.attempts a on a.id = st.attempt_id
         left join usage.reservations rv on rv.operation_id = o.id left join usage.settlements s on s.reservation_id = rv.id
        where a.job_id = $1 order by o.created_at`,
      [jobId],
    )
  ).rows as {state: string; reserved: number | null; classification: string | null; settled: number | null}[];
  return {attempts, operations};
}

// ---------------------------------------------------------------------------------------------------
test.describe('In progress (J-01)', () => {
  test('says there are no jobs, with a way to the Projects, and keeps "Prints in Progress" as coming later', async ({page, context, baseURL}) => {
    await member(context, baseURL!);
    await open(page, '/progress');
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'progress.noneTitle')})).toBeVisible();
    await expect(page.getByRole('link', {name: t('en', 'progress.seeProjects')})).toHaveAttribute('href', '/projects');
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'progress.printsTitle')})).toBeVisible();
    await expect(page.getByText(t('en', 'progress.comingLater'))).toBeVisible();
    await expect(page.locator('main [role="progressbar"]')).toHaveCount(0);
    // Nothing is open, so the page does not claim to update by itself.
    await expect(page.getByText(say('en', 'job.list.updates', {seconds: 10}))).toHaveCount(0);
  });

  test('lists several jobs in mixed states: the open ones first, each a card with its state in a word and a shape, and one target that opens the job', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const project = await world.addProject(person.user, {title: 'Courtyard bench'});
    const other = await world.addProject(person.user, {title: 'Garden arch'});
    // The finished ones first: an Account may have three open jobs, and a job is open until it ends.
    const completed = await jobIn(person, 'completed', {projectId: project});
    const failed = await jobIn(person, 'failed', {projectId: other});
    const cancelled = await jobIn(person, 'cancelled', {projectId: project});
    const jobs = {
      waiting: await jobIn(person, 'waiting', {projectId: project}),
      awaitingWorker: await jobIn(person, 'awaiting_worker', {projectId: other}),
      running: await jobIn(person, 'running', {projectId: project}),
      completed,
      failed,
      cancelled,
    };
    await open(page, '/progress');
    await expect(cards(page)).toHaveCount(6);
    const open3 = page.locator('section[aria-labelledby="jobs-open-title"] article.job-card');
    const done3 = page.locator('section[aria-labelledby="jobs-finished-title"] article.job-card');
    await expect(open3).toHaveCount(3);
    await expect(done3).toHaveCount(3);
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'job.list.activeTitle')})).toBeVisible();
    await expect(page.getByRole('heading', {level: 2, name: t('en', 'job.list.recentTitle')})).toBeVisible();
    for (const [id, state, reason] of [
      [jobs.waiting.jobId, 'job.state.waiting', 'job.reason.awaiting_dispatch'],
      [jobs.awaitingWorker.jobId, 'job.state.waiting', 'job.reason.awaiting_worker'],
      [jobs.running.jobId, 'job.state.running', null],
      [jobs.completed.jobId, 'job.state.completed', null],
      [jobs.failed.jobId, 'job.state.failed', 'job.reason.step_failed'],
      [jobs.cancelled.jobId, 'job.state.cancelled', 'job.reason.user_cancelled'],
    ] as const) {
      const card = cards(page).filter({has: page.locator(`a[href="/progress/${id}"]`)});
      await expect(card, id).toHaveCount(1);
      await expect(card.locator('.status-badge')).toHaveText(t('en', state));
      // A state is a word and its own shape, never colour alone.
      await expect(card.locator('.status-badge svg')).toHaveCount(1);
      if (reason) await expect(card).toContainText(t('en', reason));
      await expect(card.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
      await expect(card.getByRole('link')).toHaveText(new RegExp(`${t('en', 'job.kind.test_workload')}[\\u2066-\\u2069]* for `));
    }
    // The cards of the two Projects name their own.
    await expect(cards(page).filter({hasText: 'Garden arch'})).toHaveCount(2);
    await expect(cards(page).filter({hasText: 'Courtyard bench'})).toHaveCount(4);
    // The whole card is one target.
    const card = cards(page).filter({has: page.locator(`a[href="/progress/${jobs.running.jobId}"]`)});
    await card.scrollIntoViewIfNeeded();
    const box = (await card.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
    await expect(page).toHaveURL(`${baseURL}/progress/${jobs.running.jobId}`, crossing);
  });

  test('never lists another Account\'s jobs, nor those of a deleted Project, and shows nothing of them', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const mine = await jobIn(person, 'waiting', {title: 'Mine'});
    const stranger = await member(context, baseURL!);
    await jobIn(stranger, 'waiting', {title: 'Somebody else\'s secret plans'});
    const doomed = await jobIn(person, 'completed', {title: 'Doomed'});
    await world.hideProject(doomed.projectId);
    // The page reads the cookie of the context's last sign-in: sign in as the first member again.
    await signIn(context, baseURL!, person.user, {locale: 'en', theme: 'light'});
    await open(page, '/progress');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first().locator('a')).toHaveAttribute('href', `/progress/${mine.jobId}`);
    expect(await page.content()).not.toContain('secret plans');
    expect(await page.content()).not.toContain('Doomed');
  });

  test('is an error state with a way to try again, and nothing else of the jobs, when the list cannot be read; asking again works', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    await jobIn(person, 'waiting', {title: 'Behind the outage'});
    await open(page, '/progress');
    await expect(cards(page)).toHaveCount(1);
    startOutage(person.accountId, {rpc: ['list_jobs'], mode: 'down'});
    try {
      await open(page, `${flakyBaseUrl(baseURL!)}/progress`);
      await expect(page.getByRole('heading', {level: 2, name: t('en', 'job.error.title')})).toBeVisible();
      await expect(page.locator('.state-error[role="alert"]')).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
      // "We could not look" is not "you have none".
      await expect(page.getByRole('heading', {name: t('en', 'progress.noneTitle')})).toHaveCount(0);
      await expect(page.getByText('Behind the outage')).toHaveCount(0);
      // The placeholder is the page's own and stays.
      await expect(page.getByRole('heading', {level: 2, name: t('en', 'progress.printsTitle')})).toBeVisible();
    } finally {
      endOutage(person.accountId);
    }
    await hydrated(page, 'main button');
    await page.getByRole('button', {name: t('en', 'state.retry')}).click();
    await expect(cards(page)).toHaveCount(1, crossing);
  });

  test('keeps the shell\'s navigation on In Progress for a job beneath it, and goes back to it', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    await expect(page.getByRole('navigation', {name: label('en', 'a11y.mainNavigation')}).getByRole('link', {name: t('en', 'nav.progress')})).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', {name: new RegExp(t('en', 'nav.back'))}).first().click();
    await expect(page).toHaveURL(`${baseURL}/progress`, crossing);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('a Job (J-02)', () => {
  type Expected = {state: MessageKey; reason?: MessageKey; stage?: string; progress?: string; nextKey: MessageKey; cancel: boolean; explained?: boolean; cause?: MessageKey; cost: (j: SeededJob) => string};
  const variantsOf: Record<string, {seed: SeededState; expected: Expected}> = {
    waiting: {
      seed: 'waiting',
      expected: {state: 'job.state.waiting', reason: 'job.reason.awaiting_dispatch', stage: 'job.stage.accepted', nextKey: 'job.next.dispatch', cancel: true, cost: () => 'job.cost.title'},
    },
    'waiting for a worker': {
      seed: 'awaiting_worker',
      expected: {state: 'job.state.waiting', reason: 'job.reason.awaiting_worker', stage: 'job.stage.accepted', nextKey: 'job.next.worker', cancel: true, cost: () => 'job.cost.none'},
    },
    running: {
      seed: 'running',
      expected: {state: 'job.state.running', stage: 'job.stage.step', progress: 'Requests completed: 0 of 1', nextKey: 'job.next.running', cancel: true, cost: () => dollars(3400)},
    },
    completed: {
      seed: 'completed',
      expected: {state: 'job.state.completed', stage: 'job.stage.step', progress: 'Requests completed: 1 of 1', nextKey: 'job.next.completed', cancel: false, cost: () => dollars(2)},
    },
    failed: {
      seed: 'failed',
      expected: {state: 'job.state.failed', reason: 'job.reason.step_failed', progress: 'Requests completed: 0 of 1', nextKey: 'job.next.failed', cancel: false, explained: true, cause: 'job.cause.step_failed', cost: () => dollars(3400)},
    },
    'a lost worker': {
      seed: 'lease_lost',
      expected: {state: 'job.state.failed', reason: 'job.reason.lease_lost', progress: 'Requests completed: 0 of 1', nextKey: 'job.next.failed', cancel: false, explained: true, cause: 'job.cause.lease_lost', cost: () => dollars(3400)},
    },
    'a stale result rejected': {
      seed: 'stale',
      expected: {state: 'job.state.rejected', progress: 'Requests completed: 1 of 1', nextKey: 'job.next.rejected', cancel: false, explained: true, cause: 'job.cause.stale_revision', cost: () => dollars(2)},
    },
    cancelled: {
      seed: 'cancelled',
      expected: {state: 'job.state.cancelled', reason: 'job.reason.user_cancelled', stage: 'job.stage.accepted', nextKey: 'job.next.cancelled', cancel: false, explained: true, cause: 'job.cause.user_cancelled', cost: () => 'job.cost.none'},
    },
  };

  for (const [name, variant] of Object.entries(variantsOf)) {
    test(`shows the "${name}" variant: its state, stage, progress, cost, what happened and what to do next`, async ({page, context, baseURL}) => {
      const person = await member(context, baseURL!);
      const job = await jobIn(person, variant.seed);
      await openJob(page, job.jobId);
      const expected = variant.expected;
      await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'job.kind.test_workload'));
      await expect(badge(page)).toHaveText(t('en', expected.state));
      await expect(badge(page).locator('svg')).toHaveCount(1);
      if (expected.reason) await expect(page.locator('.job-reason')).toHaveText(t('en', expected.reason));
      const body = await mainText(page);
      expect(body).toContain('Courtyard bench');
      if (expected.stage === 'job.stage.step') expect(body).toContain('Step: search');
      else if (expected.stage) expect(body).toContain(say('en', expected.stage as MessageKey));
      if (expected.progress) await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext', expected.progress);
      else await expect(page.getByRole('progressbar')).toHaveCount(0);
      // What to do next: one place, in plain words, and never a retry.
      await expect(outcome(page)).toHaveCount(1);
      expect(await textOf(outcome(page))).toContain(say('en', expected.nextKey));
      expect(body).not.toMatch(/\b(retry|try again)\b/i);
      await expect(page.getByRole('button', {name: /retry|again/i})).toHaveCount(0);
      // The cost, exactly.
      const cost = expected.cost(job);
      if (cost.startsWith('job.')) expect(await textOf(page.locator('[data-section="cost"]'))).toContain(say('en', cost as MessageKey));
      else expect(await textOf(page.locator('[data-section="cost"]'))).toContain(cost);
      // Cancel is there while the job is open, and only then.
      await expect(cancelButton(page)).toHaveCount(expected.cancel ? 1 : 0);
      // A failure or a stop explains itself in the five things.
      if (expected.explained) {
        const text = await textOf(outcome(page));
        for (const key of ['job.what.title', 'job.what.stage', 'job.what.cause', 'job.what.kept', 'job.what.cost', 'job.what.next'] as const) expect(text, key).toContain(say('en', key));
        expect(text).toContain(say('en', expected.cause!));
        expect(text).toContain(say('en', 'job.kept.body'));
      }
      // The page agrees with the records.
      const record = await recordOf(job.jobId);
      expect(record.attempts).toHaveLength(1);
      const attempt = record.attempts[0];
      if (variant.seed === 'stale') expect(attempt.lease_detail).toBe('stale_revision');
      if (variant.seed === 'lease_lost') expect(attempt.reason).toBe('lease_lost');
    });
  }

  test('says what a failure cost: a request already sent may still be charged, and its amount stays held', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'failed');
    await openJob(page, job.jobId);
    const text = await textOf(outcome(page));
    expect(text).toContain(say('en', 'job.impact.held', {count: 1, amount: dollars(3400)}));
    // The dispatched request is still potentially chargeable in the records, and its reservation is held.
    const record = await recordOf(job.jobId);
    expect(record.operations).toEqual([{state: 'dispatched', reserved: 3400, classification: null, settled: null}]);
    const cost = await textOf(page.locator('[data-section="cost"]'));
    expect(cost).toContain(dollars(3400));
    expect(cost).toContain(say('en', 'job.cost.pending'));
  });

  test('says what a completion cost: what was charged and what went back, exactly, history unrewritten', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'completed');
    await openJob(page, job.jobId);
    const cost = await textOf(page.locator('[data-section="cost"]'));
    expect(cost).toContain(dollars(2));
    expect(cost).toContain(dollars(3398));
    expect(cost).not.toContain('$0.0034');
    const record = await recordOf(job.jobId);
    expect(record.operations).toEqual([{state: 'completed', reserved: 3400, classification: 'evidence', settled: 2}]);
  });

  test('is one answer for a job that is not available: another Account\'s, unknown, malformed (an ID that does not even decode included) or of a deleted Project, each a 404 with nothing of any job', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const stranger = await member(context, baseURL!);
    const theirs = await jobIn(stranger, 'waiting', {title: 'Somebody else\'s secret plans'});
    const doomed = await jobIn(person, 'waiting', {title: 'Doomed'});
    await world.hideProject(doomed.projectId);
    await signIn(context, baseURL!, person.user, {locale: 'en', theme: 'light'});
    const pages: string[] = [];
    for (const id of [theirs.jobId, randomUUID(), 'not-a-job-id', '%E0%A4%A', doomed.jobId]) {
      await open(page, `/progress/${id}`, 404);
      await expect(page.getByRole('heading', {level: 1})).toHaveText(t('en', 'job.unavailable.title'));
      await expect(page.getByRole('link', {name: t('en', 'job.unavailable.action')})).toHaveAttribute('href', '/progress');
      await expect(page).toHaveTitle(`${t('en', 'meta.jobUnavailable')} · nova3D`);
      const content = await page.content();
      expect(content).not.toContain('secret plans');
      expect(content).not.toContain('Doomed');
      pages.push(await mainText(page));
    }
    // The same page, word for word, whatever the reason.
    expect(new Set(pages).size).toBe(1);
  });

  test('shows the job\'s own title, in the interface language, in the tab', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!, {locale: 'he'});
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    await expect(page).toHaveTitle(`${t('he', 'job.kind.test_workload')} · nova3D`);
  });

  test('puts no Account, epoch, fence, digest or request ID anywhere on the page', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    const content = await page.content();
    expect(content).not.toContain(person.accountId);
    expect(content).not.toContain(job.fence!);
    expect(content).not.toContain('a'.repeat(64));
    expect(content).not.toContain(job.outboxId);
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('cancelling a job', () => {
  test('asks first; keeping the job changes nothing; cancelling ends the lease, abandons what never went out, releases it, and the page says so', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    // A job that is accepted and waiting, with one planned request and its reservation (what submitting a job with a plan commits).
    const project = await world.addProject(person.user, {title: 'Courtyard bench'});
    const submitted = await jobCommands(world.db, who(person)).submit(project, {plan: {operations: [planOperation(await fixtureSchedule(world.db))]}});
    expect(submitted.outcome).toBe('accepted');
    const job = {jobId: submitted.job_id as string};
    await openJob(page, job.jobId);
    expect(await world.db.query('select count(*)::int as n from usage.settlements s join usage.reservations r on r.id = s.reservation_id where r.job_id = $1', [job.jobId]).then((r) => r.rows[0].n)).toBe(0);
    expect(plain(await page.locator('[data-section="cost"]').innerText())).toContain(dollars(3400));
    await cancelButton(page).click();
    await expect(confirmDialog(page)).toBeVisible();
    const dialog = await textOf(confirmDialog(page));
    expect(dialog).toContain(say('en', 'job.cancel.body'));
    expect(dialog).toContain(say('en', 'job.cancel.cost'));
    // Focus starts on the safe choice, so Enter does not cancel by accident.
    await expect(confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.keep')})).toBeFocused();
    await confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.keep')}).click();
    await expect(confirmDialog(page)).toHaveCount(0);
    expect((await recordOf(job.jobId)).attempts[0].state).toBe('waiting');
    await expect(badge(page)).toHaveText(t('en', 'job.state.waiting'));
    // Now cancel it.
    await cancelButton(page).click();
    await confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.confirm')}).click();
    await expect(confirmDialog(page)).toHaveCount(0, crossing);
    await expect(badge(page)).toHaveText(t('en', 'job.state.cancelled'), crossing);
    await expect(page.getByText(t('en', 'job.cancel.done'))).toBeVisible();
    // The change is said politely, and so is the confirmation (a status of its own).
    await expect.poll(() => announced(page), crossing).toContain(say('en', 'job.announce.changed', {state: t('en', 'job.state.cancelled'), stage: t('en', 'job.stage.accepted')}));
    await expect(page.locator('.notice[role="status"]')).toContainText(say('en', 'job.cancel.done'));
    await expect(cancelButton(page)).toHaveCount(0);
    const text = await textOf(outcome(page));
    expect(text).toContain(say('en', 'job.cause.user_cancelled'));
    expect(text).toContain(say('en', 'job.impact.released', {amount: dollars(3400)}));
    // The records: the lease (the job was never claimed, so there is none) and the attempt moved, the planned request was abandoned and its reservation released unused.
    const record = await recordOf(job.jobId);
    expect(record.attempts[0]).toMatchObject({state: 'cancelled', reason: 'user_cancelled'});
    expect(record.operations).toEqual([{state: 'abandoned', reserved: 3400, classification: 'unused', settled: 0}]);
  });

  test('a running job: the lease ends first, the request that went out stays chargeable and held, and nothing new starts', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    await cancelButton(page).click();
    await confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.confirm')}).click();
    await expect(badge(page)).toHaveText(t('en', 'job.state.cancelled'), crossing);
    const record = await recordOf(job.jobId);
    expect(record.attempts[0]).toMatchObject({state: 'cancelled', reason: 'user_cancelled', end_reason: 'cancelled', lease_detail: 'user_cancelled', lease_ended: true});
    expect(record.operations).toEqual([{state: 'dispatched', reserved: 3400, classification: null, settled: null}]);
    const text = await textOf(outcome(page));
    expect(text).toContain(say('en', 'job.impact.held', {count: 1, amount: dollars(3400)}));
    // The worker that still holds the fence is told so, and publishes nothing.
    const late = await workerCommands(world.db).finish(job.attemptId, job.fence!, 'completed');
    expect(late.outcome).toBe('cancelled');
    expect((await recordOf(job.jobId)).attempts[0].state).toBe('cancelled');
  });

  test('says a job that had already ended was not changed, and the page shows how it ended', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    await cancelButton(page).click();
    // The work finishes in the meantime (another window, a worker), before the person confirms.
    await workerCommands(world.db).operation(job.attemptId, job.fence!, job.operationIds[0], 'completed');
    await workerCommands(world.db).finish(job.attemptId, job.fence!, 'completed');
    await confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.confirm')}).click();
    await expect(confirmDialog(page).locator('.notice[role="alert"]')).toContainText(t('en', 'job.cancel.notCancellable'), crossing);
    expect((await recordOf(job.jobId)).attempts[0].state).toBe('completed');
    await confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.keep')}).click();
    await expect(badge(page)).toHaveText(t('en', 'job.state.completed'), crossing);
  });

  test('sends the command the dialog made, once for each confirmation: pressing the button twice cancels once', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'waiting');
    await openJob(page, job.jobId);
    await cancelButton(page).click();
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/progress/')) requests.push(request.url());
    });
    const confirm = confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.confirm')});
    await confirm.dblclick();
    await expect(badge(page)).toHaveText(t('en', 'job.state.cancelled'), crossing);
    expect(requests.length).toBeLessThanOrEqual(1);
    const commands = await world.db.query(`select count(*)::int as n from jobs.commands where account_id = $1 and kind = 'cancel_job'`, [person.accountId]);
    expect(commands.rows[0].n).toBe(1);
  });

  test('another Account\'s job cannot be cancelled by a form that names it: the answer is the unavailable one and nothing changes', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const mine = await jobIn(person, 'waiting', {title: 'Mine'});
    const stranger = await member(context, baseURL!);
    const theirs = await jobIn(stranger, 'waiting', {title: 'Theirs'});
    await signIn(context, baseURL!, person.user, {locale: 'en', theme: 'light'});
    await openJob(page, mine.jobId);
    await cancelButton(page).click();
    await page.evaluate((target) => {
      (document.querySelector('dialog input[name="jobId"]') as HTMLInputElement).value = target;
    }, theirs.jobId);
    await confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.confirm')}).click();
    await expect(confirmDialog(page).locator('.notice[role="alert"]')).toContainText(t('en', 'job.cancel.gone'), crossing);
    expect((await recordOf(theirs.jobId)).attempts[0].state).toBe('waiting');
    expect((await recordOf(mine.jobId)).attempts[0].state).toBe('waiting');
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('the page keeps up with the job', () => {
  test('has a refresh button that reads the job again, says that it is working, and shows what changed', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    await expect(badge(page)).toHaveText(t('en', 'job.state.running'));
    await workerCommands(world.db).operation(job.attemptId, job.fence!, job.operationIds[0], 'completed');
    await workerCommands(world.db).finish(job.attemptId, job.fence!, 'completed');
    await Promise.all([page.waitForResponse((response) => response.url().includes('_rsc=') && new URL(response.url()).pathname === `/progress/${job.jobId}`), refreshButton(page).click()]);
    await expect(badge(page)).toHaveText(t('en', 'job.state.completed'), crossing);
    await expect.poll(() => announced(page), crossing).toContain(say('en', 'job.announce.changed', {state: t('en', 'job.state.completed'), stage: 'Step: search'}));
    await expect(refreshButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    // A finished job is not refreshed by itself, but the button still works.
    await expect(page.getByText(say('en', 'job.list.updates', {seconds: 10}))).toHaveCount(0);
  });

  test('refreshes itself every 10 seconds while the job is open, and not while the tab is hidden', async ({page, context, baseURL}) => {
    test.setTimeout(120_000);
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    await expect(page.getByText(say('en', 'job.list.updates', {seconds: 10}))).toBeVisible();
    // Hide the tab: the document says it is hidden, and nothing is asked while it is.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await workerCommands(world.db).operation(job.attemptId, job.fence!, job.operationIds[0], 'completed');
    await workerCommands(world.db).finish(job.attemptId, job.fence!, 'completed');
    // What the page asks for itself is a request for this very page's payload (a link's prefetch is for another address).
    let asked = 0;
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.searchParams.has('_rsc') && url.pathname === `/progress/${job.jobId}`) asked += 1;
    });
    await page.waitForTimeout(12_000);
    expect(asked).toBe(0);
    await expect(badge(page)).toHaveText(t('en', 'job.state.running'));
    // Shown again: it reads the job at once.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(badge(page)).toHaveText(t('en', 'job.state.completed'), crossing);
  });

  test('refreshes the open job by itself within about ten seconds, with nothing pressed', async ({page, context, baseURL}) => {
    test.setTimeout(120_000);
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    await workerCommands(world.db).operation(job.attemptId, job.fence!, job.operationIds[0], 'completed');
    await workerCommands(world.db).finish(job.attemptId, job.fence!, 'completed');
    await expect(badge(page)).toHaveText(t('en', 'job.state.completed'), {timeout: 30_000});
    await expect(cancelButton(page)).toHaveCount(0);
  });

  test('In Progress refreshes itself too while anything is open, and announces that the list changed', async ({page, context, baseURL}) => {
    test.setTimeout(120_000);
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await open(page, '/progress');
    await hydrated(page, 'main button');
    await expect(page.getByText(say('en', 'job.list.updates', {seconds: 10}))).toBeVisible();
    await workerCommands(world.db).operation(job.attemptId, job.fence!, job.operationIds[0], 'completed');
    await workerCommands(world.db).finish(job.attemptId, job.fence!, 'completed');
    await expect(cards(page).first().locator('.status-badge')).toHaveText(t('en', 'job.state.completed'), {timeout: 30_000});
    await expect.poll(() => announced(page), crossing).toContain(say('en', 'job.announce.list'));
    await expect(page.locator('section[aria-labelledby="jobs-open-title"]')).toContainText(t('en', 'job.list.activeNone'));
  });
});

// ---------------------------------------------------------------------------------------------------
test.describe('accessible, localized and responsive on every Job screen (WCAG 2.2 AA)', () => {
  type Opened = {name: string; open: (page: Page, person: Member, locale: Locale) => Promise<void>};
  const hebrewTitle = 'המזבח החיצון והכבש';
  const titleFor = (locale: Locale) => (locale === 'he' ? hebrewTitle : 'Courtyard bench');
  const detail = (name: string, seed: SeededState): Opened => ({
    name: `a Job: ${name}`,
    open: async (page, person, locale) => {
      const job = await jobIn(person, seed, {title: titleFor(locale)});
      await openJob(page, job.jobId);
    },
  });
  const pages: Opened[] = [
    {name: 'In progress with no jobs', open: async (page) => void (await open(page, '/progress'))},
    {
      name: 'In progress with jobs in mixed states',
      open: async (page, person, locale) => {
        const project = await world.addProject(person.user, {title: titleFor(locale)});
        // The finished ones first: an Account may have three open jobs, and a job is open until it ends.
        for (const state of ['completed', 'failed', 'cancelled', 'waiting', 'awaiting_worker', 'running'] as const) await jobIn(person, state, {projectId: project});
        await open(page, '/progress');
        await expect(cards(page)).toHaveCount(6);
      },
    },
    detail('waiting', 'waiting'),
    detail('waiting for a worker', 'awaiting_worker'),
    detail('running', 'running'),
    detail('completed', 'completed'),
    detail('failed', 'failed'),
    detail('a lost worker', 'lease_lost'),
    detail('a stale result rejected', 'stale'),
    detail('cancelled', 'cancelled'),
    {
      name: 'the cancel confirmation',
      open: async (page, person, locale) => {
        const job = await jobIn(person, 'running', {title: titleFor(locale)});
        await openJob(page, job.jobId);
        await cancelButton(page, locale).click();
        await expect(confirmDialog(page, locale)).toBeVisible();
      },
    },
    {
      name: 'the unavailable page',
      open: async (page) => void (await open(page, `/progress/${randomUUID()}`, 404)),
    },
  ];

  for (const variant of variants) {
    for (const entry of pages) {
      test(`${entry.name} has no accessibility violations: ${variant.name}`, async ({page, context, baseURL}) => {
        const person = await member(context, baseURL!, variant);
        const problems = watchForProblems(page);
        const failed: string[] = [];
        page.on('response', (response) => {
          if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
        });
        await entry.open(page, person, variant.locale);
        await expect(page.locator('html')).toHaveAttribute('lang', variant.locale);
        await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
        expect(await violations(page)).toEqual([]);
        if (!(await page.getByRole('dialog').count())) expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
        const unavailable = entry.name === 'the unavailable page';
        expect(failed).toEqual(unavailable ? [`404 ${new URL(page.url()).pathname}`] : []);
        expect(problems.filter((problem) => !(unavailable && /^error: Failed to load resource: the server responded with a status of 404/.test(problem)))).toEqual([]);
      });
    }
  }

  test('has no violations with high contrast requested, in light and dark', async ({page, context, baseURL}) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({contrast: 'more'});
      const person = await member(context, baseURL!, {theme});
      const failed = await jobIn(person, 'failed');
      await jobIn(person, 'running');
      for (const url of ['/progress', `/progress/${failed.jobId}`]) {
        await open(page, url);
        expect(await violations(page), `${url} ${theme}`).toEqual([]);
      }
    }
  });

  test('reads right to left in Hebrew: the list, the job and the confirmation, with the title as written and every amount left to right', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!, {locale: 'he', theme: 'dark'});
    const job = await jobIn(person, 'running', {title: hebrewTitle});
    await open(page, '/progress');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('he', 'nav.progress'));
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first().locator('.status-badge')).toHaveText(t('he', 'job.state.running'));
    await expect(cards(page).first().locator('.project-title')).toContainText(hebrewTitle);
    await openJob(page, job.jobId);
    await expect(page.getByRole('heading', {level: 1})).toHaveText(t('he', 'job.kind.test_workload'));
    await expect(page.locator('main .job-facts bdi').filter({hasText: hebrewTitle})).toHaveCount(1);
    const amount = page.locator('[data-section="cost"] bdi.ltr-token').first();
    await expect(amount).toHaveAttribute('dir', 'ltr');
    await cancelButton(page, 'he').click();
    await expect(confirmDialog(page, 'he')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  for (const entry of pages.filter((candidate) => !/unavailable|confirmation/.test(candidate.name))) {
    test(`${entry.name} fits at 320 px with the text at 200%`, async ({page, context, baseURL}) => {
      const person = await member(context, baseURL!);
      await page.setViewportSize({width: 320, height: 640});
      await setFontSize(page, 32);
      await entry.open(page, person, 'en');
      expect(await overflowReport(page)).toEqual({scroll: 0, clipped: []});
    });
  }

  test('has targets of at least 44 px: the refresh and cancel buttons, the dialog\'s buttons and a card', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    for (const button of [refreshButton(page), cancelButton(page)]) {
      const box = (await button.boundingBox())!;
      expect(box.height, await button.innerText()).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await cancelButton(page).click();
    for (const name of [t('en', 'job.cancel.keep'), t('en', 'job.cancel.confirm')]) {
      const box = (await confirmDialog(page).getByRole('button', {name}).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
    }
    await confirmDialog(page).getByRole('button', {name: t('en', 'job.cancel.keep')}).click();
    await open(page, '/progress');
    const box = (await cards(page).first().boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const refresh = (await refreshButton(page).boundingBox())!;
    expect(refresh.height).toBeGreaterThanOrEqual(44);
  });

  test('puts the keyboard on every control in a sensible order, each with a visible focus ring, and returns focus to the button after the confirmation', async ({page, context, baseURL}) => {
    const person = await member(context, baseURL!);
    const job = await jobIn(person, 'running');
    await openJob(page, job.jobId);
    const ring = async () => page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return {tag: element.tagName.toLowerCase(), outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0};
    });
    const seen: string[] = [];
    await page.locator('main').getByRole('link').first().focus();
    for (let step = 0; step < 6; step += 1) {
      const focus = await ring();
      if (focus.tag === 'button' || focus.tag === 'a') expect(focus.outline, `${focus.tag} #${step}`).toBe(true);
      seen.push(await page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim()));
      await page.keyboard.press('Tab');
    }
    expect(seen.join('|')).toContain(t('en', 'job.refresh'));
    expect(seen.join('|')).toContain(t('en', 'job.cancel.button'));
    await cancelButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(confirmDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(cancelButton(page)).toBeFocused();
  });
});

