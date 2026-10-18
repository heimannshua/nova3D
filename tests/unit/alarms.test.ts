import {describe, expect, it, vi} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {alarmsDueMail, raiseAlarm as recordAlarm, recordAlarmNotice, resolveAlarm} from '@/lib/lifecycle';
import {alarmConditions, type AlarmCondition, type AlarmDetail} from '@/lib/alarm-conditions';
import {applyConditions, dispatchDeadlineMs, dispatchDueMail, raiseAlarm, runAlarmMonitor, runHeartbeatEvaluation, type MonitorDeps} from '@/lib/alarms';
import {mailTimeoutMs} from '@/lib/mailer';
import {postTimeoutMs} from '../../workers/heartbeat/src/main';
import {env, fakeDatabase, HOUR, iso, json, calm, refused, sender, START, unknown, type Database} from '../support/alarm-fakes';

// The alarm path (Story 1.13, lib/alarms.ts) against a stand-in for the database (tests/support/alarm-fakes.ts) that keeps alarms and notices the way the
// alarm functions do, including the 24-hour email rule (the real functions are tested against the real database in tests/integration/alarms.test.ts). What is
// under test here is the ORCHESTRATION: what the monitor raises, resolves and mails, in what order, and what a failing mailer, a failing database or a
// condition that throws does to it.
const deps = (database: Database, mail: ReturnType<typeof sender>, extra: Partial<MonitorDeps> = {}): MonitorDeps => ({accounts: {env, fetch: database.fetch as never}, send: mail.send, heartbeatConfigured: false, ...extra});

/** A fixture threshold condition (a later story's): raised while `unaccounted` is over 1, with a flat detail. */
const fixtureThreshold: AlarmCondition = {
  id: 'fixture-threshold',
  evaluatedBy: 'monitor',
  evaluate: (observations) => (observations.unaccounted > 1 ? [{subject: null, detail: {count: observations.unaccounted, receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T07:00:00.000Z'}}] : []),
};
/** A fixture condition whose findings are subject-keyed: one alarm per subject. */
const fixtureSubjects = (subjects: string[]): AlarmCondition => ({id: 'fixture-subject', evaluatedBy: 'monitor', evaluate: () => subjects.map((subject) => ({subject, detail: {n: subjects.length}}))});

describe('a threshold condition that crosses its threshold (AC-1)', () => {
  it('opens one alarm, emails the Administrator once, and a second evaluation refreshes the record and sends nothing more', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;

    expect(await runAlarmMonitor(options)).toEqual({raised: 1, resolved: 0, mailed: 1, mailFailed: 0});
    expect(database.alarms).toHaveLength(1);
    expect(mail.mails).toEqual([{condition: 'fixture-threshold', subject: null, firstAt: iso(START), detail: expect.objectContaining({count: 9})}]);
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['sent']);

    database.advance(5 * 60_000);
    database.observed.value.unaccounted = 12;
    expect(await runAlarmMonitor(options)).toEqual({raised: 1, resolved: 0, mailed: 0, mailFailed: 0});
    expect(database.alarms).toHaveLength(1);
    expect(database.alarms[0]).toMatchObject({latestAt: START + 5 * 60_000, detail: expect.objectContaining({count: 12})});
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  it('resolves the alarm when the condition clears, keeps the record, and sends no email for it', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;
    await runAlarmMonitor(options);
    database.advance(60_000);
    database.observed.value.unaccounted = 0;
    expect(await runAlarmMonitor(options)).toEqual({raised: 0, resolved: 1, mailed: 0, mailFailed: 0});
    expect(database.alarms).toHaveLength(1);
    expect(database.alarms[0].resolvedAt).toBe(START + 60_000);
    expect(mail.send).toHaveBeenCalledTimes(1);
    // ... and nothing is left to resolve the next time.
    expect(await runAlarmMonitor(options)).toEqual({raised: 0, resolved: 0, mailed: 0, mailFailed: 0});
  });

  it('opens a NEW alarm when the condition comes back, and emails it only when its condition has not been emailed in the last 24 hours (then, when that window ends, if it is still open)', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;
    await runAlarmMonitor(options);
    database.advance(HOUR);
    database.observed.value.unaccounted = 0;
    await runAlarmMonitor(options);
    database.advance(HOUR);
    database.observed.value.unaccounted = 9;
    // Back after two hours: a new record, so the second incident is never hidden, but no second email inside the window.
    expect(await runAlarmMonitor(options)).toEqual({raised: 1, resolved: 0, mailed: 0, mailFailed: 0});
    expect(database.alarms).toHaveLength(2);
    expect(database.openAlarms()).toHaveLength(1);
    expect(mail.send).toHaveBeenCalledTimes(1);
    // 22 hours later: still inside the 24 hours of the first email. 25 hours after it: the window has ended and the open alarm is emailed.
    database.advance(20 * HOUR);
    expect((await runAlarmMonitor(options)).mailed).toBe(0);
    database.advance(2 * HOUR);
    expect((await runAlarmMonitor(options)).mailed).toBe(1);
    expect(mail.mails.at(-1)).toMatchObject({condition: 'fixture-threshold', firstAt: iso(START + 2 * HOUR)});
    expect(database.alarms).toHaveLength(2);
  });

  it('reminds at most once every 24 hours while the alarm stays open', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;
    await runAlarmMonitor(options);
    for (const hours of [6, 6, 6, 5]) {
      database.advance(hours * HOUR);
      expect((await runAlarmMonitor(options)).mailed, `${hours} hours`).toBe(0);
    }
    // 23 hours after the first email; one more hour and the 24 hours are up.
    database.advance(HOUR + 1);
    expect((await runAlarmMonitor(options)).mailed).toBe(1);
    database.advance(HOUR);
    expect((await runAlarmMonitor(options)).mailed).toBe(0);
    expect(mail.send).toHaveBeenCalledTimes(2);
    expect(database.alarms).toHaveLength(1);
  });

  it('never emails a resolved alarm', async () => {
    const database = fakeDatabase();
    const mail = sender([refused]);
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;
    expect((await runAlarmMonitor(options)).mailFailed).toBe(1);
    // The mail failed, and then the condition cleared: nothing is retried for a resolved alarm.
    database.observed.value.unaccounted = 0;
    database.advance(60_000);
    expect(await runAlarmMonitor(options)).toEqual({raised: 0, resolved: 1, mailed: 0, mailFailed: 0});
    expect(mail.send).toHaveBeenCalledTimes(1);
  });
});

describe('a subject-keyed condition (AC-6)', () => {
  it('gives each subject its own alarm and email at the evaluation that raises it, and the repeat of one creates nothing', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const conditions = [fixtureSubjects(['A'])];
    expect(await runAlarmMonitor(deps(database, mail, {conditions}))).toMatchObject({raised: 1, mailed: 1});
    database.advance(60_000);
    expect(await runAlarmMonitor(deps(database, mail, {conditions: [fixtureSubjects(['A', 'B'])]}))).toMatchObject({raised: 2, mailed: 1});
    database.advance(60_000);
    // A raises again: the same record, refreshed, and no further email.
    expect(await runAlarmMonitor(deps(database, mail, {conditions: [fixtureSubjects(['A', 'B'])]}))).toMatchObject({raised: 2, mailed: 0});
    expect(database.alarms.map((alarm) => alarm.subject)).toEqual(['A', 'B']);
    expect(mail.mails.map((alarm) => alarm.subject)).toEqual(['A', 'B']);
  });

  it('resolves only the subject that is no longer found', async () => {
    const database = fakeDatabase();
    const mail = sender();
    await runAlarmMonitor(deps(database, mail, {conditions: [fixtureSubjects(['A', 'B'])]}));
    database.advance(1000);
    expect(await runAlarmMonitor(deps(database, mail, {conditions: [fixtureSubjects(['B'])]}))).toMatchObject({raised: 1, resolved: 1});
    expect(database.alarms.map((alarm) => [alarm.subject, alarm.resolvedAt !== null])).toEqual([['A', true], ['B', false]]);
  });

  it('is raised through the push helper too, followed by the same mail dispatch, and the repeat of a subject sends nothing more', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail);
    expect(await raiseAlarm({condition: 'payment-exception', subject: 'pay_A', detail: {amount: 5}}, options)).toMatchObject({outcome: 'opened', mailed: 1, mailFailed: 0});
    expect(await raiseAlarm({condition: 'payment-exception', subject: 'pay_B', detail: {amount: 7}}, options)).toMatchObject({outcome: 'opened', mailed: 1});
    expect(await raiseAlarm({condition: 'payment-exception', subject: 'pay_A', detail: {amount: 6}}, options)).toMatchObject({outcome: 'refreshed', mailed: 0});
    expect(database.alarms).toHaveLength(2);
    expect(mail.mails.map((alarm) => alarm.subject)).toEqual(['pay_A', 'pay_B']);
    // A pushed condition is in no registry, so no evaluation resolves it by its absence.
    const monitor = await runAlarmMonitor(deps(database, sender()));
    expect(monitor.resolved).toBe(0);
    expect(database.openAlarms()).toHaveLength(2);
  });
});

