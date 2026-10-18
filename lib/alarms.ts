// Story 1.13. The alarm path: the monitor's run, the mail dispatch and the helper a pushed condition raises through. It is the ONE caller of
// `sendAlarmMail` (lib/mailer.ts), so there is one channel and no other send function: a later story's condition gets the same path by adding an entry
// to the registry (lib/alarm-conditions.ts) or by calling `raiseAlarm` here, and nothing else.
//
//   runAlarmMonitor       what the `alarm-monitor` task does (lib/job-tasks.ts): reads the observations, raises each finding of the conditions the monitor
//                         evaluates, resolves the open alarms of those conditions whose (condition, subject) is no longer found, then dispatches the email
//                         that is due. Its receipt holds counts only.
//   runHeartbeatEvaluation  the same for the conditions the application evaluates when the Railway heartbeat arrives (lib/heartbeat.ts), and it answers the
//                         age of the latest receipt, which the heartbeat route returns.
//   dispatchDueMail       asks the database which open alarms are due an email (the 24-hour rule is its) and is CLAIMED them as they are returned, so the monitor
//                         and the heartbeat evaluation, which overlap at :00 and :30, never mail one alarm twice; sends each through `sendAlarmMail` and records the
//                         outcome, which releases the claim: `sent` closes the window, `failed` and `unknown` close nothing, so the email is retried at the next
//                         evaluation. A sender that throws is a `failed` notice, and a notice that cannot be recorded is counted as a failed mail and does not stop
//                         the alarms behind it: neither escapes (the alarm keeps its claim and is tried again when the claim lapses, after 10 minutes). It sends
//                         one at a time and stops STARTING sends once ten seconds have passed since it began (each send has its own ten-second timeout, and the
//                         heartbeat task waits thirty seconds for the route that calls this): the alarms it did not reach are still claimed, with no outcome
//                         recorded, so they are due again when the claim lapses, within 10 minutes. Only the database failing to LIST what is due escapes.
//   raiseAlarm            for a PUSHED, subject-keyed condition (a payment exception, say): records the alarm and dispatches the same mail.
//
// The alarm is recorded BEFORE any mail is attempted, so a mailer that fails leaves the alarm on the Administrator's page and in the database, and the email
// is retried at the next evaluation. A condition that cannot be evaluated is never treated as "found nothing": its open alarms are left alone, the other
// conditions are still evaluated, and the run fails at the end (the receipt records the error's class), so the scheduler retries it.
//
// SERVER-ONLY. This file reads no environment variable and logs nothing: the environment reaches the mailer through `mail` (the mailer reads its own by
// default), and the database calls take `accounts`.
import type {AccountsOptions} from './accounts.ts';
import {alarmConditions, alarmKey, evaluateConditions, unobservable, type AlarmCondition, type AlarmDetail, type Observations, type ScheduleLike} from './alarm-conditions.ts';
import {
  alarmObservations,
  alarmsDueMail,
  listAlarms,
  maxDueMail,
  raiseAlarm as raiseAlarmRecord,
  recordAlarmNotice,
  resolveAlarm,
  type AlarmRaise,
  type NoticeOutcome,
} from './lifecycle.ts';
import {scheduleRegistry} from './schedules.ts';
import {sendAlarmMail, type AlarmNotice, type MailerOptions, type MailOutcome} from '@/lib/mailer';

export type AlarmDeps = {
  /** The database calls' options (the environment, a fetch, a deadline). */
  accounts?: AccountsOptions;
  /** Sends one alarm email. `sendAlarmMail` by default; the tests pass their own to make the mailer fail. There is no other way to send. */
  send?: (alarm: AlarmNotice) => Promise<MailOutcome>;
  /** The options of the default sender (the environment it reads the Administrator address from, a fetch, a timeout). Ignored when `send` is given. */
  mail?: MailerOptions;
  /** Milliseconds from a monotonic clock, for the dispatch's deadline (`performance.now` by default); the tests pass their own. It measures this module's own work and is never compared with a time the database wrote. */
  clock?: () => number;
};

/** `dispatchDueMail` stops starting new sends once this many milliseconds have passed since it began; the alarms it did not reach stay due. */
export const dispatchDeadlineMs = 10_000;

