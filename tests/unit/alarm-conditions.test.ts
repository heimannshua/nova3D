import {describe, expect, it} from 'vitest';
import {
  alarmConditions,
  alarmKey,
  evaluateConditions,
  heartbeatStaleCondition,
  identitiesUnaccountedCondition,
  lateFactor,
  ledgerPendingCondition,
  monitorLateCondition,
  ledgerPendingSeconds,
  qstashStaleCondition,
  schedulerStaleSeconds,
  taskLateCondition,
  unaccountedLimit,
  unobservable,
  type AlarmCondition,
  type Finding,
  type ScheduleLike,
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
/** The findings of a condition that is observable (a test of what it does not find uses `toEqual([])`; one of what it cannot observe checks for `unobservable`). */
const found = (condition: AlarmCondition, observations: Observations, registry: readonly ScheduleLike[] = scheduleRegistry): Finding[] => {
  const answer = condition.evaluate(observations, registry);
  if (answer === unobservable) throw new Error(`${condition.id} is unobservable`);
  return answer;
};
const without = (observations: Observations, task: string): Observations => ({...observations, tasks: observations.tasks.filter((candidate) => candidate.task !== task)});
const withReceipt = (observations: Observations, replacement: TaskReceipt): Observations => ({...observations, tasks: [...observations.tasks.filter((candidate) => candidate.task !== replacement.task), replacement]});

describe('the registry', () => {
  it('holds the six conditions this story can observe, each with an ID the database accepts and who evaluates it', () => {
    expect(alarmConditions.map((condition) => [condition.id, condition.evaluatedBy])).toEqual([
      ['task-late', 'monitor'],
      ['ledger-pending', 'monitor'],
      ['identities-unaccounted', 'monitor'],
      ['heartbeat-stale', 'monitor'],
      ['qstash-stale', 'heartbeat'],
      ['monitor-late', 'heartbeat'],
    ]);
    expect(new Set(alarmConditions.map((condition) => condition.id)).size).toBe(alarmConditions.length);
    for (const condition of alarmConditions) expect(condition.id).toMatch(/^[a-z][a-z0-9-]{0,47}$/);
  });

  it('states its thresholds once: twice the interval, 15 minutes, 25 identities, two hours', () => {
    expect([lateFactor, ledgerPendingSeconds, unaccountedLimit, schedulerStaleSeconds]).toEqual([2, 900, 25, 7200]);
  });

  it('finds nothing when nothing is wrong', () => {
    for (const condition of alarmConditions) expect(condition.evaluate(calm(), scheduleRegistry), condition.id).toEqual([]);
    // (With nothing configured, the two conditions that need a precondition cannot be observed rather than clear.)
    expect(heartbeatStaleCondition.evaluate(calm({heartbeatConfigured: false}), scheduleRegistry)).toBe('unobservable');
    expect(ledgerPendingCondition.evaluate(withReceipt(calm(), receipt('ledger-relay', 60, 'no_store')), scheduleRegistry)).toBe('unobservable');
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
    const findings = alarmConditions.flatMap((condition) => found(condition, trouble).map((finding) => ({condition: condition.id, ...finding})));
    // task-late for the two tasks older than twice their interval, then one finding for each of the five other conditions.
    expect(findings).toHaveLength(7);
    for (const finding of findings) {
      expect(isAlarmDetail(finding.detail), `${finding.condition}: ${JSON.stringify(finding.detail)}`).toBe(true);
      if (finding.subject !== null) expect(finding.subject).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    }
  });
});

describe('task-late', () => {
  it('is subject-keyed by the task, and raises for a task whose latest finished receipt is older than twice its interval', () => {
    // ledger-relay fires every 300 s: 601 s is late, 600 s is not.
    expect(found(taskLateCondition, withReceipt(calm(), receipt('ledger-relay', 600)), scheduleRegistry)).toEqual([]);
    const late = found(taskLateCondition, withReceipt(calm(), {task: 'ledger-relay', outcome: 'ran', at: AT, age: 601}), scheduleRegistry);
    expect(late).toEqual([{subject: 'ledger-relay', detail: {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: AT, age_seconds: 601}}]);
  });

  it('names the last receipt: its task, its outcome (a failed run too) and when it finished', () => {
    const findings = found(taskLateCondition, withReceipt(calm(), {task: 'staging-cleanup', outcome: 'failed', at: '2026-10-17T01:02:03.004Z', age: 7201}), scheduleRegistry);
    expect(findings).toEqual([{subject: 'staging-cleanup', detail: {receipt_task: 'staging-cleanup', receipt_outcome: 'failed', receipt_at: '2026-10-17T01:02:03.004Z', age_seconds: 7201}}]);
  });

  it('uses each task\'s own interval: the daily purge is late after two days, the hourly cleanup after two hours', () => {
    expect(found(taskLateCondition, withReceipt(calm(), receipt('dormant-identity-purge', 172_800)), scheduleRegistry)).toEqual([]);
    expect(found(taskLateCondition, withReceipt(calm(), receipt('dormant-identity-purge', 172_801)), scheduleRegistry).map((finding) => finding.subject)).toEqual(['dormant-identity-purge']);
    expect(found(taskLateCondition, withReceipt(calm(), receipt('staging-cleanup', 7200)), scheduleRegistry)).toEqual([]);
    expect(found(taskLateCondition, withReceipt(calm(), receipt('staging-cleanup', 7201)), scheduleRegistry).map((finding) => finding.subject)).toEqual(['staging-cleanup']);
  });

  it('measures a task that never finished a run from the first receipt of any task, and says `never`', () => {
    const never = without(calm({firstReceiptAge: 601}), 'ledger-relay');
    expect(found(taskLateCondition, never, scheduleRegistry)).toEqual([
      {subject: 'ledger-relay', detail: {receipt_task: 'ledger-relay', receipt_outcome: 'never', receipt_at: 'never', age_seconds: 601}},
    ]);
    // Not late until the scheduler has been running for longer than twice its interval.
    expect(found(taskLateCondition, without(calm({firstReceiptAge: 600}), 'ledger-relay'), scheduleRegistry)).toEqual([]);
    // No receipt of any task at all: there is nothing to measure from, so nothing is late yet.
    expect(found(taskLateCondition, {...calm({firstReceiptAge: null, latestReceiptAge: null}), tasks: []}, scheduleRegistry)).toEqual([]);
  });

  it('leaves the monitor out: it is what evaluates this, so it cannot report on itself', () => {
    const silent = calm({firstReceiptAge: 1_000_000});
    const findings = found(taskLateCondition, {...silent, tasks: []}, scheduleRegistry);
    expect(findings.map((finding) => finding.subject)).toEqual(['dormant-identity-purge', 'ledger-relay', 'staging-cleanup']);
    expect(findings.map((finding) => finding.subject)).not.toContain('alarm-monitor');
  });

  it('reads the schedules it is given (a later story\'s task is covered by its registry entry alone)', () => {
    const registry = [{task: 'outbox-sweep', intervalSeconds: 60}];
    expect(found(taskLateCondition, {...calm(), tasks: [receipt('outbox-sweep', 121)]}, registry).map((finding) => finding.subject)).toEqual(['outbox-sweep']);
    expect(found(taskLateCondition, {...calm(), tasks: [receipt('outbox-sweep', 120)]}, registry)).toEqual([]);
  });

  it('ignores a receipt of a task that is not in the registry', () => {
    expect(found(taskLateCondition, withReceipt(calm(), receipt('retired-task', 999_999)), scheduleRegistry)).toEqual([]);
  });
});

describe('ledger-pending', () => {
  it('is a threshold condition: the oldest pending event over 900 seconds old raises it, with the count, the age and the relay\'s last receipt', () => {
    const observations = withReceipt(calm({ledgerWaiting: 3, ledgerOldest: 901}), {task: 'ledger-relay', outcome: 'ran', at: AT, age: 120});
    expect(found(ledgerPendingCondition, observations, scheduleRegistry)).toEqual([
      {subject: null, detail: {pending: 3, oldest_seconds: 901, receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: AT}},
    ]);
  });

  it('is quiet at exactly 900 seconds, and with nothing pending', () => {
    expect(found(ledgerPendingCondition, calm({ledgerWaiting: 3, ledgerOldest: 900}), scheduleRegistry)).toEqual([]);
    expect(found(ledgerPendingCondition, calm({ledgerWaiting: 0, ledgerOldest: null}), scheduleRegistry)).toEqual([]);
  });

  // CHANGED (F4): this used to expect `[]` (no finding, so the runner RESOLVED an open alarm). With no store the backlog cannot be observed, so the answer is
  // `'unobservable'`: nothing is raised and nothing is resolved, and an alarm that is already open stays open until the relay can relay again.
  it('is UNOBSERVABLE while the relay\'s latest finished receipt is `no_store`: with no store the events can never be relayed, so no alarm opens and an open one stays', () => {
    const observations = withReceipt(calm({ledgerWaiting: 134, ledgerOldest: 50_000}), receipt('ledger-relay', 100, 'no_store'));
    expect(ledgerPendingCondition.evaluate(observations, scheduleRegistry)).toBe(unobservable);
    // ... also when nothing is pending: the relay's receipt is what makes it unobservable, not the backlog.
    expect(ledgerPendingCondition.evaluate(withReceipt(calm(), receipt('ledger-relay', 100, 'no_store')), scheduleRegistry)).toBe('unobservable');
    // ... and it is observed again the moment the relay reports anything else: found when the backlog is old, clear when it is not.
    expect(found(ledgerPendingCondition, withReceipt(observations, receipt('ledger-relay', 100, 'failed')), scheduleRegistry)).toHaveLength(1);
    expect(found(ledgerPendingCondition, withReceipt(calm({ledgerWaiting: 0, ledgerOldest: null}), receipt('ledger-relay', 100, 'ran')), scheduleRegistry)).toEqual([]);
  });

  it('names a relay that never finished a run with `never`', () => {
    const observations = without(calm({ledgerWaiting: 1, ledgerOldest: 5_000}), 'ledger-relay');
    expect(found(ledgerPendingCondition, observations, scheduleRegistry)).toEqual([
      {subject: null, detail: {pending: 1, oldest_seconds: 5_000, receipt_task: 'ledger-relay', receipt_outcome: 'never', receipt_at: 'never'}},
    ]);
  });
});

describe('identities-unaccounted', () => {
  it('raises for more than 25 Auth identities with no Account, and for 25 or fewer does not', () => {
    expect(found(identitiesUnaccountedCondition, calm({unaccounted: 26}), scheduleRegistry)).toEqual([{subject: null, detail: {count: 26}}]);
    expect(found(identitiesUnaccountedCondition, calm({unaccounted: 25}), scheduleRegistry)).toEqual([]);
    expect(found(identitiesUnaccountedCondition, calm({unaccounted: 0}), scheduleRegistry)).toEqual([]);
  });
});

describe('heartbeat-stale (evaluated by the monitor, on QStash)', () => {
  // CHANGED (F4): this used to expect `[]` ("no such condition", so the runner RESOLVED an open alarm). Without `SERVICE_KEYS_HEARTBEAT` there is nothing to observe, so
  // the answer is `'unobservable'` whatever the ages are: nothing is raised, nothing is resolved, and an alarm already open stays open.
  it('is UNOBSERVABLE without the heartbeat configured, whatever the ages are: no alarm opens, and an open one stays', () => {
    expect(heartbeatStaleCondition.evaluate(calm({heartbeatConfigured: false, latestHeartbeatAge: 99_999, firstReceiptAge: 99_999}), scheduleRegistry)).toBe(unobservable);
    expect(heartbeatStaleCondition.evaluate(calm({heartbeatConfigured: false, latestHeartbeatAge: 5}), scheduleRegistry)).toBe('unobservable');
    expect(heartbeatStaleCondition.evaluate(calm({heartbeatConfigured: false, latestHeartbeatAge: null, firstReceiptAge: null}), scheduleRegistry)).toBe('unobservable');
  });

  it('raises when the latest heartbeat is older than two hours, not at exactly two hours', () => {
    expect(found(heartbeatStaleCondition, calm({latestHeartbeatAge: 7201}), scheduleRegistry)).toEqual([{subject: null, detail: {age_seconds: 7201, heartbeat: 'stale'}}]);
    expect(found(heartbeatStaleCondition, calm({latestHeartbeatAge: 7200}), scheduleRegistry)).toEqual([]);
  });

  it('raises when there is no heartbeat at all while the first receipt of any task is older than two hours', () => {
    expect(found(heartbeatStaleCondition, calm({latestHeartbeatAge: null, firstHeartbeatAge: null, firstReceiptAge: 7201}), scheduleRegistry)).toEqual([{subject: null, detail: {age_seconds: 7201, heartbeat: 'none'}}]);
    expect(found(heartbeatStaleCondition, calm({latestHeartbeatAge: null, firstHeartbeatAge: null, firstReceiptAge: 7200}), scheduleRegistry)).toEqual([]);
    // Nothing has run at all: nothing has been waiting for a heartbeat.
    expect(found(heartbeatStaleCondition, calm({latestHeartbeatAge: null, firstHeartbeatAge: null, firstReceiptAge: null}), scheduleRegistry)).toEqual([]);
  });
});

describe('qstash-stale (evaluated by the application when the Railway heartbeat arrives)', () => {
  it('raises when the latest receipt of any scheduler task is older than two hours, not at exactly two hours', () => {
    expect(found(qstashStaleCondition, calm({latestReceiptAge: 7201}), scheduleRegistry)).toEqual([{subject: null, detail: {age_seconds: 7201, receipts: 'stale'}}]);
    expect(found(qstashStaleCondition, calm({latestReceiptAge: 7200}), scheduleRegistry)).toEqual([]);
  });

  it('raises when there is no receipt at all while the first heartbeat is older than two hours', () => {
    expect(found(qstashStaleCondition, calm({latestReceiptAge: null, firstReceiptAge: null, firstHeartbeatAge: 7201}), scheduleRegistry)).toEqual([{subject: null, detail: {age_seconds: 7201, receipts: 'none'}}]);
    expect(found(qstashStaleCondition, calm({latestReceiptAge: null, firstReceiptAge: null, firstHeartbeatAge: 7200}), scheduleRegistry)).toEqual([]);
    expect(found(qstashStaleCondition, calm({latestReceiptAge: null, firstReceiptAge: null, firstHeartbeatAge: null}), scheduleRegistry)).toEqual([]);
  });

  it('does not need the heartbeat to be configured: it is evaluated only when a heartbeat has arrived', () => {
    expect(found(qstashStaleCondition, calm({heartbeatConfigured: false, latestReceiptAge: 9_000}), scheduleRegistry)).toHaveLength(1);
  });
});

describe('monitor-late (evaluated by the application when the Railway heartbeat arrives, because the monitor cannot see itself stop)', () => {
  const monitor = (age: number, outcome: TaskReceipt['outcome'] = 'ran'): TaskReceipt => ({task: 'alarm-monitor', outcome, at: AT, age});

  it('is a threshold condition of the heartbeat, with no subject, and raises when the latest finished monitor receipt is older than 600 seconds (twice its interval), not at exactly 600', () => {
    expect(monitorLateCondition.evaluatedBy).toBe('heartbeat');
    expect(lateFactor * scheduleRegistry.find((entry) => entry.task === 'alarm-monitor')!.intervalSeconds).toBe(600);
    expect(found(monitorLateCondition, withReceipt(calm(), monitor(600)))).toEqual([]);
    expect(found(monitorLateCondition, withReceipt(calm(), monitor(601)))).toEqual([
      {subject: null, detail: {receipt_task: 'alarm-monitor', receipt_outcome: 'ran', receipt_at: AT, age_seconds: 601}},
    ]);
    // A run that finished `failed` is still a run: lateness is about it not running.
    expect(found(monitorLateCondition, withReceipt(calm(), monitor(60, 'failed')))).toEqual([]);
    expect(found(monitorLateCondition, withReceipt(calm(), monitor(9_999, 'failed')))[0].detail).toMatchObject({receipt_outcome: 'failed', age_seconds: 9_999});
  });

  it('resolves, that is finds nothing, when a fresh monitor receipt exists', () => {
    expect(found(monitorLateCondition, withReceipt(calm({firstReceiptAge: 1_000_000}), monitor(30)))).toEqual([]);
    expect(found(monitorLateCondition, calm())).toEqual([]);
  });

  it('raises when the monitor has no finished receipt while the first receipt of any task is older than 600 seconds, naming `never`', () => {
    const none = without(calm({firstReceiptAge: 601}), 'alarm-monitor');
    expect(found(monitorLateCondition, none)).toEqual([
      {subject: null, detail: {receipt_task: 'alarm-monitor', receipt_outcome: 'never', receipt_at: 'never', age_seconds: 601}},
    ]);
    expect(found(monitorLateCondition, without(calm({firstReceiptAge: 100_000}), 'alarm-monitor'))[0].detail).toMatchObject({age_seconds: 100_000});
  });

  it('does not raise when it has none but the scheduler has only just begun (the first receipt of any task is young), or nothing has run at all', () => {
    expect(found(monitorLateCondition, without(calm({firstReceiptAge: 600}), 'alarm-monitor'))).toEqual([]);
    expect(found(monitorLateCondition, without(calm({firstReceiptAge: 5}), 'alarm-monitor'))).toEqual([]);
    expect(found(monitorLateCondition, {...calm({firstReceiptAge: null, latestReceiptAge: null}), tasks: []})).toEqual([]);
  });

  it('reads the interval from the schedules it is given, and 300 seconds when they do not name the monitor', () => {
    expect(found(monitorLateCondition, withReceipt(calm(), monitor(1_000)), [{task: 'alarm-monitor', intervalSeconds: 600}])).toEqual([]);
    expect(found(monitorLateCondition, withReceipt(calm(), monitor(1_201)), [{task: 'alarm-monitor', intervalSeconds: 600}])).toHaveLength(1);
    expect(found(monitorLateCondition, withReceipt(calm(), monitor(601)), [])).toHaveLength(1);
    expect(found(monitorLateCondition, withReceipt(calm(), monitor(600)), [])).toEqual([]);
  });

  it('is what task-late leaves out: the other tasks late and the monitor late are different alarms', () => {
    const stopped = without(withReceipt(calm({firstReceiptAge: 100_000}), monitor(5_000)), 'ledger-relay');
    expect(found(taskLateCondition, stopped).map((finding) => finding.subject)).toEqual(['ledger-relay']);
    expect(found(monitorLateCondition, stopped)).toHaveLength(1);
  });
});

describe('unobservable', () => {
  it('is the answer of exactly the two conditions that have a precondition, and of no other, whatever the observations', () => {
    const states = [calm(), calm({heartbeatConfigured: false}), withReceipt(calm(), receipt('ledger-relay', 10, 'no_store')), calm({firstReceiptAge: 1_000_000, latestReceiptAge: 9_999, unaccounted: 99, ledgerWaiting: 9, ledgerOldest: 9_999})];
    const unobservableBy = new Set<string>();
    for (const observations of states) for (const condition of alarmConditions) if (condition.evaluate(observations, scheduleRegistry) === 'unobservable') unobservableBy.add(condition.id);
    expect([...unobservableBy].sort()).toEqual(['heartbeat-stale', 'ledger-pending']);
  });

  it('is carried by evaluateConditions as it is: not as findings, not as a failure', () => {
    const states = evaluateConditions(alarmConditions, 'monitor', calm({heartbeatConfigured: false}), scheduleRegistry);
    expect(states.find((one) => one.id === 'heartbeat-stale')).toEqual({id: 'heartbeat-stale', findings: 'unobservable'});
    expect(states.find((one) => one.id === 'task-late')).toEqual({id: 'task-late', findings: []});
  });
});

describe('evaluateConditions', () => {
  const fixture: AlarmCondition = {id: 'fixture-threshold', evaluatedBy: 'monitor', evaluate: (observations) => (observations.unaccounted > 1 ? [{subject: null, detail: {count: observations.unaccounted}}] : [])};
  const pushedByHeartbeat: AlarmCondition = {id: 'fixture-heartbeat', evaluatedBy: 'heartbeat', evaluate: () => [{subject: 'x', detail: {}}]};

  it('evaluates only the conditions one evaluator owns', () => {
    const conditions = [...alarmConditions, fixture, pushedByHeartbeat];
    expect(evaluateConditions(conditions, 'monitor', calm(), scheduleRegistry).map((one) => one.id)).toEqual(['task-late', 'ledger-pending', 'identities-unaccounted', 'heartbeat-stale', 'fixture-threshold']);
    expect(evaluateConditions(conditions, 'heartbeat', calm(), scheduleRegistry).map((one) => one.id)).toEqual(['qstash-stale', 'monitor-late', 'fixture-heartbeat']);
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