describe('a mailer that fails (AC-5)', () => {
  it('leaves the alarm recorded and open, records a `failed` notice, and retries at the next evaluation', async () => {
    const database = fakeDatabase();
    const mail = sender([refused]);
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;
    expect(await runAlarmMonitor(options)).toEqual({raised: 1, resolved: 0, mailed: 0, mailFailed: 1});
    expect(database.openAlarms()).toHaveLength(1);
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['failed']);
    // The next evaluation (not 24 hours later): the failed notice closed nothing, so the email is retried, and this time it goes.
    database.advance(5 * 60_000);
    expect(await runAlarmMonitor(options)).toEqual({raised: 1, resolved: 0, mailed: 1, mailFailed: 0});
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['failed', 'sent']);
    expect(database.alarms).toHaveLength(1);
  });

  it('records an `unknown` notice for an answer that may have gone out, retries it, and may duplicate one mail (accepted)', async () => {
    const database = fakeDatabase();
    const mail = sender([unknown]);
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;
    expect(await runAlarmMonitor(options)).toMatchObject({mailed: 0, mailFailed: 1});
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['unknown']);
    database.advance(60_000);
    expect(await runAlarmMonitor(options)).toMatchObject({mailed: 1});
    expect(mail.send).toHaveBeenCalledTimes(2);
  });

  it('records a `failed` notice for a sender that throws, and no error escapes', async () => {
    const database = fakeDatabase();
    const mail = sender(['throw']);
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;
    await expect(runAlarmMonitor(options)).resolves.toEqual({raised: 1, resolved: 0, mailed: 0, mailFailed: 1});
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['failed']);
    await expect(raiseAlarm({condition: 'payment-exception', subject: 'pay_Z', detail: {}}, deps(database, sender(['throw'])))).resolves.toMatchObject({outcome: 'opened', mailFailed: 1});
  });

  it('treats a sender that answers something that is not an answer as a failure to send', async () => {
    const database = fakeDatabase();
    const options = deps(database, sender(), {send: (async () => undefined) as never, conditions: [fixtureThreshold]});
    database.observed.value.unaccounted = 9;
    expect(await runAlarmMonitor(options)).toMatchObject({mailed: 0, mailFailed: 1});
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['failed']);
  });

  it('mails what the database says is due, in the order it says, and at most one message for an alarm', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail, {conditions: [fixtureSubjects(['one', 'two', 'three'])]});
    expect(await runAlarmMonitor(options)).toMatchObject({raised: 3, mailed: 3});
    expect(mail.mails.map((alarm) => alarm.subject)).toEqual(['one', 'two', 'three']);
    expect(await dispatchDueMail(options)).toEqual({mailed: 0, mailFailed: 0});
  });
});

