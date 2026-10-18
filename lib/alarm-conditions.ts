// Story 1.13. The registry of alarm conditions: what the monitor (lib/alarms.ts) and the heartbeat route (lib/heartbeat.ts) look for, as pure data and
// pure functions. This file imports nothing but the schedule registry (a plain list) and reads no clock, no database and no environment variable: the
// database reports every age in SECONDS on its own clock (lifecycle.ts `alarmObservations`), so the application never compares its clock with the
// database's, and a test feeds a condition the observations as data.
//
// A CONDITION is `{id, evaluatedBy, evaluate(observations, registry) -> findings | 'unobservable'}`. A finding is `{subject, detail}`: the subject names what the
// alarm is about (a task) or is null for a THRESHOLD condition, which has one alarm at a time; the detail is a flat object of whole numbers,
// booleans and short text (lib/lifecycle.ts `isAlarmDetail`). `'unobservable'` means a precondition of the condition is missing NOW (the relay has no store to write
// to, the heartbeat is not configured): the evaluator then raises nothing AND resolves nothing for that condition, so an alarm that is already open stays open until
// the condition can be observed again and is found clear. (An outage must not close the alarm it raised by removing the thing that raised it.) `evaluatedBy` says which side evaluates it:
//   monitor    the `alarm-monitor` task on the QStash scheduler (lib/alarms.ts `runAlarmMonitor`)
//   heartbeat  the application, when the Railway cron task's signed heartbeat arrives (lib/heartbeat.ts), so each scheduler has one observer on the other
//              platform: the monitor runs on QStash and so cannot see QStash stop, and it cannot see ITSELF stop either (`monitor-late`)
// The evaluator raises each finding and resolves every open alarm of one of ITS conditions whose (condition, subject) is no longer found. A later story
// adds a condition by adding an entry to `alarmConditions` and nothing else (a condition whose subject-keyed alarms are PUSHED, such as a payment
// exception, raises through lib/alarms.ts `raiseAlarm` and has no entry here: nothing evaluates it, so nothing resolves it by absence).
//
// The conditions of the other stories (outbox age and expired leases 2.7, unknown cost 2.8, storage integrity 4.1, missed purge 8.3, backup snapshot
// age 8.9, payment exceptions) are theirs to add; this story registers the six it can observe.
//
// Erasable TypeScript syntax and relative `.ts` imports, like the modules it serves.
import {monitorTask} from './schedules.ts';

/** An alarm's detail: a flat object of whole numbers, booleans and strings of at most 80 printable ASCII characters (at most 1 KB in all). */
export type AlarmDetail = Record<string, number | boolean | string>;

/** A task's newest finished receipt: its outcome, when it finished (UTC text) and how long ago, in seconds. */
export type TaskReceipt = {task: string; outcome: 'ran' | 'idle' | 'no_store' | 'failed'; at: string; age: number};

/**
 * Everything a condition looks at. The ages are in seconds, on the database's clock; `null` is "never". `tasks` holds the newest FINISHED receipt of each
 * task that has finished a run.
 */
export type Observations = {
  /** The first, and the latest, receipt of any task (claimed, finished or not). */
  firstReceiptAge: number | null;
  latestReceiptAge: number | null;
  /** The first, and the latest, heartbeat of the Railway cron task. */
  firstHeartbeatAge: number | null;
  latestHeartbeatAge: number | null;
  /** How many ledger events wait for the relay, and the age of the oldest (null when none). */
  ledgerWaiting: number;
  ledgerOldest: number | null;
  /** How many Auth identities have no Account. */
  unaccounted: number;
  tasks: TaskReceipt[];
  /** Whether the Railway heartbeat is configured for this deployment (`SERVICE_KEYS_HEARTBEAT` is set): without it there is no heartbeat to be late. */
  heartbeatConfigured: boolean;
};

export type Finding = {subject: string | null; detail: AlarmDetail};

/** A schedule, as a condition reads it: the task and how often it fires, in seconds. lib/schedules.ts `scheduleRegistry` entries are these. */
export type ScheduleLike = {readonly task: string; readonly intervalSeconds: number};

/** What a condition answers when a precondition of it is missing now: it can be neither found nor found clear, so nothing is raised and nothing is resolved. */
export const unobservable = 'unobservable';
export type Unobservable = typeof unobservable;