export type MonitorDeps = AlarmDeps & {
  /** The registry of conditions; `alarmConditions` by default. A test passes a fixture condition beside (or instead of) the real ones. */
  conditions?: readonly AlarmCondition[];
  /** The schedules the conditions look at; `scheduleRegistry` by default. */
  registry?: readonly ScheduleLike[];
  /** Whether the Railway heartbeat is configured for this deployment (lib/heartbeat.ts `isHeartbeatConfigured`): `heartbeat-stale` exists only when it is. */
  heartbeatConfigured?: boolean;
};

export type MailReport = {mailed: number; mailFailed: number};

/** What a notice records for a mailer's answer: only `sent` is a success, an `unknown` may have gone out, and everything else was not sent. */
function noticeOf(answer: MailOutcome | undefined): NoticeOutcome {
  if (answer?.outcome === 'sent') return 'sent';
  return answer?.outcome === 'unknown' ? 'unknown' : 'failed';
}

/**
 * Emails the Administrator the open alarms that are due and records each attempt. At most 50 alarms a call, one at a time, and no new send starts once
 * `dispatchDeadlineMs` has passed since the call began. The database CLAIMS each alarm it hands out (api.alarms_due_mail), so a dispatch that overlaps this one is
 * handed none of them; the outcome recorded here releases the claim. Whatever this call did not reach, or could not record, keeps its claim and is due again when
 * the claim lapses, 10 minutes after it was made. A notice that cannot be recorded (the database went away after the mail) is counted in `mailFailed` and the next
 * alarm is still tried; that alarm is mailed again after the claim lapses, which is the duplicate `unknown` already allows. It throws only when the database cannot
 * list (and claim) what is due.
 */
export async function dispatchDueMail(deps: AlarmDeps = {}): Promise<MailReport> {
  const accounts = deps.accounts ?? {};
  const send = deps.send ?? ((alarm: AlarmNotice) => sendAlarmMail(alarm, deps.mail));
  const clock = deps.clock ?? (() => performance.now());
  const due = await alarmsDueMail({limit: maxDueMail}, accounts);
  const began = clock();
  let mailed = 0;
  let mailFailed = 0;
  for (const alarm of due) {
    if (clock() - began >= dispatchDeadlineMs) break;
    let outcome: NoticeOutcome;
    try {
      outcome = noticeOf(await send({condition: alarm.condition, subject: alarm.subject, firstAt: alarm.firstAt, detail: alarm.detail}));
    } catch {
      // The sender threw: nothing is known about the message, and it is retried at the next evaluation like any other failure.
      outcome = 'failed';
    }
    try {
      await recordAlarmNotice({alarmId: alarm.id, outcome}, accounts);
    } catch {
      // Nothing was recorded, so this alarm keeps its claim and is tried again when the claim lapses; the others behind it are not held up by it.
      mailFailed += 1;
      continue;
    }
    if (outcome === 'sent') mailed += 1;
    else mailFailed += 1;
  }
  return {mailed, mailFailed};
}

export type ApplyReport = {raised: number; resolved: number; failures: unknown[]};

/**
 * Raises every finding of the conditions one evaluator owns and resolves the open alarms of those conditions that are no longer found. A finding that
 * could not be raised, and a condition that could not be evaluated, leave their alarms as they are (they are never resolved on the strength of a failure) and
 * are returned in `failures`. A condition that answers `'unobservable'` (a precondition is missing now) raises nothing and resolves nothing: its open alarms stay
 * open until it can be observed again and is found clear, and nothing is reported as a failure. It throws only when the open alarms cannot be listed.
 */