describe('the conditions the monitor evaluates', () => {
  it('raises task-late for a task that stopped, naming it and its last receipt, and resolves it when the task runs again', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail);
    database.observed.value.tasks = database.observed.value.tasks.map((task) => (task.task === 'ledger-relay' ? {...task, age: 700, at: '2026-10-17T07:48:20.000Z', outcome: 'ran'} : task));
    expect(await runAlarmMonitor(options)).toEqual({raised: 1, resolved: 0, mailed: 1, mailFailed: 0});
    expect(database.alarms).toEqual([expect.objectContaining({condition: 'task-late', subject: 'ledger-relay', detail: {receipt_task: 'ledger-relay', receipt_outcome: 'ran', receipt_at: '2026-10-17T07:48:20.000Z', age_seconds: 700}})]);
    expect(mail.mails[0]).toMatchObject({condition: 'task-late', subject: 'ledger-relay'});
    database.advance(60_000);
    database.observed.value = calm();
    expect(await runAlarmMonitor(options)).toEqual({raised: 0, resolved: 1, mailed: 0, mailFailed: 0});
  });

  it('knows the Railway heartbeat is configured only when told, and then evaluates heartbeat-stale', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.observed.value.latest_heartbeat_age = 8000;
    expect(await runAlarmMonitor(deps(database, mail, {heartbeatConfigured: false}))).toMatchObject({raised: 0});
    expect(await runAlarmMonitor(deps(database, mail, {heartbeatConfigured: true}))).toMatchObject({raised: 1, mailed: 1});
    expect(database.alarms).toEqual([expect.objectContaining({condition: 'heartbeat-stale', subject: null})]);
    database.observed.value.latest_heartbeat_age = 30;
    database.advance(60_000);
    expect(await runAlarmMonitor(deps(database, mail, {heartbeatConfigured: true}))).toMatchObject({resolved: 1});
  });

  // CHANGED (F4): "no finding means resolved" no longer holds for the two conditions with a precondition. `heartbeat-stale` used to be evaluated only when the heartbeat
  // was configured and its alarm resolved by the next run without it; now the unconfigured heartbeat is unobservable, so an alarm that is open stays open.
  it('leaves an open heartbeat-stale alarm open when the heartbeat stops being configured, opens none, and resolves it once the heartbeat is configured again and found clear', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.observed.value.latest_heartbeat_age = 8000;
    await runAlarmMonitor(deps(database, mail, {heartbeatConfigured: true}));
    expect(database.openAlarms().map((alarm) => alarm.condition)).toEqual(['heartbeat-stale']);
    // The key set is unset: unobservable. Nothing is raised, nothing resolved, whatever the ages say (clear or stale).
    for (const age of [8000, 30, null]) {
      database.advance(60_000);
      database.observed.value.latest_heartbeat_age = age;
      expect(await runAlarmMonitor(deps(database, mail, {heartbeatConfigured: false}))).toMatchObject({raised: 0, resolved: 0});
      expect(database.openAlarms().map((alarm) => alarm.condition)).toEqual(['heartbeat-stale']);
    }
    // Configured again and clear: resolved.
    database.advance(60_000);
    database.observed.value.latest_heartbeat_age = 30;
    expect(await runAlarmMonitor(deps(database, mail, {heartbeatConfigured: true}))).toMatchObject({raised: 0, resolved: 1});
    expect(database.openAlarms()).toEqual([]);
    // And with the heartbeat unconfigured from the start, none is ever opened.
    const never = fakeDatabase();
    never.observed.value.latest_heartbeat_age = 99_999;
    expect(await runAlarmMonitor(deps(never, sender(), {heartbeatConfigured: false}))).toMatchObject({raised: 0});
    expect(never.alarms).toEqual([]);
  });

  // CHANGED (F4): `ledger-pending` used to be silent (an empty list of findings) while the relay reported `no_store`, so an alarm opened earlier was RESOLVED. It is now
  // unobservable then: the alarm stays open.
  it('leaves an open ledger-pending alarm open when the relay\'s latest receipt becomes `no_store`, opens none while it is, and resolves it once the relay can relay and the backlog is clear', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const relay = (outcome: string) => (task: {task: string; outcome: string; at: string; age: number}) => (task.task === 'ledger-relay' ? {...task, outcome} : task);
    database.observed.value.ledger_pending = 4;
    database.observed.value.ledger_oldest = 2000;
    await runAlarmMonitor(deps(database, mail));
    expect(database.openAlarms().map((alarm) => alarm.condition)).toEqual(['ledger-pending']);
    // The relay now reports `no_store`: unobservable, whatever the backlog is (still old, or gone).
    for (const [pending, oldest] of [[4, 2000], [0, null]] as const) {
      database.advance(60_000);
      database.observed.value.tasks = database.observed.value.tasks.map(relay('no_store'));
      database.observed.value.ledger_pending = pending;
      database.observed.value.ledger_oldest = oldest;
      expect(await runAlarmMonitor(deps(database, mail))).toMatchObject({raised: 0, resolved: 0});
      expect(database.openAlarms().map((alarm) => alarm.condition)).toEqual(['ledger-pending']);
    }
    // The relay can relay again and the backlog is clear: resolved.
    database.advance(60_000);
    database.observed.value.tasks = database.observed.value.tasks.map(relay('ran'));
    expect(await runAlarmMonitor(deps(database, mail))).toMatchObject({raised: 0, resolved: 1});
    expect(database.openAlarms()).toEqual([]);
    // With the relay at `no_store` from the start, none is ever opened.
    const never = fakeDatabase();
    never.observed.value.tasks = never.observed.value.tasks.map(relay('no_store'));
    never.observed.value.ledger_pending = 134;
    never.observed.value.ledger_oldest = 50_000;
    expect(await runAlarmMonitor(deps(never, sender()))).toMatchObject({raised: 0});
    expect(never.alarms).toEqual([]);
  });

  it('leaves the open alarms of an unobservable condition alone in the heartbeat\'s evaluation too, and does not call it a failure', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const unobservableByHeartbeat: AlarmCondition = {id: 'fixture-unobservable', evaluatedBy: 'heartbeat', evaluate: () => 'unobservable'};
    await raiseAlarm({condition: 'fixture-unobservable', subject: null, detail: {n: 1}}, deps(database, mail));
    expect(await runHeartbeatEvaluation(deps(database, mail, {conditions: [unobservableByHeartbeat]}))).toMatchObject({raised: 0, resolved: 0});
    expect(database.openAlarms().map((alarm) => alarm.condition)).toEqual(['fixture-unobservable']);
  });

  it('does not evaluate qstash-stale: the monitor runs on QStash and cannot see it stop (the heartbeat route does)', async () => {
    const database = fakeDatabase();
    database.observed.value.latest_receipt_age = 99_999;
    expect(await runAlarmMonitor(deps(database, sender()))).toMatchObject({raised: 0});
    expect(database.alarms).toEqual([]);
  });

  it('leaves alone an open alarm of a condition no registry knows, or that another evaluator owns', async () => {
    const database = fakeDatabase();
    const mail = sender();
    await raiseAlarm({condition: 'payment-exception', subject: 'pay_A', detail: {}}, deps(database, mail));
    await raiseAlarm({condition: 'qstash-stale', subject: null, detail: {age_seconds: 9000}}, deps(database, mail));
    expect(await runAlarmMonitor(deps(database, mail))).toMatchObject({raised: 0, resolved: 0});
    expect(database.openAlarms()).toHaveLength(2);
  });

  it('evaluates the real registry against calm observations and finds nothing', async () => {
    const database = fakeDatabase();
    const mail = sender();
    expect(await runAlarmMonitor(deps(database, mail, {conditions: alarmConditions, heartbeatConfigured: true}))).toEqual({raised: 0, resolved: 0, mailed: 0, mailFailed: 0});
    expect(database.calls).toEqual(['alarm_observations', 'list_alarms', 'alarms_due_mail']);
  });
});