export type AlarmCondition = {
  /** One lower-case word of letters, digits and hyphens (`^[a-z][a-z0-9-]{0,47}$`). */
  id: string;
  evaluatedBy: 'monitor' | 'heartbeat';
  evaluate(observations: Observations, registry: readonly ScheduleLike[]): Finding[] | Unobservable;
};

/** The interval, in seconds, of the monitor itself: the baseline of `monitor-late` when the registry handed to a test does not name it. */
const monitorIntervalSeconds = 300;

/** A task is late when its latest finished receipt is older than this many times its interval. */
export const lateFactor = 2;
/** A ledger event is stuck when the oldest pending one is older than this, in seconds (15 minutes). */
export const ledgerPendingSeconds = 900;
/** More Auth identities than this with no Account is an alarm. */
export const unaccountedLimit = 25;
/** A scheduler is stale when the other platform's latest receipt is older than this, in seconds (two hours). */
export const schedulerStaleSeconds = 7200;

/** The newest finished receipt of the relay and of a task, by name, as the detail's `receipt_*` keys name it: `never` when the task has no finished receipt. */
function receiptDetail(task: string, receipt: TaskReceipt | undefined): AlarmDetail {
  return receipt ? {receipt_task: task, receipt_outcome: receipt.outcome, receipt_at: receipt.at} : {receipt_task: task, receipt_outcome: 'never', receipt_at: 'never'};
}

/**
 * `task-late`: a periodic task whose latest finished receipt is older than twice its interval. Subject-keyed (the subject is the task): each late task is its
 * own alarm. A task that has never finished a run is measured from the first receipt of any task (the scheduler has been running that long). The monitor is
 * left out: it is what evaluates this, so it cannot report on itself.
 */
export const taskLateCondition: AlarmCondition = {
  id: 'task-late',
  evaluatedBy: 'monitor',
  evaluate(observations, registry) {
    const findings: Finding[] = [];
    for (const entry of registry) {
      if (entry.task === monitorTask) continue;
      const receipt = observations.tasks.find((candidate) => candidate.task === entry.task);
      const age = receipt ? receipt.age : observations.firstReceiptAge;
      if (age !== null && age > lateFactor * entry.intervalSeconds) {
        findings.push({subject: entry.task, detail: {...receiptDetail(entry.task, receipt), age_seconds: age}});
      }
    }
    return findings;
  },
};

/**
 * `ledger-pending`: ledger events pending whose oldest is over 15 minutes. A threshold condition. UNOBSERVABLE while the relay's latest finished receipt is
 * `no_store`: with no store the events can never be relayed, so no alarm opens for them (it would stay open for ever; the Backblaze adapter is Story 8.9's), and an
 * alarm that is already open stays open until the relay can relay again and the backlog is found clear.
 */
export const ledgerPendingCondition: AlarmCondition = {
  id: 'ledger-pending',
  evaluatedBy: 'monitor',
  evaluate(observations) {
    const relay = observations.tasks.find((candidate) => candidate.task === 'ledger-relay');
    if (relay?.outcome === 'no_store') return unobservable;
    if (observations.ledgerWaiting === 0 || observations.ledgerOldest === null || observations.ledgerOldest <= ledgerPendingSeconds) return [];
    return [{subject: null, detail: {pending: observations.ledgerWaiting, oldest_seconds: observations.ledgerOldest, ...receiptDetail('ledger-relay', relay)}}];
  },
};

/** `identities-unaccounted`: more than 25 Auth identities with no Account. A threshold condition. */
export const identitiesUnaccountedCondition: AlarmCondition = {
  id: 'identities-unaccounted',
  evaluatedBy: 'monitor',
  evaluate(observations) {
    return observations.unaccounted > unaccountedLimit ? [{subject: null, detail: {count: observations.unaccounted}}] : [];
  },
};

/**
 * `heartbeat-stale`: the Railway cron task has stopped. Evaluated by the monitor (on QStash): the latest heartbeat is older than two hours, or there is none
 * while the first receipt of any task is older than that. A threshold condition. UNOBSERVABLE when the heartbeat is not configured (`SERVICE_KEYS_HEARTBEAT` is
 * unset): no alarm opens, and one already open stays open (the operator who removed the heartbeat on purpose closes it with `api.resolve_alarm`).
 */
