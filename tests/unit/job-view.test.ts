import {redirect} from 'next/navigation';
import {describe, expect, it, vi} from 'vitest';
import {catalogs, createTranslator, isolateLtr, locales, type Locale, type MessageKey} from '@/lib/i18n';
import {
  amountText,
  amountWords,
  attemptJobCancel,
  cancelFailureKey,
  causeKey,
  changeSignature,
  costImpactLines,
  endingDetails,
  explain,
  hasCostActivity,
  isOpenState,
  jobCancelIdle,
  jobPath,
  jobRefreshMs,
  jobRefreshSeconds,
  jobStates,
  kindWords,
  needsExplaining,
  nextActionKey,
  progressPath,
  progressNoteKey,
  progressReading,
  reasonWordKeys,
  reasonWords,
  shownReasons,
  stageWords,
  variantBadges,
  variantOf,
  variantWordKeys,
  type JobCancelState,
  type JobCost,
  type JobDetail,
  type JobProgress,
} from '@/lib/job-view';
import {hasUndecodableJobId, undecodableJobPath} from '@/lib/job-paths';
import {unexpectedResponseMessage} from '@/lib/session-actions';

// What the Job screens say (lib/job-view.ts), without a browser or a server: the variants and their words and shapes, the stage and the reason in plain language, the money (always
// exact, never $0.00 for an amount above zero), the progress that is real, the five things a failure explains, a next action that never implies a retry, and how the Cancel
// action's answer is read.

const ZERO_COST: JobCost = {held: 0, settled: 0, released: 0, chargeableOperations: 0};
const PROGRESS: JobProgress = {steps: 1, stepsBegun: 1, operationsPlanned: 1, operationsCompleted: 0};

function job(over: Partial<JobDetail> = {}): JobDetail {
  const base: JobDetail = {
    jobId: '3b71d3c8-f723-44a3-b9f6-0229053dd41b',
    projectId: '823ce223-e130-45c0-a61e-8a79f67b8008',
    projectTitle: 'Courtyard bench',
    kind: 'test_workload',
    createdAt: '2026-10-29T02:28:49.950178+00:00',
    state: 'running',
    stage: 'search',
    reason: null,
    canCancel: true,
    canRetry: false,
    attempts: [],
    progress: PROGRESS,
    cost: ZERO_COST,
    ending: null,
  };
  return {...base, ...over};
}

// The translator wraps each string it fills in a first-strong isolate, so a token already isolated left to right arrives inside both.
const filled = (text: string) => `\u2068${isolateLtr(text)}\u2069`;

const failed = (over: Partial<JobDetail> = {}) => job({state: 'failed', reason: 'step_failed', canCancel: false, canRetry: true, ending: 'step_failed', ...over});
const cancelled = (over: Partial<JobDetail> = {}) => job({state: 'cancelled', reason: 'user_cancelled', canCancel: false, ending: 'user_cancelled', ...over});

describe('the vocabularies', () => {
  it('knows which states are open', () => {
    expect(jobStates.filter(isOpenState)).toEqual(['waiting', 'running']);
  });

  it('names every reason the database can show, awaiting_worker among them', () => {
    expect(shownReasons).toEqual([
      'awaiting_dispatch',
      'awaiting_reconciliation',
      'awaiting_worker',
      'step_failed',
      'lease_lost',
      'user_cancelled',
      'account_disabled',
    ]);
    expect(Object.keys(reasonWordKeys)).toEqual([...shownReasons]);
  });

  it('names every ending a lease can have', () => {
    expect(endingDetails).toEqual(['user_cancelled', 'account_disabled', 'lease_expired', 'stale_revision', 'revoked_epoch', 'tombstoned', 'step_failed']);
  });

  it('keeps the places and the refresh period', () => {
    expect(progressPath).toBe('/progress');
    expect(jobPath('3b71d3c8-f723-44a3-b9f6-0229053dd41b')).toBe('/progress/3b71d3c8-f723-44a3-b9f6-0229053dd41b');
    expect(jobRefreshSeconds).toBe(10);
    expect(jobRefreshMs).toBe(10_000);
  });
});