describe('the heartbeat route\'s evaluation', () => {
  it('raises qstash-stale when the latest receipt is over two hours old, emails it, and answers the age of the latest receipt', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.observed.value.latest_receipt_age = 7201;
    expect(await runHeartbeatEvaluation(deps(database, mail))).toEqual({raised: 1, resolved: 0, mailed: 1, mailFailed: 0, receiptAge: 7201});
    expect(database.alarms).toEqual([expect.objectContaining({condition: 'qstash-stale', subject: null, detail: {age_seconds: 7201, receipts: 'stale'}})]);
    // A later heartbeat with a fresh receipt resolves it.
    database.advance(30 * 60_000);
    database.observed.value.latest_receipt_age = 40;
    expect(await runHeartbeatEvaluation(deps(database, mail))).toEqual({raised: 0, resolved: 1, mailed: 0, mailFailed: 0, receiptAge: 40});
  });

  it('answers null when no scheduler task has ever left a receipt', async () => {
    const database = fakeDatabase();
    database.observed.value = {...calm(), first_receipt_age: null, latest_receipt_age: null, tasks: []};
    expect((await runHeartbeatEvaluation(deps(database, sender()))).receiptAge).toBeNull();
  });

  // CHANGED (F3): this left `tasks` empty, which was a calm picture for the heartbeat's one condition. Since `monitor-late` is also the heartbeat's, an empty list of
  // finished receipts with an old first receipt IS a stopped monitor and would be raised; so the picture keeps a fresh monitor receipt, and what it proves is unchanged:
  // the monitor's conditions (here the identities) are not the heartbeat's to raise.
  it('evaluates only the heartbeat\'s conditions: the monitor\'s are not its to raise or resolve', async () => {
    const database = fakeDatabase();
    database.observed.value.unaccounted = 99;
    database.observed.value.tasks = [{task: 'alarm-monitor', outcome: 'ran', at: '2026-10-17T07:59:00.000Z', age: 60}];
    expect(await runHeartbeatEvaluation(deps(database, sender()))).toMatchObject({raised: 0});
    expect(database.alarms).toEqual([]);
  });

  it('raises monitor-late when the monitor has no fresh receipt (it cannot see itself stop, so the heartbeat\'s evaluation does), emails it once, and resolves it at a later heartbeat with a fresh monitor receipt', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.observed.value.tasks = database.observed.value.tasks.map((task) => (task.task === 'alarm-monitor' ? {...task, age: 900, at: '2026-10-17T07:45:00.000Z'} : task));
    expect(await runHeartbeatEvaluation(deps(database, mail))).toMatchObject({raised: 1, resolved: 0, mailed: 1});
    expect(database.alarms).toEqual([expect.objectContaining({condition: 'monitor-late', subject: null, resolvedAt: null, detail: {receipt_task: 'alarm-monitor', receipt_outcome: 'ran', receipt_at: '2026-10-17T07:45:00.000Z', age_seconds: 900}})]);
    expect(mail.mails).toEqual([expect.objectContaining({condition: 'monitor-late', subject: null})]);
    // The next heartbeat finds it still late: the same alarm, refreshed, no second email.
    database.advance(30 * 60_000);
    expect(await runHeartbeatEvaluation(deps(database, mail))).toMatchObject({raised: 1, mailed: 0});
    expect(database.alarms).toHaveLength(1);
    // A fresh monitor receipt resolves it.
    database.advance(30 * 60_000);
    database.observed.value.tasks = database.observed.value.tasks.map((task) => (task.task === 'alarm-monitor' ? {...task, age: 120} : task));
    expect(await runHeartbeatEvaluation(deps(database, mail))).toMatchObject({raised: 0, resolved: 1, mailed: 0});
    expect(database.alarms[0].resolvedAt).not.toBeNull();
    expect(mail.mails).toHaveLength(1);
  });

  it('raises monitor-late for a monitor that has no finished receipt at all while the scheduler has been running for over 600 seconds (the schedule was never made)', async () => {
    const database = fakeDatabase();
    database.observed.value.tasks = database.observed.value.tasks.filter((task) => task.task !== 'alarm-monitor');
    database.observed.value.first_receipt_age = 3_000;
    expect(await runHeartbeatEvaluation(deps(database, sender()))).toMatchObject({raised: 1});
    expect(database.alarms).toEqual([expect.objectContaining({condition: 'monitor-late', detail: expect.objectContaining({receipt_outcome: 'never', receipt_at: 'never', age_seconds: 3_000})})]);
    // ... and not for one that has only just begun.
    const young = fakeDatabase();
    young.observed.value.tasks = [];
    young.observed.value.first_receipt_age = 200;
    expect(await runHeartbeatEvaluation(deps(young, sender()))).toMatchObject({raised: 0});
  });

  it('does not evaluate monitor-late in the monitor\'s own run: it is the heartbeat\'s', async () => {
    const database = fakeDatabase();
    database.observed.value.tasks = [];
    database.observed.value.first_receipt_age = 100_000;
    const report = await runAlarmMonitor(deps(database, sender()));
    expect(database.alarms.map((alarm) => alarm.condition)).not.toContain('monitor-late');
    // (Two tasks are late; the monitor itself is left out, and the third task has not had two of its intervals yet.)
    expect(report.raised).toBe(2);
  });
});

