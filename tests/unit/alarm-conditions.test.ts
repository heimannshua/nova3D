import {describe, expect, it} from 'vitest';
import {
  alarmConditions,
  alarmKey,
  evaluateConditions,
  heartbeatStaleCondition,
  identitiesUnaccountedCondition,
  lateFactor,
  ledgerPendingCondition,
  ledgerPendingSeconds,
  qstashStaleCondition,
  schedulerStaleSeconds,
  taskLateCondition,
  unaccountedLimit,
  type AlarmCondition,
  type Observations,
  type TaskReceipt,
} from '@/lib/alarm-conditions';
import {isAlarmDetail} from '@/lib/lifecycle';
import {scheduleRegistry} from '@/lib/schedules';

// The registry of alarm conditions (Story 1.13, lib/alarm-conditions.ts): every condition is a pure function of the observations the database reports (ages in
// seconds), so each is tested with the observations as data. Nothing here touches a database, a clock or the environment.

const AT = '2026-10-17T08:00:00.000Z';
const receipt = (task: string, age: number, outcome: TaskReceipt['outcome'] = 'ran'): TaskReceipt => ({task, outcome, at: AT, age});

/** Observations in which nothing is wrong: every task finished a run a minute ago, nothing is pending, the heartbeat is configured and fresh. */
function calm(change: Partial<Observations> = {}): Observations {
  return {
    firstReceiptAge: 40_000,
    latestReceiptAge: 60,
    firstHeartbeatAge: 30_000,
    latestHeartbeatAge: 600,
    ledgerWaiting: 0,
    ledgerOldest: null,
    unaccounted: 0,
    tasks: scheduleRegistry.map((entry) => receipt(entry.task, 60)),
    heartbeatConfigured: true,
    ...change,
  };
}
const without = (observations: Observations, task: string): Observations => ({...observations, tasks: observations.tasks.filter((candidate) => candidate.task !== task)});
const withReceipt = (observations: Observations, replacement: TaskReceipt): Observations => ({...observations, tasks: [...observations.tasks.filter((candidate) => candidate.task !== replacement.task), replacement]});

describe('the registry', () => {
  it('holds the five conditions this story can observe, each with an ID the database accepts and who evaluates it', () => {
    expect(alarmConditions.map((condition) => [condition.id, condition.evaluatedBy])).toEqual([
      ['task-late', 'monitor'],
      ['ledger-pending', 'monitor'],
      ['identities-unaccounted', 'monitor'],
      ['heartbeat-stale', 'monitor'],
      ['qstash-stale', 'heartbeat'],
    ]);
    expect(new Set(alarmConditions.map((condition) => condition.id)).size).toBe(alarmConditions.length);
    for (const condition of alarmConditions) expect(condition.id).toMatch(/^[a-z][a-z0-9-]{0,47}$/);
  });

  it('states its thresholds once: twice the interval, 15 minutes, 25 identities, two hours', () => {
    expect([lateFactor, ledgerPendingSeconds, unaccountedLimit, schedulerStaleSeconds]).toEqual([2, 900, 25, 7200]);
  });

  it('finds nothing when nothing is wrong', () => {
    for (const condition of alarmConditions) expect(condition.evaluate(calm(), scheduleRegistry), condition.id).toEqual([]);
  });

  it('produces details the database accepts (flat, whole numbers, booleans and short printable text) in every finding it can make', () => {
    const trouble = calm({
      firstReceiptAge: 100_000,
      latestReceiptAge: 9_000,
      latestHeartbeatAge: 9_000,
      ledgerWaiting: 4,
      ledgerOldest: 2_000,
      unaccounted: 40,
      tasks: [],
    });
    const findings = alarmConditions.flatMap((condition) => condition.evaluate(trouble, scheduleRegistry).map((finding) => ({condition: condition.id, ...finding})));
    // task-late for the two tasks older than twice their interval, then one finding for each of the four other conditions.
    expect(findings).toHaveLength(6);
    for (const finding of findings) {
      expect(isAlarmDetail(finding.detail), `${finding.condition}: ${JSON.stringify(finding.detail)}`).toBe(true);
      if (finding.subject !== null) expect(finding.subject).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    }
  });
});