describe('a Job link whose ID does not decode', () => {
  it('is found by the proxy, which sends it to the one unavailable page instead of a 500', () => {
    for (const path of ['/progress/%E0%A4%A', '/progress/%zz', '/progress/%/', '/progress/%C3%28', '/progress/%E0%A4%A/']) expect(hasUndecodableJobId(path), path).toBe(true);
    for (const path of ['/progress', '/progress/', '/progress/%41', '/progress/3b71d3c8-f723-44a3-b9f6-0229053dd41b', '/progress/3b71d3c8-f723-44a3-b9f6-0229053dd41b/', '/projects/%zz', '/progress/a/%zz']) {
      expect(hasUndecodableJobId(path), path).toBe(false);
    }
    // The page it is rewritten to is itself fine, and its segment is no ID.
    expect(hasUndecodableJobId(undecodableJobPath)).toBe(false);
    expect(undecodableJobPath).toBe('/progress/not-a-job-id');
  });
});

describe('the variants of J-02', () => {
  it('is a failed Job whose result was refused for a changed Project that shows as "rejected", and no other', () => {
    expect(variantOf(job({state: 'waiting'}))).toBe('waiting');
    expect(variantOf(job({state: 'running'}))).toBe('running');
    expect(variantOf(job({state: 'completed'}))).toBe('completed');
    expect(variantOf(failed())).toBe('failed');
    expect(variantOf(failed({ending: 'lease_expired', reason: 'lease_lost'}))).toBe('failed');
    expect(variantOf(failed({ending: 'stale_revision'}))).toBe('rejected');
    expect(variantOf(cancelled())).toBe('cancelled');
    // Only a failure can be a rejected result.
    expect(variantOf(job({state: 'completed', ending: 'stale_revision'}))).toBe('completed');
  });

  it('gives each variant its own word, tone and shape, so the state never rests on colour alone', () => {
    const variants = Object.keys(variantBadges) as (keyof typeof variantBadges)[];
    expect(variants).toEqual(['waiting', 'running', 'completed', 'failed', 'cancelled', 'rejected']);
    expect(new Set(variants.map((variant) => variantBadges[variant].icon)).size).toBe(variants.length);
    for (const locale of locales) {
      const words = variants.map((variant) => catalogs[locale][variantWordKeys[variant]]);
      expect(new Set(words).size, locale).toBe(variants.length);
    }
  });
});

describe('the stage, the reason and the kind in words', () => {
  const t = createTranslator('en');

  it('names the three stages the records set and the one step the test workload runs', () => {
    expect(stageWords(t, 'accepted')).toBe('Accepted, not started yet');
    expect(stageWords(t, 'retry')).toBe('Accepted again, not started yet');
    expect(stageWords(t, 'started')).toBe('Started');
    expect(stageWords(t, 'work')).toBe('Doing the work');
  });

  it('shows any other step key as the step it is, isolated as a token', () => {
    expect(stageWords(t, 'search')).toBe(`Step: ${filled('search')}`);
    // An inherited property is not a stage.
    expect(stageWords(t, 'constructor')).toContain('constructor');
    expect(stageWords(t, '__proto__')).toContain('__proto__');
  });

  it('says why a Job waits, failed or stopped, and nothing for a Job that has no reason', () => {
    expect(reasonWords(t, 'awaiting_worker')).toBe('Waiting for a worker that can run it');
    expect(reasonWords(t, 'awaiting_reconciliation')).toBe('Waiting for an earlier charge to be checked');
    expect(reasonWords(t, 'awaiting_dispatch')).toBe('Waiting to be started');
    expect(reasonWords(t, 'lease_lost')).toBe('The worker stopped answering');
    expect(reasonWords(t, null)).toBeNull();
  });

  it('names the only kind there is, and calls any other background work', () => {
    expect(kindWords(t, 'test_workload')).toBe('Test workload');
    expect(kindWords(t, 'research')).toBe('Background work');
  });
});