describe('failures', () => {
  it('throws when the database does not answer, and raises and emails nothing', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.fail.alarm_observations = () => json({message: 'down'}, 503);
    await expect(runAlarmMonitor(deps(database, mail))).rejects.toBeInstanceOf(AccountsUnavailableError);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('does not clear an alarm because a database call failed: a raise that fails leaves the open alarm alone, the run still finishes the rest and then fails', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail, {conditions: [fixtureThreshold, fixtureSubjects(['A', 'B'])]});
    database.observed.value.unaccounted = 9;
    await runAlarmMonitor(options);
    expect(database.openAlarms()).toHaveLength(3);
    database.advance(60_000);
    // The next raise call (the first one: the threshold's) fails; everything else still goes through.
    database.failOnce('raise_alarm');
    await expect(runAlarmMonitor(options)).rejects.toBeInstanceOf(AccountsUnavailableError);
    expect(database.openAlarms()).toHaveLength(3);
    expect(database.alarms.find((alarm) => alarm.condition === 'fixture-subject' && alarm.subject === 'B')?.latestAt).toBe(START + 60_000);
  });

  it('never resolves the alarms of a condition that could not be evaluated, still evaluates the others, mails what is due, and then fails the run', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const broken: AlarmCondition = {
      id: 'fixture-broken',
      evaluatedBy: 'monitor',
      evaluate() {
        throw new TypeError('a bug');
      },
    };
    const conditions = [broken, fixtureThreshold];
    database.observed.value.unaccounted = 9;
    // An alarm of the broken condition is already open.
    await raiseAlarm({condition: 'fixture-broken', subject: null, detail: {}}, deps(database, sender()));
    await expect(runAlarmMonitor(deps(database, mail, {conditions}))).rejects.toBeInstanceOf(TypeError);
    expect(database.open('fixture-broken', null)).toBeDefined();
    expect(database.open('fixture-threshold', null)).toBeDefined();
    expect(mail.mails.map((alarm) => alarm.condition)).toContain('fixture-threshold');
  });

  it('applyConditions reports the failures instead of throwing for a raise or a condition, and counts what it did', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.failOnce('raise_alarm');
    const applied = await applyConditions('monitor', {...(await import('@/lib/lifecycle').then((m) => m.alarmObservations({env, fetch: database.fetch as never}))), heartbeatConfigured: false}, deps(database, mail, {conditions: [fixtureSubjects(['A', 'B'])]}));
    expect(applied.raised).toBe(1);
    expect(applied.failures).toHaveLength(1);
  });

  // CHANGED (review patch P2): this used to expect the run to reject when the notice could not be recorded. A notice that cannot be recorded no longer aborts the
  // loop (the alarms behind it were skipped, and the alarm already mailed was mailed again at the next evaluation anyway); it is counted in `mail_failed` and the
  // next alarm is still tried. The run still reports what it could not do, in the receipt's own key, and the alarm stays due.
  it('counts a notice that cannot be recorded (the database went away after the mail) as a failed mail, and does not throw: the alarm has no notice, so it is still due', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.fail.record_alarm_notice = () => json({message: 'down'}, 503);
    database.observed.value.unaccounted = 9;
    const options = deps(database, mail, {conditions: [fixtureThreshold]});
    expect(await runAlarmMonitor(options)).toEqual({raised: 1, resolved: 0, mailed: 0, mailFailed: 1});
    expect(database.notices).toEqual([]);
    expect(database.openAlarms()).toHaveLength(1);
    delete database.fail.record_alarm_notice;
    // CHANGED (F1): this expected the very next run to mail it again. The alarm now keeps the claim api.alarms_due_mail made, with no outcome to release it, so it is
    // held for 10 minutes (a sender that crashes after claiming is retried after 10 minutes) and then mailed again.
    expect(await runAlarmMonitor(options)).toMatchObject({mailed: 0, mailFailed: 0});
    expect(mail.mails).toHaveLength(1);
    database.advance(10 * 60_000 + 1);
    expect(await runAlarmMonitor(options)).toMatchObject({mailed: 1, mailFailed: 0});
    expect(mail.mails).toHaveLength(2);
  });
});