describe('task-late', () => {
  it('is subject-keyed by the task, and raises for a task whose latest finished receipt is older than twice its interval', () => {
    // ledger-relay fires every 300 s: 601 s is late, 600 s is not.
    expect(taskLateCondition.evaluate(withReceipt(calm(), receipt('ledger-relay', 600)), scheduleRegistry)).toEqual([]);
    const late = taskLateCondition.evaluate(withReceipt(calm(), {task: 'ledger-relay', outcome: 'ran', at: AT, age: 601}), scheduleRegistry);
    expect(late).toEqual([{subject: 'ledger-relay', detail: {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: AT, age_seconds: 601}}]);
  });

  it('names the last receipt: its task, its outcome (a failed run too) and when it finished', () => {
    const findings = taskLateCondition.evaluate(withReceipt(calm(), {task: 'staging-cleanup', outcome: 'failed', at: '2026-10-17T01:02:03.004Z', age: 7201}), scheduleRegistry);
    expect(findings).toEqual([{subject: 'staging-cleanup', detail: {receipt_task: 'staging-cleanup', receipt_outcome: 'failed', receipt_at: '2026-10-17T01:02:03.004Z', age_seconds: 7201}}]);
  });

  it('uses each task\'s own interval: the daily purge is late after two days, the hourly cleanup after two hours', () => {
    expect(taskLateCondition.evaluate(withReceipt(calm(), receipt('dormant-identity-purge', 172_800)), scheduleRegistry)).toEqual([]);
    expect(taskLateCondition.evaluate(withReceipt(calm(), receipt('dormant-identity-purge', 172_801)), scheduleRegistry).map((finding) => finding.subject)).toEqual(['dormant-identity-purge']);
    expect(taskLateCondition.evaluate(withReceipt(calm(), receipt('staging-cleanup', 7200)), scheduleRegistry)).toEqual([]);
    expect(taskLateCondition.evaluate(withReceipt(calm(), receipt('staging-cleanup', 7201)), scheduleRegistry).map((finding) => finding.subject)).toEqual(['staging-cleanup']);
  });

  it('measures a task that never finished a run from the first receipt of any task, and says `never`', () => {
    const never = without(calm({firstReceiptAge: 601}), 'ledger-relay');
    expect(taskLateCondition.evaluate(never, scheduleRegistry)).toEqual([
      {subject: 'ledger-relay', detail: {receipt_task: 'ledger-relay', receipt_outcome: 'never', receipt_at: 'never', age_seconds: 601}},
    ]);
    // Not late until the scheduler has been running for longer than twice its interval.
    expect(taskLateCondition.evaluate(without(calm({firstReceiptAge: 600}), 'ledger-relay'), scheduleRegistry)).toEqual([]);
    // No receipt of any task at all: there is nothing to measure from, so nothing is late yet.
    expect(taskLateCondition.evaluate({...calm({firstReceiptAge: null, latestReceiptAge: null}), tasks: []}, scheduleRegistry)).toEqual([]);
  });

  it('leaves the monitor out: it is what evaluates this, so it cannot report on itself', () => {
    const silent = calm({firstReceiptAge: 1_000_000});
    const findings = taskLateCondition.evaluate({...silent, tasks: []}, scheduleRegistry);
    expect(findings.map((finding) => finding.subject)).toEqual(['dormant-identity-purge', 'ledger-relay', 'staging-cleanup']);
    expect(findings.map((finding) => finding.subject)).not.toContain('alarm-monitor');
  });

  it('reads the schedules it is given (a later story\'s task is covered by its registry entry alone)', () => {
    const registry = [{task: 'outbox-sweep', intervalSeconds: 60}];
    expect(taskLateCondition.evaluate({...calm(), tasks: [receipt('outbox-sweep', 121)]}, registry).map((finding) => finding.subject)).toEqual(['outbox-sweep']);
    expect(taskLateCondition.evaluate({...calm(), tasks: [receipt('outbox-sweep', 120)]}, registry)).toEqual([]);
  });

  it('ignores a receipt of a task that is not in the registry', () => {
    expect(taskLateCondition.evaluate(withReceipt(calm(), receipt('retired-task', 999_999)), scheduleRegistry)).toEqual([]);
  });
});