export async function applyConditions(evaluatedBy: AlarmCondition['evaluatedBy'], observations: Observations, deps: MonitorDeps = {}): Promise<ApplyReport> {
  const accounts = deps.accounts ?? {};
  const evaluated = evaluateConditions(deps.conditions ?? alarmConditions, evaluatedBy, observations, deps.registry ?? scheduleRegistry);
  const failures: unknown[] = [];
  const owned = new Set<string>();
  const found = new Set<string>();
  let raised = 0;
  for (const one of evaluated) {
    if (one.findings === null) {
      failures.push(one.failure);
      continue;
    }
    // Neither raised nor resolved: it is not `owned` for this run, so the resolving loop below leaves its open alarms alone.
    if (one.findings === unobservable) continue;
    owned.add(one.id);
    for (const finding of one.findings) {
      // Whatever becomes of the call, this alarm is not cleared: a database that did not answer is not a condition that went away.
      found.add(alarmKey(one.id, finding.subject));
      try {
        await raiseAlarmRecord({condition: one.id, subject: finding.subject, detail: finding.detail}, accounts);
        raised += 1;
      } catch (error) {
        failures.push(error);
      }
    }
  }
  let resolved = 0;
  for (const alarm of await listAlarms({includeResolved: false}, accounts)) {
    if (!owned.has(alarm.condition) || found.has(alarmKey(alarm.condition, alarm.subject))) continue;
    try {
      if ((await resolveAlarm({condition: alarm.condition, subject: alarm.subject}, accounts)).outcome === 'resolved') resolved += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  return {raised, resolved, failures};
}

export type MonitorReport = {raised: number; resolved: number; mailed: number; mailFailed: number};

/**
 * One run of the monitor: observe, evaluate the monitor's conditions, raise and resolve, then email what is due. Throws (the first failure, after everything
 * else was done) when a condition could not be evaluated or an alarm could not be written, and when the database does not answer.
 */
export async function runAlarmMonitor(deps: MonitorDeps = {}): Promise<MonitorReport> {
  const observed = await alarmObservations(deps.accounts ?? {});
  const applied = await applyConditions('monitor', {...observed, heartbeatConfigured: deps.heartbeatConfigured === true}, deps);
  const mail = await dispatchDueMail(deps);
  if (applied.failures.length > 0) throw applied.failures[0];
  return {raised: applied.raised, resolved: applied.resolved, mailed: mail.mailed, mailFailed: mail.mailFailed};
}

export type HeartbeatReport = MonitorReport & {
  /** The age in seconds of the latest receipt of any scheduler task, on the database's clock; null when there is none. */
  receiptAge: number | null;
};

/**
 * What the application does when the Railway heartbeat has been recorded: observe, evaluate the conditions the heartbeat owns (`qstash-stale`), raise or
 * resolve, email what is due, and answer the latest receipt's age. Throws on any failure: the route answers 503, never a success that skipped the evaluation.
 */
export async function runHeartbeatEvaluation(deps: MonitorDeps = {}): Promise<HeartbeatReport> {
  const observed = await alarmObservations(deps.accounts ?? {});
  const applied = await applyConditions('heartbeat', {...observed, heartbeatConfigured: deps.heartbeatConfigured === true}, deps);
  const mail = await dispatchDueMail(deps);
  if (applied.failures.length > 0) throw applied.failures[0];
  return {raised: applied.raised, resolved: applied.resolved, mailed: mail.mailed, mailFailed: mail.mailFailed, receiptAge: observed.latestReceiptAge};
}

export type PushedAlarm = AlarmRaise & MailReport;

/**
 * Raises the alarm of a PUSHED condition, one that no evaluation looks for (a payment exception, keyed by its subject): the alarm is recorded, then the
 * same mail dispatch runs, so it is emailed at once (a subject-keyed alarm is due as it opens) through the same channel. The repeat of a subject that is open
 * refreshes its record and sends nothing more inside its 24 hours. Resolving it is the pusher's, with `resolveAlarm` (lib/lifecycle.ts). It throws only when
 * the alarm could not be recorded; a dispatch that fails afterwards is counted (`mailFailed`) and swallowed.
 */
export async function raiseAlarm(input: {condition: string; subject: string | null; detail: AlarmDetail}, deps: AlarmDeps = {}): Promise<PushedAlarm> {
  const raised = await raiseAlarmRecord(input, deps.accounts ?? {});
  try {
    return {...raised, ...(await dispatchDueMail(deps))};
  } catch {
    // The alarm IS recorded: that is what the caller asked for, and the email is retried at the next evaluation. A dispatch that could not even list what is due
    // is counted as one mail that failed and is never thrown, so a pusher does not mistake "recorded, mail pending" for "not recorded" and raise it twice.
    return {...raised, mailed: 0, mailFailed: 1};
  }
}