describe('dispatchDueMail: a notice that cannot be recorded does not stop the alarms behind it (review patch P2)', () => {
  it('mails and records the second alarm when the first one\'s notice cannot be recorded, counts the first as a failed mail, and mails the first again at the next evaluation', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail, {conditions: [fixtureSubjects(['one', 'two'])]});
    await applyConditions('monitor', {...(await import('@/lib/lifecycle').then((m) => m.alarmObservations({env, fetch: database.fetch as never}))), heartbeatConfigured: false}, options);
    database.failOnce('record_alarm_notice');
    expect(await dispatchDueMail(options)).toEqual({mailed: 1, mailFailed: 1});
    expect(mail.mails.map((alarm) => alarm.subject)).toEqual(['one', 'two']);
    // Only the second was recorded.
    expect(database.notices.map((notice) => [database.alarms.find((alarm) => alarm.id === notice.alarmId)?.subject, notice.outcome])).toEqual([['two', 'sent']]);
    // CHANGED (F1): "the first has no notice, so it is due again" now reads: it keeps its claim, which holds it for 10 minutes; after that it is due again, and only it.
    expect(await dispatchDueMail(options)).toEqual({mailed: 0, mailFailed: 0});
    database.advance(10 * 60_000 + 1);
    expect(await dispatchDueMail(options)).toEqual({mailed: 1, mailFailed: 0});
    expect(mail.mails.map((alarm) => alarm.subject)).toEqual(['one', 'two', 'one']);
  });

  it('counts a notice that cannot be recorded for a mail that failed too, once, as one failed mail', async () => {
    const database = fakeDatabase();
    const mail = sender([refused, refused]);
    const options = deps(database, mail, {conditions: [fixtureSubjects(['one', 'two'])]});
    await applyConditions('monitor', {...(await import('@/lib/lifecycle').then((m) => m.alarmObservations({env, fetch: database.fetch as never}))), heartbeatConfigured: false}, options);
    database.failOnce('record_alarm_notice');
    expect(await dispatchDueMail(options)).toEqual({mailed: 0, mailFailed: 2});
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['failed']);
  });
});