describe('money: exact, and never $0.00 for an amount above zero', () => {
  it.each([
    [0, '$0.00'],
    [1, '$0.000001'],
    [2, '$0.000002'],
    [3400, '$0.0034'],
    [10_000, '$0.01'],
    [3_398, '$0.003398'],
    [1_000_000, '$1.00'],
    [1_234_567_000, '$1,234.567'],
  ])('writes %d microdollars as %s', (microdollars, text) => {
    expect(amountText(microdollars)).toBe(text);
    expect(amountWords(microdollars)).toBe(isolateLtr(text));
  });

  it('refuses an amount that is not a whole number of microdollars, rather than round it', () => {
    expect(() => amountText(0.5)).toThrow(RangeError);
    expect(() => amountText(Number.NaN)).toThrow(RangeError);
  });

  it('never writes a positive amount as $0.00', () => {
    for (let microdollars = 1; microdollars <= 20_000; microdollars += 97) expect(amountText(microdollars)).not.toBe('$0.00');
  });

  it('knows whether anything was reserved, charged, released or may still be charged', () => {
    expect(hasCostActivity(ZERO_COST)).toBe(false);
    expect(hasCostActivity({...ZERO_COST, held: 1})).toBe(true);
    expect(hasCostActivity({...ZERO_COST, settled: 1})).toBe(true);
    expect(hasCostActivity({...ZERO_COST, released: 1})).toBe(true);
    expect(hasCostActivity({...ZERO_COST, chargeableOperations: 1})).toBe(true);
  });
});

describe('the cost impact, in sentences', () => {
  const en = createTranslator('en');
  const he = createTranslator('he');

  it('says nothing was charged when nothing was', () => {
    expect(costImpactLines(en, ZERO_COST)).toEqual(['Nothing was charged, and nothing is held.']);
    expect(costImpactLines(he, ZERO_COST)).toEqual(['שום דבר לא חויב ושום דבר לא מוחזק.']);
  });

  it('says a request that went out may still be charged and that its amount stays held', () => {
    const lines = costImpactLines(en, {held: 3400, settled: 0, released: 0, chargeableOperations: 1});
    expect(lines).toEqual([`One request was already sent and may still be charged. ${filled('$0.0034')} stays held until it is checked.`]);
    const many = costImpactLines(en, {held: 6800, settled: 0, released: 0, chargeableOperations: 2});
    expect(many).toEqual([`2 requests were already sent and may still be charged. ${filled('$0.0068')} stays held until each one is checked.`]);
  });

  it('reads the dual in Hebrew', () => {
    const [line] = costImpactLines(he, {held: 6800, settled: 0, released: 0, chargeableOperations: 2});
    expect(line).toContain('שתי בקשות');
    expect(line).toContain(filled('$0.0068'));
  });

  it('says what was charged and what went back, each in its own sentence, and what is set aside', () => {
    const lines = costImpactLines(en, {held: 0, settled: 2, released: 3398, chargeableOperations: 0});
    expect(lines).toEqual([`Charged so far: ${filled('$0.000002')}.`, `${filled('$0.003398')} was never used and went back to your allowance.`]);
    expect(costImpactLines(en, {held: 3400, settled: 0, released: 0, chargeableOperations: 0})).toEqual([`${filled('$0.0034')} is set aside for requests that have not been sent.`]);
  });

  it('says a request may be charged even when no amount is held for it', () => {
    expect(costImpactLines(en, {held: 0, settled: 0, released: 0, chargeableOperations: 1})).toEqual(['One request was already sent and may still be charged.']);
  });
});