describe('ledger-pending', () => {
  it('is a threshold condition: the oldest pending event over 900 seconds old raises it, with the count, the age and the relay\'s last receipt', () => {
    const observations = withReceipt(calm({ledgerWaiting: 3, ledgerOldest: 901}), {task: 'ledger-relay', outcome: 'ran', at: AT, age: 120});
    expect(ledgerPendingCondition.evaluate(observations, scheduleRegistry)).toEqual([
      {subject: null, detail: {pending: 3, oldest_seconds: 901, receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: AT}},
    ]);
  });

  it('is quiet at exactly 900 seconds, and with nothing pending', () => {
    expect(ledgerPendingCondition.evaluate(calm({ledgerWaiting: 3, ledgerOldest: 900}), scheduleRegistry)).toEqual([]);
    expect(ledgerPendingCondition.evaluate(calm({ledgerWaiting: 0, ledgerOldest: null}), scheduleRegistry)).toEqual([]);
  });

  it('is silent while the relay\'s latest finished receipt is `no_store`: with no store the events can never be relayed', () => {
    const observations = withReceipt(calm({ledgerWaiting: 134, ledgerOldest: 50_000}), receipt('ledger-relay', 100, 'no_store'));
    expect(ledgerPendingCondition.evaluate(observations, scheduleRegistry)).toEqual([]);
    // ... and speaks again the moment the relay reports anything else.
    expect(ledgerPendingCondition.evaluate(withReceipt(observations, receipt('ledger-relay', 100, 'failed')), scheduleRegistry)).toHaveLength(1);
  });

  it('names a relay that never finished a run with `never`', () => {
    const observations = without(calm({ledgerWaiting: 1, ledgerOldest: 5_000}), 'ledger-relay');
    expect(ledgerPendingCondition.evaluate(observations, scheduleRegistry)).toEqual([
      {subject: null, detail: {pending: 1, oldest_seconds: 5_000, receipt_task: 'ledger-relay', receipt_outcome: 'never', receipt_at: 'never'}},
    ]);
  });
});

describe('identities-unaccounted', () => {
  it('raises for more than 25 Auth identities with no Account, and for 25 or fewer does not', () => {
    expect(identitiesUnaccountedCondition.evaluate(calm({unaccounted: 26}), scheduleRegistry)).toEqual([{subject: null, detail: {count: 26}}]);
    expect(identitiesUnaccountedCondition.evaluate(calm({unaccounted: 25}), scheduleRegistry)).toEqual([]);
    expect(identitiesUnaccountedCondition.evaluate(calm({unaccounted: 0}), scheduleRegistry)).toEqual([]);
  });
});

describe('heartbeat-stale (evaluated by the monitor, on QStash)', () => {
  it('does not exist without the heartbeat configured', () => {
    expect(heartbeatStaleCondition.evaluate(calm({heartbeatConfigured: false, latestHeartbeatAge: 99_999, firstReceiptAge: 99_999}), scheduleRegistry)).toEqual([]);
  });

  it('raises when the latest heartbeat is older than two hours, not at exactly two hours', () => {
    expect(heartbeatStaleCondition.evaluate(calm({latestHeartbeatAge: 7201}), scheduleRegistry)).toEqual([{subject: null, detail: {age_seconds: 7201, heartbeat: 'stale'}}]);
    expect(heartbeatStaleCondition.evaluate(calm({latestHeartbeatAge: 7200}), scheduleRegistry)).toEqual([]);
  });

  it('raises when there is no heartbeat at all while the first receipt of any task is older than two hours', () => {
    expect(heartbeatStaleCondition.evaluate(calm({latestHeartbeatAge: null, firstHeartbeatAge: null, firstReceiptAge: 7201}), scheduleRegistry)).toEqual([{subject: null, detail: {age_seconds: 7201, heartbeat: 'none'}}]);
    expect(heartbeatStaleCondition.evaluate(calm({latestHeartbeatAge: null, firstHeartbeatAge: null, firstReceiptAge: 7200}), scheduleRegistry)).toEqual([]);
    // Nothing has run at all: nothing has been waiting for a heartbeat.
    expect(heartbeatStaleCondition.evaluate(calm({latestHeartbeatAge: null, firstHeartbeatAge: null, firstReceiptAge: null}), scheduleRegistry)).toEqual([]);
  });
});