export const heartbeatStaleCondition: AlarmCondition = {
  id: 'heartbeat-stale',
  evaluatedBy: 'monitor',
  evaluate(observations) {
    if (!observations.heartbeatConfigured) return unobservable;
    if (observations.latestHeartbeatAge !== null) {
      return observations.latestHeartbeatAge > schedulerStaleSeconds ? [{subject: null, detail: {age_seconds: observations.latestHeartbeatAge, heartbeat: 'stale'}}] : [];
    }
    return observations.firstReceiptAge !== null && observations.firstReceiptAge > schedulerStaleSeconds
      ? [{subject: null, detail: {age_seconds: observations.firstReceiptAge, heartbeat: 'none'}}]
      : [];
  },
};

/**
 * `qstash-stale`: the QStash scheduler has stopped. Evaluated by the application when the Railway heartbeat arrives (the monitor runs on QStash and cannot
 * see it stop): the latest receipt of any scheduler task is older than two hours, or there is none while the first heartbeat is older than that. A threshold
 * condition.
 */
export const qstashStaleCondition: AlarmCondition = {
  id: 'qstash-stale',
  evaluatedBy: 'heartbeat',
  evaluate(observations) {
    if (observations.latestReceiptAge !== null) {
      return observations.latestReceiptAge > schedulerStaleSeconds ? [{subject: null, detail: {age_seconds: observations.latestReceiptAge, receipts: 'stale'}}] : [];
    }
    return observations.firstHeartbeatAge !== null && observations.firstHeartbeatAge > schedulerStaleSeconds
      ? [{subject: null, detail: {age_seconds: observations.firstHeartbeatAge, receipts: 'none'}}]
      : [];
  },
};

/**
 * `monitor-late`: the monitor has stopped, or its schedule was never made. The monitor runs on QStash and evaluates everything else, so it cannot see itself stop
 * (`task-late` leaves it out); the application therefore evaluates this one when the Railway heartbeat arrives: the latest finished `alarm-monitor` receipt is older
 * than twice its interval (600 seconds), or there is none while the first receipt of any task is older than that. A threshold condition with no subject. A missing or
 * dead `alarm-monitor` schedule is thus seen within about 40 minutes (the 10 minutes, and the 30 until the next heartbeat). The detail names the last receipt.
 */
export const monitorLateCondition: AlarmCondition = {
  id: 'monitor-late',
  evaluatedBy: 'heartbeat',
  evaluate(observations, registry) {
    const limit = lateFactor * (registry.find((entry) => entry.task === monitorTask)?.intervalSeconds ?? monitorIntervalSeconds);
    const receipt = observations.tasks.find((candidate) => candidate.task === monitorTask);
    const age = receipt ? receipt.age : observations.firstReceiptAge;
    return age !== null && age > limit ? [{subject: null, detail: {...receiptDetail(monitorTask, receipt), age_seconds: age}}] : [];
  },
};

/** Every registered condition. A later story adds its entry here and nothing else. */
export const alarmConditions: readonly AlarmCondition[] = [taskLateCondition, ledgerPendingCondition, identitiesUnaccountedCondition, heartbeatStaleCondition, qstashStaleCondition, monitorLateCondition];

/**
 * What one condition found: its ID and its findings (none when it holds nothing); `'unobservable'` when a precondition of it is missing now (nothing is raised and
 * nothing is resolved for it); or `null` findings and the `failure` when it could not be evaluated (the same: its alarms are left as they are).
 */
export type Evaluated = {id: string; findings: Finding[] | Unobservable | null; failure?: unknown};

/**
 * Evaluates the conditions that one evaluator owns against the observations. A condition that throws is reported as `findings: null` with its failure, and
 * the others are still evaluated: the caller must not treat "could not look" as "found nothing", which would resolve its open alarms.
 */
export function evaluateConditions(
  conditions: readonly AlarmCondition[],
  evaluatedBy: AlarmCondition['evaluatedBy'],
  observations: Observations,
  registry: readonly ScheduleLike[],
): Evaluated[] {
  return conditions
    .filter((condition) => condition.evaluatedBy === evaluatedBy)
    .map((condition): Evaluated => {
      try {
        return {id: condition.id, findings: condition.evaluate(observations, registry)};
      } catch (failure) {
        return {id: condition.id, findings: null, failure};
      }
    });
}

/** The key of one alarm: its condition and subject (null is a subject of its own). */
export const alarmKey = (condition: string, subject: string | null) => `${condition}\n${subject ?? ''}`;