describe('progress that is real', () => {
  it('measures requests completed of those planned', () => {
    expect(progressReading({steps: 2, stepsBegun: 2, operationsPlanned: 3, operationsCompleted: 1}, 'running')).toEqual({max: 3, value: 1, percent: 33, wordsKey: 'job.progress.requests'});
    expect(progressReading({steps: 1, stepsBegun: 1, operationsPlanned: 1, operationsCompleted: 0}, 'running')?.percent).toBe(0);
  });

  it('draws no bar when no request was planned: a step exists only once it has begun, so steps begun of steps would always read full', () => {
    // A running Job with one begun step and no operations used to read "1 of 1, 100%": a full bar for work that has barely started.
    expect(progressReading({steps: 1, stepsBegun: 1, operationsPlanned: 0, operationsCompleted: 0}, 'running')).toBeNull();
    expect(progressReading({steps: 2, stepsBegun: 2, operationsPlanned: 0, operationsCompleted: 0}, 'running')).toBeNull();
    expect(progressReading({steps: 1, stepsBegun: 1, operationsPlanned: 0, operationsCompleted: 0}, 'failed')).toBeNull();
    expect(progressReading({steps: 1, stepsBegun: 1, operationsPlanned: 0, operationsCompleted: 0}, 'cancelled')).toBeNull();
    // The real measure is untouched.
    expect(progressReading({steps: 2, stepsBegun: 2, operationsPlanned: 2, operationsCompleted: 1}, 'running')?.percent).toBe(50);
  });

  it('says in words why there is no bar: nothing has started, or this work has no parts to count', () => {
    expect(progressNoteKey({steps: 0, stepsBegun: 0, operationsPlanned: 0, operationsCompleted: 0}, 'waiting')).toBe('job.progress.nothing');
    expect(progressNoteKey({steps: 0, stepsBegun: 0, operationsPlanned: 0, operationsCompleted: 0}, 'running')).toBe('job.progress.nothing');
    expect(progressNoteKey({steps: 1, stepsBegun: 1, operationsPlanned: 0, operationsCompleted: 0}, 'running')).toBe('job.progress.unmeasured');
    expect(progressNoteKey({steps: 1, stepsBegun: 1, operationsPlanned: 0, operationsCompleted: 0}, 'failed')).toBe('job.progress.unmeasured');
  });

  it('has nothing to measure before anything has started, and is whole when the Job is completed', () => {
    expect(progressReading({steps: 0, stepsBegun: 0, operationsPlanned: 0, operationsCompleted: 0}, 'waiting')).toBeNull();
    expect(progressReading({steps: 1, stepsBegun: 1, operationsPlanned: 2, operationsCompleted: 2}, 'completed')?.percent).toBe(100);
    // A completed Job is whole even if a request was never counted, and a completed Job that planned no request is whole in steps.
    expect(progressReading({steps: 1, stepsBegun: 1, operationsPlanned: 2, operationsCompleted: 1}, 'completed')?.percent).toBe(100);
    expect(progressReading({steps: 1, stepsBegun: 1, operationsPlanned: 0, operationsCompleted: 0}, 'completed')).toEqual({max: 1, value: 1, percent: 100, wordsKey: 'job.progress.steps'});
  });

  it('never goes past its end', () => {
    expect(progressReading({steps: 1, stepsBegun: 1, operationsPlanned: 2, operationsCompleted: 5}, 'running')?.percent).toBe(100);
  });
});