describe('dispatchDueMail: the database claims what it hands out (F1), and the dispatch records the real outcome', () => {
  const accounts = (database: Database) => ({env, fetch: database.fetch as never});
  const open = async (database: Database, condition: string, subject: string | null) => (await recordAlarm({condition, subject, detail: {}}, accounts(database))).alarmId;
  const due = async (database: Database) => (await alarmsDueMail({}, accounts(database))).map((alarm) => alarm.id);

  it('claims an alarm as it hands it out, and records the real outcome after it: `sent` closes the day, and the claim no longer holds anything', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = deps(database, mail, {conditions: [fixtureSubjects(['one'])]});
    await applyConditions('monitor', {...(await import('@/lib/lifecycle').then((m) => m.alarmObservations(accounts(database)))), heartbeatConfigured: false}, options);
    expect(await dispatchDueMail(options)).toEqual({mailed: 1, mailFailed: 0});
    expect(database.claims).toEqual([expect.objectContaining({alarmId: database.alarms[0].id})]);
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['sent']);
    // The claim came first and the outcome after it, and nothing is due now or for 24 hours.
    expect(database.notices[0].seq).toBeGreaterThan(database.claims[0].seq);
    expect(await due(database)).toEqual([]);
    database.advance(24 * HOUR - 1);
    expect(await due(database)).toEqual([]);
    database.advance(2);
    expect(await due(database)).toEqual([database.alarms[0].id]);
  });

  it('releases the claim with `failed` and with `unknown`: the email is retried at the very next evaluation, not after 10 minutes', async () => {
    const database = fakeDatabase();
    const mail = sender([refused, unknown]);
    const options = deps(database, mail, {conditions: [fixtureSubjects(['one'])]});
    await applyConditions('monitor', {...(await import('@/lib/lifecycle').then((m) => m.alarmObservations(accounts(database)))), heartbeatConfigured: false}, options);
    expect(await dispatchDueMail(options)).toEqual({mailed: 0, mailFailed: 1});
    expect(await dispatchDueMail(options)).toEqual({mailed: 0, mailFailed: 1});
    expect(await dispatchDueMail(options)).toEqual({mailed: 1, mailFailed: 0});
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['failed', 'unknown', 'sent']);
    expect(database.claims).toHaveLength(3);
  });

  it('hands an alarm to exactly one of two dispatches that overlap (the monitor and the heartbeat evaluation at :00): one mail, one `sent` notice', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const slow = {...deps(database, mail, {conditions: [fixtureSubjects(['one', 'two'])]}), send: async (alarm: Parameters<typeof mail.send>[0]) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return mail.send(alarm);
    }};
    await applyConditions('monitor', {...(await import('@/lib/lifecycle').then((m) => m.alarmObservations(accounts(database)))), heartbeatConfigured: false}, slow);
    const [first, second] = await Promise.all([dispatchDueMail(slow), dispatchDueMail(slow)]);
    expect(first.mailed + second.mailed).toBe(2);
    expect([first.mailed, second.mailed].sort()).toEqual([0, 2]);
    expect(mail.mails.map((alarm) => alarm.subject).sort()).toEqual(['one', 'two']);
    expect(database.notices.map((notice) => notice.outcome)).toEqual(['sent', 'sent']);
  });

  it('retries a sender that crashed after claiming only after 10 minutes: held at 9 minutes 59 seconds, due at 10 minutes 1 second', async () => {
    const database = fakeDatabase();
    const id = await open(database, 'fixture-crash', 'one');
    expect(await due(database)).toEqual([id]);
    // The sender "crashes": nothing is recorded.
    database.advance(10 * 60_000 - 1000);
    expect(await due(database)).toEqual([]);
    database.advance(2000);
    expect(await due(database)).toEqual([id]);
  });

  it('lets a later `sent`, `failed` or `unknown` notice release the claim at once, and an EARLIER one does not', async () => {
    const database = fakeDatabase();
    for (const outcome of ['failed', 'unknown'] as const) {
      const id = await open(database, `fixture-${outcome}`, 'one');
      expect(await due(database)).toContain(id);
      expect(await due(database)).not.toContain(id);
      await recordAlarmNotice({alarmId: id, outcome}, accounts(database));
      expect(await due(database)).toContain(id);
    }
  });

  it('holds an alarm with no subject for a claim on ANY alarm of its condition, and a subject-keyed alarm only for its own', async () => {
    const database = fakeDatabase();
    // A claim on an alarm of the condition (its sender crashed), which is then resolved.
    const first = await open(database, 'fixture-hold', null);
    expect(await due(database)).toContain(first);
    await resolveAlarm({condition: 'fixture-hold', subject: null}, accounts(database));
    // The condition came back: its new alarm has no subject, so the old claim holds it. A subject-keyed alarm of the same condition is not held.
    const second = await open(database, 'fixture-hold', null);
    const keyed = await open(database, 'fixture-hold', 'A');
    const handed = await due(database);
    expect(handed).toContain(keyed);
    expect(handed).not.toContain(second);
    // Ten minutes later the claim has lapsed.
    database.advance(10 * 60_000 + 1);
    expect(await due(database)).toContain(second);
  });

  it('does not let a caller record a claim: the typed call refuses it before asking, and the database refuses it too', async () => {
    const database = fakeDatabase();
    const id = await open(database, 'fixture-claim', 'one');
    await expect(recordAlarmNotice({alarmId: id, outcome: 'claimed' as never}, accounts(database))).rejects.toBeInstanceOf(TypeError);
    const calls = database.calls.length;
    await expect(recordAlarmNotice({alarmId: id, outcome: 'claimed' as never}, accounts(database))).rejects.toBeInstanceOf(TypeError);
    expect(database.calls.length).toBe(calls);
    const refused = await database.fetch('http://x/rest/v1/rpc/record_alarm_notice', {body: JSON.stringify({p_alarm_id: id, p_outcome: 'claimed'})} as RequestInit);
    expect(refused.status).toBe(400);
  });
});