describe('qstash-stale (evaluated by the application when the Railway heartbeat arrives)', () => {
  it('raises when the latest receipt of any scheduler task is older than two hours, not at exactly two hours', () => {
    expect(qstashStaleCondition.evaluate(calm({latestReceiptAge: 7201}), scheduleRegistry)).toEqual([{subject: null, detail: {age_seconds: 7201, receipts: 'stale'}}]);
    expect(qstashStaleCondition.evaluate(calm({latestReceiptAge: 7200}), scheduleRegistry)).toEqual([]);
  });

  it('raises when there is no receipt at all while the first heartbeat is older than two hours', () => {
    expect(qstashStaleCondition.evaluate(calm({latestReceiptAge: null, firstReceiptAge: null, firstHeartbeatAge: 7201}), scheduleRegistry)).toEqual([{subject: null, detail: {age_seconds: 7201, receipts: 'none'}}]);
    expect(qstashStaleCondition.evaluate(calm({latestReceiptAge: null, firstReceiptAge: null, firstHeartbeatAge: 7200}), scheduleRegistry)).toEqual([]);
    expect(qstashStaleCondition.evaluate(calm({latestReceiptAge: null, firstReceiptAge: null, firstHeartbeatAge: null}), scheduleRegistry)).toEqual([]);
  });

  it('does not need the heartbeat to be configured: it is evaluated only when a heartbeat has arrived', () => {
    expect(qstashStaleCondition.evaluate(calm({heartbeatConfigured: false, latestReceiptAge: 9_000}), scheduleRegistry)).toHaveLength(1);
  });
});

describe('evaluateConditions', () => {
  const fixture: AlarmCondition = {id: 'fixture-threshold', evaluatedBy: 'monitor', evaluate: (observations) => (observations.unaccounted > 1 ? [{subject: null, detail: {count: observations.unaccounted}}] : [])};
  const pushedByHeartbeat: AlarmCondition = {id: 'fixture-heartbeat', evaluatedBy: 'heartbeat', evaluate: () => [{subject: 'x', detail: {}}]};

  it('evaluates only the conditions one evaluator owns', () => {
    const conditions = [...alarmConditions, fixture, pushedByHeartbeat];
    expect(evaluateConditions(conditions, 'monitor', calm(), scheduleRegistry).map((one) => one.id)).toEqual(['task-late', 'ledger-pending', 'identities-unaccounted', 'heartbeat-stale', 'fixture-threshold']);
    expect(evaluateConditions(conditions, 'heartbeat', calm(), scheduleRegistry).map((one) => one.id)).toEqual(['qstash-stale', 'fixture-heartbeat']);
  });

  it('lets a later story add a condition by adding an entry: a fixture condition is evaluated like the rest', () => {
    const found = evaluateConditions([fixture], 'monitor', calm({unaccounted: 5}), scheduleRegistry);
    expect(found).toEqual([{id: 'fixture-threshold', findings: [{subject: null, detail: {count: 5}}]}]);
  });

  it('reports a condition that throws as not evaluated (`null` findings and its failure), and still evaluates the others: "could not look" is never "found nothing"', () => {
    const broken: AlarmCondition = {
      id: 'broken',
      evaluatedBy: 'monitor',
      evaluate() {
        throw new RangeError('a bug in the condition');
      },
    };
    const found = evaluateConditions([broken, fixture], 'monitor', calm({unaccounted: 5}), scheduleRegistry);
    expect(found[0]).toMatchObject({id: 'broken', findings: null});
    expect(found[0].failure).toBeInstanceOf(RangeError);
    expect(found[1]).toEqual({id: 'fixture-threshold', findings: [{subject: null, detail: {count: 5}}]});
  });
});

describe('alarmKey', () => {
  it('keys an alarm by condition and subject; no subject is a key of its own (a real subject is never empty)', () => {
    expect(alarmKey('task-late', 'ledger-relay')).not.toBe(alarmKey('task-late', 'staging-cleanup'));
    expect(alarmKey('task-late', null)).not.toBe(alarmKey('task-late', 'ledger-relay'));
    expect(alarmKey('a', 'b')).not.toBe(alarmKey('a\nb', null));
    expect(alarmKey('task-late', 'ledger-relay')).toBe(alarmKey('task-late', 'ledger-relay'));
  });
});