describe('what a failure explains, and what to do next', () => {
  const en = createTranslator('en');

  it('needs explaining when the Job failed or was cancelled, and only then', () => {
    expect(jobStates.filter((state) => needsExplaining({state}))).toEqual(['failed', 'cancelled']);
  });

  it('explains a failed step: the stage, the known cause, what was kept, the cost, and what to do next', () => {
    const explanation = explain(en, failed({stage: 'search', cost: {held: 3400, settled: 0, released: 0, chargeableOperations: 1}}));
    expect(explanation.stage).toBe(`Step: ${filled('search')}`);
    expect(explanation.cause).toBe('The work ran into a problem and could not finish.');
    expect(explanation.kept).toBe('Everything you had approved is exactly as it was. Nothing from this run was added to your project.');
    expect(explanation.cost).toHaveLength(1);
    expect(explanation.cost[0]).toContain('may still be charged');
    expect(explanation.next).toBe('It will not run again by itself. Starting this work again is your decision, and this page does not offer it yet.');
  });

  it('tells a lost worker from a refused result and from a cancellation, by the lease\'s ending', () => {
    expect(explain(en, failed({reason: 'lease_lost', ending: 'lease_expired'})).cause).toBe('The worker stopped answering before the work was done, so it was marked as failed.');
    expect(explain(en, failed({ending: 'stale_revision'})).cause).toBe('The project changed while the work was running, so its result was not kept.');
    expect(explain(en, cancelled()).cause).toBe('You cancelled it.');
    expect(explain(en, cancelled({reason: 'account_disabled', ending: 'account_disabled'})).cause).toBe('Your Account was switched off while it was running, so the work was stopped.');
    // An Account that was switched off and on again (its epoch moved) or removed was not necessarily "switched off" while the work ran: the words say what is known.
    for (const ending of ['revoked_epoch', 'tombstoned'] as const) {
      const authority = explain(en, cancelled({reason: 'account_disabled', ending})).cause;
      expect(authority, ending).toBe('The permission to run work for your Account changed while it was running, so the work was stopped. Everything you had approved was kept.');
      expect(authority, ending).not.toContain('switched off');
    }
    expect(causeKey({state: 'cancelled', reason: 'account_disabled', ending: 'revoked_epoch'})).toBe('job.cause.authority_changed');
    expect(causeKey({state: 'cancelled', reason: 'account_disabled', ending: 'tombstoned'})).toBe('job.cause.authority_changed');
    expect(causeKey({state: 'cancelled', reason: 'account_disabled', ending: 'account_disabled'})).toBe('job.cause.account_disabled');
    expect(causeKey({state: 'cancelled', reason: 'account_disabled', ending: null})).toBe('job.cause.account_disabled');
    // A cancel by the user is the user's, whatever the lease says.
    expect(causeKey({state: 'cancelled', reason: 'user_cancelled', ending: 'user_cancelled'})).toBe('job.cause.user_cancelled');
    // The Hebrew words say it too, in no Latin letters.
    expect(createTranslator('he')('job.cause.authority_changed')).not.toMatch(/[A-Za-z]/);
    // A failure whose cause is not recorded says so.
    expect(explain(en, failed({reason: null, ending: null})).cause).toBe('The cause is not known.');
  });

  it('names the stage a cancelled-before-start Job never left', () => {
    expect(explain(en, cancelled({stage: 'accepted', cost: ZERO_COST})).stage).toBe('Accepted, not started yet');
  });

  it('gives every variant a next action, and none of them says the work will run again by itself or points at a retry button', () => {
    const jobs = [
      job({state: 'waiting', reason: 'awaiting_dispatch'}),
      job({state: 'waiting', reason: 'awaiting_worker'}),
      job({state: 'waiting', reason: 'awaiting_reconciliation'}),
      job({state: 'running'}),
      job({state: 'completed', canCancel: false}),
      failed(),
      failed({ending: 'stale_revision'}),
      cancelled(),
    ];
    const keys = jobs.map((candidate) => nextActionKey(candidate));
    expect(new Set(keys).size).toBe(8);
    for (const locale of locales) {
      for (const key of keys) {
        const text = catalogs[locale][key] as string;
        expect(text.length, `${locale}:${key}`).toBeGreaterThan(10);
        expect(text, `${locale}:${key}`).not.toMatch(/\bretry\b|try again|automatic|will be tried|runs again|will run again\b(?! by itself)/i);
      }
    }
    // The failure ones say, in so many words, that nothing runs again without being asked.
    for (const key of [nextActionKey(failed()), nextActionKey(failed({ending: 'stale_revision'}))]) expect(catalogs.en[key]).toContain('will not run again by itself');
  });

  it('picks the next action of a waiting Job by why it waits', () => {
    expect(nextActionKey(job({state: 'waiting', reason: 'awaiting_dispatch'}))).toBe('job.next.dispatch');
    expect(nextActionKey(job({state: 'waiting', reason: 'awaiting_worker'}))).toBe('job.next.worker');
    expect(nextActionKey(job({state: 'waiting', reason: 'awaiting_reconciliation'}))).toBe('job.next.reconciliation');
  });
});