describe('dispatchDueMail: a deadline for starting sends (review patch P1)', () => {
  /** A clock the test moves: every send takes `sendMs` of it. */
  function clocked(sendMs: number) {
    const time = {now: 0};
    const mail = sender();
    const send = async (alarm: Parameters<typeof mail.send>[0]) => {
      const answer = await mail.send(alarm);
      time.now += sendMs;
      return answer;
    };
    return {time, mail, send, clock: () => time.now};
  }
  const subjectsOf = (mail: ReturnType<typeof sender>) => mail.mails.map((alarm) => alarm.subject);

  async function openFive(database: Database, mail: ReturnType<typeof sender>) {
    const options = deps(database, mail, {conditions: [fixtureSubjects(['a', 'b', 'c', 'd', 'e'])]});
    await applyConditions('monitor', {...(await import('@/lib/lifecycle').then((m) => m.alarmObservations({env, fetch: database.fetch as never}))), heartbeatConfigured: false}, options);
    return options;
  }

  // CHANGED (F1): the alarms it did not reach used to have no notice and were due at the next evaluation. They were claimed when the dispatch listed them and no outcome
  // was recorded for them, so each keeps its claim: not due for 10 minutes, then due again. (The page shows them as pending, not failing: no outcome was recorded.)
  it('stops STARTING sends once ten seconds have passed since it began, and leaves what it did not reach claimed with no outcome, so it is due again when the claim lapses', async () => {
    const database = fakeDatabase();
    const world = clocked(4_000);
    const options = {...(await openFive(database, world.mail)), send: world.send, clock: world.clock};
    // 0 s, 4 s and 8 s start a send; at 12 s the deadline has passed and the last two are not tried.
    expect(await dispatchDueMail(options)).toEqual({mailed: 3, mailFailed: 0});
    expect(subjectsOf(world.mail)).toEqual(['a', 'b', 'c']);
    expect(database.notices).toHaveLength(3);
    expect(database.alarms.filter((alarm) => alarm.resolvedAt === null)).toHaveLength(5);
    expect(database.claims).toHaveLength(5);
    // The very next evaluation (a fresh clock) finds the two it did not reach still claimed: nothing is sent, and nothing is recorded for them.
    world.time.now = 0;
    expect(await dispatchDueMail(options)).toEqual({mailed: 0, mailFailed: 0});
    expect(database.notices).toHaveLength(3);
    // Ten minutes after the claim, they are due, and exactly they are sent.
    database.advance(10 * 60_000 + 1);
    expect(await dispatchDueMail(options)).toEqual({mailed: 2, mailFailed: 0});
    expect(subjectsOf(world.mail)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await dispatchDueMail(options)).toEqual({mailed: 0, mailFailed: 0});
  });

  it('measures from when the dispatch began, not from when the clock started, and stops at exactly ten seconds', async () => {
    const database = fakeDatabase();
    const world = clocked(10_000);
    world.time.now = 987_654;
    const options = {...(await openFive(database, world.mail)), send: world.send, clock: world.clock};
    // The first send always starts; it takes ten seconds, which is the deadline, so the second does not.
    expect(await dispatchDueMail(options)).toEqual({mailed: 1, mailFailed: 0});
    expect(subjectsOf(world.mail)).toEqual(['a']);
    const quick = clocked(9_999);
    const second = {...options, send: quick.send, clock: quick.clock};
    // (The four it did not reach are held by their claims for 10 minutes.)
    expect(await dispatchDueMail(second)).toEqual({mailed: 0, mailFailed: 0});
    database.advance(10 * 60_000 + 1);
    // Nine seconds and 999 milliseconds for each: the second starts at 9.999 s, the third does not.
    expect(await dispatchDueMail(second)).toEqual({mailed: 2, mailFailed: 0});
    expect(subjectsOf(quick.mail)).toEqual(['b', 'c']);
  });

  it('counts the failures of the sends it did start, and the deadline is a property of the dispatch, which the monitor and the heartbeat evaluation both pass on', async () => {
    const database = fakeDatabase();
    const time = {now: 0};
    const mail = sender([refused]);
    const send = async (alarm: Parameters<typeof mail.send>[0]) => {
      const answer = await mail.send(alarm);
      time.now += 6_000;
      return answer;
    };
    const options = {...(await openFive(database, mail)), send, clock: () => time.now};
    expect(await dispatchDueMail(options)).toEqual({mailed: 1, mailFailed: 1});
    time.now = 0;
    database.observed.value.latest_receipt_age = 60;
    // `a` failed (its claim is released) and `c`, `d`, `e` were not reached (claimed): after the claims lapse, `a` and `c` go, and then `d` and `e`.
    database.advance(10 * 60_000 + 1);
    expect(await runAlarmMonitor({...options, conditions: [fixtureSubjects(['a', 'b', 'c', 'd', 'e'])]})).toMatchObject({mailed: 2, mailFailed: 0});
    time.now = 0;
    database.advance(10 * 60_000 + 1);
    expect(await runHeartbeatEvaluation({...options, conditions: []})).toMatchObject({mailed: 2});
    expect(subjectsOf(mail).sort()).toEqual(['a', 'a', 'b', 'c', 'd', 'e']);
  });

  it('is ten seconds, and a send that is stuck is the mailer\'s ten-second timeout, so the whole dispatch is about twenty seconds at worst', async () => {
    expect(dispatchDeadlineMs).toBe(10_000);
    expect(dispatchDeadlineMs + mailTimeoutMs).toBe(20_000);
    expect(postTimeoutMs).toBeGreaterThan(dispatchDeadlineMs + mailTimeoutMs);
  });

  it('uses a monotonic clock of its own by default, and sends everything that is due when nothing is slow', async () => {
    const database = fakeDatabase();
    const mail = sender();
    const options = await openFive(database, mail);
    expect(await dispatchDueMail(options)).toEqual({mailed: 5, mailFailed: 0});
  });
});

describe('the pushed helper (review patch P7)', () => {
  it('returns the raise result and counts one failed mail, without throwing, when the dispatch after the raise throws: the alarm is recorded', async () => {
    const database = fakeDatabase();
    const mail = sender();
    database.fail.alarms_due_mail = () => json({message: 'down'}, 503);
    const pushed = await raiseAlarm({condition: 'payment-exception', subject: 'pay_A', detail: {amount: 5}}, deps(database, mail));
    expect(pushed).toEqual({outcome: 'opened', alarmId: database.alarms[0].id, mailed: 0, mailFailed: 1});
    expect(database.alarms).toHaveLength(1);
    expect(mail.send).not.toHaveBeenCalled();
    // The next evaluation mails it.
    delete database.fail.alarms_due_mail;
    expect(await dispatchDueMail(deps(database, mail))).toEqual({mailed: 1, mailFailed: 0});
  });

  it('still throws when the alarm itself could not be recorded: that is the one thing the caller must know', async () => {
    const database = fakeDatabase();
    database.fail.raise_alarm = () => json({message: 'down'}, 503);
    await expect(raiseAlarm({condition: 'payment-exception', subject: 'pay_A', detail: {}}, deps(database, sender()))).rejects.toBeInstanceOf(AccountsUnavailableError);
  });

  it('takes its detail as an AlarmDetail: a detail the database would refuse is refused before the call', async () => {
    const database = fakeDatabase();
    const detail: AlarmDetail = {amount: 5, paid: false, note: 'x'};
    expect(await raiseAlarm({condition: 'payment-exception', subject: 'pay_B', detail}, deps(database, sender()))).toMatchObject({outcome: 'opened'});
    await expect(raiseAlarm({condition: 'payment-exception', subject: 'pay_C', detail: {big: 1000000000000000}}, deps(database, sender()))).rejects.toBeInstanceOf(TypeError);
  });
});

describe('what it prints and reads', () => {
  it('prints nothing', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const database = fakeDatabase();
    database.observed.value.unaccounted = 99;
    await runAlarmMonitor(deps(database, sender(['throw']), {conditions: [fixtureThreshold]}));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