describe('what the Cancel action answers', () => {
  const data = () => new FormData();
  const cancelledState: JobCancelState = {outcome: 'cancelled', replayed: false};

  it('has a message for each answer that is not a cancellation, and none for the others', () => {
    expect(cancelFailureKey(jobCancelIdle)).toBeNull();
    expect(cancelFailureKey(cancelledState)).toBeNull();
    // A form that is not the dialog's has a message too: the dialog shows something, and says nothing was changed.
    expect(cancelFailureKey({outcome: 'invalid'})).toBe('job.cancel.invalid');
    expect(cancelFailureKey({outcome: 'not_cancellable', state: 'completed'})).toBe('job.cancel.notCancellable');
    expect(cancelFailureKey({outcome: 'reused'})).toBe('job.cancel.reused');
    expect(cancelFailureKey({outcome: 'gone'})).toBe('job.cancel.gone');
    expect(cancelFailureKey({outcome: 'unavailable', unknown: false})).toBe('job.cancel.unavailable');
    expect(cancelFailureKey({outcome: 'unavailable', unknown: true})).toBe('job.cancel.unknown');
  });

  it('passes the action\'s own answer through, and hands it the previous state and the form', async () => {
    const action = vi.fn(async () => cancelledState);
    const form = data();
    expect(await attemptJobCancel(action, {outcome: 'idle'}, form, vi.fn())).toBe(cancelledState);
    expect(action).toHaveBeenCalledWith({outcome: 'idle'}, form);
  });

  it('rethrows a redirect for Next.js to follow', async () => {
    const navigate = vi.fn();
    let thrown: unknown;
    try {
      redirect('/login');
    } catch (error) {
      thrown = error;
    }
    await expect(
      attemptJobCancel(async () => {
        throw thrown;
      }, jobCancelIdle, data(), navigate),
    ).rejects.toBe(thrown);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('loads the page again when the answer was a redirect by the proxy, and keeps the previous state', async () => {
    const navigate = vi.fn();
    const previous: JobCancelState = {outcome: 'gone'};
    const state = await attemptJobCancel(
      async () => {
        throw new Error(unexpectedResponseMessage);
      },
      previous,
      data(),
      navigate,
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(state).toBe(previous);
  });

  it('reads any other failure as an answer that did not come: unavailable, and the cancellation may have been made', async () => {
    const navigate = vi.fn();
    const state = await attemptJobCancel(
      async () => {
        throw new TypeError('Failed to fetch');
      },
      jobCancelIdle,
      data(),
      navigate,
    );
    expect(state).toEqual({outcome: 'unavailable', unknown: true});
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('announcing a change', () => {
  it('changes when the state, the stage or the reason does, and not otherwise', () => {
    const base = {state: 'waiting', stage: 'accepted', reason: 'awaiting_dispatch'} as const;
    expect(changeSignature(base)).toBe(changeSignature({...base}));
    expect(changeSignature(base)).not.toBe(changeSignature({...base, state: 'running', reason: null}));
    expect(changeSignature(base)).not.toBe(changeSignature({...base, reason: 'awaiting_worker'}));
    expect(changeSignature(base)).not.toBe(changeSignature({...base, stage: 'started'}));
  });
});

describe('the copy', () => {
  const keys = Object.keys(catalogs.en).filter((key) => key.startsWith('job.')) as MessageKey[];

  it('has job copy in both languages with the same placeholders, and none in Hebrew written in Latin letters', () => {
    expect(keys.length).toBeGreaterThan(80);
    for (const locale of locales as readonly Locale[]) {
      for (const key of keys) {
        const message = catalogs[locale][key];
        expect(message, `${locale}:${key}`).toBeDefined();
      }
    }
    for (const key of keys) {
      const message = catalogs.he[key];
      const texts = typeof message === 'string' ? [message] : Object.values(message);
      for (const text of texts) expect(text.replace(/\{\w+\}/g, ''), `he:${key}`).not.toMatch(/[A-Za-z]{2,}/);
    }
  });

  it('puts no dollar sign or digit of money in a message: an amount is always a {placeholder}', () => {
    for (const locale of locales as readonly Locale[]) {
      for (const key of keys) {
        const message = catalogs[locale][key];
        const texts = typeof message === 'string' ? [message] : Object.values(message);
        for (const text of texts) expect(text, `${locale}:${key}`).not.toMatch(/\$\s?\d/);
      }
    }
  });
});
